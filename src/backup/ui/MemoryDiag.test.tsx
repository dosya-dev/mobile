jest.mock("@/perf/thermal", () => ({
  getMemoryFootprint: jest.fn(() => -1),
  getThermalState: jest.fn(() => "nominal"),
}));

import { render, screen } from "@testing-library/react-native";
import { MemoryDiag } from "./MemoryDiag";
import { getMemoryFootprint } from "@/perf/thermal";

describe("MemoryDiag", () => {
  it("renders nothing when the native module is absent", () => {
    render(<MemoryDiag />);
    expect(screen.queryByTestId("memory-diag")).toBeNull();
  });

  it("shows footprint + thermal when available", () => {
    (getMemoryFootprint as jest.Mock).mockReturnValue(412 * 1024 * 1024);
    render(<MemoryDiag />);
    expect(screen.getByTestId("memory-diag")).toHaveTextContent(/RAM 412\.0 MB · thermal nominal/);
  });
});
