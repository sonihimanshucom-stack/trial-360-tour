"""AI super-resolution of the equirectangular captures with Real-ESRGAN x4plus.

Usage: python3 tools/upscale.py MODEL.pth [names...]
  MODEL.pth  https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth

Reads source/panoramas/<name>.jpg, writes source/upscaled/<name>.png (4x).
The panorama is padded with wrapped columns before inference so the
left/right seam is reconstructed consistently. Runs on CPU (needs torch).
"""
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "panoramas"
OUT = ROOT / "source" / "upscaled"


class RDB(nn.Module):
    def __init__(self, nf=64, gc=32):
        super().__init__()
        self.conv1 = nn.Conv2d(nf, gc, 3, 1, 1)
        self.conv2 = nn.Conv2d(nf + gc, gc, 3, 1, 1)
        self.conv3 = nn.Conv2d(nf + 2 * gc, gc, 3, 1, 1)
        self.conv4 = nn.Conv2d(nf + 3 * gc, gc, 3, 1, 1)
        self.conv5 = nn.Conv2d(nf + 4 * gc, nf, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(0.2, inplace=True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    def __init__(self, nf=64, gc=32):
        super().__init__()
        self.rdb1, self.rdb2, self.rdb3 = RDB(nf, gc), RDB(nf, gc), RDB(nf, gc)

    def forward(self, x):
        return self.rdb3(self.rdb2(self.rdb1(x))) * 0.2 + x


class RRDBNet(nn.Module):
    def __init__(self, nf=64, nb=23, gc=32):
        super().__init__()
        self.conv_first = nn.Conv2d(3, nf, 3, 1, 1)
        self.body = nn.Sequential(*[RRDB(nf, gc) for _ in range(nb)])
        self.conv_body = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_hr = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_last = nn.Conv2d(nf, 3, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(0.2, inplace=True)

    def forward(self, x):
        feat = self.conv_first(x)
        feat = feat + self.conv_body(self.body(feat))
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode="nearest")))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode="nearest")))
        return self.conv_last(self.lrelu(self.conv_hr(feat)))


def load_model(path):
    net = RRDBNet()
    state = torch.load(path, map_location="cpu", weights_only=True)
    net.load_state_dict(state.get("params_ema", state.get("params", state)), strict=True)
    return net.eval()


@torch.inference_mode()
def upscale(net, img, tile=200, pad=12, wrap=32):
    """img: HxWx3 uint8 -> (4H)x(4W)x3 uint8, tiled, seam-aware."""
    arr = np.concatenate([img[:, -wrap:], img, img[:, :wrap]], axis=1)  # wrap padding
    x = torch.from_numpy(arr).permute(2, 0, 1).float().div(255).unsqueeze(0)
    _, _, h, w = x.shape
    out = torch.zeros(1, 3, h * 4, w * 4)
    tiles = [(ty, tx) for ty in range(0, h, tile) for tx in range(0, w, tile)]
    t0 = time.time()
    for i, (ty, tx) in enumerate(tiles):
        y0, x0 = max(ty - pad, 0), max(tx - pad, 0)
        y1, x1 = min(ty + tile + pad, h), min(tx + tile + pad, w)
        patch = x[:, :, y0:y1, x0:x1]
        res = net(patch)
        ty1, tx1 = min(ty + tile, h), min(tx + tile, w)
        out[:, :, ty * 4:ty1 * 4, tx * 4:tx1 * 4] = res[
            :, :, (ty - y0) * 4:(ty - y0 + ty1 - ty) * 4, (tx - x0) * 4:(tx - x0 + tx1 - tx) * 4]
        if i % 10 == 0:
            el = time.time() - t0
            print(f"    tile {i + 1}/{len(tiles)}  {el:.0f}s elapsed, ~{el / (i + 1) * (len(tiles) - i - 1):.0f}s left", flush=True)
    res = out[0].clamp(0, 1).mul(255).round().byte().permute(1, 2, 0).numpy()
    return res[:, wrap * 4:-wrap * 4]


if __name__ == "__main__":
    torch.set_num_threads(max(1, torch.get_num_threads()))
    net = load_model(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    names = sys.argv[2:] or ["arrival", "driveway", "lawn", "courtyard", "ballroom"]
    for name in names:
        print(f"  {name}")
        img = np.asarray(Image.open(SRC / f"{name}.jpg").convert("RGB"))
        Image.fromarray(upscale(net, img)).save(OUT / f"{name}.png", compress_level=1)
