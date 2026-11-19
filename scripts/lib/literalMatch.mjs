/**
 * #7591: matching that used to build a RegExp from text, done without one. Semgrep's
 * detect-non-literal-regexp is fixed, not suppressed (GOTCHAS.md), so the scripts that
 * looked for a named identifier, file or glob use these instead. Each function states
 * the pattern it replaces and matches exactly what that pattern matched.
 */

const WORD = /[A-Za-z0-9_]/;
const LINE_END = /[\n\r\u2028\u2029]/;
const isWord = (ch) => ch !== undefined && WORD.test(ch);

/** `\b` at `at` in `s`: a word character (ASCII, as a non-unicode regex reads them) on exactly one side. */
export const boundaryAt = (s, at) => isWord(s[at - 1]) !== isWord(s[at]);

/** Every index of `needle` in `text`, left to right (overlapping occurrences included). */
export function* indexesOf(text, needle, from = 0) {
  if (!needle) return;
  for (let i = text.indexOf(needle, from); i >= 0; i = text.indexOf(needle, i + 1)) yield i;
}

/** Whether `word` stands in `text` as `\bword\b` did. */
export function hasWord(text, word) {
  for (const i of indexesOf(text, word)) if (boundaryAt(text, i) && boundaryAt(text, i + word.length)) return true;
  return false;
}

/**
 * What `` new RegExp(`\\b${head}${tail}`, 'g') `` matched through `matchAll`, with `head` literal and `tail` a fixed
 * pattern written as a sticky (`y`) literal: regex-style matches (`[whole, ...tail groups]`, with `index`), left to
 * right and never overlapping.
 */
export function* matchAfterWord(text, head, sticky) {
  if (!sticky.sticky) throw new Error('matchAfterWord needs a sticky (y) pattern');
  let end = 0;
  for (const i of indexesOf(text, head)) {
    if (i < end || !boundaryAt(text, i)) continue;
    sticky.lastIndex = i + head.length;
    const m = sticky.exec(text);
    if (!m) continue;
    const out = [head + m[0], ...m.slice(1)];
    out.index = i;
    end = i + out[0].length;
    yield out;
  }
}

/** Whether `needle` occurs in `text` with `before` (a set of characters) just before it, or `after` just after it. */
export function quotedAround(text, needle, { before = null, after = null } = {}) {
  for (const i of indexesOf(text, needle)) {
    if (before && !before.includes(text[i - 1] ?? '\u0000')) continue;
    if (after && !after.includes(text[i + needle.length] ?? '\u0000')) continue;
    return true;
  }
  return false;
}

// ── Path patterns ──────────────────────────────────────────────────────────

/**
 * A path pattern as tokens: `{ lit }` one character; `{ run, slash, dot, min }` a run of at least `min` characters
 * (`slash`: may hold "/"; `dot`: a regex `.`, which never holds a line end); `{ optional }` that token or nothing;
 * `{ group }` a sequence that is all there or all absent.
 */
const lit = (c) => ({ lit: c });
const run = ({ slash, dot, min = 0 }) => ({ run: true, slash, dot, min });

function matchTokens(tokens, text) {
  const memo = new Map();
  const go = (ti, i) => {
    const key = ti * (text.length + 1) + i;
    if (memo.has(key)) return memo.get(key);
    let ok = false;
    if (ti === tokens.length) ok = i === text.length;
    else {
      const t = tokens[ti];
      if (t.group) ok = go2(t.group, 0, i, ti + 1) || go(ti + 1, i);
      else if (t.run) {
        for (let k = i; ; k += 1) {
          if (k - i >= t.min && go(ti + 1, k)) { ok = true; break; }
          const ch = text[k];
          if (ch === undefined || (!t.slash && ch === '/') || (t.dot && LINE_END.test(ch))) break;
        }
      } else ok = (text[i] === t.lit && go(ti + 1, i + 1)) || (Boolean(t.optional) && go(ti + 1, i));
    }
    memo.set(key, ok);
    return ok;
  };
  // A group's tokens, then the rest of the outer pattern (groups do not nest).
  const go2 = (group, gi, i, next) => {
    if (gi === group.length) return go(next, i);
    const t = group[gi];
    if (t.run) {
      for (let k = i; ; k += 1) {
        if (k - i >= t.min && go2(group, gi + 1, k, next)) return true;
        const ch = text[k];
        if (ch === undefined || (!t.slash && ch === '/') || (t.dot && LINE_END.test(ch))) return false;
      }
    }
    return text[i] === t.lit && go2(group, gi + 1, i + 1, next);
  };
  return go(0, 0);
}

