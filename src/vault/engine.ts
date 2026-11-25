import {
  setupIdentity,
  unlock as engineUnlock,
  unlockWithRecoveryKey as engineUnlockWithRecoveryKey,
  createWorkspace as engineCreateWorkspace,
  openWorkspace as engineOpenWorkspace,
  listFolder as engineListFolder,
  readWorkspaceName as engineReadWorkspaceName,
  renameWorkspace as engineRenameWorkspace,
  commitFolderOps,
  uploadFileStreaming,
  downloadFileTo as engineDownloadFileTo,
  deleteEntry as engineDeleteEntry,
  createHighWaterPersistence,
  type ApiClient,
  type HighWaterStore,
  type ChunkTransport,
  type FileDeps,
  type Session,
  type Workspace,
} from "@dosya-dev/e2ee-client";
import { toHex, type PlainChunkSink, type PlainChunkSource } from "@dosya-dev/e2ee-core";
import { getItem, setItem } from "@/lib/keychain";
import { buildVaultClient } from "./client";
import { ensureVaultRuntime } from "./runtime";

/**
 * Crypto boundary: everything that touches keys, the Session or the open
 * Workspace lives inside this closure. The store and the screens see only
 * the methods below - never a KEK, a private key, a recovery key, a Session
 * or a Workspace value. Same contract as apps/web's `E2eeEngine`, with
 * streaming file APIs in place of whole buffers.
 */
export type VaultEntry = { id: string; name: string; kind: "file" | "folder"; size: number | null; timestamp: number };

export interface VaultEngine {
  hasIdentity(): Promise<boolean>;
  setup(passphrase: string): Promise<{ recoveryKeyHex: string }>;
  unlock(passphrase: string): Promise<void>;
  unlockWithRecoveryKey(recoveryKey: string): Promise<void>;
  lock(): void;
  isUnlocked(): boolean;
  /**
   * The unlocked identity's X25519 keys (copies), for on-device Personas to
   * open or seal the user's personas key (src/personas/device/engine-host.ts
   * unlockPersonas). Null while locked. Optional so test engines need not
   * implement it.
   */
  personasIdentity?(): { x25519Pub: Uint8Array; x25519Priv: Uint8Array } | null;
  /**
   * `name` is sealed into the Space itself, so every device that opens it
   * reads the same label. Omitted, the Space is created unnamed.
   */
  createWorkspace(id: string, name?: string): Promise<void>;
  /** The open Space's own name, or null if it was made before names existed. */
  readWorkspaceName(): Promise<string | null>;
  /**
   * The name of a Space that is NOT the open one, without disturbing the open
   * one. Fills in a Spaces list whose labels this phone has never seen, so
   * they do not all read "Space a1b2c3" until each is tapped into.
   */
  readWorkspaceNameById(id: string): Promise<string | null>;
  /** Write a name into the open Space. `null` clears it. */
  renameWorkspace(name: string | null): Promise<void>;
  setWorkspaceScope(workspaceId: string, globalWorkspaceId: string): Promise<void>;
  openWorkspace(id: string, selfFounded: boolean): Promise<void>;
  listMyWorkspaces(): Promise<{ workspaceId: string; globalWorkspaceId: string | null; createdByMe: boolean }[]>;
  listFolder(folderId: string): Promise<VaultEntry[]>;
  createFolder(parentFolderId: string, name: string): Promise<{ folderId: string }>;
  uploadFile(folderId: string, name: string, source: PlainChunkSource): Promise<{ fileId: string }>;
  downloadFileTo(folderId: string, entryId: string, sink: PlainChunkSink): Promise<{ totalSize: number }>;
  deleteEntry(folderId: string, entryId: string): Promise<void>;
}

