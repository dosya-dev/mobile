import { act, render, screen, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("./onboardingState", () => ({ writeOnboarding: jest.fn(async () => {}) }));

// Every step double renders the REAL StepScreen, with the same absolute step
// number its real counterpart passes. The frame is where the progress
// indicator lives, and the flow now decides how many steps that indicator is
// counting - a double that skipped the frame could not see the numbering at
// all, which is how "Step 2 of 4" on the very first screen of a new account
// went unnoticed.
// The real WorkspaceStep does async work between the press and onDone -
// createWorkspace, then invalidateQueries(["workspaces"]), which resolves only
// once the refetch has landed in the cache. A double that calls onDone
// synchronously cannot see anything the flow does with the refreshed list
// while the user is still on this step, so the press is routed through a
// swappable async body. The default is still effectively synchronous.
let mockWorkspaceStepCreate: (onDone: () => void) => Promise<void> =
  async (onDone) => { onDone(); };
jest.mock("./steps/WorkspaceStep", () => ({
  WorkspaceStep: ({ onDone }: { onDone: () => void }) => {
    const { Text } = require("react-native");
    const { StepScreen } = require("./ui/StepScreen");
    return (
      <StepScreen step={1} title="workspace" primaryLabel="Continue" onPrimary={() => {}}>
        <Text testID="s1" onPress={() => { void mockWorkspaceStepCreate(onDone); }}>step1</Text>
      </StepScreen>
    );
  },
}));
jest.mock("./steps/PhotoAccessStep", () => ({
  // No onSkip: guideline 5.1.1(iv) leaves this step with exactly two exits,
  // both of them through the OS dialog. Skipping now happens one screen later,
  // from PermissionDeniedStep.
  PhotoAccessStep: ({ onGranted, onDenied }: Record<string, (p?: string) => void>) => {
    const { Text } = require("react-native");
    const { StepScreen } = require("./ui/StepScreen");
    return (
      <StepScreen step={2} title="photos" primaryLabel="Continue" onPrimary={() => {}}>
        <Text testID="s2-grant" onPress={() => onGranted("granted")}>grant</Text>
        <Text testID="s2-deny" onPress={() => onDenied()}>deny</Text>
      </StepScreen>
    );
  },
}));
jest.mock("./steps/PermissionDeniedStep", () => ({
  PermissionDeniedStep: ({ onContinue }: { onContinue: () => void }) => {
    const { Text } = require("react-native");
    const { StepScreen } = require("./ui/StepScreen");
    return (
      <StepScreen step={2} title="denied" primaryLabel="Open Settings" onPrimary={() => {}}>
        <Text testID="denied" onPress={onContinue}>denied</Text>
      </StepScreen>
    );
  },
}));
// These two mocks capture every prop they're given (via a `mock`-prefixed spy,
// so the capture works under Babel's jest-hoist rule below) instead of just
// destructuring onDone - a mock that discards workspaceId can't tell a caller
// with the right id from one silently passing "".
const mockChooseStepProps = jest.fn();
jest.mock("./steps/ChooseStep", () => ({
  ChooseStep: (props: { onDone: () => void }) => {
    mockChooseStepProps(props);
    const { Text } = require("react-native");
    const { StepScreen } = require("./ui/StepScreen");
    return (
      <StepScreen step={3} title="choose" primaryLabel="Start backup" onPrimary={() => {}}>
        <Text testID="s3" onPress={props.onDone}>step3</Text>
      </StepScreen>
    );
  },
}));
const mockFirstBackupStepProps = jest.fn();
jest.mock("./steps/FirstBackupStep", () => ({
  FirstBackupStep: (props: { onDone: () => void }) => {
    mockFirstBackupStepProps(props);
    const { Text } = require("react-native");
    const { StepScreen } = require("./ui/StepScreen");
    return (
      <StepScreen step={4} title="running" primaryLabel="Done" onPrimary={() => {}}>
        <Text testID="s4" onPress={props.onDone}>step4</Text>
      </StepScreen>
    );
  },
}));

// Babel's jest-hoist plugin forbids a jest.mock() factory from closing over an
// out-of-scope variable unless its name is `mock`-prefixed (see ChooseStep.test.tsx
// for the same fix) - so the brief's `workspaces` becomes `mockWorkspaces` here.
let mockWorkspaces: { id: string; name: string }[] | undefined = [];
let mockIsLoading = false;
let mockIsError = false;
jest.mock("@/files/hooks", () => ({
  useWorkspaces: () => ({ data: mockWorkspaces, isLoading: mockIsLoading, isError: mockIsError }),
}));
// `activeId` is mutable and `setActive` is a real spy, not a stub, so a test
// can start an "already has a workspace" account with no active selection
// (activeId: null - the real starting condition for a reinstall / second
// device, since only WorkspaceStep.onCreate or the post-onboarding
// WorkspaceGate ever call setActive) and then observe whether the flow
// adopts one.
let mockActiveId: string | null = "ws1";
const mockSetActive = jest.fn(async (id: string) => { mockActiveId = id; });
jest.mock("@/files/workspaceStore", () => ({
  useWorkspaceStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ activeId: mockActiveId }),
    { getState: () => ({ setActive: mockSetActive }) },
  ),
}));

