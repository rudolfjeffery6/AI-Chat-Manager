# Development Preferences - ChatGPT Conversation Manager

## Project-Specific Learnings

### CSS Layout Rules (Critical)

1. **Always set up height chain FIRST**
   ```css
   /* MUST have complete chain from root to scrollable container */
   html, body { height: 100%; overflow: hidden; }
   #app { flex: 1; min-height: 0; display: flex; flex-direction: column; }
   #content { flex: 1; min-height: 0; }
   .scrollable-area { flex: 1; min-height: 0; overflow-y: auto; }
   ```

2. **Flex children need `min-height: 0` to enable scrolling**
   - Default `min-height: auto` prevents shrinking below content size
   - Without it, `overflow-y: auto` is useless

3. **Avoid `overflow: hidden` on ancestor containers**
   - Use `overflow: visible` or just omit it
   - Only the actual scrollable element should have `overflow-y: auto`

4. **Fixed-height elements need `flex-shrink: 0`**
   - Headers, tabs, action bars should not be compressed
   - Apply to: h1, .tabs, .sync-bar, .batch-actions, .panel-header

### Chrome Extension MV3 Patterns

1. **Token extraction from ChatGPT**
   ```typescript
   // Content script - extract from __NEXT_DATA__
   const nextData = document.getElementById('__NEXT_DATA__')
   const data = JSON.parse(nextData?.textContent || '{}')
   const token = data?.props?.pageProps?.accessToken
   ```

2. **Message passing pattern**
   ```typescript
   // Popup -> Background
   chrome.runtime.sendMessage({ type: 'ACTION', data })

   // Background -> Content (needs tab query first)
   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
   chrome.tabs.sendMessage(tab.id, { type: 'ACTION' })
   ```

3. **Cache-first loading strategy**
   ```typescript
   const hasCache = await loadFromStorage()
   if (hasCache) {
     renderImmediately(cachedData)
     silentRefreshInBackground()
   } else {
     showLoading()
     await fetchAndRender()
   }
   ```

### UI/UX Patterns

1. **Optimistic updates for delete**
   - Update UI immediately
   - Call API in background
   - Rollback on failure

2. **Two-column layout structure**
   ```html
   <div class="main-layout">
     <div class="left-panel">
       <div class="fixed-header">...</div>
       <div class="scrollable-list">...</div>
     </div>
     <div class="right-panel">
       <div class="panel-header">...</div>
       <div class="panel-content">...</div>
     </div>
   </div>
   ```

## Anti-Patterns to Avoid

1. **DON'T use `overflow: hidden` on flex containers** unless you specifically want to clip content
2. **DON'T forget `min-height: 0`** on any flex child that should scroll
3. **DON'T skip Sprint 0** communication checks - they catch MV3 issues early
4. **DON'T make UI features too broad** - split layout from content rendering

## Build & Test Commands

```bash
npm run build    # Production build
npm run dev      # Watch mode
npm run clean    # Clear dist/
```

## File Structure

```
src/
├── manifest.json       # MV3 manifest
├── background.ts       # Service worker, API calls
├── content/
│   └── content.ts      # Token extraction
├── popup/
│   ├── popup.html
│   ├── popup.ts        # UI logic
│   └── popup.css       # Styles
├── api/
│   └── chatgpt.ts      # API functions
└── utils/
    └── logger.ts       # Logging utility
```
