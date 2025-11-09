import { omit } from 'es-toolkit';

import type { BasicMetadata, BasicMetadataBase, BasicMetadataIntermediate, MaimaiTitleMetadataExtra } from '../interfaces';
import { MaimaiTitleRareType } from '../interfaces';
import type { MetadataMerger } from '../master';
import { forEachParallel, objectMap } from '../utils/base';
import type { RegionalizedMap, RegionalizedNetOpenDate } from '../utils/data';
import { maybeCompactRegionalizedMap, parseNetOpenDate } from '../utils/data';
import { forEachRegionAndVersion } from '../utils/each';
import { globFiles, parseXmls } from '../utils/fs';
import { zCoerceNumber, zCoerceString, zParseEnum } from '../utils/zod';
import type { WorkerProcessor } from '../worker';

type IntermediateData<TExtra> = Record<number, BasicMetadataIntermediate<TExtra>>;

const defineDataType = <TExtra = {}>(
  globXmls: (axxxDir: string) => ReturnType<typeof globFiles>,
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
      result[id] = { name, netOpenDate, ...parseExtraFields!(xmlData) };
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
  title: defineDataType<MaimaiTitleMetadataExtra>(axxxDir => globFiles(axxxDir, 'title', 'title', 'Title.xml'), 'TitleData', TitleData => ({
    rareType: zParseEnum(MaimaiTitleRareType, TitleData.rareType),
  })),
  frame: defineDataType(axxxDir => globFiles(axxxDir, 'frame', 'frame', 'Frame.xml'), 'FrameData'),
  icon: defineDataType(axxxDir => globFiles(axxxDir, 'icon', 'icon', 'Icon.xml'), 'IconData'),
  partner: defineDataType(axxxDir => globFiles(axxxDir, 'partner', 'partner', 'Partner.xml'), 'PartnerData'),
  plate: defineDataType(axxxDir => globFiles(axxxDir, 'plate', 'plate', 'Plate.xml'), 'PlateData'),
  chara: defineDataType(axxxDir => globFiles(axxxDir, 'chara', 'chara', 'Chara.xml'), 'CharaData'),
  card: defineDataType(axxxDir => globFiles(axxxDir, 'card', 'card', 'Card.xml'), 'CardData'),
  loginBonus: defineDataType(axxxDir => globFiles(axxxDir, 'loginBonus', 'LoginBonus', 'LoginBonus.xml'), 'LoginBonusData'),
};
