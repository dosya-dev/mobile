import { create } from "zustand";
import { AppState, type AppStateStatus } from "react-native";
import { getItem, setItem, deleteItem } from "@/lib/keychain";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { createVaultEngine, type VaultEngine, type VaultEntry } from "./engine";
import { fileSourceFromUri } from "./fileSource";
import { cachePathFor, cachedFile, createCacheSink, wipeVaultCache } from "./cache";
// The workspace menu reads the Vault's lock state from here rather than from
// this store, which would put the e2ee bundle on the boot path.
import { t as translate } from "@/lib/i18n";
import { setVaultLocked, setVaultActivity, VAULT_SPACES_KEY_PREFIX, type VaultActivity } from "./status";

/**
 * The Vault's UI state. Mirrors apps/web's `useE2ee` store: the engine holds
 * every secret in closure; this store holds only what a screen renders plus
 * the non-secret list of known Spaces, persisted per account in the keychain
 * (id, name, selfFounded, globalWorkspaceId, shared - no key material).
 * `selfFounded` is the security-critical, client-authored anchor: true only
 * for a Space THIS device created; discovery never sets it.
 */
export type VaultStatus = "locked" | "unlocking" | "unlocked";
/**
 * `name` is what this phone shows. The Space itself now carries its own name
 * (sealed in its root index), and `openSpace` reconciles the two, so the same
 * Space reads the same on every device.
 *
 * `stub` marks a name this phone INVENTED for a Space it discovered on the
 * server rather than created - "Space a1b2c3". A stub is never promoted into
 * the Space; a real name is. An entry persisted before this field existed has
 * no `stub`, and is treated as real, which is what it was: something a person
 * typed on this phone.
 */
export type KnownSpace = {
  id: string;
  name: string;
  selfFounded: boolean;
  globalWorkspaceId: string | null;
  shared: boolean;
  stub?: boolean;
};
export type Transfer = {
  id: string; name: string; kind: "upload" | "download"; done: number; total: number; error: string | null;
  /** For a failed upload: what to hand back to `uploadFromUri` on Retry. */
  retry?: { folderId: string; fileUri: string };
};

export interface VaultState {
  status: VaultStatus;
  hasIdentity: boolean | null;
  error: string | null;
  busy: boolean;
  spaces: KnownSpace[];
  activeSpaceId: string | null;
  entries: VaultEntry[];
  recoveryKeyOnce: string | null;
  transfers: Record<string, Transfer>;
  hydrate(accountId: string): Promise<void>;
  checkIdentity(): Promise<void>;
  setup(passphrase: string): Promise<boolean>;
  unlock(passphrase: string): Promise<boolean>;
  unlockWithRecoveryKey(key: string): Promise<boolean>;
  lock(): Promise<void>;
  createSpace(name: string): Promise<string | null>;
  openSpace(id: string): Promise<boolean>;
  refreshSpaces(): Promise<void>;
  /**
   * Fill in the labels for Spaces this phone only knows as placeholders, so a
   * list of them is not a column of identical rows.
   */
  resolveSpaceNames(): Promise<void>;
  mySpacesForActiveWorkspace(): KnownSpace[];
  refreshFolder(folderId: string): Promise<void>;
  clearEntries(): void;
  createFolder(parentFolderId: string, name: string): Promise<boolean>;
  /** `retryOf` reuses an existing (failed) transfer row instead of minting a second one. */
  uploadFromUri(folderId: string, name: string, fileUri: string, retryOf?: string): Promise<boolean>;
  downloadToCache(folderId: string, entry: VaultEntry): Promise<string | null>;
  deleteEntry(folderId: string, entry: VaultEntry): Promise<boolean>;
  dismissTransfer(id: string): void;
  dismissRecoveryKey(): void;
  __setEngine(engine: VaultEngine): void;
}

const KEY_PREFIX = VAULT_SPACES_KEY_PREFIX;
let accountKey: string | null = null;
let engine: VaultEngine = createVaultEngine();

// Downloads currently writing into the cache. lock() (directly, or via
// lockVaultForPurge) aborts every one of these BEFORE wiping the cache, so a
// paused write can never resume into a directory the wipe already removed.
// A download removes its own abort once it finishes, succeeds or fails, so a
// later lock() never re-aborts a sink that is already closed.
const inFlightDownloadAborts = new Set<() => Promise<void>>();

