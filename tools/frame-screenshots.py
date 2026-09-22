#!/usr/bin/env python3
"""
Frames screenshots to the exact sizes the Chrome Web Store accepts.

The store takes 1280x800 or 640x400 and nothing else. A capture of just the
tooltip is the right *content* — it shows the feature without a screenful of
someone else's website around it — but it is never the right size, and
stretching it to fit makes the text blurry, which reads as a low-effort
listing.

So this never scales up. It shrinks only when a capture is too big, and
otherwise centres it on a canvas painted the colour sampled from the capture's
own edges. On a screenshot taken over a coloured page that makes the padding
invisible: the frame looks like more of the same page rather than a letterbox.

    python tools/frame-screenshots.py shot1.png shot2.png
    python tools/frame-screenshots.py --size 640x400 shot.png
    python tools/frame-screenshots.py --bg "#0b2a6f" shot.png

Writes to screenshots/ next to the repo root. Requires Pillow.
"""
import argparse
import os
import sys
from collections import Counter

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is needed: pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "screenshots")

# The store rejects anything else, so these are not suggestions.
SIZES = {"1280x800": (1280, 800), "640x400": (640, 400)}

# Leave the capture some room; a shot flush against the canvas edge looks
# cropped rather than framed.
MARGIN = 0.94


def edge_colour(img):
    """
    The most common colour around the border, which is almost always the page
    behind the tooltip. Sampling the border rather than the whole image avoids
    picking up the tooltip itself, which is usually the darkest thing present.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    step = max(1, min(w, h) // 120)

    samples = []
    for x in range(0, w, step):
        samples.append(px[x, 0])
        samples.append(px[x, h - 1])
    for y in range(0, h, step):
        samples.append(px[0, y])
        samples.append(px[w - 1, y])

    # Round to a coarse grid so near-identical shades count as one colour;
    # gradients and JPEG noise otherwise split the vote a hundred ways.
    def bucket(c):
        return (c[0] // 8 * 8, c[1] // 8 * 8, c[2] // 8 * 8)

    return Counter(bucket(s) for s in samples).most_common(1)[0][0]


def frame(path, size, bg_override):
    img = Image.open(path).convert("RGB")
    target_w, target_h = size

    bg = bg_override or edge_colour(img)
    canvas = Image.new("RGB", (target_w, target_h), bg)

    max_w, max_h = int(target_w * MARGIN), int(target_h * MARGIN)
    scale = min(max_w / img.width, max_h / img.height, 1.0)  # never enlarge

    if scale < 1.0:
        img = img.resize(
            (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
            Image.LANCZOS,
        )

    canvas.paste(img, ((target_w - img.width) // 2, (target_h - img.height) // 2))

    os.makedirs(OUT_DIR, exist_ok=True)
    stem = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(OUT_DIR, "%s-%dx%d.png" % (stem, target_w, target_h))
    canvas.save(out, "PNG", optimize=True)
    return out, scale, bg


def main():
    ap = argparse.ArgumentParser(description="Frame screenshots for the Chrome Web Store.")
    ap.add_argument("images", nargs="+", help="screenshots to frame")
    ap.add_argument("--size", default="1280x800", choices=sorted(SIZES), help="store size")
    ap.add_argument("--bg", default=None, help='background colour, e.g. "#0b2a6f"')
    args = ap.parse_args()

    bg = None
    if args.bg:
        h = args.bg.lstrip("#")
        if len(h) != 6:
            sys.exit('--bg wants six hex digits, e.g. "#0b2a6f"')
        bg = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

    size = SIZES[args.size]
    print("Framing to %dx%d\n" % size)

    for path in args.images:
        if not os.path.exists(path):
            print("  missing: %s" % path)
            continue
        out, scale, used = frame(path, size, bg)
        note = "shrunk to %.0f%%" % (scale * 100) if scale < 1.0 else "unscaled"
        print("  %-34s %s, background #%02x%02x%02x" % (os.path.basename(out), note, *used))

    print("\nWritten to %s" % os.path.relpath(OUT_DIR, ROOT))
    print("Upload at least three; the listing looks thin with fewer.")


if __name__ == "__main__":
    main()
