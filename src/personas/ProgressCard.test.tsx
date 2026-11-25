// The progress card: this phone's reading, with Pause and Resume, gone once
// every photo is read. It also says what reading waits for, whether it goes on
// in the background, and (iOS 26+, Any time) offers Keep reading in background.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as bgNative from "../../modules/dosya-personas-background";
import { resetReadSettings, setReadMode } from "./device/settings";
import { __resetPersonasBackgroundForTests } from "./device/background";
import { PersonasProgressCard } from "./ProgressCard";

jest.mock("../../modules/dosya-personas-background");
jest.mock("@sentry/react-native", () => ({ addBreadcrumb: jest.fn(), captureException: jest.fn() }));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));
const native = bgNative as jest.Mocked<typeof bgNative>;

beforeEach(async () => {
  __resetPersonasBackgroundForTests();
  await resetReadSettings();
  native.supportsContinued.mockReset().mockReturnValue(false);
  native.startContinued.mockReset().mockResolvedValue(true);
});
afterEach(async () => { await act(async () => {}); });

const ready = (read: number, total: number | null, paused = false) => ({ state: "ready" as const, read, total, reading: false, paused });

it("says how far this phone has read, with a progress bar and Pause", () => {
  const onPause = jest.fn();
  render(<PersonasProgressCard status={ready(1240, 9800)} onPause={onPause} />);
  expect(screen.getByText("Read 1,240 of 9,800 photos on this device")).toBeTruthy();
  const bar = screen.getByTestId("personas-progress-bar");
  expect(bar.props.accessibilityRole).toBe("progressbar");
  expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 9800, now: 1240, text: "Read 1,240 of 9,800 photos on this device" });
  fireEvent.press(screen.getByText("Pause"));
  expect(onPause).toHaveBeenCalledWith(true);
});

it("paused, it offers Resume", () => {
  const onPause = jest.fn();
  render(<PersonasProgressCard status={ready(3, 10, true)} onPause={onPause} />);
  fireEvent.press(screen.getByText("Resume"));
  expect(onPause).toHaveBeenCalledWith(false);
});

it("says it is finding the photos before they are counted", () => {
  render(<PersonasProgressCard status={ready(0, null)} onPause={jest.fn()} />);
  expect(screen.getByText("Finding your photos")).toBeTruthy();
  expect(screen.queryByText("Pause")).toBeNull();
});

it("is gone once every photo is read", () => {
  const { toJSON } = render(<PersonasProgressCard status={ready(10, 10)} onPause={jest.fn()} />);
  expect(toJSON()).toBeNull();
});

it("a phone that cannot read photos says so; the grid still works from the other devices", () => {
  render(<PersonasProgressCard status={ready(3, 10)} supported={false} onPause={jest.fn()} />);
  expect(screen.getByText("This device can't read photos. Your other devices can.")).toBeTruthy();
  expect(screen.queryByText("Pause")).toBeNull();
});

it("says what reading waits for", () => {
  const { rerender } = render(<PersonasProgressCard status={ready(0, 10)} onPause={jest.fn()} />);
  expect(screen.queryByTestId("personas-progress-held")).toBeNull();
  const cases: [Parameters<typeof PersonasProgressCard>[0]["heldReason"], string][] = [
    ["wifi", "Waiting for Wi-Fi"],
    ["charger", "Waiting for a charger"],
    ["battery", "Waiting: battery below 20%"],
    ["lowPower", "Waiting: Low Power Mode is on"],
    ["thermal", "Waiting for the phone to cool down"],
  ];
  for (const [reason, text] of cases) {
    rerender(<PersonasProgressCard status={ready(0, 10)} heldReason={reason} onPause={jest.fn()} />);
    expect(screen.getByTestId("personas-progress-held").props.children).toBe(text);
  }
});

it("says it keeps reading in the background, by read mode", () => {
  const { rerender } = render(<PersonasProgressCard status={ready(3, 10)} onPause={jest.fn()} />);
  expect(screen.getByText("Keeps reading in the background while charging")).toBeTruthy();
  act(() => setReadMode("anytime"));
  rerender(<PersonasProgressCard status={ready(3, 10)} onPause={jest.fn()} />);
  expect(screen.getByText("Keeps reading in the background")).toBeTruthy();
  act(() => setReadMode("open"));
  expect(screen.queryByTestId("personas-progress-background")).toBeNull();
  // Paused, or waiting for something: that line instead.
  act(() => setReadMode("charging"));
  rerender(<PersonasProgressCard status={ready(3, 10, true)} onPause={jest.fn()} />);
  expect(screen.queryByTestId("personas-progress-background")).toBeNull();
  rerender(<PersonasProgressCard status={ready(3, 10)} heldReason="charger" onPause={jest.fn()} />);
  expect(screen.queryByTestId("personas-progress-background")).toBeNull();
});

describe("Keep reading in background", () => {
  it("shows only when supported, in Any time, with work left, and starts the continued task with the translated title", async () => {
    native.supportsContinued.mockReturnValue(true);
    act(() => setReadMode("anytime"));
    render(<PersonasProgressCard status={ready(1240, 8000)} onPause={jest.fn()} />);
    const button = screen.getByTestId("personas-keep-reading");
    expect(screen.getByText("Keep reading in background")).toBeTruthy();
    await act(async () => { fireEvent.press(button); });
    expect(native.startContinued).toHaveBeenCalledWith({ title: "Reading photos for Personas", subtitle: "1,240 of 8,000" });
    // Started: the button gives way to the background line, and a second press submits nothing.
    expect(screen.queryByTestId("personas-keep-reading")).toBeNull();
    expect(screen.getByText("Keeps reading in the background")).toBeTruthy();
    fireEvent.press(button);
    await act(async () => {});
    expect(native.startContinued).toHaveBeenCalledTimes(1);
  });

  it("a refused start shows the button again", async () => {
    native.supportsContinued.mockReturnValue(true);
    native.startContinued.mockResolvedValue(false);
    act(() => setReadMode("anytime"));
    render(<PersonasProgressCard status={ready(3, 10)} onPause={jest.fn()} />);
    await act(async () => { fireEvent.press(screen.getByTestId("personas-keep-reading")); });
    expect(screen.getByTestId("personas-keep-reading")).toBeTruthy();
  });

  it("is hidden without the continued task, in another mode, paused, held, or with nothing left", () => {
    act(() => setReadMode("anytime"));
    const { rerender } = render(<PersonasProgressCard status={ready(3, 10)} onPause={jest.fn()} />);
    expect(screen.queryByTestId("personas-keep-reading")).toBeNull();
    native.supportsContinued.mockReturnValue(true);
    act(() => setReadMode("charging"));
    rerender(<PersonasProgressCard status={ready(3, 10)} onPause={jest.fn()} />);
    expect(screen.queryByTestId("personas-keep-reading")).toBeNull();
    act(() => setReadMode("anytime"));
    rerender(<PersonasProgressCard status={ready(3, 10, true)} onPause={jest.fn()} />);
    expect(screen.queryByTestId("personas-keep-reading")).toBeNull();
    rerender(<PersonasProgressCard status={ready(10, 10)} onPause={jest.fn()} />);
    expect(screen.queryByTestId("personas-keep-reading")).toBeNull();
    rerender(<PersonasProgressCard status={ready(3, 10)} heldReason="battery" onPause={jest.fn()} />);
    expect(screen.queryByTestId("personas-keep-reading")).toBeNull();
    rerender(<PersonasProgressCard status={ready(3, 10)} onPause={jest.fn()} />);
    expect(screen.getByTestId("personas-keep-reading")).toBeTruthy();
  });
});
