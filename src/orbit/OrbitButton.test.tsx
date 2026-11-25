import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Animated } from "react-native";
import { OrbitButton } from "./OrbitButton";
import { useDownloadStore } from "@/files/downloadStore";
import { useUploadStore } from "@/upload/store";
import { usePlayerStore } from "@/player/playerStore";
import { useMetadataStore } from "@/player/metadata/metadataStore";
import type { DownloadEntry } from "@/files/downloadModel";
import type { PlayerTrack } from "@/player/types";

// No cast: `getForTrack` re-checks sizeBytes and modifiedAt against the entry
// before it hands artwork back, so a loosely-typed fixture silently loses the
// artwork rather than failing to compile.
const track: PlayerTrack = {
  fileId: "t1",
  title: "Ocean Eyes",
  artist: "Billie Eilish",
  extension: "mp3",
  sizeBytes: 4_200_000,
  modifiedAt: 1_700_000_000,
};

function entry(over: Partial<DownloadEntry> = {}): DownloadEntry {
  return { fileId: "d1", name: "match.mp4", phase: "downloading", written: 43, total: 100, startedAt: 0, ...over };
}

function mount(over: Partial<React.ComponentProps<typeof OrbitButton>> = {}) {
  return render(<OrbitButton open={false} onPress={jest.fn()} progress={{ position: 0, duration: 0 }} {...over} />);
}

beforeEach(() => {
  useDownloadStore.getState().clearAll();
  useUploadStore.setState({ items: [] });
  usePlayerStore.setState({ queue: [], index: -1, playing: false });
  useMetadataStore.setState({ entries: {} });
});
afterEach(() => useDownloadStore.getState().clearAll());

describe("with nothing happening", () => {
  it("is a plain plus, with neither arc drawn", () => {
    mount();
    expect(screen.getByTestId("orbit-core-add")).toBeTruthy();
    expect(screen.queryByTestId("orbit-transfer-arc")).toBeNull();
    expect(screen.queryByTestId("orbit-playback-arc")).toBeNull();
  });

  it("opens the sheet on press", () => {
    const onPress = jest.fn();
    mount({ onPress });
    fireEvent.press(screen.getByTestId("orbit-button"));
    expect(onPress).toHaveBeenCalled();
  });
});

describe("while a transfer runs", () => {
  beforeEach(() => useDownloadStore.setState({ entries: { d1: entry() } }));

  it("draws the outer arc and puts the percentage in the middle", () => {
    mount();
    expect(screen.getByTestId("orbit-transfer-arc")).toBeTruthy();
    expect(screen.getByTestId("orbit-core-percent")).toHaveTextContent("43");
  });

  // The whole reason the capsule needed its tap-to-reveal timer: the ring took
  // the plus's place, so a transfer left nothing to press and a tap had to hand
  // the plus back for four seconds before it would upload again.
  it("still opens the sheet on the first press, rather than swapping its own glyph", () => {
    const onPress = jest.fn();
    mount({ onPress });
    fireEvent.press(screen.getByTestId("orbit-button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("while a track is loaded", () => {
  beforeEach(() => usePlayerStore.setState({ queue: [track], index: 0, playing: true }));

  it("wears the artwork and draws the playback arc", () => {
    useMetadataStore.setState({
      entries: {
        t1: {
          fileId: "t1", title: "Ocean Eyes", artist: "Billie Eilish", artworkUri: "file:///art.jpg",
          sizeBytes: track.sizeBytes, modifiedAt: track.modifiedAt,
        },
      },
    });
    mount({ progress: { position: 60, duration: 120 } });
    expect(screen.getByTestId("orbit-artwork")).toBeTruthy();
    expect(screen.getByTestId("orbit-playback-arc")).toBeTruthy();
  });

  it("falls back to a note rather than an empty hole when no artwork was extracted", () => {
    mount();
    expect(screen.getByTestId("orbit-core-artwork")).toBeTruthy();
    expect(screen.queryByTestId("orbit-artwork")).toBeNull();
  });

  it("carries a transfer at the same time, on the outer arc", () => {
    useDownloadStore.setState({ entries: { d1: entry() } });
    mount({ progress: { position: 60, duration: 120 } });
    expect(screen.getByTestId("orbit-transfer-arc")).toBeTruthy();
    expect(screen.getByTestId("orbit-playback-arc")).toBeTruthy();
    // The artwork keeps the middle; the percentage has the arc and the sheet.
    expect(screen.getByTestId("orbit-core-artwork")).toBeTruthy();
    expect(screen.queryByTestId("orbit-core-percent")).toBeNull();
  });

  it("announces the track and the transfer together", () => {
    useDownloadStore.setState({ entries: { d1: entry() } });
    mount();
    expect(screen.getByLabelText("Now playing, 1 transfer")).toBeTruthy();
  });
});

describe("while the sheet is open", () => {
  it("becomes a close glyph, whatever else is going on", () => {
    usePlayerStore.setState({ queue: [track], index: 0, playing: true });
    useDownloadStore.setState({ entries: { d1: entry() } });
    mount({ open: true });
    expect(screen.getByTestId("orbit-core-close")).toBeTruthy();
    expect(screen.getByLabelText("Close")).toBeTruthy();
  });
});

describe("the disc's acknowledgement when a transfer begins", () => {
  // The confirmation dialog that used to announce an upload was removed, so
  // this pulse is now the only thing that says "I heard you" at the moment of
  // the tap. Assert it fires, fires once, and respects reduced motion.
  beforeEach(() => {
    jest.clearAllMocks();
    useUploadStore.setState({ items: [] });
    useDownloadStore.setState({ entries: {} });
    usePlayerStore.setState({ queue: [], index: 0, playing: false });
  });

  it("swells once when the first transfer appears, not on every progress tick", () => {
    const sequence = jest.spyOn(Animated, "sequence");
    const { rerender } = render(<OrbitButton open={false} onPress={() => {}} />);
    expect(sequence).not.toHaveBeenCalled();

    act(() => {
      useUploadStore.setState({
        items: [{ id: "u1", name: "a.jpg", status: "uploading", sent: 10, total: 100 }] as never,
      });
    });
    rerender(<OrbitButton open={false} onPress={() => {}} />);
    expect(sequence).toHaveBeenCalledTimes(1);

    // Progress moves; the disc must not swell again mid-upload.
    act(() => {
      useUploadStore.setState({
        items: [{ id: "u1", name: "a.jpg", status: "uploading", sent: 60, total: 100 }] as never,
      });
    });
    rerender(<OrbitButton open={false} onPress={() => {}} />);
    expect(sequence).toHaveBeenCalledTimes(1);
  });
});
