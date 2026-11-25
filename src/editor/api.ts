import { apiRequest } from "@/api/client";

/**
 * The signed ONLYOFFICE config for one file.
 *
 * React Native fetches this because /api/files/:id/editor-config is
 * authenticated; the WebView that renders the editor never sees a user
 * credential. It does not need one: the config carries an opaque session token,
 * and the document server downloads the file itself through
 * /api/onlyoffice/download?t=<token>.
 */
export interface EditorConfig {
  documentServerUrl: string;
  config: {
    document: { title: string; url: string; fileType: string; key: string };
    documentType: string;
    editorConfig: { mode: "edit" | "view"; callbackUrl?: string };
    token?: string;
  };
}

export async function getEditorConfig(fileId: string): Promise<EditorConfig> {
  const res = await apiRequest<{ ok: true } & EditorConfig>(`/api/files/${fileId}/editor-config`);
  return { documentServerUrl: res.documentServerUrl, config: res.config };
}

/**
 * The page that hosts the editor.
 *
 * Built here rather than inlined at build time like the map and the reader,
 * because ONLYOFFICE's api.js has to come from the document server at runtime -
 * it is the server's own matching client and cannot be vendored.
 *
 * The config is injected as JSON rather than interpolated into code: a document
 * title containing a quote would otherwise end the script early, and titles are
 * user input.
 */
export function editorHtml(input: EditorConfig): string {
  const payload = JSON.stringify(input.config).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <style>
      html, body, #oo { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="oo"></div>
    <script>
      var post = function (m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
      var cfg = ${payload};
      cfg.events = {
        onAppReady: function () { post({ type: "ready" }); },
        onError: function (e) { post({ type: "error", message: (e && e.data) || "editor error" }); },
        onDocumentStateChange: function (e) { post({ type: "dirty", value: !!(e && e.data) }); },
      };
      var s = document.createElement("script");
      s.src = ${JSON.stringify(input.documentServerUrl)} + "/web-apps/apps/api/documents/api.js";
      s.onload = function () {
        try { new window.DocsAPI.DocEditor("oo", cfg); }
        catch (err) { post({ type: "error", message: String(err && err.message || err) }); }
      };
      // A document server that cannot be reached must say so - without this the
      // page sits on a blank white box forever.
      s.onerror = function () { post({ type: "error", code: "unreachable", message: "Document server unreachable" }); };
      document.head.appendChild(s);
    </script>
  </body>
</html>`;
}
