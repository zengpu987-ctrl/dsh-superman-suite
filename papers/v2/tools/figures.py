#!/usr/bin/env python3
"""Draw figures 1–9 of FACTS §6 from ``papers/v2/data/metrics.json``.

Writes ``papers/v2/figures/{en,zh}/fig-<key>.png`` for the nine keys the
manuscripts place: versions, limitations, checks, code, ocr, corpus, latency,
bm25, lifecycle.

Design rules applied to every figure (FACTS §6): no in-image title when the
caption names the figure; one message per panel; direct labels instead of a
legend wherever there is room; a light grid and no chartjunk; ≥ 260 dpi; labels
in one language only (English or Chinese, never both — file aliases stay as they
are in the data); the decisive number annotated; multi-panel figures letter
their panels (a), (b), (c).

Usage (the workspace Anaconda interpreter has matplotlib)::

    MPLCONFIGDIR=/tmp/mpl /opt/anaconda3/bin/python3 papers/v2/tools/figures.py
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
from matplotlib.ticker import FuncFormatter

ROOT = Path(__file__).resolve().parents[3]
V2 = ROOT / "papers" / "v2"
DATA = json.loads((V2 / "data" / "metrics.json").read_text(encoding="utf-8"))

CJK_FONT = "/System/Library/Fonts/Supplemental/Songti.ttc"
DPI = 260

INK = "#15171c"
MUTED = "#5c6270"
GRID = "#dcdee6"
BLUE = "#2f5bd7"
RED = "#c2452d"
GREEN = "#2f8f5b"
AMBER = "#c98a1b"
PAPER = "#f4f5f9"

# ---------------------------------------------------------------------------
# labels: one language per figure, never mixed
# ---------------------------------------------------------------------------
LABELS = {
    "en": {
        "fix_matrix_x": "new offline checks attributable to the limitation",
        "status": {"closed": "closed", "partial": "partial", "open": "open"},
        "checks_y": "checks",
        "checks_v1": "v1",
        "checks_v2": "v2",
        "checks_total": "total 284 → 449",
        "code_x": "lines of JavaScript",
        "code_v1": "v1",
        "code_v2": "v2",
        "code_new": "new in v2",
        "ocr_x": "characters",
        "ocr_layer": "text layer",
        "ocr_ocr": "OCR",
        "ocr_han_short": "Han",
        "ocr_cases": {
            "rasterised page A": "page A",
            "rasterised page B": "page B",
            "broken CMap brochure": "broken CMap\nbrochure",
            "rasterised page A (Latin)": "page A (Latin)",
            "rasterised page B (Han)": "page B (Han)",
        },
        "corpus_x": "pages",
        "corpus_y": "extracted characters",
        "corpus_text": "text layer",
        "corpus_textless": "no text layer (9 files, 0 pages)",
        "corpus_ocr": "recovered by OCR",
        "latency_x": "pages",
        "latency_y": "median extraction time (ms, log)",
        "latency_textless": "9 textless vector files\n(0 pages, 0.2–0.8 ms)",
        "bm25_flat": "v1 flat additive score",
        "bm25_after": "v2 BM25 score",
        "bm25_score": "score",
        "bm25_rank": "rank",
        "bm25_flip": "rank flip",
        "bm25_idf": "IDF: memory 0.18 (both documents) · compaction 0.69 (one document)",
        "lifecycle_steps": [
            "store",
            "classify",
            "extract / OCR",
            "index",
            "recall (BM25)",
            "compact",
        ],
        "lifecycle_caps": "caps: 2 000 items · 512 MiB\noldest-first eviction",
        "lifecycle_reconcile": "start-up reconciliation:\ndrop orphans and missing files",
        "lifecycle_ocr": "OCR fallback when the text layer is empty",
        "topology_v1": "(a) v1: text layers only, history in localStorage, unbounded memory",
        "topology_v2": "(b) v2: OCR fallback, image hydration, compaction and reconciliation",
        "topology_browser": "browser",
        "topology_host": "host",
        "topology_none": "no OCR · no compaction",
        "topology_store": "memory store\nindex.json + files/",
        "topology_store_v2": "memory store + compaction\nindex.json + files/\ncaps · reconciliation",
        "topology_ocr": "OCR bundle\nVision + PDFKit",
        "topology_llm": "ctx.llm",
        "topology_panels": "panels: chat · memory · arXiv · toasts",
        "topology_history": "history: localStorage only",
        "topology_durable": "history: + chatstate payloads",
        "topology_images": "images: 160 px thumbnails",
        "topology_hydrate": "images: memoryId → original bytes",
    },
    "zh": {
        "fix_matrix_x": "归因于该局限的新增离线检查项",
        "status": {"closed": "已修复", "partial": "部分", "open": "未修复"},
        "checks_y": "检查项",
        "checks_v1": "v1",
        "checks_v2": "v2",
        "checks_total": "合计 284 → 449",
        "code_x": "JavaScript 行数",
        "code_v1": "v1",
        "code_v2": "v2",
        "code_new": "v2 新增",
        "ocr_x": "字符数",
        "ocr_layer": "文本层",
        "ocr_ocr": "OCR",
        "ocr_han_short": "汉字",
        "ocr_cases": {
            "rasterised page A": "页面 A",
            "rasterised page B": "页面 B",
            "broken CMap brochure": "CMap 损坏\n的册子",
            "rasterised page A (Latin)": "页面 A（拉丁）",
            "rasterised page B (Han)": "页面 B（汉字）",
        },
        "corpus_x": "页数",
        "corpus_y": "抽取字符数",
        "corpus_text": "文本层",
        "corpus_textless": "无文本层（9 个文件，0 页）",
        "corpus_ocr": "OCR 恢复",
        "latency_x": "页数",
        "latency_y": "抽取中位耗时（毫秒，对数）",
        "latency_textless": "9 个无文本层矢量文件\n（0 页，0.2–0.8 毫秒）",
        "bm25_flat": "v1 加法打分",
        "bm25_after": "v2 BM25 打分",
        "bm25_score": "得分",
        "bm25_rank": "名次",
        "bm25_flip": "名次翻转",
        "bm25_idf": "IDF：memory 0.18（两篇都有）· compaction 0.69（只有一篇有）",
        "lifecycle_steps": [
            "入库",
            "分类",
            "抽取 / OCR",
            "建索引",
            "回忆（BM25）",
            "压缩",
        ],
        "lifecycle_caps": "上限：2 000 条 · 512 MiB\n最旧优先淘汰",
        "lifecycle_reconcile": "启动对账：\n删除孤儿与缺失条目",
        "lifecycle_ocr": "文本层为空时自动 OCR 降级",
        "topology_v1": "(a) v1：只读文本层，历史存 localStorage，记忆体只增不减",
        "topology_v2": "(b) v2：OCR 降级、图片取回原图、压缩与对账",
        "topology_browser": "浏览器",
        "topology_host": "Host",
        "topology_none": "无 OCR · 无压缩",
        "topology_store": "记忆体\nindex.json + files/",
        "topology_store_v2": "记忆体 + 压缩\nindex.json + files/\n上限 · 对账",
        "topology_ocr": "OCR 包\nVision + PDFKit",
        "topology_llm": "ctx.llm",
        "topology_panels": "面板：Chat · 记忆体 · arXiv · 提示卡",
        "topology_history": "历史：仅 localStorage",
        "topology_durable": "历史：＋ chatstate 载荷",
        "topology_images": "图片：160px 缩略图",
        "topology_hydrate": "图片：memoryId → 原图字节",
    },
}

LIMITATION_TITLES = {
    "en": {
        "L1": "L1  scans read by OCR",
        "L2": "L2  BM25 recall",
        "L3": "L3  durable history",
        "L4": "L4  image fidelity",
        "L5": "L5  compaction policy",
        "L6": "L6  store-time extraction",
        "L7": "L7  DOM verification",
        "L8": "L8  semantic recall",
    },
    "zh": {
        "L1": "L1  扫描件 OCR",
        "L2": "L2  BM25 回忆",
        "L3": "L3  记录可跨 origin 恢复",
        "L4": "L4  历史图片原图",
        "L5": "L5  压缩策略",
        "L6": "L6  入库即抽取文本",
        "L7": "L7  DOM 验证",
        "L8": "L8  语义回忆",
    },
}


def use_fonts(lang: str) -> str:
    """Point matplotlib at the right faces and return the CJK family name."""
    from matplotlib import font_manager

    cjk = None
    if os.path.exists(CJK_FONT):
        cjk = font_manager.FontProperties(fname=CJK_FONT).get_name()
        font_manager.fontManager.addfont(CJK_FONT)
    # A family list lets matplotlib fall back per glyph, so a Han face can
    # still draw the en dash and the minus sign the data uses.
    if lang == "zh" and cjk:
        plt.rcParams["font.family"] = [cjk, "DejaVu Sans"]
    else:
        plt.rcParams["font.family"] = ["DejaVu Sans"] + ([cjk] if cjk else [])
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["figure.facecolor"] = "white"
    plt.rcParams["savefig.facecolor"] = "white"
    plt.rcParams["font.size"] = 8
    return cjk or "DejaVu Sans"


def tidy(axis, grid: str = "y") -> None:
    """Light grid, no top/right spines, muted ticks."""
    axis.set_axisbelow(True)
    if grid:
        axis.grid(axis=grid, color=GRID, linewidth=0.6)
    for side in ("top", "right"):
        axis.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        axis.spines[side].set_color(GRID)
    axis.tick_params(colors=INK, labelsize=7.5, length=2.5, width=0.6)


def save(fig, path: Path, pad: float = 0.05) -> None:
    """Write one figure at the published resolution."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=DPI, bbox_inches="tight", pad_inches=pad)
    plt.close(fig)


