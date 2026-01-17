# ChatGPT Conversation Manager

A Chrome extension for managing your ChatGPT conversations - view, search, delete, and backup all from your browser toolbar.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green?logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)

## Features

- 📋 **View Conversations** - Browse all your ChatGPT conversations in a clean dual-panel UI
- 🔍 **Search** - Real-time search by title or content
- 👁️ **Preview** - View conversation messages without leaving the popup
- 🗑️ **Delete** - Single or batch delete with confirmation dialog
- 💾 **Backup** - Optional backup before deletion
- 🔄 **Background Sync** - Sync continues even when popup is closed
- ⚡ **Instant Load** - Local caching for instant popup display

## Installation

### From Source (Developer Mode)

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ai-chat-manager.git
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

4. Open ChatGPT:
   - Go to [chatgpt.com](https://chatgpt.com) and log in
   - Click the extension icon in your toolbar

## Usage

1. **First Time Setup**: Open ChatGPT and log in. The extension will automatically acquire your session token.

2. **View Conversations**: Click the extension icon to see your conversation list.

3. **Search**: Type in the search box to filter conversations.

4. **Preview**: Click any conversation to see the last 3 messages.

5. **Delete**:
   - Single: Click the × button on any conversation
   - Batch: Check multiple conversations and click "Delete"
   - Optional: Enable "Backup before delete" to save a local copy

6. **Backups**: Switch to the "Backups" tab to view and restore deleted conversations.

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
├── api/chatgpt.ts      # ChatGPT API wrapper
├── background.ts       # Service worker (sync, cache)
├── content/content.ts  # Token extraction
├── popup/              # UI components
└── utils/logger.ts     # Logging utility
```

## Technical Details

- **Manifest V3**: Uses modern Chrome Extension architecture with Service Workers
- **Background Sync**: Sync logic runs in background, survives popup close
- **Cache Strategy**: 5-minute cache freshness, incremental batch saving
- **No External Services**: All data stays local, no third-party servers

## Privacy

This extension:
- ✅ Only accesses chatgpt.com and chat.openai.com
- ✅ Stores data locally in your browser
- ✅ Never sends data to external servers
- ✅ Uses your existing ChatGPT session (no password required)

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
- Uses ChatGPT's internal API (unofficial)
