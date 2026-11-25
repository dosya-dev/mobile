import { buildEmailShareBody, buildLinkShareBody, buildShareUpdateBody } from "./payload";

describe("buildLinkShareBody", () => {
  it("omits everything that was not set rather than sending nulls", () => {
    expect(buildLinkShareBody({})).toEqual({});
  });

  it("passes expiry through as days, which is what this screen's picker produces", () => {
    expect(buildLinkShareBody({ expiresInDays: 7 })).toEqual({ expires_in_days: 7 });
  });

  // This case used to assert `{}` - the field omitted entirely - and read as
  // correct because 0 is not an expiry of zero days. On the server it was the
  // opposite of what the picker said: createShareLink applies the workspace's
  // default_share_expiry_days whenever a payload names NO expiry at all, so
  // "Never" quietly became "7 days" (or 30 for a mailed link). 0 is the API's
  // own spelling of never (lib/share/expiry.ts), and it has to be SAID.
  it("says 'never' explicitly, because an omitted expiry means the workspace default", () => {
    expect(buildLinkShareBody({ expiresInDays: 0 })).toEqual({ expires_in_days: 0 });
  });

  it("still omits the field when the caller named no expiry at all", () => {
    expect(buildLinkShareBody({ password: "hunter2000" })).toEqual({ password: "hunter2000" });
  });

  it("drops a blank password instead of creating a 'protected' link with no password", () => {
    expect(buildLinkShareBody({ password: "   " })).toEqual({});
    expect(buildLinkShareBody({ password: "hunter2000" })).toEqual({ password: "hunter2000" });
  });

  // This case used to assert the opposite: the fixture was "hunter2", seven
  // characters, which the API has always refused. Mobile sent it anyway and the
  // user found out after the round trip. Now the shared policy stops it here.
  it("refuses a password under the shared 8-character floor", () => {
    expect(() => buildLinkShareBody({ password: "hunter2" }))
      .toThrow("Password must be at least 8 characters");
  });

  it("refuses an expiry past the global ceiling", () => {
    expect(buildLinkShareBody({ expiresInDays: 3650 })).toEqual({ expires_in_days: 3650 });
    expect(() => buildLinkShareBody({ expiresInDays: 3651 }))
      .toThrow("Expiry cannot be more than 3650 days from now");
  });

  // The API has accepted lock_mode since migration 0019 and the CLI sends it as
  // --lock, but no GUI ever did. Without this the mobile view-only toggle would
  // be decorative - the exact bug it exists to close on web.
  it("sends the view-only lock the API has always accepted", () => {
    expect(buildLinkShareBody({ lockMode: "view_only" })).toEqual({ lock_mode: "view_only" });
  });

  it("omits an unset or explicitly-none lock, which the server defaults to anyway", () => {
    expect(buildLinkShareBody({})).not.toHaveProperty("lock_mode");
    expect(buildLinkShareBody({ lockMode: "none" })).not.toHaveProperty("lock_mode");
  });

  // "Remove photo metadata" (API migration 0183): sent only when on, so an
  // ordinary link's body is byte-for-byte what it was before the option.
  it("sends strip_metadata only when the option is on", () => {
    expect(buildLinkShareBody({ stripMetadata: true })).toEqual({ strip_metadata: true });
    expect(buildLinkShareBody({ stripMetadata: false })).not.toHaveProperty("strip_metadata");
    expect(buildLinkShareBody({})).not.toHaveProperty("strip_metadata");
  });
});