def labelled(axis, text: str, x: float, y: float, **extra) -> None:
    """A direct label in the figure's ink colour."""
    axis.text(x, y, text, color=INK, **extra)


def panel(axis, letter: str) -> None:
    """Letter one panel of a multi-panel figure."""
    axis.text(-0.015, 1.02, f"({letter})", transform=axis.transAxes, fontsize=9,
              fontweight="bold", color=INK, ha="left", va="bottom")


# ---------------------------------------------------------------------------
# Figure 1 — versions: v1 and v2 topology
# ---------------------------------------------------------------------------
def figure_versions(lang: str, labels: dict, out: Path) -> None:
    fig, axes = plt.subplots(2, 1, figsize=(6.9, 4.9), dpi=200, gridspec_kw={"hspace": 0.16})

    def box(axis, x, y, w, h, text, color, size=6.6, fill=0.10):
        axis.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.35,rounding_size=1.0",
                                      linewidth=0.7, edgecolor=color, facecolor=color, alpha=fill, zorder=2))
        axis.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=size,
                  color=INK, zorder=3, linespacing=1.4)

    def arrow(axis, start, end, color=INK, dashed=False):
        axis.add_patch(FancyArrowPatch(start, end, arrowstyle="-|>", mutation_scale=7,
                                       linewidth=0.85, color=color, zorder=4,
                                       linestyle="--" if dashed else "-"))

    def frame(axis, title, history, images, store, extra):
        axis.set_xlim(0, 100)
        axis.set_ylim(0, 40)
        axis.axis("off")
        axis.text(0.5, 39.2, title, fontsize=7.4, color=INK, fontweight="bold", va="top")
        axis.text(0.5, 34.2, labels["topology_browser"], fontsize=6.6, color=MUTED)
        box(axis, 1, 23, 33, 9.4, labels["topology_panels"], BLUE, size=6.2)
        box(axis, 35.5, 23, 29.5, 9.4, history, RED, size=6.0)
        box(axis, 66.5, 23, 32.5, 9.4, images, AMBER, size=6.0)
        axis.text(0.5, 18.4, labels["topology_host"], fontsize=6.6, color=MUTED)
        box(axis, 1, 3.5, 30, 13.4, labels["topology_llm"], BLUE, size=6.4)
        box(axis, 35.5, 3.5, 29.5, 13.4, store, GREEN, size=6.0)
        box(axis, 66.5, 3.5, 32.5, 13.4, extra, AMBER if extra == labels["topology_ocr"] else MUTED, size=6.0)
        arrow(axis, (17.5, 22.8), (16, 17.5), BLUE)
        arrow(axis, (50, 22.8), (50, 17.5), GREEN, dashed=True)
        arrow(axis, (82, 22.8), (82, 17.5), AMBER)

    frame(axes[0], labels["topology_v1"], labels["topology_history"], labels["topology_images"],
          labels["topology_store"], labels.get("topology_none", "no OCR · no compaction"))
    frame(axes[1], labels["topology_v2"], labels["topology_durable"], labels["topology_hydrate"],
          labels["topology_store_v2"], labels["topology_ocr"])
    save(fig, out)


