// Which face reader this phone uses for Personas: the native one
// (modules/dosya-face-reader + ONNX Runtime) once its module is in the build
// and both models are on disk and match their pins, otherwise the hidden
// WebView (./reader.ts). Kept apart from engine-host so ReaderHost can ask
// without loading the engine.
import { isNativeFaceReaderAvailable } from "../../../modules/dosya-face-reader";
import { faceModelsReady } from "./models";

export type ReaderKind = "native" | "webview";

let modelsReady = false;
let forced: ReaderKind | null = null;
const fns = new Set<() => void>();

const announce = () => {
  for (const fn of [...fns]) fn();
};

/** "native" when the native module is present and the models are known to be ready. */
export function personasReaderKind(): ReaderKind {
  if (forced) return forced;
  return modelsReady && isNativeFaceReaderAvailable() ? "native" : "webview";
}

export function subscribeReaderKind(fn: () => void): () => void {
  fns.add(fn);
  return () => {
    fns.delete(fn);
  };
}

/** The models are on disk and verified (after a download, say): switch to the native reader. */
export function markFaceModelsReady(): void {
  const before = personasReaderKind();
  modelsReady = true;
  if (personasReaderKind() !== before) announce();
}

/** Check the models on disk (no network) and switch when they are ready. */
export async function refreshReaderKind(check: () => Promise<boolean> = faceModelsReady): Promise<ReaderKind> {
  if (!modelsReady && isNativeFaceReaderAvailable()) {
    let ok = false;
    try {
      ok = await check();
    } catch {
      ok = false;
    }
    if (ok) markFaceModelsReady();
  }
  return personasReaderKind();
}

/** Tests only: force a kind (null = decide as usual). */
export function __setReaderKindForTests(kind: ReaderKind | null): void {
  forced = kind;
  if (kind === null) modelsReady = false;
  announce();
}
