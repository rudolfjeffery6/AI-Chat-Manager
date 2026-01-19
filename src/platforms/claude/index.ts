/**
 * Claude Platform Implementation
 */

import type {
  PlatformAdapter,
  PlatformType,
  AuthResult,
  ConversationsResult,
  UnifiedMessage
} from '../types'
import {
  fetchOrganizations,
  fetchConversations,
  fetchConversationDetail,
  deleteConversation as apiDeleteConversation
} from './api'
import { toUnifiedConversation, extractMessages } from './adapter'

// Simple colored dot for Claude icon (SVG was rendering incorrectly)
const CLAUDE_ICON = '<span style="color:#D97757;font-size:18px;">●</span>'

export class ClaudePlatform implements PlatformAdapter {
  readonly name: PlatformType = 'claude'
  readonly displayName = 'Claude'
  readonly hostPatterns = ['claude.ai']
  readonly icon = CLAUDE_ICON
  readonly color = '#D97757'

  // Claude uses cookie auth, no token needed
  // But we store orgId for API calls
  private orgId: string | null = null
  private token: string | null = null // Kept for interface compatibility

  setToken(token: string): void {
    // For Claude, token is actually the orgId
    this.token = token
    this.orgId = token
  }

  getToken(): string | null {
    return this.orgId
  }

  private async ensureOrgId(): Promise<string> {
    if (this.orgId) {
      return this.orgId
    }

    // Fetch organizations to get orgId
    const orgs = await fetchOrganizations()
    if (!orgs || orgs.length === 0) {
      throw new Error('AUTH_REQUIRED: No organizations found')
    }

    this.orgId = orgs[0].uuid
    return this.orgId
  }

  async checkAuth(): Promise<AuthResult> {
    try {
      const orgs = await fetchOrganizations()
      if (orgs && orgs.length > 0) {
        this.orgId = orgs[0].uuid
        return { ok: true }
      }
      return {
        ok: false,
        error: 'AUTH_REQUIRED',
        message: 'Please log in to Claude first'
      }
    } catch (err) {
      const errorMsg = String(err)
      if (errorMsg.includes('AUTH_REQUIRED') || errorMsg.includes('401') || errorMsg.includes('403')) {
        return {
          ok: false,
          error: 'AUTH_REQUIRED',
          message: 'Please log in to Claude first'
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
    const orgId = await this.ensureOrgId()

    // Claude API returns all conversations at once (no pagination)
    const data = await fetchConversations(orgId)
    const allConversations = data.map(toUnifiedConversation)

    // Sort by update time (newest first)
    allConversations.sort((a, b) => b.updateTime - a.updateTime)

    // Apply offset and limit manually
    const paginatedConversations = allConversations.slice(offset, offset + limit)

    return {
      conversations: paginatedConversations,
      total: allConversations.length,
      hasMore: offset + limit < allConversations.length
    }
  }

  async getConversationDetail(id: string): Promise<UnifiedMessage[]> {
    const orgId = await this.ensureOrgId()
    const detail = await fetchConversationDetail(orgId, id)
    return extractMessages(detail)
  }

  async deleteConversation(id: string): Promise<boolean> {
    const orgId = await this.ensureOrgId()
    return apiDeleteConversation(orgId, id)
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

export const claudePlatform = new ClaudePlatform()