// Bumped by every lock(). An async action captures its value on entry and,
// after each await, treats itself as stale once it no longer matches - a
// continuation that resumes after the Vault has been relocked must never
// write a Space name, a file name or a "couldn't ..." sentence back into
// state the user can no longer act on.
//
// A stale continuation only SKIPS its writes; it never calls engine.lock().
// The engine is a singleton, and it already discards a stale ceremony by its
// own epoch (engine.ts) - locking it from here would wipe the live session of
// whoever signed in after the sign-out that made this continuation stale.
let lockGen = 0;
const stale = (gen: number) => gen !== lockGen;

function patchTransfer(transfers: Record<string, Transfer>, id: string, patch: Partial<Transfer>): Record<string, Transfer> {
  // Tolerates a row that is no longer there (dismissed, or wiped by a lock()
  // that ran between this update being scheduled and it actually running).
  if (!transfers[id]) return transfers;
  return { ...transfers, [id]: { ...transfers[id], ...patch } };
}

const isScopeRequired = (e: unknown) => e instanceof Error && /\(412\)/.test(e.message);
// Functions, not constants: the words are produced when the error happens, in the
// language chosen at that moment (module `t`, so a headless caller gets English).
const unlockError = () => translate("vault.error.couldnTUnlockCheckYourPassphraseAndTryAgain");
const recoveryError = () => translate("vault.error.thatRecoveryKeyDidnTUnlockYourVault");
const scopeError = () => translate("vault.error.couldnTAttachTheSpaceToThisWorkspaceUploadsWillRetryTheAttachment");

/** Spec 7.6: a discovered Space is named after its id, so two are told apart. */
const discoveredName = (id: string, shared: boolean) =>
  translate("vault.label.sharedSelectTrueSharedSpaceOtherSpaceSlice", { shared: String(shared), slice: id.replace(/^ws-/, "").slice(0, 6) });

async function persistSpaces(spaces: KnownSpace[]): Promise<void> {
  if (!accountKey) return;
  await setItem(accountKey, JSON.stringify(spaces));
}

/**
 * Make this phone's label for a Space and the Space's own name agree.
 *
 * Runs after every open, and deliberately NOT awaited by `openSpace`: it is
 * housekeeping, and a person waiting to see their files should not wait on
 * it. Both directions matter:
 *
 *  - the Space has a name -> adopt it. This is the case that fixes the bug:
 *    a Space created on another device stops reading as "Space a1b2c3" here.
 *  - the Space has none, and this phone holds a real one -> write it in. That
 *    is how every Space made before names existed acquires one, without
 *    asking anybody to retype anything.
 *
 * Best effort throughout. A failure here costs a label, so it must never
 * surface as an error over a Space that opened perfectly well.
 */
async function reconcileSpaceName(id: string, gen: number): Promise<void> {
  try {
    const remote = await engine.readWorkspaceName();
    if (stale(gen) || useVault.getState().activeSpaceId !== id) return;
    const known = useVault.getState().spaces.find((s) => s.id === id);
    if (!known) return;

    if (remote !== null) {
      if (remote === known.name && known.stub !== true) return;
      const spaces = useVault.getState().spaces.map((s) => (s.id === id ? { ...s, name: remote, stub: false } : s));
      useVault.setState({ spaces });
      await persistSpaces(spaces);
      return;
    }

    // Nothing in the Space, and nothing real here to put there.
    if (known.stub === true) return;
    await engine.renameWorkspace(known.name);
  } catch {
    // A label is not worth an error message.
  }
}

/**
 * On-device Personas: copies of the unlocked identity's X25519 keys, which
 * open or seal the user's personas key (src/personas/device/engine-host.ts).
 * Null while the Vault is locked. The caller wipes the private key copy.
 */
export function vaultPersonasIdentity(): { x25519Pub: Uint8Array; x25519Priv: Uint8Array } | null {
  return engine.personasIdentity?.() ?? null;
}

