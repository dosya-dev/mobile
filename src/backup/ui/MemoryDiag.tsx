import { useEffect, useState } from "react";
import { Text } from "@/ui/Text";
import { formatBytes } from "@/lib/format";
import { getMemoryFootprint, getThermalState, type ThermalState } from "@/perf/thermal";

/**
 * Dev-only readout of the app's REAL memory footprint (phys_footprint - the
 * same number Xcode's gauge shows) + thermal state, sampled every 3 s. Renders
 * nothing where the native module is absent (Expo Go, Android, old builds).
 * Exists so RAM reports during backup runs are measurements, not impressions.
 */
export function MemoryDiag() {
  const [footprint, setFootprint] = useState<number>(-1);
  const [thermal, setThermal] = useState<ThermalState>("nominal");
  useEffect(() => {
    const sample = () => {
      setFootprint(getMemoryFootprint());
      setThermal(getThermalState());
    };
    sample();
    const t = setInterval(sample, 3000);
    return () => clearInterval(t);
  }, []);
  if (footprint < 0) return null;
  return (
    <Text testID="memory-diag" className="mt-1 text-center text-xs text-muted-foreground">
      RAM {formatBytes(footprint)} · thermal {thermal}
    </Text>
  );
}
