// Jest can't parse raw CSS (global.css is Tailwind source, not JS).
// Metro/nativewind handle it at bundle time via Metro's CSS support;
// under Jest we just need the import to resolve to something inert.
module.exports = {};
