export * from './base';
export * from './music';
export * from './title';
export * from './assets';
export * from './loginBonus';

import { maimaiAssetKinds } from './assets';

export const maimaiMetadataKinds = ['music', 'title', 'frame', 'icon', 'partner', 'plate', 'chara', 'card', 'loginBonus'] as const;
export type MaimaiMetadataKind = (typeof maimaiMetadataKinds)[number];

export const maimaiThumbKinds = maimaiAssetKinds;
export type MaimaiThumbKind = (typeof maimaiThumbKinds)[number];
export type ThumbCache = Record<MaimaiThumbKind, Record<string, { thumbHash: string; hash: string }>>;
