import { logger } from './utils/logger'
import { getConversations, getConversation, deleteConversation } from './api/chatgpt'
import type { Conversation } from './api/chatgpt'

logger.log('background loaded')

// Token management
let accessToken: string | null = null

// Sync state
let syncInProgress = false
let syncAborted = false

// Cache keys
const CACHE_KEY = 'conversationCache'
const SYNC_PROGRESS_KEY = 'syncProgress'
const SYNC_ERROR_KEY = 'syncError'

// Cache type
interface ConversationCache {
  conversations: Conversation[]
  totalCount: number
  lastSyncTime: number
  syncComplete: boolean
}

// Sync constants
const SYNC_BATCH_SIZE = 50
const SYNC_DELAY_MS = 300

// Helper function for delay
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getToken(): Promise<string | null> {
  if (accessToken) return accessToken

  return new Promise((resolve) => {
    chrome.storage.session.get(['accessToken'], (result) => {
      const token = result.accessToken as string | undefined
      if (token) {
        accessToken = token
        resolve(token)
      } else {
        resolve(null)
      }
    })
  })
}

// Main sync function - runs in background, survives popup close
async function startSync(forceRefresh = false) {
  if (syncInProgress) {
    logger.log('Sync already in progress, skipping')
    return
  }

  const token = await getToken()
  if (!token) {
    logger.error('No token available for sync')
    await chrome.storage.local.set({
      [SYNC_ERROR_KEY]: 'No token available. Please open ChatGPT first.'
    })
    return
  }

  // Check if we need to sync (cache < 5 minutes old and not forced)
  if (!forceRefresh) {
    const cached = await chrome.storage.local.get(CACHE_KEY)
    const cache = cached[CACHE_KEY] as ConversationCache | undefined
    if (cache?.lastSyncTime && cache?.syncComplete) {
      const age = Date.now() - cache.lastSyncTime
      if (age < 5 * 60 * 1000) {
        logger.log('Cache is fresh (< 5 min), skipping sync')
        return
      }
    }
  }

  syncInProgress = true
  syncAborted = false
  logger.log('Starting background sync')

  // Clear previous error
  await chrome.storage.local.remove(SYNC_ERROR_KEY)

  try {
    const allConversations: Conversation[] = []
    let offset = 0
    let totalCount = 0

    while (!syncAborted) {
      logger.log(`Fetching conversations: offset=${offset}, limit=${SYNC_BATCH_SIZE}`)

      const data = await getConversations(token, offset, SYNC_BATCH_SIZE)

      if (!data?.items) {
        logger.error('Invalid API response')
        break
      }

      allConversations.push(...data.items)
      totalCount = data.total || allConversations.length

      const loadedCount = offset + data.items.length
      const hasMore = loadedCount < totalCount

      logger.log(`Fetched ${allConversations.length}/${totalCount} conversations`)

      // Save progress to storage (allows popup to show real-time updates)
      await chrome.storage.local.set({
        [CACHE_KEY]: {
          conversations: allConversations,
          totalCount,
          lastSyncTime: Date.now(),
          syncComplete: !hasMore
        },
        [SYNC_PROGRESS_KEY]: {
          loaded: allConversations.length,
          total: totalCount,
          inProgress: true
        }
      })

      if (!hasMore) {
        logger.log('Sync complete!')
        break
      }

      offset += SYNC_BATCH_SIZE
      await sleep(SYNC_DELAY_MS)
    }

    // Clear sync progress when done
    await chrome.storage.local.remove(SYNC_PROGRESS_KEY)

  } catch (err) {
    logger.error('Sync error:', err)
    await chrome.storage.local.set({
      [SYNC_ERROR_KEY]: String(err)
    })
    // Clear sync progress on error
    await chrome.storage.local.remove(SYNC_PROGRESS_KEY)
  } finally {
    syncInProgress = false
    logger.log('Sync finished')
  }
}

// Stop sync (e.g., when user wants to cancel)
function stopSync() {
  syncAborted = true
  logger.log('Sync aborted by user')
}