/** `*` is any run without "/"; every other character is itself. Replaces `^${glob with * → [^/]*}$`. */
export function starGlobMatches(glob, text) {
  return matchTokens([...glob].map((c) => (c === '*' ? run({ slash: false, dot: false }) : lit(c))), text);
}

/**
 * package.json's test globs: `**` (with or without a following "/") is any run of whole directories, or none;
 * `*` is any run without "/". Replaces `^…$` built with `**` (and an optional "/") → `(?:.*` `/)?` and
 * `*` → `[^/]*`.
 */
export function testGlobMatches(glob, text) {
  const tokens = [];
  for (let i = 0; i < glob.length; i += 1) {
    if (glob.startsWith('**', i)) {
      tokens.push({ group: [run({ slash: true, dot: true }), lit('/')] });
      i += glob[i + 2] === '/' ? 2 : 1;
    } else tokens.push(glob[i] === '*' ? run({ slash: false, dot: false }) : lit(glob[i]));
  }
  return matchTokens(tokens, text);
}

/**
 * A GitHub branch filter (`**`, `*`, and `?` making the character before it optional), or null when it is not one
 * the inventory reads. Replaces `^…$` built with `**` → `.*`, `*` → `[^/]*`, `?` → `?`.
 */
export function branchFilterMatches(pattern, text) {
  if (/[^\w/.*?-]/.test(pattern)) return null;
  const tokens = [];
  for (const part of pattern.split(/(\*\*|\*|\?)/)) {
    if (part === '**') tokens.push(run({ slash: true, dot: true }));
    else if (part === '*') tokens.push(run({ slash: false, dot: false }));
    else if (part === '?') {
      // `x?` is optional and `x??` lazily so; `*?` is lazy. One more `?` than that, or one first, was a regex syntax
      // error, which read as "not a filter" (null).
      const prev = tokens[tokens.length - 1];
      if (!prev) return null;
      prev.marks = (prev.marks ?? 0) + 1;
      if (prev.marks > (prev.run ? 1 : 2)) return null;
      if (prev.lit !== undefined) prev.optional = true;
    } else for (const c of part) tokens.push(lit(c));
  }
  return matchTokens(tokens, text);
}

/**
 * Whether a Hono path pattern covers `path`: a trailing `/*` is "/" and at least one more character, or nothing;
 * any other `*` is any run; `:name` is a segment of at least one character. Replaces the pattern built with
 * `/\/\*$/` → `(?:/..*)?` (the later `*` rewrite reaches that one too), `*` → `.*` and `:name` → `[^/]+`.
 */
export function honoPathMatches(pattern, path) {
  const tail = pattern.endsWith('/*');
  const body = tail ? pattern.slice(0, -2) : pattern;
  const tokens = [];
  for (let i = 0; i < body.length; i += 1) {
    const param = /^:[A-Za-z_]\w*/.exec(body.slice(i));
    if (param) { tokens.push(run({ slash: false, dot: false, min: 1 })); i += param[0].length - 1; }
    else tokens.push(body[i] === '*' ? run({ slash: true, dot: true }) : lit(body[i]));
  }
  if (tail) tokens.push({ group: [lit('/'), run({ slash: true, dot: true, min: 1 })] });
  return matchTokens(tokens, path);
}
