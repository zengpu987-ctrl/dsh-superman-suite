# Superman OCR — Host API 契约（冻结版本 v1）

浏览器半（`chat-mode/client.js` 的 PDF 读取器、记忆体面板）只通过下面这一个路由与本插件交互；
`tools/superman-ocr-check.mjs` 用同一份契约做离线验证。任何一侧改动都要同时改这里。

## 引擎与工作目录

- 引擎：`tools/ocr-pdf.swift`（PDFKit 渲染 + Vision 识别，简体中文 + 英文，`.accurate`）。
- 工作目录：`config.workDir`（patch 里用 `!!js dshHomePath('superman-ocr')`）。
  - `<workDir>/ocr-pdf` — **首次使用时**用 `swiftc` 编译出的二进制，之后一直复用（同一进程内只编译一次，
    并发的调用共用同一个 Promise；新进程若发现它比源码新，直接复用，不再编译）。
  - `<workDir>/ocr-<uuid>.pdf` — 每次 `ocr` 调用写入的临时文件，调用结束（成功或失败）一律删除。
  - `<workDir>/clang-cache/` — clang 模块缓存，让受限沙箱里也能编译。

## `POST /api/superman-ocr/api`

请求体一律是 JSON，回复一律是 JSON：

```jsonc
// 成功
{ "ok": true, "value": { ... } }
// 失败（HTTP 400/413/499/500/502/504）
{ "ok": false, "error": { "code": "bad-request", "message": "..." } }
```

### action: `health`

```jsonc
{}                                     // 请求
{ "ready": true,                       // 现在就能跑吗（bin 存在且可执行）
  "bin": "/Users/…/superman-ocr/ocr-pdf",
  "compiled": true,                    // 本进程是否真的跑过 swiftc（复用缓存/用 config.bin 时为 false）
  "version": "ocr-pdf 1.0.0" }         // 编译好的工具自报的版本，未编译时为源码版本
```

- `config.bin` 非空时：`bin` 就是它，**永不编译**，`compiled` 恒为 `false`。
- `config.bin` 为空且没有已编译的二进制时：`ready: false`、`bin: ""`、`compiled: false`。
- 新进程发现 `<workDir>/ocr-pdf` 比源码新时直接复用：`ready: true`、`compiled: false`。
- `compiled` 是"本进程编译过"的标记，不是"磁盘上有二进制"；想知道后者看 `ready`。

### action: `ocr`

```jsonc
{
  "base64": "JVBERi0…",   // 必填：PDF 字节（base64）
  "name": "扫描件.pdf",    // 可选：仅用于日志/诊断
  "maxPages": 8           // 可选：本次最多识别多少页，默认取 config.maxPages
}
{
  "text": "## page 1\n识别出的正文…",   // 识别结果，保留 `## page N` 分页标记，最多 400000 字符
  "pages": 8,                           // 识别到的 `## page N` 标记数
  "characters": 128390                  // 截断前的完整字符数（可能与 text.length 不同）
}
```

- 页数上限：`maxPages` 先四舍五入，再夹到 `[1, 200]`（`1` 是下限，`200` 是硬上限）；
  请求不带时取 `config.maxPages`（默认 40）。
- `name` 只是诊断信息，不参与识别。
- 请求被 `AbortSignal` 取消时返回 `aborted`，引擎进程一并结束。

### 错误码

| code | HTTP | 含义 |
|---|---|---|
| `bad-request` | 400 | 未知 action、缺 `base64`、空 payload、不是 PDF（魔术字节不是 `%PDF-`） |
| `body` | 400 | 请求体不是 JSON |
| `too-large` | 413 | payload 超过 32 MiB（含 base64 长度预检） |
| `aborted` | 499 | 调用方取消了请求 |
| `compile-failed` | 500 | `swiftc` 失败/超时/没产出文件，或源码不存在；message 带 stderr 尾部 |
| `ocr-failed` | 502 | 引擎非零退出或无法启动；message 带 stderr 尾部 |
| `ocr-timeout` | 504 | 引擎超过 `config.timeoutMs` 未结束 |

### 限额（`LIMITS` 导出，供调用方与离线检查共用）

```ts
interface Limits {
  routePath: '/api/superman-ocr/api'
  defaultMaxPages: 40      // config.maxPages 缺席时的页数预算
  hardMaxPages: 200        // 单次识别的硬上限
  defaultTimeoutMs: 600000 // 单次识别的默认墙钟预算
  defaultScale: 2          // 渲染倍数（设备像素 / PDF 点），accepts 0.5–6
  maxPdfBytes: 33554432    // 32 MiB
  maxBase64Chars: 44739260 // base64 形式的长度预检上限
  maxTextChars: 400000     // text 字段的回传上限
}
```

## 浏览器半使用方式

`chat-mode/client.js` 的 `extractPdfText` 返回 `{ text: '', note: 'no-text', pages }`（扫描件、文字转曲）时，
把同一份字节交给本路由：

```js
const health = await fetch('/api/superman-ocr/api', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'health' }),
}).then((response) => response.json())
if (health.ok && health.value.ready) {
  const answer = await fetch('/api/superman-ocr/api', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'ocr', base64, name: file.name, maxPages: 40 }),
    signal,                       // 用户换文件/离开页面时取消
  }).then((response) => response.json())
  if (answer.ok) use(answer.value.text)   // answer.value.pages / characters 可用于进度提示
}
```

## 引擎输出格式（`tools/ocr-pdf.swift`）

```
## page 1
第一行识别结果
第二行识别结果
## page 2
…
```

- 每页一个 `## page N` 标记，`N` 从 1 开始；随后是该页按阅读顺序（自上而下、自左向右）的文本行。
- 每识别完一页就立刻写 stdout 并 flush，所以即使调用方按超时把进程杀掉，已经识别完的页也留在 stdout 里。
- 打不开文件、加密、或没有任何一页渲染成功时：stderr 打印 `ocr-pdf: …`，退出码非 0。
- 其他参数：`--max-pages N`（默认 40，硬上限 200）、`--scale S`（默认 2，夹在 0.5–6）、
  `--progress`（每页往 stderr 打一行进度，不影响 stdout）、`--version`、`--help`。
