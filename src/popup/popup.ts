/**
 * Popup UI
 * Multi-platform conversation manager
 */

import { logger } from '../utils/logger'
import { getAllPlatforms } from '../platforms/registry'
import {
  getCacheKey,
  getSyncProgressKey,
  getSyncErrorKey,
  getPreviewCacheKey,
  getContentIndexKey,
  getIndexProgressKey,
  PREVIEW_CACHE_EXPIRY_MS
} from '../platforms/types'
import type {
  PlatformType,
  PlatformConfig,
  PlatformCache,
  SyncProgress,
  UnifiedConversation,
  UnifiedMessage,
  PreviewCache,
  ContentIndex,
  IndexProgress
} from '../platforms/types'
import { ErrorCode, ErrorMessages } from '../errors'

// Diagnostics types
interface LogEntry {
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

logger.log('popup loaded')

// DOM elements
const errorDiv = document.getElementById('error') as HTMLDivElement
const tokenStatusDiv = document.getElementById('tokenStatus') as HTMLDivElement
const contentDiv = document.getElementById('content') as HTMLDivElement
const confirmDialog = document.getElementById('confirmDialog') as HTMLDivElement
const dialogMessage = document.getElementById('dialogMessage') as HTMLDivElement
const backupCheckbox = document.getElementById('backupCheckbox') as HTMLInputElement
const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement
const confirmBtn = document.getElementById('confirmBtn') as HTMLButtonElement

// Sort options
type SortOption = 'updated' | 'created' | 'title'
const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'updated', label: 'Recent Update' },
  { value: 'created', label: 'Created Time' },
  { value: 'title', label: 'Title A-Z' }
]

// State
let currentPlatform: PlatformType = 'chatgpt'
let platforms: PlatformConfig[] = []
let selectedConversationId: string | null = null
let pendingDeleteId: string | null = null
let pendingDeleteIds: string[] = []
let currentView: 'conversations' | 'backups' | 'diagnostics' = 'conversations'
let selectedForDelete: Set<string> = new Set()
let searchQuery: string = ''
let currentSortOption: SortOption = 'updated'

// Loading states
let deletingIds: Set<string> = new Set()

// Cache data (read from storage)
let cachedConversations: UnifiedConversation[] = []
let lastSyncTime: number | null = null
let syncComplete = false
let syncProgress: SyncProgress | null = null

// Content index data
let contentIndex: ContentIndex = {}
let indexProgress: IndexProgress | null = null

// Search results with snippets
interface SearchResult {
  conv: UnifiedConversation
  matchType: 'title' | 'content'
  snippet: string | null
}

// Settings
const SETTINGS_KEY = 'settings'
let backupBeforeDeletePref = false

// Load platforms on init
async function loadPlatforms(): Promise<void> {
  platforms = getAllPlatforms()
  logger.log('Loaded platforms:', platforms.map(p => p.name))
}

// Load user settings from storage
async function loadSettings(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY, 'lastPlatform', 'sortOption'], (result) => {
      const settings = result[SETTINGS_KEY] as { backupBeforeDelete?: boolean } | undefined
      if (settings?.backupBeforeDelete !== undefined) {
        backupBeforeDeletePref = settings.backupBeforeDelete
      }
      // Restore last used platform
      if (result.lastPlatform && platforms.some(p => p.name === result.lastPlatform)) {
        currentPlatform = result.lastPlatform as PlatformType
      }
      // Restore sort option
      if (result.sortOption && SORT_OPTIONS.some(o => o.value === result.sortOption)) {
        currentSortOption = result.sortOption as SortOption
      }
      resolve()
    })
  })
}

// Save backup preference
function saveBackupPreference(value: boolean): void {
  backupBeforeDeletePref = value
  chrome.storage.local.get([SETTINGS_KEY], (result) => {
    const settings = (result[SETTINGS_KEY] as Record<string, unknown>) || {}
    settings.backupBeforeDelete = value
    chrome.storage.local.set({ [SETTINGS_KEY]: settings })
  })
}

// Save current platform
function saveCurrentPlatform(): void {
  chrome.storage.local.set({ lastPlatform: currentPlatform })
}

backupCheckbox.addEventListener('change', () => {
  saveBackupPreference(backupCheckbox.checked)
})

// Load cache for current platform
async function loadCache(): Promise<boolean> {
  const cacheKey = getCacheKey(currentPlatform)
  const progressKey = getSyncProgressKey(currentPlatform)
  const errorKey = getSyncErrorKey(currentPlatform)
  const contentIndexKey = getContentIndexKey(currentPlatform)
  const indexProgressKey = getIndexProgressKey(currentPlatform)

  return new Promise((resolve) => {
    chrome.storage.local.get([cacheKey, progressKey, errorKey, contentIndexKey, indexProgressKey], (result) => {
      logger.log(`[${currentPlatform}] loadCache: keys:`, Object.keys(result))

      const cache = result[cacheKey] as PlatformCache | undefined

      if (cache?.conversations && Array.isArray(cache.conversations)) {
        cachedConversations = cache.conversations
        lastSyncTime = cache.lastSyncTime || null
        syncComplete = cache.syncComplete || false
        logger.log(`[${currentPlatform}] loadCache: ${cachedConversations.length} conversations`)
        resolve(true)
      } else {
        cachedConversations = []
        lastSyncTime = null
        syncComplete = false
        logger.log(`[${currentPlatform}] loadCache: NO CACHE`)
        resolve(false)
      }

      syncProgress = result[progressKey] as SyncProgress | undefined || null

      // Load content index
      contentIndex = (result[contentIndexKey] as ContentIndex | undefined) || {}
      indexProgress = (result[indexProgressKey] as IndexProgress | undefined) || null
      logger.log(`[${currentPlatform}] loadCache: ${Object.keys(contentIndex).length} indexed conversations`)

      const syncError = result[errorKey] as string | undefined
      if (syncError) {
        logger.error(`[${currentPlatform}] Sync error:`, syncError)
      }
    })
  })
}

function showError(message: string) {
  errorDiv.textContent = message
  errorDiv.classList.remove('hidden')
  logger.error(message)
}

