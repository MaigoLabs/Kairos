import { Unpacker } from './unpacker';
import { createLogger } from '../../logger';

const logger = createLogger('UnpackWorker');

export interface UnpackTask {
  /** Absolute path to the source `.ab` file. */
  abPath: string;
  /** Absolute output PNG path. Parent dir is created if needed. */
  outPath: string;
}

export interface WorkerArguments {
  tasks: UnpackTask[];
}

export default async (args: WorkerArguments): Promise<void> => {
  const unpacker = await Unpacker.start();
  try {
    for (const t of args.tasks) {
      const res = await unpacker.unpack(t.abPath, t.outPath);
      if (res.skipped) logger.warn(`Skipped ${t.abPath}: ${res.skipped}`);
    }
    logger.log(`Unpacked ${args.tasks.length} files`);
  } finally {
    await unpacker.close();
  }
};
