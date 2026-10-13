# Superman 套件 · DeepSeek Harness 扩展体系

> 一个给 **DeepSeek Harness** 增加「Chat 模式 + 智能记忆体 + 文献捕获」的插件套件：
> 不改 Harness 源码，纯插件安装；含 284 项离线检查与两篇论文（中/英）。
>
> *An extension suite for **DeepSeek Harness**: a ChatGPT-style chat panel, a smart
> memory ("Superman"), and arXiv literature capture — installed as plugins, without
> forking the harness. Ships 284 offline checks and two papers (Chinese & English).*

**作者 / Author:** Zeng Pu · zengpu987@gmail.com · 独立研究者 / Independent Researcher
**许可 / License:** MIT

---

## 中文

### 这是什么

DeepSeek Harness（DSH）本身是一个以会话为中心的智能体框架。本套件在它的 Web 界面上
**新增**三种能力，全部通过官方插件机制（bundle + slot + 已鉴权 Fetch 路由 + system
prompt 段 + 会话事件）接入，不修改 DSH 任何源码：

| 插件包 | 能力 |
|---|---|
| `chat-mode` | **Chat 模式**：仿 ChatGPT 的纯对话面板。带对话记录、上传文件、DeepSeek 模型与思考强度选择；输出按 Markdown + **LaTeX→MathML** 排版；不调用任何工具 |
| `superman` | **记忆体 Superman**：侧边栏大脑图标入口的智能文件夹。Harness 与 Chat 上传的文件/图片自动识别归类到 **PDF / 图片 / 程序 / 其他**，对话与任务记录同步进同一核心，两个模式思考时都会自动回忆；每记住一份文件弹出提示卡 |
| `arxiv-search` | **arXiv 搜索 + 文献捕获**：设置里的论文检索小节，每条结果一个「收藏到记忆体」按钮，自动下载 PDF 归档进 Superman（下载受阻时降级为记录） |

三者可以独立安装，彼此只通过同源的 `/api/superman/api` 契约通信：
Superman 缺席时，Chat 与 arXiv 会自动降级，不会报错。

### 核心特性

- **对话**：多轮记录（可新建/切换/删除/收起），模型与思考强度按会话记忆恢复。
- **文件**：PDF、Mathematica 笔记本（`.nb`，拍平输入单元）、Mathematica 代码
  （`.wl/.wls/.m/.mta`）、图片、文本、网页；先做**编码识别**（UTF-8/BOM/UTF-16/GBK/Big5/
  Shift-JIS/EUC-KR），二进制文件明确拒绝而不是读成乱码。
- **PDF 自解析**：bundle 内自带的 PDF 阅读器（对象表扫描 → Flate 解压 → ToUnicode CMap →
  内容流重放），支持对象流、间接 `/Length`、继承 `/Resources`、ASCII85/ASCIIHex，
  并对「伪装成 WinAnsi 的 GBK」做回退识别。实测 14 个真实 PDF：199 942 字符、
  67 235 个汉字、0 个乱码字符。
- **公式**：LaTeX → MathML（浏览器用 `STIX Two Math` 排版），识别 `$…$`、`$$…$$`、
  `\(…\)`、`\[…\]` 以及**无定界符的裸 LaTeX**；`$100` 不会被误判。
- **记忆体**：`index.json` + `files/` 的原子写入存储；按魔术字节/MIME/扩展名/内容启发式
  分类；图片尺寸直接读文件头；回忆为词法打分（词频 + 近因）并渲染成提示词摘要。
- **双模式回忆**：Chat 发送前把命中摘要插进本轮提问；Harness 通过动态
  `systemPrompt.section` 让 Agent 始终知道记忆体里有什么（实测：本会话自身的系统提示词里
  就能看到记忆体目录与计数），并可直接读取 `files/` 下的原文件。
- **提示**：4 秒守望者轮询记忆体，新收录的条目在右下角弹出提示卡（点击直达面板）。

### 安装

前置：已安装 DeepSeek Harness（桌面版或 `dsh web`），并有一个可用的 profile。

```bash
git clone <this-repo> dsh-superman-suite
cd dsh-superman-suite
```

然后在 Harness 里（或让 Harness 里的 Agent 执行）对每个包调用安装：

```
plugin_manager({ action: 'install_bundle', target: '<repo>/chat-mode' })
plugin_manager({ action: 'install_bundle', target: '<repo>/superman' })
plugin_manager({ action: 'install_bundle', target: '<repo>/arxiv-search' })
```

- 新增 bundle 装入后经加载器 **HMR 立即生效**，无需重启；修改已安装包的 Host 半则需要重启进程。
- Chat/arXiv 与记忆体的联动只需要记忆体包在同一 profile 里；不装 `superman` 也能用。
- 记忆体默认目录 `~/.dsh/superman`，可在 `superman/cordis.patch.yml` 里改 `config.root`。

### 使用

