#!/usr/bin/env python3
"""Typeset the two manuscripts as PRD-style two-column PDFs.

Reads ``papers/paper-en.md`` / ``papers/paper-zh.md`` plus the measured data and
the figures, and writes ``papers/paper-en.pdf`` / ``papers/paper-zh.pdf``.

Requires reportlab (``pip install reportlab``); the workspace's temporary
virtualenv was used during development:

    /tmp/pdfenv/bin/python papers/tools/build_pdf.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Frame,
    FrameBreak,
    Image,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[2]
PAPERS = ROOT / "papers"
DATA = json.loads((PAPERS / "data" / "metrics.json").read_text(encoding="utf-8"))

PAGE = A4
MARGIN_X = 17 * mm
MARGIN_TOP = 19 * mm
MARGIN_BOTTOM = 18 * mm
GUTTER = 6 * mm
COLUMN = (PAGE[0] - 2 * MARGIN_X - GUTTER) / 2
BODY_HEIGHT = PAGE[1] - MARGIN_TOP - MARGIN_BOTTOM

INK = colors.HexColor("#14161c")
RULE = colors.HexColor("#9aa1b1")
ACCENT = colors.HexColor("#2f5bd7")

CJK_SERIF = "/System/Library/Fonts/Supplemental/Songti.ttc"
CJK_BOLD_INDEX = 1
CJK_BODY_INDEX = 4


def register_fonts(lang: str) -> dict:
    """Register the fonts one language needs and return their names."""
    pdfmetrics.registerFont(TTFont("Song", CJK_SERIF, subfontIndex=CJK_BODY_INDEX))
    pdfmetrics.registerFont(TTFont("SongBold", CJK_SERIF, subfontIndex=CJK_BOLD_INDEX))
    pdfmetrics.registerFontFamily("Song", normal="Song", bold="SongBold", italic="Song", boldItalic="SongBold")
    if lang == "zh":
        return {"body": "Song", "bold": "SongBold", "italic": "Song", "mono": "Courier"}
    return {"body": "Times-Roman", "bold": "Times-Bold", "italic": "Times-Italic", "mono": "Courier"}


def styles(lang: str, fonts: dict) -> dict:
    """Paragraph styles for one language."""
    body_size = 9.6 if lang == "zh" else 8.9
    leading = body_size * 1.42 if lang == "zh" else body_size * 1.24
    wrap = "CJK" if lang == "zh" else None
    base = dict(fontName=fonts["body"], fontSize=body_size, leading=leading, textColor=INK, alignment=TA_JUSTIFY)
    if wrap:
        base["wordWrap"] = wrap
    make = lambda **extra: ParagraphStyle("s", parent=None, **{**base, **extra})
    return {
        "title": ParagraphStyle("title", fontName=fonts["bold"], fontSize=19 if lang == "en" else 20, leading=24 if lang == "en" else 27, textColor=INK, alignment=TA_CENTER, spaceAfter=6),
        "authors": ParagraphStyle("authors", fontName=fonts["body"], fontSize=10.5, leading=15, textColor=INK, alignment=TA_CENTER),
        "affiliation": ParagraphStyle("aff", fontName=fonts["body"], fontSize=9, leading=13, textColor=colors.HexColor("#4a4f5c"), alignment=TA_CENTER, spaceAfter=10),
        "h1": make(fontName=fonts["bold"], fontSize=11 if lang == "en" else 11.4, leading=14.4, alignment=TA_LEFT, spaceBefore=7, spaceAfter=2.8),
        "h2": make(fontName=fonts["bold"], fontSize=9.8 if lang == "en" else 10.2, leading=12.6, alignment=TA_LEFT, spaceBefore=4.6, spaceAfter=2),
        "body": make(spaceAfter=2.6, firstLineIndent=0),
        "abstract_label": make(fontName=fonts["bold"], fontSize=9.4, spaceAfter=1),
        "abstract": make(fontSize=8.6 if lang == "en" else 9.4, leading=11.6 if lang == "en" else 13.8, spaceAfter=3),
        "keywords": make(fontSize=8.5 if lang == "en" else 9.2, leading=11.6 if lang == "en" else 13.4, spaceAfter=5),
        "caption": ParagraphStyle("caption", fontName=fonts["body"], fontSize=7.7, leading=10.1, textColor=colors.HexColor("#33384a"), alignment=TA_LEFT, spaceBefore=2, spaceAfter=5),
        "tablecap": ParagraphStyle("tablecap", fontName=fonts["body"], fontSize=7.7, leading=10.1, textColor=colors.HexColor("#33384a"), alignment=TA_LEFT, spaceAfter=2),
        "cell": ParagraphStyle("cell", fontName=fonts["body"], fontSize=6.9, leading=8.6, textColor=INK, wordWrap="CJK"),
        "cellhead": ParagraphStyle("cellhead", fontName=fonts["bold"], fontSize=7.1, leading=8.8, textColor=colors.white, wordWrap="CJK"),
        "code": ParagraphStyle("code", fontName=fonts["mono"], fontSize=6.8, leading=8.4, textColor=colors.HexColor("#1d2333")),
        "list": make(spaceAfter=1.6, leftIndent=9, bulletIndent=1),
        "ref": make(fontSize=7.3 if lang == "en" else 7.9, leading=9.4 if lang == "en" else 10.6, leftIndent=11, firstLineIndent=-11, spaceAfter=1.6),
    }


INLINE = [
    (re.compile(r"\*\*(.+?)\*\*"), r"<b>\1</b>"),
    (re.compile(r"(?<!\*)\*([^*\n]+?)\*(?!\*)"), r"<i>\1</i>"),
    (re.compile(r"`([^`]+?)`"), r'<font face="Courier" size="7.6">\1</font>'),
]


CJK_RUN = re.compile(r"[\u2e80-\u9fff\uff00-\uffef]+")


def inline(text: str, fonts: dict) -> str:
    """Convert the little inline Markdown the manuscripts use into mini-HTML.

    The English manuscript quotes a few Chinese literals from the interface; a
    Times face has no glyphs for them, so each CJK run is wrapped in the CJK face
    registered for that purpose. Without this the quotes vanish from the page.
    """
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    for pattern, replacement in INLINE:
        text = pattern.sub(replacement, text)
    if fonts["body"] != "Song":
        text = CJK_RUN.sub(lambda match: f'<font face="Song">{match.group(0)}</font>', text)
    return text


FIGURE_FILES = {
    "architecture": "fig-architecture.png",
    "inventory": "fig-inventory.png",
    "suites": "fig-suites.png",
    "pdf-chars": "fig-pdf-chars.png",
    "pdf-latency": "fig-pdf-latency.png",
    "encoding": "fig-encoding.png",
}


def cells(rows: list[list[str]], style: dict, header: bool = True, widths: list[float] | None = None) -> Table:
    """One data table in the paper's rule style."""
    data = []
    for index, row in enumerate(rows):
        row_style = style["cellhead"] if header and index == 0 else style["cell"]
        data.append([Paragraph(str(value), row_style) for value in row])
    table = Table(data, hAlign="CENTER", repeatRows=1 if header else 0, colWidths=widths)
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2f3a56")) if header else ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("LINEABOVE", (0, 0), (-1, 0), 0.8, INK),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, RULE),
        ("LINEBELOW", (0, -1), (-1, -1), 0.8, INK),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 1.4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.4),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        commands.append(("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f8")]))
    table.setStyle(TableStyle(commands))
    return table