/** The key as the engine wants it: people paste it with spaces, dashes or line breaks. */
export function normalizeRecoveryKey(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

const WRITER_ID = "self";

function byKindThenName(a: VaultEntry, b: VaultEntry): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Where each Space's rollback high-water mark lives between launches. Not a
 * secret (a version number and a public root hash); the keychain is simply
 * this app's durable store. What matters is that it outlives the in-memory
 * `Workspace`, so a relaunch or a Space switch cannot be served a
 * pre-revocation head unnoticed - see `Workspace.floor` in e2ee-client.
 */
const keychainHighWaterStore: HighWaterStore = { get: getItem, set: setItem };

export function createVaultEngine(deps: {
  client?: () => { api: ApiClient; transport: ChunkTransport };
  runtime?: () => Promise<void>;
  highWaterStore?: HighWaterStore;
} = {}): VaultEngine {
  const runtime = deps.runtime ?? ensureVaultRuntime;
  const highWater = createHighWaterPersistence(deps.highWaterStore ?? keychainHighWaterStore);
  /** The persisted mark to check `id`'s head against, and the hook that keeps it current. */
  async function markOpts(s: Session, id: string) {
    return { highWater: await highWater.load(s, id), onAdvance: highWater.onAdvance(s, id) };
  }
  let built: { api: ApiClient; transport: ChunkTransport } | null = null;
  let session: Session | null = null;
  let ws: Workspace | null = null;
  // Bumped by every lock(). A ceremony captures it before its awaits and, if
  // it no longer matches afterwards, discards what it built instead of
  // assigning it - and rejects, so the caller learns nothing was established.
  //
  // This belongs here rather than in the store because the engine is a
  // SINGLETON: after a sign-out and a second sign-in, a continuation from the
  // first account must neither re-arm the engine with the old identity nor
  // (as a store-side "lock it again" guard would) wipe the session the new
  // account is using right now.
  let epoch = 0;
  const staleSince = (e: number) => e !== epoch;

  async function ready(): Promise<{ api: ApiClient; transport: ChunkTransport }> {
    await runtime();
    if (!built) built = (deps.client ?? buildVaultClient)();
    return built;
  }
  function requireSession(): Session {
    if (!session) throw new Error("vault: locked");
    return session;
  }
  function fileDeps(): FileDeps {
    const s = requireSession();
    if (!ws || !built) throw new Error("vault: no open Space");
    return { api: built.api, transport: built.transport, session: s, ws };
  }

  return {
    async hasIdentity() {
      const { api } = await ready();
      return (await api.getUserKeys()) !== null;
    },
    async setup(passphrase) {
      const e = epoch;
      const { api } = await ready();
      const { session: s, recoveryKey } = await setupIdentity(api, passphrase);
      if (staleSince(e)) throw new Error("vault: locked");
      session = s;
      return { recoveryKeyHex: toHex(recoveryKey) };
    },
    async unlock(passphrase) {
      const e = epoch;
      const { api } = await ready();
      const s = await engineUnlock(api, passphrase);
      if (staleSince(e)) throw new Error("vault: locked");
      session = s;
    },
    async unlockWithRecoveryKey(recoveryKey) {
      const e = epoch;
      const { api } = await ready();
      const s = await engineUnlockWithRecoveryKey(api, normalizeRecoveryKey(recoveryKey));
      if (staleSince(e)) throw new Error("vault: locked");
      session = s;
    },
    lock() {
      epoch += 1;
      session = null;
      ws = null;
    },
    isUnlocked() {
      return session !== null;
    },
    personasIdentity() {
      if (!session) return null;
      const { publicKey, privateKey } = session.identity.x25519;
      return { x25519Pub: publicKey.slice(), x25519Priv: privateKey.slice() };
    },
    async createWorkspace(id, name) {
      const e = epoch;
      const { api } = await ready();
      if (staleSince(e)) throw new Error("vault: locked");
      const s = requireSession();
      // Forget any previously open Space before the switch, so a rejected
      // create leaves no Space open rather than silently keeping the old one.
      ws = null;
      const created = await engineCreateWorkspace(api, s, id, {
        ...(name === undefined ? {} : { name }),
        onAdvance: highWater.onAdvance(s, id),
      });
      if (staleSince(e)) throw new Error("vault: locked");
      ws = created;
    },
    async setWorkspaceScope(workspaceId, globalWorkspaceId) {
      const { api } = await ready();
      await api.putWorkspaceScope(workspaceId, globalWorkspaceId);
    },
    async openWorkspace(id, selfFounded) {
      const e = epoch;
      const { api } = await ready();
      if (staleSince(e)) throw new Error("vault: locked");
      const s = requireSession();
      // `selfFounded` is the caller's OWN persisted knowledge, never a server
      // value - see apps/web's store and e2ee-client's openWorkspace doc.
      // Forget any previously open Space before the switch, so a rejected
      // open leaves no Space open rather than silently keeping the old one.
      ws = null;
      const opened = await engineOpenWorkspace(api, s, id, { selfFounded, ...(await markOpts(s, id)) });
      if (staleSince(e)) throw new Error("vault: locked");
      ws = opened;
    },
    async listMyWorkspaces() {
      const { api } = await ready();
      return api.listMyWorkspaces();
    },
    async readWorkspaceName() {
      const d = fileDeps();
      return engineReadWorkspaceName(d.api, d.session, d.ws);
    },
    async readWorkspaceNameById(id) {
      const e = epoch;
      const { api } = await ready();
      if (staleSince(e)) throw new Error("vault: locked");
      const s = requireSession();
      // A SEPARATE handle, deliberately never assigned to `ws`: reading a
      // label must not close the Space the person is looking at. selfFounded
      // stays false (TOFU), as openWorkspace's contract requires for a Space
      // this client did not itself create.
      const other = await engineOpenWorkspace(api, s, id, { selfFounded: false, ...(await markOpts(s, id)) });
      if (staleSince(e)) throw new Error("vault: locked");
      return engineReadWorkspaceName(api, s, other);
    },
    async renameWorkspace(name) {
      const d = fileDeps();
      await engineRenameWorkspace(d.api, d.session, d.ws, name);
    },
    async listFolder(folderId) {
      const d = fileDeps();
      const state = await engineListFolder(d.api, d.session, d.ws, folderId);
      const entries: VaultEntry[] = [...state.values()].map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        size: e.kind === "file" && typeof e.meta.size === "number" ? e.meta.size : null,
        timestamp: e.timestamp,
      }));
      return entries.sort(byKindThenName);
    },
    async createFolder(parentFolderId, name) {
      const d = fileDeps();
      const folderId = crypto.randomUUID();
      await commitFolderOps(d.api, d.session, d.ws, parentFolderId, [
        { type: "put", entry: { id: folderId, name, kind: "folder", contentRef: "", meta: {}, writerId: WRITER_ID, timestamp: Date.now() } },
      ]);
      return { folderId };
    },
    async uploadFile(folderId, name, source) {
      return uploadFileStreaming(fileDeps(), folderId, name, source);
    },
    async downloadFileTo(folderId, entryId, sink) {
      return engineDownloadFileTo(fileDeps(), folderId, entryId, sink);
    },
    async deleteEntry(folderId, entryId) {
      await engineDeleteEntry(fileDeps(), folderId, entryId);
    },
  };
}