function clearError() {
  errorDiv.classList.add('hidden')
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function formatDate(dateStr: string | number): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function cleanSnippet(text: string, maxLength = 120): string {
  if (!text) return ''
  return text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim().substring(0, maxLength)
}

function extractSnippet(messages: UnifiedMessage[]): string {
  if (!messages || messages.length === 0) return ''
  const filtered = messages.filter(m => m.role === 'assistant' || m.role === 'user').reverse()
  const assistantMsg = filtered.find(m => m.role === 'assistant')
  if (assistantMsg) return cleanSnippet(assistantMsg.content)
  const userMsg = filtered.find(m => m.role === 'user')
  if (userMsg) return cleanSnippet(userMsg.content)
  return ''
}

// Error parsing
type ErrorType = 'auth' | 'rate_limit' | 'network' | 'server' | 'not_found' | 'generic'

interface ParsedError {
  type: ErrorType
  message: string
  retryAfter?: number
}

function parseErrorDetailed(error: string): ParsedError {
  if (error.includes('401') || error.includes('Unauthorized') || error.includes('AUTH_REQUIRED')) {
    const platform = platforms.find(p => p.name === currentPlatform)
    return { type: 'auth', message: `Session expired. Please refresh ${platform?.displayName || 'the platform'} page.` }
  }
  if (error.includes('403') || error.includes('Forbidden')) {
    return { type: 'auth', message: 'Access denied. Please log in first.' }
  }
  if (error.includes('404')) {
    return { type: 'not_found', message: 'Conversation not found.' }
  }
  if (error.includes('429')) {
    const retryMatch = error.match(/(\d+)\s*seconds?/i)
    const retryAfter = retryMatch ? parseInt(retryMatch[1]) : 30
    return { type: 'rate_limit', message: 'Too many requests.', retryAfter }
  }
  if (error.includes('500') || error.includes('502') || error.includes('503')) {
    return { type: 'server', message: 'Server temporarily unavailable.' }
  }
  if (error.includes('network') || error.includes('fetch') || error.includes('Failed to fetch')) {
    return { type: 'network', message: 'Unable to connect.' }
  }
  return { type: 'generic', message: error }
}

function parseError(error: string): string {
  return parseErrorDetailed(error).message
}

// Rate limit countdown
let rateLimitCountdown: number | null = null
let rateLimitTimer: number | null = null

function showErrorWithAction(error: string) {
  const parsed = parseErrorDetailed(error)

  if (rateLimitTimer) {
    clearInterval(rateLimitTimer)
    rateLimitTimer = null
  }

  switch (parsed.type) {
    case 'auth':
      showAuthError(parsed.message)
      break
    case 'rate_limit':
      showRateLimitError(parsed.message, parsed.retryAfter || 30)
      break
    case 'network':
      showNetworkError(parsed.message)
      break
    default:
      showError(parsed.message)
  }
}

function showAuthError(message: string) {
  const platform = platforms.find(p => p.name === currentPlatform)
  const url = currentPlatform === 'chatgpt' ? 'https://chatgpt.com' : 'https://claude.ai'

  errorDiv.innerHTML = `
    <div class="error-content">
      <span class="error-icon">🔑</span>
      <span class="error-message">${escapeHtml(message)}</span>
    </div>
    <button class="error-action-btn" id="refreshPageBtn">
      <span>↻</span> Open ${platform?.displayName || 'Platform'}
    </button>
  `
  errorDiv.classList.remove('hidden')
  errorDiv.className = 'error error-auth'

  document.getElementById('refreshPageBtn')?.addEventListener('click', async () => {
    window.open(url, '_blank')
  })
}

function showRateLimitError(message: string, seconds: number) {
  rateLimitCountdown = seconds

  const updateDisplay = () => {
    if (rateLimitCountdown === null || rateLimitCountdown <= 0) {
      errorDiv.innerHTML = `
        <div class="error-content">
          <span class="error-icon">✓</span>
          <span class="error-message">Ready to retry</span>
        </div>
        <button class="error-action-btn" id="retryBtn">
          <span>↻</span> Retry Now
        </button>
      `
      errorDiv.className = 'error error-ready'
      document.getElementById('retryBtn')?.addEventListener('click', () => {
        clearError()
        triggerSync(true)
      })
      if (rateLimitTimer) {
        clearInterval(rateLimitTimer)
        rateLimitTimer = null
      }
      return
    }

    errorDiv.innerHTML = `
      <div class="error-content">
        <span class="error-icon">⏳</span>
        <span class="error-message">${escapeHtml(message)} Wait ${rateLimitCountdown}s...</span>
      </div>
    `
  }

  errorDiv.classList.remove('hidden')
  errorDiv.className = 'error error-rate-limit'
  updateDisplay()

  rateLimitTimer = window.setInterval(() => {
    if (rateLimitCountdown !== null) {
      rateLimitCountdown--
      updateDisplay()
    }
  }, 1000)
}

function showNetworkError(message: string) {
  errorDiv.innerHTML = `
    <div class="error-content">
      <span class="error-icon">📡</span>
      <span class="error-message">${escapeHtml(message)}</span>
    </div>
    <button class="error-action-btn" id="retryNetworkBtn">
      <span>↻</span> Retry
    </button>
  `
  errorDiv.classList.remove('hidden')
  errorDiv.className = 'error error-network'

  document.getElementById('retryNetworkBtn')?.addEventListener('click', () => {
    clearError()
    triggerSync(true)
  })
}

// Confirmation Dialog
function showConfirmDialog(conversationId: string, title: string) {
  pendingDeleteId = conversationId
  pendingDeleteIds = []
  dialogMessage.textContent = `Are you sure you want to delete "${title}"?`
  backupCheckbox.checked = backupBeforeDeletePref
  confirmDialog.style.display = 'flex'
}

function showBatchConfirmDialog(ids: string[]) {
  pendingDeleteId = null
  pendingDeleteIds = ids
  dialogMessage.textContent = `Are you sure you want to delete ${ids.length} conversations?`
  backupCheckbox.checked = backupBeforeDeletePref
  confirmDialog.style.display = 'flex'
}

function hideConfirmDialog() {
  confirmDialog.style.display = 'none'
  pendingDeleteId = null
  pendingDeleteIds = []
}

cancelBtn.addEventListener('click', hideConfirmDialog)

confirmBtn.addEventListener('click', async () => {
  const isBatch = pendingDeleteIds.length > 0
  const idsToDelete = isBatch ? [...pendingDeleteIds] : (pendingDeleteId ? [pendingDeleteId] : [])

  if (idsToDelete.length === 0) return

  const shouldBackup = backupCheckbox.checked
  hideConfirmDialog()

  idsToDelete.forEach(id => {
    deletingIds.add(id)
    selectedForDelete.delete(id)
  })
  updateDeletingState()

  const failedErrors: string[] = []

  for (const id of idsToDelete) {
    try {
      if (shouldBackup) {
        const backupResponse = await chrome.runtime.sendMessage({
          type: 'BACKUP_CONVERSATION',
          platform: currentPlatform,
          conversationId: id
        })
        if (backupResponse.error) {
          failedErrors.push(`Backup failed: ${parseError(backupResponse.error)}`)
          continue
        }
      }

      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_CONVERSATION',
        platform: currentPlatform,
        conversationId: id
      })

      if (response.error) {
        failedErrors.push(parseError(response.error))
      }
    } catch (err) {
      failedErrors.push(parseError(String(err)))
    }

    deletingIds.delete(id)
  }

  if (failedErrors.length > 0) {
    showError(failedErrors[0])
  }

  deletingIds.clear()
})

