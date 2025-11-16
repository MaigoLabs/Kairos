import fs from 'node:fs';

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { rgbaToThumbHash } from 'thumbhash-node';

import type { MaimaiThumbKind } from '../interfaces';
import { maimaiThumbKinds } from '../interfaces';
import { createLogger } from '../logger';
import { arrayToObject } from '../utils/base';

const logger = createLogger('Worker');

export type WorkerArguments = {
  tasks: { kind: MaimaiThumbKind; id: number; filePath: string }[];
  outputFile: string;
};

const MAX_SIZE = 100;

export default async (args: WorkerArguments) => {
  const result: Record<MaimaiThumbKind, Record<number, string>> = arrayToObject(maimaiThumbKinds, () => ({}));
  await Promise.all(args.tasks.map(async ({ kind, id, filePath }) => {
    const image = await loadImage(filePath);
    const width = image.width;
    const height = image.height;
    const scale = Math.min(MAX_SIZE / width, MAX_SIZE / height);
    const resizedWidth = Math.round(width * scale);
    const resizedHeight = Math.round(height * scale);
    const canvas = createCanvas(resizedWidth, resizedHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const rgba = new Uint8Array(imageData.data.buffer);
    const thumbhash = rgbaToThumbHash(resizedWidth, resizedHeight, rgba);
    logger.log(`Generated thumbhash for ${filePath}`);
    result[kind][id] = Buffer.from(thumbhash).toString('base64url');
  }));
  await fs.promises.writeFile(args.outputFile, JSON.stringify(result, null, 2));
};