# ---------------------------------------------------------------------------
# Figure 2 — the fix matrix
# ---------------------------------------------------------------------------
def figure_limitations(lang: str, labels: dict, out: Path) -> None:
    rows = DATA["limitations"]
    titles = LIMITATION_TITLES[lang]
    order = [row["id"] for row in rows][::-1]
    by_id = {row["id"]: row for row in rows}
    colors = {"closed": GREEN, "partial": AMBER, "open": RED}
    fig, axis = plt.subplots(figsize=(6.9, 3.0), dpi=200)
    span = max(row["newChecks"] for row in rows)
    chip_x = span * 1.16
    for position, key in enumerate(order):
        row = by_id[key]
        value = row["newChecks"]
        axis.barh(position, value, height=0.62, color=colors[row["status"]], alpha=0.9, zorder=3)
        axis.text(value + 1.8, position, f"+{value}" if value else "0", va="center", fontsize=7.4, color=INK)
        axis.text(chip_x, position, labels["status"][row["status"]], va="center", ha="right",
                  fontsize=6.8, color=colors[row["status"]], fontweight="bold")
    axis.set_yticks(range(len(order)))
    axis.set_yticklabels([titles[key] for key in order], fontsize=7.6, color=INK)
    axis.set_xlabel(labels["fix_matrix_x"], fontsize=7.8, color=INK)
    axis.set_xlim(0, span * 1.30)
    axis.set_ylim(-0.7, len(order) - 0.3)
    tidy(axis, "x")
    save(fig, out)