1. 左侧边栏出现三个入口：**Harness 模式**（官方会话）、**Chat 模式**、**Superman**（大脑图标）。
2. Chat 面板输入框上方有「记忆体」开关；开启时每轮自动带上回忆摘要。
3. 在 Chat 里上传 PDF/笔记本/图片/文本 → 内容内联进模型上下文，同时存入记忆体。
4. 在 Harness 里上传的附件会被 Host 侧捕获进记忆体，每轮结束生成一条任务记录。
5. 设置 → **arXiv 搜索** → 搜索 → 点「收藏到记忆体」。
6. 点开 Superman 面板：四个分类 + 对话记录页签，支持搜索、预览、上传、删除。

### 目录结构

```
chat-mode/           Chat 模式 bundle（Host 半 255 行 + 浏览器半 4017 行）
superman/            记忆体 bundle（Host 半 666 行 + 浏览器半 1320 行）
arxiv-search/        arXiv 搜索 bundle（Host 半 139 行 + 浏览器半 784 行）
tools/               离线验证脚本（5 套，284 项检查）与记忆体/论文度量脚本
papers/              两篇论文（中/英）的 Markdown 源、图表、度量数据与 PDF
docs/                架构、安装、验证文档（中英双语）
```

### 验证

```bash
node tools/chat-mode-check.mjs          # 77 项（无 PDF 语料时 76）：路由、SSE、历史、附件、记忆体联动
node tools/chat-mode-format-check.mjs   # 59 项：LaTeX→MathML、Markdown、编码识别
node tools/superman-host-check.mjs      # 39 项：分类、存储、回忆、Harness 捕获
node tools/superman-check.mjs           # 57 项：入口、文件夹、预览、上传、提示卡
node tools/arxiv-smoke.mjs              # 52 项：arXiv 半，含收藏三条路径
node tools/paper-metrics.mjs            # 重跑论文所用的全部度量
```

全部检查都在 Node 里驱动**打包后的真实文件**：浏览器半用桩 `window.__ModuleLoader__`、
桩 React（直接调用函数组件）、内存 `localStorage` 与桩 `fetch`；Host 半用假 Cordis 上下文
与临时记忆目录。详见 [docs/VERIFICATION.zh.md](docs/VERIFICATION.zh.md)。

### 论文

`papers/` 内含同一体系的完整技术论文，中文与英文各一份（约 8 页，A4 双栏）：

- `papers/paper-zh.pdf` / `papers/paper-en.pdf`
- 源文件：`papers/paper-zh.md` / `papers/paper-en.md`；图表：`papers/figures/{zh,en}/`；
  测量数据：`papers/data/metrics.json`（可用脚本复现）

### 设计的取舍（诚实说明）

- PDF 抽取只读文本层：扫描件/文字转曲会得到「无文字层」的明确提示，不做 OCR。
- 回忆是词法匹配（词频 + 近义字符/二元组 + 近因），不是向量检索。
- Chat 对话记录存在页面 origin 的 `localStorage`：重启仍在，但清除站点数据或换端口（如
  `dsh web` 的 3080）不会共享。
- 历史里的图片只留 160px 缩略图；重发旧轮次时会明确标注「原图不可用」。
- 视觉细节没有自动化端到端（DOM）测试，靠离线套件 + 实时槽位/提示词检查覆盖。

---

## English

### What this is

DeepSeek Harness (DSH) is a session-centric agent harness. This suite **adds** three
capabilities to its Web UI entirely through the harness's own extension mechanisms —
bundles, slots, authenticated Fetch routes, a system-prompt section and session events —
without modifying a single line of DSH:

| Package | Capability |
|---|---|
| `chat-mode` | **Chat mode**: a ChatGPT-style plain-conversation panel with saved history, file attachments, DeepSeek model and thinking-effort selection, and Markdown + **LaTeX→MathML** typesetting. No tools. |
| `superman` | **Superman memory**: a smart folder behind a brain icon in the sidebar. Files and images uploaded in either mode are classified into **PDF / images / code / other**; conversation and task records join the same core; both modes recall it while they think; every remembered file raises a notice. |
| `arxiv-search` | **arXiv search + literature capture**: the Settings search section gains a *save to memory* button per result that downloads the PDF into Superman, degrading to a metadata record when the download is blocked. |

The three install independently and talk only through the same-origin
`/api/superman/api` contract: with Superman absent, Chat and arXiv degrade silently.

### Highlights

- **Conversations** with per-conversation model and effort, a history column, and
  edit-free switching.
- **Attachments**: PDF, Mathematica notebooks (`.nb`, input cells flattened),
  Mathematica sources (`.wl/.wls/.m`), images, text and saved web pages — each decoded
  by **encoding detection** (UTF-8/BOM/UTF-16/GBK/Big5/Shift-JIS/EUC-KR); binary files
  are refused explicitly instead of being turned into mojibake.
