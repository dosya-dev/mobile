import {
  createShareLink, shareViaEmail, listMyShares, revokeShare, createFolderShareLink, shareFolderViaEmail,
  updateShare, getShareAnalytics, openShare, requestShareCode, verifyShareCode, getFolderShareExclusions,
} from "./api";

function capture(body: unknown, status = 200) {
  const calls: { url: string; init: any }[] = [];
  (globalThis as any).fetch = jest.fn(async (url: string, init: any) => { calls.push({ url, init }); return { status, ok: status < 400, headers: new Headers(), json: async () => body }; });
  return calls;
}

describe("share api", () => {
  afterEach(() => jest.restoreAllMocks());

  it("creates a link with expiry + password", async () => {
    const calls = capture({ ok: true, link: { id: "l1", token: "tok", url: "https://dosya.dev/s/tok" } });
    // "pw" until the shared validation policy landed - two characters, which the
    // API refuses at the 8-character floor. The fixture was asserting that
    // mobile would happily send it.
    const link = await createShareLink("f1", { expiresInDays: 7, password: "correct-horse" });
    expect(calls[0].url).toContain("/api/files/f1/share");
    expect(JSON.parse(calls[0].init.body)).toEqual({ expires_in_days: 7, password: "correct-horse" });
    expect(link.url).toBe("https://dosya.dev/s/tok");
  });

  it("shares via email", async () => {
    const calls = capture({ ok: true });
    await shareViaEmail("f1", { emails: ["a@b.com"], message: "hi", restrictToRecipients: false });
    expect(calls[0].url).toContain("/api/files/f1/share-email");
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ emails: ["a@b.com"], message: "hi", restrict_to_recipients: false });
    expect(JSON.parse(calls[0].init.body)).not.toHaveProperty("expires_in_days");
  });

  it("lists my shares for a workspace", async () => {
    const calls = capture({ ok: true, links: [{ link_id: "l1", token: "tok", file_name: "a.txt", folder_name: null, is_bundle: 0, is_password_protected: 0, is_revoked: 0, expires_at: null, view_count: 2, download_count: 1, shared_at: 1, status: "active" }], stats: { total: 1, active: 1, expiring: 0, total_views: 2 } });
    const page = await listMyShares("w1");
    expect(calls[0].url).toContain("workspace_id=w1");
    expect(page.links[0].file_name).toBe("a.txt");
    expect(page.stats).toEqual({ total: 1, active: 1, expiring: 0, total_views: 2 });
  });

  // The endpoint has always sent `stats`; nothing on mobile read it. Deriving a
  // fallback means an API that stops sending it blanks a number rather than the
  // whole header.
  it("derives the header counts when the response carries no stats block", async () => {
    capture({ ok: true, links: [
      { link_id: "l1", status: "active", view_count: 5 },
      { link_id: "l2", status: "expiring", view_count: 3 },
    ] });
    const page = await listMyShares("w1");
    expect(page.stats).toEqual({ total: 2, active: 1, expiring: 1, total_views: 8 });
  });

  it("revokes by link id", async () => {
    const calls = capture({ ok: true });
    await revokeShare("l1");
    expect(calls[0].url).toContain("/api/shares/l1/revoke");
    expect(calls[0].init.method).toBe("POST");
  });

  it("creates a folder link against the folders endpoint", async () => {
    const calls = capture({ ok: true, link: { id: "l1", token: "tok", url: "https://dosya.dev/s/tok" } });
    const link = await createFolderShareLink("fld1", { expiresInDays: 7 });
    expect(calls[0].url).toContain("/api/folders/fld1/share");
    expect(calls[0].url).not.toContain("/api/files/");
    expect(JSON.parse(calls[0].init.body)).toEqual({ expires_in_days: 7 });
    expect(link.url).toBe("https://dosya.dev/s/tok");
  });

  it("emails a folder link against the folders endpoint", async () => {
    const calls = capture({ ok: true, share_url: "https://dosya.dev/s/tok" });
    await shareFolderViaEmail("fld1", { emails: ["a@b.com"], message: "hi", restrictToRecipients: false });
    expect(calls[0].url).toContain("/api/folders/fld1/share-email");
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ emails: ["a@b.com"], message: "hi", restrict_to_recipients: false });
  });

  it("patches only the named fields and keeps the token", async () => {
    const calls = capture({ ok: true, link: { link_id: "l1", expires_at: null, is_password_protected: 0, lock_mode: "view_only", access_mode: "public", recipient_count: 0 } });
    const updated = await updateShare("l1", { lockMode: "view_only" });
    expect(calls[0].url).toContain("/api/shares/l1");
    expect(calls[0].url).not.toContain("/revoke");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(calls[0].init.body)).toEqual({ lock_mode: "view_only" });
    expect(updated.lock_mode).toBe("view_only");
  });

  it("asks for analytics at the range the screen is showing", async () => {
    const calls = capture({ ok: true, link: { link_id: "l1" }, range: 7, timeline: [], reach: { visitors: 0, truncated: false, devices: [], browsers: [] }, recipients: null, log: { total: 0, offset: 0, limit: 50, rows: [] }, gaps: { repeat_visits: "x", per_recipient: null } });
    const a = await getShareAnalytics("l1", 7);
    expect(calls[0].url).toContain("/api/shares/l1/analytics");
    expect(calls[0].url).toContain("range=7");
    expect(a.range).toBe(7);
  });

  it("reads a folder link's exclusion count", async () => {
    const calls = capture({ ok: true, excluded_count: 3 });
    expect(await getFolderShareExclusions("fld1")).toBe(3);
    expect(calls[0].url).toContain("/api/folders/fld1/share");
  });

  it("treats a missing exclusion count as nothing excluded, never as an error", async () => {
    capture({ ok: true });
    expect(await getFolderShareExclusions("fld1")).toBe(0);
  });
});

