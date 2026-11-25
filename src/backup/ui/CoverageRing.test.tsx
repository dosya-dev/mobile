import { StyleSheet } from "react-native";
import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { CoverageRing, CORE_SIZE, RING_CIRCUMFERENCE, RING_STROKE, ARC_MS } from "./CoverageRing";
import { TOKENS_LIGHT } from "@/theme/tokens";
import { formatWhen } from "@/lib/format";

const base = {
  status: "protected" as const,
  buttonState: "idle" as const,
  hasPending: false,
  onPress: jest.fn(),
  uploaded: 90,
  total: 120,
  startedAt: null,
  lastRun: 1_710_000_500,
  holdReason: null,
  bytesPerSec: 0,
  etaSec: null,
};

const arcOffset = () => Number(screen.getByTestId("coverage-ring-arc").props.strokeDashoffset);

afterEach(() => {
  jest.useRealTimers();
});

describe("CoverageRing - the ring is the coverage number", () => {
  it("fills the arc in proportion to the library that is protected, caps included", () => {
    render(<CoverageRing {...base} uploaded={90} total={120} />);
    // Round caps overshoot each end by half the stroke, so the drawn dash is
    // one stroke shorter than the span it should cover.
    expect(arcOffset()).toBeCloseTo(RING_CIRCUMFERENCE * 0.25 + RING_STROKE, 2);
    expect(screen.getByTestId("backup-coverage")).toHaveTextContent("90 of 120 protected");
  });

  it("keeps a nearly full ring's gap visible instead of letting the caps swallow it", () => {
    // 1366 of 1380: a 1% gap is narrower than the two caps; uncorrected they
    // overlap into a lump just before twelve o'clock.
    render(<CoverageRing {...base} uploaded={1366} total={1380} />);
    const gap = RING_CIRCUMFERENCE * (1 - 1366 / 1380);
    expect(arcOffset()).toBeCloseTo(gap + RING_STROKE, 2);
  });

  it("does not draw a negative dash when the fill is shorter than the caps", () => {
    render(<CoverageRing {...base} uploaded={1} total={1000} />);
    expect(arcOffset()).toBeLessThanOrEqual(RING_CIRCUMFERENCE);
    expect(arcOffset()).toBeGreaterThanOrEqual(RING_CIRCUMFERENCE - RING_STROKE);
  });

  it("is full when everything is protected", () => {
    render(<CoverageRing {...base} uploaded={120} total={120} />);
    expect(arcOffset()).toBe(0);
  });

  it("never draws past full when the ledger exceeds the library", () => {
    // Items deleted from the device after backup keep their uploaded row.
    render(<CoverageRing {...base} uploaded={130} total={120} />);
    expect(arcOffset()).toBe(0);
  });

  it("sweeps the arc to a new value over ARC_MS instead of snapping to it", () => {
    // The ledger is re-read every few seconds while a run is live, so the
    // fill arrives in steps. Drawn directly, each step was a jump; users read
    // the jumps as the ring stuttering.
    jest.useFakeTimers();
    const view = render(<CoverageRing {...base} uploaded={60} total={120} />);
    const start = arcOffset();
    view.rerender(<CoverageRing {...base} uploaded={90} total={120} />);
    const target = RING_CIRCUMFERENCE * 0.25 + RING_STROKE;
    // Still where it was on the frame the new value lands.
    expect(arcOffset()).toBeCloseTo(start, 2);
    act(() => {
      jest.advanceTimersByTime(ARC_MS / 2);
    });
    const midway = arcOffset();
    expect(midway).toBeLessThan(start);
    expect(midway).toBeGreaterThan(target);
    act(() => {
      jest.advanceTimersByTime(ARC_MS);
    });
    expect(arcOffset()).toBeCloseTo(target, 2);
  });

  it("draws an empty, dashed ring with no arc at all, and still names the library size, when nothing is backed up", () => {
    render(<CoverageRing {...base} uploaded={0} total={120} lastRun={null} />);
    // A zero-length arc with round caps still paints a dot at twelve o'clock.
    expect(screen.queryByTestId("coverage-ring-arc")).toBeNull();
    expect(screen.getByTestId("coverage-ring-track").props.strokeDasharray).toBeTruthy();
    expect(screen.getByTestId("backup-coverage")).toHaveTextContent("0 of 120 protected");
  });

  it("says nothing is backed up yet only when there is no library count to show against", () => {
    render(<CoverageRing {...base} uploaded={0} total={null} lastRun={null} />);
    expect(screen.getByTestId("backup-coverage")).toHaveTextContent("Nothing backed up yet");
  });

  it("falls back to the backed-up count when the library could not be counted", () => {
    // No photo permission: the denominator is unknown, so it is not invented.
    render(<CoverageRing {...base} uploaded={40} total={null} />);
    expect(screen.getByTestId("backup-coverage")).toHaveTextContent("40 backed up");
    expect(screen.queryByTestId("coverage-ring-arc")).toBeNull();
  });

  it("announces the coverage to a screen reader, as words and as a value", () => {
    render(<CoverageRing {...base} />);
    const ring = screen.getByTestId("coverage-ring");
    expect(ring.props.accessibilityLabel).toMatch(/90 of 120/);
    expect(ring.props.accessibilityValue).toEqual({ min: 0, max: 120, now: 90 });
  });
});

