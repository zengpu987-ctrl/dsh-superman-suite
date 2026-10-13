# 架构 / Architecture

> 本文件描述 Superman 套件的整体架构与每个子系统的关键设计。
> *This file describes the suite's architecture and the key design decisions of each
> subsystem. Numbers cited here are measured; the full evaluation lives in the papers.*

## 中文

### 1. 为什么是插件而不是补丁

DeepSeek Harness（DSH）把界面与能力都拆成可组合的插件行（bundle → cordis.patch.yml →
插件模块），运行在一个 *profile* 里。套件严格遵守三条约束：

1. **不替换随包 UI**：只往槽位里**新增**条目（`sidebar.panellist`、`main`、`settings.section`、
   `shell.overlay`），已占用的 id 一律不动。
2. **不新开监听端口**：Host 半只注册已鉴权 `/api` 通道上的精确 Fetch 路由，
   因此继承官方的 Host/Origin 信任栅栏与浏览器会话凭证。
3. **不 import 其他 Harness Client 包**：浏览器半只 `require('react')`，
   颜色只用主题 token，文案走 `ctx.locale`（中英双份，键集一致）。

代价是要自己实现 PDF 阅读器、公式渲染器与编码探测器 —— 这也是论文的主要贡献之一。

### 2. 拓扑

```
浏览器
 ├─ Chat 面板      main[chat]                ← 会话记录(localStorage) + 合成器
 ├─ 记忆体面板    main[superman]            ← 分类文件夹 + 预览 + 上传
 ├─ arXiv 小节    settings.section[arxiv]   ← 检索 + 收藏按钮
 └─ 提示卡        shell.overlay[superman.toast]
        │ 同源 fetch（已鉴权 /api）
Host
 ├─ POST /api/chat-mode/stream    → ctx.llm.stream(...) → SSE 帧
 ├─ POST /api/superman/api        → store/list/get/delete/note/recall
 ├─ GET  /api/superman/file?id=   → 原始字节
 ├─ systemPrompt.section()        → 每轮重算的记忆体摘要
 └─ session/event 监听            → 捕获 Harness 上传 + 轮次记录
```

### 3. 关键机制

**槽位注入。** `ctx.slots.inject(key, cb)` + `ctx.slots.register(options, component)`；
回调的注册随声明销毁、随声明回归而重装。面板组件拿到 `t`（本地化翻译器）与
`inject()` 返回的属性；`hooks: {store}` 会被渲染层转成 `useStore(selector)` 选择器 Hook。

**流式与取消。** Chat 的 Host 路由把模型流写成 `text/event-stream`：`text-delta` →
`{type:'text'}`、`reasoning-delta` → `{type:'reasoning'}`、`usage` 与 `finish` 各自成帧；
页面用 `fetch` + `getReader()` 按 `\n\n` 重组。请求被中止时 `request.signal` 会传进
`ctx.llm.stream`，provider 调用随之取消。

**提示词注入。** `systemPrompt.section({name, order, text})` 的 `text` 可以是函数：
Superman 因此在**每次组装提示词**时重算摘要，始终反映记忆体当前内容；
`order` 取 `getSectionOrder('FILE_REFERENCE') + 1`，与「你手上有什么材料」的段落相邻。

**热更新边界。** 浏览器半是普通 ES 模块，客户端 HMR 每 500 ms 轮询 bundle 的
mtime/size 并推给页面；Host 半是 Cordis 加载的普通 Node 模块，**新增** bundle 立即激活，
改动已安装包的 Host 半则需要重启进程。这决定了开发顺序：先写 Host 契约，再把 UI 放在客户端迭代。

### 4. 子系统要点

**Chat 模式**：上传 → 分类/解码/抽取 → 内联进消息；`<file name="…">…</file>` 承载文本，
图片作为 `{type:'image', attachment}` 交给附件服务持久化。会话记录在
`localStorage['dsh.chat-mode.history.v1']`：≤40 个会话、每个 ≤200 条消息、总计 ≤3.5M 字符、
每个附件文本 ≤4 万字符，图片只留 160 px 缩略图并在重发时显式标注不可用。

**Superman 记忆体**：存储 `<root>/index.json` + `<root>/files/<id>`，写入串行且
「先写临时文件再 rename」。分类顺序为魔术字节 → MIME → 扩展名 → 内容启发式；
图片尺寸直接从 PNG/JPEG/GIF/WebP 文件头读出。回忆为词法打分：名称命中权重 4，
正文命中 1.5/1.2，近因最多 1.5，取前 k（默认 6）渲染成提示词摘要。

