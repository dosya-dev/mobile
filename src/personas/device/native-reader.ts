// The phone's native FaceReaderPort: the platform decoder and ONNX Runtime in
// modules/dosya-face-reader, driven by the vendored pipeline (./ort/pipeline).
// Same output as the WebView reader (./reader.ts): boxes as fractions of the
// encoded image. The native decode may shrink the photo but keeps its aspect
// ratio, so a box over the decoded size is the same fraction of the encoded one.
import { ReaderUnsupportedError, type FaceReaderPort, type ReadFace } from "@dosya-dev/personas-engine";
import { decodeImage, detect, embed, FaceReaderError, loadModels, unloadModels } from "../../../modules/dosya-face-reader";
import { PersonasUnavailableError } from "./errors";
import { faceModelPaths, faceModelsReady, type ModelDeps } from "./models";
import { FACE_STRIDE, readFaces, VECTOR_LEN } from "./ort/pipeline";

const plain = (uri: string) => uri.replace(/^file:\/\//, "");

function mapError(err: unknown): unknown {
  if (!(err instanceof FaceReaderError)) return err;
  switch (err.code) {
    case "UNSUPPORTED":
      return new ReaderUnsupportedError();
    case "NO_MODELS":
    case "EUNAVAILABLE":
      return new PersonasUnavailableError(err.message);
    default:
      return new Error(err.message);
  }
}

export function createNativeReader(deps: { models?: ModelDeps } = {}): FaceReaderPort & { unload(): Promise<void> } {
  let loaded: Promise<void> | null = null;

  const ensureLoaded = (): Promise<void> => {
    if (!loaded) {
      const p = faceModelsReady(deps.models).then(async (ok) => {
        if (!ok) throw new PersonasUnavailableError("personas: face models are not downloaded");
        const paths = faceModelPaths(deps.models?.dir);
        await loadModels(plain(paths.detector), plain(paths.embedder));
      });
      loaded = p;
      p.catch(() => {
        if (loaded === p) loaded = null;
      });
    }
    return loaded;
  };

  return {
    async read(photo) {
      try {
        const img = await decodeImage(photo);
        await ensureLoaded();
        const out = await readFaces({ px: img.rgba, width: img.width, height: img.height, channels: 4 }, { detect, embed });
        const faces: ReadFace[] = [];
        for (let o = 0; o + FACE_STRIDE <= out.length; o += FACE_STRIDE) {
          faces.push({
            box: { x: out[o] / img.width, y: out[o + 1] / img.height, w: out[o + 2] / img.width, h: out[o + 3] / img.height },
            sig: out.slice(o + 5, o + 5 + VECTOR_LEN),
            score: out[o + 4],
          });
        }
        return faces;
      } catch (err) {
        throw mapError(err);
      }
    },
    async unload() {
      const inflight = loaded;
      if (!inflight) return;
      loaded = null;
      // A load may still be running: let it settle first, or the sessions
      // would be left loaded after this resolves.
      await inflight.catch(() => undefined);
      await unloadModels();
    },
  };
}
