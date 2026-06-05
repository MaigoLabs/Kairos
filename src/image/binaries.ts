import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { createLogger } from '../logger';
import { sha256File } from './crypto';

const logger = createLogger('Binaries');
const dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(dirname, '..', '..');
export const BIN_CACHE_DIR = path.join(REPO_ROOT, '.cache', 'bin');

interface BinarySpecBase {
  name: string;
  url: string;
  sha256: string;
  /** Path under BIN_CACHE_DIR where the final file lives. */
  outRelPath: string;
  executable?: boolean;
}
type BinarySpec =
  | (BinarySpecBase & { archiveType?: undefined; archiveMember?: undefined })
  | (BinarySpecBase & { archiveType: 'zip' | 'tar.gz'; archiveMember: string });

export const BINARIES = {
  avifenc: {
    name: 'avifenc',
    url: 'https://github.com/AOMediaCodec/libavif/releases/download/v1.4.2/linux-artifacts.zip',
    sha256: 'bfa76fdb43b4903972ed2baedbff889d4f1e0b19efe7fe934044cf83e4b709a5',
    archiveType: 'zip',
    archiveMember: 'avifenc',
    outRelPath: 'avifenc',
    executable: true,
  },
  cwebp: {
    name: 'cwebp',
    url: 'https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.5.0-linux-x86-64.tar.gz',
    sha256: '3f7c790f922b9417031180e33ed3ccfab5f2c543829d7915e2953f8419a81422',
    archiveType: 'tar.gz',
    archiveMember: 'libwebp-1.5.0-linux-x86-64/bin/cwebp',
    outRelPath: 'cwebp',
    executable: true,
  },
} as const satisfies Record<string, BinarySpec>;

export type BinaryKey = keyof typeof BINARIES;

const targetPath = (spec: BinarySpec): string => path.join(BIN_CACHE_DIR, spec.outRelPath);

const downloadTo = async (url: string, dest: string): Promise<void> => {
  logger.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(res.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(dest));
};

const extractMember = async (cmd: string, args: string[], outPath: string, label: string): Promise<void> => {
  await new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    const out = fs.createWriteStream(outPath);
    p.stdout.pipe(out);
    p.on('error', rej);
    p.on('close', code => {
      if (code === 0) out.on('close', () => res());
      else rej(new Error(`${label} extraction exited ${code}`));
    });
  });
};

export const ensureBinary = async (key: BinaryKey): Promise<string> => {
  const spec = BINARIES[key] as BinarySpec;
  const out = targetPath(spec);
  const existing = await fs.promises.stat(out).then(() => true).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return false;
    throw err;
  });
  if (existing) {
    if (await sha256File(out) === spec.sha256) return out;
    logger.warn(`Binary ${spec.name} sha256 mismatch — redownloading`);
    await fs.promises.rm(out);
  }

  const tmp = `${out}.download`;
  if (spec.archiveType) {
    const archive = `${out}.archive`;
    await downloadTo(spec.url, archive);
    if (spec.archiveType === 'zip') {
      await extractMember('unzip', ['-p', archive, spec.archiveMember], tmp, `unzip ${spec.archiveMember} from ${archive}`);
    } else {
      await extractMember('tar', ['-xzOf', archive, spec.archiveMember], tmp, `tar ${spec.archiveMember} from ${archive}`);
    }
    await fs.promises.rm(archive);
  } else {
    await downloadTo(spec.url, tmp);
  }

  const got = await sha256File(tmp);
  if (got !== spec.sha256) {
    await fs.promises.rm(tmp, { force: true });
    throw new Error(`sha256 mismatch for ${spec.name}: expected ${spec.sha256}, got ${got}`);
  }
  await fs.promises.rename(tmp, out);
  if (spec.executable) await fs.promises.chmod(out, 0o755);
  logger.log(`Ready: ${out}`);
  return out;
};

export const ensureAllBinaries = async (): Promise<Record<BinaryKey, string>> => {
  const entries = await Promise.all(
    (Object.keys(BINARIES) as BinaryKey[]).map(async k => [k, await ensureBinary(k)] as const),
  );
  return Object.fromEntries(entries) as Record<BinaryKey, string>;
};
