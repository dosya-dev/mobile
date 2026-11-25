import { useEffect, useReducer, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { formatBytes } from "@/files/format";
import { useColorTheme } from "@/theme/useColorTheme";
import { shareFile } from "@/files/download";
import { isSafeExternalUrl } from "@/lib/safeUrl";
import { READER_HTML } from "./readerHtml.generated";
import {
  INITIAL_UI,
  parsePageMessage,
  readerReducer,
  jsInit,
  jsGoTo,
  jsTurn,
  jsApply,
  jsSearch,
  jsSearchClear,
  decideTap,
  stageLabel,
  allowsReaderNavigation,
  READER_BASE_URL,
  prepareProgress,
  errorCopy,
  type SearchHit,
} from "./bridge";
import { chromeBands } from "./chromeLayout";
import { deliverBook } from "./chunkDelivery";
import {
  ReadingState,
  EMPTY_STATE,
  loadReadingState,
  addBookmark,
  removeBookmark,
  hasBookmarkAt,
  createPositionSaver,
  updateReadingState,
} from "./readingState";
import { useReaderPrefs } from "./readerPrefs";
import { themeById } from "./readerThemes";
import { ReaderChrome } from "./ReaderChrome";
import { ReaderMenu } from "./ReaderMenu";
import { TocSheet } from "./TocSheet";
import { ThemesSheet } from "./ThemesSheet";
import { SearchSheet } from "./SearchSheet";

/** Dims the page behind the card without hiding that a book is there. */
const SCRIM = "rgba(0,0,0,0.55)";

const CARD_SHADOW = {
  shadowColor: "#000000",
  shadowOpacity: 0.34,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 14 },
  elevation: 12,
} as const;

