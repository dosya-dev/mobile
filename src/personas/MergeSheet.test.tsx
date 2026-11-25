// The merge sheet: the other personas from the engine, the picked one merged
// into the target through the engine, the copy for named and unnamed targets.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { MergeSheet } from "./MergeSheet";
import { SHEET_DISMISS_DY } from "@/ui/SheetHandle";
import { dragSheetHandle } from "@/ui/sheetTesting";
import { card } from "./device/__fixtures__/fake-host";

jest.mock("@/api/config", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok" }));

const ALEX = card("p1", "Alex", { photo_count: 412 });
const SAM = card("p2", "Sam", { photo_count: 30 });
const NOBODY = card("p3", null);

const engineOf = (list: typeof ALEX[], merge: () => Promise<string> = async () => "p1") => ({ listPersonas: jest.fn(() => list), merge: jest.fn(merge) });

afterEach(async () => { await act(async () => {}); });

it("names the target, says it keeps its name and cover, and lists the other personas", () => {
  render(<MergeSheet visible engine={engineOf([ALEX, SAM, NOBODY])} target={ALEX} onClose={jest.fn()} onMerged={jest.fn()} />);
  expect(screen.getByText("Merge with Alex")).toBeTruthy();
  expect(screen.getByText("Pick the persona that is also Alex. Its photos move to Alex and Alex keeps the name and cover.")).toBeTruthy();
  expect(screen.getByTestId("merge-option-p2")).toBeTruthy();
  expect(screen.getByTestId("merge-option-p3")).toBeTruthy();
  expect(screen.queryByTestId("merge-option-p1")).toBeNull();
  expect(screen.getByText("Unnamed")).toBeTruthy();
  expect(screen.getByText("30 photos")).toBeTruthy();
});

it("merges the picked persona into the target and reports the survivor", async () => {
  const engine = engineOf([ALEX, SAM], async () => "p2");
  const onMerged = jest.fn();
  render(<MergeSheet visible engine={engine} target={ALEX} onClose={jest.fn()} onMerged={onMerged} />);
  expect(screen.getByTestId("merge-confirm").props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  fireEvent.press(screen.getByTestId("merge-option-p2"));
  fireEvent.press(screen.getByTestId("merge-confirm"));
  await act(async () => {});
  expect(engine.merge).toHaveBeenCalledWith("p1", "p2");
  expect(onMerged).toHaveBeenCalledWith("p2");
});

it("for an unnamed target, says a named pick keeps its name, and the button reads Merge", () => {
  render(<MergeSheet visible engine={engineOf([NOBODY, ALEX])} target={NOBODY} onClose={jest.fn()} onMerged={jest.fn()} />);
  expect(screen.getByText("Merge with this persona")).toBeTruthy();
  expect(screen.getByText("Pick the persona that is also this person. If the one you pick has a name, it keeps the name and cover.")).toBeTruthy();
  expect(screen.getByText("Merge")).toBeTruthy();
});

it("says so when there is nobody else to merge, and when the merge fails", async () => {
  const { unmount } = render(<MergeSheet visible engine={engineOf([ALEX])} target={ALEX} onClose={jest.fn()} onMerged={jest.fn()} />);
  expect(screen.getByTestId("merge-empty")).toBeTruthy();
  unmount();
  render(<MergeSheet visible engine={engineOf([ALEX, SAM], async () => { throw new Error("offline"); })} target={ALEX} onClose={jest.fn()} onMerged={jest.fn()} />);
  fireEvent.press(screen.getByTestId("merge-option-p2"));
  fireEvent.press(screen.getByTestId("merge-confirm"));
  expect(await screen.findByTestId("merge-failed")).toBeTruthy();
});

it("Cancel, the backdrop and a swipe down close it, but not while a merge runs", async () => {
  const onClose = jest.fn();
  let finish: (v: string) => void = () => {};
  render(<MergeSheet visible engine={engineOf([ALEX, SAM], () => new Promise((r) => { finish = r; }))} target={ALEX} onClose={onClose} onMerged={jest.fn()} />);
  fireEvent.press(screen.getByTestId("merge-cancel"));
  fireEvent.press(screen.getByTestId("merge-sheet-backdrop"));
  expect(dragSheetHandle(screen.getByTestId("merge-sheet-handle"), 0, SHEET_DISMISS_DY + 20)).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(3);
  fireEvent.press(screen.getByTestId("merge-option-p2"));
  fireEvent.press(screen.getByTestId("merge-confirm"));
  dragSheetHandle(screen.getByTestId("merge-sheet-handle"), 0, 100);
  expect(onClose).toHaveBeenCalledTimes(3);
  await act(async () => { finish("p1"); });
});
