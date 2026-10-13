#!/usr/bin/env python3
"""Collect every v2 measurement the article reports into ``papers/v2/data/metrics.json``.

Nothing here is estimated: the six shipped suites are executed, the v1 source is
read out of git, the corpus/encoding/math rows are copied from the v1 file, the
OCR numbers are re-measured on rasterised pages with PyMuPDF + macOS Vision (the
suite's own Swift tool), and the worked BM25 example is computed by the shipped
``superman/index.js`` internals.

Reproduction (from the workspace root, ``<workspace>``)::

    /tmp/pdfenv/bin/python papers/v2/tools/metrics.py

Individual commands it runs::

    # 1. the six offline suites, from dsh-superman-suite/v2
    cd dsh-superman-suite/v2
    for s in chat-mode-check chat-mode-format-check superman-host-check \
             superman-check arxiv-smoke superman-ocr-check; do node tools/$s.mjs; done

    # 1b. the same host suite, in a scratch cwd that also holds a real corpus
    #     (it compares the host and browser PDF readers on <cwd>/papers/*.pdf)
    mkdir -p /tmp/v2-corpus-run && ln -s <suite>/v2/{tools,superman,chat-mode,arxiv-search} /tmp/v2-corpus-run/
    cd /tmp/v2-corpus-run && node tools/superman-host-check.mjs

    # 2. v1 line counts
    git -C dsh-superman-suite show 52b99e6:<path> | wc -l

    # 3. v1 corpus / encoding / math battery: copied verbatim from papers/data/metrics.json

    # 4. OCR: rasterise a page (image-only PDF, no text layer), then read it back
    /tmp/pdfenv/bin/python papers/v2/tools/rasterize.py --src <in.pdf> --page 1 --out /tmp/raster.pdf --dpi 200
    swiftc -O -module-cache-path /tmp/clang-cache dsh-superman-suite/v2/tools/ocr-pdf.swift -o /tmp/ocr-pdf
    /tmp/ocr-pdf /tmp/raster.pdf --scale 2

    # 5. BM25 worked example
    node papers/v2/tools/bm25-probe.mjs

Environment overrides: ``DSH_PYMUPDF_PYTHON`` (interpreter with PyMuPDF, default
``/tmp/pdfenv/bin/python``), ``DSH_TEST_CORPUS`` (directory of extra corpus PDFs),
``DSH_OCR_SRC_A`` / ``DSH_OCR_SRC_B`` (the two PDFs the OCR re-measurement
rasterises; defaults point at files already in this workspace).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
V2 = ROOT / "papers" / "v2"
DATA_FILE = V2 / "data" / "metrics.json"
V1_DATA_FILE = ROOT / "papers" / "data" / "metrics.json"
SUITE_ROOT = ROOT / "dsh-superman-suite"
SUITE_V2 = SUITE_ROOT / "v2"
SUITE_TOOLS = SUITE_V2 / "tools"
V1_COMMIT = os.environ.get("DSH_V1_COMMIT", "52b99e6")

PYMUPDF_PYTHON = Path(os.environ.get("DSH_PYMUPDF_PYTHON", "/tmp/pdfenv/bin/python"))
RASTERIZE = Path(__file__).resolve().parent / "rasterize.py"
BM25_PROBE = Path(__file__).resolve().parent / "bm25-probe.mjs"

HAN = range(0x3400, 0xA000)


def run(command: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    """Run one command and return the finished process (text captured)."""
    return subprocess.run(command, cwd=str(cwd) if cwd else None, capture_output=True, text=True)


def ok_lines(output: str) -> tuple[int, int]:
    """Count `ok` and `FAIL` lines in one suite's output."""
    passed = sum(1 for line in output.splitlines() if line.startswith("  ok"))
    failed = sum(1 for line in output.splitlines() if line.startswith("FAIL"))
    return passed, failed


