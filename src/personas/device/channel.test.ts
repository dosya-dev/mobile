// The line between the reader port and the hidden WebView (ReaderHost):
// mounted only while there is reading to do, messages held until the page
// says it is ready, remounted when stuck or gone.
import { createReaderChannel } from "./channel";

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

let mockNow = 1_000_000;
function setup() {
  const ch = createReaderChannel({ idleMs: 60_000, now: () => mockNow });
  const inbound: string[] = [];
  const gone = jest.fn();
  const unloaded = jest.fn();
  ch.connect({ receive: (d) => inbound.push(d), gone, unloaded });
  const toPage: string[] = [];
  return { ch, inbound, gone, unloaded, toPage };
}

it("is not mounted until something is posted, and holds messages until the page is ready", () => {
  const { ch, toPage } = setup();
  expect(ch.snapshot().mounted).toBe(false);
  ch.post("a");
  expect(ch.snapshot().mounted).toBe(true);
  ch.attach((m) => toPage.push(m));
  expect(toPage).toEqual([]);
  ch.receive(JSON.stringify({ type: "ready" }));
  expect(toPage).toEqual(["a"]);
  ch.post("b");
  expect(toPage).toEqual(["a", "b"]);
});

it("hands the page's answers and its ready line (whether it can read) to the reader", () => {
  const { ch, inbound } = setup();
  ch.post("a");
  ch.attach(() => {});
  ch.receive(JSON.stringify({ type: "ready", supported: true }));
  ch.receive('{"id":1,"faces":[]}');
  expect(inbound).toEqual(['{"type":"ready","supported":true}', '{"id":1,"faces":[]}']);
});

it("unmounts a minute after the last answer (the reader is told its page is gone), and mounts again for the next photo", () => {
  const { ch, unloaded, gone } = setup();
  ch.post("a");
  ch.attach(() => {});
  ch.receive(JSON.stringify({ type: "ready" }));
  ch.receive('{"id":1,"faces":[]}');
  jest.advanceTimersByTime(59_000);
  expect(ch.snapshot().mounted).toBe(true);
  expect(unloaded).not.toHaveBeenCalled();
  jest.advanceTimersByTime(2_000);
  expect(ch.snapshot().mounted).toBe(false);
  expect(unloaded).toHaveBeenCalledTimes(1);
  expect(gone).not.toHaveBeenCalled();
  ch.post("b");
  expect(ch.snapshot().mounted).toBe(true);
});

it("a remount gives the WebView a new key and waits for the new page to be ready", () => {
  const { ch, toPage } = setup();
  ch.post("a");
  ch.attach((m) => toPage.push(m));
  ch.receive(JSON.stringify({ type: "ready" }));
  const key = ch.snapshot().key;
  ch.remount();
  expect(ch.snapshot()).toEqual({ mounted: true, key: key + 1 });
  ch.post("b");
  expect(toPage).toEqual(["a"]);
  ch.receive(JSON.stringify({ type: "ready" }));
  expect(toPage).toEqual(["a", "b"]);
});

it("a page that fails to load or a WebView that dies tells the reader, unmounts and drops what was waiting: no remount churn", () => {
  const { ch, gone, toPage } = setup();
  ch.post("a");
  ch.attach((m) => toPage.push(m));
  const key = ch.snapshot().key;
  ch.gone();
  expect(gone).toHaveBeenCalledTimes(1);
  expect(ch.snapshot()).toEqual({ mounted: false, key: key + 1 });
  jest.advanceTimersByTime(600_000);
  expect(ch.snapshot().mounted).toBe(false);
  // The next photo (under the read loop's backoff) mounts a fresh page; "a" is gone.
  ch.post("b");
  expect(ch.snapshot().mounted).toBe(true);
  ch.receive(JSON.stringify({ type: "ready", supported: true }));
  expect(toPage).toEqual(["b"]);
});

it("after three failures in a row without a ready page it stops mounting for a while, failing each read at once", () => {
  const { ch, gone } = setup();
  for (let i = 0; i < 3; i++) {
    ch.post(`p${i}`);
    expect(ch.snapshot().mounted).toBe(true);
    ch.gone();
  }
  expect(gone).toHaveBeenCalledTimes(3);
  ch.post("p3");
  expect(ch.snapshot().mounted).toBe(false);
  expect(gone).toHaveBeenCalledTimes(4);
  mockNow += 5 * 60_000 + 1;
  ch.post("p4");
  expect(ch.snapshot().mounted).toBe(true);
});

it("a page that said ready resets the failure count", () => {
  const { ch, gone } = setup();
  for (let i = 0; i < 2; i++) { ch.post("x"); ch.gone(); }
  ch.post("y");
  ch.receive(JSON.stringify({ type: "ready", supported: true }));
  ch.gone();
  ch.post("z");
  expect(ch.snapshot().mounted).toBe(true);
  expect(gone).toHaveBeenCalledTimes(3);
});

it("close() unmounts at once and drops what was waiting", () => {
  const { ch, toPage } = setup();
  ch.post("a");
  ch.close();
  expect(ch.snapshot().mounted).toBe(false);
  ch.attach((m) => toPage.push(m));
  ch.receive(JSON.stringify({ type: "ready" }));
  expect(toPage).toEqual([]);
});

it("notifies subscribers of every change and keeps the same snapshot object between changes", () => {
  const { ch } = setup();
  const fn = jest.fn();
  const off = ch.subscribe(fn);
  const s0 = ch.snapshot();
  expect(ch.snapshot()).toBe(s0);
  ch.post("a");
  expect(fn).toHaveBeenCalled();
  off();
  fn.mockClear();
  ch.close();
  expect(fn).not.toHaveBeenCalled();
});
