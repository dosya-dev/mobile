// Jest stand-in for the native background module. It keeps the native
// buffering contract: onWindow / onWindowExpired / onPausePressed events emitted with no
// listener are held and flushed, in order, to the first listener. Tests drive
// it through __native and inspect the jest.fn calls.
import type { BackgroundBlock, WindowEvent } from "../index";

export type { BackgroundBlock, WindowEvent, WindowKind } from "../index";

type Name = "onWindow" | "onWindowExpired" | "onMemoryWarning" | "onPausePressed" | "onServiceStopped";
const listeners: Record<Name, Set<(e: unknown) => void>> = {
  onWindow: new Set(),
  onWindowExpired: new Set(),
  onMemoryWarning: new Set(),
  onPausePressed: new Set(),
  onServiceStopped: new Set(),
};
let pending: { name: Name; body: unknown }[] = [];

function emit(name: Name, body: unknown, buffer: boolean) {
  if (listeners[name].size === 0) {
    if (buffer) pending.push({ name, body });
    return;
  }
  for (const fn of [...listeners[name]]) fn(body);
}

function listen(name: Name, fn: (e: unknown) => void): () => void {
  listeners[name].add(fn);
  if (listeners[name].size === 1) {
    const flush = pending.filter((p) => p.name === name);
    pending = pending.filter((p) => p.name !== name);
    for (const p of flush) fn(p.body);
  }
  return () => {
    listeners[name].delete(fn);
  };
}

export const __native = {
  emitWindow: (w: WindowEvent) => emit("onWindow", w, true),
  emitExpired: (id: string) => emit("onWindowExpired", id, true),
  emitMemoryWarning: () => emit("onMemoryWarning", undefined, false),
  emitPause: () => emit("onPausePressed", undefined, true),
  emitServiceStopped: () => emit("onServiceStopped", undefined, true),
  reset() {
    pending = [];
    for (const k of Object.keys(listeners) as Name[]) listeners[k].clear();
  },
};

export function isPersonasBackgroundAvailable(): boolean {
  return true;
}
export function onWindow(fn: (w: WindowEvent) => void): () => void {
  return listen("onWindow", (e) => fn(e as WindowEvent));
}
export function onWindowExpired(fn: (id: string) => void): () => void {
  return listen("onWindowExpired", (e) => fn(e as string));
}
export function onMemoryWarning(fn: () => void): () => void {
  return listen("onMemoryWarning", () => fn());
}
export const windowDone = jest.fn((_id: string, _moreLeft: boolean): void => undefined);
export const scheduleWindow = jest.fn(async (_o: { requiresPower: boolean }): Promise<void> => undefined);
export const cancelWindows = jest.fn(async (): Promise<void> => undefined);
export const supportsContinued = jest.fn((): boolean => false);
export const startContinued = jest.fn(async (_o: { title: string; subtitle: string }): Promise<boolean> => false);
export const setWindowProgress = jest.fn((_id: string, _p: { read: number; total: number; text: string }): void => undefined);
export const backgroundBlocks = jest.fn(async (): Promise<BackgroundBlock[]> => []);
export const openAppSettings = jest.fn(async (_which: BackgroundBlock): Promise<void> => undefined);
export function onPausePressed(fn: () => void): () => void {
  return listen("onPausePressed", () => fn());
}
export function onServiceStopped(fn: () => void): () => void {
  return listen("onServiceStopped", () => fn());
}
export const startService = jest.fn(async (_o: { title: string; text: string; pauseLabel: string; channelName: string }): Promise<boolean> => true);
export const updateService = jest.fn((_p: { read: number; total: number; text: string }): void => undefined);
export const stopService = jest.fn((): void => undefined);
export const enqueueWorker = jest.fn(
  async (_o: { requiresCharging: boolean; batteryNotLow: boolean; unmetered: boolean; tapText: string }): Promise<void> => undefined,
);
export const requestNotificationPermission = jest.fn(async (): Promise<boolean> => true);
