# Chat 模式 (chat-mode)

给 DeepSeek Harness Web UI 增加一个「对话框」模式：左侧边栏新增两个模式入口 ——
**Harness 模式**（就是现在的 Agent 会话）与 **Chat 模式**（仿 ChatGPT 的纯对话面板）。
Chat 面板支持对话记录、上传文件、选择 DeepSeek 模型与思考强度，不调用任何工具，直接和模型对话。

- Harness 入口：侧边栏 `sidebar.panellist` 中 id 为 `conversation` 的图标
  （点它等于选中 Harness 自己的会话面板，所以不需要复制任何官方 UI）
- Chat 入口：同一槽中 id 为 `chat` 的图标（`order: -10`，排在「插件」「定时任务」之前）
- Chat 面板：布局 `main` 槽中 key 为 `chat` 的整页组件
- 模型流：Host 半在已鉴权的 `/api` 通道上注册 `POST /api/chat-mode/stream`，
  浏览器半用 `fetch` + SSE 读取，Host 侧再调用 `ctx.llm.stream(...)`

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | bundle 清单：`dsh.bundle.patch` 声明 profile 层，`dsh.client` 声明浏览器半 |
| `cordis.patch.yml` | 插入 Host 行 `chat-mode`，`config.systemPrompt` 可换掉默认系统提示 |
| `index.js` | Host 半：校验请求、把上传图片转成附件引用、SSE 流式转发模型输出 |
| `client.js` | 浏览器半：侧边栏两个模式入口、Chat 面板、对话记录、Markdown+LaTeX 排版、PDF/笔记本解析、编码识别、字典、样式 |
| `locale/{zh,en}.json` | 插件管理页/清单卡片的显示元数据 |
| `icon.svg` | 插件图标 |
| `../tools/chat-mode-check.mjs` | 工作区里的离线联调脚本：管线 70 项（不属于安装内容） |
| `../tools/chat-mode-format-check.mjs` | 离线排版/解码检查：LaTeX→MathML 与编码识别 59 项 |
| `../tools/chat-mode-load.mjs` | 离线加载 client.js 的公共桩（window/document/React/localStorage） |

## 面板能力

1. **对话记录**：面板左侧是 ChatGPT 风格的会话列表（标题取首条提问，按更新时间排序，
   可新建 / 切换 / 删除，标题栏的按钮可收起列表）。切换回 Harness 再切回来、刷新页面、
   重启应用都不会丢；切换会话时会恢复该会话的模型与思考强度选择。
2. **对话与排版**：居中消息流；用户消息右侧气泡，模型回答左侧整行；回答按 Markdown 渲染
   （标题、无序/有序列表、引用、表格、行内代码、代码块、链接、粗体斜体删除线）；
   回答可一键复制；停止按钮可中断流；空状态给出 4 个示例问题。
3. **公式（重点）**：模型输出的 LaTeX 会被解析成 **MathML**，由浏览器用系统数学字体
   （`STIX Two Math` → `Latin Modern Math` → `Cambria Math` → `STIXGeneral`）排版，
   分数、根式、上下标、求和/积分（含 ∮ ∯ ∬ ∭）、大算符的上下限、矩阵与 cases、
   花体/黑板体（𝒪、ℝ）、向量箭头与重音、`\left( \right)` 伸缩括号都按 TeX 语义绘制。
   识别 `$…$`、`$$…$$`、`\(…\)`、`\[…\]`，以及**没有定界符的裸 LaTeX**
   （整行 `\frac{…}{…}` 或多行 `\begin{aligned}…\end{aligned}`）——
   这正是「公式乱码」的来源：以前它们被当成纯文本原样显示。解析失败时降级为原文，
   不会白屏；`$100`、`$200` 这类金额不会被误判成公式。
4. **思考强度**：读取 Host 的模型目录（`remote.session.modelCatalog`），
   把每个模型自己声明的 reasoning efforts（Off / Low / High / Max）做成下拉，
   默认跟随该模型声明的默认档位，思考过程折叠显示。
5. **模型选择**：同一个目录里的 DeepSeek 分组（如 DeepSeek Account →
   DeepSeek-V41-Flash / DeepSeek-V4-Pro），默认取部署默认模型。
