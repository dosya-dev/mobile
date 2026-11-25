import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Pressable, RefreshControl, SectionList, View, type ViewToken } from "react-native";
import Animated from "react-native-reanimated";
import { useRouter } from "expo-router";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { FileThumb } from "@/files/FileThumb";
import { FileRow } from "@/files/FileRow";
import { FileCard } from "@/files/FileCard";
import type { FileViewMode } from "@/files/viewPrefs";
import { formatBytes, normalizeExt } from "@/files/format";
import { fileOpenPath } from "@/files/file-open";
import { isFullLock, isKnownLocked } from "@/files/lock";
import { useViewerList } from "@/viewer/viewerStore";
import { useLibrary } from "./hooks";
import { mergeLibraryPages, chunkRows } from "./grouping";
import { LIBRARY_PAGE_SIZE, KIND_KEYS, plural, type LibraryItem, type LibraryKind, type LibrarySort } from "./api";
import { useT } from "@/lib/i18n";
import { byteCount } from "@/lib/format-locale";
import { isLiveStill } from "@/files/livePhotos";
import { VideoPoster } from "@/files/VideoPoster";
import { SelectCheck } from "@/files/SelectCheck";
import { useSelectedScale } from "@/files/selection/useSelectedScale";
import { useKeyedCallbacks } from "@/files/selection/useKeyedCallbacks";
import { useSelectionMotion, visibleRowsOf } from "@/files/selection/SelectionMotion";

const PHOTO_COLUMNS = 3;
const VIDEO_COLUMNS = 2;
const DOC_COLUMNS = 3;
const GUTTER = 2;

const EMPTY_ICON: Record<LibraryKind, IconName> = {
  photos: "images-outline",
  videos: "videocam-outline",
  documents: "document-outline",
};

/** `rowStart`: the flat index of the section's first row across all sections, for the check circles' wave. */
type Section = { key: string; title: string; count: number; loaded: number; rowStart: number; data: LibraryItem[][] };

const NO_SELECTION: ReadonlySet<string> = new Set();

type TileProps = {
  file: LibraryItem;
  /** Selection mode: a tap toggles instead of opening, and a hold does nothing. */
  selectable: boolean;
  selected: boolean;
  /** Check circle mounted; stays true through the selection exit fade. */
  checks: boolean;
  row: number;
  col: number;
  onOpen: () => void;
  onToggle: () => void;
  onMore?: () => void;
};

/**
 * One photo in the 3-up grid. Memoised with stable callbacks from the browser,
 * so a tap in selection mode re-renders this tile only. Square at rest; a
 * selected tile shrinks and rounds (useSelectedScale).
 */
const PhotoTile = memo(function PhotoTile({ file, selectable, selected, checks, row, col, onOpen, onToggle, onMore }: TileProps) {
  const scaleStyle = useSelectedScale(selected, 0);
  return (
    <Pressable
      testID={`photo-${file.id}`}
      accessibilityRole="button"
      accessibilityLabel={file.name}
      accessibilityState={selectable ? { selected } : undefined}
      onPress={selectable ? onToggle : onOpen}
      onLongPress={selectable ? undefined : onMore}
      style={{ flex: 1 }}
    >
      <Animated.View className="relative overflow-hidden" style={scaleStyle}>
        <FileThumb file={file} variant="photo" live={isLiveStill(file)} />
        {isKnownLocked(file) ? (
          <View className="absolute end-1 top-1 rounded-full bg-black/50 p-1">
            <Icon name="lock-closed" size={12} color="#ffffff" />
          </View>
        ) : null}
        {checks ? <SelectCheck selected={selected} testID={`select-${file.id}`} overlay row={row} col={col} /> : null}
      </Animated.View>
    </Pressable>
  );
});

