jest.mock("expo-file-system/legacy", () => require("./testing/memoryFs").fsModule);
const mockExclude = { result: true as boolean | null };
jest.mock("../../modules/dosya-media-extras", () => ({
  setExcludedFromBackup: jest.fn(async () => mockExclude.result),
}));

import * as Sentry from "@sentry/react-native";
import { Platform } from "react-native";
import { filesUnder, putFile, resetFs } from "./testing/memoryFs";
import { beginSession, __resetSessionForTests, OFFLINE_ROOT, type OfflineSession } from "./session";
import {
  bytesRetained, ensureRoot, finalPath, moveIntoPlace, removeFileBytes, savedPath, sweep, tempPath, verify, wipeAccount,
  __setDevForTests,
} from "./store";
import { setExcludedFromBackup } from "../../modules/dosya-media-extras";
import type { OfflineFileRow } from "./types";

const row = (id: string, over: Partial<OfflineFileRow> = {}): OfflineFileRow => ({
  file_id: id, workspace_id: "w1", folder_id: null, name: `${id}.docx`, extension: "docx", mime_type: "x",
  size_bytes: 10, remote_version: 2, saved_version: 2, saved_size: 10, rendition: "ready",
  rendition_version: 2, rendition_size: 5, updated_at: 1, ...over,
});

let s: OfflineSession;
const filesDir = () => `${s.root}files/`;
const originalOS = Platform.OS;

beforeEach(() => {
  resetFs();
  __resetSessionForTests();
  s = beginSession("acct");
  mockExclude.result = true;
  __setDevForTests(false);
  jest.clearAllMocks();
});
afterEach(() => { Platform.OS = originalOS; });

