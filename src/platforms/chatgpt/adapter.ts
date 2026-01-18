/**
 * ChatGPT data adapter
 * Converts ChatGPT API responses to unified format
 */

import type { UnifiedConversation, UnifiedMessage } from '../types'
import type {
  ChatGPTConversation,
  ChatGPTConversationDetail,
  ChatGPTMappingNode
} from './api'

/**
 * Convert ChatGPT conversation to unified format
 */
export function toUnifiedConversation(conv: ChatGPTConversation): UnifiedConversation {
  return {
    id: conv.id,
    title: conv.title || 'Untitled',
    createTime: new Date(conv.create_time).getTime(),
    updateTime: new Date(conv.update_time).getTime(),
    platform: 'chatgpt'
  }
}

/**
 * Extract messages from ChatGPT mapping tree
 */
export function extractMessages(detail: ChatGPTConversationDetail): UnifiedMessage[] {
  const messages: UnifiedMessage[] = []
  const mapping = detail.mapping || {}

  function traverse(nodeId: string | null) {
    if (!nodeId || !mapping[nodeId]) return

    const node: ChatGPTMappingNode = mapping[nodeId]
    const msg = node.message

    if (msg?.content?.parts && msg.author) {
      const role = msg.author.role as 'user' | 'assistant' | 'system'
      if (role === 'user' || role === 'assistant') {
        const content = msg.content.parts.join('')
        if (content.trim()) {
          messages.push({
            id: msg.id,
            role,
            content,
            createTime: msg.create_time ? msg.create_time * 1000 : Date.now()
          })
        }
      }
    }

    // Traverse first child (linear path)
    if (node.children && node.children.length > 0) {
      traverse(node.children[0])
    }
  }

  // Find root node (no parent)
  const rootId = Object.keys(mapping).find(id => !mapping[id].parent)
  traverse(rootId || null)

  return messages
}
