import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, View, type ViewToken } from "react-native";
import * as Haptics from "expo-haptics";
// gesture-handler's FlatList: its scroll is a gesture the hold-to-drag pan can
// cancel natively once it activates, so the list cannot take a drag over.
import { FlatList } from "react-native-gesture-handler";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { useFocusEffect, useRouter } from "expo-router";
import { useColorTheme } from "@/theme/useColorTheme";
import { PromptDialog } from "@/ui/PromptDialog";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { ActionSheet } from "@/ui/ActionSheet";
import { toast } from "@/ui/toast";
import { describeFolderPurge } from "./folderPurge";
import { useWorkspaceStore } from "./workspaceStore";
import { useWorkspaces, useFileList } from "./hooks";
import { useFileMutations } from "./mutationHooks";
import { fileKind } from "./format";
import { playFolder } from "@/player/controller";
import { fileOpenPath } from "./file-open";
import { useViewerList } from "@/viewer/viewerStore";
import { FileRow } from "./FileRow";
import { FolderRow } from "./FolderRow";
import { FileCard } from "./FileCard";
import { FolderCard } from "./FolderCard";
import { useViewPrefs, type FileViewMode } from "./viewPrefs";
import { foldersFromPages, filesFromPages } from "./file-list-view";
import { FileActionsSheet } from "./FileActionsSheet";
import { FolderActionsSheet } from "./FolderActionsSheet";
import { usePermissions } from "@/workspace/usePermissions";
import { useUploadTarget } from "@/orbit/uploadTargetStore";
import { useAuthStore } from "@/auth/authStore";
import { FirstLoadSplash } from "./FirstLoadSplash";
import { FolderInfoDialog } from "./FolderInfoDialog";
import { LockDialog, type LockTarget } from "./LockDialog";
import { setFolderHidden, setFileHidden } from "./mutations";
import { AddToGroupSheet } from "@/groups/AddToGroupSheet";
import { LibraryBrowser } from "@/library/LibraryBrowser";
import { kindForFilter, librarySortOptions, plural, type LibraryItem, type LibrarySort } from "@/library/api";
import { useLibraryTotal } from "@/library/hooks";
import { ViewToggleButton } from "./ViewToggleButton";
import type { FileFilter, FileSort, FileItem, FolderItem } from "./types";
import { collapseLiveTwins, twinsUnderStills, isLiveStill } from "./livePhotos";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import { MoveConfirmDialog, type MoveTarget } from "./MoveConfirmDialog";
import { OfflineBanner } from "@/offline/ui/OfflineBanner";
import { OfflinePinConfirm } from "@/offline/ui/offlineActions";
import { useDragMove } from "./useDragMove";
import { useFilesInteraction } from "./menu/interactionStore";
import { DragGhost } from "./DragGhost";
import { canDragInView, moveCount, type DragItem, type MoveItems } from "./dragMove";
import { describeMoveOutcome, liveTwinIds, moveItems } from "./bulkMove";
import { SwipeRow } from "./SwipeRow";
import { useFilesView } from "./filesViewStore";
import { SelectionMotionScope, useSelectionMotionState, visibleRowsOf } from "./selection/SelectionMotion";
import { SelectionHeader } from "./selection/SelectionHeader";
import { HeaderSwap } from "./selection/HeaderSwap";
import { useKeyedCallbacks } from "./selection/useKeyedCallbacks";
import { nextMoveToken, useSelectionMoves } from "./selection/selectionMoveStore";

type OperationTarget = { kind: "file" | "folder"; id: string; name: string };

/** Web's six, verbatim - same values, same labels, same order. */
const SORTS: { key: FileSort; label: MessageKey }[] = [
  { key: "newest", label: "files.option.newest" },
  { key: "oldest", label: "files.option.oldest" },
  { key: "name_asc", label: "files.option.nameAZ" },
  { key: "name_desc", label: "files.option.nameZA" },
  { key: "largest", label: "files.option.largest" },
  { key: "smallest", label: "files.option.smallest" },
];

type Row = { type: "folder"; item: FolderItem } | { type: "file"; item: FileItem };
type ListItem = Row | { type: "spacer"; id: string };

const GRID_COLUMNS = 3;

