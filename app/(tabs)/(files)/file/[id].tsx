import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, View, useWindowDimensions } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { PromptDialog } from "@/ui/PromptDialog";
import { toast } from "@/ui/toast";
import { useColorTheme } from "@/theme/useColorTheme";
import { useFile, useRegions, useWorkspaces } from "@/files/hooks";
import { ApiError } from "@/api/errors";
import { useIsOnline } from "@/offline/network";
import { savedOriginalForExport } from "@/offline/read";
import { useSavedCopies } from "@/offline/useSavedCopies";
import { NewerVersionBar, UpdatePendingNote } from "@/offline/ui/NewerVersionBar";
import { useOfflineRow } from "@/offline/ui/offlineActions";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useFileMutations, type RemoveWithTwinOutcome } from "@/files/mutationHooks";
import { getDownloadUrl } from "@/files/api";
import { unlockFile } from "@/files/mutations";
import { downloadToCache, shareFile } from "@/files/download";
import { ensureLocal, localUri, type DownloadTask } from "@/files/byteStore";
import { useDownloadStore } from "@/files/downloadStore";
import { DONE_HOLD_MS, shouldEmitProgress } from "@/files/downloadModel";
import { cancelDownload, forgetTask, registerTask } from "@/files/downloadControl";
import { notifyTransferDone, updateTransferNotification, clearTransferNotification } from "@/files/transferNotice";
import { SaveCancelled, saveOutcomeMessage, saveToDevice } from "@/files/saveToDevice";
import { canDownload, isViewOnly } from "@/files/lock";
import { FileThumb } from "@/files/FileThumb";
import { imageCachePolicy, mayPersistBytes } from "@/files/cachePolicy";
import { fileKind, formatBytes, formatDateTime, lineCount, normalizeExt } from "@/files/format";
import { MAX_VCF_PARSE_BYTES, parseVCardFile } from "@/contacts/vcardFile";
import { restoreContacts } from "@/contacts/restoreContacts";
import { ICS_INLINE_BYTES, isCalendarFile, MAX_ICS_PARSE_BYTES, readCalendar } from "@/calendar/calendarRead";
import { playFileQueue } from "@/player/controller";
import { useFavourite } from "@/player/useFavourite";
import { getForTrack } from "@/player/metadata/metadataStore";
import { loadReadingState } from "@/reader/readingState";
import { fileRawUrl } from "@/files/fileUrl";
import { isLiveStill } from "@/files/livePhotos";
import type { FileItem } from "@/files/types";

import { useFilePreview } from "@/viewer/useFilePreview";
import { useViewerList, resolveContext, positionLabel } from "@/viewer/viewerStore";
import { stagePalette } from "@/viewer/stageTheme";
import { audioPlayable } from "@/viewer/audioSupport";
import { isVlcAvailable } from "@/viewer/vlcPlayer";
import { viewerImagePlaceholder, viewerImageSource } from "@/viewer/imageSource";
import { pageFromOffset } from "@/viewer/pagerIndex";
import { layoutIsRtl } from "@/lib/direction";
import {
  actionAvailability,
  detailRows,
  lockBadge,
  metaParts,
  primaryAction,
  stageKind,
  type StageKind,
} from "@/viewer/viewerModel";
import { ViewerChrome } from "@/viewer/ViewerChrome";
import { ViewerSheet } from "@/viewer/ViewerSheet";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { ViewerActions } from "@/viewer/ViewerActions";
import { ViewerDetails } from "@/viewer/ViewerDetails";
import { PeopleChips } from "@/personas/PeopleChips";
import { ViewerMoreSheet, type MoreAction } from "@/viewer/ViewerMoreSheet";
import { ImageStage } from "@/viewer/stages/ImageStage";
import { LivePhotoStage } from "@/viewer/stages/LivePhotoStage";
import { VideoStage } from "@/viewer/stages/VideoStage";
import { AudioStage } from "@/viewer/stages/AudioStage";
import { InlineAudioPlayer } from "@/viewer/stages/InlineAudioPlayer";
import { VlcInlineAudioPlayer } from "@/viewer/stages/VlcInlineAudioPlayer";
import { CsvStage } from "@/viewer/stages/CsvStage";
import { MarkdownStage } from "@/viewer/stages/MarkdownStage";
import { PdfStage } from "@/viewer/stages/PdfStage";
import { OfficeStage } from "@/viewer/stages/OfficeStage";
import { TextStage } from "@/viewer/stages/TextStage";
import { ContactsStage } from "@/viewer/stages/ContactsStage";
import { CalendarStage } from "@/viewer/stages/CalendarStage";
import { BookStage } from "@/viewer/stages/BookStage";
import { GlyphStage } from "@/viewer/stages/GlyphStage";
import { LockGate } from "@/viewer/stages/LockGate";
import { StageMessage } from "@/viewer/stages/StageMessage";
import { CastSheet } from "@/cast/CastSheet";
import { useCastStore } from "@/cast/castStore";
import { canAirPlay, canCast } from "@/cast/castSupport";
import { castAvailable, castFile, connectTo, initCast, openCastControls, stopCasting, whenConnected } from "@/cast/castController";
import { showAirPlayPicker } from "../../../../modules/dosya-media-extras";

/**
 * The file viewer.
 *
 * Three layers: a stage holding nothing but the file, floating chrome over it,
 * and a sheet carrying every word and every action. Tapping the stage strips
 * the other two away; dragging the sheet up reveals the full record; swiping
 * sideways moves through the folder.
 *
 * Only the ACTIVE page resolves bytes. Presigning every neighbour would fire a
 * request per file in the folder for photos the user may never reach, so the
 * pages either side render the disk-cached thumbnail the list already loaded
 * and are replaced by the real stage when they become current.
 */
