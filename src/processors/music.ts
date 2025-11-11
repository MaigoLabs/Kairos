import type { MaimaiChartMetadataIntermediate, MaimaiMusicMetadata, MaimaiMusicMetadataIntermediate } from '../interfaces';
import { MaimaiRegion, MaimaiMajorVersionId, maimaiMajorVersionIds, MaimaiMusicAddDeleteLogEntry } from '../interfaces';
import { createLogger } from '../logger';
import type { MetadataMerger } from '../master';
import { forEachParallel, objectEntries, objectKeys } from '../utils/base';
import { parseEventIdAsNetOpenDate, parseNetOpenDate } from '../utils/data';
import { forEachRegionAndVersion } from '../utils/each';
import { globFiles, parseXmls } from '../utils/fs';
import { zCoerceNumber, zCoerceString, zParseEnum } from '../utils/zod';
import type { WorkerProcessor } from '../worker';

const logger = createLogger('Music');

type IntermediateData = Record<number, MaimaiMusicMetadataIntermediate>;

export const processMusic: WorkerProcessor<IntermediateData> = async ctx => {
  const musics: Record<number, MaimaiMusicMetadataIntermediate> = {};
  await ctx.forEachAxxxDirOrdered(async axxxDir => await forEachParallel(parseXmls(globFiles(axxxDir, 'music', 'music', 'Music.xml')), async ({ fileName, xml: { MusicData } }) => {
    const id = zCoerceNumber(MusicData.name.id);
    const name = zCoerceString(MusicData.name.str);
    const artist = zCoerceString(MusicData.artistName.str);
    const genre = zCoerceString(MusicData.genreName.str);
    const bpm = zCoerceNumber(MusicData.bpm);
    const versionId = zParseEnum(MaimaiMajorVersionId, MusicData.AddVersion.id);
    const netOpenDate = parseNetOpenDate(MusicData.netOpenName.str);
    const subEventDate = parseEventIdAsNetOpenDate(MusicData.subEventName.id);

    const charts = (MusicData.notesData.Notes as any[]).map(note =>
      // DX and DX+ version didn't set the `isEnable` flag.
      (
        ctx.version === MaimaiMajorVersionId.DX || ctx.version === MaimaiMajorVersionId.DX_PLUS
          ? !!note.level
          : note.isEnable
      )
        ? {
          level: zCoerceNumber(note.level) + zCoerceNumber(note.levelDecimal) / 10,
          designer: zCoerceString(note.notesDesigner.str),
        } satisfies MaimaiChartMetadataIntermediate
        : undefined);

    // Remove charts of nonexistent difficulties.
    while (charts.length > 0 && charts[charts.length - 1] === undefined) charts.pop();

    // Normally musics are deleted only on major version updates.
    // However, sometimes they delete musics in patches due to political or copyright reasons.
    const isDeleted = MusicData.eventName.id === 0;
    if (isDeleted) {
      logger.warn(`Music ${fileName} (${name}) deleted by patch!`);
      const existingMusic = musics[id];
      if (!existingMusic) logger.error(`Music ${fileName} (${name}) is detected to be deleted by patch but not found!`);
      else existingMusic.deletedInPatch = true;
      return;
    }

    musics[id] = {
      name,
      artist,
      genre,
      bpm,
      versionId,
      charts: charts.map(c => ({ designer: c!.designer })),
      chartsWithLevel: charts.map(c => c!),
      netOpenDate,
      subEventDate,
      deletedInPatch: false,
    } satisfies MaimaiMusicMetadataIntermediate;
  }));
  return musics;
};

