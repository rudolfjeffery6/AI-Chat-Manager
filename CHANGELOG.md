# Changelog

All notable changes to ChatGPT Conversation Manager are documented here.

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

**ChatGPT Conversation Manager** is a Chrome extension for managing ChatGPT conversations directly from your browser toolbar.

### Features

| Feature | Description |
|---------|-------------|
| View Conversations | Browse all your ChatGPT conversations |
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
│  • API requests to ChatGPT backend                          │
│  • Sync logic (startSync, stopSync)                         │
│  • Cache management (chrome.storage.local)                  │
│  • Message handlers: START_SYNC, DELETE_CONVERSATION, etc.  │
└─────────────────────────────────────────────────────────────┘
                              ↕
                    chrome.runtime.sendMessage
                    chrome.storage.onChanged
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                   popup.ts (UI Layer)                        │
│  • Render conversation list and preview                     │
│  • Handle user interactions                                 │
│  • Listen to storage changes for real-time updates          │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                 content.ts (Content Script)                  │
│  • Extract accessToken from ChatGPT session                 │
│  • Send token to background on page load                    │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
chatgpt-manager/
├── src/
│   ├── api/
│   │   └── chatgpt.ts          # ChatGPT API wrapper
│   ├── utils/
│   │   └── logger.ts           # Logging utility
│   ├── popup/
│   │   ├── popup.html          # Popup HTML
│   │   ├── popup.css           # Styles (~23KB)
│   │   └── popup.ts            # UI logic (~37KB)
│   ├── content/
│   │   └── content.ts          # Content script for token extraction
│   ├── background.ts           # Background service worker (~14KB)
│   ├── manifest.json           # Extension manifest (MV3)
│   ├── icons/                  # Extension icons (16/48/128px)
│   └── _locales/en/            # i18n messages
├── dist/                       # Build output (git ignored)
├── node_modules/               # Dependencies (git ignored)
├── package.json                # NPM configuration
├── tsconfig.json               # TypeScript configuration
├── webpack.config.js           # Webpack bundler config
├── CHANGELOG.md                # This file
└── README.md                   # Project documentation
```

### Technology Stack

- **Runtime**: Chrome Extension Manifest V3
- **Language**: TypeScript 5.3+
- **Bundler**: Webpack 5
- **Storage**: chrome.storage.local, chrome.storage.session
- **API**: ChatGPT Backend API (unofficial)

### Build Commands

```bash
npm install          # Install dependencies
npm run build        # Production build
npm run dev          # Development build with watch
npm run clean        # Clean dist folder
```