/** One video in the 2-up grid: a 16:9 plate with its poster, play mark, format pill and name. Memoised like PhotoTile. */
const VideoTile = memo(function VideoTile({ file, selectable, selected, checks, row, col, onOpen, onToggle, onMore }: TileProps) {
  const scaleStyle = useSelectedScale(selected);
  // Only a full lock hides the play mark - a view-only video streams fine, so its card keeps the affordance.
  const locked = isFullLock(file);
  return (
    <Pressable
      testID={`video-${file.id}`}
      accessibilityRole="button"
      accessibilityLabel={file.name}
      accessibilityState={selectable ? { selected } : undefined}
      onPress={selectable ? onToggle : onOpen}
      onLongPress={selectable ? undefined : onMore}
      style={{ flex: 1, aspectRatio: 16 / 9 }}
    >
      <Animated.View style={[{ flex: 1 }, scaleStyle]} className="relative overflow-hidden bg-muted">
        <VideoPoster file={file} />
        <View className="absolute inset-0 items-center justify-center">
          <View className="rounded-full bg-black/45 p-2">
            <Icon testID={`video-${locked ? "lock" : "play"}-${file.id}`} name={locked ? "lock-closed" : "play-circle"} size={36} color="#ffffff" />
          </View>
        </View>
        <View className="absolute end-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5">
          <Text className="text-[10px] font-semibold uppercase text-white">{normalizeExt(file.extension).toUpperCase() || "VIDEO"}</Text>
        </View>
        <View className="absolute inset-x-0 bottom-0 bg-black/50 px-2 pb-1.5 pt-4">
          <Text className="text-xs font-medium text-white" numberOfLines={1}>{file.name}</Text>
          <Text className="text-[10px] text-white/80">{formatBytes(file.size_bytes)}</Text>
        </View>
        {checks ? <SelectCheck selected={selected} testID={`select-${file.id}`} overlay row={row} col={col} /> : null}
      </Animated.View>
    </Pressable>
  );
});

/**
 * A row's key: its files' ids. With onViewableItemsChanged set, SectionList
 * also runs the key extractor on the visible section headers and footers,
 * passing the section object in place of a row - it must not assume an array
 * (calling .map on a section crashed the app, 1.0.9 build 47).
 */
export function libraryRowKey(row: LibraryItem[] | { title?: string }, index: number): string {
  return Array.isArray(row) ? row.map((f) => f.id).join("|") : `section:${row.title ?? index}`;
}

/**
 * The Library view: every file of the given `kind` in the workspace, grouped
 * by month, newest first, with a full-width Load more button instead of
 * pages.
 *
 * Rows, not cells, are the SectionList items - it lays out one column, so a
 * multi-up grid is a list of rows. Tap opens the viewer with the whole loaded
 * library as its context; long-press hands the item to the caller's actions
 * sheet, which already knows how to move / share / delete a file.
 *
 * `kind` picks the query (useLibrary is keyed by it); `layout` picks the row
 * shape. `"list"` renders one `FileRow` per item for every kind. `"grid"`
 * renders each kind's own tile: photos 3-up `FileThumb variant="photo"`
 * tiles, videos 2-up 16:9 plate cards, and documents 3-up `FileCard` tiles
 * (the same square tile the All grid uses).
 *
 * Selection (owned by the caller, FileBrowser): while `selectable`, a tap
 * toggles the item through `onToggleSelect` instead of opening it, and every
 * tile shows a check circle (`checks` keeps them mounted through the exit
 * fade). `onLoadedFiles` hands the caller the merged loaded list so it can
 * carry Live Photo twins along on a move. The visible rows, counted across
 * months, go to the selection motion for the circles' entrance wave.
 */
