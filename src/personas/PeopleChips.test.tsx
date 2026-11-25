// "In this photo": the people this phone's Personas found in one photo
// (engine.peopleInFile), as chips that open each persona. Nothing is asked of
// a server; off, locked, signed out or a failure show nothing.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { fakeHost, card } from "./device/__fixtures__/fake-host";
import { PeopleChips } from "./PeopleChips";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/api/config", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok" }));
jest.mock("./device/engine-host", () => require("./device/__fixtures__/fake-host"));

const BOX = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

beforeEach(() => {
  fakeHost.reset();
  mockPush.mockClear();
  fakeHost.engine.personas = [card("p1", "Alex"), card("p2", null)];
  fakeHost.engine.faces.set("f1", [
    { persona_id: "p1", name: "Alex", face_id: "a1", box: BOX },
    { persona_id: "p1", name: "Alex", face_id: "a2", box: BOX },
    { persona_id: "p2", name: null, face_id: "b1", box: BOX },
    { persona_id: null, name: null, face_id: "c1", box: BOX },
  ]);
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

it("shows one chip per shown persona in the photo, cropped from this photo, and a chip opens the persona", async () => {
  render(<PeopleChips wsId="w1" fileId="f1" />);
  await settle();
  expect(screen.getByText("In this photo")).toBeTruthy();
  expect(screen.getByTestId("people-chip-p1")).toBeTruthy();
  expect(screen.getByTestId("people-chip-p2").props.accessibilityLabel).toBe("Unnamed");
  expect(screen.queryAllByTestId(/^people-chip-/)).toHaveLength(2);
  const img = screen.UNSAFE_getAllByType("ExpoImageMock" as never)[0];
  expect((img.props as { source: { uri: string } }).source.uri).toBe("https://api.test/api/files/f1/thumb?w=256");
  expect(fakeHost.engine.peopleInFile).toHaveBeenCalledWith("f1");
  fireEvent.press(screen.getByTestId("people-chip-p1"));
  expect(mockPush).toHaveBeenCalledWith("/personas/p1");
});

it("shows nothing while Personas is not ready, and follows the index (a rename shows at once)", async () => {
  fakeHost.set({ status: { state: "needs_unlock" } });
  render(<PeopleChips wsId="w1" fileId="f1" />);
  await settle();
  expect(screen.queryByTestId("viewer-people")).toBeNull();
  await act(async () => { fakeHost.set({ status: { state: "ready", read: 1, total: 1, reading: false, paused: false } }); });
  await act(async () => { fakeHost.engine.changed(); });
  await settle();
  expect(screen.getByTestId("viewer-people")).toBeTruthy();
});

it("shows nothing when nobody in the photo belongs to a shown persona, or when the engine cannot be made", async () => {
  fakeHost.engine.faces.set("f2", [{ persona_id: null, name: null, face_id: "x", box: BOX }]);
  const { unmount } = render(<PeopleChips wsId="w1" fileId="f2" />);
  await settle();
  expect(screen.queryByTestId("viewer-people")).toBeNull();
  unmount();
  fakeHost.set({ engine: null });
  render(<PeopleChips wsId="w1" fileId="f1" />);
  await settle();
  expect(screen.queryByTestId("viewer-people")).toBeNull();
});

it("uses the caller's onOpen when given", async () => {
  const onOpen = jest.fn();
  render(<PeopleChips wsId="w1" fileId="f1" onOpen={onOpen} />);
  await settle();
  fireEvent.press(screen.getByTestId("people-chip-p1"));
  expect(onOpen).toHaveBeenCalledWith("p1");
  expect(mockPush).not.toHaveBeenCalled();
});
