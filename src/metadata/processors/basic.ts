import { omit } from 'es-toolkit';

import type { BasicMetadata, BasicMetadataBase, BasicMetadataIntermediate, MaimaiThumbKind, MaimaiTitleMetadataExtra } from '../../interfaces';
import { MaimaiTitleRareType } from '../../interfaces';
import { createLogger } from '../../logger';
import { forEachParallel, objectMap } from '../../utils/base';
import type { RegionalizedMap, RegionalizedNetOpenDate } from '../../utils/data';
import { maybeCompactRegionalizedMap, parseNetOpenDate } from '../../utils/data';
import { forEachRegionAndVersion } from '../../utils/each';
import { globFiles, parseXmls } from '../../utils/fs';
import { zCoerceNumber, zCoerceString, zParseEnum } from '../../utils/zod';
import type { MetadataMerger } from '../master';
import type { WorkerProcessor } from '../worker';

const logger = createLogger('Basic');

type IntermediateData<TExtra> = Record<number, BasicMetadataIntermediate<TExtra>>;

const defineDataType = <TExtra = {}>(
  globXmls: (axxxDir: string) => ReturnType<typeof globFiles>,
  thumbKind: MaimaiThumbKind | undefined,
  xmlRootElementName: string,
  parseExtraFields: (xmlData: any) => TExtra = () => ({}) as any,
): {
  process: WorkerProcessor<IntermediateData<TExtra>>;
  merge: MetadataMerger<IntermediateData<TExtra>, Record<number, BasicMetadata<TExtra>>>;
} => ({
  process: async ctx => {
    const result: Record<number, BasicMetadataIntermediate<TExtra>> = {};
    await ctx.forEachAxxxDirOrdered(async axxxDir => await forEachParallel(parseXmls(globXmls(axxxDir)), async ({ xml }) => {
      const xmlData = xml[xmlRootElementName];
      const id = zCoerceNumber(xmlData.name.id);
      const name = zCoerceString(xmlData.name.str);
      const netOpenDate = parseNetOpenDate(xmlData.netOpenName.str);
      result[id] = { name, netOpenDate, ...parseExtraFields(xmlData) };
      if (thumbKind) {
        const assetImage = ctx.thumbCache[thumbKind][id];
        if (!assetImage) logger.warn(`Asset image ${thumbKind} ${id} not found in thumb cache`);
        (result[id] as { assetImage?: { thumbhash: string; hash: string } }).assetImage = assetImage;
      }
    }));
    return result;
  },
  merge: dataMap => {
    // Merge
    const regionalNetOpenDate: Record<number, RegionalizedNetOpenDate> = {};
    const mergedMap: Record<number, RegionalizedMap<BasicMetadataBase<TExtra>>> = {};
    forEachRegionAndVersion(dataMap, 'jpnFirst', 'oldFirst', (region, version, entries) => Object.entries(entries).forEach(([idStr, entry]) => {
      const id = Number(idStr);
      const regionalizedMap = mergedMap[id] ??= {};
      const versionedMap = regionalizedMap[region] ??= {};
      versionedMap[version] = omit(entry, ['netOpenDate']) as BasicMetadataBase<TExtra>;

      (regionalNetOpenDate[id] ??= {})[region] ??= null;
      if (entry.netOpenDate) (regionalNetOpenDate[id] ??= {})[region] = entry.netOpenDate; // Newer version overrides the older one.
    }));

    // Compact
    return objectMap(mergedMap, (regionalizedMap, idStr) => ({
      ...maybeCompactRegionalizedMap(regionalizedMap!),
      regionalNetOpenDate: regionalNetOpenDate[Number(idStr)]!,
    }));
  },
});

export const basicDataTypes = {
  title: defineDataType<MaimaiTitleMetadataExtra>(axxxDir => globFiles(axxxDir, 'title', 'title', 'Title.xml'), undefined, 'TitleData', TitleData => ({
    rareType: zParseEnum(MaimaiTitleRareType, TitleData.rareType),
  })),
  frame: defineDataType(axxxDir => globFiles(axxxDir, 'frame', 'frame', 'Frame.xml'), 'frame', 'FrameData'),
  icon: defineDataType(axxxDir => globFiles(axxxDir, 'icon', 'icon', 'Icon.xml'), 'icon', 'IconData'),
  partner: defineDataType(axxxDir => globFiles(axxxDir, 'partner', 'partner', 'Partner.xml'), undefined, 'PartnerData'),
  plate: defineDataType(axxxDir => globFiles(axxxDir, 'plate', 'plate', 'Plate.xml'), 'plate', 'PlateData'),
  chara: defineDataType(axxxDir => globFiles(axxxDir, 'chara', 'chara', 'Chara.xml'), undefined, 'CharaData'),
  card: defineDataType(axxxDir => globFiles(axxxDir, 'card', 'card', 'Card.xml'), undefined, 'CardData'),
  loginBonus: defineDataType(axxxDir => globFiles(axxxDir, 'loginBonus', 'LoginBonus', 'LoginBonus.xml'), undefined, 'LoginBonusData'),
};
