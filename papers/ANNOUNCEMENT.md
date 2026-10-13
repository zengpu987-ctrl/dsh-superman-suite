**Zeng, P.** · Independent Researcher

📄 **PDF** — [English, 8 pages](https://github.com/zengpu987-ctrl/dsh-superman-suite/blob/main/papers/paper-en.pdf) · [中文，8 页](https://github.com/zengpu987-ctrl/dsh-superman-suite/blob/main/papers/paper-zh.pdf)
📦 **Sources** — [`papers/`](https://github.com/zengpu987-ctrl/dsh-superman-suite/blob/main/papers) · the code it describes is [`v1/`](https://github.com/zengpu987-ctrl/dsh-superman-suite/blob/main/v1)

---

### Abstract

Agentic coding harnesses present a terminal-like, tool-first surface in which every user utterance is a task for an autonomous loop. That surface fits three needs poorly: casual conversation with a model, durable memory of material seen earlier, and capture of literature. We describe an extension suite for DeepSeek Harness (DSH) that addresses them without forking it, in three bundles: *chat mode*, a conversation panel with attachments and Markdown plus LaTeX typesetting; *Superman*, a smart-folder memory that classifies uploads, stores conversation and task records, and injects a dynamic digest into every agent prompt; and an *arXiv bookmarking* addition that archives a paper's PDF into that memory and degrades to a metadata record when the download is blocked. All three use the harness's slot system and an authenticated same-origin Fetch channel, so no shipped interface is replaced and no listening socket is added. The suite is 7 187 lines of JavaScript across six files, verified by 284 offline checks over five suites and a 14-file PDF corpus from which the hand-written reader extracts 199 942 characters (67 235 CJK) over 138 pages with zero noise, in 34.7 ms for a 19-page document and about 72 ms for two 54–56-page Chinese documents; seven of seven encoding probes and sixteen of sixteen math expressions are handled correctly.

### 摘要

智能体编码框架的界面以会话、终端与工具调用为中心，缺少三样东西：一个不调用工具的纯对话界面、一份跨会话持久的记忆、以及把检索到的文献收进工作流的入口。本文报告一套为 DeepSeek Harness 构建的扩展套件，它在不修改、不派生宿主源码的前提下补齐上述能力。套件由三个 bundle 组成：Chat 模式新增一个仿 ChatGPT 的对话面板，支持附件、Markdown 与 LaTeX 排版、模型与思考强度选择；Superman 记忆体把两个模式上传的文件、图片以及对话与任务记录归类进一个智能文件夹，并在每次组装提示词时把记忆摘要注入系统提示词；文献捕获在 arXiv 检索结果上增加「收藏到记忆体」按钮，下载失败时降级为一条记录。全部界面经宿主槽位注入，全部网络交互走已鉴权的同源 `/api` 通道，不新开监听端口。浏览器半无法 import 宿主的 Client 包，因此 PDF 文本抽取、LaTeX→MathML 渲染与编码识别都在本 bundle 内自行实现。评测给出：6 个文件共 7 187 行 JavaScript；5 套离线检查共 284 项全部通过；14 个真实 PDF 抽出 199 942 个字符、67 235 个汉字、138 页，替换字符与 C1 控制字符为 0，其中 9 个无文字层的文件被如实报告；编码探测 7/7 正确；16 条公式生成合法 MathML 且无反斜杠泄漏；三个侧边栏入口在运行中的页面生效，并在运行中 Agent 自身的系统提示词里观察到记忆体摘要。

---

### What this paper describes

Three extension bundles for DeepSeek Harness, installed as plugins without forking the harness — a ChatGPT-style **Chat mode**, a **Superman memory** that classifies every upload and recalls it while either mode thinks, and an **arXiv search section** that archives a paper's PDF into that memory:

- a self-contained PDF text reader (object scan → Flate → `/ToUnicode` CMap → content replay), because a browser half may not import another client package;
- encoding detection (UTF-8/BOM/UTF-16/GBK/Big5/Shift-JIS/EUC-KR) so uploads are never inlined as mojibake;
- LaTeX → MathML with a 16-expression battery, typeset by the browser with STIX Two Math;
- a memory with an index plus files, an atomic write path, category classification and a prompt digest injected at every turn;
- 284 offline checks over five suites, and the live evidence that Harness-side recall really fires.

Its last section lists the eight limitations that the follow-up article then set out to close — see the [v2 announcement](https://github.com/zengpu987-ctrl/dsh-superman-suite/blob/main/../discussions) for how each one ended.

### Cite

```bibtex
@article{superman-v1,
  author = {Zeng, P.},
  title  = {Extending an Agentic Coding Harness with a Conversational Surface, a Smart Memory, and Literature Capture},
  year   = {2026},
  note   = {The suite, its architecture and its measured verification}
}
```
