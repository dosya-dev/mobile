// The native reader as the app shares it (./native-host.ts): unload waits for
// the reads in flight and no read starts while it runs; 60 s with no read and
// a memory warning let the models go.
import type { FaceReaderPort } from "@dosya-dev/personas-engine";
import { createManagedReader } from "./native-host";

function base() {
  const log: string[] = [];
  const pending: (() => void)[] = [];
  let unloadGate: Promise<void> | null = null;
  const reader: FaceReaderPort & { unload(): Promise<void> } = {
    read: async () => {
      log.push("read:start");
      await new Promise<void>((r) => pending.push(r));
      log.push("read:end");
      return [];
    },
    unload: async () => {
      log.push("unload:start");
      if (unloadGate) await unloadGate;
      log.push("unload:end");
    },
  };
  return { reader, log, finishRead: () => pending.shift()?.(), holdUnload: (p: Promise<void>) => { unloadGate = p; } };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

it("unload waits for the reads in flight, and a read asked for meanwhile starts only after it", async () => {
  const b = base();
  const m = createManagedReader(b.reader, { idleMs: 0 });
  const r1 = m.read(new Uint8Array());
  await flush();
  const u = m.unload();
  await flush();
  expect(b.log).toEqual(["read:start"]);
  let release!: () => void;
  b.holdUnload(new Promise<void>((r) => { release = r; }));
  b.finishRead();
  await r1;
  await flush();
  expect(b.log).toEqual(["read:start", "read:end", "unload:start"]);
  const r2 = m.read(new Uint8Array());
  await flush();
  // Never a read while unload() is awaiting.
  expect(b.log).toEqual(["read:start", "read:end", "unload:start"]);
  release();
  await u;
  await flush();
  expect(b.log).toEqual(["read:start", "read:end", "unload:start", "unload:end", "read:start"]);
  b.finishRead();
  await r2;
  m.stop();
});

describe("idle", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("lets the models go after 60 s with no read", async () => {
    const b = base();
    const m = createManagedReader(b.reader);
    const r = m.read(new Uint8Array());
    await jest.advanceTimersByTimeAsync(0);
    b.finishRead();
    await r;
    await jest.advanceTimersByTimeAsync(59_000);
    expect(b.log).not.toContain("unload:start");
    // A read inside the minute starts the minute again.
    const r2 = m.read(new Uint8Array());
    await jest.advanceTimersByTimeAsync(0);
    b.finishRead();
    await r2;
    await jest.advanceTimersByTimeAsync(59_000);
    expect(b.log).not.toContain("unload:start");
    await jest.advanceTimersByTimeAsync(1_000);
    expect(b.log).toContain("unload:end");
    m.stop();
  });
});

it("a memory warning lets the models go", async () => {
  const b = base();
  let warn: () => void = () => {};
  const m = createManagedReader(b.reader, { idleMs: 0, onMemoryWarning: (fn) => { warn = fn; return () => {}; } });
  warn();
  await flush();
  expect(b.log).toEqual(["unload:start", "unload:end"]);
  m.stop();
});

describe("a native read that never answers", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("fails as a read after 60 s, then the reader is unusable while it hangs and unload leaves the sessions alone", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PersonasUnavailableError } = require("./errors") as typeof import("./errors");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeReadTimeoutError } = require("./native-host") as typeof import("./native-host");
    const b = base();
    const m = createManagedReader(b.reader, { idleMs: 0 });
    let err: unknown = null;
    const r = m.read(new Uint8Array()).catch((e) => (err = e));
    await jest.advanceTimersByTimeAsync(59_000);
    expect(err).toBeNull();
    await jest.advanceTimersByTimeAsync(1_000);
    await r;
    expect(err).toBeInstanceOf(NativeReadTimeoutError);
    expect(err).not.toBeInstanceOf(PersonasUnavailableError);
    // The next read never reaches the native side.
    await expect(m.read(new Uint8Array())).rejects.toBeInstanceOf(PersonasUnavailableError);
    expect(b.log).toEqual(["read:start"]);
    // unload no longer waits for the hung call, nor touches its sessions.
    await m.unload();
    expect(b.log).toEqual(["read:start"]);
    m.stop();
  });

  it("is usable again once the slow call finally answers, and idles out as before", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PersonasUnavailableError } = require("./errors") as typeof import("./errors");
    const b = base();
    const m = createManagedReader(b.reader, { idleMs: 60_000 });
    const r = m.read(new Uint8Array()).catch(() => undefined);
    await jest.advanceTimersByTimeAsync(60_000);
    await r;
    await expect(m.read(new Uint8Array())).rejects.toBeInstanceOf(PersonasUnavailableError);
    // The native side answers late: the reader recovers.
    b.finishRead();
    await jest.advanceTimersByTimeAsync(0);
    const next = m.read(new Uint8Array());
    await jest.advanceTimersByTimeAsync(0);
    b.finishRead();
    await expect(next).resolves.toEqual([]);
    expect(b.log).toEqual(["read:start", "read:end", "read:start", "read:end"]);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(b.log).toContain("unload:end");
    m.stop();
  });
});
