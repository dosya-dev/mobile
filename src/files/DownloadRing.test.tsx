import { render, screen } from "@testing-library/react-native";
import { DownloadRing, RING_CIRCUMFERENCE } from "./DownloadRing";
import type { DownloadEntry } from "./downloadModel";

function entry(over: Partial<DownloadEntry> = {}): DownloadEntry {
  return {
    fileId: "f1",
    name: "match.mp4",
    phase: "downloading",
    written: 0,
    total: 0,
    startedAt: 0,
    ...over,
  };
}

const arcOffset = () => Number(screen.getByTestId("download-ring-arc").props.strokeDashoffset);

it("shows the plain download icon and no arc when nothing is running", () => {
  render(<DownloadRing entry={undefined} />);
  expect(screen.queryByTestId("download-ring-arc")).toBeNull();
  expect(screen.getByTestId("download-ring-icon")).toBeTruthy();
});

it("draws the arc in proportion to the bytes on disk", () => {
  render(<DownloadRing entry={entry({ written: 25, total: 100 })} />);
  // 25% done leaves 75% of the circumference still dashed out.
  expect(arcOffset()).toBeCloseTo(RING_CIRCUMFERENCE * 0.75, 2);
});

it("puts the whole number inside the ring, so the count is where the press was", () => {
  render(<DownloadRing entry={entry({ written: 42, total: 100 })} />);
  expect(screen.getByTestId("download-ring-percent")).toHaveTextContent("42");
});

// An arc drawn against an unknown total is a number the app invented.
it("shows no percentage while the total is still unknown", () => {
  render(<DownloadRing entry={entry({ phase: "downloading", written: 5000, total: 0 })} />);
  expect(screen.queryByTestId("download-ring-percent")).toBeNull();
});

it("never draws past a full circle when the server over-reports the size", () => {
  render(<DownloadRing entry={entry({ written: 150, total: 100 })} />);
  expect(arcOffset()).toBe(0);
});

it("swaps the count for a check once the file has landed", () => {
  render(<DownloadRing entry={entry({ phase: "done", written: 100, total: 100 })} />);
  expect(screen.queryByTestId("download-ring-percent")).toBeNull();
  expect(screen.getByTestId("download-ring-check")).toBeTruthy();
});

it("shows a failure as something to act on, not just a stopped arc", () => {
  render(<DownloadRing entry={entry({ phase: "error", written: 30, total: 100 })} />);
  expect(screen.getByTestId("download-ring-error")).toBeTruthy();
});

it("announces the state to a screen reader rather than relying on the arc alone", () => {
  render(<DownloadRing entry={entry({ written: 42, total: 100 })} />);
  expect(screen.getByLabelText("Downloading, 42 percent")).toBeTruthy();
});

// Rounding reaches 100 a little before the transfer does. Showing it there and
// then sitting on it is the "parked and looking stuck" problem the saving phase
// exists to avoid, reintroduced one step later.
it("holds at 99 until the transfer is genuinely finished", () => {
  render(<DownloadRing entry={entry({ written: 99.6, total: 100 })} />);
  expect(screen.getByTestId("download-ring-percent")).toHaveTextContent("99");
});

// On the green FAB the default colours vanish: a primary-green arc on a
// primary-green disc is invisible, and foreground-on-primary fails contrast.
// Asserted as a DIFFERENCE from the default, so a component that ignores the
// prop entirely cannot pass this.
it("switches to the on-primary colours when it sits on the green disc", () => {
  const e = entry({ written: 42, total: 100 });
  const a = render(<DownloadRing entry={e} />);
  const surfaceArc = a.getByTestId("download-ring-arc").props.stroke;
  const surfaceNum = a.getByTestId("download-ring-percent").props.style;
  a.unmount();

  const b = render(<DownloadRing entry={e} tone="primary" />);
  expect(b.getByTestId("download-ring-arc").props.stroke).not.toBe(surfaceArc);
  expect(b.getByTestId("download-ring-percent").props.style).not.toEqual(surfaceNum);
  expect(b.getByTestId("download-ring-percent")).toHaveTextContent("42");
});
