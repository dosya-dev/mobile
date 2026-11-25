import { fileOpenPath } from "./file-open";

const file = (over: Record<string, unknown> = {}) => ({
  id: "f1", mime_type: "image/jpeg", extension: ".jpg", lock_mode: "none", ...over,
} as Parameters<typeof fileOpenPath>[0]);

// Books and audio used to bypass the viewer - a book deep-opened the reader and
// a track was intercepted before navigation - so the viewer's book and audio
// stages could not be reached by tapping anything at all.
it("sends every file type to the viewer", () => {
  expect(fileOpenPath(file())).toBe("/file/f1");
  expect(fileOpenPath(file({ mime_type: "application/epub+zip", extension: ".epub" }))).toBe("/file/f1");
  expect(fileOpenPath(file({ mime_type: "audio/mpeg", extension: ".mp3" }))).toBe("/file/f1");
  expect(fileOpenPath(file({ mime_type: "application/pdf", extension: ".pdf" }))).toBe("/file/f1");
  expect(fileOpenPath(file({ mime_type: "text/vcard", extension: ".vcf" }))).toBe("/file/f1");
  expect(fileOpenPath(file({ mime_type: "application/zip", extension: ".zip" }))).toBe("/file/f1");
});

it("sends a locked file to the viewer too, where its gate lives", () => {
  expect(fileOpenPath(file({ lock_mode: "full_lock" }))).toBe("/file/f1");
  expect(fileOpenPath(file({ lock_mode: "view_only" }))).toBe("/file/f1");
});
