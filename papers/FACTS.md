# FACTS — the single source of truth for the two papers

Everything in this file is measured from the working system or read from its source.
Both manuscripts (English and Chinese) must agree with it. Do not invent numbers,
features, benchmarks, users, or citations beyond the reference list below.

## 1. What the system is

A suite of extension bundles for **DeepSeek Harness (DSH)**, an agentic coding
harness whose UI is a browser application served from `http://127.0.0.1:19387`.
The suite adds three user-facing capabilities to that harness **without forking it**:

1. **Chat mode** (`@local/dsh-chat-mode`) — a ChatGPT-style conversation panel beside
   the agent, with saved conversation history, attachments (PDF / Mathematica notebook /
   image / text / web page), DeepSeek model and thinking-effort selection, Markdown +
   LaTeX typesetting, and no tool use.
2. **Superman memory** (`@local/dsh-superman`) — a smart folder in the sidebar: every file
   or image uploaded in either mode is classified (PDF / image / code / other) into
   `~/.dsh/superman`, conversation and task records are mirrored into the same core, and
   both modes recall it while they think.
3. **arXiv bookmarking** (an addition to `@local/dsh-arxiv`) — each arXiv search result
   gains a *save to memory* button that downloads the paper's PDF and archives it into
   Superman, degrading to a metadata record when the download is blocked.

The suite is installed into a *profile* with `plugin_manager install_bundle`; no DSH
source is modified.

## 2. Architecture in one page

```
                    browser (DSH Web GUI, React, theme tokens)
   ┌───────────────────────────┬───────────────────────────────┬───────────────────┐
   │ Chat panel (main key chat)│ Superman panel (main superman)│ arXiv settings    │
   │  · history column         │  · category folders           │  section          │
   │  · composer, pickers      │  · preview, search, upload    │  · bookmark btn   │
   │  · Markdown + MathML      │  · toast watcher (4 s poll)   │                   │
   └─────────────┬─────────────┴──────────────┬────────────────┴─────────┬─────────┘
                 │ fetch (same origin, authenticated /api channel)        │
   ┌─────────────▼────────────────────────────▼───────────────────────────▼─────────┐
   │ Host (Node) — two plugin halves                                                 │
   │  chat-mode  POST /api/chat-mode/stream   → ctx.llm.stream(...) → SSE frames     │
   │  superman   POST /api/superman/api       → store/list/get/delete/note/recall     │
   │             GET  /api/superman/file?id=  → original bytes                        │
   │             systemPrompt.section()       → dynamic memory digest in every prompt │
   │             session/event listener       → captures Harness uploads + turn record│
   └─────────────────────────────────────────────────────────────────────────────────┘
```

Key mechanisms:

- **Slot system.** UI is contributed through `ctx.slots.inject(key, cb)` +
  `ctx.slots.register(options, component)`. The suite occupies `sidebar.panellist`
  (ids `conversation`, `chat`, `superman`), `main` (keys `chat`, `superman`),
  `settings.section` (id `arxiv`) and `shell.overlay` (id `superman.toast`).
  Existing shipped entries are never replaced; new ids are additive.
- **Authenticated transport.** Both Host halves register **exact Fetch routes on the
  authenticated `/api` channel** (`ctx.connection.fetch.register`), so they inherit
  the Host/Origin trust fence and the browser-session credential without adding any
  new listening socket.
- **Streaming.** Chat answers are `text/event-stream` frames written to a
  `ReadableStream`; the page reads them with `fetch` + `getReader()` and reassembles
  frames on `\n\n`. Aborting the request aborts the provider call (the route passes
  `request.signal` into `ctx.llm.stream`).
- **Prompt injection.** Superman registers a `systemPrompt.section` whose `text` is a
  *function*, so the digest is recomputed at every prompt assembly and always reflects
  the current memory contents.
- **Capture from both modes.** Chat uploads are posted to the memory by the panel;
  Harness uploads are captured by a `session/event` listener that walks committed
  events for attachment references, copies bytes through `ctx.attachments`, and writes
  a task record at `turn/end`.
- **Hot reload.** Client halves are plain ES modules served by the client-module graph;
  the HMR watcher polls each bundle's mtime/size every 500 ms, so UI changes reach the
  running page without a restart. Host halves are ordinary Node modules loaded by the
  Cordis loader: adding a *new* bundle activates through the loader immediately, while
  editing an installed Host half needs a process restart.

## 3. Subsystem notes (for the paper's main sections)

### 3.1 Chat mode

- Composer: attachments (paperclip / drag-and-drop / paste), model picker, thinking
  effort picker, memory switch, send ⇄ stop.
