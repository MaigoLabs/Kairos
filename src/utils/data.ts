import { isEqual } from 'es-toolkit';

import type { MaimaiMajorVersionId, MaimaiRegion, MetadataMaybeRegionalized, MetadataMaybeVersioned } from '../interfaces';
import { objectEntries, objectFromEntries, objectMap } from './base';
import { zCoerceString } from './zod';

export const parseNetOpenDate = (input: unknown) => {
  const str = zCoerceString(input);
  const match = str.match(/^Net(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  if (year === '99') return null;
  return `20${year}-${month}-${day}`;
};

export const parseEventIdAsNetOpenDate = (input: unknown) => {
  const str = zCoerceString(input);
  const match = str.match(/^(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  if (year === '99') return null;
  return `20${year}-${month}-${day}`;
};

export type VersionedMap<T> = Partial<Record<MaimaiMajorVersionId, T>>;
export const maybeCompactVersionedMap = <T>(versionedMap: VersionedMap<T>): MetadataMaybeVersioned<T> => {
  const versionedEntries = objectEntries(versionedMap)
    .toSorted(([verA], [verB]) => verA - verB) // version: low -> high
    .filter(([, data], index, array) => index === 0 || !isEqual(data, array[index - 1]?.[1])); // Skip entries that are equal to the previous version.
  return versionedEntries.length === 1
    ? { unversioned: versionedEntries[0]![1]! }
    : { versioned: objectFromEntries(versionedEntries) };
};

export type RegionalizedMap<T> = Partial<Record<MaimaiRegion, VersionedMap<T>>>;
export const maybeCompactRegionalizedMap = <T>(regionalizedMap: RegionalizedMap<T>): MetadataMaybeRegionalized<T> => {
  const regionalizedEntries = objectMap(regionalizedMap, versionedMap => maybeCompactVersionedMap(versionedMap!));
  return regionalizedEntries.JPN != null && isEqual(regionalizedEntries.JPN, regionalizedEntries.EXP) && isEqual(regionalizedEntries.JPN, regionalizedEntries.CHN)
    ? { unregionalized: regionalizedEntries.JPN! }
    : { regionalized: regionalizedEntries };
};

export type RegionalizedNetOpenDate = Partial<Record<MaimaiRegion, string | null>>;
