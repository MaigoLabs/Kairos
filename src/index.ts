import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { merge } from 'es-toolkit';
import yaml from 'js-yaml';
import { z } from 'zod';

import { runEncode, runThumb, runUnpack, runUpload, runUpscale } from './image';
import { MaimaiRegion, MaimaiMajorVersionId } from './interfaces/index';
import { runMetadata } from './metadata/master';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export const Config = z.object({
  historicalMetadataInputs: z.record(
    z.enum(MaimaiRegion),
    z.record(z.preprocess(Number, z.enum(MaimaiMajorVersionId)), z.string()),
  ).optional(),
  gamePackageInput: z.string().optional(),
  hashSalt: z.string().optional(),
  outputDir: z.string(),
  upload: z.object({
    endpoint: z.string().url(),
    bucket: z.string(),
    prefix: z.string().default(''),
    region: z.string().default('auto'),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
  }).optional(),
});
export type Config = z.infer<typeof Config>;

const loadConfigFile = (filename: string) => yaml.load(fs.readFileSync(path.resolve(dirname, '..', filename), 'utf-8')) as Record<string, unknown>;
const config = Config.parse(merge(loadConfigFile('config.base.yaml'), loadConfigFile('config.yaml')));
const imageDir = path.join(config.outputDir, 'image');

const command = process.argv[2];
if (command === 'metadata') {
  if (!config.historicalMetadataInputs) throw new Error('config.historicalMetadataInputs is required');
  await runMetadata(config.historicalMetadataInputs, config.outputDir);
} else if (command === 'thumb') {
  await runThumb(imageDir, config.hashSalt ?? '', config.outputDir);
} else if (command === 'unpack') {
  if (!config.gamePackageInput) throw new Error('config.gamePackageInput is required');
  await runUnpack(config.gamePackageInput, imageDir);
} else if (command === 'upscale') {
  await runUpscale(imageDir);
} else if (command === 'encode') {
  await runEncode(imageDir);
} else if (command === 'upload') {
  if (!config.upload) throw new Error('config.upload is required');
  await runUpload(imageDir, config.upload);
} else {
  throw new Error(`Unknown command: ${command}`);
}
