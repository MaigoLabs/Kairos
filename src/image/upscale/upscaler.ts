import { spawn, type ChildProcessByStdio } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(dirname, '..', '..', '..');
const PYTHON = path.join(REPO_ROOT, 'python', '.venv', 'bin', 'python');
const SCRIPT = path.join(REPO_ROOT, 'python', 'upscale_batch.py');

interface UpscaleResponse {
  ok?: boolean;
  ready?: boolean;
  error?: string;
}

/**
 * A long-running Python subprocess that upscales PNGs over stdin/stdout.
 *
 * Real-ESRGAN model weights take 3-5s to load on the GPU; spawning a fresh
 * Python per file would be cold-start-bound. Keep one process per batch and
 * feed tasks sequentially.
 */
export class Upscaler {
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

  static async start(): Promise<Upscaler> {
    const proc = spawn(PYTHON, [SCRIPT], { stdio: ['pipe', 'pipe', 'inherit'] });
    const u = new Upscaler(proc);
    const ready = JSON.parse(await u.nextLine()) as UpscaleResponse;
    if (!ready.ready) throw new Error(`Upscaler did not signal ready: ${JSON.stringify(ready)}`);
    return u;
  }

  private nextLine(): Promise<string> {
    return new Promise(res => this.waiters.push(res));
  }

  async upscale(srcPath: string, dstPath: string, scale: 2 | 3 | 4): Promise<void> {
    this.proc.stdin.write(`${JSON.stringify({ srcPath, dstPath, scale })}\n`);
    const resp = JSON.parse(await this.nextLine()) as UpscaleResponse;
    if (!resp.ok) throw new Error(`Upscale failed for ${srcPath}: ${resp.error ?? 'unknown'}`);
  }

  async close(): Promise<void> {
    this.proc.stdin.end();
    await new Promise<void>(res => this.proc.on('exit', () => res()));
  }
}
