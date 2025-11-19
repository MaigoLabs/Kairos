import type { MaimaiMajorVersionId, MaimaiRegion } from './base';

export type MaimaiChartNoteStats = {
  tap: number;
  hold: number;
  slide: number;
  touch: number;
  break: number;
};

export type MaimaiChartMetadata = {
  // `level` is not included here and should be inferred from the change log.
  designer: string;
  stats?: MaimaiChartNoteStats;
};

export type MaimaiMusicMetadataBase = {
  name: string;
  artist: string;
  genre: string;
  bpm: number;
  charts: MaimaiChartMetadata[];
};

export type MaimaiMusicMetadataIntermediate = MaimaiMusicMetadataBase & {
  chartLevel: number[];
  versionId: MaimaiMajorVersionId;
  deletedInPatch: boolean;
  netOpenDate: string | null;
  subEventDate: string | null;
};

export enum MaimaiMusicAddDeleteLogEntry {
  Added = 1,
  AddedReMaster = 2,
  DeletedFromPackage = 3,
  DeletedInPatch = 4,
}
export type MaimaiMusicAddDeleteLog = Partial<Record<MaimaiMajorVersionId, MaimaiMusicAddDeleteLogEntry>>;
export interface MaimaiMusicMetadataRegionalInfo {
  versionId: MaimaiMajorVersionId;
  /**
   * For a music deleted from package, it don't have the level value in that version.
   * For a music deleted in patch, it has the level value in that version.
   */
  addDeleteLog: MaimaiMusicAddDeleteLog;
  netOpenDate: string | null;
  subEventDate: string | null;
}

export type MaimaiMusicLevelChangeLog = Partial<Record<MaimaiMajorVersionId, number>>[];
export interface MaimaiMusicMetadata extends MaimaiMusicMetadataBase {
  jacket?: { thumbhash: string; hash: string };
  /**
   * The level change log per chart (BASIC, ADVANCED, EXPERT, MASTER, Re:MASTER).
   */
  levelChangeLog: MaimaiMusicLevelChangeLog; // This is observed to be identical for all regions.
  regionalInfo: Partial<Record<MaimaiRegion, MaimaiMusicMetadataRegionalInfo>>;
}
