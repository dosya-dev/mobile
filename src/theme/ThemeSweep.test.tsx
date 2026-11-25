import { AccessibilityInfo } from "react-native";
import * as reanimated from "react-native-reanimated";
import { render, screen, act } from "@testing-library/react-native";
import { ThemeSweepOverlay, sweepTheme } from "./ThemeSweep";

// reanimated's jest mock runs withTiming callbacks immediately, so a sweep
// completes within the act() that starts it. That makes the mid-sweep state
// unobservable from outside - which is why the interesting assertions below
// are made from inside the apply callback, at the moment the theme swaps.
function mockReduceMotion(on: boolean) {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(on);
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockReturnValue({ remove: () => {} } as ReturnType<typeof AccessibilityInfo.addEventListener>);
}

/** Let the overlay's isReduceMotionEnabled() promise settle before sweeping. */
async function mountOverlay() {
  const view = render(<ThemeSweepOverlay />);
  await act(async () => {});
  return view;
}

/** The uncover phase starts inside a requestAnimationFrame, which the worklets
 *  mock schedules on a timer - so it lands after the act() that began the sweep. */
async function flushFrames() {
  await act(async () => { await new Promise((r) => setTimeout(r, 32)); });
}

afterEach(() => jest.restoreAllMocks());

it("applies instantly when no overlay is mounted", () => {
  const apply = jest.fn();
  sweepTheme("#000000", apply);
  expect(apply).toHaveBeenCalledTimes(1);
});

it("paints the destination colour and holds the swap while covering", async () => {
  mockReduceMotion(false);
  // Freeze the cover phase: withTiming jumps the value but never reports
  // completion, leaving the band on screen and the swap still pending.
  const stalled = jest
    .spyOn(reanimated, "withTiming")
    .mockImplementation(((to: number) => to) as unknown as typeof reanimated.withTiming);
  await mountOverlay();
  // Nothing is painted until a theme change asks for a sweep.
  expect(screen.queryByTestId("theme-sweep")).toBeNull();

  const apply = jest.fn();
  await act(async () => { sweepTheme("#02080e", apply); });

  const band = screen.getByTestId("theme-sweep");
  expect(band.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ backgroundColor: "#02080e" })]),
  );
  // The band wears the colour the app is about to, so the cover never flashes
  // the outgoing theme - and the swap waits until the screen is hidden.
  expect(apply).not.toHaveBeenCalled();
  stalled.mockRestore();
});

it("applies the theme and tears the band down once the sweep ends", async () => {
  mockReduceMotion(false);
  await mountOverlay();
  const apply = jest.fn();

  // The reanimated mock reports each phase complete immediately.
  await act(async () => { sweepTheme("#02080e", apply); });
  expect(apply).toHaveBeenCalledTimes(1);

  await flushFrames();
  expect(screen.queryByTestId("theme-sweep")).toBeNull();
});

it("skips the animation under Reduce Motion", async () => {
  mockReduceMotion(true);
  await mountOverlay();
  const apply = jest.fn();

  await act(async () => { sweepTheme("#ffffff", apply); });

  expect(apply).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("theme-sweep")).toBeNull();
});

it("falls back to an instant apply after the overlay unmounts", async () => {
  mockReduceMotion(false);
  const view = await mountOverlay();
  await act(async () => { view.unmount(); });

  const apply = jest.fn();
  sweepTheme("#ffffff", apply);
  expect(apply).toHaveBeenCalledTimes(1);
});
