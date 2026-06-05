#!/usr/bin/env python3
"""GPU-accelerated PNG upscaler using UltraMix Balanced (Kim2091) via spandrel.

Long-running batch worker: reads JSON tasks from stdin (one per line) and writes
one JSON response per task to stdout. Designed to be spawned once per batch by
the TS upscale worker so that model loading (~3-5s on GPU) is amortized.

Task line:    {"srcPath": "...", "dstPath": "...", "scale": 2}
Response:     {"ok": true} | {"ok": false, "error": "..."}
First stdout: {"ready": true, "model": ..., "native_scale": 4}

Why spandrel: UltraMix Balanced is an ESRGAN/RRDBNet variant (interpolation of
multiple Kim2091 models). spandrel auto-detects architecture from state_dict and
provides a clean inference path without hand-wiring RRDBNet hyperparameters.
"""

import json
import os
import sys
import urllib.request

import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader
import spandrel_extra_arches

spandrel_extra_arches.install()

# Canonical source: Kim2091's own HuggingFace repo. UltraMix Balanced is a 4x
# RRDBNet ("ESRGAN" arch family), ~67 MB, FP32 weights.
MODEL_URL = (
    "https://huggingface.co/Kim2091/UltraSharp/resolve/main/"
    "Interpolations/4x-UltraMix_Balanced.pth?download=true"
)
MODEL_CACHE = os.path.expanduser("~/.cache/kairos-models/ultramix_balanced.pth")


def ensure_model() -> str:
    if not os.path.exists(MODEL_CACHE):
        os.makedirs(os.path.dirname(MODEL_CACHE), exist_ok=True)
        tmp = MODEL_CACHE + ".download"
        urllib.request.urlretrieve(MODEL_URL, tmp)
        os.replace(tmp, MODEL_CACHE)
    return MODEL_CACHE


def make_upsampler():
    if not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA is not available. This worker requires GPU; refusing to fall back to CPU."
        )
    descriptor = ModelLoader().load_from_file(ensure_model())
    model = descriptor.model.eval()
    device = torch.device("cuda")
    model = model.to(device).half()
    return model, device, descriptor.scale


def upscale(model, device, native_scale: int, src: str, dst: str, outscale: float) -> None:
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    img = Image.open(src).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    tensor = (
        torch.from_numpy(arr.transpose(2, 0, 1)).unsqueeze(0).to(device).half()
    )
    with torch.no_grad():
        out = model(tensor)
    out_arr = (
        out.squeeze(0).clamp(0, 1).float().cpu().numpy().transpose(1, 2, 0)
    )
    out_arr = (out_arr * 255).round().astype(np.uint8)
    out_img = Image.fromarray(out_arr)
    # Native upscale ratio (e.g. 4x) may exceed the requested outscale (e.g. 2x).
    # In that case downsample the model output via Lanczos — strictly better than
    # asking the network to produce a smaller-than-native result, which it can't.
    if native_scale != outscale:
        new_w = int(round(arr.shape[1] * outscale))
        new_h = int(round(arr.shape[0] * outscale))
        out_img = out_img.resize((new_w, new_h), Image.LANCZOS)
    out_img.save(dst)


def main() -> None:
    model, device, native_scale = make_upsampler()
    sys.stdout.write(
        json.dumps(
            {"ready": True, "model": "ultramix_balanced", "native_scale": native_scale}
        )
        + "\n"
    )
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            task = json.loads(line)
            upscale(
                model,
                device,
                native_scale,
                task["srcPath"],
                task["dstPath"],
                float(task.get("scale", 2)),
            )
            sys.stdout.write(json.dumps({"ok": True}) + "\n")
        except Exception as e:  # noqa: BLE001 — surface to TS caller
            sys.stdout.write(
                json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}) + "\n"
            )
        sys.stdout.flush()


if __name__ == "__main__":
    main()
