import { mapActionPath } from "./actionPath";

describe("mapActionPath", () => {
  it("rejects absent, relative and protocol-relative paths", () => {
    expect(mapActionPath(null)).toBeNull();
    expect(mapActionPath(undefined)).toBeNull();
    expect(mapActionPath("")).toBeNull();
    expect(mapActionPath("files/a")).toBeNull();
    expect(mapActionPath("//evil.example.com")).toBeNull();
    expect(mapActionPath("https://evil.example.com")).toBeNull();
  });

  it("maps a single file onto mobile's singular file route", () => {
    expect(mapActionPath("/files/abc")).toBe("/file/abc");
    expect(mapActionPath("/files/abc/")).toBe("/file/abc");
  });

  it("maps a support reply onto the live chat screen", () => {
    expect(mapActionPath("/support/chat")).toBe("/support-chat");
    expect(mapActionPath("/support/chat/")).toBe("/support-chat");
  });

  it("maps the web surfaces mobile has equivalents for", () => {
    expect(mapActionPath("/files")).toBe("/(tabs)/(files)");
    expect(mapActionPath("/shared")).toBe("/shares");
    expect(mapActionPath("/teams")).toBe("/teams");
    expect(mapActionPath("/workspaces")).toBe("/workspaces");
    expect(mapActionPath("/profile")).toBe("/profile");
    expect(mapActionPath("/notifications")).toBe("/notifications");
  });

  it("maps the Vault onto the screen inside the Files tab", () => {
    // Mobile grew a Vault; the web link is "/vault" and the mobile route lives
    // inside the Files tab's stack.
    expect(mapActionPath("/vault")).toBe("/vault");
    expect(mapActionPath("/vault/")).toBe("/vault");
    // Only the surface itself: a link into one Space is not something mobile
    // can resolve, so it stays hidden rather than opening the wrong thing.
    expect(mapActionPath("/vault/ws-1")).toBeNull();
  });

  it("returns null for surfaces mobile does not have, so the action is hidden", () => {
    expect(mapActionPath("/billing")).toBeNull();
    expect(mapActionPath("/duplicates")).toBeNull();
    expect(mapActionPath("/uploads")).toBeNull();
    expect(mapActionPath("/integrations")).toBeNull();
  });

  it("does not route /activity to the inbox, which is a different feed", () => {
    expect(mapActionPath("/activity")).toBeNull();
  });

  it("does not mistake a nested path for a file id", () => {
    expect(mapActionPath("/files/a/b")).toBeNull();
  });
});
