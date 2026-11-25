import { Platform } from "react-native";
Platform.OS = "ios";

import TrackPlayer from "react-native-track-player";
import { installCarPlayBrowseScreen } from "./browseScreen";
import * as carplay from "react-native-carplay";
import * as bootstrap from "./bootstrap";
import * as browse from "./browse";
import * as recents from "./recents";
import * as controller from "@/player/controller";
import * as filesApi from "@/files/api";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { ApiError } from "@/api";

jest.mock("./bootstrap");
jest.mock("./browse");
jest.mock("./recents");
jest.mock("@/player/controller");
jest.mock("@/files/api");

const mockedCarplay = carplay as unknown as {
  __connect: Function;
  __reset: Function;
  __currentRoot: Function;
  __selectItem: Function;
  __stack: Function;
};

const folder = (id: string, name: string) => ({
  id, name, created_at: 0, lock_mode: "none", file_count: 1, is_synced: 0, is_hidden: 0, hidden_mode: "none",
});
const audio = (id: string, name: string) => ({
  id, name, size_bytes: 1, mime_type: "audio/mpeg", extension: "mp3", created_at: 0, updated_at: 0,
  current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
});

/** The connect handler's async work needs three microtask ticks to settle - see the comment in the 401 test. */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const rowsOf = (template: any) => template.config.sections.flatMap((s: any) => s.items);

