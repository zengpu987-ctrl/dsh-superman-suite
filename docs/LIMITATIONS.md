# 局限性与修复记录 / Limitations and how they were closed

本文件记录 Superman 套件从 v1 到 v2 的**局限修复**：每一条都写明原问题、修复方式、验证证据，
以及是否需要在 Harness 里重启进程才能生效。
*This file records how the v1 limitations were closed: the original problem, the fix, the evidence,
and whether the harness process must be restarted for it to take effect.*

| # | v1 局限 | v2 状态 | 生效方式 |
|---|---|---|---|
| 1 | 扫描件/文字转曲的 PDF 没有文本层，无法被回忆 | ✅ 已修复：本机 OCR（macOS Vision）+ 自动降级 | 客户端即时；OCR 需要 `superman-ocr` 包 |
| 2 | 回忆是平均的词法打分，长文档被长度带偏 | ✅ 已修复：BM25 + IDF 取代加法打分 | Host 半，**需重启** |
| 3 | 对话记录只存在页面 origin 的 `localStorage` | ✅ 已修复：记忆体保存可还原的结构化会话 | 客户端即时 |
| 4 | 历史里的图片只剩 160px 缩略图，重发时"不可用" | ✅ 已修复：按 `memoryId` 从记忆体取回原图 | 客户端即时 |
| 5 | 记忆体只增不减，没有压缩策略 | ✅ 已修复：条数/字节上限 + 淘汰 + 孤儿清理 + `prune` | Host 半，**需重启** |
| 6 | 面板上传与 Harness 捕获的 PDF 不带文本 | ✅ 已修复：Host 侧在入库时自行抽取文本 | Host 半，**需重启** |
| 7 | 没有浏览器级（DOM）端到端测试 | ⚠️ 部分：`tools/dom-check.mjs` 与本地 React/jsdom 工具链已就绪，仍在修 jsdom 交互细节 | 工具链，不影响产品 |
| 8 | 语义回忆（向量检索）缺失 | ❌ 未修复：本机没有可用的嵌入服务，词法检索已升级为 BM25 并如实标注 | — |

## 1. 扫描件 → 本机 OCR

**原问题**：PDF 抽取只读文本层，扫描件返回 `no-text`，用户只能上传截图。

**修复**：
- `tools/ocr-pdf.swift`：用 PDFKit 渲染页面 + Vision `VNRecognizeTextRequest`
  （`recognitionLanguages = ["zh-Hans", "en-US"]`、`.accurate`）的独立 CLI。
- `superman-ocr/` bundle：`POST /api/superman-ocr/api`，`{action:'health'|'ocr'}`；
  首次使用时用 `swiftc` 把 Swift 工具编译进 `~/.dsh/superman-ocr` 并缓存二进制，
  并发编译只跑一次；临时文件用完即删，返回文本上限 400 000 字符。
- Chat 半：抽取结果为空时自动调用 OCR 路由（`readByOcr`），成功则把识别文本内联进上下文、
  同时带着文本存进记忆体，并在正文前标注"以下内容由本机 OCR 识别，可能有错字"；
  OCR 包不存在时保持原来的"无文本层"提示，不报错。

**验证**：`node tools/superman-ocr-check.mjs`（路由/信封/编译/超时/参数/清理）；
真实扫描件上的识别字数对比记录在该套件的输出里。

## 2. BM25 回忆

**原问题**：加法打分（名称 4、正文 1.5/1.2、近因 ≤1.5）在文档长度差异大时偏向长文档，
且常见词与稀有词同权。

**修复**：`recall` 改为 **BM25（k1 = 1.2，b = 0.75）**，按字段加权（名称加权、正文、记录标题与正文）
并保留近因项；文档频率按整库现算；返回结构与 `digest` 字符串不变，调用方无需改动。

**验证**：`tools/superman-host-check.mjs` 新增检查——含稀有查询词的文档排第一；在所有文档里都出现的词被 IDF 降权。

## 3. 对话记录可跨 origin 恢复

