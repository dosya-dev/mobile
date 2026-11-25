import { render, screen, fireEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import { UpdateRow } from "./UpdateRow";
import { __resetSideloadUpdateCache } from "./useSideloadUpdate";
import * as runtime from "./runtime";
import * as check from "./sideloadUpdate";

jest.mock("./runtime");

const AVAILABLE = {
  status: "available" as const,
  version: "1.2.0",
  versionCode: 20,
  sizeBytes: 68_000_000,
  downloadPageUrl: "https://dosya.dev/mobile/",
};

function arrange(opts: {
  channel?: "direct" | "play";
  installed?: number | null;
  result?: check.UpdateCheck;
}) {
  jest.spyOn(runtime, "getDistributionChannel").mockReturnValue(opts.channel ?? "direct");
  jest.spyOn(runtime, "getInstalledVersionCode").mockReturnValue(
    opts.installed === undefined ? 14 : opts.installed,
  );
  return jest
    .spyOn(check, "checkForUpdate")
    .mockResolvedValue(opts.result ?? AVAILABLE);
}

beforeEach(() => {
  __resetSideloadUpdateCache();
  jest.restoreAllMocks();
});

describe("UpdateRow", () => {
  it("offers the new version when one is published", async () => {
    arrange({});
    render(<UpdateRow />);
    expect(await screen.findByTestId("sideload-update-row")).toBeTruthy();
    expect(screen.getByText("Version 1.2.0 is available")).toBeTruthy();
  });

  it("shows the download size so the user can decide on mobile data", async () => {
    arrange({});
    render(<UpdateRow />);
    await screen.findByTestId("sideload-update-row");
    // 68_000_000 bytes, rendered in MiB by formatBytes.
    expect(screen.getByText(/64\.8 MB/)).toBeTruthy();
  });

  it("opens the download page rather than installing in-app", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    arrange({});
    render(<UpdateRow />);
    fireEvent.press(await screen.findByTestId("sideload-update-row"));
    expect(openURL).toHaveBeenCalledWith("https://dosya.dev/mobile/");
  });

  it("renders nothing when the build is current", async () => {
    arrange({ result: { status: "up-to-date", versionCode: 14 } });
    render(<UpdateRow />);
    expect(screen.queryByTestId("sideload-update-row")).toBeNull();
  });

  it("renders nothing when the check fails", async () => {
    arrange({ result: { status: "unavailable", reason: "offline" } });
    render(<UpdateRow />);
    expect(screen.queryByTestId("sideload-update-row")).toBeNull();
  });

  // The load-bearing case: a Play build must not prompt for an APK that
  // Android will refuse to install over it.
  it("never even checks on a Play build", async () => {
    const spy = arrange({ channel: "play" });
    render(<UpdateRow />);
    expect(screen.queryByTestId("sideload-update-row")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("never even checks when the installed version is unknown (iOS)", async () => {
    const spy = arrange({ installed: null });
    render(<UpdateRow />);
    expect(screen.queryByTestId("sideload-update-row")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("checks once across remounts rather than on every visit to Settings", async () => {
    const spy = arrange({});
    const first = render(<UpdateRow />);
    await screen.findByTestId("sideload-update-row");
    first.unmount();
    render(<UpdateRow />);
    await screen.findByTestId("sideload-update-row");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // Offline is the usual reason a check fails, and pinning that for six hours
  // would hide a real update for the rest of the day.
  it("retries after a failed check instead of caching the failure", async () => {
    const spy = arrange({ result: { status: "unavailable", reason: "offline" } });
    const first = render(<UpdateRow />);
    // Let the first check settle before remounting.
    await new Promise((r) => setTimeout(r, 0));
    first.unmount();
    spy.mockResolvedValue(AVAILABLE);
    render(<UpdateRow />);
    expect(await screen.findByTestId("sideload-update-row")).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