# --------------------------------------------------------------------------
# 1. the six suites
# --------------------------------------------------------------------------
SUITES = [
    ("chat-mode-check.mjs", "pipeline: route, SSE, history, attachments, memory wiring"),
    ("chat-mode-format-check.mjs", "rendering and decoding: LaTeX→MathML, Markdown, encodings"),
    ("superman-host-check.mjs", "memory host half: extraction, BM25 recall, caps, reconciliation"),
    ("superman-check.mjs", "memory panel: entry, folders, preview, upload, notices"),
    ("arxiv-smoke.mjs", "arXiv bundle including the bookmark path"),
    ("superman-ocr-check.mjs", "OCR bundle: route, envelope, compile-on-first-use, real engine"),
]


def measure_suites() -> list[dict]:
    """Run every shipped suite and record its exit code, check counts and wall clock."""
    rows = []
    for suite, purpose in SUITES:
        started = time.time()
        finished = run(["node", f"tools/{suite}"], cwd=SUITE_V2)
        elapsed = round((time.time() - started) * 1000)
        passed, failed = ok_lines(finished.stdout)
        rows.append({
            "suite": suite,
            "purpose": purpose,
            "ok": passed,
            "fail": failed,
            "exitCode": finished.returncode,
            "ms": elapsed,
            "green": finished.returncode == 0 and failed == 0,
            "lines": disk_lines(SUITE_TOOLS / suite),
            "cwd": "dsh-superman-suite/v2",
            "failures": [
                line.strip() for line in finished.stdout.splitlines() if line.startswith("FAIL")
            ],
        })
    return rows


def measure_suites_v1() -> list[dict]:
    """Re-run the five v1 suites from ``dsh-superman-suite/v1`` (the published v1 tree).

    The chat suite samples real PDFs when ``DSH_TEST_CORPUS`` is set, and the
    default scan of ``~/Downloads`` (recursive) decides how many it sees, so its
    total can move by a check or two between machines: that is why the recorded
    v1 figure in FACTS §4 and a fresh re-run may differ by one.
    """
    rows = []
    for suite, _purpose in SUITES:
        source = SUITE_ROOT / "v1" / "tools" / suite
        if not source.exists():
            continue
        finished = run(["node", f"tools/{suite}"], cwd=SUITE_ROOT / "v1")
        passed, failed = ok_lines(finished.stdout)
        rows.append({"suite": suite, "ok": passed, "fail": failed,
                     "exitCode": finished.returncode, "lines": disk_lines(source)})
    return rows


# FACTS §4's recorded table, kept beside the fresh measurement so the article
# and the data can be compared without guessing which one moved.
FACTS_SUITES = {
    "chat-mode-check.mjs": {"v1": 77, "v2": 139},
    "chat-mode-format-check.mjs": {"v1": 59, "v2": 59},
    "superman-host-check.mjs": {"v1": 39, "v2": 71},
    "superman-check.mjs": {"v1": 57, "v2": 57},
    "arxiv-smoke.mjs": {"v1": 52, "v2": 52},
    "superman-ocr-check.mjs": {"v1": None, "v2": 71},
}


def measure_suites_with_corpus(real_pdfs: list[Path]) -> dict:
    """Re-run the host suite in a scratch cwd that also holds a real PDF corpus.

    The host suite compares the host and browser PDF readers on every
    ``<cwd>/papers/*.pdf``; without a corpus present it reports that comparison
    over zero files, which fails. This run proves the comparison itself passes
    when a corpus is available.
    """
    scratch = Path(tempfile.mkdtemp(prefix="v2-corpus-run-"))
    for name in ("tools", "superman", "chat-mode", "arxiv-search", "superman-ocr"):
        source = SUITE_V2 / name
        if source.exists():
            (scratch / name).symlink_to(source)
    papers = scratch / "papers"
    papers.mkdir()
    linked = []
    for index, pdf in enumerate(real_pdfs):
        target = papers / f"corpus-{index + 1:02d}.pdf"
        target.symlink_to(pdf)
        linked.append(pdf.name)
    finished = run(["node", "tools/superman-host-check.mjs"], cwd=scratch)
    passed, failed = ok_lines(finished.stdout)
    return {
        "cwd": str(scratch),
        "corpusFiles": len(linked),
        "ok": passed,
        "fail": failed,
        "exitCode": finished.returncode,
        "green": finished.returncode == 0,
        "failures": [line.strip() for line in finished.stdout.splitlines() if line.startswith("FAIL")],
        "note": "the same suite with real PDFs in <cwd>/papers; proves the reader comparison itself passes",
    }


