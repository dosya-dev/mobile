#!/usr/bin/env node
// Physical-direction scanner, fixer and source gate for the mobile app.
//
//   node scripts/rtl-gate.mjs --check <files...>   report; exit 1 on any unmarked finding
//   node scripts/rtl-gate.mjs --fix <files...>     apply the pure renames, print the rest
//   node scripts/rtl-gate.mjs --count [root]       JSON { file: unmarked findings } for app/ and src/
//
// Mobile runs with React Native's legacy left/right swap turned OFF, so a
// physical style means physical on both platforms. Everything that should
// mirror is written logically (start/end); what is left is either allowed,
// reported for a hand edit, or carries an `rtl-ok: <reason>` marker on its
// own line or the line above.
//
// Style keys are renamed only inside a style (style={{ }} and its array members,
// StyleSheet.create, objects typed or named *Style); elsewhere they are reported.
// Fixed (renames only): ml-/mr- -> ms-/me-, pl-/pr- -> ps-/pe-, left-/right-
// -> start-/end-, rounded-l/r -> rounded-s/e, rounded-tl/tr/bl/br ->
// rounded-ss/se/es/ee (every variant prefix, `-` and `!` kept); style keys
// marginLeft/Right, paddingLeft/Right, left:/right:, borderLeft/RightWidth/
// Color, border{Top,Bottom}{Left,Right}Radius.
//
// Reported, never fixed: border-l/border-r classes (write a style with
// borderStartWidth/borderEndWidth by hand), the banned border-s/border-e and
// text-start/text-end classes (NativeWind compiles them physical or drops
// them), translateX / translate-x-*, scaleX, locationX, pageX, contentOffset.x,
// SVG x/cx/x1/x2/d attributes.
//
// Allowed: text-left/right, textAlign left/right, a line or object literal
// carrying both left and right with the same value, inset-x-*, px-*, mx-*,
// hitSlop / pressRetentionOffset objects, a left-1/2 or right-1/2 paired with
// -translate-x-1/2 (centering).
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Why a marked line may stay physical. A reason must begin with one of these. */
export const ALLOWED_REASONS = [
  'centering',
  'pointer coordinates',
  'canvas coordinates',
  'media timeline',
  'book art',
  'code',
  'map',
  'mirrored',
  'physical geometry',
  'scroll offset',
  'pager offset',
  'rtl selector',
];

/** Null when `reason` starts with an allowed reason (whole words), else a message. */
export function reasonError(reason) {
  const r = reason.trim().toLowerCase();
  const ok = ALLOWED_REASONS.some((a) => r === a || (r.startsWith(a) && /^[^a-z0-9]/.test(r.slice(a.length))));
  return ok ? null : `rtl-ok reason "${reason.trim()}" does not begin with one of: ${ALLOWED_REASONS.join(', ')}`;
}

const VALUE = String.raw`(?:\d+(?:\.\d+)?|px|auto|full|\d+\/\d+|\[[^\s]+\]|\([^\s]+\))`;
const SUFFIX = String.raw`[A-Za-z0-9\[\]().%#_\-\/]+`;
const CORNER = { tl: 'ss', tr: 'se', bl: 'es', br: 'ee' };

const BORDER_HAND = 'border-l/border-r: write style={{ borderStartWidth / borderEndWidth }} by hand';
const BANNED_BORDER = 'banned: NativeWind compiles border-s/border-e to a physical side; use borderStartWidth/borderEndWidth in a style';
const BANNED_TEXT = 'banned: NativeWind drops text-start/text-end; use text-left/text-right (they follow the direction on native)';

/** Splits a token on `:` outside brackets. Returns the variant prefix and where the utility starts. */
function splitToken(token) {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth = Math.max(0, depth - 1);
    else if (c === ':' && depth === 0) last = i;
  }
  return { variants: last < 0 ? '' : token.slice(0, last), offset: last + 1 };
}

