import TrackPlayer from "react-native-track-player";
import { onLocaleChange, t } from "@/lib/i18n";
import { isCarPlaySupported, getCarPlayModule } from "./carplayNative";
import { hydrateForCarPlay } from "./bootstrap";
import { listBrowseLevel } from "./browse";
import type { BrowseLevel } from "./browse";
import { getCurrentPlayback, getRecent } from "./recents";
import { playFileQueue, playSingleFile } from "@/player/controller";
import { getFile } from "@/files/api";
import { ApiError } from "@/api";
import type { FileItem, FolderItem } from "@/files/types";

// TODO(android-auto follow-up spec): the active workspace should come from a
// shared incar-scope accessor once Android Auto reuses this module; for v1
// CarPlay reads it directly off the same store the phone UI uses.
import { useWorkspaceStore } from "@/files/workspaceStore";

interface RowItem {
  text: string;
  detailText?: string;
  showsDisclosureIndicator?: boolean;
  onSelect: () => Promise<void>;
}

/**
 * Apple caps a non-navigation app's CarPlay template stack at 5, and
 * `CarPlay.pushTemplate` is a void bridge call - a push past the cap fails
 * natively with nothing observable from JS, so tapping a too-deep folder would
 * simply do nothing at all for the driver. Browsing is therefore capped at 4
 * templates (root + 3 pushed folder levels); the 5th slot, still inside Apple's
 * limit, is spent on a row that says why rather than on a silent no-op.
 */
const MAX_TEMPLATE_DEPTH = 4;
const tooDeepRowText = (): string => t("carplay.error.tooManyNestedFoldersBrowseThisOnYourIPhone");

function toListItem(row: RowItem) {
  return { text: row.text, detailText: row.detailText, showsDisclosureIndicator: row.showsDisclosureIndicator };
}

async function playFolderFile(files: FileItem[], startFileId: string, sourceName: string): Promise<void> {
  await playFileQueue(files, startFileId, sourceName);
}

/**
 * Resumes one saved track (Continue Listening / Recently Played).
 *
 * Deliberately NOT `playFolder`: history rows carry no folder context
 * (`PlayerTrack` has no folder id, so historyHooks.ts persists `folderId: null`),
 * and `playFolder(folderId: null)` fetches the WORKSPACE ROOT listing, fails to
 * find `startFileId` in it, and plays whatever happens to sit first at the root
 * - i.e. the wrong file. `getFile` needs no folder context at all, so this plays
 * exactly the saved track, solo. The trade is losing "resume the rest of the
 * folder queue" until folder context is threaded through PlayerTrack.
 *
 * `seekToSeconds` is only ever non-null for Continue Listening; Recently Played
 * entries carry no position and correctly start at 0:00.
 */
async function resumeSavedTrack(
  fileId: string,
  sourceName: string,
  seekToSeconds: number | null,
): Promise<void> {
  let file: FileItem;
  try {
    file = await getFile(fileId);
  } catch (e) {
    // Deleted, moved out of reach, or offline: there is no modal to show while
    // driving (spec Non-goals), so this stays a no-op rather than throwing out
    // of the tap handler.
    console.warn("[carplay] couldn't load the saved track", e);
    return;
  }
  const started = await playSingleFile(file, sourceName);
  if (started && seekToSeconds !== null && seekToSeconds > 0) {
    await TrackPlayer.seekTo(seekToSeconds);
  }
}

