const mockSetString = jest.fn(async (_s: string) => {});
jest.mock("expo-clipboard", () => ({ setStringAsync: (s: string) => mockSetString(s) }));
const mockWrite = jest.fn(async (_uri: string, _body: string) => {});
const mockDelete = jest.fn(async (_uri: string, _o?: unknown) => {});
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: (uri: string, body: string) => mockWrite(uri, body),
  deleteAsync: (uri: string, o?: unknown) => mockDelete(uri, o),
}));
const mockSave = jest.fn(async (_p: unknown) => ({ kind: "folder" as const }));
jest.mock("@/files/saveToDevice", () => ({
  ...jest.requireActual("@/files/saveToDevice"),
  saveToDevice: (p: unknown) => mockSave(p),
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";
import { RecoveryKeyStep } from "./RecoveryKeyStep";
import { useVault } from "@/vault/store";

const KEY = "3f9a1c7e8b20d45f0e6a92bc7d13f84e";

beforeEach(() => {
  jest.clearAllMocks();
  useVault.setState({ recoveryKeyOnce: KEY });
});

describe("RecoveryKeyStep", () => {
  it("shows the key in groups of four", () => {
    render(<RecoveryKeyStep onDone={() => {}} />);
    for (const g of ["3f9a", "1c7e", "8b20", "d45f", "0e6a", "92bc", "7d13", "f84e"]) {
      expect(screen.getByText(g)).toBeTruthy();
    }
  });

  it("keeps Finish off until the key is said to be stored, then forgets it", () => {
    const onDone = jest.fn();
    render(<RecoveryKeyStep onDone={onDone} />);

    fireEvent.press(screen.getByTestId("vault-recovery-dismiss"));
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("vault-recovery-stored"));
    fireEvent.press(screen.getByTestId("vault-recovery-dismiss"));
    expect(onDone).toHaveBeenCalled();
    expect(useVault.getState().recoveryKeyOnce).toBeNull();
  });

  // The groups are for reading. A key copied with the spaces in would not
  // decode, so every way out carries the bare key.
  it("copies and shares the key without the grouping spaces", async () => {
    useVault.setState({ recoveryKeyOnce: "3f9a 1c7e" });
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    render(<RecoveryKeyStep onDone={() => {}} />);

    fireEvent.press(screen.getByTestId("vault-recovery-copy"));
    await waitFor(() => expect(mockSetString).toHaveBeenCalledWith("3f9a1c7e"));

    fireEvent.press(screen.getByTestId("vault-recovery-share"));
    expect(share).toHaveBeenCalledWith({ message: "3f9a1c7e" });
  });

  it("saves the key as a text file and never leaves the plain copy in the cache", async () => {
    render(<RecoveryKeyStep onDone={() => {}} />);
    fireEvent.press(screen.getByTestId("vault-recovery-save"));

    await waitFor(() => expect(mockDelete).toHaveBeenCalled());
    const [uri, body] = mockWrite.mock.calls[0];
    expect(uri).toBe("file:///cache/dosya-vault-recovery-key.txt");
    expect(body).toContain(KEY);
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ localUri: uri, mimeType: "text/plain" }));
    expect(mockDelete).toHaveBeenCalledWith(uri, { idempotent: true });
  });

  it("still deletes the cached copy when saving fails", async () => {
    mockSave.mockRejectedValueOnce(new Error("disk full"));
    render(<RecoveryKeyStep onDone={() => {}} />);
    fireEvent.press(screen.getByTestId("vault-recovery-save"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("file:///cache/dosya-vault-recovery-key.txt", { idempotent: true }));
  });
});