function updateDeletingState() {
  deletingIds.forEach(id => {
    const item = document.querySelector(`.conversation-item[data-id="${id}"]`)
    if (item) {
      item.classList.add('deleting')
      const deleteBtn = item.querySelector('.conv-delete-btn') as HTMLButtonElement
      if (deleteBtn) {
        deleteBtn.disabled = true
        deleteBtn.innerHTML = '<span class="spinner-small"></span>'
      }
    }
  })

  const batchBtn = document.getElementById('batchDeleteBtn') as HTMLButtonElement
  if (batchBtn && deletingIds.size > 0) {
    batchBtn.disabled = true
  }
}

// Platform tabs rendering
function renderPlatformTabs(): string {
  return `
    <div class="platform-tabs">
      ${platforms.map(p => `
        <button class="platform-tab ${p.name === currentPlatform ? 'active' : ''}"
                data-platform="${p.name}"
                style="--tab-color: ${p.color}">
          <span class="platform-icon">${p.icon}</span>
          <span class="platform-name">${p.displayName}</span>
        </button>
      `).join('')}
    </div>
  `
}

function attachPlatformTabHandlers() {
  contentDiv.querySelectorAll('.platform-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const platform = tab.getAttribute('data-platform') as PlatformType
      if (platform && platform !== currentPlatform) {
        switchPlatform(platform)
      }
    })
  })
}

async function switchPlatform(platform: PlatformType) {
  currentPlatform = platform
  saveCurrentPlatform()
  clearError()
  selectedForDelete.clear()
  searchQuery = ''

  // Update UI
  contentDiv.querySelectorAll('.platform-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-platform') === platform)
  })

  // Load new platform data
  showInitialLoading()
  const hasCache = await loadCache()

  if (hasCache && cachedConversations.length > 0) {
    renderConversationList(cachedConversations)
  }

  // Check auth and trigger sync
  const hasToken = await checkTokenStatus()
  if (hasToken) {
    triggerSync()
  }
}

function renderViewTabs(): string {
  return `
    <div class="view-tabs">
      <button class="view-tab ${currentView === 'conversations' ? 'active' : ''}" data-view="conversations">Conversations</button>
      <button class="view-tab ${currentView === 'backups' ? 'active' : ''}" data-view="backups">Backups</button>
      <button class="view-tab ${currentView === 'diagnostics' ? 'active' : ''}" data-view="diagnostics">Diagnostics</button>
    </div>
  `
}

function attachViewTabHandlers() {
  contentDiv.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.getAttribute('data-view') as 'conversations' | 'backups' | 'diagnostics'
      if (view && view !== currentView) {
        currentView = view
        if (view === 'conversations') {
          renderConversationList(cachedConversations)
        } else if (view === 'backups') {
          renderBackupList()
        } else if (view === 'diagnostics') {
          renderDiagnosticsPanel()
        }
      }
    })
  })
}

function renderSyncStatusBar(): string {
  if (cachedConversations.length === 0 && !syncProgress) return ''

  const platform = platforms.find(p => p.name === currentPlatform)

  if (syncProgress) {
    const progressText = syncProgress.total > 0
      ? `${syncProgress.loaded}/${syncProgress.total}`
      : `${syncProgress.loaded}`
    return `
      <div class="sync-status-bar syncing">
        <span class="sync-indicator spinning"></span>
        <span>Syncing ${platform?.displayName || ''}... ${progressText}</span>
      </div>
    `
  }

  const countText = `${cachedConversations.length} conversations`
  const timeText = lastSyncTime ? `Last sync: ${formatRelativeTime(lastSyncTime)}` : ''

  return `
    <div class="sync-status-bar">
      <span>${countText}${timeText ? ' · ' + timeText : ''}</span>
      <button id="manualSyncBtn" class="manual-sync-btn" title="Sync now">↻</button>
    </div>
  `
}

function updateSyncStatusBar() {
  const statusBar = document.querySelector('.sync-status-bar')
  if (!statusBar) return

  const platform = platforms.find(p => p.name === currentPlatform)

  if (syncProgress) {
    const progressText = syncProgress.total > 0
      ? `${syncProgress.loaded}/${syncProgress.total}`
      : `${syncProgress.loaded}`
    statusBar.className = 'sync-status-bar syncing'
    statusBar.innerHTML = `
      <span class="sync-indicator spinning"></span>
      <span>Syncing ${platform?.displayName || ''}... ${progressText}</span>
    `
  } else {
    const countText = `${cachedConversations.length} conversations`
    const timeText = lastSyncTime ? `Last sync: ${formatRelativeTime(lastSyncTime)}` : ''

    // Build index status text
    let indexText = ''
    const indexedCount = Object.keys(contentIndex).length
    if (indexProgress?.inProgress) {
      indexText = ` · Indexing ${indexProgress.indexed}/${indexProgress.total}`
    } else if (indexedCount > 0) {
      indexText = ` · ${indexedCount} indexed`
    }

    statusBar.className = 'sync-status-bar'
    statusBar.innerHTML = `
      <span>${countText}${timeText ? ' · ' + timeText : ''}${indexText}</span>
      ${indexProgress?.inProgress ? '<span class="index-indicator">📝</span>' : ''}
      <button id="manualSyncBtn" class="manual-sync-btn" title="Sync now">↻</button>
    `
    attachSyncButtonHandler()
  }
}

function triggerSync(forceRefresh = false) {
  logger.log(`[${currentPlatform}] Triggering sync, forceRefresh:`, forceRefresh)
  chrome.runtime.sendMessage({ type: 'START_SYNC', platform: currentPlatform, forceRefresh })
}

function attachSyncButtonHandler() {
  document.getElementById('manualSyncBtn')?.addEventListener('click', () => {
    triggerSync(true)
  })
}

async function checkTokenStatus(): Promise<boolean> {
  const platform = platforms.find(p => p.name === currentPlatform)
  tokenStatusDiv.textContent = `Checking ${platform?.displayName || 'platform'}...`
  tokenStatusDiv.className = 'token-status checking'

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_TOKEN_STATUS',
      platform: currentPlatform
    })
    if (response.hasToken) {
      tokenStatusDiv.textContent = `✓ ${platform?.displayName} connected`
      tokenStatusDiv.className = 'token-status success'
      return true
    } else {
      const url = currentPlatform === 'chatgpt' ? 'chatgpt.com' : 'claude.ai'
      tokenStatusDiv.textContent = `✗ Please open ${url} first`
      tokenStatusDiv.className = 'token-status error'
      return false
    }
  } catch {
    tokenStatusDiv.textContent = '✗ Failed to check status'
    tokenStatusDiv.className = 'token-status error'
    return false
  }
}

function renderPreview(messages: UnifiedMessage[], conversationId: string, title: string) {
  const lastMessages = messages.slice(-3)
  const platform = platforms.find(p => p.name === currentPlatform)
  const assistantName = platform?.displayName || 'Assistant'

  const messagesHtml = lastMessages.length === 0
    ? '<p class="empty">No messages</p>'
    : lastMessages.map(msg => `
        <div class="message ${msg.role}">
          <div class="msg-role">${msg.role === 'user' ? 'You' : assistantName}</div>
          <div class="msg-content">${escapeHtml(msg.content.substring(0, 200))}${msg.content.length > 200 ? '...' : ''}</div>
        </div>
      `).join('')

  return `
    <div class="preview-messages">
      ${messagesHtml}
    </div>
    <div class="preview-actions">
      <button class="delete-btn" data-id="${conversationId}" data-title="${escapeHtml(title)}">Delete Conversation</button>
    </div>
  `
}