export function BookReader({
  file,
  localUri,
  format,
  onClose,
  onOpenDetails,
}: {
  file: { id: string; name: string; size_bytes: number };
  localUri: string;
  format: "book" | "txt";
  onClose: () => void;
  onOpenDetails?: () => void;
}) {
  const t = useT();
  const webref = useRef<WebView>(null);
  const [ui, dispatch] = useReducer(readerReducer, INITIAL_UI);
  const [bookState, setBookState] = useState<ReadingState>(EMPTY_STATE);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Query-generation guard: the page tags every searchResults/searchDone/
  // searchError message with the `gen` its __dosyaSearch call was assigned
  // (reader-page/main.js's searchGen). The `searching` guard below only
  // covers "no search is active at all" - it can't catch the ACTIVE-TO-
  // ACTIVE case where a batch the page already posted for a superseded
  // query (e.g. "cat") arrives after a newer query (e.g. "cathedral") was
  // dispatched, since `searching` never dips to false in between.
  //
  // currentGenRef holds the gen of the query we currently trust, and
  // persists across dispatches (it is NOT reset to null on a new query) -
  // resetting it would make the very first message to arrive after a
  // dispatch "win" regardless of its gen, and that first arrival is
  // exactly the stale straggler this guard exists to reject (it's already
  // in flight over the bridge by the time the new query is dispatched, so
  // it beats the new query's own first message here). pendingGenRef marks
  // "a new query was dispatched and we haven't yet seen a message for it" -
  // while pending, only a gen strictly greater than currentGenRef can be
  // adopted as the new current generation; anything else is a leftover
  // from the superseded query and is dropped.
  const currentGenRef = useRef<number | null>(null);
  const pendingGenRef = useRef(false);
  const { fontSizePct, themeId } = useReaderPrefs();
  const saverRef = useRef(createPositionSaver(file.id));
  const startedRef = useRef(false);
  // Fraction of the book's bytes handed to the page so far (see deliverBook).
  const [delivered, setDelivered] = useState(0);
  // Bumped by Retry; used as the WebView's key so a retry gets a brand new
  // WebView - and therefore a brand new renderer process - rather than
  // re-injecting into whatever is left of a dead one.
  const [attempt, setAttempt] = useState(0);
  // The tap model needs to know how tall the control bands are relative to
  // the page (see chromeBands): the safe-area insets and the measured height
  // of this reader, which the page itself cannot know.
  const insets = useSafeAreaInsets();
  const [pageHeight, setPageHeight] = useState(0);
  const { tokens } = useColorTheme();

  // EPUB/MOBI/AZW3 only - react-native-pdf exposes no text search, and the
  // TXT path's book object has no createDocument hook for foliate's search
  // to walk (see reader-redesign-spec.md's "Page protocol changes").
  const canSearch = format === "book";

  useEffect(() => {
    void loadReadingState(file.id).then(setBookState);
    const saver = saverRef.current;
    return () => {
      void saver.flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  useEffect(() => {
    if (ui.status === "ready") {
      const theme = themeById(themeId);
      webref.current?.injectJavaScript(jsApply({ fontSizePct, bg: theme.bg, fg: theme.fg }));
    }
  }, [fontSizePct, themeId, ui.status]);

  const start = async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const state = await loadReadingState(file.id);
      const inject = (js: string) => webref.current?.injectJavaScript(js);
      const theme = themeById(themeId);
      inject(
        jsInit({
          name: file.name,
          format,
          fontSizePct,
          bg: theme.bg,
          fg: theme.fg,
          location: state.location,
          texts: { searchBookLoading: t("reader.description.theBookIsStillLoadingTrySearchingAgainInAMoment") },
        }),
      );
      await deliverBook({ uri: localUri, size: file.size_bytes, inject, onProgress: setDelivered });
    } catch (err) {
      dispatch({ type: "error", message: err instanceof Error ? err.message : "Failed to open book" });
    }
  };

  const retry = () => {
    startedRef.current = false;
    setDelivered(0);
    dispatch({ type: "reset" });
    setAttempt((a) => a + 1);
  };

  // See currentGenRef/pendingGenRef above. Returns whether `gen` belongs to
  // the query we currently trust, updating the refs as a side effect when it
  // does. Must be called at most once per incoming message.
  const acceptsGen = (gen: number) => {
    if (pendingGenRef.current) {
      if (currentGenRef.current !== null && gen <= currentGenRef.current) return false;
      currentGenRef.current = gen;
      pendingGenRef.current = false;
      return true;
    }
    return gen === currentGenRef.current;
  };

  const onMessage = (e: { nativeEvent: { data: string } }) => {
    const msg = parsePageMessage(e.nativeEvent.data);
    if (!msg) return;
    if (msg.type === "loaded") {
      void start();
      return;
    }
    if (msg.type === "externalLink") {
      // The reader page cancels foliate's own window.open for this (see
      // reader-page/main.js's onExternalLink) and hands the URL to us
      // instead - open it in the system browser, never inside this WebView.
      if (isSafeExternalUrl(msg.href)) void Linking.openURL(msg.href).catch(() => {});
    }
    if (msg.type === "relocated") saverRef.current.update(msg.location, msg.fraction);
    if (msg.type === "tap") {
      // The page only reports where the tap landed; what it means depends on
      // whether the controls are showing and where their bands are, which
      // only this side knows. See decideTap for the model.
      const decision = decideTap(msg, ui.chromeVisible, chromeBands(insets, pageHeight));
      if (decision.turn !== 0) webref.current?.injectJavaScript(jsTurn(decision.turn));
      if (decision.chrome !== ui.chromeVisible) dispatch({ type: "setChrome", visible: decision.chrome });
    }
    // The page cancels its own generator on a superseded query or a close
    // (see reader-page/main.js's searchGen), but a message can already be
    // in flight over the bridge when that cancellation lands - so also
    // ignore search messages here whenever no search is currently active,
    // rather than trusting every message that happens to arrive. The gen
    // check additionally covers the active-to-active case `searching` can't
    // see (a new query dispatched before the previous one finished).
    if (msg.type === "searchResults" && searching && acceptsGen(msg.gen)) {
      setSearchHits((prev) => [...prev, ...msg.items]);
    }
    if (msg.type === "searchDone" && searching && acceptsGen(msg.gen)) setSearching(false);
    if (msg.type === "searchError" && searching && acceptsGen(msg.gen)) {
      setSearchError(msg.message);
      setSearching(false);
    }
    dispatch(msg);
  };

  // Defense in depth alongside the CSP on reader-page/index.html and the
  // reader page's own external-link handling. See allowsReaderNavigation:
  // everything except the reader page's own URL and foliate's blob:/data:
  // section URLs is refused.
  const onShouldStartLoadWithRequest = (request: WebViewNavigation) => allowsReaderNavigation(request.url);

  const toggleBookmark = async () => {
    if (!ui.location) return;
    const location = ui.location;
    const percent = Math.round(ui.fraction * 100);
    const label = ui.section ? `${ui.section} · ${percent}%` : t("reader.label.positionPercent", { percent });
    const next = await updateReadingState(file.id, (current) => {
      const existing = hasBookmarkAt(current, location);
      return existing ? removeBookmark(current, existing.id) : addBookmark(current, location, label);
    });
    setBookState(next);
  };

  // Search state lives here (not in the sheet) so a query survives the sheet
  // being backgrounded behind the menu and jsSearchClear can be issued on
  // every path that ends the search, not just the sheet's own Done button.
  const closeSearch = () => {
    setSearchOpen(false);
    webref.current?.injectJavaScript(jsSearchClear());
    setSearchHits([]);
    setSearching(false);
    setSearchError(null);
  };

  const onSearchQuery = (query: string) => {
    setSearchHits([]);
    setSearching(true);
    setSearchError(null);
    pendingGenRef.current = true;
    webref.current?.injectJavaScript(jsSearch(query));
  };

  const pageBg = themeById(themeId).bg;
  const bookmarked = ui.location ? !!hasBookmarkAt(bookState, ui.location) : false;

  return (
    <View
      style={{ flex: 1, backgroundColor: pageBg }}
      onLayout={(e: LayoutChangeEvent) => setPageHeight(e.nativeEvent.layout.height)}
    >
      <WebView
        key={attempt}
        ref={webref}
        // baseUrl is load-bearing, not decoration - without it the page gets
        // an opaque origin and the renderer dies on the first section. See
        // READER_BASE_URL.
        source={{ html: READER_HTML, baseUrl: READER_BASE_URL }}
        originWhitelist={["*"]}
        javaScriptEnabled
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        // Android only, and the whole reason a failed open used to look like
        // an endless "Preparing book…": when the WebView's renderer process
        // dies, every channel this reader listens on dies with it. No
        // `relocate` ever arrives, so ui.status stays "preparing" and the
        // opaque overlay sits on top of a dead WebView forever.
        // react-native-webview notices (it logs "The WebView rendering
        // process crashed"), so turn that into the terminal error state the
        // reader already knows how to show - with a Retry, since a fresh
        // renderer often succeeds.
        onRenderProcessGone={() => dispatch({ type: "rendererGone" })}
        style={{ flex: 1, backgroundColor: pageBg }}
      />
      {ui.status !== "ready" ? (
        // Deliberately an overlay, not a screen of its own: the reader keeps
        // the book's own paper colour behind it, so a failure never flashes
        // the app's background over whatever was being read. The dead WebView
        // stays mounted too - Try again remounts it (see `attempt`).
        <View style={StyleSheet.absoluteFill} testID="reader-overlay">
          <View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]} />
          <View className="flex-1 items-center justify-center p-6">
            <View
              className="w-full gap-4 rounded-[20px] border border-border bg-card p-6"
              style={[{ maxWidth: 320 }, CARD_SHADOW]}
            >
              {ui.status === "preparing" ? (
                <>
                  <View className="flex-row items-center gap-3">
                    <View className="h-11 w-11 items-center justify-center rounded-xl bg-muted">
                      <Icon name="book-outline" size={22} color={tokens.mutedForeground} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-medium leading-5 text-foreground" numberOfLines={2}>
                        {file.name}
                      </Text>
                      <Text className="mt-0.5 text-xs text-muted-foreground">{formatBytes(file.size_bytes)}</Text>
                    </View>
                  </View>
                  <View className="gap-2">
                    <View testID="reader-prepare-progress" className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <View
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round(prepareProgress(ui.stage, delivered) * 100)}%` }}
                      />
                    </View>
                    <Text testID="reader-stage-label" className="text-[13px] text-muted-foreground">
                      {stageLabel(ui.stage)}
                    </Text>
                  </View>
                  <Pressable
                    onPress={onClose}
                    accessibilityRole="button"
                    testID="reader-prepare-cancel"
                    className="h-11 items-center justify-center rounded-xl"
                  >
                    <Text className="text-[15px] text-muted-foreground">{t("common.cancel")}</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <View className="flex-row items-start gap-3">
                    <View className="h-11 w-11 items-center justify-center rounded-xl bg-destructive/10">
                      <Icon name="alert-circle-outline" size={22} color={tokens.destructive} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[17px] font-bold leading-[22px] text-foreground">
                        {t("reader.error.thisBookDidnTOpen")}
                      </Text>
                      <Text className="mt-1 text-[13px] leading-[19px] text-muted-foreground">
                        {errorCopy(ui.errorKind)}
                      </Text>
                    </View>
                  </View>
                  <View className="gap-2">
                    <Pressable
                      onPress={retry}
                      accessibilityRole="button"
                      testID="reader-error-retry"
                      className="h-[50px] items-center justify-center rounded-[14px] bg-primary px-5"
                    >
                      <Text className="text-base font-medium text-primary-foreground">{t("common.action.tryAgain")}</Text>
                    </Pressable>
                    <Pressable
                      onPress={onClose}
                      accessibilityRole="button"
                      testID="reader-error-close"
                      className="h-[46px] items-center justify-center rounded-[14px] bg-muted px-5"
                    >
                      <Text className="text-[15px] text-foreground">{t("reader.action.closeBook")}</Text>
                    </Pressable>
                  </View>
                  {onOpenDetails ? (
                    <Pressable
                      onPress={onOpenDetails}
                      accessibilityRole="button"
                      testID="reader-error-details"
                      className="items-center py-1.5"
                    >
                      <Text className="text-[13px] text-muted-foreground underline">{t("common.label.fileDetails")}</Text>
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          </View>
        </View>
      ) : null}
      <ReaderChrome visible={ui.chromeVisible && ui.status !== "error"} onClose={onClose} onOpenMenu={() => setMenuOpen(true)} />
      <ReaderMenu
        visible={menuOpen}
        percent={Math.round(ui.fraction * 100)}
        canSearch={canSearch}
        canTheme
        bookmarked={bookmarked}
        onClose={() => setMenuOpen(false)}
        onContents={() => {
          setMenuOpen(false);
          setTocOpen(true);
        }}
        onSearch={() => {
          setMenuOpen(false);
          setSearchOpen(true);
        }}
        onThemes={() => {
          setMenuOpen(false);
          setThemesOpen(true);
        }}
        onShare={() => void shareFile(localUri)}
        onToggleBookmark={() => void toggleBookmark()}
      />
      <TocSheet
        visible={tocOpen}
        toc={ui.toc}
        bookmarks={bookState.bookmarks}
        onClose={() => setTocOpen(false)}
        onBack={() => {
          setTocOpen(false);
          setMenuOpen(true);
        }}
        onSelectToc={(href) => {
          webref.current?.injectJavaScript(jsGoTo(href));
          setTocOpen(false);
        }}
        onSelectBookmark={(b) => {
          webref.current?.injectJavaScript(jsGoTo(b.location));
          setTocOpen(false);
        }}
        onRemoveBookmark={(id) => {
          void updateReadingState(file.id, (current) => removeBookmark(current, id)).then(setBookState);
        }}
      />
      <ThemesSheet
        visible={themesOpen}
        onClose={() => setThemesOpen(false)}
        onBack={() => {
          setThemesOpen(false);
          setMenuOpen(true);
        }}
      />
      <SearchSheet
        visible={searchOpen}
        hits={searchHits}
        searching={searching}
        error={searchError}
        onQuery={onSearchQuery}
        onSelect={(cfi) => {
          webref.current?.injectJavaScript(jsGoTo(cfi));
          closeSearch();
        }}
        onClose={closeSearch}
        onBack={() => {
          closeSearch();
          setMenuOpen(true);
        }}
      />
    </View>
  );
}
