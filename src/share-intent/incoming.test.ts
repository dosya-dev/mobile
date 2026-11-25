jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  getInfoAsync: jest.fn(async () => ({ exists: true, isDirectory: false, size: 2048 })),
  deleteAsync: jest.fn(async () => {}),
}));

import * as FS from "expo-file-system/legacy";
import { describeIncomingFile, discardSharedFiles, routeIncomingUrl } from "./incoming";
import { useShareIntentStore } from "./store";

const INBOX = "file:///private/var/mobile/Containers/Data/Application/ABC/Documents/Inbox/";

beforeEach(() => {
  jest.clearAllMocks();
  (FS.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, isDirectory: false, size: 2048 });
  useShareIntentStore.setState({ pending: null });
});

describe("describeIncomingFile", () => {
  it("decodes the filename iOS put in the URL and derives the mime from its extension", async () => {
    // iOS hands over a percent-encoded file URL. The user shared "Q3 Report.pdf"
    // and that is what must reach their file list, not "Q3%20Report.pdf".
    const file = await describeIncomingFile(`${INBOX}Q3%20Report.pdf`);
    expect(file).toEqual({
      uri: `${INBOX}Q3%20Report.pdf`,
      name: "Q3 Report.pdf",
      size: 2048,
      mime: "application/pdf",
    });
  });

  it("knows spreadsheets", async () => {
    // The report that started this: Excel files. The server picks its icon and
    // preview from the extension, but the upload path still sends a mime.
    const xlsx = await describeIncomingFile(`${INBOX}budget.xlsx`);
    expect(xlsx?.mime).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const xls = await describeIncomingFile(`${INBOX}old.XLS`);
    expect(xls?.mime).toBe("application/vnd.ms-excel");
  });

  it("falls back to a generic mime for an unknown extension", async () => {
    const file = await describeIncomingFile(`${INBOX}data.xyz123`);
    expect(file?.mime).toBe("application/octet-stream");
    expect(file?.name).toBe("data.xyz123");
  });

  it("reads the real size from disk", async () => {
    (FS.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, isDirectory: false, size: 777 });
    const file = await describeIncomingFile(`${INBOX}a.pdf`);
    expect(file?.size).toBe(777);
  });

  it("rejects a directory", async () => {
    // A package or folder cannot be uploaded; parking it would open a picker
    // for something the copy step can only fail on.
    (FS.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, isDirectory: true });
    expect(await describeIncomingFile(`${INBOX}Bundle.pages`)).toBeNull();
  });

  it("rejects a file that is not there", async () => {
    (FS.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });
    expect(await describeIncomingFile(`${INBOX}gone.pdf`)).toBeNull();
  });

  it("rejects anything that is not a file URL", async () => {
    expect(await describeIncomingFile("dosya://auth/callback?code=1")).toBeNull();
    expect(await describeIncomingFile("https://dosya.dev/s/abc")).toBeNull();
    expect(await describeIncomingFile("content://downloads/42")).toBeNull();
    expect(FS.getInfoAsync).not.toHaveBeenCalled();
  });
});

