import fs from 'node:fs';

import { XMLParser } from 'fast-xml-parser';
import { glob } from 'glob';

export async function* parseXmls(stream: ReturnType<typeof glob.stream>) {
  for await (const file of stream) {
    const fileName = typeof file === 'string' ? file : file.fullpath();
    const xmlString = await fs.promises.readFile(fileName, 'utf-8');
    const xml = new XMLParser({ ignoreAttributes: false, allowBooleanAttributes: true }).parse(xmlString);
    yield { fileName, xml };
  }
}

export const globAxxxDirs = async (streamingAssetsPath: string) =>
  (await glob(`${streamingAssetsPath}/*`)).sort((a, b) => a.localeCompare(b));

export const globFiles = (axxxPath: string, dirName: string, subDirPrefix: string, fileName: string) =>
  glob.stream(`${axxxPath}/${dirName}/${subDirPrefix}*/${fileName}`);
