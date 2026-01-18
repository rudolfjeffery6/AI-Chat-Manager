/**
 * Claude.ai API wrapper
 * Base URL: https://claude.ai/api
 * Authentication: Session Cookie (credentials: 'include')
 */

const API_BASE = 'https://claude.ai/api'

export interface ClaudeOrganization {
  uuid: string
  name: string
  capabilities: string[]
}

export interface ClaudeConversation {
  uuid: string
  name: string
  summary: string
  model: string | null
  created_at: string
  updated_at: string
  is_starred: boolean
  project_uuid: string | null
}

export interface ClaudeMessage {
  uuid: string
  text: string
  sender: 'human' | 'assistant'
  index: number
  created_at: string
  updated_at: string
  content?: ClaudeContentBlock[]
}

export interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
}

export interface ClaudeConversationDetail {
  uuid: string
  name: string
  summary: string
  model: string | null
  created_at: string
  updated_at: string
  chat_messages: ClaudeMessage[]
}

/**
 * Get user's organizations (needed for all other API calls)
 */
export async function fetchOrganizations(): Promise<ClaudeOrganization[]> {
  const response = await fetch(`${API_BASE}/organizations`, {
    credentials: 'include'
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('AUTH_REQUIRED: Please log in to Claude')
    }
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Get conversation list for an organization
 */
export async function fetchConversations(
  orgId: string
): Promise<ClaudeConversation[]> {
  const response = await fetch(
    `${API_BASE}/organizations/${orgId}/chat_conversations`,
    { credentials: 'include' }
  )

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('AUTH_REQUIRED: Session expired')
    }
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Get conversation detail with messages
 */
export async function fetchConversationDetail(
  orgId: string,
  conversationId: string
): Promise<ClaudeConversationDetail> {
  const response = await fetch(
    `${API_BASE}/organizations/${orgId}/chat_conversations/${conversationId}`,
    { credentials: 'include' }
  )

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('AUTH_REQUIRED: Session expired')
    }
    if (response.status === 404) {
      throw new Error('NOT_FOUND: Conversation not found')
    }
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Delete a conversation (hard delete)
 */
export async function deleteConversation(
  orgId: string,
  conversationId: string
): Promise<boolean> {
  const response = await fetch(
    `${API_BASE}/organizations/${orgId}/chat_conversations/${conversationId}`,
    {
      method: 'DELETE',
      credentials: 'include'
    }
  )

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('AUTH_REQUIRED: Session expired')
    }
    throw new Error(`API error: ${response.status}`)
  }

  return true
}
