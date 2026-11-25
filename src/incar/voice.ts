import { t } from "@/lib/i18n";
import { searchAudio } from "./search";
import { playFileQueue } from "@/player/controller";
import type { FileItem, FolderItem } from "@/files/types";
import { SiriSearch } from "../../modules/dosya-siri-search";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { hydrateForCarPlay } from "./bootstrap";

export type VoiceResolution =
  | { kind: "played"; fileId: string }
  | { kind: "ambiguous"; folders: FolderItem[]; files: FileItem[] }
  | { kind: "no-match" };

/**
 * A spoken query resolves to exactly one audio file, many, or none — an
 * ambiguous or empty result must never guess which file to play (spec Voice
 * flow). "played" is the only case that starts audio; the other two are for
 * the caller to render as a fallback list.
 */
export async function resolveVoiceQuery(workspaceId: string, query: string): Promise<VoiceResolution> {
  const results = await searchAudio(workspaceId, query);
  if (results.files.length === 1 && results.folders.length === 0) {
    const file = results.files[0];
    await playFileQueue([file], file.id, t("carplay.label.searchResults"));
    return { kind: "played", fileId: file.id };
  }
  if (results.files.length === 0 && results.folders.length === 0) {
    return { kind: "no-match" };
  }
  return { kind: "ambiguous", folders: results.folders, files: results.files };
}

/**
 * Wires the native Siri bridge (see modules/dosya-siri-search) into the
 * resolver. Two delivery paths, both handled here: `addQueryListener` covers
 * the app already running when Siri fires the intent; `takePendingQuery`
 * drains a query that arrived while JS wasn't listening yet (Siri cold-
 * launching the app - the intent handler runs before this module's listener
 * is registered).
 *
 * The cold-launch path is exactly why `hydrateForCarPlay()` has to run before
 * `activeId` is read: on a Siri cold launch nothing has mounted the phone app's
 * Files tab and no CarPlay scene has connected, so the workspace store is still
 * at its initial `activeId: null` and the query would be silently dropped by the
 * guard below. browseScreen.ts hydrates for the same reason on connect.
 */
export function installVoiceSearch(): void {
  const handle = async (query: string): Promise<void> => {
    if (!query) return;
    if ((await hydrateForCarPlay()) === "signed-out") return;
    const workspaceId = useWorkspaceStore.getState().activeId;
    if (!workspaceId) return;
    await resolveVoiceQuery(workspaceId, query);
  };

  // The native bridge's listener signature is sync, so the promise is kicked off
  // and its rejection reported here rather than escaping as an unhandled one.
  const run = (query: string) => {
    void handle(query).catch((e) => {
      console.warn("[voice] resolveVoiceQuery failed", e);
    });
  };

  SiriSearch.addQueryListener(run);

  const pending = SiriSearch.takePendingQuery();
  if (pending) run(pending);
}