/**
 * Check if preview cache is valid (within 24 hours)
 */
async function getValidPreviewCache(conversationId: string): Promise<UnifiedMessage[] | null> {
  const cacheKey = getPreviewCacheKey(currentPlatform, conversationId)
  return new Promise(resolve => {
    chrome.storage.local.get([cacheKey], result => {
      const cache = result[cacheKey] as PreviewCache | undefined
      if (cache?.messages && cache.cachedAt) {
        const age = Date.now() - cache.cachedAt
        if (age < PREVIEW_CACHE_EXPIRY_MS) {
          resolve(cache.messages)
          return
        }
      }
      resolve(null)
    })
  })
}

/**
 * Save preview to cache
 */
async function savePreviewCache(conversationId: string, messages: UnifiedMessage[]): Promise<void> {
  const cacheKey = getPreviewCacheKey(currentPlatform, conversationId)
  const cache: PreviewCache = {
    messages,
    cachedAt: Date.now()
  }
  await chrome.storage.local.set({ [cacheKey]: cache })
}

async function showConversationPreview(conversationId: string, title: string) {
  selectedConversationId = conversationId

  document.querySelectorAll('.conversation-item').forEach(el => {
    el.classList.toggle('selected', el.getAttribute('data-id') === conversationId)
  })

  const previewDiv = document.getElementById('preview')
  if (!previewDiv) return

  const conv = cachedConversations.find(c => c.id === conversationId)

  // Step 1: Check preview cache first (24h validity) - instant if cached
  const cachedMessages = await getValidPreviewCache(conversationId)
  if (cachedMessages) {
    logger.log(`[preview] Cache hit for ${conversationId}`)
    showFullPreview(previewDiv, cachedMessages, conversationId, title, conv)
    return
  }

  // Step 2: Show loading state while fetching
  previewDiv.innerHTML = '<p class="loading">Loading preview...</p>'

  // Step 3: Fetch from API
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_CONVERSATION_DETAIL',
      platform: currentPlatform,
      conversationId
    })

    if (response.error) {
      previewDiv.innerHTML = `<p class="error-text">${parseError(response.error)}</p>`
      return
    }

    const messages = response.data.messages

    // Save to cache for next time
    await savePreviewCache(conversationId, messages)

    // Show full preview
    showFullPreview(previewDiv, messages, conversationId, title, conv)

  } catch (err) {
    previewDiv.innerHTML = `<p class="error-text">Failed to load preview</p>`
  }
}

/**
 * Show full preview with smooth transition
 */
function showFullPreview(
  previewDiv: HTMLElement,
  messages: UnifiedMessage[],
  conversationId: string,
  title: string,
  conv: UnifiedConversation | undefined
) {
  const snippet = extractSnippet(messages)
  if (conv) {
    conv.snippet = snippet
    conv.messageCount = messages.length
    updateConversationSnippet(conversationId, snippet, messages.length)
  }

  // Add fade-in class for smooth transition
  previewDiv.classList.add('preview-transitioning')

  // Small delay for smooth visual transition
  requestAnimationFrame(() => {
    previewDiv.innerHTML = renderPreview(messages, conversationId, title)
    attachPreviewDeleteHandler(previewDiv)

    // Remove transition class after animation
    setTimeout(() => {
      previewDiv.classList.remove('preview-transitioning')
    }, 150)
  })
}

/**
 * Attach delete button handler in preview
 */
function attachPreviewDeleteHandler(previewDiv: HTMLElement) {
  const deleteBtn = previewDiv.querySelector('.delete-btn')
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      const id = deleteBtn.getAttribute('data-id')
      const btnTitle = deleteBtn.getAttribute('data-title') || 'Untitled'
      if (id) showConfirmDialog(id, btnTitle)
    })
  }
}

function updateConversationSnippet(conversationId: string, snippet: string, messageCount: number) {
  const item = document.querySelector(`.conversation-item[data-id="${conversationId}"]`)
  if (item) {
    const snippetEl = item.querySelector('.conv-snippet')
    if (snippetEl) {
      snippetEl.textContent = snippet || '(No preview)'
    }
    const countEl = item.querySelector('.conv-count')
    if (countEl) {
      countEl.textContent = `${messageCount} msgs`
    }
  }
}

function updateBatchDeleteBtn() {
  const btn = document.getElementById('batchDeleteBtn') as HTMLButtonElement
  const count = selectedForDelete.size
  if (btn) {
    btn.textContent = count > 0 ? `Delete (${count})` : 'Delete'
    btn.disabled = count === 0 || deletingIds.size > 0
  }
}

function extractSearchSnippet(text: string, query: string): string {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerText.indexOf(lowerQuery)
  if (index === -1) return ''

  const start = Math.max(0, index - 30)
  const end = Math.min(text.length, index + query.length + 30)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < text.length ? '...' : ''
  return prefix + text.slice(start, end) + suffix
}

function searchConversations(conversations: UnifiedConversation[], query: string): SearchResult[] {
  if (!query.trim()) {
    return conversations.map(conv => ({ conv, matchType: 'title' as const, snippet: null }))
  }

  const lowerQuery = query.toLowerCase().trim()
  const results: SearchResult[] = []

  for (const conv of conversations) {
    const title = (conv.title || '').toLowerCase()

    // Check title match first
    if (title.includes(lowerQuery)) {
      results.push({ conv, matchType: 'title', snippet: null })
      continue
    }

    // Check indexed content
    const indexed = contentIndex[conv.id]
    if (indexed?.contentText) {
      const contentLower = indexed.contentText.toLowerCase()
      if (contentLower.includes(lowerQuery)) {
        const snippet = extractSearchSnippet(indexed.contentText, query)
        results.push({ conv, matchType: 'content', snippet })
        continue
      }
    }

    // Also check snippet field (from preview)
    const snippetText = (conv.snippet || '').toLowerCase()
    if (snippetText.includes(lowerQuery)) {
      results.push({ conv, matchType: 'title', snippet: null })
    }
  }

  return results
}

function sortConversations(conversations: UnifiedConversation[], sortBy: SortOption): UnifiedConversation[] {
  const sorted = [...conversations]
  switch (sortBy) {
    case 'updated':
      sorted.sort((a, b) => b.updateTime - a.updateTime)
      break
    case 'created':
      sorted.sort((a, b) => b.createTime - a.createTime)
      break
    case 'title':
      sorted.sort((a, b) => {
        const titleA = (a.title || '').toLowerCase()
        const titleB = (b.title || '').toLowerCase()
        return titleA.localeCompare(titleB)
      })
      break
  }
  return sorted
}