# ---------------------------------------------------------------------------
# Figure 3 — checks per suite, v1 vs v2
# ---------------------------------------------------------------------------
def figure_checks(lang: str, labels: dict, out: Path) -> None:
    suites = DATA["suites"]
    facts = DATA["factsSuites"]
    names = [row["suite"].replace(".mjs", "") for row in suites]
    v2 = [row["ok"] + row["fail"] for row in suites]
    v1 = [facts[row["suite"]]["v1"] or 0 for row in suites]
    positions = range(len(names))
    fig, axis = plt.subplots(figsize=(6.9, 2.9), dpi=200)
    axis.bar([p - 0.19 for p in positions], v1, width=0.36, color=MUTED, alpha=0.85,
             label=labels["checks_v1"], zorder=3)
    axis.bar([p + 0.19 for p in positions], v2, width=0.36, color=BLUE,
             label=labels["checks_v2"], zorder=3)
    for position, (before, after) in enumerate(zip(v1, v2)):
        axis.text(position - 0.19, before + 2, str(before) if before else "—", ha="center",
                  fontsize=7, color=MUTED)
        axis.text(position + 0.19, after + 2, str(after), ha="center", fontsize=7.4, color=BLUE)
        if after != before:
            axis.text(position, max(before, after) + 12, f"+{after - before}", ha="center",
                      fontsize=7.2, color=GREEN, fontweight="bold")
    axis.set_xticks(list(positions))
    axis.set_xticklabels([name.replace("chat-mode-", "cm-").replace("superman-", "sm-") for name in names],
                         rotation=16, ha="right", fontsize=7.2, color=INK)
    axis.set_ylabel(labels["checks_y"], fontsize=7.8, color=INK)
    axis.set_ylim(0, max(v2) * 1.30)
    axis.legend(fontsize=7.2, frameon=False, loc="upper left", ncols=2)
    axis.text(0.99, 0.93, labels["checks_total"], transform=axis.transAxes, ha="right",
              va="top", fontsize=8, color=INK, fontweight="bold")
    tidy(axis)
    save(fig, out)


