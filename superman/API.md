# Superman 记忆体 — Host API 契约（冻结版本 v1）

浏览器半只通过下面的两个路由和 Host 交互；`tools/superman-*-check.mjs` 用同一份契约做离线验证。
任何一侧改动都要同时改这里。

## 存储位置

- `config.root`（patch 里用 `!!js dshHomePath('superman')`，默认 `~/.dsh/superman`）
- `<root>/index.json` — 索引（items + notes + version）
- `<root>/files/<id>` — 原文件字节，`id` 为 16 位十六进制哈希

索引只经**临时文件 + 原子重命名**写入，且所有改动操作串行执行，进程中途死亡也不会留下
半个 `index.json`。Store 首次 `load()` 时会把索引和目录**对账一次**：文件不见了的条目删除、
没有任何条目引用的文件删除、两边都有则原样保留（绝不删掉条目还在引用的文件）；只有真的
改了东西才重写索引。

## `POST /api/superman/api`

请求体一律是 JSON，回复一律是 JSON：

```jsonc
// 成功
{ "ok": true, "value": { ... } }
// 失败（HTTP 400/404/500）
{ "ok": false, "error": { "code": "bad-request", "message": "..." } }
```

### action: `list`

```jsonc
{}                                    // 请求
{ "items": [Item], "notes": [Note], "stats": Stats, "root": "/Users/…/superman" }
```

### action: `store`

```jsonc
{
  "name": "报告.pdf",
  "mime": "application/pdf",          // 可选
  "base64": "JVBERi0…",               // 必填，文件字节
  "source": "chat",                   // 可选：chat | harness | superman，默认 superman
  "origin": "c-abc123",               // 可选：来源会话/条目 id
  "text": "已提取的正文…"              // 可选：调用方已提取的文本（PDF 等），用于回忆
}
{ "item": Item }
```

### action: `note`（对话与任务记录）

```jsonc
{ "note": { "id": "session:…", "kind": "task", "title": "…", "text": "…",
            "source": "harness", "sessionId": "…", "tags": ["…"] } }
{ "note": Note }                      // id 相同则覆盖（updatedAt 刷新）
```

### action: `get` / `delete`

```jsonc
{ "id": "…" }        ->  { "item": Item }        // get：带 text 预览
{ "id": "…" }        ->  { "deleted": true }     // delete：items 或 notes 都接受
```

### action: `recall`（回忆）

```jsonc
{ "q": "用户这一轮的问题", "limit": 6 }
{
  "digest": "【记忆体 Superman】…（可直接塞进提示词的文本）",
  "matches": [ { "id": "…", "kind": "item", "name": "…", "category": "pdf",
                 "score": 12.5, "snippet": "…命中附近 200 字…" } ]
}
```

## `GET /api/superman/file?id=<itemId>`

返回原始字节（`content-type` 取自条目，`content-disposition: inline`）。图片预览、PDF 下载都用它。

## 数据结构

```ts
type Category = 'pdf' | 'image' | 'code' | 'other'

interface Item {
  id: string
  name: string
  category: Category
  mime: string
  bytes: number
  addedAt: number
  source: 'chat' | 'harness' | 'superman'
  origin?: string
  detail?: string          // “12 页 · 1.2 MB”“1920×1080”之类
  hasText: boolean
  textLength: number
  width?: number
  height?: number
  pages?: number
  text?: string            // 仅 get 与 store 回复里带
}

interface Note {
  id: string
  kind: 'task' | 'conversation'
  title: string
  text: string
  source: string
  sessionId?: string
  createdAt: number
  updatedAt: number
  tags: string[]
}

interface Stats {
  total: number
  bytes: number
  notes: number
  categories: { pdf: number; image: number; code: number; other: number }
}
```

## 分类规则（`categorize`）

1. 魔术字节：`%PDF-` → pdf；PNG/JPEG/GIF/WEBP/BMP → image；`PK\x03\x04` → other（压缩包）；
   ELF/MZ → other。
2. MIME：`application/pdf` → pdf；`image/*` → image。
3. 扩展名：`pdf` → pdf；图片扩展名 → image；代码扩展名（含 `nb/wl/m/js/ts/py/…`）→ code。
4. 文本启发式：以 `#!` 开头，或包含 ≥3 个代码特征（注释、括号、分号、关键字）→ code。
5. 其余 → other。

## 浏览器半使用方式

```js
const response = await fetch('/api/superman/api', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'list' }),
})
const payload = await response.json()   // { ok: true, value } 或 { ok: false, error }
```

图片预览：`<img src={'/api/superman/file?id=' + item.id} />`