function sortSearchResults(results: SearchResult[], sortBy: SortOption): SearchResult[] {
  const sorted = [...results]
  switch (sortBy) {
    case 'updated':
      sorted.sort((a, b) => b.conv.updateTime - a.conv.updateTime)
      break
    case 'created':
      sorted.sort((a, b) => b.conv.createTime - a.conv.createTime)
      break
    case 'title':
      sorted.sort((a, b) => {
        const titleA = (a.conv.title || '').toLowerCase()
        const titleB = (b.conv.title || '').toLowerCase()
        return titleA.localeCompare(titleB)
      })
      break
  }
  return sorted
}

function searchAndSortConversations(conversations: UnifiedConversation[], query: string, sortBy: SortOption): SearchResult[] {
  const results = searchConversations(conversations, query)
  return sortSearchResults(results, sortBy)
}

// Legacy function for backward compatibility
function filterAndSortConversations(conversations: UnifiedConversation[], query: string, sortBy: SortOption): UnifiedConversation[] {
  const results = searchAndSortConversations(conversations, query, sortBy)
  return results.map(r => r.conv)
}

function renderSearchBox(): string {
  const sortOptionsHtml = SORT_OPTIONS.map(opt =>
    `<option value="${opt.value}" ${opt.value === currentSortOption ? 'selected' : ''}>${opt.label}</option>`
  ).join('')

  return `
    <div class="search-sort-row">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" id="searchInput" class="search-input" placeholder="Search conversations..." value="${escapeHtml(searchQuery)}">
        <button id="clearSearchBtn" class="clear-search-btn ${searchQuery ? '' : 'hidden'}" title="Clear">×</button>
      </div>
      <div class="sort-box">
        <select id="sortSelect" class="sort-select">
          ${sortOptionsHtml}
        </select>
      </div>
    </div>
  `
}

function attachSearchHandlers() {
  const searchInput = document.getElementById('searchInput') as HTMLInputElement
  const clearBtn = document.getElementById('clearSearchBtn') as HTMLButtonElement
  const sortSelect = document.getElementById('sortSelect') as HTMLSelectElement

  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value
    clearBtn?.classList.toggle('hidden', !searchQuery)
    updateListItems()
  })

  clearBtn?.addEventListener('click', () => {
    searchQuery = ''
    if (searchInput) searchInput.value = ''
    clearBtn.classList.add('hidden')
    updateListItems()
    searchInput?.focus()
  })

  sortSelect?.addEventListener('change', () => {
    currentSortOption = sortSelect.value as SortOption
    // Save sort preference
    chrome.storage.local.set({ sortOption: currentSortOption })
    updateListItems()
  })
}

