# 验证方法学 / Verification methodology

## 中文

### 为什么不用浏览器自动化

DSH 的界面是浏览器应用，但本项目在开发环境中**没有可编程的浏览器控制**（不能截图、
不能驱动 DOM）。套件因此选择「在 Node 里驱动打包后的真实文件」这一路线：
断言的是真实代码路径与真实数据，而不是替身的返回值。

### 五套离线检查（共 284 项）
> 注：`chat-mode-check.mjs` 的真实 PDF 语料检查需要本机存在 PDF（默认扫描 `~/Downloads`，可用
> `DSH_TEST_CORPUS` 指定目录）；没有语料时会跳过这两项，总数变为 76。


| 套件 | 覆盖 | 项数 |
|---|---|---|
| `tools/chat-mode-check.mjs` | Host 路由注册与校验、SSE 分帧、多轮历史、附件内联、图片转附件、记忆体联动（上传入库、问题带摘要、轮次镜像、开关生效）、失败路径 | 77 |
| `tools/chat-mode-format-check.mjs` | LaTeX→MathML 逐项断言与 16 条公式清单（禁止反斜杠泄漏）、Markdown 块结构、`$100` 不误判、编码识别、GBK 笔记本端到端、网页去标签 | 59 |
| `tools/superman-host-check.mjs` | 分类（PDF/图片/程序/其他）、图片尺寸解析、存储与索引、get/file 路由、记录去重更新、回忆与摘要、删除、Harness 附件捕获与轮次记录、同一附件不重复 | 39 |
| `tools/superman-check.mjs` | 入口与顺序、大脑图标、字典键集一致、六个页签渲染、卡片/预览/上传/删除请求、提示卡注册与去重、守望者基线、错误与空态降级 | 57 |
| `tools/arxiv-smoke.mjs` | Host 检索路由的分支与限速、Atom 解析与渲染、复制 BibTeX、**收藏到记忆体三条路径**（存 PDF / 降级记录 / 失败） | 52 |

### 替身与真实边界

**浏览器半**（`tools/chat-mode-load.mjs`）：

- 桩 `window.__ModuleLoader__` 捕获 `load()` 调用，再以桩 `require('react')` 调入工厂；
- 桩 React 只实现 `createElement/memo/Fragment/useState/useRef/useEffect`，
  并**直接调用函数组件**（而不是模拟渲染），因此组件体里真实跑了一遍；
- `document`、`navigator`、`setTimeout/setInterval`（`unref` 化，避免挂住进程）、
  内存 `localStorage`（可设配额）与桩 `fetch`（按命令返回罐头响应）都是替身。

**Host 半**：假 Cordis 上下文（`inject/effect/on/get/connection.fetch.register`），
记忆体指向 `mkdtemp` 出来的临时目录，测试结束删除。System prompt 段通过一个
记录型替身捕获。

**真实的部分**：插件源码、契约校验、状态机、PDF 抽取与公式生成、编码探测、
记忆体索引与文件、SSE 重组、URL 与请求体、DOM 结构（元素类型/属性/文本）。

**证明不了的部分**：像素级外观、真实浏览器的字体与布局、真实 provider 的模型输出、
真实 Harness 的鉴权链路（`/api` 的信任栅栏在本机由宿主服务保证）、以及
「提示卡确实出现在正确位置」这类视觉结论。

### 端到端与实时检查

- 端到端：`tools/paper-metrics.mjs` 用**真实语料**（本机 14 个 PDF）跑真实抽取器，
  产出论文所用数据；`tools/chat-mode-format-check.mjs` 用真实字节跑编码探测。
- 实时：通过 Inspection 查询核对运行中的页面——`sidebar.panellist` 三个入口 active、
  `main` 的 `chat`/`superman` 面板 active、`shell.overlay` 里 `superman.toast` 存在、
  以及**运行中 Agent 自身的系统提示词里出现记忆体摘要**（最强证据：Harness 侧回忆生效）。

### 复现

