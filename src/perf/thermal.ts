import { requireOptionalNativeModule } from "expo-modules-core";

export type ThermalState = "nominal" | "fair" | "serious" | "critical";

interface DosyaThermalModule {
  getThermalState(): ThermalState;
  getMemoryFootprint(): number; // bytes (phys_footprint), -1 if unavailable
  addListener?(event: "onThermalStateChange", cb: (e: { state: ThermalState }) => void): { remove: () => void };
}

// Present only in dev-client / release builds that include the local module -
// absent in Expo Go. Implemented on iOS and Android. Every caller must work
// with the fallback: "nominal", no events, footprint -1.
const native = requireOptionalNativeModule<DosyaThermalModule>("DosyaThermal");

export function isThermalAvailable(): boolean {
  return native != null;
}

export function getThermalState(): ThermalState {
  try {
    return native?.getThermalState() ?? "nominal";
  } catch {
    return "nominal";
  }
}

/** Current app memory footprint in bytes (iOS phys_footprint, Android PSS), -1 when unknown. */
export function getMemoryFootprint(): number {
  try {
    return native?.getMemoryFootprint() ?? -1;
  } catch {
    return -1;
  }
}

/** Subscribe to thermal-state changes; returns a disposer. No-op without the module. */
export function addThermalListener(cb: (state: ThermalState) => void): () => void {
  if (!native?.addListener) return () => {};
  try {
    const sub = native.addListener("onThermalStateChange", (e) => cb(e.state));
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
