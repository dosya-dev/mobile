import { Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ViewerSheet } from "./ViewerSheet";

function renderSheet(over: Partial<React.ComponentProps<typeof ViewerSheet>> = {}) {
  const props: React.ComponentProps<typeof ViewerSheet> = {
    visible: true,
    expanded: false,
    onToggleExpanded: jest.fn(),
    name: "Kas-harbour-sunset.jpg",
    meta: ["2.4 MB", "JPEG image", "3 Aug 2026"],
    children: <Text testID="actions-slot">actions</Text>,
    details: <Text testID="details-slot">details</Text>,
    ...over,
  };
  return { props, ...render(<ViewerSheet {...props} />) };
}

describe("the progress line", () => {
  const big = {
    fileId: "f1",
    name: "match.mp4",
    phase: "downloading" as const,
    written: 100 * 1024 * 1024,
    total: 512 * 1024 * 1024,
    startedAt: 0,
  };

  it("is absent when nothing is downloading", () => {
    renderSheet();
    expect(screen.queryByTestId("viewer-progress")).toBeNull();
  });

  // Below the threshold the transfer is over before the line finishes
  // appearing, so it would flash on and off. The ring still reports.
  it("stays out of the way for a file small enough to finish in a breath", () => {
    renderSheet({ download: { ...big, total: 2 * 1024 * 1024, written: 1024 } });
    expect(screen.queryByTestId("viewer-progress")).toBeNull();
  });

  it("appears for a big file, carrying the bytes, the rate and the estimate", () => {
    renderSheet({ download: big, now: 10_000 });
    expect(screen.getByTestId("viewer-progress")).toBeTruthy();
    const caption = screen.getByTestId("viewer-progress-caption").props.children;
    expect(caption).toContain("100.0 MB");
    expect(caption).toContain("left");
  });

  // The total is deliberately not repeated - the meta line directly above
  // already says how big the file is, and repeating it pushed the estimate
  // off the end of a 360px row.
  it("does not repeat the file size the meta line already states", () => {
    renderSheet({ download: big, now: 10_000 });
    expect(screen.getByTestId("viewer-progress-caption").props.children).not.toContain("of 512");
  });

  it("offers a way out of a transfer that is still running", () => {
    const onCancelDownload = jest.fn();
    renderSheet({ download: big, onCancelDownload });
    fireEvent.press(screen.getByTestId("viewer-progress-action"));
    expect(onCancelDownload).toHaveBeenCalled();
  });

  it("turns that way out into a retry once the transfer has broken", () => {
    const onCancelDownload = jest.fn();
    renderSheet({ download: { ...big, phase: "error", message: "offline" }, onCancelDownload });
    expect(screen.getByText("Retry")).toBeTruthy();
    fireEvent.press(screen.getByTestId("viewer-progress-action"));
    expect(onCancelDownload).toHaveBeenCalled();
  });

  // The write through the OS reports nothing, so there is nothing to cancel
  // and no honest number to show moving.
  it("withdraws the cancel during the save, when there is no transfer left to stop", () => {
    renderSheet({ download: { ...big, phase: "saving" }, onCancelDownload: jest.fn() });
    expect(screen.queryByTestId("viewer-progress-action")).toBeNull();
    expect(screen.getByTestId("viewer-progress-caption").props.children).toBe("Saving to your phone…");
  });
});

it("names the file and joins its facts into one line", () => {
  renderSheet();
  expect(screen.getByText("Kas-harbour-sunset.jpg")).toBeTruthy();
  expect(screen.getByTestId("viewer-meta").props.children).toBe("2.4 MB  ·  JPEG image  ·  3 Aug 2026");
});

it("keeps the details out of the way until the sheet is expanded", () => {
  const { props } = renderSheet();
  expect(screen.queryByTestId("details-slot")).toBeNull();
  render(<ViewerSheet {...props} expanded />);
  expect(screen.getByTestId("details-slot")).toBeTruthy();
});

it("toggles on the grabber", () => {
  const onToggleExpanded = jest.fn();
  renderSheet({ onToggleExpanded });
  fireEvent.press(screen.getByTestId("viewer-grabber"));
  expect(onToggleExpanded).toHaveBeenCalled();
});

it("always renders the action row it is given", () => {
  renderSheet();
  expect(screen.getByTestId("actions-slot")).toBeTruthy();
});

it("shows a primary action only when there is one", () => {
  renderSheet();
  expect(screen.queryByTestId("viewer-primary")).toBeNull();

  renderSheet({ primary: { kind: "read", label: "Continue reading", tone: "solid" } });
  expect(screen.getByText("Continue reading")).toBeTruthy();
});

it("fires the primary action", () => {
  const onPrimary = jest.fn();
  renderSheet({ primary: { kind: "save", label: "Save to phone", tone: "quiet" }, onPrimary });
  fireEvent.press(screen.getByTestId("viewer-primary"));
  expect(onPrimary).toHaveBeenCalled();
});

it("does not fire the primary action while it is already running", () => {
  const onPrimary = jest.fn();
  renderSheet({ primary: { kind: "save", label: "Save to phone", tone: "quiet" }, onPrimary, primaryBusy: true });
  fireEvent.press(screen.getByTestId("viewer-primary"));
  expect(onPrimary).not.toHaveBeenCalled();
});

it("shows a lock badge and a note when it is given them", () => {
  renderSheet({ badge: "View only", note: "The owner turned off downloads for this file." });
  expect(screen.getByText("View only")).toBeTruthy();
  expect(screen.getByTestId("viewer-note")).toBeTruthy();
});

// The sheet stays mounted and slides away, so it must stop taking touches -
// otherwise an invisible sheet swallows the tap meant to bring it back.
it("takes no touches while hidden", () => {
  renderSheet({ visible: false });
  const sheet = screen.getByTestId("viewer-sheet", { includeHiddenElements: true });
  expect(sheet.props.pointerEvents).toBe("none");
  expect(sheet.props.accessibilityElementsHidden).toBe(true);
});

it("takes touches while visible", () => {
  renderSheet();
  expect(screen.getByTestId("viewer-sheet").props.pointerEvents).toBe("auto");
});
