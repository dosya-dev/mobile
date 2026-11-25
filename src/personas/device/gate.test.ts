// When the phone may read photos: the app in the foreground and, unless the
// user allowed mobile data and battery, on Wi-Fi and charging.
import { createReadGate, gateDecision, type GateInput, type GateSignals, type HeldReason } from "./gate";
import type { ReadMode, ReadSettings } from "./settings";

type Thermal = "nominal" | "fair" | "serious" | "critical";
type Net = { connected: boolean; onWifi: boolean };

function signals(init: { active?: boolean; connected?: boolean; onWifi?: boolean; charging?: boolean; battery?: number | null; lowPower?: boolean; thermal?: Thermal; music?: boolean } = {}) {
  const s = { active: true, connected: true, onWifi: true, charging: true, battery: 0.8 as number | null, lowPower: false, thermal: "nominal" as Thermal, music: false, ...init };
  const fns = {
    app: new Set<(a: boolean) => void>(),
    net: new Set<(n: Net) => void>(),
    power: new Set<(c: boolean) => void>(),
    level: new Set<(l: number | null) => void>(),
    low: new Set<(l: boolean) => void>(),
    music: new Set<(p: boolean) => void>(),
  };
  const polls = new Set<() => void>();
  const sig: GateSignals = {
    appActive: () => s.active,
    onAppActive: (fn) => { fns.app.add(fn); return () => fns.app.delete(fn); },
    network: async () => ({ connected: s.connected, onWifi: s.onWifi }),
    onNetwork: (fn) => { fns.net.add(fn); return () => fns.net.delete(fn); },
    charging: async () => s.charging,
    onCharging: (fn) => { fns.power.add(fn); return () => fns.power.delete(fn); },
    batteryLevel: async () => s.battery,
    onBatteryLevel: (fn) => { fns.level.add(fn); return () => fns.level.delete(fn); },
    lowPower: async () => s.lowPower,
    onLowPower: (fn) => { fns.low.add(fn); return () => fns.low.delete(fn); },
    thermal: () => s.thermal,
    musicPlaying: () => s.music,
    onMusicPlaying: (fn) => { fns.music.add(fn); return () => fns.music.delete(fn); },
    poll: (fn) => { polls.add(fn); return () => polls.delete(fn); },
  };
  return {
    sig,
    fns,
    polls,
    app(active: boolean) { s.active = active; for (const f of fns.app) f(active); },
    net(n: Net) { for (const f of fns.net) f(n); },
    power(c: boolean) { for (const f of fns.power) f(c); },
    level(l: number | null) { for (const f of fns.level) f(l); },
    low(l: boolean) { for (const f of fns.low) f(l); },
    thermal(t: Thermal) { s.thermal = t; },
    music(p: boolean) { s.music = p; for (const f of fns.music) f(p); },
    tick() { for (const f of [...polls]) f(); },
  };
}

