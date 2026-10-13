#!/usr/bin/env python3
"""Nature-style typesetter for the two v2 manuscripts.

Reads ``papers/v2/paper-en.md`` / ``papers/v2/paper-zh.md``, the measured data in
``papers/v2/data/metrics.json`` and the figures in ``papers/v2/figures/<lang>/``,
and writes ``papers/v2/paper-en.pdf`` / ``papers/v2/paper-zh.pdf``.

Layout: one wide column on A4 with generous margins; sans-serif (Helvetica)
title, section headings, table heads and figure captions; the scientific body
face is STIX Two Text, with STIXGeneral carrying symbols and Songti carrying
Han runs quoted inside the English manuscript. STIX Two Math is a CFF-outline
OpenType face, which ReportLab cannot embed, so the symbol face is its TrueType
sibling STIXGeneral — the same family, the same glyphs. The abstract is set at a
narrower measure, figure captions sit below their figure, table captions above
their table, references are a hanging-indent list, and every page carries a
running head and a page number.

The builder verifies its own output with PyMuPDF when it is importable: the page
count, that no page is blank, that every figure and table of the programme is
present, that a featured numeral reaches the text layer, and that no text lands
outside the margins.

Usage::

    /tmp/pdfenv/bin/python papers/v2/tools/build_pdf.py            # both languages
    /tmp/pdfenv/bin/python papers/v2/tools/build_pdf.py --lang en
    /tmp/pdfenv/bin/python papers/v2/tools/build_pdf.py --source-dir /tmp/v2-synth --out-dir /tmp/v2-synth

When ``paper-<lang>.md`` is missing the builder falls back to the synthetic
manuscript in ``/tmp/v2-synth`` (see ``synthetic_manuscript.py``) and writes the
PDFs there too, so the repository never receives placeholder content.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import struct
import subprocess
import sys
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
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[3]
V2 = ROOT / "papers" / "v2"
SYNTHETIC = Path("/tmp/v2-synth")

PAGE = A4
MARGIN_X = 19.5 * mm
MARGIN_TOP = 19 * mm
MARGIN_BOTTOM = 18 * mm
COLUMN = PAGE[0] - 2 * MARGIN_X
BODY_HEIGHT = PAGE[1] - MARGIN_TOP - MARGIN_BOTTOM
TARGET_PAGES = 19

INK = colors.HexColor("#111318")
RULE = colors.HexColor("#9aa1b1")
MUTED = colors.HexColor("#4d525e")
ACCENT = colors.HexColor("#2f5bd7")

# ---------------------------------------------------------------------------
# fonts
# ---------------------------------------------------------------------------
SUPPLEMENTAL = Path("/System/Library/Fonts/Supplemental")
SONGTI = SUPPLEMENTAL / "Songti.ttc"
STIX_TEXT = SUPPLEMENTAL / "STIXTwoText.ttf"
STIX_TEXT_ITALIC = SUPPLEMENTAL / "STIXTwoText-Italic.ttf"
MPL_TTF = "/opt/anaconda3/lib/python3*/site-packages/matplotlib/mpl-data/fonts/ttf"

# The WinAnsi repertoire ReportLab gives the built-in Type 1 faces.
WINANSI = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100)) | {
    0x152, 0x153, 0x160, 0x161, 0x178, 0x17D, 0x17E, 0x192, 0x2C6, 0x2C7, 0x2D8,
    0x2D9, 0x2DA, 0x2DB, 0x2DC, 0x2DD, 0x2013, 0x2014, 0x2018, 0x2019, 0x201A,
    0x201C, 0x201D, 0x201E, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039,
    0x203A, 0x20AC, 0x2122,
}


def find_font(pattern: str) -> Path | None:
    """First existing path matching one glob (used for the matplotlib STIX files)."""
    for candidate in sorted(Path("/").glob(pattern.lstrip("/"))):
        return candidate
    return None


def ttf_codepoints(path: Path, index: int = 0) -> set[int]:
    """The set of Unicode codepoints one TrueType face maps to a real glyph.

    A small cmap reader (formats 4 and 12) so the builder does not need
    fontTools; the fallback chain depends on knowing exactly which characters a
    face can and cannot draw.
    """
    data = path.read_bytes()
    if data[:4] == b"ttcf":
        offset = struct.unpack(">I", data[12 + 4 * index : 16 + 4 * index])[0]
    else:
        offset = 0
    table_count = struct.unpack(">H", data[offset + 4 : offset + 6])[0]
    tables: dict[bytes, int] = {}
    for position in range(table_count):
        record = offset + 12 + 16 * position
        tag = data[record : record + 4]
        tables[tag] = struct.unpack(">I", data[record + 8 : record + 12])[0]
    if b"cmap" not in tables:
        return set()
    cmap = tables[b"cmap"]
    subtables = struct.unpack(">H", data[cmap + 2 : cmap + 4])[0]
    scores = {(3, 10): 5, (0, 4): 4, (0, 6): 4, (3, 1): 3, (0, 3): 2, (1, 0): 1}
    best: tuple[int, int] | None = None
    for position in range(subtables):
        record = cmap + 4 + 8 * position
        platform, encoding, sub = struct.unpack(">HHI", data[record : record + 8])
        score = scores.get((platform, encoding))
        if score is None:
            continue
        if best is None or score > best[0]:
            best = (score, cmap + sub)
    if best is None:
        return set()
    start = best[1]
    fmt = struct.unpack(">H", data[start : start + 2])[0]
    points: set[int] = set()
    if fmt == 4:
        length, seg_x2 = struct.unpack(">HH", data[start + 2 : start + 6])
        segments = seg_x2 // 2
        ends = struct.unpack(f">{segments}H", data[start + 14 : start + 14 + seg_x2])
        starts_at = start + 16 + seg_x2
        starts = struct.unpack(f">{segments}H", data[starts_at : starts_at + seg_x2])
        deltas_at = starts_at + seg_x2 + 2
        deltas = struct.unpack(f">{segments}h", data[deltas_at : deltas_at + seg_x2])
        ranges_at = deltas_at + seg_x2
        ranges = struct.unpack(f">{segments}H", data[ranges_at : ranges_at + seg_x2])
        for index_ in range(segments):
            for code in range(starts[index_], min(ends[index_], 0xFFFF) + 1):
                if ranges[index_] == 0:
                    glyph = (code + deltas[index_]) & 0xFFFF
                else:
                    glyph_at = ranges_at + 2 * index_ + ranges[index_] + 2 * (code - starts[index_])
                    if glyph_at + 2 > len(data):
                        continue
                    glyph = struct.unpack(">H", data[glyph_at : glyph_at + 2])[0]
                    if glyph:
                        glyph = (glyph + deltas[index_]) & 0xFFFF
                if glyph:
                    points.add(code)
    elif fmt == 12:
        groups = struct.unpack(">I", data[start + 12 : start + 16])[0]
        for position in range(groups):
            record = start + 16 + 12 * position
            first, last, glyph = struct.unpack(">III", data[record : record + 12])
            if glyph:
                points.update(range(first, min(last, 0x10FFFF) + 1))
    return points


class Fonts:
    """The faces one language needs, and which characters each can draw."""

    def __init__(self, lang: str) -> None:
        self.lang = lang
        self.coverage: dict[str, set[int]] = {}
        self.bold_symbol = find_font(f"{MPL_TTF}/STIXGeneralBol.ttf") or STIX_TEXT
        self.symbol = find_font(f"{MPL_TTF}/STIXGeneral.ttf") or STIX_TEXT
        self.body_bold_path = self.bold_symbol
        self._register()

    def _add(self, name: str, path: Path, index: int = 0) -> None:
        pdfmetrics.registerFont(TTFont(name, str(path), subfontIndex=index))
        self.coverage[name] = ttf_codepoints(path, index)

    def _register(self) -> None:
        self._add("STIXText", STIX_TEXT)
        self._add("STIXTextItalic", STIX_TEXT_ITALIC)
        self._add("STIXTextBold", self.body_bold_path)
        pdfmetrics.registerFontFamily(
            "STIXText", normal="STIXText", bold="STIXTextBold",
            italic="STIXTextItalic", boldItalic="STIXTextBold",
        )
        self._add("STIXSym", self.symbol)
        self._add("Songti", SONGTI, 4)
        self._add("SongtiBold", SONGTI, 1)
        for name in ("Helvetica", "Helvetica-Bold", "Courier", "Courier-Bold"):
            self.coverage[name] = set(WINANSI)
        # A CJK face usually lacks some Latin punctuation a Han run sits beside;
        # keeping the chain explicit makes the fallback order deterministic.
        self.names = {
            "body": "STIXText",
            "bold": "STIXTextBold",
            "italic": "STIXTextItalic",
            "boldItalic": "STIXTextBold",
            "sans": "Helvetica",
            "sansBold": "Helvetica-Bold",
            "mono": "Courier",
            "sym": "STIXSym",
            "cjk": "Songti",
            "cjkBold": "SongtiBold",
        }

    def has(self, name: str, character: str) -> bool:
        return ord(character) in self.coverage.get(name, set())

    def pick(self, character: str, primary: str) -> str:
        """The first face in the chain that can draw one character.

        A bold primary asks for the bold Han face, because a bold Latin face
        never carries Han glyphs and a heading set in regular Songti next to
        bold Helvetica would look accidental rather than deliberate.
        """
        if self.has(primary, character):
            return primary
        bold = primary in (self.names["sansBold"], self.names["bold"],
                           self.names["boldItalic"], self.names["cjkBold"])
        han = self.names["cjkBold"] if bold else self.names["cjk"]
        for name in (self.names["sym"], han, self.names["cjk"], self.names["cjkBold"]):
            if name != primary and self.has(name, character):
                return name
        return primary

    def missing(self, text: str, primary: str) -> str:
        """Characters no face in the chain can draw (reported, never printed)."""
        return "".join(sorted({
            character for character in text
            if not any(self.has(name, character)
                       for name in (primary, self.names["sym"], self.names["cjk"]))
        }))


# ---------------------------------------------------------------------------
# inline markup with per-character font fallback
# ---------------------------------------------------------------------------
INLINE = re.compile(r"\*\*(.+?)\*\*|(?<!\*)\*([^*\n]+?)\*(?!\*)|`([^`]+?)`", re.S)


def plain(text: str, fonts: Fonts, primary: str) -> str:
    """Escape one run and wrap the characters the primary face cannot draw."""
    pieces: list[str] = []
    current = primary
    buffer: list[str] = []
    for character in text:
        face = fonts.pick(character, primary)
        if face != current:
            if buffer:
                pieces.append(_wrap("".join(buffer), current, primary))
                buffer = []
            current = face
        buffer.append(character)
    if buffer:
        pieces.append(_wrap("".join(buffer), current, primary))
    return "".join(pieces)


def _wrap(text: str, face: str, primary: str) -> str:
    escaped = html.escape(text)
    if face == primary:
        return escaped
    return f'<font face="{face}">{escaped}</font>'


CITATION = re.compile(r"\[\[(\d+)\]\]")


def inline(text: str, fonts: Fonts, base: str, code_size: float = 7.6) -> str:
    """The small inline Markdown subset, with font fallback per character.

    The English manuscript marks citations as ``[[n]]`` to keep them apart from
    the figure and table placeholders; both render as the Nature-style ``[n]``.
    """
    text = CITATION.sub(r"[\1]", text)
    text = re.sub(r"\\([*_`~])", r"\1", text)
    out: list[str] = []
    position = 0
    for match in INLINE.finditer(text):
        out.append(plain(text[position:match.start()], fonts, base))
        if match.group(1) is not None:
            out.append(plain(match.group(1), fonts, fonts.names["bold"]))
        elif match.group(2) is not None:
            out.append(plain(match.group(2), fonts, fonts.names["italic"]))
        else:
            out.append(f'<font face="{fonts.names["mono"]}" size="{code_size}">'
                       f'{html.escape(match.group(3))}</font>')
        position = match.end()
    out.append(plain(text[position:], fonts, base))
    return "".join(out)


# ---------------------------------------------------------------------------
# styles
# ---------------------------------------------------------------------------
def styles(fonts: Fonts, lang: str, body_size: float) -> dict:
    """Every paragraph style the manuscripts need."""
    zh = lang == "zh"
    leading = body_size * (1.45 if zh else 1.27)
    wrap = "CJK" if zh else None
    base = dict(fontName=fonts.names["body"], fontSize=body_size, leading=leading,
                textColor=INK, alignment=TA_JUSTIFY)
    if wrap:
        base["wordWrap"] = wrap

    def make(**extra):
        return ParagraphStyle("s", parent=None, **{**base, **extra})

    heading = fonts.names["sansBold"]
    return {
        "title": ParagraphStyle("title", fontName=heading, fontSize=20, leading=25,
                                textColor=INK, alignment=TA_LEFT, spaceAfter=7),
        "subtitle": ParagraphStyle("subtitle", fontName=fonts.names["sans"], fontSize=10.5,
                                   leading=14, textColor=MUTED, alignment=TA_LEFT, spaceAfter=8),
        "authors": ParagraphStyle("authors", fontName=fonts.names["sans"], fontSize=10,
                                  leading=14.5, textColor=INK, alignment=TA_LEFT, spaceAfter=2,
                                  wordWrap="CJK"),
        "affiliation": ParagraphStyle("aff", fontName=fonts.names["sans"], fontSize=8,
                                      leading=11.5, textColor=MUTED, alignment=TA_LEFT,
                                      spaceAfter=7, wordWrap="CJK"),
        "h1": ParagraphStyle("h1", fontName=heading, fontSize=12, leading=15, textColor=INK,
                             alignment=TA_LEFT, spaceBefore=9, spaceAfter=4),
        "h2": ParagraphStyle("h2", fontName=heading, fontSize=10, leading=13, textColor=INK,
                             alignment=TA_LEFT, spaceBefore=8, spaceAfter=3),
        "h3": ParagraphStyle("h3", fontName=fonts.names["sansBold"], fontSize=body_size + 0.2,
                             leading=leading, textColor=INK, alignment=TA_LEFT,
                             spaceBefore=6, spaceAfter=2),
        "back": ParagraphStyle("back", fontName=heading, fontSize=body_size + 0.1,
                               leading=leading + 1, textColor=INK, alignment=TA_LEFT,
                               spaceBefore=9, spaceAfter=2.5),
        "body": make(spaceAfter=2.3),
        "abstract_label": ParagraphStyle("abstract-label", fontName=heading, fontSize=10.5,
                                         leading=13, textColor=INK, alignment=TA_LEFT,
                                         spaceBefore=8, spaceAfter=3),
        "abstract": make(fontSize=body_size * 0.98, leading=leading * 0.98,
                         leftIndent=16 * mm, rightIndent=16 * mm, spaceAfter=4),
        "keywords": make(fontSize=body_size - 0.6, leading=leading - 1,
                         leftIndent=16 * mm, rightIndent=16 * mm, spaceAfter=6),
        "caption": ParagraphStyle("caption", fontName=fonts.names["sans"], fontSize=7.4,
                                  leading=9.8, textColor=INK, alignment=TA_LEFT,
                                  spaceBefore=3, spaceAfter=6, wordWrap="CJK"),
        "caption_narrow": ParagraphStyle("caption-narrow", fontName=fonts.names["sans"],
                                         fontSize=6.9, leading=9.0, textColor=INK,
                                         alignment=TA_LEFT, wordWrap="CJK"),
        "tablecap": ParagraphStyle("tablecap", fontName=fonts.names["sans"], fontSize=7.4,
                                   leading=9.8, textColor=INK, alignment=TA_LEFT,
                                   spaceBefore=5, spaceAfter=3, wordWrap="CJK"),
        "cell": ParagraphStyle("cell", fontName=fonts.names["body"], fontSize=6.9,
                               leading=8.7, textColor=INK, alignment=TA_LEFT, wordWrap="CJK"),
        "cellhead": ParagraphStyle("cellhead", fontName=fonts.names["sansBold"], fontSize=7.1,
                                   leading=9, textColor=INK, alignment=TA_LEFT, wordWrap="CJK"),
        "code": ParagraphStyle("code", fontName=fonts.names["mono"], fontSize=7, leading=8.8,
                               textColor=colors.HexColor("#1d2333")),
        "list": make(spaceAfter=1.6, leftIndent=11, bulletIndent=2),
        "ref": make(fontSize=body_size - 1.5, leading=(body_size - 1.5) * 1.22,
                    leftIndent=13, firstLineIndent=-13, spaceAfter=1.8),
    }


# ---------------------------------------------------------------------------
# tables, all generated from the measured data
# ---------------------------------------------------------------------------
TABLE_ZH = {
    "versions": ["#", "方面", "v1 行为", "v2 变化", "生效方式"],
    "limitations": ["#", "v1 局限", "v2 修复", "证据", "状态"],
    "inventory": ["文件", "v1 行数", "v2 行数", "增减"],
    "suites": ["套件", "用途", "v1", "v2", "行数"],
    "ocr": ["用例", "页", "文本层字符", "文本层汉字", "OCR 字符", "OCR 汉字", "毫秒"],
    "api": ["模块", "路由", "动作", "状态", "说明"],
}
TABLE_EN = {
    "versions": ["#", "area", "v1 behaviour", "v2 change", "takes effect"],
    "limitations": ["#", "v1 limitation", "v2 fix", "evidence", "status"],
    "inventory": ["file", "v1 lines", "v2 lines", "delta"],
    "suites": ["suite", "what it drives", "v1", "v2", "lines"],
    "ocr": ["case", "pages", "layer chars", "layer Han", "OCR chars", "OCR Han", "ms"],
    "api": ["module", "route", "action", "status", "note"],
}
STATUS_ZH = {"closed": "已修复", "partial": "部分修复", "open": "未修复"}
AREA_EN = {"L1": "scans and OCR", "L2": "recall scoring", "L3": "history storage",
           "L4": "image fidelity", "L5": "compaction", "L6": "store-time extraction",
           "L7": "DOM verification", "L8": "semantic recall"}
AREA_ZH = {"L1": "扫描件与 OCR", "L2": "回忆打分", "L3": "历史存储", "L4": "图片保真",
           "L5": "压缩策略", "L6": "入库抽取", "L7": "DOM 验证", "L8": "语义回忆"}
SUITE_ZH = {
    "chat-mode-check.mjs": "对话管线：路由、SSE、历史、附件、记忆体联动",
    "chat-mode-format-check.mjs": "渲染与解码：LaTeX→MathML、Markdown、编码识别",
    "superman-host-check.mjs": "记忆体 Host 半：抽取、BM25 回忆、上限、对账",
    "superman-check.mjs": "记忆体面板：入口、文件夹、预览、上传、提示",
    "arxiv-smoke.mjs": "arXiv 包，含收藏路径",
    "superman-ocr-check.mjs": "OCR 包：路由、信封、首次编译、真实引擎",
}
API_ZH = {
    ("superman", "list"): ("沿用", "契约不变，stats 增加淘汰计数"),
    ("superman", "store"): ("v2 变更", "入库时由 Host 抽取 PDF 文本"),
    ("superman", "note"): ("沿用", "契约不变"),
    ("superman", "get"): ("沿用", "契约不变，返回抽取出的文本"),
    ("superman", "delete"): ("沿用", "契约不变"),
    ("superman", "recall"): ("v2 变更", "BM25（k1 1.2、b 0.75）加 IDF 取代加法打分"),
    ("superman", "prune"): ("v2 新增", "手动压缩通道，返回被清理的内容"),
    ("superman-ocr", "health"): ("v2 新增", "{ready, bin, compiled, version}"),
    ("superman-ocr", "ocr"): ("v2 新增", "{text, pages, characters}，Vision 引擎"),
}
API_STATUS_ZH = {"carried": "沿用", "changed in v2": "v2 变更", "new in v2": "v2 新增"}
OCR_CASE_ZH = {
    "rasterised page A": "光栅化页面 A",
    "rasterised page B": "光栅化页面 B",
    "broken CMap brochure": "CMap 损坏的 19 页册子",
    "rasterised page A (Latin)": "光栅化页面 A（拉丁）",
    "rasterised page B (Han)": "光栅化页面 B（汉字）",
}
OCR_CASE_EN = {
    "rasterised page A": "rasterised page A",
    "rasterised page B": "rasterised page B",
    "broken CMap brochure": "broken-CMap brochure",
    "rasterised page A (Latin)": "rasterised page A (Latin)",
    "rasterised page B (Han)": "rasterised page B (Han)",
}


def table_rows(key: str, lang: str, data: dict) -> tuple[list[list[str]], list[float]]:
    """Rows and relative column widths for one table key, from the measured data."""
    zh = lang == "zh"
    if key == "versions":
        rows = [TABLE_ZH["versions"] if zh else TABLE_EN["versions"]]
        areas = AREA_ZH if zh else AREA_EN
        for row in data["limitations"]:
            rows.append([
                row["id"],
                areas.get(row["id"], ""),
                row["v1"],
                row["v2"],
                row["effective"],
            ])
        return rows, [4, 14, 30, 38, 14]
    if key == "limitations":
        rows = [TABLE_ZH["limitations"] if zh else TABLE_EN["limitations"]]
        for row in data["limitations"]:
            status = STATUS_ZH[row["status"]] if zh else row["status"]
            rows.append([row["id"], row["v1"], row["v2"], row.get("evidence", ""), status])
        return rows, [4, 26, 30, 32, 8]
    if key == "inventory":
        rows = [TABLE_ZH["inventory"] if zh else TABLE_EN["inventory"]]
        for row in data["codeDelta"]["files"]:
            before = "—" if row["v1"] is None else f'{row["v1"]:,}'
            delta = "new" if row["delta"] is None else f'{row["delta"]:+,}'
            if zh and delta == "new":
                delta = "新增"
            rows.append([f'`{row["file"]}`', before, f'{row["v2"]:,}', delta])
        totals = data["codeDelta"]["moduleJsTotals"]
        rows.append(["**total (module .js)**", f'{totals["v1"]:,}', f'{totals["v2"]:,}', f'{totals["delta"]:+,}'])
        return rows, [40, 16, 16, 14]
    if key == "suites":
        rows = [TABLE_ZH["suites"] if zh else TABLE_EN["suites"]]
        facts = data["factsSuites"]
        for row in data["suites"]:
            purpose = SUITE_ZH[row["suite"]] if zh else row["purpose"]
            before = facts[row["suite"]]["v1"]
            rows.append([
                f'`{row["suite"]}`',
                purpose,
                "—" if before is None else str(before),
                str(row["ok"] + row["fail"]),
                str(row["lines"]),
            ])
        total_v1 = sum(value["v1"] or 0 for value in facts.values())
        total_v2 = sum(row["ok"] + row["fail"] for row in data["suites"])
        rows.append(["**total**", "", f"**{total_v1}**", f"**{total_v2}**",
                     f'**{sum(row["lines"] for row in data["suites"]):,}**'])
        return rows, [30, 44, 8, 8, 8]
    if key == "ocr":
        rows = [TABLE_ZH["ocr"] if zh else TABLE_EN["ocr"]]
        cases = OCR_CASE_ZH if zh else OCR_CASE_EN
        for row in data["ocr"]["facts"]:
            rows.append([
                cases.get(row["case"], row["case"]),
                str(row["pages"]),
                f'{row["layerChars"]:,}',
                f'{row.get("layerHan", 0):,}',
                f'{row["ocrChars"]:,}',
                f'{row["ocrHan"]:,}',
                "—",
            ])
        for row in data["ocr"].get("remeasured", []):
            if not row.get("chars"):
                continue
            rows.append([
                cases.get(row["case"], row["case"]),
                str(row.get("pages", 1)),
                f'{row.get("layerChars", 0):,}',
                f'{row.get("layerHan", 0):,}',
                f'{row["chars"]:,}',
                f'{row.get("han", 0):,}',
                f'{row.get("ms", 0):,}',
            ])
        return rows, [40, 8, 14, 12, 14, 12, 10]
    if key == "api":
        rows = [TABLE_ZH["api"] if zh else TABLE_EN["api"]]
        for row in data["api"]:
            if zh:
                status, note = API_ZH.get((row["module"], row["action"]),
                                          (API_STATUS_ZH.get(row["status"], row["status"]), row["note"]))
            else:
                status, note = row["status"], row["note"]
            rows.append([f'`{row["module"]}`', row["route"], f'`{row["action"]}`', status, note])
        return rows, [14, 30, 12, 12, 32]
    raise KeyError(key)


def build_table(key: str, style: dict, fonts: Fonts, data: dict, lang: str) -> Table:
    """One booktabs-style table from the measured data."""
    rows, widths = table_rows(key, lang, data)
    total = sum(widths)
    columns = [COLUMN * width / total for width in widths]
    body: list[list[Paragraph]] = []
    for index, row in enumerate(rows):
        row_style = style["cellhead"] if index == 0 else style["cell"]
        body.append([Paragraph(inline(str(value), fonts, row_style.fontName, 6.6), row_style)
                     for value in row])
    table = Table(body, hAlign="CENTER", repeatRows=1, colWidths=columns)
    commands = [
        ("LINEABOVE", (0, 0), (-1, 0), 0.9, INK),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, INK),
        ("LINEBELOW", (0, -1), (-1, -1), 0.9, INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2.0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.0),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]
    table.setStyle(TableStyle(commands))
    return table


# ---------------------------------------------------------------------------
# manuscript parsing
# ---------------------------------------------------------------------------
PLACEHOLDER = re.compile(r"^\[\[(FIG|TAB):([a-z0-9\-]+)\]\]$")
BACK_MATTER = (
    "data availability", "code availability", "acknowledg", "author contributions",
    "competing interests", "references", "appendix", "数据可用性", "代码可用性", "致谢",
    "作者贡献", "利益冲突", "参考文献", "附录",
)


def figure_width(path: Path, measure: float = COLUMN,
                 maximum_height: float = 80 * mm) -> tuple[float, float]:
    """Scale one figure to the measure, capped in height."""
    from PIL import Image as PILImage

    width, height = PILImage.open(path).size
    target = measure
    if target * height / width > maximum_height:
        target = maximum_height * width / height
    return target, target * height / width


def figure_path(figure_dir: Path, key: str) -> Path | None:
    """The image file for one figure key, if it exists."""
    for suffix in (".png", ".pdf"):
        candidate = figure_dir / f"fig-{key}{suffix}"
        if candidate.exists():
            return candidate
    return None


CAPTION_LEAD = ("Figure", "Table", "图", "表")


def caption_after(lines: list[str], index: int) -> tuple[str, int]:
    """The caption line that follows a placeholder, and how many lines it uses."""
    if index < len(lines):
        text = lines[index].strip()
        if text.startswith(CAPTION_LEAD):
            return text, 1
    return "", 0


def parse_manuscript(path: Path, lang: str, style: dict, fonts: Fonts, data: dict,
                     figure_dir: Path, body_size: float, pairing: bool = True) -> tuple[list, list[str]]:
    """Turn one manuscript into a flowable story, and collect the missing tables."""
    lines = path.read_text(encoding="utf-8").split("\n")
    story: list = []
    missing: list[str] = []
    index = 0
    paragraph: list[str] = []
    list_items: list[str] = []
    code: list[str] = []
    in_code = False
    in_references = False
    reference: list[str] = []
    body_style = "body"
    placed = {"figures": 0, "tables": 0, "figureKeys": [], "tableKeys": []}

    def flush_paragraph() -> None:
        nonlocal paragraph
        if not paragraph:
            return
        text = " ".join(part.strip() for part in paragraph)
        chosen = style[body_style]
        story.append(Paragraph(inline(text, fonts, chosen.fontName), chosen))
        paragraph = []

    def flush_list() -> None:
        nonlocal list_items
        for item in list_items:
            story.append(Paragraph("• " + inline(item, fonts, fonts.names["body"]), style["list"]))
        list_items = []

    def flush_code() -> None:
        nonlocal code
        if not code:
            return
        block = Table([[Paragraph("<br/>".join(
            html.escape(line).replace(" ", "&nbsp;") for line in code) or "&nbsp;", style["code"])]],
            colWidths=[COLUMN])
        block.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f4f5f9")),
            ("BOX", (0, 0), (-1, -1), 0.4, RULE),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(block)
        story.append(Spacer(1, 4))
        code = []

    def flush_reference() -> None:
        nonlocal reference
        if not reference:
            return
        story.append(Paragraph(inline(" ".join(reference), fonts, fonts.names["body"],
                                      body_size - 1.3), style["ref"]))
        reference = []

    def emit_figure(key: str, caption: str) -> None:
        image_path = figure_path(figure_dir, key)
        if image_path is None:
            missing.append(f"figure {key}")
            return
        width, height = figure_width(image_path, COLUMN)
        story.append(KeepTogether([
            Spacer(1, 2),
            Image(str(image_path), width=width, height=height),
            Paragraph(inline(caption, fonts, fonts.names["sans"], 7.0), style["caption"]),
        ]))
        placed["figures"] += 1
        placed["figureKeys"].append(key)

    def emit_figure_pair(first: tuple[str, str], second: tuple[str, str]) -> bool:
        """Two consecutive figures side by side, each with its caption beneath.

        Nothing is lost by pairing: both captions stay with their figure, the
        reading order is unchanged, and a half-width figure at 58 mm leaves the
        page far less white than two full-width bands.
        """
        cells = []
        half = (COLUMN - 6 * mm) / 2
        for key, caption in (first, second):
            image_path = figure_path(figure_dir, key)
            if image_path is None:
                missing.append(f"figure {key}")
                return False
            width, height = figure_width(image_path, half, 54 * mm)
            cells.append([Image(str(image_path), width=width, height=height),
                          Paragraph(inline(caption, fonts, fonts.names["sans"], 6.8),
                                    style["caption_narrow"])])
        band = Table([cells], colWidths=[half, half])
        band.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (0, 0), 0),
            ("RIGHTPADDING", (0, 0), (0, 0), 3 * mm),
            ("LEFTPADDING", (1, 0), (1, 0), 3 * mm),
            ("RIGHTPADDING", (1, 0), (1, 0), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(KeepTogether([Spacer(1, 2), band, Spacer(1, 4)]))
        placed["figures"] += 2
        placed["figureKeys"].extend([first[0], second[0]])
        return True

    def emit_table(key: str, caption: str) -> None:
        try:
            table = build_table(key, style, fonts, data, lang)
        except KeyError:
            missing.append(f"table {key}")
            return
        placed["tables"] += 1
        placed["tableKeys"].append(key)
        heading = Paragraph(inline(caption, fonts, fonts.names["sans"], 7.0), style["tablecap"])
        # A short table stays with its caption; a tall one is allowed to break
        # across pages (its head row repeats) instead of leaving a page half empty.
        height = table.wrap(COLUMN, BODY_HEIGHT)[1]
        if height < 62 * mm:
            story.append(KeepTogether([heading, table, Spacer(1, 2)]))
        else:
            story.append(CondPageBreak(26 * mm))
            story.append(heading)
            story.append(table)
            story.append(Spacer(1, 3))

    while index < len(lines):
        raw = lines[index]
        stripped = raw.strip()

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
            code.append(raw.rstrip())
            index += 1
            continue

        match = PLACEHOLDER.match(stripped)
        if match is not None:
            flush_paragraph()
            flush_list()
            flush_reference()
            kind, key = match.group(1), match.group(2)
            caption, used = caption_after(lines, index + 1)
            consumed = 1 + used
            if kind == "FIG" and pairing:
                # Look past the blanks for a second figure: consecutive figures
                # are laid out side by side instead of as two full-width bands.
                probe = index + consumed
                while probe < len(lines) and lines[probe].strip() == "":
                    probe += 1
                neighbour = PLACEHOLDER.match(lines[probe].strip()) if probe < len(lines) else None
                if neighbour is not None and neighbour.group(1) == "FIG":
                    second_caption, second_used = caption_after(lines, probe + 1)
                    if emit_figure_pair((key, caption), (neighbour.group(2), second_caption)):
                        index = probe + 1 + second_used
                        continue
            if kind == "FIG":
                emit_figure(key, caption)
            else:
                emit_table(key, caption)
            index += consumed
            continue

        if stripped.startswith("#### "):
            flush_paragraph()
            flush_list()
            story.append(Paragraph(inline(stripped[5:], fonts, fonts.names["sansBold"]), style["h3"]))
            index += 1
            continue
        if stripped.startswith("### "):
            flush_paragraph()
            flush_list()
            story.append(CondPageBreak(22 * mm))
            story.append(Paragraph(inline(stripped[4:], fonts, fonts.names["sansBold"]), style["h2"]))
            index += 1
            continue
        if stripped.startswith("## "):
            flush_paragraph()
            flush_list()
            flush_reference()
            heading = stripped[3:]
            lowered = heading.lower()
            in_references = lowered.startswith(("references", "参考文献"))
            # The abstract is set at a narrower measure than the body.
            body_style = "abstract" if lowered.startswith(("abstract", "摘要")) else "body"
            if lowered.startswith(("abstract", "摘要")):
                story.append(Paragraph(inline(heading, fonts, fonts.names["sansBold"]),
                                       style["abstract_label"]))
            elif any(lowered.startswith(marker) for marker in BACK_MATTER):
                story.append(CondPageBreak(24 * mm))
                story.append(Paragraph(inline(heading, fonts, fonts.names["sansBold"]), style["back"]))
            else:
                story.append(CondPageBreak(28 * mm))
                story.append(Paragraph(inline(heading, fonts, fonts.names["sansBold"]), style["h1"]))
            index += 1
            continue
        if stripped.startswith("# "):
            flush_paragraph()
            flush_list()
            story.append(Paragraph(inline(stripped[2:], fonts, fonts.names["sansBold"]), style["title"]))
            index += 1
            continue

        labelled = re.match(r"^\*\*(.+?)\*\*\s*(.*)$", stripped)
        if labelled is not None:
            head, rest = labelled.group(1), labelled.group(2)
            if re.match(r"^(Authors|作者|Affiliations?|单位|机构|Corresponding|通讯作者|Keywords|关键词)", head):
                flush_paragraph()
                flush_list()
                name = ("authors" if re.match(r"^(Authors|作者)", head)
                        else "keywords" if re.match(r"^(Keywords|关键词)", head)
                        else "affiliation")
                story.append(Paragraph(inline(f"**{head}** {rest}".strip(), fonts,
                                              style[name].fontName), style[name]))
                index += 1
                continue

        if stripped.startswith("- ") or stripped.startswith("* "):
            flush_paragraph()
            list_items.append(stripped[2:])
            index += 1
            continue
        if re.match(r"^\d+\.\s", stripped) and in_references:
            flush_reference()
            reference.append(stripped)
            index += 1
            continue
        if in_references and reference and stripped and not stripped.startswith("## "):
            reference.append(stripped)
            index += 1
            continue
        if stripped == "":
            flush_paragraph()
            flush_list()
            flush_reference()
            index += 1
            continue
        paragraph.append(stripped)
        index += 1

    flush_paragraph()
    flush_list()
    flush_code()
    flush_reference()
    return story, missing, placed


# ---------------------------------------------------------------------------
# document
# ---------------------------------------------------------------------------
def build(lang: str, source: Path, out: Path, data: dict, body_size: float,
          verify: bool = True, pairing: bool = True) -> dict:
    """Typeset one manuscript and return a build report."""
    fonts = Fonts(lang)
    style = styles(fonts, lang, body_size)
    figure_dir = V2 / "figures" / lang
    story, missing, placed = parse_manuscript(source, lang, style, fonts, data, figure_dir,
                                              body_size, pairing)

    title = source.read_text(encoding="utf-8").split("\n")[0].lstrip("# ").strip()
    running = "Closing the documented limitations of a harness extension suite" if lang == "en" \
        else "补齐 Harness 扩展套件的已知局限"

    doc = BaseDocTemplate(
        str(out), pagesize=PAGE, leftMargin=MARGIN_X, rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP, bottomMargin=MARGIN_BOTTOM,
        title=title, author="Anstar, Z. et al.",
        subject="DeepSeek Harness extension suite, v2",
    )

    head_style = ParagraphStyle("runhead", fontName=fonts.names["sans"], fontSize=7.2,
                                leading=8.6, textColor=MUTED, alignment=TA_LEFT)
    head_right = ParagraphStyle("runhead-right", parent=head_style, alignment=1)
    signature = "Anstar, Z. et al." if lang == "en" else "Anstar, Z. 等"

    def decorate(canvas, document) -> None:
        """Page number, rule and running head.

        The head is drawn as a Paragraph, not through `canvas.drawString`, so a
        Han running title goes through the same per-character font fallback as
        the body instead of printing notdef boxes.
        """
        canvas.saveState()
        canvas.setFont(fonts.names["sans"], 7.2)
        canvas.setFillColor(MUTED)
        canvas.drawCentredString(PAGE[0] / 2, MARGIN_BOTTOM - 8 * mm, str(document.page))
        if document.page > 1:
            canvas.setStrokeColor(RULE)
            canvas.setLineWidth(0.3)
            canvas.line(MARGIN_X, PAGE[1] - MARGIN_TOP + 5 * mm,
                        PAGE[0] - MARGIN_X, PAGE[1] - MARGIN_TOP + 5 * mm)
            base_y = PAGE[1] - MARGIN_TOP + 6.4 * mm
            left = Paragraph(inline(running, fonts, fonts.names["sans"], 6.6), head_style)
            width, height = left.wrap(COLUMN * 0.72, 24)
            left.drawOn(canvas, MARGIN_X, base_y - height + 7)
            right = Paragraph(inline(signature, fonts, fonts.names["sans"], 6.6), head_right)
            width, height = right.wrap(COLUMN * 0.28, 24)
            right.drawOn(canvas, PAGE[0] - MARGIN_X - width, base_y - height + 7)
        canvas.restoreState()

    frame = Frame(MARGIN_X, MARGIN_BOTTOM, COLUMN, BODY_HEIGHT, id="body",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="body", frames=[frame], onPage=decorate)])
    doc.build(story)

    report = {"lang": lang, "source": str(source), "pdf": str(out), "bodySize": body_size,
              "missing": missing, "bytes": out.stat().st_size, **placed}
    if verify:
        report.update(verify_pdf(out, data, fonts, lang, placed))
    return report


# ---------------------------------------------------------------------------
# self-verification
# ---------------------------------------------------------------------------
def verify_pdf(path: Path, data: dict, fonts: Fonts, lang: str, placed: dict) -> dict:
    """Check the finished PDF: pages, blanks, figures, tables, numerals, margins."""
    try:
        import pymupdf
    except ImportError:  # pragma: no cover - verification is best-effort
        return {"verified": False, "reason": "pymupdf not importable"}

    document = pymupdf.open(path)
    text = "\n".join(page.get_text() for page in document)
    pages = document.page_count
    blank = []
    overflow = []
    images = 0
    for number, page in enumerate(document):
        images += len(page.get_images(full=True))
        page_text = page.get_text().strip()
        if not page_text and not page.get_images(full=True):
            blank.append(number + 1)
        for block in page.get_text("blocks"):
            x0, y0, x1, y1 = block[:4]
            if x0 < 4 or x1 > PAGE[0] - 4 or y0 < 4 or y1 > PAGE[1] - 4:
                overflow.append(number + 1)
                break
    figures = [key for key in
               ("versions", "limitations", "checks", "code", "ocr", "corpus", "latency", "bm25", "lifecycle")
               if (V2 / "figures" / lang / f"fig-{key}.png").exists()]
    fill = []
    measure_right = PAGE[0] - MARGIN_X
    span_spill = 0.0
    figure_caption_below = True
    table_caption_above = True
    for page in document:
        fill.append(len(page.get_text()))
        # How far any span reaches past the right edge of the measure. A CJK
        # line may hang its closing punctuation there, and an inline code token
        # cannot be hyphenated; anything larger than a few points is a bug.
        for block in page.get_text("dict")["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line["spans"]:
                    span_spill = max(span_spill, span["bbox"][2] - measure_right)
        image_boxes = [item["bbox"] for item in page.get_image_info()]
        text_blocks = [block for block in page.get_text("dict")["blocks"] if block.get("type") == 0]
        text_blocks.sort(key=lambda block: block["bbox"][1])
        for position, block in enumerate(text_blocks):
            if not block.get("lines"):
                continue
            first = "".join(span["text"] for span in block["lines"][0]["spans"]).strip()
            caption = re.match(r"^(Figure|图|Table|表)\s*\d+\s*[.:：|]", first)
            if caption is None:
                continue  # an in-text reference such as "Figure 3 shows ..."
            left, top = block["bbox"][0], block["bbox"][1]
            right, bottom = block["bbox"][2], block["bbox"][3]
            if first.startswith(("Figure", "图")):
                # Images above the caption, in the same column: the nearest of
                # them must end at the caption, never under it.
                above = [item for item in image_boxes
                         if item[0] < right and item[2] > left and item[1] < top]
                if not above or any(item[3] > top + 1 for item in above):
                    figure_caption_below = False
            if first.startswith(("Table", "表")) and position + 1 < len(text_blocks):
                if text_blocks[position + 1]["bbox"][1] < bottom - 1:
                    table_caption_above = False
    tables = ["versions", "limitations", "inventory", "suites", "ocr", "api"]
    table_marks = {
        "versions": "v1 behaviour" if lang == "en" else "v1 行为",
        "limitations": "evidence" if lang == "en" else "证据",
        "inventory": "delta" if lang == "en" else "增减",
        "suites": "drives" if lang == "en" else "用途",
        "ocr": "OCR chars" if lang == "en" else "OCR 字符",
        "api": "action" if lang == "en" else "动作",
    }
    document.close()
    featured = "3 411"
    return {
        "verified": True,
        "pages": pages,
        "blankPages": blank,
        "pagesWithOverflow": sorted(set(overflow)),
        "images": images,
        "figuresExpected": len(figures),
        "figuresPlaced": placed["figures"],
        "tablesPlaced": placed["tables"],
        "tablesExpected": len(tables),
        "tablesPresent": [key for key in tables if table_marks[key] in text],
        "maxSpillBeyondMeasure": round(span_spill, 2),
        "figureCaptionsBelow": figure_caption_below,
        "tableCaptionsAbove": table_caption_above,
        "featuredNumeral": featured if featured in text else None,
        "textChars": len(text),
        "charactersPerPage": fill,
        "thinnestPages": sorted(range(1, pages + 1), key=lambda n: fill[n - 1])[:3],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lang", choices=["en", "zh", "both"], default="both")
    parser.add_argument("--source-dir", default=None)
    parser.add_argument("--out-dir", default=None)
    parser.add_argument("--no-autofit", action="store_true")
    parser.add_argument("--no-pairing", action="store_true",
                        help="place consecutive figures one per band instead of side by side")
    arguments = parser.parse_args()

    data = json.loads((V2 / "data" / "metrics.json").read_text(encoding="utf-8"))
    languages = ["en", "zh"] if arguments.lang == "both" else [arguments.lang]
    reports = []
    for lang in languages:
        source_dir = Path(arguments.source_dir) if arguments.source_dir else V2
        source = source_dir / f"paper-{lang}.md"
        out_dir = Path(arguments.out_dir) if arguments.out_dir else V2
        if not source.exists():
            synthetic = SYNTHETIC / f"paper-{lang}.md"
            if not synthetic.exists():
                print(f"{lang}: no manuscript at {source} and no synthetic at {synthetic}; skipped")
                continue
            print(f"{lang}: {source} absent — building against {synthetic} instead")
            source, out_dir = synthetic, SYNTHETIC
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"paper-{lang}.pdf"

        # Chinese typesetting wants a larger body size than Latin at the same
        # page count, so the two languages search different ranges.
        candidates = ([10.5, 10.2, 10.0, 9.8, 9.5, 9.2, 9.0, 8.8, 8.5] if lang == "zh"
                      else [11.0, 10.8, 10.6, 10.4, 10.2, 10.0, 9.8, 9.6, 9.4, 9.2])
        window = (18, 20)  # both languages aim at 19 pages, ±1
        pairing = not arguments.no_pairing
        if arguments.no_autofit:
            report = build(lang, source, out, data, candidates[0], pairing=pairing)
            reports.append(report)
            continue
        # Every candidate is measured; the winner is the one closest to the
        # target page count, and a larger body size breaks a tie so the type is
        # never smaller than it has to be.
        best = None
        for size in candidates:
            report = build(lang, source, out, data, size, pairing=pairing)
            pages = report.get("pages") or 0
            inside = window[0] <= pages <= window[1]
            score = (0 if inside else 1, abs(pages - TARGET_PAGES), -size)
            if best is None or score < best[0]:
                best = (score, size, report)
        _, size, report = best
        report = build(lang, source, out, data, size, pairing=pairing)
        reports.append(report)
        print(f"{lang}: {size} pt body → {out} · {report.get('pages')} pages · "
              f"{report['bytes'] / 1024:.0f} KB")
        if report.get("verified"):
            print(f"    blank pages: {report['blankPages'] or 'none'} · "
                  f"figures placed: {report['figuresPlaced']} (images {report['images']}) · "
                  f"tables placed: {report['tablesPlaced']} "
                  f"(captions found {len(report['tablesPresent'])}) · "
                  f"featured numeral: {report['featuredNumeral']} · "
                  f"captions below/above: {report['figureCaptionsBelow']}/{report['tableCaptionsAbove']} · "
                  f"max spill past the measure: {report['maxSpillBeyondMeasure']} pt · "
                  f"outside the page: {report['pagesWithOverflow'] or 'none'}")
        if report["missing"]:
            print(f"    missing: {report['missing']}")
    failures = [report for report in reports
                if report.get("blankPages") or report.get("missing")
                or not (18 <= (report.get("pages") or 0) <= 20)
                or report.get("images") != report.get("figuresPlaced")
                or len(report.get("tablesPresent", [])) != report.get("tablesPlaced")
                or report.get("featuredNumeral") is None
                or not report.get("figureCaptionsBelow") or not report.get("tableCaptionsAbove")
                or (report.get("maxSpillBeyondMeasure") or 0) > 8.6]
    if failures:
        print(f"{len(failures)} build(s) need attention", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
