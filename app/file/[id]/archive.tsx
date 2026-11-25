// apps/mobile/app/file/[id]/archive.tsx
//
// Browsing what is inside a stored zip, on a phone: one directory level at a
// time rather than the inline tree web and desktop draw. Tapping a folder
// does not push a new route - it just moves the `path` stack this screen
// keeps and re-renders the level underneath it, which is what lets the chip
// row jump back up several levels in one tap instead of one pop per level.
//
// An entry is addressed by its central-directory INDEX, never by its name -
// that is the server's contract (see archive-tree.ts) and the reason
// traversal is unreachable here. `onOpenFile`/`onOpenDir` below always take
// the TreeNode itself; nothing reconstructs a path to look an entry up by.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, BackHandler, Image, Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { apiRequest } from "@/api/client";
import { ApiError, API_BASE_URL } from "@/api";
import { getAccessToken } from "@/auth/authStore";
import { downloadToCache, shareFile } from "@/files/download";
import { fileKind, formatBytes } from "@/files/format";
import { fonts } from "@/theme/fonts";
import { toast } from "@/ui/toast";
import { rtlLine, useT } from "@/lib/i18n";
import { formatNumber, localDigits } from "@/lib/format-locale";
import { stagePalette, CHROME_SCRIM } from "@/viewer/stageTheme";
import { buildArchiveTree, type ArchiveEntry, type TreeNode } from "@/archive/archiveTree";
import { ArchiveList } from "@/archive/ArchiveList";
import { planFolderSave, MAX_FOLDER_SAVE_FILES } from "@/archive/archiveSave";
import { useArchiveSaveStore, type ArchiveSaveJob } from "@/archive/archiveSaveStore";

/** The body of `GET /api/files/:id/archive`. */
interface ArchiveIndex {
  /** What the API opened it as. Older cached responses may omit it. */
  kind?: "zip" | "iso";
  archiveSize: number;
  totalEntries: number;
  truncated: boolean;
  entries: ArchiveEntry[];
}

/**
 * `download` is not a formatting detail - it is the whole permission story.
 *
 * Without `dl=1` the server serves the entry off its PREVIEW chain, which
 * deliberately allows a view-only file and a view-only ancestor folder because
 * previewing is exactly what view-only permits. `dl=1` switches it to the
 * download rules instead (see the api route's own comment: "An archive is not
 * a way around that") - it 403s a view_only file and re-runs the download
 * guard without allowViewOnlyFolders. So: the inline image preview asks
 * WITHOUT it, and anything that puts bytes on the device - the cache download
 * that feeds the OS share sheet, with its Save to Files and AirDrop - asks
 * WITH it, and lets the server refuse.
 *
 * `version` is the other half: both archive routes accept `?version=N` (see
 * the api's resolve-viewable.ts) and both answer `Cache-Control: private,
 * max-age=3600` with no cache-buster, so an unversioned URL both ignores which
 * version was asked for and keeps serving a re-uploaded zip's old contents for
 * up to an hour. The server's cache key is version-specific already.
 */
function entryUrl(fileId: string, index: number, download = false, version?: string): string {
  const v = version ? `&version=${version}` : "";
  return `${API_BASE_URL}/api/files/${fileId}/archive/entry?i=${index}${download ? "&dl=1" : ""}${v}`;
}

function extOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : null;
}

const DISK_IMAGE_EXTS = new Set(["iso", "img"]);
const isDiskImageName = (name: string) => DISK_IMAGE_EXTS.has((extOf(name) ?? "").toLowerCase());

