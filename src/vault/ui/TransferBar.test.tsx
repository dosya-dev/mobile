import { render, screen, fireEvent } from "@testing-library/react-native";
import { TransferBar } from "./TransferBar";
import type { Transfer } from "@/vault/store";

const upload = (over: Partial<Transfer> = {}): Transfer => ({
  id: "up-1", name: "photo.jpg", kind: "upload", done: 512, total: 2048, error: null, ...over,
});

describe("TransferBar", () => {
  it("renders nothing when there is nothing in flight", () => {
    render(<TransferBar transfers={[]} onRetry={jest.fn()} onDismiss={jest.fn()} />);
    expect(screen.queryByTestId("vault-transfer-up-1")).toBeNull();
  });

  it("names each transfer and reports its progress in bytes", () => {
    render(<TransferBar transfers={[upload()]} onRetry={jest.fn()} onDismiss={jest.fn()} />);
    expect(screen.getByTestId("vault-transfer-up-1")).toBeTruthy();
    expect(screen.getByText("photo.jpg")).toBeTruthy();
    expect(screen.getByText("512 B of 2.0 KB")).toBeTruthy();
  });

  it("shows the store's message on a failed transfer", () => {
    render(
      <TransferBar
        transfers={[upload({ error: "Couldn't upload photo.jpg.", retry: { folderId: "root", fileUri: "file:///p.jpg" } })]}
        onRetry={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(screen.getByText("Couldn't upload photo.jpg.")).toBeTruthy();
  });

  it("offers Retry only for an upload that kept what it needs to retry", () => {
    const onRetry = jest.fn();
    const retry = { folderId: "root", fileUri: "file:///p.jpg" };
    const { rerender } = render(
      <TransferBar transfers={[upload({ error: "Couldn't upload photo.jpg.", retry })]} onRetry={onRetry} onDismiss={jest.fn()} />,
    );
    fireEvent.press(screen.getByTestId("vault-transfer-retry-up-1"));
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: "up-1", retry }));

    // A download has nothing to hand back, and neither does an upload still running.
    rerender(
      <TransferBar
        transfers={[{ id: "dl-1", name: "photo.jpg", kind: "download", done: 1, total: 2, error: "Couldn't download photo.jpg." }]}
        onRetry={onRetry}
        onDismiss={jest.fn()}
      />,
    );
    expect(screen.queryByTestId("vault-transfer-retry-dl-1")).toBeNull();
  });

  it("dismisses a row by id", () => {
    const onDismiss = jest.fn();
    render(<TransferBar transfers={[upload()]} onRetry={jest.fn()} onDismiss={onDismiss} />);
    fireEvent.press(screen.getByTestId("vault-transfer-dismiss-up-1"));
    expect(onDismiss).toHaveBeenCalledWith("up-1");
  });
});