function updateListItems() {
  const listContainer = document.querySelector('.conversation-list')
  const resultCountEl = document.querySelector('.search-result-count')

  if (!listContainer) return

  // Use content-aware search when query exists, otherwise just sort
  const searchResults = searchQuery
    ? searchAndSortConversations(cachedConversations, searchQuery, currentSortOption)
    : sortSearchResults(
        cachedConversations.map(conv => ({ conv, matchType: 'title' as const, snippet: null })),
        currentSortOption
      )

  if (resultCountEl) {
    if (searchQuery) {
      const contentMatches = searchResults.filter(r => r.matchType === 'content').length
      const titleMatches = searchResults.length - contentMatches
      let countText = `${searchResults.length} results`
      if (contentMatches > 0) {
        countText += ` (${contentMatches} in content)`
      }
      resultCountEl.textContent = countText
      resultCountEl.classList.remove('hidden')
    } else {
      resultCountEl.classList.add('hidden')
    }
  }

  if (searchResults.length === 0 && searchQuery) {
    listContainer.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <div class="no-results-text">No conversations match "${escapeHtml(searchQuery)}"</div>
        <div class="no-results-hint">Try a different search term</div>
      </div>
    `
    return
  }

  const listHtml = searchResults.map(r => renderConversationItem(r.conv, r.snippet)).join('')
  listContainer.innerHTML = listHtml
  attachListItemHandlers()
}

function renderConversationItem(conv: UnifiedConversation, searchSnippet?: string | null): string {
  const isDeleting = deletingIds.has(conv.id)
  const snippetText = conv.snippet || ''
  const countText = conv.messageCount ? `${conv.messageCount} msgs` : ''
  const starIcon = conv.isStarred ? '⭐ ' : ''

  // Display search snippet if it's a content match, otherwise show normal snippet
  let snippetHtml: string
  if (searchSnippet) {
    snippetHtml = `<span class="content-match">"${escapeHtml(searchSnippet)}"</span>`
  } else if (snippetText) {
    snippetHtml = escapeHtml(snippetText)
  } else {
    snippetHtml = '<span class="no-preview">(Click to load preview)</span>'
  }

  return `
    <div class="conversation-item ${isDeleting ? 'deleting' : ''}" data-id="${conv.id}" data-title="${escapeHtml(conv.title || 'Untitled')}">
      <input type="checkbox" class="conv-checkbox" data-id="${conv.id}" ${selectedForDelete.has(conv.id) ? 'checked' : ''} ${isDeleting ? 'disabled' : ''}>
      <div class="conv-content">
        <div class="conv-title">${starIcon}${escapeHtml(conv.title || 'Untitled')}</div>
        <div class="conv-snippet">${snippetHtml}</div>
        <div class="conv-meta">
          <span class="conv-date">${formatRelativeTime(conv.updateTime)}</span>
          ${countText ? `<span class="conv-count">${countText}</span>` : ''}
        </div>
      </div>
      <button class="conv-delete-btn" data-id="${conv.id}" data-title="${escapeHtml(conv.title || 'Untitled')}" title="Delete" ${isDeleting ? 'disabled' : ''}>
        ${isDeleting ? '<span class="spinner-small"></span>' : '×'}
      </button>
    </div>
  `
}

function attachListItemHandlers() {
  const selectAllCheckbox = document.getElementById('selectAllCheckbox') as HTMLInputElement

  contentDiv.querySelectorAll('.conv-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation()
      const checkbox = cb as HTMLInputElement
      const id = checkbox.getAttribute('data-id')
      if (id) {
        if (checkbox.checked) {
          selectedForDelete.add(id)
        } else {
          selectedForDelete.delete(id)
        }
      }
      updateBatchDeleteBtn()

      const allCheckboxes = contentDiv.querySelectorAll('.conv-checkbox:not(:disabled)') as NodeListOf<HTMLInputElement>
      const allChecked = Array.from(allCheckboxes).every(c => c.checked)
      if (selectAllCheckbox) selectAllCheckbox.checked = allChecked
    })
  })

  contentDiv.querySelectorAll('.conv-content').forEach(el => {
    el.addEventListener('click', () => {
      const item = el.parentElement
      const id = item?.getAttribute('data-id')
      const title = item?.getAttribute('data-title') || 'Untitled'
      if (id && !deletingIds.has(id)) showConversationPreview(id, title)
    })
  })

  contentDiv.querySelectorAll('.conv-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const id = btn.getAttribute('data-id')
      const title = btn.getAttribute('data-title') || 'Untitled'
      if (id && !deletingIds.has(id)) showConfirmDialog(id, title)
    })
  })

  updateBatchDeleteBtn()
}

function renderConversationList(conversations: UnifiedConversation[]) {
  const preserveSelection = deletingIds.size > 0
  if (!preserveSelection) {
    selectedForDelete.clear()
  }

  const filteredConversations = filterAndSortConversations(conversations, searchQuery, currentSortOption)
  const platform = platforms.find(p => p.name === currentPlatform)

  if (conversations.length === 0) {
    contentDiv.innerHTML = `
      ${renderPlatformTabs()}
      ${renderViewTabs()}
      <div class="main-layout">
        <div class="left-panel">
          <p class="empty">No conversations found on ${platform?.displayName || 'this platform'}.</p>
          ${renderSyncStatusBar()}
        </div>
        <div class="right-panel">
          <div class="right-panel-header">Preview</div>
          <div class="right-panel-content">
            <div id="preview" class="preview">
              <div class="preview-empty">
                <div class="preview-empty-icon">💬</div>
                <div>No conversations yet</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `
    attachPlatformTabHandlers()
    attachViewTabHandlers()
    attachSyncButtonHandler()
    return
  }

  const listHtml = filteredConversations.map(conv => renderConversationItem(conv)).join('')
  const resultCountHtml = `<div class="search-result-count ${searchQuery ? '' : 'hidden'}">${searchQuery ? `${filteredConversations.length} results` : ''}</div>`

  contentDiv.innerHTML = `
    ${renderPlatformTabs()}
    ${renderViewTabs()}
    <div class="main-layout">
      <div class="left-panel">
        ${renderSearchBox()}
        ${resultCountHtml}
        <div class="batch-actions">
          <label class="select-all-label">
            <input type="checkbox" id="selectAllCheckbox">
            <span>Select All</span>
          </label>
          <button id="batchDeleteBtn" class="batch-delete-btn" disabled>Delete</button>
        </div>
        <div class="conversation-list">${listHtml}</div>
        ${renderSyncStatusBar()}
      </div>
      <div class="right-panel">
        <div class="right-panel-header">Preview</div>
        <div class="right-panel-content">
          <div id="preview" class="preview">
            <div class="preview-empty">
              <div class="preview-empty-icon">${platform?.icon || '💬'}</div>
              <div>Click a conversation to preview</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `

  attachPlatformTabHandlers()
  attachViewTabHandlers()
  attachSearchHandlers()

  const selectAllCheckbox = document.getElementById('selectAllCheckbox') as HTMLInputElement
  selectAllCheckbox?.addEventListener('change', () => {
    const checkboxes = contentDiv.querySelectorAll('.conv-checkbox:not(:disabled)') as NodeListOf<HTMLInputElement>
    checkboxes.forEach(cb => {
      cb.checked = selectAllCheckbox.checked
      const id = cb.getAttribute('data-id')
      if (id) {
        if (selectAllCheckbox.checked) {
          selectedForDelete.add(id)
        } else {
          selectedForDelete.delete(id)
        }
      }
    })
    updateBatchDeleteBtn()
  })

  const batchDeleteBtn = document.getElementById('batchDeleteBtn')
  batchDeleteBtn?.addEventListener('click', () => {
    if (selectedForDelete.size > 0 && deletingIds.size === 0) {
      showBatchConfirmDialog(Array.from(selectedForDelete))
    }
  })

  attachListItemHandlers()
  attachSyncButtonHandler()
}

interface Backup {
  id: string
  title: string
  platform: PlatformType
  messages: UnifiedMessage[]
  backupTime: number
}

function renderBackupPreview(backup: Backup): string {
  const lastMessages = backup.messages.slice(-3)
  const platform = platforms.find(p => p.name === backup.platform)
  const assistantName = platform?.displayName || 'Assistant'

  return lastMessages.length === 0
    ? '<p class="empty">No messages</p>'
    : lastMessages.map(msg => `
        <div class="message ${msg.role}">
          <div class="msg-role">${msg.role === 'user' ? 'You' : assistantName}</div>
          <div class="msg-content">${escapeHtml(msg.content.substring(0, 200))}${msg.content.length > 200 ? '...' : ''}</div>
        </div>
      `).join('')
}

async function renderBackupList() {
  contentDiv.innerHTML = `
    ${renderPlatformTabs()}
    ${renderViewTabs()}
    <p class="loading">Loading backups...</p>
  `
  attachPlatformTabHandlers()
  attachViewTabHandlers()

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_BACKUPS',
      platform: currentPlatform
    })
    const backups: Backup[] = response.backups || []

    if (backups.length === 0) {
      contentDiv.innerHTML = `
        ${renderPlatformTabs()}
        ${renderViewTabs()}
        <p class="empty">No backups found</p>
      `
      attachPlatformTabHandlers()
      attachViewTabHandlers()
      return
    }

    const listHtml = backups.map(backup => {
      const platform = platforms.find(p => p.name === backup.platform)
      return `
        <div class="backup-item" data-id="${backup.id}">
          <div class="backup-header">
            <div class="conv-title">
              <span class="platform-badge" style="background: ${platform?.color || '#666'}">${platform?.icon || '?'}</span>
              ${escapeHtml(backup.title || 'Untitled')}
            </div>
            <button class="delete-backup-btn" data-id="${backup.id}" data-platform="${backup.platform}">×</button>
          </div>
          <div class="conv-date">Backed up: ${formatDate(backup.backupTime)}</div>
          <div class="backup-preview">${renderBackupPreview(backup)}</div>
        </div>
      `
    }).join('')

    contentDiv.innerHTML = `
      ${renderPlatformTabs()}
      ${renderViewTabs()}
      <div class="backup-list">${listHtml}</div>
    `

    attachPlatformTabHandlers()
    attachViewTabHandlers()

    contentDiv.querySelectorAll('.delete-backup-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const id = btn.getAttribute('data-id')
        const platform = btn.getAttribute('data-platform') as PlatformType
        if (id && confirm('Delete this backup?')) {
          await chrome.runtime.sendMessage({
            type: 'DELETE_BACKUP',
            platform,
            conversationId: id
          })
          renderBackupList()
        }
      })
    })
  } catch (err) {
    showError(`Failed to load backups: ${parseError(String(err))}`)
  }
}

function showInitialLoading() {
  const platform = platforms.find(p => p.name === currentPlatform)

  contentDiv.innerHTML = `
    ${renderPlatformTabs()}
    ${renderViewTabs()}
    <div class="main-layout">
      <div class="left-panel">
        <div class="sync-status-bar syncing">
          <span class="sync-indicator spinning"></span>
          <span>Loading ${platform?.displayName || ''} conversations...</span>
        </div>
      </div>
      <div class="right-panel">
        <div class="right-panel-header">Preview</div>
        <div class="right-panel-content">
          <div id="preview" class="preview">
            <div class="preview-empty">
              <div class="preview-empty-icon">${platform?.icon || '💬'}</div>
              <div>Loading...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
  attachPlatformTabHandlers()
  attachViewTabHandlers()
}

// Storage change listener for real-time updates
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return

    const cacheKey = getCacheKey(currentPlatform)
    const progressKey = getSyncProgressKey(currentPlatform)
    const errorKey = getSyncErrorKey(currentPlatform)
    const contentIndexKey = getContentIndexKey(currentPlatform)
    const indexProgressKey = getIndexProgressKey(currentPlatform)

    // Update conversation cache
    if (changes[cacheKey]?.newValue) {
      const cache = changes[cacheKey].newValue as PlatformCache
      cachedConversations = cache.conversations || []
      lastSyncTime = cache.lastSyncTime || null
      syncComplete = cache.syncComplete || false
      logger.log(`[${currentPlatform}] Cache updated: ${cachedConversations.length} conversations`)

      if (currentView === 'conversations' && deletingIds.size === 0) {
        // Check if the list is already rendered
        const listContainer = document.querySelector('.conversation-list')
        if (listContainer) {
          // Just update list items without re-rendering entire page
          // This preserves search input focus and value
          const scrollTop = listContainer.scrollTop || 0
          updateListItems()
          listContainer.scrollTop = scrollTop
        } else {
          // List not yet rendered, do full render
          renderConversationList(cachedConversations)
        }
        updateSyncStatusBar()
      }
    }

    // Update sync progress
    if (changes[progressKey]) {
      syncProgress = changes[progressKey].newValue as SyncProgress | undefined || null
      updateSyncStatusBar()
    }

    // Update content index
    if (changes[contentIndexKey]?.newValue) {
      contentIndex = changes[contentIndexKey].newValue as ContentIndex || {}
      logger.log(`[${currentPlatform}] Content index updated: ${Object.keys(contentIndex).length} indexed`)
    }

    // Update index progress
    if (changes[indexProgressKey]) {
      indexProgress = changes[indexProgressKey].newValue as IndexProgress | undefined || null
      updateSyncStatusBar()
    }

    // Handle sync error
    if (changes[errorKey]?.newValue) {
      const errorMsg = changes[errorKey].newValue as string
      showErrorWithAction(errorMsg)
    }
  })
}

