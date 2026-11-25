import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import type { ReadFace } from "@dosya-dev/personas-engine";
import { Text } from "@/ui/Text";
import { base64ToBytes } from "@/player/metadata/base64";
import { isNativeFaceReaderAvailable } from "../modules/dosya-face-reader";
import { ensureFaceModels } from "@/personas/device/models";
import { createNativeReader } from "@/personas/device/native-reader";
import { comparePersonasParity, type ParityReference } from "@/personas/device/parity";
import { recentWindows, type WindowRecord } from "@/personas/device/health";

/**
 * Personas reader parity - reachable only by deep link (dosya://personas-parity),
 * like app/vault-diagnostics.tsx: no account, no user data. It reads three
 * bundled photos with the native reader and compares faces, boxes and
 * signatures with what the web reader produced for the same files
 * (modules/dosya-face-reader/parity/reference.json). Run on a real phone;
 * it gates the release. Below the verdict: the last background windows
 * (spec 11.3), newest first, to check background reading on a test phone.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const reference = require("../modules/dosya-face-reader/parity/reference.json") as ParityReference;
const PHOTOS: Record<string, number> = {
  "crew.jpg": require("../modules/dosya-face-reader/parity/crew.jpg"),
  "exp73.jpg": require("../modules/dosya-face-reader/parity/exp73.jpg"),
  "sts116.jpg": require("../modules/dosya-face-reader/parity/sts116.jpg"),
};
/* eslint-enable @typescript-eslint/no-require-imports */

export interface ParityRun { ok: boolean; lines: string[] }
type Runner = () => Promise<ParityRun>;

async function loadBytes(moduleId: number): Promise<Uint8Array> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error("photo asset has no local file");
  const b64 = await FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.Base64 });
  return base64ToBytes(b64);
}

export async function runParity(): Promise<ParityRun> {
  if (!(await ensureFaceModels())) throw new Error("The face models could not be downloaded");
  const reader = createNativeReader();
  const got: Record<string, ReadFace[]> = {};
  const ms: string[] = [];
  try {
    for (const name of Object.keys(reference.files)) {
      const bytes = await loadBytes(PHOTOS[name]);
      const t0 = Date.now();
      got[name] = await reader.read(bytes);
      ms.push(`${name}: ${Date.now() - t0} ms`);
    }
  } finally {
    await reader.unload().catch(() => undefined);
  }
  const verdict = comparePersonasParity(reference, got, reference.files);
  return { ok: verdict.ok, lines: [...verdict.lines, ...ms] };
}

/** One background window as a diagnostics line: "2026-11-02 03:04:05 processing ios charging: 312 photos in 45.0 s, deadline". */
export function windowLine(w: WindowRecord): string {
  const when = new Date(w.at).toISOString().replace("T", " ").slice(0, 19);
  return `${when} ${w.kind} ${w.platform} ${w.mode}: ${w.photos} photos in ${(w.ms / 1000).toFixed(1)} s, ${w.end}`;
}

let runnerOverride: Runner | null = null;
/** Test seam: swap the runner (null restores the real one). */
export function __setParityRunnerForTests(runner: Runner | null): void {
  runnerOverride = runner;
}

export default function PersonasParityScreen() {
  const [run, setRun] = useState<ParityRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = isNativeFaceReaderAvailable();
  const [windows, setWindows] = useState<WindowRecord[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    recentWindows().then((w) => { if (!cancelled) setWindows(w); }, () => { if (!cancelled) setWindows([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    (runnerOverride ?? runParity)()
      .then((r) => { if (!cancelled) setRun(r); })
      .catch((err: unknown) => { if (!cancelled) setError(String((err as Error)?.message ?? err)); });
    return () => { cancelled = true; };
  }, [available]);

  const verdict = !available ? "UNAVAILABLE" : error ? "FAIL" : run ? (run.ok ? "PASS" : "FAIL") : "RUNNING";
  const shown = !available ? ["Native reader not available"] : error ? [error] : run?.lines ?? null;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: "Personas parity", headerShown: true }} />
      <ScrollView contentContainerClassName="px-5 py-4 gap-2">
        <Text className="text-2xl font-bold text-foreground" testID="personas-parity-verdict">{verdict}</Text>
        {shown ? shown.map((line, i) => (
          <Text key={i} className="font-mono text-sm text-foreground" testID={`personas-parity-line-${i}`}>{line}</Text>
        )) : (
          <Text className="text-sm text-muted-foreground">Running…</Text>
        )}
        {windows ? (
          <>
            <Text className="mt-4 text-lg font-bold text-foreground">{`Background windows (${windows.length})`}</Text>
            {windows.length === 0 ? (
              <Text className="text-sm text-muted-foreground">No background window yet</Text>
            ) : windows.map((w, i) => (
              <Text key={i} className="font-mono text-xs text-foreground" testID={`personas-parity-window-${i}`}>{windowLine(w)}</Text>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
