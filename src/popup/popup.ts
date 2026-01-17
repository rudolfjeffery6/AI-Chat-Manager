import { logger } from '../utils/logger'
import type { Conversation, Message } from '../api/chatgpt'

logger.log('popup loaded')

const errorDiv = document.getElementById('error') as HTMLDivElement
const tokenStatusDiv = document.getElementById('tokenStatus') as HTMLDivElement
const contentDiv = document.getElementById('content') as HTMLDivElement
const confirmDialog = document.getElementById('confirmDialog') as HTMLDivElement
const dialogMessage = document.getElementById('dialogMessage') as HTMLDivElement
const backupCheckbox = document.getElementById('backupCheckbox') as HTMLInputElement
const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement
const confirmBtn = document.getElementById('confirmBtn') as HTMLButtonElement

// State
let selectedConversationId: string | null = null
let pendingDeleteId: string | null = null
let pendingDeleteIds: string[] = []
let currentView: 'conversations' | 'backups' = 'conversations'
let selectedForDelete: Set<string> = new Set()
let searchQuery: string = ''

// Loading states
let isInitialLoading = false
let isSyncing = false  // Background sync in progress
let deletingIds: Set<string> = new Set()

// Sync progress
let syncProgress = { current: 0, total: 0 }

// Local cache
let cachedConversations: Conversation[] = []
let lastSyncAt: number | null = null
let totalCount: number | null = null

// Constants
const SYNC_BATCH_SIZE = 50
const SYNC_DELAY_MS = 300  // Delay between batches to avoid rate limiting

// Cache keys
const CACHE_KEY = 'cached_conversations'
const CACHE_META_KEY = 'cache_meta'

// Settings keys
const SETTINGS_KEY = 'settings'

// User preferences (loaded from storage)
let backupBeforeDeletePref = false  // Default: false (user can enable)

// Load user settings from storage
async function loadSettings(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY], (result) => {
      const settings = result[SETTINGS_KEY] as { backupBeforeDelete?: boolean } | undefined
      if (settings?.backupBeforeDelete !== undefined) {
        backupBeforeDeletePref = settings.backupBeforeDelete
      }
      resolve()
    })
  })
}

// Save backup preference when checkbox changes
function saveBackupPreference(value: boolean): void {
  backupBeforeDeletePref = value
  chrome.storage.local.get([SETTINGS_KEY], (result) => {
    const settings = (result[SETTINGS_KEY] as Record<string, unknown>) || {}
    settings.backupBeforeDelete = value
    chrome.storage.local.set({ [SETTINGS_KEY]: settings })
  })
}

// Attach checkbox change listener
backupCheckbox.addEventListener('change', () => {
  saveBackupPreference(backupCheckbox.checked)
})

// Load cache from storage
async function loadCache(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.local.get([CACHE_KEY, CACHE_META_KEY], (result) => {
      if (result[CACHE_KEY] && Array.isArray(result[CACHE_KEY])) {
        cachedConversations = result[CACHE_KEY]
        const meta = result[CACHE_META_KEY] as { lastSyncAt?: number, totalCount?: number } | undefined
        lastSyncAt = meta?.lastSyncAt || null
        totalCount = meta?.totalCount || cachedConversations.length
        logger.log('Cache loaded:', cachedConversations.length, 'conversations')
        resolve(true)
      } else {
        resolve(false)
      }
    })
  })
}

