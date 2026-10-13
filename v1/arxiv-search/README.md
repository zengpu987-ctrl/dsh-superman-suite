# arXiv 文献检索 (arxiv-search)

DeepSeek Harness 设置里的一个 arXiv 检索插件：按 **arXiv 号 / 标题 / 作者 / 摘要 / 关键词 / 分类**
查找论文，并把 arXiv 记录的 **会议与期刊** 信息（`comment`、`journal-ref`）显示出来。

- 入口：设置侧栏新增一节 `settings.section`（id `arxiv`，order 20，排在「插件」之后）
- 页面：检索表单 + 结果列表（标题、作者、提交/更新时间、主分类、会议/期刊、摘要、PDF/摘要页链接、复制 BibTeX）
- 取数：浏览器不能直连 `export.arxiv.org`（它不返回 `Access-Control-Allow-Origin`），
  因此由本 bundle 的 Host 半在同源路径 `/arxiv/search` 上代理并原样回传 Atom feed，
  页面再用渲染进程自带的 `DOMParser` 解析

## 收藏到记忆体（Superman）

每个搜索结果右侧都有 **收藏到记忆体**：浏览器先下载该论文的 PDF（`arxiv.org` 的 PDF 带
`access-control-allow-origin: *`，所以页面能直接取），再把字节连同标题、作者、分类、摘要一起
存进 Superman 记忆体；下载被拦时降级为一条记录。归档后记忆体会弹出提示卡，论文进入
PDF / 对话记录分类，之后 Chat 与 Harness 思考时都能回忆到它。

契约见 [superman/API.md](../superman/API.md)；离线覆盖见 `tools/arxiv-smoke.mjs`。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | bundle 清单：`dsh.bundle.patch` 声明 profile 层，`dsh.client` 声明浏览器半；`icon` 给插件管理页用 |
| `cordis.patch.yml` | 插入行 `arxiv-search`（含 `minIntervalMs`、`requestTimeoutMs` 配置） |
| `index.js` | Host 半：注册并实现 `/arxiv/search` 代理路由（校验、限速、转发、错误码） |
| `client.js` | 浏览器半：设置节、检索表单、feed 解析、结果渲染、BibTeX 复制 |
| `locale/{zh,en}.json` | 插件显示元数据（title、description） |
| `icon.svg` | 插件图标 |

## 检索字段与查询构造

| 字段 | arXiv 查询 | 例 |
|---|---|---|
| 关键词 | `all:"…"` | `retrieval augmented generation` |
| 标题 | `ti:"…"` | `Attention Is All You Need` |
| 作者 | `au:"…"` | `Vaswani` |
| 摘要 | `abs:"…"` | `sparse attention` |
| arXiv 号 | `id_list=…` | `2303.08774`、`2303.08774, 1706.03762`、`arXiv: 2303.08774` |
| 分类 | `cat:…` | `cs.CL`、`cs.AI` |

排序可选 相关度 / 最新提交（`submittedDate`）/ 最近更新（`lastUpdatedDate`）；每页 10/20/50 条
（Host 侧硬上限 50，即 arXiv 单页上限）。arXiv 号查询不带排序参数。

## 路由契约

`GET /arxiv/search?mode=<all|title|author|abstract|id|category>&q=<…>&max=<1..50>&sort=<relevance|submitted|updated>`

- 成功：`200`，`content-type: application/atom+xml`，body 为 arXiv 原始 feed，`cache-control: no-store`
- 失败：`4xx/5xx` + `application/json`，body 形如 `{"error":{"code":"empty|empty-id|too-long|mode|method|upstream|network","detail":"…"}}`
- 路由只接受“字段 + 检索词”，从不接受 URL，因此不能被当成通用代理使用
- 按 arXiv 官方要求限速：相邻两次上游请求间隔 `minIntervalMs`（默认 3000ms）排队等待

## 安装到 profile

```sh
dsh plugin --profile desktop add <repo>/arxiv-search
```

## 验证

```sh
node tools/arxiv-smoke.mjs
```

`tools/arxiv-smoke.mjs` 用桩上下文捕获 Host 注册的路由并用桩 `fetch` 驱动它：
校验 / 转发 / 限速 / 各字段查询构造 / 页大小钳制 / 5 种拒绝码 / 上游 5xx 与传输失败；
客户端部分用桩模块加载器与桩 React 渲染设置节：字典完整性、表单渲染、空查询提示、
真实请求路径与参数、feed 映射后的标题/作者/主分类/会议期刊/摘要/链接/BibTeX 复制，
以及上游失败与解析失败两种提示。

注：渲染进程的 `DOMParser`、`navigator.clipboard` 在 Node 里不存在，测试用的是**桩**；
真实 XML 解析只能在浏览器里发生。真实数据链路可以在 Graph GUI 的会话里这样验证
（需要 GUI 的鉴权 cookie）：

```sh
curl -s --cookie "<dsh-auth cookie>" \
  "http://127.0.0.1:19387/arxiv/search?mode=author&q=Vaswani&max=3" | head
```

## 维护

- 想要新的检索字段：在 `client.js` 的 `MODES`/`modeKey`/`placeholderKey` 与 `index.js` 的
  `SEARCH_FIELDS` 各加一处。
- 想要别的源（Crossref/DBLP 等）：在 Host 半再注册一条同源路由，客户端按需切换。
