import * as FileSystem from "expo-file-system/legacy";
import { base64ToBytes, bytesToBase64 } from "./base64";
import { id3TagSize, parseId3 } from "./id3";
import { parseMp3Duration } from "./mp3Duration";
import { locateMoov, parseMp4 } from "./mp4";
import { getForTrack, META_DIR, PARSER_VERSION, useMetadataStore, type TrackMetadata } from "./metadataStore";
import { normalizeExt } from "@/files/format";
import type { PlayerTrack } from "../types";

const MP4_EXTS = new Set(["m4a", "m4b", "mp4", "aac", "alac"]);

type Container = "id3" | "mp4" | null;

/**
 * Identify the container from its bytes. The extension is the first signal but
 * cannot be the only one: it is user-controlled (a re-uploaded ".bin", a
 * missing extension) and, for the whole life of this module before the fix,
 * was silently the WRONG shape - the API stores extensions dot-prefixed, so
 * `ext === "mp3"` never once matched and no file ever got parsed. Sniffing
 * gives the parser selection a source of truth that a bad extension cannot
 * suppress.
 *
 * ID3v2 tags start with the literal "ID3" at offset 0. MP4/M4A carry a "ftyp"
 * box type at offset 4 (offset 0..3 is that box's length).
 */
export function sniffContainer(bytes: Uint8Array): Container {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "id3";
  if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "mp4";
  return null;
}

/** Extension first, bytes as the backstop. Neither alone is trustworthy - see sniffContainer. */
function pickContainer(extension: string | null, bytes: Uint8Array): Container {
  const ext = normalizeExt(extension);
  if (ext === "mp3") return "id3";
  if (MP4_EXTS.has(ext)) return "mp4";
  return sniffContainer(bytes);
}

/**
 * Tags sit in a sliver of an audio file, so that sliver is all that is read:
 * decoding happens byte by byte on the JS thread, and doing it for whole songs
 * heated phones during playback.
 *
 * The first read covers sniffing, a typical ID3 tag and the first MPEG frame.
 */
export const HEAD_BYTES = 256 * 1024;
/** parseMp3Duration's frame search past the end of the tag, plus the Xing header. */
const FRAME_SCAN_BYTES = 128 * 1024;
/**
 * Files larger than this are audiobooks and the like, and are never parsed: a
 * first-frame bitrate estimate is too rough to replace the duration playback
 * reports for them, so they keep a parsed-but-tagless entry and the playback
 * duration fallback in onPlaybackStarted fills the queue row.
 */
export const MAX_PARSE_BYTES = 50 * 1024 * 1024;

interface ByteSource {
  size: number;
  read: (position: number, length: number) => Promise<Uint8Array>;
}

/** Clamped to the file: Android's reader throws on a read that starts at the end of it. */
async function readRange(fileUri: string, position: number, length: number, fileSize: number): Promise<Uint8Array> {
  const clamped = Math.min(length, fileSize - position);
  if (clamped <= 0) return new Uint8Array(0);
  return base64ToBytes(await FileSystem.readAsStringAsync(fileUri, { encoding: "base64", position, length: clamped }));
}

async function localSource(fileUri: string): Promise<ByteSource> {
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists) throw new Error("cached audio file is gone");
  return { size: info.size, read: (position, length) => readRange(fileUri, position, length, info.size) };
}

/**
 * The bytes of a track that is streaming, a slice at a time. Anything but a 206
 * throws: a server that ignored the Range header has just sent the whole song,
 * and its bytes would not be the ones asked for.
 */
function remoteSource(t: PlayerTrack, url: string): ByteSource {
  const part = `${FileSystem.cacheDirectory}audio-tags-${t.fileId}.part`;
  return {
    size: t.sizeBytes,
    read: async (position, length) => {
      const clamped = Math.min(length, t.sizeBytes - position);
      if (clamped <= 0) return new Uint8Array(0);
      try {
        const res = await FileSystem.downloadAsync(url, part, {
          headers: { Range: `bytes=${position}-${position + clamped - 1}` },
          sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        });
        if (res.status !== 206) throw new Error(`range read answered ${res.status}`);
        return base64ToBytes(await FileSystem.readAsStringAsync(part, { encoding: "base64" }));
      } finally {
        await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {});
      }
    },
  };
}

