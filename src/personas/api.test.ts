// Small helpers the Personas screens share (src/personas/api.ts): the face
// crop of a photo's thumbnail, the thumbnail source, what an engine error means.
import { faceCrop, faceThumbSource, personasErrorCode, PERSONAS_PRIVACY_URL } from "./api";

jest.mock("@/api/config", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok" }));

it("the thumbnail a face is cropped from: 256 px, with the bearer token", () => {
  expect(faceThumbSource("f/1")).toEqual({ uri: "https://api.test/api/files/f%2F1/thumb?w=256", headers: { Authorization: "Bearer tok" } });
});

it("the privacy link is the Biometric data policy", () => {
  expect(PERSONAS_PRIVACY_URL).toBe("https://dosya.dev/biometric-data-policy");
});

describe("faceCrop", () => {
  it("fills the frame with the face and its margin, inside the image", () => {
    // A 1000 x 500 image, a 100 x 100 px face in the middle.
    const c = faceCrop({ x: 0.45, y: 0.4, w: 0.1, h: 0.2 }, 1000, 500);
    // side = 160 px: the image is 625% x 312.5% of the frame.
    expect(c.width).toBeCloseTo(625);
    expect(c.height).toBeCloseTo(312.5);
    expect(c.x).toBeCloseTo(-262.5);
    expect(c.y).toBeCloseTo(-106.25);
  });

  it("keeps the square inside the image at an edge", () => {
    const c = faceCrop({ x: 0, y: 0, w: 0.1, h: 0.1 }, 1000, 1000);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
  });

  it("shows the whole image for a box or size it cannot use", () => {
    const whole = { width: 100, height: 100, x: 0, y: 0 };
    expect(faceCrop({ x: 0.1, y: 0.1, w: 0, h: 0.1 }, 100, 100)).toEqual(whole);
    expect(faceCrop({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, 0, 100)).toEqual(whole);
    expect(faceCrop({ x: Number.NaN, y: 0.1, w: 0.1, h: 0.1 }, 100, 100)).toEqual(whole);
  });
});

it("personasErrorCode: the engine's own code, anything else is try again", () => {
  const err = (code: string) => Object.assign(new Error(code), { name: "PersonasEngineError", code });
  for (const code of ["not_found", "name_taken", "name_invalid", "not_ready", "invalid"]) expect(personasErrorCode(err(code))).toBe(code);
  expect(personasErrorCode(err("weird"))).toBe("retry");
  expect(personasErrorCode(new Error("offline"))).toBe("retry");
  expect(personasErrorCode(null)).toBe("retry");
});