- **Self-contained PDF reader** (object-table scan → Flate inflate → `/ToUnicode` CMap →
  content-stream replay) with object streams, indirect `/Length`, inherited
  `/Resources`, ASCII85/ASCIIHex chains, and a GBK/Big5/Shift-JIS fallback for fonts
  mislabelled `WinAnsiEncoding`. Measured on 14 real PDFs: 199 942 characters,
  67 235 CJK, 0 noise characters.
- **Math**: LaTeX is parsed into **MathML** and laid out by the browser with
  `STIX Two Math`; `$…$`, `$$…$$`, `\(…\)`, `\[…\]` and **bare LaTeX** all work, while
  `$100` is not mistaken for math.
- **Memory**: an `index.json` + `files/` store with atomic write-then-rename, a
  classification cascade (magic bytes → MIME → extension → content), image dimensions
  read straight from file headers, and lexical recall (term overlap + recency) rendered
  as a prompt digest.
- **Recall in both modes**: Chat prepends the matching digest to the question; Harness
  publishes a dynamic `systemPrompt.section`, so the agent always knows what the memory
  holds (observed live inside this session's own prompt) and can read the originals
  under `files/`.
- **Notices**: a 4-second watcher raises one toast per newly remembered file.

### Install

Prerequisite: an installed DeepSeek Harness (desktop app or `dsh web`) with a profile.

```bash
git clone <this-repo> dsh-superman-suite
```

Then install each package by absolute path (from the harness itself or its agent):

```
plugin_manager({ action: 'install_bundle', target: '<repo>/chat-mode' })
plugin_manager({ action: 'install_bundle', target: '<repo>/superman' })
plugin_manager({ action: 'install_bundle', target: '<repo>/arxiv-search' })
```

- A **new** bundle activates through the loader immediately (no restart); editing the
  Host half of an installed package requires a process restart.
- The memory defaults to `~/.dsh/superman`; change `config.root` in
  `superman/cordis.patch.yml`.

### Layout

```
chat-mode/          Chat mode bundle (host 255 lines + browser 4017 lines)
superman/           memory bundle (host 666 + browser 1320)
arxiv-search/       arXiv bundle (host 139 + browser 784)
tools/               offline verification (5 suites, 284 checks) and metric scripts
papers/              two papers (zh/en): Markdown sources, figures, data, PDFs
docs/                architecture, install, verification (bilingual)
```

### Verify

```bash
node tools/chat-mode-check.mjs          # 77 (76 without a PDF corpus): route, SSE, history, attachments, memory wiring
node tools/chat-mode-format-check.mjs   # 59: LaTeX→MathML, Markdown, decoding
node tools/superman-host-check.mjs      # 39: classification, store, recall, capture
node tools/superman-check.mjs           # 57: entry, folders, preview, upload, notices
node tools/arxiv-smoke.mjs              # 52: arXiv bundle incl. the bookmark paths
node tools/paper-metrics.mjs            # re-measure everything the papers report
```

Every suite drives the **shipped files** in Node: the browser halves load with a stub
`window.__ModuleLoader__`, a stub React whose function components are invoked directly,
a memory `localStorage` and a stubbed `fetch`; the host halves run against a fake Cordis
context and a temporary memory directory. See [docs/VERIFICATION.en.md](docs/VERIFICATION.en.md).

### Papers

`papers/` carries a full technical paper about the suite in both languages (~8 pages,
A4, two columns): `papers/paper-zh.pdf` and `papers/paper-en.pdf`, with their Markdown
sources, generated figures, and the measured `papers/data/metrics.json` that the chart
and PDF scripts consume.

### Honest limitations

- PDF extraction reads the text layer only: scanned or outlined documents report
  "no text layer" instead of being OCR'd.
- Recall is lexical, not embedding-based.
- Chat history lives in the page origin's `localStorage`: it survives restarts, but not
  clearing site data, and is not shared with a different port (`dsh web` on 3080).
- Images restored from history keep a 160 px thumbnail; resending an old turn marks them
  unavailable rather than dropping them silently.
- There is no automated browser-level (DOM) end-to-end test: verification is the offline
  suites plus live slot and prompt inspection, so visual details remain unverified.

### Cite

```bibtex
@misc{superman-suite,
  author = {Zeng Pu},
  title  = {Superman: an extension suite for DeepSeek Harness},
  year   = {2026},
  note   = {Chat mode, smart memory, and literature capture as harness plugins}
}
```

## 致谢 / Acknowledgements

感谢 DeepSeek Harness 提供的插件机制、槽位系统与文档；本研究中的 PDF 文本抽取、
公式排版与记忆体设计均在该框架的官方约束（不引入其他 Client 包、只使用主题 token、
不改源码）下完成。感谢 arXiv 提供开放接口与可跨域访问的 PDF。
*Thanks to DeepSeek Harness for the plugin, slot and documentation surface this work
builds on, and to arXiv for its open API and CORS-enabled PDFs.*

## 许可 / License

MIT — 见 [LICENSE](LICENSE)。