- Host route validates `{provider, model, reasoningEffort?, messages}`; images arrive as
  base64 and are turned into durable attachment references with `ctx.attachments.saveImages`;
  limits: ≤8 MiB per image, ≤400 000 characters per text part, ≤200 messages.
- Failure modes are explicit: `provider-missing`, `model-missing`, `messages-missing`,
  `messages-empty`, `text-too-long`, `image-rejected`, `image-too-large`, and a terminal
  `finish{error}` frame that the panel renders as an error row.
- Conversation history is stored in the page origin's `localStorage` under
  `dsh.chat-mode.history.v1`: at most 40 conversations, 200 messages each, 3.5 M
  characters total, 40 000 characters of text per attachment; images keep a 160 px
  thumbnail and are replaced by an explicit note when resent.
- Markdown: fences, headings, lists, quotes, tables, inline code, links, emphasis.
- LaTeX → **MathML** with a 16-expression battery measured clean (no backslash leakage);
  the browser lays it out with `STIX Two Math` → `Latin Modern Math` → `Cambria Math`
  → `STIXGeneral`. Delimiters `$…$`, `$$…$$`, `\(…\)`, `\[…\]` and **bare LaTeX**
  (a line starting with `\frac{…}` or `\begin{…}…\end{…}`) are recognised; `$100`
  and `$200` are not mistaken for math.
- Attachments are decoded before they are inlined: BOM (UTF-8/UTF-16LE/BE) → strict
  UTF-8 → UTF-16 without a mark (NUL-pattern heuristic) → GBK / Big5 / Shift-JIS /
  EUC-KR / windows-1252, each candidate scored on how much of it reads as text; a file
  whose best reading is still noise is reported as binary instead of inlined.
- PDF text extraction is implemented in the bundle itself (no PDF library):
  object-table scan → `DecompressionStream` inflation (tolerating padding after the
  compressed data) → `/ToUnicode` CMap parsing → content-stream operator replay →
  per-page assembly, with object streams (`/ObjStm`), indirect `/Length`, inherited
  `/Resources`, ASCII85/ASCIIHex filter chains, and a CJK fallback for fonts declared
  `WinAnsiEncoding` that actually carry GBK/Big5/Shift-JIS bytes.

### 3.2 Superman memory

- Storage: `<root>/index.json` + `<root>/files/<id>` where `<root>` is
  `dshHomePath('superman')` = `~/.dsh/superman`. Writes are serialised and atomic
  (write-temp + rename).
- Classification order: magic bytes (`%PDF-`, PNG/JPEG/GIF/BMP/RIFF-WEBP, `PK\x03\x04`)
  → MIME → extension (code extensions include `nb`, `wl`, `m`, `py`, `js`, …) →
  content heuristic (shebang, or ≥2 code features). Image dimensions are read from the
  PNG/JPEG/GIF/WebP header without an image library.
- Recall: query tokenisation (latin words + CJK characters + CJK bigrams), name match
  weight 4, body match 1.5/1.2, a recency term up to 1.5, top-*k* (default 6) rendered
  as a prompt-ready digest.
- Prompt digest: folder path, per-category counts, the 24 most recent items with an
  80-character snippet, the 6 most recent records, and the instruction to read files
  under `files/` when full content is needed.
- Notices: a 4-second watcher diffs the memory list and raises one toast per newly
  remembered item (`shell.overlay`, id `superman.toast`); the first poll is only a
  baseline, so a start-up does not replay history.
- Chat integration: uploads are stored with their extracted text; before each request
  the composer asks for a recall digest for the current question and prepends it to the
  user turn; each finished turn mirrors the conversation into a record
  (`id = chat:<conversationId>`); a composer switch turns recall off per browser.

### 3.3 arXiv bookmarking

- `arxiv.org` PDF responses carry `access-control-allow-origin: *` (verified with a
  HEAD request), so the page downloads the PDF itself — no host proxy is needed.
- The button posts `{action:'store', source:'arxiv', base64, text:<metadata+abstract>}`
  to the memory; when the download fails it posts `{action:'note'}` instead, so the
  paper still becomes recallable; when the memory itself is unavailable the button
  reports `归档失败` rather than pretending.

## 4. Measured numbers (use these, nothing else)

### 4.1 Source inventory (lines of JavaScript)

| module | files | lines | bytes |
|---|---|---|---|
| chat-mode | 2 (`index.js` 255, `client.js` 4017) | 4274 | 178 186 |
| superman | 2 (`index.js` 666, `client.js` 1320) | 1988 | 79 879 |
| arxiv-search | 2 (`index.js` 139, `client.js` 784) | 925 | 36 264 |
| **total** | 6 | **7187** | **294 329** |

