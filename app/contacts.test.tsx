import { render, screen, fireEvent, waitFor, act, configure } from "@testing-library/react-native";

/**
 * The restore path awaits four calls in sequence (find the folder, list it,
 * get a download URL, read the file), and every button here is additionally
 * gated behind an async permission check that has to settle first. Each
 * waitFor only gets 1s by default, which is ample in isolation - this file
 * passes 11/11 on its own every time - but not when jest is running ~197
 * suites in parallel and the machine is saturated. The suite then failed
 * intermittently, 3 tests one run and 1 the next.
 *
 * Nothing here asserts on speed, so the budget is the wrong thing to be
 * strict about. No assertion is weakened - they all still have to come true.
 */
configure({ asyncUtilTimeout: 5000 });
// The screen declares its native header via Stack.Screen, which needs a navigator; stub it
// as the other screen suites do. useFocusEffect fires the effect on mount and runs its
// cleanup on unmount, exactly like a focused-then-blurred screen - without a
// NavigationContainer (same pattern as app/(tabs)/backup.test.tsx).
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(cb, []);
  },
}));
import { useWorkspaceStore } from "@/files/workspaceStore";

jest.mock("@/contacts/backupContacts", () => ({
  backupContacts: jest.fn(async () => ({ count: 3, fileName: "contacts-2026-07-12.vcf" })),
  getLastContactsBackupAt: jest.fn(async () => null),
}));
jest.mock("@/contacts/restoreContacts", () => ({ restoreContacts: jest.fn(async () => ({ added: 3, failed: 0 })) }));
jest.mock("@/backup/folders", () => ({ findContactsFolder: jest.fn(async () => "folder1") }));
jest.mock("@/files/api", () => ({
  listFiles: jest.fn(async () => ({
    files: [
      { id: "old", name: "contacts-2026-07-10.vcf", created_at: 100 },
      { id: "new", name: "contacts-2026-07-12.vcf", created_at: 200 },
    ],
    folders: [], breadcrumbs: [], pagination: { page: 1, per_page: 500, total_files: 2, total_pages: 1 },
  })),
  getDownloadUrl: jest.fn(async () => "https://r2/new"),
}));
jest.mock("@/files/download", () => ({ downloadToCache: jest.fn(async () => "file:///cache/contacts-2026-07-12.vcf") }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
// The priming card checks current status (without prompting) on mount, and
// only the Allow button ever calls requestPermissionsAsync. Default to
// "not yet granted" so the rationale is what a fresh mount paints first.
jest.mock("expo-contacts", () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: false, status: "undetermined" })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false, status: "denied" })),
}));

import ContactsScreen from "./contacts";
import { backupContacts } from "@/contacts/backupContacts";
import { restoreContacts } from "@/contacts/restoreContacts";
import { findContactsFolder } from "@/backup/folders";
import { getDownloadUrl } from "@/files/api";
import { toast } from "@/ui/toast";
import * as Contacts from "expo-contacts";

beforeEach(() => {
  useWorkspaceStore.setState({ activeId: "w1" });
  jest.clearAllMocks();
});

// These three exercise the backup/restore SUCCESS paths, which now require
// permission to already be granted - the buttons are gated on it (see the
// "does not fire the OS prompt... while access is not yet granted" tests
// below for the gate itself). Without this, every press here would be a
// no-op against a disabled button.
async function renderGranted() {
  (Contacts.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true, status: "granted" });
  render(<ContactsScreen />);
  await waitFor(() => expect(screen.queryByTestId("contacts-primer")).toBeNull());
}

