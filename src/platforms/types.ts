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
