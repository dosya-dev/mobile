// Defined inside the factory, not captured from an outer const: jest hoists
// jest.mock() above the imports, so an outer binding is still uninitialised when
// voice.ts requires this module and SiriSearch would come through as undefined.
jest.mock("../../modules/dosya-siri-search", () => ({
  SiriSearch: {
    addQueryListener: jest.fn(() => ({ remove: jest.fn() })),
    takePendingQuery: jest.fn(() => null),
  },
}));

import { resolveVoiceQuery, installVoiceSearch } from "./voice";
import * as search from "./search";
import * as controller from "@/player/controller";
import * as bootstrap from "./bootstrap";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { SiriSearch } from "../../modules/dosya-siri-search";

const mockSiriSearch = SiriSearch as unknown as {
  addQueryListener: jest.Mock;
  takePendingQuery: jest.Mock;
};

jest.mock("./search");
jest.mock("./bootstrap");
jest.mock("@/player/controller");

const audioFile = (id: string, name: string) => ({
  id, name, size_bytes: 1, mime_type: "audio/mpeg", extension: "mp3",
  created_at: 0, updated_at: 0, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
});

describe("resolveVoiceQuery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("plays the single matching file directly", async () => {
    (search.searchAudio as jest.Mock).mockResolvedValue({ folders: [], files: [audioFile("a1", "Nvidia Pt 2.mp3")] });
    const result = await resolveVoiceQuery("ws1", "nvidia");
    expect(result).toEqual({ kind: "played", fileId: "a1" });
    expect(controller.playFileQueue).toHaveBeenCalledWith([audioFile("a1", "Nvidia Pt 2.mp3")], "a1", "Search results");
  });

  it("reports ambiguous rather than guessing when multiple files match", async () => {
    (search.searchAudio as jest.Mock).mockResolvedValue({
      folders: [],
      files: [audioFile("a1", "Nvidia Pt 1.mp3"), audioFile("a2", "Nvidia Pt 2.mp3")],
    });
    const result = await resolveVoiceQuery("ws1", "nvidia");
    expect(result.kind).toBe("ambiguous");
    expect(controller.playFileQueue).not.toHaveBeenCalled();
  });

  it("reports no-match on an empty result", async () => {
    (search.searchAudio as jest.Mock).mockResolvedValue({ folders: [], files: [] });
    const result = await resolveVoiceQuery("ws1", "gibberish");
    expect(result).toEqual({ kind: "no-match" });
  });
});

describe("installVoiceSearch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSiriSearch.takePendingQuery.mockReturnValue(null);
    (search.searchAudio as jest.Mock).mockResolvedValue({ folders: [], files: [audioFile("a1", "Nvidia Pt 2.mp3")] });
    // The cold-launch state this whole path exists for: nothing has mounted the
    // phone app's Files tab and no CarPlay scene has connected, so the workspace
    // store is still at its initial activeId: null until hydration runs.
    useWorkspaceStore.setState({ activeId: null, hydrated: false } as never);
    (bootstrap.hydrateForCarPlay as jest.Mock).mockImplementation(async () => {
      useWorkspaceStore.setState({ activeId: "ws1", hydrated: true } as never);
      return "signed-in";
    });
  });

  it("hydrates before reading the active workspace on a Siri cold launch", async () => {
    mockSiriSearch.takePendingQuery.mockReturnValue("nvidia");

    installVoiceSearch();
    await new Promise(process.nextTick);

    expect(bootstrap.hydrateForCarPlay).toHaveBeenCalled();
    expect(search.searchAudio).toHaveBeenCalledWith("ws1", "nvidia");
    expect(controller.playFileQueue).toHaveBeenCalled();
  });

  it("hydrates for a query delivered to the already-running app too", async () => {
    installVoiceSearch();
    const listener = mockSiriSearch.addQueryListener.mock.calls[0][0] as unknown as (q: string) => void;
    listener("nvidia");
    await new Promise(process.nextTick);

    expect(bootstrap.hydrateForCarPlay).toHaveBeenCalled();
    expect(search.searchAudio).toHaveBeenCalledWith("ws1", "nvidia");
  });

  it("does nothing when there is no session to hydrate", async () => {
    (bootstrap.hydrateForCarPlay as jest.Mock).mockResolvedValue("signed-out");
    mockSiriSearch.takePendingQuery.mockReturnValue("nvidia");

    installVoiceSearch();
    await new Promise(process.nextTick);

    expect(search.searchAudio).not.toHaveBeenCalled();
  });

  it("ignores an empty pending query without hydrating", async () => {
    mockSiriSearch.takePendingQuery.mockReturnValue("");

    installVoiceSearch();
    await new Promise(process.nextTick);

    expect(bootstrap.hydrateForCarPlay).not.toHaveBeenCalled();
    expect(search.searchAudio).not.toHaveBeenCalled();
  });
});
