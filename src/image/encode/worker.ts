import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createLogger } from '../../logger';

const logger = createLogger('EncodeWorker');

export interface EncodeTask {
  /** Absolute path to source PNG (upscaled). */
  srcPath: string;
  /** Absolute output directory; encoder writes `<basename>.avif` and `<basename>.webp`. */
  outDir: string;
  /** Basename without extension. */
  basename: string;
  avifencBin: string;
  cwebpBin: string;
}

export interface WorkerArguments {
  tasks: EncodeTask[];
  /** Output JSON file: per-basename pick of which extension wins (smaller bytes). */
  outputFile: string;
}

interface PickResult {
  kind: string;
  basename: string;
  avif: { path: string; size: number };
  webp: { path: string; size: number };
}

const run = async (cmd: string, args: string[]): Promise<void> => {
  await new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', rej);
    p.on('close', code => code === 0 ? res() : rej(new Error(`${cmd} exit ${code}: ${err.slice(0, 500)}`)));
  });
};

export default async (args: WorkerArguments): Promise<void> => {
  const results: PickResult[] = [];
  for (const t of args.tasks) {
    await fs.promises.mkdir(t.outDir, { recursive: true });
    const avifOut = path.join(t.outDir, `${t.basename}.avif`);
    const webpOut = path.join(t.outDir, `${t.basename}.webp`);

    await run(t.avifencBin, ['-j', 'all', '-s', '0', '-q', '65', t.srcPath, avifOut]);
    await run(t.cwebpBin, ['-q', '80', '-m', '6', '-pass', '10', '-mt', '-sns', '100', '-f', '100', '-sharp_yuv', t.srcPath, '-o', webpOut]);

    const [avifStat, webpStat] = await Promise.all([fs.promises.stat(avifOut), fs.promises.stat(webpOut)]);
    results.push({
      kind: path.basename(t.outDir),
      basename: t.basename,
      avif: { path: avifOut, size: avifStat.size },
      webp: { path: webpOut, size: webpStat.size },
    });
  }
  await fs.promises.writeFile(args.outputFile, JSON.stringify(results));
  logger.log(`Encoded ${results.length} files → ${args.outputFile}`);
};
