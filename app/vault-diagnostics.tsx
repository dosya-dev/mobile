import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import { Text } from "@/ui/Text";
import { runVaultDiagnostics, summarize, type DiagnosticsReport } from "@/vault/diagnostics";
import { expoDiagnosticsFs } from "@/vault/diagnosticsFs";
import * as chunker from "../modules/dosya-vault-chunker";

/**
 * Vault diagnostics - reachable only by deep link (dosya://vault-diagnostics),
 * the way the Maestro flows reach every screen. No entry point in the UI, no
 * network, no user data: it runs e2ee-core's backend self-test and the native
 * chunker against the frozen vectors on this device and prints timings.
 * .maestro/19-vault-diagnostics.yaml asserts the first three lines.
 */
type Runner = () => Promise<DiagnosticsReport>;

const defaultRunner: Runner = () => runVaultDiagnostics({ fs: expoDiagnosticsFs, chunker });
let runnerOverride: Runner | null = null;

/** Test seam: swap the runner (null restores the real one). */
export function __setDiagnosticsRunnerForTests(runner: Runner | null): void {
  runnerOverride = runner;
}

export default function VaultDiagnosticsScreen() {
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (runnerOverride ?? defaultRunner)()
      .then((report) => { if (!cancelled) setLines(summarize(report)); })
      .catch((err: unknown) => { if (!cancelled) setError(String((err as Error)?.message ?? err)); });
    return () => { cancelled = true; };
  }, []);

  const verdict = error ? "FAIL" : lines ? (lines[0] === "Self-test: PASS" && lines[1] === "Chunker: PASS" && lines[2] === "Binary AD: PASS" ? "PASS" : "FAIL") : "RUNNING";
  const shown = error ? ["Self-test: FAIL", "Chunker: FAIL", "Binary AD: FAIL", error] : lines;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: "Vault diagnostics", headerShown: true }} />
      <ScrollView contentContainerClassName="px-5 py-4 gap-2">
        <Text className="text-2xl font-bold text-foreground" testID="vault-diagnostics-verdict">{verdict}</Text>
        {shown ? shown.map((line, i) => (
          <Text key={i} className="font-mono text-sm text-foreground" testID={`vault-diagnostics-line-${i}`}>{line}</Text>
        )) : (
          <Text className="text-sm text-muted-foreground">Running…</Text>
        )}
      </ScrollView>
    </View>
  );
}