def data_tables(lang: str, style: dict) -> dict:
    """Build every table from the measured data, with localized headers."""
    zh = lang == "zh"
    tables: dict[str, tuple[list[list[str]], str]] = {}

    inventory = DATA["inventory"]
    tables["inventory"] = (
        [(["模块", "文件数", "行数", "字节"] if zh else ["module", "files", "lines", "bytes"])]
        + [[row["module"], str(len(row["files"])), f'{row["lines"]:,}', f'{row["bytes"]:,}'] for row in inventory]
        + [(["合计", "6", f'{sum(row["lines"] for row in inventory):,}', f'{sum(row["bytes"] for row in inventory):,}'] if zh else ["total", "6", f'{sum(row["lines"] for row in inventory):,}', f'{sum(row["bytes"] for row in inventory):,}'])],
        "各模块代码规模。" if zh else "Code size per module.",
        [64, 34, 42, 58],
    )

    checks = {"chat-mode-check": 77, "chat-mode-format-check": 59, "superman-host-check": 39, "superman-check": 57, "arxiv-smoke": 52}
    purposes_en = {
        "chat-mode-check": "pipeline: route, SSE, history, attachments, memory wiring",
        "chat-mode-format-check": "LaTeX→MathML, Markdown, decoding",
        "superman-host-check": "classification, store, recall, capture",
        "superman-check": "panel: entry, folders, preview, upload, notices",
        "arxiv-smoke": "arXiv bundle incl. bookmark paths",
    }
    purposes_zh = {
        "chat-mode-check": "管线：路由、SSE、历史、附件、记忆体联动",
        "chat-mode-format-check": "LaTeX→MathML、Markdown、编码识别",
        "superman-host-check": "分类、存储、回忆、捕获",
        "superman-check": "面板：入口、文件夹、预览、上传、提示",
        "arxiv-smoke": "arXiv 半，含收藏路径",
    }
    rows = [(["套件", "用途", "检查项", "行数"] if zh else ["suite", "purpose", "checks", "lines"])]
    for row in DATA["suiteSizes"]:
        key = row["suite"].replace(".mjs", "")
        rows.append([row["suite"], (purposes_zh if zh else purposes_en)[key], str(checks[key]), str(row["lines"])])
    rows.append(["合计" if zh else "total", "", str(sum(checks.values())), str(sum(row["lines"] for row in DATA["suiteSizes"]))])
    tables["suites"] = (rows, "离线验证套件。" if zh else "Offline verification suites.", [78, 88, 28, 28])

    rows = [(["文件（化名）", "KB", "毫秒", "字符", "汉字", "页", "备注"] if zh else ["file (alias)", "KB", "ms", "chars", "CJK", "pp", "note"])]
    for row in DATA["corpus"]:
        if not row.get("pages"):
            continue
        rows.append([
            row["name"],
            f'{row["bytes"] / 1024:.0f}',
            f'{row["medianMs"]:.1f}',
            f'{row["characters"]:,}',
            f'{row["cjk"]:,}',
            str(row["pages"]),
            row.get("note", ""),
        ])
    textless = len([row for row in DATA["corpus"] if not row.get("pages")])
    rows.append((["文本层缺失", "—", "—", "0", "0", "0", f"{textless} files"] if zh else ["no text layer", "—", "—", "0", "0", "0", f"{textless} files"]))
    tables["pdf"] = (rows, "真实语料上的 PDF 文本抽取（文件名为化名）。" if zh else "PDF text extraction over the corpus (file names are aliases).", [62, 26, 26, 38, 30, 22, 36])

    rows = [(["探测样本", "期望", "识别结果", "正确"] if zh else ["probe", "expected", "detected", "ok"])]
    for row in DATA["encodings"]:
        rows.append([row["label"], row["expected"], row["detected"], "✓" if row["correct"] else "✗"])
    tables["encoding"] = (rows, "文件编码识别探测。" if zh else "File-encoding detection probes.", [78, 52, 66, 24])

    battery = DATA["math"]["battery"]
    rows = [(["表达式", "MathML 字符", "分式", "上下标", "表格", "合格"] if zh else ["expression", "markup", "fractions", "scripts", "tables", "ok"])]
    for row in battery[:8]:
        rows.append([
            row["expression"][:28].replace("\\", ""),
            str(row["markupLength"]),
            str(row["fractions"]),
            str(row["scripts"]),
            str(row["tables"]),
            "✓" if row["valid"] and not row["backslashLeak"] else "✗",
        ])
    rows.append((["… 共 16 条", "", "", "", "", "16/16"] if zh else ["… 16 total", "", "", "", "", "16/16"]))
    tables["math"] = (rows, "LaTeX→MathML 表达式清单（节选）。" if zh else "LaTeX→MathML battery (excerpt).", [84, 40, 32, 32, 30, 24])

    tables["slots"] = (
        [
            (["槽位", "条目 id", "顺序", "用途"] if zh else ["slot", "entry id", "order", "purpose"]),
            ["sidebar.panellist", "conversation", "-20", "Harness 模式入口" if zh else "Harness mode entry"],
            ["sidebar.panellist", "chat", "-10", "Chat 模式入口" if zh else "Chat mode entry"],
            ["sidebar.panellist", "superman", "-5", "记忆体入口" if zh else "memory entry"],
            ["main", "chat", "—", "对话面板" if zh else "conversation panel"],
            ["main", "superman", "—", "记忆体面板" if zh else "memory panel"],
            ["settings.section", "arxiv", "20", "arXiv 搜索小节" if zh else "arXiv search section"],
            ["shell.overlay", "superman.toast", "—", "收录提示卡" if zh else "remembered-file notices"],
        ],
        "本套件占用的槽位（均为新增条目，不替换随包 UI）。" if zh else "Slots the suite occupies (all additive; shipped UI is never replaced).",
        [72, 62, 24, 74],
    )
    return tables


