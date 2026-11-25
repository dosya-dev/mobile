import { shouldPurgeOnSignOut } from "./sessionDrop";

/**
 * The purge used to be driven by the status flipping to signedOut, which
 * conflates two very different events: an account that is GONE, and an app
 * that merely could not read its own token store (a locked iOS keychain during
 * a background launch). The second leaves a live 60-day session on disk, so
 * purging there costs the user their backup ledger for nothing.
 */
describe("shouldPurgeOnSignOut", () => {
  it("purges when the user signed out on purpose", () => {
    expect(shouldPurgeOnSignOut({ reason: "explicit-sign-out", at: 1 })).toBe(true);
  });

  it("purges when the server actually rejected the credential", () => {
    expect(shouldPurgeOnSignOut({ reason: "server-rejected-refresh", at: 1 })).toBe(true);
  });

  it("does NOT purge when nothing recorded why the session ended", () => {
    expect(shouldPurgeOnSignOut(null)).toBe(false);
  });

  // Fail safe: a reason added later has to opt IN to destroying account data,
  // rather than inheriting a purge nobody considered.
  it("does NOT purge for a reason it does not recognise", () => {
    expect(shouldPurgeOnSignOut({ reason: "something-new" as never, at: 1 })).toBe(false);
  });
});
