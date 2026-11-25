import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import ResetPasswordScreen from "./reset-password";
import { submitReset, requestResetCode } from "@/auth/passwordReset";
import { useAuthStore } from "@/auth/authStore";
import { ApiError } from "@/api/errors";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ email: "a@b.com" }),
}));
jest.mock("@/auth/passwordReset", () => ({
  ...jest.requireActual("@/auth/passwordReset"),
  submitReset: jest.fn(),
  requestResetCode: jest.fn(),
}));

const mockSubmit = submitReset as jest.MockedFunction<typeof submitReset>;
const mockResend = requestResetCode as jest.MockedFunction<typeof requestResetCode>;

function fillValid() {
  fireEvent.changeText(screen.getByTestId("code"), "123456");
  fireEvent.changeText(screen.getByTestId("password"), "newpassword");
  fireEvent.changeText(screen.getByTestId("confirm"), "newpassword");
}

describe("ResetPasswordScreen", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReplace.mockClear();
    mockSubmit.mockReset().mockResolvedValue(undefined);
    mockResend.mockReset().mockResolvedValue(undefined);
    useAuthStore.setState({ signIn: jest.fn().mockResolvedValue(undefined) } as never);
  });

  afterEach(() => { jest.useRealTimers(); });

  it("strips non-digits from a pasted code", () => {
    render(<ResetPasswordScreen />);
    fireEvent.changeText(screen.getByTestId("code"), "12 34-56");
    expect(screen.getByTestId("code").props.value).toBe("123456");
  });

  it("will not submit an incomplete code", () => {
    render(<ResetPasswordScreen />);
    fireEvent.changeText(screen.getByTestId("code"), "123");
    fireEvent.changeText(screen.getByTestId("password"), "newpassword");
    fireEvent.changeText(screen.getByTestId("confirm"), "newpassword");
    fireEvent.press(screen.getByTestId("submit-reset"));
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("will not submit when the two passwords differ", () => {
    render(<ResetPasswordScreen />);
    fireEvent.changeText(screen.getByTestId("code"), "123456");
    fireEvent.changeText(screen.getByTestId("password"), "newpassword");
    fireEvent.changeText(screen.getByTestId("confirm"), "different");
    fireEvent.press(screen.getByTestId("submit-reset"));
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("signs in with the new password after a successful reset, because the cookie is useless to mobile", async () => {
    const signIn = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ signIn } as never);
    render(<ResetPasswordScreen />);
    fillValid();
    fireEvent.press(screen.getByTestId("submit-reset"));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledWith("a@b.com", "123456", "newpassword"));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("a@b.com", "newpassword"));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(tabs)/(files)"));
  });

  it("clears a burned code so the user cannot keep retrying digits that can never work", async () => {
    mockSubmit.mockRejectedValueOnce(
      new ApiError("Too many incorrect attempts. Request a new code.", 429),
    );
    render(<ResetPasswordScreen />);
    fillValid();
    fireEvent.press(screen.getByTestId("submit-reset"));
    await waitFor(() => expect(screen.getByTestId("reset-error")).toBeTruthy());
    expect(screen.getByTestId("code").props.value).toBe("");
    expect(screen.getByTestId("reset-error").props.children).toMatch(/resend/i);
  });

  it("keeps the code on a plain wrong-code error, so a typo can be corrected", async () => {
    mockSubmit.mockRejectedValueOnce(new ApiError("Invalid or expired code", 400));
    render(<ResetPasswordScreen />);
    fillValid();
    fireEvent.press(screen.getByTestId("submit-reset"));
    await waitFor(() => expect(screen.getByTestId("reset-error")).toBeTruthy());
    expect(screen.getByTestId("code").props.value).toBe("123456");
  });

  it("starts with the resend control counting down rather than enabled", () => {
    render(<ResetPasswordScreen />);
    expect(screen.getByTestId("resend-countdown")).toBeTruthy();
    expect(screen.queryByTestId("resend")).toBeNull();
  });

  it("offers resend once the 30 second cooldown elapses", async () => {
    render(<ResetPasswordScreen />);
    await act(async () => { jest.advanceTimersByTime(31_000); });
    expect(screen.queryByTestId("resend-countdown")).toBeNull();
    fireEvent.press(screen.getByTestId("resend"));
    await waitFor(() => expect(mockResend).toHaveBeenCalledWith("a@b.com"));
  });

  it("tells the user to log in manually if the post-reset sign-in fails", async () => {
    useAuthStore.setState({ signIn: jest.fn().mockRejectedValue(new Error("offline")) } as never);
    render(<ResetPasswordScreen />);
    fillValid();
    fireEvent.press(screen.getByTestId("submit-reset"));
    await waitFor(() => expect(screen.getByTestId("reset-error")).toBeTruthy());
    expect(screen.getByTestId("reset-error").props.children).toMatch(/log in/i);
  });

  // QA MOB-REG-013: with different passwords the button just stayed grey and
  // nothing said why. The mismatch is now written under the confirm field as
  // soon as both have text.
  it("shows the mismatch under the confirm field while the passwords differ", () => {
    render(<ResetPasswordScreen />);
    fireEvent.changeText(screen.getByTestId("password"), "newpassword");
    expect(screen.queryByTestId("password-mismatch")).toBeNull();
    fireEvent.changeText(screen.getByTestId("confirm"), "newpassw");
    expect(screen.getByTestId("password-mismatch")).toHaveTextContent("Those passwords do not match.");
    fireEvent.changeText(screen.getByTestId("confirm"), "newpassword");
    expect(screen.queryByTestId("password-mismatch")).toBeNull();
  });
});
