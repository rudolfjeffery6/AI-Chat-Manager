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

logger.log('background loaded')

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
        break
      }

      offset += SYNC_BATCH_SIZE
      await sleep(SYNC_DELAY_MS)
    }

    // Clear sync progress when done
    await chrome.storage.local.remove(getSyncProgressKey(platform))

  } catch (err) {
    logger.error(`[${platform}] Sync error:`, err)
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
        sendResponse({ success: true })
        // Auto-start sync when token is set
        startSync(platform)
      } else {
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

  } catch (err) {
    logger.error('Error in message handler:', err)
    sendResponse({ error: String(err) })
  }

  return true
})
