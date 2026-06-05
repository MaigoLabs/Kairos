import { Upscaler } from './upscaler';
import { createLogger } from '../../logger';

const logger = createLogger('UpscaleWorker');

export interface UpscaleTask {
  srcPath: string;
  dstPath: string;
  /** Output scale factor relative to input. Native model is 4x; other values resample after inference. */
  scale: 2 | 3 | 4;
}

export interface WorkerArguments {
  tasks: UpscaleTask[];
}

export default async (args: WorkerArguments): Promise<void> => {
  const upscaler = await Upscaler.start();
  try {
    for (const t of args.tasks) {
      await upscaler.upscale(t.srcPath, t.dstPath, t.scale);
    }
    logger.log(`Upscaled ${args.tasks.length} files`);
  } finally {
    await upscaler.close();
  }
};
