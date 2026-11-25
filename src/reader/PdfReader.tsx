import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Pdf from "react-native-pdf";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { Button } from "@/ui/Button";
import { shareFile } from "@/files/download";
import type { TocItem } from "./bridge";
import { flattenPdfOutline, pageLocation, parsePageLocation, type PdfOutlineNode } from "./pdfToc";
import {
  ReadingState,
  EMPTY_STATE,
  loadReadingState,
  updateReadingState,
  addBookmark,
  removeBookmark,
  hasBookmarkAt,
  createPositionSaver,
} from "./readingState";
import { useReaderPrefs } from "./readerPrefs";
import { themeById } from "./readerThemes";
import { ReaderChrome } from "./ReaderChrome";
import { ReaderMenu } from "./ReaderMenu";
import { TocSheet } from "./TocSheet";
import { localDigits } from "@/lib/format-locale";

export function PdfReader({
  file,
  localUri,
  onClose,
  onOpenDetails,
}: {
  file: { id: string; name: string };
  localUri: string;
  onClose: () => void;
  onOpenDetails?: () => void;
}) {
  const t = useT();
  const { themeId } = useReaderPrefs();
  const [resolved, setResolved] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bookState, setBookState] = useState<ReadingState>(EMPTY_STATE);
  const saverRef = useRef(createPositionSaver(file.id));
  // Tracks whether a real (post-resume) onPageChanged has already fired, so
  // the resumed location - which loads asynchronously and may resolve after
  // the reader has already moved on - never clobbers a live page with a
  // stale one.
  const pageReportedRef = useRef(false);
  // Ref mirror of `resolved`, read synchronously inside onPageChanged (a
  // stable useCallback closure would otherwise see a stale `resolved` from
  // its first render, and state alone can't be read synchronously anyway).
  const resolvedRef = useRef(false);
  // The page this reader last commanded or was told about, read
  // synchronously inside onPageChanged so it can tell a page the person
  // turned (swipe/scroll in the native view) from the native echo of a jump
  // we asked for (resume, contents, bookmark). Only the former is reading,
  // and only reading hides the controls.
  const pageRef = useRef(1);
  const jumpTo = (p: number) => {
    pageRef.current = p;
    setPage(p);
  };

  useEffect(() => {
    let cancelled = false;
    void loadReadingState(file.id).then((state) => {
      if (cancelled) return;
      setBookState(state);
      if (!pageReportedRef.current) jumpTo(parsePageLocation(state.location) ?? 1);
      resolvedRef.current = true;
      setResolved(true);
    });
    const saver = saverRef.current;
    return () => {
      cancelled = true;
      void saver.flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const onLoadComplete = useCallback((count: number, _path: string, _size: unknown, outline?: PdfOutlineNode[]) => {
    setPageCount(count);
    setToc(flattenPdfOutline(outline));
  }, []);

  const onPageChanged = useCallback((p: number, count: number) => {
    // The native view fires its own initial-settle onPageChanged as soon as
    // it displays a first page (Android: PdfView's OnPageChangeListener;
    // iOS: PDFViewPageChangedNotification) - this can arrive before the
    // saved reading state has resolved. Treating that as a real navigation
    // would both block the resume (via pageReportedRef) and arm the position
    // saver with a page the user never actually chose, risking overwriting
    // their real saved position on flush. Ignore it entirely until resolved;
    // once resolved, the native echo of our own commanded jump re-reports
    // the same location we already set, which is harmless.
    if (!resolvedRef.current) return;
    pageReportedRef.current = true;
    const turned = p !== pageRef.current;
    pageRef.current = p;
    setPage(p);
    setPageCount(count);
    saverRef.current.update(pageLocation(p), count > 0 ? p / count : 0);
    // Turning a page means reading: the controls get out of the way (the
    // book reader does the same on a swipe or a tap-turn - see decideTap).
    if (turned) setChromeVisible(false);
  }, []);

  const toggleBookmark = async () => {
    const location = pageLocation(page);
    const label = t("reader.label.pagePage", { page: localDigits(page) });
    const next = await updateReadingState(file.id, (current) => {
      const existing = hasBookmarkAt(current, location);
      return existing ? removeBookmark(current, existing.id) : addBookmark(current, location, label);
    });
    setBookState(next);
  };

  if (errorMessage) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background p-8">
        <Text className="text-lg text-foreground">{t("reader.error.couldnTOpenThisBook")}</Text>
        <Button title={t("common.close")} onPress={onClose} testID="reader-error-close" />
        {onOpenDetails ? (
          <Button title={t("reader.action.openFileDetails")} variant="ghost" onPress={onOpenDetails} testID="reader-error-details" />
        ) : null}
      </View>
    );
  }

  const pageBg = themeById(themeId).bg;
  const bookmarked = hasBookmarkAt(bookState, pageLocation(page)) !== undefined;
  const percent = pageCount > 0 ? Math.round((page / pageCount) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: pageBg }}>
      <Pdf
        source={{ uri: localUri }}
        page={page}
        style={{ flex: 1, backgroundColor: pageBg }}
        onLoadComplete={onLoadComplete}
        onPageChanged={onPageChanged}
        onPageSingleTap={() => setChromeVisible((v) => !v)}
        onError={() => setErrorMessage(t("reader.error.couldnTOpenThisBook"))}
      />
      {!resolved ? (
        <View style={StyleSheet.absoluteFill} className="items-center justify-center bg-background">
          <ActivityIndicator />
        </View>
      ) : null}
      <ReaderChrome visible={chromeVisible} onClose={onClose} onOpenMenu={() => setMenuOpen(true)} />
      <ReaderMenu
        visible={menuOpen}
        percent={percent}
        canSearch={false}
        canTheme={false}
        bookmarked={bookmarked}
        onClose={() => setMenuOpen(false)}
        onContents={() => {
          setMenuOpen(false);
          setTocOpen(true);
        }}
        onSearch={() => {}}
        onThemes={() => {}}
        onShare={() => void shareFile(localUri)}
        onToggleBookmark={() => void toggleBookmark()}
      />
      <TocSheet
        visible={tocOpen}
        toc={toc}
        bookmarks={bookState.bookmarks}
        onClose={() => setTocOpen(false)}
        onBack={() => {
          setTocOpen(false);
          setMenuOpen(true);
        }}
        onSelectToc={(href) => {
          jumpTo(Number(href));
          setTocOpen(false);
        }}
        onSelectBookmark={(b) => {
          const target = parsePageLocation(b.location);
          if (target) jumpTo(target);
          setTocOpen(false);
        }}
        onRemoveBookmark={(id) => {
          void updateReadingState(file.id, (current) => removeBookmark(current, id)).then(setBookState);
        }}
      />
    </View>
  );
}
