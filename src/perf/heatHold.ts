import { usePlayerStore } from "@/player/playerStore";
import { getThermalState } from "./thermal";

/**
 * Whether work nobody asked for right now should wait. Background audio keeps
 * the app running, so a scan, a sync or a model would otherwise stack on top of
 * playback and be blamed on the music. Work the user started does not ask.
 */

export function isPhoneHot(): boolean {
  const state = getThermalState();
  return state === "serious" || state === "critical";
}

export function isAutoWorkHeld(): boolean {
  return usePlayerStore.getState().listening || isPhoneHot();
}