/** Strips punctuation that belongs to the surrounding code, not the class. */
function trim(raw, start) {
  let s = raw;
  let a = start;
  while (/^[(\[]/.test(s) && s.split(s[0]).length - 1 > s.split(s[0] === '(' ? ')' : ']').length - 1) {
    s = s.slice(1);
    a += 1;
  }
  for (;;) {
    const last = s[s.length - 1];
    if (last === '.' || last === ',' || last === ':' || last === '?') s = s.slice(0, -1);
    else if (last === ')' && s.split('(').length < s.split(')').length) s = s.slice(0, -1);
    else if (last === ']' && s.split('[').length < s.split(']').length) s = s.slice(0, -1);
    else break;
  }
  return { token: s, start: a };
}

/**
 * Classifies one class token. Null when it is not a physical-direction class.
 * { fix } for a pure rename, { reason } for report-only; `center` marks the two
 * halves of a centering pair, `side` a left-/right- inset for the symmetric check.
 */
function classify(token) {
  const { variants, offset } = splitToken(token);
  if (/(?:^|:)(?:rtl|ltr)$/.test(variants)) return null;
  const rest = token.slice(offset);
  const lead = /^!?-?/.exec(rest)[0];
  let util = rest.slice(lead.length);
  let tail = '';
  if (util.endsWith('!')) {
    util = util.slice(0, -1);
    tail = '!';
  }
  const head = token.slice(0, offset) + lead;
  const rename = (logical) => ({ fix: head + logical + tail });
  let m;
  if ((m = new RegExp(`^m([lr])-(${VALUE})$`).exec(util))) return { ...rename(`m${m[1] === 'l' ? 's' : 'e'}-${m[2]}`), util };
  if ((m = new RegExp(`^p([lr])-(${VALUE})$`).exec(util))) return { ...rename(`p${m[1] === 'l' ? 's' : 'e'}-${m[2]}`), util };
  if ((m = new RegExp(`^(left|right)-(${VALUE})$`).exec(util))) {
    return {
      ...rename(`${m[1] === 'left' ? 'start' : 'end'}-${m[2]}`),
      util,
      center: !lead.includes('-') && /^(?:1\/2|\[50%\])$/.test(m[2]) ? 'inset' : null,
      side: { variants, side: m[1], value: m[2], lead },
    };
  }
  if ((m = new RegExp(`^rounded-([lr])(?:-(${SUFFIX}))?$`).exec(util))) {
    return { ...rename(`rounded-${m[1] === 'l' ? 's' : 'e'}${m[2] ? `-${m[2]}` : ''}`), util };
  }
  if ((m = new RegExp(`^rounded-(tl|tr|bl|br)(?:-(${SUFFIX}))?$`).exec(util))) {
    return { ...rename(`rounded-${CORNER[m[1]]}${m[2] ? `-${m[2]}` : ''}`), util };
  }
  if (new RegExp(`^border-[lr](?:-${SUFFIX})?$`).test(util)) return { reason: BORDER_HAND, util };
  if (new RegExp(`^border-[se](?:-${SUFFIX})?$`).test(util)) return { reason: BANNED_BORDER, util };
  if (/^text-(?:start|end)$/.test(util)) return { reason: BANNED_TEXT, util };
  if (/^translate-x-/.test(util)) {
    const half = lead.includes('-') ? /^translate-x-(?:1\/2|\[50%\])$/.test(util) : /^translate-x-\[-50%\]$/.test(util);
    return { reason: 'translate-x is physical', util, center: half ? 'translate' : null };
  }
  return null;
}

const STYLE_KEYS = {
  marginLeft: 'marginStart',
  marginRight: 'marginEnd',
  paddingLeft: 'paddingStart',
  paddingRight: 'paddingEnd',
  borderLeftWidth: 'borderStartWidth',
  borderRightWidth: 'borderEndWidth',
  borderLeftColor: 'borderStartColor',
  borderRightColor: 'borderEndColor',
  borderTopLeftRadius: 'borderTopStartRadius',
  borderTopRightRadius: 'borderTopEndRadius',
  borderBottomLeftRadius: 'borderBottomStartRadius',
  borderBottomRightRadius: 'borderBottomEndRadius',
};
const TYPE_WORDS = String.raw`(?:number|string|boolean|unknown|null|undefined|any)\b`;

const WORDS = [
  [/\btranslateX\b/g, 'translateX is physical'],
  [/\bscaleX\b/g, 'scaleX is physical'],
  [/\blocationX\b/g, 'locationX is physical (touch coordinates)'],
  [/\bpageX\b/g, 'pageX is physical (touch coordinates)'],
  [/\bcontentOffset\.x\b/g, 'contentOffset.x is physical'],
  [/\bcontentOffset\s*=\s*\{\{?\s*x\b/g, 'contentOffset x is physical'],
];

/** `text` with comments replaced by spaces (offsets and newlines kept). */
function blankComments(text) {
  const out = text.split('');
  let i = 0;
  let quote = '';
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (quote) {
      if (c === '\\') i += 2;
      else {
        if (c === quote || (c === '\n' && quote !== '`')) quote = '';
        i++;
      }
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') out[i++] = ' ';
    } else if (c === '/' && n === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < text.length) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
    } else {
      if (c === '"' || c === "'" || c === '`') quote = c;
      i++;
    }
  }
  return out.join('');
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}
function lineOf(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** The `{ ... }` literal around `pos`: [open, close] or null. */
function enclosingBraces(text, pos) {
  let depth = 0;
  let open = -1;
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] === '}') depth++;
    else if (text[i] === '{') {
      if (depth === 0) {
        open = i;
        break;
      }
      depth--;
    }
  }
  if (open < 0) return null;
  depth = 0;
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      if (depth === 0) return [open, i];
      depth--;
    }
  }
  return null;
}

