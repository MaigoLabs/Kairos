import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { merge } from 'es-toolkit';
import yaml from 'js-yaml';
import { z } from 'zod';

import { MaimaiRegion, MaimaiMajorVersionId } from './interfaces/index';
import { runMetadata } from './metadata/master';
import { runThumb } from './thumb/master';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export const Config = z.object({
  inputs: z.record(
    z.enum(MaimaiRegion),
    z.record(z.preprocess(Number, z.enum(MaimaiMajorVersionId)), z.string()),
  ).optional(),
  assetsDir: z.string().optional(),
  outputDir: z.string(),
});
export type Config = z.infer<typeof Config>;

const loadConfigFile = (filename: string) => yaml.load(fs.readFileSync(path.resolve(dirname, '..', filename), 'utf-8')) as Record<string, unknown>;
const config = Config.parse(merge(loadConfigFile('config.base.yaml'), loadConfigFile('config.yaml')));

const command = process.argv[2];
if (command === 'metadata') {
  if (!config.inputs) throw new Error('config.inputs is required');
  await runMetadata(config.inputs, config.outputDir);
} else if (command === 'thumb') {
  if (!config.assetsDir) throw new Error('config.assetsDir is required');
  await runThumb(config.assetsDir, config.outputDir);
} else {
  throw new Error(`Unknown command: ${command}`);
}
