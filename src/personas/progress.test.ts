// What the progress card shows for the engine's status: this phone's reading.
import { progressPercent, progressView } from "./progress";

const ready = (read: number, total: number | null, paused = false) => ({ state: "ready" as const, read, total, reading: false, paused });

it("finding while the photos are not counted, reading while some are left, hidden once all are read", () => {
  expect(progressView(ready(0, null))).toBe("finding");
  expect(progressView(ready(3, 10))).toBe("reading");
  expect(progressView(ready(3, 10, true))).toBe("reading");
  expect(progressView(ready(10, 10))).toBe("hidden");
  expect(progressView(ready(0, 0))).toBe("hidden");
});

it("whole percent, never 100 while photos are left", () => {
  expect(progressPercent(ready(0, null))).toBe(0);
  expect(progressPercent(ready(1, 4))).toBe(25);
  expect(progressPercent(ready(999, 1000))).toBe(99);
  expect(progressPercent(ready(10, 10))).toBe(100);
});

it("a phone whose WebView cannot read photos says so whatever the counts", () => {
  expect(progressView(ready(3, 10), false)).toBe("unsupported");
  expect(progressView(ready(10, 10), false)).toBe("unsupported");
  expect(progressView(ready(3, 10), true)).toBe("reading");
});
