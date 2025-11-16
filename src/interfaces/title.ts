import type { MaimaiRegion, MetadataMaybeRegionalized } from './base';

export enum MaimaiTitleRareType {
  Normal = 'Normal',
  Bronze = 'Bronze',
  Silver = 'Silver',
  Gold = 'Gold',
  Rainbow = 'Rainbow',
}

export type BasicMetadataBase<TExtra> = TExtra & { name: string };
export type BasicMetadataIntermediate<TExtra> = BasicMetadataBase<TExtra> & { netOpenDate: string | null };
export type BasicMetadata<TExtra = {}> = MetadataMaybeRegionalized<BasicMetadataBase<TExtra>> & {
  regionalNetOpenDate: Partial<Record<MaimaiRegion, string | null>>;
};

export type MaimaiTitleMetadataExtra = { rareType: MaimaiTitleRareType };
export type MaimaiFrameMetadataExtra = { thumbHash: string };
export type MaimaiIconMetadataExtra = { thumbHash: string };
export type MaimaiPlateMetadataExtra = { thumbHash: string };
