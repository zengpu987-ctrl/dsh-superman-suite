#!/usr/bin/env python3
"""Write the synthetic manuscripts the typesetter is tested against.

The real ``papers/v2/paper-{en,zh}.md`` are owned by other agents; until they
land, this script writes stand-ins to ``/tmp/v2-synth/`` with the structure and
the length FACTS §8 asks for (title, authors, abstract, Introduction, Results
with the eight limitation subsections, Discussion, Methods, back matter,
references, appendices A–E, all nine figure placeholders and six table
placeholders). The prose is generated from the measured numbers, so page counts
and caption placement can be exercised without touching the repository.

Usage::

    /tmp/pdfenv/bin/python papers/v2/tools/synthetic_manuscript.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
V2 = ROOT / "papers" / "v2"
OUT = Path("/tmp/v2-synth")

DATA = json.loads((V2 / "data" / "metrics.json").read_text(encoding="utf-8"))

REFERENCES = [
    "DeepSeek Harness, https://github.com/deepseek-ai/deepseek-harness",
    "Cordis plugin framework, https://github.com/cordiverse/cordis",
    "ISO 32000-1:2008, Document management — Portable document format — Part 1: PDF 1.7.",
    "Adobe Systems, PDF Reference, 6th edn (FlateDecode, ToUnicode CMaps), 2006.",
    "ISO 19005-1:2005, PDF/A-1 (archival PDF).",
    "R. Smith, An overview of the Tesseract OCR engine, ICDAR 2007.",
    "Apple Inc., Vision framework — VNRecognizeTextRequest, developer documentation.",
    "Apple Inc., PDFKit framework, developer documentation.",
    "W3C, MathML Core, W3C Recommendation.",
    "KaTeX, https://katex.org/",
    "MathJax, https://www.mathjax.org/",
    "STIX Two fonts, https://github.com/stipub/stixfonts",
    "The Unicode Consortium, The Unicode Standard, Version 15.",
    "WHATWG, Encoding Standard (GBK, Big5, Shift_JIS, EUC-KR decoders).",
    "WHATWG, HTML Living Standard, § Server-sent events.",
    "WHATWG, HTML Living Standard, § Web storage (localStorage).",
    "React, https://react.dev/",
    "jsdom, https://github.com/jsdom/jsdom",
    "S. Robertson and H. Zaragoza, The probabilistic relevance framework: BM25 and beyond, Found. Trends IR 3(4), 2009.",
    "S. E. Robertson, S. Walker, S. Jones, M. M. Hancock and M. Beaulieu, Okapi at TREC-3, TREC 1994.",
    "G. Salton and C. Buckley, Term-weighting approaches in automatic text retrieval, Inf. Process. Manag. 24(5), 1988.",
    "K. Sparck Jones, A statistical interpretation of term specificity and its application in retrieval, J. Doc. 28(1), 1972.",
    "K. Karpukhin et al., Dense passage retrieval for open-domain question answering, EMNLP 2020.",
    "N. Reimers and I. Gurevych, Sentence-BERT, EMNLP 2019.",
    "O. Khattab and M. Zaharia, ColBERT, SIGIR 2020.",
    "P. Lewis et al., Retrieval-augmented generation for knowledge-intensive NLP tasks, NeurIPS 2020.",
    "J. Johnson, M. Douze and H. Jégou, Billion-scale similarity search with GPUs (FAISS), IEEE Trans. Big Data, 2019.",
    "Y. A. Malkov and D. A. Yashunin, Efficient and robust approximate nearest neighbour search using HNSW, IEEE TPAMI, 2018.",
    "N. F. Liu et al., Lost in the middle: how language models use long contexts, TACL 2024.",
    "C. Packer et al., MemGPT: towards LLMs as operating systems, 2023, arXiv:2310.08560.",
    "J. S. Park et al., Generative agents: interactive simulacra of human behavior, UIST 2023.",
    "S. Yao et al., ReAct: synergizing reasoning and acting in language models, ICLR 2023.",
    "T. Schick et al., Toolformer: language models can teach themselves to use tools, NeurIPS 2023.",
    "arXiv API user manual, https://info.arxiv.org/help/api/user-manual.html",
    "M. Kleppmann, Designing Data-Intensive Applications, O'Reilly, 2017 (atomic replace, idempotence).",
    "GitHub, REST API for repository creation and contents.",
    "Git project, https://git-scm.com/",
    "MIT License, https://opensource.org/license/mit",
    "OpenAI et al., GPT-4 Technical Report, 2023, arXiv:2303.08774 (used only as a corpus sample).",
    "V. I. Levenshtein, Binary codes capable of correcting deletions, insertions and reversals, 1966.",
    "L. R. Rabiner, A tutorial on hidden Markov models, Proc. IEEE 77(2), 1989.",
    "J. Devlin et al., BERT, NAACL 2019.",
    "A. Vaswani et al., Attention is all you need, NeurIPS 2017.",
    "T. Brown et al., Language models are few-shot learners, NeurIPS 2020.",
    "D. E. Knuth, The TeXbook, Addison-Wesley, 1984.",
    "C. A. R. Hoare, Proof of a program: FIND, Acta Informatica 1, 1971.",
]

FIGURES = {
    "en": [
        ("versions", "Figure 1 | The two topologies. (a) v1 stored PDF bytes and read the text layer only, "
                     "kept conversation history in the page origin's localStorage and let the memory grow. "
                     "(b) v2 adds the on-device OCR fallback, image hydration from the memory item id, and a "
                     "compaction policy with start-up reconciliation."),
        ("limitations", "Figure 2 | The fix matrix. The eight v1 limitations by outcome, with the number of "
                        "new offline checks attributable to each; L7 is partial and L8 remains open."),
        ("checks", "Figure 3 | Offline checks per suite. Grouped bars compare the recorded v1 totals with the "
                   "v2 measurement; the suite totals rise from 284 to 449."),
        ("code", "Figure 4 | Code growth per module. Stacked bars show the v1 and v2 line counts with the "
                 "files new in v2 highlighted; superman/pdf.js and the OCR bundle carry the increase."),
        ("ocr", "Figure 5 | What OCR recovers. (a) the three FACTS §2 cases: a rasterised page with an empty "
                "text layer, a page with a single character, and the 19-page brochure whose embedded CMap is "
                "broken; (b) two pages rasterised and re-measured in this run. Bars give the text-layer and "
                "OCR character counts, and the Han share is printed under each case."),
        ("corpus", "Figure 6 | The corpus. (a) extracted characters against page count for the five documents "
                   "with a text layer, with the nine textless vector files on the zero line; (b) the origin "
                   "cluster, where the OCR-recovered pages sit."),
        ("latency", "Figure 7 | Extraction time against document length. The nine textless vector files return "
                    "in under a millisecond; the 54–56 page prospectuses cost about 75 ms."),
        ("bm25", "Figure 8 | The worked BM25 example. (a) the v1 flat additive score, (b) the v2 BM25 score on "
                 "the same two documents and query; the rare term flips the order."),
        ("lifecycle", "Figure 9 | The memory lifecycle. Store, classify, extract or OCR, index, recall and "
                      "compact, with the caps and the start-up reconciliation labelled."),
    ],
    "zh": [
        ("versions", "图 1｜两个版本的拓扑。(a) v1 只读文本层、历史存于页面 origin 的 localStorage、记忆体只增不减；"
                     "(b) v2 增加本机 OCR 降级、按 memoryId 取回原图，以及带上限与启动对账的压缩策略。"),
        ("limitations", "图 2｜修复矩阵。八条 v1 局限的结果，以及归因到每条局限的新增离线检查项数量；L7 为部分修复，L8 仍未修复。"),
        ("checks", "图 3｜各套件的离线检查项。分组柱对比 v1 记录值与 v2 的实测值，合计由 284 升至 449。"),
        ("code", "图 4｜各模块代码增长。堆叠柱给出 v1 与 v2 的行数，并高亮 v2 新增文件；增量主要来自 superman/pdf.js 与 OCR 包。"),
        ("ocr", "图 5｜OCR 的效果。(a) FACTS §2 的三个用例：文本层为空的光栅化页面、只剩 1 个字符的页面，"
                "以及内嵌 CMap 损坏的 19 页册子；(b) 本次重新测量的两页。柱高为文本层与 OCR 的字符数，汉字数量标注在用例下方。"),
        ("corpus", "图 6｜语料。(a) 五份有文本层文档的抽取字符数与页数，九个无文本层矢量文件落在零线；(b) 原点附近的放大，"
                   "OCR 恢复的页面就在其中。"),
        ("latency", "图 7｜抽取耗时与文档长度。九个无文本层矢量文件均在 1 毫秒内返回；54–56 页的两份文档约需 75 毫秒。"),
        ("bm25", "图 8｜BM25 算例。(a) v1 的加法打分，(b) v2 在同一查询与两篇文档上的 BM25 打分；稀有词使名次翻转。"),
        ("lifecycle", "图 9｜记忆体生命周期。入库、分类、抽取或 OCR、建索引、回忆、压缩，并标注上限与启动对账。"),
    ],
}

TABLES = {
    "en": [
        ("versions", "Table 1 | What changed between v1 and v2, and where each change takes effect."),
        ("limitations", "Table 2 | Limitation, fix, evidence and status for the eight documented limitations."),
        ("inventory", "Table 3 | Source inventory: v1 and v2 line counts per file."),
        ("suites", "Table 4 | Verification suites, what each drives, and the check counts."),
        ("ocr", "Table 5 | OCR measurements per case: text-layer characters, OCR characters and the Han share."),
        ("api", "Table 6 | Memory and OCR API actions added or changed in v2."),
    ],
    "zh": [
        ("versions", "表 1｜v1 到 v2 的变化，以及每项变化在何处生效。"),
        ("limitations", "表 2｜八条局限的「局限—修复—证据—状态」登记表。"),
        ("inventory", "表 3｜源码清单：各文件 v1 与 v2 的行数。"),
        ("suites", "表 4｜验证套件、各自驱动的对象与检查项数量。"),
        ("ocr", "表 5｜各用例的 OCR 测量：文本层字符、OCR 字符与其中汉字。"),
        ("api", "表 6｜v2 新增或变更的记忆体与 OCR API 动作。"),
    ],
}

EN_SENTENCES = [
    "The v2 pass closed six of the eight limitations, partially closed one and could not close the last.",
    "The measurement is taken on this machine, and every number in the article is reproducible from the shipped scripts.",
    "Offline verification is the only honest test available: the suite drives the shipped files through stub loaders, an in-memory localStorage and a stubbed fetch.",
    "A page rasterised to an image-only PDF carries zero characters in its text layer, and OCR reads 3 411 characters of which 979 are Han.",
    "BM25 with k1 = 1.2 and b = 0.75 replaces the flat additive score, so a rare term outweighs a term every document carries.",
    "Conversation state is written beside the prose record as a restorable JSON payload, capped at 7 900 characters, and merged on start-up.",
    "An image remembers the memory item id of its bytes, so a resend fetches the original from the file route instead of apologising.",
    "The compaction policy caps the memory at 2 000 items and 512 MiB and evicts oldest-first, deleting the entry and its file together.",
    "The host extracts PDF text at store time through a Node port of the browser extractor, capped at 200 pages and 400 000 characters.",
    "The DOM suite mounts the panels with createRoot and real events; jsdom environment differences still keep it out of the published tree.",
    "Semantic recall stays open because no embedding service exists on this machine, and the seam is the single recall function.",
    "The Chinese manuscripts quote interface strings; the typesetter falls back per character so no glyph disappears from the page.",
    "The figures are drawn from the same metrics file the tables come from, so a stale number cannot survive a rebuild.",
    "Extraction of 14 real PDFs yields 199 942 characters and 67 235 Han characters across 138 pages with no replacement characters.",
    "The 16-expression LaTeX battery converts cleanly to MathML, and the encoding probes detect all seven cases correctly.",
]

ZH_SENTENCES = [
    "v2 补齐了八条局限中的六条，部分补齐一条，最后一条无法补齐。",
    "文中所有数字都在本机测得，并可由仓库内的脚本复现。",
    "离线验证是唯一诚实的检验方式：套件通过桩加载器、内存 localStorage 与桩 fetch 驱动已发布的文件。",
    "把一页光栅化为纯图片 PDF 后，其文本层字符数为 0，OCR 读出 3 411 个字符，其中汉字 979 个。",
    "BM25 取 k1 = 1.2、b = 0.75，取代原来的加法打分，稀有词因此胜过每篇文档都有的词。",
    "每轮结束除散文记录外还写入可还原的 JSON 载荷，上限 7 900 字符，启动时合并回列表。",
    "图片记住自身字节在记忆体里的条目 id，重发时从文件路由取回原图，而不是提示不可用。",
    "压缩策略把记忆体限制在 2 000 条与 512 MiB，最旧优先淘汰，并同时删除条目与文件。",
    "Host 半在入库时用浏览器抽取器的 Node 移植版抽取 PDF 文本，上限 200 页、400 000 字符。",
    "DOM 套件用 createRoot 挂载面板并派发真实事件；jsdom 环境差异使它暂时未进入发布目录。",
    "语义回忆仍未实现，因为本机没有可用的嵌入服务，接入点收敛在 recall 一个函数里。",
    "中文稿会引用界面字符串；排版器按字符回退字体，页面上不会丢字形。",
    "图与表都来自同一份度量文件，因此过期的数字无法在重新构建后存活。",
    "14 份真实 PDF 共抽出 199 942 个字符、67 235 个汉字、138 页，且没有替换字符。",
    "16 条 LaTeX 表达式全部干净地转换为 MathML，七项编码探测全部识别正确。",
]


def paragraph(sentences: list[str], count: int, seed: int) -> str:
    """A deterministic paragraph of ``count`` sentences."""
    return " ".join(sentences[(seed + index) % len(sentences)] for index in range(count))


def english() -> str:
    lines: list[str] = []
    lines.append("# Closing the documented limitations of a harness extension suite: OCR, BM25, durable history and compaction in Superman v2")
    lines.append("")
    lines.append("**Authors:** Anstar, Z.¹*, Zeng, P.¹, DeepSeek Harness Contributors²")
    lines.append("")
    lines.append("**Affiliations:** ¹ Superman project, DeepSeek Harness extension suite. "
                 "² DeepSeek Harness Contributors.")
    lines.append("")
    lines.append("**Corresponding author:** Anstar, Z. (anstar@example.org)")
    lines.append("")
    lines.append("## Abstract")
    lines.append("")
    lines.append(paragraph(EN_SENTENCES, 9, 0))
    lines.append("")
    lines.append("**Keywords:** agent harness, PDF text extraction, on-device OCR, BM25, memory compaction, offline verification")
    lines.append("")
    lines.append("## Introduction")
    lines.append("")
    for index in range(9):
        lines.append(paragraph(EN_SENTENCES, 8, index))
        lines.append("")
    lines.append("## Results")
    lines.append("")
    titles = [
        "L1 — Scanned documents are read by on-device OCR",
        "L2 — Recall becomes BM25",
        "L3 — Conversation history survives the origin",
        "L4 — History images come back at full fidelity",
        "L5 — The memory gains a compaction policy",
        "L6 — Extraction moves into the store path",
        "L7 — Browser-level verification, partially closed",
        "L8 — Semantic recall remains open",
    ]
    figure_order = ["ocr", "bm25", "lifecycle", "versions", "limitations", "checks", "code", "corpus"]
    for index, title in enumerate(titles):
        lines.append(f"### {title}")
        lines.append("")
        for part in range(5):
            lines.append(paragraph(EN_SENTENCES, 8, index * 5 + part))
            lines.append("")
        key, caption = [item for item in FIGURES["en"] if item[0] == figure_order[index]][0]
        lines.append(f"[[FIG:{key}]]")
        lines.append(caption)
        lines.append("")
    lines.append("## Discussion")
    lines.append("")
    for index in range(7):
        lines.append(paragraph(EN_SENTENCES, 8, index + 3))
        lines.append("")
    lines.append("## Methods")
    lines.append("")
    lines.append("### The plugin model")
    lines.append("")
    for index in range(4):
        lines.append(paragraph(EN_SENTENCES, 8, index))
        lines.append("")
    lines.append("### The offline verification methodology")
    lines.append("")
    lines.append(paragraph(EN_SENTENCES, 8, 5))
    lines.append("")
    lines.append("```")
    lines.append("cd dsh-superman-suite/v2")
    lines.append("for suite in chat-mode-check chat-mode-format-check superman-host-check superman-check arxiv-smoke; do")
    lines.append("    node tools/$suite.mjs")
    lines.append("done")
    lines.append("```")
    lines.append("")
    lines.append("### The BM25 formulation")
    lines.append("")
    lines.append("The score of a document d against a query Q is score = Σ IDF(t) · f(tf) with "
                 "IDF(t) = log(1 + (N − df + 0.5)/(df + 0.5)) and a saturated term weight, "
                 "so a term every document carries contributes almost nothing.")
    lines.append("")
    lines.append(paragraph(EN_SENTENCES, 8, 9))
    lines.append("")
    lines.append("### Storage schema, atomicity and compaction")
    lines.append("")
    lines.append(paragraph(EN_SENTENCES, 8, 11))
    lines.append("")
    lines.append("## Data availability")
    lines.append("")
    lines.append(paragraph(EN_SENTENCES, 3, 1))
    lines.append("")
    lines.append("## Code availability")
    lines.append("")
    lines.append(paragraph(EN_SENTENCES, 3, 6))
    lines.append("")
    lines.append("## Acknowledgements")
    lines.append("")
    lines.append(paragraph(EN_SENTENCES, 2, 2))
    lines.append("")
    lines.append("## Author contributions")
    lines.append("")
    lines.append("Z.A. designed the suite; P.Z. built the harness plugins; both measured and wrote.")
    lines.append("")
    lines.append("## Competing interests")
    lines.append("")
    lines.append("The authors declare no competing interests.")
    lines.append("")
    lines.append("## References")
    lines.append("")
    for number, reference in enumerate(REFERENCES, start=1):
        lines.append(f"[{number}] {reference}")
    lines.append("")
    lines.append("## Appendix A — The memory and OCR API actions")
    lines.append("")
    lines.append(paragraph(EN_SENTENCES, 6, 4))
    lines.append("")
    lines.append("[[TAB:api]]")
    lines.append(TABLES["en"][5][1])
    lines.append("")
    lines.append("## Appendix B — The verification suite inventory")
    lines.append("")
    lines.append(paragraph(EN_SENTENCES, 5, 7))
    lines.append("")
    lines.append("[[TAB:suites]]")
    lines.append(TABLES["en"][3][1])
    lines.append("")
    lines.append("## Appendix C — The corpus and the OCR measurements")
    lines.append("")
    lines.append(paragraph(EN_SENTENCES, 6, 8))
    lines.append("")
    lines.append("[[TAB:ocr]]")
    lines.append(TABLES["en"][4][1])
    lines.append("")
    lines.append("[[FIG:corpus]]")
    lines.append(FIGURES["en"][5][1])
    lines.append("")
    lines.append("[[FIG:latency]]")
    lines.append(FIGURES["en"][6][1])
    lines.append("")
    lines.append("## Appendix D — The limitation-to-fix register")
    lines.append("")
    lines.append(paragraph(EN_SENTENCES, 6, 10))
    lines.append("")
    lines.append("[[TAB:limitations]]")
    lines.append(TABLES["en"][1][1])
    lines.append("")
    lines.append("[[TAB:versions]]")
    lines.append(TABLES["en"][0][1])
    lines.append("")
    lines.append("[[FIG:checks]]")
    lines.append(FIGURES["en"][2][1])
    lines.append("")
    lines.append("[[FIG:code]]")
    lines.append(FIGURES["en"][3][1])
    lines.append("")
    lines.append("[[FIG:bm25]]")
    lines.append(FIGURES["en"][7][1])
    lines.append("")
    lines.append("[[FIG:limitations]]")
    lines.append(FIGURES["en"][1][1])
    lines.append("")
    lines.append("[[FIG:versions]]")
    lines.append(FIGURES["en"][0][1])
    lines.append("")
    lines.append("[[FIG:lifecycle]]")
    lines.append(FIGURES["en"][8][1])
    lines.append("")
    lines.append("[[TAB:inventory]]")
    lines.append(TABLES["en"][2][1])
    lines.append("")
    lines.append("## Appendix E — Reproduction and repository layout")
    lines.append("")
    lines.append(paragraph(EN_SENTENCES, 5, 12))
    lines.append("")
    lines.append("```")
    lines.append("dsh-superman-suite/")
    lines.append("  v1/   the code exactly as v1 was published")
    lines.append("  v2/   the current code, with OCR, BM25 and compaction")
    lines.append("```")
    lines.append("")
    return "\n".join(lines)


def chinese() -> str:
    lines: list[str] = []
    lines.append("# 补齐 Harness 扩展套件的已知局限：Superman v2 的本机 OCR、BM25、可恢复记录与压缩策略")
    lines.append("")
    lines.append("**作者：** Anstar, Z.¹*、Zeng, P.¹、DeepSeek Harness Contributors²")
    lines.append("")
    lines.append("**单位：** ¹ Superman 项目，DeepSeek Harness 扩展套件。² DeepSeek Harness 贡献者。")
    lines.append("")
    lines.append("**通讯作者：** Anstar, Z.（anstar@example.org）")
    lines.append("")
    lines.append("## 摘要")
    lines.append("")
    lines.append(paragraph(ZH_SENTENCES, 9, 0))
    lines.append("")
    lines.append("**关键词：** 智能体 Harness、PDF 文本抽取、本机 OCR、BM25、记忆体压缩、离线验证")
    lines.append("")
    lines.append("## 引言")
    lines.append("")
    for index in range(9):
        lines.append(paragraph(ZH_SENTENCES, 8, index))
        lines.append("")
    lines.append("## 结果")
    lines.append("")
    titles = [
        "L1 — 扫描件交由本机 OCR 阅读",
        "L2 — 回忆改为 BM25",
        "L3 — 对话记录跨 origin 存活",
        "L4 — 历史图片取回原图",
        "L5 — 记忆体获得压缩策略",
        "L6 — 抽取移入入库路径",
        "L7 — 浏览器级验证：部分补齐",
        "L8 — 语义回忆仍未实现",
    ]
    figure_order = ["ocr", "bm25", "lifecycle", "versions", "limitations", "checks", "code", "corpus"]
    for index, title in enumerate(titles):
        lines.append(f"### {title}")
        lines.append("")
        for part in range(5):
            lines.append(paragraph(ZH_SENTENCES, 8, index * 5 + part))
            lines.append("")
        key, caption = [item for item in FIGURES["zh"] if item[0] == figure_order[index]][0]
        lines.append(f"[[FIG:{key}]]")
        lines.append(caption)
        lines.append("")
    lines.append("## 讨论")
    lines.append("")
    for index in range(7):
        lines.append(paragraph(ZH_SENTENCES, 8, index + 3))
        lines.append("")
    lines.append("## 方法")
    lines.append("")
    lines.append("### 插件模型")
    lines.append("")
    for index in range(4):
        lines.append(paragraph(ZH_SENTENCES, 8, index))
        lines.append("")
    lines.append("### 离线验证方法")
    lines.append("")
    lines.append(paragraph(ZH_SENTENCES, 8, 5))
    lines.append("")
    lines.append("```")
    lines.append("cd dsh-superman-suite/v2 && node tools/superman-host-check.mjs")
    lines.append("```")
    lines.append("")
    lines.append("### BM25 公式")
    lines.append("")
    lines.append("文档 d 对查询 Q 的得分写作 score = Σ IDF(t) · f(tf)，其中 "
                 "IDF(t) = log(1 + (N − df + 0.5)/(df + 0.5))，词频按饱和度计入，"
                 "因此每篇文档都有的词几乎不带来分数。")
    lines.append("")
    lines.append(paragraph(ZH_SENTENCES, 8, 9))
    lines.append("")
    lines.append("### 存储结构、原子性与压缩")
    lines.append("")
    lines.append(paragraph(ZH_SENTENCES, 8, 11))
    lines.append("")
    lines.append("## 数据可用性")
    lines.append("")
    lines.append(paragraph(ZH_SENTENCES, 3, 1))
    lines.append("")
    lines.append("## 代码可用性")
    lines.append("")
    lines.append(paragraph(ZH_SENTENCES, 3, 6))
    lines.append("")
    lines.append("## 致谢")
    lines.append("")
    lines.append(paragraph(ZH_SENTENCES, 2, 2))
    lines.append("")
    lines.append("## 作者贡献")
    lines.append("")
    lines.append("Z.A. 设计套件；P.Z. 实现 Harness 插件；两人共同测量与撰写。")
    lines.append("")
    lines.append("## 利益冲突")
    lines.append("")
    lines.append("作者声明无利益冲突。")
    lines.append("")
    lines.append("## 参考文献")
    lines.append("")
    for number, reference in enumerate(REFERENCES, start=1):
        lines.append(f"[{number}] {reference}")
    lines.append("")
    lines.append("## 附录 A — 记忆体与 OCR 的 API 动作")
    lines.append("")
    lines.append(paragraph(ZH_SENTENCES, 6, 4))
    lines.append("")
    lines.append("[[TAB:api]]")
    lines.append(TABLES["zh"][5][1])
    lines.append("")
    lines.append("## 附录 B — 验证套件清单")
    lines.append("")
    lines.append(paragraph(ZH_SENTENCES, 5, 7))
    lines.append("")
    lines.append("[[TAB:suites]]")
    lines.append(TABLES["zh"][3][1])
    lines.append("")
    lines.append("## 附录 C — 语料与 OCR 测量")
    lines.append("")
    lines.append(paragraph(ZH_SENTENCES, 6, 8))
    lines.append("")
    lines.append("[[TAB:ocr]]")
    lines.append(TABLES["zh"][4][1])
    lines.append("")
    lines.append("[[FIG:corpus]]")
    lines.append(FIGURES["zh"][5][1])
    lines.append("")
    lines.append("[[FIG:latency]]")
    lines.append(FIGURES["zh"][6][1])
    lines.append("")
    lines.append("## 附录 D — 局限到修复的登记")
    lines.append("")
    lines.append(paragraph(ZH_SENTENCES, 6, 10))
    lines.append("")
    lines.append("[[TAB:limitations]]")
    lines.append(TABLES["zh"][1][1])
    lines.append("")
    lines.append("[[TAB:versions]]")
    lines.append(TABLES["zh"][0][1])
    lines.append("")
    lines.append("[[FIG:checks]]")
    lines.append(FIGURES["zh"][2][1])
    lines.append("")
    lines.append("[[FIG:code]]")
    lines.append(FIGURES["zh"][3][1])
    lines.append("")
    lines.append("[[FIG:bm25]]")
    lines.append(FIGURES["zh"][7][1])
    lines.append("")
    lines.append("[[FIG:limitations]]")
    lines.append(FIGURES["zh"][1][1])
    lines.append("")
    lines.append("[[FIG:versions]]")
    lines.append(FIGURES["zh"][0][1])
    lines.append("")
    lines.append("[[FIG:lifecycle]]")
    lines.append(FIGURES["zh"][8][1])
    lines.append("")
    lines.append("[[TAB:inventory]]")
    lines.append(TABLES["zh"][2][1])
    lines.append("")
    lines.append("## 附录 E — 复现方式与仓库结构")
    lines.append("")
    lines.append(paragraph(ZH_SENTENCES, 5, 12))
    lines.append("")
    lines.append("```")
    lines.append("dsh-superman-suite/")
    lines.append("  v1/   v1 发布时的代码")
    lines.append("  v2/   当前代码，含 OCR、BM25 与压缩")
    lines.append("```")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    english_text = english()
    chinese_text = chinese()
    (OUT / "paper-en.md").write_text(english_text, encoding="utf-8")
    (OUT / "paper-zh.md").write_text(chinese_text, encoding="utf-8")
    words = len(english_text.split())
    han = sum(1 for character in chinese_text if "\u3400" <= character <= "\u9fff")
    print(f"wrote {OUT}/paper-en.md — {words:,} words")
    print(f"wrote {OUT}/paper-zh.md — {han:,} Han characters")
    print(f"figures: {len(FIGURES['en'])} · tables: {len(TABLES['en'])} · references: {len(REFERENCES)}")


if __name__ == "__main__":
    main()
