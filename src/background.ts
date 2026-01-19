/**
 * Background Service Worker
 * Handles sync logic for all platforms via registry
 */

import { logger } from './utils/logger'
import { getPlatform, getAllPlatformAdapters } from './platforms/registry'
import {
  getCacheKey,
  getSyncProgressKey,
  getSyncErrorKey,
  getBackupKey
} from './platforms/types'
import type {
  PlatformType,
  PlatformCache,
  UnifiedConversation
} from './platforms/types'
import { ErrorCode } from './errors'

logger.log('background loaded')

// ==================== Diagnostics Logging System ====================

export interface LogEntry {
  timestamp: number
  level: 'INFO' | 'WARN' | 'ERROR'
  action: string
  url?: string
  status?: number
  duration?: number
  message?: string
  stack?: string
  platform?: string
}

const DIAGNOSTICS_LOGS_KEY = 'diagnostics_logs'
const MAX_LOG_ENTRIES = 50

async function getDiagnosticsLogs(): Promise<LogEntry[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([DIAGNOSTICS_LOGS_KEY], (result) => {
      resolve((result[DIAGNOSTICS_LOGS_KEY] as LogEntry[] | undefined) || [])
    })
  })
}

async function addDiagnosticsLog(entry: Omit<LogEntry, 'timestamp'>): Promise<void> {
  const logs = await getDiagnosticsLogs()
  const newEntry: LogEntry = {
    ...entry,
    timestamp: Date.now()
  }
  logs.push(newEntry)
  // Ring buffer: keep only last MAX_LOG_ENTRIES
  while (logs.length > MAX_LOG_ENTRIES) {
    logs.shift()
  }
  await chrome.storage.local.set({ [DIAGNOSTICS_LOGS_KEY]: logs })
}

async function clearDiagnosticsLogs(): Promise<void> {
  await chrome.storage.local.set({ [DIAGNOSTICS_LOGS_KEY]: [] })
}

// Helper to log with diagnostics
async function diagLog(level: LogEntry['level'], action: string, details?: Partial<LogEntry>): Promise<void> {
  await addDiagnosticsLog({ level, action, ...details })
  if (level === 'ERROR') {
    logger.error(`[DIAG] ${action}`, details?.message || '')
  } else if (level === 'WARN') {
    logger.log(`[DIAG] ${action}`, details?.message || '')
  } else {
    logger.log(`[DIAG] ${action}`, details?.message || '')
  }
}

// Sync state per platform
const syncState: Record<PlatformType, { inProgress: boolean; aborted: boolean }> = {
  chatgpt: { inProgress: false, aborted: false },
  claude: { inProgress: false, aborted: false },
  gemini: { inProgress: false, aborted: false }
}

// Sync constants
const SYNC_BATCH_SIZE = 50
const SYNC_DELAY_MS = 300
const CACHE_FRESHNESS_MS = 5 * 60 * 1000 // 5 minutes

// Helper function for delay
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Get token for a platform from session storage
 */
async function getStoredToken(platform: PlatformType): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.session.get([`${platform}_token`], (result) => {
      const token = result[`${platform}_token`] as string | undefined
      resolve(token || null)
    })
  })
}

/**
 * Store token for a platform
 */
async function storeToken(platform: PlatformType, token: string): Promise<void> {
  await chrome.storage.session.set({ [`${platform}_token`]: token })
}

/**
 * Main sync function - runs in background, survives popup close
 */
