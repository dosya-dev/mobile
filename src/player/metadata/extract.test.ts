const mockFiles = new Map<string, string>();
const mockRemote: { bytes: Uint8Array; status: number } = { bytes: new Uint8Array(0), status: 206 };
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  FileSystemSessionType: { BACKGROUND: 0, FOREGROUND: 1 },
  downloadAsync: jest.fn(async (_url: string, path: string, o: { headers: { Range: string } }) => {
    const [from, to] = o.headers.Range.replace("bytes=", "").split("-").map(Number);
    const body = mockRemote.status === 206 ? mockRemote.bytes.subarray(from, to + 1) : mockRemote.bytes;
    mockFiles.set(path, Buffer.from(body).toString("base64"));
    return { uri: path, status: mockRemote.status, headers: {} };
  }),
  makeDirectoryAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async (p: string, o?: { position?: number; length?: number }) => {
    if (!mockFiles.has(p)) throw new Error("ENOENT");
    const data = mockFiles.get(p) as string;
    if (o?.length === undefined) return data;
    const start = o.position ?? 0;
    const bytes = Buffer.from(data, "base64");
    // Android's reader throws on a read that starts at or past the end of the file.
    if (start >= bytes.length) throw new Error("read past EOF");
    return bytes.subarray(start, start + o.length).toString("base64");
  }),
  writeAsStringAsync: jest.fn(async (p: string, d: string) => { mockFiles.set(p, d); }),
  deleteAsync: jest.fn(async (p: string) => { mockFiles.delete(p); }),
  getInfoAsync: jest.fn(async (p: string) => (mockFiles.has(p)
    ? { exists: true, size: Buffer.from(mockFiles.get(p) as string, "base64").length }
    : { exists: false })),
}));
jest.mock("./id3", () => ({
  ...jest.requireActual("./id3"),
  parseId3: jest.fn(() => ({ title: "Tagged", artist: "Artist", artwork: { mime: "image/jpeg", data: new Uint8Array([1, 2, 3]) } })),
}));
jest.mock("./mp3Duration", () => ({ parseMp3Duration: jest.fn(() => ({ durationSec: 100, bitrateKbps: 128, sampleRateHz: 44100 })) }));
jest.mock("./mp4", () => ({ ...jest.requireActual("./mp4"), parseMp4: jest.fn(() => ({ title: "M4", durationSec: 50 })) }));

import * as FileSystem from "expo-file-system/legacy";
import { bytesToBase64 } from "./base64";
import { extractMetadata, extractMetadataFromUrl, HEAD_BYTES, MAX_PARSE_BYTES, sniffContainer } from "./extract";
import { parseMp3Duration } from "./mp3Duration";
import { parseMp4 } from "./mp4";
import { PARSER_VERSION, useMetadataStore } from "./metadataStore";
import type { PlayerTrack } from "../types";

/**
 * Extensions are DOT-PREFIXED here because that is what the API actually puts
 * in `files.extension`, and `PlayerTrack.extension` is copied from that row
 * verbatim (queue.ts). Earlier versions of this file passed a bare "mp3",
 * which is why the whole suite stayed green while the extractor's
 * `ext === "mp3"` check matched nothing in production and no file was ever
 * parsed. Keep the dot.
 */
const track = (ext: string): PlayerTrack => ({ fileId: "f1", title: "fallback", artist: "Mix", extension: ext, sizeBytes: 1000, modifiedAt: 5 });

const ID3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00]);
const FTYP_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

const box = (type: string, bodyLength: number): Uint8Array => {
  const size = 8 + bodyLength;
  const b = new Uint8Array(size);
  b.set([(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff], 0);
  for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  return b;
};
const join = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
/** ftyp, then moov straight away: a well-formed file with nothing else in it. */
const MP4_BYTES = join(box("ftyp", 16), box("moov", 8));
/** An ID3 tag declaring 1 MiB, which overflows the first read. */
const largeTagMp3 = (): Uint8Array => {
  const b = new Uint8Array(HEAD_BYTES * 16);
  b.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00], 0);
  return b;
};
const lengthsRead = (): number[] => (FileSystem.readAsStringAsync as jest.Mock).mock.calls.map(([, o]) => o?.length ?? Infinity);

beforeEach(() => { mockFiles.clear(); mockRemote.status = 206; useMetadataStore.getState()._resetForTests(); jest.clearAllMocks(); });

