# Changelog

All notable changes to AI Chat Manager are documented here.

## [2.0.0] - 2025-01-18

### Multi-Platform Architecture (Breaking Change)
- **NEW**: Support for Claude.ai alongside ChatGPT
- Extensible platform adapter pattern - add new platforms (e.g., Gemini) by creating a new directory and registering
- Unified data types for cross-platform conversation management

### Added
- `src/platforms/` directory with modular platform architecture
  - `types.ts`: Unified types (PlatformType, UnifiedConversation, UnifiedMessage, PlatformAdapter interface)
  - `registry.ts`: Platform discovery and routing
  - `chatgpt/`: ChatGPT platform implementation (api.ts, adapter.ts, index.ts)
  - `claude/`: Claude platform implementation (api.ts, adapter.ts, index.ts)
- Platform tabs in popup UI for switching between ChatGPT and Claude
- Claude.ai host permissions in manifest.json
- Dual-platform token extraction in content script

### Changed
- Renamed project from "ChatGPT Conversation Manager" to "AI Chat Manager"
- background.ts now uses platform registry instead of hardcoded ChatGPT API
- Cache keys now include platform prefix (`chatgpt_conversations`, `claude_conversations`)
- Tokens stored per-platform in session storage

### Technical Details
- Platform adapters implement `PlatformAdapter` interface
- ChatGPT uses Bearer token authentication
- Claude uses organization ID from cookies for authentication
- Real-time UI updates via chrome.storage.onChanged listener

## [1.2.0] - 2025-01-17

### Architecture Refactoring
- **BREAKING**: Migrated sync logic from popup to background service worker
- Sync now continues even when popup is closed
- Added `chrome.storage.onChanged` listener for real-time UI updates
- Implemented incremental cache saving (each batch saved immediately)

### Added
- `START_SYNC` message for triggering background sync
- `STOP_SYNC` message for canceling sync
- `GET_SYNC_STATUS` message for checking sync state
- 5-minute cache freshness check (skip sync if cache is recent)
- Auto-sync triggered when token is set

### Changed
- Popup now only handles UI rendering and user interactions
- Cache structure updated with `syncComplete` flag
- Improved error handling with typed errors

## [1.1.0] - 2025-01-17

### Added
- **Search functionality**: Real-time search/filter by title and content
- **Batch operations**: Select All checkbox, multi-select delete
- **Backup system**: Optional backup before delete, Backups tab
- **User preferences**: Remember backup preference setting
- **Cache system**: Local storage caching for instant popup display
- **Sync status bar**: Shows sync progress and last sync time

### Changed
- Removed Load More/Load All buttons in favor of auto-sync
- Improved error messages with actionable buttons
- Rate limit handling with countdown timer

## [1.0.0] - 2025-01-16

### Added
- Initial release
- Token extraction from ChatGPT session
- Conversation list display with dual-panel layout
- Conversation detail preview (last 3 messages)
- Single conversation delete with confirmation dialog
- Chrome Extension Manifest V3 support
- TypeScript + Webpack build system

---

## Project Overview

**AI Chat Manager** is a Chrome extension for managing conversations across multiple AI platforms (ChatGPT, Claude) directly from your browser toolbar.

### Supported Platforms

| Platform | Status | Authentication |
|----------|--------|----------------|
| ChatGPT  | ✅ Supported | Session token |
| Claude   | ✅ Supported | Organization cookie |
| Gemini   | 🔜 Planned | - |

### Features

| Feature | Description |
|---------|-------------|
| Multi-Platform | Manage ChatGPT and Claude in one place |
| View Conversations | Browse all your conversations |
| Search | Real-time filter by title or content |
| Preview | View last 3 messages without leaving the popup |
| Delete | Single or batch delete with confirmation |
| Backup | Optional backup before deletion |
| Sync | Background sync that survives popup close |
| Cache | Instant popup display with local caching |

### Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              background.ts (Service Worker)                  │
│  • Platform registry for multi-platform support             │
│  • API requests via platform adapters                       │
│  • Sync logic (startSync, stopSync) per platform            │
│  • Per-platform cache management (chrome.storage.local)     │
│  • Message handlers: START_SYNC, DELETE_CONVERSATION, etc.  │
└─────────────────────────────────────────────────────────────┘
                              ↕
                    chrome.runtime.sendMessage
                    chrome.storage.onChanged
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                   popup.ts (UI Layer)                        │
│  • Platform tabs for switching between ChatGPT/Claude       │
│  • Render conversation list and preview                     │
│  • Handle user interactions                                 │
│  • Listen to storage changes for real-time updates          │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                 content.ts (Content Script)                  │
│  • Detect current platform from hostname                    │
│  • Extract accessToken (ChatGPT) or orgId (Claude)          │
│  • Send credentials to background on page load              │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
chatgpt-manager/
├── src/
│   ├── platforms/              # Multi-platform support
│   │   ├── types.ts           # Unified types (PlatformAdapter, etc.)
│   │   ├── registry.ts        # Platform discovery and routing
│   │   ├── chatgpt/           # ChatGPT platform
│   │   │   ├── api.ts         # API calls
│   │   │   ├── adapter.ts     # Data transformation
│   │   │   └── index.ts       # ChatGPTPlatform class
│   │   └── claude/            # Claude platform
│   │       ├── api.ts         # API calls
│   │       ├── adapter.ts     # Data transformation
│   │       └── index.ts       # ClaudePlatform class
│   ├── utils/
│   │   └── logger.ts          # Logging utility
│   ├── popup/
│   │   ├── popup.html         # Popup HTML
│   │   ├── popup.css          # Styles with platform tabs
│   │   └── popup.ts           # UI logic with platform switching
│   ├── content/
│   │   └── content.ts         # Multi-platform token extraction
│   ├── background.ts          # Background service worker
│   ├── manifest.json          # Extension manifest (MV3)
│   ├── icons/                 # Extension icons (16/48/128px)
│   └── _locales/en/           # i18n messages
├── docs/
│   └── CLAUDE_API_RESEARCH.md # Claude API research notes
├── dist/                      # Build output (git ignored)
├── node_modules/              # Dependencies (git ignored)
├── package.json               # NPM configuration
├── tsconfig.json              # TypeScript configuration
├── webpack.config.js          # Webpack bundler config
├── CHANGELOG.md               # This file
└── README.md                  # Project documentation
```

### Technology Stack

- **Runtime**: Chrome Extension Manifest V3
- **Language**: TypeScript 5.3+
- **Bundler**: Webpack 5
- **Storage**: chrome.storage.local, chrome.storage.session
- **APIs**: ChatGPT Backend API, Claude API (unofficial)

### Build Commands

```bash
npm install          # Install dependencies
npm run build        # Production build
npm run dev          # Development build with watch
npm run clean        # Clean dist folder
```