export function FileBrowser({
  folderId,
  folderName = null,
  header,
  banner,
}: {
  folderId: string | null;
  folderName?: string | null;
  /**
   * Rendered above the toolbar. As a function it receives the view tools
   * (play all, sort, list/grid) to place in the header itself, and the toolbar
   * under it keeps only the count (the Files root does this).
   */
  header?: ReactNode | ((tools: ReactNode) => ReactNode);
  /**
   * Rendered under the header slot, outside the selection swap (the Files root
   * passes the deletion banner): the selection row centres on the header row
   * alone and the banner stays visible while selecting.
   */
  banner?: ReactNode;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const router = useRouter();
  const workspaces = useWorkspaces();
  const activeId = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  // The view comes from the menu's store and applies to the Files root only; a folder always shows everything.
  const rootView = useFilesView((s) => s.view);
  const filter: FileFilter = folderId === null ? rootView : "all";
  const libraryKind = kindForFilter(filter);
  const isLibraryView = libraryKind !== null;
  const [sort, setSort] = useState<FileSort>("newest");
  // One library order for Photos, Videos and Documents, in memory like the folder sort.
  const [librarySort, setLibrarySort] = useState<LibrarySort>("taken_desc");
  const [sortOpen, setSortOpen] = useState(false);
  const [sheetFile, setSheetFile] = useState<FileItem | null>(null);
  const [sheetFolder, setSheetFolder] = useState<FolderItem | null>(null);
  const [renameTarget, setRenameTarget] = useState<OperationTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OperationTarget | null>(null);
  const [infoFolder, setInfoFolder] = useState<FolderItem | null>(null);
  const [lockTarget, setLockTarget] = useState<LockTarget | null>(null);
  const [hideFolder, setHideFolder] = useState<FolderItem | null>(null);
  const [hideFile, setHideFile] = useState<FileItem | null>(null);
  const [groupTarget, setGroupTarget] = useState<{ kind: "folder" | "file"; id: string; name: string } | null>(null);
  const { can, userId } = usePermissions();
  const setUploadTarget = useUploadTarget((s) => s.setTarget);
  const setViewerList = useViewerList((s) => s.setViewerList);

  // Selection mode and drag-to-move. Hold a row or card and move it onto a
  // folder: nothing moves on the drop, a confirm asks first and Move runs the
  // same bulk move the destination picker runs for a ticked selection.
  const [selecting, setSelecting] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedFolders, setSelectedFolders] = useState<ReadonlySet<string>>(() => new Set());
  const [dropMove, setDropMove] = useState<{ items: MoveItems; target: MoveTarget } | null>(null);
  const [moving, setMoving] = useState(false);
  // The library view's loaded list, reported by LibraryBrowser: what a
  // library selection is pruned against and where its Live Photo twins are found.
  const [libraryFiles, setLibraryFiles] = useState<LibraryItem[]>([]);

  const viewMode = useViewPrefs((s) => s.viewMode);
  const setViewMode = useViewPrefs((s) => s.setViewMode);
  const libraryLayout = useViewPrefs((s) => s.libraryLayout);
  const setLibraryLayout = useViewPrefs((s) => s.setLibraryLayout);
  const hydrateView = useViewPrefs((s) => s.hydrate);
  useEffect(() => { void hydrateView(); }, [hydrateView]);
  const isGrid = viewMode === "grid";
  // The toggle in the header reflects whichever mode is live: the folder
  // listing's viewMode outside library mode, or the tapped kind's own
  // libraryLayout entry inside it - each library kind remembers its own choice.
  const toggleMode = libraryKind ? libraryLayout[libraryKind] : viewMode;
  const libraryTotal = useLibraryTotal(activeId, libraryKind, librarySort);
  const setToggleMode = (m: FileViewMode) => {
    if (libraryKind) void setLibraryLayout(libraryKind, m);
    else void setViewMode(m);
  };

  const resolvingWorkspace = !activeId && (workspaces.isLoading || workspaces.isPending);

  // Direct-mutation handlers below (hide/unhide, lock save) refetch `q` for the
  // folder listing; in library mode (Images/Videos/Docs) `q` is a disabled
  // query, so those refetches would leave the library stale. They also
  // invalidate ["library"] so LibraryBrowser's own query picks the change up
  // regardless of which view is showing when the mutation lands.
  const queryClient = useQueryClient();
  const q = useFileList(activeId, folderId, filter, sort, { enabled: !isLibraryView });
  const authedUser = useAuthStore((s) => s.user);
  // Decided once, at mount: the splash exists only for a cold root mount with
  // no cached LISTING to paint (first login, or a cold start after a purge). A
  // warm mount has pages synchronously from the query cache and must never see
  // it - the splash would slow down the common case to decorate the rare one.
  // Deliberately keyed on the listing alone: OnboardingGate has already
  // resolved workspaces before this ever mounts, so requiring a cold
  // workspaces cache too would disqualify the splash on the exact flow it
  // exists for.
  const [firstLoad] = useState(() => folderId === null && !q.data);
  const pages = q.data?.pages ?? [];
  // Kept as its own array, not just flattened into `rows`: this exact list, in
  // this exact order, is what the viewer pages through.
  const files = filesFromPages(pages);
  // Fail closed on an absent payload: the endpoint refuses anyway, and
  // offering a locked door is the defect this fixes.
  const canLock = pages[0]?.can_lock ?? false;
  const canHide = pages[0]?.can_hide ?? false;
  const folderRows = foldersFromPages(pages, sort);
  const rows: Row[] = [
    ...folderRows.map((f) => ({ type: "folder" as const, item: f })),
    ...(isGrid ? collapseLiveTwins(files) : twinsUnderStills(files)).map((f) => ({ type: "file" as const, item: f })),
  ];

  // Dragging needs the permission "Move to..." asks for that kind of item.
  const canMoveFiles = can("upload_files");
  const canMoveFolders = can("rename_folders");
  const canSelect = canMoveFiles || canMoveFolders;
  // The files a selection is made from: the folder listing, or in a library
  // view the library's loaded list (its files can sit in any folder; the move
  // moves each by id).
  const selectableFiles: readonly FileItem[] = isLibraryView ? libraryFiles : files;
  const selectedCount = selectedFiles.size + selectedFolders.size;
  // Unticking the last item leaves selection mode, the same as ×.
  const toggleSelected = (item: DragItem) => {
    const prev = item.kind === "file" ? selectedFiles : selectedFolders;
    const next = new Set(prev);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    const others = item.kind === "file" ? selectedFolders : selectedFiles;
    if (next.size + others.size === 0) {
      clearSelection();
      return;
    }
    (item.kind === "file" ? setSelectedFiles : setSelectedFolders)(next);
  };
  const selectOne = (item: DragItem) => {
    if (!selecting) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelecting(true);
    (item.kind === "file" ? setSelectedFiles : setSelectedFolders)((prev) => new Set(prev).add(item.id));
  };
  const clearSelection = () => {
    setSelecting(false);
    setSelectedFiles(new Set());
    setSelectedFolders(new Set());
  };
  const nameOf = (kind: "file" | "folder", id: string): string | null =>
    (kind === "file" ? selectableFiles.find((f) => f.id === id)?.name : folderRows.find((f) => f.id === id)?.name) ?? null;

  // Ticks follow the listing: an item that left it (moved away by the picker,
  // deleted elsewhere, filtered out) is no longer selected, and when nothing
  // ticked remains selection mode ends with it. Keyed on the id lists, not the
  // arrays, which are rebuilt every render.
  const listedFileIds = selectableFiles.map((f) => f.id).join("\u0000");
  const listedFolderIds = folderRows.map((f) => f.id).join("\u0000");
  useEffect(() => {
    if (!selecting) return;
    const fileIds = new Set(listedFileIds ? listedFileIds.split("\u0000") : []);
    const folderIds = new Set(listedFolderIds ? listedFolderIds.split("\u0000") : []);
    const keptFiles = [...selectedFiles].filter((id) => fileIds.has(id));
    const keptFolders = [...selectedFolders].filter((id) => folderIds.has(id));
    if (keptFiles.length === selectedFiles.size && keptFolders.length === selectedFolders.size) return;
    if (keptFiles.length + keptFolders.length === 0) {
      setSelecting(false);
    }
    setSelectedFiles(new Set(keptFiles));
    setSelectedFolders(new Set(keptFolders));
    // selectedFiles/selectedFolders are read, not depended on: this reacts to
    // the LISTING changing, and a tick that is pruned re-runs it harmlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecting, listedFileIds, listedFolderIds]);

  const drag = useDragMove({
    enabled: !!activeId && canDragInView({ isLibrary: isLibraryView, isHidden: filter === "hidden" }),
    sourceFolderId: folderId,
    selectedFiles,
    selectedFolders,
    canDrag: (item) => (item.kind === "file" ? canMoveFiles : canMoveFolders),
    nameOfFolder: (id) => nameOf("folder", id) ?? "",
    onDrop: (items, target) => setDropMove({ items, target }),
    // A hold that never moved is the long press it always was: the item's
    // actions. In selection mode the tap already toggles, so a hold is nothing.
    onHold: (item) => {
      if (selecting) return;
      if (item.kind === "file") {
        const f = files.find((x) => x.id === item.id);
        if (f) setSheetFile(f);
      } else {
        const f = folderRows.find((x) => x.id === item.id);
        if (f) setSheetFolder(f);
      }
    },
  });

  const runDropMove = async () => {
    const m = dropMove;
    if (!m || moving) return;
    setMoving(true);
    try {
      const outcome = await moveItems(m.items, m.target.id, liveTwinIds(files, new Set(m.items.fileIds)));
      setDropMove(null);
      clearSelection();
      // The destination's own listing is cached too, so every folder listing
      // goes stale, and this one is refetched now so the rows leave at once.
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      await q.refetch();
      const { message, kind } = describeMoveOutcome(outcome, t);
      toast(message, kind);
    } finally {
      setMoving(false);
    }
  };

  // Move to... for a ticked selection: the destination picker does the move,
  // with the Live Photo videos it cannot look up itself passed along. A Cancel
  // in the picker comes back to the ticks. A move that succeeds ends selection
  // mode: the picker records this press's token in useSelectionMoves (in a
  // library view the moved files are still listed, so pruning alone would
  // leave them ticked).
  const moveToken = useRef<string | null>(null);
  const moveSelection = () => {
    if (selectedCount === 0) return;
    const twins = liveTwinIds(isLibraryView ? libraryFiles : files, selectedFiles);
    const token = nextMoveToken();
    moveToken.current = token;
    router.push({
      pathname: "/pick-destination",
      params: {
        fileIds: [...selectedFiles].join(","),
        folderIds: [...selectedFolders].join(","),
        mode: "move",
        ...(twins.length ? { twinIds: twins.join(",") } : {}),
        moveToken: token,
      },
    });
  };
  const movedToken = useSelectionMoves((s) => s.moved);
  useEffect(() => {
    if (!movedToken || movedToken !== moveToken.current) return;
    moveToken.current = null;
    clearSelection();
  }, [movedToken]);

  // A new view (Images -> Videos, a library -> All) is a new list: the ticks
  // from the old one end with it rather than leaving a partial subset.
  const shownFilter = useRef(filter);
  useEffect(() => {
    if (shownFilter.current === filter) return;
    shownFilter.current = filter;
    clearSelection();
  }, [filter]);
  // Grid: pad the last row with invisible spacers so a partial row left-aligns
  // (flex-1 tiles would otherwise stretch to fill the row).
  const padCount = isGrid ? (GRID_COLUMNS - (rows.length % GRID_COLUMNS)) % GRID_COLUMNS : 0;
  const data: ListItem[] = isGrid
    ? [...rows, ...Array.from({ length: padCount }, (_, i) => ({ type: "spacer" as const, id: `spacer-${i}` }))]
    : rows;

  const isPlayableAudio = (f: FileItem) => fileKind(f.mime_type, f.extension) === "audio" && f.lock_mode === "none";
  const hasAudio = rows.some((r) => r.type === "file" && isPlayableAudio(r.item));

  // Folder name for the player's artist line: last breadcrumb, or the
  // workspace name at the root. The listing carries breadcrumbs on every page.
  const sourceName =
    pages[0]?.breadcrumbs?.[(pages[0]?.breadcrumbs?.length ?? 0) - 1]?.name ??
    workspaces.data?.find((w) => w.id === activeId)?.name ??
    "dosya";

  const startPlayback = async (startFileId?: string) => {
    if (!activeId) return;
    try {
      const ok = await playFolder({ workspaceId: activeId, folderId, filter, sort, loadedPages: pages, sourceName, ...(startFileId ? { startFileId } : {}) });
      if (ok) router.push("/player");
    } catch {
      toast(t("files.error.couldnTStartPlayback"), "error");
    }
  };

  // Hand the viewer the files that are on screen, so it can page through them.
  // Published at the moment of the tap rather than on every render: it is a
  // one-shot hand-off, not a subscription, and re-publishing it while the user
  // is already inside the viewer would shuffle the pager under them the next
  // time a background refetch reorders the folder.
  //
  // EVERY type goes to the viewer, audio included. A tap on a track used to
  // start playback immediately, which meant the viewer's audio stage - artwork,
  // tags, duration - was unreachable. Playback is now one tap further on, and
  // the "Play all" control above still queues the whole folder in one go.
  const openFile = (f: FileItem) => {
    setViewerList(files, sourceName);
    router.push(fileOpenPath(f) as never);
  };

  // Hide/unhide is a straight toggle between "everyone" and "none"; web's per-user and
  // per-role targeting needs member pickers this screen doesn't have.
  const toggleHidden = async () => {
    const f = hideFolder;
    setHideFolder(null);
    if (!f) return;
    try {
      await setFolderHidden(f.id, f.is_hidden ? "none" : "everyone");
      await q.refetch();
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      toast(f.is_hidden ? t("files.status.folderUnhidden") : t("files.status.folderHidden"));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("files.error.couldnTUpdateTheFolder"), "error");
    }
  };

  const toggleHiddenFile = async () => {
    const f = hideFile;
    setHideFile(null);
    if (!f) return;
    try {
      // Only "none" or "everyone" - mobile has no member or role picker, so it
      // can clear a users/roles rule set on web but never author one.
      await setFileHidden(f.id, f.is_hidden ? "none" : "everyone");
      await q.refetch();
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      toast(f.is_hidden ? t("files.status.fileUnhidden") : t("files.status.fileHidden"));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("files.error.couldnTUpdateTheFile"), "error");
    }
  };

  // The `+` moved from this screen into the tab bar, where it is also on
  // screen from Backup and Settings. It can no longer READ the folder being
  // browsed, so the browser tells it - and keeps telling it, because the
  // workspace, the folder and the permission all change under it.
  //
  // Upload needs both the capability (upload_files) and the page permission
  // (access_upload) that the upload endpoints check; a viewer holds neither.
  // The Files menu's edge swipe stands down while a selection or a drag-move
  // owns the screen. Only the root has the swipe, so only the root reports.
  const setInteractionBusy = useFilesInteraction((s) => s.setBusy);
  const interactionBusy = selecting || drag.armed || !!drag.active;
  const isFilesRoot = folderId === null;
  useEffect(() => {
    if (isFilesRoot) setInteractionBusy(interactionBusy);
  }, [isFilesRoot, interactionBusy, setInteractionBusy]);
  useEffect(() => {
    if (!isFilesRoot) return;
    return () => setInteractionBusy(false);
  }, [isFilesRoot, setInteractionBusy]);
  const canAdd = can("upload_files") && can("access_upload");
  const canCreateFolder = can("create_folders");
  const workspaceName = workspaces.data?.find((w) => w.id === activeId)?.name ?? null;
  // Published on focus as well as on a dep change while focused: the root stays
  // mounted under a pushed folder, so popping back changes none of its deps and
  // a plain effect would leave the folder's target behind (New folder from the +
  // sheet would land in that folder). An unfocused screen does not publish.
  useFocusEffect(
    useCallback(() => {
      setUploadTarget({ workspaceId: activeId, folderId, folderName, workspaceName, canAdd, canCreateFolder });
    }, [setUploadTarget, activeId, folderId, folderName, workspaceName, canAdd, canCreateFolder]),
  );

  // One motion for every check circle and the header swap (see SelectionMotion).
  // The list reports its visible rows into it; FlatList refuses a new
  // onViewableItemsChanged after mount, so the handler is stable and reads refs.
  const motion = useSelectionMotionState(selecting);
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const columnsRef = useRef(1);
  columnsRef.current = isGrid ? GRID_COLUMNS : 1;
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const { first, count } = visibleRowsOf(viewableItems, columnsRef.current);
    motionRef.current.reportVisibleRows(first, count);
  }, []);

  // Tiles are memoised, so their callbacks must keep their identity across
  // renders: one stable function per item that calls the latest closure.
  const cb = useKeyedCallbacks();

  // The header keeps showing the last count while it fades out, so leaving
  // does not roll "0 selected" in on the way.
  const shownCount = useRef(selectedCount);
  if (selecting) shownCount.current = selectedCount;
  const selectionHeader = (
    <SelectionHeader
      count={shownCount.current}
      roll={selecting}
      onCancel={clearSelection}
      onMove={moveSelection}
      moveDisabled={selectedCount === 0}
    />
  );
  const tools = (
    <>
      {!isLibraryView && hasAudio ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t("files.action.playAll")} hitSlop={4} onPress={() => void startPlayback()} testID="play-all">
          <Icon name="play-circle-outline" size={20} color={tokens.primary} />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("files.action.sort")}
        hitSlop={4}
        onPress={() => setSortOpen(true)}
        testID="open-sort"
      >
        <Icon name="swap-vertical" size={18} color={tokens.mutedForeground} />
      </Pressable>
      <ViewToggleButton mode={toggleMode} onToggle={() => setToggleMode(toggleMode === "grid" ? "list" : "grid")} />
    </>
  );
  const count = libraryTotal !== null && libraryKind ? (
    <Text className="text-xs text-muted-foreground" numberOfLines={1} testID="files-count">{plural(libraryKind, libraryTotal, t)}</Text>
  ) : null;
  const toolsInHeader = typeof header === "function";
  const toolbar = toolsInHeader ? (
    // The tools sit in the header; only the count line is left, when there is one.
    count ? <View className="px-5 pb-2">{count}</View> : null
  ) : (
    <View className="flex-row items-center justify-between gap-3 px-5 py-2">
      {count ?? <View />}
      <View className="flex-row items-center gap-3">{tools}</View>
    </View>
  );
  const headerNode = toolsInHeader ? header(tools) : header;

  return (
    <SelectionMotionScope value={motion}>
    <View className="flex-1 bg-background">
      {/* The selection header takes the header slot: the Files root's own
          header when there is one (the toolbar stays under it), else the toolbar. */}
      {headerNode ? (
        <>
          <HeaderSwap selecting={selecting} normal={headerNode} selection={selectionHeader} />
          {banner}
          <OfflineBanner />
          {toolbar}
        </>
      ) : (
        <>
          <HeaderSwap selecting={selecting} normal={toolbar} selection={selectionHeader} />
          {banner}
          <OfflineBanner />
        </>
      )}

      {isLibraryView ? (
        // key: a hop to another kind or order remounts the SectionList, so it starts at the top instead of keeping the old scroll offset.
        <LibraryBrowser
          key={`${libraryKind}:${librarySort}`}
          workspaceId={activeId}
          kind={libraryKind}
          sort={librarySort}
          layout={libraryLayout[libraryKind]}
          onMore={(f) => setSheetFile(f)}
          selectable={selecting}
          checks={motion.checksMounted}
          selected={selectedFiles}
          onToggleSelect={(id) => toggleSelected({ id, kind: "file" })}
          onLoadedFiles={setLibraryFiles}
        />
      ) : resolvingWorkspace || q.isLoading ? (
        <View testID="browser-loading" className="flex-1 items-center justify-center"><ActivityIndicator /></View>
      ) : q.isError ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-destructive mb-3">{t("files.error.couldnTLoadFiles")}</Text>
          <Pressable onPress={() => q.refetch()} className="rounded-lg bg-primary px-4 py-2">
            <Text className="text-primary-foreground">{t("common.retry")}</Text>
          </Pressable>
        </View>
      ) : (
        // The area the drag ghost is positioned in; its window rectangle is
        // what the edge auto-scroll measures against.
        <View {...drag.areaProps} testID="file-list-area" className="flex-1">
        <FlatList
          key={isGrid ? "grid" : "list"}
          testID="file-list"
          {...drag.listProps}
          extraData={[selecting, motion.checksMounted, selectedFiles, selectedFolders, drag.overId, drag.armed]}
          data={data}
          numColumns={isGrid ? GRID_COLUMNS : 1}
          // flexGrow makes a short or empty list fill the viewport, so the whole area under
          // the rows is part of the scroll view and can be pulled - without it there's
          // nothing to grab below the last row.
          contentContainerStyle={isGrid ? { paddingHorizontal: 8, paddingTop: 4, flexGrow: 1 } : { flexGrow: 1 }}
          keyExtractor={(r) => (r.type === "spacer" ? r.id : r.type + ":" + r.item.id)}
          onViewableItemsChanged={onViewableItemsChanged}
          renderItem={({ item, index }) => {
            if (item.type === "spacer") return <View className="flex-1 p-1.5" />;
            const row = isGrid ? Math.floor(index / GRID_COLUMNS) : index;
            const col = isGrid ? index % GRID_COLUMNS : 0;
            // List rows swipe: right reveals Select, left reveals Delete, with
            // the same gates as the actions sheets. Not in the grid, not in
            // selection mode, and not while a hold is arming a drag.
            const swipeWrap = (id: string, canDelete: boolean, onDelete: () => void, node: ReactElement): ReactElement => (
              // Unwrapped until the checks' exit fade is over, so the row is not remounted mid-fade.
              isGrid || selecting || motion.checksMounted ? node : (
                <SwipeRow
                  id={id}
                  enabled={!drag.armed}
                  onSelect={canSelect ? () => selectOne({ id, kind: item.type === "folder" ? "folder" : "file" }) : undefined}
                  onDelete={canDelete ? onDelete : undefined}
                >
                  {node}
                </SwipeRow>
              )
            );
            if (item.type === "folder") {
              const f = item.item;
              const shared = {
                selectable: selecting,
                checks: motion.checksMounted,
                selected: selectedFolders.has(f.id),
                onToggleSelect: cb(`toggle:folder:${f.id}`, () => toggleSelected({ id: f.id, kind: "folder" })),
                drag: drag.handle({ id: f.id, kind: "folder" }),
                dropActive: drag.overId === f.id,
                targetRef: drag.targetRef(f.id),
                row,
                onPress: cb(`open:folder:${f.id}`, () => router.push({ pathname: "/folder/[id]", params: { id: f.id, name: f.name } })),
                onMore: cb(`more:folder:${f.id}`, () => setSheetFolder(f)),
              };
              if (isGrid) return <FolderCard folder={f} col={col} {...shared} />;
              return swipeWrap(
                f.id,
                can("delete_any_file") || can("delete_own_files"),
                () => setDeleteTarget({ kind: "folder", id: f.id, name: f.name }),
                <FolderRow folder={f} {...shared} />,
              );
            }
            const f = item.item;
            const shared = {
              selectable: selecting,
              checks: motion.checksMounted,
              selected: selectedFiles.has(f.id),
              onToggleSelect: cb(`toggle:file:${f.id}`, () => toggleSelected({ id: f.id, kind: "file" })),
              drag: drag.handle({ id: f.id, kind: "file" }),
              row,
              onPress: cb(`open:file:${f.id}`, () => openFile(f)),
              onMore: cb(`more:file:${f.id}`, () => setSheetFile(f)),
            };
            if (isGrid) return <FileCard file={f} live={isLiveStill(f)} col={col} {...shared} />;
            return swipeWrap(
              f.id,
              // Same rule as the file sheet and files/[id]: delete_any_file
              // covers everything, delete_own_files only this member's uploads.
              can("delete_any_file") || (can("delete_own_files") && f.uploaded_by === userId),
              () => setDeleteTarget({ kind: "file", id: f.id, name: f.name }),
              <FileRow file={f} {...shared} />,
            );
          }}
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage(); }}
          // The empty state lives inside the list, not beside it: rendering it as a sibling
          // meant an empty folder had no FlatList at all, so there was no refresh control
          // to pull.
          ListEmptyComponent={
            <View testID="browser-empty" className="flex-1 items-center justify-center px-8">
              <Text className="text-muted-foreground">{t("files.description.thisFolderIsEmpty")}</Text>
              {/* QA MOB-REG-007: a fresh account landed on "empty" with no
                  pointer to the + button or the folder icon. */}
              <Text className="mt-2 text-center text-xs text-muted-foreground" testID="browser-empty-hint">
                {t("files.description.tapToAddFilesOrTheFolderIconToCreateOne")}
              </Text>
            </View>
          }
          ListFooterComponent={q.isFetchingNextPage ? <View className="py-4"><ActivityIndicator /></View> : null}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => q.refetch()} tintColor={tokens.primary} />}
        />
        {drag.active ? (
          <DragGhost
            x={drag.ghostX}
            y={drag.ghostY}
            name={nameOf(drag.active.item.kind, drag.active.item.id) ?? ""}
            file={drag.active.item.kind === "file" ? files.find((f) => f.id === drag.active?.item.id) ?? null : null}
            count={moveCount(drag.active.items)}
          />
        ) : null}
        </View>
      )}

      {sheetFile ? (
        <FileActionsSheet
          file={sheetFile} visible onClose={() => setSheetFile(null)}
          onMove={(f) => { setSheetFile(null); router.push({ pathname: "/pick-destination", params: { fileId: f.id, mode: "move" } }); }}
          onCopy={(f) => { setSheetFile(null); router.push({ pathname: "/pick-destination", params: { fileId: f.id, mode: "copy" } }); }}
          onVersions={(f) => { setSheetFile(null); router.push(`/file/${f.id}/versions`); }}
          onComments={(f) => { setSheetFile(null); router.push({ pathname: "/comments", params: { fileId: f.id, name: f.name } }); }}
          onShare={(f) => { setSheetFile(null); router.push(`/file/${f.id}/share`); }}
          onRename={(f) => { setSheetFile(null); setRenameTarget({ kind: "file", id: f.id, name: f.name }); }}
          onDelete={(f) => { setSheetFile(null); setDeleteTarget({ kind: "file", id: f.id, name: f.name }); }}
          onLock={(f) => { setSheetFile(null); setLockTarget({ kind: "file", id: f.id, name: f.name, lock_mode: f.lock_mode, size_bytes: f.size_bytes, extension: f.extension }); }}
          onToggleHidden={(f) => { setSheetFile(null); setHideFile(f); }}
          onSelect={canSelect ? (f) => { setSheetFile(null); selectOne({ id: f.id, kind: "file" }); } : undefined}
          canLock={canLock}
          canHide={canHide}
        />
      ) : null}

      {sheetFolder ? (
        <FolderActionsSheet
          folder={sheetFolder} visible onClose={() => setSheetFolder(null)}
          onOpen={(f) => { setSheetFolder(null); router.push({ pathname: "/folder/[id]", params: { id: f.id, name: f.name } }); }}
          onInfo={(f) => { setSheetFolder(null); setInfoFolder(f); }}
          onRename={(f) => { setSheetFolder(null); setRenameTarget({ kind: "folder", id: f.id, name: f.name }); }}
          onMove={(f) => { setSheetFolder(null); router.push({ pathname: "/pick-destination", params: { folderId: f.id, mode: "move" } }); }}
          onAddToGroup={(f) => { setSheetFolder(null); setGroupTarget({ kind: "folder", id: f.id, name: f.name }); }}
          onShare={(f) => { setSheetFolder(null); router.push({ pathname: "/folder/[id]/share", params: { id: f.id, name: f.name, itemCount: f.file_count ?? "" } }); }}
          onLock={(f) => { setSheetFolder(null); setLockTarget({ kind: "folder", id: f.id, name: f.name, lock_mode: f.lock_mode, file_count: f.file_count }); }}
          onToggleHidden={(f) => { setSheetFolder(null); setHideFolder(f); }}
          onDelete={(f) => { setSheetFolder(null); setDeleteTarget({ kind: "folder", id: f.id, name: f.name }); }}
          onSelect={canSelect ? (f) => { setSheetFolder(null); selectOne({ id: f.id, kind: "folder" }); } : undefined}
          canLock={canLock}
          canHide={canHide}
        />
      ) : null}

      {/* "Make available offline" on a large folder asks here: the sheet that
          asked is gone by the time the estimate comes back. */}
      <OfflinePinConfirm />

      {dropMove ? (
        <MoveConfirmDialog
          visible
          items={dropMove.items}
          target={dropMove.target}
          nameOf={nameOf}
          onConfirm={() => void runDropMove()}
          onCancel={() => setDropMove(null)}
        />
      ) : null}

      {/* All three mount only while open. The lock dialog seeds its mode from the folder's
          current lock_mode, so a persistent mount would keep the first folder's state; the
          group sheet holds a query client, which the rest of this screen doesn't need. */}
      {infoFolder ? (
        <FolderInfoDialog folder={infoFolder} visible onClose={() => setInfoFolder(null)} />
      ) : null}

      {lockTarget ? (
        <LockDialog
          target={lockTarget}
          visible
          onClose={() => setLockTarget(null)}
          onSaved={() => {
            void q.refetch();
            void queryClient.invalidateQueries({ queryKey: ["library"] });
          }}
        />
      ) : null}

      <ConfirmDialog
        visible={hideFolder !== null}
        title={hideFolder?.is_hidden ? t("files.heading.unhideFolder") : t("files.heading.hideFolder")}
        message={
          hideFolder?.is_hidden
            ? t("files.description.nameWillBeVisibleToEveryoneAgain", { name: hideFolder?.name ?? "" })
            : t("files.description.nameWillBeHiddenFromEveryoneHidingFromSpecificPeopleOrRolesIsWeb", { name: hideFolder?.name ?? "" })
        }
        confirmLabel={hideFolder?.is_hidden ? t("files.action.unhide") : t("files.action.hide")}
        onConfirm={() => void toggleHidden()}
        onCancel={() => setHideFolder(null)}
      />

      <ConfirmDialog
        visible={hideFile !== null}
        title={hideFile?.is_hidden ? t("files.heading.unhideFile") : t("files.heading.hideFile")}
        message={
          hideFile?.is_hidden
            ? t("files.description.nameWillBeVisibleToEveryoneAgain", { name: hideFile?.name ?? "" })
            : t("files.description.nameWillBeHiddenFromEveryoneHidingFromSpecificPeopleOrRolesIsWeb", { name: hideFile?.name ?? "" })
        }
        confirmLabel={hideFile?.is_hidden ? t("files.action.unhide") : t("files.action.hide")}
        onConfirm={() => void toggleHiddenFile()}
        onCancel={() => setHideFile(null)}
      />

      {groupTarget ? (
        <AddToGroupSheet target={groupTarget} workspaceId={activeId} visible onClose={() => setGroupTarget(null)} />
      ) : null}

      <ActionSheet
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        actions={libraryKind
          ? librarySortOptions(libraryKind, t).map((s) => ({
            label: s.label,
            icon: librarySort === s.value ? "checkmark" : "swap-vertical-outline",
            onPress: () => setLibrarySort(s.value),
          }))
          : SORTS.map((s) => ({
            label: t(s.label),
            icon: sort === s.key ? "checkmark" : "swap-vertical-outline",
            onPress: () => setSort(s.key),
          }))}
      />

      {renameTarget || deleteTarget ? (
        <OperationDialogs
          renameTarget={renameTarget}
          deleteTarget={deleteTarget}
          files={files}
          onDoneRename={() => setRenameTarget(null)}
          onDoneDelete={() => setDeleteTarget(null)}
        />
      ) : null}

      {firstLoad ? (
        <FirstLoadSplash
          inputs={{
            hasUser: !!authedUser,
            // `data` implies the query resolved; the empty-workspaces guard
            // keeps a zero-workspace account from waiting on a listing that
            // will never be fetched.
            workspaceReady: !!workspaces.data && (!!activeId || workspaces.data.length === 0),
            filesReady: !!q.data || workspaces.data?.length === 0,
          }}
          failed={workspaces.isError === true || q.isError === true}
          onRetry={() => {
            if (workspaces.isError) void workspaces.refetch();
            if (q.isError) void q.refetch();
          }}
        />
      ) : null}
    </View>
    </SelectionMotionScope>
  );
}

