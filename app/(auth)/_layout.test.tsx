import { render, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import AuthLayout from "./_layout";

// The real Stack renders a native navigator. Only the options it receives are
// under test here, so capture them and render nothing.
const screenOptions: Record<string, unknown>[] = [];
jest.mock("expo-router", () => ({
  Stack: (props: { screenOptions?: Record<string, unknown> }) => {
    screenOptions.push(props.screenOptions ?? {});
    return null;
  },
}));

describe("auth stack animation", () => {
  beforeEach(() => {
    screenOptions.length = 0;
    jest.restoreAllMocks();
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<
        typeof AccessibilityInfo.addEventListener
      >);
  });

  const latest = () => screenOptions[screenOptions.length - 1];

  it("pushes from the right, so the arriving screen says which way you moved", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    render(<AuthLayout />);
    await waitFor(() => expect(latest().animation).toBe("slide_from_right"));
  });

  it("falls back to a fade under reduced motion, not to nothing", async () => {
    // "none" would drop the only cue that the step changed at all; the fade
    // keeps that while removing the travel.
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    render(<AuthLayout />);
    await waitFor(() => expect(latest().animation).toBe("fade"));
  });

  it("still animates if the accessibility query fails", async () => {
    // A rejected preference check must not leave the stack in the reduced
    // state, and must never block sign-in.
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockRejectedValue(new Error("unavailable"));
    render(<AuthLayout />);
    await waitFor(() => expect(latest().animation).toBe("slide_from_right"));
  });

  it("keeps the headers hidden, which the auth screens draw themselves", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    render(<AuthLayout />);
    await waitFor(() => expect(latest().headerShown).toBe(false));
  });

  it("unsubscribes from the preference listener on unmount", async () => {
    const remove = jest.fn();
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockReturnValue({ remove } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    const view = render(<AuthLayout />);
    await waitFor(() => expect(latest().animation).toBe("slide_from_right"));
    view.unmount();
    expect(remove).toHaveBeenCalled();
  });
});
