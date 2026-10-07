"""Make the scene-card thumbnails from the original panoramas.

Usage: python3 tools/thumbs.py   (run from the repository root; needs Pillow)

The panoramas themselves are served untouched: assets/pano/<name>.jpg is a
byte-for-byte copy of source/panoramas/<name>.jpg. This script only writes
assets/pano/<name>-thumb.jpg, a plain crop of the opening view.
"""
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "panoramas"
OUT = ROOT / "assets" / "pano"

# opening view (degrees from the panorama centre) used for each thumbnail
YAW = {"arrival": 0, "driveway": 10, "courtyard": -60, "lawn": 0, "ballroom": 0}


def thumb(img, yaw_deg, size=(640, 360)):
    w, h = img.size
    span = w // 4
    cx = int((yaw_deg / 360 + 0.5) * w)
    top = int(h * 0.30)
    # take the crop from a horizontally doubled copy so it can wrap the seam
    wide = Image.new("RGB", (w * 2, h))
    wide.paste(img, (0, 0))
    wide.paste(img, (w, 0))
    left = (cx - span // 2) % w
    crop = wide.crop((left, top, left + span, top + span * 9 // 16))
    return crop.resize(size, Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, yaw in YAW.items():
        src = SRC / f"{name}.jpg"
        shutil.copyfile(src, OUT / f"{name}.jpg")
        thumb(Image.open(src).convert("RGB"), yaw).save(OUT / f"{name}-thumb.jpg", quality=88)
        print(f"  {name}")
