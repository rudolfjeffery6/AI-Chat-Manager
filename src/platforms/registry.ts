/**
 * Platform Registry
 * Central place to register and discover platform adapters
 */

import type { PlatformAdapter, PlatformConfig, PlatformType } from './types'
import { ChatGPTPlatform } from './chatgpt'
import { ClaudePlatform } from './claude'
// import { GeminiPlatform } from './gemini'  // Future: Gemini support

// Singleton platform instances
const platforms: PlatformAdapter[] = [
  new ChatGPTPlatform(),
  new ClaudePlatform(),
  // new GeminiPlatform(),  // Future: Gemini support
]

/**
 * Get platform adapter by name
 */
export function getPlatform(name: PlatformType): PlatformAdapter | undefined {
  return platforms.find(p => p.name === name)
}

/**
 * Detect platform by hostname
 * Used by content scripts to determine which platform the user is on
 */
export function detectPlatformByHost(hostname: string): PlatformType | null {
  for (const p of platforms) {
    if (p.hostPatterns.some(pattern => hostname.includes(pattern))) {
      return p.name
    }
  }
  return null
}

/**
 * Get all registered platforms (config only, not full adapter)
 */
export function getAllPlatforms(): PlatformConfig[] {
  return platforms.map(p => ({
    name: p.name,
    displayName: p.displayName,
    hostPatterns: p.hostPatterns,
    icon: p.icon,
    color: p.color
  }))
}

/**
 * Get all platform adapters
 */
export function getAllPlatformAdapters(): PlatformAdapter[] {
  return platforms
}

/**
 * Get default platform (first registered)
 */
export function getDefaultPlatform(): PlatformType {
  return platforms[0]?.name || 'chatgpt'
}

/**
 * Check if a platform is registered
 */
export function hasPlatform(name: PlatformType): boolean {
  return platforms.some(p => p.name === name)
}