# --------------------------------------------------------------------------
# 2. v1 → v2 code delta
# --------------------------------------------------------------------------
DELTA_FILES = [
    ("chat-mode/client.js", True),
    ("chat-mode/index.js", True),
    ("superman/client.js", True),
    ("superman/index.js", True),
    ("superman/pdf.js", False),
    ("superman-ocr/index.js", False),
    ("tools/ocr-pdf.swift", False),
    ("arxiv-search/client.js", True),
    ("arxiv-search/index.js", True),
]
VERIFICATION_FILES = [
    "tools/chat-mode-check.mjs",
    "tools/superman-host-check.mjs",
    "tools/superman-ocr-check.mjs",
]


def v1_lines(path: str) -> int | None:
    """Line count of one file at the v1 commit, or None when the file is new.

    Counts newline characters (`wc -l`), the convention FACTS §3 uses.
    """
    finished = run(["git", "-C", str(SUITE_ROOT), "show", f"{V1_COMMIT}:{path}"])
    if finished.returncode != 0:
        return None
    return finished.stdout.count("\n")


def disk_lines(path: Path) -> int:
    """Line count of one file on disk (the v2 tree), `wc -l` style."""
    return path.read_text(encoding="utf-8").count("\n")


def measure_code_delta() -> dict:
    """v1 vs v2 line counts, bundle totals and verification-code growth."""
    files = []
    for relative, existed in DELTA_FILES:
        before = v1_lines(relative)
        after = disk_lines(SUITE_V2 / relative)
        files.append({
            "file": relative,
            "v1": before,
            "v2": after,
            "delta": None if before is None else after - before,
            "new": before is None,
        })
    # A reproducible total: every shipped .js file of each version's modules.
    modules = ("chat-mode", "superman", "arxiv-search", "superman-ocr")
    v2_js = 0
    for module in modules:
        directory = SUITE_V2 / module
        if not directory.exists():
            continue
        for source in sorted(directory.glob("*.js")):
            v2_js += disk_lines(source)
    v1_js = 0
    listing = run(["git", "-C", str(SUITE_ROOT), "ls-tree", "-r", "--name-only", V1_COMMIT]).stdout.splitlines()
    for name in listing:
        if re.fullmatch(r"(chat-mode|superman|arxiv-search)/[^/]+\.js", name):
            count = v1_lines(name)
            v1_js += count or 0
    verification = []
    for relative in VERIFICATION_FILES:
        before = v1_lines(relative)
        after = disk_lines(SUITE_V2 / relative)
        verification.append({"suite": relative.split("/")[-1], "v1": before, "v2": after, "new": before is None})
    return {
        "commit": V1_COMMIT,
        "files": files,
        "moduleJsTotals": {"v1": v1_js, "v2": v2_js, "delta": v2_js - v1_js},
        "factsBundle": {"v1": 7187, "v2": 8869, "source": "FACTS §3 (bundle files, includes the extractor and OCR bundle)"},
        "verification": verification,
        "sourceSwiftLines": disk_lines(SUITE_V2 / "tools" / "ocr-pdf.swift"),
    }


