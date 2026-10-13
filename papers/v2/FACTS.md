# FACTS v2 — the single source of truth for the v2 papers and figures

Both v2 manuscripts (English and Chinese) and every v2 figure must agree with this file.
Numbers here are measured on this machine; do not invent others. Read the code and the
v1 material (`../FACTS.md`, `../paper-en.md`) for depth, but cite only the references
listed in §7.

## 1. What the v2 paper is

v1 (published as `papers/paper-en.pdf` / `paper-zh.pdf`, 8 pages each) built the suite and
honestly listed eight limitations. v2 **closed six of them, partially closed one, and could
not close one**, and grew the offline verification from 284 to 449 checks. The v2 paper
documents that work: the limitations, the fixes, the evidence, and what remains.

Both versions now live in the same repository: `v1/` is the code exactly as v1 was
published, `v2/` is the current code.

## 2. The eight v1 limitations and their v2 outcome (the paper's spine)

| # | v1 limitation | v2 outcome | evidence |
|---|---|---|---|
| L1 | PDF extraction reads the text layer only; scans yield nothing | **closed**: on-device OCR via macOS Vision, wired into the Chat upload path as an automatic fallback | a page rasterised to an image-only PDF has **0** characters in its text layer; OCR reads **3 411 characters, 979 of them Han**. A second rasterised page: layer 1 char → OCR 1 341 chars / 1 072 Han. A 19-page brochure whose embedded CMap is broken yields 9 423 chars with only 9 Han; OCR yields 11 333 chars / 66 Han |
| L2 | Recall was a flat additive lexical score that favoured long documents | **closed**: BM25 (k1 = 1.2, b = 0.75) with IDF over name/body/record fields plus the recency term | the memory host suite proves a rare-term document ranks first and that a term present in every document is down-weighted by IDF |
| L3 | Conversation history lived in the page origin's `localStorage` | **closed**: every finished turn also writes a restorable JSON payload (`chatstate:<id>`, ≤ 7 900 characters, oldest turns dropped) beside the prose record; the memory merges into the list on start-up | the client suite proves a fresh origin (empty `localStorage`) restores a conversation, that a newer local copy is never overwritten by an older memory copy, that an older local copy **is** upgraded, and that a malformed payload is skipped without disturbing the list |
| L4 | Images in history kept only a 160 px thumbnail and resent as "unavailable" | **closed**: an image remembers the memory item id of its bytes; a resend fetches `GET /api/superman/file?id=…` and sends the original | the client suite proves the outgoing request body carries the base64 bytes and emits no "unavailable" note, and that a 404 falls back to that note while still sending |
| L5 | The memory grew without a compaction policy | **closed**: `maxItems` (2 000) and `maxBytes` (512 MiB) caps, oldest-first eviction deleting file and entry, start-up reconciliation of orphans and missing files, `prune`, and eviction counters in `stats` | the host suite proves eviction removes both the entry and its file, that the byte cap holds, that reconciliation clears orphans and missing-file entries, and that `index.json` stays valid JSON |
| L6 | Panel uploads and Harness captures stored PDF bytes without text | **closed**: `superman/pdf.js`, a Node port of the browser extractor, parses on store (200-page / 400 000-character caps, never failing the store) | the host suite compares the port against the browser extractor on real files and requires identical text |
| L7 | No automated browser-level (DOM) end-to-end test | **partially closed**: a workspace-local jsdom + React/ReactDOM toolchain and `tools/dom-check.mjs` exist and mount the panels with `createRoot`, driving real DOM events; jsdom/React environment differences are still being converged, so the suite is **not** part of the published tree | the suite mounts the Chat panel, types, sends, and starts a new conversation before hitting the remaining environment issue |
| L8 | Recall is not semantic | **not closed**: no embedding service exists on this machine. Retrieval stays lexical (now BM25); the seam is the single `recall(q)` function | stated as a limitation; the paper discusses what an embedding path would need |

## 3. Measured code delta (v1 → v2)

