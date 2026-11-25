import { render, screen, fireEvent } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FileActionsSheet } from "./FileActionsSheet";
import { finishSheetDismissal } from "@/ui/sheetTesting";

const file = { id: "f1", name: "a.txt", size_bytes: 1, mime_type: "text/plain", extension: "txt", created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0 };
const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: 0}, mutations: { gcTime: 0 } } })}>{ui}</QueryClientProvider>;
jest.mock("@/files/workspaceStore", () => ({ useWorkspaceStore: (sel: any) => sel({ activeId: "w1" }) }));

describe("FileActionsSheet", () => {
  it("shows the core actions", () => {
    render(wrap(<FileActionsSheet file={file as any} visible onClose={() => {}} onMove={() => {}} onCopy={() => {}} onVersions={() => {}} onRename={() => {}} onDelete={() => {}} onShare={() => {}} onLock={() => {}} onToggleHidden={() => {}} onComments={() => {}} canLock canHide />));
    expect(screen.getByText("Rename")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
    expect(screen.getByText("Add to favourites")).toBeTruthy();
    expect(screen.getByText("Share")).toBeTruthy();
  });

  // Regression test for the Phase 2b unmount bug: Rename/Delete used to open a dialog
  // that lived *inside* this sheet, so onClose() (fired by the same row press) unmounted
  // the sheet - and the dialog with it - before the local state update could render.
  // The fix delegates to parent-owned callbacks instead of local state; verify the
  // delegation happens so the dialogs (now hosted in FileBrowser) survive the unmount.
  it("delegates Rename taps to the onRename callback with the file", () => {
    const onRename = jest.fn();
    render(wrap(<FileActionsSheet file={file as any} visible onClose={() => {}} onMove={() => {}} onCopy={() => {}} onVersions={() => {}} onRename={onRename} onDelete={() => {}} onShare={() => {}} onLock={() => {}} onToggleHidden={() => {}} onComments={() => {}} canLock canHide />));
    fireEvent.press(screen.getByText("Rename"));
    finishSheetDismissal();
    expect(onRename).toHaveBeenCalledWith(file);
  });

  it("delegates Comments taps to the onComments callback with the file", () => {
    const onComments = jest.fn();
    render(wrap(<FileActionsSheet file={file as any} visible onClose={() => {}} onMove={() => {}} onCopy={() => {}} onVersions={() => {}} onRename={() => {}} onDelete={() => {}} onShare={() => {}} onLock={() => {}} onToggleHidden={() => {}} onComments={onComments} canLock canHide />));
    fireEvent.press(screen.getByText("Comments"));
    finishSheetDismissal();
    expect(onComments).toHaveBeenCalledWith(file);
  });

  it("delegates Delete taps to the onDelete callback with the file", () => {
    const onDelete = jest.fn();
    render(wrap(<FileActionsSheet file={file as any} visible onClose={() => {}} onMove={() => {}} onCopy={() => {}} onVersions={() => {}} onRename={() => {}} onDelete={onDelete} onShare={() => {}} onLock={() => {}} onToggleHidden={() => {}} onComments={() => {}} canLock canHide />));
    fireEvent.press(screen.getByText("Delete"));
    finishSheetDismissal();
    expect(onDelete).toHaveBeenCalledWith(file);
  });

  it("delegates Share taps to the onShare callback with the file", () => {
    const onShare = jest.fn();
    render(wrap(<FileActionsSheet file={file as any} visible onClose={() => {}} onMove={() => {}} onCopy={() => {}} onVersions={() => {}} onRename={() => {}} onDelete={() => {}} onShare={onShare} onLock={() => {}} onToggleHidden={() => {}} onComments={() => {}} canLock canHide />));
    fireEvent.press(screen.getByText("Share"));
    finishSheetDismissal();
    expect(onShare).toHaveBeenCalledWith(file);
  });

  it("offers Lock and Hide rows", () => {
    render(wrap(<FileActionsSheet file={file as any} visible onClose={() => {}} onMove={() => {}} onCopy={() => {}} onVersions={() => {}} onRename={() => {}} onDelete={() => {}} onShare={() => {}} onLock={() => {}} onToggleHidden={() => {}} onComments={() => {}} canLock canHide />));
    expect(screen.getByText("Lock")).toBeTruthy();
    expect(screen.getByText("Hide")).toBeTruthy();
  });

  it("delegates Lock taps with the file", () => {
    const onLock = jest.fn();
    render(wrap(<FileActionsSheet file={file as any} visible onClose={() => {}} onMove={() => {}} onCopy={() => {}} onVersions={() => {}} onRename={() => {}} onDelete={() => {}} onShare={() => {}} onLock={onLock} onToggleHidden={() => {}} onComments={() => {}} canLock canHide />));
    fireEvent.press(screen.getByText("Lock"));
    finishSheetDismissal();
    expect(onLock).toHaveBeenCalledWith(file);
  });

  it("names the current lock state on the Lock row so it is not a blind toggle", () => {
    const locked = { ...file, lock_mode: "view_only" };
    render(wrap(<FileActionsSheet file={locked as any} visible onClose={() => {}} onMove={() => {}} onCopy={() => {}} onVersions={() => {}} onRename={() => {}} onDelete={() => {}} onShare={() => {}} onLock={() => {}} onToggleHidden={() => {}} onComments={() => {}} canLock canHide />));
    expect(screen.getByText("Lock - View only")).toBeTruthy();
  });

  it("does NOT put a hide state on the Lock row", () => {
    // describeProtection reports the strongest state it is given, so passing the
    // whole file would print "Hidden from specific roles" onto the Lock row.
    const hidden = { ...file, lock_mode: "none", is_hidden: 1, hidden_mode: "roles" };
    render(wrap(<FileActionsSheet file={hidden as any} visible onClose={() => {}} onMove={() => {}} onCopy={() => {}} onVersions={() => {}} onRename={() => {}} onDelete={() => {}} onShare={() => {}} onLock={() => {}} onToggleHidden={() => {}} onComments={() => {}} canLock canHide />));
    expect(screen.getByText("Lock")).toBeTruthy();
    expect(screen.getByText("Unhide - Hidden from specific roles")).toBeTruthy();
  });

  it("shows Unhide for an already-hidden file", () => {
    const hidden = { ...file, is_hidden: 1, hidden_mode: "everyone" };
    render(wrap(<FileActionsSheet file={hidden as any} visible onClose={() => {}} onMove={() => {}} onCopy={() => {}} onVersions={() => {}} onRename={() => {}} onDelete={() => {}} onShare={() => {}} onLock={() => {}} onToggleHidden={() => {}} onComments={() => {}} canLock canHide />));
    expect(screen.getByText("Unhide - Hidden from everybody")).toBeTruthy();
  });

  // The cases above all pass canLock/canHide because they are ABOUT those rows.
  // This one is the reason the props exist: lock_files and hide_files are
  // seeded owner-only, so for nearly every member these rows are two taps that
  // can only ever produce a 403. The listing already tells us which it is
  // (can_lock / can_hide) - the sheet just has to read it.
  it("omits Lock and Hide when the role holds neither permission", () => {
    render(wrap(<FileActionsSheet file={file as any} visible onClose={() => {}} onMove={() => {}} onCopy={() => {}} onVersions={() => {}} onRename={() => {}} onDelete={() => {}} onShare={() => {}} onLock={() => {}} onToggleHidden={() => {}} onComments={() => {}} />));
    expect(screen.queryByText("Lock")).toBeNull();
    expect(screen.queryByText("Hide")).toBeNull();
    // The ungated rows are untouched - this hides two controls, not the sheet.
    expect(screen.getByText("Rename")).toBeTruthy();
    expect(screen.getByText("Add to favourites")).toBeTruthy();
  });

  it("can show one without the other", () => {
    render(wrap(<FileActionsSheet file={file as any} visible onClose={() => {}} onMove={() => {}} onCopy={() => {}} onVersions={() => {}} onRename={() => {}} onDelete={() => {}} onShare={() => {}} onLock={() => {}} onToggleHidden={() => {}} onComments={() => {}} canLock />));
    expect(screen.getByText("Lock")).toBeTruthy();
    expect(screen.queryByText("Hide")).toBeNull();
  });
});
