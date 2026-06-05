import fs from 'node:fs';
import path from 'node:path';

import { glob } from 'glob';
import Tinypool from 'tinypool';

import type { UnpackTask, WorkerArguments } from './worker';
import { maimaiAssetKinds, maimaiAssetKindSources, maimaiAssetIdFromAbName } from '../../interfaces';
import { createLogger } from '../../logger';
import { IncrementalCache } from '../cache';
import { sha256File } from '../crypto';

const logger = createLogger('Unpack');

const pool = new Tinypool({
  filename: new URL('./worker.ts', import.meta.url).href,
  minThreads: 4,
  maxThreads: 16,
});

const FILES_PER_BATCH = 32;

const extractAssetFileHash = async (manifestPath: string): Promise<string | null> => {
  // Manifest is small YAML; regex is sufficient and avoids js-yaml round-trip cost.
  // Format excerpt:
  //   AssetFileHash:
  //     serializedVersion: 2
  //     Hash: 96afd7584194d8067e1cb121f7eabcdd
  const text = await fs.promises.readFile(manifestPath, 'utf-8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
  if (text === null) return null;
  const m = text.match(/AssetFileHash:[\s\S]*?Hash:\s*([0-9a-f]+)/);
  return m ? m[1]! : null;
};

interface CacheStamp {
  /** AssetFileHash from manifest, or `sha:<sha256>` if no manifest was found. */
  hash: string;
}

export const runUnpack = async (
  gamePackagePath: string,
  imageDir: string,
): Promise<void> => {
  const streamingAssetsPath = path.join(gamePackagePath, 'Sinmai_Data', 'StreamingAssets');
  const normalizedRoot = path.join(imageDir, 'normalized');
  await fs.promises.mkdir(normalizedRoot, { recursive: true });

  const cache = await IncrementalCache.load<CacheStamp>(path.join(imageDir, '.unpack-cache.json'));
  const pendingTaskMeta: Array<{ cacheKey: string; stamp: CacheStamp; task: UnpackTask }> = [];
  let scheduled = 0;
  let skipped = 0;

  // Higher Axxx dirs override lower ones in mai2; iterate sorted descending so the highest wins per (kind, id).
  const axxxDirs = (await glob(path.join(streamingAssetsPath, 'A*'))).sort().reverse();
  const winners = new Map<string, { abPath: string; manifestPath: string; outPath: string; cacheKey: string }>();

  for (const axxxDir of axxxDirs) {
    for (const kind of maimaiAssetKinds) {
      const src = maimaiAssetKindSources[kind];
      const abFiles = await glob(path.join(axxxDir, 'AssetBundleImages', src.abDir, `${src.abPrefix}*.ab`));
      for (const abPath of abFiles) {
        const abBasename = path.basename(abPath);
        const id = maimaiAssetIdFromAbName(kind, abBasename);
        const winnerKey = `${kind}/${id}`;
        if (winners.has(winnerKey)) continue;
        winners.set(winnerKey, {
          abPath,
          manifestPath: `${abPath}.manifest`,
          outPath: path.join(normalizedRoot, kind, `${id}.png`),
          cacheKey: `${kind}/${abBasename}`,
        });
      }
    }
  }

  for (const w of winners.values()) {
    let stamp: CacheStamp;
    const fromManifest = await extractAssetFileHash(w.manifestPath);
    if (fromManifest) {
      stamp = { hash: fromManifest };
    } else {
      stamp = { hash: `sha:${await sha256File(w.abPath)}` };
    }

    const previous = cache.get(w.cacheKey);
    const outExists = await fs.promises.stat(w.outPath).then(() => true).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return false;
      throw err;
    });
    if (previous?.hash === stamp.hash && outExists) {
      skipped++;
      continue;
    }

    pendingTaskMeta.push({ cacheKey: w.cacheKey, stamp, task: { abPath: w.abPath, outPath: w.outPath } });
    scheduled++;
  }

  logger.log(`Unpack: ${scheduled} new/changed, ${skipped} unchanged`);

  interface Batch {
    workerArgs: WorkerArguments;
    metas: Array<{ cacheKey: string; stamp: CacheStamp }>;
  }
  const batches: Batch[] = [];
  for (let i = 0; i < pendingTaskMeta.length; i += FILES_PER_BATCH) {
    const slice = pendingTaskMeta.slice(i, i + FILES_PER_BATCH);
    batches.push({
      workerArgs: { tasks: slice.map(m => m.task) },
      metas: slice.map(({ cacheKey, stamp }) => ({ cacheKey, stamp })),
    });
  }

  const results = await Promise.allSettled(batches.map((b, i) => pool.run(b.workerArgs).then(async () => {
    for (const m of b.metas) cache.set(m.cacheKey, m.stamp);
    await cache.save();
    logger.log(`Unpack batch ${i + 1}/${batches.length} done`);
  })));
  await cache.save();
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => r.reason as unknown);
  if (errors.length) {
    for (const e of errors) logger.error(String(e));
    throw new AggregateError(errors, `Unpack failed for ${errors.length}/${batches.length} batches`);
  }
  logger.log(`Unpack done → ${normalizedRoot}`);
};