async function init() {
  logger.log('init: START')
  clearError()

  // Setup storage listener first
  setupStorageListener()

  // Load platforms
  await loadPlatforms()

  // Load user settings
  await loadSettings()
  logger.log('init: settings loaded, platform:', currentPlatform)

  // Load cache immediately
  const hasCache = await loadCache()
  logger.log('init: hasCache =', hasCache, 'conversations:', cachedConversations.length)

  if (hasCache && cachedConversations.length > 0) {
    logger.log('init: rendering cached list')
    renderConversationList(cachedConversations)
  } else {
    logger.log('init: no cache, showing loading state')
    showInitialLoading()
  }

  // Check token
  logger.log('init: checking token status')
  const hasToken = await checkTokenStatus()
  logger.log('init: hasToken =', hasToken)

  if (hasToken) {
    logger.log('init: triggering background sync')
    triggerSync()
  } else {
    if (!hasCache) {
      const platform = platforms.find(p => p.name === currentPlatform)
      const url = currentPlatform === 'chatgpt' ? 'chatgpt.com' : 'claude.ai'

      contentDiv.innerHTML = `
        ${renderPlatformTabs()}
        ${renderViewTabs()}
        <div class="main-layout">
          <div class="left-panel">
            <p>To use this extension:</p>
            <ol>
              <li>Open <a href="https://${url}" target="_blank">${url}</a></li>
              <li>Make sure you are logged in</li>
              <li>Refresh this popup</li>
            </ol>
          </div>
          <div class="right-panel">
            <div class="right-panel-header">Preview</div>
            <div class="right-panel-content">
              <div id="preview" class="preview">
                <div class="preview-empty">
                  <div class="preview-empty-icon">🔑</div>
                  <div>Login to ${platform?.displayName || 'platform'} first</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `
      attachPlatformTabHandlers()
      attachViewTabHandlers()
    }
  }
  logger.log('init: END')
}

// ==================== Diagnostics Panel ====================

async function getExtensionVersion(): Promise<string> {
  try {
    const manifest = chrome.runtime.getManifest()
    return manifest.version || 'unknown'
  } catch {
    return 'unknown'
  }
}

function formatLogTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', { hour12: false })
}

function getLogLevelClass(level: string): string {
  switch (level) {
    case 'ERROR': return 'log-error'
    case 'WARN': return 'log-warn'
    default: return 'log-info'
  }
}

function sanitizeLogs(logs: LogEntry[]): LogEntry[] {
  return logs.map(log => {
    const sanitized = { ...log }
    // Sanitize sensitive fields in message
    if (sanitized.message) {
      sanitized.message = sanitized.message
        .replace(/accessToken["\s:=]+[A-Za-z0-9._-]+/gi, 'accessToken: [REDACTED]')
        .replace(/sessionKey["\s:=]+[A-Za-z0-9._-]+/gi, 'sessionKey: [REDACTED]')
        .replace(/token["\s:=]+[A-Za-z0-9._-]{20,}/gi, 'token: [REDACTED]')
        .replace(/user[_-]?id["\s:=]+[A-Za-z0-9-]+/gi, 'userId: [REDACTED]')
    }
    // Sanitize conversation IDs (keep first 8 chars)
    if (sanitized.message) {
      sanitized.message = sanitized.message.replace(
        /([a-f0-9]{8})-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,
        '$1-***'
      )
    }
    if (sanitized.stack) {
      sanitized.stack = sanitized.stack
        .replace(/accessToken["\s:=]+[A-Za-z0-9._-]+/gi, 'accessToken: [REDACTED]')
        .replace(/token["\s:=]+[A-Za-z0-9._-]{20,}/gi, 'token: [REDACTED]')
    }
    return sanitized
  })
}

async function pingContentScript(): Promise<{ ok: boolean; duration: number; url?: string; error?: string }> {
  const startTime = Date.now()
  const timeout = 500

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve({ ok: false, duration: timeout, error: ErrorCode.INJECT_FAILED })
    }, timeout)

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) {
        clearTimeout(timeoutId)
        resolve({ ok: false, duration: Date.now() - startTime, error: ErrorCode.NO_TAB })
        return
      }

      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'PING' })
        clearTimeout(timeoutId)
        if (response?.type === 'PONG') {
          resolve({
            ok: true,
            duration: Date.now() - startTime,
            url: response.url
          })
        } else {
          resolve({ ok: false, duration: Date.now() - startTime, error: ErrorCode.INJECT_FAILED })
        }
      } catch {
        clearTimeout(timeoutId)
        resolve({ ok: false, duration: Date.now() - startTime, error: ErrorCode.INJECT_FAILED })
      }
    })
  })
}

async function probeAPI(): Promise<{ ok: boolean; duration: number; status?: number; total?: number; error?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'PROBE', platform: currentPlatform },
      (response) => {
        if (response) {
          resolve(response)
        } else {
          resolve({ ok: false, duration: 0, error: ErrorCode.NETWORK_ERROR })
        }
      }
    )
  })
}