```bash
node tools/chat-mode-check.mjs && node tools/chat-mode-format-check.mjs \
  && node tools/superman-host-check.mjs && node tools/superman-check.mjs \
  && node tools/arxiv-smoke.mjs
node tools/paper-metrics.mjs
MPLCONFIGDIR=/tmp/mpl /opt/anaconda3/bin/python3 papers/tools/figures.py
/tmp/pdfenv/bin/python papers/tools/build_pdf.py     # 需要 reportlab
```

## English

### Why not browser automation

The harness UI is a browser application, but the development environment had **no
programmatic browser control** (no screenshots, no DOM driving). The suite therefore
drives the *shipped files* inside Node instead: assertions target real code paths and
real data, not the return values of doubles.

### Five offline suites (284 checks)
> Note: the real-document checks in `chat-mode-check.mjs` need PDFs on the machine
> (`~/Downloads` by default, or set `DSH_TEST_CORPUS`); without a corpus they are skipped
> and the suite reports 76 checks.


| Suite | Coverage | Checks |
|---|---|---|
| `tools/chat-mode-check.mjs` | route registration and validation, SSE framing, multi-turn history, attachment inlining, image → attachment, memory wiring (uploads stored, question carries the digest, turns mirrored, switch honoured), failure paths | 77 |
| `tools/chat-mode-format-check.mjs` | LaTeX→MathML assertions plus the 16-expression battery (no backslash leakage), Markdown structure, `$100` not taken for math, encoding probes, a GBK notebook end to end, HTML tag stripping | 59 |
| `tools/superman-host-check.mjs` | classification (PDF/image/code/other), header-parsed image size, store + index, `get`/`file` routes, record upsert, recall and digest, delete, Harness capture and turn records, attachment dedup | 39 |
| `tools/superman-check.mjs` | entry and order, brain icon, dictionary parity, six folder tabs, card/preview/upload/delete requests, notice registration and dedup, watcher baseline, error and empty degradation | 57 |
| `tools/arxiv-smoke.mjs` | host route branches and pacing, Atom parsing and rendering, BibTeX copy, and the three **save-to-memory** paths (PDF / record fallback / failure) | 52 |

### What is doubled and what is real

**Browser halves** (`tools/chat-mode-load.mjs`): a stub `window.__ModuleLoader__`
captures the `load()` call and the factory is invoked with a stub `require('react')`; the
stub React implements only `createElement/memo/Fragment/useState/useRef/useEffect` and
**invokes function components directly**, so component bodies really execute. `document`,
`navigator`, timers (`unref`'d so a poller cannot hold the process), an in-memory
`localStorage` with an optional quota, and a stubbed `fetch` that answers canned payloads
are all doubles.

**Host halves**: a fake Cordis context (`inject/effect/on/get/connection.fetch.register`),
a memory root created with `mkdtemp` and deleted afterwards, and a recording double for
the system-prompt section.

**Real**: the plugin sources, contract validation, state machines, PDF extraction and math
generation, encoding detection, the memory index and files, SSE reassembly, URLs and
request bodies, and DOM structure (element types, props, text).

**Not proven**: pixel-level appearance, real-browser fonts and layout, real provider
output, the real harness authentication chain (the `/api` trust fence is the host's
guarantee here), and visual conclusions such as "the toast really appears in the corner".

### End-to-end and live checks

- End-to-end: `tools/paper-metrics.mjs` runs the real extractor over a **real corpus**
  (14 local PDFs) and produces the paper's data; the format suite runs the decoder over
  real bytes.
- Live: inspection queries confirmed the running page — three active `sidebar.panellist`
  entries, active `main` panels `chat`/`superman`, the `superman.toast` occupant inside
  `shell.overlay`, and **the memory digest observed inside the running agent's own system
  prompt** (the strongest evidence that Harness-side recall works).

### Reproduce

```bash
node tools/chat-mode-check.mjs && node tools/chat-mode-format-check.mjs \
  && node tools/superman-host-check.mjs && node tools/superman-check.mjs \
  && node tools/arxiv-smoke.mjs
node tools/paper-metrics.mjs
MPLCONFIGDIR=/tmp/mpl /opt/anaconda3/bin/python3 papers/tools/figures.py
/tmp/pdfenv/bin/python papers/tools/build_pdf.py     # requires reportlab
```
