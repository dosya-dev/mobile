import { useSyncExternalStore } from "react";
import * as Network from "expo-network";

/**
 * Whether the phone can reach the internet: true, false, or null for "not
 * known yet". Null is not offline. Read paths treat it as "try the network and
 * fall back", which is right both ways: a real offline start fails fast with a
 * transport error and reads the saved copy, and a slow first answer never hides
 * the server's version from a phone that is in fact online.
 */

type Online = boolean | null;

let online: Online = null;
let started = false;
let heard = false;
let sub: { remove(): void } | null = null;
const listeners = new Set<() => void>();

function fromState(n: { isConnected?: boolean | null; isInternetReachable?: boolean | null } | null | undefined): Online {
  if (!n || n.isConnected == null) return null;
  // Connected to a network with no way out (a captive portal, a router with
  // no uplink) is offline for every purpose here.
  return n.isConnected && n.isInternetReachable !== false;
}

function set(next: Online): void {
  if (next === online) return;
  online = next;
  for (const l of [...listeners]) l();
}

function ensureStarted(): void {
  if (started) return;
  started = true;
  try {
    sub = Network.addNetworkStateListener((e) => {
      heard = true;
      set(fromState(e));
    });
  } catch {
    // No network events: the initial read is all we get.
  }
  Network.getNetworkStateAsync()
    .then((n) => {
      // An event that already arrived is newer than this read.
      if (!heard) set(fromState(n));
    })
    .catch(() => {});
}

function subscribe(fn: () => void): () => void {
  ensureStarted();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function isOnlineNow(): Online {
  ensureStarted();
  return online;
}

export function useIsOnline(): Online {
  return useSyncExternalStore(subscribe, () => online, () => online);
}

/**
 * Transfers follow the Wi-Fi setting. Ethernet is as unmetered as Wi-Fi.
 * A VPN on Wi-Fi reports UNKNOWN on iOS; that is NOT counted, because the
 * same answer can mean cellular. Such a phone waits for Wi-Fi, and the
 * Offline screen points at the mobile-data setting.
 */
export function isUnmetered(type: unknown): boolean {
  return type === Network.NetworkStateType.WIFI || type === Network.NetworkStateType.ETHERNET;
}

/** Test hook. */
export function __resetOnlineForTests(): void {
  sub?.remove();
  sub = null;
  started = false;
  heard = false;
  online = null;
  listeners.clear();
}