| file | v1 lines | v2 lines |
|---|---|---|
| `chat-mode/client.js` | 4 017 | 4 281 |
| `chat-mode/index.js` | 255 | 255 |
| `superman/client.js` | 1 320 | 1 320 |
| `superman/index.js` | 666 | 908 |
| `superman/pdf.js` | — | 799 |
| `superman-ocr/index.js` | — | 383 |
| `superman-ocr` Swift tool (`tools/ocr-pdf.swift`) | — | ~190 |
| `arxiv-search/client.js` / `index.js` | 784 / 139 | 784 / 139 |

Bundle JavaScript: v1 7 187 lines → v2 8 869 lines (bundles plus the new extractor and OCR
bundle). Verification code: `chat-mode-check.mjs` 445 → 823 lines, `superman-host-check.mjs`
199 → 501, plus the new `superman-ocr-check.mjs`.

## 4. Verification (the paper's Results section)

| suite | v1 checks | v2 checks |
|---|---|---|
| chat pipeline (`chat-mode-check.mjs`) | 77 | **139** |
| rendering and decoding (`chat-mode-format-check.mjs`) | 59 | 59 |
| memory host (`superman-host-check.mjs`) | 39 | **71** |
| memory panel (`superman-check.mjs`) | 57 | 57 |
| arXiv bundle (`arxiv-smoke.mjs`) | 52 | 52 |
| OCR bundle (`superman-ocr-check.mjs`) | — | **71** |
| **total** | **284** | **449** |

All 449 are green on this machine. Every suite drives the shipped files: browser halves load
through a stub `window.__ModuleLoader__` with a stub React whose function components are
invoked directly, an in-memory `localStorage` and a stubbed `fetch`; host halves run against
a fake Cordis context with a temporary memory directory. Real inputs are used where they
exist (a 14-document PDF corpus, real encoding probes, the real OCR binary).

## 5. v1 corpus measurements (still valid; reuse)

14 real PDFs → 199 942 characters, 67 235 Han, 138 pages, **0** replacement or C1 control
characters; 5 documents with a text layer and 9 honest `no-text` reports. Median extraction
times: 34.7 ms for 19 pages, 71.8 ms and 71.3 ms for the two 54–56 page Chinese documents,
11.7 ms for a 7-page contract, 7.3 ms for 2 pages, 0.2–0.8 ms for the 9 textless vector
files. Encoding probes 7/7; the 16-expression LaTeX→MathML battery is 16/16 clean.
File names are aliases (see `../data/metrics.json`); never print the real ones.

## 6. Figure and table programme (clearer than v1)

Design rules for every figure: no redundant in-image title when the caption already names the
figure; one message per panel; direct labels instead of a legend when there is room; a light
grid and no chartjunk; ≥ 260 dpi; all-CJK or all-Latin labels per language (never mixed);
annotate the decisive number (e.g. "0 → 3 411"). Multi-panel figures must letter their panels
(a), (b), (c) and be referenced that way in the text.

- `[[FIG:versions]]` — (a) v1 topology, (b) v2 topology with OCR, hydration and compaction;
  one caption. **Figure 1**
- `[[FIG:limitations]]` — the eight limitations as a fix matrix: closed / partial / open,
  with the check delta per limitation. **Figure 2**
- `[[FIG:checks]]` — grouped bars, v1 vs v2 checks per suite, totals annotated. **Figure 3**
- `[[FIG:code]]` — stacked code growth per module (v1 vs v2), new files highlighted. **Figure 4**
- `[[FIG:ocr]]` — the OCR result: text-layer vs OCR characters for each rasterised case,
  with the "0 → 3 411" annotation and the broken-CMap case. **Figure 5**
- `[[FIG:corpus]]` — extracted characters vs pages, the nine textless files on the zero line,
  the OCR-recovered cases marked. **Figure 6**
- `[[FIG:latency]]` — median extraction time vs pages, log-friendly, annotated. **Figure 7**
- `[[FIG:bm25]]` — worked BM25 example: two documents, one rare query term; scores before
  (flat) and after (BM25), showing the rank flip. **Figure 8**
- `[[FIG:lifecycle]]` — the memory lifecycle: store → classify → extract/OCR → index →
  recall → compact, with the caps and the reconciliation step labelled. **Figure 9**
