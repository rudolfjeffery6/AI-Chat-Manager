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

// Official Claude logo SVG from Bootstrap Icons
const CLAUDE_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/></svg>`

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
