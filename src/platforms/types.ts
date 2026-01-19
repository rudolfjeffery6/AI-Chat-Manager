/**
 * Multi-platform types for AI Chat Manager
 * Supports: ChatGPT, Claude, (future: Gemini)
 */

export type PlatformType = 'chatgpt' | 'claude' | 'gemini'

export interface PlatformConfig {
  name: PlatformType
  displayName: string
  hostPatterns: string[]
  icon: string
  color: string
}

export interface UnifiedConversation {
  id: string
  title: string
  summary?: string
  createTime: number
  updateTime: number
  platform: PlatformType
  isStarred?: boolean
  // Local fields (enriched after detail fetch)
  snippet?: string
  messageCount?: number
}

export interface UnifiedMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createTime: number
}

export interface AuthResult {
  ok: boolean
  error?: 'AUTH_REQUIRED' | 'NO_TAB' | 'INJECT_FAILED' | 'NETWORK_ERROR'
  message?: string
}

export interface ConversationsResult {
  conversations: UnifiedConversation[]
  total: number
  hasMore: boolean
}

export interface PlatformAdapter extends PlatformConfig {
  /**
   * Check if user is authenticated on this platform
   */
  checkAuth(): Promise<AuthResult>

  /**
   * Get list of conversations
   * @param offset - Pagination offset
   * @param limit - Max items per page
   */
  getConversations(offset?: number, limit?: number): Promise<ConversationsResult>

  /**
   * Get conversation detail with messages
   */
  getConversationDetail(id: string): Promise<UnifiedMessage[]>

  /**
   * Delete a single conversation
   */
  deleteConversation(id: string): Promise<boolean>

  /**
   * Batch delete conversations (optional)
   */
  deleteConversations?(ids: string[]): Promise<{ success: string[]; failed: string[] }>

  /**
   * Set auth token for this platform
   */
  setToken(token: string): void

  /**
   * Get current token
   */
  getToken(): string | null
}

// Cache types
export interface PlatformCache {
  conversations: UnifiedConversation[]
  totalCount: number
  lastSyncTime: number
  syncComplete: boolean
}

export interface SyncProgress {
  loaded: number
  total: number
  inProgress?: boolean
}

// Storage key helpers
export function getCacheKey(platform: PlatformType): string {
  return `${platform}_conversationCache`
}

export function getSyncProgressKey(platform: PlatformType): string {
  return `${platform}_syncProgress`
}

export function getSyncErrorKey(platform: PlatformType): string {
  return `${platform}_syncError`
}

export function getBackupKey(platform: PlatformType, conversationId: string): string {
  return `${platform}_backup_${conversationId}`
}

export function getPreviewCacheKey(platform: PlatformType, conversationId: string): string {
  return `${platform}_preview_${conversationId}`
}

// Preview cache structure
export interface PreviewCache {
  messages: UnifiedMessage[]
  cachedAt: number
}

// Preview cache expiry (24 hours)
export const PREVIEW_CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000

// Content index types
export interface ContentIndexEntry {
  contentText: string    // All messages concatenated, max 2000 chars
  indexedAt: number
}

export interface ContentIndex {
  [conversationId: string]: ContentIndexEntry
}

export interface IndexProgress {
  indexed: number
  total: number
  inProgress: boolean
  currentId?: string
  pausedUntil?: number  // Timestamp when pause ends (for rate limiting)
}

// Content index storage key
export function getContentIndexKey(platform: PlatformType): string {
  return `${platform}_content_index`
}

export function getIndexProgressKey(platform: PlatformType): string {
  return `${platform}_index_progress`
}

// Index config
export const INDEX_CONFIG = {
  requestInterval: 5000,      // 5 seconds between requests
  pauseOn429: 60000,          // Pause 60 seconds on rate limit
  pauseOnError: 30000,        // Pause 30 seconds on other errors
  maxContentLength: 2000,     // Max chars per conversation
  maxIndexedConversations: 500 // Max conversations to index
}