- `[[TAB:versions]]` — v1 vs v2: what changed, and where it takes effect (client HMR vs host restart)
- `[[TAB:limitations]]` — limitation → fix → evidence → status
- `[[TAB:inventory]]` — v1/v2 source inventory
- `[[TAB:suites]]` — v1/v2 suite inventory with what each drives
- `[[TAB:ocr]]` — the OCR measurements per case (layer chars → OCR chars/Han, pages, ms)
- `[[TAB:api]]` — the memory/OCR API actions added or changed in v2

The generator inserts all tables from `papers/v2/data/metrics.json`; the manuscripts only
place the placeholder and a caption line.

## 7. References — cite **at least 40** of these 46, in order of first appearance

Give each as `[n] Author(s), Title, Venue/Spec, Year. URL` in Nature style (numbered,
superscript in text is optional; use `[n]`). Only these may be cited.

1. DeepSeek Harness — https://github.com/deepseek-ai/deepseek-harness
2. Cordis plugin framework — https://github.com/cordiverse/cordis
3. ISO 32000-1:2008, Document management — Portable document format — Part 1: PDF 1.7.
4. Adobe Systems, PDF Reference, 6th edn (FlateDecode, ToUnicode CMaps), 2006.
5. ISO 19005-1:2005, PDF/A-1 (archival PDF).
6. R. Smith, An overview of the Tesseract OCR engine, ICDAR 2007.
7. Apple Inc., Vision framework — VNRecognizeTextRequest, developer documentation.
8. Apple Inc., PDFKit framework, developer documentation.
9. W3C, MathML Core, W3C Recommendation.
10. KaTeX — https://katex.org/
11. MathJax — https://www.mathjax.org/
12. STIX Two fonts — https://github.com/stipub/stixfonts
13. The Unicode Consortium, The Unicode Standard, Version 15.
14. WHATWG, Encoding Standard (GBK, Big5, Shift_JIS, EUC-KR decoders).
15. WHATWG, HTML Living Standard, § Server-sent events.
16. WHATWG, HTML Living Standard, § Web storage (localStorage).
17. React — https://react.dev/
18. jsdom — https://github.com/jsdom/jsdom
19. S. Robertson and H. Zaragoza, The probabilistic relevance framework: BM25 and beyond, Found. Trends IR 3(4), 2009.
20. S. E. Robertson, S. Walker, S. Jones, M. M. Hancock and M. Beaulieu, Okapi at TREC-3, TREC 1994.
21. G. Salton and C. Buckley, Term-weighting approaches in automatic text retrieval, Inf. Process. Manag. 24(5), 1988.
22. K. Sparck Jones, A statistical interpretation of term specificity and its application in retrieval, J. Doc. 28(1), 1972.
23. K. Karpukhin et al., Dense passage retrieval for open-domain question answering, EMNLP 2020.
24. N. Reimers and I. Gurevych, Sentence-BERT, EMNLP 2019.
25. O. Khattab and M. Zaharia, ColBERT, SIGIR 2020.
26. P. Lewis et al., Retrieval-augmented generation for knowledge-intensive NLP tasks, NeurIPS 2020.
27. J. Johnson, M. Douze and H. Jégou, Billion-scale similarity search with GPUs (FAISS), IEEE Trans. Big Data, 2019.
28. Y. A. Malkov and D. A. Yashunin, Efficient and robust approximate nearest neighbour search using HNSW, IEEE TPAMI, 2018.
29. N. F. Liu et al., Lost in the middle: how language models use long contexts, TACL 2024.
30. C. Packer et al., MemGPT: towards LLMs as operating systems, 2023, arXiv:2310.08560.
31. J. S. Park et al., Generative agents: interactive simulacra of human behavior, UIST 2023.
32. S. Yao et al., ReAct: synergizing reasoning and acting in language models, ICLR 2023.
33. T. Schick et al., Toolformer: language models can teach themselves to use tools, NeurIPS 2023.
34. arXiv API user manual — https://info.arxiv.org/help/api/user-manual.html
35. M. Kleppmann, Designing Data-Intensive Applications, O'Reilly, 2017 (atomic replace, idempotence).
36. GitHub, REST API for repository creation and contents.
37. Git project — https://git-scm.com/
38. MIT License — https://opensource.org/license/mit
39. OpenAI et al., GPT-4 Technical Report, 2023, arXiv:2303.08774 (used only as a corpus sample).
40. V. I. Levenshtein, Binary codes capable of correcting deletions, insertions and reversals, 1966 (edit distance, for OCR error discussion).
41. A. H. Barr and J. Feigenbaum (eds), Handbook of OCR, 1981 — only if you can cite it accurately; otherwise replace with: L. R. Rabiner, A tutorial on hidden Markov models, Proc. IEEE 77(2), 1989 (the classic OCR/sequence-decoding reference).
42. J. Devlin et al., BERT, NAACL 2019.
43. A. Vaswani et al., Attention is all you need, NeurIPS 2017.
44. T. Brown et al., Language models are few-shot learners, NeurIPS 2020.
45. D. E. Knuth, The TeXbook, Addison-Wesley, 1984.
46. C. A. R. Hoare, Proof of a program: FIND (or, if you prefer a systems reference: L. Lamport, Time, clocks, and the ordering of events in a distributed system, CACM 21(7), 1978).