describe("extractMetadata", () => {
  it("mp3: parses tags + duration, writes artwork, upserts the store", async () => {
    mockFiles.set("file:///audio.mp3", bytesToBase64(ID3_BYTES));
    const meta = await extractMetadata(track(".mp3"), "file:///audio.mp3");
    expect(meta).toMatchObject({ fileId: "f1", title: "Tagged", artist: "Artist", durationSec: 100, bitrateKbps: 128 });
    expect(meta.artworkUri).toBe("file:///cache/audio-meta/f1.jpg");
    expect(mockFiles.has("file:///cache/audio-meta/f1.jpg")).toBe(true);
    expect(useMetadataStore.getState().entries["f1"]?.title).toBe("Tagged");
    // Marks that a parse was actually attempted, distinct from a bare
    // ensureEntry()/setDuration() bookkeeping row - see triggers.ts gating.
    expect(meta.parsedAt).toEqual(expect.any(Number));
  });

  it("m4a routes to the mp4 parser", async () => {
    mockFiles.set("file:///a.m4a", bytesToBase64(MP4_BYTES));
    const meta = await extractMetadata(track(".m4a"), "file:///a.m4a");
    expect(meta).toMatchObject({ title: "M4", durationSec: 50 });
  });

  it("unknown extension records a bare entry (fallbacks stay filename-based)", async () => {
    mockFiles.set("file:///a.wav", bytesToBase64(new Uint8Array([1])));
    const meta = await extractMetadata(track(".wav"), "file:///a.wav");
    expect(meta.title).toBeUndefined();
    expect(meta.parsedAt).toEqual(expect.any(Number));
    expect(useMetadataStore.getState().entries["f1"]).toBeDefined();
  });

  it("preserves a duration already captured from playback when the parser finds none", async () => {
    // wav/flac have no parser above (unknown extension), so durationSec can
    // only ever come from TrackPlayer.getProgress() during playback. A fresh
    // parse pass must not clobber that with undefined.
    useMetadataStore.getState().upsert({ fileId: "f1", sizeBytes: 1000, modifiedAt: 5, durationSec: 222, parsedAt: 1 });
    mockFiles.set("file:///a.wav", bytesToBase64(new Uint8Array([1])));
    const meta = await extractMetadata(track(".wav"), "file:///a.wav");
    expect(meta.durationSec).toBe(222);
  });

  // The heat bug: the whole song was base64'd and decoded byte by byte on the
  // JS thread for tags that sit in a sliver of it.
  it("reads only the head of a long mp3, never the audio", async () => {
    mockFiles.set("file:///long.mp3", bytesToBase64(join(ID3_BYTES, new Uint8Array(HEAD_BYTES * 8))));
    await extractMetadata(track(".mp3"), "file:///long.mp3");
    expect(lengthsRead()).toEqual([HEAD_BYTES]);
  });

  it("estimates duration from the file's real size, not the bytes it read", async () => {
    const file = join(ID3_BYTES, new Uint8Array(HEAD_BYTES * 8));
    mockFiles.set("file:///long.mp3", bytesToBase64(file));
    await extractMetadata(track(".mp3"), "file:///long.mp3");
    expect(parseMp3Duration).toHaveBeenCalledWith(expect.any(Uint8Array), file.length);
  });

  it("reads further when the ID3 tag runs past the head, and no further than the tag needs", async () => {
    mockFiles.set("file:///art.mp3", bytesToBase64(largeTagMp3()));
    await extractMetadata(track(".mp3"), "file:///art.mp3");
    const reads = lengthsRead();
    expect(reads).toHaveLength(2);
    expect(reads[1]).toBeGreaterThan(1024 * 1024);
    expect(reads[1]).toBeLessThan(largeTagMp3().length);
  });

  it("a format with no parser costs one head read", async () => {
    mockFiles.set("file:///a.flac", bytesToBase64(new Uint8Array(HEAD_BYTES * 8)));
    const meta = await extractMetadata(track(".flac"), "file:///a.flac");
    expect(lengthsRead()).toEqual([HEAD_BYTES]);
    expect(meta.parsedAt).toEqual(expect.any(Number));
  });

  it("finds a moov that sits after the audio and hands only that box to the parser", async () => {
    const mdat = box("mdat", HEAD_BYTES * 8);
    const moov = box("moov", 32);
    mockFiles.set("file:///tail.m4a", bytesToBase64(join(box("ftyp", 16), mdat, moov)));
    const meta = await extractMetadata(track(".m4a"), "file:///tail.m4a");
    expect(meta.title).toBe("M4");
    expect((parseMp4 as jest.Mock).mock.calls[0][0]).toHaveLength(moov.length);
    expect(Math.max(...lengthsRead())).toBeLessThanOrEqual(HEAD_BYTES);
  });

  it("an mp4 with no moov records a bare entry instead of parsing", async () => {
    mockFiles.set("file:///broken.m4a", bytesToBase64(box("ftyp", 16)));
    const meta = await extractMetadata(track(".m4a"), "file:///broken.m4a");
    expect(parseMp4).not.toHaveBeenCalled();
    expect(meta.parsedAt).toEqual(expect.any(Number));
  });

  it("records a parsed entry for an empty file without reading it", async () => {
    mockFiles.set("file:///empty.mp3", "");
    const meta = await extractMetadata(track(".mp3"), "file:///empty.mp3");
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
    expect(meta.parsedAt).toEqual(expect.any(Number));
  });

  it("skips reading/parsing above the size cap, but still records a parsedAt entry", async () => {
    const huge: PlayerTrack = { ...track(".mp3"), sizeBytes: MAX_PARSE_BYTES + 1 };
    const meta = await extractMetadata(huge, "file:///huge.mp3");
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
    expect(meta.title).toBeUndefined();
    expect(meta.parsedAt).toEqual(expect.any(Number));
    expect(useMetadataStore.getState().entries["f1"]?.parsedAt).toEqual(expect.any(Number));
  });

  it("size-cap skip still preserves an existing playback duration", async () => {
    const huge: PlayerTrack = { ...track(".mp3"), sizeBytes: MAX_PARSE_BYTES + 1 };
    useMetadataStore.getState().upsert({ fileId: "f1", sizeBytes: huge.sizeBytes, modifiedAt: huge.modifiedAt, durationSec: 999, parsedAt: 1 });
    const meta = await extractMetadata(huge, "file:///huge.mp3");
    expect(meta.durationSec).toBe(999);
  });

  it("dedupes concurrent calls for the same fileId to a single file read", async () => {
    mockFiles.set("file:///audio.mp3", bytesToBase64(ID3_BYTES));
    const [a, b] = await Promise.all([
      extractMetadata(track(".mp3"), "file:///audio.mp3"),
      extractMetadata(track(".mp3"), "file:///audio.mp3"),
    ]);
    expect(FileSystem.readAsStringAsync).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("allows a fresh extraction after the in-flight one settles", async () => {
    mockFiles.set("file:///audio.mp3", bytesToBase64(ID3_BYTES));
    await extractMetadata(track(".mp3"), "file:///audio.mp3");
    await extractMetadata(track(".mp3"), "file:///audio.mp3");
    expect(FileSystem.readAsStringAsync).toHaveBeenCalledTimes(2);
  });

  // The original defect: files.extension is ".mp3", the extractor compared it
  // to "mp3", both branches were skipped, and every track came back tagless
  // with the player falling back to its placeholder icon forever.
  it("parses a DOT-PREFIXED extension - the shape the API actually sends", async () => {
    mockFiles.set("file:///audio.mp3", bytesToBase64(ID3_BYTES));
    const meta = await extractMetadata(track(".mp3"), "file:///audio.mp3");
    expect(meta.title).toBe("Tagged");
    expect(meta.artworkUri).toBe("file:///cache/audio-meta/f1.jpg");
  });

  it("uppercase and bare extensions parse too", async () => {
    mockFiles.set("file:///a.mp3", bytesToBase64(ID3_BYTES));
    expect((await extractMetadata(track(".MP3"), "file:///a.mp3")).title).toBe("Tagged");
    useMetadataStore.getState()._resetForTests();
    expect((await extractMetadata(track("mp3"), "file:///a.mp3")).title).toBe("Tagged");
  });

  it("falls back to magic bytes when the extension lies", async () => {
    // A re-uploaded ".bin" is still an mp3. The extension picks no parser, so
    // the sniff has to.
    mockFiles.set("file:///mystery.bin", bytesToBase64(ID3_BYTES));
    const meta = await extractMetadata(track(".bin"), "file:///mystery.bin");
    expect(meta.title).toBe("Tagged");
  });

  it("stamps the current parser version so a later fix can retire the entry", async () => {
    mockFiles.set("file:///audio.mp3", bytesToBase64(ID3_BYTES));
    const meta = await extractMetadata(track(".mp3"), "file:///audio.mp3");
    expect(meta.parserVersion).toBe(PARSER_VERSION);
  });

  it("size-cap skips are versioned too, so they are not re-read every play", async () => {
    const huge: PlayerTrack = { ...track(".mp3"), sizeBytes: MAX_PARSE_BYTES + 1 };
    const meta = await extractMetadata(huge, "file:///huge.mp3");
    expect(meta.parserVersion).toBe(PARSER_VERSION);
  });
});

describe("extractMetadataFromUrl", () => {
  const URL = "https://r2/f1";
  const sized = (ext: string, sizeBytes: number): PlayerTrack => ({ ...track(ext), sizeBytes });
  const rangesAsked = (): string[] => (FileSystem.downloadAsync as jest.Mock).mock.calls.map(([, , o]) => o.headers.Range);

  it("reads a streaming track's tags from its first bytes, not the whole song", async () => {
    mockRemote.bytes = new Uint8Array(HEAD_BYTES * 20);
    mockRemote.bytes.set(ID3_BYTES, 0);
    const meta = await extractMetadataFromUrl(sized(".mp3", mockRemote.bytes.length), URL);
    expect(meta).toMatchObject({ title: "Tagged", durationSec: 100, parserVersion: PARSER_VERSION });
    expect(rangesAsked()).toEqual([`bytes=0-${HEAD_BYTES - 1}`]);
  });

  it("leaves no partial file behind", async () => {
    mockRemote.bytes = new Uint8Array(HEAD_BYTES * 2);
    mockRemote.bytes.set(ID3_BYTES, 0);
    await extractMetadataFromUrl(sized(".mp3", mockRemote.bytes.length), URL);
    expect([...mockFiles.keys()].filter((p) => p.includes(".part"))).toEqual([]);
  });

  it("asks again only for an ID3 tag longer than the first read", async () => {
    mockRemote.bytes = largeTagMp3();
    await extractMetadataFromUrl(sized(".mp3", mockRemote.bytes.length), URL);
    const tagAndFrames = 10 + 0x100000 + 128 * 1024;
    expect(rangesAsked()).toEqual([`bytes=0-${HEAD_BYTES - 1}`, `bytes=0-${tagAndFrames - 1}`]);
  });

  it("finds a moov box at the end of the file with small reads", async () => {
    mockRemote.bytes = join(box("ftyp", 16), box("mdat", HEAD_BYTES * 8), box("moov", 8));
    const size = mockRemote.bytes.length;
    const meta = await extractMetadataFromUrl(sized(".m4a", size), URL);
    expect(meta).toMatchObject({ title: "M4", durationSec: 50 });
    // ftyp comes out of the first read; only mdat's successor needs the network.
    const moovAt = size - 16;
    expect(rangesAsked()).toEqual([`bytes=0-${HEAD_BYTES - 1}`, `bytes=${moovAt}-${size - 1}`, `bytes=${moovAt}-${size - 1}`]);
  });

  it("records nothing when the server answers with the whole file, so the caller can fall back", async () => {
    mockRemote.bytes = new Uint8Array(HEAD_BYTES * 2);
    mockRemote.status = 200;
    await expect(extractMetadataFromUrl(sized(".mp3", mockRemote.bytes.length), URL)).rejects.toThrow();
    expect(useMetadataStore.getState().entries["f1"]).toBeUndefined();
  });

  it("records nothing for an expired link", async () => {
    mockRemote.status = 403;
    await expect(extractMetadataFromUrl(sized(".mp3", HEAD_BYTES * 2), URL)).rejects.toThrow();
    expect(useMetadataStore.getState().entries["f1"]).toBeUndefined();
  });

  it("does not touch the network for a file over the parse cap", async () => {
    const meta = await extractMetadataFromUrl(sized(".mp3", MAX_PARSE_BYTES + 1), URL);
    expect(meta.parserVersion).toBe(PARSER_VERSION);
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
  });
});

describe("sniffContainer", () => {
  it("recognizes ID3 at offset 0", () => {
    expect(sniffContainer(ID3_BYTES)).toBe("id3");
  });

  it("recognizes an ftyp box type at offset 4", () => {
    expect(sniffContainer(FTYP_BYTES)).toBe("mp4");
  });

  it("returns null for anything else, including truncated input", () => {
    expect(sniffContainer(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBeNull();
    expect(sniffContainer(new Uint8Array([0x49, 0x44]))).toBeNull();
    expect(sniffContainer(new Uint8Array([]))).toBeNull();
  });
});
