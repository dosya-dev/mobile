import { render, screen, waitFor, fireEvent } from "@testing-library/react-native";
import TvScreen from "./tv";
import { ApiError } from "@/api";
import { normalizeTvCode } from "@/tv/code";

/**
 * Signing in a dosya TV app from the phone (docs/TV-API-CONTRACT.md §1). The
 * TV's QR code opens this screen with ?code=; Settings opens it without one.
 */
const mockParams: { code?: string } = {};
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
  useRouter: () => ({ back: mockBack, canGoBack: () => true, replace: jest.fn() }),
}));

const mockRequest = jest.fn();
jest.mock("@/api", () => {
  const actual = jest.requireActual("@/api/errors");
  return {
    ApiError: actual.ApiError,
    apiRequest: (...args: unknown[]) => mockRequest(...args),
  };
});

const LOOKUP = { user_code: "KDTR-9WMX", device_type: "Apple TV", device_model: "AppleTV14,1", location: "Brisbane, AU", expires_at: 1793845900 };

beforeEach(() => {
  mockRequest.mockReset();
  mockBack.mockReset();
  delete mockParams.code;
});

describe("normalizeTvCode", () => {
  it("accepts the code with or without the dash, in any case", () => {
    expect(normalizeTvCode("KDTR-9WMX")).toBe("KDTR-9WMX");
    expect(normalizeTvCode("kdtr9wmx")).toBe("KDTR-9WMX");
    expect(normalizeTvCode(" kdtr 9wmx ")).toBe("KDTR-9WMX");
    expect(normalizeTvCode("kdtr–9wmx")).toBe("KDTR-9WMX");
  });

  it("refuses anything that cannot be a TV code", () => {
    expect(normalizeTvCode("")).toBeNull();
    expect(normalizeTvCode("KDTR-9WM")).toBeNull();
    expect(normalizeTvCode("KDTR-9WMXX")).toBeNull();
    expect(normalizeTvCode("KDTO-9WMX")).toBeNull(); // O is not in the alphabet
    expect(normalizeTvCode("KDTR-0WMX")).toBeNull(); // nor is 0
  });
});

describe("TvScreen", () => {
  it("looks the code from the link up in its normalised form and shows the TV", async () => {
    mockParams.code = "kdtr9wmx";
    mockRequest.mockResolvedValueOnce(LOOKUP);
    render(<TvScreen />);
    await waitFor(() => expect(screen.getByTestId("tv-ready")).toBeTruthy());
    expect(mockRequest).toHaveBeenCalledWith("/api/auth/tv/lookup?code=KDTR-9WMX");
    expect(screen.getByTestId("tv-code").props.children).toBe("KDTR-9WMX");
    expect(screen.getByText("Check this matches the code on your TV.")).toBeTruthy();
    expect(screen.getByText("Apple TV")).toBeTruthy();
    expect(screen.getByText("Device type reported by the TV")).toBeTruthy();
    expect(screen.getByText("Near Brisbane, AU")).toBeTruthy();
    expect(screen.getByTestId("tv-name").props.value).toBe("Apple TV");
  });

  it("Allow posts the code, the decision and the typed name", async () => {
    mockParams.code = "KDTR-9WMX";
    mockRequest.mockResolvedValueOnce(LOOKUP).mockResolvedValueOnce({ ok: true });
    render(<TvScreen />);
    await waitFor(() => expect(screen.getByTestId("tv-ready")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("tv-name"), "  Living room  ");
    fireEvent.press(screen.getByTestId("tv-allow"));
    await waitFor(() => expect(screen.getByTestId("tv-allowed")).toBeTruthy());
    expect(mockRequest).toHaveBeenLastCalledWith("/api/auth/tv/approve", {
      method: "POST",
      body: { user_code: "KDTR-9WMX", decision: "allow", device_name: "Living room" },
    });
    expect(screen.getByText("Your TV is signed in")).toBeTruthy();
  });

  it("Cancel posts a deny without a name", async () => {
    mockParams.code = "KDTR-9WMX";
    mockRequest.mockResolvedValueOnce(LOOKUP).mockResolvedValueOnce({ ok: true });
    render(<TvScreen />);
    await waitFor(() => expect(screen.getByTestId("tv-ready")).toBeTruthy());
    fireEvent.press(screen.getByTestId("tv-cancel"));
    await waitFor(() => expect(screen.getByTestId("tv-denied")).toBeTruthy());
    expect(mockRequest).toHaveBeenLastCalledWith("/api/auth/tv/approve", {
      method: "POST",
      body: { user_code: "KDTR-9WMX", decision: "deny" },
    });
  });

  it("an expired or used code says so", async () => {
    mockParams.code = "KDTR-9WMX";
    mockRequest.mockRejectedValueOnce(new ApiError("Not found", 404));
    render(<TvScreen />);
    await waitFor(() => expect(screen.getByTestId("tv-gone")).toBeTruthy());
    expect(screen.getByText("This code has expired or was already used. Get a new code on your TV.")).toBeTruthy();
    expect(screen.queryByTestId("tv-allow")).toBeNull();
  });

  it("a 409 (already allowed or cancelled elsewhere) is refused and does not claim success", async () => {
    mockParams.code = "KDTR-9WMX";
    mockRequest.mockResolvedValueOnce(LOOKUP).mockRejectedValueOnce(new ApiError("Already decided", 409));
    render(<TvScreen />);
    await waitFor(() => expect(screen.getByTestId("tv-ready")).toBeTruthy());
    fireEvent.press(screen.getByTestId("tv-allow"));
    await waitFor(() => expect(screen.getByTestId("tv-decided")).toBeTruthy());
    expect(screen.queryByTestId("tv-allowed")).toBeNull();
  });

  it("a network failure says we could not reach dosya and Try again looks the code up again", async () => {
    mockParams.code = "KDTR-9WMX";
    mockRequest.mockRejectedValueOnce(new ApiError("Network request failed", 0)).mockResolvedValueOnce(LOOKUP);
    render(<TvScreen />);
    await waitFor(() => expect(screen.getByTestId("tv-failed")).toBeTruthy());
    expect(screen.getByText("We couldn't reach dosya. Check your connection and try again.")).toBeTruthy();
    fireEvent.press(screen.getByTestId("tv-retry"));
    await waitFor(() => expect(screen.getByTestId("tv-ready")).toBeTruthy());
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("without a code it asks for one and refuses a malformed code before any request", async () => {
    render(<TvScreen />);
    fireEvent.changeText(screen.getByTestId("tv-code-input"), "abc");
    fireEvent.press(screen.getByTestId("tv-code-continue"));
    expect(screen.getByTestId("tv-code-error")).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();

    mockRequest.mockResolvedValueOnce(LOOKUP);
    fireEvent.changeText(screen.getByTestId("tv-code-input"), "kdtr 9wmx");
    fireEvent.press(screen.getByTestId("tv-code-continue"));
    await waitFor(() => expect(screen.getByTestId("tv-ready")).toBeTruthy());
    expect(mockRequest).toHaveBeenCalledWith("/api/auth/tv/lookup?code=KDTR-9WMX");
  });
});
