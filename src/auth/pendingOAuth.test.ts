const store: Record<string, string> = {};
let mockThrowOnRead = false;
let mockThrowOnWrite = false;

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "afterFirstUnlock",
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (mockThrowOnWrite) throw new Error("User interaction is not allowed.");
    store[k] = v;
  }),
  getItemAsync: jest.fn(async (k: string) => {
    if (mockThrowOnRead) throw new Error("User interaction is not allowed.");
    return k in store ? store[k] : null;
  }),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));

import { savePendingOAuth, loadPendingOAuth, clearPendingOAuth } from "./pendingOAuth";

const KEY = "dosya.oauth.pending";
const PAIR = { verifier: "v".repeat(43), challenge: "c".repeat(43), nonce: "nonce123456" };

beforeEach(async () => {
  for (const k of Object.keys(store)) delete store[k];
  mockThrowOnRead = false;
  mockThrowOnWrite = false;
  await clearPendingOAuth();
});

it("round-trips the verifier and nonce", async () => {
  await savePendingOAuth(PAIR);
  const loaded = await loadPendingOAuth();
  expect(loaded).toMatchObject({ verifier: PAIR.verifier, nonce: PAIR.nonce });
});

it("never persists the challenge - only the half the server cannot already see", async () => {
  await savePendingOAuth(PAIR);
  expect(store[KEY]).not.toContain(PAIR.challenge);
  expect(store[KEY]).toContain(PAIR.verifier);
});

it("returns null when no sign-in is in flight", async () => {
  expect(await loadPendingOAuth()).toBeNull();
});

it("forgets the record once cleared", async () => {
  await savePendingOAuth(PAIR);
  await clearPendingOAuth();
  expect(await loadPendingOAuth()).toBeNull();
  expect(store[KEY]).toBeUndefined();
});

it("expires a flow that was abandoned long ago", async () => {
  const started = 1_000_000;
  await savePendingOAuth(PAIR, started);
  // Comfortably past the 10-minute window.
  expect(await loadPendingOAuth(started + 11 * 60 * 1000)).toBeNull();
  // And the stale record is not left on disk to be found later.
  expect(store[KEY]).toBeUndefined();
});

it("still serves a flow that is merely slow", async () => {
  const started = 1_000_000;
  await savePendingOAuth(PAIR, started);
  expect(await loadPendingOAuth(started + 60 * 1000)).not.toBeNull();
});

/**
 * The cold-start path: Android relaunched the app to deliver the deep link, so
 * the module scope that held the verifier is gone and disk is all there is.
 * `jest.isolateModules` gives a module registry with empty in-memory state
 * while the SecureStore fake above keeps its contents.
 */
it("recovers the record from disk when memory has been lost", async () => {
  await savePendingOAuth(PAIR);

  await new Promise<void>((resolve, reject) => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require("./pendingOAuth") as typeof import("./pendingOAuth");
      fresh
        .loadPendingOAuth()
        .then((loaded) => {
          expect(loaded).toMatchObject({ verifier: PAIR.verifier, nonce: PAIR.nonce });
          resolve();
        })
        .catch(reject);
    });
  });
});

it("treats a corrupt entry as no pending flow rather than throwing", async () => {
  store[KEY] = "{not json";
  await new Promise<void>((resolve, reject) => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require("./pendingOAuth") as typeof import("./pendingOAuth");
      fresh.loadPendingOAuth().then((loaded) => {
        expect(loaded).toBeNull();
        resolve();
      }).catch(reject);
    });
  });
});

it("treats a half-written entry as no pending flow", async () => {
  store[KEY] = JSON.stringify({ verifier: "v", startedAt: Date.now() }); // nonce missing
  await new Promise<void>((resolve, reject) => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require("./pendingOAuth") as typeof import("./pendingOAuth");
      fresh.loadPendingOAuth().then((loaded) => {
        expect(loaded).toBeNull();
        resolve();
      }).catch(reject);
    });
  });
});

// A locked keychain must not turn into a failed sign-in on the common path,
// where memory still holds the record.
it("serves from memory even when the keychain is unreadable", async () => {
  await savePendingOAuth(PAIR);
  mockThrowOnRead = true;
  expect(await loadPendingOAuth()).toMatchObject({ nonce: PAIR.nonce });
});

it("keeps the in-memory record when the disk write fails", async () => {
  mockThrowOnWrite = true;
  await expect(savePendingOAuth(PAIR)).resolves.toBeUndefined();
  expect(await loadPendingOAuth()).toMatchObject({ nonce: PAIR.nonce });
});