function settings(init: Partial<ReadSettings> = {}) {
  const fns = new Set<() => void>();
  let value: ReadSettings = { mode: "charging", mobileData: false, ...init };
  return {
    get: () => value,
    subscribe(fn: () => void) { fns.add(fn); return () => { fns.delete(fn); }; },
    set(next: Partial<ReadSettings>) { value = { ...value, ...next }; for (const f of fns) f(); },
  };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

it("stays hidden until the network and the charger are known, then opens on Wi-Fi while charging in the foreground", async () => {
  const s = signals();
  const gate = createReadGate(s.sig, settings());
  expect(gate.hidden).toBe(true);
  const changed = jest.fn();
  gate.addEventListener("visibilitychange", changed);
  await flush();
  expect(gate.hidden).toBe(false);
  expect(changed).toHaveBeenCalledTimes(1);
  gate.stop();
});

it("closes in the background, off Wi-Fi, offline or off the charger, and opens again when that changes", async () => {
  const s = signals();
  const gate = createReadGate(s.sig, settings());
  await flush();
  const changed = jest.fn();
  gate.addEventListener("visibilitychange", changed);
  s.app(false);
  expect(gate.hidden).toBe(true);
  s.app(true);
  expect(gate.hidden).toBe(false);
  s.net({ connected: true, onWifi: false });
  expect(gate.hidden).toBe(true);
  s.net({ connected: true, onWifi: true });
  s.power(false);
  expect(gate.hidden).toBe(true);
  s.power(true);
  expect(gate.hidden).toBe(false);
  expect(changed).toHaveBeenCalledTimes(6);
  // Nothing changes, nothing is said.
  s.power(true);
  expect(changed).toHaveBeenCalledTimes(6);
  gate.removeEventListener("visibilitychange", changed);
  s.app(false);
  expect(changed).toHaveBeenCalledTimes(6);
  gate.stop();
});

it("\"Read on mobile data or battery\" lifts the Wi-Fi and charger conditions, not the foreground or a connection", async () => {
  const s = signals({ onWifi: false, charging: false });
  const any = settings();
  const gate = createReadGate(s.sig, any);
  await flush();
  expect(gate.hidden).toBe(true);
  any.set({ mode: "anytime", mobileData: true });
  expect(gate.hidden).toBe(false);
  s.app(false);
  expect(gate.hidden).toBe(true);
  s.app(true);
  s.net({ connected: false, onWifi: false });
  expect(gate.hidden).toBe(true);
  gate.stop();
});

it("stop() lets go of every signal", async () => {
  const s = signals();
  const any = settings();
  const gate = createReadGate(s.sig, any);
  gate.stop();
  expect(s.fns.app.size + s.fns.net.size + s.fns.power.size).toBe(0);
});

it("a signal it cannot read keeps it closed (unless allowed anywhere)", async () => {
  const s = signals();
  s.sig.network = async () => { throw new Error("no module"); };
  const any = settings();
  const gate = createReadGate(s.sig, any);
  await flush();
  expect(gate.hidden).toBe(true);
  any.set({ mode: "anytime", mobileData: true });
  expect(gate.hidden).toBe(false);
  gate.stop();
});

it("held: connected but waiting for Wi-Fi or a charger (not when allowed anywhere), told to subscribers", async () => {
  const s = signals({ charging: false });
  const any = settings();
  const gate = createReadGate(s.sig, any);
  const fn = jest.fn();
  gate.subscribe(fn);
  await flush();
  expect(gate.held).toBe(true);
  s.power(true);
  expect(gate.held).toBe(false);
  s.net({ connected: true, onWifi: false });
  expect(gate.held).toBe(true);
  any.set({ mode: "anytime", mobileData: true });
  expect(gate.held).toBe(false);
  s.net({ connected: false, onWifi: false });
  expect(gate.held).toBe(false);
  expect(fn.mock.calls.length).toBeGreaterThanOrEqual(4);
  gate.stop();
});

it("polls the thermal state while running and stops polling at stop()", async () => {
  const s = signals();
  const gate = createReadGate(s.sig, settings());
  await flush();
  expect(gate.hidden).toBe(false);
  s.thermal("serious");
  expect(gate.hidden).toBe(false);
  s.tick();
  expect(gate.hidden).toBe(true);
  expect(gate.heldReason).toBe("thermal");
  expect(gate.allows("background")).toBe(false);
  s.thermal("nominal");
  s.tick();
  expect(gate.hidden).toBe(false);
  gate.stop();
  expect(s.polls.size).toBe(0);
  expect(s.fns.level.size + s.fns.low.size).toBe(0);
});

it("battery level and Low Power Mode changes reach the gate in Any time mode", async () => {
  const s = signals({ charging: false, battery: 0.5 });
  const st = settings({ mode: "anytime" });
  const gate = createReadGate(s.sig, st);
  await flush();
  expect(gate.heldReason).toBeNull();
  expect(gate.allows("background")).toBe(true);
  s.level(0.1);
  expect(gate.heldReason).toBe("battery");
  s.level(0.5);
  s.low(true);
  expect(gate.heldReason).toBe("lowPower");
  s.low(false);
  expect(gate.held).toBe(false);
  gate.stop();
});

it("a settings change reopens the gate and tells subscribers", async () => {
  const s = signals({ charging: false });
  const st = settings();
  const gate = createReadGate(s.sig, st);
  const fn = jest.fn();
  gate.subscribe(fn);
  await flush();
  expect(gate.heldReason).toBe("charger");
  st.set({ mode: "anytime" });
  expect(gate.heldReason).toBeNull();
  expect(fn).toHaveBeenCalled();
  gate.stop();
});

// ---- gateDecision ----
// The oracle is written from the rules list alone, not from gate.ts.
function oracle(i: GateInput, where: "foreground" | "background"): { open: boolean; held: HeldReason | null } {
  const closed = { open: false, held: null };
  if (i.connected !== true) return closed;
  const mode = i.settings.mode;
  if (where === "background" && mode === "open") return closed;
  if (where === "foreground" && !i.active) return closed;
  const hold = (held: HeldReason) => ({ open: false, held });
  if (!i.onWifi && !i.settings.mobileData) return hold("wifi");
  if (i.thermal === "serious" || i.thermal === "critical") return hold("thermal");
  if (mode === "anytime") {
    if (i.lowPower) return hold("lowPower");
    const charging = i.charging === true;
    if (!charging && (i.battery === null || i.battery < 0.2)) return hold("battery");
    return { open: true, held: null };
  }
  // open (foreground) and charging both need a charger
  return i.charging === true ? { open: true, held: null } : hold("charger");
}

const base: GateInput = { active: true, connected: true, onWifi: true, charging: true, battery: 0.8, lowPower: false, thermal: "nominal", musicPlaying: false, settings: { mode: "charging", mobileData: false } };

describe("gateDecision", () => {
  it("music stops background reading only, and never claims the phone is hot", () => {
    const playing = { ...base, musicPlaying: true };
    expect(gateDecision(playing, "foreground")).toEqual({ open: true, held: null });
    expect(gateDecision(playing, "background")).toEqual({ open: false, held: null });
  });

  it("matches the oracle over the whole table", () => {
    const modes: ReadMode[] = ["open", "charging", "anytime"];
    const nets: Array<[boolean | null, boolean]> = [[true, true], [true, false], [false, false], [null, false]];
    let n = 0;
    for (const mode of modes) for (const charging of [true, false, null]) for (const battery of [0.1, 0.5, null])
      for (const lowPower of [false, true]) for (const thermal of ["nominal", "fair", "serious", "critical"] as Thermal[])
        for (const [connected, onWifi] of nets) for (const mobileData of [false, true])
          for (const active of [true, false]) for (const where of ["foreground", "background"] as const) {
            const input: GateInput = { active, connected, onWifi, charging, battery, lowPower, thermal, musicPlaying: false, settings: { mode, mobileData } };
            expect({ input, where, got: gateDecision(input, where) }).toEqual({ input, where, got: oracle(input, where) });
            n++;
          }
    expect(n).toBe(3 * 3 * 3 * 2 * 4 * 4 * 2 * 2 * 2);
  });

  const d = (over: Partial<GateInput>, where: "foreground" | "background" = "foreground") => gateDecision({ ...base, ...over }, where);
  it("not connected: closed with no reason", () => {
    expect(d({ connected: false })).toEqual({ open: false, held: null });
    expect(d({ connected: null })).toEqual({ open: false, held: null });
  });
  it("cellular with mobile data off: held wifi; on: not held", () => {
    expect(d({ onWifi: false })).toEqual({ open: false, held: "wifi" });
    expect(d({ onWifi: false, settings: { mode: "charging", mobileData: true } }).open).toBe(true);
  });
  it("thermal serious or critical: held thermal, in both places", () => {
    expect(d({ thermal: "serious" }).held).toBe("thermal");
    expect(d({ thermal: "critical" }, "background").held).toBe("thermal");
    expect(d({ thermal: "fair" }).open).toBe(true);
  });
  it("open mode: foreground needs a charger, background never reads", () => {
    const settings = { mode: "open" as const, mobileData: false };
    expect(d({ settings }).open).toBe(true);
    expect(d({ settings, charging: false }).held).toBe("charger");
    expect(d({ settings }, "background").open).toBe(false);
  });
  it("charging mode: both places need a charger", () => {
    expect(d({ charging: false }, "background").held).toBe("charger");
    expect(d({}, "background").open).toBe(true);
  });
  it("unknown charging is held charger", () => {
    expect(d({ charging: null }).held).toBe("charger");
  });
  it("anytime: Low Power Mode is held lowPower", () => {
    expect(d({ settings: { mode: "anytime", mobileData: false }, lowPower: true, charging: false }).held).toBe("lowPower");
  });
  it("anytime: below 20% off the charger is held battery; charging or 20% exactly is fine", () => {
    const settings = { mode: "anytime" as const, mobileData: false };
    expect(d({ settings, charging: false, battery: 0.19 }).held).toBe("battery");
    expect(d({ settings, charging: true, battery: 0.05 }).open).toBe(true);
    expect(d({ settings, charging: false, battery: 0.2 }).open).toBe(true);
  });
  it("anytime: unknown battery off the charger is held battery", () => {
    expect(d({ settings: { mode: "anytime", mobileData: false }, charging: false, battery: null }).held).toBe("battery");
  });
  it("foreground needs the app active (no reason); background does not", () => {
    expect(d({ active: false })).toEqual({ open: false, held: null });
    expect(d({ active: false }, "background").open).toBe(true);
  });
});

it("closes when music starts and reopens when it stops", async () => {
  const s = signals({ music: false });
  const gate = createReadGate(s.sig, { get: () => ({ mode: "charging", mobileData: false }), subscribe: () => () => undefined });
  await new Promise((r) => setImmediate(r));
  expect(gate.allows("background")).toBe(true);
  s.music(true);
  expect(gate.allows("background")).toBe(false);
  s.music(false);
  expect(gate.allows("background")).toBe(true);
  gate.stop();
});
