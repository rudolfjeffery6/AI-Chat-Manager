/**
 * ChatGPT Platform Implementation
 */

import type {
  PlatformAdapter,
  PlatformType,
  AuthResult,
  ConversationsResult,
  UnifiedMessage
} from '../types'
import {
  fetchConversations,
  fetchConversationDetail,
  deleteConversation as apiDeleteConversation
} from './api'
import { toUnifiedConversation, extractMessages } from './adapter'

export class ChatGPTPlatform implements PlatformAdapter {
  readonly name: PlatformType = 'chatgpt'
  readonly displayName = 'ChatGPT'
  readonly hostPatterns = ['chatgpt.com', 'chat.openai.com']
  readonly icon = '🤖'
  readonly color = '#10a37f'

  private token: string | null = null

  setToken(token: string): void {
    this.token = token
  }

  getToken(): string | null {
    return this.token
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.token) {
      return {
        ok: false,
        error: 'AUTH_REQUIRED',
        message: 'Please open ChatGPT and log in first'
      }
    }

    try {
      // Try a simple API call to verify token
      await fetchConversations(this.token, 0, 1)
      return { ok: true }
    } catch (err) {
      const errorMsg = String(err)
      if (errorMsg.includes('AUTH_REQUIRED') || errorMsg.includes('401')) {
        return {
          ok: false,
          error: 'AUTH_REQUIRED',
          message: 'Session expired. Please refresh ChatGPT page.'
        }
      }
      return {
        ok: false,
        error: 'NETWORK_ERROR',
        message: errorMsg
      }
    }
  }

  async getConversations(offset = 0, limit = 50): Promise<ConversationsResult> {
    if (!this.token) {
      throw new Error('AUTH_REQUIRED: No token available')
    }

    const data = await fetchConversations(this.token, offset, limit)
    const conversations = data.items.map(toUnifiedConversation)
    const loadedCount = offset + data.items.length
    const hasMore = loadedCount < data.total

    return {
      conversations,
      total: data.total,
      hasMore
    }
  }

  async getConversationDetail(id: string): Promise<UnifiedMessage[]> {
    if (!this.token) {
      throw new Error('AUTH_REQUIRED: No token available')
    }

    const detail = await fetchConversationDetail(this.token, id)
    return extractMessages(detail)
  }

  async deleteConversation(id: string): Promise<boolean> {
    if (!this.token) {
      throw new Error('AUTH_REQUIRED: No token available')
    }

    return apiDeleteConversation(this.token, id)
  }

  async deleteConversations(ids: string[]): Promise<{ success: string[]; failed: string[] }> {
    const success: string[] = []
    const failed: string[] = []

    for (const id of ids) {
      try {
        await this.deleteConversation(id)
        success.push(id)
      } catch {
        failed.push(id)
      }
    }

    return { success, failed }
  }
}

export const chatgptPlatform = new ChatGPTPlatform()
