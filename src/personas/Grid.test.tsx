// The grid: Named / Not named yet with counts, tiles open the persona,
// "Add a name" renames inline through the engine, "More coming" while reading.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { PersonasGrid } from "./Grid";
import { card } from "./device/__fixtures__/fake-host";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/api/config", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok" }));

const ALEX = card("p1", "Alex", { photo_count: 412 });
const SAM = card("p2", "Sam", { photo_count: 1 });
const G1 = card("g1", null, { photo_count: 3 });
const G2 = card("g2", null, { photo_count: 4 });

beforeEach(() => { mockPush.mockClear(); });
afterEach(async () => { await act(async () => {}); });

it("splits Named and Not named yet, with counts, and a tile opens the persona", () => {
  render(<PersonasGrid engine={{ rename: jest.fn() }} personas={[ALEX, SAM, G1, G2]} />);
  expect(screen.getByText("Named")).toBeTruthy();
  expect(screen.getByText("Not named yet")).toBeTruthy();
  expect(screen.getAllByText("2")).toHaveLength(2);
  expect(screen.getByText("412 photos")).toBeTruthy();
  expect(screen.getByText("Add a name to find them in search.")).toBeTruthy();
  expect(screen.getByText("A face needs to appear in at least 3 photos before it shows here.")).toBeTruthy();
  expect(screen.getByTestId("persona-tile-p1").props.accessibilityLabel).toBe("Alex, 412 photos");
  expect(screen.getByTestId("persona-tile-g1").props.accessibilityLabel).toBe("Unnamed, 3 photos");
  fireEvent.press(screen.getByTestId("persona-tile-p1"));
  expect(mockPush).toHaveBeenCalledWith("/personas/p1");
});

it("each face is a crop of its cover photo's thumbnail", () => {
  render(<PersonasGrid engine={{ rename: jest.fn() }} personas={[ALEX]} />);
  const img = screen.UNSAFE_getAllByType("ExpoImageMock" as never)[0];
  expect((img.props as { source: { uri: string } }).source.uri).toBe("https://api.test/api/files/file-p1/thumb?w=256");
});

it("Add a name opens the field and saves through the engine", async () => {
  const engine = { rename: jest.fn(async () => {}) };
  const onChanged = jest.fn();
  render(<PersonasGrid engine={engine} personas={[G1]} onChanged={onChanged} />);
  fireEvent.press(screen.getByTestId("persona-add-name-g1"));
  fireEvent.changeText(screen.getByTestId("persona-name-g1-input"), "Jordan");
  fireEvent.press(screen.getByTestId("persona-name-g1-save"));
  await act(async () => {});
  expect(engine.rename).toHaveBeenCalledWith("g1", "Jordan");
  expect(onChanged).toHaveBeenCalled();
  expect(screen.queryByTestId("persona-name-g1-input")).toBeNull();
});

it("a More coming tile closes the not-named section while reading, even with nobody yet", () => {
  render(<PersonasGrid engine={{ rename: jest.fn() }} personas={[]} reading />);
  expect(screen.getByTestId("personas-more-coming")).toBeTruthy();
  expect(screen.getByText("More coming")).toBeTruthy();
  expect(screen.queryByTestId("personas-named")).toBeNull();
});
