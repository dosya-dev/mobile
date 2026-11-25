import { render, screen, waitFor, act } from "@testing-library/react-native";
import { OfficeStage } from "./OfficeStage";
import { stagePalette } from "../stageTheme";

const palette = stagePalette("light");
const ENDPOINT = "https://api.test/api/files/f1/preview-pdf";
const CACHED = "file:///data/user/0/dev.dosya/cache/bytes/f1-v3.pdf";

const mockFetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (global as unknown as { fetch: jest.Mock }).fetch = mockFetch;
  // Faithful to the platform, and the whole point of these cases: React Native's
  // fetch is OkHttp-backed and REJECTS a file:// URL rather than reading it. A
  // mock that resolved 200 for any input would let the buggy code pass by
  // recovering from a reset it should never have performed.
  mockFetch.mockImplementation(async (input: unknown) => {
    if (!String(input).startsWith("http")) throw new TypeError("Network request failed");
    return { status: 200, json: async () => ({}) };
  });
});

describe("OfficeStage", () => {
  it("polls the conversion endpoint and then renders the PDF", async () => {
    render(<OfficeStage uri={ENDPOINT} headers={{ Authorization: "Bearer t" }} palette={palette} />);

    expect(await screen.findByTestId("pdf-stage")).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith(ENDPOINT, { headers: { Authorization: "Bearer t" } });
  });

  it("renders a already-converted local file straight away, without polling it", async () => {
    // useFilePreview hands this stage a file:// path once the converted PDF is
    // on disk. Those bytes ARE the finished conversion - there is nothing left
    // to wait for. Polling it is not merely wasteful: React Native's fetch is
    // OkHttp-backed and rejects the file: scheme outright, so the request throws,
    // officePreview maps the resulting status 0 to `failed`, and a document that
    // is sitting on the device renders as "Could not prepare a preview".
    render(<OfficeStage uri={CACHED} palette={palette} />);

    expect(await screen.findByTestId("pdf-stage")).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps the rendered PDF mounted when the URI switches to the cached copy", async () => {
    // The regression that made docx previews impossible to scroll. The stage's
    // effect keys on [uri, headers] and the disk cache changes BOTH at once, so
    // it reset to `preparing` and unmounted the PDF mid-read - throwing away the
    // reader's scroll position and page. Re-rendering with the local copy must
    // leave the document on screen.
    const { rerender } = render(
      <OfficeStage uri={ENDPOINT} headers={{ Authorization: "Bearer t" }} palette={palette} />,
    );
    const before = await screen.findByTestId("pdf-stage");
    expect(before).toBeTruthy();

    await act(async () => {
      rerender(<OfficeStage uri={CACHED} palette={palette} />);
    });

    expect(screen.getByTestId("pdf-stage")).toBeTruthy();
    expect(screen.queryByTestId("office-preparing")).toBeNull();
  });

  it("still reports a genuine conversion failure", async () => {
    // The guard above must not swallow real errors on the network path.
    mockFetch.mockResolvedValue({ status: 500, json: async () => ({}) });
    render(<OfficeStage uri={ENDPOINT} palette={palette} />);

    await waitFor(() => expect(screen.getByTestId("office-failed")).toBeTruthy());
  });
});