export const useVault = create<VaultState>((set, get) => ({
  status: "locked",
  hasIdentity: null,
  error: null,
  busy: false,
  spaces: [],
  activeSpaceId: null,
  entries: [],
  recoveryKeyOnce: null,
  transfers: {},

  async hydrate(accountId) {
    const gen = lockGen;
    accountKey = KEY_PREFIX + accountId;
    try {
      const raw = await getItem(accountKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      // A corrupted or foreign-shaped keychain value must never crash the
      // Vault gate - it just starts with no known Spaces (refreshSpaces and
      // Setup/Unlock still work; a real Space is rediscovered on refresh).
      // A read that lands after a lock()/purge writes nothing: the list it
      // carries belongs to an account this store has already forgotten.
      if (!stale(gen)) set({ spaces: Array.isArray(parsed) ? (parsed as KnownSpace[]) : [] });
    } catch {
      if (!stale(gen)) set({ spaces: [] });
    }
  },

  async checkIdentity() {
    try {
      set({ hasIdentity: await engine.hasIdentity(), error: null });
    } catch {
      // Unknown is not "none": a network blip must never route a returning
      // user into Setup, whose upsert would orphan their real Spaces.
      set({ hasIdentity: null, error: translate("vault.error.couldnTCheckEncryptionStatus") });
    }
  },

  async setup(passphrase) {
    const gen = lockGen;
    set({ busy: true, error: null });
    try {
      const { recoveryKeyHex } = await engine.setup(passphrase);
      if (stale(gen)) return false;
      setVaultLocked(false);
      set({ status: "unlocked", hasIdentity: true, recoveryKeyOnce: recoveryKeyHex, busy: false });
      return true;
    } catch {
      if (stale(gen)) return false;
      set({ busy: false, error: translate("vault.error.couldnTSetUpYourVaultPleaseTryAgain") });
      return false;
    }
  },

  async unlock(passphrase) {
    const gen = lockGen;
    set({ status: "unlocking", busy: true, error: null });
    try {
      await engine.unlock(passphrase);
      if (stale(gen)) return false;
      setVaultLocked(false);
      set({ status: "unlocked", hasIdentity: true, busy: false });
      return true;
    } catch {
      if (stale(gen)) return false;
      // Never the engine's message: it can carry request/response detail.
      set({ status: "locked", busy: false, error: unlockError() });
      return false;
    }
  },

  async unlockWithRecoveryKey(key) {
    const gen = lockGen;
    set({ status: "unlocking", busy: true, error: null });
    try {
      // Setup shows the key in groups of four, so a key typed back from paper
      // arrives with spaces (or a pasted one with a newline). The hex decoder
      // rejects both; the groups are layout, not part of the key.
      await engine.unlockWithRecoveryKey(key.replace(/\s+/g, ""));
      if (stale(gen)) return false;
      setVaultLocked(false);
      set({ status: "unlocked", hasIdentity: true, busy: false });
      return true;
    } catch {
      if (stale(gen)) return false;
      set({ status: "locked", busy: false, error: recoveryError() });
      return false;
    }
  },

  async lock() {
    lockGen += 1;
    // Forget the session immediately, before anything async: no later
    // continuation can observe a "locked" store next to a still-open engine.
    engine.lock();
    setVaultLocked(true);
    const aborts = [...inFlightDownloadAborts];
    inFlightDownloadAborts.clear();
    await Promise.all(aborts.map((abort) => abort().catch(() => {})));
    set({ status: "locked", activeSpaceId: null, entries: [], transfers: {}, error: null, recoveryKeyOnce: null, busy: false });
    await wipeVaultCache().catch(() => {});
  },

  async createSpace(name) {
    const gen = lockGen;
    set({ busy: true, error: null });
    const gw = useWorkspaceStore.getState().activeId;
    const id = `ws-${crypto.randomUUID()}`;
    try {
      // The name goes INTO the Space, not just into this phone's list.
      await engine.createWorkspace(id, name);
    } catch {
      // The engine forgets any open Space on a failed create (see engine.ts):
      // the store must match that, not keep whatever was open before this call.
      if (!stale(gen)) set({ busy: false, error: translate("vault.error.couldnTCreateTheSpace"), activeSpaceId: null, entries: [] });
      return null;
    }
    // Scoping is a SEPARATE failure. The Space exists on the server and is
    // open in the engine, so dropping it from the list would hide it until
    // discovery renamed it. Keep it unscoped - the first upload's 412 path
    // attaches it - and report only what actually failed.
    let scoped = true;
    if (gw) {
      try {
        await engine.setWorkspaceScope(id, gw);
      } catch {
        scoped = false;
      }
    }
    if (stale(gen)) return null;
    const spaces = [...get().spaces, { id, name, selfFounded: true, globalWorkspaceId: scoped ? gw : null, shared: false, stub: false }];
    set({ spaces, activeSpaceId: id, entries: [], busy: false, error: scoped ? null : scopeError() });
    // Outside the try above and in its own: a keychain write failure here must
    // never be reported as "Couldn't create the Space" - the Space exists, is
    // open, and is in state; only the on-disk copy of the list failed to save.
    try {
      await persistSpaces(spaces);
    } catch {
      if (!stale(gen)) set({ error: translate("vault.error.couldnTSaveYourSpacesListOnThisPhone") });
    }
    return id;
  },

  async openSpace(id) {
    const gen = lockGen;
    set({ busy: true, error: null });
    try {
      const known = get().spaces.find((s) => s.id === id);
      await engine.openWorkspace(id, known?.selfFounded ?? false);
      // A lock() that landed while this awaited must not report success into
      // a store the user can no longer act on, or the caller could navigate
      // into a Space the store (and the engine) no longer consider open.
      if (stale(gen)) return false;
      set({ activeSpaceId: id, entries: [], busy: false });
      void reconcileSpaceName(id, gen);
      return true;
    } catch {
      // Same reasoning as createSpace: the engine forgets any open Space on a
      // failed open, so a stale activeSpaceId/entries here would point at a
      // Space the engine no longer considers open.
      if (!stale(gen)) set({ busy: false, error: translate("vault.error.couldnTOpenTheSpace"), activeSpaceId: null, entries: [] });
      return false;
    }
  },

  async refreshSpaces() {
    const gen = lockGen;
    let spaces: KnownSpace[] | null = null;
    try {
      const mine = await engine.listMyWorkspaces();
      // A listing that lands after lock()/purge belongs to the account that
      // asked for it, not to whoever the store holds now: never write it, and
      // never persist it under the next account's keychain key.
      if (stale(gen)) return;
      const known = new Set(get().spaces.map((s) => s.id));
      // A discovered Space is NEVER selfFounded, even when the server says
      // this account created it: only a device that ran createSpace itself
      // may set that flag. A concurrent delete-then-recreate on another
      // device, or the same account on a second device, must not upgrade a
      // discovered entry's trust here.
      const discovered: KnownSpace[] = mine
        .filter((m) => !known.has(m.workspaceId))
        .map((m) => ({ id: m.workspaceId, name: discoveredName(m.workspaceId, !m.createdByMe), selfFounded: false, globalWorkspaceId: m.globalWorkspaceId, shared: !m.createdByMe, stub: true }));
      if (discovered.length === 0) return;
      spaces = [...get().spaces, ...discovered];
      set({ spaces });
    } catch {
      if (!stale(gen)) set({ error: translate("vault.error.couldnTCheckForSpaces") });
      return;
    }
    // Outside the try above: a keychain write failure must not be reported as
    // "Couldn't check for Spaces" - the check succeeded; only the save didn't.
    try {
      await persistSpaces(spaces);
    } catch {
      if (!stale(gen)) set({ error: translate("vault.error.couldnTSaveYourSpacesListOnThisPhone") });
    }
    // The list is already on screen; the labels arrive behind it.
    void get().resolveSpaceNames();
  },

  async resolveSpaceNames() {
    const gen = lockGen;
    // Only the placeholders, and only once each: every one costs a grant
    // fetch, a head fetch and a decrypt. Sequential on purpose - this is
    // background work behind a list that already rendered.
    const pending = get().spaces.filter((s) => s.stub === true);
    for (const space of pending) {
      try {
        const name = await engine.readWorkspaceNameById(space.id);
        if (stale(gen) || name === null) continue;
        const spaces = get().spaces.map((s) => (s.id === space.id ? { ...s, name, stub: false } : s));
        set({ spaces });
        await persistSpaces(spaces);
      } catch {
        // Leave the placeholder. A label is not worth an error.
      }
    }
  },

  mySpacesForActiveWorkspace() {
    const gw = useWorkspaceStore.getState().activeId;
    return get().spaces.filter((s) => !s.shared && (s.globalWorkspaceId === gw || s.globalWorkspaceId == null));
  },

  async refreshFolder(folderId) {
    const gen = lockGen;
    set({ busy: true, error: null });
    try {
      const entries = await engine.listFolder(folderId);
      if (!stale(gen)) set({ entries, busy: false });
    } catch {
      if (!stale(gen)) set({ busy: false, error: translate("vault.error.couldnTLoadThisFolder") });
    }
  },

  /**
   * Empty the listing now, without waiting for a re-list. The store keeps ONE
   * `entries` array for the whole Vault, so a screen coming back into focus
   * would otherwise show the subfolder's rows under the parent's title - and
   * a tap in that window navigates with the wrong folderId.
   */
  clearEntries() {
    set({ entries: [] });
  },

  async createFolder(parentFolderId, name) {
    const gen = lockGen;
    set({ busy: true, error: null });
    try {
      await engine.createFolder(parentFolderId, name);
      await get().refreshFolder(parentFolderId);
      return true;
    } catch {
      if (!stale(gen)) set({ busy: false, error: translate("vault.error.couldnTCreateTheFolder") });
      return false;
    }
  },

  async uploadFromUri(folderId, name, fileUri, retryOf) {
    const gen = lockGen;
    // Retry reuses the row it was pressed on: a second row would leave the
    // failed one behind with a live Retry button, and pressing that again
    // uploads a second copy of the same file into the Space.
    const id = retryOf ?? `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ transfers: { ...s.transfers, [id]: { id, name, kind: "upload", done: 0, total: 0, error: null } }, error: null }));
    let source: Awaited<ReturnType<typeof fileSourceFromUri>> | null = null;
    try {
      source = await fileSourceFromUri(fileUri);
      const total = source.totalSize;
      let done = 0;
      const tracked = {
        ...source,
        read: async (offset: number, size: number) => {
          const bytes = await source!.read(offset, size);
          done += size;
          if (!stale(gen)) set((s) => ({ transfers: patchTransfer(s.transfers, id, { done, total }) }));
          return bytes;
        },
      };
      try {
        await engine.uploadFile(folderId, name, tracked);
      } catch (e) {
        // A Space with no storage workspace cannot take bytes (412); attach it
        // to the active workspace, as the web store does, and retry once.
        const spaceId = get().activeSpaceId;
        const gw = useWorkspaceStore.getState().activeId;
        if (!isScopeRequired(e) || !spaceId || !gw) throw e;
        await engine.setWorkspaceScope(spaceId, gw);
        const spaces = get().spaces.map((s) => (s.id === spaceId ? { ...s, globalWorkspaceId: gw } : s));
        if (!stale(gen)) set({ spaces });
        await persistSpaces(spaces);
        done = 0;
        await engine.uploadFile(folderId, name, tracked);
      }
      if (stale(gen)) return true;
      await get().refreshFolder(folderId);
      set((s) => { const t = { ...s.transfers }; delete t[id]; return { transfers: t }; });
      return true;
    } catch {
      if (stale(gen)) return false;
      const message = translate("vault.error.couldnTUploadName", { name });
      set((s) => ({
        error: message,
        transfers: { ...s.transfers, [id]: { ...(s.transfers[id] ?? { id, name, kind: "upload", done: 0, total: 0 }), error: message, retry: { folderId, fileUri } } },
      }));
      return false;
    } finally {
      // Idempotent on the real reader, but a finally must never itself throw
      // and mask the outcome above - a repeat close on a bad handle is not
      // impossible on device.
      try { source?.close(); } catch { /* best effort */ }
    }
  },

  async downloadToCache(folderId, entry) {
    const gen = lockGen;
    const spaceId = get().activeSpaceId;
    if (!spaceId) return null;
    // Version 1 always: VaultEntry carries no file version and edits are out
    // of scope; lock() wipes the cache, so a stale copy cannot outlive a session.
    const target = cachePathFor(spaceId, entry.id, 1, entry.name);
    const hit = await cachedFile(target);
    if (hit) return hit;
    const id = `dl-${entry.id}`;
    set((s) => ({ transfers: { ...s.transfers, [id]: { id, name: entry.name, kind: "download", done: 0, total: entry.size ?? 0, error: null } }, error: null }));
    const { sink, finish, abort } = createCacheSink(target);
    inFlightDownloadAborts.add(abort);
    try {
      let done = 0;
      await engine.downloadFileTo(folderId, entry.id, async (plain, index) => {
        await sink(plain, index);
        done += plain.length;
        if (!stale(gen)) set((s) => ({ transfers: patchTransfer(s.transfers, id, { done }) }));
      });
      const uri = await finish();
      if (!stale(gen)) set((s) => { const t = { ...s.transfers }; delete t[id]; return { transfers: t }; });
      return uri;
    } catch {
      // Either a real failure, or lock() already aborted this sink out from
      // under us - either way the write is dead; abort() is idempotent.
      await abort().catch(() => {});
      if (stale(gen)) return null;
      const message = translate("vault.error.couldnTDownloadName", { name: entry.name });
      set((s) => ({ error: message, transfers: patchTransfer(s.transfers, id, { error: message }) }));
      return null;
    } finally {
      inFlightDownloadAborts.delete(abort);
    }
  },

  async deleteEntry(folderId, entry) {
    const gen = lockGen;
    set({ busy: true, error: null });
    try {
      await engine.deleteEntry(folderId, entry.id);
      // Re-list rather than remove locally: a concurrent edit on another
      // device can turn this delete into a delete-edit conflict, where the
      // entry is still present after the call resolves successfully. The
      // folder listing is the truth; no special-casing beyond showing it.
      await get().refreshFolder(folderId);
      return true;
    } catch {
      if (!stale(gen)) set({ busy: false, error: translate("vault.error.couldnTDeleteName", { name: entry.name }) });
      return false;
    }
  },

  dismissTransfer(id) {
    set((s) => { const t = { ...s.transfers }; delete t[id]; return { transfers: t, error: null }; });
  },

  dismissRecoveryKey() {
    set({ recoveryKeyOnce: null });
  },

  __setEngine(next) {
    engine = next;
  },
}));

/**
 * Sign-out and account switch: forget the session, the Spaces list and the
 * cache, and delete THIS account's keychain entry directly - never relying on
 * `accountKey` (only ever set by `hydrate`, which nothing guarantees ran for
 * this account in this process).
 */
/**
 * Publish the transfer list as counts and bytes, for the plus button's ring
 * and its sheet. Subscribed once, here, rather than called from each of the
 * dozen places that touch `transfers`: a caller that forgot would leave the
 * ring reporting a transfer that finished minutes ago.
 *
 * Only numbers leave. See `VaultActivity` for why the name must not.
 */
function summariseTransfers(transfers: Record<string, Transfer>): VaultActivity {
  let count = 0;
  let failed = 0;
  let uploads = 0;
  let downloads = 0;
  let written = 0;
  let total = 0;
  for (const t of Object.values(transfers)) {
    count += 1;
    if (t.error) failed += 1;
    if (t.kind === "upload") uploads += 1;
    else downloads += 1;
    written += t.done;
    total += t.total;
  }
  return { count, failed, uploads, downloads, written, total };
}

useVault.subscribe((state, prev) => {
  if (state.transfers === prev.transfers) return;
  setVaultActivity(summariseTransfers(state.transfers));
});

export async function lockVaultForPurge(accountId: string): Promise<void> {
  await useVault.getState().lock();
  useVault.setState({ spaces: [], hasIdentity: null });
  await deleteItem(KEY_PREFIX + accountId).catch(() => {});
  accountKey = null;
}

export const BACKGROUND_LOCK_MS = 5 * 60 * 1000;

/** Lock once the app has been in the background for BACKGROUND_LOCK_MS; a quick app switch keeps the session. */
export function startVaultBackgroundLock(appState: typeof AppState = AppState): () => void {
  // Elapsed wall clock, NOT a timer, is the guarantee. React Native pauses JS
  // timers while the host is paused (Android JavaTimerManager.onHostPause,
  // iOS RCTTiming), and on resume the AppState "active" event is delivered
  // before any expired timer would be dispatched - so a timer armed on
  // `background` is not what can lock a genuinely backgrounded app. The
  // timestamp is checked on "active", the way AppLockGate re-gates.
  let since: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const lockIfUnlocked = () => { if (useVault.getState().status === "unlocked") void useVault.getState().lock(); };
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const sub = appState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "background" || state === "inactive") {
      if (since !== null) return;
      since = Date.now();
      // Harmless bonus: on a platform (or in the iOS "inactive while still in
      // the foreground" case) that keeps JS running, this locks at the
      // five-minute mark instead of waiting for the user to come back.
      timer = setTimeout(() => { timer = null; lockIfUnlocked(); }, BACKGROUND_LOCK_MS);
    } else if (state === "active") {
      clearTimer();
      const left = since;
      since = null;
      if (left !== null && Date.now() - left >= BACKGROUND_LOCK_MS) lockIfUnlocked();
    }
  });
  return () => { sub.remove(); clearTimer(); };
}
