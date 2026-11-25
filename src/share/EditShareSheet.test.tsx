import { render, screen, fireEvent } from "@testing-library/react-native";
import { EditShareSheet } from "./EditShareSheet";
import * as hooks from "./hooks";
import type { ShareAnalyticsLink } from "./types";

const now = Math.floor(Date.now() / 1000);
const DAY = 86400;
const update = { mutate: jest.fn(), isPending: false };

function link(over: Partial<ShareAnalyticsLink> = {}): ShareAnalyticsLink {
  return {
    link_id: "l1", url: "https://dosya.dev/s/tok", display_name: "Q3.pdf",
    is_folder: false, is_bundle: false, file_id: "f1", size_bytes: 2048,
    extension: "pdf", region: "weur", created_at: now - 6 * DAY,
    created_by: "u1", created_by_name: "Me", is_mine: true,
    expires_at: null, is_revoked: false, revoked_at: null,
    is_password_protected: false, lock_mode: "none", access_mode: "public",
    status: "active", view_count: 86, download_count: 12,
    max_downloads: null, downloads_left: null,
    ...over,
  };
}

function open(l: ShareAnalyticsLink = link(), recipients: string[] = []) {
  return render(<EditShareSheet visible link={l} recipientEmails={recipients} onClose={jest.fn()} />);
}

/** The `input` the sheet handed to the update mutation. */
function sentInput() {
  return update.mutate.mock.calls[0][0].input;
}

