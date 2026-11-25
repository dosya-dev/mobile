import { StyleSheet } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { ArchiveList, iconKind } from "./ArchiveList";
import { TOKENS_LIGHT } from "@/theme/tokens";
import type { TreeNode } from "./archiveTree";

function dir(over: Partial<TreeNode> = {}): TreeNode {
  return {
    kind: "dir", name: "photos", index: null, size: 0, method: 0, encrypted: false,
    mtime: null, children: [], totalBytes: 0, fileCount: 3, ...over,
  };
}

function file(over: Partial<TreeNode> = {}): TreeNode {
  return {
    kind: "file", name: "report.pdf", index: 0, size: 0, method: 8, encrypted: false,
    mtime: null, children: [], totalBytes: 0, fileCount: 1, ...over,
  };
}

describe("ArchiveList", () => {
  it("shows a folder row with its child item count", () => {
    render(<ArchiveList nodes={[dir({ fileCount: 3 })]} onOpenDir={jest.fn()} onOpenFile={jest.fn()} />);
    expect(screen.getByText("photos")).toBeTruthy();
    expect(screen.getByText("3 items")).toBeTruthy();
  });

  it("shows a file row with its size", () => {
    render(
      <ArchiveList
        nodes={[file({ name: "report.pdf", size: 5 * 1024 * 1024, method: 8 })]}
        onOpenDir={jest.fn()}
        onOpenFile={jest.fn()}
      />,
    );
    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(screen.getByText(/5\.0 MB/)).toBeTruthy();
  });

  it("marks a password-protected entry disabled, with an accessible reason and the muted colour - never opacity", () => {
    render(
      <ArchiveList
        nodes={[file({ name: "secret.psd", encrypted: true, method: 0 })]}
        onOpenDir={jest.fn()}
        onOpenFile={jest.fn()}
      />,
    );
    const row = screen.getByTestId("archive-entry-secret.psd");
    expect(row.props.accessibilityState).toEqual({ disabled: true });
    expect(row.props.accessibilityHint).toMatch(/password-protected/i);

    const nameText = screen.getByText("secret.psd");
    const flat = StyleSheet.flatten(nameText.props.style);
    expect(flat.color).toBe(TOKENS_LIGHT.mutedForeground);
    // Dimming a refused row's text with opacity would drop it under the AA
    // floor this project publishes - the muted colour token is the only
    // thing allowed to make it read as de-emphasised.
    expect(flat.opacity).toBeUndefined();

    expect(screen.getByText("Password-protected")).toBeTruthy();
  });

  it("marks an entry with an unsupported compression method disabled, with its own reason", () => {
    render(
      <ArchiveList
        nodes={[file({ name: "old.zip", encrypted: false, method: 99 })]}
        onOpenDir={jest.fn()}
        onOpenFile={jest.fn()}
      />,
    );
    const row = screen.getByTestId("archive-entry-old.zip");
    expect(row.props.accessibilityState).toEqual({ disabled: true });
    expect(row.props.accessibilityHint).toMatch(/compression method/i);
    expect(screen.getByText("Unsupported compression")).toBeTruthy();
  });

  it("opens a directory on press", () => {
    const onOpenDir = jest.fn();
    render(<ArchiveList nodes={[dir({ name: "photos" })]} onOpenDir={onOpenDir} onOpenFile={jest.fn()} />);
    fireEvent.press(screen.getByTestId("archive-dir-photos"));
    expect(onOpenDir).toHaveBeenCalledWith(expect.objectContaining({ name: "photos" }));
  });

  it("opens an openable file on press", () => {
    const onOpenFile = jest.fn();
    render(
      <ArchiveList
        nodes={[file({ name: "report.pdf", method: 8 })]}
        onOpenDir={jest.fn()}
        onOpenFile={onOpenFile}
      />,
    );
    fireEvent.press(screen.getByTestId("archive-entry-report.pdf"));
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ name: "report.pdf" }));
  });

  it("never opens a refused entry, even if something presses it anyway", () => {
    const onOpenFile = jest.fn();
    render(
      <ArchiveList
        nodes={[file({ name: "secret.psd", encrypted: true })]}
        onOpenDir={jest.fn()}
        onOpenFile={onOpenFile}
      />,
    );
    fireEvent.press(screen.getByTestId("archive-entry-secret.psd"));
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  // fileKind's own extension fallback only covers image/book/text/office - it
  // has no extension guess for video/audio/pdf (MIME-only there), and an
  // archive entry carries no MIME. Without ArchiveList's own local check
  // these three kinds fell through to the generic document glyph.
  // Tested as the pure function rather than through a rendered Ionicons prop:
  // Ionicons renders a bare, prop-less placeholder until its font finishes
  // loading (an async, real state update even under the jest mock), which
  // makes asserting a rendered icon's `name` prop flaky. iconKind is exported
  // from ArchiveList.tsx specifically so this doesn't need to fight that.
  it("picks the video/audio/pdf kind from the extension, not the generic 'other' fallback", () => {
    // fileKind's own extension fallback only covers image/book/text/office -
    // it has no extension guess for video/audio/pdf (MIME-only there), and an
    // archive entry carries no MIME. Without this, all three fell through to
    // the generic document glyph.
    expect(iconKind("clip.mp4")).toBe("video");
    expect(iconKind("track.mp3")).toBe("audio");
    expect(iconKind("scan.pdf")).toBe("pdf");
    // Controls: image is already correctly detected via fileKind's own
    // extension fallback, and a genuinely unknown extension still falls
    // through to "other" rather than guessing wrong.
    expect(iconKind("photo.png")).toBe("image");
    expect(iconKind("payload.bin")).toBe("other");
  });
});
