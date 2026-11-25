import { fireEvent, render, screen } from "@testing-library/react-native";
import { MoveConfirmDialog, moveConfirmMessage } from "./MoveConfirmDialog";
import { t } from "@/lib/i18n";

const nameOf = (kind: "file" | "folder", id: string) => (kind === "file" ? { f1: "doc.pdf" } : { d1: "Vacation" })[id as "f1" | "d1"] ?? null;

describe("moveConfirmMessage", () => {
  it("names the one file being moved", () => {
    expect(moveConfirmMessage({ fileIds: ["f1"], folderIds: [] }, "Archive", nameOf, t)).toBe("You are moving doc.pdf to Archive.");
  });
  it("names the one folder being moved", () => {
    expect(moveConfirmMessage({ fileIds: [], folderIds: ["d1"] }, "Archive", nameOf, t)).toBe("You are moving Vacation to Archive.");
  });
  it("counts files when several files move", () => {
    expect(moveConfirmMessage({ fileIds: ["f1", "f2"], folderIds: [] }, "Archive", nameOf, t)).toBe("You are moving 2 files to Archive.");
  });
  it("counts folders when several folders move", () => {
    expect(moveConfirmMessage({ fileIds: [], folderIds: ["d1", "d2"] }, "Archive", nameOf, t)).toBe("You are moving 2 folders to Archive.");
  });
  it("counts both when files and folders move together", () => {
    expect(moveConfirmMessage({ fileIds: ["f1"], folderIds: ["d1", "d2"] }, "Archive", nameOf, t)).toBe("You are moving 1 file and 2 folders to Archive.");
  });
  it("falls back to the count when the single item's name is unknown", () => {
    expect(moveConfirmMessage({ fileIds: ["gone"], folderIds: [] }, "Archive", nameOf, t)).toBe("You are moving 1 file to Archive.");
  });
});

describe("MoveConfirmDialog", () => {
  it("asks before moving and fires onConfirm from the Move button", () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    render(
      <MoveConfirmDialog
        visible
        items={{ fileIds: ["f1"], folderIds: [] }}
        target={{ id: "d9", name: "Archive" }}
        nameOf={nameOf}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("Are you sure?")).toBeTruthy();
    expect(screen.getByText("You are moving doc.pdf to Archive.")).toBeTruthy();
    fireEvent.press(screen.getByText("Move"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
