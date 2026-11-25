import { getEditorConfig, editorHtml, type EditorConfig } from "./api";

let calls: { url: string; method: string }[] = [];

function mockFetch(body: unknown, status = 200) {
  (globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url, method: init?.method ?? "GET" });
    return { status, ok: status < 400, headers: new Headers(), json: async () => body };
  });
}

const CONFIG: EditorConfig = {
  documentServerUrl: "https://docs.dosya.dev",
  config: {
    document: { title: "Budget.docx", url: "https://api/x", fileType: "docx", key: "k1" },
    documentType: "word",
    editorConfig: { mode: "edit", callbackUrl: "https://api/cb" },
    token: "signed.jwt",
  },
};

beforeEach(() => { calls = []; });

describe("getEditorConfig", () => {
  it("asks the API for one file's config", async () => {
    mockFetch({ ok: true, ...CONFIG });
    const res = await getEditorConfig("f1");
    expect(calls[0].url).toContain("/api/files/f1/editor-config");
    expect(res.documentServerUrl).toBe("https://docs.dosya.dev");
    expect(res.config.document.title).toBe("Budget.docx");
  });
});

describe("editorHtml", () => {
  it("loads api.js from the document server the API named", () => {
    const html = editorHtml(CONFIG);
    expect(html).toContain('"https://docs.dosya.dev" + "/web-apps/apps/api/documents/api.js"');
  });

  it("carries the signed token into the page", () => {
    // Without the token the document server rejects the config outright, and the
    // failure surfaces as a blank editor rather than an auth error.
    expect(editorHtml(CONFIG)).toContain("signed.jwt");
  });

  it("escapes a title that would otherwise end the script early", () => {
    // Titles are user input: a file called `</script>` must not be able to close
    // the tag and run whatever follows.
    const evil = {
      ...CONFIG,
      config: { ...CONFIG.config, document: { ...CONFIG.config.document, title: '</script><img src=x onerror=alert(1)>' } },
    };
    const html = editorHtml(evil);
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u003c/script");
  });

  it("reports an unreachable document server rather than sitting on a blank box", () => {
    expect(editorHtml(CONFIG)).toContain("Document server unreachable");
  });

  it("wires the events the host listens for", () => {
    const html = editorHtml(CONFIG);
    expect(html).toContain("onAppReady");
    expect(html).toContain("onError");
    expect(html).toContain("onDocumentStateChange");
  });

  it("preserves the mode the API decided", () => {
    const viewOnly = {
      ...CONFIG,
      config: { ...CONFIG.config, editorConfig: { mode: "view" as const } },
    };
    expect(editorHtml(viewOnly)).toContain('"mode":"view"');
  });
});