async function startSync(platform: PlatformType, forceRefresh = false) {
  const state = syncState[platform]
  if (state.inProgress) {
    logger.log(`[${platform}] Sync already in progress, skipping`)
    return
  }

  const adapter = getPlatform(platform)
  if (!adapter) {
    logger.error(`[${platform}] Platform not found`)
    return
  }

  // Restore token from storage
  const storedToken = await getStoredToken(platform)
  if (storedToken) {
    adapter.setToken(storedToken)
  }

  // Check auth
  const authResult = await adapter.checkAuth()
  if (!authResult.ok) {
    logger.error(`[${platform}] Auth failed:`, authResult.message)
    diagLog('WARN', 'Auth check failed', {
      platform,
      message: authResult.error || ErrorCode.AUTH_REQUIRED
    })
    await chrome.storage.local.set({
      [getSyncErrorKey(platform)]: authResult.message || 'Authentication required'
    })
    return
  }

  // Check cache freshness
  if (!forceRefresh) {
    const cached = await chrome.storage.local.get(getCacheKey(platform))
    const cache = cached[getCacheKey(platform)] as PlatformCache | undefined
    if (cache?.lastSyncTime && cache?.syncComplete) {
      const age = Date.now() - cache.lastSyncTime
      if (age < CACHE_FRESHNESS_MS) {
        logger.log(`[${platform}] Cache is fresh (< 5 min), skipping sync`)
        return
      }
    }
  }

  state.inProgress = true
  state.aborted = false
  logger.log(`[${platform}] Starting background sync`)
  diagLog('INFO', 'Sync started', { platform })

  // Clear previous error
  await chrome.storage.local.remove(getSyncErrorKey(platform))

  try {
    const allConversations: UnifiedConversation[] = []
    let offset = 0
    let totalCount = 0

    while (!state.aborted) {
      logger.log(`[${platform}] Fetching: offset=${offset}, limit=${SYNC_BATCH_SIZE}`)

      const result = await adapter.getConversations(offset, SYNC_BATCH_SIZE)

      if (!result?.conversations) {
        logger.error(`[${platform}] Invalid API response`)
        break
      }

      allConversations.push(...result.conversations)
      totalCount = result.total || allConversations.length

      logger.log(`[${platform}] Fetched ${allConversations.length}/${totalCount}`)

      // Save progress to storage
      await chrome.storage.local.set({
        [getCacheKey(platform)]: {
          conversations: allConversations,
          totalCount,
          lastSyncTime: Date.now(),
          syncComplete: !result.hasMore
        } as PlatformCache,
        [getSyncProgressKey(platform)]: {
          loaded: allConversations.length,
          total: totalCount,
          inProgress: true
        }
      })

      if (!result.hasMore) {
        logger.log(`[${platform}] Sync complete!`)
        diagLog('INFO', 'Sync completed', {
          platform,
          message: `${allConversations.length} conversations synced`
        })
        break
      }

      offset += SYNC_BATCH_SIZE
      await sleep(SYNC_DELAY_MS)
    }

    // Clear sync progress when done
    await chrome.storage.local.remove(getSyncProgressKey(platform))

  } catch (err) {
    logger.error(`[${platform}] Sync error:`, err)
    diagLog('ERROR', 'Sync failed', {
      platform,
      message: String(err),
      stack: err instanceof Error ? err.stack : undefined
    })
    await chrome.storage.local.set({
      [getSyncErrorKey(platform)]: String(err)
    })
    await chrome.storage.local.remove(getSyncProgressKey(platform))
  } finally {
    state.inProgress = false
    logger.log(`[${platform}] Sync finished`)
  }
}

/**
 * Stop sync for a platform
 */
function stopSync(platform: PlatformType) {
  syncState[platform].aborted = true
  logger.log(`[${platform}] Sync aborted by user`)
}

/**
 * Remove conversation from cache after deletion
 */
