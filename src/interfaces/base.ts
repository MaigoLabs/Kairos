export enum MaimaiRegion {
  JPN = 'JPN',
  EXP = 'EXP',
  CHN = 'CHN',
}

export function maimaiRegionFromGameId(gameId: string) {
  switch (gameId) {
  case '\x53\x44\x45\x5a':
    return MaimaiRegion.JPN;
  case '\x53\x44\x47\x41':
    return MaimaiRegion.EXP;
  case '\x53\x44\x47\x42':
    return MaimaiRegion.CHN;
  default: // Fallback to JPN
    return MaimaiRegion.JPN;
  }
}

export enum MaimaiMajorVersionId {
  maimai = 0,
  maimai_PLUS = 1,
  GreeN = 2,
  GreeN_PLUS = 3,
  ORANGE = 4,
  ORANGE_PLUS = 5,
  PiNK = 6,
  PiNK_PLUS = 7,
  MURASAKi = 8,
  MURASAKi_PLUS = 9,
  MiLK = 10,
  MiLK_PLUS = 11,
  FiNALE = 12,
  DX = 13,
  DX_PLUS = 14,
  Splash = 15,
  Splash_PLUS = 16,
  UNiVERSE = 17,
  UNiVERSE_PLUS = 18,
  FESTiVAL = 19,
  FESTiVAL_PLUS = 20,
  BUDDiES = 21,
  BUDDiES_PLUS = 22,
  PRiSM = 23,
  PRiSM_PLUS = 24,
  CiRCLE = 25,
}

export const maimaiMajorVersionIds = Object.values(MaimaiMajorVersionId).filter(
  v => typeof v === 'number',
) as MaimaiMajorVersionId[];

export function maimaiVersionIdFromVersionString(gameVersion: string) {
  if (!gameVersion) {
    return maimaiMajorVersionIds[maimaiMajorVersionIds.length - 1];
  }
  const v = Number(gameVersion.split('.')[1]);
  const i = Math.floor(v / 5);
  const result = MaimaiMajorVersionId.DX + i;
  return maimaiMajorVersionIds.includes(result)
    ? result
    : /* Fallback to the latest version */ maimaiMajorVersionIds[maimaiMajorVersionIds.length - 1];
}

export type MetadataUnversioned<T> = { unversioned: T };
export type MetadataVersioned<T> = { versioned: Partial<Record<MaimaiMajorVersionId, T>> };
export type MetadataMaybeVersioned<T> = MetadataUnversioned<T> | MetadataVersioned<T>;

export type MetadataUnregionalized<T> = { unregionalized: MetadataMaybeVersioned<T> };
export type MetadataRegionalized<T> = { regionalized: Partial<Record<MaimaiRegion, MetadataMaybeVersioned<T>>> };
export type MetadataMaybeRegionalized<T> = MetadataUnregionalized<T> | MetadataRegionalized<T>;
