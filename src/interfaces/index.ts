export * from './base';
export * from './music';
export * from './title';

export const maimaiMetadataKinds = ['music', 'title', 'frame', 'icon', 'partner', 'plate', 'chara', 'card', 'loginBonus'] as const;
export type MaimaiMetadataKind = (typeof maimaiMetadataKinds)[number];
