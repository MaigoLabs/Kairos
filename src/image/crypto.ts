import crypto from 'node:crypto';
import fs from 'node:fs';

export const sha256File = async (filePath: string): Promise<string> => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

export const md5File = async (filePath: string): Promise<string> => {
  const hash = crypto.createHash('md5');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};
