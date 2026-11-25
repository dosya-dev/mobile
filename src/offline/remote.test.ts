const mockApi = { handler: null as null | ((path: string, opts?: { method?: string; body?: unknown }) => Promise<unknown>) };
jest.mock("@/api/client", () => ({
  apiRequest: jest.fn((path: string, opts?: { method?: string; body?: unknown }) => mockApi.handler!(path, opts)),
  EDGE_CHALLENGE_CODE: "edge_challenge",
}));

import { apiRequest } from "@/api/client";
import { ApiError } from "@/api/errors";
import { checkAccess, checkMembership, SNAPSHOT_PAGE } from "./remote";
import type { OfflineFolderRow, PinRow } from "./types";

const pin = (id: string, over: Partial<PinRow> = {}): PinRow => ({
  id, kind: "folder", workspace_id: "w1", name: id, created_at: 1, revision: 1, status: "ready",
  last_checked_at: null, last_error: null, ...over,
});

const fileRow = (id: string, folder_id: string, over: Record<string, unknown> = {}) => ({
  id, name: `${id}.txt`, size_bytes: 10, mime_type: "text/plain", extension: "txt", region: "eu",
  folder_id, updated_at: 1, current_version: 1, source_modified_at: null, lock_mode: "none", ...over,
});

const calls = () => (apiRequest as jest.Mock).mock.calls.map((c) => c[0] as string);

function snapshotServer(tree: { folders: { id: string; name: string; parent_id: string | null }[]; files: ReturnType<typeof fileRow>[] }, fail?: (path: string) => unknown) {
  mockApi.handler = async (path) => {
    const f = fail?.(path);
    if (f) throw f;
    const u = new URL(`https://x${path}`);
    const root = u.searchParams.get("folder_id")!;
    const limit = Number(u.searchParams.get("limit"));
    const cursor = u.searchParams.get("cursor");
    // Subtree of root, like the server's rootScopeIds.
    const scope = new Set([root]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const fo of tree.folders) if (fo.parent_id && scope.has(fo.parent_id) && !scope.has(fo.id)) { scope.add(fo.id); grew = true; }
    }
    // Pages over the whole workspace by id, then filters, as the server does.
    const all = [...tree.files].sort((a, b) => (a.id < b.id ? -1 : 1));
    const start = cursor ? all.findIndex((f) => f.id === cursor) + 1 : 0;
    const page = all.slice(start, start + limit);
    const hasMore = start + limit < all.length;
    return {
      ok: true,
      files: page.filter((f) => scope.has(f.folder_id)),
      folders: cursor ? [] : tree.folders.filter((fo) => scope.has(fo.id) && fo.id !== root),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
      root_folder_id: root,
    };
  };
}

beforeEach(() => jest.clearAllMocks());