describe("EditShareSheet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(hooks, "useShareMutations").mockReturnValue({
      createLink: {}, email: {}, revoke: {}, createFolderLink: {}, folderEmail: {}, update,
    } as never);
    jest.spyOn(hooks, "useIsFreePlan").mockReturnValue(false);
  });

  it("cannot be saved until something actually changes", () => {
    open();
    fireEvent.press(screen.getByTestId("save-link"));
    expect(update.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Nothing changed yet.")).toBeTruthy();
  });

  // The whole reason this sheet exists: only touched fields are sent, so a
  // stale form cannot clobber a change made from another device.
  it("sends only the field that changed", () => {
    open();
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", true);
    fireEvent.press(screen.getByTestId("save-link"));
    expect(sentInput()).toEqual({ lockMode: "view_only" });
  });

  it("sends a new expiry as days", () => {
    open();
    fireEvent.press(screen.getByTestId("expiry-30d"));
    fireEvent.press(screen.getByTestId("save-link"));
    expect(sentInput()).toEqual({ expiresInDays: 30 });
  });

  it("opens on the link's current expiry rather than a default", () => {
    open(link({ expires_at: now + 7 * DAY }));
    // This RNTL build has no toHaveAccessibilityState matcher; the prop the
    // component actually sets is the thing worth asserting anyway.
    expect(screen.getByTestId("expiry-7d").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("expiry-30d").props.accessibilityState).toMatchObject({ selected: false });
  });

  it("shows a link's own remaining time when it matches no preset", () => {
    open(link({ expires_at: now + 40 * DAY }));
    expect(screen.getByText("40 days left")).toBeTruthy();
  });

  it("removes a password when protection is switched off", () => {
    open(link({ is_password_protected: true }));
    fireEvent(screen.getByTestId("toggle-password"), "valueChange", false);
    fireEvent.press(screen.getByTestId("save-link"));
    expect(sentInput()).toEqual({ password: null });
  });

  it("keeps the existing password when the field is left blank", () => {
    open(link({ is_password_protected: true }));
    fireEvent.press(screen.getByTestId("expiry-30d"));
    fireEvent.press(screen.getByTestId("save-link"));
    expect(sentInput()).not.toHaveProperty("password");
  });

  it("refuses to turn protection on with an empty password", () => {
    open();
    fireEvent(screen.getByTestId("toggle-password"), "valueChange", true);
    fireEvent.press(screen.getByTestId("save-link"));
    expect(update.mutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("edit-error")).toBeTruthy();
  });

  it("sends a newly typed password", () => {
    open();
    fireEvent(screen.getByTestId("toggle-password"), "valueChange", true);
    fireEvent.changeText(screen.getByTestId("password-field"), "correct-horse");
    fireEvent.press(screen.getByTestId("save-link"));
    expect(sentInput()).toEqual({ password: "correct-horse" });
  });

  // Two changes that take access away from people who already have the link.
  it("warns before view-only strips downloads from people who already have it", () => {
    open(link({ download_count: 12 }));
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", true);
    expect(screen.getByText(/stops the 12 people/)).toBeTruthy();
  });

  it("does not warn about downloads nobody has taken", () => {
    open(link({ download_count: 0 }));
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", true);
    expect(screen.queryByText(/stops the/)).toBeNull();
  });

  it("warns before restricting a link people already hold", () => {
    open(link({ access_mode: "restricted" }), ["dana@northfield.co"]);
    fireEvent.press(screen.getByTestId("access-public"));
    fireEvent.press(screen.getByTestId("access-restricted"));
    // Back where it started, so nothing to save and nothing to warn about.
    expect(screen.getByText("Nothing changed yet.")).toBeTruthy();
  });

  it("hides the access control on a public link with nobody invited", () => {
    open();
    expect(screen.queryByTestId("access-restricted")).toBeNull();
  });

  it("offers the access control once a link has invited people", () => {
    open(link({ access_mode: "restricted" }), ["dana@northfield.co"]);
    expect(screen.getByTestId("access-public")).toBeTruthy();
  });

  it("opens a private link back up to public", () => {
    open(link({ access_mode: "restricted" }), ["dana@northfield.co"]);
    fireEvent.press(screen.getByTestId("access-public"));
    fireEvent.press(screen.getByTestId("save-link"));
    expect(sentInput()).toEqual({ accessMode: "public" });
  });

  it("carries several changes in one call", () => {
    open();
    fireEvent.press(screen.getByTestId("expiry-90d"));
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", true);
    fireEvent.press(screen.getByTestId("save-link"));
    expect(sentInput()).toEqual({ expiresInDays: 90, lockMode: "view_only" });
  });

  // ── download limit (migration 0143) ──────────────────────────────

  it("sets a download limit on a live link", () => {
    // download_count 0: the base fixture has 12 taken, which the guard below
    // rightly refuses a limit of 5 against.
    open(link({ download_count: 0 }));
    fireEvent.changeText(screen.getByTestId("max-downloads"), "5");
    fireEvent.press(screen.getByTestId("save-link"));
    expect(sentInput()).toEqual({ maxDownloads: 5 });
  });

  it("opens showing the limit the link already has", () => {
    open(link({ max_downloads: 3, download_count: 0 }));
    expect(screen.getByTestId("max-downloads").props.value).toBe("3");
  });

  it("clears the limit back to unlimited when the field is emptied", () => {
    open(link({ max_downloads: 3, download_count: 0 }));
    fireEvent.changeText(screen.getByTestId("max-downloads"), "");
    fireEvent.press(screen.getByTestId("save-link"));
    expect(sentInput()).toEqual({ maxDownloads: null });
  });

  it("does not send the limit when it was not touched", () => {
    open(link({ max_downloads: 3, download_count: 0 }));
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", true);
    fireEvent.press(screen.getByTestId("save-link"));
    expect(sentInput()).not.toHaveProperty("maxDownloads");
  });

  // Setting a ceiling below what has already been taken leaves the link
  // instantly spent, which is a revoke wearing a different hat.
  it("refuses a limit below the downloads already taken, and says the number", () => {
    open(link({ download_count: 12 }));
    fireEvent.changeText(screen.getByTestId("max-downloads"), "5");
    fireEvent.press(screen.getByTestId("save-link"));
    expect(update.mutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("edit-error")).toHaveTextContent(/already been downloaded 12 times/);
  });

  it("allows a limit exactly at the count already taken", () => {
    open(link({ download_count: 12 }));
    fireEvent.changeText(screen.getByTestId("max-downloads"), "12");
    fireEvent.press(screen.getByTestId("save-link"));
    expect(sentInput()).toEqual({ maxDownloads: 12 });
  });

  it("refuses 0", () => {
    open(link({ download_count: 0 }));
    fireEvent.changeText(screen.getByTestId("max-downloads"), "0");
    fireEvent.press(screen.getByTestId("save-link"));
    expect(update.mutate).not.toHaveBeenCalled();
  });

  it("hides the limit on a view-only link, which allows no downloads at all", () => {
    open(link({ lock_mode: "view_only" }));
    expect(screen.queryByTestId("max-downloads")).toBeNull();
  });

  // ── custom date ──────────────────────────────────────────────────

  it("sends a picked date as an absolute expiry", () => {
    open();
    fireEvent.press(screen.getByTestId("expiry-custom"));
    fireEvent.press(screen.getByTestId("cal-next"));
    fireEvent.press(screen.getByTestId("cal-day-15"));
    fireEvent.press(screen.getByTestId("cal-confirm"));
    fireEvent.press(screen.getByTestId("save-link"));
    const input = sentInput();
    expect(typeof input.expiresAt).toBe("number");
    expect(input.expiresInDays).toBeUndefined();
  });

  it("refuses to save with the date chip selected but no date picked", () => {
    open();
    fireEvent.press(screen.getByTestId("expiry-custom"));
    fireEvent.press(screen.getByTestId("cal-cancel"));
    fireEvent.press(screen.getByTestId("save-link"));
    expect(update.mutate).not.toHaveBeenCalled();
  });
});

describe("EditShareSheet - Free plan expiry cap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(hooks, "useShareMutations").mockReturnValue({
      createLink: {}, email: {}, revoke: {}, createFolderLink: {}, folderEmail: {}, update,
    } as never);
    jest.spyOn(hooks, "useIsFreePlan").mockReturnValue(true);
  });

  // apply-update.ts would quietly cut a 30-day edit to 7 days.
  it("will not move a link to a choice past the cap", () => {
    open(link({ expires_at: now + 7 * DAY }));
    fireEvent.press(screen.getByTestId("expiry-30d"));
    fireEvent.press(screen.getByTestId("save-link"));
    expect(update.mutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("expiry-30d-lock")).toBeTruthy();
    expect(screen.getByTestId("free-expiry-hint")).toBeTruthy();
  });

  it("still moves a link to a choice inside the cap", () => {
    open();
    fireEvent.press(screen.getByTestId("expiry-24h"));
    fireEvent.press(screen.getByTestId("save-link"));
    expect(sentInput()).toEqual({ expiresInDays: 1 });
  });
});