// Remove conversation from cache after deletion
async function removeFromCache(conversationId: string) {
  const cached = await chrome.storage.local.get(CACHE_KEY)
  const cache = cached[CACHE_KEY] as ConversationCache | undefined
  if (cache?.conversations) {
    cache.conversations = cache.conversations.filter(
      (c: Conversation) => c.id !== conversationId
    )
    cache.totalCount = cache.conversations.length
    await chrome.storage.local.set({ [CACHE_KEY]: cache })
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logger.log('Background received:', message)

  try {
    if (message.type === 'PING') {
      sendResponse({ type: 'PONG', time: Date.now() })
      return true
    }

    // === Sync management ===
    if (message.type === 'START_SYNC') {
      const forceRefresh = message.forceRefresh ?? false
      startSync(forceRefresh)
      sendResponse({ status: 'started', inProgress: syncInProgress })
      return true
    }

    if (message.type === 'STOP_SYNC') {
      stopSync()
      sendResponse({ status: 'stopped' })
      return true
    }

    if (message.type === 'GET_SYNC_STATUS') {
      sendResponse({ inProgress: syncInProgress })
      return true
    }

    // === Token management ===
    if (message.type === 'SET_TOKEN') {
      accessToken = message.token
      chrome.storage.session.set({ accessToken: message.token })
      logger.log('Token stored')
      sendResponse({ success: true })
      // Auto-start sync when token is set
      startSync()
      return true
    }

    if (message.type === 'GET_TOKEN_STATUS') {
      getToken().then(token => {
        if (token) {
          sendResponse({ hasToken: true, tokenPreview: token.substring(0, 20) + '...' })
        } else {
          sendResponse({ hasToken: false })
        }
      })
      return true
    }

    // === Legacy: Direct API calls (for conversation details) ===
    if (message.type === 'GET_CONVERSATIONS') {
      getToken().then(async token => {
        if (!token) {
          sendResponse({ error: 'No token available' })
          return
        }
        try {
          const offset = message.offset || 0
          const limit = message.limit || 28
          const data = await getConversations(token, offset, limit)
          const loadedCount = offset + data.items.length
          const has_more = loadedCount < data.total
          sendResponse({
            data: {
              ...data,
              has_more
            }
          })
        } catch (err) {
          logger.error('Failed to fetch conversations:', err)
          sendResponse({ error: String(err) })
        }
      })
      return true
    }

    if (message.type === 'GET_CONVERSATION_DETAIL') {
      getToken().then(async token => {
        if (!token) {
          sendResponse({ error: 'No token available' })
          return
        }
        try {
          const data = await getConversation(token, message.conversationId)
          sendResponse({ data })
        } catch (err) {
          logger.error('Failed to fetch conversation:', err)
          sendResponse({ error: String(err) })
        }
      })
      return true
    }

    // === Backup management ===
    if (message.type === 'BACKUP_CONVERSATION') {
      getToken().then(async token => {
        if (!token) {
          sendResponse({ error: 'No token available' })
          return
        }
        try {
          const data = await getConversation(token, message.conversationId)
          const backup = {
            id: message.conversationId,
            title: data.title,
            messages: data.messages,
            backupTime: Date.now()
          }
          await chrome.storage.local.set({ [`backup_${message.conversationId}`]: backup })
          sendResponse({ success: true })
        } catch (err) {
          logger.error('Failed to backup conversation:', err)
          sendResponse({ error: String(err) })
        }
      })
      return true
    }

    if (message.type === 'GET_BACKUPS') {
      chrome.storage.local.get(null, (items) => {
        const backups = Object.entries(items)
          .filter(([key]) => key.startsWith('backup_'))
          .map(([, value]) => value)
          .sort((a: any, b: any) => b.backupTime - a.backupTime)
        sendResponse({ backups })
      })
      return true
    }

    if (message.type === 'DELETE_BACKUP') {
      chrome.storage.local.remove(`backup_${message.conversationId}`, () => {
        sendResponse({ success: true })
      })
      return true
    }

    // === Conversation deletion ===
    if (message.type === 'DELETE_CONVERSATION') {
      getToken().then(async token => {
        if (!token) {
          sendResponse({ error: 'No token available' })
          return
        }
        try {
          await deleteConversation(token, message.conversationId)
          // Remove from cache immediately
          await removeFromCache(message.conversationId)
          sendResponse({ success: true })
        } catch (err) {
          logger.error('Failed to delete conversation:', err)
          sendResponse({ error: String(err) })
        }
      })
      return true
    }

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
        } catch (err) {
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