**原问题**：记录写在页面 origin 的 `localStorage`，换端口（如 `dsh web` 的 3080）、换浏览器或清除站点数据就丢。

**修复**：每轮结束除写散文式记录（供回忆检索）外，再写一条 `chatstate:<id>` 记录，
内容是**可还原的 JSON**（标题、时间、模型选择、每条消息的角色/文本/附件元数据、图片的 `memoryId`，
上限 7900 字符，超长时丢弃最旧的轮次而不是截断 JSON）。面板启动时仍**同步**用本地缓存先渲染，
随后异步把记忆体里的会话合并进来、回写本地缓存、必要时升级当前打开的会话，
并用 `memoryRestored` 提示"已从记忆体恢复 N 个会话"。

**验证**：`tools/chat-mode-check.mjs` 新增检查——空 `localStorage` 的全新 origin 能恢复会话并提示；
本地较新的副本不会被记忆体里的旧副本覆盖，较旧的本副本会被升级；损坏的载荷被跳过且不影响列表渲染。

## 4. 历史图片取回原图

**原问题**：为节省配额，历史里只存 160px 缩略图，重发旧轮次会得到"图片不可用"。

**修复**：存储时把记忆体返回的条目 id 记在附件上（`memoryId`）；发送前 `hydrate()` 对缺
`data` 的图片调用 `GET /api/superman/file?id=…` 取回原始字节，再按原来的格式发给模型；
取不到时仍回退到"图片不可用"的说明，不会静默丢图。

**验证**：`tools/chat-mode-check.mjs` 新增检查——带 `memoryId` 的图片会发请求、请求体带 base64、
且不出现"不可用"提示；文件路由 404 时回退提示且该轮照常发送。

## 5. 记忆体压缩策略

**原问题**：只有条目数上限，没有容量策略，文件与索引只增不减。

**修复**：`maxItems`（默认 2000）与 `maxBytes`（默认 512 MiB）两个上限；
每次入库后按最旧优先淘汰（同时删文件与索引项），并在结果里返回 `evicted`；
构造时做一次**一致性对账**（索引里有、磁盘上没有的条目删掉；磁盘上有、索引里没有的孤儿文件删掉）；
新增 `{action:'prune'}` 手动清理，`stats` 增加淘汰与孤儿计数。写入仍是"先写临时文件再 rename"。

**验证**：`tools/superman-host-check.mjs` 新增检查——条数上限触发时文件与条目都被删除；
字节上限生效；对账删除孤儿与缺失条目；`prune` 计数正确；淘汰后 `index.json` 仍是合法 JSON。

## 6. PDF 入库即带文本

**原问题**：Chrome 半抽取的文本只有 Chat 上传会带给记忆体；面板上传与 Harness 捕获只有字节，
回忆只能靠文件名。

**修复**：把浏览器半的抽取器移植成 Node 模块 `superman/pdf.js`，Host 半在入库时（面板上传与
`session/event` 捕获）对 PDF 自行抽取文本（上限 200 页 / 400 000 字符），解析失败不影响入库。

**验证**：新增检查直接对比两端抽取器的输出（同一批真实 PDF 文本必须一致），
另验证解析失败时仍能存下字节。

## 7. 浏览器级 DOM 测试（进行中）

**原问题**：五套离线检查都用桩 React 直接调用组件函数，看不到真实 DOM 装配。

**进展**：`tools/dom/` 已装好本地 jsdom + React/ReactDOM 工具链，`tools/dom-check.mjs` 用
`createRoot` 真实挂载面板并通过真实 DOM 事件（输入、Enter、点击、`change` 选文件）驱动，
已能覆盖挂载、输入、发送、新建会话等路径；jsdom 里 React 的 `act` 与 `console.timeStamp`
等环境差异仍在收敛中，因此该套件暂未纳入发布目录。

## 8. 仍未修复：语义回忆

本机没有可用的嵌入/向量服务，因此回忆仍是词法检索（已升级为 BM25）。
要做成语义回忆，需要接一个嵌入服务或用模型做重排；套件把回忆抽象在
`recall(q)` 一个函数里，接入时不需要改动调用方。
