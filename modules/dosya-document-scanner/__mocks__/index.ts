// Jest stand-in for the native scanner. Tests set the outcome through the
// jest.fn handles.
import type { ScannedPdf } from "../index";

export type { ScannedPdf } from "../index";

export const scannerAvailable = jest.fn((): boolean => true);
export const scanToPdf = jest.fn(async (): Promise<ScannedPdf | null> => null);
