# 安装与使用 / Install and use

## 中文

### 前置条件

- 已安装 **DeepSeek Harness**（桌面版，或 `dsh web` 之类基于 Web 的 profile）。
- 一个可写的 profile（桌面版默认 `desktop`）。
- Node.js 18+（仅运行自检脚本时需要）。

### 安装

```bash
git clone <this-repo> dsh-superman-suite
cd dsh-superman-suite
```

在 Harness 的 Agent 会话里（或任何能调用 `plugin_manager` 的地方）逐个安装：

```
plugin_manager({ action: 'install_bundle', target: '<repo>/chat-mode' })
plugin_manager({ action: 'install_bundle', target: '<repo>/superman' })
plugin_manager({ action: 'install_bundle', target: '<repo>/arxiv-search' })
```

每个包都是标准 bundle：`package.json` 里的 `dsh.bundle.patch` 声明 profile 层，
`dsh.client` 声明浏览器半。安装器会把包链接进 profile 并加入 `dsh.profile.bundles`。

**生效方式**

- 新增 bundle：加载器 **HMR 立即生效**，无需重启。
- 修改已安装包的 Host 半（`index.js`）：需要重启 Harness 进程。
- 修改浏览器半（`client.js`）：客户端 HMR 每 500 ms 轮询 bundle 变更并推给页面；
  必要时刷新一次页面。

**卸载**

```
plugin_manager({ action: 'remove_bundle', target: '@local/dsh-superman' })
```
（包名分别是 `@local/dsh-chat-mode`、`@local/dsh-superman`、`@local/dsh-arxiv`。）

### 配置

| 包 | 配置项 | 默认 | 说明 |
|---|---|---|---|
| chat-mode | `config.systemPrompt` | 内置英文助手提示 | 空字符串表示用内置 |
| superman | `config.root` | `dshHomePath('superman')` = `~/.dsh/superman` | 记忆体目录 |
| superman | `config.recallLimit` | `6` | 单次回忆最多返回多少条 |
| arxiv-search | `config.minIntervalMs` | `3000` | 遵守 arXiv 的访问节奏 |
| arxiv-search | `config.requestTimeoutMs` | `20000` | 上游超时 |

改配置：在 profile 的 `cordis.patch.yml` 里覆盖对应行，或用 Harness 的配置编辑器。

### 使用

1. 侧边栏出现三个入口：**Harness 模式**、**Chat 模式**、**Superman**（大脑图标）。
2. Chat：输入问题 → Enter 发送；回形针/拖拽/粘贴上传文件；左下角切换记忆体开关；
   右侧选择模型与思考强度；标题栏可收起对话记录列。
3. Harness：正常使用智能体即可；上传的附件会自动进记忆体，每轮结束写入任务记录。
4. 设置 → arXiv 搜索 → 检索 → 点「收藏到记忆体」。
5. Superman：四个分类 + 对话记录页签，搜索、预览（图片直显、文本/代码显示正文）、
   上传、删除；点右上角刷新可重读记忆体。

### 常见问题

| 现象 | 原因与处理 |
|---|---|
| 提示「记忆体写入失败」 | `superman` 未安装或未激活；装上后重试 |
| Chat 上传 PDF 后没有文字 | 该 PDF 没有文本层（扫描件）；面板会说明，可改为上传页面截图 |
| 收藏 arXiv 显示「已归档为记录」 | PDF 下载被网络拦截；记录里已含标题/作者/摘要，仍可被回忆 |
| 记忆体面板为空 | 还没上传过；或 `config.root` 指向了别处 |
| 改了 `index.js` 没生效 | Host 半需要重启 Harness 进程 |
| 看不到提示卡 | 提示卡只在「新收录」时弹出；启动时的历史条目不提示 |

## English

### Prerequisites

- An installed **DeepSeek Harness** (desktop app, or a web-based profile such as `dsh web`).
- A writable profile (the desktop app uses `desktop`).
- Node.js 18+ — only needed for the self-check scripts.

### Install

```bash
git clone <this-repo> dsh-superman-suite
cd dsh-superman-suite
```

Then install each package by absolute path (from a harness agent session or anywhere
`plugin_manager` is callable):

```
plugin_manager({ action: 'install_bundle', target: '<repo>/chat-mode' })
plugin_manager({ action: 'install_bundle', target: '<repo>/superman' })
plugin_manager({ action: 'install_bundle', target: '<repo>/arxiv-search' })
```

Every package is a standard bundle: `dsh.bundle.patch` in `package.json` declares its
profile layer and `dsh.client` declares the browser half. The installer links the package
into the profile and adds it to `dsh.profile.bundles`.

**When changes take effect**

- A **new** bundle activates through the loader immediately — no restart.
- Editing an installed package's host half (`index.js`) requires restarting the harness.
- Editing a browser half (`client.js`) is picked up by the client HMR watcher (500 ms
  poll); refresh the page if it looks stale.

**Uninstall**

```
plugin_manager({ action: 'remove_bundle', target: '@local/dsh-superman' })
```
The package names are `@local/dsh-chat-mode`, `@local/dsh-superman`, `@local/dsh-arxiv`.

### Configuration

| Package | Key | Default | Meaning |
|---|---|---|---|
| chat-mode | `config.systemPrompt` | built-in assistant prompt | empty string keeps the built-in |
| superman | `config.root` | `dshHomePath('superman')` = `~/.dsh/superman` | memory directory |
| superman | `config.recallLimit` | `6` | matches returned per recall |
| arxiv-search | `config.minIntervalMs` | `3000` | arXiv pacing |
| arxiv-search | `config.requestTimeoutMs` | `20000` | upstream timeout |

Override the row in the profile's `cordis.patch.yml`, or use the harness's config editor.

### Using it

1. Three sidebar entries appear: **Harness mode**, **Chat mode**, **Superman** (brain icon).
2. Chat: type and press Enter; attach files with the paperclip, drag-and-drop or paste;
   toggle recall with the memory pill; pick model and thinking effort; collapse the
   history column from the title bar.
3. Harness: just use the agent. Uploaded attachments land in the memory automatically and
   each turn writes a task record.
4. Settings → arXiv search → search → *save to memory*.
5. Superman: four category tabs plus records, with search, preview (images inline,
   text/code as text), upload and delete; the refresh button re-reads the memory.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "memory could not be saved to" | the `superman` bundle is missing or inactive; install it and retry |
| a Chat-uploaded PDF carries no text | that PDF has no text layer (a scan); the panel says so — upload page images instead |
| arXiv says "archived as a record" | the PDF download was blocked; the record still holds title/authors/abstract and stays recallable |
| the memory panel is empty | nothing uploaded yet, or `config.root` points elsewhere |
| an `index.js` edit had no effect | host halves need a harness process restart |
| no toast appears | toasts fire only for *newly* remembered files; the start-up list is treated as a baseline |
