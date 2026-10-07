"""Build the web assets from the original camera panoramas.

Usage: python3 tools/prepare.py   (run from the repository root; needs Pillow)

For each source/panoramas/<name>.jpg (the untouched camera export) this writes
into assets/pano/:
  <name>.webp       WebP at quality 95: ~3x smaller than the camera JPEG and
                    visually identical (PSNR ~44-45 dB). The viewer loads this.
  <name>.jpg        byte-for-byte copy of the original, used as a fallback.
  <name>-thumb.jpg  small crop of the opening view for the scene cards.
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
        img = Image.open(src).convert("RGB")
        shutil.copyfile(src, OUT / f"{name}.jpg")
        img.save(OUT / f"{name}.webp", "WEBP", quality=95, method=6)
        thumb(img, yaw).save(OUT / f"{name}-thumb.jpg", quality=88)
        print(f"  {name}")