def parse_manuscript(path: Path, lang: str, style: dict, fonts: dict) -> list:
    """Turn one manuscript into a flowable story."""
    lines = path.read_text(encoding="utf-8").split("\n")
    story: list = []
    tables = data_tables(lang, style)
    figure_dir = PAPERS / "figures" / lang

    index = 0
    paragraph: list[str] = []
    list_items: list[str] = []
    code: list[str] = []
    in_code = False

    def flush_paragraph() -> None:
        nonlocal paragraph
        if not paragraph:
            return
        text = " ".join(line.strip() for line in paragraph)
        story.append(Paragraph(inline(text, fonts), style["body"]))
        paragraph = []

    def flush_list() -> None:
        nonlocal list_items
        for item in list_items:
            story.append(Paragraph(f"• {inline(item, fonts)}", style["list"]))
        list_items = []

    def flush_code() -> None:
        nonlocal code
        if not code:
            return
        block = Table([[Paragraph("<br/>".join(line.replace(" ", "&nbsp;") for line in code) or "&nbsp;", style["code"])]], colWidths=[COLUMN - 4])
        block.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f2f3f7")),
            ("BOX", (0, 0), (-1, -1), 0.3, RULE),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(block)
        story.append(Spacer(1, 3))
        code = []

    def emit_figure(key: str, caption: str) -> None:
        path_png = figure_dir / FIGURE_FILES[key]
        if not path_png.exists():
            return
        from PIL import Image as PILImage

        width, height = PILImage.open(path_png).size
        target = COLUMN - (14 if key == "architecture" else 24)
        image = Image(str(path_png), width=target, height=target * height / width)
        story.append(KeepTogether([Spacer(1, 2), image, Paragraph(inline(caption, fonts), style["caption"])]))

    while index < len(lines):
        raw = lines[index]
        line = raw.rstrip()
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_code:
                flush_code()
                in_code = False
            else:
                flush_paragraph()
                flush_list()
                in_code = True
            index += 1
            continue
        if in_code:
            code.append(line)
            index += 1
            continue

        placeholder = re.fullmatch(r"\[\[(FIG|TAB):([a-z\-]+)\]\]", stripped)
        if placeholder is not None:
            flush_paragraph()
            flush_list()
            kind, key = placeholder.group(1), placeholder.group(2)
            caption = lines[index + 1].strip() if index + 1 < len(lines) else ""
            if caption.startswith(("Figure", "Table", "图", "表")):
                index += 1
            if kind == "FIG":
                emit_figure(key, caption)
            else:
                entry = tables[key]
                rows, widths = entry[0], (entry[2] if len(entry) > 2 else None)
                story.append(KeepTogether([Paragraph(inline(caption, fonts), style["tablecap"]), cells(rows, style, True, widths)]))
            index += 1
            continue

        if stripped.startswith("# "):
            flush_paragraph()
            flush_list()
            story.append(Paragraph(inline(stripped[2:], fonts), style["title"]))
            index += 1
            continue
        if stripped.startswith("## "):
            flush_paragraph()
            flush_list()
            heading = stripped[3:]
            if heading.lower().startswith(("abstract", "摘要")):
                story.append(Paragraph(inline(heading, fonts), style["abstract_label"]))
            elif heading.lower().startswith(("references", "参考文献")):
                story.append(CondPageBreak(40 * mm))
                story.append(Paragraph(inline(heading, fonts), style["h1"]))
            else:
                story.append(CondPageBreak(26 * mm))
                story.append(Paragraph(inline(heading, fonts), style["h1"]))
            index += 1
            continue
        if stripped.startswith("### "):
            flush_paragraph()
            flush_list()
            story.append(CondPageBreak(20 * mm))
            story.append(Paragraph(inline(stripped[4:], fonts), style["h2"]))
            index += 1
            continue
        if stripped.startswith("**Authors") or stripped.startswith("**作者"):
            flush_paragraph()
            story.append(Paragraph(inline(stripped.strip("*"), fonts), style["authors"]))
            index += 1
            continue
        if stripped.startswith("**Keywords") or stripped.startswith("**关键词"):
            flush_paragraph()
            story.append(Paragraph(inline(stripped.strip("*"), fonts), style["keywords"]))
            index += 1
            continue
        if stripped.startswith("- "):
            flush_paragraph()
            list_items.append(stripped[2:])
            index += 1
            continue
        if stripped == "":
            flush_paragraph()
            flush_list()
            index += 1
            continue
        if re.match(r"^\d+\.\s", stripped) and (style["ref"].fontSize < 9):
            flush_paragraph()
            story.append(Paragraph(inline(stripped, fonts), style["ref"]))
            index += 1
            continue
        paragraph.append(stripped)
        index += 1

    flush_paragraph()
    flush_list()
    return story