export function LibraryBrowser({ workspaceId, kind, sort = "taken_desc", layout, onMore, selectable = false, checks, selected = NO_SELECTION, onToggleSelect, onLoadedFiles }: {
  workspaceId: string | null; kind: LibraryKind; sort?: LibrarySort; layout: FileViewMode; onMore?: (file: LibraryItem) => void;
  selectable?: boolean;
  /** Check circles mounted (defaults to `selectable`). */
  checks?: boolean;
  selected?: ReadonlySet<string>;
  onToggleSelect?: (id: string) => void;
  /** Called with the merged loaded list whenever it changes. */
  onLoadedFiles?: (files: LibraryItem[]) => void;
}) {
  const { tokens } = useColorTheme();
  const router = useRouter();
  const setViewerList = useViewerList((s) => s.setViewerList);
  const q = useLibrary(workspaceId, kind, sort);
  const lib = useMemo(() => mergeLibraryPages(q.data?.pages ?? []), [q.data]);
  const t = useT();
  const keys = KIND_KEYS[kind];

  const rowsFor = (files: LibraryItem[]) => {
    if (layout === "list") return chunkRows(files, 1);
    if (kind === "photos") return chunkRows(files, PHOTO_COLUMNS);
    if (kind === "videos") return chunkRows(files, VIDEO_COLUMNS);
    return chunkRows(files, DOC_COLUMNS);
  };

  let rowStart = 0;
  const sections: Section[] = lib.months.map((m) => {
    const data = rowsFor(m.files);
    const section = { key: m.key, title: m.label, count: m.count, loaded: m.files.length, rowStart, data };
    rowStart += data.length;
    return section;
  });

  const openFile = (f: LibraryItem) => {
    setViewerList(lib.files, t(keys.title));
    router.push(fileOpenPath(f) as never);
  };

  const onLoadedRef = useRef(onLoadedFiles);
  onLoadedRef.current = onLoadedFiles;
  useEffect(() => { onLoadedRef.current?.(lib.files); }, [lib.files]);

  // A SectionList refuses a new onViewableItemsChanged after mount, so the
  // handler is stable and reads the latest motion through a ref. Section
  // headers have no index; a row's flat index is its section's start + index.
  const motion = useSelectionMotion();
  const reportRef = useRef(motion.reportVisibleRows);
  reportRef.current = motion.reportVisibleRows;
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const rows = viewableItems
      .filter((v) => v.index !== null && v.index !== undefined && v.section)
      .map((v) => ({ index: (v.section as Section).rowStart + (v.index as number) }));
    const { first, count } = visibleRowsOf(rows, 1);
    reportRef.current(first, count);
  }, []);

  // Tiles are memoised, so their callbacks keep their identity across renders.
  const cb = useKeyedCallbacks();
  const showChecks = checks ?? selectable;
  const extraData = useMemo(() => [selectable, showChecks, selected], [selectable, showChecks, selected]);
  const tileProps = (f: LibraryItem, row: number, col: number): TileProps => ({
    file: f, selectable, selected: selected.has(f.id), checks: showChecks, row, col,
    onOpen: cb(`open:${f.id}`, () => openFile(f)),
    onToggle: cb(`toggle:${f.id}`, () => onToggleSelect?.(f.id)),
    onMore: onMore ? cb(`more:${f.id}`, () => onMore(f)) : undefined,
  });

  // A null workspace means the active workspace has not resolved yet, and
  // useLibrary is disabled until it does - so the query never reports loading
  // and the empty state below claimed the library was empty about a library
  // nobody had asked for. It is a wait, so it renders as one.
  if (!workspaceId || q.isLoading) {
    return <View testID={`${kind}-loading`} className="flex-1 items-center justify-center"><ActivityIndicator /></View>;
  }
  if (q.isError) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-destructive mb-3">{t(keys.loadError)}</Text>
        <Pressable onPress={() => q.refetch()} className="rounded-lg bg-primary px-4 py-2">
          <Text className="text-primary-foreground">{t("common.retry")}</Text>
        </Pressable>
      </View>
    );
  }

  const remaining = Math.max(0, lib.total - lib.loaded);
  const pct = lib.total > 0 ? Math.max(2, Math.round((lib.loaded / lib.total) * 100)) : 100;

  return (
    <SectionList
      sections={sections}
      keyExtractor={libraryRowKey}
      stickySectionHeadersEnabled
      contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
      renderSectionHeader={({ section }) => (
        <View className="flex-row items-baseline gap-2 bg-background px-4 pb-1.5 pt-3">
          <Text className="text-sm font-semibold text-foreground">{section.title}</Text>
          <Text className="text-xs text-muted-foreground">{plural(kind, section.count, t)}</Text>
          {section.loaded < section.count ? <Text className="text-xs text-muted-foreground">{t("files.label.filecountLoaded", { fileCount: byteCount(section.loaded) })}</Text> : null}
        </View>
      )}
      extraData={extraData}
      onViewableItemsChanged={onViewableItemsChanged}
      renderItem={({ item, index, section }) => {
        const row = section.rowStart + index;
        if (layout === "list") {
          const p = tileProps(item[0], row, 0);
          return (
            <FileRow
              file={p.file} onPress={p.onOpen} onMore={p.onMore}
              selectable={selectable} checks={showChecks} selected={p.selected} onToggleSelect={p.onToggle} row={row}
            />
          );
        }
        if (kind === "documents") {
          return (
            // paddingHorizontal: 8 matches the All grid's contentContainerStyle
            // (FileBrowser.tsx), so document tiles sit at the same edge inset.
            <View style={{ flexDirection: "row", paddingHorizontal: 8 }}>
              {item.map((f, col) => {
                const p = tileProps(f, row, col);
                return (
                  <FileCard
                    key={f.id} file={f} onPress={p.onOpen} onMore={p.onMore}
                    selectable={selectable} checks={showChecks} selected={p.selected} onToggleSelect={p.onToggle} row={row} col={col}
                  />
                );
              })}
              {Array.from({ length: DOC_COLUMNS - item.length }, (_, i) => <View key={`pad-${i}`} className="flex-1 p-1.5" />)}
            </View>
          );
        }
        if (kind === "videos") {
          return (
            <View style={{ flexDirection: "row", gap: GUTTER, paddingHorizontal: GUTTER, marginBottom: GUTTER }}>
              {item.map((f, col) => <VideoTile key={f.id} {...tileProps(f, row, col)} />)}
              {Array.from({ length: VIDEO_COLUMNS - item.length }, (_, i) => <View key={`pad-${i}`} style={{ flex: 1 }} />)}
            </View>
          );
        }
        return (
          <View style={{ flexDirection: "row", gap: GUTTER, paddingHorizontal: GUTTER, marginBottom: GUTTER }}>
            {item.map((f, col) => <PhotoTile key={f.id} {...tileProps(f, row, col)} />)}
            {Array.from({ length: PHOTO_COLUMNS - item.length }, (_, i) => <View key={`pad-${i}`} style={{ flex: 1 }} />)}
          </View>
        );
      }}
      ListEmptyComponent={
        <View testID={`${kind}-empty`} className="flex-1 items-center justify-center px-8">
          <Icon name={EMPTY_ICON[kind]} size={40} color={tokens.mutedForeground} />
          <Text className="mt-3 text-sm font-semibold text-foreground">{t(keys.emptyTitle)}</Text>
          <Text className="mt-1 text-center text-xs text-muted-foreground">{t(keys.emptyDescription)}</Text>
        </View>
      }
      ListFooterComponent={
        lib.loaded === 0 ? null : lib.hasMore ? (
          <View className="items-center px-4 pt-4">
            <Text className="text-xs text-muted-foreground">{t(keys.showing, { loaded: byteCount(lib.loaded), total: byteCount(lib.total) })}</Text>
            <View className="my-2 h-0.5 w-40 overflow-hidden rounded-full bg-muted">
              <View className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </View>
            <Pressable
              testID="load-more"
              accessibilityRole="button"
              disabled={q.isFetchingNextPage}
              onPress={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
              className="w-full items-center rounded-xl border border-border py-2.5"
            >
              {q.isFetchingNextPage ? <ActivityIndicator /> : <Text className="text-sm text-foreground">{t("files.label.loadMinMore", { min: byteCount(Math.min(LIBRARY_PAGE_SIZE, remaining)) })}</Text>}
            </Pressable>
          </View>
        ) : (
          <View className="items-center pt-4"><Text className="text-xs text-muted-foreground">{t(keys.allLoaded, { count: lib.total })}</Text></View>
        )
      }
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => q.refetch()} tintColor={tokens.primary} />}
    />
  );
}
