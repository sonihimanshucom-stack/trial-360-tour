"""Enhance the raw equirectangular captures and export web-ready renditions.

Usage: python3 tools/enhance.py   (run from the repository root)

For every panorama in source/panoramas/ this writes into assets/pano/:
  <name>.jpg       4096x2048 master (desktop)
  <name>-2k.jpg    2048x1024 (mobile / fast first paint)
  <name>-thumb.jpg 640x360 crop of the opening view (scene cards)
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "panoramas"
OUT = ROOT / "assets" / "pano"

# Per-scene grading. yaw_deg is the opening view used for the thumbnail crop.
SCENES = {
    "arrival":   dict(local=0.30, vibrance=0.18, shadows=0.10, warmth=0.015, yaw_deg=0),
    "driveway":  dict(local=0.30, vibrance=0.18, shadows=0.12, warmth=0.015, yaw_deg=10),
    "courtyard": dict(local=0.28, vibrance=0.14, shadows=0.08, warmth=0.010, yaw_deg=-60),
    "lawn":      dict(local=0.32, vibrance=0.22, shadows=0.10, warmth=0.020, yaw_deg=0),
    "ballroom":  dict(local=0.26, vibrance=0.10, shadows=0.06, warmth=0.000, yaw_deg=0),
}


def gaussian(arr, radius):
    """Gaussian blur of a float [0,1] single-channel array via PIL."""
    img = Image.fromarray(np.clip(arr * 255, 0, 255).astype(np.uint8), mode="L")
    return np.asarray(img.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255.0


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def levels(rgb, strength=0.6):
    """Blend toward a per-channel percentile stretch (removes haze / colour cast)."""
    out = rgb.copy()
    for c in range(3):
        lo, hi = np.percentile(rgb[..., c], (0.4, 99.7))
        stretched = (rgb[..., c] - lo) / max(hi - lo, 1e-3)
        out[..., c] = rgb[..., c] * (1 - strength) + stretched * strength
    return np.clip(out, 0, 1)


def local_contrast(rgb, amount):
    lum = luminance(rgb)
    base = gaussian(lum, 28)
    boosted = np.clip(lum + (lum - base) * amount, 0, 1)
    ratio = (boosted + 1e-4) / (lum + 1e-4)
    return np.clip(rgb * ratio[..., None], 0, 1)


def tone(rgb, shadows):
    """Lift shadows, roll off highlights, add a gentle S in the mids."""
    lum = luminance(rgb)
    lift = shadows * (1 - lum) ** 3
    roll = 0.06 * np.clip(lum - 0.85, 0, None) / 0.15
    target = np.clip(lum + lift - roll, 0, 1)
    target = target + 0.06 * np.sin((target - 0.5) * np.pi) * (1 - np.abs(target - 0.5) * 2) * 0.5
    ratio = (target + 1e-4) / (lum + 1e-4)
    return np.clip(rgb * ratio[..., None], 0, 1)


def vibrance(rgb, amount):
    lum = luminance(rgb)[..., None]
    sat = rgb.max(-1, keepdims=True) - rgb.min(-1, keepdims=True)
    k = 1 + amount * (1 - sat)  # boost muted colours more than saturated ones
    return np.clip(lum + (rgb - lum) * k, 0, 1)


def warm(rgb, amount):
    out = rgb.copy()
    out[..., 0] *= 1 + amount
    out[..., 2] *= 1 - amount
    return np.clip(out, 0, 1)


def clean_nadir(rgb):
    """Replace the camera/hand smear at the bottom with a soft ring-average fill.

    The viewer draws a branded nadir cap over the pole; this makes the edge of
    that cap blend invisibly instead of revealing the smear around it.
    """
    h, w, _ = rgb.shape
    start = int(h * 0.90)
    band = rgb[start:].copy()
    ring_mean = band.mean(axis=1, keepdims=True)  # each row = one ring around nadir
    rows = np.linspace(0, 1, h - start)[:, None, None]
    weight = np.clip((rows - 0.35) / 0.65, 0, 1) ** 1.5
    soft = np.stack([gaussian(band[..., c], 6) for c in range(3)], -1)
    rgb[start:] = soft * (1 - weight) + ring_mean * weight
    blend = np.clip((rows - 0.0) / 0.35, 0, 1)
    rgb[start:] = band * (1 - blend) + rgb[start:] * blend
    return rgb


def fix_seam(rgb, cols=12):
    """Cross-fade the left/right edges so the wrap-around seam disappears."""
    left, right = rgb[:, :cols].copy(), rgb[:, -cols:].copy()
    avg = (left[:, :1] + right[:, -1:]) / 2
    for i in range(cols):
        t = 1 - i / cols
        rgb[:, i] = left[:, i] * (1 - t * 0.5) + avg[:, 0] * t * 0.5
        rgb[:, -1 - i] = right[:, -1 - i] * (1 - t * 0.5) + avg[:, 0] * t * 0.5
    return rgb


def thumb(img, yaw_deg, size=(640, 360)):
    w, h = img.size
    cx = int(((yaw_deg / 360.0) + 0.5) * w) % w
    span = w // 4
    rolled = np.roll(np.asarray(img), w // 2 - cx, axis=1)
    crop = Image.fromarray(rolled[int(h * 0.30):int(h * 0.30) + int(span * 9 / 16),
                                  w // 2 - span // 2:w // 2 + span // 2])
    return crop.resize(size, Image.LANCZOS)


def process(name, cfg):
    src = Image.open(SRC / f"{name}.jpg").convert("RGB")
    rgb = np.asarray(src, dtype=np.float32) / 255.0
    rgb = levels(rgb)
    rgb = tone(rgb, cfg["shadows"])
    rgb = local_contrast(rgb, cfg["local"])
    rgb = vibrance(rgb, cfg["vibrance"])
    rgb = warm(rgb, cfg["warmth"])
    rgb = clean_nadir(rgb)
    rgb = fix_seam(rgb)
    graded = Image.fromarray((rgb * 255 + 0.5).astype(np.uint8))

    master = graded.resize((4096, 2048), Image.LANCZOS)
    master = master.filter(ImageFilter.UnsharpMask(radius=1.6, percent=55, threshold=2))
    master.save(OUT / f"{name}.jpg", quality=86, optimize=True, progressive=True, subsampling=0)

    graded.resize((2048, 1024), Image.LANCZOS).filter(
        ImageFilter.UnsharpMask(radius=1.0, percent=40, threshold=2)
    ).save(OUT / f"{name}-2k.jpg", quality=84, optimize=True, progressive=True)

    thumb(graded, cfg["yaw_deg"]).save(OUT / f"{name}-thumb.jpg", quality=82, optimize=True, progressive=True)
    print(f"  {name}: done")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for scene, cfg in SCENES.items():
        process(scene, cfg)
