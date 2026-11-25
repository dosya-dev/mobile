import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Icon } from "@/ui/Icon";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useT } from "@/lib/i18n";
import { useColorTheme } from "@/theme/useColorTheme";
import { getEditorConfig, editorHtml } from "@/editor/api";

/**
 * The ONLYOFFICE editor on a phone.
 *
 * React Native fetches the signed config, because that endpoint is
 * authenticated; the WebView hosting the editor never sees a user credential and
 * does not need one. The config carries an opaque session token and the document
 * server fetches the file itself with it.
 *
 * Unlike the map and the book reader, the page is NOT inlined at build time:
 * ONLYOFFICE's api.js has to come from the document server at runtime, since it
 * is that server's own matching client.
 */
export default function EditorScreen() {
  const t = useT();
  const params = useLocalSearchParams<{ fileId?: string; name?: string }>();
  const fileId = params.fileId ?? null;
  const { tokens } = useColorTheme();

  const [ready, setReady] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["editor-config", fileId],
    enabled: !!fileId,
    queryFn: () => getEditorConfig(fileId as string),
    // The config embeds a short-lived session token, so a cached one is worse
    // than no cache: it would open an editor the document server then rejects.
    gcTime: 0,
    staleTime: 0,
  });

  const html = useMemo(() => (q.data ? editorHtml(q.data) : null), [q.data]);
  const mode = q.data?.config.editorConfig.mode ?? null;

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: { type?: string; message?: string; code?: string };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === "ready") { setReady(true); setPageError(null); }
    if (msg.type === "error") { setPageError(msg.code === "unreachable" ? t("editor.error.documentServerUnreachable") : msg.message ?? t("editor.error.theEditorCouldNotBeOpened")); }
  }, [t]);

  const failed = q.isError || !fileId || pageError;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: params.name ?? t("editor.heading.editor"),
          // Named in the header rather than a badge in the body: on a phone the
          // editor fills the screen and a body badge would be covered by it.
          headerRight: () =>
            mode === "view" ? (
              <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.medium }}>
                {t("editor.status.readOnly")}
              </Text>
            ) : null,
        }}
      />

      {failed ? (
        <View className="mt-16 items-center px-8" testID="editor-error">
          <Icon name="document-text-outline" size={28} color={tokens.mutedForeground} />
          <Text className="mt-2 text-center text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
            {t("editor.error.thisDocumentCouldNotBeOpened")}
          </Text>
          <Text className="mt-1 text-center text-xs text-muted-foreground">
            {pageError ?? (q.error instanceof Error ? q.error.message : t("editor.description.theEditorIsUnavailable"))}
          </Text>
          <Pressable
            testID="editor-retry"
            accessibilityRole="button"
            onPress={() => { setPageError(null); setReady(false); void q.refetch(); }}
            className="mt-3 rounded-lg border border-border px-3 py-1.5"
          >
            <Text className="text-xs text-foreground">{t("common.action.tryAgain")}</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-1">
          {html ? (
            <WebView
              testID="editor-webview"
              source={{ html, baseUrl: q.data?.documentServerUrl }}
              originWhitelist={["*"]}
              onMessage={onMessage}
              javaScriptEnabled
              domStorageEnabled
              // The editor is a full application: it opens its own dialogs and
              // uploads, and blocking those leaves controls that do nothing.
              allowFileAccess
              setSupportMultipleWindows={false}
              style={{ flex: 1, backgroundColor: tokens.background }}
            />
          ) : null}

          {!ready ? (
            <View className="absolute inset-0 items-center justify-center" testID="editor-loading">
              <ActivityIndicator color={tokens.primary} />
              <Text className="mt-2 text-xs text-muted-foreground">{t("editor.label.openingTheDocument")}</Text>
            </View>
          ) : null}
        </View>
      )}
    </SafeAreaView>
  );
}
