export * from './base';
export * from './music';
export * from './title';

export const maimaiMetadataKinds = ['music', 'title', 'frame', 'icon', 'partner', 'plate', 'chara', 'card', 'loginBonus'] as const;
export type MaimaiMetadataKind = (typeof maimaiMetadataKinds)[number];

export const maimaiThumbKinds = ['music', 'frame', 'icon', 'plate'] as const;
export type MaimaiThumbKind = (typeof maimaiThumbKinds)[number];
export type ThumbCache = Record<MaimaiThumbKind, Record<number, { thumbhash: string; hash: string }>>;