export default function FileViewerRoute() {
  const t = useT();
  const { id: routeId, origin: originParam } = useLocalSearchParams<{ id: string; origin?: string }>();
  // Opened from the Offline screen: saved copies only, never a replacement
  // fetched on the user's behalf (the plan's "Viewer behaviour").
  const origin = originParam === "offline" ? "offline-screen" as const : "files" as const;
  const online = useIsOnline();
  const router = useRouter();
  const { scheme, tokens } = useColorTheme();
  const palette = stagePalette(scheme);
  const { width } = useWindowDimensions();

  // Which file is on screen. Starts at the route's file and moves with the
  // pager; the route param stays the entry point, so Back still leaves the
  // viewer rather than walking back through every file that was swiped past.
  const [currentId, setCurrentId] = useState(routeId);
  useEffect(() => { setCurrentId(routeId); }, [routeId]);

  const listCtx = useViewerList();
  // The row the list already holds stands in for the record until it loads,
  // so swiping onto an uncached file never drops back to the loading screen.
  const listRow = useMemo(
    () => listCtx.files.find((f) => f.id === currentId) ?? null,
    [listCtx.files, currentId],
  );
  const { data: file, isLoading, isError, error, refetch } = useFile(currentId, listRow);
  // The server refused this file. A record restored from the cache - or a copy
  // saved for offline - is not shown over a refusal; useFile has already asked
  // the offline store to re-check access, which removes a copy that is denied.
  const refused = error instanceof ApiError && (error.status === 403 || error.status === 404);

  const ctx = useMemo(
    () => resolveContext({ files: listCtx.files, sourceName: listCtx.sourceName }, currentId, file ?? null),
    [listCtx.files, listCtx.sourceName, currentId, file],
  );

  // The twin's id comes from the LIST row, never from `file`.
  //
  // `file` is GET /api/files/:id, whose projection (FILE_COLUMNS) carries no
  // live_video_id / live_photo_id at all - only the listings compute pairing.
  // Reading them off the detail row meant isLiveStill() was false for every
  // Live Photo on the phone: the stage never mounted and Move to trash never
  // asked about the video.
  //
  // The list row does carry them, and it survives resolveContext's overlay:
  // that spreads the detail row over the list row, and the detail JSON omits
  // the pairing keys rather than sending them as null, so the list row's value
  // is not overwritten. Opened without a list (a deep link, a notification)
  // there is no pairing to know, and a plain image stage is the honest answer.
  const twinId = ctx.files[ctx.index]?.live_video_id ?? null;

  // Saved offline copies for everything that can show a full image right now:
  // this page, the photo pages either side, and a Live Photo's motion. Looked
  // up before any of them renders its network source - offline, that source
  // fails, and a failure would be taken for an undecodable image.
  const savedItems = useMemo(() => {
    const out: { id: string; version: number }[] = [];
    if (file && !refused && file.lock_mode === "none") out.push({ id: file.id, version: file.current_version });
    for (const d of [-1, 1]) {
      const n = ctx.files[ctx.index + d];
      // The same rule as this page: only an unrestricted file has a saved
      // copy worth showing (a restricted one is the server's to judge).
      if (n && n.lock_mode === "none" && neighbourShowsPhoto(n)) out.push({ id: n.id, version: n.current_version });
    }
    if (twinId) out.push({ id: twinId, version: 0 });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, file?.current_version, file?.lock_mode, refused, ctx.files, ctx.index, twinId]);
  const { copies: savedCopies, recheck: recheckSaved } = useSavedCopies(savedItems);
  // Saved copies that failed to load and were looked up again once. A second
  // failure of the same copy is a real decode failure.
  const recheckedSaved = useRef(new Set<string>());

  const [immersive, setImmersive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [castOpen, setCastOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // Held against the file it unlocked. Cleared in an effect it would still be
  // attached to the NEXT file for the first render after a swipe, putting a
  // stranger's token on that photo's URL and reloading the image the
  // neighbour page had already shown.
  const [unlock, setUnlock] = useState<{ id: string; token: string } | null>(null);
  const unlockToken = unlock?.id === currentId ? unlock.token : null;
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const download = useDownloadStore((s) => (currentId ? s.entries[currentId] : undefined));
  // The rate and estimate are derived from a clock, so they only advance if
  // something re-renders between the throttled progress ticks. Same 1s tick
  // UploadDock runs, and only while a transfer is actually moving.
  const [, setClock] = useState(0);
  useEffect(() => {
    if (!download || download.phase === "done" || download.phase === "error") return;
    const timer = setInterval(() => setClock((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [download]);
  // Keyed by file, not reset on every swipe: the page either side loads its
  // photo before it is current, so its size is known before the swipe lands
  // and its stage never reloads to report it again.
  const [dimensionsById, setDimensionsById] = useState<Record<string, string>>({});
  const dimensions = dimensionsById[currentId] ?? null;
  const reportDimensions = useCallback((id: string, label: string) => {
    setDimensionsById((m) => (m[id] === label ? m : { ...m, [id]: label }));
  }, []);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [readPercent, setReadPercent] = useState<number | null>(null);
  const [stageFailed, setStageFailed] = useState(false);
  // Split from stageFailed: a decode refusal (Android has no TIFF decoder,
  // old Android no HEIC) must not render as "your connection may have
  // dropped" - retrying a missing decoder helps nobody. Keyed by file for the
  // same reason as the dimensions: a neighbour can fail before it is current.
  //
  // Which source failed is kept: a network source that failed says nothing
  // about a saved copy of the same file, which takes precedence once known.
  // And offline, a network source failing is the connection, not the decoder,
  // so it marks nothing at all.
  const [undecodable, setUndecodable] = useState<Record<string, "saved" | "network">>({});
  const undecodableFlag = undecodable[currentId];
  const imageUndecodable = !!undecodableFlag && !(undecodableFlag === "network" && savedCopies[currentId]);
  const markUndecodable = useCallback((id: string, fromSaved = false) => {
    if (!fromSaved && online === false) return;
    // A saved copy that will not load may simply be gone - unpinned, or
    // replaced by a sync while the viewer was open. Look again first: no copy
    // now means the network source takes over (online), not a dead glyph.
    if (fromSaved && !recheckedSaved.current.has(id)) {
      recheckedSaved.current.add(id);
      recheckSaved(id);
      return;
    }
    const how = fromSaved ? "saved" : "network";
    setUndecodable((m) => (m[id] === how ? m : { ...m, [id]: how }));
  }, [online, recheckSaved]);

  // Measurements belong to the file that produced them.
  useEffect(() => {
    setDurationSec(null);
    setPageCount(null);
    setReadPercent(null);
    setStageFailed(false);
    setUnlock(null);
    setUnlockError(null);
  }, [currentId]);

  // Matches ViewerSheet's own `insets.bottom + 14`, so the loading skeleton
  // below sits exactly where the sheet that replaces it will.
  const skeletonPad = useSheetBottomPad(14);
  // "Open newer version", held against the file it was tapped for.
  const [askedNewer, setAskedNewer] = useState<string | null>(null);
  const preview = useFilePreview(refused ? undefined : file, unlockToken, { origin, userAskedNewer: askedNewer === currentId });
  const fav = useFavourite(file?.id ?? null);
  const mutations = useFileMutations();
  const workspaces = useWorkspaces();
  const activeWsId = useWorkspaceStore((s) => s.activeId);
  // Names the audio hand-off's artist line. The store carries the folder name
  // when the viewer was opened from a list; a deep link has neither, so the
  // workspace name stands in rather than the literal "dosya".
  const wsName = workspaces.data?.find((w) => w.id === activeWsId)?.name ?? "dosya";
  const sourceName = listCtx.files.length > 0 ? ctx.sourceName : wsName;

  const isVcf = !!file && (normalizeExt(file.extension) === "vcf" || file.mime_type === "text/vcard");
  const vcfParsable = isVcf && !!file && file.size_bytes <= MAX_VCF_PARSE_BYTES;
  const vcf = useMemo(
    () => (vcfParsable && preview.text ? parseVCardFile(preview.text) : null),
    [vcfParsable, preview.text],
  );
  const contactCount = vcf ? vcf.cards.length : null;

  // Same pattern for a .ics: parsed from the body the text preview already
  // fetched. No events (or not a calendar at all) leaves it on the text stage.
  // A calendar over the text cap (a Takeout export) is not fetched here at
  // all: it gets an unparsed calendar card, and the route reads it.
  const isIcs = !!file && isCalendarFile(file.mime_type, file.extension);
  const icsInline = isIcs && !!file && file.size_bytes <= ICS_INLINE_BYTES;
  const icsUnread = isIcs && !!file && file.size_bytes > ICS_INLINE_BYTES && file.size_bytes <= MAX_ICS_PARSE_BYTES;
  const calendar = useMemo(
    () => (icsInline && preview.text ? readCalendar(preview.text) : null),
    [icsInline, preview.text],
  );

  const gated = !!file && file.lock_mode === "full_lock" && !unlockToken;
  const stage: StageKind = file
    ? stageKind({
        file,
        gated,
        failed: preview.failed || stageFailed,
        textTooLarge: preview.textTooLarge,
        // Only claim the contacts stage once the body has actually parsed;
        // before that there is nothing to peek at and the glyph would flash.
        isContacts: vcfParsable && !!vcf,
        isCalendar: !!calendar || icsUnread,
      })
    : "none";

  // Saved reading position, for the book cover's progress bar and to decide
  // between "Read" and "Continue reading".
  useEffect(() => {
    if (!file || stage !== "book") return;
    let alive = true;
    void loadReadingState(file.id).then((s) => { if (alive) setReadPercent(s.percent); });
    return () => { alive = false; };
  }, [file, stage]);

  // Artwork and tags for an audio file the player has already parsed. Nothing
  // is parsed here: extraction reads up to 50MB and would stall a tap.
  const audioMeta = useMemo(() => {
    if (!file || stage !== "audio") return null;
    return getForTrack({
      fileId: file.id,
      title: file.name,
      artist: sourceName,
      extension: file.extension,
      sizeBytes: file.size_bytes,
      modifiedAt: file.updated_at,
    });
  }, [file, stage, sourceName]);

  const regions = useRegions();
  const regionLabel = useMemo(() => {
    if (!file?.region) return null;
    const r = regions.data?.find((x) => x.code === file.region);
    return r ? `${r.city}` : file.region;
  }, [file?.region, regions.data]);

  // Tapping a filmstrip thumbnail changes the current file without touching the
  // scroll position, so the pager has to be told to catch up. Driving it off
  // the resolved index (rather than from the tap handler) also covers the
  // filmstrip and the pager disagreeing for any other reason.
  const pagerRef = useRef<FlatList<FileItem>>(null);
  const settledIndex = useRef(ctx.index);
  useEffect(() => {
    if (!ctx.paged) return;
    if (settledIndex.current === ctx.index) return;
    settledIndex.current = ctx.index;
    pagerRef.current?.scrollToIndex({ index: ctx.index, animated: true });
  }, [ctx.index, ctx.paged]);

  const toggleImmersive = useCallback(() => {
    setImmersive((v) => {
      if (!v) setExpanded(false);
      return !v;
    });
  }, []);

  /**
   * Fetch the bytes once, into the app cache, for whatever wants them next.
   *
   * `report` is threaded all the way down because the byte store and the plain
   * downloader both accept it and neither was ever given one - which is why a
   * 512MB save looked identical at second 1 and second 170.
   */
  const fetchToCache = useCallback(async (
    report?: { onProgress: (w: number, t: number) => void; onTask: (t: DownloadTask) => void },
  ): Promise<string> => {
    if (!file) throw new Error(t("files.label.noFile"));
    // Available offline: the saved original, so Save and Share work with no
    // connection - and are the way out for an office file whose PDF could not
    // be saved. Online with a newer version on the server, that one is fetched.
    const offline = await savedOriginalForExport(file).catch(() => null);
    if (offline) return offline;
    // Already on the device - from a previous open or a previous save. Saving
    // and sharing are the two places where re-downloading a file the device is
    // already holding is most obviously wasted.
    const held = await localUri(file).catch(() => null);
    if (held) return held;

    // The store keeps what it fetches, so the next save costs nothing. It
    // declines view_only and full_lock outright, which is the one case that
    // still has to go through the plain downloader.
    const stored = await ensureLocal(
      file,
      () => getDownloadUrl(file.id, unlockToken ?? undefined),
      report,
    ).catch(() => null);
    if (stored) return stored;

    // preview.uri is only reusable when it needs no headers - a presigned URL.
    // The authenticated /raw URL cannot be handed to a downloader without them.
    // A file:// path is not a download target either, hence the scheme check.
    const reusable =
      preview.uri && !preview.headers && !preview.uri.startsWith("file:") ? preview.uri : null;
    const url = reusable ?? (await getDownloadUrl(file.id, unlockToken ?? undefined));
    return downloadToCache(url, file.name, report);
  }, [file, preview.uri, preview.headers, unlockToken, t]);

  const onDownload = useCallback(async () => {
    if (!file) return;
    const dl = useDownloadStore.getState();
    const running = dl.entries[file.id];

    // A press while the transfer is running is not a second download. The ring
    // is deliberately never disabled, so this stays the one control that can
    // reach a half-gigabyte transfer: it brings the sheet back, where the bytes,
    // the rate, the estimate and Cancel are. A press on a broken one starts
    // over from whatever is already on disk.
    if (running && (running.phase === "preparing" || running.phase === "downloading")) {
      setImmersive(false);
      return;
    }
    if (running?.phase === "saving") return;

    // Recorded at start, not resolved later: the point is to survive a
    // workspace switch, and after one the listing that knew this file's
    // workspace is gone. The file's own id wins over the active one, because a
    // file reached from search or a link need not live in what is on screen.
    const wsId = file.workspace_id ?? activeWsId ?? undefined;
    const wsLabel = workspaces.data?.find((w) => w.id === wsId)?.name;
    dl.start(file.id, file.name, Date.now(), wsId ? { id: wsId, name: wsLabel } : undefined);
    let last: { pct: number; at: number } | null = null;
    const report = {
      onProgress: (written: number, total: number) => {
        const pct = total > 0 ? written / total : 0;
        const now = Date.now();
        if (!shouldEmitProgress(last, pct, now)) return;
        last = { pct, at: now };
        useDownloadStore.getState().progress(file.id, written, total);
        void updateTransferNotification(file.id, file.name, Math.round(pct * 100), "");
      },
      onTask: (t: DownloadTask) => registerTask(file.id, t),
    };

    try {
      const local = await fetchToCache(report);
      useDownloadStore.getState().setPhase(file.id, "saving");
      const outcome = await saveToDevice({
        localUri: local,
        fileName: file.name,
        mimeType: file.mime_type,
        extension: file.extension,
        sizeBytes: file.size_bytes,
      });
      const message = saveOutcomeMessage(outcome);
      useDownloadStore.getState().setPhase(file.id, "done");
      toast(message);
      void notifyTransferDone(file.name, message);
      // Holds long enough to read, then the row is a plain Download again.
      setTimeout(() => useDownloadStore.getState().clear(file.id), DONE_HOLD_MS);
    } catch (e) {
      // Backing out of the folder picker or the permission prompt is a choice,
      // not a failure - saying "couldn't save" there reads as a bug, so it
      // clears the row rather than leaving a red ring behind.
      if (e instanceof SaveCancelled) {
        useDownloadStore.getState().clear(file.id);
        toast(e.message);
      } else {
        const message = e instanceof Error ? e.message : t("common.error.couldnTSaveThisFile");
        useDownloadStore.getState().fail(file.id, message);
        toast(message, "error");
      }
    } finally {
      forgetTask(file.id);
      void clearTransferNotification(file.id);
    }
    // activeWsId and workspaces.data are read to label the transfer; without
    // them here the callback keeps whichever workspace was active when the
    // viewer mounted, and a download started after a switch is labelled wrong.
  }, [file, fetchToCache, activeWsId, workspaces.data, t]);

  /** Stops a running transfer, or restarts a broken one. */
  const onCancelDownload = useCallback(() => {
    if (!file) return;
    if (useDownloadStore.getState().entries[file.id]?.phase === "error") {
      void onDownload();
      return;
    }
    void cancelDownload(file.id);
  }, [file, onDownload]);

  const onShareVia = useCallback(async () => {
    if (!file) return;
    try {
      await shareFile(await fetchToCache());
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common.error.couldnTShareThisFile"), "error");
    }
  }, [file, fetchToCache, t]);

  const onRestoreContacts = useCallback(async () => {
    if (!file) return;
    setRestoring(true);
    try {
      // A view-only .vcf still restores: it is readable, just not downloadable
      // in the "save a copy" sense, and /raw is how its bytes are reached.
      const saved = await savedOriginalForExport(file).catch(() => null);
      const local = saved ?? await downloadToCache(
        preview.uri && !preview.uri.startsWith("file:") ? preview.uri : await getDownloadUrl(file.id, unlockToken ?? undefined),
        file.name,
        { headers: preview.headers },
      );
      const res = await restoreContacts(local);
      toast(res.failed ? t("common.error.addedAddedContactsFailedFailed", { added: res.added, failed: res.failed }) : t("common.status.addedAddedContacts", { added: res.added }));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common.error.restoreFailed"), "error");
    } finally {
      setRestoring(false);
    }
  }, [file, preview.uri, preview.headers, unlockToken, t]);

  const doUnlock = useCallback(async (password: string) => {
    if (!file) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      setUnlock({ id: file.id, token: await unlockFile(file.id, password) });
      toast(t("files.status.unlocked"));
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : t("common.error.wrongPassword"));
    } finally {
      setUnlocking(false);
    }
  }, [file, t]);

  // How this device can play this audio file. The queue rides AVPlayer on
  // iOS, which cannot decode OGG/Opus/WMA; those play through the on-stage
  // libVLC transport when the build carries it (and libVLC needs a presigned
  // uri - it cannot send the /raw route's auth header). Without the module,
  // Save is the only honest offer.
  const audioPlayback: "queue" | "inline" | "none" =
    file && stage === "audio" && !audioPlayable(file.mime_type, file.extension, Platform.OS)
      ? isVlcAvailable() && preview.uri && !preview.headers
        ? "inline"
        : "none"
      : "queue";

  // Casting. The SDK is wired once per app run; a session survives the viewer,
  // so opening a file while the TV is connected sends that file to it, and so
  // does swiping to the next one. A file the TV cannot show leaves the last
  // one up rather than blanking the screen in the room.
  const [castReady, setCastReady] = useState(false);
  useEffect(() => {
    if (!initCast()) return;
    let alive = true;
    void castAvailable().then((ok) => { if (alive) setCastReady(ok); });
    return () => { alive = false; };
  }, []);
  const castStatus = useCastStore((s) => s.status);
  const castDevice = useCastStore((s) => s.deviceName);
  const castFileId = useCastStore((s) => s.fileId);
  const castable = !!file && castReady && online !== false && canCast(file, unlockToken);
  const airPlay = !!file && online !== false && canAirPlay(file, unlockToken, Platform.OS);
  const castSending = useRef<string | null>(null);
  const sendToTv = useCallback((f: FileItem) => {
    castSending.current = f.id;
    castFile(f, unlockToken)
      .catch(() => toast(t("cast.error.couldNotSendToTv"), "error"))
      .finally(() => { if (castSending.current === f.id) castSending.current = null; });
  }, [unlockToken, t]);
  useEffect(() => {
    if (castStatus !== "connected" || !file || !castable) return;
    if (castFileId === file.id || castSending.current === file.id) return;
    sendToTv(file);
  }, [castStatus, castFileId, file, castable, sendToTv]);
  const castingHere = castStatus === "connected" && !!file && castFileId === file.id;

  const onPickTv = useCallback((deviceId: string) => {
    void connectTo(deviceId)
      .then((asked) => (asked ? whenConnected() : false))
      .then((ok) => { if (!ok) toast(t("cast.error.couldNotConnectToTv"), "error"); });
  }, [t]);

  const onAirPlay = useCallback(() => {
    void showAirPlayPicker(stage === "video").then((shown) => {
      if (!shown) toast(t("cast.error.openAirPlayFromControlCenter"), "error");
    });
  }, [stage, t]);

  const primary = file ? primaryAction({ file, stage, contactCount, readPercent, audioPlayback }) : null;

  const onPrimary = useCallback(() => {
    if (!file || !primary) return;
    switch (primary.kind) {
      case "read":
        router.push({
          pathname: "/file/[id]/read",
          params: { id: file.id, ...(unlockToken ? { token: unlockToken } : {}) },
        });
        break;
      case "play":
        // Connected to a TV: the song goes to the room, not to the pocket.
        if (castStatus === "connected" && castable) {
          if (castingHere) openCastControls();
          else sendToTv(file);
          break;
        }
        void playFileQueue(ctx.files, file.id, sourceName)
          .then((ok) => { if (ok) router.push("/player"); })
          .catch(() => toast(t("files.error.couldnTStartPlayback"), "error"));
        break;
      case "contacts":
        router.push({ pathname: "/file/[id]/contacts", params: { id: file.id } });
        break;
      case "calendar":
        router.push({ pathname: "/file/[id]/calendar", params: { id: file.id } });
        break;
      case "browse":
        router.push({ pathname: "/file/[id]/archive", params: { id: file.id, name: file.name } });
        break;
      case "retry":
        setStageFailed(false);
        recheckedSaved.current.delete(file.id);
        recheckSaved(file.id);
        setUndecodable((m) => {
          if (!m[file.id]) return m;
          const next = { ...m };
          delete next[file.id];
          return next;
        });
        preview.retry();
        void refetch();
        break;
      case "save":
        void onDownload();
        break;
    }
  }, [file, primary, router, unlockToken, sourceName, ctx.files, preview, refetch, onDownload, recheckSaved, castStatus, castable, castingHere, sendToTv, t]);

  // Make available offline / Remove from offline. The viewer only shows Files
  // (the Vault has its own), and canPin refuses a restricted file.
  const offlineRow = useOfflineRow(file ? { kind: "file", item: file } : null, file?.workspace_id ?? activeWsId ?? null);

  const moreActions: MoreAction[] = useMemo(() => {
    if (!file) return [];
    const actions: MoreAction[] = [
      { id: "rename", label: t("common.action.rename"), icon: "create-outline", onPress: () => setRenaming(true) },
      { id: "move-to-folder", label: t("files.action.moveToFolder"), icon: "folder-outline", onPress: () => router.push({ pathname: "/pick-destination", params: { fileId: file.id, mode: "move" } }) },
      { id: "make-a-copy", label: t("files.action.makeACopy"), icon: "copy-outline", onPress: () => router.push({ pathname: "/pick-destination", params: { fileId: file.id, mode: "copy" } }) },
    ];
    if (canDownload(file)) {
      actions.push({ id: "share-via", label: t("files.action.shareVia"), icon: "share-outline", onPress: () => void onShareVia() });
    }
    // Shown while connected even on a file the TV cannot take, so Stop is
    // always one tap from whatever the phone has open.
    if (castable || airPlay || castStatus === "connected") {
      actions.push({
        id: "cast",
        label: castStatus === "connected" && castDevice ? t("cast.label.castingToDevice", { device: castDevice }) : t("cast.action.castToTv"),
        icon: "cast",
        onPress: () => setCastOpen(true),
      });
    }
    if (isVcf) {
      actions.push({
        id: "restore-to-phone",
        label: restoring ? t("files.label.restoring") : t("files.action.restoreToPhone"),
        icon: "person-add-outline",
        onPress: () => { if (!restoring) void onRestoreContacts(); },
      });
    }
    if (!expanded) {
      actions.push({ id: "file-details", label: t("common.label.fileDetails"), icon: "information-circle-outline", onPress: () => setExpanded(true) });
    }
    // Office documents open in the real editor rather than the read-only PDF
    // preview the stage shows. fileKind already knows which files those are.
    if (fileKind(file.mime_type, file.extension) === "office") {
      actions.push({
        id: "edit-document",
        label: t("files.action.editDocument"),
        icon: "create-outline",
        onPress: () => router.push({ pathname: "/editor", params: { fileId: file.id, name: file.name } }),
      });
    }
    // The count comes from /api/files, where comment_count is a real COUNT(*) -
    // the placeholder zero is only in the trash listings - so showing it here
    // means an empty thread is never a surprise tap.
    actions.push({
      id: "comments",
      label: file.comment_count > 0 ? t("files.label.commentsCommentCount", { commentCount: file.comment_count }) : t("files.label.comments"),
      icon: "chatbubble-ellipses-outline",
      onPress: () => router.push({ pathname: "/comments", params: { fileId: file.id, name: file.name } }),
    });
    if (offlineRow) actions.push(offlineRow);
    actions.push({
      id: "move-to-trash",
      label: t("common.action.moveToTrash"),
      icon: "trash-outline",
      destructive: true,
      onPress: () => {
        const afterDelete = (outcome?: RemoveWithTwinOutcome) => {
          toast(outcome?.twinDeleted === false ? t("files.error.photoMovedToTrashButItsVideoCouldNotBeDeleted") : t("files.status.movedToTrashInFiles"));
          router.back();
        };
        // The twin's id is only on the list row (see `twinId` above), so the
        // prompt and the mutation are given the file with it filled in.
        const liveFile = { ...file, live_video_id: twinId };
        if (isLiveStill(liveFile)) {
          Alert.alert(t("files.description.deletePhoto"), t("files.description.alsoDeleteItsLivePhotoVideo"), [
            { text: t("files.action.keepVideo"), onPress: () => mutations.removeWithTwin.mutate({ file: liveFile, withTwin: false }, { onSuccess: afterDelete }) },
            { text: t("files.action.deleteBoth"), style: "destructive", onPress: () => mutations.removeWithTwin.mutate({ file: liveFile, withTwin: true }, { onSuccess: afterDelete }) },
            { text: t("common.cancel"), style: "cancel" },
          ]);
        } else {
          mutations.remove.mutate(file.id, { onSuccess: () => afterDelete() });
        }
      },
    });
    return actions;
  }, [file, twinId, isVcf, expanded, restoring, router, mutations.remove, mutations.removeWithTwin, onRestoreContacts, onShareVia, offlineRow, castable, airPlay, castStatus, castDevice, t]);

  // ── loading and hard failure ──────────────────────────────────────────────
  if (isLoading && !file) {
    return (
      <View className="flex-1" style={{ backgroundColor: palette.bg }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ViewerChrome visible position={null} palette={palette} onBack={() => router.back()} onMore={() => {}} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={palette.fgMuted} />
        </View>
        {/* Same inset the real ViewerSheet takes: a flat pb-10 left the skeleton
            a few dp short of a three-button navigation bar, so the placeholder
            sat lower than the sheet that replaces it and the swap jumped. */}
        <View className="absolute inset-x-0 bottom-0 rounded-t-[22px] border-t border-border bg-card px-[18px]" style={{ paddingBottom: skeletonPad }}>
          <View className="items-center py-2.5"><View className="h-1 w-9 rounded-full bg-border" /></View>
          <View className="h-[17px] w-3/5 rounded bg-secondary" />
          <View className="mt-2.5 h-[11px] w-2/5 rounded bg-secondary" />
          <View className="mt-4 flex-row">
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} className="flex-1 items-center gap-1.5">
                <View className="h-[46px] w-[46px] rounded-full bg-secondary" />
                <View className="h-2 w-6 rounded bg-secondary" />
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  // Only when there is nothing to show. A record restored from the persisted
  // query cache with a failed refetch on top (offline cold start) is still the
  // file the user tapped; `isError` alone used to replace it with this screen.
  if (!file || refused) {
    return (
      <View className="flex-1 items-center justify-center gap-4" style={{ backgroundColor: palette.bg }}>
        <Stack.Screen options={{ headerShown: false }} />
        <Icon name="alert-circle-outline" size={44} color="#f2565f" />
        <Text className="text-base" style={{ color: palette.fg }}>{t("files.error.couldnTLoadThisFile")}</Text>
        <View className="flex-row gap-3">
          <Pressable
            testID="viewer-reload"
            accessibilityRole="button"
            onPress={() => void refetch()}
            className="rounded-xl bg-primary px-4 py-2.5"
          >
            <Text className="text-sm font-bold text-primary-foreground">{t("common.action.tryAgain")}</Text>
          </Pressable>
          <Pressable
            testID="viewer-error-back"
            accessibilityRole="button"
            onPress={() => router.back()}
            className="rounded-xl px-4 py-2.5"
            style={{ backgroundColor: palette.chrome }}
          >
            <Text className="text-sm font-bold" style={{ color: palette.fg }}>{t("common.action.goBack")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── the stage for the active file ─────────────────────────────────────────
  const activeStage = (() => {
    if (stage === "locked") {
      return <LockGate busy={unlocking} error={unlockError} onSubmit={doUnlock} palette={palette} />;
    }
    if (stage === "error") {
      return <GlyphStage variant="error" name={file.name} mimeType={file.mime_type} extension={file.extension} palette={palette} />;
    }
    if (stage === "too-large") {
      return (
        <GlyphStage
          variant="too-large"
          name={file.name}
          mimeType={file.mime_type}
          extension={file.extension}
          sizeLabel={formatBytes(file.size_bytes)}
          palette={palette}
        />
      );
    }
    // The TV is playing this one: a second player here would only fight it
    // for the same bytes (and the same speakers, for a song).
    if (castingHere && (stage === "video" || stage === "audio")) {
      return (
        <StageMessage
          testID="viewer-casting"
          icon="tv-outline"
          title={castDevice ? t("cast.heading.playingOnDevice", { device: castDevice }) : t("cast.heading.playingOnTv")}
          body={t("cast.description.useTvControlsOrStop")}
          actions={[
            { testID: "viewer-casting-controls", icon: "tv-outline", label: t("cast.action.tvControls"), onPress: openCastControls },
            { testID: "viewer-casting-stop", icon: "stop-circle-outline", label: t("cast.action.stopCasting"), onPress: () => void stopCasting() },
          ]}
        />
      );
    }
    if (stage === "audio") {
      return (
        <AudioStage
          name={file.name}
          artworkUri={audioMeta?.artworkUri}
          title={audioMeta?.title}
          artist={audioMeta?.artist}
          album={audioMeta?.album}
          palette={palette}
          // A locked file is filtered out of the player queue even once
          // unlocked, so there is nothing to hand off to - it plays here.
          // A format only libVLC decodes gets the VLC transport instead of a
          // queue hand-off that would play silence.
          footer={
            file.lock_mode !== "none" && preview.uri ? (
              <InlineAudioPlayer uri={preview.uri} headers={preview.headers} onDuration={setDurationSec} />
            ) : audioPlayback === "inline" && preview.uri ? (
              <VlcInlineAudioPlayer uri={preview.uri} onDuration={setDurationSec} />
            ) : null
          }
        />
      );
    }
    if (stage === "book") {
      return <BookStage fileId={file.id} name={file.name} percent={readPercent} palette={palette} />;
    }
    if (stage === "contacts" && vcf) {
      return <ContactsStage cards={vcf.cards} total={vcf.cards.length} />;
    }
    if (stage === "calendar") {
      return <CalendarStage parsed={calendar} fileName={file.name} sizeLabel={formatBytes(file.size_bytes)} />;
    }
    if (stage === "text") {
      return (
        <TextStage
          text={preview.text}
          mimeType={file.mime_type}
          extension={file.extension}
          mutedColor={tokens.mutedForeground}
        />
      );
    }
    if (stage === "csv") {
      return (
        <CsvStage
          text={preview.text}
          mimeType={file.mime_type}
          extension={file.extension}
          mutedColor={tokens.mutedForeground}
        />
      );
    }
    if (stage === "markdown") {
      return <MarkdownStage text={preview.text} mutedColor={tokens.mutedForeground} />;
    }

    // Deliberately ahead of the presign gate below: an image reads from the
    // authenticated /raw URL, which is known the instant the file row is, so
    // waiting on a presign round trip would delay it for nothing.
    if (stage === "image") {
      if (imageUndecodable) {
        return (
          <GlyphStage
            variant="undecodable"
            name={file.name}
            mimeType={file.mime_type}
            extension={file.extension}
            palette={palette}
          />
        );
      }
      // "Open newer version" was tapped and the viewer chose to stream: the
      // photo follows that choice instead of its saved copy.
      const streamAsked = askedNewer === currentId && preview.source === "stream";
      // Nothing renders until we know whether a saved copy is the source.
      const eligible = file.lock_mode === "none" && !streamAsked;
      if ((eligible && !(file.id in savedCopies)) || (twinId && !(twinId in savedCopies))) {
        return (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={palette.fgMuted} />
          </View>
        );
      }
      // The saved offline copy when there is one; a local file carries no credential.
      const savedHere = eligible ? savedCopies[file.id] : null;
      const network = viewerImageSource(file, unlockToken);
      const src = savedHere ? { uri: savedHere.uri, headers: {} } : network;
      if (twinId) {
        // The motion is its own file with its own source: its saved copy when
        // it is available offline, else the authenticated /raw URL with the
        // bearer - never the still's (empty) local headers.
        const twinSaved = savedCopies[twinId];
        return (
          <LivePhotoStage
            key={twinId}
            uri={src.uri}
            headers={src.headers}
            placeholder={viewerImagePlaceholder(file, unlockToken)}
            cachePolicy={imageCachePolicy(file)}
            palette={palette}
            onDimensions={(label) => reportDimensions(file.id, label)}
            onFailed={() => markUndecodable(file.id, !!savedHere)}
            twinUri={twinSaved ? twinSaved.uri : fileRawUrl(twinId, undefined, unlockToken ?? undefined)}
            twinHeaders={twinSaved ? {} : network.headers}
          />
        );
      }
      return (
        <ImageStage
          uri={src.uri}
          headers={src.headers}
          placeholder={viewerImagePlaceholder(file, unlockToken)}
          cachePolicy={imageCachePolicy(file)}
          palette={palette}
          onDimensions={(label) => reportDimensions(file.id, label)}
          onFailed={() => markUndecodable(file.id, !!savedHere)}
        />
      );
    }

    if (preview.renditionUnavailable) {
      return (
        <View testID="viewer-preview-unavailable-offline" className="flex-1">
          <GlyphStage variant="none" name={file.name} mimeType={file.mime_type} extension={file.extension} palette={palette} />
          <Text className="absolute inset-x-0 bottom-1/3 px-6 text-center text-xs" style={{ color: palette.fgMuted }}>
            {t("offline.label.previewUnavailableOffline")}
          </Text>
        </View>
      );
    }
    if (!preview.uri) {
      return (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={palette.fgMuted} />
        </View>
      );
    }
    if (stage === "video") {
      return (
        <VideoStage
          uri={preview.uri}
          headers={preview.headers}
          mimeType={file.mime_type}
          extension={file.extension}
          onDuration={setDurationSec}
          // A reported duration is the only proof the player really opened it,
          // which is what tells the stall timer to stand down.
          playing={durationSec != null}
          onSave={canDownload(file) ? () => void onDownload() : undefined}
          onRetry={preview.retry}
        />
      );
    }
    if (stage === "office") {
      // preview.uri is the conversion endpoint for an office file (see
      // useFilePreview); OfficeStage polls it and then renders it as a PDF.
      return (
        <OfficeStage
          uri={preview.uri!}
          headers={preview.headers}
          palette={palette}
          onTap={toggleImmersive}
        />
      );
    }

    if (stage === "pdf") {
      return (
        <PdfStage
          uri={preview.uri}
          headers={preview.headers}
          cache={mayPersistBytes(file)}
          palette={palette}
          onPageCount={setPageCount}
          onTap={toggleImmersive}
          onFailed={() => setStageFailed(true)}
        />
      );
    }
    return <GlyphStage variant="none" name={file.name} mimeType={file.mime_type} extension={file.extension} palette={palette} />;
  })();

  // A plain function, not a component: it has to put an ImageStage in the
  // page's slot, which is what lets the active stage take that slot over.
  const neighbourPhoto = (item: FileItem) => {
    // Until its saved copy is known the page keeps its thumbnail: a network
    // source rendered offline would only fail, and mark the photo undecodable.
    if (!(item.id in savedCopies)) return <NeighbourPage file={item} />;
    const saved = savedCopies[item.id];
    const src = saved ? { uri: saved.uri, headers: {} } : viewerImageSource(item, null);
    return (
      <ImageStage
        uri={src.uri}
        headers={src.headers}
        placeholder={viewerImagePlaceholder(item, null)}
        cachePolicy={imageCachePolicy(item)}
        palette={palette}
        onDimensions={(label) => reportDimensions(item.id, label)}
        onFailed={() => markUndecodable(item.id, !!saved)}
      />
    );
  };

  const meta = metaParts(file, {
    dimensions,
    durationSec: durationSec ?? audioMeta?.durationSec ?? null,
    pageCount,
    lineCount: (stage === "text" || stage === "markdown" || stage === "csv") && preview.text ? lineCount(preview.text) : null,
    contactCount,
    readPercent,
  });

  const availability = actionAvailability(file, unlockToken);

  return (
    <View className="flex-1" style={{ backgroundColor: palette.bg }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* The record came from the cache this launch restored and the refetch
          failed - almost always no network. The file still opens; saying so
          quietly is the difference between "saved copy" and passing a stale
          record off as live. */}
      {/* A saved offline copy that is older than the server's: online from
          Files the user may open the newer one; otherwise it only says so. */}
      {preview.newerAvailable ? (
        <NewerVersionBar palette={palette} onOpenNewer={() => setAskedNewer(currentId)} />
      ) : preview.updatePending ? (
        <UpdatePendingNote palette={palette} />
      ) : isError || online === false ? (
        <View
          testID="viewer-offline-notice"
          className="absolute inset-x-0 top-0 z-10 flex-row items-center justify-center gap-1.5 px-3 py-1.5"
          style={{ backgroundColor: palette.chrome }}
          pointerEvents="none"
        >
          <Icon name="cloud-offline-outline" size={12} color={palette.fg} />
          <Text className="text-[11px]" style={{ color: palette.fg }}>{t("files.label.offlineShowingTheSavedCopy")}</Text>
        </View>
      ) : null}

      {ctx.paged ? (
        <FlatList
          testID="viewer-pager"
          ref={pagerRef}
          data={ctx.files}
          keyExtractor={(f) => f.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={ctx.index}
          getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
          // A settled page is the new current file. onMomentumScrollEnd fires
          // once per settle; onScroll would fire on every frame of the swipe
          // and refetch a file the user is still passing over.
          // In RTL page 0 sits at the right and the offset stays left based;
          // initialScrollIndex and scrollToIndex need no conversion (the list
          // converts its own writes), only this read does. See pagerIndex.ts.
          onMomentumScrollEnd={(e) => {
            const next = pageFromOffset(
              // rtl-ok: pager offset (pageFromOffset converts it for RTL)
              e.nativeEvent.contentOffset.x,
              width,
              ctx.files.length,
              { rtl: layoutIsRtl(), platform: Platform.OS === "android" ? "android" : "ios" },
            );
            const id = ctx.files[next]?.id;
            settledIndex.current = next;
            if (id && id !== currentId) setCurrentId(id);
          }}
          renderItem={({ item, index }) => (
            <Pressable
              onPress={toggleImmersive}
              accessibilityRole="button"
              accessibilityLabel={immersive ? t("files.action.showControls") : t("files.action.hideControls")}
              style={{ width }}
              className="h-full"
            >
              {item.id === currentId
                ? activeStage
                : Math.abs(index - ctx.index) === 1 && neighbourShowsPhoto(item)
                  // The very element the page will hold once it is current:
                  // the same component in the same slot with the same source,
                  // so settling on it updates props instead of remounting and
                  // the photo the swipe revealed is the one that stays.
                  ? neighbourPhoto(item)
                  : <NeighbourPage file={item} />}
            </Pressable>
          )}
        />
      ) : (
        <Pressable
          testID="viewer-stage"
          onPress={toggleImmersive}
          accessibilityRole="button"
          accessibilityLabel={immersive ? t("files.action.showControls") : t("files.action.hideControls")}
          className="flex-1"
        >
          {activeStage}
        </Pressable>
      )}

      <ViewerChrome
        visible={!immersive}
        position={positionLabel(ctx)}
        palette={palette}
        onBack={() => router.back()}
        onMore={() => setMoreOpen(true)}
      />

      <ViewerSheet
        visible={!immersive}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((v) => !v)}
        name={file.name}
        meta={meta}
        badge={lockBadge(file, unlockToken)}
        primary={primary}
        primaryBusy={false}
        onPrimary={onPrimary}
        download={download}
        onCancelDownload={onCancelDownload}
        note={
          isViewOnly(file)
            ? t("files.description.theOwnerTurnedOffDownloadsForThisFileYouCanViewItAndShare")
            : null
        }
        details={
          <ViewerDetails
            rows={detailRows(file, { regionLabel, formatWhen: formatDateTime })}
            neighbours={ctx.files}
            currentId={currentId}
            onSelect={(f) => setCurrentId(f.id)}
            // Photos only, and only once the workspace is known: the chips come
            // from this phone's Personas and show nothing where it is not ready.
            // Only for a file of the ACTIVE workspace: a chip opens /personas/[id],
            // which reads the active workspace, so a file from another one (a
            // notification deep link) would land on "no longer here".
            people={
              fileKind(file.mime_type, file.extension) === "image" && activeWsId && (file.workspace_id ?? activeWsId) === activeWsId
                ? <PeopleChips wsId={activeWsId} fileId={currentId} />
                : undefined
            }
          />
        }
      >
        <ViewerActions
          availability={availability}
          starred={fav.isFav}
          starBusy={fav.busy}
          download={download}
          versionCount={file.current_version}
          handlers={{
            onDownload: () => void onDownload(),
            onLink: () => router.push({ pathname: "/file/[id]/share", params: { id: file.id } }),
            onStar: fav.toggle,
            onVersions: () => router.push({ pathname: "/file/[id]/versions", params: { id: file.id } }),
            onMore: () => setMoreOpen(true),
          }}
        />
      </ViewerSheet>

      <ViewerMoreSheet
        visible={moreOpen}
        file={file}
        actions={moreActions}
        onClose={() => setMoreOpen(false)}
      />

      <CastSheet
        visible={castOpen}
        chromecast={castReady}
        airPlay={airPlay}
        onPickDevice={onPickTv}
        onAirPlay={onAirPlay}
        onStop={() => void stopCasting()}
        onControls={openCastControls}
        onClose={() => setCastOpen(false)}
      />

      <PromptDialog
        visible={renaming}
        title={t("files.heading.renameFile")}
        initialValue={file.name}
        placeholder={t("files.placeholder.fileName")}
        confirmLabel={t("common.action.rename")}
        onCancel={() => setRenaming(false)}
        onSubmit={(name) => {
          setRenaming(false);
          const trimmed = name.trim();
          if (!trimmed || trimmed === file.name) return;
          mutations.rename.mutate(
            { id: file.id, name: trimmed },
            { onSuccess: () => { toast(t("files.label.renamed")); void refetch(); } },
          );
        }}
      />
    </View>
  );
}

/**
 * Whether the page next to the current one loads the real photo.
 *
 * Only a plain image the device may cache: the two pages either side of the
 * current one, so a swipe reveals the full photo at its final size rather than
 * a thumbnail that jumps to full screen once the page settles. A locked file
 * needs its unlock first, and a view-only one must not be fetched for a page
 * the user may never reach - both keep the thumbnail.
 */
function neighbourShowsPhoto(file: FileItem): boolean {
  return fileKind(file.mime_type, file.extension) === "image" && mayPersistBytes(file);
}

/**
 * A page further out, or one that is not a plain photo.
 *
 * The disk-cached thumbnail the list already loaded, so a swipe lands on
 * something recognisable immediately and the full stage takes over once the
 * page settles. Presigning every neighbour up front would fire a request per
 * file in the folder for files the user may never reach.
 */
function NeighbourPage({ file }: { file: FileItem }) {
  return (
    <View className="flex-1 items-center justify-center px-10">
      <View className="aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl opacity-70">
        <FileThumb file={file} variant="grid" />
      </View>
    </View>
  );
}