// Isolated in its own component (only mounted while a rename/delete is in flight) so
// useFileMutations() only runs when a rename/delete is actually open, keeping the common
// render path away from the mutations hook. FileBrowser itself now calls useQueryClient()
// directly (to invalidate the library cache from its own hide/lock handlers), so every render
// - this component's or not - needs a real QueryClientProvider in FileBrowser.test.tsx.
// Same pattern as NewFolderPrompt.
function OperationDialogs({
  renameTarget, deleteTarget, files, onDoneRename, onDoneDelete,
}: {
  renameTarget: OperationTarget | null; deleteTarget: OperationTarget | null; files: FileItem[];
  onDoneRename: () => void; onDoneDelete: () => void;
}) {
  const t = useT();
  const mut = useFileMutations();
  return (
    <>
      <PromptDialog
        visible={!!renameTarget}
        title={renameTarget?.kind === "folder" ? t("files.heading.renameFolder") : t("files.heading.renameFile")}
        initialValue={renameTarget?.name}
        confirmLabel={t("common.action.rename")}
        onCancel={onDoneRename}
        onSubmit={(name) => {
          const target = renameTarget;
          onDoneRename();
          if (!name || !target) return;
          if (target.kind === "file") mut.rename.mutate({ id: target.id, name }, { onSuccess: () => toast(t("files.label.renamed")) });
          else mut.renameFolder.mutate({ id: target.id, name }, { onSuccess: () => toast(t("files.label.renamed")) });
        }}
      />
      <ConfirmDialog
        visible={!!deleteTarget}
        title={deleteTarget?.kind === "folder" ? t("files.heading.deleteFolder") : t("files.heading.deleteFile")}
        message={
          deleteTarget
            ? deleteTarget.kind === "folder"
              ? t("files.description.nameAndItsContentsWillBeRemoved", { name: deleteTarget.name })
              : t("files.description.nameWillBeMovedToTrash", { name: deleteTarget.name })
            : undefined
        }
        confirmLabel={t("common.delete")}
        destructive
        onCancel={onDoneDelete}
        onConfirm={() => {
          const target = deleteTarget;
          onDoneDelete();
          if (!target) return;
          if (target.kind === "file") {
            const row = files.find((f) => f.id === target.id);
            if (row && isLiveStill(row)) {
              Alert.alert(t("files.description.deletePhoto"), t("files.description.alsoDeleteItsLivePhotoVideo"), [
                { text: t("files.action.keepVideo"), onPress: () => mut.removeWithTwin.mutate({ file: row, withTwin: false }, { onSuccess: (outcome) => toast(outcome.twinDeleted === false ? t("files.error.photoMovedToTrashButItsVideoCouldNotBeDeleted") : t("files.status.movedToTrash")) }) },
                { text: t("files.action.deleteBoth"), style: "destructive", onPress: () => mut.removeWithTwin.mutate({ file: row, withTwin: true }, { onSuccess: (outcome) => toast(outcome.twinDeleted === false ? t("files.error.photoMovedToTrashButItsVideoCouldNotBeDeleted") : t("files.status.movedToTrash")) }) },
                { text: t("common.cancel"), style: "cancel" },
              ]);
            } else {
              mut.remove.mutate(target.id, { onSuccess: () => toast(t("files.status.movedToTrash")) });
            }
          } else {
            mut.removeFolder.mutate(target.id, { onSuccess: (outcome) => toast(describeFolderPurge(outcome)) });
          }
        }}
      />
    </>
  );
}
