import {
  listRequests, createRequest, patchRequest, revokeRequest,
  listRecipients, addRecipient, removeRecipient, resendInvite, listUploads,
} from "./api";

let calls: { url: string; method: string; body: any }[] = [];

function mockFetch(body: unknown, status = 200) {
  (globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
    return { status, ok: status < 400, headers: new Headers(), json: async () => body };
  });
}

beforeEach(() => { calls = []; });

describe("listRequests", () => {
  it("asks for one workspace", async () => {
    mockFetch({ ok: true, requests: [{ id: "fr_1" }] });
    const res = await listRequests("w1");
    expect(calls[0].url).toContain("/api/file-requests?workspace_id=w1");
    expect(res).toHaveLength(1);
  });

  it("tolerates a response with no requests", async () => {
    mockFetch({ ok: true });
    expect(await listRequests("w1")).toEqual([]);
  });
});

describe("createRequest", () => {
  it("posts to the create endpoint", async () => {
    mockFetch({ ok: true, url: "https://dosya.dev/upload-request/tok" });
    const res = await createRequest({ workspaceId: "w1", title: "Assets" });
    expect(calls[0].url).toContain("/api/file-requests/create");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ workspace_id: "w1", title: "Assets" });
    expect(res.url).toBe("https://dosya.dev/upload-request/tok");
  });

  it("sends emails as an array", async () => {
    // The API reads `emails` and nothing else. A scalar recipient_email - which
    // is what the desktop app has been sending - creates the request and invites
    // nobody, with no error anywhere.
    mockFetch({ ok: true, url: "u" });
    await createRequest({ workspaceId: "w1", emails: ["a@b.c", "d@e.f"] });
    expect(calls[0].body.emails).toEqual(["a@b.c", "d@e.f"]);
    expect(calls[0].body).not.toHaveProperty("recipient_email");
  });

  it("omits what it was not given", async () => {
    mockFetch({ ok: true, url: "u" });
    await createRequest({ workspaceId: "w1", title: "Assets" });
    expect(calls[0].body).not.toHaveProperty("password");
    expect(calls[0].body).not.toHaveProperty("max_files");
    expect(calls[0].body).not.toHaveProperty("emails");
  });

  it("carries every limit it is given", async () => {
    mockFetch({ ok: true, url: "u" });
    await createRequest({
      workspaceId: "w1", expiresInDays: 7, maxFiles: 3,
      maxFileSizeMb: 25, allowedExtensions: "pdf", password: "hunter2!!",
    });
    expect(calls[0].body).toMatchObject({
      expires_in_days: 7, max_files: 3, max_file_size_mb: 25,
      allowed_extensions: "pdf", password: "hunter2!!",
    });
  });

  it("reads the url from either shape the endpoint returns", async () => {
    mockFetch({ ok: true, request: { url: "https://dosya.dev/upload-request/nested" } });
    expect((await createRequest({ workspaceId: "w1" })).url).toBe("https://dosya.dev/upload-request/nested");
  });
});

describe("patchRequest", () => {
  it("sends only the keys it was handed", async () => {
    mockFetch({ ok: true });
    await patchRequest("fr_1", { title: "Renamed" });
    expect(calls[0].url).toContain("/api/file-requests/fr_1");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toEqual({ title: "Renamed" });
  });
});

describe("revokeRequest", () => {
  it("DELETEs, which the API treats as a revoke", async () => {
    mockFetch({ ok: true });
    await revokeRequest("fr_1");
    expect(calls[0].url).toContain("/api/file-requests/fr_1");
    expect(calls[0].method).toBe("DELETE");
  });
});

describe("recipients", () => {
  it("lists them", async () => {
    mockFetch({ ok: true, recipients: [{ id: "rcp_1" }] });
    expect(await listRecipients("fr_1")).toHaveLength(1);
    expect(calls[0].url).toContain("/api/file-requests/fr_1/recipients");
  });

  it("returns an empty list when there are none", async () => {
    mockFetch({ ok: true });
    expect(await listRecipients("fr_1")).toEqual([]);
  });

  it("adds one by email", async () => {
    mockFetch({ ok: true });
    await addRecipient("fr_1", "New@Example.com ");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ email: "new@example.com" });
  });

  it("removes one by query parameter, not by body", async () => {
    mockFetch({ ok: true });
    await removeRecipient("fr_1", "rcp_9");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toContain("recipient_id=rcp_9");
    expect(calls[0].body).toBeUndefined();
  });
});

describe("resendInvite", () => {
  it("posts the recipient id", async () => {
    mockFetch({ ok: true });
    await resendInvite("fr_1", "rcp_9");
    expect(calls[0].url).toContain("/api/file-requests/fr_1/resend");
    expect(calls[0].body).toEqual({ recipient_id: "rcp_9" });
  });
});

describe("listUploads", () => {
  it("returns the request and its uploads", async () => {
    mockFetch({ ok: true, request: { id: "fr_1" }, uploads: [{ id: "fru_1" }] });
    const res = await listUploads("fr_1");
    expect(calls[0].url).toContain("/api/file-requests/fr_1/uploads");
    expect(res.request?.id).toBe("fr_1");
    expect(res.uploads).toHaveLength(1);
  });

  it("returns an empty upload list rather than undefined", async () => {
    mockFetch({ ok: true, request: { id: "fr_1" } });
    expect((await listUploads("fr_1")).uploads).toEqual([]);
  });
});