# --------------------------------------------------------------------------
# 3. attribution of the new checks to the eight limitations
# --------------------------------------------------------------------------
CHECK_LABEL = re.compile(r"check\(\s*[^,]+,\s*'((?:[^'\\]|\\.)*)'", re.S)
SUITE_LIMITATION = {
    "tools/chat-mode-check.mjs": None,
    "tools/chat-mode-format-check.mjs": None,
    "tools/superman-host-check.mjs": None,
    "tools/superman-check.mjs": None,
    "tools/arxiv-smoke.mjs": None,
    "tools/superman-ocr-check.mjs": "L1",
}
# Ordered keyword rules; the first bucket that matches wins. A label nothing
# matches lands in `other` and is reported, never guessed.
ATTRIBUTION_RULES = [
    ("L1", ("ocr", "scanned", "no text layer", "textless", "pdfocr", "recognised text", "compiled", "swiftc", "vision")),
    ("L2", ("bm25", "idf", "rare-term", "rare term", "common term")),
    ("L3", ("chatstate", "restore", "restoration", "payload", "local copy", "capped", "rememberconversation")),
    ("L4", ("image", "bytes come back", "hydrat", "memory id")),
    ("L5", ("evict", "prune", "maxbytes", "maxitems", "reconcil", "orphan", "caps", "cap holds")),
    ("L6", ("extract", "text layer", "tounicode", "flatedecode", "page count", "pdf reader", "reader", "session", "stored", "store ")),
    ("L7", ("dom",)),
    ("L8", ("semantic", "embedding", "vector")),
]


def bucket_of(label: str) -> str:
    """Assign one check label to a limitation bucket by keyword."""
    lowered = label.lower()
    for bucket, keywords in ATTRIBUTION_RULES:
        if any(keyword in lowered for keyword in keywords):
            return bucket
    return "other"


def measure_check_attribution() -> dict:
    """Diff the v1 and v2 check labels per suite and bucket the new ones."""
    per_suite = []
    totals: dict[str, int] = {}
    for relative, forced in SUITE_LIMITATION.items():
        v2_source = (SUITE_V2 / relative).read_text(encoding="utf-8")
        labels_v2 = CHECK_LABEL.findall(v2_source)
        v1_source = run(["git", "-C", str(SUITE_ROOT), "show", f"{V1_COMMIT}:{relative}"]).stdout
        labels_v1 = set(CHECK_LABEL.findall(v1_source)) if v1_source else set()
        new = [label for label in labels_v2 if label not in labels_v1]
        buckets: dict[str, int] = {}
        for label in new:
            bucket = forced or bucket_of(label)
            buckets[bucket] = buckets.get(bucket, 0) + 1
            totals[bucket] = totals.get(bucket, 0) + 1
        per_suite.append({
            "suite": relative.split("/")[-1],
            "labelsV1": len(labels_v1),
            "labelsV2": len(labels_v2),
            "newLabels": len(new),
            "buckets": buckets,
        })
    return {"perSuite": per_suite, "totals": totals,
            "note": "new check labels (static, from the suite sources) bucketed by keyword; runtime ok counts are in `suites`"}


# --------------------------------------------------------------------------
# 4. the API surface
# --------------------------------------------------------------------------
ACTION = re.compile(r"action === '([a-z-]+)'")
API_NOTES = {
    ("superman", "recall"): ("changed in v2", "BM25 (k1 1.2, b 0.75) with IDF replaces the flat additive score"),
    ("superman", "store"): ("changed in v2", "PDF text is extracted on the host at store time"),
    ("superman", "prune"): ("new in v2", "manual compaction pass; returns what the policy removed"),
    ("superman", "list"): ("carried", "unchanged contract, stats now carry eviction counters"),
    ("superman", "get"): ("carried", "unchanged contract, returns the extracted text"),
    ("superman", "delete"): ("carried", "unchanged"),
    ("superman", "note"): ("carried", "unchanged"),
    ("superman-ocr", "health"): ("new in v2", "{ready, bin, compiled, version}"),
    ("superman-ocr", "ocr"): ("new in v2", "{text, pages, characters} from the Vision engine"),
}
ROUTES = {
    "superman": "/api/superman/api (+ GET /api/superman/file?id=)",
    "superman-ocr": "/api/superman-ocr/api",
}


