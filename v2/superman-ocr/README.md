# 文字识别 Superman OCR (superman-ocr)

给记忆体补上**「扫描件也能回忆」**：扫描件、以及文字已经转曲（outline）的 PDF 没有可用的文字层，
浏览器的 PDF 读取器只能回答 `{ text: '', note: 'no-text' }` —— 于是这类文件进了记忆体也只能存字节，
回忆起不来。本 bundle 用 macOS 自带的 **Vision** 文字识别把它们变成可检索的正文，
引擎是自己带的、零依赖的 Swift 小程序，**首次使用时现场用 `swiftc` 编译一次**，之后一直复用。

- 路由：`POST /api/superman-ocr/api`（`health` / `ocr`），在已鉴权的 `/api` 通道上
- 引擎：`../tools/ocr-pdf.swift`（PDFKit 把每页渲染成位图，Vision 以 `.accurate` 识别
  `["zh-Hans", "en-US"]`）
- 工作目录：`~/.dsh/superman-ocr/`（`ocr-pdf` 二进制 + 临时 PDF + clang 模块缓存），可用 `config.workDir` 改
- 只做识别，不落库、不索引：正文由调用方（Chat / 记忆体）决定怎么用

## 文件

| 文件 | 作用 |
|---|---|
| `API.md` | 浏览器半与 Host 半之间的**冻结契约**（改动必须同步这里） |
| `package.json` | bundle 清单：`dsh.bundle.patch`（Host 行，无浏览器半） |
| `cordis.patch.yml` | 插入 Host 行 `superman-ocr`，`workDir: !!js dshHomePath('superman-ocr')` |
| `index.js` | Host 半：首次使用编译、并发编译串行化、临时文件、超时/取消、错误码 |
| `locale/{zh,en}.json` | 插件管理页的显示元数据 |
| `icon.svg` | 插件图标（识别取景框 + A / 文） |
| `../tools/ocr-pdf.swift` | 引擎本体：PDFKit 渲染 + Vision 识别（零外部依赖） |
| `../tools/superman-ocr-check.mjs` | 离线检查（71 项；加 `DSH_OCR_E2E=1` 共 76 项，含真编译的端到端识别） |

## 为什么是「首次使用时编译」

Swift 源码跟着仓库走，二进制不进仓库也不进 bundle：

1. 第一次 `ocr` 调用时，Host 半用 `swiftc -O tools/ocr-pdf.swift -o <workDir>/ocr-pdf
   -framework Vision -framework PDFKit -framework AppKit` 编译一次（先写 `<workDir>/ocr-pdf.building`，
   成功后原子改名，失败不留半成品）；
2. **同一进程内只编译一次**：并发调用共用同一个 Promise，不会编译出两个二进制；
3. **跨进程复用**：新进程发现 `<workDir>/ocr-pdf` 比源码新就直接用，不再编译；
4. 编译失败返回 `compile-failed`（HTTP 500），message 里带 `swiftc` 的 stderr 尾部；
   下一次调用会再试一次；
5. `config.bin` 指向现成的 `ocr-pdf` 时完全不编译（离线检查就是这么替换引擎的）。

因为受限沙箱下 clang 默认的模块缓存可能不可写，编译时会把 `CLANG_MODULE_CACHE_PATH` /
`SWIFT_MODULECACHE_PATH` 指到 `<workDir>/clang-cache`，编译是自包含的。

## 一次调用发生了什么

1. 校验 `base64`（长度预检 → 32 MiB 上限），要求魔术字节是 `%PDF-`；
2. 页数取 `maxPages`（默认 `config.maxPages`）并夹到 `[1, 200]`，渲染倍数取 `config.scale`（默认 2，夹到 0.5–6）；
3. 把字节写进 `<workDir>/ocr-<uuid>.pdf`；
4. 运行 `ocr-pdf <临时文件> --max-pages N --scale S`，超时按 `config.timeoutMs`（默认 600 秒），
   请求的 `AbortSignal` 会直接杀掉子进程；
5. 读 stdout，**无论成功失败都删除临时文件**；`text` 截断到 400000 字符，`pages` 数分页标记，
   `characters` 是截断前的真实字符数；
6. 引擎非零退出返回 `ocr-failed`（502）并带 stderr 尾部，超时返回 `ocr-timeout`（504）。

## 实测（本机，默认 `--scale 2`）

在一台 Apple Silicon Mac（macOS 26）上，用本 bundle 的引擎跑样例 PDF，只统计汉字个数：

| 样例 | 文字层里的汉字 | OCR 得到的汉字 | 说明 |
|---|---|---|---|
| 19 页学术讲义（`brochure.pdf`（化名），19 页全部识别） | 9 | 66 | 文字层里中文的 ToUnicode 映射是坏的：取出来是乱码，那 9 个「汉字」全是错字（真正的标题文字只存在于图里），OCR 才拿得回来 |
| 1 页成绩单（`document-B.pdf`（化名）） | 197 | 203 | 本来就有完整文字层，OCR 与之一致（说明识别质量） |
| 成绩单第 1 页栅格化成纯图片 PDF | 0 | 202 | **真正的扫描件路径：0 → 202** |
| 招生简章第 3 页栅格化成纯图片 PDF | 0 | 1072 | **真正的扫描件路径：0 → 1072（共 1341 字符）** |

也就是说：文字层里确实没有的中文，OCR 能补回来；对本来就有文字层的文件，OCR 的结果与文字层基本一致。
上面两行「纯图片 PDF」是把页面按 2 倍渲染成位图后重新封装成 PDF 得到的（文字层只有 1 个换行符，0 个汉字），
就是扫描件的形态。渲染倍数实测以 2 最好：讲义第 1 页在 `--scale 2 / 3 / 4` 下分别是 28 / 15 / 23 个汉字，
所以默认值就是 2，不必调大。

## 设计约束

- 不引入任何外部依赖：Swift 只用 PDFKit / Vision / AppKit，Host 半只用 Node 内置模块。
- 所有对外调用都走同一个接缝：导出的 `runner`（即 `runTool`）与 `config.runner`、`config.bin`，
  离线检查可以整体替换引擎或编译器。
- 临时文件一定在 `finally` 里删除；二进制一定先写临时名再原子改名，
  所以「半成品二进制」和「残留临时 PDF」都不会出现。
- bundle 不含浏览器半：调用方（Chat 的 PDF 读取器、记忆体面板）自己决定什么时候调、怎么用结果。

## 安装

    plugin_manager({ action: 'install_bundle', target: '/绝对路径/superman-ocr' })

这是**新增** bundle，装入后通过 HMR 立即生效，不需要重启。默认的 `source` 指向
`../tools/ocr-pdf.swift`（即仓库里 `superman-ocr/` 的兄弟目录 `tools/`）；
把 bundle 装到别处时用 `config.source` 指到源码，或把 `config.bin` 指到现成的二进制。

## 自检

    node tools/superman-ocr-check.mjs                  # 离线：路由/信封/错误码/页数夹取/临时文件/编译一次（70 项）
    DSH_OCR_E2E=1 node tools/superman-ocr-check.mjs   # 追加：真编译 swiftc 并识别一张生成的 PDF 页（约 8 秒）

没有装 `swiftc` 时，端到端那几项会打印一行说明并跳过，其余检查照常跑完。
