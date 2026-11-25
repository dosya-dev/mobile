import { Directory, File, Paths } from "expo-file-system";
import type { PlainChunkSink } from "@dosya-dev/e2ee-core";

/**
 * Where decrypted Vault files live while the user looks at them: a `vault/`
 * directory under the app cache, wiped on lock and sign-out (store.ts) and
 * never synced anywhere. Entry names and ids are encrypted metadata (or come
 * from the server / other clients) and can contain anything, so none of them
 * is ever used raw as a path component.
 */
export function vaultCacheDir(): string {
  return `${Paths.cache.uri.replace(/\/$/, "")}/vault`;
}

function basenameOf(raw: string): string {
  return raw.split(/[\\/]/).pop() ?? "";
}

/** A single path segment (workspace id, file id): basename only, no leading dots, capped, never empty. */
function safeSegment(raw: string): string {
  const cleaned = basenameOf(raw).replace(/^\.+/, "").replace(/[^\w.\-]/g, "_").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "id";
}

/** A display file name: basename only, no leading dots, capped - but the extension survives truncation. */
function safeFileName(name: string): string {
  const cleaned = basenameOf(name).replace(/^\.+/, "").replace(/[^\w.\- ()]/g, "_");
  if (cleaned.length === 0) return "file";
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  const stem = cleaned.slice(0, 120 - ext.length);
  const truncated = stem + ext;
  return truncated.length > 0 ? truncated : "file";
}

export function cachePathFor(workspaceId: string, fileId: string, version: number, name: string): { dir: string; fileName: string } {
  return { dir: `${vaultCacheDir()}/${safeSegment(workspaceId)}/${safeSegment(fileId)}-v${version}`, fileName: safeFileName(name) };
}

export type CacheFs = {
  ensureDir(dir: string): Promise<void>;
  open(path: string): Promise<{ write(b: Uint8Array): Promise<void>; close(): Promise<void> }>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<{ exists: boolean; size: number }>;
  removeTree(dir: string): Promise<void>;
};

export const expoCacheFs: CacheFs = {
  async ensureDir(dir) { const d = new Directory(dir); if (!d.exists) d.create({ intermediates: true }); },
  async open(path) {
    const f = new File(path);
    if (f.exists) f.delete();
    f.create();
    const h = f.open();
    return { async write(b) { h.writeBytes(b); }, async close() { h.close(); } };
  },
  async rename(from, to) { const f = new File(from); const target = new File(to); if (target.exists) target.delete(); f.move(target); },
  async remove(path) { const f = new File(path); if (f.exists) f.delete(); },
  async exists(path) { const f = new File(path); return { exists: f.exists, size: f.exists ? (f.size ?? 0) : 0 }; },
  async removeTree(dir) { const d = new Directory(dir); if (d.exists) d.delete(); },
};

export function createCacheSink(target: { dir: string; fileName: string }, fs: CacheFs = expoCacheFs) {
  const finalPath = `${target.dir}/${target.fileName}`;
  const partPath = `${finalPath}.part`;
  let handle: { write(b: Uint8Array): Promise<void>; close(): Promise<void> } | null = null;
  // A sink is used exactly once: written to (maybe), then either finished or
  // aborted. Tracking that explicitly is what makes finish/abort/sink safe
  // to call again after the first terminal call, instead of touching an
  // already-closed handle or a `.part` file that finish() already moved.
  let state: "open" | "finished" | "aborted" = "open";

  async function ensureOpen() {
    if (state !== "open") throw new Error("vault: sink closed");
    if (!handle) { await fs.ensureDir(target.dir); handle = await fs.open(partPath); }
    return handle;
  }

  const sink: PlainChunkSink = async (plaintext) => { await (await ensureOpen()).write(plaintext); };

  return {
    sink,
    async finish(): Promise<string> {
      if (state === "finished") return finalPath;
      if (state === "aborted") throw new Error("vault: sink closed");
      const h = await ensureOpen();
      await h.close();
      handle = null;
      try {
        await fs.rename(partPath, finalPath);
      } catch (err) {
        // Don't leave plaintext behind under a name nothing will look for again.
        try { await fs.remove(partPath); } catch { /* best effort */ }
        throw err;
      }
      state = "finished";
      return finalPath;
    },
    async abort(): Promise<void> {
      if (state === "finished" || state === "aborted") return;
      if (handle) { await handle.close(); handle = null; }
      await fs.remove(partPath);
      state = "aborted";
    },
  };
}

export async function cachedFile(target: { dir: string; fileName: string }, fs: CacheFs = expoCacheFs): Promise<string | null> {
  const p = `${target.dir}/${target.fileName}`;
  const info = await fs.exists(p);
  return info.exists && info.size > 0 ? p : null;
}

export async function wipeVaultCache(fs: CacheFs = expoCacheFs): Promise<void> {
  await fs.removeTree(vaultCacheDir());
}
