/**
 * Standardized Error Codes and Messages
 */

export enum ErrorCode {
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  NO_TAB = 'NO_TAB',
  INJECT_FAILED = 'INJECT_FAILED',
  API_CHANGED = 'API_CHANGED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  TIMEOUT = 'TIMEOUT'
}

export interface ErrorInfo {
  title: string
  suggestion: string
}

export const ErrorMessages: Record<ErrorCode, ErrorInfo> = {
  [ErrorCode.AUTH_REQUIRED]: {
    title: 'Authentication Required',
    suggestion: 'Please open ChatGPT/Claude and log in'
  },
  [ErrorCode.NO_TAB]: {
    title: 'Platform Tab Not Found',
    suggestion: 'Please open ChatGPT or Claude in a browser tab'
  },
  [ErrorCode.INJECT_FAILED]: {
    title: 'Script Injection Failed',
    suggestion: 'Try refreshing the ChatGPT/Claude page'
  },
  [ErrorCode.API_CHANGED]: {
    title: 'API Structure Changed',
    suggestion: 'Please check for extension updates'
  },
  [ErrorCode.NETWORK_ERROR]: {
    title: 'Network Error',
    suggestion: 'Please check your internet connection and try again'
  },
  [ErrorCode.RATE_LIMITED]: {
    title: 'Rate Limited',
    suggestion: 'Too many requests. Please wait a moment and try again'
  },
  [ErrorCode.TIMEOUT]: {
    title: 'Request Timeout',
    suggestion: 'The request took too long. Please try again'
  }
}

export function getErrorInfo(code: ErrorCode): ErrorInfo {
  return ErrorMessages[code] || {
    title: 'Unknown Error',
    suggestion: 'Please try again or restart the extension'
  }
}

export function isErrorCode(value: string): value is ErrorCode {
  return Object.values(ErrorCode).includes(value as ErrorCode)
}