### 4.2 Verification suites (all green)

| suite | purpose | checks | lines |
|---|---|---|---|
| `tools/chat-mode-check.mjs` | pipeline: route, SSE, history, attachments, memory wiring | 77 | 436 |
| `tools/chat-mode-format-check.mjs` | LaTeX→MathML, Markdown, decoding | 59 | 263 |
| `tools/superman-host-check.mjs` | classification, store, recall, capture | 39 | 199 |
| `tools/superman-check.mjs` | panel: entry, folders, preview, upload, notices | 57 | 348 |
| `tools/arxiv-smoke.mjs` | arXiv bundle incl. bookmark paths | 52 | 450 |
| **total** | | **284** | **1696** |

Every suite drives the *shipped* files: the browser halves are loaded with a stub
`window.__ModuleLoader__`, a stub React whose function components are invoked
directly, a memory `localStorage` and a stubbed `fetch`; the Host halves run against a
fake Cordis context with a temporary memory directory.

### 4.3 PDF extraction over a real corpus (14 files, 199 942 characters)

| file | bytes | median ms | chars | CJK | noise | pages | note |
|---|---|---|---|---|---|---|---|
| prospectus-2025.pdf | — | 71.8 | 90 938 | 31 791 | 0 | 56 | |
| prospectus-2026.pdf | — | 71.3 | 89 764 | 31 252 | 0 | 54 | |
| brochure.pdf | — | 34.7 | 9 423 | 9 | 0 | 19 | thin text layer |
| contract-2027.pdf | — | 11.7 | 9 031 | 3 789 | 0 | 7 | |
| document-B.pdf | — | 7.3 | 786 | 394 | 0 | 2 | |
| 9 × Apple system PDFs (vector art) | — | 0.2–0.8 | 0 | 0 | 0 | 0 | `no-text` |

Aggregate: 199 942 characters, 67 235 CJK characters, 138 pages, **0** replacement or
C1 control characters (`noise` column), 5 text-bearing documents and 9 honest
`no-text` reports. Median extraction time 34.7 ms for a 19-page document and 11.7 ms
for a 7-page contract; the two 54–56-page Chinese documents take ≈72 ms each.

### 4.4 Encoding detection (7 probes, 7 correct)

| probe | expected | detected | plausibility |
|---|---|---|---|
| UTF-8 | utf-8 | utf-8 | high |
| UTF-8 BOM | utf-8 | utf-8 | high |
| GBK (`a` + C4 E3 BA C3) | gbk | gbk | — |
| Big5 (A4 A4 A4 E5) | big5 | big5 | — |
| UTF-16LE without BOM | utf-16le | utf-16le | — |
| PNG header | binary | binary | — |
| random high bytes | binary | binary | — |

### 4.5 Math rendering (16 expressions)

16/16 produce well-formed `<math>` markup, 16/16 with no LaTeX backslash left in the
output; the battery covers fractions, roots, scripts, big operators, matrices, `cases`,
accents, `\mathbb`/`\mathcal`, `\left…\right`, and a bracketed identity matrix.
`papers/data/metrics.json` holds the per-expression markup lengths and node counts.

### 4.6 Live deployment observations

- The suite's three sidebar entries are active in the running page
  (`conversation` −20, `chat` −10, `superman` −5) alongside the shipped `plugins` (0).
- The toast stack registers as `shell.overlay[superman.toast]` next to nine shipped
  occupants.
- The memory's dynamic prompt section was observed inside the running agent's own
  system prompt, listing the live folder path and counts (`PDF 2 · 图片 0 · 程序 0 ·
  其他 0 · 对话/任务记录 2`) — i.e. Harness-mode recall is exercised by this very session.
- Two PDFs were captured into the memory during development: a 203.4 KB scanned
  document and a 5.0 MB arXiv paper stored through the bookmark button.

## 5. Limitations to state honestly

- PDF extraction is a text-layer reader: scanned or outlined documents yield nothing
  and are reported as such (9 of the 14 corpus files); it does not rasterise or OCR.
- Recall is lexical (token overlap + recency), not embedding-based; it is deterministic
  and cheap but limited to surface similarity. CJK handling uses characters and bigrams.
- Chat history lives in the page origin's `localStorage`: it survives restarts but not
  clearing site data, and it is not shared with the `dsh web` profile on another port.
- Images restored from history keep a thumbnail only; resending an old turn marks the
  image as unavailable instead of silently dropping it.
