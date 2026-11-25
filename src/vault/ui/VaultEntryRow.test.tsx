import { render, screen, fireEvent } from "@testing-library/react-native";
import { VaultEntryRow } from "./VaultEntryRow";
import type { VaultEntry } from "@/vault/engine";

const file: VaultEntry = { id: "f1", name: "photo.jpg", kind: "file", size: 2048, timestamp: 1 };
const folder: VaultEntry = { id: "d1", name: "Trip", kind: "folder", size: null, timestamp: 1 };

describe("VaultEntryRow", () => {
  it("shows a file's name and size", () => {
    render(<VaultEntryRow entry={file} onPress={jest.fn()} onMore={jest.fn()} />);
    expect(screen.getByTestId("vault-entry-f1")).toBeTruthy();
    expect(screen.getByText("photo.jpg")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
  });

  it("shows a folder by name, with no size line", () => {
    render(<VaultEntryRow entry={folder} onPress={jest.fn()} onMore={jest.fn()} />);
    expect(screen.getByTestId("vault-entry-d1")).toBeTruthy();
    expect(screen.getByText("Trip")).toBeTruthy();
    expect(screen.queryByText("0 B")).toBeNull();
  });

  it("opens the entry and its actions separately", () => {
    const onPress = jest.fn();
    const onMore = jest.fn();
    render(<VaultEntryRow entry={file} onPress={onPress} onMore={onMore} />);
    fireEvent.press(screen.getByTestId("vault-entry-f1"));
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId("vault-entry-more-f1"));
    expect(onMore).toHaveBeenCalledTimes(1);
  });
});
