# AI Chat Manager

A Chrome extension for managing your AI conversations across multiple platforms - ChatGPT, Claude, and more. View, search, delete, and backup all from your browser toolbar.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green?logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)
![Version](https://img.shields.io/badge/version-2.0.0-orange)

## Screenshots

<!-- Screenshots will be added here -->
| ChatGPT | Claude |
|---------|--------|
| *Coming soon* | *Coming soon* |

## Supported Platforms

| Platform | Status | Authentication |
|----------|--------|----------------|
| ChatGPT  | ✅ Supported | Session token |
| Claude   | ✅ Supported | Organization cookie |
| Gemini   | 🔜 Planned | - |

## Features

- 🌐 **Multi-Platform** - Manage ChatGPT and Claude conversations in one place
- 📋 **View Conversations** - Browse all your conversations in a clean dual-panel UI
- 🔍 **Search** - Real-time search by title or content
- 👁️ **Preview** - View conversation messages with 24-hour cache optimization
- 🗑️ **Delete** - Single or batch delete with confirmation dialog
- 💾 **Backup** - Optional backup before deletion
- 🔄 **Background Sync** - Sync continues even when popup is closed
- ⚡ **Instant Load** - Local caching for instant popup display
- 🔀 **Platform Tabs** - Quick switch between ChatGPT and Claude

## Installation

### From Source (Developer Mode)

1. Clone the repository:
   ```bash
   git clone https://github.com/rudolfjeffery6/ai-chat-manager.git
   cd ai-chat-manager
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `dist` folder

4. Open a supported platform:
   - Go to [chatgpt.com](https://chatgpt.com) or [claude.ai](https://claude.ai) and log in
   - Click the extension icon in your toolbar

## Usage

1. **First Time Setup**: Open ChatGPT or Claude and log in. The extension will automatically acquire your session credentials.

2. **Switch Platforms**: Use the platform tabs at the top to switch between ChatGPT and Claude.

3. **View Conversations**: Click the extension icon to see your conversation list for the selected platform.

4. **Search**: Type in the search box to filter conversations.

5. **Preview**: Click any conversation to see the message preview (cached for 24 hours).

6. **Delete**:
   - Single: Click the × button on any conversation
   - Batch: Check multiple conversations and click "Delete"
   - Optional: Enable "Backup before delete" to save a local copy

7. **Backups**: Switch to the "Backups" tab to view and restore deleted conversations.

## Screenshots

| Conversation List | Preview Panel |
|------------------|---------------|
| Dual-panel layout with search and batch operations | Message preview with delete action |

## Development

```bash
# Install dependencies
npm install

# Development build with watch
npm run dev

# Production build
npm run build

# Clean build output
npm run clean
```

### Project Structure

```
src/
├── platforms/              # Multi-platform support
│   ├── types.ts           # Unified types (PlatformAdapter, UnifiedConversation)
│   ├── registry.ts        # Platform discovery and routing
│   ├── chatgpt/           # ChatGPT implementation
│   │   ├── api.ts         # API calls
│   │   ├── adapter.ts     # Data transformation
│   │   └── index.ts       # Platform class
│   └── claude/            # Claude implementation
│       ├── api.ts         # API calls
│       ├── adapter.ts     # Data transformation
│       └── index.ts       # Platform class
├── background.ts          # Service worker (sync, cache, registry)
├── content/content.ts     # Multi-platform token extraction
├── popup/                 # UI components with platform tabs
└── utils/logger.ts        # Logging utility
```

## Technical Details

- **Multi-Platform Architecture**: Extensible platform adapter pattern
- **Manifest V3**: Modern Chrome Extension with Service Workers
- **Background Sync**: Sync logic runs in background, survives popup close
- **Cache Strategy**: Per-platform caching with 5-minute freshness check
- **Preview Cache**: 24-hour validity for message previews
- **No External Services**: All data stays local, no third-party servers

### Adding New Platforms

To add a new platform (e.g., Gemini):

1. Create `src/platforms/gemini/` with `api.ts`, `adapter.ts`, `index.ts`
2. Implement the `PlatformAdapter` interface
3. Register in `src/platforms/registry.ts`
4. Add host permissions in `manifest.json`

## Privacy

This extension:
- ✅ Only accesses chatgpt.com, chat.openai.com, and claude.ai
- ✅ Stores data locally in your browser
- ✅ Never sends data to external servers
- ✅ Uses your existing sessions (no password required)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Acknowledgments

- Built with TypeScript and Webpack
- Uses ChatGPT and Claude internal APIs (unofficial)
- Claude icon from [Bootstrap Icons](https://icons.getbootstrap.com/icons/claude/)
