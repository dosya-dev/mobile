import { render, screen, fireEvent, waitFor, within } from "@testing-library/react-native";

// Spread-and-override, NOT an enumeration of the exports this screen happens
// to use today. Listing them by hand is what left formatBytes undefined inside
// the component once, crashing 14 tests with an opaque unmount error
// (react-test-renderer swallows the TypeError) - and it would do it again on
// the next export ChooseStep consumes.
jest.mock("../librarySize", () => ({
  ...jest.requireActual("../librarySize"),
  estimateLibrary: jest.fn(),
}));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));

// Babel's jest-hoist plugin forbids a jest.mock() factory from closing over
// an out-of-scope variable unless its name is `mock`-prefixed (the brief's
// plain `update`/`updateFilters` names fail with "module factory is not
// allowed to reference any out-of-scope variables" - this rename is the fix).
//
// These fakes MUTATE, rather than just recording their arguments. A settings
// double whose update() changes nothing cannot show that a later call read a
// stale flag - which is exactly the class of bug this screen shipped.
let mockSettings: Record<string, unknown> = {};
const mockUpdate = jest.fn(async (patch: Record<string, unknown>) => {
  mockSettings = { ...mockSettings, ...patch };
});
const mockUpdateFilters = jest.fn(async (patch: Record<string, unknown>) => {
  mockSettings = {
    ...mockSettings,
    filters: { ...(mockSettings.filters as Record<string, unknown>), ...patch },
  };
});
jest.mock("@/backup/settings", () => ({
  useBackupSettings: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ settings: mockSettings }),
    { getState: () => ({ update: mockUpdate, updateFilters: mockUpdateFilters }) },
  ),
  DEFAULT_BACKUP_SETTINGS: jest.requireActual("@/backup/settings").DEFAULT_BACKUP_SETTINGS,
}));

// What ensureAlbumDefaults actually read when it ran. The real one
// early-returns - and LATCHES albumDefaultsApplied, so it can never run again -
// unless settings.filtersMigrated is already true (see backup/albumDefaults.ts).
// A double that just resolves is blind to being called too early, which is how
// the Android camera-roll narrowing could be permanently skipped with a green
// suite.
let mockMigratedWhenAlbumDefaultsRan: boolean | null = null;
jest.mock("@/backup/albumDefaults", () => ({
  ensureAlbumDefaults: jest.fn(async () => {
    mockMigratedWhenAlbumDefaultsRan = mockSettings.filtersMigrated === true;
  }),
}));
jest.mock("@/files/hooks", () => ({ useWorkspaceStorage: jest.fn() }));

import { DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";
import { estimateLibrary } from "../librarySize";
import { ensureAlbumDefaults } from "@/backup/albumDefaults";
import { useWorkspaceStorage } from "@/files/hooks";
import { toast } from "@/ui/toast";
import { ChooseStep } from "./ChooseStep";

const props = { workspaceId: "ws1", limited: false, onDone: jest.fn(), onSkip: jest.fn() };

// Plan capacities are BINARY everywhere else in the product
// (packages/shared/src/constants.ts: GB = 1_073_741_824), so the fixtures here
// are too - a decimal fixture would only prove a decimal formatter right.
const GIB = 1_073_741_824;
const FIVE_GB = 5 * GIB;
const ONE_TB = 1_099_511_627_776;

beforeEach(() => {
  jest.clearAllMocks();
  // filtersMigrated starts FALSE, which is what DEFAULT_BACKUP_SETTINGS says
  // and what an account that signed in after another one signed out actually
  // has in memory (resetBackupSettings puts it back; hydrate() only runs at
  // app mount).
  mockSettings = { ...DEFAULT_BACKUP_SETTINGS };
  mockMigratedWhenAlbumDefaultsRan = null;
  // A real 5 GB plan, in the binary base packages/shared uses for plan sizes.
  (useWorkspaceStorage as jest.Mock).mockReturnValue({ data: { used: 0, total: FIVE_GB, free: FIVE_GB } });
  (estimateLibrary as jest.Mock).mockResolvedValue({ photos: 12483, videos: 402, estimatedBytes: 60 * GIB });
});

describe("ChooseStep", () => {
  it("shows exact counts", async () => {
    render(<ChooseStep {...props} />);
    expect(await screen.findByText(/12,483/)).toBeTruthy();
  });

  it("hedges the size, because it is sampled", async () => {
    render(<ChooseStep {...props} />);
    expect((await screen.findByTestId("step-subtitle")).props.children).toMatch(/about 60\.0 GB/);
  });

  it("warns when the selection exceeds the plan, using the real plan size", async () => {
    render(<ChooseStep {...props} />);
    expect(await screen.findByTestId("storage-warning")).toBeTruthy();
  });

  // The warning used a DECIMAL formatter private to this feature, so a 5 GB
  // plan printed as "5.4 GB" - a figure that appears nowhere else in the
  // product (StorageBar, WorkspaceSwitcher and the pricing page all say 5 GB),
  // inside the one warning whose whole job is to be believed.
  it("names the plan the way the rest of the app names it, not 5.4 GB", async () => {
    render(<ChooseStep {...props} />);
    const warning = await screen.findByTestId("storage-warning");
    expect(warning).toHaveTextContent(/Your plan holds 5\.0 GB/);
    expect(screen.queryByText(/5\.4 GB/)).toBeNull();
  });

  it("stays quiet when the selection fits", async () => {
    (estimateLibrary as jest.Mock).mockResolvedValue({ photos: 10, videos: 0, estimatedBytes: 1_000_000 });
    render(<ChooseStep {...props} />);
    await screen.findByText(/10/);
    expect(screen.queryByTestId("storage-warning")).toBeNull();
  });

  it("suppresses the warning rather than guessing when no estimate exists", async () => {
    (estimateLibrary as jest.Mock).mockResolvedValue({ photos: 10, videos: 0, estimatedBytes: null });
    render(<ChooseStep {...props} />);
    await screen.findByText(/10/);
    expect(screen.queryByTestId("storage-warning")).toBeNull();
  });

  it("persists the selection into the existing settings shape", async () => {
    render(<ChooseStep {...props} />);
    await screen.findByTestId("step-primary");
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(mockUpdateFilters).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ["photo", "video"] }),
    ));
  });

  it("marks filters as migrated, retiring the one-time card for new installs", async () => {
    render(<ChooseStep {...props} />);
    await screen.findByTestId("step-primary");
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ filtersMigrated: true }),
    ));
  });

  it("resolves Android album defaults so it does not back up every app's media", async () => {
    render(<ChooseStep {...props} />);
    await screen.findByTestId("step-primary");
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(ensureAlbumDefaults).toHaveBeenCalled());
  });

  // Calling it is not enough: it early-returns, and latches itself off for
  // good, unless filtersMigrated is ALREADY true when it runs. Called first,
  // it silently did nothing - and every backup then covered all of MediaStore
  // (WhatsApp media, screenshots, Telegram caches, Downloads).
  it("writes filtersMigrated BEFORE resolving album defaults, or the narrowing never happens", async () => {
    render(<ChooseStep {...props} />);
    await screen.findByTestId("step-primary");
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(ensureAlbumDefaults).toHaveBeenCalled());
    expect(mockMigratedWhenAlbumDefaultsRan).toBe(true);
  });

  it("pins the call order itself, not just its observable effect", async () => {
    render(<ChooseStep {...props} />);
    await screen.findByTestId("step-primary");
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(ensureAlbumDefaults).toHaveBeenCalled());
    expect(mockUpdate.mock.invocationCallOrder[0])
      .toBeLessThan((ensureAlbumDefaults as jest.Mock).mock.invocationCallOrder[0]);
  });

  it("keeps the album selection ensureAlbumDefaults made, rather than writing filters over it", async () => {
    (ensureAlbumDefaults as jest.Mock).mockImplementationOnce(async () => {
      mockMigratedWhenAlbumDefaultsRan = mockSettings.filtersMigrated === true;
      await mockUpdateFilters({ albumMode: "include", albumIds: ["cam"] });
    });
    render(<ChooseStep {...props} />);
    await screen.findByTestId("step-primary");
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(mockSettings.filters).toEqual(
      expect.objectContaining({ albumMode: "include", albumIds: ["cam"], mediaTypes: ["photo", "video"] }),
    );
  });

  it("drops videos from the selection when toggled off", async () => {
    render(<ChooseStep {...props} />);
    fireEvent.press(await screen.findByTestId("toggle-video"));
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(mockUpdateFilters).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ["photo"] }),
    ));
  });

  it("says the counts cover only hand-picked photos under limited access", async () => {
    render(<ChooseStep {...props} limited />);
    expect(await screen.findByText(/only the photos you selected/i)).toBeTruthy();
  });

  it("says nothing about selection when access is full", async () => {
    render(<ChooseStep {...props} />);
    await screen.findByText(/12,483/);
    expect(screen.queryByText(/only the photos you selected/i)).toBeNull();
  });

  it("keeps the shipped connectivity defaults", async () => {
    render(<ChooseStep {...props} />);
    await screen.findByTestId("step-primary");
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ wifiOnly: true, chargingOnly: false }),
    ));
  });
});

