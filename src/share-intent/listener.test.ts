const mockRemove = jest.fn();
const mockNative = {
  consumePendingShare: jest.fn(async () => null as unknown),
  // Params declared so `.mock.calls[0][1]` is typed as the callback rather than
  // `never` - emit() below reaches for it.
  addListener: jest.fn((_event: string, _cb: (payload: unknown) => void) => ({ remove: mockRemove })),
};
// `mock`-prefixed so jest's module factory (hoisted above the imports) is
// allowed to close over it.
let mockNativeAvailable = true;

jest.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: jest.fn(() => (mockNativeAvailable ? mockNative : null)),
}));

import { startShareIntentListener } from "./listener";
import { useShareIntentStore } from "./store";

const rawPdf = {
  uri: "content://downloads/42",
  name: "invoice-2026.pdf",
  size: 1400,
  mime: "application/pdf",
};

beforeEach(() => {
  mockNativeAvailable = true;
  jest.clearAllMocks();
  mockNative.consumePendingShare.mockResolvedValue(null);
  mockNative.addListener.mockReturnValue({ remove: mockRemove });
  useShareIntentStore.setState({ pending: null });
});

/** Runs the callback the listener registered for the warm-start event. */
function emit(payload: unknown) {
  mockNative.addListener.mock.calls[0][1](payload);
}

describe("startShareIntentListener", () => {
  it("parks a file that arrived before JS started (cold start)", async () => {
    // The activity holds the intent from the moment Android launches it, long
    // before the JS engine exists - so nothing was listening when it arrived and
    // the only way to see it is to ask.
    mockNative.consumePendingShare.mockResolvedValue([rawPdf]);

    startShareIntentListener();
    await Promise.resolve();
    await Promise.resolve();

    expect(useShareIntentStore.getState().pending).toEqual([rawPdf]);
  });

  it("parks a file shared into an already-running app (warm start)", () => {
    startShareIntentListener();
    emit({ files: [rawPdf] });
    expect(useShareIntentStore.getState().pending).toEqual([rawPdf]);
  });

  it("does nothing at all when the native module is missing", async () => {
    // iOS and Expo Go. Must not throw - this runs inside the root layout's mount
    // effect, where an exception takes the whole app down on launch.
    mockNativeAvailable = false;

    expect(() => startShareIntentListener()).not.toThrow();
    await Promise.resolve();
    expect(useShareIntentStore.getState().pending).toBeNull();
  });

  it("survives a native module that rejects", async () => {
    mockNative.consumePendingShare.mockRejectedValue(new Error("no activity"));

    startShareIntentListener();
    await Promise.resolve();
    await Promise.resolve();

    expect(useShareIntentStore.getState().pending).toBeNull();
  });

  it("removes its subscription when disposed", () => {
    const dispose = startShareIntentListener();
    dispose();
    expect(mockRemove).toHaveBeenCalled();
  });

  it("discards entries with no usable uri", () => {
    // Defensive: the payload crosses the native bridge, and a provider that
    // answers the ContentResolver query with nulls would otherwise enqueue an
    // upload whose source cannot be read.
    startShareIntentListener();
    emit({ files: [{ ...rawPdf, uri: "" }, rawPdf] });
    expect(useShareIntentStore.getState().pending).toEqual([rawPdf]);
  });

  it("ignores a malformed payload instead of parking junk", () => {
    startShareIntentListener();
    emit({ files: "not-an-array" });
    expect(useShareIntentStore.getState().pending).toBeNull();
  });

  it("fills in a name and mime when the provider supplied neither", () => {
    // An unnamed upload is not actionable for the user later; octet-stream is at
    // least an honest default the server understands.
    startShareIntentListener();
    emit({ files: [{ uri: "content://x/1", size: 5 }] });

    const parked = useShareIntentStore.getState().pending;
    expect(parked?.[0].name).toBeTruthy();
    expect(parked?.[0].mime).toBe("application/octet-stream");
  });
});
