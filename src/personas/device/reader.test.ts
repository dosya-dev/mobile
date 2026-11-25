// The phone's FaceReaderPort: photos go to the hidden WebView's reader page
// as base64, faces come back as plain numbers (src/personas/device/reader.ts).
import { ReaderUnsupportedError } from "@dosya-dev/personas-engine";
import { PersonasUnavailableError } from "./errors";
import { createWebViewReader, ReaderUnavailableError } from "./reader";

const SIG = Array.from({ length: 128 }, (_, i) => (i - 64) / 128);

function setup(opts: Parameters<typeof createWebViewReader>[1] = {}) {
  const sent: { id: number; photoBase64: string }[] = [];
  const onStuck = jest.fn();
  const reader = createWebViewReader((m) => sent.push(JSON.parse(m)), { onStuck, ...opts });
  const answer = (o: unknown) => reader.onMessage(JSON.stringify(o));
  return { sent, reader, answer, onStuck };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

afterEach(() => { jest.useRealTimers(); });

describe("createWebViewReader", () => {
  it("posts the photo as base64 and resolves its faces with Float32 signatures", async () => {
    const { sent, reader, answer } = setup();
    const p = reader.read(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    await flush();
    expect(sent).toEqual([{ id: 1, photoBase64: "/9j/4A==" }]);
    answer({ id: 1, faces: [{ box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, sig: SIG, score: 0.93 }] });
    const faces = await p;
    expect(faces).toHaveLength(1);
    expect(faces[0].box).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(faces[0].score).toBe(0.93);
    expect(faces[0].sig).toBeInstanceOf(Float32Array);
    expect(Array.from(faces[0].sig)).toEqual(Array.from(Float32Array.from(SIG)));
  });

  it("reads one photo at a time", async () => {
    const { sent, reader, answer } = setup();
    const a = reader.read(new Uint8Array([1]));
    const b = reader.read(new Uint8Array([2]));
    await flush();
    expect(sent.map((m) => m.id)).toEqual([1]);
    answer({ id: 1, faces: [] });
    await a;
    await flush();
    expect(sent.map((m) => m.id)).toEqual([1, 2]);
    answer({ id: 2, faces: [] });
    await expect(b).resolves.toEqual([]);
  });

  it("maps the page's errors: unsupported is the photo's, failed is a plain error, unavailable is never the photo's", async () => {
    const { reader, answer } = setup();
    const a = reader.read(new Uint8Array([1]));
    await flush();
    answer({ id: 1, error: "unsupported" });
    await expect(a).rejects.toBeInstanceOf(ReaderUnsupportedError);

    const b = reader.read(new Uint8Array([1]));
    await flush();
    answer({ id: 2, error: "failed" });
    const failed = await b.catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(Error);
    expect(failed).not.toBeInstanceOf(PersonasUnavailableError);
    expect(failed).not.toBeInstanceOf(ReaderUnsupportedError);

    const c = reader.read(new Uint8Array([1]));
    await flush();
    answer({ id: 3, error: "unavailable" });
    const unavailable = await c.catch((e: unknown) => e);
    expect(unavailable).toBeInstanceOf(ReaderUnavailableError);
    expect(unavailable).toBeInstanceOf(PersonasUnavailableError);
  });

  it("ignores the ready line, junk and answers for other ids; a malformed answer fails the read", async () => {
    const { reader, answer } = setup();
    const p = reader.read(new Uint8Array([1]));
    await flush();
    reader.onMessage("not json");
    answer({ type: "ready" });
    answer({ id: 99, faces: [] });
    let settled = false;
    void p.then(() => { settled = true; }, () => { settled = true; });
    await flush();
    expect(settled).toBe(false);
    answer({ id: 1, faces: [{ box: { x: 0, y: 0, w: 1, h: 1 }, sig: [1, 2], score: 1 }] });
    const e = await p.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(PersonasUnavailableError);
  });

  it("the first read may take 120 s (the reader loads); then it is unavailable and the WebView is remounted", async () => {
    jest.useFakeTimers();
    const { reader, onStuck } = setup();
    const p = reader.read(new Uint8Array([1]));
    const e = p.catch((x: unknown) => x);
    await jest.advanceTimersByTimeAsync(119_000);
    expect(onStuck).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(await e).toBeInstanceOf(ReaderUnavailableError);
    expect(onStuck).toHaveBeenCalledTimes(1);
  });

  it("once loaded, a read may take 60 s; then it fails for the photo and the WebView is remounted", async () => {
    jest.useFakeTimers();
    const { reader, answer, onStuck } = setup();
    const first = reader.read(new Uint8Array([1]));
    await jest.advanceTimersByTimeAsync(0);
    answer({ id: 1, faces: [] });
    await first;
    const p = reader.read(new Uint8Array([1]));
    const e = p.catch((x: unknown) => x);
    await jest.advanceTimersByTimeAsync(59_000);
    expect(onStuck).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2_000);
    const err = await e;
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PersonasUnavailableError);
    expect(onStuck).toHaveBeenCalledTimes(1);
    // A remounted WebView loads the reader again: the next read gets the long timeout.
    const q = reader.read(new Uint8Array([1])).catch((x: unknown) => x);
    await jest.advanceTimersByTimeAsync(61_000);
    expect(onStuck).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(await q).toBeInstanceOf(ReaderUnavailableError);
  });

  it("an unavailable answer does not count as loaded", async () => {
    jest.useFakeTimers();
    const { reader, answer } = setup();
    const a = reader.read(new Uint8Array([1])).catch(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    answer({ id: 1, error: "unavailable" });
    await a;
    const b = reader.read(new Uint8Array([1])).catch((x: unknown) => x);
    await jest.advanceTimersByTimeAsync(61_000);
    let done = false;
    void b.then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(await b).toBeInstanceOf(ReaderUnavailableError);
  });

  it("the WebView going away fails the read in flight: unavailable before the reader loaded, the photo's after", async () => {
    const { reader, answer } = setup();
    const a = reader.read(new Uint8Array([1]));
    await flush();
    reader.reset();
    expect(await a.catch((x: unknown) => x)).toBeInstanceOf(ReaderUnavailableError);

    const b = reader.read(new Uint8Array([1]));
    await flush();
    answer({ id: 2, faces: [] });
    await b;
    const c = reader.read(new Uint8Array([1]));
    await flush();
    reader.reset();
    const err = await c.catch((x: unknown) => x);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PersonasUnavailableError);
  });

  it("dispose() fails the read in flight as unavailable and a posting failure is unavailable too", async () => {
    const { reader } = setup();
    const a = reader.read(new Uint8Array([1]));
    await flush();
    reader.dispose();
    expect(await a.catch((x: unknown) => x)).toBeInstanceOf(ReaderUnavailableError);

    const broken = createWebViewReader(() => { throw new Error("no WebView"); });
    expect(await broken.read(new Uint8Array([1])).catch((x: unknown) => x)).toBeInstanceOf(ReaderUnavailableError);
  });
});