export const mergeMusic: MetadataMerger<IntermediateData, Record<number, MaimaiMusicMetadata>> = dataMap => {
  const result: Record<number, MaimaiMusicMetadata> = {};

  // Merge all musics. JPN first. Nerwer version first.
  const lowsetSeenVersionId: Record<number, MaimaiMajorVersionId> = {};
  forEachRegionAndVersion(dataMap, 'jpnFirst', 'newFirst', (region, version, musics) => Object.entries(musics).forEach(([idStr, music]) => {
    const id = Number(idStr);
    const resultMusic = result[id] ??= {
      name: music.name,
      artist: music.artist,
      genre: music.genre,
      bpm: music.bpm,
      charts: music.charts,
      levelChangeLog: [],
      regionalInfo: {},
    };
    if (resultMusic.charts.length < music.charts.length) {
      // Re:MASTER added.
      resultMusic.charts.push(...music.charts.slice(resultMusic.charts.length));
    }
    const regionalInfo = resultMusic.regionalInfo[region] ??= {
      versionId: music.versionId,
      addDeleteLog: {},
      netOpenDate: null,
      subEventDate: null,
    };
    regionalInfo.netOpenDate ??= music.netOpenDate; // The newest version comes first.
    regionalInfo.subEventDate ??= music.subEventDate;
    lowsetSeenVersionId[id] = Math.min(lowsetSeenVersionId[id] ?? version, version);
  }));

  const knownMusicIds = new Set(objectKeys(result).map(Number));
  const perRegionLevelChangeLog: Record<
    number,
    Partial<Record<MaimaiRegion, Partial<Record<MaimaiMajorVersionId, number | null>>[]>>
  > = Object.fromEntries(objectKeys(result).map(id => [id, {}]));
  // Process the change log - with the release version order.
  forEachRegionAndVersion(dataMap, 'jpnFirst', 'oldFirst', (region, version, musics) => {
    // Track the music IDs known but not seen in the current version.
    const unseenMusicIds = new Set(knownMusicIds);
    // Set the level in change log for the version, for each music and chart.
    for (const [idStr, music] of objectEntries(musics)) {
      const id = Number(idStr);
      const changeLog = (perRegionLevelChangeLog[id]![region] ??= []);
      for (const [i, chart] of music.chartsWithLevel.entries()) {
        unseenMusicIds.delete(id);
        if (chart) (changeLog[i] ||= {})[version] = chart.level;
      }
    }
    // For each unseen music IDs, if we've seen it before in current region, mark it as "deleted from package".
    for (const musicId of unseenMusicIds) {
      const changeLog = perRegionLevelChangeLog[musicId]![region];
      if (changeLog) {
        let deleted = false;
        for (const chart of changeLog) {
          if (chart) {
            chart[version] = null; // Mark as "deleted from package".
            deleted = true;
          }
        }
        if (deleted) logger.verbose(`Music ${musicId} (${result[musicId]!.name}) is deleted in ${MaimaiMajorVersionId[version]} package`);
      }
    }
  });

  // Check -- one chart's level should keep the same in the same version across regions.
  for (const musicId of knownMusicIds) {
    for (let difficulty = 0; difficulty <= 4; difficulty++) {
      for (const version of maimaiMajorVersionIds) {
        const resultMusic = result[musicId]!;
        let known: { region: string; level: number } | undefined;
        for (const region of objectKeys(resultMusic.regionalInfo)) {
          if (region === MaimaiRegion.CHN) continue;
          const changeLog = perRegionLevelChangeLog[musicId]![region]![difficulty];
          const level = changeLog?.[version];
          if (level) {
            if (known) {
              if (known.level !== level) {
                logger.error(
                  `Chart ${musicId}[${difficulty}] (${result[musicId]!.name}) has different same-version level (${known.region}: ${known.level}, ${region}: ${level}) in ${MaimaiMajorVersionId[version]}`,
                );
              }
            } else {
              known = { region, level };
            }

            // Check -- if a music is added in a non-JPN region before the JPN version. the level should be the same.
            if (region !== MaimaiRegion.JPN) {
              const jpnChangeLog = perRegionLevelChangeLog[musicId]![MaimaiRegion.JPN]?.[difficulty];
              if (jpnChangeLog) {
                const firstVersion = lowsetSeenVersionId[musicId]!;
                const firstLevel = perRegionLevelChangeLog[musicId]![MaimaiRegion.JPN]![difficulty]?.[firstVersion];
                if (firstLevel && version < firstVersion) {
                  if (level !== firstLevel) {
                    logger.error(
                      `Chart ${musicId}[${difficulty}] (${result[musicId]!.name}) has different level (${region}: ${level}, JPN: ${firstLevel}) in ${MaimaiMajorVersionId[version]} (JPN added in ${MaimaiMajorVersionId[firstVersion]})`,
                    );
                  } else {
                    logger.verbose(
                      `Chart ${musicId}[${difficulty}] (${result[musicId]!.name}) has the same level (${level}) in ${MaimaiMajorVersionId[version]} (JPN added in ${MaimaiMajorVersionId[firstVersion]})`,
                    );
                  }
                  // else: missing data.
                }
              }
            }
          }
        }
      }
    }
  }

  // Fill the `levelChangeLog` and `addDeleteLog` in the result with `perRegionLevelChangeLog`.
  for (const [idStr, music] of objectEntries(result)) {
    const id = Number(idStr);
    const levelChangeLog = music.levelChangeLog;
    for (const region of objectKeys(music.regionalInfo)) {
      const regionLevelChangeLog = perRegionLevelChangeLog[id]![region]!;
      if (region !== MaimaiRegion.CHN) {
        for (const [difficulty, regionLevelChangeLogEntries] of regionLevelChangeLog.entries()) {
          levelChangeLog[difficulty] ||= {};
          for (const [version, level] of objectEntries(regionLevelChangeLogEntries)) {
            if (level != null) {
              levelChangeLog[difficulty]![version] = level;
            }
          }
        }
      }
      const { addDeleteLog } = music.regionalInfo[region]!;
      let previousVersion: MaimaiMajorVersionId | undefined;
      for (const version of dataMap.get(region)!.keys()) {
        let addDeleteLogEntry: MaimaiMusicAddDeleteLogEntry | undefined;
        if (
          regionLevelChangeLog[0]![version] != null &&
          (previousVersion === undefined || regionLevelChangeLog[0]![previousVersion] == null)
        ) {
          addDeleteLogEntry = MaimaiMusicAddDeleteLogEntry.Added;
        } else if (
          previousVersion !== undefined &&
          regionLevelChangeLog[4]?.[version] != null &&
          regionLevelChangeLog[4]?.[previousVersion] == null
        ) {
          addDeleteLogEntry = MaimaiMusicAddDeleteLogEntry.AddedReMaster;
        } else if (previousVersion !== undefined && regionLevelChangeLog[0]![previousVersion] != null) {
          const input = dataMap.get(region)!.get(version)!;
          if (regionLevelChangeLog[0]![version] == null) {
            addDeleteLogEntry = MaimaiMusicAddDeleteLogEntry.DeletedFromPackage;
          } else if (input[id]!.deletedInPatch) {
            addDeleteLogEntry = MaimaiMusicAddDeleteLogEntry.DeletedInPatch;
          }
        }
        if (addDeleteLogEntry) {
          addDeleteLog[version] = addDeleteLogEntry;
        }
        previousVersion = version;
      }
    }

    // Delete the unchanged version entries from level change log.
    for (const levelChangeLogEntries of levelChangeLog.values()) {
      const entries = objectEntries(levelChangeLogEntries).sort(([a], [b]) => Number(a) - Number(b));
      for (const [i, [version, level]] of entries.entries()) {
        // The first entry is always kept.
        if (i === 0) continue;
        // Check if the level is changed from the previous version.
        const previousLevel = entries[i - 1]![1];
        if (level === previousLevel) {
          delete levelChangeLogEntries[version];
        }
      }
    }
  }

  // TODO: Merge to one change log and track unavailablity (done). CHN 1.20 levels mismatch?
  return result;
};