def build(lang: str) -> Path:
    """Build one PDF and return its path."""
    fonts = register_fonts(lang)
    style = styles(lang, fonts)
    source = PAPERS / f"paper-{lang}.md"
    target = PAPERS / f"paper-{lang}.pdf"

    title_frame = Frame(MARGIN_X, PAGE[1] - MARGIN_TOP - 62 * mm, PAGE[0] - 2 * MARGIN_X, 62 * mm, id="title", showBoundary=0)
    left_first = Frame(MARGIN_X, MARGIN_BOTTOM, COLUMN, BODY_HEIGHT - 62 * mm - 5 * mm, id="left1", showBoundary=0)
    right_first = Frame(MARGIN_X + COLUMN + GUTTER, MARGIN_BOTTOM, COLUMN, BODY_HEIGHT - 62 * mm - 5 * mm, id="right1", showBoundary=0)
    left = Frame(MARGIN_X, MARGIN_BOTTOM, COLUMN, BODY_HEIGHT, id="left", showBoundary=0)
    right = Frame(MARGIN_X + COLUMN + GUTTER, MARGIN_BOTTOM, COLUMN, BODY_HEIGHT, id="right", showBoundary=0)

    doc = BaseDocTemplate(
        str(target),
        pagesize=PAGE,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
        title=(source.read_text(encoding="utf-8").split("\n")[0].lstrip("# ").strip()),
        author="Zeng Pu",
        subject="DeepSeek Harness extension suite",
    )

    def decorate(canvas, document) -> None:
        canvas.saveState()
        canvas.setFont(fonts["body"], 7.4)
        canvas.setFillColor(colors.HexColor("#5a5f6d"))
        canvas.drawCentredString(PAGE[0] / 2, MARGIN_BOTTOM - 9, str(document.page))
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.3)
        if document.page > 1:
            canvas.line(MARGIN_X, PAGE[1] - MARGIN_TOP + 6, PAGE[0] - MARGIN_X, PAGE[1] - MARGIN_TOP + 6)
            canvas.drawString(MARGIN_X, PAGE[1] - MARGIN_TOP + 9, "Superman: an extension suite for DeepSeek Harness" if lang == "en" else "Superman：DeepSeek Harness 扩展体系")
        canvas.restoreState()

    doc.addPageTemplates([
        PageTemplate(id="first", frames=[title_frame, left_first, right_first], onPage=decorate),
        PageTemplate(id="rest", frames=[left, right], onPage=decorate),
    ])

    story: list = [NextPageTemplate("rest")]
    body = parse_manuscript(source, lang, style, fonts)
    # Everything up to the first numbered section stays full width (title block).
    split = 0
    for position, flowable in enumerate(body):
        text = getattr(flowable, "text", "")
        if isinstance(text, str) and re.match(r"^(1|一)[\s.、]", text.strip()):
            split = position
            break
    story.extend(body[:split])
    story.append(FrameBreak())
    story.extend(body[split:])
    doc.build(story)

    with target.open("rb") as handle:
        pages = handle.read().count(b"/Type /Page") - 1
    print(f"{lang}: {target} — {target.stat().st_size / 1024:.0f} KB, ~{max(1, pages)} pages")
    return target


if __name__ == "__main__":
    for language in ("en", "zh"):
        if not (PAPERS / f"paper-{language}.md").exists():
            print(f"{language}: manuscript missing, skipped")
            continue
        build(language)
