import { devicePolicy, effectiveBackgroundMode, resetDevicePolicyCache, type DevicePolicy } from "./policy";
import type { ReadMode } from "./settings";

jest.mock("@/api/config", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok", refreshSession: async () => "rejected" }));
jest.mock("@/lib/keychain", () => ({ getItem: async () => null, setItem: async () => {} }));

const DEFAULTS: DevicePolicy = { background: "on", maxPhotosPerWindow: 2000 };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const bad = (status: number) => ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

function setup(responses: (Response | Error)[], stored: string | null = null) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const queue = [...responses];
  const store = new Map<string, string>();
  if (stored) store.set("dosya.personas.device-policy", stored);
  let now = 1_000_000;
  const deps = {
    base: "https://api.test",
    token: () => "tok",
    refresh: async () => "rejected" as const,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      const r = queue.shift() ?? bad(500);
      if (r instanceof Error) throw r;
      return r;
    }) as unknown as typeof fetch,
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { store.set(k, v); },
    now: () => now,
  };
  return { deps, calls, store, advance: (ms: number) => { now += ms; } };
}

beforeEach(() => resetDevicePolicyCache());

describe("devicePolicy", () => {
  it("caches for an hour", async () => {
    const t = setup([ok({ background: "charging", maxPhotosPerWindow: 300 }), ok({ background: "off", maxPhotosPerWindow: 300 })]);
    expect(await devicePolicy(t.deps)).toEqual({ background: "charging", maxPhotosPerWindow: 300 });
    t.advance(59 * 60_000);
    expect((await devicePolicy(t.deps)).background).toBe("charging");
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toEqual({ url: "https://api.test/api/personas/device-policy", headers: { Authorization: "Bearer tok" } });
    t.advance(2 * 60_000);
    expect((await devicePolicy(t.deps)).background).toBe("off");
    expect(t.calls).toHaveLength(2);
    expect(JSON.parse(t.store.get("dosya.personas.device-policy")!).background).toBe("off");
  });

  it("server error keeps last good", async () => {
    const t = setup([ok({ background: "off", maxPhotosPerWindow: 100 }), bad(503), new Error("offline")]);
    await devicePolicy(t.deps);
    t.advance(61 * 60_000);
    expect(await devicePolicy(t.deps)).toEqual({ background: "off", maxPhotosPerWindow: 100 });
    t.advance(10 * 60_000);
    expect(await devicePolicy(t.deps)).toEqual({ background: "off", maxPhotosPerWindow: 100 });
  });

  it("keeps the keychain copy when the memory is empty and the server fails", async () => {
    const t = setup([bad(500)], JSON.stringify({ background: "charging", maxPhotosPerWindow: 700 }));
    expect(await devicePolicy(t.deps)).toEqual({ background: "charging", maxPhotosPerWindow: 700 });
  });

  it("first failure gives defaults", async () => {
    expect(await devicePolicy(setup([bad(500)]).deps)).toEqual(DEFAULTS);
    resetDevicePolicyCache();
    expect(await devicePolicy(setup([new Error("offline")]).deps)).toEqual(DEFAULTS);
    resetDevicePolicyCache();
    expect(await devicePolicy(setup([ok({ background: "bogus" })]).deps)).toEqual(DEFAULTS);
  });
});

describe("effectiveBackgroundMode table", () => {
  const p = (background: DevicePolicy["background"]): DevicePolicy => ({ background, maxPhotosPerWindow: 2000 });
  const table: [ReadMode, DevicePolicy["background"], ReadMode | "none"][] = [
    ["open", "on", "open"], ["charging", "on", "charging"], ["anytime", "on", "anytime"],
    ["open", "charging", "open"], ["charging", "charging", "charging"], ["anytime", "charging", "charging"],
    ["open", "off", "none"], ["charging", "off", "none"], ["anytime", "off", "none"],
  ];
  it.each(table)("%s + %s = %s", (mode, bg, want) => {
    expect(effectiveBackgroundMode(mode, p(bg))).toBe(want);
  });
});

describe("devicePolicy time limit", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("a request that never answers gives the last good answer (or the default) after 15 s", async () => {
    const t = setup([]);
    let signal: AbortSignal | undefined;
    t.deps.fetch = ((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;
    let got: DevicePolicy | null = null;
    void devicePolicy(t.deps).then((p) => (got = p));
    await jest.advanceTimersByTimeAsync(14_000);
    expect(got).toBeNull();
    await jest.advanceTimersByTimeAsync(1_500);
    expect(got).toEqual(DEFAULTS);
    expect(signal?.aborted).toBe(true);
  });
});
