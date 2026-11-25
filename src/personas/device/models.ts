// The two face models the native Personas reader loads, kept under the app's
// document directory. Names and SHA-256 pins match ORT_FILES in
// apps/web/src/lib/personas-device/read-core.ts: keep the two in step.
// A model is downloaded to <name>.part and renamed only once its hash matches,
// so a half-written or tampered file is never the one the reader loads.
// The folder is excluded from iCloud and device backups (iOS): the models are
// about 40 MB and can always be downloaded again. Files already on a phone
// get the flag the first time they are found ready.
import * as FileSystem from "expo-file-system/legacy";
import { API_BASE_URL } from "@/api/config";
import { excludeFromBackup as nativeExcludeFromBackup, sha256File as nativeSha256File } from "../../../modules/dosya-face-reader";

export const FACE_MODEL_FILES: readonly { name: string; sha256: string }[] = [
  { name: "yunet-2023mar-320.onnx", sha256: "43bd9174af4ff8107207bfb43bf03a2682031ecca26b3aade72ac80ef2db041b" },
  { name: "sface-2021dec-f16-batch.onnx", sha256: "591694e8f7e1a48ecf20507aacea4199abd5fcf21410ea1fc60cb110f869aa15" },
];

export interface ModelDeps {
  dir: string;
  exists(p: string): Promise<boolean>;
  download(url: string, to: string): Promise<void>;
  remove(p: string): Promise<void>;
  /** Move a verified download into place; replaces any file already there. */
  rename(from: string, to: string): Promise<void>;
  sha256File(p: string): Promise<string>;
  /** Keep the folder out of backups (best effort; iOS only in the app). */
  excludeFromBackup?(dir: string): Promise<void>;
  apiBase: string;
}

const plain = (uri: string) => uri.replace(/^file:\/\//, "");

function defaultDir(): string {
  return `${FileSystem.documentDirectory ?? ""}personas-models/`;
}

function defaultDeps(): ModelDeps {
  return {
    dir: defaultDir(),
    apiBase: API_BASE_URL,
    exists: async (p) => (await FileSystem.getInfoAsync(p)).exists,
    download: async (url, to) => {
      await FileSystem.makeDirectoryAsync(to.replace(/\/[^/]*$/, ""), { intermediates: true });
      // Foreground session: the legacy API's default BACKGROUND URLSession fails at
      // once on the iOS simulator (NSURLErrorDomain -1), and the reader only
      // downloads while the app is open (ensureFaceModels runs in the foreground).
      const res = await FileSystem.downloadAsync(url, to, { sessionType: FileSystem.FileSystemSessionType.FOREGROUND });
      // downloadAsync writes HTTP error bodies to disk instead of rejecting.
      if (res.status !== 200) throw new Error(`model download failed: HTTP ${res.status}`);
    },
    remove: async (p) => {
      await FileSystem.deleteAsync(p, { idempotent: true });
    },
    rename: async (from, to) => {
      await FileSystem.deleteAsync(to, { idempotent: true });
      await FileSystem.moveAsync({ from, to });
    },
    sha256File: (p) => nativeSha256File(plain(p)),
    excludeFromBackup: (dir) => nativeExcludeFromBackup(plain(dir).replace(/\/+$/, "")),
  };
}

export function faceModelPaths(dir: string = defaultDir()): { detector: string; embedder: string } {
  return { detector: `${dir}${FACE_MODEL_FILES[0].name}`, embedder: `${dir}${FACE_MODEL_FILES[1].name}` };
}

let ready = false;
/** Test hook: forget the per-process memo. */
export function resetFaceModelsMemo(): void {
  ready = false;
}

async function good(deps: ModelDeps, path: string, sha256: string): Promise<boolean> {
  try {
    return (await deps.exists(path)) && (await deps.sha256File(path)) === sha256;
  } catch {
    return false;
  }
}

async function keepOutOfBackups(deps: ModelDeps): Promise<void> {
  try {
    await deps.excludeFromBackup?.(deps.dir);
  } catch {
    /* only a backup size question: the models still work */
  }
}

/** Both models are on disk and match their pins. Only a true answer is remembered. */
export async function faceModelsReady(deps: ModelDeps = defaultDeps()): Promise<boolean> {
  if (ready) return true;
  const p = faceModelPaths(deps.dir);
  const ok = (await good(deps, p.detector, FACE_MODEL_FILES[0].sha256)) && (await good(deps, p.embedder, FACE_MODEL_FILES[1].sha256));
  if (ok) {
    ready = true;
    // Once per process: also flags models downloaded before the folder was excluded.
    await keepOutOfBackups(deps);
  }
  return ok;
}

/** Download whichever model is missing or corrupt; false on any failure. */
export async function ensureFaceModels(deps: ModelDeps = defaultDeps()): Promise<boolean> {
  const p = faceModelPaths(deps.dir);
  const targets = [p.detector, p.embedder];
  for (let i = 0; i < FACE_MODEL_FILES.length; i++) {
    const { name, sha256 } = FACE_MODEL_FILES[i];
    const to = targets[i];
    if (await good(deps, to, sha256)) continue;
    const part = `${to}.part`;
    try {
      await deps.remove(part);
      await deps.download(`${deps.apiBase}/api/personas/models/${name}?v=${sha256.slice(0, 16)}`, part);
      if ((await deps.sha256File(part)) !== sha256) {
        await deps.remove(part);
        return false;
      }
      await deps.rename(part, to);
    } catch {
      try {
        await deps.remove(part);
      } catch {
        /* nothing left to clean */
      }
      return false;
    }
  }
  return faceModelsReady(deps);
}
