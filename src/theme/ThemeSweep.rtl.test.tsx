import { AccessibilityInfo, Dimensions } from "react-native";
import * as reanimated from "react-native-reanimated";
import { act, render } from "@testing-library/react-native";
import { __setLayoutRtlForTests } from "@/lib/direction";
import { ThemeSweepOverlay, sweepTheme } from "./ThemeSweep";

// The band enters from the start edge and leaves by the end edge, so in RTL it
// crosses right to left: it starts at +width and exits to -width.

/** Every value written to the band's translateX shared value, in order. */
function recordSharedValue(): number[] {
  const writes: number[] = [];
  let current = 0;
  const shared = {
    get value() { return current; },
    set value(v: number) { current = v; writes.push(v); },
  };
  jest.spyOn(reanimated, "useSharedValue").mockImplementation((() => shared) as never);
  return writes;
}

async function sweep() {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockReturnValue({ remove: () => {} } as ReturnType<typeof AccessibilityInfo.addEventListener>);
  render(<ThemeSweepOverlay />);
  await act(async () => {});
  await act(async () => { sweepTheme("#02080e", () => {}); });
  // The uncover phase starts on the next frame.
  await act(async () => { await new Promise((r) => setTimeout(r, 32)); });
}

afterEach(() => jest.restoreAllMocks());

it("enters from the right and exits to the left in right-to-left", async () => {
  __setLayoutRtlForTests(true);
  const writes = recordSharedValue();
  await sweep();
  const width = Dimensions.get("window").width;
  expect(width).toBeGreaterThan(0);
  // start, cover (to 0), exit
  expect(writes).toEqual([width, 0, -width]);
});

it("enters from the left and exits to the right in left-to-right, as before", async () => {
  __setLayoutRtlForTests(false);
  const writes = recordSharedValue();
  await sweep();
  const width = Dimensions.get("window").width;
  expect(writes).toEqual([-width, 0, width]);
});
