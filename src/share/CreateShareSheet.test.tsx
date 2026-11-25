import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { CreateShareSheet } from "./CreateShareSheet";
import * as hooks from "./hooks";

jest.mock("react-native-qrcode-svg", () => () => null);

const createLink = { mutateAsync: jest.fn(async () => ({ url: "https://dosya.dev/s/tok" })), isPending: false };
const idle = { mutateAsync: jest.fn(), isPending: false };

function open() {
  return render(
    <CreateShareSheet visible target={{ kind: "file", id: "f1", name: "beach.jpg", sizeBytes: 2048, extension: "jpg" }} onClose={jest.fn()} />,
  );
}

/** The `opts` the sheet handed to the create mutation. */
function sentOpts(): Record<string, unknown> {
  return (createLink.mutateAsync.mock.calls[0] as unknown as [{ opts: Record<string, unknown> }])[0].opts;
}

describe("CreateShareSheet - remove photo metadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(hooks, "useShareMutations").mockReturnValue({
      createLink, email: idle, revoke: idle, createFolderLink: idle, folderEmail: idle, update: idle,
    } as never);
    jest.spyOn(hooks, "useFolderShareExclusions").mockReturnValue({ data: undefined } as never);
    jest.spyOn(hooks, "useWorkspaceShareDefault").mockReturnValue({ data: undefined } as never);
    jest.spyOn(hooks, "useIsFreePlan").mockReturnValue(false);
  });

  it("sends stripMetadata when the toggle is on", async () => {
    open();
    fireEvent(screen.getByTestId("toggle-strip-metadata"), "valueChange", true);
    fireEvent.press(screen.getByTestId("create-link"));
    await waitFor(() => expect(createLink.mutateAsync).toHaveBeenCalledTimes(1));
    expect(sentOpts().stripMetadata).toBe(true);
  });

  it("leaves the option off by default, so an ordinary link is unchanged", async () => {
    open();
    fireEvent.press(screen.getByTestId("create-link"));
    await waitFor(() => expect(createLink.mutateAsync).toHaveBeenCalledTimes(1));
    expect(sentOpts().stripMetadata).toBeFalsy();
  });
});

describe("CreateShareSheet - Free plan expiry cap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(hooks, "useShareMutations").mockReturnValue({
      createLink, email: idle, revoke: idle, createFolderLink: idle, folderEmail: idle, update: idle,
    } as never);
    jest.spyOn(hooks, "useFolderShareExclusions").mockReturnValue({ data: undefined } as never);
    jest.spyOn(hooks, "useIsFreePlan").mockReturnValue(true);
  });

  it("opens on 7 days even when the workspace default is longer", async () => {
    jest.spyOn(hooks, "useWorkspaceShareDefault").mockReturnValue({ data: 30 } as never);
    open();
    fireEvent.press(screen.getByTestId("create-link"));
    await waitFor(() => expect(createLink.mutateAsync).toHaveBeenCalledTimes(1));
    expect(sentOpts().expiresInDays).toBe(7);
  });

  it("locks the longer choices with a lock and names the cap", () => {
    jest.spyOn(hooks, "useWorkspaceShareDefault").mockReturnValue({ data: undefined } as never);
    open();
    for (const key of ["30d", "90d", "custom", "never"]) {
      expect(screen.getByTestId(`expiry-${key}-lock`).props.accessibilityLabel).toBe("Free plan links last up to 7 days.");
      fireEvent.press(screen.getByTestId(`expiry-${key}`));
    }
    expect(screen.queryByTestId("expiry-1h-lock")).toBeNull();
    expect(screen.getByTestId("free-expiry-hint")).toBeTruthy();
    // Pressing a locked chip changed nothing: still the 7-day default.
    expect(screen.getByTestId("expiry-7d").props.accessibilityState.selected).toBe(true);
  });
});

describe("CreateShareSheet - paid plan", () => {
  it("locks nothing and shows no cap line", () => {
    jest.spyOn(hooks, "useShareMutations").mockReturnValue({
      createLink, email: idle, revoke: idle, createFolderLink: idle, folderEmail: idle, update: idle,
    } as never);
    jest.spyOn(hooks, "useFolderShareExclusions").mockReturnValue({ data: undefined } as never);
    jest.spyOn(hooks, "useWorkspaceShareDefault").mockReturnValue({ data: undefined } as never);
    jest.spyOn(hooks, "useIsFreePlan").mockReturnValue(false);
    open();
    expect(screen.queryByTestId("expiry-never-lock")).toBeNull();
    expect(screen.queryByTestId("free-expiry-hint")).toBeNull();
  });
});