# ---------------------------------------------------------------------------
# Figure 4 — code growth per module
# ---------------------------------------------------------------------------
def figure_code(lang: str, labels: dict, out: Path) -> None:
    files = DATA["codeDelta"]["files"]
    by_file = {row["file"]: row for row in files}
    modules = {
        "chat-mode": ["chat-mode/client.js", "chat-mode/index.js"],
        "superman": ["superman/client.js", "superman/index.js", "superman/pdf.js"],
        "arxiv-search": ["arxiv-search/client.js", "arxiv-search/index.js"],
        "superman-ocr": ["superman-ocr/index.js"],
    }
    fig, axis = plt.subplots(figsize=(6.9, 2.9), dpi=200)
    width = 0.34
    for index, (module, paths) in enumerate(modules.items()):
        for offset, (label, key) in enumerate(((labels["code_v1"], "v1"), (labels["code_v2"], "v2"))):
            bottom = 0
            for order, path in enumerate(paths):
                row = by_file[path]
                value = row[key] or 0
                if not value:
                    continue
                is_new = row["new"]
                if key == "v1" and row["v1"] is None:
                    continue
                fill = (AMBER if is_new else BLUE) if key == "v2" else MUTED
                alpha = 0.95 if (is_new and key == "v2") else (0.85 if key == "v2" else 0.7)
                axis.bar(index + (offset - 0.5) * width, value, width=width * 0.92,
                         bottom=bottom, color=fill, alpha=alpha, zorder=3)
                if value > 260:
                    axis.text(index + (offset - 0.5) * width, bottom + value / 2,
                              path.split("/")[-1].replace(".js", ""), ha="center", va="center",
                              fontsize=6, color="white", rotation=90 if value < 700 else 0)
                bottom += value
            axis.text(index + (offset - 0.5) * width, bottom + 90,
                      f"{int(bottom):,}" if bottom else "—", ha="center", fontsize=7, color=INK)
    axis.set_xticks(range(len(modules)))
    axis.set_xticklabels(list(modules), fontsize=7.6, color=INK)
    axis.set_ylabel(labels["code_x"], fontsize=7.8, color=INK)
    axis.set_ylim(0, 5600)
    handles = [
        plt.Rectangle((0, 0), 1, 1, color=MUTED, alpha=0.7, label=labels["code_v1"]),
        plt.Rectangle((0, 0), 1, 1, color=BLUE, alpha=0.85, label=labels["code_v2"]),
        plt.Rectangle((0, 0), 1, 1, color=AMBER, label=labels["code_new"]),
    ]
    axis.legend(handles=handles, fontsize=7.2, frameon=False, ncols=3, loc="upper left")
    tidy(axis)
    save(fig, out)


# ---------------------------------------------------------------------------
# Figure 5 — the OCR result
# ---------------------------------------------------------------------------
def figure_ocr(lang: str, labels: dict, out: Path) -> None:
    facts = DATA["ocr"]["facts"]
    remeasured = DATA["ocr"].get("remeasured", [])
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 2.9), dpi=200,
                            gridspec_kw={"width_ratios": [1.45, 1.0], "wspace": 0.32})

    def group(axis, rows, letter, annotations=False):
        cases = labels["ocr_cases"]
        names = []
        for row in rows:
            name = cases.get(row["case"], row["case"])
            han = row.get("ocrHan")
            names.append(f"{name}\n{han:,} {labels['ocr_han_short']}" if han else name)
        layer = [row.get("layerChars", 0) for row in rows]
        ocr = [row.get("ocrChars") or row.get("chars", 0) for row in rows]
        positions = range(len(rows))
        axis.bar([p - 0.19 for p in positions], layer, width=0.36, color=MUTED, alpha=0.75,
                 label=labels["ocr_layer"], zorder=3)
        axis.bar([p + 0.19 for p in positions], ocr, width=0.36, color=BLUE,
                 label=labels["ocr_ocr"], zorder=3)
        for position, row in enumerate(rows):
            before = row.get("layerChars", 0)
            after = row.get("ocrChars") or row.get("chars", 0)
            axis.text(position + 0.19, after + max(ocr) * 0.03, f"{after:,}", ha="center",
                      fontsize=7, color=BLUE)
            axis.text(position - 0.19, before + max(ocr) * 0.03, f"{before:,}", ha="center",
                      fontsize=7, color=MUTED)
            if annotations:
                axis.annotate("", xy=(position + 0.19, after), xytext=(position - 0.19, before + max(ocr) * 0.02),
                              arrowprops=dict(arrowstyle="-|>", color=GREEN, linewidth=0.9,
                                              connectionstyle="arc3,rad=-0.25"), zorder=5)
                axis.text(position, after + max(ocr) * 0.14, f"{before:,} → {after:,}", ha="center",
                          fontsize=7.2, color=GREEN, fontweight="bold")
        axis.set_xticks(list(positions))
        axis.set_xticklabels(names, fontsize=6.8, color=INK)
        axis.set_ylabel(labels["ocr_x"], fontsize=7.6, color=INK)
        axis.set_ylim(0, max(ocr) * 1.30)
        tidy(axis)
        if letter:
            panel(axis, letter)
        return names

    group(axes[0], facts, "a", annotations=True)
    if remeasured:
        group(axes[1], remeasured, "b", annotations=True)
        axes[1].set_ylabel("")
    else:
        axes[1].axis("off")
    axes[0].legend(fontsize=7, frameon=False, loc="upper left")
    axes[0].set_ylim(0, max(row.get("ocrChars", 0) for row in facts) * 1.42)
    save(fig, out)