describe("CoverageRing - the scope of the number", () => {
  it("names what the denominator leaves out, right under the headline, and opens the settings on tap", () => {
    const onPressScope = jest.fn();
    render(<CoverageRing {...base} uploaded={1366} total={1380} scope="Since 17 Sep 2025 · 8682 more on this phone not included" onPressScope={onPressScope} />);
    expect(screen.getByTestId("backup-coverage")).toHaveTextContent("1366 of 1380 protected");
    fireEvent.press(screen.getByTestId("coverage-scope"));
    expect(onPressScope).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("coverage-scope")).toHaveTextContent(/8682 more on this phone not included/);
  });

  it("draws no scope line when there is nothing to say", () => {
    render(<CoverageRing {...base} scope={null} onPressScope={jest.fn()} />);
    expect(screen.queryByTestId("coverage-scope")).toBeNull();
  });
});

describe("CoverageRing - the core is the engine control", () => {
  it("idle: renders backup-now, the status word, and the start caption with the last run", () => {
    const onPress = jest.fn();
    render(<CoverageRing {...base} onPress={onPress} />);
    fireEvent.press(screen.getByTestId("backup-now"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("engine-status")).toHaveTextContent("Protected");
    expect(screen.getByTestId("engine-caption")).toHaveTextContent(`Start backup · Last run ${formatWhen(1_710_000_500)}`);
  });

  it("idle with pending assets: caption reads Continue backup", () => {
    render(<CoverageRing {...base} status="ready" hasPending />);
    expect(screen.getByTestId("engine-status")).toHaveTextContent("Ready");
    expect(screen.getByTestId("engine-caption")).toHaveTextContent(/^Continue backup/);
  });

  it("idle and never run: says so instead of showing a blank stamp", () => {
    render(<CoverageRing {...base} status="ready" lastRun={null} />);
    expect(screen.getByTestId("engine-caption")).toHaveTextContent("Start backup · Never run");
  });

  it("running: renders backup-stop, speed, time left, and a ticking elapsed clock", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(1_710_000_010_000)); // 10s after startedAt
    const onPress = jest.fn();
    render(
      <CoverageRing
        {...base}
        status="backing-up"
        buttonState="running"
        startedAt={1_710_000_000}
        bytesPerSec={16_515_072}
        etaSec={160}
        onPress={onPress}
      />,
    );
    expect(screen.queryByTestId("backup-now")).toBeNull();
    fireEvent.press(screen.getByTestId("backup-stop"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("engine-status")).toHaveTextContent("Backing up");
    expect(screen.getByTestId("engine-caption")).toHaveTextContent(/tap to stop/i);
    expect(screen.getByTestId("stat-speed")).toHaveTextContent("15.8 MB/s");
    expect(screen.getByTestId("stat-eta")).toHaveTextContent("2m left");
    expect(screen.getByTestId("engine-time")).toHaveTextContent("00:00:10");
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId("engine-time")).toHaveTextContent("00:00:12");
  });

  it("running with no measurable ETA: omits the time-left segment rather than printing a dash", () => {
    render(<CoverageRing {...base} status="scanning" buttonState="running" startedAt={1} bytesPerSec={0} etaSec={null} />);
    expect(screen.getByTestId("engine-status")).toHaveTextContent("Scanning…");
    expect(screen.queryByTestId("stat-eta")).toBeNull();
    expect(screen.queryByTestId("stat-speed")).toBeNull();
  });

  it("holding: names the wait in the status and says it resumes on its own", () => {
    render(<CoverageRing {...base} status="holding" buttonState="running" startedAt={1} holdReason="waiting for Wi-Fi" />);
    expect(screen.getByTestId("engine-status")).toHaveTextContent("Paused - waiting for Wi-Fi");
    // The core names the wait; the caption must not say it a second time.
    expect(screen.getByTestId("engine-caption")).toHaveTextContent(/^Resumes on its own/);
    expect(screen.getByTestId("engine-caption")).not.toHaveTextContent(/Wi-Fi/);
    expect(screen.getByTestId("backup-stop")).toBeTruthy();
  });

  it("cooling: says the device is warm", () => {
    render(<CoverageRing {...base} status="cooling" buttonState="running" startedAt={1} />);
    expect(screen.getByTestId("engine-status")).toHaveTextContent("Cooling down…");
    expect(screen.getByTestId("engine-caption")).toHaveTextContent(/warm/i);
  });

  it("paused: keeps the backup-now testID and shows the retry caption", () => {
    render(<CoverageRing {...base} status="paused" buttonState="paused" />);
    expect(screen.getByTestId("backup-now")).toBeTruthy();
    expect(screen.getByTestId("engine-status")).toHaveTextContent("Paused");
    expect(screen.getByTestId("engine-caption")).toHaveTextContent(`Tap to retry · Last run ${formatWhen(1_710_000_500)}`);
  });

  it("disabled: does not fire onPress and says why", () => {
    const onPress = jest.fn();
    render(<CoverageRing {...base} buttonState="disabled" onPress={onPress} />);
    fireEvent.press(screen.getByTestId("backup-now"));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId("engine-caption")).toHaveTextContent(/select a workspace/i);
  });
});

