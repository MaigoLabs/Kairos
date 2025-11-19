import fs from 'node:fs';

import type { MaimaiMetadataKind, MaimaiRegion, MaimaiMajorVersionId, ThumbCache } from '../interfaces';
import { createLogger } from '../logger';
import { basicDataTypes } from './processors/basic';
import { processMusic } from './processors/music';
import { objectMap } from '../utils/base';
import { globAxxxDirs } from '../utils/fs';

const logger = createLogger('Worker');

export interface WorkerArguments {
  thumbCache: ThumbCache;
  region: MaimaiRegion;
  version: MaimaiMajorVersionId;
  streamingAssetsPath: string;
  metadataKind: MaimaiMetadataKind;
  outputFilePath: string;
};

export interface WorkerContext extends WorkerArguments {
  forEachAxxxDirOrdered: (callback: (axxxDir: string) => Promise<void>) => Promise<void>;
}

export type WorkerProcessor<TIntermediateData> = (ctx: WorkerContext) => TIntermediateData | Promise<TIntermediateData>;

const run = async (args: WorkerArguments) => {
  const { region, version, streamingAssetsPath, metadataKind, outputFilePath } = args;
  logger.log(`Generating metadata for maimai (region = ${region}, version = ${version})`);

  // Axxx dirs are ordered, so don't use forEachParallel.
  const ctx: WorkerContext = {
    ...args,
    forEachAxxxDirOrdered: async (callback: (axxxDir: string) => Promise<void>) => {
      for (const axxxDir of await globAxxxDirs(streamingAssetsPath)) {
        logger.log(`Processing ${axxxDir}`);
        await callback(axxxDir);
      }
    },
  };

  const metadataKindProcessors: Record<MaimaiMetadataKind, WorkerProcessor<unknown>> = {
    ...objectMap(basicDataTypes, dataType => dataType.process),
    music: processMusic,
  };

  logger.log(`Writing metadata to ${outputFilePath}`);
  await fs.promises.writeFile(outputFilePath, JSON.stringify(await metadataKindProcessors[metadataKind](ctx), null, 2));
};

export default async (args: WorkerArguments) => {
  try {
    await run(args);
  } catch (error) {
    logger.error(`Error processing metadata: ${error}`);
    throw error;
  }
};