def measure_api() -> list[dict]:
    """Read the action names off the shipped host halves and label them."""
    rows = []
    for module in ("superman", "superman-ocr"):
        source = (SUITE_V2 / module / "index.js").read_text(encoding="utf-8")
        v1_source = run(["git", "-C", str(SUITE_ROOT), "show", f"{V1_COMMIT}:{module}/index.js"]).stdout
        v1_actions = set(ACTION.findall(v1_source)) if v1_source else set()
        for action in dict.fromkeys(ACTION.findall(source)):
            status, note = API_NOTES.get((module, action), ("new in v2", ""))
            rows.append({
                "module": module,
                "route": ROUTES[module],
                "action": action,
                "v1": action in v1_actions,
                "status": status,
                "note": note,
            })
    return rows


# --------------------------------------------------------------------------
# 5. OCR
# --------------------------------------------------------------------------
# FACTS §2 states these four measurements; they are re-stated here so the tables
# and figures never diverge from the source of truth. `remeasured` below adds
# numbers taken on this run.
OCR_FACTS = [
    {"case": "rasterised page A", "pages": 1, "layerChars": 0, "ocrChars": 3411, "ocrHan": 979,
     "note": "single page rasterised to an image-only PDF; the layer is empty"},
    {"case": "rasterised page B", "pages": 1, "layerChars": 1, "ocrChars": 1341, "ocrHan": 1072,
     "note": "a one-character text layer; OCR recovers the Han text"},
    {"case": "broken CMap brochure", "pages": 19, "layerChars": 9423, "layerHan": 9, "ocrChars": 11333, "ocrHan": 66,
     "note": "the embedded CMap is broken, so the layer returns Latin noise and 9 Han"},
]


def pymupdf_available() -> bool:
    """True when the configured interpreter can import PyMuPDF."""
    if not PYMUPDF_PYTHON.exists():
        return False
    finished = run([str(PYMUPDF_PYTHON), "-c", "import fitz"])
    return finished.returncode == 0


def compile_ocr_tool(destination: Path) -> dict:
    """Compile the shipped Swift OCR tool once and report the compile."""
    started = time.time()
    finished = run([
        "swiftc", "-O",
        "-module-cache-path", str(destination.parent / "clang-cache"),
        str(SUITE_TOOLS / "ocr-pdf.swift"),
        "-o", str(destination),
    ])
    return {
        "ok": finished.returncode == 0,
        "ms": round((time.time() - started) * 1000),
        "stderr": finished.stderr.strip()[-300:],
    }


def rasterise(source: Path, page: int, out: Path) -> dict:
    """Rasterise one page with the helper and parse its JSON."""
    finished = run([str(PYMUPDF_PYTHON), str(RASTERIZE), "--src", str(source),
                    "--page", str(page), "--out", str(out), "--dpi", "200"])
    if finished.returncode != 0:
        return {"error": finished.stderr.strip()[-200:]}
    return json.loads(finished.stdout.strip().splitlines()[-1])


def ocr_run(binary: Path, pdf: Path) -> dict:
    """OCR one PDF with the compiled tool and count what came back."""
    started = time.time()
    finished = run([str(binary), str(pdf), "--scale", "2"])
    elapsed = round((time.time() - started) * 1000)
    text = finished.stdout
    pages = len(re.findall(r"^## page ", text, re.M))
    body = re.sub(r"^## page \d+\n", "", text, flags=re.M)
    return {
        "ms": elapsed,
        "exitCode": finished.returncode,
        "pages": pages,
        "chars": len(body),
        "han": sum(1 for character in body if ord(character) in HAN),
    }