export default function ArchiveRoute() {
  const t = useT();
  // `version` is optional and absent today - the file screen shows the current
  // version and pushes here without one - but the route accepts it so a link
  // that names a version lists and opens THAT version's entries rather than
  // silently answering with the latest.
  const { id, name, version } = useLocalSearchParams<{ id: string; name?: string; version?: string }>();
  const { scheme, tokens } = useColorTheme();
  // The image-preview modal is a stage, same as the viewer's own ImageStage -
  // it holds nothing but the file, so it takes the app's fixed dark stage
  // palette rather than the active theme (see stageTheme.ts's own reasoning).
  const palette = stagePalette(scheme);
  const archiveName = name || t("archive.label.thisArchive");

  const [index, setIndex] = useState<ArchiveIndex | null>(null);
  // The failure KIND, not its sentence: the text is produced at render so it follows the language.
  const [error, setError] = useState<{ kind: "disk" | "zip" | "tooLarge" | "failed"; serverMessage: string } | null>(null);
  // The path stack, by directory NAME - display and navigation only. The
  // server is never asked for a path; every fetch below is by index.
  const [path, setPath] = useState<string[]>([]);
  const [preview, setPreview] = useState<TreeNode | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  // A new archive - or a new VERSION of the same one - starts with a clean
  // index/error, since a different version is a different set of entries and
  // the old index does not describe it. State is adjusted during render on
  // that key changing (the same React-documented pattern the web and desktop
  // copies use for prevFileId - see file-viewer.tsx) rather than in the effect
  // below, so the effect is left doing only the fetch.
  const key = `${id}:${version ?? ""}`;
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    setIndex(null);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    apiRequest<ArchiveIndex>(`/api/files/${id}/archive${version ? `?version=${version}` : ""}`)
      .then((data) => {
        if (!cancelled) setIndex(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 422 means the file itself is not a valid zip (or, for a .iso/.img,
        // not an ISO 9660 image - and the server's sentence says which raw
        // formats it cannot read, so that travels along); 413 means a valid
        // archive the server declined to index. Every other status is a
        // request problem.
        const status = err instanceof ApiError ? err.status : null;
        const disk = isDiskImageName(archiveName);
        setError({
          kind: status === 422 ? (disk ? "disk" : "zip") : status === 413 ? "tooLarge" : "failed",
          serverMessage: err instanceof ApiError ? err.message : "",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  const tree = useMemo(() => (index ? buildArchiveTree(index.entries) : []), [index]);

  const currentNodes = useMemo(() => {
    let level = tree;
    for (const seg of path) {
      const dir = level.find((n) => n.kind === "dir" && n.name === seg);
      if (!dir) return [];
      level = dir.children;
    }
    return level;
  }, [tree, path]);

  const goUp = useCallback(() => {
    setPath((p) => (p.length === 0 ? p : p.slice(0, -1)));
  }, []);

  const goBack = useCallback(() => {
    if (path.length > 0) goUp();
    else router.back();
  }, [path.length, goUp]);

  // Mirrors the platform back gesture stepping up one level rather than
  // leaving the whole screen, same as tapping a chip - Android's hardware key
  // gets this for free; the header's own back button below gets it too.
  useEffect(() => {
    if (path.length === 0) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      goUp();
      return true;
    });
    return () => sub.remove();
  }, [path.length, goUp]);

  const onOpenDir = useCallback((node: TreeNode) => {
    setPath((p) => [...p, node.name]);
  }, []);

  const onOpenFile = useCallback(
    (node: TreeNode) => {
      if (node.index === null) return;
      const kind = fileKind("", extOf(node.name));
      if (kind === "image") {
        setPreview(node);
        return;
      }
      // No inline preview for the rest - handing the entry to the OS's own
      // share sheet is how every other "nothing to render here" file in this
      // app already gets opened (see GlyphStage). The token travels as a
      // request header on the download, never in the URL.
      //
      // `dl=1`, because this path ends at Save to Files and AirDrop: the file
      // screen only offers "Share via…" when canDownload(file) says so
      // (files/lock.ts: "Whether to offer download / share / export at all"),
      // and an archive must not be the one screen that skips the same rule.
      // The server is what enforces it; this asks the question honestly.
      setOpening(node.name);
      const authToken = getAccessToken();
      downloadToCache(entryUrl(id, node.index, true, version), node.name, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
        .then((uri) => shareFile(uri))
        .catch((err: unknown) => {
          // A refusal is not a failed transfer, and must not be reported as
          // one - retrying will never help. The wording holds for every 403
          // this route can send back (view-only, a lock, folder confinement,
          // a missing permission) without guessing which one it was.
          const status = err instanceof ApiError ? err.status : null;
          toast(
            status === 403
              ? t("archive.status.youDonTHavePermissionToSaveOrShareThisEntry")
              : t("archive.error.thisEntryCouldNotBeTransferred"),
            "error",
          );
        })
        .finally(() => setOpening(null));
    },
    [id, version, t],
  );

  // Saving INTO dosya. The server saves one entry per request; a folder is
  // planned here and driven by the destination picker one file at a time
  // (archiveSave.ts). The job travels through archiveSaveStore - a plan can
  // name hundreds of entries, far too much for route params.
  const startSave = useCallback((job: ArchiveSaveJob) => {
    useArchiveSaveStore.getState().park(job);
    router.push("/pick-archive-destination");
  }, []);
  const startFolderSave = useCallback((nodes: TreeNode[], rootName: string) => {
    const plan = planFolderSave(nodes, rootName);
    if ("tooMany" in plan) {
      toast(
        t("archive.status.thisFolderHasTooManyFilesSaveSmallerFoldersUpToMaxFolderSaveFilesOrTransferThe", {
          tooMany: formatNumber(plan.tooMany),
          maxFolderSaveFiles: localDigits(MAX_FOLDER_SAVE_FILES),
        }),
        "error",
      );
      return;
    }
    startSave({ fileId: id, archiveName, version, kind: "folder", plan });
  }, [id, archiveName, version, startSave, t]);
  const onSaveNode = useCallback((node: TreeNode) => {
    if (node.kind === "dir") {
      startFolderSave(node.children, node.name);
      return;
    }
    if (node.index === null) return;
    // The tree's CLEANED name travels as the override, so the file that lands
    // carries the name the user tapped, not a spoofed raw entry name.
    startSave({ fileId: id, archiveName, version, kind: "entry", index: node.index, name: node.name });
  }, [id, archiveName, version, startSave, startFolderSave]);
  const archiveBaseName = archiveName.replace(/\.[^.]+$/, "") || archiveName;

  const currentDirName = path.length > 0 ? path[path.length - 1]! : archiveName;
  const token = getAccessToken();

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackVisible: false,
          // Swipe-back would exit the whole screen rather than stepping up a
          // level, so a user three folders deep would lose all context in one
          // gesture. Disable it while inside a subfolder; the header button
          // and Android's back key both step up correctly.
          gestureEnabled: path.length === 0,
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.back")}
              hitSlop={8}
              onPress={goBack}
              className="h-11 w-11 items-center justify-center"
            >
              <Icon name="chevron-back" size={24} color={tokens.foreground} />
            </Pressable>
          ),
          headerTitle: () => (
            <View className="items-center">
              <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: tokens.foreground }}>
                {currentDirName}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 11, color: tokens.mutedForeground }}>
                {t("archive.label.inArchiveName", { archiveName })}
              </Text>
            </View>
          ),
        }}
      />

      <ChipRow
        archiveName={archiveName}
        path={path}
        onJump={(depth) => setPath((p) => p.slice(0, depth))}
        entryCount={currentNodes.length}
      />

      {index && path.length === 0 && tree.length > 0 && (
        <View className="flex-row items-center justify-between border-b border-border px-4 py-2">
          <Text style={{ fontSize: 11, color: tokens.mutedForeground }}>
            {index.kind === "iso" || (!index.kind && isDiskImageName(archiveName)) ? t("archive.label.diskImage") : t("archive.label.archive")}
          </Text>
          <Pressable
            testID="archive-save-all"
            accessibilityRole="button"
            accessibilityLabel={t("archive.action.saveEverythingInThisArchiveToDosya")}
            hitSlop={8}
            onPress={() => startFolderSave(tree, archiveBaseName)}
            className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ backgroundColor: tokens.muted }}
          >
            <Icon name="download-outline" size={14} color={tokens.foreground} />
            <Text style={{ fontSize: 12, fontWeight: "600", color: tokens.foreground }}>{t("common.action.saveAllToDosya")}</Text>
          </Pressable>
        </View>
      )}

      {error ? (
        <View testID="archive-error" className="flex-1 items-center justify-center gap-2 px-8">
          <Icon name="alert-circle-outline" size={28} color={tokens.mutedForeground} />
          <Text className="text-center text-sm" style={{ color: tokens.mutedForeground }}>
            {error.kind === "disk"
              ? t("archive.description.thisFileIsnTAValidDiskImageHasErrorSelectTrueServerErrorOther", {
                  hasError: error.serverMessage ? "true" : "false",
                  serverError: error.serverMessage,
                }).trim()
              : error.kind === "zip"
                ? t("archive.error.thisFileIsnTAValidZip")
                : error.kind === "tooLarge"
                  ? t("archive.error.thisArchiveIsTooLargeToListDownloadItToOpenItsContents")
                  : t("archive.error.thisArchiveCouldNotBeOpened")}
          </Text>
        </View>
      ) : !index ? (
        <View testID="archive-loading" className="flex-1 items-center justify-center">
          <ActivityIndicator color={tokens.mutedForeground} />
        </View>
      ) : currentNodes.length === 0 ? (
        // Keyed on the level actually being drawn, not on totalEntries: an
        // archive whose entries all neutralise away (names made only of
        // control or bidi characters - see archiveTree.ts) reports a non-zero
        // count and still has no row, and a folder can be empty while the
        // archive around it is not. Both used to draw a blank list.
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-sm" style={{ color: tokens.mutedForeground }}>
            {path.length === 0 ? t("common.description.thereIsNothingInsideThisArchive") : t("archive.description.thereIsNothingInThisFolder")}
          </Text>
        </View>
      ) : (
        <>
          <ArchiveList nodes={currentNodes} onOpenDir={onOpenDir} onOpenFile={onOpenFile} onSave={onSaveNode} />
          {index.truncated && path.length === 0 && (
            <View className="border-t border-border px-4 py-2.5">
              <Text style={{ fontSize: 11, color: tokens.mutedForeground }}>
                {t("archive.description.showingTheFirstEntriesCountOfTotalEntriesEntriesTransferTheWholeArchiveToGetThe", {
                  entriesCount: formatNumber(index.entries.length),
                  totalEntries: formatNumber(index.totalEntries),
                })}
              </Text>
            </View>
          )}
        </>
      )}

      {opening && (
        // Reuses the viewer's own chrome scrim colour rather than a fresh
        // literal - same dark, same purpose (dim the surface behind a
        // floating control), just solid instead of the chrome gradient.
        <View className="absolute inset-0 items-center justify-center" style={{ backgroundColor: CHROME_SCRIM[0] }} pointerEvents="none">
          <ActivityIndicator color={palette.fg} />
        </View>
      )}

      <Modal visible={preview !== null} animationType="fade" onRequestClose={() => setPreview(null)}>
        <View className="flex-1" style={{ backgroundColor: palette.bg }}>
          <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
            <View className="flex-row items-center justify-end px-3 py-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("archive.action.closePreview")}
                hitSlop={8}
                onPress={() => setPreview(null)}
                className="h-11 w-11 items-center justify-center"
              >
                <Icon name="close" size={26} color={palette.fg} />
              </Pressable>
            </View>
            {preview && preview.index !== null && (
              <>
                <View className="flex-1 items-center justify-center px-4">
                  <Image
                    testID="archive-preview-image"
                    // RN's Image needs the bearer token as a request header,
                    // not folded into the URL - a bare uri string carries no
                    // Authorization at all and the preview fails to load.
                    source={{
                      uri: entryUrl(id, preview.index, false, version),
                      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                    }}
                    resizeMode="contain"
                    style={{ width: "100%", height: "100%" }}
                    accessibilityLabel={preview.name}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: fonts.mono, fontSize: 11, color: palette.fg, textAlign: "center", paddingBottom: 12, paddingHorizontal: 16 }}
                >
                  {rtlLine(`${preview.name} · ${formatBytes(preview.size)}`)}
                </Text>
              </>
            )}
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ChipRow(props: {
  archiveName: string;
  path: string[];
  onJump: (depth: number) => void;
  entryCount: number;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const chips = [{ label: t("sync.label.root"), depth: 0 }, ...props.path.map((seg, i) => ({ label: seg, depth: i + 1 }))];

  return (
    <View className="flex-row items-center border-b border-border px-3 py-2">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1">
        {chips.map((chip, i) => {
          const current = i === chips.length - 1;
          return (
            <Pressable
              key={`${chip.depth}:${chip.label}`}
              testID={`archive-chip-${chip.depth}`}
              accessibilityRole="button"
              accessibilityLabel={chip.depth === 0 ? t("archive.label.archivenameRoot", { archiveName: props.archiveName }) : chip.label}
              accessibilityState={{ selected: current }}
              disabled={current}
              onPress={() => props.onJump(chip.depth)}
              // The chip's visual pill is shorter than 44px - hitSlop makes up
              // the difference rather than inflating the pill itself.
              hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
              className="me-1.5 flex-row items-center gap-1 rounded-full px-3 py-1.5"
              style={{ backgroundColor: current ? tokens.muted : "transparent" }}
            >
              {chip.depth === 0 && (
                <Icon name="archive-outline" size={12} color={current ? tokens.foreground : tokens.mutedForeground} />
              )}
              <Text
                numberOfLines={1}
                style={{ fontSize: 12, fontWeight: current ? "600" : "400", color: current ? tokens.foreground : tokens.mutedForeground }}
              >
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: tokens.mutedForeground, marginStart: 8 }}>
        {t("archive.label.entrycountPluralOneEntryOtherEntries", { entryCount: props.entryCount })}
      </Text>
    </View>
  );
}