describe("openShare", () => {
  afterEach(() => jest.restoreAllMocks());

  it("reports a password gate as a gate, not as an empty file", async () => {
    capture({ ok: true, is_password_protected: true, files: [], file: null, link: { view_count: 4, expires_at: 99 } });
    const p = await openShare("tok");
    expect(p.requiresPassword).toBe(true);
    expect(p.viewCount).toBe(4);
    expect(p.expiresAt).toBe(99);
  });

  // A protected link the visitor has ALREADY unlocked still reports
  // is_password_protected - it describes the link, not the visitor's state. The
  // payload is the tell, and reading the flag alone would show the prompt again
  // to someone already through it.
  it("does not re-prompt once the unlocked payload arrives", async () => {
    capture({ ok: true, is_password_protected: true, files: [{ id: "f1", name: "a.txt" }], file: { id: "f1", name: "a.txt" } });
    const p = await openShare("tok");
    expect(p.requiresPassword).toBe(false);
    expect(p.file?.name).toBe("a.txt");
  });

  it("reports a private link's verification gate separately from a password", async () => {
    capture({ ok: true, requires_recipient_verification: true, is_password_protected: false, files: [], file: null });
    const p = await openShare("tok");
    expect(p.requiresRecipientVerification).toBe(true);
    expect(p.requiresPassword).toBe(false);
  });

  // An unlocked, password-protected folder share whose current directory is
  // empty has no file and no files. Judging the gate on those alone sent the
  // visitor back to the prompt they had just cleared.
  it("does not re-prompt on an unlocked but empty protected folder", async () => {
    capture({ ok: true, is_folder: true, is_password_protected: true, files: [], file: null,
      folder: { root_id: "r", root_name: "R", current_id: "c", current_name: "Empty", breadcrumb: [], subfolders: [] } });
    const p = await openShare("tok");
    expect(p.requiresPassword).toBe(false);
    expect(p.folder?.current_name).toBe("Empty");
  });

  it("carries the folder view and the view-only lock through", async () => {
    capture({ ok: true, is_folder: true, lock_mode: "view_only", folder: { root_id: "r", root_name: "R", current_id: "c", current_name: "C", breadcrumb: [], subfolders: [] }, files: [] });
    const p = await openShare("tok");
    expect(p.isFolder).toBe(true);
    expect(p.lockMode).toBe("view_only");
    expect(p.folder?.current_name).toBe("C");
  });

  it("navigates into a subfolder by path_id", async () => {
    const calls = capture({ ok: true, is_folder: true, folder: { root_id: "r", root_name: "R", current_id: "sub", current_name: "Sub", breadcrumb: [], subfolders: [] }, files: [] });
    await openShare("tok", "sub");
    expect(calls[0].url).toContain("path_id=sub");
  });

  it("defaults an absent lock mode to none rather than undefined", async () => {
    capture({ ok: true, files: [{ id: "f1", name: "a.txt" }], file: { id: "f1", name: "a.txt" } });
    expect((await openShare("tok")).lockMode).toBe("none");
  });
});

describe("private link code flow", () => {
  afterEach(() => jest.restoreAllMocks());

  it("requests a code for a normalised address", async () => {
    const calls = capture({ ok: true });
    await requestShareCode("tok", "  Dana@Northfield.co ");
    expect(calls[0].url).toContain("/api/share/tok/request-code");
    expect(JSON.parse(calls[0].init.body)).toEqual({ email: "dana@northfield.co" });
  });

  it("verifies the code against the same address", async () => {
    const calls = capture({ ok: true });
    await verifyShareCode("tok", "Dana@Northfield.co", " 123456 ");
    expect(calls[0].url).toContain("/api/share/tok/verify-code");
    expect(JSON.parse(calls[0].init.body)).toEqual({ email: "dana@northfield.co", code: "123456" });
  });
});