describe("buildEmailShareBody", () => {
  it("carries strip_metadata on an emailed link too", () => {
    expect(buildEmailShareBody({ emails: ["a@b.com"], restrictToRecipients: false, stripMetadata: true }))
      .toMatchObject({ strip_metadata: true });
  });

  it("sends the recipient list and the public shape by default", () => {
    expect(buildEmailShareBody({ emails: ["a@b.com"], restrictToRecipients: false })).toEqual({
      emails: ["a@b.com"], message: "", restrict_to_recipients: false,
    });
  });

  it("sets restrict_to_recipients when asked", () => {
    expect(
      buildEmailShareBody({ emails: ["a@b.com"], restrictToRecipients: true }).restrict_to_recipients,
    ).toBe(true);
  });

  it("normalises and trims addresses", () => {
    expect(buildEmailShareBody({ emails: [" A@B.com "], restrictToRecipients: false }).emails)
      .toEqual(["a@b.com"]);
  });

  it("carries expiry on the email flow, which mobile previously never sent", () => {
    expect(
      buildEmailShareBody({ emails: ["a@b.com"], restrictToRecipients: false, expiresInDays: 30 }),
    ).toMatchObject({ expires_in_days: 30 });
  });

  it("throws rather than sending a share with no recipients", () => {
    expect(() => buildEmailShareBody({ emails: [], restrictToRecipients: false }))
      .toThrow(/recipient/i);
    expect(() => buildEmailShareBody({ emails: ["  "], restrictToRecipients: true }))
      .toThrow(/recipient/i);
  });

  // The server refuses the whole request on the first bad address without
  it("carries the view-only lock on the email flow too", () => {
    expect(buildEmailShareBody({ emails: ["a@b.com"], restrictToRecipients: true, lockMode: "view_only" }))
      .toMatchObject({ lock_mode: "view_only", restrict_to_recipients: true });
  });

  // saying which one. Naming it is the entire value of checking here.
  it("names the offending address rather than refusing the batch", () => {
    expect(() => buildEmailShareBody({
      emails: ["a@b.com", "not-an-email"],
      restrictToRecipients: false,
    })).toThrow('"not-an-email" is not a valid email address');
  });
});

describe("buildShareUpdateBody", () => {
  it("refuses a body that would change nothing", () => {
    expect(() => buildShareUpdateBody({})).toThrow("nothing to update");
  });

  it("sends only the field that changed, so an edit is never a full overwrite", () => {
    expect(buildShareUpdateBody({ lockMode: "view_only" })).toEqual({ lock_mode: "view_only" });
  });

  it("distinguishes removing a password from leaving it alone", () => {
    expect(buildShareUpdateBody({ password: null })).toEqual({ password: null });
    expect(buildShareUpdateBody({ lockMode: "none" })).not.toHaveProperty("password");
  });

  it("reads a blank password as a removal, not as a password of no characters", () => {
    expect(buildShareUpdateBody({ password: "   " })).toEqual({ password: null });
  });

  it("applies the shared 8-character floor before the round trip", () => {
    expect(() => buildShareUpdateBody({ password: "hunter2" }))
      .toThrow("Password must be at least 8 characters");
  });

  it("sends 0 for never, the same explicit spelling creation uses", () => {
    expect(buildShareUpdateBody({ expiresInDays: 0 })).toEqual({ expires_in_days: 0 });
  });

  it("sends an absolute expiry when the caller picked a date", () => {
    expect(buildShareUpdateBody({ expiresAt: 1893456000 })).toEqual({ expires_at: 1893456000 });
  });

  it("refuses an expiry past the global ceiling", () => {
    expect(() => buildShareUpdateBody({ expiresInDays: 3651 }))
      .toThrow("Expiry cannot be more than 3650 days from now");
  });

  it("normalises recipients and names the bad address rather than refusing the batch", () => {
    expect(buildShareUpdateBody({ recipientEmails: [" Dana@Northfield.co ", ""] }))
      .toEqual({ recipient_emails: ["dana@northfield.co"] });
    expect(() => buildShareUpdateBody({ recipientEmails: ["nope"] }))
      .toThrow('"nope" is not a valid email address');
  });

  it("sends an empty list when every recipient was removed", () => {
    expect(buildShareUpdateBody({ recipientEmails: [] })).toEqual({ recipient_emails: [] });
  });

  it("carries a multi-field edit in one body", () => {
    expect(buildShareUpdateBody({ expiresInDays: 7, lockMode: "view_only", accessMode: "public" }))
      .toEqual({ expires_in_days: 7, lock_mode: "view_only", access_mode: "public" });
  });
});