// Save cache to storage
async function saveCache(): Promise<void> {
  return new Promise((resolve) => {
    const now = Date.now()
    chrome.storage.local.set({
      [CACHE_KEY]: cachedConversations,
      [CACHE_META_KEY]: {
        lastSyncAt: now,
        totalCount: totalCount || cachedConversations.length
      }
    }, () => {
      lastSyncAt = now
      resolve()
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

function formatDate(dateStr: string | number): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Clean text for snippet: remove newlines, compress whitespace, truncate
function cleanSnippet(text: string, maxLength = 120): string {
  if (!text) return ''
  return text
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, maxLength)
}

// Extract snippet from messages: prefer recent assistant, then user
function extractSnippet(messages: Message[]): string {
  if (!messages || messages.length === 0) return ''

  // Filter out system messages, reverse to get recent first
  const filtered = messages
    .filter(m => m.role === 'assistant' || m.role === 'user')
    .reverse()

  // Prefer assistant message
  const assistantMsg = filtered.find(m => m.role === 'assistant')
  if (assistantMsg) {
    return cleanSnippet(assistantMsg.content)
  }

  // Fall back to user message
  const userMsg = filtered.find(m => m.role === 'user')
  if (userMsg) {
    return cleanSnippet(userMsg.content)
  }

  return ''
}

// Error types for special handling
type ErrorType = 'auth' | 'rate_limit' | 'network' | 'server' | 'not_found' | 'generic'

interface ParsedError {
  type: ErrorType
  message: string
  retryAfter?: number // seconds for rate limit
}

// Parse API error for user-friendly message and type
function parseErrorDetailed(error: string): ParsedError {
  if (error.includes('401') || error.includes('Unauthorized')) {
    return {
      type: 'auth',
      message: 'Session expired. Please refresh the ChatGPT page to continue.'
    }
  }
  if (error.includes('403') || error.includes('Forbidden')) {
    return {
      type: 'auth',
      message: 'Access denied. Please log in to ChatGPT first.'
    }
  }
  if (error.includes('404')) {
    return {
      type: 'not_found',
      message: 'Conversation not found. It may have been deleted.'
    }
  }
  if (error.includes('429')) {
    // Try to extract retry-after time from error message
    const retryMatch = error.match(/(\d+)\s*seconds?/i)
    const retryAfter = retryMatch ? parseInt(retryMatch[1]) : 30
    return {
      type: 'rate_limit',
      message: 'Too many requests.',
      retryAfter
    }
  }
  if (error.includes('500') || error.includes('502') || error.includes('503')) {
    return {
      type: 'server',
      message: 'ChatGPT is temporarily unavailable. Please try again in a moment.'
    }
  }
  if (error.includes('network') || error.includes('fetch') || error.includes('Failed to fetch')) {
    return {
      type: 'network',
      message: 'Unable to connect. Please check your network.'
    }
  }
  return {
    type: 'generic',
    message: error
  }
}

// Legacy parseError for simple use cases
function parseError(error: string): string {
  return parseErrorDetailed(error).message
}

// Rate limit countdown state
let rateLimitCountdown: number | null = null
let rateLimitTimer: number | null = null

// Show error with special handling for different error types
function showErrorWithAction(error: string) {
  const parsed = parseErrorDetailed(error)

  // Clear any existing rate limit timer
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

// Show auth error with refresh prompt
function showAuthError(message: string) {
  errorDiv.innerHTML = `
    <div class="error-content">
      <span class="error-icon">🔑</span>
      <span class="error-message">${escapeHtml(message)}</span>
    </div>
    <button class="error-action-btn" id="refreshPageBtn">
      <span>↻</span> Refresh ChatGPT
    </button>
  `
  errorDiv.classList.remove('hidden')
  errorDiv.className = 'error error-auth'

  document.getElementById('refreshPageBtn')?.addEventListener('click', async () => {
    // Find ChatGPT tab and reload it
    try {
      const tabs = await chrome.tabs.query({ url: ['*://chatgpt.com/*', '*://chat.openai.com/*'] })
      if (tabs.length > 0 && tabs[0].id) {
        await chrome.tabs.reload(tabs[0].id)
        errorDiv.innerHTML = '<span class="error-icon">✓</span> Refreshing ChatGPT... Please wait a moment then click Sync.'
      } else {
        window.open('https://chatgpt.com', '_blank')
      }
    } catch {
      window.open('https://chatgpt.com', '_blank')
    }
  })
}

// Show rate limit error with countdown
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
        syncAllConversations()
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
        <span class="error-message">${escapeHtml(message)} Please wait ${rateLimitCountdown}s...</span>
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

// Show network error with retry button
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
    syncAllConversations()
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

// Optimistic delete handler
confirmBtn.addEventListener('click', async () => {
  const isBatch = pendingDeleteIds.length > 0
  const idsToDelete = isBatch ? [...pendingDeleteIds] : (pendingDeleteId ? [pendingDeleteId] : [])

  if (idsToDelete.length === 0) return

  const shouldBackup = backupCheckbox.checked
  hideConfirmDialog()

  // Save original state for rollback
  const originalConversations = [...cachedConversations]
  const originalSelected = new Set(selectedForDelete)

  // Optimistic UI update - immediately mark as deleting
  idsToDelete.forEach(id => {
    deletingIds.add(id)
    selectedForDelete.delete(id)
  })

  // Update UI to show deleting state
  updateDeletingState()

  // Process deletions
  const failedIds: string[] = []
  const failedErrors: string[] = []

  for (const id of idsToDelete) {
    try {
      // Backup first if checked
      if (shouldBackup) {
        const backupResponse = await chrome.runtime.sendMessage({
          type: 'BACKUP_CONVERSATION',
          conversationId: id
        })
        if (backupResponse.error) {
          failedIds.push(id)
          failedErrors.push(`Backup failed: ${parseError(backupResponse.error)}`)
          continue
        }
      }

      // Delete
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_CONVERSATION',
        conversationId: id
      })

      if (response.error) {
        failedIds.push(id)
        failedErrors.push(parseError(response.error))
      } else {
        // Success - remove from cache
        cachedConversations = cachedConversations.filter(c => c.id !== id)
      }
    } catch (err) {
      failedIds.push(id)
      failedErrors.push(parseError(String(err)))
    }

    deletingIds.delete(id)
  }

  // Handle failures
  if (failedIds.length > 0) {
    if (failedIds.length === idsToDelete.length) {
      // All failed - full rollback
      cachedConversations = originalConversations
      selectedForDelete = originalSelected
    }
    showError(failedErrors[0])
  }

  // Clear all deleting states
  deletingIds.clear()

  // Save updated cache
  await saveCache()

  // Re-render without full loading
  renderConversationList(cachedConversations)

  // Silent refresh in background to sync with server
  syncAllConversations()
})

// Update UI for items being deleted
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

  // Disable batch delete button if any deletion in progress
  const batchBtn = document.getElementById('batchDeleteBtn') as HTMLButtonElement
  if (batchBtn && deletingIds.size > 0) {
    batchBtn.disabled = true
  }
}

// Helper function for delay
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Render bottom sync status bar
function renderSyncStatusBar(): string {
  if (cachedConversations.length === 0 && !isSyncing) return ''

  if (isSyncing) {
    const progressText = syncProgress.total > 0
      ? `${syncProgress.current}/${syncProgress.total}`
      : `${syncProgress.current}`
    return `
      <div class="sync-status-bar syncing">
        <span class="sync-indicator spinning"></span>
        <span>Syncing... ${progressText}</span>
      </div>
    `
  }

  const countText = `${cachedConversations.length} conversations`
  const timeText = lastSyncAt ? `Last sync: ${formatRelativeTime(lastSyncAt)}` : ''

  return `
    <div class="sync-status-bar">
      <span>${countText}${timeText ? ' · ' + timeText : ''}</span>
      <button id="manualSyncBtn" class="manual-sync-btn" title="Sync now">↻</button>
    </div>
  `
}

// Update sync status bar without full re-render
function updateSyncStatusBar() {
  const statusBar = document.querySelector('.sync-status-bar')
  if (!statusBar) return

  if (isSyncing) {
    const progressText = syncProgress.total > 0
      ? `${syncProgress.current}/${syncProgress.total}`
      : `${syncProgress.current}`
    statusBar.className = 'sync-status-bar syncing'
    statusBar.innerHTML = `
      <span class="sync-indicator spinning"></span>
      <span>Syncing... ${progressText}</span>
    `
  } else {
    const countText = `${cachedConversations.length} conversations`
    const timeText = lastSyncAt ? `Last sync: ${formatRelativeTime(lastSyncAt)}` : ''
    statusBar.className = 'sync-status-bar'
    statusBar.innerHTML = `
      <span>${countText}${timeText ? ' · ' + timeText : ''}</span>
      <button id="manualSyncBtn" class="manual-sync-btn" title="Sync now">↻</button>
    `
    // Re-attach handler
    document.getElementById('manualSyncBtn')?.addEventListener('click', () => {
      if (!isSyncing) syncAllConversations()
    })
  }
}

// Fetch all conversations silently in background
async function syncAllConversations() {
  if (isSyncing) return

  isSyncing = true
  syncProgress = { current: 0, total: 0 }
  updateSyncStatusBar()

  try {
    const allConversations: Conversation[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_CONVERSATIONS',
        offset,
        limit: SYNC_BATCH_SIZE
      })

      if (response.error) {
        logger.error('Sync failed:', response.error)
        // If we have some data, keep it; otherwise show error
        if (allConversations.length === 0 && cachedConversations.length === 0) {
          showErrorWithAction(response.error)
        }
        break
      }

      if (response.data?.items) {
        allConversations.push(...response.data.items)
        syncProgress = {
          current: allConversations.length,
          total: response.data.total || allConversations.length
        }
        totalCount = response.data.total || allConversations.length
        updateSyncStatusBar()

        hasMore = response.data.has_more ?? false
        offset += SYNC_BATCH_SIZE

        // Delay between requests to avoid rate limiting
        if (hasMore) {
          await sleep(SYNC_DELAY_MS)
        }
      } else {
        break
      }
    }

    // Update cache with all conversations
    if (allConversations.length > 0) {
      cachedConversations = allConversations
      await saveCache()

      // Re-render if no deletion in progress
      if (deletingIds.size === 0) {
        renderConversationList(cachedConversations)
      }
    }
  } catch (err) {
    logger.error('Sync error:', err)
  } finally {
    isSyncing = false
    updateSyncStatusBar()
  }
}

