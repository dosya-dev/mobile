import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, InteractionManager, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import { useColorTheme } from "@/theme/useColorTheme";
import { useFile } from "@/files/hooks";
import { getDownloadUrl } from "@/files/api";
import { canDownload, needsUnlock, viewOnlySource } from "@/files/lock";
import { formatBytes } from "@/files/format";
import type { FileDetail } from "@/files/types";
import { SaveCancelled, saveOutcomeMessage, saveToDevice } from "@/files/saveToDevice";
import { TextStage } from "@/viewer/stages/TextStage";
import { GlyphStage } from "@/viewer/stages/GlyphStage";
import { stagePalette } from "@/viewer/stageTheme";
import { CalendarView } from "@/calendar/CalendarView";
import { ICS_INLINE_BYTES, MAX_ICS_PARSE_BYTES, readCalendar, type ParsedCalendar } from "@/calendar/calendarRead";

type Loaded = { text: string; parsed: ParsedCalendar | null };

/**
 * The source tab for a body over the inline text cap: the text stage renders
 * every line, which a Takeout calendar would stall on, so it gets the viewer's
 * too-large card and a Save instead. The bytes are already in memory.
 */
function BigSource({ file, text }: { file: FileDetail; text: string }) {
  const t = useT();
  const { scheme } = useColorTheme();
  const [saving, setSaving] = useState(false);
  const onSave = async () => {
    setSaving(true);
    const uri = `${FileSystem.cacheDirectory}${file.name.replace(/[\\/:*?"<>|]+/g, " ")}`;
    try {
      await FileSystem.writeAsStringAsync(uri, text);
      const outcome = await saveToDevice({ localUri: uri, fileName: file.name, mimeType: file.mime_type, extension: file.extension, sizeBytes: file.size_bytes });
      toast(saveOutcomeMessage(outcome));
    } catch (e) {
      if (e instanceof SaveCancelled) toast(e.message);
      else toast(e instanceof Error && e.message ? e.message : t("common.error.couldnTSaveThisFile"), "error");
    } finally {
      setSaving(false);
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  };
  return (
    <View testID="calendar-source-too-large" className="flex-1">
      <GlyphStage variant="too-large" name={file.name} mimeType={file.mime_type} extension={file.extension} sizeLabel={formatBytes(file.size_bytes)} palette={stagePalette(scheme)} />
      {canDownload(file) ? (
        <View className="items-center pb-8">
          <View className="w-48"><Button title={t("common.action.saveToPhone")} onPress={() => void onSave()} loading={saving} testID="calendar-source-save" /></View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A .ics read as a calendar: agenda, month and source. Opened from the
 * viewer's primary action, the same way the contacts route is. Read-only.
 */
export default function CalendarRoute() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: file, isLoading, isError } = useFile(id);
  const { tokens } = useColorTheme();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The body, once it has arrived and before it is parsed.
  const [raw, setRaw] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Guards a single in-flight load per mount, matching contacts.tsx.
  const runIdRef = useRef(0);
  const tooBig = !!file && file.size_bytes > MAX_ICS_PARSE_BYTES;

  const load = useCallback(() => {
    if (!file) return;
    const runId = ++runIdRef.current;
    setLoaded(null);
    setRaw(null);
    setFailed(false);
    const raw = viewOnlySource(file);
    const resolve = raw ? Promise.resolve(raw.uri) : getDownloadUrl(file.id);
    resolve
      .then((url) => fetch(url, raw ? { headers: raw.headers } : undefined))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (runIdRef.current === runId) setRaw(text);
      })
      .catch(() => {
        if (runIdRef.current === runId) setFailed(true);
      });
  }, [file]);

  // Parse once the loading state is on screen, not in the fetch callback: a
  // Takeout calendar takes seconds on the JS thread, and the spinner (native,
  // so it keeps turning while JS works) has to paint first.
  useEffect(() => {
    if (raw === null) return;
    const runId = runIdRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        if (runIdRef.current === runId) setLoaded({ text: raw, parsed: readCalendar(raw) });
      }, 0);
    });
    return () => {
      task.cancel();
      if (timer) clearTimeout(timer);
    };
  }, [raw]);

  useEffect(() => {
    if (!file) return;
    // A file still behind its password gate, or too large to parse, belongs
    // on the detail page, which knows how to present both.
    if (needsUnlock(file, null) || tooBig) {
      router.replace(`/file/${id}`);
      return;
    }
    load();
    // Gate on file identity only, as contacts.tsx does: `load` changes with
    // every new file object and would re-fetch on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  if (isError || (!isLoading && !file)) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-destructive">{t("common.error.couldnTLoadFile")}</Text>
      </View>
    );
  }

  if (failed && file) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background px-8">
        <Stack.Screen options={{ headerShown: true, title: file.name }} />
        <Text className="text-center text-destructive">{t("common.error.couldnTLoadFile")}</Text>
        <View className="w-40"><Button title={t("common.retry")} onPress={load} testID="retry-calendar" /></View>
      </View>
    );
  }

  if (!file || !loaded) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-background">
        {file ? <Stack.Screen options={{ headerShown: true, title: file.name }} /> : null}
        <ActivityIndicator />
        <Text className="text-sm text-muted-foreground">{t("common.status.loadingCalendar")}</Text>
      </View>
    );
  }

  const source = file.size_bytes > ICS_INLINE_BYTES
    ? <BigSource file={file} text={loaded.text} />
    : <TextStage text={loaded.text} mimeType={file.mime_type} extension={file.extension} mutedColor={tokens.mutedForeground} />;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: true, title: file.name }} />
      {loaded.parsed ? (
        <CalendarView parsed={loaded.parsed} text={loaded.text} fileName={file.name} source={source} canExport={canDownload(file)} />
      ) : (
        // Not a calendar after all: the text stage shows what it is.
        <View testID="calendar-fallback" className="flex-1 pt-3">{source}</View>
      )}
    </View>
  );
}
