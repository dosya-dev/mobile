import { create } from "zustand";
import * as FileSystem from "expo-file-system/legacy";
import type { PlayerTrack } from "../types";

export interface TrackMetadata {
  fileId: string;
  title?: string;
  artist?: string;
  album?: string;
  durationSec?: number;
  bitrateKbps?: number;
  sampleRateHz?: number;
  artworkUri?: string;
  sizeBytes: number;
  modifiedAt: number;
  /**
   * Set ONLY by extractMetadata (never by ensureEntry/setDuration): marks
   * that a parse was actually attempted for this track version, as opposed
   * to a bare bookkeeping entry (e.g. the duration-capture block ensuring a
   * row exists before writing durationSec). Triggers gate on this, not on
   * entry existence, so a bare entry created while a track streams-then-caches
   * doesn't permanently block real extraction.
   */
  parsedAt?: number;
  /**
   * Which extractor produced this entry. Bumped whenever a parser fix changes
   * what a re-parse of the SAME bytes would yield, which `parsedAt` alone
   * cannot express: entries written before v2 carry a parsedAt stamp from a
   * parse that silently did nothing at all (the extension check never matched
   * the API's dot-prefixed extensions), and the triggers gate on parsedAt, so
   * without a version those tracks would keep their empty tags forever.
   * Missing means v1 - the pre-fix extractor, which predates this field.
   */
  parserVersion?: number;
}

/**
 * v1 - original; selected a parser by comparing against a dot-prefixed
 *      extension, so it never parsed anything.
 * v2 - normalizes the extension and sniffs container magic bytes.
 */
export const PARSER_VERSION = 2;

/** True when this entry predates the current extractor and is worth re-parsing. */
export function isStaleParse(meta: TrackMetadata | null): boolean {
  if (!meta?.parsedAt) return true;
  return (meta.parserVersion ?? 1) < PARSER_VERSION;
}

export const META_DIR = `${FileSystem.cacheDirectory}audio-meta/`;
const INDEX = `${META_DIR}index.json`;

interface MetadataState {
  entries: Record<string, TrackMetadata>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  upsert: (meta: TrackMetadata) => void;
  setDuration: (fileId: string, durationSec: number) => void;
  /** Upsert a bare {fileId, sizeBytes, modifiedAt} entry when none exists for this track version. */
  ensureEntry: (t: PlayerTrack) => void;
  _resetForTests: () => void;
}

async function persist(entries: Record<string, TrackMetadata>): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(META_DIR, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(Object.values(entries)));
  } catch {
    // best-effort, same stand-down posture as the audio cache
  }
}

export const useMetadataStore = create<MetadataState>((set, get) => ({
  entries: {},
  hydrated: false,
  hydrate: async () => {
    try {
      const parsed = JSON.parse(await FileSystem.readAsStringAsync(INDEX));
      const entries: Record<string, TrackMetadata> = {};
      if (Array.isArray(parsed)) for (const e of parsed) if (e?.fileId) entries[e.fileId] = e;
      set({ entries, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
  upsert: (meta) => {
    const entries = { ...get().entries, [meta.fileId]: meta };
    set({ entries });
    void persist(entries);
  },
  setDuration: (fileId, durationSec) => {
    const cur = get().entries[fileId];
    if (!cur || cur.durationSec !== undefined) return;
    const entries = { ...get().entries, [fileId]: { ...cur, durationSec } };
    set({ entries });
    void persist(entries);
  },
  ensureEntry: (t) => {
    const cur = get().entries[t.fileId];
    if (cur && cur.sizeBytes === t.sizeBytes && cur.modifiedAt === t.modifiedAt) return;
    const entries = { ...get().entries, [t.fileId]: { fileId: t.fileId, sizeBytes: t.sizeBytes, modifiedAt: t.modifiedAt } };
    set({ entries });
    void persist(entries);
  },
  _resetForTests: () => set({ entries: {}, hydrated: false }),
}));

/** Entry only when it matches the track's current size+modified (re-upload invalidation). */
export function getForTrack(t: PlayerTrack): TrackMetadata | null {
  const e = useMetadataStore.getState().entries[t.fileId];
  if (!e || e.sizeBytes !== t.sizeBytes || e.modifiedAt !== t.modifiedAt) return null;
  return e;
}
