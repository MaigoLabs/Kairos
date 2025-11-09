import { initLogger, useGlobalLogger } from '@guiiai/logg';

initLogger();

export const createLogger = (name: string) => useGlobalLogger(name);
