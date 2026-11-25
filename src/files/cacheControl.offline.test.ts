/**
 * Clear cache must never touch offline files. Those are what the user asked us
 * to keep on the phone; the cache is everything we can fetch again. Runs the
 * real clear (byte store, transient area, Live Photo temp, Vault cache) over an
 * in-memory file system holding both.
 */
jest.mock("expo-file-system/legacy", () => require("../offline/testing/memoryFs").fsModule);
jest.mock("expo-image", () => ({ Image: { clearMemoryCache: jest.fn(async () => true), clearDiskCache: jest.fn(async () => true) } }));

import { filesUnder, putFile, resetFs } from "../offline/testing/memoryFs";
import { OFFLINE_ROOT, accountRoot } from "../offline/session";
import { clearCaches } from "./cacheControl";

beforeEach(() => resetFs());

it("Clear cache leaves offline files", async () => {
  const root = accountRoot("acct");
  putFile(`${root}offline.db`, 4096);
  putFile(`${root}files/f1.v1.pdf`, 1000);
  putFile(`${root}files/f2.v3.docx`, 2000);
  putFile(`${root}files/f2.v3.pdf`, 500);
  putFile("file:///cache/files/abc.bin", 300);
  putFile("file:///cache/transient/x.bin", 100);
  putFile("file:///cache/loose.jpg", 50);

  await clearCaches();

  expect(OFFLINE_ROOT.startsWith("file:///docs/")).toBe(true);
  expect(filesUnder(OFFLINE_ROOT)).toEqual([
    `${root}files/f1.v1.pdf`,
    `${root}files/f2.v3.docx`,
    `${root}files/f2.v3.pdf`,
    `${root}offline.db`,
  ]);
  // And the cache did go.
  expect(filesUnder("file:///cache/")).toEqual([]);
});
