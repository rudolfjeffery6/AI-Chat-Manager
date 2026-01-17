const PREFIX = '[ChatGPT Manager]'

export const logger = {
  log: (...args: unknown[]) => {
    console.log(PREFIX, ...args)
  },
  warn: (...args: unknown[]) => {
    console.warn(PREFIX, ...args)
  },
  error: (...args: unknown[]) => {
    console.error(PREFIX, ...args)
  }
}
