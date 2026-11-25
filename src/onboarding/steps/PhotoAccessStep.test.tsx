import { act, render, screen, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("../permissions", () => ({ requestPhotoAccess: jest.fn() }));
import { requestPhotoAccess } from "../permissions";
import { PhotoAccessStep } from "./PhotoAccessStep";

const props = {
  workspaceName: "Firat's Files",
  onGranted: jest.fn(),
  onDenied: jest.fn(),
};
beforeEach(() => jest.clearAllMocks());

describe("PhotoAccessStep", () => {
  it("names the workspace the photos are going to", () => {
    render(<PhotoAccessStep {...props} />);
    expect(screen.getByText(/Firat's Files/)).toBeTruthy();
  });

  it("does not ask the OS until the user acts on the rationale", () => {
    render(<PhotoAccessStep {...props} />);
    expect(requestPhotoAccess).not.toHaveBeenCalled();
  });

  it("reports granted", async () => {
    (requestPhotoAccess as jest.Mock).mockResolvedValue("granted");
    render(<PhotoAccessStep {...props} />);
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(props.onGranted).toHaveBeenCalledWith("granted"));
  });

  it("treats limited access as usable, not as a denial", async () => {
    (requestPhotoAccess as jest.Mock).mockResolvedValue("limited");
    render(<PhotoAccessStep {...props} />);
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(props.onGranted).toHaveBeenCalledWith("limited"));
    expect(props.onDenied).not.toHaveBeenCalled();
  });

  it("routes a denial to the recovery state", async () => {
    (requestPhotoAccess as jest.Mock).mockResolvedValue("denied");
    render(<PhotoAccessStep {...props} />);
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(props.onDenied).toHaveBeenCalled());
  });

  // Guideline 5.1.1(iv), both halves of the 1.0.0 (16) rejection. The button
  // may not say "Allow" (that is the OS dialog's word, and a custom button
  // wearing it reads as the grant itself), and there may be no exit from the
  // rationale that skips the dialog - which is what "Not now" was.
  it("does not wear the OS dialog's own word on its button", () => {
    render(<PhotoAccessStep {...props} />);
    expect(screen.getByText("Continue")).toBeTruthy();
    expect(screen.queryByText(/Allow/)).toBeNull();
  });

  it("offers no exit that skips the permission request", () => {
    render(<PhotoAccessStep {...props} />);
    expect(screen.queryByTestId("step-secondary")).toBeNull();
    expect(screen.queryByText(/Not now/)).toBeNull();
  });

  it("says where contacts is handled, without asking for it", () => {
    render(<PhotoAccessStep {...props} />);
    expect(screen.getByText(/Contacts backup is set up later/)).toBeTruthy();
  });

  // Task 6 (WorkspaceStep) found that a useState "busy" guard alone lets a
  // same-tick double press slip through, because the disabled prop it drives
  // only reaches the button on the *next* render. iOS shows the photo-library
  // dialog once per install, so a second requestPhotoAccess() call here isn't
  // just wasted work - it can silently consume the app's only prompt. These
  // two tests pin the same useRef-backed guard used there.
  it("does not request access twice on a rapid double press", async () => {
    let resolveRequest!: (v: "granted" | "limited" | "denied") => void;
    (requestPhotoAccess as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveRequest = resolve; }),
    );
    render(<PhotoAccessStep {...props} />);
    const primary = screen.getByTestId("step-primary");
    fireEvent.press(primary);
    fireEvent.press(primary);
    resolveRequest("granted");
    await waitFor(() => expect(props.onGranted).toHaveBeenCalled());
    expect(requestPhotoAccess).toHaveBeenCalledTimes(1);
  });

  it("does not request access twice even if both presses land before the button can disable itself", async () => {
    let resolveRequest!: (v: "granted" | "limited" | "denied") => void;
    (requestPhotoAccess as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveRequest = resolve; }),
    );
    render(<PhotoAccessStep {...props} />);
    const primary = screen.getByTestId("step-primary");
    await act(async () => {
      fireEvent.press(primary);
      fireEvent.press(primary);
    });
    resolveRequest("granted");
    await waitFor(() => expect(props.onGranted).toHaveBeenCalled());
    expect(requestPhotoAccess).toHaveBeenCalledTimes(1);
  });
});