# ---------------------------------------------------------------------------
# Figure 6 — the corpus: extracted characters vs pages
# ---------------------------------------------------------------------------
def figure_corpus(lang: str, labels: dict, out: Path) -> None:
    corpus = DATA["corpusV1"]
    with_text = [row for row in corpus if row.get("pages")]
    textless = [row for row in corpus if not row.get("pages")]
    remeasured = [row for row in DATA["ocr"].get("remeasured", []) if row.get("chars")]
    fig, (axis, zoom) = plt.subplots(1, 2, figsize=(6.9, 2.9), dpi=200,
                                     gridspec_kw={"width_ratios": [2.35, 1.0], "wspace": 0.30})
    axis.axhline(0, color=RED, linewidth=0.7, alpha=0.45)
    axis.scatter([row["pages"] for row in with_text], [row["characters"] for row in with_text],
                 s=34, color=BLUE, zorder=4, edgecolor="white", linewidth=0.5)
    axis.scatter([0.7] * len(textless), [0] * len(textless), s=30, color=RED, marker="x",
                 zorder=4, linewidth=1.2)
    axis.scatter([0.4 + 0.45 * index for index, _row in enumerate(remeasured)],
                 [row.get("chars", 0) for row in remeasured],
                 s=42, color=GREEN, marker="D", zorder=4, edgecolor="white", linewidth=0.5)
    offsets = {
        "prospectus-2025.pdf": (-14, -12),
        "prospectus-2026.pdf": (-14, 4),
        "brochure.pdf": (7, -11),
        "contract-2027.pdf": (-14, 8),
        "document-B.pdf": (2, 8),
    }
    for row in with_text:
        axis.annotate(row["name"], (row["pages"], row["characters"]), textcoords="offset points",
                      xytext=offsets.get(row["name"], (6, 4)), fontsize=6.4, color=INK)
    axis.add_patch(plt.Rectangle((0, -900), 3.2, 7000, linewidth=0.7, edgecolor=MUTED,
                                 facecolor="none", linestyle="--", zorder=5))
    axis.set_xlabel(labels["corpus_x"], fontsize=7.8, color=INK)
    axis.set_ylabel(labels["corpus_y"], fontsize=7.8, color=INK)
    axis.set_xlim(-1.5, 60)
    axis.set_ylim(-7000, 99000)
    axis.yaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value / 1000:.0f}k" if value else "0"))
    tidy(axis)
    panel(axis, "a")
    # The origin cluster carries the figure's second message, so it is its own
    # lettered panel rather than a pile of overlapping labels.
    zoom.axhline(0, color=RED, linewidth=0.7, alpha=0.45)
    zoom.scatter([0.7] * len(textless), [0] * len(textless), s=30, color=RED, marker="x",
                 zorder=4, linewidth=1.2)
    zoom.scatter([0.4 + 0.45 * index for index, _row in enumerate(remeasured)],
                 [row.get("chars", 0) for row in remeasured], s=42, color=GREEN, marker="D",
                 zorder=4, edgecolor="white", linewidth=0.5)
    zoom.scatter([2], [786], s=30, color=BLUE, zorder=4, edgecolor="white", linewidth=0.5)
    zoom.scatter([2.6], [0], s=26, color=BLUE)
    zoom.annotate(labels["corpus_textless"], (0.7, 0), textcoords="offset points", xytext=(0, -26),
                  fontsize=6.4, color=RED, ha="center")
    for index, row in enumerate(remeasured):
        zoom.annotate(f'{labels["corpus_ocr"]} · {row.get("chars", 0):,}',
                      (0.4 + 0.45 * index, row.get("chars", 0)), textcoords="offset points",
                      xytext=(9, 2), fontsize=6.4, color=GREEN)
    zoom.annotate("document-B.pdf", (2, 786), textcoords="offset points", xytext=(-6, 10),
                  fontsize=6.4, color=INK, ha="left")
    zoom.set_xlim(0, 5.4)
    zoom.set_ylim(-750, 2900)
    zoom.set_yticks([0, 1000, 2000])
    zoom.set_xticks([0, 1, 2, 3, 4, 5])
    tidy(zoom)
    panel(zoom, "b")
    save(fig, out)


