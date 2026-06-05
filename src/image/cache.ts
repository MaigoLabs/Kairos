import fs from 'node:fs';
import path from 'node:path';

/**
 * JSON-backed key→value cache used to skip re-doing expensive stages.
 * Loads on construction; callers must `await save()` to persist.
 *
 * Cache invalidation is the caller's responsibility: caller computes a "stamp"
 * (typically a content hash + parameters hash) and stores it under a stable key.
 * On the next run the caller compares the new stamp with the cached one and skips if equal.
 */
export class IncrementalCache<TStamp = string> {
  private data: Record<string, TStamp> = {};

  private constructor(private readonly filePath: string) {}

  static async load<TStamp = string>(filePath: string): Promise<IncrementalCache<TStamp>> {
    const cache = new IncrementalCache<TStamp>(filePath);
    const exists = await fs.promises.stat(filePath).then(() => true).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return false;
      throw err;
    });
    if (exists) {
      cache.data = JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as Record<string, TStamp>;
    }
    return cache;
  }

  get(key: string): TStamp | undefined {
    return this.data[key];
  }

  set(key: string, stamp: TStamp): void {
    this.data[key] = stamp;
  }

  delete(key: string): void {
    delete this.data[key];
  }

  has(key: string): boolean {
    return key in this.data;
  }

  keys(): string[] {
    return Object.keys(this.data);
  }

  async save(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
  }
}