describe("routeIncomingUrl", () => {
  it("passes every non-file URL through untouched", async () => {
    // OAuth callbacks, share links and universal links must keep routing
    // exactly as before. Returning anything else here breaks sign-in.
    expect(await routeIncomingUrl("dosya://auth/callback?code=1&state=2", "ios")).toBe(
      "dosya://auth/callback?code=1&state=2",
    );
    expect(await routeIncomingUrl("https://dosya.dev/s/abc", "android")).toBe("https://dosya.dev/s/abc");
    // The dosya TV app's QR code: expo-router turns it into app/tv.tsx with ?code=.
    expect(await routeIncomingUrl("https://app.dosya.dev/tv?code=KDTR-9WMX", "ios")).toBe("https://app.dosya.dev/tv?code=KDTR-9WMX");
    expect(useShareIntentStore.getState().pending).toBeNull();
  });

  it("on iOS parks the opened file for the picker and keeps it out of the router", async () => {
    // Returning null is what stops expo-router from treating
    // file:///.../Inbox/x.pdf as a route and rendering "Unmatched Route" over
    // the app. The picker is opened by useShareIntentRouting off the store.
    const result = await routeIncomingUrl(`${INBOX}invoice.pdf`, "ios");
    expect(result).toBeNull();
    expect(useShareIntentStore.getState().pending).toEqual([
      expect.objectContaining({ uri: `${INBOX}invoice.pdf`, name: "invoice.pdf", mime: "application/pdf" }),
    ]);
  });

  it("on Android keeps content:// and file:// launch URLs out of the router without parking them", async () => {
    // The native module (modules/dosya-share-intent) already delivers these
    // with their real display name and size; parking here too would open the
    // picker twice. But the URL must still be swallowed: "Open with" launches
    // the activity with the content:// URI as intent data, and RN's Linking
    // reports it as the initial URL - which expo-router would otherwise route.
    expect(await routeIncomingUrl("content://com.android.providers.downloads/document/42", "android")).toBeNull();
    expect(await routeIncomingUrl("file:///sdcard/Download/a.pdf", "android")).toBeNull();
    expect(useShareIntentStore.getState().pending).toBeNull();
    expect(FS.getInfoAsync).not.toHaveBeenCalled();
  });

  it("does not park the same URL twice", async () => {
    // iOS can surface one open through both the initial-URL read and the url
    // event. Two deliveries would mean two picker pushes for one file.
    await routeIncomingUrl(`${INBOX}once.pdf`, "ios");
    useShareIntentStore.getState().take();
    expect(await routeIncomingUrl(`${INBOX}once.pdf`, "ios")).toBeNull();
    expect(useShareIntentStore.getState().pending).toBeNull();
  });

  it("parks the same path again once the repeat window has passed", async () => {
    // The Inbox original is deleted after saving, so opening the same document
    // again later lands on the identical path. A permanent "seen" set would
    // silently drop every second open of a file.
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    await routeIncomingUrl(`${INBOX}again.pdf`, "ios");
    useShareIntentStore.getState().take();
    now.mockReturnValue(1_000_000 + 60_000);
    await routeIncomingUrl(`${INBOX}again.pdf`, "ios");
    expect(useShareIntentStore.getState().pending).toHaveLength(1);
    now.mockRestore();
  });

  it("swallows a file URL it cannot describe instead of routing it", async () => {
    (FS.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });
    expect(await routeIncomingUrl(`${INBOX}gone.pdf`, "ios")).toBeNull();
    expect(useShareIntentStore.getState().pending).toBeNull();
  });

  it("never throws, even when the filesystem does", async () => {
    // expo-router documents that a throw from redirectSystemPath can crash
    // the app. A stat failure must degrade to "nothing to save", not a crash.
    (FS.getInfoAsync as jest.Mock).mockRejectedValue(new Error("EIO"));
    await expect(routeIncomingUrl(`${INBOX}bad.pdf`, "ios")).resolves.toBeNull();
  });
});

describe("discardSharedFiles", () => {
  it("deletes originals iOS placed in Documents/Inbox", async () => {
    // Apple leaves Inbox cleanup to the app. Without this every file a user
    // ever opened with dosya.dev stays in the sandbox forever.
    await discardSharedFiles([{ uri: `${INBOX}a.pdf`, name: "a.pdf", size: 1, mime: "application/pdf" }]);
    expect(FS.deleteAsync).toHaveBeenCalledWith(`${INBOX}a.pdf`, { idempotent: true });
  });

  it("leaves everything that is not an Inbox file alone", async () => {
    // A content:// URI is a borrowed handle into another app's provider, and
    // a cache copy belongs to the upload queue. Neither is ours to delete here.
    await discardSharedFiles([
      { uri: "content://downloads/42", name: "a.pdf", size: 1, mime: "application/pdf" },
      { uri: "file:///cache/upload-share-1.pdf", name: "a.pdf", size: 1, mime: "application/pdf" },
    ]);
    expect(FS.deleteAsync).not.toHaveBeenCalled();
  });

  it("keeps going when one delete fails", async () => {
    (FS.deleteAsync as jest.Mock).mockRejectedValueOnce(new Error("EPERM"));
    await expect(
      discardSharedFiles([
        { uri: `${INBOX}a.pdf`, name: "a.pdf", size: 1, mime: "application/pdf" },
        { uri: `${INBOX}b.pdf`, name: "b.pdf", size: 1, mime: "application/pdf" },
      ]),
    ).resolves.toBeUndefined();
    expect(FS.deleteAsync).toHaveBeenCalledTimes(2);
  });
});