describe("ContactsScreen", () => {
  it("backs up the active workspace and toasts the count", async () => {
    await renderGranted();
    fireEvent.press(screen.getByTestId("contacts-backup"));
    await waitFor(() => expect(backupContacts).toHaveBeenCalledWith("w1"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Backing up 3 contacts"));
  });

  it("restores from the newest .vcf in the Contacts folder", async () => {
    await renderGranted();
    fireEvent.press(screen.getByTestId("contacts-restore"));
    await waitFor(() => expect(getDownloadUrl).toHaveBeenCalledWith("new"));
    await waitFor(() => expect(restoreContacts).toHaveBeenCalledWith("file:///cache/contacts-2026-07-12.vcf"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Added 3 contacts", "success"));
  });

  it("reports when no contacts backup exists (and creates no folders)", async () => {
    (findContactsFolder as jest.Mock).mockResolvedValueOnce(null);
    await renderGranted();
    fireEvent.press(screen.getByTestId("contacts-restore"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("No contacts backup found", "error"));
  });

  it("explains why before asking for the address book", () => {
    render(<ContactsScreen />);
    expect(screen.getByText(/exported as a single \.vcf file/i)).toBeTruthy();
    expect(Contacts.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("asks only when the user acts on the rationale", async () => {
    (Contacts.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    render(<ContactsScreen />);
    fireEvent.press(screen.getByTestId("contacts-allow"));
    await waitFor(() => expect(Contacts.requestPermissionsAsync).toHaveBeenCalledTimes(1));
  });

  // Same in-flight guard as WorkspaceStep's onCreate (see its own "before the
  // button can disable itself" test): both presses land inside one act()
  // batch, so no render commits between them and the button is still
  // "enabled" for the second dispatch too - a same-tick ref is the only thing
  // that stops a real device queuing a second touch before the OS prompt
  // (or the button's own disabled state) has a chance to appear.
  it("asks exactly once even if a second tap lands before the button can disable itself", async () => {
    let resolveRequest!: (res: { granted: boolean }) => void;
    (Contacts.requestPermissionsAsync as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveRequest = resolve; }),
    );
    render(<ContactsScreen />);
    const allow = screen.getByTestId("contacts-allow");
    await act(async () => {
      fireEvent.press(allow);
      fireEvent.press(allow);
    });
    await act(async () => { resolveRequest({ granted: true }); });
    await waitFor(() => expect(screen.queryByTestId("contacts-primer")).toBeNull());
    expect(Contacts.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("leaves the rest of the screen usable after a denial", async () => {
    (Contacts.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    render(<ContactsScreen />);
    fireEvent.press(screen.getByTestId("contacts-allow"));
    await waitFor(() => expect(screen.getByText(/declined/i)).toBeTruthy());
    // The ask disappears once declined (the OS will not re-prompt), but the
    // backup/restore controls are not trapped behind it: they're still on
    // screen (not removed, not a dead end) - even though pressing them stays
    // gated (see "does not fire the OS prompt cold" below), which a denial
    // does not lift, since re-requesting would just be silently denied again.
    expect(screen.queryByTestId("contacts-allow")).toBeNull();
    expect(screen.getByTestId("contacts-backup")).toBeTruthy();
    expect(screen.getByTestId("contacts-backup").props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByTestId("contacts-restore")).toBeTruthy();
    expect(screen.getByTestId("contacts-restore").props.accessibilityState?.disabled).toBe(true);
  });

  // Regression: the pre-existing "Back up contacts now" / "Restore from
  // latest backup" buttons are gated only on activeId, not on permission.
  // They reach backupContacts/restoreContacts, which call
  // Contacts.requestPermissionsAsync() themselves - so a user who ignores
  // the primer and presses one of these FIRST gets the native OS dialog
  // cold, with no rationale ever shown. That also makes the primer's own
  // "Access only happens when you tap Allow" line false. Every OTHER test
  // in this file only ever presses contacts-allow, which is why the suite
  // was blind to this path.
  it("does not fire the OS prompt from 'Back up contacts now' while access is not yet granted", () => {
    render(<ContactsScreen />);
    fireEvent.press(screen.getByTestId("contacts-backup"));
    expect(backupContacts).not.toHaveBeenCalled();
    expect(Contacts.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("does not fire the OS prompt from 'Restore from latest backup' while access is not yet granted", async () => {
    render(<ContactsScreen />);
    fireEvent.press(screen.getByTestId("contacts-restore"));
    // restoreContacts sits behind an async chain (findContactsFolder ->
    // listFiles -> getDownloadUrl -> downloadToCache). `waitFor` on a "not
    // called" assertion would resolve on its very first (already-true) poll
    // and prove nothing, so give an UN-gated chain a real chance to run to
    // completion before asserting it never got there.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(restoreContacts).not.toHaveBeenCalled();
    expect(Contacts.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("re-checks permission when the screen regains focus, so an already-permitted user is not told to tap Allow again", async () => {
    const { unmount } = render(<ContactsScreen />);
    expect(await screen.findByTestId("contacts-primer")).toBeTruthy();
    unmount(); // simulates losing focus (see the useFocusEffect mock above)

    // Access was granted OUTSIDE this screen (e.g. the user went to device
    // Settings and back) while it was not focused - local state from a
    // previous onAllow() call would never see that.
    (Contacts.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true, status: "granted" });
    render(<ContactsScreen />); // simulates regaining focus
    await waitFor(() => expect(screen.queryByTestId("contacts-primer")).toBeNull());
  });

  it("unlocks the backup/restore buttons once access is granted", async () => {
    (Contacts.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true, status: "granted" });
    render(<ContactsScreen />);
    await waitFor(() => expect(screen.queryByTestId("contacts-primer")).toBeNull());
    fireEvent.press(screen.getByTestId("contacts-backup"));
    await waitFor(() => expect(backupContacts).toHaveBeenCalledWith("w1"));
  });
});
