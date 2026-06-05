import fs from 'node:fs';
import path from 'node:path';

import { glob } from 'glob';
import Tinypool from 'tinypool';

import type { UpscaleTask } from './worker';
import { maimaiAssetKinds } from '../../interfaces';
import { createLogger } from '../../logger';
import { IncrementalCache } from '../cache';
import { sha256File } from '../crypto';

const logger = createLogger('Upscale');

// The Real-ESRGAN PyTorch worker holds the GPU; one worker thread is plenty
// (the model already saturates a 4060 in FP16). Each batch spawns one Python
// process that loads the model once and services FILES_PER_BATCH tasks.
const pool = new Tinypool({
  filename: new URL('./worker.ts', import.meta.url).href,
  minThreads: 1,
  maxThreads: 1,
});

// Identifier for cache invalidation; bump when swapping checkpoints.
const MODEL_NAME = 'ultramix-balanced';
const SCALE = 2;
const FILES_PER_BATCH = 16;

interface CacheStamp {
  srcSha256: string;
  model: string;
  scale: number;
}

export const runUpscale = async (imageDir: string): Promise<void> => {
  const normalizedRoot = path.join(imageDir, 'normalized');
  const upscaledRoot = path.join(imageDir, 'upscaled');
  await fs.promises.mkdir(upscaledRoot, { recursive: true });

  const cache = await IncrementalCache.load<CacheStamp>(path.join(imageDir, '.upscale-cache.json'));
  const tasksMeta: { cacheKey: string; stamp: CacheStamp; task: UpscaleTask }[] = [];
  let skipped = 0;

  for (const kind of maimaiAssetKinds) {
    const files = await glob(path.join(normalizedRoot, kind, '*.png'));
    for (const srcPath of files) {
      const basename = path.basename(srcPath);
      const dstPath = path.join(upscaledRoot, kind, basename);
      const cacheKey = `${kind}/${basename}`;
      const srcSha = await sha256File(srcPath);
      const previous = cache.get(cacheKey);
      const dstExists = await fs.promises.stat(dstPath).then(() => true).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return false;
        throw err;
      });
      if (
        previous?.srcSha256 === srcSha &&
        previous?.model === MODEL_NAME &&
        previous?.scale === SCALE &&
        dstExists
      ) {
        skipped++;
        continue;
      }
      tasksMeta.push({
        cacheKey,
        stamp: { srcSha256: srcSha, model: MODEL_NAME, scale: SCALE },
        task: { srcPath, dstPath, scale: SCALE },
      });
    }
  }

  logger.log(`Upscale: ${tasksMeta.length} to process, ${skipped} unchanged`);

  for (let i = 0; i < tasksMeta.length; i += FILES_PER_BATCH) {
    const batch = tasksMeta.slice(i, i + FILES_PER_BATCH);
    await pool.run({ tasks: batch.map(b => b.task) });
    // Worker succeeded → batch is durable; record in cache and persist.
    for (const b of batch) cache.set(b.cacheKey, b.stamp);
    await cache.save();
    logger.log(`Upscale: ${Math.min(i + FILES_PER_BATCH, tasksMeta.length)}/${tasksMeta.length}`);
  }
  logger.log(`Upscale done → ${upscaledRoot}`);
};
