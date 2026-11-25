import { NativeModules } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Passkey } from "react-native-passkey";
import { PasskeysSection } from "./PasskeysSection";
import { usePasskeys } from "./hooks";
import * as api from "./api";
import { toast } from "@/ui/toast";
import { finishSheetDismissal } from "@/ui/sheetTesting";

jest.mock("./hooks", () => ({ usePasskeys: jest.fn(), PASSKEYS_KEY: ["passkeys"] }));
jest.mock("./api", () => ({
  sendPasskeyCode: jest.fn(async () => {}),
  passkeyOptions: jest.fn(),
  savePasskey: jest.fn(async () => {}),
  removePasskey: jest.fn(async () => {}),
}));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("expo-device", () => ({ modelName: "iPhone 16" }));
jest.mock("react-native-passkey", () => ({
  Passkey: { isSupported: jest.fn(() => true), createPlatformKey: jest.fn() },
}));
const mockInvalidate = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

const mockHook = usePasskeys as jest.Mock;
const mockApi = api as jest.Mocked<typeof api>;
const mockCreate = Passkey.createPlatformKey as jest.Mock;
const CREATED = { id: "n", rawId: "n", response: { clientDataJSON: "c", attestationObject: "a" } };
const OPTIONS = { challenge: "ch" };
const ROW = { id: "pk_1", name: "MacBook", backed_up: 1, created_at: 1_700_000_000, last_used_at: null };

function withData(proof: "password" | "code", passkeys: unknown[] = []) {
  mockHook.mockReturnValue({ data: { passkeys, proof }, isLoading: false, isError: false, refetch: jest.fn() });
}

beforeEach(() => {
  jest.clearAllMocks();
  (NativeModules as Record<string, unknown>).Passkey = {};
  (Passkey.isSupported as jest.Mock).mockReturnValue(true);
  mockApi.passkeyOptions.mockResolvedValue({ challenge_token: "tok", options: OPTIONS as never });
  mockCreate.mockResolvedValue(CREATED);
});
afterEach(() => { delete (NativeModules as Record<string, unknown>).Passkey; });

async function submitDialog(value: string) {
  fireEvent.changeText(await screen.findByTestId("prompt-input"), value);
  fireEvent.press(screen.getByTestId("submit"));
  finishSheetDismissal();
}

it("password account: asks for the password and never emails a code", async () => {
  withData("password");
  render(<PasskeysSection />);
  fireEvent.press(screen.getByTestId("passkey-add"));
  await submitDialog("hunter2");

  await waitFor(() => expect(mockApi.savePasskey).toHaveBeenCalled());
  expect(mockApi.sendPasskeyCode).not.toHaveBeenCalled();
  expect(mockApi.passkeyOptions).toHaveBeenCalledWith({ password: "hunter2" });
  expect(mockCreate).toHaveBeenCalledWith(OPTIONS);
  expect(mockApi.savePasskey).toHaveBeenCalledWith(
    "tok",
    expect.objectContaining({ id: "n", rawId: "n", type: "public-key" }),
    "iPhone 16",
  );
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["passkeys"] });
  expect(toast).toHaveBeenCalledWith("Passkey added");
});

it("account with no password: emails a code first, then confirms with it", async () => {
  withData("code");
  render(<PasskeysSection />);
  fireEvent.press(screen.getByTestId("passkey-add"));
  await waitFor(() => expect(mockApi.sendPasskeyCode).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Enter the code we emailed you")).toBeTruthy();
  await submitDialog("482913");

  await waitFor(() => expect(mockApi.savePasskey).toHaveBeenCalled());
  expect(mockApi.passkeyOptions).toHaveBeenCalledWith({ code: "482913" });
});

it("does not open the code dialog when the email could not be sent", async () => {
  withData("code");
  mockApi.sendPasskeyCode.mockRejectedValueOnce(new Error("Could not send the code. Try again."));
  render(<PasskeysSection />);
  fireEvent.press(screen.getByTestId("passkey-add"));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Could not send the code. Try again.", "error"));
  expect(screen.queryByText("Enter the code we emailed you")).toBeNull();
});

it("waits for the proof dialog to finish closing before the native sheet opens", async () => {
  withData("password");
  render(<PasskeysSection />);
  fireEvent.press(screen.getByTestId("passkey-add"));
  fireEvent.changeText(await screen.findByTestId("prompt-input"), "pw");
  fireEvent.press(screen.getByTestId("submit"));
  expect(mockApi.passkeyOptions).not.toHaveBeenCalled();
  finishSheetDismissal();
  await waitFor(() => expect(mockApi.passkeyOptions).toHaveBeenCalled());
});

it("closing the native sheet shows nothing and saves nothing", async () => {
  withData("password");
  mockCreate.mockRejectedValueOnce({ error: "UserCancelled", message: "" });
  render(<PasskeysSection />);
  fireEvent.press(screen.getByTestId("passkey-add"));
  await submitDialog("pw");

  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByTestId("passkey-add").props.accessibilityState?.disabled).toBeFalsy());
  expect(toast).not.toHaveBeenCalled();
  expect(mockApi.savePasskey).not.toHaveBeenCalled();
});

it("shows the server's refusal of a wrong password and skips the sheet", async () => {
  withData("password");
  mockApi.passkeyOptions.mockRejectedValueOnce(new Error("Password is incorrect"));
  render(<PasskeysSection />);
  fireEvent.press(screen.getByTestId("passkey-add"));
  await submitDialog("wrong");

  await waitFor(() => expect(toast).toHaveBeenCalledWith("Password is incorrect", "error"));
  expect(mockCreate).not.toHaveBeenCalled();
});

it("removes a passkey only after the Are you sure? dialog", async () => {
  withData("password", [ROW]);
  render(<PasskeysSection />);
  fireEvent.press(screen.getByTestId("passkey-remove-pk_1"));
  expect(screen.getByText("Are you sure?")).toBeTruthy();
  expect(mockApi.removePasskey).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId("confirm"));

  await waitFor(() => expect(mockApi.removePasskey).toHaveBeenCalledWith("pk_1"));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Passkey removed"));
  expect(mockInvalidate).toHaveBeenCalled();
});

it("shows a synced passkey and its added date", () => {
  withData("password", [ROW]);
  render(<PasskeysSection />);
  expect(screen.getByText("MacBook")).toBeTruthy();
  expect(screen.getByText("Synced")).toBeTruthy();
  expect(screen.getByText(/^Added /)).toBeTruthy();
});

it("hides Add on an unsupported device but keeps existing passkeys removable", () => {
  withData("password", [ROW]);
  (Passkey.isSupported as jest.Mock).mockReturnValue(false);
  render(<PasskeysSection />);
  expect(screen.queryByTestId("passkey-add")).toBeNull();
  expect(screen.getByTestId("passkey-remove-pk_1")).toBeTruthy();
});

it("offers a retry when the list cannot load", () => {
  const refetch = jest.fn();
  mockHook.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
  render(<PasskeysSection />);
  fireEvent.press(screen.getByTestId("passkeys-retry"));
  expect(refetch).toHaveBeenCalled();
});
