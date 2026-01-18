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

// Official Claude logo SVG (Anthropic orange)
const CLAUDE_ICON = `<svg viewBox="0 0 24 24" fill="#D97757"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.163-2.809-.17-.087.26.186.236 1.552.924 1.621.966 1.147.058zm8.837-.788l-.078.092-.238 4.455-.157 2.946-.034.353h.318l.17-.207 1.138-1.778 1.772-2.768 1.168-1.844-.046-.092-.442.046-1.29.32-2.281.477zm2.562-4.315l.063.1 4.627.822 2.104.383.191-.168-.07-.262-1.03-1.421-1.071-1.49-1.04-1.47-.238.046-.46 1.479-.888 2.87.168-.27-.812-2.627-.524-1.658-.068.17.203.17 1.963 1.26 2.286 1.466-.032-.122-2.126-1.364-1.37-.88-.04.124.09.14zm-7.64 6.117l-.09-.088-3.31 3.06-1.036.957.17.192.27-.02 2.097-.575 2.098-.575 1.201-.576-.043-.128-.507-.068-1.07-.143.22.036zm9.473-11.937l-.18.052-.13.39.404 1.326.836 2.71.587 1.853.168-.012.148-.188.334-2.86.197-1.7-.078-.18-1.05-.624-1.236-.767zM6.82 5.27l.012.182.212.13 2.674.622 2.034.482.274-.318-.014-.1-.562-.384-1.522-1.04-1.72-1.19-.2.04-.514 1.088-.674 1.408v-.92zm4.2 5.216a1.143 1.143 0 10.002 2.286 1.143 1.143 0 00-.002-2.286z"/></svg>`

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
