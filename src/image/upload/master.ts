import fs from 'node:fs';
import path from 'node:path';

import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { glob } from 'glob';

import type { Config } from '../..';
import { createLogger } from '../../logger';
import { md5File } from '../crypto';

const logger = createLogger('Upload');

const CONCURRENT_PUTS = 8;

const concurrent = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
};

const contentTypeFor = (ext: string): string =>
  ext === '.avif' ? 'image/avif' :
    ext === '.webp' ? 'image/webp' :
      'application/octet-stream';

/**
 * Fetches every object under `prefix` from the bucket via paginated ListObjectsV2.
 * Returns a Map keyed by full S3 key → {size, etag (md5-hex, without quotes)}.
 *
 * R2 returns ETag = md5(body) for simple (non-multipart, non-SSE-C) PUTs, which
 * is all we do here. See https://developers.cloudflare.com/r2/api/s3/api/#etag
 */
const listRemote = async (client: S3Client, bucket: string, prefix: string): Promise<Map<string, { size: number; etag: string }>> => {
  const result = new Map<string, { size: number; etag: string }>();
  let continuationToken: string | undefined;
  do {
    const resp = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const o of resp.Contents ?? []) {
      if (!o.Key || o.Size == null || !o.ETag) continue;
      result.set(o.Key, {
        size: o.Size,
        etag: o.ETag.replace(/"/g, ''),
      });
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);
  return result;
};

export const runUpload = async (imageDir: string, upload: NonNullable<Config['upload']>): Promise<void> => {
  const encodedRoot = path.join(imageDir, 'encoded');

  const client = new S3Client({
    endpoint: upload.endpoint,
    region: upload.region,
    credentials: {
      accessKeyId: upload.accessKeyId,
      secretAccessKey: upload.secretAccessKey,
    },
    forcePathStyle: true,
  });

  logger.log(`Listing remote s3://${upload.bucket}/${upload.prefix || ''}`);
  const prefixWithSlash = upload.prefix ? `${upload.prefix}/` : '';
  const remote = await listRemote(client, upload.bucket, prefixWithSlash);
  logger.log(`Remote has ${remote.size} objects under prefix`);

  const localRel = await glob(['*/*.avif', '*/*.webp'], { cwd: encodedRoot, absolute: false });

  const toUpload: { localPath: string; key: string; size: number }[] = [];
  const seenKeys = new Set<string>();
  let unchanged = 0;

  for (const rel of localRel) {
    const localPath = path.join(encodedRoot, rel);
    const key = upload.prefix ? `${upload.prefix}/${rel}` : rel;
    seenKeys.add(key);

    const stat = await fs.promises.stat(localPath);
    const remoteEntry = remote.get(key);

    if (remoteEntry && remoteEntry.size === stat.size) {
      const localMd5 = await md5File(localPath);
      if (localMd5 === remoteEntry.etag) {
        unchanged++;
        continue;
      }
    }

    toUpload.push({ localPath, key, size: stat.size });
  }

  const remoteOnly = [...remote.keys()].filter(k => !seenKeys.has(k));
  logger.log(`Upload: ${toUpload.length} to PUT, ${unchanged} unchanged, ${remoteOnly.length} remote-only (left untouched)`);

  await concurrent(toUpload, CONCURRENT_PUTS, async ({ localPath, key, size }) => {
    const body = await fs.promises.readFile(localPath);
    await client.send(new PutObjectCommand({
      Bucket: upload.bucket,
      Key: key,
      Body: body,
      ContentType: contentTypeFor(path.extname(key)),
    }));
    logger.log(`PUT ${key} (${size}B)`);
  });

  logger.log(`Upload done → s3://${upload.bucket}/${upload.prefix || ''}`);
};
