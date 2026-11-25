import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * The phone's own document scanner, handing back one PDF.
 *
 * iOS: VisionKit's document camera (the one Notes and Files use); the module
 * writes the pages into a PDF itself. Android: Google's ML Kit document
 * scanner, which runs inside Play services and writes the PDF for us. Both
 * find the page edges, flatten the perspective and handle retakes and extra
 * pages, so none of that lives in dosya.
 *
 * Safe without the native module (Expo Go, an older build): nothing is
 * available and the button stays hidden.
 */

export interface ScannedPdf {
  /** file:// URI of the PDF in the app's cache. */
  uri: string;
  pageCount: number;
  /** Bytes. */
  size: number;
}

interface NativeDocumentScanner {
  isAvailable(): boolean;
  scan(): Promise<ScannedPdf | null>;
}

const native = requireOptionalNativeModule<NativeDocumentScanner>("DosyaDocumentScanner");

/**
 * False on a phone with no scanner: an iPhone without VisionKit's camera, an
 * Android phone without Google Play services, or a build without the module.
 */
export function scannerAvailable(): boolean {
  try {
    return native?.isAvailable() ?? false;
  } catch {
    return false;
  }
}

/** Opens the scanner. Null when the person backs out without saving. */
export async function scanToPdf(): Promise<ScannedPdf | null> {
  if (!native) throw new Error("Document scanner is not in this build");
  return native.scan();
}
