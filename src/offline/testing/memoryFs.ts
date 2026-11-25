/**
 * expo-file-system/legacy for jest: an in-memory tree with real directory
 * semantics (delete a directory and everything under it goes), free-space
 * accounting, and downloads a test can hold open, fail, or feed progress to.
 * Test-only: nothing in the app imports it.
 *
 *   jest.mock("expo-file-system/legacy", () => require("./testing/memoryFs").fsModule);
 */

export interface MemFile { size: number; body?: string }

export interface DownloadCtl {
  url: string;
  dest: string;
  headers: Record<string, string> | undefined;
  /** Report progress the way createDownloadResumable's callback does. */
  progress(written: number, expected?: number): void;
  cancelled: boolean;
}

/** What a download does. Return the HTTP status, or undefined for "cancelled". */
export type DownloadImpl = (ctl: DownloadCtl) => Promise<number | undefined>;

export const DOCS = "file:///docs/";

export const fsState = {
  files: new Map<string, MemFile>(),
  dirs: new Set<string>(),
  /** Free space before any file in `files` is counted. */
  capacity: 100 * 1024 ** 3,
  downloads: [] as DownloadCtl[],
  impl: null as DownloadImpl | null,
  /** Called with every deleted path, so a fake database under it can go too (see sqliteNode.dropSqliteUnder). */
  onDelete: [] as ((path: string) => void)[],
};

function used(): number {
  let n = 0;
  for (const f of fsState.files.values()) n += f.size;
  return n;
}

const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/", p.length - 2) + 1);
const asDir = (p: string) => (p.endsWith("/") ? p : `${p}/`);

function isDir(p: string): boolean {
  const d = asDir(p);
  if (fsState.dirs.has(d)) return true;
  for (const k of fsState.files.keys()) if (k.startsWith(d)) return true;
  return false;
}

/** Write a file of `size` bytes (a download landing, or a test planting one). */
export function putFile(path: string, size: number, body?: string): void {
  fsState.files.set(path, { size, body });
  fsState.dirs.add(dirOf(path));
}

export function resetFs(): void {
  fsState.files.clear();
  fsState.dirs.clear();
  fsState.capacity = 100 * 1024 ** 3;
  fsState.downloads.length = 0;
  fsState.onDelete = [];
  // Default: a 200 that writes `size` bytes taken from a `?size=` on the URL, or 10.
  fsState.impl = async (ctl) => {
    const m = /[?&]size=(\d+)/.exec(ctl.url);
    putFile(ctl.dest, m ? Number(m[1]) : 10);
    return 200;
  };
}
resetFs();

/** Paths currently on disk under a prefix. */
export function filesUnder(prefix: string): string[] {
  return [...fsState.files.keys()].filter((k) => k.startsWith(prefix)).sort();
}

export const fsModule = {
  documentDirectory: DOCS,
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: jest.fn(async (p: string) => { fsState.dirs.add(asDir(p)); }),
  getInfoAsync: jest.fn(async (p: string) => {
    const f = fsState.files.get(p);
    if (f) return { exists: true, isDirectory: false, size: f.size, uri: p };
    if (isDir(p)) return { exists: true, isDirectory: true, size: 0, uri: p };
    return { exists: false, isDirectory: false, uri: p };
  }),
  readDirectoryAsync: jest.fn(async (p: string) => {
    const d = asDir(p);
    if (!isDir(d)) throw new Error(`ENOENT ${d}`);
    const names = new Set<string>();
    for (const k of [...fsState.files.keys(), ...fsState.dirs]) {
      if (!k.startsWith(d) || k === d) continue;
      const rest = k.slice(d.length);
      const name = rest.split("/")[0];
      if (name) names.add(name);
    }
    return [...names];
  }),
  deleteAsync: jest.fn(async (p: string) => {
    fsState.files.delete(p);
    const d = asDir(p);
    for (const k of [...fsState.files.keys()]) if (k.startsWith(d)) fsState.files.delete(k);
    for (const k of [...fsState.dirs]) if (k.startsWith(d)) fsState.dirs.delete(k);
    for (const fn of fsState.onDelete) fn(d);
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const f = fsState.files.get(from);
    if (!f) throw new Error(`ENOENT ${from}`);
    fsState.files.delete(from);
    putFile(to, f.size, f.body);
  }),
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const f = fsState.files.get(from);
    if (!f) throw new Error(`ENOENT ${from}`);
    putFile(to, f.size, f.body);
  }),
  readAsStringAsync: jest.fn(async (p: string) => {
    const f = fsState.files.get(p);
    if (!f) throw new Error(`ENOENT ${p}`);
    return f.body ?? "";
  }),
  writeAsStringAsync: jest.fn(async (p: string, body: string) => { putFile(p, body.length, body); }),
  getFreeDiskStorageAsync: jest.fn(async () => Math.max(0, fsState.capacity - used())),
  createDownloadResumable: jest.fn((
    url: string,
    dest: string,
    opts?: { headers?: Record<string, string> },
    cb?: (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void,
  ) => {
    const ctl: DownloadCtl = {
      url, dest, headers: opts?.headers, cancelled: false,
      progress: (w, e = -1) => cb?.({ totalBytesWritten: w, totalBytesExpectedToWrite: e }),
    };
    fsState.downloads.push(ctl);
    let settleCancel: (() => void) | null = null;
    return {
      downloadAsync: async () => {
        const cancelled = new Promise<undefined>((r) => { settleCancel = () => r(undefined); });
        const status = await Promise.race([fsState.impl!(ctl), cancelled]);
        // A cancelled resumable download resolves undefined, as the real one does.
        if (ctl.cancelled || status === undefined) return undefined;
        return { status, uri: dest, headers: {}, mimeType: null };
      },
      cancelAsync: async () => {
        ctl.cancelled = true;
        settleCancel?.();
      },
    };
  }),
};
