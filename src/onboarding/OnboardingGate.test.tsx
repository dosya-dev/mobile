import { render, screen, waitFor, act } from "@testing-library/react-native";
import { Text } from "react-native";

jest.mock("./onboardingState", () => ({ readOnboarding: jest.fn() }));
jest.mock("./OnboardingFlow", () => ({
  OnboardingFlow: ({ onFinished }: { onFinished: () => void }) => {
    const { Text: T } = require("react-native");
    return <T testID="flow" onPress={onFinished}>flow</T>;
  },
}));
jest.mock("@/files/hooks", () => ({ useWorkspaces: jest.fn() }));

// `let` (not `const`) so the "resets on account switch" test can move it
// between renders. `mock`-prefixed so babel-plugin-jest-hoist allows the
// reference inside the factory below.
let mockUserId = "u1";
jest.mock("@/auth/authStore", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: mockUserId, name: "Firat" } }),
}));

import { readOnboarding } from "./onboardingState";
import { useWorkspaces } from "@/files/hooks";
import { OnboardingGate } from "./OnboardingGate";
import { useOnboardingRefresh } from "./onboardingRefresh";

const child = <Text>app content</Text>;
const HAS_WORKSPACE = { data: [{ id: "w1", name: "Test" }], isLoading: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = "u1";
  (useWorkspaces as jest.Mock).mockReturnValue(HAS_WORKSPACE);
});