describe("reads queued behind a failure", () => {
  it("reads queued behind one the page could not load for fail at once, and later reads try again", async () => {
    const { sent, reader, answer } = setup();
    const a = reader.read(new Uint8Array([1]));
    const b = reader.read(new Uint8Array([2]));
    await flush();
    answer({ id: 1, error: "unavailable" });
    expect(await a.catch((x: unknown) => x)).toBeInstanceOf(ReaderUnavailableError);
    expect(await b.catch((x: unknown) => x)).toBeInstanceOf(ReaderUnavailableError);
    expect(sent.map((m) => m.id)).toEqual([1]);
    const c = reader.read(new Uint8Array([3]));
    await flush();
    answer({ id: sent[sent.length - 1].id, faces: [] });
    await expect(c).resolves.toEqual([]);
  });

  it("dispose() fails the reads still queued without posting them", async () => {
    const { sent, reader } = setup();
    const a = reader.read(new Uint8Array([1]));
    const b = reader.read(new Uint8Array([2]));
    await flush();
    reader.dispose();
    await a.catch(() => undefined);
    expect(await b.catch((x: unknown) => x)).toBeInstanceOf(ReaderUnavailableError);
    expect(sent).toHaveLength(1);
  });
});

describe("whether this phone can read", () => {
  it("is unknown until the page says, then follows its ready line and tells its listener", () => {
    const { reader } = setup();
    const fn = jest.fn();
    reader.onSupported(fn);
    expect(reader.supported()).toBeNull();
    reader.onMessage(JSON.stringify({ type: "ready", supported: true }));
    expect(reader.supported()).toBe(true);
    reader.onMessage(JSON.stringify({ type: "ready", supported: false }));
    expect(reader.supported()).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
    reader.onMessage(JSON.stringify({ type: "ready", supported: false }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a WebView that cannot read fails every read at once as unavailable, posting nothing", async () => {
    const { reader, sent } = setup();
    reader.onMessage(JSON.stringify({ type: "ready", supported: false }));
    expect(await reader.read(new Uint8Array([1])).catch((e: unknown) => e)).toBeInstanceOf(ReaderUnavailableError);
    expect(sent).toEqual([]);
  });
});

it("a page let go idle (unloaded) fails nothing, and the next page gets the first-load timeout", async () => {
  jest.useFakeTimers();
  const { reader, answer, onStuck } = setup();
  const first = reader.read(new Uint8Array([1]));
  await jest.advanceTimersByTimeAsync(0);
  answer({ id: 1, faces: [] });
  await first;
  reader.unloaded();
  const p = reader.read(new Uint8Array([1])).catch((x: unknown) => x);
  await jest.advanceTimersByTimeAsync(61_000);
  expect(onStuck).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(await p).toBeInstanceOf(ReaderUnavailableError);
});
