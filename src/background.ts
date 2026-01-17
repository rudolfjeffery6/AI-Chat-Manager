import { logger } from './utils/logger'
import { getConversations, getConversation, deleteConversation } from './api/chatgpt'

logger.log('background loaded')

let accessToken: string | null = null

async function getToken(): Promise<string | null> {
  if (accessToken) return accessToken

  return new Promise((resolve) => {
    chrome.storage.session.get(['accessToken'], (result) => {
      const token = result.accessToken as string | undefined
      if (token) {
        accessToken = token
        resolve(token)
      } else {
        resolve(null)
      }
    })
  })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logger.log('Background received:', message)

  try {
    if (message.type === 'PING') {
      sendResponse({ type: 'PONG', time: Date.now() })
      return true
    }

    if (message.type === 'SET_TOKEN') {
      accessToken = message.token
      chrome.storage.session.set({ accessToken: message.token })
      logger.log('Token stored')
      sendResponse({ success: true })
      return true
    }

    if (message.type === 'GET_TOKEN_STATUS') {
      getToken().then(token => {
        if (token) {
          sendResponse({ hasToken: true, tokenPreview: token.substring(0, 20) + '...' })
        } else {
          sendResponse({ hasToken: false })
        }
      })
      return true
    }

    if (message.type === 'GET_CONVERSATIONS') {
      getToken().then(async token => {
        if (!token) {
          sendResponse({ error: 'No token available' })
          return
        }
        try {
          const data = await getConversations(token, message.offset || 0, message.limit || 28)
          sendResponse({ data })
        } catch (err) {
          logger.error('Failed to fetch conversations:', err)
          sendResponse({ error: String(err) })
        }
      })
      return true
    }

    if (message.type === 'GET_CONVERSATION_DETAIL') {
      getToken().then(async token => {
        if (!token) {
          sendResponse({ error: 'No token available' })
          return
        }
        try {
          const data = await getConversation(token, message.conversationId)
          sendResponse({ data })
        } catch (err) {
          logger.error('Failed to fetch conversation:', err)
          sendResponse({ error: String(err) })
        }
      })
      return true
    }

    if (message.type === 'BACKUP_CONVERSATION') {
      getToken().then(async token => {
        if (!token) {
          sendResponse({ error: 'No token available' })
          return
        }
        try {
          const data = await getConversation(token, message.conversationId)
          const backup = {
            id: message.conversationId,
            title: data.title,
            messages: data.messages,
            backupTime: Date.now()
          }
          await chrome.storage.local.set({ [`backup_${message.conversationId}`]: backup })
          sendResponse({ success: true })
        } catch (err) {
          logger.error('Failed to backup conversation:', err)
          sendResponse({ error: String(err) })
        }
      })
      return true
    }

    if (message.type === 'GET_BACKUPS') {
      chrome.storage.local.get(null, (items) => {
        const backups = Object.entries(items)
          .filter(([key]) => key.startsWith('backup_'))
          .map(([, value]) => value)
          .sort((a: any, b: any) => b.backupTime - a.backupTime)
        sendResponse({ backups })
      })
      return true
    }

    if (message.type === 'DELETE_BACKUP') {
      chrome.storage.local.remove(`backup_${message.conversationId}`, () => {
        sendResponse({ success: true })
      })
      return true
    }

    if (message.type === 'DELETE_CONVERSATION') {
      getToken().then(async token => {
        if (!token) {
          sendResponse({ error: 'No token available' })
          return
        }
        try {
          await deleteConversation(token, message.conversationId)
          sendResponse({ success: true })
        } catch (err) {
          logger.error('Failed to delete conversation:', err)
          sendResponse({ error: String(err) })
        }
      })
      return true
    }

    if (message.type === 'GET_PAGE_INFO') {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs[0]
        if (!tab?.id) {
          sendResponse({ error: 'No active tab found' })
          return
        }
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' })
          sendResponse(response)
        } catch (err) {
          sendResponse({ error: 'Content script not available' })
        }
      })
      return true
    }

    if (message.type === 'TEST_ERROR') {
      throw new Error('Test error')
    }
  } catch (err) {
    logger.error('Error in message handler:', err)
    sendResponse({ error: String(err) })
  }

  return true
})
