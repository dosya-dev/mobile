// One persona from this phone's engine: header, photos by month (named and
// dated from the photo listing), the photo menu, rename, merge, Remove person
// with its "Are you sure?" and paging.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PersonaView, byMonth, toFileItem, toRows } from "./PersonaScreen";
import { finishSheetDismissal } from "@/ui/sheetTesting";
import { toast } from "@/ui/toast";
import { useViewerList } from "@/viewer/viewerStore";
import { card, fakeHost, photoRow, READY } from "./device/__fixtures__/fake-host";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/api/config", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok" }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/files/FileThumb", () => ({ FileThumb: () => null }));
jest.mock("./device/engine-host", () => require("./device/__fixtures__/fake-host"));

const mockToast = toast as jest.Mock;

// 2026-10-05 and 2026-09-20, local noon.
const OCT = Math.floor(new Date(2026, 9, 5, 12).getTime() / 1000);
const SEP = Math.floor(new Date(2026, 8, 20, 12).getTime() / 1000);
const BOX = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 };

beforeEach(() => {
  fakeHost.reset(READY);
  const e = fakeHost.engine;
  e.personas = [card("p1", "Alex", { photo_count: 4 }), card("p2", "Sam"), card("g1", null, { photo_count: 1 })];
  e.photos.set("p1", ["a", "b", "c", "d"].map((id) => ({ file_id: id, face_id: `face-${id}`, box: BOX })));
  e.photos.set("g1", [{ file_id: "a", face_id: "face-g", box: BOX }]);
  fakeHost.rows = new Map([
    ["a", photoRow("a", { taken_at: OCT })],
    ["b", photoRow("b", { taken_at: OCT })],
    ["c", photoRow("c", { taken_at: SEP })],
    ["d", photoRow("d", { taken_at: SEP, folder_id: null })],
  ]);
  mockToast.mockClear();
  Object.values(mockRouter).forEach((f) => f.mockClear());
  mockRouter.canGoBack.mockReturnValue(true);
  useViewerList.getState().clearViewerList();
});
afterEach(async () => { await act(async () => {}); });

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };

function Host({ pid = "p1" }: { pid?: string }) {
  // Re-renders on every engine change, as the screen's hook does.
  const { engine, status } = jest.requireMock("./device/engine-host").usePersonasEngine("w1");
  return <PersonaView wsId="w1" personaId={pid} engine={engine} status={status} />;
}

const mount = async (pid = "p1") => {
  render(<Host pid={pid} />);
  await screen.findByTestId(`persona-${pid}`);
  await settle();
};

it("shows the name, the count, Rename / Merge / Remove person and the photos by month", async () => {
  await mount();
  expect(screen.getByTestId("persona-title").props.children).toBe("Alex");
  expect(screen.getByText("4 photos")).toBeTruthy();
  expect(screen.getByText("Rename")).toBeTruthy();
  expect(screen.getByText("Merge")).toBeTruthy();
  expect(screen.getByText("Remove person")).toBeTruthy();
  expect(screen.getByText("October 2026")).toBeTruthy();
  expect(screen.getByText("September 2026")).toBeTruthy();
  expect(screen.getByTestId("persona-rename").props.accessibilityLabel).toBe("Rename Alex");
  expect(screen.getByTestId("persona-photo-a").props.accessibilityHint).toBe("Photo options");
  expect(screen.getByTestId("persona-cover-image").props.source.uri).toBe("https://api.test/api/files/file-p1/thumb?w=256");
});

it("leaves out a photo the listing no longer has (trashed, hidden or locked)", async () => {
  fakeHost.rows.delete("b");
  await mount();
  expect(screen.queryByTestId("persona-photo-b")).toBeNull();
  expect(screen.getByTestId("persona-photo-a")).toBeTruthy();
});

it("a long press opens the photo menu: Not Alex, Set as cover, Show in folder", async () => {
  await mount();
  fireEvent(screen.getByTestId("persona-photo-a"), "longPress");
  expect(await screen.findByText("Not Alex")).toBeTruthy();
  expect(screen.getByText("Set as cover")).toBeTruthy();
  expect(screen.getByText("Show in folder")).toBeTruthy();
});

it("Not Alex takes that face out of the persona through the engine", async () => {
  await mount();
  fireEvent(screen.getByTestId("persona-photo-a"), "longPress");
  fireEvent.press(await screen.findByText("Not Alex"));
  finishSheetDismissal();
  await settle();
  expect(fakeHost.engine.notThisPerson).toHaveBeenCalledWith("face-a");
  expect(screen.queryByTestId("persona-photo-a")).toBeNull();
});

it("Set as cover sets this photo's face as the cover; a failure says so", async () => {
  await mount();
  fireEvent(screen.getByTestId("persona-photo-c"), "longPress");
  fireEvent.press(await screen.findByText("Set as cover"));
  finishSheetDismissal();
  await settle();
  expect(fakeHost.engine.setCover).toHaveBeenCalledWith("p1", "face-c");
  fakeHost.engine.setCover.mockRejectedValueOnce(new Error("offline"));
  fireEvent(screen.getByTestId("persona-photo-c"), "longPress");
  fireEvent.press(await screen.findByText("Set as cover"));
  finishSheetDismissal();
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith("The persona could not be updated. Try again.", "error"));
});