// DATE_RANGES.floor() reads Date.now(), so the clock is pinned here rather
// than asserted against the live clock - otherwise the 12-month case would be
// flaky within a millisecond of a day boundary, and every assertion below
// would be a moving target.
describe("ChooseStep date range math", () => {
  const FIXED_NOW_MS = new Date("2026-01-15T00:00:00.000Z").getTime();
  const FIXED_NOW_S = Math.floor(FIXED_NOW_MS / 1000);
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it("sends a genuine null floor for All time, not 0 - 0 is a real timestamp and would be treated as a floor", async () => {
    render(<ChooseStep {...props} />);
    fireEvent.press(await screen.findByTestId("range-all"));
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(mockUpdateFilters).toHaveBeenCalledWith(
      expect.objectContaining({ dateFloor: null }),
    ));
  });

  it("sends today's floor in unix seconds, not milliseconds", async () => {
    render(<ChooseStep {...props} />);
    fireEvent.press(await screen.findByTestId("range-today"));
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(mockUpdateFilters).toHaveBeenCalledWith(
      expect.objectContaining({ dateFloor: FIXED_NOW_S }),
    ));
    // A milliseconds value would be ~1000x FIXED_NOW_S and comfortably past
    // this - a wrong unit here would silently exclude the entire library.
    const calls = mockUpdateFilters.mock.calls as unknown as { dateFloor: number }[][];
    expect(calls[calls.length - 1][0].dateFloor).toBeLessThan(2_000_000_000);
  });

  it("sends a 12-months-ago floor in unix seconds", async () => {
    render(<ChooseStep {...props} />);
    // "12mo" is already the default selection, but press it explicitly so
    // this assertion does not silently depend on that default never changing.
    fireEvent.press(await screen.findByTestId("range-12mo"));
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(mockUpdateFilters).toHaveBeenCalledWith(
      expect.objectContaining({ dateFloor: FIXED_NOW_S - 365 * 86_400 }),
    ));
  });

  it("passes the selected floor into the re-estimate, not just into the saved filters", async () => {
    render(<ChooseStep {...props} />);
    fireEvent.press(await screen.findByTestId("range-today"));
    await waitFor(() => expect(estimateLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ dateFloor: FIXED_NOW_S }),
    ));
  });
});

// Every test above mocks the plan total to exactly 5 GB, which happens to
// equal a free-plan figure someone could hardcode by mistake - all 12 would
// still pass a regression that reintroduced a literal 5 GB. These pin the
// screen to whatever useWorkspaceStorage actually returns.
describe("ChooseStep plan size comes from the account, never a hardcoded figure", () => {
  it("stays quiet against a 1 TB plan for a selection well under it", async () => {
    (useWorkspaceStorage as jest.Mock).mockReturnValue({ data: { used: 0, total: ONE_TB, free: ONE_TB } });
    render(<ChooseStep {...props} />);
    await screen.findByText(/12,483/);
    expect(screen.queryByTestId("storage-warning")).toBeNull();
  });

  it("warns against a 1 TB plan when the selection exceeds it, naming the real 1 TB figure, not 5 GB", async () => {
    (useWorkspaceStorage as jest.Mock).mockReturnValue({ data: { used: 0, total: ONE_TB, free: ONE_TB } });
    (estimateLibrary as jest.Mock).mockResolvedValue({
      photos: 999_999, videos: 1, estimatedBytes: 2 * ONE_TB,
    });
    render(<ChooseStep {...props} />);
    const warning = await screen.findByTestId("storage-warning");
    // Scoped to the warning itself: the pinned running total in the footer
    // names the same plan size, so an unscoped query now matches twice.
    expect(within(warning).getByText(/1\.00 TB/)).toBeTruthy();
    expect(screen.queryByText(/5\.0 GB/)).toBeNull();
  });
});

// The screen had a try/finally with NO catch, so any throw stopped the spinner
// and left the primary action doing nothing at all, forever, with nothing on
// screen to say why.
describe("ChooseStep never becomes a silent dead end", () => {
  it("surfaces a failed settings write instead of swallowing it", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("keychain unavailable"));
    render(<ChooseStep {...props} />);
    await screen.findByTestId("step-primary");
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("keychain unavailable", "error"));
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it("surfaces a failed album-defaults resolution too", async () => {
    (ensureAlbumDefaults as jest.Mock).mockRejectedValueOnce(new Error("media library unavailable"));
    render(<ChooseStep {...props} />);
    await screen.findByTestId("step-primary");
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("media library unavailable", "error"));
  });

  it("re-enables the primary action after a failure, so the user can try again", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("offline"));
    render(<ChooseStep {...props} />);
    await screen.findByTestId("step-primary");
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(toast).toHaveBeenCalled());

    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
  });
});

describe("ChooseStep estimate-unavailable copy", () => {
  it("gives honest copy when the estimate is unavailable, instead of promising a number forever", async () => {
    (estimateLibrary as jest.Mock).mockResolvedValue(null);
    render(<ChooseStep {...props} />);
    expect(await screen.findByText(/couldn't check your library/i)).toBeTruthy();
    expect(screen.queryByText(/Checking your library/i)).toBeNull();
  });
});
