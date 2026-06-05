// Mapping from Kairos asset kind names → StreamingAssets/A000/AssetBundleImages/<dir>/<prefix>*.ab.
// Output PNG IDs are derived from the .ab basename: strip prefix, strip leading zeros on each
// underscore-separated numeric segment.

export const maimaiAssetKinds = [
  'music', 'frame', 'icon', 'plate',
  'partner', 'chara',
  'cardBase', 'cardChara', 'cardFrame',
] as const;
export type MaimaiAssetKind = (typeof maimaiAssetKinds)[number];

export interface MaimaiAssetSource {
  /** Subdirectory under `A000/AssetBundleImages/`. */
  abDir: string;
  /** `.ab` filename prefix (everything between this and `.ab` is the ID, sans trailing `.ab`). */
  abPrefix: string;
}

export const maimaiAssetKindSources: Record<MaimaiAssetKind, MaimaiAssetSource> = {
  music: { abDir: 'jacket', abPrefix: 'ui_jacket_' },
  frame: { abDir: 'frame', abPrefix: 'ui_frame_' },
  icon: { abDir: 'icon', abPrefix: 'ui_icon_' },
  plate: { abDir: 'nameplate', abPrefix: 'ui_plate_' },
  partner: { abDir: 'partner', abPrefix: 'ui_partner_' },
  chara: { abDir: 'chara', abPrefix: 'ui_chara_' },
  cardBase: { abDir: 'cardbase_s', abPrefix: 'ui_cardbase_' },
  cardChara: { abDir: 'cardchara_s', abPrefix: 'ui_cardchara_' },
  cardFrame: { abDir: 'cardframe_s', abPrefix: 'ui_cardframe_' },
};

/**
 * Converts an `.ab` basename (e.g. `ui_jacket_000123.ab`) under kind `music`
 * to its output PNG ID (e.g. `123`).
 *
 * For compound IDs (cardBase: `ui_cardbase_0000002_000001_s.ab`), each underscore-separated
 * numeric segment is independently stripped, so the result is `2_1_s`.
 */
export const maimaiAssetIdFromAbName = (kind: MaimaiAssetKind, abBasename: string): string => {
  const src = maimaiAssetKindSources[kind];
  if (!abBasename.startsWith(src.abPrefix) || !abBasename.endsWith('.ab')) {
    throw new Error(`Asset .ab name does not match kind ${kind}: ${abBasename}`);
  }
  const id = abBasename.slice(src.abPrefix.length, -'.ab'.length);
  return id.split('_').map(seg => /^\d+$/.test(seg) ? String(Number(seg)) : seg).join('_');
};