it("Show in folder opens the photo's folder, or Files for a photo at the root", async () => {
  await mount();
  fireEvent(screen.getByTestId("persona-photo-a"), "longPress");
  fireEvent.press(await screen.findByText("Show in folder"));
  finishSheetDismissal();
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/folder/[id]", params: { id: "fold1" } });
  fireEvent(screen.getByTestId("persona-photo-d"), "longPress");
  fireEvent.press(await screen.findByText("Show in folder"));
  finishSheetDismissal();
  expect(mockRouter.push).toHaveBeenCalledWith("/");
});

it("a tap opens the photo in the viewer with this persona's photos as its neighbours", async () => {
  await mount();
  fireEvent.press(screen.getByTestId("persona-photo-b"));
  expect(mockRouter.push).toHaveBeenCalledWith("/file/b");
  const list = useViewerList.getState();
  expect(list.files.map((f) => f.id)).toEqual(["a", "b", "c", "d"]);
  expect(list.sourceName).toBe("Alex");
});

it('Remove person asks "Are you sure?" naming the person, then removes through the engine and leaves', async () => {
  await mount();
  fireEvent.press(screen.getByTestId("persona-remove"));
  expect(screen.getByText("Are you sure?")).toBeTruthy();
  expect(screen.getByTestId("persona-remove-name").props.children).toBe("Alex");
  expect(screen.getByTestId("persona-remove-statement")).toHaveTextContent("You are removing Alex. Their face data is deleted from all your devices.");
  fireEvent.press(screen.getByTestId("persona-remove-cancel"));
  expect(fakeHost.engine.removePersona).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId("persona-remove"));
  fireEvent.press(screen.getByTestId("persona-remove-confirm"));
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  expect(fakeHost.engine.removePersona).toHaveBeenCalledWith("p1");
});

it('an unnamed persona offers "Add a name" and "Not this person", and the plain remove statement', async () => {
  await mount("g1");
  expect(screen.getByTestId("persona-title").props.children).toBe("Unnamed");
  expect(screen.getByText("Add a name")).toBeTruthy();
  fireEvent(screen.getByTestId("persona-photo-a"), "longPress");
  expect(await screen.findByText("Not this person")).toBeTruthy();
  fireEvent.press(screen.getByTestId("persona-remove"));
  expect(screen.getByTestId("persona-remove-statement")).toHaveTextContent("You are removing this person. Their face data is deleted from all your devices.");
});

it("renames from the header through the engine", async () => {
  await mount();
  fireEvent.press(screen.getByTestId("persona-rename"));
  fireEvent.changeText(screen.getByTestId("persona-name-input"), "Alexandra");
  fireEvent.press(screen.getByTestId("persona-name-save"));
  await settle();
  expect(fakeHost.engine.rename).toHaveBeenCalledWith("p1", "Alexandra");
  expect(screen.getByTestId("persona-title").props.children).toBe("Alexandra");
});

it("a merge whose survivor is the other persona goes to its screen", async () => {
  fakeHost.engine.merge.mockImplementationOnce(async () => "p2");
  await mount();
  fireEvent.press(screen.getByTestId("persona-merge"));
  fireEvent.press(screen.getByTestId("merge-option-p2"));
  fireEvent.press(screen.getByTestId("merge-confirm"));
  await settle();
  expect(fakeHost.engine.merge).toHaveBeenCalledWith("p1", "p2");
  expect(mockRouter.replace).toHaveBeenCalledWith("/personas/p2");
});

it("loads the next page as the list nears its end", async () => {
  fakeHost.engine.photos.set("p1", Array.from({ length: 70 }, (_, i) => ({ file_id: `x${i}`, face_id: `fx${i}`, box: BOX })));
  fakeHost.rows = new Map(Array.from({ length: 70 }, (_, i) => [`x${i}`, photoRow(`x${i}`, { taken_at: OCT })]));
  await mount();
  expect(screen.queryByTestId("persona-photo-x65")).toBeNull();
  const list = screen.getByTestId("persona-list");
  await act(async () => { list.props.onEndReached(); });
  await settle();
  expect(fakeHost.engine.personaPhotos).toHaveBeenLastCalledWith("p1", null, 120);
});

it("says so when the persona is gone, and shows the empty line when it has no photos to show", async () => {
  await mount("p2");
  expect(screen.getByText("No photos of this person to show.")).toBeTruthy();
  render(<Host pid="nobody" />);
  expect(await screen.findByText("This persona is no longer here.")).toBeTruthy();
});

describe("helpers", () => {
  it("groups photos by month in the order given and lays them out three a row", () => {
    const rows = [photoRow("a", { taken_at: OCT }), photoRow("b", { taken_at: OCT }), photoRow("c", { taken_at: SEP })];
    const months = byMonth(rows.map((file) => ({ file, face_id: "f", box: BOX })));
    expect(months.map((m) => m.photos.length)).toEqual([2, 1]);
    expect(toRows(months).map((r) => r.type)).toEqual(["month", "photos", "month", "photos"]);
  });

  it("turns a listing row into a file row the viewer and the thumbnail accept", () => {
    const f = toFileItem(photoRow("a", { current_version: 3 }), "w1");
    expect(f).toMatchObject({ id: "a", name: "a.jpg", mime_type: "image/jpeg", current_version: 3, folder_id: "fold1", workspace_id: "w1", lock_mode: "none" });
  });
});
