jest.mock("@dosya-dev/e2ee-client", () => ({
  setupIdentity: jest.fn(async () => ({ session: { kek: new Uint8Array(32), identity: {} }, recoveryKey: new Uint8Array([0xab, 0xcd]) })),
  unlock: jest.fn(async () => ({ kek: new Uint8Array(32), identity: {} })),
  unlockWithRecoveryKey: jest.fn(async () => ({ kek: new Uint8Array(32), identity: {} })),
  createWorkspace: jest.fn(async (_api: unknown, _s: unknown, id: string) => ({ workspaceId: id, wk: new Uint8Array(32), wkVersion: 1 })),
  openWorkspace: jest.fn(async (_api: unknown, _s: unknown, id: string) => ({ workspaceId: id, wk: new Uint8Array(32), wkVersion: 1 })),
  listFolder: jest.fn(async () => new Map([
    ["f2", { id: "f2", name: "b.txt", kind: "file", contentRef: "y", meta: { size: 7, record: "{}" }, writerId: "self", timestamp: 6 }],
    ["f1", { id: "f1", name: "A.jpg", kind: "file", contentRef: "x", meta: { size: 123, record: "{}" }, writerId: "self", timestamp: 5 }],
    ["d1", { id: "d1", name: "Sub", kind: "folder", contentRef: "", meta: {}, writerId: "self", timestamp: 4 }],
  ])),
  commitFolderOps: jest.fn(async () => {}),
  uploadFileStreaming: jest.fn(async () => ({ fileId: "new-file" })),
  downloadFileTo: jest.fn(async (_d: unknown, _f: string, _e: string, sink: (b: Uint8Array, i: number) => Promise<void>) => { await sink(new Uint8Array([1, 2]), 0); return { totalSize: 2 }; }),
  deleteEntry: jest.fn(async () => {}),
  createHighWaterPersistence: jest.fn(() => ({
    load: jest.fn(async (_s: unknown, id: string) => (id === "ws-2" ? { version: 7, hash: new Uint8Array(32), wkVersion: 2 } : undefined)),
    onAdvance: jest.fn(() => () => {}),
  })),
}));

import * as client from "@dosya-dev/e2ee-client";
import { createVaultEngine, normalizeRecoveryKey } from "./engine";

const fakeClient = () => ({
  api: {
    listMyWorkspaces: jest.fn(async () => [{ workspaceId: "ws-1", globalWorkspaceId: "g1", createdByMe: false }]),
    putWorkspaceScope: jest.fn(async () => {}),
    getUserKeys: jest.fn(async () => null),
  } as never,
  transport: {} as never,
});
const runtime = jest.fn(async () => {});