describe("installCarPlayBrowseScreen", () => {
  beforeEach(() => {
    mockedCarplay.__reset();
    jest.clearAllMocks();
    (bootstrap.hydrateForCarPlay as jest.Mock).mockResolvedValue("signed-in");
    (recents.getCurrentPlayback as jest.Mock).mockResolvedValue(null);
    (recents.getRecent as jest.Mock).mockResolvedValue([]);
    (browse.listBrowseLevel as jest.Mock).mockResolvedValue({ folders: [], audioFiles: [] });
    (controller.playSingleFile as jest.Mock).mockResolvedValue(true);
    useWorkspaceStore.setState({ activeId: "ws1", hydrated: true } as any);
  });

  it("shows a sign-in row instead of browsing when there is no session", async () => {
    (bootstrap.hydrateForCarPlay as jest.Mock).mockResolvedValue("signed-out");
    installCarPlayBrowseScreen();
    await mockedCarplay.__connect();
    await Promise.resolve(); // let the connect handler's async work settle
    await Promise.resolve();

    const rows = rowsOf(mockedCarplay.__currentRoot());
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toMatch(/Open dosya on your iPhone/);
  });

  it("distinguishes a dead refresh token (401) from a network failure while browsing", async () => {
    (browse.listBrowseLevel as jest.Mock).mockRejectedValue(new ApiError("Unauthorized", 401));
    installCarPlayBrowseScreen();
    await mockedCarplay.__connect();
    // A 3rd tick: each Promise.all branch now has its own .catch() (task-5
    // review finding 1), and .catch() adds one more microtask hop before
    // Promise.all's slowest branch can settle - measured empirically via a
    // scratch tick-counting harness, not asserted from first principles.
    await settle();

    expect(rowsOf(mockedCarplay.__currentRoot())[0].text).toMatch(/Reconnect on your iPhone/);
  });

  it("shows a generic message for a non-auth failure while browsing", async () => {
    (browse.listBrowseLevel as jest.Mock).mockRejectedValue(new Error("network down"));
    installCarPlayBrowseScreen();
    await mockedCarplay.__connect();
    await settle();

    expect(rowsOf(mockedCarplay.__currentRoot())[0].text).toMatch(/Check your connection/);
  });

  it("still shows Continue Listening and Recently Played when only the folder listing fails", async () => {
    // Regression test for task-5 review finding 1: Promise.all([...]) with no
    // per-item .catch() rejects as a whole the instant any member rejects, so
    // a listBrowseLevel failure was wiping out current/recent even though they
    // had already resolved with real data. Each branch now catches its own
    // failure so a folder-listing error only produces one error row alongside
    // the still-present Continue Listening / Recently Played rows.
    (recents.getCurrentPlayback as jest.Mock).mockResolvedValue({
      workspaceId: "ws1",
      folderId: null,
      fileId: "cur1",
      title: "Currently Playing Episode",
      sourceName: "Personal",
      positionSeconds: 10,
      durationSeconds: 100,
      updatedAt: 0,
    });
    (recents.getRecent as jest.Mock).mockResolvedValue([
      { fileId: "r1", workspaceId: "ws1", folderId: null, title: "Recent Episode", sourceName: "Personal", updatedAt: 0 },
    ]);
    (browse.listBrowseLevel as jest.Mock).mockRejectedValue(new Error("network down"));

    installCarPlayBrowseScreen();
    await mockedCarplay.__connect();
    await settle();

    const rows = rowsOf(mockedCarplay.__currentRoot());
    expect(rows.some((r: any) => r.text === "Currently Playing Episode")).toBe(true);
    expect(rows.some((r: any) => r.text === "Recent Episode")).toBe(true);
    expect(rows.some((r: any) => /Check your connection/.test(r.text))).toBe(true);
  });

  it("renders folders and audio files for the workspace root, and playing a file calls playFileQueue", async () => {
    (browse.listBrowseLevel as jest.Mock).mockResolvedValue({
      folders: [folder("f1", "Podcasts")],
      audioFiles: [audio("a1", "The Daily.mp3")],
    });
    installCarPlayBrowseScreen();
    await mockedCarplay.__connect();
    await settle();

    const root = mockedCarplay.__currentRoot();
    const items = rowsOf(root);
    const fileIndex = items.findIndex((i: any) => i.text === "The Daily.mp3");
    expect(fileIndex).toBeGreaterThanOrEqual(0);

    await mockedCarplay.__selectItem(root, fileIndex);
    expect(controller.playFileQueue).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "a1" })]),
      "a1",
      // Files at the workspace root have no enclosing folder to name them by
      // (unlike a pushed folder level, which uses folder.name) - "Personal" is
      // the real default workspace name every account is auto-created with,
      // mirroring the phone app's fallback (see FileBrowser.tsx's sourceName:
      // last breadcrumb, else workspace name). Not "Podcasts" - that's just
      // this suite's stock fixture folder name, an unrelated sibling of the
      // file in this level's listing.
      "Personal",
    );
  });

  it("scopes Recently Played to the active workspace", async () => {
    installCarPlayBrowseScreen();
    await mockedCarplay.__connect();
    await settle();

    expect(recents.getRecent).toHaveBeenCalledWith("ws1");
  });

  describe("resuming a saved track", () => {
    // I2/I3: history rows carry no folder context (folderId is always null), so
    // the old playFolder(folderId: null) fetched the workspace ROOT listing,
    // never found startFileId in it, and played whatever sat first at the root.
    // getFile + playSingleFile always plays the right file instead.
    beforeEach(() => {
      (recents.getCurrentPlayback as jest.Mock).mockResolvedValue({
        workspaceId: "ws1",
        folderId: null,
        fileId: "cur1",
        title: "Episode 42",
        sourceName: "Podcasts",
        positionSeconds: 137,
        durationSeconds: 900,
        updatedAt: 0,
      });
      (recents.getRecent as jest.Mock).mockResolvedValue([
        { fileId: "r1", workspaceId: "ws1", folderId: null, title: "Older Episode", sourceName: "Audiobooks", updatedAt: 0 },
      ]);
    });

    it("Continue Listening fetches the exact file and seeks to the saved position", async () => {
      (filesApi.getFile as jest.Mock).mockResolvedValue(audio("cur1", "Episode 42.mp3"));
      installCarPlayBrowseScreen();
      await mockedCarplay.__connect();
      await settle();

      const root = mockedCarplay.__currentRoot();
      const index = rowsOf(root).findIndex((r: any) => r.text === "Episode 42");
      await mockedCarplay.__selectItem(root, index);

      expect(filesApi.getFile).toHaveBeenCalledWith("cur1");
      expect(controller.playSingleFile).toHaveBeenCalledWith(
        expect.objectContaining({ id: "cur1" }),
        "Podcasts",
      );
      expect(controller.playFolder).not.toHaveBeenCalled();
      expect(TrackPlayer.seekTo).toHaveBeenCalledWith(137);
    });

    it("Recently Played plays the exact file from the start, with no seek", async () => {
      (filesApi.getFile as jest.Mock).mockResolvedValue(audio("r1", "Older Episode.mp3"));
      installCarPlayBrowseScreen();
      await mockedCarplay.__connect();
      await settle();

      const root = mockedCarplay.__currentRoot();
      const index = rowsOf(root).findIndex((r: any) => r.text === "Older Episode");
      await mockedCarplay.__selectItem(root, index);

      expect(filesApi.getFile).toHaveBeenCalledWith("r1");
      expect(controller.playSingleFile).toHaveBeenCalledWith(
        expect.objectContaining({ id: "r1" }),
        "Audiobooks",
      );
      expect(controller.playFolder).not.toHaveBeenCalled();
      expect(TrackPlayer.seekTo).not.toHaveBeenCalled();
    });

    it("does not throw when the saved file is gone", async () => {
      (filesApi.getFile as jest.Mock).mockRejectedValue(new ApiError("Not found", 404));
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      installCarPlayBrowseScreen();
      await mockedCarplay.__connect();
      await settle();

      const root = mockedCarplay.__currentRoot();
      const index = rowsOf(root).findIndex((r: any) => r.text === "Episode 42");
      await expect(mockedCarplay.__selectItem(root, index)).resolves.toBeUndefined();
      expect(controller.playSingleFile).not.toHaveBeenCalled();
      expect(TrackPlayer.seekTo).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("template stack depth guard", () => {
    // I5: Apple caps the stack at 5 templates and pushTemplate is a void bridge
    // call, so a push past the cap fails with nothing observable from JS.
    beforeEach(() => {
      (browse.listBrowseLevel as jest.Mock).mockResolvedValue({
        folders: [folder("f1", "Level")],
        audioFiles: [],
      });
    });

    async function connectAndDescend(levels: number) {
      installCarPlayBrowseScreen();
      await mockedCarplay.__connect();
      await settle();
      let template = mockedCarplay.__currentRoot();
      for (let i = 0; i < levels; i++) {
        await mockedCarplay.__selectItem(template, 0);
        const stack = mockedCarplay.__stack();
        template = stack[stack.length - 1];
      }
      return template;
    }

    it("browses three folder levels below the root without complaint", async () => {
      const deepest = await connectAndDescend(3);
      expect(mockedCarplay.__stack()).toHaveLength(4);
      expect(rowsOf(deepest)[0].text).toBe("Level");
    });

    it("renders an explanatory row instead of pushing a fifth folder level", async () => {
      const deepest = await connectAndDescend(4);
      const rows = rowsOf(deepest);
      expect(rows).toHaveLength(1);
      expect(rows[0].text).toMatch(/Too many nested folders/);
      // Still inside Apple's 5-template limit, so the message itself is visible.
      expect(mockedCarplay.__stack()).toHaveLength(5);
    });

    it("frees a slot again once the driver backs out of a folder", async () => {
      const deepest = await connectAndDescend(3);
      // react-native-carplay fires onBackButtonPressed before popping; without
      // that hook the counter would be a one-way ratchet and every folder would
      // read "too deep" for the rest of the drive.
      deepest.config.onBackButtonPressed();
      const stack = mockedCarplay.__stack();
      await mockedCarplay.__selectItem(stack[stack.length - 2], 0);
      const next = mockedCarplay.__stack();
      expect(rowsOf(next[next.length - 1])[0].text).toBe("Level");
    });
  });
});
