import { act, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { SelectionMotionProvider, staggerDelay, useSelectionMotion, visibleRowsOf } from "./SelectionMotion";

describe("staggerDelay", () => {
  it.each([
    // row, col, first visible row, visible rows, delay
    [0, 0, 0, 10, 0],
    [0, 2, 0, 10, 28],
    [3, 1, 0, 10, 3 * 28 + 14],
    [5, 0, 4, 10, 28],
    // Out of view: above, below and exactly one past the window.
    [2, 0, 4, 10, 0],
    [14, 2, 4, 10, 0],
    [20, 0, 0, 10, 0],
    // Capped at 300 ms however deep the row.
    [12, 2, 0, 20, 300],
    [10, 2, 0, 11, 300],
  ])("row %i col %i, first %i of %i rows -> %i ms", (row, col, first, rows, ms) => {
    expect(staggerDelay(row, col, first, rows)).toBe(ms);
  });

  it("nothing is visible before the list reports: no delay", () => {
    expect(staggerDelay(0, 0, 0, 0)).toBe(0);
  });
});

describe("visibleRowsOf", () => {
  it("turns viewable item indexes into the first row and the row count", () => {
    expect(visibleRowsOf([{ index: 7 }, { index: 3 }, { index: 11 }], 3)).toEqual({ first: 1, count: 3 });
    expect(visibleRowsOf([{ index: 4 }, { index: 5 }], 1)).toEqual({ first: 4, count: 2 });
    expect(visibleRowsOf([], 3)).toEqual({ first: 0, count: 0 });
    expect(visibleRowsOf([{ index: null }], 3)).toEqual({ first: 0, count: 0 });
  });
});

describe("SelectionMotionProvider", () => {
  it("gives every consumer the same shared values, settled at the selecting state", () => {
    const seen: ReturnType<typeof useSelectionMotion>[] = [];
    function Probe() {
      seen.push(useSelectionMotion());
      return <Text>probe</Text>;
    }
    render(
      <SelectionMotionProvider selecting>
        <Probe />
        <Probe />
      </SelectionMotionProvider>,
    );
    expect(seen[0].progress).toBe(seen[1].progress);
    expect(seen[0].firstVisibleRow).toBe(seen[1].firstVisibleRow);
    expect(seen[0].progress.value).toBe(1);
    expect(seen[0].active.value).toBe(1);
  });
});

describe("checksMounted", () => {
  type Done = (finished: boolean) => void;
  const reanimated = jest.requireMock("react-native-reanimated") as { withTiming: unknown; useReducedMotion: unknown };
  const realTiming = reanimated.withTiming;
  const realReduced = reanimated.useReducedMotion;
  let pending: Done | null = null;
  beforeEach(() => {
    pending = null;
    // A timing that finishes only when the test says so.
    reanimated.withTiming = (to: number, _cfg: unknown, done?: Done) => { pending = done ?? null; return to; };
  });
  afterEach(() => {
    reanimated.withTiming = realTiming;
    reanimated.useReducedMotion = realReduced;
  });

  let last: ReturnType<typeof useSelectionMotion> | null = null;
  function Probe() {
    last = useSelectionMotion();
    return null;
  }
  const tree = (selecting: boolean) => <SelectionMotionProvider selecting={selecting}><Probe /></SelectionMotionProvider>;

  it("mounts the checks with selection and keeps them until the way-out fade finishes", () => {
    const view = render(tree(false));
    expect(last!.checksMounted).toBe(false);
    view.rerender(tree(true));
    expect(last!.checksMounted).toBe(true);
    view.rerender(tree(false));
    expect(last!.checksMounted).toBe(true);
    act(() => pending!(true));
    expect(last!.checksMounted).toBe(false);
  });

  it("a fade cut short by selecting again keeps them", () => {
    const view = render(tree(true));
    view.rerender(tree(false));
    const outDone = pending!;
    view.rerender(tree(true));
    act(() => outDone(false));
    expect(last!.checksMounted).toBe(true);
  });

  it("Reduce Motion: they go at once", () => {
    reanimated.useReducedMotion = () => true;
    const view = render(tree(true));
    view.rerender(tree(false));
    expect(last!.checksMounted).toBe(false);
  });
});