export function installCarPlayBrowseScreen(): void {
  if (!isCarPlaySupported()) return;
  const { CarPlay, ListTemplate } = getCarPlayModule();

  // Root template counts as one. Reset on every connect so a reconnect starts
  // from a clean stack rather than inheriting the previous drive's depth.
  let templateDepth = 1;

  function buildList(rows: RowItem[], title: string) {
    return new ListTemplate({
      title,
      sections: [{ items: rows.map(toListItem) }],
      onItemSelect: async (e: { index: number }) => {
        await rows[e.index]?.onSelect();
      },
      // react-native-carplay installs its own back CPBarButton on every
      // ListTemplate (RNCarPlay.m, `backButtonHidden` unset) and fires this
      // before popping, which is what keeps the depth counter from being a
      // one-way ratchet that would wrongly report "too deep" after the driver
      // backs out of a deep folder. Floored at 1 so the root's (inert) back
      // button can't push it below the root template itself.
      onBackButtonPressed: () => {
        templateDepth = Math.max(1, templateDepth - 1);
      },
    });
  }

  async function pushList(rows: RowItem[], title: string) {
    templateDepth += 1;
    await CarPlay.pushTemplate(buildList(rows, title));
  }

  function signedOutList() {
    return buildList([{ text: t("carplay.action.openDosyaOnYourIPhoneToSignIn"), onSelect: async () => {} }], "dosya");
  }

  /**
   * A 401 that survives apiRequest's own automatic refresh means the refresh
   * token itself is dead (spec Error handling: "Refresh token invalid") —
   * distinct from a network/5xx blip, which is transient and doesn't mean the
   * session is gone. CarPlay can't show a login form either way, but the
   * message should tell the driver which one it is.
   */
  function errorRowText(e: unknown): string {
    if (e instanceof ApiError && e.status === 401) return t("carplay.description.reconnectOnYourIPhoneToKeepBrowsing");
    return t("carplay.error.couldnTLoadYourFilesCheckYourConnection");
  }

  function playFolderRow(workspaceId: string, folder: FolderItem): RowItem {
    return { text: folder.name, showsDisclosureIndicator: true, onSelect: async () => pushFolder(workspaceId, folder) };
  }

  async function pushFolder(workspaceId: string, folder: FolderItem) {
    if (templateDepth >= MAX_TEMPLATE_DEPTH) {
      await pushList([{ text: tooDeepRowText(), onSelect: async () => {} }], folder.name);
      return;
    }
    let level: BrowseLevel | { error: unknown };
    try {
      level = await listBrowseLevel(workspaceId, folder.id);
    } catch (e) {
      level = { error: e };
    }
    const rows: RowItem[] = [];
    if ("error" in level) {
      rows.push({ text: errorRowText(level.error), onSelect: async () => {} });
    } else {
      for (const sub of level.folders) rows.push(playFolderRow(workspaceId, sub));
      for (const file of level.audioFiles) {
        rows.push({ text: file.name, onSelect: async () => playFolderFile(level.audioFiles, file.id, folder.name) });
      }
    }
    await pushList(rows, folder.name);
  }

  // True between connect and disconnect, so a language switch while the head
  // unit is showing us rebuilds the root list in the new language.
  let connected = false;

  async function buildRoot() {
    templateDepth = 1;
    const status = await hydrateForCarPlay();
    if (status === "signed-out") {
      await CarPlay.setRootTemplate(signedOutList());
      return;
    }

    const workspaceId = useWorkspaceStore.getState().activeId;
    if (!workspaceId) {
      await CarPlay.setRootTemplate(signedOutList());
      return;
    }

    // Each branch gets its own .catch() so a listBrowseLevel failure can't
    // drag down current/recent (which may have already resolved with real
    // data) via Promise.all's all-or-nothing rejection - see task-5 review
    // finding 1. Note: chaining .catch() onto each branch adds one extra
    // microtask tick before Promise.all can settle vs. a shared try/catch
    // around the whole group (measured empirically) - callers awaiting this
    // in tests need one more tick than before.
    const [current, recent, level]: [
      Awaited<ReturnType<typeof getCurrentPlayback>>,
      Awaited<ReturnType<typeof getRecent>>,
      BrowseLevel | { error: unknown },
    ] = await Promise.all([
      getCurrentPlayback().catch(() => null),
      getRecent(workspaceId).catch(() => []),
      listBrowseLevel(workspaceId, null).catch((e) => ({ error: e }) as const),
    ]);

    const rows: RowItem[] = [];
    // getCurrentPlayback() is a single device-wide row and is NOT workspace
    // scoped by the query, so it's filtered here - otherwise the active
    // workspace's root would offer a track from a different workspace.
    if (current && current.workspaceId === workspaceId) {
      rows.push({
        text: current.title,
        detailText: t("carplay.label.continueListening"),
        onSelect: async () => resumeSavedTrack(current.fileId, current.sourceName, current.positionSeconds),
      });
    }
    for (const entry of recent) {
      rows.push({
        text: entry.title,
        detailText: entry.sourceName,
        onSelect: async () => resumeSavedTrack(entry.fileId, entry.sourceName, null),
      });
    }
    if ("error" in level) {
      rows.push({ text: errorRowText(level.error), onSelect: async () => {} });
    } else {
      for (const folder of level.folders) rows.push(playFolderRow(workspaceId, folder));
      for (const file of level.audioFiles) {
        // "Personal" is wrong for any non-default/team workspace: useWorkspaceStore
        // only exposes activeId here, not a display name, so there's no lookup to
        // resolve the real workspace name at the root level. Fixing this properly
        // needs a workspace-name accessor - out of scope for this task.
        rows.push({ text: file.name, onSelect: async () => playFolderFile(level.audioFiles, file.id, t("common.label.personal")) });
      }
    }

    await CarPlay.setRootTemplate(buildList(rows, "dosya"));
  }

  CarPlay.registerOnConnect(async () => {
    connected = true;
    await buildRoot();
  });

  CarPlay.registerOnDisconnect(() => {
    // Templates are cheap to rebuild on the next connect, and
    // react-native-carplay has no per-template dispose() to call anyway.
    connected = false;
  });

  onLocaleChange(() => {
    if (connected) void buildRoot().catch((e) => console.warn("[carplay] couldn't rebuild after a language change", e));
  });
}
