import fs from 'node:fs';
import path from 'node:path';

import { glob } from 'glob';
import Tinypool from 'tinypool';

import type { WorkerArguments } from './worker';
import type { ThumbCache } from '../../interfaces';
import { maimaiThumbKinds } from '../../interfaces';
import { createLogger } from '../../logger';
import { objectEntries, arrayToObject } from '../../utils/base';

const logger = createLogger('Master');

const pool = new Tinypool({
  filename: new URL('./worker.ts', import.meta.url).href,
  minThreads: 8,
  maxThreads: 32,
});

const NUM_WORKERS = 32;
const ASSET_SUFFIX = '.png';

export const runThumb = async (imageDir: string, hashSalt: string, outputDir: string) => {
  await fs.promises.mkdir(path.resolve(outputDir, 'thumb'), { recursive: true });

  const workerArgs: WorkerArguments[] = Array.from({ length: NUM_WORKERS }).map((_, i) => ({ hashSalt, tasks: [], outputFile: path.resolve(outputDir, 'thumb', `${i}.json`) }));
  let i = 0;
  for (const kind of maimaiThumbKinds) {
    const files = await glob(`${imageDir}/normalized/${kind}/*${ASSET_SUFFIX}`);
    for (const file of files) {
      const id = path.basename(file, ASSET_SUFFIX);
      workerArgs[i++ % NUM_WORKERS]!.tasks.push({ kind, id, filePath: file });
    }
    logger.log(`Found ${files.length} files for ${kind}`);
  }

  await Promise.all(workerArgs.map(args => pool.run(args)));

  const result: ThumbCache = arrayToObject(maimaiThumbKinds, () => ({}));
  for (const args of workerArgs) {
    const data = JSON.parse(await fs.promises.readFile(args.outputFile, 'utf-8')) as ThumbCache;
    for (const [kind, entries] of objectEntries(data)) {
      Object.assign(result[kind], entries);
    }
  }
  await fs.promises.writeFile(`${outputDir}/thumb.json`, JSON.stringify(result, null, 2));
  logger.log(`Merged thumb hashes to ${outputDir}/thumb.json`);
};
