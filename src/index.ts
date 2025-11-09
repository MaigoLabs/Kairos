import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { merge } from 'es-toolkit';
import yaml from 'js-yaml';
import { z } from 'zod';

import { MaimaiRegion, MaimaiMajorVersionId } from './interfaces/index';
import { run } from './master';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export const Config = z.object({
  inputs: z.record(
    z.enum(MaimaiRegion),
    z.record(z.preprocess(Number, z.enum(MaimaiMajorVersionId)), z.string()),
  ),
  outputDir: z.string(),
});
export type Config = z.infer<typeof Config>;

const loadConfigFile = (filename: string) => yaml.load(fs.readFileSync(path.resolve(dirname, '..', filename), 'utf-8')) as Record<string, unknown>;
const config = Config.parse(merge(loadConfigFile('config.base.yaml'), loadConfigFile('config.yaml')));

await run(config);
