import { logger } from '../utils/logger'

logger.log('Content script injected into ChatGPT')

async function getAccessToken(): Promise<string | null> {
  try {
    // Method 1: Try to get from session API
    const response = await fetch('https://chatgpt.com/api/auth/session', {
      credentials: 'include'
    })
    if (response.ok) {
      const data = await response.json()
      if (data.accessToken) {
        return data.accessToken
      }
    }
  } catch (err) {
    logger.warn('Failed to get token from session API:', err)
  }

  return null
}

// Send token to background on load
getAccessToken().then(token => {
  if (token) {
    logger.log('Token acquired, sending to background')
    chrome.runtime.sendMessage({ type: 'SET_TOKEN', token })
  } else {
    logger.warn('No token found')
  }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logger.log('Content received:', message)

  try {
    if (message.type === 'GET_PAGE_INFO') {
      sendResponse({
        url: location.href,
        title: document.title
      })
      return true
    }

    if (message.type === 'GET_TOKEN') {
      getAccessToken().then(token => {
        sendResponse({ token })
      })
      return true
    }
  } catch (err) {
    logger.error('Error in content script:', err)
    sendResponse({ error: String(err) })
  }

  return true
})