**文献捕获**：实测 `arxiv.org` 的 PDF 响应带 `access-control-allow-origin: *`，
因此页面可以自己下载 PDF 再 `store`；下载失败时退化为 `note`（元数据 + 摘要）仍然形成记忆；
记忆体不可用时按钮显示失败而不假装成功。

## English

### 1. Why plugins instead of a patch

DSH composes UI and capability out of plugin rows (bundle → `cordis.patch.yml` → module)
inside a *profile*. The suite obeys three constraints:

1. **Never replace shipped UI** — only *add* entries to `sidebar.panellist`, `main`,
   `settings.section` and `shell.overlay`; an occupied id is never touched.
2. **Never open a listener** — host halves register exact Fetch routes on the
   authenticated `/api` channel, inheriting the official Host/Origin fence and the
   browser-session credential.
3. **Never import another Harness Client package** — a browser half may `require('react')`
   only, uses theme tokens for colour, and routes text through `ctx.locale` with complete
   Chinese and English dictionaries.

The price is writing a PDF reader, a math renderer and an encoding detector by hand —
which is one of the paper's main contributions.

### 2. Topology

```
browser
 ├─ Chat panel     main[chat]                ← history (localStorage) + composer
 ├─ Memory panel   main[superman]            ← category folders, preview, upload
 ├─ arXiv section  settings.section[arxiv]   ← search + bookmark button
 └─ Notices        shell.overlay[superman.toast]
        │ same-origin fetch (authenticated /api)
host
 ├─ POST /api/chat-mode/stream    → ctx.llm.stream(...) → SSE frames
 ├─ POST /api/superman/api        → store/list/get/delete/note/recall
 ├─ GET  /api/superman/file?id=   → original bytes
 ├─ systemPrompt.section()        → memory digest recomputed every assembly
 └─ session/event listener        → captures Harness uploads + turn records
```

### 3. Mechanisms

**Slot injection.** `ctx.slots.inject(key, cb)` plus
`ctx.slots.register(options, component)`; registrations are disposed when their declaring
entry collapses and reinstalled when it returns. A panel receives `t` (the bound
translator) and whatever `inject()` returns; a `hooks: {store}` entry is turned into a
`useStore(selector)` hook by the render layer.

**Streaming and cancellation.** The Chat route writes the model stream as
`text/event-stream`: `text-delta` → `{type:'text'}`, `reasoning-delta` →
`{type:'reasoning'}`, plus `usage` and `finish` frames; the page reads it with `fetch` +
`getReader()` and reassembles on `\n\n`. When the request aborts, `request.signal` is
passed into `ctx.llm.stream`, which cancels the provider call.

**Prompt injection.** `systemPrompt.section({name, order, text})` accepts a *function*
for `text`, so Superman recomputes the digest at every prompt assembly and always
reflects the current memory. Its order is `getSectionOrder('FILE_REFERENCE') + 1`, next
to the "what material do I have" sections.

**Hot-reload boundary.** Browser halves are plain ES modules; the client HMR watcher
polls each bundle's mtime/size every 500 ms and pushes changes to the page. Host halves
are ordinary Node modules loaded by Cordis: a **new** bundle activates immediately,
while editing an installed host half needs a process restart. That shapes the workflow —
freeze the host contract first, then iterate on the UI.

### 4. Subsystem notes

**Chat mode.** Upload → classify/decode/extract → inline into the message; text travels
in `<file name="…">…</file>` blocks and images become `{type:'image', attachment}`
handed to the attachment service. History lives in
`localStorage['dsh.chat-mode.history.v1']`: ≤40 conversations, ≤200 messages each,
≤3.5 M characters total, ≤40 000 characters of text per attachment; images keep only a
160 px thumbnail and are explicitly marked unavailable when resent.

**Superman memory.** Storage is `<root>/index.json` plus `<root>/files/<id>`, written
serially with write-temp-then-rename. Classification cascades through magic bytes →
MIME → extension → content heuristics; image dimensions are parsed straight from
PNG/JPEG/GIF/WebP headers. Recall is lexical: name hits weigh 4, body hits 1.5/1.2,
recency up to 1.5, and the top *k* (default 6) render into a prompt digest.

**Literature capture.** `arxiv.org` PDF responses carry
`access-control-allow-origin: *` (verified), so the page downloads the PDF itself and
`store`s it; a failed download degrades to a `note` (metadata + abstract) that is still
recallable; an unavailable memory reports failure instead of pretending.