// Attach sync button handler
function attachSyncButtonHandler() {
  document.getElementById('manualSyncBtn')?.addEventListener('click', () => {
    if (!isSyncing) syncAllConversations()
  })
}

async function checkTokenStatus(): Promise<boolean> {
  tokenStatusDiv.textContent = 'Checking token...'
  tokenStatusDiv.className = 'token-status checking'

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TOKEN_STATUS' })
    if (response.hasToken) {
      tokenStatusDiv.textContent = '✓ Token acquired'
      tokenStatusDiv.className = 'token-status success'
      return true
    } else {
      tokenStatusDiv.textContent = '✗ No token - Please open ChatGPT first'
      tokenStatusDiv.className = 'token-status error'
      return false
    }
  } catch (err) {
    tokenStatusDiv.textContent = '✗ Failed to check token'
    tokenStatusDiv.className = 'token-status error'
    return false
  }
}

function renderPreview(messages: Message[], conversationId: string, title: string) {
  const lastMessages = messages.slice(-3)

  const messagesHtml = lastMessages.length === 0
    ? '<p class="empty">No messages</p>'
    : lastMessages.map(msg => `
        <div class="message ${msg.role}">
          <div class="msg-role">${msg.role === 'user' ? 'You' : 'ChatGPT'}</div>
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

async function showConversationPreview(conversationId: string, title: string) {
  selectedConversationId = conversationId

  document.querySelectorAll('.conversation-item').forEach(el => {
    el.classList.toggle('selected', el.getAttribute('data-id') === conversationId)
  })

  const previewDiv = document.getElementById('preview')
  if (!previewDiv) return

  previewDiv.innerHTML = '<p class="loading">Loading preview...</p>'

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_CONVERSATION_DETAIL',
      conversationId
    })

    if (response.error) {
      previewDiv.innerHTML = `<p class="error-text">${parseError(response.error)}</p>`
      return
    }

    // Extract and save snippet to cache
    const messages = response.data.messages
    const snippet = extractSnippet(messages)
    const conv = cachedConversations.find(c => c.id === conversationId)
    if (conv) {
      conv.snippet = snippet
      conv.messageCount = messages.length
      // Update cache in storage
      saveCache()
      // Update the snippet display in the list
      updateConversationSnippet(conversationId, snippet, messages.length)
    }

    previewDiv.innerHTML = renderPreview(messages, conversationId, title)

    const deleteBtn = previewDiv.querySelector('.delete-btn')
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        const id = deleteBtn.getAttribute('data-id')
        const btnTitle = deleteBtn.getAttribute('data-title') || 'Untitled'
        if (id) showConfirmDialog(id, btnTitle)
      })
    }
  } catch (err) {
    previewDiv.innerHTML = `<p class="error-text">Failed to load preview</p>`
  }
}

// Update snippet in the DOM without full re-render
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

function renderTabs() {
  return `
    <div class="tabs">
      <button class="tab ${currentView === 'conversations' ? 'active' : ''}" data-view="conversations">Conversations</button>
      <button class="tab ${currentView === 'backups' ? 'active' : ''}" data-view="backups">Backups</button>
    </div>
  `
}

function updateBatchDeleteBtn() {
  const btn = document.getElementById('batchDeleteBtn') as HTMLButtonElement
  const count = selectedForDelete.size
  if (btn) {
    btn.textContent = count > 0 ? `Delete (${count})` : 'Delete'
    btn.disabled = count === 0 || deletingIds.size > 0
  }
}

// Filter conversations by search query
function filterConversations(conversations: Conversation[], query: string): Conversation[] {
  if (!query.trim()) return conversations
  const lowerQuery = query.toLowerCase().trim()
  return conversations.filter(conv => {
    const title = (conv.title || '').toLowerCase()
    const snippet = (conv.snippet || '').toLowerCase()
    return title.includes(lowerQuery) || snippet.includes(lowerQuery)
  })
}

// Render search box
function renderSearchBox(): string {
  return `
    <div class="search-box">
      <span class="search-icon">🔍</span>
      <input type="text" id="searchInput" class="search-input" placeholder="Search conversations..." value="${escapeHtml(searchQuery)}">
      <button id="clearSearchBtn" class="clear-search-btn ${searchQuery ? '' : 'hidden'}" title="Clear">×</button>
    </div>
  `
}

// Attach search handlers
function attachSearchHandlers() {
  const searchInput = document.getElementById('searchInput') as HTMLInputElement
  const clearBtn = document.getElementById('clearSearchBtn') as HTMLButtonElement

  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value
    clearBtn?.classList.toggle('hidden', !searchQuery)
    // Only update list items, don't re-render entire layout
    updateListItems()
  })

  clearBtn?.addEventListener('click', () => {
    searchQuery = ''
    if (searchInput) searchInput.value = ''
    clearBtn.classList.add('hidden')
    updateListItems()
    searchInput?.focus()
  })
}

// Update only the list items without re-rendering the entire layout
function updateListItems() {
  const listContainer = document.querySelector('.conversation-list')
  const resultCountEl = document.querySelector('.search-result-count')

  if (!listContainer) return

  const filteredConversations = filterConversations(cachedConversations, searchQuery)

  // Update result count
  if (resultCountEl) {
    if (searchQuery) {
      resultCountEl.textContent = `${filteredConversations.length} results`
      resultCountEl.classList.remove('hidden')
    } else {
      resultCountEl.classList.add('hidden')
    }
  }

  // Handle no results case
  if (filteredConversations.length === 0 && searchQuery) {
    listContainer.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <div class="no-results-text">No conversations match "${escapeHtml(searchQuery)}"</div>
        <div class="no-results-hint">Try a different search term</div>
      </div>
    `
    return
  }

  // Generate list HTML
  const listHtml = filteredConversations.map(conv => {
    const isDeleting = deletingIds.has(conv.id)
    const snippetText = conv.snippet || ''
    const countText = conv.messageCount ? `${conv.messageCount} msgs` : ''
    return `
    <div class="conversation-item ${isDeleting ? 'deleting' : ''}" data-id="${conv.id}" data-title="${escapeHtml(conv.title || 'Untitled')}">
      <input type="checkbox" class="conv-checkbox" data-id="${conv.id}" ${selectedForDelete.has(conv.id) ? 'checked' : ''} ${isDeleting ? 'disabled' : ''}>
      <div class="conv-content">
        <div class="conv-title">${escapeHtml(conv.title || 'Untitled')}</div>
        <div class="conv-snippet">${snippetText ? escapeHtml(snippetText) : '<span class="no-preview">(Click to load preview)</span>'}</div>
        <div class="conv-meta">
          <span class="conv-date">${formatRelativeTime(new Date(conv.update_time).getTime())}</span>
          ${countText ? `<span class="conv-count">${countText}</span>` : ''}
        </div>
      </div>
      <button class="conv-delete-btn" data-id="${conv.id}" data-title="${escapeHtml(conv.title || 'Untitled')}" title="Delete" ${isDeleting ? 'disabled' : ''}>
        ${isDeleting ? '<span class="spinner-small"></span>' : '×'}
      </button>
    </div>
  `}).join('')

  listContainer.innerHTML = listHtml

  // Re-attach event handlers for list items
  attachListItemHandlers()
}