describe("checkMembership: folder pins", () => {
  it("pages until done and returns every file under the folder", async () => {
    snapshotServer({ folders: [{ id: "sub", name: "Sub", parent_id: "P" }], files: [fileRow("a", "P"), fileRow("b", "sub"), fileRow("c", "elsewhere")] });
    const [c] = await checkMembership([pin("P")], []);
    expect(c.outcome).toBe("ok");
    if (c.outcome !== "ok") return;
    expect(c.files.map((f) => f.file_id).sort()).toEqual(["a", "b"]);
    expect(c.files[0]).toMatchObject({ workspace_id: "w1", lock_mode: "none", current_version: 1 });
    expect(c.folders).toEqual(expect.arrayContaining([
      { id: "P", workspace_id: "w1", parent_id: null, name: "P", pin_id: "P" },
      { id: "sub", workspace_id: "w1", parent_id: "P", name: "Sub", pin_id: "P" },
    ]));
  });

  it("a 12,000-file folder takes 3 pages", async () => {
    const files = Array.from({ length: 12_000 }, (_, i) => fileRow(`f${String(i).padStart(5, "0")}`, "P"));
    snapshotServer({ folders: [], files });
    const [c] = await checkMembership([pin("P")], []);
    expect(calls()).toHaveLength(3);
    expect(SNAPSHOT_PAGE).toBe(5000);
    expect(c.outcome === "ok" && c.files.length).toBe(12_000);
    expect(calls()[1]).toContain("cursor=");
  });

  it("a failed page means skipped", async () => {
    const files = Array.from({ length: 6000 }, (_, i) => fileRow(`f${String(i).padStart(5, "0")}`, "P"));
    snapshotServer({ folders: [], files }, (path) => (path.includes("cursor=") ? new ApiError("down", 503) : null));
    const [c] = await checkMembership([pin("P", { revision: 4 })], []);
    expect(c).toEqual({ pinId: "P", revision: 4, outcome: "skipped" });
  });

  it.each([403, 404])("the folder's own %s means gone", async (status) => {
    snapshotServer({ folders: [], files: [] }, () => new ApiError("no", status));
    const [c] = await checkMembership([pin("P")], []);
    expect(c.outcome).toBe("gone");
  });

  it.each([
    ["network", new ApiError("offline", 0)],
    ["401", new ApiError("auth", 401)],
    ["429", new ApiError("slow", 429)],
    ["edge challenge 403", new ApiError("challenge", 403, "edge_challenge")],
  ])("%s means skipped, not gone", async (_l, err) => {
    snapshotServer({ folders: [], files: [] }, () => err);
    const [c] = await checkMembership([pin("P")], []);
    expect(c.outcome).toBe("skipped");
  });

  it("a missing lock_mode comes through as empty, never as none", async () => {
    snapshotServer({ folders: [], files: [fileRow("a", "P", { lock_mode: undefined })] });
    const [c] = await checkMembership([pin("P")], []);
    expect(c.outcome === "ok" && c.files[0].lock_mode).toBe("");
  });

  it("a 200 with no file list is skipped, never read as an empty folder", async () => {
    mockApi.handler = async () => ({ ok: true, folders: [], hasMore: false, nextCursor: null });
    const [c] = await checkMembership([pin("P")], []);
    expect(c.outcome).toBe("skipped");
  });

  it("nested pins make no extra request", async () => {
    snapshotServer({
      folders: [{ id: "B", name: "B", parent_id: "A" }, { id: "B2", name: "B2", parent_id: "B" }],
      files: [fileRow("a", "A"), fileRow("b", "B"), fileRow("b2", "B2")],
    });
    // Stored folders say B lived under A last run; it is checked after A either way.
    const stored: OfflineFolderRow[] = [{ id: "B", workspace_id: "w1", parent_id: "A", name: "B", pin_id: "A" }];
    const checks = await checkMembership([pin("B", { revision: 7 }), pin("A")], stored);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toContain("folder_id=A");
    const b = checks.find((c) => c.pinId === "B")!;
    expect(b.revision).toBe(7);
    expect(b.outcome === "ok" && b.files.map((f) => f.file_id).sort()).toEqual(["b", "b2"]);
    expect(b.outcome === "ok" && b.folders.map((f) => f.id).sort()).toEqual(["B", "B2"]);
    expect(b.outcome === "ok" && b.folders.find((f) => f.id === "B")?.parent_id).toBe("A");
  });

  it("a pin that moved out of its old ancestor is fetched on its own", async () => {
    snapshotServer({
      folders: [{ id: "B", name: "B", parent_id: "elsewhere" }],
      files: [fileRow("b", "B")],
    });
    const stored: OfflineFolderRow[] = [{ id: "B", workspace_id: "w1", parent_id: "A", name: "B", pin_id: "A" }];
    const checks = await checkMembership([pin("A"), pin("B")], stored);
    expect(calls()).toHaveLength(2);
    expect(checks.find((c) => c.pinId === "B")?.outcome).toBe("ok");
  });

  it("the check carries the revision from its start", async () => {
    snapshotServer({ folders: [], files: [fileRow("a", "P")] });
    const p = pin("P", { revision: 3 });
    const pending = checkMembership([p], []);
    p.revision = 4; // a re-pin landing while the request is out
    const [c] = await pending;
    expect(c.revision).toBe(3);
  });
});

describe("checkMembership: file pins", () => {
  const detail = (id: string, over: Record<string, unknown> = {}) => ({
    id, name: `${id}.docx`, size_bytes: 10, mime_type: "x", extension: "docx", created_at: 1, updated_at: 2,
    current_version: 5, lock_mode: "none", share_count: 0, comment_count: 0, folder_id: "fo", workspace_id: "w1", ...over,
  });

  it("reads the file record", async () => {
    mockApi.handler = async (path) => ({ ok: true, file: detail(path.split("/").pop()!) });
    const [c] = await checkMembership([pin("f1", { kind: "file" })], []);
    expect(c.outcome === "ok" && c.files).toEqual([expect.objectContaining({ file_id: "f1", current_version: 5, folder_id: "fo", lock_mode: "none" })]);
  });

  it.each([403, 404])("%s means gone", async (status) => {
    mockApi.handler = async () => { throw new ApiError("no", status); };
    const [c] = await checkMembership([pin("f1", { kind: "file" })], []);
    expect(c.outcome).toBe("gone");
  });

  it.each([0, 429, 500, 503])("%s means skipped", async (status) => {
    mockApi.handler = async () => { throw new ApiError("no", status); };
    const [c] = await checkMembership([pin("f1", { kind: "file" })], []);
    expect(c.outcome).toBe("skipped");
  });

  it("a 200 with no file record is skipped, not absent", async () => {
    mockApi.handler = async () => ({ ok: true });
    const [c] = await checkMembership([pin("f1", { kind: "file" })], []);
    expect(c.outcome).toBe("skipped");
  });

  it("a trashed file is absent, not gone", async () => {
    mockApi.handler = async (path) => ({ ok: true, file: detail(path.split("/").pop()!, { deleted_at: 9 }) });
    const [c] = await checkMembership([pin("f1", { kind: "file" })], []);
    expect(c).toMatchObject({ outcome: "ok", files: [] });
  });

  it("runs at most 4 at once", async () => {
    let inFlight = 0;
    let peak = 0;
    mockApi.handler = async (path) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      return { ok: true, file: detail(path.split("/").pop()!) };
    };
    const pins = Array.from({ length: 10 }, (_, i) => pin(`f${i}`, { kind: "file" }));
    const checks = await checkMembership(pins, []);
    expect(checks).toHaveLength(10);
    expect(peak).toBe(4);
  });
});