import { writeOnboarding } from "./onboardingState";
import { OnboardingFlow } from "./OnboardingFlow";

/** What the shared frame is currently telling the user about their progress. */
const lastProgress = () => {
  const bar = screen.getByTestId("onboarding-progress");
  return {
    label: bar.props.accessibilityLabel as string,
    total: bar.props.accessibilityValue.max as number,
    now: bar.props.accessibilityValue.now as number,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkspaces = [];
  mockIsLoading = false;
  mockIsError = false;
  mockActiveId = "ws1";
  mockSetActive.mockImplementation(async (id: string) => { mockActiveId = id; });
  mockWorkspaceStepCreate = async (onDone) => { onDone(); };
});

describe("OnboardingFlow", () => {
  it("starts at the workspace step for a brand-new account", () => {
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    expect(screen.getByTestId("s1")).toBeTruthy();
  });

  it("skips workspace creation when the account already has one", () => {
    mockWorkspaces = [{ id: "ws1", name: "Existing" }];
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    expect(screen.queryByTestId("s1")).toBeNull();
    expect(screen.getByTestId("s2-grant")).toBeTruthy();
  });

  // The bug this cohort actually hits: activeId is null until WorkspaceStep.
  // onCreate sets it, or WorkspaceGate does (post-onboarding, inside
  // OnboardingGate). This account skips WorkspaceStep entirely, so without
  // the flow adopting one itself, ChooseStep and FirstBackupStep would both
  // receive workspaceId "" / null - the storage check goes silently disabled,
  // and the backup this whole flow exists to start never starts.
  it("adopts an existing workspace as active for the skip-workspace-step cohort, so a real id reaches every step that needs it", async () => {
    mockActiveId = null;
    mockWorkspaces = [{ id: "ws9", name: "Their Files" }];
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    await waitFor(() => expect(mockSetActive).toHaveBeenCalledWith("ws9"));

    fireEvent.press(await screen.findByTestId("s2-grant"));
    await waitFor(() =>
      expect(mockChooseStepProps).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws9" })),
    );

    fireEvent.press(await screen.findByTestId("s3"));
    await waitFor(() =>
      expect(mockFirstBackupStepProps).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws9" })),
    );
  });

  it("does not decide the starting step while the workspace list is still loading", () => {
    mockIsLoading = true;
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    // Deciding from an empty list before it has actually loaded would wrongly
    // send a re-install or second device (which DOES have a workspace) into
    // workspace creation.
    expect(screen.queryByTestId("s1")).toBeNull();
    expect(screen.queryByTestId("s2-grant")).toBeNull();
  });

  it("lands straight on photos once a still-loading list resolves for an existing account", () => {
    mockIsLoading = true;
    mockWorkspaces = [];
    const { rerender } = render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    mockIsLoading = false;
    mockWorkspaces = [{ id: "ws1", name: "Existing" }];
    rerender(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    expect(screen.getByTestId("s2-grant")).toBeTruthy();
    expect(screen.queryByTestId("s1")).toBeNull();
  });

  it("walks the happy path through to the end", async () => {
    const onFinished = jest.fn();
    render(<OnboardingFlow accountId="a1" onFinished={onFinished} />);
    fireEvent.press(screen.getByTestId("s1"));
    fireEvent.press(await screen.findByTestId("s2-grant"));
    fireEvent.press(await screen.findByTestId("s3"));
    fireEvent.press(await screen.findByTestId("s4"));
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
  });

  it("records completion, not a skip, on the happy path", async () => {
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    fireEvent.press(screen.getByTestId("s1"));
    fireEvent.press(await screen.findByTestId("s2-grant"));
    fireEvent.press(await screen.findByTestId("s3"));
    fireEvent.press(await screen.findByTestId("s4"));
    await waitFor(() => expect(writeOnboarding).toHaveBeenCalledWith(
      "a1", expect.objectContaining({ completedAt: expect.any(Number), skippedAt: null }),
    ));
  });

  it("routes a denial to the recovery screen, not onward", async () => {
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    fireEvent.press(screen.getByTestId("s1"));
    fireEvent.press(await screen.findByTestId("s2-deny"));
    expect(await screen.findByTestId("denied")).toBeTruthy();
    expect(screen.queryByTestId("s3")).toBeNull();
  });

  it("records the denial so the Backup tab can offer to resume", async () => {
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    fireEvent.press(screen.getByTestId("s1"));
    fireEvent.press(await screen.findByTestId("s2-deny"));
    await waitFor(() => expect(writeOnboarding).toHaveBeenCalledWith(
      "a1", expect.objectContaining({ photoPermission: "denied" }),
    ));
  });

  it("exits the flow when a denial is carried past, and marks it unfinished", async () => {
    const onFinished = jest.fn();
    render(<OnboardingFlow accountId="a1" onFinished={onFinished} />);
    fireEvent.press(screen.getByTestId("s1"));
    fireEvent.press(await screen.findByTestId("s2-deny"));
    fireEvent.press(await screen.findByTestId("denied"));
    await waitFor(() => expect(writeOnboarding).toHaveBeenCalledWith(
      "a1", expect.objectContaining({ skippedAt: expect.any(Number), completedAt: null }),
    ));
    expect(onFinished).toHaveBeenCalled();
  });

  // The rejected build let the user leave the rationale screen WITHOUT the OS
  // dialog ever appearing. Nothing may put that exit back.
  it("offers no way off the photo step that skips the OS dialog", async () => {
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    fireEvent.press(screen.getByTestId("s1"));
    await screen.findByTestId("s2-grant");
    expect(screen.queryByTestId("step-secondary")).toBeNull();
  });
});

// setActive persists to SecureStore. The rejection branch was missing, so a
// storage failure meant setStage never ran, `stage` stayed null, the component
// rendered nothing, and the effect's deps never changed again - the whole app
// blank, permanently. Third instance of this branch's hang bug, introduced by
// the fix for the second, and it hits exactly the reinstall / second-device
// cohort the code path was added for.
describe("OnboardingFlow survives a failed setActive", () => {
  it("still advances when persisting the active workspace rejects", async () => {
    mockActiveId = null;
    mockWorkspaces = [{ id: "ws9", name: "Their Files" }];
    mockSetActive.mockRejectedValue(new Error("keychain unavailable"));
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    expect(await screen.findByTestId("s2-grant")).toBeTruthy();
  });
});

// OnboardingGate reads an errored workspaces fetch as "assume it HAS
// workspaces"; this component used to read the same error as "assume NONE"
// and pin `stage` to "workspace". On a flaky network during a reinstall that
// stranded the user on "Name your first workspace" - and the effect returned
// early forever after, so a successful fetch seconds later could not fix it.
// The only forward action there creates a DUPLICATE workspace, which makes
// the user's real files look missing.
describe("OnboardingFlow reads an errored workspaces fetch the way the gate does", () => {
  it("does not demand a new workspace when the fetch merely errored", async () => {
    mockIsError = true;
    mockWorkspaces = undefined;
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    expect(await screen.findByTestId("s2-grant")).toBeTruthy();
    expect(screen.queryByTestId("s1")).toBeNull();
  });

  it("never calls setActive with an id it does not have", async () => {
    mockIsError = true;
    mockWorkspaces = undefined;
    mockActiveId = null;
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    await screen.findByTestId("s2-grant");
    expect(mockSetActive).not.toHaveBeenCalled();
  });

  it("corrects the stage when a later fetch succeeds, instead of latching the first guess", async () => {
    // The list resolves EMPTY first (so the workspace step is the right call),
    // then a refetch shows the account did have one all along.
    mockWorkspaces = [];
    const { rerender } = render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    expect(screen.getByTestId("s1")).toBeTruthy();

    mockWorkspaces = [{ id: "ws9", name: "Their Files" }];
    mockActiveId = null;
    rerender(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);

    expect(await screen.findByTestId("s2-grant")).toBeTruthy();
    await waitFor(() => expect(mockSetActive).toHaveBeenCalledWith("ws9"));
  });

  it("leaves a user who is already on the workspace step there when the fetch errors", async () => {
    mockWorkspaces = [];
    const { rerender } = render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    expect(screen.getByTestId("s1")).toBeTruthy();

    // A transient error must not yank someone off a form they are typing into.
    mockIsError = true;
    mockWorkspaces = undefined;
    rerender(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);

    expect(screen.getByTestId("s1")).toBeTruthy();
  });
});

// The server auto-creates a Personal workspace on every signup path (apps/api
// 9a3ba8a6, live since 2026-08-02), so the workspace step is skipped for the
// primary cohort - and the very first screen a brand-new account saw announced
// "Step 2 of 4" with two of four bars already filled.
describe("OnboardingFlow step indicator counts the steps actually shown", () => {
  it("numbers a skipped-workspace run 1 of 3, not 2 of 4", async () => {
    mockWorkspaces = [{ id: "ws1", name: "Personal" }];
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    await screen.findByTestId("s2-grant");
    expect(lastProgress()).toEqual({ label: "Step 1 of 3", total: 3, now: 1 });
  });

  it("keeps the full four-step numbering when the workspace step IS shown", async () => {
    mockWorkspaces = [];
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    expect(screen.getByTestId("s1")).toBeTruthy();
    expect(lastProgress()).toEqual({ label: "Step 1 of 4", total: 4, now: 1 });

    fireEvent.press(screen.getByTestId("s1"));
    await screen.findByTestId("s2-grant");
    expect(lastProgress()).toEqual({ label: "Step 2 of 4", total: 4, now: 2 });
  });

  // Two fixes in this wave interact. WorkspaceStep now AWAITS
  // invalidateQueries(["workspaces"]), which resolves only once the refetch has
  // landed, and the stage effect no longer latches - so the flow sees the new
  // list while `stage` is still "workspace", falls through, and used to reset
  // the step count. A user who pressed Continue on "Step 1 of 4" landed on
  // "Step 1 of 3" with the bar not advancing, then 2/3, 3/3 - which partially
  // undid this fix for the one cohort it had not broken: upgraders, who are the
  // only people who still see the workspace step.
  it("does not renumber a four-step run when the workspace refetch lands before onDone", async () => {
    mockWorkspaces = [];
    let releaseInvalidation!: () => void;
    const invalidationLanded = new Promise<void>((r) => { releaseInvalidation = r; });
    mockWorkspaceStepCreate = async (onDone) => {
      await invalidationLanded;
      onDone();
    };

    const { rerender } = render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    expect(lastProgress()).toEqual({ label: "Step 1 of 4", total: 4, now: 1 });

    fireEvent.press(screen.getByTestId("s1"));

    // The invalidation's refetch lands: useWorkspaces now reports the new
    // workspace, while the user is STILL on the workspace step.
    mockWorkspaces = [{ id: "ws1", name: "Personal" }];
    mockActiveId = "ws1";
    rerender(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    await act(async () => { releaseInvalidation(); });

    expect(await screen.findByTestId("s2-grant")).toBeTruthy();
    expect(lastProgress()).toEqual({ label: "Step 2 of 4", total: 4, now: 2 });

    fireEvent.press(screen.getByTestId("s2-grant"));
    await screen.findByTestId("s3");
    expect(lastProgress()).toEqual({ label: "Step 3 of 4", total: 4, now: 3 });

    fireEvent.press(screen.getByTestId("s3"));
    await screen.findByTestId("s4");
    expect(lastProgress()).toEqual({ label: "Step 4 of 4", total: 4, now: 4 });
  });

  it("keeps counting to 3 all the way to the last step of a skipped-workspace run", async () => {
    mockWorkspaces = [{ id: "ws1", name: "Personal" }];
    render(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />);
    fireEvent.press(await screen.findByTestId("s2-grant"));
    fireEvent.press(await screen.findByTestId("s3"));
    await screen.findByTestId("s4");
    expect(lastProgress()).toEqual({ label: "Step 3 of 3", total: 3, now: 3 });
  });
});