// Attach handlers to list items (extracted for reuse)
function attachListItemHandlers() {
  const selectAllCheckbox = document.getElementById('selectAllCheckbox') as HTMLInputElement

  // Individual checkboxes
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

      // Update select all state
      const allCheckboxes = contentDiv.querySelectorAll('.conv-checkbox:not(:disabled)') as NodeListOf<HTMLInputElement>
      const allChecked = Array.from(allCheckboxes).every(c => c.checked)
      if (selectAllCheckbox) selectAllCheckbox.checked = allChecked
    })
  })

  // Click on item to preview
  contentDiv.querySelectorAll('.conv-content').forEach(el => {
    el.addEventListener('click', () => {
      const item = el.parentElement
      const id = item?.getAttribute('data-id')
      const title = item?.getAttribute('data-title') || 'Untitled'
      if (id && !deletingIds.has(id)) showConversationPreview(id, title)
    })
  })

  // Click delete button
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

function renderConversationList(conversations: Conversation[]) {
  // Don't clear selectedForDelete if just re-rendering after delete
  const preserveSelection = deletingIds.size > 0
  if (!preserveSelection) {
    selectedForDelete.clear()
  }

  // Filter by search query
  const filteredConversations = filterConversations(conversations, searchQuery)

  // No conversations at all
  if (conversations.length === 0) {
    contentDiv.innerHTML = `
      ${renderTabs()}
      <div class="main-layout">
        <div class="left-panel">
          <p class="empty">No conversations found.</p>
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
    attachTabHandlers()
    attachSyncButtonHandler()
    return
  }

  // Has conversations but search returned no results
  if (filteredConversations.length === 0 && searchQuery) {
    contentDiv.innerHTML = `
      ${renderTabs()}
      <div class="main-layout">
        <div class="left-panel">
          ${renderSearchBox()}
          <div class="no-results">
            <div class="no-results-icon">🔍</div>
            <div class="no-results-text">No conversations match "${escapeHtml(searchQuery)}"</div>
            <div class="no-results-hint">Try a different search term</div>
          </div>
          ${renderSyncStatusBar()}
        </div>
        <div class="right-panel">
          <div class="right-panel-header">Preview</div>
          <div class="right-panel-content">
            <div id="preview" class="preview">
              <div class="preview-empty">
                <div class="preview-empty-icon">💬</div>
                <div>Click a conversation to preview</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `
    attachTabHandlers()
    attachSearchHandlers()
    attachSyncButtonHandler()
    return
  }

  const listHtml = filteredConversations.map(conv => {
    const isDeleting = deletingIds.has(conv.id)
    const snippetText = conv.snippet || ''
    const countText = conv.messageCount ? `${conv.messageCount} msgs` : ''
    return `
    <div class="conversation-item ${isDeleting ? 'deleting' : ''}" data-id="${conv.id}" data-title="${escapeHtml(conv.title || 'Untitled')}">
      <input type="checkbox" class="conv-checkbox" data-id="${conv.id}" ${selectedForDelete.has(conv.id) ? 'checked' : ''} ${isDeleting ? 'disabled' : ''}>
      <div class="conv-content">
        <div class="conv-title">${escapeHtml(conv.title || 'Untitled')}</div>
        <div class="conv-snippet">${snippetText ? escapeHtml(snippetText) : '<span class="no-preview">(Click to load preview)</span>'}</div>
        <div class="conv-meta">
          <span class="conv-date">${formatRelativeTime(new Date(conv.update_time).getTime())}</span>
          ${countText ? `<span class="conv-count">${countText}</span>` : ''}
        </div>
      </div>
      <button class="conv-delete-btn" data-id="${conv.id}" data-title="${escapeHtml(conv.title || 'Untitled')}" title="Delete" ${isDeleting ? 'disabled' : ''}>
        ${isDeleting ? '<span class="spinner-small"></span>' : '×'}
      </button>
    </div>
  `}).join('')

  // Result count
  const resultCountHtml = `<div class="search-result-count ${searchQuery ? '' : 'hidden'}">${searchQuery ? `${filteredConversations.length} results` : ''}</div>`

  contentDiv.innerHTML = `
    ${renderTabs()}
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
              <div class="preview-empty-icon">💬</div>
              <div>Click a conversation to preview</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `

  attachTabHandlers()
  attachSearchHandlers()

  // Select all checkbox
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

  // Batch delete button
  const batchDeleteBtn = document.getElementById('batchDeleteBtn')
  batchDeleteBtn?.addEventListener('click', () => {
    if (selectedForDelete.size > 0 && deletingIds.size === 0) {
      showBatchConfirmDialog(Array.from(selectedForDelete))
    }
  })

  // Attach list item handlers (checkboxes, preview, delete buttons)
  attachListItemHandlers()

  // Attach sync button handler
  attachSyncButtonHandler()
}


interface Backup {
  id: string
  title: string
  messages: Message[]
  backupTime: number
}

function renderBackupPreview(backup: Backup) {
  const lastMessages = backup.messages.slice(-3)

  const messagesHtml = lastMessages.length === 0
    ? '<p class="empty">No messages</p>'
    : lastMessages.map(msg => `
        <div class="message ${msg.role}">
          <div class="msg-role">${msg.role === 'user' ? 'You' : 'ChatGPT'}</div>
          <div class="msg-content">${escapeHtml(msg.content.substring(0, 200))}${msg.content.length > 200 ? '...' : ''}</div>
        </div>
      `).join('')

  return messagesHtml
}

async function renderBackupList() {
  contentDiv.innerHTML = renderTabs() + '<p class="loading">Loading backups...</p>'
  attachTabHandlers()

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_BACKUPS' })
    const backups: Backup[] = response.backups || []

    if (backups.length === 0) {
      contentDiv.innerHTML = renderTabs() + '<p class="empty">No backups found</p>'
      attachTabHandlers()
      return
    }

    const listHtml = backups.map(backup => `
      <div class="backup-item" data-id="${backup.id}">
        <div class="backup-header">
          <div class="conv-title">${escapeHtml(backup.title || 'Untitled')}</div>
          <button class="delete-backup-btn" data-id="${backup.id}">×</button>
        </div>
        <div class="conv-date">Backed up: ${formatDate(backup.backupTime)}</div>
        <div class="backup-preview">${renderBackupPreview(backup)}</div>
      </div>
    `).join('')

    contentDiv.innerHTML = `
      ${renderTabs()}
      <div class="backup-list">${listHtml}</div>
    `

    attachTabHandlers()

    contentDiv.querySelectorAll('.delete-backup-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const id = btn.getAttribute('data-id')
        if (id && confirm('Delete this backup?')) {
          await chrome.runtime.sendMessage({ type: 'DELETE_BACKUP', conversationId: id })
          renderBackupList()
        }
      })
    })
  } catch (err) {
    showError(`Failed to load backups: ${parseError(String(err))}`)
  }
}

function attachTabHandlers() {
  contentDiv.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.getAttribute('data-view') as 'conversations' | 'backups'
      if (view && view !== currentView) {
        currentView = view
        if (view === 'conversations') {
          // Use cached data, trigger background sync
          renderConversationList(cachedConversations)
          syncAllConversations()
        } else {
          renderBackupList()
        }
      }
    })
  })
}

// Show initial loading state when no cache
function showInitialLoading() {
  contentDiv.innerHTML = `
    ${renderTabs()}
    <div class="main-layout">
      <div class="left-panel">
        <div class="sync-status-bar syncing">
          <span class="sync-indicator spinning"></span>
          <span>Loading conversations...</span>
        </div>
      </div>
      <div class="right-panel">
        <div class="right-panel-header">Preview</div>
        <div class="right-panel-content">
          <div id="preview" class="preview">
            <div class="preview-empty">
              <div class="preview-empty-icon">💬</div>
              <div>Loading...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
  attachTabHandlers()
}

async function init() {
  clearError()

  // Load user settings (backup preference)
  await loadSettings()

  // Step 1: Load cache first (instant display)
  const hasCache = await loadCache()

  if (hasCache) {
    // Have cache - render immediately
    renderConversationList(cachedConversations)
  } else {
    // No cache - show loading state
    showInitialLoading()
  }

  // Step 2: Check token
  const hasToken = await checkTokenStatus()

  if (hasToken) {
    // Start background sync (will update UI when done)
    syncAllConversations()
  } else {
    if (!hasCache) {
      contentDiv.innerHTML = `
        ${renderTabs()}
        <div class="main-layout">
          <div class="left-panel">
            <p>To use this extension:</p>
            <ol>
              <li>Open <a href="https://chatgpt.com" target="_blank">chatgpt.com</a></li>
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
                  <div>Login to ChatGPT first</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `
      attachTabHandlers()
    }
  }
}

init()
