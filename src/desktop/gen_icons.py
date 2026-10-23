# -*- coding: utf-8 -*-
"""Generates the application icon set for the desktop bundle.

Draws the Quick Snippets emblem (dark circle with a white four-point sparkle,
matching the overlay hub) and writes PNG + ICO variants used by Tauri.

Usage: python gen_icons.py [output_dir]
"""

import math
import os
import sys

from PIL import Image, ImageDraw

# Circle and sparkle geometry (relative units, canvas is 256x256).
CANVAS = 256
CIRCLE_R = 118
SPARKLE_R = 78
HALO_RATIO = 1.25

TIPS = [(0.0, -1.0), (1.0, 0.0), (0.0, 1.0), (-1.0, 0.0)]
CURVES = [
    ((2.2236, -3.36201), (2.3175, -3.12378), (2.4614, -2.92290)),
    ((2.5889, -2.74484), (2.7448, -2.58894), (2.9229, -2.46141)),
    ((3.1238, -2.31755), (3.3620, -2.22359), (3.8385, -2.03568)),
]


def sparkle_polygon(cx, cy, r, halo_mult=1.0):
    """Builds the filled 4-point sparkle polygon (rounded inner corners)."""
    pts = [(0.0, -9.0), (2.0357, -3.83847)]
    steps = 10
    for c1, c2, p in CURVES:
        x0, y0 = pts[-1]
        for s in range(1, steps + 1):
            t = s / steps
            u = 1.0 - t
            x = u**3 * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * p[0]
            y = u**3 * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * p[1]
            pts.append((x, y))
    pts.append((9.0, 0.0))

    def rot90(q):
        return [(-y, x) for (x, y) in q]

    outline = pts + rot90(pts) + rot90(rot90(pts)) + rot90(rot90(rot90(pts)))
    scale = r / 9.0
    return [
        (cx + (x * scale) * halo_mult, cy + (y * scale) * halo_mult) for (x, y) in outline
    ]


def render(size):
    """Renders the emblem at the given pixel size with supersampling."""
    ss = 4
    big = size * ss
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = cy = big / 2
    r = CIRCLE_R / 256 * big
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(18, 18, 22, 252), outline=(255, 255, 255, 255), width=max(1, int(6 / 256 * big)))
    sr = SPARKLE_R / 256 * big
    d.polygon(sparkle_polygon(cx, cy, sr, HALO_RATIO), fill=(150, 152, 168, 255))
    d.polygon(sparkle_polygon(cx, cy, sr), fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


def main():
    """Entry point: writes the icon set next to tauri.conf.json."""
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
    os.makedirs(out_dir, exist_ok=True)

    for size in (32, 128, 256):
        render(size).save(os.path.join(out_dir, f"{size}x{size}.png"))

    # 128@2x is just the 256 render.
    os.replace(os.path.join(out_dir, "256x256.png"), os.path.join(out_dir, "128x128@2x.png"))

    render(256).save(
        os.path.join(out_dir, "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    render(512).save(os.path.join(out_dir, "icon.png"))
    print(f"icons written to {out_dir}")


if __name__ == "__main__":
    main()
