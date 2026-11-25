// Manual mock for `uuid` (auto-applied for all tests). The real package moved to
// ESM-only builds (both its "node" and "default" export conditions ship `export`
// syntax) and Jest's react-native test environment only recognizes the
// "require"/"react-native" export conditions, so `require("uuid")` throws
// `SyntaxError: Unexpected token 'export'` before any test code runs - even
// though real Node (which supports synchronous require-of-ESM) loads it fine,
// which is why `expo prebuild` (a plain Node process) is unaffected.
//
// The only in-repo consumer that reaches this package under test is
// `xcode`'s pbxProject.js (a transitive dependency of `expo/config-plugins`,
// pulled in by plugins/withCarPlay.js's `withXcodeProject` mod), which calls
// only `uuid.v4()` to mint a random Xcode object id. A crypto-random v4 stand-in
// is enough for that; nothing in this repo asserts on the actual id value.
function v4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

module.exports = { v4 };
