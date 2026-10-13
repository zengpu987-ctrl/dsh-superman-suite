#!/usr/bin/env python3
"""Draw the paper's figures from the measured data.

Reads ``papers/data/metrics.json`` and writes PNGs into
``papers/figures/<lang>/`` for ``lang in {en, zh}``.  Run with a Python that has
matplotlib (the workspace's Anaconda interpreter is fine):

    MPLCONFIGDIR=/tmp/mpl /opt/anaconda3/bin/python3 papers/tools/figures.py
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

ROOT = Path(__file__).resolve().parents[2]
PAPERS = ROOT / "papers"
DATA = json.loads((PAPERS / "data" / "metrics.json").read_text(encoding="utf-8"))

CJK_FONT = "/System/Library/Fonts/Supplemental/Songti.ttc"
INK = "#1b1b1f"
ACCENT = "#2f5bd7"
ACCENT_2 = "#c2452d"
ACCENT_3 = "#2f8f5b"
GRID = "#d7d9e0"

LABELS = {
    "en": {
        "inventory_title": "Code size per module",
        "inventory_y": "lines of JavaScript",
        "suites_title": "Offline checks per suite",
        "suites_y": "checks",
        "pdf_chars_title": "Extracted characters vs. document length",
        "pdf_chars_x": "pages",
        "pdf_chars_y": "extracted characters",
        "pdf_latency_title": "Extraction time vs. document length",
        "pdf_latency_x": "pages",
        "pdf_latency_y": "median wall-clock (ms)",
        "encoding_title": "File-encoding detection probes",
        "encoding_y": "probes",
        "encoding_ok": "detected correctly",
        "encoding_bad": "misdetected",
        "architecture_title": "Extension topology",
        "browser": "Browser (React panels, theme tokens)",
        "host": "Host (Node, Cordis plugin halves)",
        "chat_panel": "Chat panel\nmain[chat]",
        "superman_panel": "Superman panel\nmain[superman]",
        "arxiv_panel": "arXiv section\nsettings.section[arxiv]",
        "toast": "Toast stack\nshell.overlay[superman.toast]",
        "sidebar": "Sidebar\nsidebar.panellist\n(conversation, chat, superman)",
        "api": "authenticated /api Fetch routes",
        "sse": "POST /api/chat-mode/stream\nSSE ← ctx.llm.stream()",
        "memory": "POST /api/superman/api\nGET /api/superman/file",
        "prompt": "systemPrompt.section()\ndynamic memory digest",
        "session": "session/event listener\nHarness uploads + turn records",
        "store": "~/.dsh/superman\nindex.json + files/",
        "llm": "ctx.llm",
    },
    "zh": {
        "inventory_title": "各模块代码规模",
        "inventory_y": "JavaScript 行数",
        "suites_title": "各测试套件的离线检查项",
        "suites_y": "检查项",
        "pdf_chars_title": "抽取字符数与文档长度",
        "pdf_chars_x": "页数",
        "pdf_chars_y": "抽取字符数",
        "pdf_latency_title": "抽取耗时与文档长度",
        "pdf_latency_x": "页数",
        "pdf_latency_y": "中位耗时（毫秒）",
        "encoding_title": "文件编码识别探测",
        "encoding_y": "探测数",
        "encoding_ok": "识别正确",
        "encoding_bad": "识别错误",
        "architecture_title": "扩展拓扑",
        "browser": "浏览器（React 面板、主题 token）",
        "host": "Host（Node、Cordis 插件两半）",
        "chat_panel": "Chat 面板\nmain[chat]",
        "superman_panel": "记忆体面板\nmain[superman]",
        "arxiv_panel": "arXiv 小节\nsettings.section[arxiv]",
        "toast": "提示卡\nshell.overlay[superman.toast]",
        "sidebar": "侧边栏\nsidebar.panellist\n(conversation, chat, superman)",
        "api": "已鉴权的 /api Fetch 路由",
        "sse": "POST /api/chat-mode/stream\nSSE ← ctx.llm.stream()",
        "memory": "POST /api/superman/api\nGET /api/superman/file",
        "prompt": "systemPrompt.section()\n动态记忆体摘要",
        "session": "session/event 监听\nHarness 上传与轮次记录",
        "store": "~/.dsh/superman\nindex.json + files/",
        "llm": "ctx.llm",
    },
}


def use_cjk_font(lang: str) -> None:
    """Let a Chinese-capable face handle the CJK glyphs of one language."""
    if not os.path.exists(CJK_FONT):
        return
    from matplotlib import font_manager

    entry = font_manager.FontProperties(fname=CJK_FONT)
    if lang == "zh":
        plt.rcParams["font.family"] = entry.get_name()
    else:
        # Keep the English figures in a Latin face but fall back to Songti for CJK.
        plt.rcParams["font.family"] = ["DejaVu Sans", entry.get_name()]
    matplotlib.rcParams["axes.unicode_minus"] = False


def style(axis) -> None:
    axis.set_axisbelow(True)
    axis.grid(axis="y", color=GRID, linewidth=0.6)
    for side in ("top", "right"):
        axis.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        axis.spines[side].set_color(GRID)
    axis.tick_params(colors=INK, labelsize=8)


def figure_inventory(lang: str, labels: dict, out: Path) -> None:
    rows = DATA["inventory"]
    names = [row["module"] for row in rows]
    lines = [row["lines"] for row in rows]
    fig, axis = plt.subplots(figsize=(3.4, 2.1), dpi=260)
    bars = axis.bar(names, lines, color=[ACCENT, ACCENT_3, ACCENT_2], width=0.58)
    axis.set_ylabel(labels["inventory_y"], fontsize=8, color=INK)
    axis.set_title(labels["inventory_title"], fontsize=9, color=INK, pad=6)
    for bar, value in zip(bars, lines):
        axis.text(bar.get_x() + bar.get_width() / 2, value + 60, f"{value:,}", ha="center", fontsize=7.5, color=INK)
    axis.set_ylim(0, max(lines) * 1.18)
    style(axis)
    fig.tight_layout(pad=0.3)
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)


def figure_suites(lang: str, labels: dict, out: Path) -> None:
    rows = DATA["suiteSizes"]
    names = [row["suite"].replace(".mjs", "").replace("chat-mode-", "cm-") for row in rows]
    checks = []
    for row in rows:
        # The check counts are recorded in FACTS; keep them next to the suite list.
        checks.append({"chat-mode-check": 77, "chat-mode-format-check": 59, "superman-host-check": 39, "superman-check": 57, "arxiv-smoke": 52}[row["suite"].replace(".mjs", "")])
    fig, axis = plt.subplots(figsize=(3.4, 2.1), dpi=260)
    bars = axis.bar(names, checks, color=ACCENT, width=0.58)
    axis.set_ylabel(labels["suites_y"], fontsize=8, color=INK)
    axis.set_title(labels["suites_title"], fontsize=9, color=INK, pad=6)
    for bar, value in zip(bars, checks):
        axis.text(bar.get_x() + bar.get_width() / 2, value + 1.5, str(value), ha="center", fontsize=7.5, color=INK)
    axis.set_ylim(0, max(checks) * 1.2)
    axis.tick_params(axis="x", labelrotation=18, labelsize=7)
    style(axis)
    fig.tight_layout(pad=0.3)
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)


def figure_pdf_chars(lang: str, labels: dict, out: Path) -> None:
    rows = [row for row in DATA["corpus"] if row.get("pages")]
    fig, axis = plt.subplots(figsize=(3.4, 2.2), dpi=260)
    pages = [row["pages"] for row in rows]
    characters = [row["characters"] for row in rows]
    cjk = [row["cjk"] for row in rows]
    axis.scatter(pages, characters, s=26, color=ACCENT, label="all characters", zorder=3)
    axis.scatter(pages, cjk, s=20, color=ACCENT_2, marker="^", label="CJK characters", zorder=3)
    for row in rows:
        if row["characters"] > 40000 or row["pages"] > 12:
            axis.annotate(f'{row["name"][:10]}…', (row["pages"], row["characters"]), textcoords="offset points", xytext=(-6, 5), fontsize=6.5, color=INK)
    axis.set_xlabel(labels["pdf_chars_x"], fontsize=8, color=INK)
    axis.set_ylabel(labels["pdf_chars_y"], fontsize=8, color=INK)
    axis.set_title(labels["pdf_chars_title"], fontsize=9, color=INK, pad=6)
    axis.legend(fontsize=6.5, frameon=False)
    style(axis)
    fig.tight_layout(pad=0.3)
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)


def figure_pdf_latency(lang: str, labels: dict, out: Path) -> None:
    rows = [row for row in DATA["corpus"] if row.get("pages")]
    fig, axis = plt.subplots(figsize=(3.4, 2.2), dpi=260)
    pages = [row["pages"] for row in rows]
    times = [row["medianMs"] for row in rows]
    axis.scatter(pages, times, s=26, color=ACCENT_3, zorder=3)
    for row in rows:
        if row["medianMs"] > 30:
            axis.annotate(f'{row["name"][:10]}…', (row["pages"], row["medianMs"]), textcoords="offset points", xytext=(-4, 5), fontsize=6.5, color=INK)
    axis.set_xlabel(labels["pdf_latency_x"], fontsize=8, color=INK)
    axis.set_ylabel(labels["pdf_latency_y"], fontsize=8, color=INK)
    axis.set_title(labels["pdf_latency_title"], fontsize=9, color=INK, pad=6)
    style(axis)
    fig.tight_layout(pad=0.3)
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)


def figure_encoding(lang: str, labels: dict, out: Path) -> None:
    rows = DATA["encodings"]
    correct = sum(1 for row in rows if row["correct"])
    fig, axis = plt.subplots(figsize=(3.2, 1.5), dpi=260)
    axis.barh([0], [correct], color=ACCENT_3, height=0.5, label=labels["encoding_ok"])
    axis.barh([0], [len(rows) - correct], left=[correct], color=ACCENT_2, height=0.5, label=labels["encoding_bad"])
    axis.set_yticks([])
    axis.set_xlim(0, len(rows))
    axis.set_xlabel(labels["encoding_y"], fontsize=8, color=INK)
    axis.set_title(labels["encoding_title"], fontsize=9, color=INK, pad=6)
    axis.text(correct / 2, 0, f"{correct}/{len(rows)}", ha="center", va="center", fontsize=8, color="white")
    axis.legend(fontsize=6.5, frameon=False, loc="lower right")
    style(axis)
    fig.tight_layout(pad=0.3)
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)


def figure_architecture(lang: str, labels: dict, out: Path) -> None:
    fig, axis = plt.subplots(figsize=(6.9, 2.9), dpi=260)
    axis.set_xlim(0, 100)
    axis.set_ylim(0, 44)
    axis.axis("off")

    def box(x, y, w, h, text, color, text_color=INK, size=6.4, fill=0.09):
        axis.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1.2", linewidth=0.7, edgecolor=color, facecolor=color, alpha=fill, zorder=2))
        axis.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=size, color=text_color, zorder=3, linespacing=1.35)

    def arrow(x1, y1, x2, y2, color=INK, style="-|>", radius=0.15, dashed=False):
        axis.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style, mutation_scale=7, linewidth=0.8, color=color, connectionstyle=f"arc3,rad={radius}", linestyle="--" if dashed else "-", zorder=4))

    axis.text(1, 41.5, labels["browser"], fontsize=7, color=INK, weight="bold")
    axis.add_patch(FancyBboxPatch((0.5, 25.5), 99, 14.5, boxstyle="round,pad=0.5,rounding_size=1.4", linewidth=0.7, edgecolor=GRID, facecolor="#f5f6fa", zorder=1))
    box(3, 32.5, 20, 6, labels["chat_panel"], ACCENT)
    box(27, 32.5, 20, 6, labels["superman_panel"], ACCENT_3)
    box(51, 32.5, 20, 6, labels["arxiv_panel"], ACCENT_2)
    box(75, 32.5, 22, 6, labels["toast"], ACCENT)
    box(3, 26.5, 51, 4.6, labels["sidebar"], ACCENT_3, size=6.1)
    box(58, 26.5, 39, 4.6, labels["prompt"], ACCENT_2, size=6.1)

    axis.add_patch(FancyBboxPatch((0.5, 2), 99, 20, boxstyle="round,pad=0.5,rounding_size=1.4", linewidth=0.7, edgecolor=GRID, facecolor="#f7f7fb", zorder=1))
    axis.text(1, 21, labels["host"], fontsize=7, color=INK, weight="bold")
    box(6, 12.5, 26, 6.4, labels["sse"], ACCENT)
    box(38, 12.5, 26, 6.4, labels["memory"], ACCENT_3)
    box(70, 12.5, 24, 6.4, labels["session"], ACCENT_2, size=6.1)
    box(6, 3.5, 26, 6.4, labels["llm"], ACCENT, size=6.4)
    box(38, 3.5, 26, 6.4, labels["store"], ACCENT_3, size=6.1)
    box(70, 3.5, 24, 6.4, labels["prompt"], ACCENT_2, size=6.1)

    axis.text(50, 23.4, labels["api"], ha="center", fontsize=6.6, color=INK)
    arrow(13, 26.3, 13, 19.2, ACCENT)
    arrow(37, 26.3, 37, 19.2, ACCENT_3)
    arrow(56.4, 32.5, 56.4, 19.2, ACCENT_2, dashed=True)
    arrow(19, 12.5, 19, 9.9, ACCENT)
    arrow(48, 12.5, 48, 9.9, ACCENT_3)
    arrow(82, 12.5, 82, 9.9, ACCENT_2)
    arrow(32, 15.7, 33.5, 15.7, ACCENT_3)
    axis.text(50, 0.7, "DSH extension bundles: @local/dsh-chat-mode · @local/dsh-superman · @local/dsh-arxiv", ha="center", fontsize=6.2, color="#5b5f6b")
    fig.tight_layout(pad=0.2)
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    for lang in ("en", "zh"):
        labels = LABELS[lang]
        directory = PAPERS / "figures" / lang
        directory.mkdir(parents=True, exist_ok=True)
        use_cjk_font(lang)
        figure_architecture(lang, labels, directory / "fig-architecture.png")
        figure_inventory(lang, labels, directory / "fig-inventory.png")
        figure_suites(lang, labels, directory / "fig-suites.png")
        figure_pdf_chars(lang, labels, directory / "fig-pdf-chars.png")
        figure_pdf_latency(lang, labels, directory / "fig-pdf-latency.png")
        figure_encoding(lang, labels, directory / "fig-encoding.png")
        print(f"{lang}: wrote 6 figures to {directory}")


if __name__ == "__main__":
    main()
