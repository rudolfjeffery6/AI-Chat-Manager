/**
 * ChatGPT API wrapper
 * Base URL: https://chatgpt.com/backend-api
 */

const API_BASE = 'https://chatgpt.com/backend-api'

export interface ChatGPTConversation {
  id: string
  title: string
  create_time: string
  update_time: string
}

export interface ChatGPTConversationsResponse {
  items: ChatGPTConversation[]
  total: number
  limit: number
  offset: number
}

export interface ChatGPTMessage {
  id: string
  author: { role: string }
  content: {
    parts: string[]
    content_type: string
  }
  create_time?: number
}

export interface ChatGPTMappingNode {
  id: string
  message?: ChatGPTMessage
  parent?: string | null
  children?: string[]
}

export interface ChatGPTConversationDetail {
  title: string
  create_time: number
  update_time: number
  mapping: Record<string, ChatGPTMappingNode>
}

export async function fetchConversations(
  token: string,
  offset = 0,
  limit = 50
): Promise<ChatGPTConversationsResponse> {
  const response = await fetch(
    `${API_BASE}/conversations?offset=${offset}&limit=${limit}&order=updated`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  )

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('AUTH_REQUIRED: Session expired')
    }
    if (response.status === 429) {
      throw new Error('RATE_LIMIT: Too many requests')
    }
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

export async function fetchConversationDetail(
  token: string,
  conversationId: string
): Promise<ChatGPTConversationDetail> {
  const response = await fetch(
    `${API_BASE}/conversation/${conversationId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  )

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('AUTH_REQUIRED: Session expired')
    }
    if (response.status === 404) {
      throw new Error('NOT_FOUND: Conversation not found')
    }
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

export async function deleteConversation(
  token: string,
  conversationId: string
): Promise<boolean> {
  const response = await fetch(
    `${API_BASE}/conversation/${conversationId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ is_visible: false })
    }
  )

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('AUTH_REQUIRED: Session expired')
    }
    throw new Error(`API error: ${response.status}`)
  }

  return true
}