6. **上传文件**（回形针 / 拖拽 / 粘贴，单条最多 6 个）：
   - **PDF**：在浏览器里自己解析——定位对象表、用平台 `DecompressionStream` 解压
     `FlateDecode`（容忍压缩数据后的填充字节）、按字体 `/ToUnicode` CMap 还原字形码、
     重放内容流的文本算符；同时支持对象流（`/ObjStm`）、间接 `/Length`、
     继承的 `/Resources`，以及把伪装成 WinAnsi 的中文（GBK/Big5/Shift-JIS）识别出来。
     提取不到文字（扫描件）或每页文字过少时会明确说明，而不是塞入乱码。
   - **Mathematica 笔记本 `.nb`**：把 `Cell[...]` 拆成输入单元与文本单元，
     把 `RowBox[...]`/`SuperscriptBox[...]` 盒式结构拍平成可读代码；
     解析失败时退回原文。
   - **Mathematica 代码 `.wl/.wls/.m/.ma/.mt/.mth`**：按文本直接内联。
   - **图片**（png/jpeg/webp/gif ≤8 MB）：走附件服务变成耐久图片引用，交给多模态模型。
   - **文本类**（`.md/.txt/.json/.csv/代码…`）：先做**编码识别**再内联——
     BOM（UTF-8/UTF-16）→ 严格 UTF-8 → 无 BOM 的 UTF-16 → GBK / Big5 / Shift-JIS / EUC-KR，
     每个候选按「读起来像不像文本」打分取最优。所以 GBK 的 `.nb`、Big5 的源码不会再变乱码，
     附件卡片上会显示识别到的编码（如 `GBK`）。
   - **网页**（`.html/.htm/.xhtml`）：去掉 script/style 与标签，只内联可见文字。
   - **二进制文件**（含 PNG、zip、docx 等）：识别为二进制后明确跳过并说明，
     不再把 `File.text()` 的乱码塞进对话。
   - 其它类型同样明确跳过并说明原因，不会静默丢弃。
7. **错误呈现**：没有可用模型、目录读取失败、模型调用失败、PDF 无文字层、
   存储写入失败都会在面板内说明原因。

## 与记忆体 Superman 的联动

Chat 模式会和同工作区的 `superman` 插件（记忆体）联动，任何一半缺席都会**静默降级**、不影响对话：

- 上传文件时同时把字节 + 已提取的正文 `store` 进记忆体，输入框上方提示「已存入记忆体 N 项」；
- 每次发送前用这一轮的问题调 `recall`，命中时把 `【记忆体 Superman｜命中 N 项】…` 摘要插在
  该条用户消息最前面作为上下文；输入框里的「记忆体」开关可以关掉（状态记在浏览器里）；
- 每完成一轮就把该会话镜像成一条 `kind: 'conversation'` 记录（id 为 `chat:<会话id>`），
  于是别的对话问起相关内容时也能被检索到。

接口契约见 [superman/API.md](../superman/API.md)。

## 对话记录存在哪里

存在 **这个页面 origin（`http://127.0.0.1:19387`）的 `localStorage`**，键为
`dsh.chat-mode.history.v1`：一条 JSON 记录，包含会话列表、每条会话的消息与模型选择。

- 好处：不需要改 Host 代码，装好即用；桌面版端口固定，重启后记录仍在。
- 取舍：文本附件保留提取出的文字（每个文件最多 4 万字符，超出部分会标注），
  图片只保留 160px 缩略图——重开旧会话再次发送时，原图会替换成一句说明，
  需要重新上传；存储写满时会丢弃最旧的会话并在面板上提示。
- 清除浏览器站点数据会清空记录；`dsh web`（3080 端口）与桌面版（19387）各存一份。

## 设计约束

- Host 半只做一件事：把「一次普通模型调用」暴露给页面，不读 Session、不读设置、
  不碰文件系统，并且跑在已鉴权、带 Origin 校验的 `/api` 通道上。
- 浏览器半只 `require('react')`，不引入任何 Harness Client 包，PDF 与笔记本解析都在
  自己这份 bundle 内；颜色全部来自 `--dsw-alias-*` / `--dsw-specific-*` 主题 token，
  中英文都走 `ctx.locale`，因此跟随应用语言与明暗主题。
- 会话内容保存在槽注入的 snapshot store 里，落盘走一个 600ms 去抖的写入，
  流式回答只改当前那一条消息对象，列表里其它行不会重渲染。

## 安装与更新

    plugin_manager({ action: 'install_bundle', target: '/绝对路径/chat-mode' })

安装会把包加到 profile 的 `dsh.profile.bundles`。安装后：

- 只改 `client.js`：`dsh-client-hmr` 每 500ms 轮询 bundle 的 mtime/size，
  变更后把新 bundle 推给页面，插件会自动重新注册（无需重启，必要时刷新一次页面）。
- 改 `index.js`（Host 半）：需要重启 Harness 才会重新加载模块。

## 自检

    node tools/chat-mode-check.mjs

    node tools/chat-mode-check.mjs          # 管线：70 项
    node tools/chat-mode-format-check.mjs   # 排版与解码：59 项

两套都用真实的两半代码 + 假 `ctx.llm` + 内存 `localStorage`：

- 管线：Host 路由注册、SSE 分帧、多轮历史、附件内联、图片转附件、PDF 提取
  （含真实中文 PDF 与手工构造的 CMap/hex/加密样例）、笔记本拍平、
  会话记录读写与配额裁剪、失败路径与面板渲染。
- 排版与解码：LaTeX→MathML 的逐项断言与一份 16 条真实公式清单（禁止反斜杠泄漏）、
  Markdown 块结构、`$100` 不被误判、GBK/Big5/UTF-16/二进制识别、GBK 笔记本端到端解析、
  网页去标签。
