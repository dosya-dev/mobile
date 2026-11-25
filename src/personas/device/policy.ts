// The remote switch for phone background reading (spec 11.2).
//
// GET /api/personas/device-policy says whether background reading may run at
// all, and how many photos one window may read. Cached for an hour; on any
// failure the last good answer stands (memory, then the keychain), and with
// none the default is "on" / 2000. The foreground reader never asks.
import { API_BASE_URL } from "@/api/config";
import { getAccessToken, refreshSession } from "@/auth/authStore";
import * as keychain from "@/lib/keychain";
import { timedSignal, untilAborted } from "./abort";
import type { ReadMode } from "./settings";

export interface DevicePolicy {
  background: "on" | "charging" | "off";
  maxPhotosPerWindow: number;
}

const KEY = "dosya.personas.device-policy";
const TTL_MS = 60 * 60_000;
/** After a failed fetch, do not ask again for this long (windows call per batch). */
const RETRY_MS = 5 * 60_000;
const DEFAULTS: DevicePolicy = { background: "on", maxPhotosPerWindow: 2000 };

export interface PolicyDeps {
  base?: string;
  fetch?: typeof fetch;
  token?: () => string | null;
  refresh?: () => Promise<"refreshed" | "rejected" | "unavailable">;
  getItem?: (key: string) => Promise<string | null>;
  setItem?: (key: string, value: string) => Promise<void>;
  now?: () => number;
  /** Time limit for the request (React Native's fetch has none); 15 s when not given. */
  timeoutMs?: number;
}

const FETCH_TIMEOUT_MS = 15_000;

let good: DevicePolicy | null = null;
let freshUntil = 0;

/** Tests only: forget the in-memory copy. */
export function resetDevicePolicyCache(): void {
  good = null;
  freshUntil = 0;
}

function valid(v: unknown): DevicePolicy | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (r.background !== "on" && r.background !== "charging" && r.background !== "off") return null;
  if (typeof r.maxPhotosPerWindow !== "number" || !Number.isFinite(r.maxPhotosPerWindow)) return null;
  return { background: r.background, maxPhotosPerWindow: r.maxPhotosPerWindow };
}

async function fetchPolicy(d: PolicyDeps): Promise<DevicePolicy> {
  const base = (d.base ?? API_BASE_URL).replace(/\/+$/, "");
  const f = d.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const token = d.token ?? getAccessToken;
  const refresh = d.refresh ?? refreshSession;
  // A stalled request must not hold a background window (and the read lock):
  // past the limit the last good answer stands.
  const limit = timedSignal(d.timeoutMs ?? FETCH_TIMEOUT_MS);
  const send = () => {
    const t = token();
    return untilAborted(
      f(`${base}/api/personas/device-policy`, { headers: t ? { Authorization: `Bearer ${t}` } : {}, signal: limit.signal } as RequestInit),
      limit.signal,
    );
  };
  try {
    let res = await send();
    if (res.status === 401 && (await untilAborted(refresh(), limit.signal)) === "refreshed") res = await send();
    if (!res.ok) throw new Error(`device-policy: HTTP ${res.status}`);
    const p = valid(await untilAborted(res.json() as Promise<unknown>, limit.signal));
    if (!p) throw new Error("device-policy: bad body");
    return p;
  } finally {
    limit.clear();
  }
}

export async function devicePolicy(deps: PolicyDeps = {}): Promise<DevicePolicy> {
  const now = (deps.now ?? Date.now)();
  if (good && now < freshUntil) return good;
  const getItem = deps.getItem ?? keychain.getItem;
  const setItem = deps.setItem ?? keychain.setItem;
  try {
    const p = await fetchPolicy(deps);
    good = p;
    freshUntil = now + TTL_MS;
    try { await setItem(KEY, JSON.stringify(p)); } catch { /* the memory copy still stands */ }
    return p;
  } catch {
    if (!good) {
      try {
        const raw = await getItem(KEY);
        good = (raw ? valid(JSON.parse(raw)) : null) ?? { ...DEFAULTS };
      } catch {
        good = { ...DEFAULTS };
      }
    }
    freshUntil = now + RETRY_MS;
    return good;
  }
}

/** The read mode a background window may use: "none" = no background reading. */
export function effectiveBackgroundMode(mode: ReadMode, p: DevicePolicy): ReadMode | "none" {
  if (p.background === "off") return "none";
  if (p.background === "charging" && mode === "anytime") return "charging";
  return mode;
}