If a reference cannot be stated accurately, drop it and use another from the list; never
invent one.

## 8. Manuscript structure (Nature style, ~19 pages)

Nature article conventions: no numbered section headings in the abstract; Introduction,
Results, Discussion, Methods, then back matter. Our required appendix comes after Methods.

- Title (invent a real one; keep it factual).
- Authors: **Anstar, Z.¹ et al.** with `¹` affiliations; add `Zeng, P.¹` and
  `DeepSeek Harness Contributors²` as co-authors after Anstar. Corresponding author marked
  with `*` and a contact line.
- Abstract (unreferenced, ≤ 250 words): the problem, what changed, the headline numbers.
- Introduction (~1 200 words): agentic harnesses, the three subsystems, why limitations
  deserve a paper of their own, contributions list.
- Results (the bulk, ~6 000–8 000 words) with subsections from §2's eight limitations:
  L1 OCR, L2 BM25, L3 durable history, L4 image fidelity, L5 compaction, L6 store-time
  extraction, L7 DOM verification (partial), L8 semantic recall (open); each with method,
  measurement and figure/table references.
- Discussion (~1 200 words): what a "closing the limitations" pass teaches; honesty about
  L7/L8; threats to validity.
- Methods (~2 000 words): the harness plugin model, the offline verification methodology,
  the OCR pipeline (Vision parameters, compile-on-first-use), the BM25 formulation with
  formulas written as inline math, the storage schema and atomicity, the compaction policy,
  the DOM harness, and reproduction commands.
- Data availability, Code availability, Acknowledgements, Author contributions,
  Competing interests.
- References (≥ 40, from §7 only).
- **Appendix A–E**: A the memory and OCR API actions; B the verification suite inventory
  and what each check family drives; C the corpus and OCR measurement tables; D the
  limitation-to-fix-to-evidence register; E reproduction commands and the repository layout
  (v1/ and v2/ side by side).

Length: 11 000–13 500 English words (or 19 000–23 000 Han characters for the Chinese
version) of body text excluding references and appendix tables, which should bring the
typeset article to about 19 pages including figures.

Inline math must be written as plain Unicode/Latin (e.g. `score = Σ IDF·f(tf)`), never as
LaTeX; the typesetter renders it with the STIX scientific fonts.

## 9. Typesetting requirements (the pipeline agent)

- Nature-like layout: single wide column, generous margins, sans-serif (Helvetica Neue)
  title/section headings and figure labels, **scientific body face**: STIX Two Text if
  present on the machine (`/System/Library/Fonts/Supplemental/STIXTwoText*.otf`), otherwise
  Times/`STIXGeneral`; STIX Two Math for symbols; small caps or bold run-in for the
  back-matter headings; abstract in a slightly narrower measure.
- ~19 pages for the English article; the Chinese one may differ by ±1 page.
- Figures 1–9 with captions **below**, tables 1–6 with captions **above**, both generated
  from `papers/v2/data/metrics.json`; no hand-written tables in the manuscripts.
- Page numbers, a running header, and no overlapping or clipped text; verify every page
  renders and that featured numerals appear in the text layer.
