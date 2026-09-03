"""Automated checks from Scarlet Thread - Image Commission.md section 10.3.

Only the checks that are actually mechanical are implemented here (the doc's own
"I will run it" line refers to the red sweep specifically). Glyph/text sweep,
trail continuity, light continuity, mirror-pair likeness, and the bottom-third
busyness check are visual judgment calls -- this script does not attempt them
and says so, rather than faking a pass/fail on something it cannot actually see.

Usage:  py tools/verify_commissioned_images.py <image.png> [<image2.png> ...]
        py tools/verify_commissioned_images.py design/image-commission/candidates/*.png

Exit code is non-zero if any image fails the red sweep.
Author: Kenneth Hill
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

# Image Commission.md section 10.3.1, verbatim threshold:
# "any pixel where r > 110 && r > g*1.55 && r > b*1.55 is a fail."
RED_THRESHOLD = 110
RED_RATIO = 1.55

EXPECTED_SIZE = (1536, 1024)


def red_sweep(img: Image.Image) -> list[tuple[int, int, tuple[int, int, int]]]:
    """Returns every offending pixel's (x, y, (r, g, b)). Empty list = pass."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    pixels = rgb.load()
    offenders: list[tuple[int, int, tuple[int, int, int]]] = []
    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y]
            if r > RED_THRESHOLD and r > g * RED_RATIO and r > b * RED_RATIO:
                offenders.append((x, y, (r, g, b)))
    return offenders


def check_one(path: Path) -> bool:
    print(f"\n{path.name}")
    try:
        img = Image.open(path)
    except Exception as exc:  # noqa: BLE001 -- report and continue to next file
        print(f"  FAIL: could not open ({exc})")
        return False

    ok = True

    if img.size != EXPECTED_SIZE:
        print(f"  WARN: size {img.size}, expected {EXPECTED_SIZE} (not a hard fail -- master "
              "panorama crops may legitimately differ; check against the commission doc)")

    offenders = red_sweep(img)
    if offenders:
        ok = False
        sample = offenders[:5]
        print(f"  FAIL: red sweep -- {len(offenders)} offending pixel(s). First few:")
        for x, y, (r, g, b) in sample:
            print(f"    ({x},{y}) rgb=({r},{g},{b})")
    else:
        print("  PASS: red sweep (no pixel exceeds the rope-red threshold)")

    print("  NOT CHECKED (visual judgment, do these by eye per section 10.3):")
    print("    - glyph/sparkle sweep (view at 300%, whole frame)")
    print("    - text/numeral sweep (map sheets especially)")
    print("    - trail continuity (master panorama only)")
    print("    - light continuity left/right (master panorama only)")
    print("    - mirror-pair likeness (01/11, 02/10, 03/09, 04/08, 05/07)")
    print("    - bottom-third busyness (scenes/site vistas)")

    return ok


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2

    paths = [Path(p) for p in argv[1:]]
    results = [check_one(p) for p in paths]

    passed = sum(results)
    total = len(results)
    print(f"\n{passed}/{total} passed the automated red sweep.")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
