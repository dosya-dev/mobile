import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { LockDialog, type LockTarget } from "./LockDialog";

const mockSetFolderLock = jest.fn();
const mockSetFileLock = jest.fn();
jest.mock("./mutations", () => ({
  setFolderLock: (...args: unknown[]) => mockSetFolderLock(...args),
  setFileLock: (...args: unknown[]) => mockSetFileLock(...args),
}));
const mockToast = jest.fn();
jest.mock("@/ui/toast", () => ({ toast: (...args: unknown[]) => mockToast(...args) }));

const folder: LockTarget = { kind: "folder", id: "fo1", name: "Tax 2025", lock_mode: "none", file_count: 14 };
const file: LockTarget = { kind: "file", id: "f1", name: "passport-scan.jpg", lock_mode: "none", size_bytes: 3_250_000, extension: "jpg" };

beforeEach(() => {
  mockSetFolderLock.mockReset().mockResolvedValue({ ok: true });
  mockSetFileLock.mockReset().mockResolvedValue({ ok: true });
  mockToast.mockReset();
});

describe("LockDialog", () => {
  it("names the item, preselects its current mode, and offers nothing to apply yet", () => {
    render(<LockDialog target={folder} visible onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText("Lock folder")).toBeTruthy();
    expect(screen.getByText("Tax 2025")).toBeTruthy();
    expect(screen.getByText("Folder · 14 files")).toBeTruthy();
    expect(screen.getByTestId("lock-mode-none")).toBeChecked();
    expect(screen.getByTestId("lock-mode-full_lock")).not.toBeChecked();
    expect(screen.getByText("Remove lock")).toBeTruthy();
    expect(screen.getByTestId("lock-save")).toBeDisabled();
    expect(screen.queryByTestId("lock-password")).toBeNull();
  });

  it("describes a file by type and size", () => {
    render(<LockDialog target={file} visible onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText("Lock file")).toBeTruthy();
    expect(screen.getByText("JPG · 3.1 MB")).toBeTruthy();
    expect(screen.getByText("Anyone with access to it can open, download and edit it.")).toBeTruthy();
  });

  it("reveals the password field inside the Password row and saves the lock", async () => {
    const onSaved = jest.fn();
    const onClose = jest.fn();
    render(<LockDialog target={folder} visible onClose={onClose} onSaved={onSaved} />);

    fireEvent.press(screen.getByTestId("lock-mode-full_lock"));
    expect(screen.getByTestId("lock-mode-full_lock")).toBeChecked();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByText("At least 8 characters.")).toBeTruthy();
    expect(screen.getByText("Lock with password")).toBeTruthy();
    expect(screen.getByTestId("lock-save")).toBeDisabled();

    fireEvent.changeText(screen.getByTestId("lock-password"), "abc");
    expect(screen.getByTestId("lock-save")).toBeDisabled();
    fireEvent.changeText(screen.getByTestId("lock-password"), "abcdefgh");
    expect(screen.getByTestId("lock-save")).toBeEnabled();

    fireEvent.press(screen.getByTestId("lock-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockSetFolderLock).toHaveBeenCalledWith("fo1", "full_lock", "abcdefgh");
    expect(onClose).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/Locked with a password/));
  });

  it("shows the current lock, asks for a new password, and can remove the lock instead", async () => {
    const locked: LockTarget = { ...folder, lock_mode: "full_lock" };
    render(<LockDialog target={locked} visible onClose={() => {}} onSaved={() => {}} />);

    expect(screen.getByText("Currently password-locked")).toBeTruthy();
    expect(screen.getByTestId("lock-mode-full_lock")).toBeChecked();
    expect(screen.getByText("New password")).toBeTruthy();
    expect(screen.getByText("Update password")).toBeTruthy();
    expect(screen.getByTestId("lock-save")).toBeDisabled();

    fireEvent.press(screen.getByTestId("lock-mode-none"));
    expect(screen.getByText("Remove lock")).toBeTruthy();
    expect(screen.getByTestId("lock-save")).toBeEnabled();
    fireEvent.press(screen.getByTestId("lock-save"));
    await waitFor(() => expect(mockSetFolderLock).toHaveBeenCalledWith("fo1", "none", undefined));
    expect(mockToast).toHaveBeenCalledWith("Lock removed");
  });

  it("closes from the header button", () => {
    const onClose = jest.fn();
    render(<LockDialog target={file} visible onClose={onClose} onSaved={() => {}} />);
    fireEvent.press(screen.getByTestId("lock-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("reports a failed save and stays open", async () => {
    mockSetFileLock.mockRejectedValue(new Error("You don't have permission to lock files"));
    const onClose = jest.fn();
    render(<LockDialog target={file} visible onClose={onClose} onSaved={() => {}} />);
    fireEvent.press(screen.getByTestId("lock-mode-view_only"));
    fireEvent.press(screen.getByTestId("lock-save"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("You don't have permission to lock files", "error"));
    expect(mockSetFileLock).toHaveBeenCalledWith("f1", "view_only", undefined);
    expect(onClose).not.toHaveBeenCalled();
  });
});