describe("offline byte store", () => {
  it("paths are under documentDirectory/offline/<account>/", () => {
    expect(OFFLINE_ROOT).toBe("file:///docs/offline/");
    expect(finalPath(s, "f1", 3, "docx")).toBe("file:///docs/offline/acct/files/f1-v3.docx");
    expect(finalPath(s, "f1", 3, "docx", "pdf")).toBe("file:///docs/offline/acct/files/f1-v3-pdf.pdf");
    expect(tempPath(s).startsWith("file:///docs/offline/acct/tmp/")).toBe(true);
    expect(tempPath(s)).not.toBe(tempPath(s));
  });

  it("an odd extension or id cannot escape the files directory", () => {
    expect(finalPath(s, "../x", 1, "../../etc")).toBe("file:///docs/offline/acct/files/___x-v1.bin");
  });

  it("verify rejects wrong size", async () => {
    putFile("file:///docs/offline/acct/tmp/a", 9);
    expect(await verify("file:///docs/offline/acct/tmp/a", 10)).toBe(false);
    expect(await verify("file:///docs/offline/acct/tmp/a", 9)).toBe(true);
    expect(await verify("file:///docs/offline/acct/tmp/missing", null)).toBe(false);
    expect(await verify("file:///docs/offline/acct/tmp/a", null)).toBe(true);
  });

  it("verify rejects an empty file when no size is known", async () => {
    putFile("file:///docs/offline/acct/tmp/e", 0);
    expect(await verify("file:///docs/offline/acct/tmp/e", null)).toBe(false);
  });

  it("moveIntoPlace replaces whatever was at the final path", async () => {
    const tmp = tempPath(s);
    putFile(tmp, 10);
    const dest = finalPath(s, "f1", 1, "txt");
    putFile(dest, 3);
    await moveIntoPlace(tmp, dest);
    expect(filesUnder(s.root)).toEqual([dest]);
  });

  it("sweep empties tmp and keeps saved and rendition versions", async () => {
    putFile(`${s.root}tmp/killed-run.part`, 4);
    putFile(finalPath(s, "a", 2, "docx"), 10);
    putFile(finalPath(s, "a", 2, "docx", "pdf"), 5);
    putFile(finalPath(s, "a", 1, "docx"), 10); // superseded version
    putFile(finalPath(s, "a", 1, "docx", "pdf"), 5); // superseded rendition
    putFile(finalPath(s, "gone", 1, "txt"), 10); // no row at all
    putFile(finalPath(s, "b", 4, "pdf"), 10);
    await sweep(s, [row("a"), row("b", { saved_version: 4, rendition: "none", rendition_version: null, extension: "pdf" })]);
    expect(filesUnder(s.root)).toEqual([
      finalPath(s, "a", 2, "docx"),
      finalPath(s, "a", 2, "docx", "pdf"),
      finalPath(s, "b", 4, "pdf"),
    ].sort());
  });

  it("sweep keeps saved bytes under the extension they were written with, after a rename", async () => {
    putFile(finalPath(s, "n", 3, "txt"), 10);
    putFile(finalPath(s, "n", 3, "md"), 10); // a stray under the new name is not the saved copy
    const renamed = row("n", { name: "notes.md", extension: "md", saved_version: 3, saved_ext: "txt", rendition: "none", rendition_version: null });
    await sweep(s, [renamed]);
    expect(filesUnder(filesDir())).toEqual([finalPath(s, "n", 3, "txt")]);
    expect(savedPath(s, renamed)).toBe(finalPath(s, "n", 3, "txt"));
  });

  it("a row saved before saved_ext existed falls back to its metadata extension", () => {
    expect(savedPath(s, row("o", { saved_version: 2, saved_ext: null }))).toBe(finalPath(s, "o", 2, "docx"));
    expect(savedPath(s, row("o", { saved_version: null }))).toBeNull();
  });

  it("sweep drops a rendition whose row says it is not ready", async () => {
    putFile(finalPath(s, "a", 2, "docx"), 10);
    putFile(finalPath(s, "a", 2, "docx", "pdf"), 5);
    await sweep(s, [row("a", { rendition: "failed", rendition_version: null })]);
    expect(filesUnder(s.root)).toEqual([finalPath(s, "a", 2, "docx")]);
  });

  it("removeFileBytes keeps only the named version", async () => {
    putFile(finalPath(s, "a", 1, "docx"), 10);
    putFile(finalPath(s, "a", 1, "docx", "pdf"), 5);
    putFile(finalPath(s, "a", 2, "docx"), 10);
    putFile(finalPath(s, "a-v9", 1, "docx"), 10); // another file whose id looks similar
    await removeFileBytes(s, "a", 2);
    expect(filesUnder(`${s.root}files/`)).toEqual([finalPath(s, "a", 2, "docx"), finalPath(s, "a-v9", 1, "docx")].sort());
    await removeFileBytes(s, "a");
    expect(filesUnder(`${s.root}files/`)).toEqual([finalPath(s, "a-v9", 1, "docx")]);
  });

  it("bytesRetained sums the files directory only", async () => {
    putFile(finalPath(s, "a", 1, "docx"), 10);
    putFile(finalPath(s, "a", 1, "docx", "pdf"), 5);
    putFile(`${s.root}tmp/x.part`, 1000);
    expect(await bytesRetained(s)).toBe(15);
  });

  it("wipeAccount removes that account's root and nothing else", async () => {
    putFile(finalPath(s, "a", 1, "docx"), 10);
    putFile(`${s.root}offline.db`, 1);
    putFile(`${OFFLINE_ROOT}other/files/b-v1.txt`, 1);
    await wipeAccount("acct");
    expect(filesUnder(OFFLINE_ROOT)).toEqual([`${OFFLINE_ROOT}other/files/b-v1.txt`]);
  });

  describe("ensureRoot", () => {
    it("creates the account directories and excludes the offline root on iOS", async () => {
      Platform.OS = "ios";
      expect(await ensureRoot(s)).toEqual({ excluded: true });
      expect(setExcludedFromBackup).toHaveBeenCalledWith(OFFLINE_ROOT, true);
    });

    it("release build with a missing native module reports excluded:false and logs to Sentry", async () => {
      Platform.OS = "ios";
      mockExclude.result = null;
      expect(await ensureRoot(s)).toEqual({ excluded: false });
      expect(Sentry.captureException).toHaveBeenCalled();
    });

    it("a refused exclusion is reported too", async () => {
      Platform.OS = "ios";
      mockExclude.result = false;
      expect(await ensureRoot(s)).toEqual({ excluded: false });
      expect(Sentry.captureException).toHaveBeenCalled();
    });

    it("a dev build skips the report silently", async () => {
      Platform.OS = "ios";
      mockExclude.result = null;
      __setDevForTests(true);
      expect(await ensureRoot(s)).toEqual({ excluded: false });
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it("Android relies on the backup rules from the config plugin", async () => {
      Platform.OS = "android";
      expect(await ensureRoot(s)).toEqual({ excluded: true });
      expect(setExcludedFromBackup).not.toHaveBeenCalled();
    });
  });
});
