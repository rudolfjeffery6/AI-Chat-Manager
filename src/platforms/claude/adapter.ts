/**
 * Claude data adapter
 * Converts Claude API responses to unified format
 */

import type { UnifiedConversation, UnifiedMessage } from '../types'
import type { ClaudeConversation, ClaudeMessage, ClaudeConversationDetail } from './api'

/**
 * Convert Claude conversation to unified format
 */
export function toUnifiedConversation(conv: ClaudeConversation): UnifiedConversation {
  return {
    id: conv.uuid,
    title: conv.name || 'Untitled',
    summary: conv.summary,
    createTime: new Date(conv.created_at).getTime(),
    updateTime: new Date(conv.updated_at).getTime(),
    platform: 'claude',
    isStarred: conv.is_starred
  }
}

/**
 * Convert Claude message to unified format
 */
export function toUnifiedMessage(msg: ClaudeMessage): UnifiedMessage {
  // Extract text content
  let content = msg.text || ''

  // If no text but has content blocks, extract from there
  if (!content && msg.content) {
    content = msg.content
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text)
      .join('\n')
  }

  return {
    id: msg.uuid,
    role: msg.sender === 'human' ? 'user' : 'assistant',
    content,
    createTime: new Date(msg.created_at).getTime()
  }
}

/**
 * Extract messages from Claude conversation detail
 */
export function extractMessages(detail: ClaudeConversationDetail): UnifiedMessage[] {
  if (!detail.chat_messages || !Array.isArray(detail.chat_messages)) {
    return []
  }

  return detail.chat_messages
    .sort((a, b) => a.index - b.index)
    .map(toUnifiedMessage)
    .filter(msg => msg.content.trim())
}
