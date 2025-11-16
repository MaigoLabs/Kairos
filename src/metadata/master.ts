import fs from 'node:fs';
import path from 'node:path';

import Tinypool from 'tinypool';

import type { MaimaiMajorVersionId, MaimaiMetadataKind, MaimaiRegion, MaimaiThumbKind } from '../interfaces';
import { maimaiMetadataKinds, maimaiThumbKinds } from '../interfaces';
import { createLogger } from '../logger';
import { basicDataTypes } from './processors/basic';
import { mergeMusic } from './processors/music';
import type { WorkerArguments } from './worker';
import { arrayToObject, getOrSet, objectEntries, objectMap } from '../utils/base';

const logger = createLogger('Master');

const pool = new Tinypool({
  filename: new URL('./worker.ts', import.meta.url).href,
  minThreads: 8,
  maxThreads: 32,
});

export type IntermediateDataMap<TIntermediateData> = Map<MaimaiRegion, Map<MaimaiMajorVersionId, TIntermediateData>>;
export type MetadataMerger<TIntermediateData, TResult> = (intermediateDataMap: IntermediateDataMap<TIntermediateData>, thumbCache: Record<MaimaiThumbKind, Record<number, string>>) => TResult;

export const runMetadata = async (inputs: Record<MaimaiRegion, Record<MaimaiMajorVersionId, string>>, outputDir: string) => {
  await fs.promises.mkdir(outputDir, { recursive: true });

  const thumbCacheFilePath = path.resolve(outputDir, 'thumb.json');
  let thumbCache: Record<MaimaiThumbKind, Record<number, string>>;
  if (await fs.promises.stat(thumbCacheFilePath).catch(() => false)) {
    thumbCache = JSON.parse(await fs.promises.readFile(thumbCacheFilePath, 'utf-8')) as Record<MaimaiThumbKind, Record<number, string>>;
  } else {
    logger.warn('Thumb cache not found, generating metadata with empty thumb hashes');
    thumbCache = arrayToObject(maimaiThumbKinds, () => ({}));
  }

  const index: Map<MaimaiMetadataKind, Map<MaimaiRegion, Map<MaimaiMajorVersionId, string>>> = new Map();
  const tasks: Promise<void>[] = [];
  for (const [regionName, versionPathMap] of objectEntries(inputs)) {
    const region = regionName as MaimaiRegion;
    for (const [versionName, streamingAssetsPath] of objectEntries(versionPathMap)) {
      const version = Number(versionName) as MaimaiMajorVersionId;
      const versionOutputDir = path.resolve(outputDir, 'intermediate', `${region}-${version}`);
      await fs.promises.mkdir(versionOutputDir, { recursive: true });

      const filePaths = arrayToObject(maimaiMetadataKinds, kind => path.resolve(versionOutputDir, `${kind}.json`));

      for (const [metadataKind, outputFilePath] of objectEntries(filePaths)) {
        const regionIndex = getOrSet(index, metadataKind as MaimaiMetadataKind, new Map());
        const versionIndex = getOrSet(regionIndex, region, new Map());
        versionIndex.set(version, outputFilePath);

        if (fs.existsSync(outputFilePath)) continue;

        tasks.push(pool.run({
          thumbCache,
          region,
          version,
          streamingAssetsPath,
          metadataKind,
          outputFilePath,
        } satisfies WorkerArguments));
      }
    }
  }
  await Promise.all(tasks);

  const dataMap: Map<MaimaiMetadataKind, IntermediateDataMap<unknown>> = new Map();
  for (const [kind, regionMergeIndex] of index.entries()) {
    const regionMap = getOrSet(dataMap, kind, new Map());
    for (const [region, versionMergeIndex] of regionMergeIndex.entries()) {
      const versionMap = getOrSet(regionMap, region, new Map());
      for (const [version, outputFilePath] of versionMergeIndex.entries()) {
        const data = JSON.parse(await fs.promises.readFile(outputFilePath, 'utf-8'));
        versionMap.set(version, data);
      }
    }
  }

  const mergers: Record<MaimaiMetadataKind, MetadataMerger<any, any>> = {
    ...objectMap(basicDataTypes, dataType => dataType.merge),
    music: mergeMusic,
  };
  const result = objectEntries(mergers).reduce((result, [kind, merger]) => {
    try {
      result[kind] = merger(dataMap.get(kind)!, thumbCache);
      return result;
    } catch (error) {
      logger.error(`Failed to merge ${kind} metadata`);
      throw error;
    }
  }, {} as Record<MaimaiMetadataKind, unknown>);

  const mergedFilePath = path.resolve(outputDir, 'merged.json');
  await fs.promises.writeFile(mergedFilePath, JSON.stringify(result, null, 2));
  logger.log(`Merged metadata to ${mergedFilePath}`);
};