async function fetchDiagnosticsLogs(): Promise<LogEntry[]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_LOGS' }, (response) => {
      resolve(response?.logs || [])
    })
  })
}

async function clearDiagnosticsLogs(): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' }, () => resolve())
  })
}

function renderDiagnosticsPanel() {
  const platform = platforms.find(p => p.name === currentPlatform)

  contentDiv.innerHTML = `
    ${renderPlatformTabs()}
    ${renderViewTabs()}
    <div class="diagnostics-panel">
      <div class="diag-section">
        <div class="diag-title">System Info</div>
        <div class="diag-info-grid">
          <div class="diag-info-item">
            <span class="diag-label">Version</span>
            <span class="diag-value" id="diagVersion">Loading...</span>
          </div>
          <div class="diag-info-item">
            <span class="diag-label">Platform</span>
            <span class="diag-value">${platform?.displayName || currentPlatform}</span>
          </div>
          <div class="diag-info-item">
            <span class="diag-label">Status</span>
            <span class="diag-value" id="diagStatus">Checking...</span>
          </div>
        </div>
      </div>

      <div class="diag-section">
        <div class="diag-title">Connection Tests</div>
        <div class="diag-actions">
          <button id="pingBtn" class="diag-btn">Ping</button>
          <button id="probeBtn" class="diag-btn">Probe API</button>
        </div>
        <div id="diagResult" class="diag-result"></div>
      </div>

      <div class="diag-section diag-logs-section">
        <div class="diag-title">
          Recent Logs
          <span class="diag-log-count" id="logCount"></span>
        </div>
        <div id="diagLogs" class="diag-logs">
          <div class="diag-logs-loading">Loading logs...</div>
        </div>
        <div class="diag-log-actions">
          <button id="copyLogsBtn" class="diag-btn diag-btn-secondary">Copy Logs</button>
          <button id="clearLogsBtn" class="diag-btn diag-btn-secondary">Clear Logs</button>
        </div>
        <div id="copyStatus" class="diag-copy-status"></div>
      </div>
    </div>
  `

  attachPlatformTabHandlers()
  attachViewTabHandlers()
  attachDiagnosticsHandlers()
  loadDiagnosticsData()
}

async function loadDiagnosticsData() {
  // Load version
  const version = await getExtensionVersion()
  const versionEl = document.getElementById('diagVersion')
  if (versionEl) versionEl.textContent = version

  // Check connection status
  const pingResult = await pingContentScript()
  const statusEl = document.getElementById('diagStatus')
  if (statusEl) {
    if (pingResult.ok) {
      statusEl.innerHTML = '<span class="status-connected">Connected</span>'
    } else {
      statusEl.innerHTML = '<span class="status-disconnected">Disconnected</span>'
    }
  }

  // Load logs
  await refreshDiagnosticsLogs()
}

async function refreshDiagnosticsLogs() {
  const logs = await fetchDiagnosticsLogs()
  const logsEl = document.getElementById('diagLogs')
  const countEl = document.getElementById('logCount')

  if (countEl) {
    countEl.textContent = `(${logs.length})`
  }

  if (logsEl) {
    if (logs.length === 0) {
      logsEl.innerHTML = '<div class="diag-logs-empty">No logs yet</div>'
    } else {
      // Show newest first
      const reversedLogs = [...logs].reverse()
      logsEl.innerHTML = reversedLogs.map(log => `
        <div class="diag-log-entry ${getLogLevelClass(log.level)}">
          <span class="log-time">[${formatLogTime(log.timestamp)}]</span>
          <span class="log-level">[${log.level}]</span>
          <span class="log-action">${escapeHtml(log.action)}</span>
          ${log.message ? `<span class="log-message">- ${escapeHtml(log.message)}</span>` : ''}
          ${log.duration ? `<span class="log-duration">(${log.duration}ms)</span>` : ''}
        </div>
      `).join('')
    }
  }
}

function attachDiagnosticsHandlers() {
  const pingBtn = document.getElementById('pingBtn')
  const probeBtn = document.getElementById('probeBtn')
  const copyLogsBtn = document.getElementById('copyLogsBtn')
  const clearLogsBtn = document.getElementById('clearLogsBtn')
  const resultEl = document.getElementById('diagResult')

  pingBtn?.addEventListener('click', async () => {
    if (resultEl) resultEl.innerHTML = '<span class="diag-testing">Testing...</span>'
    const result = await pingContentScript()

    if (result.ok) {
      if (resultEl) {
        const hostname = result.url ? new URL(result.url).hostname : 'unknown'
        resultEl.innerHTML = `<span class="diag-success">✓ Ping OK (${result.duration}ms) - URL: ${hostname}</span>`
      }
    } else {
      const errorInfo = ErrorMessages[result.error as ErrorCode] || { title: result.error }
      if (resultEl) {
        resultEl.innerHTML = `<span class="diag-error">✗ Ping Failed - ${errorInfo.title}</span>`
      }
    }
  })

  probeBtn?.addEventListener('click', async () => {
    if (resultEl) resultEl.innerHTML = '<span class="diag-testing">Testing API...</span>'
    const result = await probeAPI()

    if (result.ok) {
      if (resultEl) {
        resultEl.innerHTML = `<span class="diag-success">✓ API OK (${result.duration}ms) - Status: ${result.status}</span>`
      }
    } else {
      const errorInfo = ErrorMessages[result.error as ErrorCode] || { title: result.error }
      const statusText = result.status ? ` - Status: ${result.status}` : ''
      if (resultEl) {
        resultEl.innerHTML = `<span class="diag-error">✗ API Failed${statusText} - ${errorInfo.title}</span>`
      }
    }

    // Refresh logs after probe
    await refreshDiagnosticsLogs()
  })

  copyLogsBtn?.addEventListener('click', async () => {
    const logs = await fetchDiagnosticsLogs()
    const sanitized = sanitizeLogs(logs)
    const json = JSON.stringify(sanitized, null, 2)

    try {
      await navigator.clipboard.writeText(json)
      const statusEl = document.getElementById('copyStatus')
      if (statusEl) {
        statusEl.textContent = 'Copied!'
        statusEl.classList.add('visible')
        setTimeout(() => {
          statusEl.classList.remove('visible')
        }, 2000)
      }
    } catch (err) {
      logger.error('Failed to copy logs:', err)
    }
  })

  clearLogsBtn?.addEventListener('click', async () => {
    await clearDiagnosticsLogs()
    await refreshDiagnosticsLogs()
  })
}

init()
