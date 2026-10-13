**Anstar, Z.¹*, Zeng, P.¹, and DeepSeek Harness Contributors²**

📄 **PDF** — [English, 19 pages](https://github.com/zengpu987-ctrl/dsh-superman-suite/blob/main/papers/v2/paper-en.pdf) · [中文，19 页](https://github.com/zengpu987-ctrl/dsh-superman-suite/blob/main/papers/v2/paper-zh.pdf)
📦 **Sources** — [`papers/v2/`](https://github.com/zengpu987-ctrl/dsh-superman-suite/blob/main/papers/v2) (manuscripts, figures, measured data, reproduction scripts)

---

### Abstract

Agent harnesses accumulate capability faster than they retire their documented weaknesses, and a limitation recorded in a release note rarely receives the measurement that would show it closed. This paper reports the systematic closure of the eight limitations published with v1 of the Superman suite, an out-of-tree extension for DeepSeek Harness (DSH). Six were closed, one partially, and one not at all. On-device optical character recognition (OCR) through the macOS Vision framework turns image-only pages whose text layer holds zero characters into 3 411 recognised characters, 979 of them Han, and recovers 11 333 characters from a 19-page brochure whose embedded CMap is damaged. Recall was rebuilt as BM25 with k1 = 1.2 and b = 0.75 over name, body and record fields, so a rare query term now outranks a term every document carries. Conversations, images, capacity and store-time extraction moved into the memory: a fresh browser origin restores a conversation from the memory, a resent image is refetched byte-for-byte, PDFs are parsed as they are stored, and item and byte caps evict oldest-first while start-up reconciliation repairs the index. Offline verification grew from 284 to 449 checks across six suites. The browser-level DOM suite remains unconverged and semantic recall remains open because no embedding service exists on this machine; both are reported as such rather than presented as solved.

### 摘要

智能体编码框架的记忆通常止步于单次会话。我们此前为 DeepSeek Harness 构建的 Superman 扩展套件补上了这一缺口，并如实列出八条局限。本文报告随后的「关闭局限」工作：六条已关闭，一条部分关闭，一条未关闭。扫描件经本机 macOS Vision OCR 恢复为可回忆文本，一页文本层为 0 字符的栅格化页面被识别出 3 411 个字符、其中 979 个汉字。回忆打分改为 BM25（k1 = 1.2、b = 0.75）。每轮对话另写一条上限 7 900 字符的可还原载荷，记忆体在启动时把会话合并回列表。历史图片凭记忆条目 id 取回原始字节。记忆体加入 2 000 条与 512 MiB 双上限、最旧优先淘汰、启动对账与 prune。面板上传与 Harness 捕获的 PDF 在入库时自行抽取文本。离线检查由 284 项增至 449 项，代码由 7 187 行增至 8 869 行。DOM 测试与语义回忆未完成，本文说明其边界。

---

### What this paper reports

The previous article documented eight limitations of the Superman suite. This one closes six of them, partially closes a seventh, and says plainly why the eighth cannot be closed here:

| | limitation | outcome |
|---|---|---|
| L1 | scans have no text layer | **closed** — on-device OCR (macOS Vision); a rasterised page with **0** characters in its text layer yields **3 411 characters / 979 Han** |
| L2 | flat lexical recall favoured long documents | **closed** — BM25 (k1 = 1.2, b = 0.75) with IDF; the rare-term document moves from rank 2 to rank 1 |
| L3 | history lived in one origin's `localStorage` | **closed** — a restorable payload rides in the memory, so history survives a cleared origin or another port |
| L4 | images in history resent as "unavailable" | **closed** — the memory's item id brings the original bytes back |
| L5 | the memory only grew | **closed** — `maxItems`/`maxBytes` eviction, reconciliation, `prune` |
| L6 | panel and Harness PDFs stored without text | **closed** — store-time extraction, byte-identical to the browser reader |
| L7 | no browser-level DOM test | **partial** — the jsdom harness mounts and drives the panels, and is honest about what it cannot yet reproduce |
| L8 | recall is not semantic | **open** — no embedding service exists on this machine; the seam is one `recall(q)` function |

Offline verification grew from **284 to 449 checks** across six suites (the reader-comparison check needs a PDF corpus present; without one the suite reports 448 passed + 1 failed rather than a silent skip — stated in the paper).

Both revisions live in this repository: [`v1/`](https://github.com/zengpu987-ctrl/dsh-superman-suite/blob/main/v1) is the original release, [`v2/`](https://github.com/zengpu987-ctrl/dsh-superman-suite/blob/main/v2) is the current tree.

### Reproduce

```bash
git clone https://github.com/zengpu987-ctrl/dsh-superman-suite && cd dsh-superman-suite
node v2/tools/chat-mode-check.mjs && node v2/tools/superman-host-check.mjs   # 139 + 71 checks
python papers/v2/tools/metrics.py            # re-measure everything
MPLCONFIGDIR=/tmp/mpl python papers/v2/tools/figures.py
python papers/v2/tools/build_pdf.py          # rebuild both PDFs
```

### Cite

```bibtex
@article{superman-v2,
  author = {Anstar, Z. and Zeng, P. and DeepSeek Harness Contributors},
  title  = {Closing the Documented Limitations of an Agent-Harness Memory Extension},
  year   = {2026},
  note   = {On-device OCR, BM25 recall, durable history, image fidelity, compaction}
}
```

Comments, corrections and failed reproductions are very welcome below.
