jest.mock("@/backup/policy", () => ({ readPolicyInputs: jest.fn() }));

import { Text } from "react-native";
import { render, screen, waitFor } from "@testing-library/react-native";
import { deriveNetworkKind, useNetworkKind } from "./network";
import { readPolicyInputs } from "@/backup/policy";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";
import { usePacing } from "@/upload/pacing";

function Probe({ runActive }: { runActive: boolean }) {
  const kind = useNetworkKind(runActive);
  return <Text testID="net">{kind ?? "none"}</Text>;
}

beforeEach(() => {
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
  usePacing.setState({ policyOverride: { wifi: false, charging: false } });
  jest.clearAllMocks();
});

describe("deriveNetworkKind", () => {
  it("covers the full matrix", () => {
    const base = { connected: true, onWifi: false, wifiOnly: false, backupRelevant: true };
    expect(deriveNetworkKind({ ...base })).toBe("cellular-data");
    expect(deriveNetworkKind({ ...base, wifiOnly: true })).toBe("waiting-for-wifi");
    expect(deriveNetworkKind({ ...base, onWifi: true })).toBeNull();
    expect(deriveNetworkKind({ ...base, connected: false })).toBe("offline");
    expect(deriveNetworkKind({ ...base, backupRelevant: false })).toBeNull();
  });
});

describe("useNetworkKind", () => {
  const cellular = () =>
    (readPolicyInputs as jest.Mock).mockResolvedValue({ connected: true, onWifi: false, charging: true, batteryPercent: 90 });

  it("reads mobile data when Wi-Fi is off and backups would run over cellular", async () => {
    cellular();
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true, wifiOnly: false } });
    render(<Probe runActive={false} />);
    await waitFor(() => expect(screen.getByTestId("net")).toHaveTextContent("cellular-data"));
  });

  it("reads a wait when wifiOnly gates the run", async () => {
    cellular();
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true, wifiOnly: true } });
    render(<Probe runActive={false} />);
    await waitFor(() => expect(screen.getByTestId("net")).toHaveTextContent("waiting-for-wifi"));
  });

  it("reads nothing on Wi-Fi", async () => {
    (readPolicyInputs as jest.Mock).mockResolvedValue({ connected: true, onWifi: true, charging: true, batteryPercent: 90 });
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true } });
    render(<Probe runActive={false} />);
    await waitFor(() => expect(readPolicyInputs).toHaveBeenCalled());
    expect(screen.getByTestId("net")).toHaveTextContent("none");
  });

  it("reads mobile data, not a wait, for a run the user chose to make over mobile data", async () => {
    cellular();
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true, wifiOnly: true } });
    usePacing.setState({ policyOverride: { wifi: true, charging: true } });
    render(<Probe runActive />);
    await waitFor(() => expect(screen.getByTestId("net")).toHaveTextContent("cellular-data"));
  });

  it("warns during a MANUAL run on cellular even with auto-backup off (manual bypasses the wifi gate)", async () => {
    cellular();
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: false, wifiOnly: false } });
    render(<Probe runActive />);
    await waitFor(() => expect(screen.getByTestId("net")).toHaveTextContent("cellular-data"));
  });

  it("stays silent, rather than guessing, when the network state cannot be read", async () => {
    (readPolicyInputs as jest.Mock).mockRejectedValue(new Error("no sensor"));
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true } });
    render(<Probe runActive={false} />);
    await waitFor(() => expect(readPolicyInputs).toHaveBeenCalled());
    expect(screen.getByTestId("net")).toHaveTextContent("none");
  });
});
