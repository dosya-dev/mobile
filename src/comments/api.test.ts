import { listComments, postComment, editComment, deleteComment } from "./api";

let calls: { url: string; method: string; body: unknown }[] = [];

function mockFetch(body: unknown, status = 200) {
  (globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
    return { status, ok: status < 400, headers: new Headers(), json: async () => body };
  });
}

const row = { id: "c1", body: "hi", user_id: "u1", parent_id: null };

beforeEach(() => { calls = []; });

describe("listComments", () => {
  it("asks for one file in one workspace", async () => {
    mockFetch({ ok: true, comments: [row] });
    const res = await listComments("w1", "f1");
    expect(calls[0].url).toContain("/api/comments?");
    expect(calls[0].url).toContain("file_id=f1");
    expect(calls[0].url).toContain("workspace_id=w1");
    expect(res).toHaveLength(1);
  });

  it("returns an empty list when the response carries none", async () => {
    mockFetch({ ok: true });
    expect(await listComments("w1", "f1")).toEqual([]);
  });
});

describe("postComment", () => {
  it("posts the body against the file", async () => {
    mockFetch({ ok: true, comment: row });
    await postComment({ workspaceId: "w1", fileId: "f1", body: " hi " });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ workspace_id: "w1", file_id: "f1", body: "hi" });
  });

  it("omits parent_id entirely when not replying", async () => {
    // Sending parent_id: null is a value the server then looks up, and it
    // answers a parent it cannot find with a 404. Absence means top level.
    mockFetch({ ok: true, comment: row });
    await postComment({ workspaceId: "w1", fileId: "f1", body: "hi" });
    expect(calls[0].body).not.toHaveProperty("parent_id");
  });

  it("carries parent_id when replying", async () => {
    mockFetch({ ok: true, comment: row });
    await postComment({ workspaceId: "w1", fileId: "f1", body: "hi", parentId: "c9" });
    expect(calls[0].body).toMatchObject({ parent_id: "c9" });
  });
});

describe("editComment", () => {
  it("PUTs the trimmed body to the comment", async () => {
    mockFetch({ ok: true });
    await editComment("c1", " fixed ");
    expect(calls[0].url).toContain("/api/comments/c1");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body).toEqual({ body: "fixed" });
  });
});

describe("deleteComment", () => {
  it("DELETEs the comment", async () => {
    mockFetch({ ok: true });
    await deleteComment("c1");
    expect(calls[0].url).toContain("/api/comments/c1");
    expect(calls[0].method).toBe("DELETE");
  });
});
