#!/usr/bin/env python3
"""Unity AssetBundle unpacker — long-running batch worker.

Reads task JSON lines from stdin; for each, opens the .ab via UnityPy, finds
the (single) Texture2D, decodes to PNG, writes to outPath.

Why long-running: importing UnityPy + its texture decoder costs ~1-2 s; we
amortize that across many tasks per process by being persistent.
"""

import json
import os
import sys

import UnityPy


def process_one(ab_path: str, out_path: str) -> dict:
    env = UnityPy.load(ab_path)
    tex = next((o for o in env.objects if o.type.name == "Texture2D"), None)
    if tex is None:
        return {"ok": True, "skipped": "no Texture2D"}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tex.read().image.save(out_path)
    return {"ok": True}


def main() -> None:
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            task = json.loads(line)
            resp = process_one(task["abPath"], task["outPath"])
        except Exception as e:  # noqa: BLE001 — surface error to TS caller
            resp = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