- The suite has no automated browser-level (end-to-end DOM) test: verification is
  offline suites plus live slot/prompt inspection, so visual details are unverified.
- The memory grows without a compaction policy beyond caps (item count, note count are
  bounded, but no deduplication beyond content hash + name).

## 6. Reference list (real, verifiable — cite these, no others)

1. DeepSeek Harness — https://github.com/deepseek-ai/deepseek-harness
2. Cordis plugin framework — https://github.com/cordiverse/cordis
3. ISO 32000-1:2008, *Document management — Portable document format — Part 1: PDF 1.7*.
4. Adobe Systems, *PDF Reference, 6th edition* (FlateDecode, ToUnicode CMaps) — https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.6.pdf
5. W3C, *MathML Core* — https://www.w3.org/TR/mathml-core/
6. WHATWG, *Encoding Standard* (GBK, Big5, Shift_JIS, EUC-KR decoders) — https://encoding.spec.whatwg.org/
7. WHATWG, *HTML Living Standard*, § Server-sent events — https://html.spec.whatwg.org/multipage/server-sent-events.html
8. D. E. Knuth, *The TeXbook*, Addison-Wesley, 1984.
9. KaTeX — https://katex.org/
10. S. Robertson and H. Zaragoza, "The probabilistic relevance framework: BM25 and beyond", *Foundations and Trends in Information Retrieval*, 3(4):333–389, 2009.
11. arXiv API user manual — https://info.arxiv.org/help/api/user-manual.html
12. OpenAI et al., "GPT-4 Technical Report", arXiv:2303.08774, 2023. (used only as a corpus sample, not as a design claim)
13. STIX Two Math font — https://github.com/stipub/stixfonts
14. React — https://react.dev/

## 7. Paper skeleton both manuscripts must follow

`papers/paper-en.md` (English) and `papers/paper-zh.md` (Chinese) are produced from
this skeleton with the same section numbering, the same figures and the same tables:

- Title (choose a real title; see below), authors, affiliation, contact.
- Abstract (150–250 words) + 5–8 keywords.
- 1 Introduction (motivation: agent harnesses have a terminal-like UI; the gap is a
  plain conversational surface, durable memory, and literature capture; contributions
  list).
- 2 Background and related work (DSH/Cordis plugin model; PDF text extraction; MathML
  vs KaTeX; lexical retrieval; harness memory approaches).
- 3 System architecture (the figure above; slot table; transport; streaming; hot reload).
- 4 Chat mode (conversation surface, attachments, decoding, PDF reader, LaTeX→MathML,
  history storage).
- 5 Superman memory (storage schema, classification, recall scoring, prompt injection,
  dual-mode capture, notices).
- 6 Literature capture (arXiv bookmarking with the CORS finding and the fallback).
- 7 Evaluation (the source inventory, the 284 checks, the PDF corpus table, the
  encoding probes, the math battery; **Table 1–5** and **Figure 1–6** must be
  referenced in the text and listed in the captions).
- 8 Discussion, threats to validity, and limitations (section 5 of this file).
- 9 Conclusion and future work (embedding-based recall, OCR fallback, cross-origin
  memory sync, packaging as a profile bundle collection).
- Acknowledgements.
- References (numbered, from section 6 only).

Figures/tables to include, with the placeholders the generator understands:

- `[[FIG:architecture]]` — the architecture diagram (generated separately).
- `[[FIG:inventory]]` — bar chart of lines per module (data in 4.1).
- `[[FIG:suites]]` — bar chart of checks per suite (data in 4.2).
- `[[FIG:pdf-chars]]` — chart of extracted characters vs pages per corpus file (4.3).
- `[[FIG:pdf-latency]]` — chart of median extraction time vs document pages (4.3).
- `[[FIG:encoding]]` — chart of encoding probes correct (4.4).
- `[[TAB:inventory]]`, `[[TAB:suites]]`, `[[TAB:pdf]]`, `[[TAB:encoding]]`,
  `[[TAB:math]]`, `[[TAB:slots]]` (slot occupancy: slot / id / order / purpose).

The generator inserts the real table from the data files; in the manuscript write the
placeholder on its own line with a caption line directly under it:
`[[TAB:pdf]]` then `Table 3. PDF extraction over the corpus.`

Title suggestions (pick one, translate it for the Chinese manuscript):
- EN: "Extending an Agentic Coding Harness with a Conversational Surface, a Smart Memory, and Literature Capture"
- ZH: 《在智能体编码框架上构建对话界面、智能记忆体与文献捕获体系》
