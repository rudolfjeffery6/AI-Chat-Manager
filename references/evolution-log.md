# Evolution Log - ChatGPT Conversation Manager

## Project Timeline

**Start Date**: 2026-01-15
**V1 Complete**: 2026-01-16
**Total Duration**: ~2 days

---

## Sprint 0: Extension Foundation (COMPLETED)

### Features Delivered
- [x] TypeScript + Webpack build configuration
- [x] MV3 extension skeleton
- [x] Content script injection to ChatGPT
- [x] Popup ↔ Background communication
- [x] Background ↔ Content communication
- [x] Error visibility setup (logger utility)

### Key Decisions
- Used `chrome.storage.session` for token (session-scoped, not persisted)
- Used `chrome.storage.local` for conversation cache and backups
- Matched both `chatgpt.com` and `chat.openai.com` for content script

### Issues Encountered
- None significant - Sprint 0 went smoothly

---

## Sprint 1: Core API Integration (COMPLETED)

### Features Delivered
- [x] Token extraction from `__NEXT_DATA__`
- [x] Fetch conversation list API
- [x] Fetch conversation detail API
- [x] Delete conversation API
- [x] Delete confirmation dialog
- [x] Backup before delete (with checkbox)
- [x] View backups tab

### Key Decisions
- DELETE uses PATCH with `{is_visible: false}` (ChatGPT's soft delete)
- Backup stores full conversation with messages in `chrome.storage.local`
- Confirmation dialog is native HTML (no framework)

### Issues Encountered
| Issue | Root Cause | Resolution |
|-------|------------|------------|
| Delete button not clickable | Dialog z-index issue | Added proper z-index and display:flex |
| Preview not showing | Event handler not attached | Fixed event delegation |

---

## Sprint 1.5: UX Improvements (COMPLETED)

### Features Delivered
- [x] Multi-select batch delete
- [x] Conversation snippets in list
- [x] Cache-first loading (no loading flash)
- [x] Optimistic delete (instant UI update)
- [x] Sync status bar with refresh button
- [x] Two-column layout (list + preview side by side)

### Key Decisions
- Cache-first: Load from `chrome.storage.local` first, then silent refresh
- Optimistic delete: Update UI immediately, rollback on API failure
- Snippet extraction: Prefer last assistant message, fallback to user message

### Issues Encountered (CSS Layout - Main Pain Point)

| Issue | Root Cause | Resolution | Iterations |
|-------|------------|------------|------------|
| Delete button text cut off ("Delete(1") | Missing `box-sizing: border-box` | Added global reset | 1 |
| Preview at page bottom | Rendered after list in DOM | Restructured to two-column layout | 1 |
| Both columns can't scroll | `overflow: hidden` on parent containers | Changed to `overflow: visible` | 1 |
| Scrolling still broken | `#app` missing `flex: 1` and `min-height: 0` | Added #app flex styles | 1 |

**Total CSS layout iterations: 4**

### Lesson Learned: CSS Height Chain

The complete height chain must be established:
```
body (height: fixed)
└── #app (flex: 1, min-height: 0) ← THIS WAS MISSING
    └── #content (flex: 1, min-height: 0)
        └── .main-layout (flex: 1, min-height: 0)
            ├── .left-panel (flex: 1, min-height: 0)
            │   └── .conversation-list (overflow-y: auto) ← scrolls
            └── .right-panel (min-height: 0)
                └── .right-panel-content (overflow-y: auto) ← scrolls
```

---

## PRD Methodology Feedback

### What Worked Well

1. **Sprint 0 communication checks**: Caught MV3 messaging patterns early
2. **Feature-level granularity for APIs**: Each API = one feature = easy to verify
3. **Hard constraints in PRD**: "NEVER refresh page" kept focus sharp

### What Needs Improvement

1. **UI features too broad**: "Session Buddy Style List UI" should be split into:
   - Layout structure (height chain, flex containers)
   - List rendering (items, metadata)
   - Interactions (hover, selection)
   - Scrolling behavior

2. **Missing "Layout Foundation" feature**: Should be Sprint 2 Feature 0:
   ```json
   {
     "id": 0,
     "name": "Layout Foundation",
     "steps": [
       "Establish height chain from body to scrollable containers",
       "Set up two-column flex layout",
       "Verify both columns scroll independently",
       "Add flex-shrink: 0 to fixed-height elements"
     ]
   }
   ```

---

## Metrics

| Metric | Value |
|--------|-------|
| Total features | 12 (Sprint 0: 6, Sprint 1: 6) |
| Features passed | 11 |
| CSS layout issues | 4 |
| API integration issues | 0 |
| Communication issues | 0 |

---

## Future Improvements (Sprint 2 Candidates)

- [ ] Search and filter conversations
- [ ] Date range filter
- [ ] Load more messages in preview
- [ ] Export backup as JSON
- [ ] Chrome Web Store assets (icons, description)
- [ ] Keyboard shortcuts
