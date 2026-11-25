import { fileThumbUrl, fileRawUrl } from "./fileUrl";
import { API_BASE_URL } from "@/api";

it("builds a thumb URL with size and version", () => {
  expect(fileThumbUrl("f1", 512, 3)).toBe(`${API_BASE_URL}/api/files/f1/thumb?version=3&w=512`);
});

it("omits version when not provided (or zero)", () => {
  expect(fileThumbUrl("f2", 128)).toBe(`${API_BASE_URL}/api/files/f2/thumb?w=128`);
  expect(fileThumbUrl("f3", 256, 0)).toBe(`${API_BASE_URL}/api/files/f3/thumb?w=256`);
});

it("builds a raw URL (with and without version)", () => {
  expect(fileRawUrl("f1", 3)).toBe(`${API_BASE_URL}/api/files/f1/raw?version=3`);
  expect(fileRawUrl("f2")).toBe(`${API_BASE_URL}/api/files/f2/raw`);
});