describe("checkAccess", () => {
  function server(answer: (ws: string, ids: string[]) => unknown) {
    mockApi.handler = async (_path, opts) => {
      const body = opts!.body as { workspace_id: string; file_ids: string[] };
      const r = answer(body.workspace_id, body.file_ids);
      if (r instanceof Error) throw r;
      return r;
    };
  }
  const allowAll = (_ws: string, ids: string[]) => ({ ok: true, decisions: Object.fromEntries(ids.map((id) => [id, "allowed"])) });

  it("asks in chunks of 500", async () => {
    server(allowAll);
    const ids = Array.from({ length: 1201 }, (_, i) => `f${i}`);
    const [a] = await checkAccess(new Map([["w1", ids]]));
    const bodies = (apiRequest as jest.Mock).mock.calls.map((c) => c[1].body.file_ids.length);
    expect(bodies).toEqual([500, 500, 201]);
    expect((apiRequest as jest.Mock).mock.calls[0][0]).toBe("/api/sync/download-check");
    expect((apiRequest as jest.Mock).mock.calls[0][1].method).toBe("POST");
    expect(a.outcome === "ok" && a.allowed.size).toBe(1201);
  });

  it("reads per-file decisions", async () => {
    server((_ws, ids) => ({ ok: true, decisions: Object.fromEntries(ids.map((id) => [id, id === "x" ? "denied" : "allowed"])) }));
    const [a] = await checkAccess(new Map([["w1", ["x", "y"]]]));
    expect(a).toEqual({ workspaceId: "w1", outcome: "ok", allowed: new Set(["y"]), denied: new Set(["x"]) });
  });

  it("an id missing from the answer, or an odd value, is neither allowed nor denied", async () => {
    server(() => ({ ok: true, decisions: { y: "maybe" } }));
    const [a] = await checkAccess(new Map([["w1", ["x", "y"]]]));
    expect(a).toEqual({ workspaceId: "w1", outcome: "ok", allowed: new Set(), denied: new Set() });
  });

  it("a 200 with no decisions makes the workspace unknown", async () => {
    server(() => ({ ok: true }));
    const [a] = await checkAccess(new Map([["w1", ["x"]]]));
    expect(a).toEqual({ workspaceId: "w1", outcome: "unknown" });
  });

  it("one failed chunk makes the workspace unknown", async () => {
    let n = 0;
    server((ws, ids) => (++n === 2 ? new ApiError("down", 503) : allowAll(ws, ids)));
    const ids = Array.from({ length: 1000 }, (_, i) => `f${i}`);
    const [a] = await checkAccess(new Map([["w1", ids]]));
    expect(a).toEqual({ workspaceId: "w1", outcome: "unknown" });
  });

  it.each(["not_member", "no_download_permission"])("coded 403 %s means workspace_denied", async (code) => {
    server(() => new ApiError("no", 403, code));
    const [a] = await checkAccess(new Map([["w1", ["x"]]]));
    expect(a).toEqual({ workspaceId: "w1", outcome: "workspace_denied" });
  });

  it.each([
    ["uncoded 403", new ApiError("no", 403)],
    ["edge challenge", new ApiError("no", 403, "edge_challenge")],
    ["401", new ApiError("no", 401)],
    ["429", new ApiError("no", 429)],
    ["network", new ApiError("no", 0)],
    ["500", new ApiError("no", 500)],
    ["non-ApiError", new Error("weird")],
  ])("%s means unknown", async (_l, err) => {
    server(() => err);
    const [a] = await checkAccess(new Map([["w1", ["x"]]]));
    expect(a).toEqual({ workspaceId: "w1", outcome: "unknown" });
  });

  it("workspaces are judged separately", async () => {
    server((ws, ids) => (ws === "w2" ? new ApiError("no", 403, "not_member") : allowAll(ws, ids)));
    const out = await checkAccess(new Map([["w1", ["a"]], ["w2", ["b"]]]));
    expect(out.find((a) => a.workspaceId === "w1")?.outcome).toBe("ok");
    expect(out.find((a) => a.workspaceId === "w2")?.outcome).toBe("workspace_denied");
  });
});
