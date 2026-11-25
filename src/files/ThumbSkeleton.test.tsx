import { render, screen } from "@testing-library/react-native";
import { withRepeat } from "react-native-reanimated";
import { ThumbSkeleton } from "./ThumbSkeleton";

jest.mock("react-native-reanimated", () => {
  const actual = jest.requireActual("react-native-reanimated/mock");
  return { ...actual, __esModule: true, default: actual.default ?? actual, withRepeat: jest.fn((a) => a) };
});

it("renders the placeholder", () => {
  render(<ThumbSkeleton />);
  expect(screen.getByTestId("thumb-skeleton")).toBeTruthy();
});

// A load that hangs or is cancelled off screen leaves the tile mounted, and an
// endless loop would keep the display working for as long as it stayed there.
it("stops pulsing on its own, back at its resting opacity", () => {
  render(<ThumbSkeleton />);
  const reps = (withRepeat as jest.Mock).mock.calls[0][1];
  expect(reps).toBeGreaterThan(0);
  expect(reps % 2).toBe(0);
});