async function removeFromCache(platform: PlatformType, conversationId: string) {
  const cacheKey = getCacheKey(platform)
  const cached = await chrome.storage.local.get(cacheKey)
  const cache = cached[cacheKey] as PlatformCache | undefined

  if (cache?.conversations) {
    cache.conversations = cache.conversations.filter(c => c.id !== conversationId)
    cache.totalCount = cache.conversations.length
    await chrome.storage.local.set({ [cacheKey]: cache })
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logger.log('Background received:', message)

  try {
    if (message.type === 'PING') {
      sendResponse({ type: 'PONG', time: Date.now() })
      return true
    }

    // === Sync management ===
    if (message.type === 'START_SYNC') {
      const platform = (message.platform || 'chatgpt') as PlatformType
      const forceRefresh = message.forceRefresh ?? false
      startSync(platform, forceRefresh)
      sendResponse({ status: 'started', inProgress: syncState[platform].inProgress })
      return true
    }

    if (message.type === 'STOP_SYNC') {
      const platform = (message.platform || 'chatgpt') as PlatformType
      stopSync(platform)
      sendResponse({ status: 'stopped' })
      return true
    }

    if (message.type === 'GET_SYNC_STATUS') {
      const platform = (message.platform || 'chatgpt') as PlatformType
      sendResponse({ inProgress: syncState[platform].inProgress })
      return true
    }

    // === Token management ===
    if (message.type === 'SET_TOKEN') {
      const platform = (message.platform || 'chatgpt') as PlatformType
      const token = message.token

      const adapter = getPlatform(platform)
      if (adapter) {
        adapter.setToken(token)
        storeToken(platform, token)
        logger.log(`[${platform}] Token stored`)
        diagLog('INFO', 'Token received', { platform })
        sendResponse({ success: true })
        // Auto-start sync when token is set
        startSync(platform)
      } else {
        diagLog('ERROR', 'Token set failed', { platform, message: ErrorCode.NO_TAB })
        sendResponse({ error: 'Platform not found' })
      }
      return true
    }

    if (message.type === 'GET_TOKEN_STATUS') {
      const platform = (message.platform || 'chatgpt') as PlatformType
      getStoredToken(platform).then(token => {
        if (token) {
          sendResponse({ hasToken: true, tokenPreview: token.substring(0, 20) + '...' })
        } else {
          sendResponse({ hasToken: false })
        }
      })
      return true
    }

    // === Conversation operations ===
    if (message.type === 'GET_CONVERSATION_DETAIL') {
      const platform = (message.platform || 'chatgpt') as PlatformType
      const adapter = getPlatform(platform)

      if (!adapter) {
        sendResponse({ error: 'Platform not found' })
        return true
      }

      getStoredToken(platform).then(async token => {
        if (token) adapter.setToken(token)

        try {
          const messages = await adapter.getConversationDetail(message.conversationId)
          sendResponse({ data: { messages } })
        } catch (err) {
          logger.error(`[${platform}] Failed to fetch conversation:`, err)
          sendResponse({ error: String(err) })
        }
      })
      return true
    }

    if (message.type === 'DELETE_CONVERSATION') {
      const platform = (message.platform || 'chatgpt') as PlatformType
      const adapter = getPlatform(platform)

      if (!adapter) {
        sendResponse({ error: 'Platform not found' })
        return true
      }

      getStoredToken(platform).then(async token => {
        if (token) adapter.setToken(token)

        try {
          await adapter.deleteConversation(message.conversationId)
          await removeFromCache(platform, message.conversationId)
          sendResponse({ success: true })
        } catch (err) {
          logger.error(`[${platform}] Failed to delete conversation:`, err)
          sendResponse({ error: String(err) })
        }
      })
      return true
    }

    // === Backup management ===
    if (message.type === 'BACKUP_CONVERSATION') {
      const platform = (message.platform || 'chatgpt') as PlatformType
      const adapter = getPlatform(platform)

      if (!adapter) {
        sendResponse({ error: 'Platform not found' })
        return true
      }

      getStoredToken(platform).then(async token => {
        if (token) adapter.setToken(token)

        try {
          const messages = await adapter.getConversationDetail(message.conversationId)

          // Get title from cache
          const cacheKey = getCacheKey(platform)
          const cached = await chrome.storage.local.get(cacheKey)
          const cache = cached[cacheKey] as PlatformCache | undefined
          const conv = cache?.conversations?.find(c => c.id === message.conversationId)

          const backup = {
            id: message.conversationId,
            title: conv?.title || 'Untitled',
            platform,
            messages,
            backupTime: Date.now()
          }
          await chrome.storage.local.set({
            [getBackupKey(platform, message.conversationId)]: backup
          })
          sendResponse({ success: true })
        } catch (err) {
          logger.error(`[${platform}] Failed to backup conversation:`, err)
          sendResponse({ error: String(err) })
        }
      })
      return true
    }

    if (message.type === 'GET_BACKUPS') {
      const platform = message.platform as PlatformType | undefined

      chrome.storage.local.get(null, (items) => {
        const backups = Object.entries(items)
          .filter(([key]) => {
            if (platform) {
              return key.startsWith(`${platform}_backup_`)
            }
            // Return all backups
            return key.includes('_backup_')
          })
          .map(([, value]) => value)
          .sort((a: any, b: any) => b.backupTime - a.backupTime)
        sendResponse({ backups })
      })
      return true
    }

    if (message.type === 'DELETE_BACKUP') {
      const platform = (message.platform || 'chatgpt') as PlatformType
      chrome.storage.local.remove(
        getBackupKey(platform, message.conversationId),
        () => sendResponse({ success: true })
      )
      return true
    }

    // === Platform info ===
    if (message.type === 'GET_PLATFORMS') {
      const platforms = getAllPlatformAdapters().map(p => ({
        name: p.name,
        displayName: p.displayName,
        icon: p.icon,
        color: p.color
      }))
      sendResponse({ platforms })
      return true
    }

    if (message.type === 'CHECK_PLATFORM_AUTH') {
      const platform = (message.platform || 'chatgpt') as PlatformType
      const adapter = getPlatform(platform)

      if (!adapter) {
        sendResponse({ ok: false, error: 'Platform not found' })
        return true
      }

      getStoredToken(platform).then(async token => {
        if (token) adapter.setToken(token)

        const result = await adapter.checkAuth()
        sendResponse(result)
      })
      return true
    }

    // === Legacy support ===
    if (message.type === 'GET_PAGE_INFO') {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs[0]
        if (!tab?.id) {
          sendResponse({ error: 'No active tab found' })
          return
        }
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' })
          sendResponse(response)
        } catch {
          sendResponse({ error: 'Content script not available' })
        }
      })
      return true
    }

    if (message.type === 'TEST_ERROR') {
      throw new Error('Test error')
    }

    // === Diagnostics ===
    if (message.type === 'GET_LOGS') {
      getDiagnosticsLogs().then(logs => sendResponse({ logs }))
      return true
    }

    if (message.type === 'CLEAR_LOGS') {
      clearDiagnosticsLogs().then(() => {
        diagLog('INFO', 'Logs cleared')
        sendResponse({ success: true })
      })
      return true
    }

    if (message.type === 'PROBE') {
      const platform = (message.platform || 'chatgpt') as PlatformType
      const adapter = getPlatform(platform)
      const startTime = Date.now()

      if (!adapter) {
        diagLog('ERROR', 'Probe failed', {
          platform,
          message: ErrorCode.NO_TAB
        })
        sendResponse({ ok: false, error: ErrorCode.NO_TAB })
        return true
      }

      getStoredToken(platform).then(async token => {
        if (token) adapter.setToken(token)

        try {
          // Try to fetch just 1 conversation to test API
          const result = await adapter.getConversations(0, 1)
          const duration = Date.now() - startTime

          diagLog('INFO', 'Probe success', {
            platform,
            duration,
            status: 200,
            message: `API OK - ${result.total} total conversations`
          })

          sendResponse({
            ok: true,
            duration,
            status: 200,
            total: result.total
          })
        } catch (err) {
          const duration = Date.now() - startTime
          const errorMsg = String(err)
          let errorCode = ErrorCode.NETWORK_ERROR
          let status = 0

          if (errorMsg.includes('AUTH_REQUIRED') || errorMsg.includes('401')) {
            errorCode = ErrorCode.AUTH_REQUIRED
            status = 401
          } else if (errorMsg.includes('403')) {
            errorCode = ErrorCode.AUTH_REQUIRED
            status = 403
          } else if (errorMsg.includes('429')) {
            errorCode = ErrorCode.RATE_LIMITED
            status = 429
          }

          diagLog('ERROR', 'Probe failed', {
            platform,
            duration,
            status,
            message: errorCode,
            stack: err instanceof Error ? err.stack : undefined
          })

          sendResponse({
            ok: false,
            duration,
            status,
            error: errorCode
          })
        }
      })
      return true
    }

  } catch (err) {
    logger.error('Error in message handler:', err)
    diagLog('ERROR', 'Message handler error', {
      message: String(err),
      stack: err instanceof Error ? err.stack : undefined
    })
    sendResponse({ error: String(err) })
  }

  return true
})
