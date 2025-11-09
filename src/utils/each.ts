import type { MaimaiMajorVersionId } from '../interfaces';
import { MaimaiRegion } from '../interfaces';

export const forEachRegion = <T>(
  regionMap: Map<MaimaiRegion, T>,
  order: 'jpnFirst' | 'jpnLast',
  callback: (region: MaimaiRegion, data: T) => void,
) =>
  [...regionMap.entries()]
    .sort(
      ([a], [b]) =>
        (order === 'jpnFirst' ? 1 : -1) *
        (Object.values(MaimaiRegion).indexOf(a) - Object.values(MaimaiRegion).indexOf(b)),
    )
    .forEach(([region, data]) => callback(region, data));

export const forEachVersion = <T>(
  versionMap: Map<MaimaiMajorVersionId, T>,
  order: 'oldFirst' | 'newFirst',
  callback: (version: MaimaiMajorVersionId, data: T) => void,
) =>
  [...versionMap.entries()]
    .sort(([a], [b]) => (order === 'oldFirst' ? a - b : b - a))
    .forEach(([version, data]) => callback(version, data));

export const forEachRegionAndVersion = <T>(
  regionMap: Map<MaimaiRegion, Map<MaimaiMajorVersionId, T>>,
  regionOrder: 'jpnFirst' | 'jpnLast',
  versionOrder: 'oldFirst' | 'newFirst',
  callback: (region: MaimaiRegion, version: MaimaiMajorVersionId, data: T) => void,
) => forEachRegion(
  regionMap, regionOrder,
  (region, versionMap) => forEachVersion(
    versionMap, versionOrder,
    (version, data) =>
      callback(region, version, data),
  ),
);