# ---------------------------------------------------------------------------
# Figure 7 — extraction latency
# ---------------------------------------------------------------------------
def figure_latency(lang: str, labels: dict, out: Path) -> None:
    corpus = DATA["corpusV1"]
    with_text = [row for row in corpus if row.get("pages")]
    textless = [row for row in corpus if not row.get("pages")]
    fig, axis = plt.subplots(figsize=(6.9, 2.9), dpi=200)
    axis.set_yscale("log")
    jitter = [0.35, 0.5, 0.65, 0.8, 0.95, 1.1, 1.25, 1.4, 1.55]
    axis.scatter(jitter[:len(textless)], [row["medianMs"] for row in textless], s=26, color=RED,
                 marker="x", linewidth=1.1, zorder=4)
    axis.scatter([row["pages"] for row in with_text], [row["medianMs"] for row in with_text],
                 s=36, color=BLUE, zorder=4, edgecolor="white", linewidth=0.5)
    tail = {"prospectus-2025.pdf": (9, 3), "prospectus-2026.pdf": (9, -12)}
    for row in with_text:
        axis.annotate(f'{row["name"]} · {row["medianMs"]:.1f} ms', (row["pages"], row["medianMs"]),
                      textcoords="offset points", xytext=tail.get(row["name"], (-4, 9)),
                      fontsize=6.4, color=INK)
    axis.text(0.05, 0.05, labels["latency_textless"], transform=axis.transAxes, ha="left",
              va="bottom", fontsize=6.6, color=RED)
    axis.set_xlabel(labels["latency_x"], fontsize=7.8, color=INK)
    axis.set_ylabel(labels["latency_y"], fontsize=7.8, color=INK)
    axis.set_xlim(0, 74)
    axis.set_ylim(0.1, 300)
    # Plain decade labels: the default log minor labels carry U+2212 exponents,
    # which the Han face has no glyph for.
    from matplotlib.ticker import FixedLocator, NullFormatter, ScalarFormatter

    axis.yaxis.set_major_locator(FixedLocator([0.1, 0.5, 1, 5, 10, 50, 100]))
    axis.yaxis.set_major_formatter(ScalarFormatter())
    axis.yaxis.set_minor_locator(FixedLocator([]))
    axis.yaxis.set_minor_formatter(NullFormatter())
    tidy(axis, "both")
    save(fig, out)


# ---------------------------------------------------------------------------
# Figure 8 — the worked BM25 example
# ---------------------------------------------------------------------------
def figure_bm25(lang: str, labels: dict, out: Path) -> None:
    rows = DATA["bm25"]["corpus"]
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 2.7), dpi=200, gridspec_kw={"wspace": 0.3})
    names = [row["label"] for row in rows]

    def bars(axis, key, rank_key, title, color, letter):
        values = [row[key] for row in rows]
        ranks = [row[rank_key] for row in rows]
        positions = range(len(rows))
        axis.bar(positions, values, width=0.5, color=[color if rank == 1 else MUTED for rank in ranks],
                 alpha=0.9, zorder=3)
        for position, (value, rank) in enumerate(zip(values, ranks)):
            axis.text(position, value + max(values) * 0.06, f"{value:.2f}", ha="center",
                      fontsize=7.6, color=INK)
            axis.text(position, value / 2, f'#{rank}', ha="center", va="center", fontsize=10,
                      color="white", fontweight="bold")
        axis.set_xticks(list(positions))
        axis.set_xticklabels(names, fontsize=6.6, color=INK, rotation=12, ha="right")
        axis.set_ylabel(labels["bm25_score"], fontsize=7.6, color=INK)
        axis.set_ylim(0, max(values) * 1.32)
        axis.set_title(title, fontsize=8, color=INK, pad=5)
        tidy(axis)
        panel(axis, letter)

    bars(axes[0], "flatScore", "flatRank", labels["bm25_flat"], RED, "a")
    bars(axes[1], "bm25Score", "bm25Rank", labels["bm25_after"], GREEN, "b")
    axes[1].annotate(labels["bm25_flip"], xy=(0.5, 0.72), xycoords="axes fraction", ha="center",
                     fontsize=8, color=GREEN, fontweight="bold")
    axes[1].text(0.5, -0.42, labels["bm25_idf"], transform=axes[1].transAxes, ha="center",
                 fontsize=6.8, color=MUTED)
    save(fig, out)


