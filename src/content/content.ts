/**
 * Content Script
 * Runs on ChatGPT and Claude pages to extract auth tokens
 */

import { logger } from '../utils/logger'
import { detectPlatformByHost } from '../platforms/registry'
import type { PlatformType } from '../platforms/types'

// Detect current platform
const currentPlatform = detectPlatformByHost(location.hostname)

logger.log(`Content script injected, platform: ${currentPlatform || 'unknown'}`)

/**
 * Get ChatGPT access token from session API
 */
async function getChatGPTToken(): Promise<string | null> {
  try {
    const response = await fetch('https://chatgpt.com/api/auth/session', {
      credentials: 'include'
    })
    if (response.ok) {
      const data = await response.json()
      return data.accessToken || null
    }
  } catch (err) {
    logger.warn('Failed to get ChatGPT token:', err)
  }
  return null
}

/**
 * Get Claude organization ID (used as "token")
 * Claude uses cookie auth, so we just need to verify we can access the API
 */
async function getClaudeOrgId(): Promise<string | null> {
  try {
    const response = await fetch('https://claude.ai/api/organizations', {
      credentials: 'include'
    })
    if (response.ok) {
      const orgs = await response.json()
      if (orgs && orgs.length > 0) {
        return orgs[0].uuid
      }
    }
  } catch (err) {
    logger.warn('Failed to get Claude org ID:', err)
  }
  return null
}

/**
 * Get token for current platform
 */
async function getToken(): Promise<{ platform: PlatformType; token: string } | null> {
  if (!currentPlatform) {
    return null
  }

  let token: string | null = null

  if (currentPlatform === 'chatgpt') {
    token = await getChatGPTToken()
  } else if (currentPlatform === 'claude') {
    token = await getClaudeOrgId()
  }

  if (token) {
    return { platform: currentPlatform, token }
  }
  return null
}

// Send token to background on load
if (currentPlatform) {
  getToken().then(result => {
    if (result) {
      logger.log(`[${result.platform}] Token acquired, sending to background`)
      chrome.runtime.sendMessage({
        type: 'SET_TOKEN',
        platform: result.platform,
        token: result.token
      })
    } else {
      logger.warn(`[${currentPlatform}] No token found`)
    }
  })
}

// Listen for messages from background/popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logger.log('Content received:', message)

  try {
    if (message.type === 'GET_PAGE_INFO') {
      sendResponse({
        url: location.href,
        title: document.title,
        platform: currentPlatform
      })
      return true
    }

    if (message.type === 'GET_TOKEN') {
      getToken().then(result => {
        if (result) {
          sendResponse({ platform: result.platform, token: result.token })
        } else {
          sendResponse({ error: 'No token available' })
        }
      })
      return true
    }

    if (message.type === 'GET_PLATFORM') {
      sendResponse({ platform: currentPlatform })
      return true
    }

  } catch (err) {
    logger.error('Error in content script:', err)
    sendResponse({ error: String(err) })
  }

  return true
})
