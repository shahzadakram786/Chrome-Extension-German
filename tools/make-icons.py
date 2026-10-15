#!/usr/bin/env python3
"""
Renders every icon the extension ships from logo.svg.

logo.svg is the one source of truth. To change the gradient or the tile
colour, edit it there and run this; never touch the PNGs by hand, or the sizes
drift apart.

    python tools/make-icons.py

Writes icons/icon16|32|48|128.png, icons/store-icon-128.png and logo.png.
Requires Pillow and resvg-py (pip install Pillow resvg-py).
"""
import io
import os
import re
import sys

try:
    import resvg_py
    from PIL import Image
except ImportError:
    sys.exit("Pillow and resvg-py are needed: pip install Pillow resvg-py")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

with open(os.path.join(ROOT, "logo.svg"), encoding="utf-8") as f:
    SVG = f.read()

# At 16px the book is a two-pixel white speck that reads as dirt on the icon,
# so the toolbar size goes without it.
NO_BOOK = re.sub(r'<path id="book"[^>]*/>', "", SVG)
if NO_BOOK == SVG:
    sys.exit('logo.svg has no <path id="book" .../>; the 16px icon needs it removable')


def render(svg, px):
    data = resvg_py.svg_to_bytes(svg_string=svg, width=px, height=px)
    return Image.open(io.BytesIO(bytes(data))).convert("RGBA")


def padded(svg, size=128, art=96):
    """The store wants 96x96 artwork centred in 128x128, padding transparent."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile = render(svg, art)
    canvas.paste(tile, ((size - art) // 2, (size - art) // 2), tile)
    return canvas


def main():
    out = {
        "icons/icon16.png": render(NO_BOOK, 16),
        "icons/icon32.png": render(SVG, 32),
        "icons/icon48.png": render(SVG, 48),
        "icons/icon128.png": padded(SVG),
        "icons/store-icon-128.png": padded(SVG),
        "logo.png": render(SVG, 1024),
    }
    for rel, im in out.items():
        im.save(os.path.join(ROOT, rel), optimize=True)
        print("  " + rel.ljust(28) + "%dx%d" % im.size)


if __name__ == "__main__":
    main()
