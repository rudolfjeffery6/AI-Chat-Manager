# Claude.ai API 调研报告

> **注意**: 由于 Claude.ai 使用 Cloudflare Turnstile 防护，无法通过自动化浏览器直接访问。以下信息基于公开资料和已知的 API 结构整理。

## 1. 概述

Claude.ai 是 Anthropic 提供的 AI 聊天界面，使用 RESTful API 与后端通信。

### 基础信息

| 项目 | 值 |
|------|-----|
| Base URL | `https://claude.ai/api` |
| 认证方式 | Session Cookie |
| 主要 Cookie | `sessionKey` |
| 防护机制 | Cloudflare Turnstile |

## 2. 认证方式

### 与 ChatGPT 的区别

| 特性 | ChatGPT | Claude.ai |
|------|---------|-----------|
| 认证方式 | Bearer Token (accessToken) | Session Cookie |
| Token 获取 | `/api/auth/session` | 登录时自动设置 |
| Token 位置 | Authorization Header | Cookie Header |
| Token 有效期 | ~1小时 | 较长（会话级） |

### Cookie 结构

```
sessionKey=sk-ant-sid01-xxxxx;
__cf_bm=xxxxx;  // Cloudflare Bot Management
```

## 3. API 端点

### 3.1 获取组织信息

首先需要获取用户的组织 ID（organization_id）。

```
GET /api/organizations
```

**Response:**
```typescript
interface Organization {
  uuid: string           // 组织 UUID，用于后续 API 调用
  name: string
  settings: {
    claude_console_privacy: string
  }
  capabilities: string[]
  join_token: string
  created_at: string
  updated_at: string
  active_flags: string[]
}

type OrganizationsResponse = Organization[]
```

### 3.2 获取对话列表

```
GET /api/organizations/{organization_id}/chat_conversations
```

**Query Parameters:**
- 无必需参数（返回所有对话）

**Response:**
```typescript
interface ClaudeConversation {
  uuid: string              // 对话 UUID
  name: string              // 对话标题
  summary: string           // 对话摘要
  model: string | null      // 使用的模型
  created_at: string        // ISO 8601 格式
  updated_at: string        // ISO 8601 格式
  settings: {
    preview_feature_uses_artifacts: boolean
    preview_feature_uses_latex: boolean
    preview_feature_uses_citations: boolean
    enabled_artifacts_attachments: boolean
  }
  is_starred: boolean       // 是否收藏
  project_uuid: string | null
  current_leaf_message_uuid: string | null
}

type ConversationsResponse = ClaudeConversation[]
```

### 3.3 获取对话详情

```
GET /api/organizations/{organization_id}/chat_conversations/{conversation_uuid}
```

**Response:**
```typescript
interface ClaudeMessage {
  uuid: string
  text: string
  sender: 'human' | 'assistant'
  index: number
  created_at: string
  updated_at: string
  attachments: Attachment[]
  files: File[]
  content: ContentBlock[]   // 结构化内容
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  // ... 其他字段取决于类型
}

interface ConversationDetail {
  uuid: string
  name: string
  summary: string
  model: string | null
  created_at: string
  updated_at: string
  chat_messages: ClaudeMessage[]
  // ... 其他元数据
}
```

### 3.4 删除对话

```
DELETE /api/organizations/{organization_id}/chat_conversations/{conversation_uuid}
```

**Response:** `204 No Content`

### 3.5 重命名对话

```
PUT /api/organizations/{organization_id}/chat_conversations/{conversation_uuid}
```

**Request Body:**
```json
{
  "name": "新标题"
}
```

## 4. 与 ChatGPT API 对比

| 功能 | ChatGPT API | Claude.ai API |
|------|-------------|---------------|
| **Base URL** | `chatgpt.com/backend-api` | `claude.ai/api` |
| **对话列表** | `/conversations?offset=&limit=` | `/organizations/{id}/chat_conversations` |
| **对话详情** | `/conversation/{id}` | `/organizations/{id}/chat_conversations/{id}` |
| **删除对话** | `PATCH /conversation/{id}` + `{is_visible: false}` | `DELETE /chat_conversations/{id}` |
| **认证** | Bearer Token | Session Cookie |
| **分页** | offset + limit 参数 | 一次返回全部 |
| **消息结构** | mapping (树状) | chat_messages (数组) |
| **组织概念** | 无 | 有 (organization_id) |

### 主要差异

1. **组织层级**: Claude 有 organization 概念，API 路径中需要包含 `organization_id`

