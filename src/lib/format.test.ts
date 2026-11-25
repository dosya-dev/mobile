import { formatBytes, formatSpeed, formatDuration, formatWhen, formatElapsed } from "./format";

describe("formatBytes", () => {
  it("formats each unit", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });
  it("guards bad input", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
  });
});

describe("formatSpeed", () => {
  it("suffixes /s", () => { expect(formatSpeed(1024 * 1024)).toBe("1.0 MB/s"); });
});

describe("formatDuration", () => {
  it("formats s / m / h", () => {
    expect(formatDuration(5)).toBe("5s");
    expect(formatDuration(90)).toBe("1m");
    expect(formatDuration(3720)).toBe("1h 2m");
  });
  it("returns - for null / non-positive", () => {
    expect(formatDuration(0)).toBe("-");
    expect(formatDuration(null)).toBe("-");
  });
});

describe("formatElapsed", () => {
  it("renders a VPN-style HH:MM:SS clock", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(632)).toBe("00:10:32");
    expect(formatElapsed(3661)).toBe("01:01:01");
  });
  it("clamps negative / fractional input", () => {
    expect(formatElapsed(-5)).toBe("00:00:00");
    expect(formatElapsed(59.9)).toBe("00:00:59");
  });
});

describe("formatWhen", () => {
  it("renders a short date-time string", () => {
    const s = formatWhen(1710000500); // fixed timestamp; exact text is locale-dependent
    expect(s.length).toBeGreaterThan(5);
    expect(s).toMatch(/\d/);
  });
});
