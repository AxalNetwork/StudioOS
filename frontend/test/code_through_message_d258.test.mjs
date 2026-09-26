/**
 * D258 — no page reads a refusal's machine code through its message.
 *
 * WHAT WAS WRONG. Before D258, `request()` put a string `error` code ahead of
 * the body's own `message`, so `e.message` was often the code, and pages
 * learned to branch on it: `/pii_linter_blocked/.test(e?.message || '')`,
 * `e?.message === 'not_enough_trusted_contacts'`,
 * `APPLY_ERROR_MESSAGES[err.message]`. D258 moved the sentence into
 * `e.message` and the code onto `e.code`, which fixed ~190 refusals at once and
 * silently broke every one of those matches: the Worker's own sentence wins
 * now, so a regex looking for the code finds prose and never fires. Measured
 * before the fix, sixteen sites across fourteen files did this, and eleven
 * more read `e.body` — a field nothing in the SPA has ever set, since
 * `request()` puts the body on `e.data` — so their "structured" branch was
 * dead code that fell through to the generic message every time.
 *
 * WHAT IS ASSERTED, AND HOW. Every source file under `frontend/src` is read
 * through `codeOnly` and scanned for six shapes, each written as a literal
 * pattern (nothing here builds a regex from data):
 *
 *   equality   a message, or a name assigned from one, compared with `===`,
 *              `!==`, `==` or `!=` against a literal shaped like a code
 *   search     a message searched for a snake_case token: `.includes`,
 *              `.startsWith`, `.match`, `.search`, `.indexOf`, or a regex
 *              literal's `.test(message)`
 *   lookup     a table indexed by a message — `T[e.message]` or
 *              `Object.hasOwn(T, e.message)` — where `T` is keyed by codes,
 *              or cannot be seen from the file
 *   switch     a `switch` on a message with a `case` that is a code
 *   dead-body  `e.body` read off a caught error, in a `catch` block or a
 *              `.catch()` handler
 *   hand-built an Error built from a body's `error`, `detail` or `message`
 *              anywhere but `lib/api.js`, which is where `refusalError`
 *              already builds one from a Response the D258 way
 *
 * "A name assigned from one" is taint, per file: `const msg = e?.message || ''`
 * makes `msg` a message, and so does anything assigned from `msg` through calls
 * (`msg.toLowerCase()`) — but a named property read off it (`m.role`) is
 * something else, which is what keeps per-file taint from following a reused
 * name into the next function. A sentence
 * match is NOT a finding: `.includes('already')`, a table keyed by
 * `'TOTP required'`, and `e.message === 'Unauthorized'` all pass, because a
 * sentence is what `e.message` now carries.
 *
 * The scan is checked against itself in both directions below: each pre-D258
 * shape — most of them copied verbatim from the lines D258 removed — must
 * yield exactly one finding of its rule, and each control must yield none.
 *
 * WHAT IS DELIBERATELY NOT CAUGHT. Taint does not cross a function boundary
 * or React state: `setError(e.message)` followed by `error === 'x_y'`
 * somewhere else is invisible. A lookup through a Map's `.get()` is not
 * scanned (measured: no site). Both are narrower than what this replaces,
 * and the six shapes are the ones the tree actually contained.
 *
 * WHEN THIS FAILS on a `.message` that is not an HTTP refusal — a chat
 * message, a notification, an SSE frame, a 200 body — add an entry to
 * ALLOWED naming the file, a phrase from the flagged line, and why. An entry
 * that stops matching fails too, so the list cannot rot.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const SRC = resolve(process.cwd(), 'frontend/src');
const API = 'lib/api.js';

// ── Shapes ───────────────────────────────────────────────────────────────────

// A machine code as the Worker writes one (`kind_not_available`) or as a page
// constant spells one (`PAYWALL_PREMIUM_METHOD`). A sentence has a space or a
// capital in the wrong place and never matches.
const CODE = /^(?:[a-z][a-z0-9_]*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)$/;
// Inside a longer string or a regex: an underscore joining two word runs.
const SNAKE = /[A-Za-z0-9]+_[A-Za-z0-9_]+/;
// An identifier that is not a property access.
const IDENT = /(?<![\w$.])[A-Za-z_$][\w$]*/g;

const KEYWORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'await', 'yield', 'void', 'delete',
  'throw', 'new', 'else', 'do', 'instanceof', 'const', 'let', 'var', 'export',
]);

// The operand pattern — `(expr)` or a name, then any run of `.prop`, `?.prop`
// and `(call args)` — appears inline in each literal below, because a regex
// composed from strings is exactly what this file refuses to contain.
const EQ_LEFT = /(typeof\s*)?((?:\([^()]*\)|[\w$]+)(?:\s*(?:\?\.|\.)\s*[\w$]+|\s*\([^()]*\))*)\s*(?:===|!==|==|!=)\s*(['"`])([^'"`\n]*)\3/g;
const EQ_RIGHT = /(['"`])([^'"`\n]*)\1\s*(?:===|!==|==|!=)\s*(typeof\s*)?((?:\([^()]*\)|[\w$]+)(?:\s*(?:\?\.|\.)\s*[\w$]+|\s*\([^()]*\))*)/g;
const SEARCH = /((?:\([^()]*\)|[\w$]+)(?:\s*(?:\?\.|\.)\s*[\w$]+|\s*\([^()]*\))*)\s*(?:\?\.|\.)\s*(?:includes|startsWith|endsWith|indexOf|lastIndexOf|match|matchAll|search)\s*\(\s*(?:(['"`])([^'"`\n]*)\2|\/((?:\\.|[^\\\/\n])+)\/[a-z]*)/g;
const REGEX_TEST = /\/((?:\\.|[^\\\/\n])+)\/[a-z]*\s*\.test\(\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
const LOOKUP = /(?<![\w$.])([A-Za-z_$][\w$]*(?:\s*(?:\?\.|\.)\s*[A-Za-z_$][\w$]*)*)\s*(?:\?\.)?\[\s*([^\[\]\n]*)\]/g;
const HAS_OWN = /Object\.hasOwn\(\s*([A-Za-z_$][\w$]*)\s*,\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
const TABLE_DECL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Object\.freeze\(\s*)?\{/g;
const SWITCH = /(?<![\w$.])switch\s*\(/g;
const CASE_LITERAL = /(?<![\w$.])case\s+(['"`])([^'"`\n]*)\1\s*:/g;
const CATCH_BLOCK = /(?<![\w$.])catch\s*\(\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)\s*\{/g;
const CATCH_DESTRUCTURED = /(?<![\w$.])catch\s*\(\s*\{([^{}]*)\}\s*(?::[^)]*)?\)/g;
const CATCH_CALL = /\.catch\(/g;
const HANDLER_ARROW = /^\s*(?:async\s+)?(?:\(\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)|([A-Za-z_$][\w$]*))\s*=>/;
const HANDLER_FUNCTION = /^\s*(?:async\s+)?function\s*[\w$]*\s*\(\s*([A-Za-z_$][\w$]*)/;
const HANDLER_DESTRUCTURED = /^\s*(?:async\s+)?\(\s*\{([^{}]*)\}\s*(?::[^)]*)?\)\s*=>/;
const BODY_READ = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*body\b/g;
const BODY_DESTRUCTURE = /(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*([A-Za-z_$][\w$]*)(?![\w$.?])/g;
const NAMES_BODY = /(?<![\w$])body\b/;
const HAND_BUILT = /new\s+Error\(\s*([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*(?:error|detail|message)\b[^\n]*/g;
const DECL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?![=>])/g;
const DESTRUCTURED_DECL = /(?:const|let|var)\s*\{([^{}]*)\}\s*=/g;
const MESSAGE_BINDING = /(?<![\w$])message(?![\w$])\s*(?::\s*([A-Za-z_$][\w$]*))?/g;
const MESSAGE_READ = /\.message\b/g;
const NAME_AHEAD = /^[A-Za-z_$][\w$]*/;

/**
 * Does this expression yield a message — `.message`, or a name tainted by one?
 *
 * Only when the chain after the read keeps the VALUE: `e.message.trim()` and
 * `msg.split(':')[0]` are still the message, but `msg.message?.role` and
 * `m.role` read a named property of something else — a chat message's role, a
 * write receipt's status. The first draft of this guard counted any occurrence
 * and flagged eleven of those across two files, because taint is per file and
 * `m` names a websocket frame in one function and a chat bubble in the next.
 */
function readsMessage(expr, tainted) {
  for (const m of expr.matchAll(MESSAGE_READ)) {
    if (stillTheValue(expr, m.index + m[0].length)) return true;
  }
  for (const m of expr.matchAll(IDENT)) {
    if (tainted.has(m[0]) && stillTheValue(expr, m.index + m[0].length)) return true;
  }
  return false;
}

/**
 * Walk the chain that follows a read at `at`: calls and index reads keep the
 * value, a named property that is not called replaces it.
 */
function stillTheValue(expr, at) {
  let i = at;
  for (;;) {
    while (/\s/.test(expr[i] ?? '')) i++;
    if (expr.startsWith('?.', i)) i += 2;
    else if (expr[i] === '.') i += 1;
    else if (expr[i] === '(' || expr[i] === '[') {
      const close = balanced(expr, i);
      if (close < 0) return true;
      i = close + 1;
      continue;
    } else return true;
    while (/\s/.test(expr[i] ?? '')) i++;
    if (expr[i] === '(' || expr[i] === '[') {          // `?.(` and `?.[`
      const close = balanced(expr, i);
      if (close < 0) return true;
      i = close + 1;
      continue;
    }
    const name = NAME_AHEAD.exec(expr.slice(i));
    if (!name) return true;
    i += name[0].length;
    let j = i;
    while (/\s/.test(expr[j] ?? '')) j++;
    if (expr[j] !== '(') return false;
  }
}

// ── A small lexer: enough to find a bracket's partner ───────────────────────
//
// Strings, template literals (with their `${…}` parts), comments and regex
// literals are skipped, because an apostrophe in a trailing comment or a `{`
// in a regex would otherwise send a scope past its end. An unterminated quote
// stops at its line, so a JSX apostrophe costs one line, not the file.

const PAIR = { '(': ')', '[': ']', '{': '}' };

function regexCanStart(src, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  if (k < 0) return true;
  if ('(,=:[!&|?{};'.includes(src[k])) return true;
  const word = /[A-Za-z_$][\w$]*$/.exec(src.slice(Math.max(0, k - 12), k + 1));
  return !!word && KEYWORDS.has(word[0]);
}

/** Index just past a literal or comment starting at i, or -1 if none starts there. */
function skipLiteral(src, i) {
  const ch = src[i];
  if (ch === "'" || ch === '"') {
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === '\\') { j++; continue; }
      if (src[j] === ch) return j + 1;
      if (src[j] === '\n') return j;
    }
    return src.length;
  }
  if (ch === '`') {
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === '\\') { j++; continue; }
      if (src[j] === '`') return j + 1;
      if (src[j] === '$' && src[j + 1] === '{') {
        const close = balanced(src, j + 1);
        if (close < 0) return src.length;
        j = close;
      }
    }
    return src.length;
  }
  if (ch === '/') {
    if (src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      return nl < 0 ? src.length : nl;
    }
    if (src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      return end < 0 ? src.length : end + 2;
    }
    if (regexCanStart(src, i)) {
      let inClass = false;
      for (let j = i + 1; j < src.length; j++) {
        const c = src[j];
        if (c === '\\') { j++; continue; }
        if (c === '\n') return -1;
        if (inClass) { if (c === ']') inClass = false; continue; }
        if (c === '[') { inClass = true; continue; }
        if (c === '/') {
          let k = j + 1;
          while (k < src.length && /[a-z]/.test(src[k])) k++;
          return k;
        }
      }
      return -1;
    }
  }
  return -1;
}

/** Index of the bracket closing the one at `open`, or -1 when it does not balance. */
function balanced(src, open) {
  const stack = [PAIR[src[open]]];
  for (let i = open + 1; i < src.length; i++) {
    const skip = skipLiteral(src, i);
    if (skip >= 0) { i = skip - 1; continue; }
    const c = src[i];
    if (PAIR[c]) stack.push(PAIR[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** The keys an object literal opening at `open` declares at its own top level. */
function topLevelKeys(src, open) {
  const close = balanced(src, open);
  if (close < 0) return null;
  const keys = [];
  let segStart = open + 1;
  const push = (to) => {
    const seg = src.slice(segStart, to).replace(/^(?:\s|\/\/[^\n]*|\/\*(?:[^*]|\*(?!\/))*\*\/)*/, '');
    const m = /^(?:(['"`])([^'"`\n]*)\1|([A-Za-z_$][\w$]*))\s*:/.exec(seg);
    if (m) keys.push(m[2] ?? m[3]);
  };
  for (let i = open + 1; i < close; i++) {
    const skip = skipLiteral(src, i);
    if (skip >= 0) { i = skip - 1; continue; }
    const c = src[i];
    if (PAIR[c]) {
      const end = balanced(src, i);
      if (end < 0) return null;
      i = end;
      continue;
    }
    if (c === ',') { push(i); segStart = i + 1; }
  }
  push(close);
  return keys;
}

// ── Taint: which names in a file hold a message ─────────────────────────────

function taintedNames(code) {
  const lines = code.split('\n');
  const decls = [];
  const tainted = new Set();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(DECL)) {
      let rhs = line.slice(m.index + m[0].length);
      let j = i;
      // A declaration that continues onto the next lines: the line ends on an
      // operator, or the next one starts with one. Five lines is enough for
      // every `a || b || c` chain in the tree.
      while (
        !rhs.includes(';') && j < i + 5 && j + 1 < lines.length
        && (/(?:=|\|\||&&|\?\?|\?|:|\(|,)\s*$/.test(lines[j]) || /^\s*(?:\|\||&&|\?\?|\?|:|\.|\+)/.test(lines[j + 1]))
      ) {
        j++;
        rhs += `\n${lines[j]}`;
      }
      const semi = rhs.indexOf(';');
      decls.push({ name: m[1], rhs: semi >= 0 ? rhs.slice(0, semi) : rhs });
    }
    for (const m of line.matchAll(DESTRUCTURED_DECL)) {
      for (const b of m[1].matchAll(MESSAGE_BINDING)) tainted.add(b[1] || 'message');
    }
  });
  // Anything assigned from a tainted name is tainted too:
  // `const lower = msg.toLowerCase()` is still the message.
  for (let grew = true; grew;) {
    grew = false;
    for (const d of decls) {
      if (!tainted.has(d.name) && readsMessage(d.rhs, tainted)) {
        tainted.add(d.name);
        grew = true;
      }
    }
  }
  return tainted;
}

// ── The scan ─────────────────────────────────────────────────────────────────

const HINT = {
  equality: 'compare e.code instead; e.message is a sentence now',
  search: 'branch on e.code instead; e.message is a sentence now',
  lookup: 'key the table by e.code instead; e.message is a sentence now',
  switch: 'switch on e.code instead; e.message is a sentence now',
  'dead-body': 'nothing sets e.body; request() puts the body on e.data',
  'hand-built': 'build it with `throw await refusalError(res, fallback)` from lib/api.js',
};

/** Every finding in one file. `src` is the file as written; the scan reads its code only. */
function scan(rel, src) {
  const code = codeOnly(src);
  const tainted = taintedNames(code);
  const out = new Map();
  const add = (rule, index, snippet) => {
    const key = `${rule}:${index}`;
    if (!out.has(key)) out.set(key, { rule, file: rel, index, snippet: snippet.replace(/\s+/g, ' ').trim() });
  };

  for (const m of code.matchAll(EQ_LEFT)) {
    if (!m[1] && CODE.test(m[4]) && readsMessage(m[2], tainted)) add('equality', m.index, m[0]);
  }
  for (const m of code.matchAll(EQ_RIGHT)) {
    if (!m[3] && CODE.test(m[2]) && readsMessage(m[4], tainted)) add('equality', m.index, m[0]);
  }

  for (const m of code.matchAll(SEARCH)) {
    const needle = m[3] ?? m[4] ?? '';
    if (SNAKE.test(needle) && readsMessage(m[1], tainted)) add('search', m.index, m[0]);
  }
  for (const m of code.matchAll(REGEX_TEST)) {
    if (SNAKE.test(m[1]) && readsMessage(m[2], tainted)) add('search', m.index, m[0]);
  }

  const tables = new Map();
  for (const m of code.matchAll(TABLE_DECL)) {
    if (!tables.has(m[1])) tables.set(m[1], m.index + m[0].length - 1);
  }
  // A table is code-keyed when any of its own keys is a code. One it cannot
  // see — imported, or reached through a property — is assumed to be: the
  // guard would rather name a sentence-keyed table once than miss a code one.
  const codeKeyed = (name) => {
    if (!tables.has(name)) return true;
    const keys = topLevelKeys(code, tables.get(name));
    return keys === null || keys.some((k) => CODE.test(k));
  };
  for (const m of code.matchAll(LOOKUP)) {
    if (KEYWORDS.has(m[1])) continue;
    if (readsMessage(m[2], tainted) && codeKeyed(m[1])) add('lookup', m.index, m[0]);
  }
  for (const m of code.matchAll(HAS_OWN)) {
    if (readsMessage(m[2], tainted) && codeKeyed(m[1])) add('lookup', m.index, m[0]);
  }

  for (const m of code.matchAll(SWITCH)) {
    const open = m.index + m[0].length - 1;
    const close = balanced(code, open);
    if (close < 0 || !readsMessage(code.slice(open + 1, close), tainted)) continue;
    const brace = /^\s*\{/.exec(code.slice(close + 1));
    if (!brace) continue;
    const bodyOpen = close + brace[0].length;
    const bodyClose = balanced(code, bodyOpen);
    const body = bodyClose < 0 ? '' : code.slice(bodyOpen, bodyClose);
    if ([...body.matchAll(CASE_LITERAL)].some((c) => CODE.test(c[2]))) {
      add('switch', m.index, code.slice(m.index, close + 1));
    }
  }

  const scopes = [];
  for (const m of code.matchAll(CATCH_BLOCK)) {
    const open = m.index + m[0].length - 1;
    const close = balanced(code, open);
    if (close >= 0) scopes.push({ param: m[1], start: open, end: close });
  }
  for (const m of code.matchAll(CATCH_DESTRUCTURED)) {
    if (NAMES_BODY.test(m[1])) add('dead-body', m.index, m[0]);
  }
  for (const m of code.matchAll(CATCH_CALL)) {
    const open = m.index + m[0].length - 1;
    const close = balanced(code, open);
    if (close < 0) continue;
    const inner = code.slice(open + 1, close);
    const destructured = HANDLER_DESTRUCTURED.exec(inner);
    if (destructured && NAMES_BODY.test(destructured[1])) add('dead-body', m.index, m[0] + destructured[0]);
    const arrow = HANDLER_ARROW.exec(inner);
    const fn = HANDLER_FUNCTION.exec(inner);
    const param = arrow ? (arrow[1] || arrow[2]) : fn ? fn[1] : null;
    if (param) scopes.push({ param, start: open, end: close });
  }
  for (const s of scopes) {
    const body = code.slice(s.start, s.end);
    for (const b of body.matchAll(BODY_READ)) {
      if (b[1] === s.param) add('dead-body', s.start + b.index, b[0]);
    }
    for (const b of body.matchAll(BODY_DESTRUCTURE)) {
      if (b[2] === s.param && NAMES_BODY.test(b[1])) add('dead-body', s.start + b.index, b[0]);
    }
  }

  if (rel !== API) {
    for (const m of code.matchAll(HAND_BUILT)) add('hand-built', m.index, m[0]);
  }

  // Where each finding is: the line of code it sits on (what ALLOWED matches
  // against), and its line in the file as written — codeOnly drops whole
  // comment blocks, so the two line counts differ below any doc header.
  const codeLines = code.split('\n');
  return [...out.values()].map((f) => {
    const at = code.slice(0, f.index).split('\n').length;
    const needle = code.slice(f.index).split('\n')[0].trim();
    let seen = 0;
    for (let k = code.indexOf(needle); k >= 0 && k <= f.index + needle.length; k = code.indexOf(needle, k + 1)) seen++;
    let pos = -1;
    for (let n = 0; n < seen; n++) {
      pos = src.indexOf(needle, pos + 1);
      if (pos < 0) break;
    }
    const line = pos >= 0 ? src.slice(0, pos).split('\n').length : at;
    return { ...f, line, lineText: codeLines[at - 1] ?? '', snippet: f.snippet.slice(0, 160) };
  });
}

// ── The tree ─────────────────────────────────────────────────────────────────

/** Every source file under frontend/src, as `path relative to src` → contents. */
function sources() {
  const out = new Map();
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(full, rel); continue; }
      if (!/\.(js|jsx|ts|tsx)$/.test(rel)) continue;
      out.set(rel, readFileSync(full, 'utf8'));
    }
  };
  walk(SRC, '');
  return out;
}
const FILES = sources();
const FINDINGS = [...FILES].flatMap(([rel, src]) => scan(rel, src));

/**
 * Sites the scan flags that are not a refusal read through `request()`. Each
 * names a phrase from the flagged line, so an entry follows its line through
 * edits above it and dies with it.
 */
const ALLOWED = [
  {
    rule: 'hand-built',
    file: 'components/advisor/PersonalAdvisor.jsx',
    phrase: "data.message || 'explain stream error'",
    why: "an SSE `error` frame's own message inside a 200 stream — no HTTP refusal exists for request() to read",
  },
  {
    rule: 'hand-built',
    file: 'pages/IntegrationsPage.jsx',
    phrase: 'Could not start Google connect.',
    why: 'a 200 answer that carries no redirect URL; request() only reads refusals',
  },
  {
    rule: 'hand-built',
    file: 'pages/IntegrationsPage.jsx',
    phrase: 'Could not start LinkedIn connect.',
    why: 'a 200 answer that carries no authorize URL; request() only reads refusals',
  },
  {
    rule: 'hand-built',
    file: 'pages/IntegrationsPage.jsx',
    phrase: 'Could not start Microsoft connect.',
    why: 'a 200 answer that carries no redirect URL; request() only reads refusals',
  },
  {
    rule: 'hand-built',
    file: 'pages/ApiBridgePage.jsx',
    phrase: 'err.detail || "Request failed"',
    why: 'inside the bridge code sample the page shows developers — text, not code this app runs',
  },
  {
    rule: 'hand-built',
    file: 'pages/research/CompanyCandidate.jsx',
    phrase: 'That URL did not return a page.',
    why: 'POST /competitors/fetch answers 200 {ok:false, error:<code>} — the Worker should refuse instead; filed with task 435',
  },
];

const isAllowed = (f) => ALLOWED.some((a) => a.rule === f.rule && a.file === f.file && f.lineText.includes(a.phrase));

test('the scan reads the whole tree, not a corner of it', () => {
  // A walk that silently lost a directory would pass everything below.
  assert.ok(FILES.size >= 700, `only ${FILES.size} source files were scanned`);
  assert.ok(FILES.has(API), 'lib/api.js was not scanned');
});

test('no page reads a refusal\'s code through its message, or a body off e.body', () => {
  const offending = FINDINGS.filter((f) => !isAllowed(f));
  assert.deepEqual(
    offending.map((f) => `${f.file}:${f.line}  [${f.rule}]  ${f.snippet}\n      → ${HINT[f.rule]}`),
    [],
    [
      `${offending.length} site(s) read a refusal the pre-D258 way.`,
      'request() puts the sentence in e.message, the machine code in e.code and the body in e.data (D258).',
      'A match on a code through e.message never fires any more, because the Worker\'s own sentence wins.',
      'If a flagged `.message` is not an HTTP refusal — a chat message, an SSE frame, a 200 body —',
      'add an ALLOWED entry in frontend/test/code_through_message_d258.test.mjs naming the file,',
      'a phrase from the line, and why.',
    ].join('\n'),
  );
});

test('every ALLOWED entry still names a site the scan flags', () => {
  const stale = ALLOWED.filter((a) => !FINDINGS.some(
    (f) => f.rule === a.rule && f.file === a.file && f.lineText.includes(a.phrase),
  ));
  assert.deepEqual(
    stale.map((a) => `${a.file} [${a.rule}] "${a.phrase}"`),
    [],
    'an allowance whose line is gone or fixed — delete the entry',
  );
});

// ── The scan, checked against itself ───────────────────────────────────────

const wrap = (body) => `export async function run(api, setError, toast) {\n${body}\n}\n`;

// Each is the shape D258 removed. Most are verbatim from the lines commit 3
// deleted; the rest exercise a branch of a rule those lines did not reach.
const CAUGHT = [
  ['equality', 'RecoverPage', wrap(`  try { await api.post('/x'); } catch (e) {
    setError(e?.message === 'not_enough_trusted_contacts'
      ? 'Two trusted contacts must confirm first.' : 'Could not start recovery.');
  }`)],
  ['equality', 'a code on the left of the comparison', wrap(`  try { await api.post('/x'); } catch (e) {
    if ('no_method_id' === e.message) setError('Pick a method first.');
  }`)],
  ['search', 'TotpEnrollment, through a name', wrap(`  try { await api.post('/x'); } catch (e) {
    const msg = e.message || '';
    setError(/invalid_code/i.test(msg) ? 'That code did not match.' : msg);
  }`)],
  ['search', 'AdminX, inline', wrap(`  try { await api.post('/x'); } catch (e) {
    if (e?.status === 422 || /pii_linter_blocked/.test(e?.message || '')) {
      setError('Blocked.');
    }
  }`)],
  ['search', 'ProjectDetail, beside a legitimate code read', wrap(`  try { await api.post('/x'); } catch (e) {
    const msg = String(e?.message || '');
    const code = e?.data?.error;
    if (code === 'crunchbase_not_connected' || /not_connected/i.test(msg)) setError('Connect it first.');
  }`)],
  ['search', 'IntegrationsPage, a method search two names deep', wrap(`  try { await api.post('/x'); } catch (e) {
    const msg = e?.message || '';
    const lower = msg.toLowerCase();
    if (lower.includes('slack_webhook_unconfigured')) setError('Set the webhook first.');
  }`)],
  ['lookup', 'PublicJobDetailPage', `const APPLY_ERROR_MESSAGES = {
  already_applied: 'You have already applied to this role.',
  job_closed: 'This role has closed.',
};
${wrap(`  try { await api.post('/x'); } catch (err) {
    const raw = err?.message || '';
    const msg = APPLY_ERROR_MESSAGES[raw] || raw || 'Something went wrong. Please try again.';
    setError(msg);
  }`)}`],
  ['lookup', 'a table the file cannot see', `import { FRIENDLY } from './copy.js';
${wrap(`  try { await api.post('/x'); } catch (e) {
    setError(FRIENDLY[e.message] || e.message);
  }`)}`],
  ['switch', 'a switch on the message', wrap(`  try { await api.post('/x'); } catch (e) {
    switch (e.message) {
      case 'daily_cap_reached': setError('Try tomorrow.'); break;
      default: setError(e.message);
    }
  }`)],
  ['dead-body', 'AdminTelegram, in a catch block', wrap(`  try { await api.post('/x'); } catch (e) {
    if (e?.body?.code === 'pii_linter_blocked') {
      setError('Blocked.');
    }
  }`)],
  ['dead-body', 'a .catch() handler', wrap(`  await api.post('/x').catch((err) => setError(err?.body?.detail === 'unsupported_type'
    ? 'That file type is not accepted.' : err.message));`)],
  ['dead-body', 'a destructured catch parameter', wrap(`  try { await api.post('/x'); } catch ({ body }) {
    setError(body?.message);
  }`)],
  ['hand-built', 'a raw fetch helper', wrap(`  const r = await fetch('/api/x');
  const j = await r.json();
  if (!r.ok) throw new Error(j?.message || j?.error || \`HTTP \${r.status}\`);`)],
  // Calls and index reads keep the value, so these are still the message.
  ['equality', 'the message through a chain of calls', wrap(`  try { await api.post('/x'); } catch (e) {
    if (e.message.trim().toLowerCase() === 'no_method_id') setError('Pick a method first.');
  }`)],
  ['search', 'the message through a call and an index', wrap(`  try { await api.post('/x'); } catch (e) {
    if (/no_method_id/.test(e.message.split(':')[0])) setError('Pick a method first.');
  }`)],
];

// Shapes that look like the ones above and are correct.
const PASSES = [
  ['a typeof check is not a code', wrap(`  try { await api.post('/x'); } catch (e) {
    setError(typeof e.message === 'string' ? e.message : 'Failed.');
  }`)],
  ['a single word is a sentence match', wrap(`  try { await api.post('/x'); } catch (e) {
    const msg = e.message || '';
    if (msg.includes('already')) setError('Already done.');
  }`)],
  ['a table keyed by sentences', `const FRIENDLY = {
  'TOTP required': 'Turn on your authenticator first.',
  'Session expired': 'Sign in again.',
};
${wrap(`  try { await api.post('/x'); } catch (e) {
    setError(FRIENDLY[e.message] || e.message);
  }`)}`],
  ['a code read off e.code', wrap(`  try { await api.post('/x'); } catch (e) {
    if (e.code === 'pii_linter_blocked') setError('Blocked.');
  }`)],
  ['the body read off e.data', wrap(`  try { await api.post('/x'); } catch (e) {
    setError(e?.data?.findings?.length ? 'Findings.' : e.message);
  }`)],
  ['a Response body that is not the caught error', wrap(`  try { await api.post('/x'); } catch (e) {
    const res = await fetch('/api/y');
    toast(res.body ? 'streamed' : e.message);
  }`)],
  ['a sentence compared with a sentence', wrap(`  try { await api.post('/x'); } catch (e) {
    if (e.message === 'Unauthorized') setError('Sign in again.');
  }`)],
  ['an Error from a literal', wrap(`  if (!api) throw new Error('No API client.');`)],
  // Taint is per file, so a name that holds a message in one function is a
  // chat bubble in the next. A named property read off it is not the message.
  ['a property of a message-bearing name', wrap(`  const m = frame.message;
  const wrote = m.written_to;
  if (m.role === 'user' || wrote.status === 'ok') toast('mine');`)],
  ['a property of a field called message', wrap(`  if (msg.message?.role === 'system') toast('system');`)],
  // Destructuring `messages` binds `messages`, not `message`.
  ['a destructured plural is not a message', wrap(`  const { messages } = await api.get('/thread');
  const message = pick(messages);
  if (message === 'draft') toast('draft');`)],
];

test('each pre-D258 shape is caught once, by its own rule', () => {
  for (const [rule, name, src] of CAUGHT) {
    const found = scan('fixture.jsx', src);
    assert.deepEqual(
      found.map((f) => f.rule),
      [rule],
      `${name}: expected one ${rule} finding, got ${JSON.stringify(found.map((f) => [f.rule, f.snippet]))}`,
    );
  }
});

test('the look-alikes that are correct pass', () => {
  for (const [name, src] of PASSES) {
    assert.deepEqual(scan('fixture.jsx', src), [], name);
  }
});

test('lib/api.js may build an Error from a body; nothing else may', () => {
  const src = wrap(`  const j = await r.json();
  throw new Error(j.detail || 'Request failed');`);
  assert.deepEqual(scan(API, src), [], 'the hand-built rule skips lib/api.js, which is where refusalError lives');
  assert.deepEqual(scan('pages/Somewhere.jsx', src).map((f) => f.rule), ['hand-built']);
});