2. **消息结构**:
   - ChatGPT 使用 `mapping` 树状结构存储对话
   - Claude 使用 `chat_messages` 数组，更简单直接

3. **认证方式**:
   - ChatGPT: 从 `/api/auth/session` 获取 accessToken，放在 Authorization header
   - Claude: 使用 sessionKey cookie，需要从已登录的浏览器会话中提取

4. **删除机制**:
   - ChatGPT: 软删除（设置 is_visible = false）
   - Claude: 硬删除（DELETE 方法）

5. **防护机制**:
   - ChatGPT: 相对宽松
   - Claude: Cloudflare Turnstile，更严格的反自动化

## 5. 实现建议

### Content Script 修改

```typescript
// content/content.ts - 需要支持 claude.ai
const CLAUDE_DOMAINS = ['claude.ai']
const CHATGPT_DOMAINS = ['chatgpt.com', 'chat.openai.com']

function detectPlatform(): 'claude' | 'chatgpt' | null {
  const host = location.hostname
  if (CLAUDE_DOMAINS.some(d => host.includes(d))) return 'claude'
  if (CHATGPT_DOMAINS.some(d => host.includes(d))) return 'chatgpt'
  return null
}

// Claude 的 token 获取方式不同
async function getClaudeSession(): Promise<string | null> {
  // Claude 使用 cookie 认证，不需要单独获取 token
  // 只需要确保请求时携带 cookie
  try {
    const response = await fetch('https://claude.ai/api/organizations', {
      credentials: 'include'
    })
    if (response.ok) {
      const orgs = await response.json()
      return orgs[0]?.uuid || null  // 返回组织 ID
    }
  } catch (err) {
    console.error('Failed to get Claude session:', err)
  }
  return null
}
```

### API 模块

```typescript
// api/claude.ts
const CLAUDE_API_BASE = 'https://claude.ai/api'

export interface ClaudeConversation {
  uuid: string
  name: string
  summary: string
  created_at: string
  updated_at: string
  is_starred: boolean
}

export interface ClaudeMessage {
  uuid: string
  text: string
  sender: 'human' | 'assistant'
  created_at: string
}

export interface ClaudeConversationDetail {
  uuid: string
  name: string
  chat_messages: ClaudeMessage[]
}

export async function getOrganizations(): Promise<{ uuid: string }[]> {
  const response = await fetch(`${CLAUDE_API_BASE}/organizations`, {
    credentials: 'include'
  })
  if (!response.ok) throw new Error(`API error: ${response.status}`)
  return response.json()
}

export async function getConversations(
  orgId: string
): Promise<ClaudeConversation[]> {
  const response = await fetch(
    `${CLAUDE_API_BASE}/organizations/${orgId}/chat_conversations`,
    { credentials: 'include' }
  )
  if (!response.ok) throw new Error(`API error: ${response.status}`)
  return response.json()
}

export async function getConversation(
  orgId: string,
  conversationId: string
): Promise<ClaudeConversationDetail> {
  const response = await fetch(
    `${CLAUDE_API_BASE}/organizations/${orgId}/chat_conversations/${conversationId}`,
    { credentials: 'include' }
  )
  if (!response.ok) throw new Error(`API error: ${response.status}`)
  return response.json()
}

export async function deleteConversation(
  orgId: string,
  conversationId: string
): Promise<boolean> {
  const response = await fetch(
    `${CLAUDE_API_BASE}/organizations/${orgId}/chat_conversations/${conversationId}`,
    {
      method: 'DELETE',
      credentials: 'include'
    }
  )
  return response.ok
}
```

### Manifest 修改

```json
{
  "content_scripts": [
    {
      "matches": [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://claude.ai/*"
      ],
      "js": ["content/content.js"],
      "run_at": "document_idle"
    }
  ],
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*"
  ]
}
```

## 6. 注意事项

1. **Cloudflare 防护**: Claude.ai 使用 Cloudflare Turnstile，自动化访问可能被阻止

2. **Cookie 依赖**: 必须在已登录的浏览器中使用，扩展需要在 claude.ai 页面注入 content script

3. **Organization ID**: 每次请求都需要 organization_id，建议缓存

4. **API 变更风险**: 这是非官方 API，可能随时变更

## 7. 下一步

1. 更新 `manifest.json` 添加 claude.ai 权限
2. 创建 `api/claude.ts` 模块
3. 修改 `content/content.ts` 支持双平台
4. 更新 UI 显示平台标识
5. 统一对话数据结构（适配器模式）
