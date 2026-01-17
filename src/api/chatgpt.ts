const API_BASE = 'https://chatgpt.com/backend-api'

export interface Conversation {
  id: string
  title: string
  create_time: string
  update_time: string
  // Local fields (not from API)
  snippet?: string
  messageCount?: number
}

export interface ConversationsResponse {
  items: Conversation[]
  total: number
  limit: number
  offset: number
}

export async function getConversations(
  token: string,
  offset = 0,
  limit = 28
): Promise<ConversationsResponse> {
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
      throw new Error('Unauthorized - please refresh ChatGPT page')
    }
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ConversationDetail {
  title: string
  messages: Message[]
}

export async function getConversation(
  token: string,
  conversationId: string
): Promise<ConversationDetail> {
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
      throw new Error('Unauthorized - please refresh ChatGPT page')
    }
    throw new Error(`API error: ${response.status}`)
  }

  const data = await response.json()

  // Parse the conversation mapping to extract messages
  const messages: Message[] = []
  const mapping = data.mapping || {}

  // Find messages in order (traverse the tree)
  function extractMessages(nodeId: string | null) {
    if (!nodeId || !mapping[nodeId]) return
    const node = mapping[nodeId]
    const msg = node.message
    if (msg && msg.content && msg.content.parts && msg.author) {
      const role = msg.author.role
      if (role === 'user' || role === 'assistant') {
        const content = msg.content.parts.join('')
        if (content.trim()) {
          messages.push({
            id: msg.id,
            role,
            content
          })
        }
      }
    }
    // Continue to children
    if (node.children && node.children.length > 0) {
      extractMessages(node.children[0])
    }
  }

  // Find root and traverse
  const rootId = Object.keys(mapping).find(id => !mapping[id].parent)
  extractMessages(rootId || null)

  return {
    title: data.title || 'Untitled',
    messages
  }
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
      throw new Error('Unauthorized - please refresh ChatGPT page')
    }
    throw new Error(`API error: ${response.status}`)
  }

  return true
}