def measure_ocr() -> dict:
    """Re-measure the rasterised-page case when PyMuPDF and the Swift tool exist."""
    result: dict = {"facts": OCR_FACTS, "source": "FACTS §2", "tool": "dsh-superman-suite/v2/tools/ocr-pdf.swift"}
    if not pymupdf_available():
        result["remeasured"] = []
        result["skipped"] = f"PyMuPDF interpreter not usable: {PYMUPDF_PYTHON}"
        return result

    scratch = Path(tempfile.mkdtemp(prefix="v2-ocr-"))
    binary = scratch / "ocr-pdf"
    compile_report = compile_ocr_tool(binary)
    result["compile"] = compile_report
    if not compile_report["ok"]:
        result["remeasured"] = []
        result["skipped"] = "swiftc could not build the OCR tool"
        return result

    sources = [
        ("rasterised page A (Latin)", Path(os.environ.get(
            "DSH_OCR_SRC_A",
            "tools/zotero-pdf2zh/test/attention.pdf")), 1),
        ("rasterised page B (Han)", Path(os.environ.get(
            "DSH_OCR_SRC_B",
            "tools/zotero-pdf2zh/server/translated/attention.no_watermark.zh-CN.mono.pdf")), 2),
    ]
    rows = []
    for label, relative, page in sources:
        source = relative if relative.is_absolute() else ROOT / relative
        row: dict = {"case": label, "source": "outside the repository" if relative.is_absolute() else str(relative)}
        if not source.exists():
            row["error"] = "source PDF not present"
            rows.append(row)
            continue
        target = scratch / f"{label.split()[2].rstrip('()')}.pdf"
        produced = rasterise(source, page, target)
        row.update({
            "sourceBytes": source.stat().st_size,
            "page": page,
            "dpi": 200,
            "pages": produced.get("pages", 1),
            "layerChars": produced.get("chars", 0),
            "layerHan": produced.get("han", 0),
        })
        if "error" in produced:
            row["error"] = produced["error"]
        else:
            row.update(ocr_run(binary, target))
        rows.append(row)
    result["remeasured"] = rows
    return result


# --------------------------------------------------------------------------
# 6. the worked BM25 example
# --------------------------------------------------------------------------
def measure_bm25() -> dict:
    """Run the BM25 probe against the shipped internals."""
    finished = run(["node", str(BM25_PROBE), str(SUITE_V2)])
    if finished.returncode != 0:
        return {"error": finished.stderr.strip()[-300:]}
    return json.loads(finished.stdout)


# --------------------------------------------------------------------------
# 7. the eight limitations
# --------------------------------------------------------------------------
LIMITATIONS = [
    {"id": "L1", "v1": "PDF extraction reads the text layer only; scans yield nothing",
     "v2": "on-device OCR through macOS Vision, wired into the Chat upload path as an automatic fallback",
     "status": "closed", "effective": "client HMR + OCR bundle", "figure": "FIG:ocr", "table": "TAB:ocr"},
    {"id": "L2", "v1": "recall was a flat additive lexical score that favoured long documents",
     "v2": "BM25 (k1 = 1.2, b = 0.75) with IDF over name/body/record fields plus the recency term",
     "status": "closed", "effective": "host, restart", "figure": "FIG:bm25"},
    {"id": "L3", "v1": "conversation history lived in the page origin's localStorage",
     "v2": "every finished turn also writes a restorable JSON payload (chatstate:<id>, ≤ 7 900 characters) that merges on start-up",
     "status": "closed", "effective": "client HMR", "figure": "FIG:lifecycle"},
    {"id": "L4", "v1": "images in history kept only a 160 px thumbnail and resent as unavailable",
     "v2": "an image remembers the memory item id of its bytes; a resend fetches the original from the file route",
     "status": "closed", "effective": "client HMR"},
    {"id": "L5", "v1": "the memory grew without a compaction policy",
     "v2": "maxItems 2 000 and maxBytes 512 MiB caps, oldest-first eviction, start-up reconciliation, prune, eviction counters",
     "status": "closed", "effective": "host, restart", "figure": "FIG:lifecycle"},
    {"id": "L6", "v1": "panel uploads and Harness captures stored PDF bytes without text",
     "v2": "superman/pdf.js, a Node port of the browser extractor, parses on store (200-page / 400 000-character caps)",
     "status": "closed", "effective": "host, restart"},
    {"id": "L7", "v1": "no automated browser-level (DOM) end-to-end test",
     "v2": "a workspace-local jsdom + React toolchain and tools/dom-check.mjs mount the panels with createRoot; environment differences remain",
     "status": "partial", "effective": "toolchain, not shipped", "figure": "FIG:limitations"},
    {"id": "L8", "v1": "recall is not semantic",
     "v2": "no embedding service exists on this machine; retrieval stays lexical (now BM25), the seam is recall(q)",
     "status": "open", "effective": "—"},
]


