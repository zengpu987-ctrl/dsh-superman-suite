# The v2 publication pipeline

Four scripts produce `papers/v2/data/metrics.json`, `papers/v2/figures/{en,zh}/`
and the two PDFs. Everything is measured on this machine; nothing is typed in by
hand except the label dictionaries and the table headers inside the scripts.

Run them in this order (from the workspace root):

```sh
# 1. measurements — suites, v1→v2 code delta, corpus/encoding/math re-use,
#    OCR re-measurement (PyMuPDF + macOS Vision), the worked BM25 example
/tmp/pdfenv/bin/python papers/v2/tools/metrics.py

# 2. figures 1–9 for both languages, drawn from the fresh metrics
MPLCONFIGDIR=/tmp/mpl /opt/anaconda3/bin/python3 papers/v2/tools/figures.py

# 3. the two PDFs; the body size is auto-fitted to ~19 pages per language
/tmp/pdfenv/bin/python papers/v2/tools/build_pdf.py
```

Supporting pieces:

- `rasterize.py` — rasterises one page into an image-only PDF (so its text layer
  is empty) and reports a PDF's text-layer character and Han counts. Called by
  `metrics.py`; usable on its own with `--inspect`.
- `bm25-probe.mjs` — runs the shipped `superman/index.js` internals over the
  synthetic two-document corpus and prints the flat-vs-BM25 worked example.
- `synthetic_manuscript.py` — writes stand-in manuscripts to `/tmp/v2-synth/`
  for pipeline tests when `papers/v2/paper-{en,zh}.md` are not on disk. The
  builder never writes placeholder content into the repository.

Environment overrides: `DSH_PYMUPDF_PYTHON` (default `/tmp/pdfenv/bin/python`),
`DSH_TEST_CORPUS` (extra corpus PDFs for the suite runs), `DSH_OCR_SRC_A` /
`DSH_OCR_SRC_B` (the pages the OCR re-measurement rasterises), `DSH_V1_COMMIT`
(default `52b99e6`).

`build_pdf.py` verifies its own output with PyMuPDF and exits non-zero when the
English PDF is outside 18–20 pages, a page is blank, a figure or table of the
programme is missing, a featured numeral is absent from the text layer, a
caption sits on the wrong side of its float, or text lands in the margins.
