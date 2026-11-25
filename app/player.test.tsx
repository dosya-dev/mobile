import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PlayerScreen from "./player";
import { usePlayerStore } from "@/player/playerStore";
import { useMetadataStore } from "@/player/metadata/metadataStore";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { cycleRepeat, jumpTo, next, previous, togglePlay, toggleShuffle } from "@/player/controller";
import { ThemeProvider } from "@/theme/ThemeProvider";
import type { PlayerTrack } from "@/player/types";

jest.mock("@/player/controller", () => ({
  togglePlay: jest.fn(async () => {}), next: jest.fn(async () => {}), previous: jest.fn(async () => {}),
  jumpTo: jest.fn(async () => {}), toggleShuffle: jest.fn(async () => {}), cycleRepeat: jest.fn(async () => {}),
}));
jest.mock("@/files/api", () => ({ getFavourites: jest.fn(async () => ({ files: [{ id: "a" }], folders: [] })) }));
jest.mock("@/files/mutations", () => ({ addFavourite: jest.fn(async () => ({})), removeFavourite: jest.fn(async () => ({})) }));
jest.mock("@/groups/AddToGroupSheet", () => ({ AddToGroupSheet: () => null }));
const mockPush = jest.fn();
const mockBack = jest.fn();
// Module-scoped singleton, not a per-call object literal: this mirrors the real
// expo-router behavior (useRouter() returns a module-level singleton), so tests
// catch a real bug in player.tsx rather than one manufactured by an unstable mock.
const mockRouterObj = { push: mockPush, back: mockBack };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouterObj,
}));

const t = (fileId: string, title: string): PlayerTrack => ({ fileId, title, artist: "Road trip", extension: "mp3", sizeBytes: 1, modifiedAt: 1 });
const renderIt = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0}, mutations: { gcTime: 0 } } });
  return render(<ThemeProvider><QueryClientProvider client={qc}><PlayerScreen /></QueryClientProvider></ThemeProvider>);
};

beforeEach(() => {
  usePlayerStore.getState().clear();
  useMetadataStore.getState()._resetForTests();
  useWorkspaceStore.setState({ activeId: "w1" });
  jest.clearAllMocks();
});

describe("PlayerScreen", () => {
  it("shows an empty state when nothing is queued", () => {
    const { getByText } = renderIt();
    expect(getByText("Nothing playing.")).toBeTruthy();
  });

  it("renders track metadata and wires every control", () => {
    usePlayerStore.getState().setQueue([t("a", "first"), t("b", "second")], 0, "Road trip");
    const { getByTestId, getAllByText } = renderIt();
    expect(getAllByText("first").length).toBeGreaterThan(0);
    fireEvent.press(getByTestId("player-toggle"));
    expect(togglePlay).toHaveBeenCalled();
    fireEvent.press(getByTestId("player-next"));
    expect(next).toHaveBeenCalled();
    fireEvent.press(getByTestId("player-previous"));
    expect(previous).toHaveBeenCalled();
    fireEvent.press(getByTestId("player-shuffle"));
    expect(toggleShuffle).toHaveBeenCalled();
    fireEvent.press(getByTestId("player-repeat"));
    expect(cycleRepeat).toHaveBeenCalled();
  });

  it("jump-plays a queue row", () => {
    usePlayerStore.getState().setQueue([t("a", "first"), t("b", "second")], 0, "Road trip");
    const { getByTestId } = renderIt();
    fireEvent.press(getByTestId("queue-item-b"));
    expect(jumpTo).toHaveBeenCalledWith(1);
  });

  it("renders a circular back button that goes back", () => {
    usePlayerStore.getState().setQueue([t("a", "first")], 0, "Road trip");
    const { getByTestId } = renderIt();
    fireEvent.press(getByTestId("player-back"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("shows the back button in the empty state too", () => {
    const { getByTestId } = renderIt();
    expect(getByTestId("player-back")).toBeTruthy();
  });

  it("actions row: filled heart for a favourited track, toggle calls removeFavourite", async () => {
    const { removeFavourite } = jest.requireMock("@/files/mutations");
    usePlayerStore.getState().setQueue([t("a", "first")], 0, "Road trip");
    const { getByTestId, getByLabelText } = renderIt();
    // Wait for the favourites list, not just for the control to exist: the
    // press now decides add-vs-remove from the state the user can SEE, so
    // pressing while the list is still loading would (correctly) mean "add".
    await waitFor(() => expect(getByLabelText("Remove favourite")).toBeTruthy());
    fireEvent.press(getByTestId("player-fav"));
    await waitFor(() => expect(removeFavourite).toHaveBeenCalledWith(expect.any(String), { fileId: "a" }));
  });

  it("the heart flips the moment it is pressed, before the request answers", async () => {
    const { removeFavourite } = jest.requireMock("@/files/mutations");
    // Held open so the assertion lands while the DELETE is still unanswered -
    // the window in which the star used to sit there unchanged.
    let release!: () => void;
    (removeFavourite as jest.Mock).mockImplementationOnce(
      () => new Promise((r) => { release = () => r({ ok: true }); }),
    );
    usePlayerStore.getState().setQueue([t("a", "first")], 0, "Road trip");
    const { getByTestId, getByLabelText } = renderIt();
    await waitFor(() => expect(getByLabelText("Remove favourite")).toBeTruthy());
    fireEvent.press(getByTestId("player-fav"));
    expect(getByLabelText("Add favourite")).toBeTruthy();
    await waitFor(() => expect(release).toBeDefined());
    await act(async () => { release(); });
  });

  it("info button opens the info sheet", async () => {
    usePlayerStore.getState().setQueue([t("a", "first")], 0, "Road trip");
    const { getByTestId, queryByTestId } = renderIt();
    expect(queryByTestId("info-sheet")).toBeNull();
    fireEvent.press(getByTestId("player-info"));
    await waitFor(() => expect(getByTestId("info-sheet")).toBeTruthy());
  });

  it("prefers extracted tag title/artist over filename", () => {
    useMetadataStore.getState().upsert({ fileId: "a", title: "Tag Title", artist: "Tag Artist", sizeBytes: 1, modifiedAt: 1 });
    usePlayerStore.getState().setQueue([t("a", "first")], 0, "Road trip");
    const { getAllByText } = renderIt();
    expect(getAllByText("Tag Title").length).toBeGreaterThan(0);
  });

  it("queue rows show numbers and known durations; header shows track count", () => {
    useMetadataStore.getState().upsert({ fileId: "a", durationSec: 185, sizeBytes: 1, modifiedAt: 1 });
    usePlayerStore.getState().setQueue([t("a", "first"), t("b", "second")], 0, "Road trip");
    const { getByText, getByTestId } = renderIt();
    expect(getByText("1")).toBeTruthy();
    expect(getByText("2")).toBeTruthy();
    expect(getByText("3:05")).toBeTruthy();
    // Scoped to the row: SeekBar's own remaining-time label also reads "--:--"
    // (duration 0 in the mock), so an unscoped getByText would match both.
    expect(within(getByTestId("queue-item-b")).getByText("--:--")).toBeTruthy();
    expect(getByTestId("queue-header")).toHaveTextContent("2 tracks");
  });
});
