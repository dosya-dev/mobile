jest.mock("@/onboarding/onboardingState", () => ({ readOnboarding: jest.fn() }));
jest.mock("@/auth/authStore", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: "u1" } }),
}));

import { Text } from "react-native";
import { render, screen, waitFor } from "@testing-library/react-native";
import { readOnboarding } from "@/onboarding/onboardingState";
import { useUnfinishedSetup } from "./useUnfinishedSetup";

function Probe() {
  const state = useUnfinishedSetup();
  return <Text testID="setup">{state == null ? "done" : state.photoPermission}</Text>;
}

beforeEach(() => jest.clearAllMocks());

describe("useUnfinishedSetup", () => {
  it("reports a skipped setup with its photo permission", async () => {
    (readOnboarding as jest.Mock).mockResolvedValue({ completedAt: null, skippedAt: 1, photoPermission: "denied" });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("setup")).toHaveTextContent("denied"));
  });

  it("is null for an account that completed setup", async () => {
    (readOnboarding as jest.Mock).mockResolvedValue({ completedAt: 1, skippedAt: null, photoPermission: "granted" });
    render(<Probe />);
    await waitFor(() => expect(readOnboarding).toHaveBeenCalledWith("u1"));
    expect(screen.getByTestId("setup")).toHaveTextContent("done");
  });

  it("is null for an account that never skipped", async () => {
    (readOnboarding as jest.Mock).mockResolvedValue({ completedAt: null, skippedAt: null, photoPermission: "unasked" });
    render(<Probe />);
    await waitFor(() => expect(readOnboarding).toHaveBeenCalled());
    expect(screen.getByTestId("setup")).toHaveTextContent("done");
  });
});