/**
 * True when the key at `pos` sits in a style: a `style={{ }}` literal (or an
 * array / function member of a style prop), a StyleSheet.create entry, or an
 * object assigned to or typed as a style (name ending in Style, ViewStyle,
 * TextStyle, ImageStyle). Anything else is just an object that has a `left` key.
 */
function inStyleContext(code, pos) {
  const span = enclosingBraces(code, pos);
  if (!span) return false;
  const before = code.slice(Math.max(0, span[0] - 400), span[0]);
  if (/(?:\b\w*[sS]tyle|\b(?:View|Text|Image)Style)\s*(?::\s*[\w.<>\[\]]+\s*)?[=:]\s*(?:\{\s*)?$/.test(before)) return true;
  if (/:\s*(?:ViewStyle|TextStyle|ImageStyle)\s*=\s*$/.test(before)) return true;
  if (/\bas\s+(?:ViewStyle|TextStyle|ImageStyle)\b/.test(code.slice(span[1], span[1] + 40).split('\n')[0])) return true;
  const parent = enclosingBraces(code, span[0]);
  if (parent && /StyleSheet\.create\(\s*$/.test(code.slice(Math.max(0, parent[0] - 40), parent[0]))) return true;
  // A member of an array / expression inside a style prop: style={[a, cond && { ... }]}.
  if (/(?:[\[,(?:]|&&|\|\||\?\?|=>)\s*$/.test(before)) {
    let at = -1;
    for (const m of before.matchAll(/\b\w*[sS]tyle\s*=/g)) at = m.index;
    if (at >= 0) {
      let depth = 0;
      for (const c of before.slice(at)) {
        if (c === '{' || c === '[' || c === '(') depth++;
        else if (c === '}' || c === ']' || c === ')') depth--;
      }
      if (depth > 0) return true;
    }
  }
  return false;
}

const NOT_STYLE = (key) => `${key} outside a style object: rename by hand only if it is a style`;

const SVG_ATTR = /\s(x|cx|x1|x2|d)=(?=[{"'])/g;

/**
 * Every physical-direction use in `text` that is not allowed and not marked.
 * Each finding: { line, token, kind: "class" | "style", fix?, reason?, start, end }.
 * `fix` is the replacement for [start, end) when the finding is a pure rename.
 */
export function scanSource(text, file = '') {
  void file;
  const original = text;
  const lines = original.split('\n');
  const starts = lineStarts(original);
  const code = blankComments(original);

  // rtl-ok markers: the line itself or the line above, with an allowed reason.
  const validMark = new Array(lines.length + 2).fill(false);
  const badMarks = [];
  lines.forEach((l, i) => {
    const at = l.indexOf('rtl-ok:');
    if (at < 0) return;
    const reason = l.slice(at + 'rtl-ok:'.length).split('*/')[0].replace(/-->.*$/, '').replace(/\}\s*$/, '');
    const err = reason.trim() ? reasonError(reason) : 'rtl-ok needs a reason';
    if (err) badMarks.push({ line: i + 1, token: 'rtl-ok:', kind: 'style', reason: err, start: starts[i] + at, end: starts[i] + at + 7 });
    else validMark[i + 1] = true;
  });
  const marked = (line) => validMark[line] || validMark[line - 1];

  const findings = [...badMarks];
  const push = (start, token, kind, extra) => {
    const line = lineOf(starts, start);
    if (marked(line)) return;
    findings.push({ line, token, kind, ...extra, start, end: start + token.length });
  };

  // Class tokens.
  const segmentOf = (pos) => {
    const from = Math.max(code.lastIndexOf('"', pos), code.lastIndexOf("'", pos), code.lastIndexOf('`', pos)) + 1;
    const nexts = ['"', "'", '`'].map((q) => code.indexOf(q, pos)).filter((i) => i >= 0);
    return [from, nexts.length ? Math.min(...nexts) : code.length];
  };
  const cands = [];
  const re = /[^\s'"`{}<>;]+/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const { token, start } = trim(m[0], m.index);
    if (!token) continue;
    const info = classify(token);
    if (info) cands.push({ token, start, info });
  }
  const near = (a, b) => {
    const [from, to] = segmentOf(a.start);
    return (b.start >= from && b.start < to) || lineOf(starts, b.start) === lineOf(starts, a.start);
  };
  for (const c of cands) {
    const { info } = c;
    if (info.center) {
      const other = info.center === 'inset' ? 'translate' : 'inset';
      if (cands.some((o) => o !== c && o.info.center === other && near(c, o))) continue;
    }
    if (info.side) {
      const s = info.side;
      const opposite = s.side === 'left' ? 'right' : 'left';
      if (cands.some((o) => o !== c && o.info.side && o.info.side.side === opposite && o.info.side.value === s.value && o.info.side.variants === s.variants && o.info.side.lead === s.lead && near(c, o))) continue;
    }
    push(c.start, c.token, 'class', info.fix ? { fix: info.fix } : { reason: info.reason });
  }

  // Style keys.
  const styleKey = new RegExp(`\\b(${Object.keys(STYLE_KEYS).join('|')})\\s*:(?!\\s*${TYPE_WORDS})`, 'g');
  for (let m = styleKey.exec(code); m; m = styleKey.exec(code)) {
    push(m.index, m[1], 'style', inStyleContext(code, m.index) ? { fix: STYLE_KEYS[m[1]] } : { reason: NOT_STYLE(m[1]) });
  }
  const sideKey = new RegExp(`(?:^|(?<=[{,]))[ \\t]*(left|right)[ \\t]*:(?![ \\t]*${TYPE_WORDS})(?=[ \\t]*\\S)`, 'gm');
  for (let m = sideKey.exec(code); m; m = sideKey.exec(code)) {
    const at = m.index + m[0].length - m[0].trimStart().length;
    const key = m[1];
    const lineEnd = code.indexOf('\n', at) < 0 ? code.length : code.indexOf('\n', at);
    // `left: 0;` is CSS inside a string, not a style object.
    if (/^[^,{}]*;/.test(code.slice(at, lineEnd))) continue;
    const span = enclosingBraces(code, at);
    const body = span ? code.slice(span[0] + 1, span[1]) : code.slice(starts[lineOf(starts, at) - 1], lineEnd);
    if (span && /(?:hitSlop|pressRetentionOffset)\s*(?:=\s*\{|:)\s*$/.test(code.slice(Math.max(0, span[0] - 60), span[0]))) continue;
    const values = {};
    for (const p of body.matchAll(/(?:^|[,{\s])(left|right)\s*:\s*([^,}\n]+)/g)) values[p[1]] = p[2].trim();
    if (values.left !== undefined && values.left === values.right) continue;
    push(at, key, 'style', inStyleContext(code, at) ? { fix: key === 'left' ? 'start' : 'end' } : { reason: NOT_STYLE(key) });
  }

  // Never fixed: coordinates, transforms, scroll offsets.
  for (const [pattern, reason] of WORDS) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(code); m; m = pattern.exec(code)) push(m.index, m[0], 'style', { reason });
  }

  // SVG geometry attributes, in files that draw with react-native-svg.
  const svg = /from\s+["']react-native-svg["']/.exec(code);
  if (svg) {
    const imp = /import\s+([^;]*?)\s+from\s+["']react-native-svg["']/s.exec(code);
    const names = new Set((imp ? imp[1] : '').match(/\b[A-Z]\w*/g) ?? []);
    names.add('Svg');
    for (let m = SVG_ATTR.exec(code); m; m = SVG_ATTR.exec(code)) {
      const before = code.slice(0, m.index);
      const tag = /<([A-Z]\w*)\b[^<]*$/.exec(before);
      if (tag && names.has(tag[1])) push(m.index + 1, m[1], 'style', { reason: `SVG ${m[1]} attribute is physical geometry` });
    }
    SVG_ATTR.lastIndex = 0;
  }

  findings.sort((a, b) => a.start - b.start);
  return findings;
}

/** Applies the pure renames in `text`; returns the new text and what was left. */
export function fixSource(text, file = '') {
  const findings = scanSource(text, file);
  let out = '';
  let pos = 0;
  const left = [];
  for (const f of findings) {
    if (f.fix && f.start >= pos) {
      out += text.slice(pos, f.start) + f.fix;
      pos = f.end;
    } else left.push(f);
  }
  return { output: out + text.slice(pos), left };
}

// Not scanned: tests, declaration files
// and the vendored i18n runtime (copied flat from apps/desktop by vendor-i18n.mjs).
const TEST = /\.(?:test|spec)\.|(?:^|[\\/])(?:__tests__|__mocks__)[\\/]/;
export const EXEMPT_FILES = [
  'src/i18n/icu.ts',
  'src/i18n/translator.ts',
  'src/i18n/match.ts',
  'src/i18n/keys.ts',
  'src/i18n/locales.ts',
  'src/i18n/loaders.ts',
  'src/i18n/external-keys.ts',
  // Generated HTML for the map and reader WebViews: their own layout, never native styles.
  'src/map/mapHtml.generated.ts',
  'src/reader/readerHtml.generated.ts',
];

function walk(dir, out) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts') && !TEST.test(p)) out.push(p);
  }
  return out;
}

/** Unmarked findings per file under `<root>/app` and `<root>/src`: { 'src/a.tsx': [finding...] }. */
export function scanTree(root) {
  const base = resolve(root);
  const result = {};
  const files = [...walk(join(base, 'app'), []), ...walk(join(base, 'src'), [])].sort();
  for (const file of files) {
    const rel = relative(base, file).split(sep).join('/');
    if (EXEMPT_FILES.includes(rel)) continue;
    const findings = scanSource(readFileSync(file, 'utf8'), rel);
    if (findings.length) result[rel] = findings;
  }
  return result;
}

/** { file: number of unmarked findings } for every file that has any. */
export function countTree(root) {
  return Object.fromEntries(Object.entries(scanTree(root)).map(([file, f]) => [file, f.length]));
}

function describe(file, f) {
  return `${file}:${f.line} ${f.token} ${f.fix ? `-> ${f.fix}` : `(${f.reason})`}`;
}

function main(argv) {
  const [mode, ...rest] = argv;
  if (mode === '--count') {
    process.stdout.write(`${JSON.stringify(countTree(rest[0] ?? process.cwd()), null, 2)}\n`);
    return 0;
  }
  if (mode !== '--check' && mode !== '--fix') {
    console.error('usage: rtl-gate.mjs --check|--fix <files...> | --count [root]');
    return 2;
  }
  let unmarked = 0;
  for (const file of rest) {
    const text = readFileSync(file, 'utf8');
    if (mode === '--fix') {
      const { output, left } = fixSource(text, file);
      if (output !== text) {
        writeFileSync(file, output);
        console.log(`${file}: fixed`);
      }
      for (const f of left) console.log(describe(file, f));
    } else {
      for (const f of scanSource(text, file)) {
        unmarked++;
        console.log(describe(file, f));
      }
    }
  }
  return mode === '--check' && unmarked > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
