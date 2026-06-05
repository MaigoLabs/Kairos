import { spawn, type ChildProcessByStdio } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(dirname, '..', '..', '..');
const PYTHON = path.join(REPO_ROOT, 'python', '.venv', 'bin', 'python');
const SCRIPT = path.join(REPO_ROOT, 'python', 'unpack_batch.py');

interface UnpackResponse {
  ok?: boolean;
  ready?: boolean;
  skipped?: string;
  error?: string;
}

/**
 * Long-running UnityPy subprocess that decodes .ab → PNG one task at a time.
 *
 * Mirrors {@link ../upscale/upscaler.ts} in shape: importing UnityPy plus its
 * texture decoder costs ~1-2 s, so we keep one process alive per batch and
 * feed tasks over stdin/stdout JSON lines.
 */
export class Unpacker {
  private proc: ChildProcessByStdio<Writable, Readable, null>;
  private waiters: ((line: string) => void)[] = [];

  private constructor(proc: ChildProcessByStdio<Writable, Readable, null>) {
    this.proc = proc;
    const rl = createInterface({ input: proc.stdout });
    rl.on('line', line => {
      const handler = this.waiters.shift();
      if (handler) handler(line);
    });
    proc.on('exit', code => {
      // Flush pending waiters so awaiters never hang if Python dies.
      while (this.waiters.length) {
        const w = this.waiters.shift()!;
        w(JSON.stringify({ ok: false, error: `python exited (code=${code})` }));
      }
    });
  }

  static async start(): Promise<Unpacker> {
    const proc = spawn(PYTHON, [SCRIPT], { stdio: ['pipe', 'pipe', 'inherit'] });
    const u = new Unpacker(proc);
    const ready = JSON.parse(await u.nextLine()) as UnpackResponse;
    if (!ready.ready) throw new Error(`Unpacker did not signal ready: ${JSON.stringify(ready)}`);
    return u;
  }

  private nextLine(): Promise<string> {
    return new Promise(res => this.waiters.push(res));
  }

  async unpack(abPath: string, outPath: string): Promise<{ skipped?: string }> {
    this.proc.stdin.write(`${JSON.stringify({ abPath, outPath })}\n`);
    const resp = JSON.parse(await this.nextLine()) as UnpackResponse;
    if (!resp.ok) throw new Error(`Unpack failed for ${abPath}: ${resp.error ?? 'unknown'}`);
    return { skipped: resp.skipped };
  }

  async close(): Promise<void> {
    this.proc.stdin.end();
    await new Promise<void>(res => this.proc.on('exit', () => res()));
  }
}
