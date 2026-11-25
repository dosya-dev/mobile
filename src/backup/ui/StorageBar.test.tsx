import { render, screen } from "@testing-library/react-native";
import { StorageBar } from "./StorageBar";

describe("StorageBar", () => {
  it("shows used / total / free with a proportional fill", () => {
    render(<StorageBar used={12_884_901_888} total={53_687_091_200} />); // 12 GB of 50 GB
    expect(screen.getByTestId("storage-bar")).toBeTruthy();
    expect(screen.getByTestId("storage-label")).toHaveTextContent("12.0 GB of 50.0 GB used");
    expect(screen.getByTestId("storage-free")).toHaveTextContent("38.0 GB free");
    expect(screen.getByTestId("storage-fill").props.style).toEqual(expect.objectContaining({ width: "24%" }));
  });

  it("switches to the warning fill at 90%+", () => {
    render(<StorageBar used={95} total={100} />);
    const fill = screen.getByTestId("storage-fill");
    expect(fill.props.className ?? "").toContain("bg-destructive");
  });

  it("keeps the normal fill under 90%", () => {
    render(<StorageBar used={50} total={100} />);
    expect(screen.getByTestId("storage-fill").props.className ?? "").toContain("bg-primary");
  });

  it("clamps overflow to 100%", () => {
    render(<StorageBar used={200} total={100} />);
    expect(screen.getByTestId("storage-fill").props.style).toEqual(expect.objectContaining({ width: "100%" }));
  });

  it("renders nothing for a zero quota", () => {
    render(<StorageBar used={0} total={0} />);
    expect(screen.queryByTestId("storage-bar")).toBeNull();
  });
});
