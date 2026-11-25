// The hidden WebView that reads faces for Personas. React Native's Hermes
// cannot run WebAssembly, so the face reader runs in the web app's reader
// page (apps/web/personas-reader.html) inside a zero-size, invisible
// WebView. It is mounted only while there is reading to do (./channel.ts
// decides) and is mounted once, in the root layout, so reading started from
// any screen has it.
//
// While the native reader is in use (./reader-kind.ts) the WebView is never
// mounted (spec 11.5): its ~100 MB would sit beside the ONNX sessions.
//
// The page needs no cookies or session: it fetches the reader and the models
// from the public models route and checks their SHA-256 itself. Nothing but
// the reader page is ever loaded in it.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { WEB_ORIGIN } from "@/api/config";
import { personasReaderChannel, type ReaderChannel } from "./channel";
import { personasReaderKind, subscribeReaderKind } from "./reader-kind";

export const READER_PAGE_URL = `${WEB_ORIGIN.replace(/\/+$/, "")}/personas-reader.html`;

export function ReaderHost({ channel = personasReaderChannel }: { channel?: ReaderChannel }) {
  const snap = useSyncExternalStore(channel.subscribe, channel.snapshot, channel.snapshot);
  const kind = useSyncExternalStore(subscribeReaderKind, personasReaderKind, personasReaderKind);
  const mounted = snap.mounted && kind !== "native";
  const key = snap.key;
  const ref = useRef<WebView>(null);

  useEffect(() => {
    if (!mounted) return;
    channel.attach((m) => ref.current?.postMessage(m));
    return () => channel.attach(null);
  }, [channel, mounted, key]);

  if (!mounted) return null;
  const gone = () => channel.gone();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", width: 0, height: 0, opacity: 0, overflow: "hidden" }}
    >
      <WebView
        key={key}
        ref={ref}
        source={{ uri: READER_PAGE_URL }}
        originWhitelist={[WEB_ORIGIN]}
        javaScriptEnabled
        onMessage={(e) => channel.receive(e.nativeEvent.data)}
        onShouldStartLoadWithRequest={(r) => r.url === READER_PAGE_URL}
        onContentProcessDidTerminate={gone}
        onRenderProcessGone={gone}
        onError={gone}
        onHttpError={gone}
        style={{ width: 0, height: 0 }}
      />
    </View>
  );
}