describe("OnboardingGate", () => {
  it("runs the flow for an account that has never onboarded", async () => {
    (readOnboarding as jest.Mock).mockResolvedValue({ completedAt: null, skippedAt: null });
    render(<OnboardingGate>{child}</OnboardingGate>);
    expect(await screen.findByTestId("flow")).toBeTruthy();
    expect(screen.queryByText("app content")).toBeNull();
  });

  it("lets a completed account with a workspace straight through", async () => {
    (readOnboarding as jest.Mock).mockResolvedValue({ completedAt: 100, skippedAt: null });
    render(<OnboardingGate>{child}</OnboardingGate>);
    expect(await screen.findByText("app content")).toBeTruthy();
    expect(screen.queryByTestId("flow")).toBeNull();
  });

  it("does not re-run the flow for a skipped account that has a workspace", async () => {
    (readOnboarding as jest.Mock).mockResolvedValue({ completedAt: null, skippedAt: 100 });
    render(<OnboardingGate>{child}</OnboardingGate>);
    expect(await screen.findByText("app content")).toBeTruthy();
    expect(screen.queryByTestId("flow")).toBeNull();
  });

  // Regression: the OLD onboarding flow marked its completion flag when the
  // user tapped "Get started", which came BEFORE the blocking
  // create-workspace step that used to follow. An account that quit right
  // after that tap migrates in as "completed" with zero workspaces, and
  // WorkspaceGate no longer has a create-form branch to save it. Without this,
  // such an account reaches the app with no workspace and no way to make one.
  // (This rescues accounts from BEFORE apps/api 9a3ba8a6 - since 2026-08-02
  // the server auto-creates a Personal workspace on every signup path, so a
  // brand-new account is not the cohort at risk here.)
  it("runs the flow for a completed account that has zero workspaces (legacy-migrated, quit before creating one)", async () => {
    (useWorkspaces as jest.Mock).mockReturnValue({ data: [], isLoading: false });
    (readOnboarding as jest.Mock).mockResolvedValue({ completedAt: 100, skippedAt: null });
    render(<OnboardingGate>{child}</OnboardingGate>);
    expect(await screen.findByTestId("flow")).toBeTruthy();
    expect(screen.queryByText("app content")).toBeNull();
  });

  it("reveals the app once the flow finishes", async () => {
    (readOnboarding as jest.Mock).mockResolvedValue({ completedAt: null, skippedAt: null });
    render(<OnboardingGate>{child}</OnboardingGate>);
    (await screen.findByTestId("flow")).props.onPress();
    expect(await screen.findByText("app content")).toBeTruthy();
  });

  it("reads state per account, so a second account is not skipped", async () => {
    (readOnboarding as jest.Mock).mockResolvedValue({ completedAt: null, skippedAt: null });
    render(<OnboardingGate>{child}</OnboardingGate>);
    await waitFor(() => expect(readOnboarding).toHaveBeenCalledWith("u1"));
  });

  // Regression: queryClient sets retry: 2, so once retries are exhausted an
  // ordinary failure (expired token, a 500, first launch offline) settles
  // useWorkspaces to isLoading: false with data still undefined - the exact
  // same shape as "still loading". A guard that only checks `!workspaces`
  // can't tell the two apart and blocks forever.
  it("lets an already-answered account through rather than blocking forever when the workspaces fetch has errored", async () => {
    (useWorkspaces as jest.Mock).mockReturnValue({ data: undefined, isLoading: false, isError: true });
    (readOnboarding as jest.Mock).mockResolvedValue({ completedAt: 100, skippedAt: null });
    render(<OnboardingGate>{child}</OnboardingGate>);
    // An errored fetch is NOT confirmed "zero workspaces" - forcing an
    // already-answered account (which, in the common case, already HAS a
    // workspace) into WorkspaceStep on a mere network blip risks a duplicate
    // workspace once the backend recovers. Letting it through is safer.
    expect(await screen.findByText("app content")).toBeTruthy();
    expect(screen.queryByTestId("flow")).toBeNull();
  });

  it("still runs the flow (not a blank screen) for a never-onboarded account when the workspaces fetch has errored", async () => {
    (useWorkspaces as jest.Mock).mockReturnValue({ data: undefined, isLoading: false, isError: true });
    (readOnboarding as jest.Mock).mockResolvedValue({ completedAt: null, skippedAt: null });
    render(<OnboardingGate>{child}</OnboardingGate>);
    // A never-onboarded account runs the flow regardless of fetch success or
    // error, exactly as on a successful empty fetch: a fresh account
    // genuinely starts with zero workspaces, and OnboardingFlow's own
    // `!workspaces` fallback already renders the interactive WorkspaceStep
    // (not a blank screen) for this case.
    expect(await screen.findByTestId("flow")).toBeTruthy();
    expect(screen.queryByText("app content")).toBeNull();
  });

  it("resets rather than keeping the previous account's verdict when the signed-in account changes", async () => {
    (readOnboarding as jest.Mock).mockResolvedValueOnce({ completedAt: 100, skippedAt: null });
    const { rerender } = render(<OnboardingGate>{child}</OnboardingGate>);
    expect(await screen.findByText("app content")).toBeTruthy();

    // Switch accounts without unmounting - a live gate must not go on
    // showing the FIRST account's "done" verdict while the second account's
    // own state is still loading.
    mockUserId = "u2";
    (readOnboarding as jest.Mock).mockResolvedValueOnce({ completedAt: null, skippedAt: null });
    rerender(<OnboardingGate>{child}</OnboardingGate>);

    expect(screen.queryByText("app content")).toBeNull();
    expect(await screen.findByTestId("flow")).toBeTruthy();
    await waitFor(() => expect(readOnboarding).toHaveBeenCalledWith("u2"));
  });

  // Regression: the Backup tab's "Finish setting up backup" row resumes a skipped setup by
  // clearing `skippedAt` and calling `onResume`. The account never changes,
  // so the gate's own effect - keyed only on accountId - would otherwise
  // never notice the write and would go on showing the app. Bumping
  // useOnboardingRefresh is the signal a navigation-only `router.replace`
  // cannot provide: it is what actually makes resuming work.
  it("re-reads onboarding state when the refresh signal bumps, with no account change", async () => {
    (readOnboarding as jest.Mock)
      .mockResolvedValueOnce({ completedAt: null, skippedAt: 100 })
      .mockResolvedValueOnce({ completedAt: null, skippedAt: null });
    render(<OnboardingGate>{child}</OnboardingGate>);
    expect(await screen.findByText("app content")).toBeTruthy();

    act(() => { useOnboardingRefresh.getState().bump(); });

    expect(await screen.findByTestId("flow")).toBeTruthy();
    expect(readOnboarding).toHaveBeenCalledTimes(2);
  });
});
