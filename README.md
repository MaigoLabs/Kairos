# Kairos

Maimai DX metadata + asset pipeline. [AGPL-3.0-or-later](LICENSE).

## Setup

`pnpm i && (cd python && uv sync)`. Linux + NVIDIA CUDA for `image:upscale`.

## Use

Copy `config.example.yaml` → `config.yaml` (gitignored). Run stages via `package.json` scripts: `metadata`, `image:{unpack,upscale,encode,thumb,upload}`.

Typical order: `image:unpack → :upscale → :encode → :thumb → metadata → image:upload`.
