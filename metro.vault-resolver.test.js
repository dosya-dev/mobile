const { resolveVaultRequest } = require("./metro.vault-resolver");

describe("resolveVaultRequest", () => {
  const fallback = jest.fn((_ctx, name) => ({ type: "sourceFile", filePath: `/resolved/${name}.js` }));
  const context = { resolveRequest: fallback };

  it("maps the Node crypto builtin to an empty module (the vendored e2ee bundle keeps a dead `import(\"crypto\")` fallback)", () => {
    const resolve = resolveVaultRequest(undefined);
    expect(resolve(context, "crypto", "android")).toEqual({ type: "empty" });
    expect(resolve(context, "node:crypto", "ios")).toEqual({ type: "empty" });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("delegates every other module to the previous resolver, or the context's, in that order", () => {
    const previous = jest.fn(() => ({ type: "sourceFile", filePath: "/prev.js" }));
    expect(resolveVaultRequest(previous)(context, "react", "ios")).toEqual({ type: "sourceFile", filePath: "/prev.js" });
    expect(resolveVaultRequest(undefined)(context, "react", "ios")).toEqual({ type: "sourceFile", filePath: "/resolved/react.js" });
  });
});