/** One extraction per fileId at a time: the cache hook and onPlaybackStarted can both fire for the same file. */
const inFlight = new Map<string, Promise<TrackMetadata>>();

/**
 * Extract tags/artwork/duration from a LOCAL cached file and record the result.
 * Parser failures yield a bare (but parsedAt-stamped) entry so we do not
 * re-parse a hopeless file every play. Concurrent calls for the same fileId
 * share one read/parse.
 */
export function extractMetadata(t: PlayerTrack, fileUri: string): Promise<TrackMetadata> {
  return shared(t, () => localSource(fileUri));
}

/**
 * The same for a track that is streaming, fetching only the slices that hold
 * its tags so the song is not downloaded alongside the stream. A failed read
 * rejects and records nothing, so the track is tried again next time.
 */
export function extractMetadataFromUrl(t: PlayerTrack, url: string): Promise<TrackMetadata> {
  return shared(t, async () => remoteSource(t, url));
}

function shared(t: PlayerTrack, open: () => Promise<ByteSource>): Promise<TrackMetadata> {
  const existing = inFlight.get(t.fileId);
  if (existing) return existing;
  const promise = doExtract(t, open).finally(() => inFlight.delete(t.fileId));
  inFlight.set(t.fileId, promise);
  return promise;
}

async function doExtract(t: PlayerTrack, open: () => Promise<ByteSource>): Promise<TrackMetadata> {
  // Preserve a duration already captured from playback (the only source of
  // truth for formats with no parser, e.g. wav/flac) across this parse pass.
  const priorDurationSec = getForTrack(t)?.durationSec;

  if (t.sizeBytes > MAX_PARSE_BYTES) {
    const meta: TrackMetadata = {
      fileId: t.fileId, sizeBytes: t.sizeBytes, modifiedAt: t.modifiedAt,
      parsedAt: Date.now(), parserVersion: PARSER_VERSION,
      ...(priorDurationSec !== undefined ? { durationSec: priorDurationSec } : {}),
    };
    useMetadataStore.getState().upsert(meta);
    return meta;
  }

  const source = await open();
  const fileSize = source.size;
  const head = await source.read(0, HEAD_BYTES);
  // Box headers near the start are already in hand; for a stream each miss is a request.
  const read = async (position: number, length: number) =>
    position + length <= head.length ? head.subarray(position, position + length) : source.read(position, length);
  const meta: TrackMetadata = {
    fileId: t.fileId, sizeBytes: t.sizeBytes, modifiedAt: t.modifiedAt,
    parsedAt: Date.now(), parserVersion: PARSER_VERSION,
  };
  let artwork: { mime: string; data: Uint8Array } | undefined;
  const container = pickContainer(t.extension, head);
  if (container === "id3") {
    const wanted = id3TagSize(head) + FRAME_SCAN_BYTES;
    const bytes = wanted > head.length && head.length < fileSize ? await read(0, wanted) : head;
    const tags = parseId3(bytes);
    const mp3 = parseMp3Duration(bytes, fileSize);
    Object.assign(meta, {
      title: tags.title, artist: tags.artist, album: tags.album,
      durationSec: mp3.durationSec, bitrateKbps: mp3.bitrateKbps, sampleRateHz: mp3.sampleRateHz,
    });
    artwork = tags.artwork;
  } else if (container === "mp4") {
    const moov = await locateMoov(read, fileSize);
    if (moov) {
      const r = parseMp4(await read(moov.offset, moov.size));
      Object.assign(meta, { title: r.title, artist: r.artist, album: r.album, durationSec: r.durationSec });
      artwork = r.artwork;
    }
  }
  if (meta.durationSec === undefined && priorDurationSec !== undefined) meta.durationSec = priorDurationSec;
  if (artwork) {
    try {
      const path = `${META_DIR}${t.fileId}.${artwork.mime === "image/png" ? "png" : "jpg"}`;
      await FileSystem.makeDirectoryAsync(META_DIR, { intermediates: true }).catch(() => {});
      await FileSystem.writeAsStringAsync(path, bytesToBase64(artwork.data), { encoding: "base64" });
      meta.artworkUri = path;
    } catch {
      // keep text tags without artwork
    }
  }
  useMetadataStore.getState().upsert(meta);
  return meta;
}
