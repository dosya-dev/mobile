import { txtToHtml, escapeHtml } from "./txt";

it("escapes html entities", () => {
  expect(escapeHtml('<b>&"x"</b>')).toBe("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;");
});

it("splits paragraphs on blank lines and keeps single newlines as breaks", () => {
  const html = txtToHtml("Line one\nLine two\n\nPara two");
  expect(html).toContain("<p>Line one<br>Line two</p>");
  expect(html).toContain("<p>Para two</p>");
});

it("produces a full html document with charset", () => {
  const html = txtToHtml("hi");
  expect(html).toMatch(/^<!doctype html>/i);
  expect(html).toContain('<meta charset="utf-8">');
});