# ---------------------------------------------------------------------------
# Figure 9 — the memory lifecycle
# ---------------------------------------------------------------------------
def figure_lifecycle(lang: str, labels: dict, out: Path) -> None:
    fig, axis = plt.subplots(figsize=(6.9, 2.3), dpi=200)
    axis.set_xlim(0, 100)
    axis.set_ylim(0, 40)
    axis.axis("off")
    steps = labels["lifecycle_steps"]
    width = 14.0
    gap = (100 - len(steps) * width) / (len(steps) - 1)
    centers = []
    for index, step in enumerate(steps):
        x = index * (width + gap)
        centers.append(x + width / 2)
        color = [BLUE, MUTED, AMBER, GREEN, BLUE, GREEN][index]
        axis.add_patch(FancyBboxPatch((x, 22), width, 10,
                                      boxstyle="round,pad=0.3,rounding_size=1.2",
                                      linewidth=0.8, edgecolor=color, facecolor=color, alpha=0.10))
        axis.text(x + width / 2, 27, step, ha="center", va="center", fontsize=7, color=INK)
        if index:
            axis.add_patch(FancyArrowPatch((centers[index - 1] + width / 2, 27), (x - 0.6, 27),
                                           arrowstyle="-|>", mutation_scale=7, linewidth=0.9,
                                           color=MUTED))
    axis.text(centers[2], 34.6, labels["lifecycle_ocr"], ha="center", fontsize=6.8, color=AMBER)
    axis.add_patch(FancyArrowPatch((centers[2], 33.6), (centers[2], 32.4), arrowstyle="-|>",
                                   mutation_scale=6, linewidth=0.8, color=AMBER))
    axis.text(centers[5], 34.6, labels["lifecycle_caps"], ha="center", fontsize=6.8, color=GREEN)
    axis.add_patch(FancyArrowPatch((centers[5], 33.6), (centers[5], 32.4), arrowstyle="-|>",
                                   mutation_scale=6, linewidth=0.8, color=GREEN))
    axis.add_patch(FancyArrowPatch((centers[5], 21.4), (centers[3], 21.4), arrowstyle="-|>",
                                   mutation_scale=7, linewidth=0.9, color=GREEN,
                                   connectionstyle="arc3,rad=0.25"))
    axis.text((centers[3] + centers[5]) / 2, 15.5, labels["lifecycle_reconcile"], ha="center",
              fontsize=6.8, color=GREEN)
    save(fig, out)


# ---------------------------------------------------------------------------
def main() -> None:
    for lang in ("en", "zh"):
        labels = LABELS[lang]
        directory = V2 / "figures" / lang
        use_fonts(lang)
        figure_versions(lang, labels, directory / "fig-versions.png")
        figure_limitations(lang, labels, directory / "fig-limitations.png")
        figure_checks(lang, labels, directory / "fig-checks.png")
        figure_code(lang, labels, directory / "fig-code.png")
        figure_ocr(lang, labels, directory / "fig-ocr.png")
        figure_corpus(lang, labels, directory / "fig-corpus.png")
        figure_latency(lang, labels, directory / "fig-latency.png")
        figure_bm25(lang, labels, directory / "fig-bm25.png")
        figure_lifecycle(lang, labels, directory / "fig-lifecycle.png")
        print(f"{lang}: wrote 9 figures to {directory}")


if __name__ == "__main__":
    main()
