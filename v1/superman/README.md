# 记忆体 Superman (superman)

给 DeepSeek Harness Web UI 增加一个「智能文件夹」记忆体：侧边栏新增 **Superman** 入口。
Harness 与 Chat 两个模式里上传过的文件、图片都会进入记忆体，自动识别归类到
**PDF / 图片 / 程序 / 其他** 四个文件夹；对话与任务记录也同步进记忆体核心，
于是两个模式思考时都能回忆其中的内容，不同对话之间也能相互联想。

- 入口：侧边栏 `sidebar.panellist` 中 id 为 `superman` 的**大脑图标**，名称显示为 **Superman**
  （`order: -5`，紧跟 Chat 模式）
- 面板：布局 `main` 槽中 key 为 `superman` 的整页组件
- 记忆目录：`~/.dsh/superman/`（`index.json` 索引 + `files/` 原文件），可用 `config.root` 改
- 两条路由：`POST /api/superman/api`（命令）、`GET /api/superman/file?id=`（取原始字节）

## 文件

| 文件 | 作用 |
|---|---|
| `API.md` | 浏览器半与 Host 半之间的**冻结契约**（改动必须同步这里） |
| `package.json` | bundle 清单：`dsh.bundle.patch` + `dsh.client` |
| `cordis.patch.yml` | 插入 Host 行 `superman`，`root: !!js dshHomePath('superman')` |
| `index.js` | Host 半：存储、分类、索引、回忆、提示词注入、Harness 上传捕获 |
| `client.js` | 浏览器半：侧边栏入口与记忆体面板（文件夹、预览、上传、搜索、删除） |
| `locale/{zh,en}.json` | 插件管理页的显示元数据 |
| `icon.svg` | 插件图标 |
| `../tools/superman-host-check.mjs` | Host 半离线检查（分类/存储/回忆/捕获，33 项） |

## 智能分类

1. **魔术字节优先**：`%PDF-` → PDF；PNG/JPEG/GIF/BMP/RIFF-WEBP → 图片；`PK\x03\x04` → 其他（压缩包）。
2. **MIME 其次**：`application/pdf` → PDF，`image/*` → 图片。
3. **扩展名再次**：图片扩展名 → 图片；代码扩展名（`js/ts/py/nb/wl/m/…`，含 Mathematica 的 `nb/wl/m`）→ 程序。
4. **内容启发式**：`#!` 开头，或出现注释、括号分号、`def/function/class/import`、`::`/`=>` 等特征 ≥2 个 → 程序。
5. 其余 → 其他。

图片会顺手从自己的文件头读出像素尺寸（PNG/GIF/JPEG/WebP），卡片上显示 `1920×1080 · 2.4 MB`。
文本类（含代码、PDF 由 Chat 侧提取出的正文）会保留一段正文预览（每个最多 4000 字符）供回忆与检索。

## 回忆是怎么发生的

- **Chat 模式**：发送前用这一轮的问题调 `action: 'recall'`，命中时把返回的
  `【记忆体 Superman｜命中 N 项】…` 摘要作为**上下文**插在该条用户消息最前面；
  输入框左侧的「记忆体」开关可以关掉（状态记在浏览器里）。上传文件时同时
  `action: 'store'` 存进记忆体，并在输入框上方提示「已存入记忆体 N 项」。
- **Harness 模式**：Host 半注册了一个**动态 system prompt 段**，每次组装提示词时都会
  告诉 Agent：记忆体目录在哪、四个文件夹各有多少内容、最近收录了哪些文件、
  最近的对话/任务记录有哪些。Agent 需要旧材料时直接读 `files/` 下的原文件或 `index.json`
  ——所以 Harness 也会「自动记得」记忆体里有什么。
- **上传捕获**：Host 订阅 `session/event`，用户消息或助手消息里出现的图片/文件附件
  会被复制进记忆体（`source: 'harness'`，同一附件不会重复收录）；
  每轮结束（`turn/end`）会把该会话的首问、轮次与最近回答写成一条**任务记录**。
- **对话记录**：Chat 每完成一轮就把该会话镜像成一条 `kind: 'conversation'` 记录
  （id 为 `chat:<会话id>`，正文取最近 8000 字符），于是别的对话问起时可以被检索到。

## 收录提示（每次记住都会提示）

`client.js` 里有一个**记忆体守望者**：每 4 秒问一次 `list`，把这一页没见过的条目排成右下角的
浮层提示卡（`shell.overlay` 中 id 为 `superman.toast`），卡片上写明「记忆体已记住 + 文件名 +
分类 + 大小」，点击直接跳到记忆体面板，7 秒后自动消失。第一次拉取只作基线，所以启动时不会
被历史文件刷屏；同一个条目只会提示一次。

四个来源因此都能提示到：**面板上传**（立即提示）、**Chat 上传**（轮询发现）、
**Harness 上传**（Host 侧捕获后轮询发现）、**arXiv 收藏**（见下）。新建立的对话/任务记录
也会提示一次。

## 与 arXiv 搜索的联动

设置里的「arXiv 搜索」每个结果都多了一个**收藏到记忆体**按钮：

1. 先在浏览器里下载该论文的 PDF（`arxiv.org` 的 PDF 允许跨域，已实测
   `access-control-allow-origin: *`）；
2. 把字节 + 标题/作者/分类/摘要一起 `store` 进记忆体（`source: 'arxiv'`），
   于是这篇论文既是一个 PDF 文件，正文摘要也能被回忆检索到；
3. 下载被拦或失败时**降级为一条记录**（`action: 'note'`，标题=论文标题，正文=元数据+摘要），
   仍然能形成记忆；记忆体不可用时按钮显示「归档失败」，不会假装成功。

按钮状态：`收藏到记忆体 → 归档中… → 已归档 PDF / 已归档为记录 / 归档失败`。

## 设计约束

- Host 半不碰 Session 日志内容以外的任何状态：捕获失败一律吞掉，绝不因为记忆体
  出错而让会话追加失败。
- 写索引是**串行 + 原子重命名**的，两个上传并发也不会写坏索引。
- 浏览器半只 `require('react')`，不引入任何 Harness Client 包；颜色全部来自主题 token，
  文案走 `ctx.locale`（中英双份，键集一致）。

## 安装

    plugin_manager({ action: 'install_bundle', target: '/绝对路径/superman' })

这是**新增** bundle，装入后通过 HMR 立即生效，不需要重启。

## 自检

    node tools/superman-host-check.mjs    # Host 半：分类、存储、图片尺寸、回忆、捕获、错误路径（39 项）
    node tools/superman-check.mjs         # 浏览器半：入口/图标/字典/文件夹/预览/上传/删除/提示（57 项）
    node tools/arxiv-smoke.mjs            # arXiv 半：含「收藏到记忆体」的三条路径（52 项）