describe("VaultEngine", () => {
  beforeEach(() => jest.clearAllMocks());

  it("ensures the runtime before the first call and reports identity from getUserKeys", async () => {
    const c = fakeClient();
    const e = createVaultEngine({ client: () => c, runtime });
    expect(await e.hasIdentity()).toBe(false);
    expect(runtime).toHaveBeenCalledTimes(1);
    (c.api as { getUserKeys: jest.Mock }).getUserKeys.mockResolvedValueOnce({ any: true });
    expect(await e.hasIdentity()).toBe(true);
  });

  it("setup returns the recovery key as hex and leaves the engine unlocked; lock forgets everything", async () => {
    const e = createVaultEngine({ client: fakeClient, runtime });
    const { recoveryKeyHex } = await e.setup("pass");
    expect(recoveryKeyHex).toBe("abcd");
    expect(e.isUnlocked()).toBe(true);
    e.lock();
    expect(e.isUnlocked()).toBe(false);
    await expect(e.listFolder("root")).rejects.toThrow("vault: locked");
  });

  it("unlock with a recovery key normalizes spacing and dashes first", async () => {
    const e = createVaultEngine({ client: fakeClient, runtime });
    await e.unlockWithRecoveryKey(" ab-cd ef\n");
    expect((client.unlockWithRecoveryKey as jest.Mock).mock.calls[0][1]).toBe("abcdef");
    expect(normalizeRecoveryKey("12-34 56")).toBe("123456");
  });

  it("openWorkspace passes the caller's selfFounded verbatim, never a server value", async () => {
    const e = createVaultEngine({ client: fakeClient, runtime });
    await e.unlock("p");
    await e.openWorkspace("ws-1", false);
    expect((client.openWorkspace as jest.Mock).mock.calls[0][3]).toMatchObject({ selfFounded: false });
    await e.openWorkspace("ws-2", true);
    expect((client.openWorkspace as jest.Mock).mock.calls[1][3]).toMatchObject({ selfFounded: true });
  });

  it("openWorkspace hands back the persisted high-water mark and a hook to keep it current", async () => {
    const e = createVaultEngine({ client: fakeClient, runtime });
    await e.unlock("p");
    await e.openWorkspace("ws-2", true);
    const opts = (client.openWorkspace as jest.Mock).mock.calls[0][3];
    expect(opts.highWater).toEqual({ version: 7, hash: new Uint8Array(32), wkVersion: 2 });
    expect(typeof opts.onAdvance).toBe("function");
  });

  it("listFolder maps entries to VaultEntry, folders first then files by name, case-insensitive", async () => {
    const e = createVaultEngine({ client: fakeClient, runtime });
    await e.unlock("p");
    await e.openWorkspace("ws-1", true);
    expect(await e.listFolder("root")).toEqual([
      { id: "d1", name: "Sub", kind: "folder", size: null, timestamp: 4 },
      { id: "f1", name: "A.jpg", kind: "file", size: 123, timestamp: 5 },
      { id: "f2", name: "b.txt", kind: "file", size: 7, timestamp: 6 },
    ]);
  });

  it("createFolder commits a put of a folder entry with a fresh id and returns it", async () => {
    const e = createVaultEngine({ client: fakeClient, runtime });
    await e.unlock("p");
    await e.openWorkspace("ws-1", true);
    const { folderId } = await e.createFolder("root", "Photos");
    const call = (client.commitFolderOps as jest.Mock).mock.calls[0];
    expect(call[3]).toBe("root");
    expect(call[4]).toEqual([{ type: "put", entry: expect.objectContaining({ id: folderId, name: "Photos", kind: "folder", contentRef: "" }) }]);
    expect(folderId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uploadFile, downloadFileTo and deleteEntry delegate with the session and workspace", async () => {
    const e = createVaultEngine({ client: fakeClient, runtime });
    await e.unlock("p");
    await e.openWorkspace("ws-1", true);
    const source = { totalSize: 0, boundaries: [], read: async () => new Uint8Array(0) };
    expect(await e.uploadFile("root", "x.bin", source)).toEqual({ fileId: "new-file" });
    const uploadCall = (client.uploadFileStreaming as jest.Mock).mock.calls[0];
    expect(uploadCall.slice(1)).toEqual(["root", "x.bin", source]);
    expect(uploadCall[0].session).toBeDefined();
    expect(uploadCall[0].ws.workspaceId).toBe("ws-1");
    const got: number[] = [];
    expect(await e.downloadFileTo("root", "f1", async (b) => { got.push(b.length); })).toEqual({ totalSize: 2 });
    expect(got).toEqual([2]);
    await e.deleteEntry("root", "f1");
    expect((client.deleteEntry as jest.Mock).mock.calls[0].slice(1)).toEqual(["root", "f1"]);
  });

  it("refuses workspace operations before a Space is open", async () => {
    const e = createVaultEngine({ client: fakeClient, runtime });
    await e.unlock("p");
    await expect(e.listFolder("root")).rejects.toThrow("vault: no open Space");
  });

  it("forgets the open Space before a switch, so a failed openWorkspace leaves no Space open", async () => {
    const e = createVaultEngine({ client: fakeClient, runtime });
    await e.unlock("p");
    await e.openWorkspace("ws-1", true);
    (client.openWorkspace as jest.Mock).mockRejectedValueOnce(new Error("boom"));
    await expect(e.openWorkspace("ws-2", false)).rejects.toThrow("boom");
    await expect(e.listFolder("root")).rejects.toThrow("vault: no open Space");
  });

  it("lock clears the open Space, not only the session", async () => {
    const e = createVaultEngine({ client: fakeClient, runtime });
    await e.unlock("p");
    await e.openWorkspace("ws-1", true);
    e.lock();
    await e.unlock("p");
    await expect(e.listFolder("root")).rejects.toThrow("vault: no open Space");
  });

  it("sorts by id when two names tie case-insensitively", async () => {
    (client.listFolder as jest.Mock).mockResolvedValueOnce(new Map([
      ["f-b", { id: "f-b", name: "a.txt", kind: "file", contentRef: "y", meta: { size: 1, record: "{}" }, writerId: "self", timestamp: 1 }],
      ["f-a", { id: "f-a", name: "A.txt", kind: "file", contentRef: "x", meta: { size: 1, record: "{}" }, writerId: "self", timestamp: 1 }],
    ]));
    const e = createVaultEngine({ client: fakeClient, runtime });
    await e.unlock("p");
    await e.openWorkspace("ws-1", true);
    const entries = await e.listFolder("root");
    expect(entries.map((x) => x.id)).toEqual(["f-a", "f-b"]);
  });
});

describe("VaultEngine - a ceremony that finishes after lock()", () => {
  // Its own hook: the outer describe's beforeEach does not run for this block,
  // and these tests wait on the client mocks' call counts.
  beforeEach(() => jest.clearAllMocks());

  it("discards a stale unlock: the promise rejects and the engine stays locked", async () => {
    // The engine is a singleton shared by whoever is signed in. A ceremony
    // from before a sign-out must not assign its session afterwards.
    let settle!: (s: unknown) => void;
    (client.unlock as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    const e = createVaultEngine({ client: fakeClient, runtime });

    const pending = e.unlock("p");
    while ((client.unlock as jest.Mock).mock.calls.length === 0) await Promise.resolve();
    e.lock();
    settle({ kek: new Uint8Array(32), identity: {} });

    await expect(pending).rejects.toThrow("vault: locked");
    expect(e.isUnlocked()).toBe(false);
  });

  it("never lets a stale unlock replace the session a later unlock established", async () => {
    let settle!: (s: unknown) => void;
    (client.unlock as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    const e = createVaultEngine({ client: fakeClient, runtime });

    const stale = e.unlock("old");
    while ((client.unlock as jest.Mock).mock.calls.length === 0) await Promise.resolve();
    e.lock();
    await e.unlock("new");
    expect(e.isUnlocked()).toBe(true);

    settle({ kek: new Uint8Array(32), identity: {} });
    await expect(stale).rejects.toThrow("vault: locked");
    // The live session stands: the stale continuation neither replaced it nor
    // locked it out.
    expect(e.isUnlocked()).toBe(true);
  });

  it("discards a stale openWorkspace the same way", async () => {
    let settle!: (w: unknown) => void;
    const e = createVaultEngine({ client: fakeClient, runtime });
    await e.unlock("p");
    (client.openWorkspace as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));

    const pending = e.openWorkspace("ws-1", true);
    while ((client.openWorkspace as jest.Mock).mock.calls.length === 0) await Promise.resolve();
    e.lock();
    settle({ workspaceId: "ws-1", wk: new Uint8Array(32), wkVersion: 1 });

    await expect(pending).rejects.toThrow("vault: locked");
    await e.unlock("p");
    await expect(e.listFolder("root")).rejects.toThrow("vault: no open Space");
  });
});

// On-device Personas opens or seals the user's personas key with the unlocked
// identity's X25519 keys (src/personas/device/engine-host.ts unlockPersonas).
describe("VaultEngine.personasIdentity", () => {
  it("is null while locked and hands out copies of the X25519 keys once unlocked", async () => {
    const pub = new Uint8Array(32).fill(1);
    const priv = new Uint8Array(32).fill(2);
    (client.unlock as jest.Mock).mockResolvedValueOnce({ kek: new Uint8Array(32), identity: { x25519: { publicKey: pub, privateKey: priv } } });
    const e = createVaultEngine({ client: fakeClient, runtime });
    expect(e.personasIdentity?.()).toBeNull();
    await e.unlock("passphrase");
    const id = e.personasIdentity?.();
    expect(Array.from(id!.x25519Pub)).toEqual(Array.from(pub));
    expect(Array.from(id!.x25519Priv)).toEqual(Array.from(priv));
    id!.x25519Priv.fill(0);
    expect(priv[0]).toBe(2);
    e.lock();
    expect(e.personasIdentity?.()).toBeNull();
  });
});
