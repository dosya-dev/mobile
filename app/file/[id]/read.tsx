import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { Text } from "@/ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Button } from "@/ui/Button";
import { useT } from "@/lib/i18n";
import { useFile } from "@/files/hooks";
import { getDownloadUrl } from "@/files/api";
import { needsUnlock, viewOnlySource } from "@/files/lock";
import { formatBytes, readerType } from "@/files/format";
import { ensureBookCached, releaseOpenBooks } from "@/reader/bookCache";
import { BookReader } from "@/reader/BookReader";
import { PdfReader } from "@/reader/PdfReader";

type Phase = "gate" | "downloading" | "error" | "ready";

export default function ReadRoute() {
  const t = useT();
  const { id, token } = useLocalSearchParams<{ id: string; token?: string }>();
  const { data: file, isLoading, isError } = useFile(id);

  const [phase, setPhase] = useState<Phase>("gate");
  const [progress, setProgress] = useState({ written: 0, total: 0 });
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Guards a single in-flight download per mount: without this, a retry
  // press that lands while the previous ensureBookCached call is still
  // resolving (ensureBookCached itself has no concurrent-call guard) could
  // kick off a second overlapping download for the same file.
  const runIdRef = useRef(0);

  const kind = file ? readerType(file.mime_type, file.extension) : undefined;
  // Only full_lock without a token bounces back to the detail screen.
  // view_only is readable - it just cannot be downloaded - and gating it here
  // was half of why a view-only book could not be opened at all.
  const gated = file ? needsUnlock(file, token) : false;

  const download = useCallback(() => {
    if (!file) return;
    const runId = ++runIdRef.current;
    setPhase("downloading");
    setErrorMessage(null);
    setProgress({ written: 0, total: 0 });
    // A view-only book streams from the authenticated /raw route; everything
    // else presigns. See src/files/lock.ts.
    const raw = viewOnlySource(file);
    ensureBookCached(
      file,
      () => (raw ? Promise.resolve(raw.uri) : getDownloadUrl(file.id, token)),
      (written, total) => {
        if (runIdRef.current !== runId) return;
        setProgress({ written, total });
      },
      raw?.headers,
    )
      .then((uri) => {
        if (runIdRef.current !== runId) return;
        setLocalUri(uri);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (runIdRef.current !== runId) return;
        setErrorMessage(err instanceof Error ? err.message : t("common.error.downloadFailed"));
        setPhase("error");
      });
  }, [file, token, t]);

  useEffect(() => {
    if (!file) return;
    if (kind === null || gated) {
      router.replace(`/file/${id}`);
      return;
    }
    download();
    // Re-running on every `download` identity change would double-fire the
    // download on unrelated re-renders; gate strictly on the file identity
    // (and its resolved reader kind / lock state, which only change when
    // the file itself does).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  /**
   * A view-only book is readable, not keepable.
   *
   * The reader cannot stream - it needs a path - so a restricted book is
   * written to disk to be opened at all. Closing the reader is where that copy
   * stops being justified, so it goes here. Unrestricted books are untouched:
   * they live in the byte store and are meant to survive.
   */
  useEffect(() => () => { void releaseOpenBooks(); }, []);

  let body: ReactNode;
  if (isLoading) {
    body = (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  } else if (isError || !file) {
    body = (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-destructive">{t("common.error.couldnTLoadFile")}</Text>
      </View>
    );
  } else if (phase === "gate") {
    // Brief window between the file resolving and the gate effect deciding
    // to redirect or download - show a spinner rather than flashing the
    // download UI (with its progress bar / file name) for a file that may
    // be about to bounce straight back to the detail screen.
    body = (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  } else if (phase === "ready" && localUri) {
    body =
      kind === "pdf" ? (
        <PdfReader
          key={file.id}
          file={file}
          localUri={localUri}
          onClose={() => router.back()}
          onOpenDetails={() => router.replace(`/file/${id}`)}
        />
      ) : (
        <BookReader
          key={file.id}
          file={file}
          localUri={localUri}
          format={kind === "txt" ? "txt" : "book"}
          onClose={() => router.back()}
          onOpenDetails={() => router.replace(`/file/${id}`)}
        />
      );
  } else {
    const pct = progress.total > 0 ? Math.round((progress.written / progress.total) * 100) : 0;
    body = (
      <SafeAreaView className="flex-1 items-center justify-center bg-background" edges={["bottom"]}>
        <View className="w-full max-w-sm gap-3 px-8">
          <Text className="text-center text-base text-foreground" numberOfLines={2}>{file.name}</Text>
          <Text className="text-center text-sm text-muted-foreground">{formatBytes(file.size_bytes)}</Text>
          {phase === "error" ? (
            <>
              <Text className="text-center text-destructive">{errorMessage}</Text>
              <Button title={t("common.retry")} onPress={download} testID="retry-download" />
            </>
          ) : (
            <View testID="download-progress" className="mt-2 h-2 overflow-hidden rounded-full bg-border">
              <View className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
    </>
  );
}