describe("CoverageRing - the core's paint and layout", () => {
  // Seen on a device: the running core rendered as a 30% green disc with no
  // glow, i.e. only a halo, with the fill missing, and the glyph sat above the
  // middle because it was centred together with the label.
  const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style) as Record<string, unknown>;

  it("paints the running core solid primary on its own view, with the glow, above the halos", () => {
    render(<CoverageRing {...base} status="backing-up" buttonState="running" startedAt={1} />);
    const fill = flat("engine-core");
    expect(fill.backgroundColor).toBe(TOKENS_LIGHT.primary);
    expect(fill.shadowOpacity).toBeGreaterThan(0);
    expect(fill.opacity ?? 1).toBe(1);
    // The press target that carries the fill is stacked above the halo layer.
    expect(Number(flat("backup-stop").zIndex)).toBeGreaterThan(Number(flat("engine-halos").zIndex));
  });

  it("paints the idle core on the card surface with a border", () => {
    render(<CoverageRing {...base} />);
    const fill = flat("engine-core");
    expect(fill.backgroundColor).toBe(TOKENS_LIGHT.card);
    expect(fill.borderWidth).toBe(1);
  });

  it("keeps the glyph at the exact centre and hangs the label below it", () => {
    render(<CoverageRing {...base} />);
    const glyph = flat("engine-glyph");
    expect(glyph.position).toBe("absolute");
    expect(glyph.top).toBe(0);
    expect(glyph.bottom).toBe(0);
    expect(glyph.justifyContent).toBe("center");
    const label = flat("engine-status");
    expect(label.position).toBe("absolute");
    expect(Number(label.top)).toBeGreaterThan(CORE_SIZE / 2 + 16);
  });
});

describe("CoverageRing - pulse halos", () => {
  it("mounts exactly two halos while running and none otherwise", () => {
    render(<CoverageRing {...base} status="backing-up" buttonState="running" startedAt={1} />);
    expect(screen.getAllByTestId("engine-halo")).toHaveLength(2);
  });
  it("mounts no halos when idle, paused, or disabled", () => {
    for (const buttonState of ["idle", "paused", "disabled"] as const) {
      const view = render(<CoverageRing {...base} buttonState={buttonState} />);
      expect(view.queryAllByTestId("engine-halo")).toHaveLength(0);
      view.unmount();
    }
  });
});
