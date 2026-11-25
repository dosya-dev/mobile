import { useShareIntentStore } from "./store";
import type { SharedFile } from "./types";

const pdf: SharedFile = {
  uri: "content://com.android.providers.downloads/document/42",
  name: "invoice-2026.pdf",
  size: 1400,
  mime: "application/pdf",
};
const photo: SharedFile = { uri: "content://media/external/images/1", name: "a.jpg", size: 10, mime: "image/jpeg" };

beforeEach(() => useShareIntentStore.setState({ pending: null }));

describe("share intent store", () => {
  it("holds files handed to it until they are taken", () => {
    useShareIntentStore.getState().receive([pdf]);
    expect(useShareIntentStore.getState().pending).toEqual([pdf]);
  });

  it("hands the files over exactly once", () => {
    useShareIntentStore.getState().receive([pdf]);

    expect(useShareIntentStore.getState().take()).toEqual([pdf]);
    // The screen that consumes a share re-renders freely, and the root layout's
    // effect re-runs on every auth transition. Both call take(). A second
    // non-null answer would push a duplicate destination picker and upload the
    // same file twice.
    expect(useShareIntentStore.getState().take()).toBeNull();
  });

  it("keeps a share that arrives while signed out, so signing in does not lose it", () => {
    // The whole reason this store exists. AuthGate redirects a signed-out user to
    // /(auth)/login; a share consumed at that moment would be routed away and
    // dropped silently - the user sees dosya.dev open on a login screen and their
    // file is simply gone.
    useShareIntentStore.getState().receive([pdf]);
    expect(useShareIntentStore.getState().pending).toEqual([pdf]);
    expect(useShareIntentStore.getState().take()).toEqual([pdf]);
  });

  it("replaces an untaken share rather than merging it", () => {
    // Sharing twice before the picker opens means the user changed their mind
    // about which file to send. Concatenating would upload the abandoned one too.
    useShareIntentStore.getState().receive([pdf]);
    useShareIntentStore.getState().receive([photo]);
    expect(useShareIntentStore.getState().take()).toEqual([photo]);
  });

  it("ignores an empty delivery", () => {
    // A share sheet can hand over text with no stream. Parking an empty array
    // would open a destination picker for nothing.
    useShareIntentStore.getState().receive([]);
    expect(useShareIntentStore.getState().pending).toBeNull();
  });

  it("drops a parked share on sign-out", () => {
    // Account-scoped: purgeAccountData clears everything belonging to the
    // previous user. A file parked by one account must not surface in the next
    // account's session.
    useShareIntentStore.getState().receive([pdf]);
    useShareIntentStore.getState().clear();
    expect(useShareIntentStore.getState().take()).toBeNull();
  });
});
