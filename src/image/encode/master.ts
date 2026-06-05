import fs from 'node:fs';
import path from 'node:path';

import { glob } from 'glob';
import Tinypool from 'tinypool';

import type { EncodeTask, WorkerArguments } from './worker';
import { maimaiAssetKinds } from '../../interfaces';
import { createLogger } from '../../logger';
import { ensureBinary } from '../binaries';
import { IncrementalCache } from '../cache';
import { sha256File } from '../crypto';

const logger = createLogger('Encode');

const pool = new Tinypool({
  filename: new URL('./worker.ts', import.meta.url).href,
  minThreads: 4,
  maxThreads: 16,
});

const FILES_PER_BATCH = 16;
// Bump this whenever the encoder flag set changes — invalidates the entire cache.
const ENCODER_PARAMS_VERSION = 'avif-q65-s0;webp-q80-m6-pass10-sharp_yuv';

interface CacheStamp {
  srcSha256: string;
  paramsVersion: string;
}

interface PickResult {
  kind: string;
  basename: string;
  avif: { path: string; size: number };
  webp: { path: string; size: number };
}

export const runEncode = async (imageDir: string): Promise<void> => {
  const upscaledRoot = path.join(imageDir, 'upscaled');
  const encodedRoot = path.join(imageDir, 'encoded');
  await fs.promises.mkdir(encodedRoot, { recursive: true });

  const avifencBin = await ensureBinary('avifenc');
  const cwebpBin = await ensureBinary('cwebp');

  const cache = await IncrementalCache.load<CacheStamp>(path.join(imageDir, '.encode-cache.json'));
  const tasksMeta: { cacheKey: string; stamp: CacheStamp; task: EncodeTask }[] = [];
  const reuse: PickResult[] = [];

  for (const kind of maimaiAssetKinds) {
    const files = await glob(path.join(upscaledRoot, kind, '*.png'));
    for (const srcPath of files) {
      const basename = path.basename(srcPath, '.png');
      const outDir = path.join(encodedRoot, kind);
      const cacheKey = `${kind}/${basename}`;
      const srcSha = await sha256File(srcPath);

      const previous = cache.get(cacheKey);
      const avifPath = path.join(outDir, `${basename}.avif`);
      const webpPath = path.join(outDir, `${basename}.webp`);
      const stat = async (p: string) => await fs.promises.stat(p).then(s => s).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return null;
        throw err;
      });
      const [avifStat, webpStat] = await Promise.all([stat(avifPath), stat(webpPath)]);

      if (
        previous?.srcSha256 === srcSha &&
        previous?.paramsVersion === ENCODER_PARAMS_VERSION &&
        avifStat && webpStat
      ) {
        reuse.push({
          kind,
          basename,
          avif: { path: avifPath, size: avifStat.size },
          webp: { path: webpPath, size: webpStat.size },
        });
        continue;
      }

      tasksMeta.push({
        cacheKey,
        stamp: { srcSha256: srcSha, paramsVersion: ENCODER_PARAMS_VERSION },
        task: { srcPath, outDir, basename, avifencBin, cwebpBin },
      });
    }
  }

  logger.log(`Encode: ${tasksMeta.length} new/changed, ${reuse.length} unchanged`);

  const intermediateDir = path.join(imageDir, '.encode-intermediate');
  await fs.promises.mkdir(intermediateDir, { recursive: true });
  interface Batch {
    workerArgs: WorkerArguments;
    metas: { cacheKey: string; stamp: CacheStamp }[];
  }
  const batches: Batch[] = [];
  for (let i = 0; i < tasksMeta.length; i += FILES_PER_BATCH) {
    const slice = tasksMeta.slice(i, i + FILES_PER_BATCH);
    batches.push({
      workerArgs: {
        tasks: slice.map(m => m.task),
        outputFile: path.join(intermediateDir, `${i}.json`),
      },
      metas: slice.map(({ cacheKey, stamp }) => ({ cacheKey, stamp })),
    });
  }

  const results = await Promise.allSettled(batches.map((b, i) => pool.run(b.workerArgs).then(async () => {
    for (const m of b.metas) cache.set(m.cacheKey, m.stamp);
    await cache.save();
    logger.log(`Encode batch ${i + 1}/${batches.length} done`);
  })));
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => r.reason as unknown);

  // Assemble index.json from whichever batches succeeded; partial output is still useful.
  const fresh: PickResult[] = [];
  for (let i = 0; i < batches.length; i++) {
    if (results[i]!.status !== 'fulfilled') continue;
    fresh.push(...JSON.parse(await fs.promises.readFile(batches[i]!.workerArgs.outputFile, 'utf-8')) as PickResult[]);
  }
  const all = [...reuse, ...fresh].sort((a, b) =>
    a.kind === b.kind ? a.basename.localeCompare(b.basename) : a.kind.localeCompare(b.kind));

  // index.json: array of `<kind>/<basename>.<ext>` entries, listing webp always and avif only when avif < webp.
  const index: string[] = [];
  for (const r of all) {
    index.push(`${r.kind}/${r.basename}.webp`);
    if (r.avif.size < r.webp.size) index.push(`${r.kind}/${r.basename}.avif`);
  }
  await fs.promises.writeFile(path.join(encodedRoot, 'index.json'), JSON.stringify(index));
  await fs.promises.rm(intermediateDir, { recursive: true, force: true });

  if (errors.length) {
    for (const e of errors) logger.error(String(e));
    throw new AggregateError(errors, `Encode failed for ${errors.length}/${batches.length} batches`);
  }
  logger.log(`Encode done → ${encodedRoot} (index has ${index.length} entries)`);
};
