// A round face: a crop of the photo's own 256 px thumbnail around the face
// box the engine keeps on this phone. No face image is made or stored anywhere.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { FaceAvatar } from "./FaceAvatar";

jest.mock("@/api/config", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok" }));

const BOX = { x: 0.45, y: 0.4, w: 0.1, h: 0.2 };

it("loads the photo's 256 px thumbnail with the bearer token, hidden until its size is known", () => {
  render(<FaceAvatar fileId="f1" box={BOX} name="Alex" testID="face" />);
  const img = screen.getByTestId("face-image");
  expect(img.props.source).toEqual({ uri: "https://api.test/api/files/f1/thumb?w=256", headers: { Authorization: "Bearer tok" } });
  expect(img.props.style).toEqual(expect.objectContaining({ opacity: 0 }));
  expect(screen.getByTestId("face").props.accessibilityLabel).toBe("Alex");
  expect(screen.getByTestId("face").props.accessibilityRole).toBe("image");
});

it("crops to the face once the thumbnail has loaded", () => {
  render(<FaceAvatar fileId="f1" box={BOX} name="Alex" size={40} testID="face" />);
  act(() => { fireEvent(screen.getByTestId("face-image"), "load", { source: { width: 1000, height: 500 } }); });
  const style = screen.getByTestId("face-image").props.style;
  expect(style).toEqual(expect.objectContaining({ opacity: 1, position: "absolute", width: "625%", height: "312.5%", left: "-262.5%", top: "-106.25%" }));
  expect(screen.getByTestId("face").props.style).toEqual(expect.objectContaining({ width: 40, height: 40 }));
});

it("is named Face without a name, and falls back to an icon when the thumbnail cannot load", () => {
  const { rerender } = render(<FaceAvatar fileId="f1" box={BOX} name={null} testID="face" />);
  expect(screen.getByTestId("face").props.accessibilityLabel).toBe("Face");
  act(() => { fireEvent(screen.getByTestId("face-image"), "error", { error: "404" }); });
  expect(screen.queryByTestId("face-image")).toBeNull();
  rerender(<FaceAvatar fileId="f2" box={BOX} name={null} testID="face" />);
  expect(screen.getByTestId("face-image").props.source.uri).toContain("/f2/");
});
