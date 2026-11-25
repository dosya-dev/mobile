import { fireEvent, render, screen } from "@testing-library/react-native";
import { ViewerActions } from "./ViewerActions";
import type { ActionAvailability } from "./viewerModel";

const ALL: ActionAvailability = { save: true, link: true, star: true, versions: true, more: true };

function handlers() {
  return {
    onDownload: jest.fn(),
    onLink: jest.fn(),
    onStar: jest.fn(),
    onVersions: jest.fn(),
    onMore: jest.fn(),
  };
}

const disabledOf = (id: string) => screen.getByTestId(id).props.accessibilityState?.disabled === true;

it("shows all five actions in a fixed order", () => {
  render(<ViewerActions availability={ALL} starred={false} handlers={handlers()} />);
  for (const key of ["save", "link", "star", "versions", "more"]) {
    expect(screen.getByTestId(`viewer-action-${key}`)).toBeTruthy();
  }
});

it("fires the matching handler", () => {
  const h = handlers();
  render(<ViewerActions availability={ALL} starred={false} handlers={h} />);
  fireEvent.press(screen.getByTestId("viewer-action-save"));
  fireEvent.press(screen.getByTestId("viewer-action-more"));
  expect(h.onDownload).toHaveBeenCalled();
  expect(h.onMore).toHaveBeenCalled();
  expect(h.onLink).not.toHaveBeenCalled();
});

// Removing them instead would reflow the row the moment a file unlocks -
// under the thumb that is already reaching for a button.
it("dims an unavailable action rather than removing it", () => {
  render(
    <ViewerActions
      availability={{ save: false, link: false, star: true, versions: false, more: true }}
      starred={false}
      handlers={handlers()}
    />,
  );
  expect(screen.getByTestId("viewer-action-save")).toBeTruthy();
  expect(disabledOf("viewer-action-save")).toBe(true);
  expect(disabledOf("viewer-action-versions")).toBe(true);
  expect(disabledOf("viewer-action-star")).toBe(false);
});

it("does not fire a disabled Download", () => {
  const h = handlers();
  render(<ViewerActions availability={{ ...ALL, save: false }} starred={false} handlers={h} />);
  fireEvent.press(screen.getByTestId("viewer-action-save"));
  expect(h.onDownload).not.toHaveBeenCalled();
});

it("says whether the file is starred without opening anything", () => {
  const { rerender } = render(<ViewerActions availability={ALL} starred={false} handlers={handlers()} />);
  expect(screen.getByText("Star")).toBeTruthy();
  rerender(<ViewerActions availability={ALL} starred handlers={handlers()} />);
  expect(screen.getByText("Starred")).toBeTruthy();
  expect(screen.getByTestId("viewer-action-star").props.accessibilityState?.selected).toBe(true);
});

describe("the Download action while a transfer is running", () => {
  const running = {
    fileId: "f1",
    name: "match.mp4",
    phase: "downloading" as const,
    written: 42,
    total: 100,
    startedAt: 0,
  };

  it("reports on the button that was pressed, rather than beside it", () => {
    render(<ViewerActions availability={ALL} starred={false} download={running} handlers={handlers()} />);
    expect(screen.getByTestId("download-ring-percent")).toHaveTextContent("42");
    expect(screen.getByText("Downloading")).toBeTruthy();
  });

  // The old row set `disabled` the moment work started, which made the one
  // control that could stop a half-gigabyte cellular transfer inert for exactly
  // as long as it mattered.
  it("stays pressable while it runs, so the transfer can still be reached", () => {
    const h = handlers();
    render(<ViewerActions availability={ALL} starred={false} download={running} handlers={h} />);
    expect(disabledOf("viewer-action-save")).toBe(false);
    fireEvent.press(screen.getByTestId("viewer-action-save"));
    expect(h.onDownload).toHaveBeenCalled();
  });

  it("offers the retry as a press, not as a message to read", () => {
    const h = handlers();
    render(
      <ViewerActions
        availability={ALL}
        starred={false}
        download={{ ...running, phase: "error", message: "offline" }}
        handlers={h}
      />,
    );
    expect(screen.getByText("Retry")).toBeTruthy();
    fireEvent.press(screen.getByTestId("viewer-action-save"));
    expect(h.onDownload).toHaveBeenCalled();
  });

  it("goes back to plain Download once nothing is running", () => {
    render(<ViewerActions availability={ALL} starred={false} handlers={handlers()} />);
    expect(screen.getByText("Download")).toBeTruthy();
    expect(screen.queryByTestId("download-ring-arc")).toBeNull();
  });
});

it("badges the version count, but only when there is history to see", () => {
  const { rerender } = render(<ViewerActions availability={ALL} starred={false} versionCount={1} handlers={handlers()} />);
  expect(screen.queryByTestId("viewer-action-versions-badge")).toBeNull();
  rerender(<ViewerActions availability={ALL} starred={false} versionCount={3} handlers={handlers()} />);
  expect(screen.getByText("3")).toBeTruthy();
});
