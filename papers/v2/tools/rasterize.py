#!/usr/bin/env python3
"""Rasterise one PDF page into an image-only PDF, and inspect a PDF's text layer.

This is the measurement instrument behind the OCR numbers in
``papers/v2/data/metrics.json``: it uses PyMuPDF to draw a text-bearing page to
a bitmap, writes that bitmap into a fresh one-page PDF (so the result has a
pixel image and *no* text layer), and reports how many characters — and how
many Han characters — the text layer of a PDF actually carries.

Run with an interpreter that has PyMuPDF and Pillow (the workspace's temporary
virtualenv):

    /tmp/pdfenv/bin/python papers/v2/tools/rasterize.py --src in.pdf --page 1 \
        --out /tmp/raster.pdf --dpi 200
    /tmp/pdfenv/bin/python papers/v2/tools/rasterize.py --inspect /tmp/raster.pdf

Both modes print one JSON object on stdout.
"""
from __future__ import annotations

import argparse
import json

HAN = range(0x3400, 0xA000)


def inspect(path: str) -> dict:
    """Report the pages, characters and Han characters of one PDF's text layer."""
    import fitz

    document = fitz.open(path)
    try:
        text = "".join(document[index].get_text() for index in range(len(document)))
        return {
            "path": path,
            "pages": len(document),
            "chars": len(text),
            "han": sum(1 for character in text if ord(character) in HAN),
        }
    finally:
        document.close()


def rasterise(source: str, page: int, out: str, dpi: int) -> dict:
    """Draw one page to a bitmap and write it as a one-page image-only PDF."""
    import fitz

    document = fitz.open(source)
    try:
        if page < 1 or page > len(document):
            raise SystemExit(f"page {page} outside 1..{len(document)}")
        bitmap = document[page - 1].get_pixmap(dpi=dpi)
        target = fitz.open()
        try:
            target_page = target.new_page(width=bitmap.width, height=bitmap.height)
            target_page.insert_image(
                fitz.Rect(0, 0, bitmap.width, bitmap.height),
                pixmap=bitmap,
            )
            target.save(out, deflate=True)
        finally:
            target.close()
    finally:
        document.close()
    return {"source": source, "page": page, "dpi": dpi, "out": out, **inspect(out)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--out")
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--inspect")
    arguments = parser.parse_args()
    if arguments.inspect:
        print(json.dumps(inspect(arguments.inspect)))
        return
    if not arguments.src or not arguments.out:
        raise SystemExit("--src and --out are both required to rasterise")
    print(json.dumps(rasterise(arguments.src, arguments.page, arguments.out, arguments.dpi)))


if __name__ == "__main__":
    main()