def measure_limitations(attribution: dict) -> list[dict]:
    """The eight limitations with their measured check attribution attached."""
    totals = attribution["totals"]
    rows = []
    for entry in LIMITATIONS:
        row = dict(entry)
        row["newChecks"] = totals.get(entry["id"], 0)
        rows.append(row)
    return rows


# --------------------------------------------------------------------------
def main() -> None:
    v1 = json.loads(V1_DATA_FILE.read_text(encoding="utf-8"))
    suites = measure_suites()
    attribution = measure_check_attribution()

    # Real PDFs for the corpus-present host run: the v1 corpus rows still on
    # disk plus the eight Automator vector files the v1 measurement used.
    corpus_candidates: list[Path] = []
    downloads = Path.home() / "Downloads"
    if downloads.exists():
        corpus_candidates.extend(sorted(downloads.glob("*.pdf"))[:1])
    automator = Path("/System/Library/Frameworks/Automator.framework/Resources")
    if automator.exists():
        corpus_candidates.extend(sorted(automator.glob("*.pdf"))[:9])
    extra = os.environ.get("DSH_TEST_CORPUS")
    if extra and Path(extra).exists():
        corpus_candidates.extend(sorted(Path(extra).glob("*.pdf")))

    metrics = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "generator": "papers/v2/tools/metrics.py",
        "suites": suites,
        "suitesV1": measure_suites_v1(),
        "factsSuites": FACTS_SUITES,
        "factsSuitesSource": "FACTS §4 (recorded totals; the fresh runs above are the measurement)",
        "suitesWithCorpus": measure_suites_with_corpus(corpus_candidates),
        "codeDelta": measure_code_delta(),
        "checkAttribution": attribution,
        "limitations": measure_limitations(attribution),
        "api": measure_api(),
        "ocr": measure_ocr(),
        "bm25": measure_bm25(),
        "corpusV1": v1["corpus"],
        "encodingsV1": v1["encodings"],
        "mathV1": v1["math"],
        "classificationV1": v1["classification"],
        "v1Source": "papers/data/metrics.json (v1 measurement, reused verbatim)",
    }
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(metrics, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    total_ok = sum(row["ok"] for row in suites)
    total_fail = sum(row["fail"] for row in suites)
    print(f"suites: {total_ok} checks ok, {total_fail} failed, exit codes {[row['exitCode'] for row in suites]}")
    print(f"with corpus: {metrics['suitesWithCorpus']['ok']} ok / {metrics['suitesWithCorpus']['fail']} fail")
    print(f"ocr remeasured: {json.dumps(metrics['ocr'].get('remeasured'), ensure_ascii=False)[:400]}")
    print(f"bm25: {metrics['bm25'].get('flatWinner')} -> {metrics['bm25'].get('bm25Winner')} (flip={metrics['bm25'].get('rankFlip')})")
    print(f"wrote {DATA_FILE}")
    shutil.rmtree(Path(metrics["suitesWithCorpus"]["cwd"]), ignore_errors=True)


if __name__ == "__main__":
    main()
