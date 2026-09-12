#!/usr/bin/env node
/**
 * check-unused-imports — a name a module binds and never uses.
 *
 * TWO SHAPES, one rule. `import { a } from '…'` where `a` is never used, and
 * `const { a } = obj` where `a` is never used. `check-react-hook-imports.mjs`
 * guards the opposite direction — a name used but never imported — and its
 * header puts it well: the two are "the two halves of one rule: the set of
 * names a module imports and the set it uses must agree." A dead destructured
 * binding is the same dead text arriving by a different route.
 *
 * Small, and it earns its place empirically: CodeQL raised this on this
 * repository three separate times in one working session (alerts 5939, 5941,
 * 5942) — two unused React/lucide imports and an unused `statSync`. Each was a
 * thirty-second fix that cost a full CI round trip to discover, because the
 * only thing checking was a scanner that runs after the push.
 *
 * IMPORTS ARE DELIBERATELY NARROW. Only `import { a, b } from '…'` is examined:
 * default and namespace imports are frequently side-effecting or re-exported,
 * and flagging them would produce noise rather than findings.
 *
 * Type-only names are unwrapped (`import { type Foo }`) and then checked like
 * any other, because an unused type import is still dead text — but the
 * `type ` prefix has to come off first, or every one of them reads as unused.
 * The first draft of this script got that wrong and reported eight
 * false positives in `captable.ts` alone.
 *
 * DESTRUCTURING IS NARROWER STILL, and every restriction below is a false
 * positive a draft actually produced against this repository:
 *
 *   - `const` only. Not `let`/`var`, not function parameters, not
 *     `catch ({ … })`. A parameter list is an API declaration as much as a
 *     binding, and it is where the rest-spread idiom below lives.
 *   - A REST ELEMENT SKIPS THE WHOLE PATTERN. `const { password, ...safe } =
 *     user` names `password` precisely in order to exclude it from `safe`;
 *     reporting it would break correct code. Nine such patterns exist here.
 *   - COMMAS ARE SPLIT AT TOP LEVEL ONLY. Naive `split(',')` reported seven
 *     findings — `identity`, `auditably`, `attributing` — which were not
 *     bindings at all but fragments of prose, from string defaults like
 *     `subheadline = 'Axal gives … payments, identity, and policy primitives
 *     … safely, auditably, and at scale.'` in the brand/templates family.
 *   - BRACES ARE MATCHED, NOT REGEXED. `\{([^}]*)\}` stops at the first inner
 *     `}`, so a nested pattern is silently truncated rather than skipped.
 *     Anything that does not reduce to a plain identifier — nested, computed,
 *     unexpected — skips the whole pattern. Skip, never guess.
 *
 * As of writing, zero destructured bindings in this repository are dead. The
 * guard is preventive, so `frontend/test/unused_imports_guard.test.mjs` is the
 * evidence it can fail at all — this folder's README already insists on that:
 * "a guard that cannot fail on the bug it was written for is decoration."
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
export const TREES = ['frontend/src', 'cloudflare-worker/src', 'scripts', 'frontend/test', 'cloudflare-worker/test'];
const EXT = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const SKIP = new Set(['node_modules', 'dist', '__pycache__']);

export function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(extname(e.name))) out.push(p);
  }
  return out;
}

/**
 * Source with template literals blanked out.
 *
 * Widening this guard to the test trees immediately produced four false
 * positives in `cloudflare-worker/test/wellbeing_route.test.mjs`, where the
 * lines
 *
 *     import { validateDailyBody, encryptOrFallback } from './wellbeing.helpers.mjs';
 *
 * are not imports at all — they sit inside a `const composed = ` … ``
 * template that the test assembles and evaluates at runtime. Removing those
 * names, as the guard advised, would have broken a passing test.
 *
 * A real import statement can never be inside backticks, so blanking template
 * spans is sound. It errs toward MISSING an import rather than inventing one,
 * which is the direction this file's header already argues for: a false
 * negative costs a CodeQL alert, a false positive blocks correct work and
 * teaches everyone to ignore the guard.
 *
 * Newlines are preserved so any line numbers stay meaningful.
 */
export function withoutTemplates(src) {
  return blankMatches(src, /`(?:\\.|[^`\\])*`/gs);
}

/**
 * Replace every match with spaces, keeping the string's length and its lines.
 *
 * Length preservation is not cosmetic. Offsets taken from one derived copy are
 * used to blank text in another, and a `replace(…, '')` anywhere in that chain
 * silently shifts every index after it.
 */
export function blankMatches(src, re) {
  return src.replace(re, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * The two comment shapes a string literal cannot produce, blanked.
 *
 * Blanket regex comment-removal on JSX is unsound: an INLINE `/*` inside a
 * string or a className opens a comment that runs to the next close far below.
 * The first version of this script did that, ate half of
 * SpinoutLabScoringPage.jsx, and reported `useState` — used nineteen times in
 * that file — as unused. So only a block comment that STARTS a line at column 0
 * and a line that is nothing but a `//` comment are touched.
 *
 * THIS APPLIES TO FINDING DECLARATIONS TOO, not just to the usage search. The
 * destructuring half was written without it and immediately reported three
 * bindings dead that exist only as EXAMPLE CODE inside this file's own doc
 * comments. That is the second time this guard has tripped over its own prose:
 * the header records CodeQL alert 5943, raised because the docblock mentioned
 * `statSync` and so made the unused `statSync` import read as used.
 *
 * Inline comment markers — where the real hazard lives — are left alone, so a
 * name mentioned in a trailing comment still reads as used and is missed. That
 * residual gap is the safe direction: a false negative costs a CodeQL alert, a
 * false positive blocks correct work and teaches everyone to ignore the guard.
 */
export function withoutSafeComments(src) {
  return blankMatches(blankMatches(src, /^\/\*[\s\S]*?\*\//gm), /^[ \t]*\/\/[^\n]*$/gm);
}

/**
 * Single- and double-quoted strings, blanked.
 *
 * Used ONLY when looking for destructuring declarations, on the same reasoning
 * that already covers template literals: a real `const { … } =` cannot be
 * inside a string literal. This file's own test fixtures are the proof — they
 * put example declarations in quoted strings, and the guard reported
 * `onlyInAComment` and `alsoJustProse` as dead bindings on its first run
 * against them.
 *
 * NOT used for the import half: `namedImports` matches `from '…'`, and blanking
 * the module path would stop every import from being recognised at all.
 *
 * Run this AFTER `withoutSafeComments`, which is what makes it safe: an
 * apostrophe in prose (`// it's fine`) would otherwise open a string and blank
 * everything to the next quote. Comment text is already gone by then. An
 * apostrophe in JSX body text can still do it, and the cost is a declaration
 * that goes unexamined — a false negative, which is the direction this guard
 * errs in everywhere else.
 */
export function withoutStrings(src) {
  return blankMatches(src, /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g);
}

/** Every named binding an import statement introduces, with the `type ` prefix off. */
export function namedImports(src) {
  const out = [];
  for (const m of src.matchAll(/^import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gm)) {
    for (const raw of m.group?.(1) ?? m[1].split(',')) {
      const piece = typeof raw === 'string' ? raw : String(raw);
      const name = piece.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.push({ name, index: m.index ?? 0 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Destructured locals
//
// These three walk characters rather than matching a pattern, because every
// shortcut here has a counter-example in this repository. See the header.

/**
 * Index just past the bracket matching the one at `i`, or -1.
 *
 * Tracks `{}` / `[]` / `()` depth AND string state, so a brace or comma inside
 * a string default cannot end the scan early.
 */
export function matchBracket(src, i) {
  const CLOSE = { '{': '}', '[': ']', '(': ')' };
  const stack = [src[i]];
  let quote = null;
  for (let k = i + 1; k < src.length; k += 1) {
    const ch = src[k];
    if (quote) {
      if (ch === '\\') { k += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { stack.push(ch); continue; }
    if (ch === '}' || ch === ']' || ch === ')') {
      if (ch !== CLOSE[stack[stack.length - 1]]) return -1;
      stack.pop();
      if (!stack.length) return k + 1;
    }
  }
  return -1;
}

/** Top-level comma-separated pieces with their offsets into `str`. */
export function topParts(str) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let k = 0; k < str.length; k += 1) {
    const ch = str[k];
    if (quote) {
      if (ch === '\\') { k += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth += 1; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; continue; }
    if (ch === ',' && depth === 0) { out.push({ text: str.slice(start, k), at: start }); start = k + 1; }
  }
  out.push({ text: str.slice(start), at: start });
  return out;
}

/**
 * First top-level `want`, or -1.
 *
 * For `=` this must recognise a plain assignment and nothing else. Testing only
 * the NEXT character is not enough: in `a === b` the pair at 2–3 is stepped
 * over and the third `=` at index 4 then reads as an assignment, which chopped
 * `a = x === y` in the wrong place.
 */
export function topIndexOf(str, want) {
  let depth = 0;
  let quote = null;
  for (let k = 0; k < str.length; k += 1) {
    const ch = str[k];
    if (quote) {
      if (ch === '\\') { k += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth += 1; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; continue; }
    if (depth === 0 && ch === want) {
      if (want === '=' && (/[=!<>+\-*/%&|^]/.test(str[k - 1] || '') || str[k + 1] === '=' || str[k + 1] === '>')) continue;
      return k;
    }
  }
  return -1;
}

/**
 * Every `const { … } =` pattern, as `{ start, end, inner }` spans.
 *
 * `start`/`end` bracket the `{ … }` itself and NOT the right-hand side, which
 * matters: `const { a } = x; const { b } = a;` is a real use of `a`, so
 * blanking the whole statement would report it dead.
 */
export function destructurePatterns(src) {
  const out = [];
  for (const m of src.matchAll(/(?:^|[^\w$.])const\s*(?=\{)/g)) {
    const open = (m.index ?? 0) + m[0].length;
    const end = matchBracket(src, open);
    if (end < 0) continue;
    // `const {a} = x` is a destructuring declaration; `const {a}` followed by
    // anything else is not one we understand, so leave it alone.
    if (!/^\s*=(?!=|>)/.test(src.slice(end))) continue;
    out.push({ start: open, end, inner: src.slice(open + 1, end - 1) });
  }
  return out;
}

/**
 * The plain identifiers a pattern binds, or `null` to skip the whole pattern.
 *
 * `null` is the important half: a rest element, a nested pattern, a computed
 * key or anything unrecognised returns it, because a guess here is a false
 * positive and a false positive is what teaches people to ignore the guard.
 */
export function destructuredNames(inner) {
  const spans = destructuredSpans(inner);
  return spans && spans.map((s) => s.name);
}

/**
 * The same bindings, each with its offset inside `inner`, or `null` to skip.
 *
 * The offsets are what let the body preparation blank the BINDING ALONE rather
 * than the whole pattern — see `prepareBody`.
 */
export function destructuredSpans(inner) {
  const out = [];
  for (const { text, at } of topParts(inner)) {
    if (!text.trim()) continue;
    const eq = topIndexOf(text, '=');             // drop a default
    const left = eq >= 0 ? text.slice(0, eq) : text;
    const colon = topIndexOf(left, ':');          // `key: binding` → binding
    const namePart = colon >= 0 ? left.slice(colon + 1) : left;
    const lead = namePart.length - namePart.trimStart().length;
    const name = namePart.trim();
    // THE ONE REFUSAL, and it carries every skip the header lists. A rest
    // element (`...safe`), a nested pattern (`a: { b }`), an array pattern, a
    // hole — none of them reduce to a plain identifier, so all of them land
    // here and abandon the whole pattern rather than half-reading it.
    //
    // The rest case is the one worth naming, because it is the only skip that
    // protects CORRECT code rather than merely declining to parse:
    // `const { password, ...safe } = user` names `password` precisely so that
    // `safe` will not contain it, and reporting it would demand a change that
    // breaks the redaction. An earlier draft tested for `...` separately; that
    // branch could never be reached, because this line had already refused.
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
    out.push({ name, at: at + (colon >= 0 ? colon + 1 : 0) + lead });
  }
  return out;
}

/** Every destructured binding in a source, with absolute offsets. */
export function destructureBindings(src) {
  const out = [];
  for (const p of destructurePatterns(src)) {
    const spans = destructuredSpans(p.inner);
    if (!spans) continue;
    for (const s of spans) out.push({ name: s.name, start: p.start + 1 + s.at, length: s.name.length });
  }
  return out;
}

/**
 * The text a usage search runs over.
 *
 * ORDER IS LOAD-BEARING. The binding spans are blanked FIRST, while their
 * indices still address `src`; the strips below replace with `''` and so change
 * the string's length. Doing it the other way round blanked the wrong ranges
 * and reported thirteen bindings dead that were used on the very next line.
 *
 * ONLY THE BINDING NAME IS BLANKED, never the rest of the pattern. Blanking the
 * whole `{ … }` span looks tidier and is wrong twice over: a default and a
 * computed key are ordinary expressions that may reference ANOTHER binding, and
 * blanking them loses that use —
 *
 *     const { fallback } = cfg;
 *     const { size = fallback } = opts;     // `fallback` is used HERE
 *     const { [keyName]: picked } = row;    // and `keyName` HERE
 *
 * — both of which were reported dead before this was narrowed.
 */
export function prepareBody(src, bindings = []) {
  const chars = src.split('');
  for (const b of bindings) {
    for (let k = b.start; k < b.start + b.length && k < chars.length; k += 1) {
      if (chars[k] !== '\n') chars[k] = ' ';
    }
  }
  // Every step here preserves length, so no step can invalidate the offsets of
  // a later one. The import statements go because a name imported and never
  // used must not read as used by its own import line.
  return blankMatches(withoutSafeComments(chars.join('')), /^import\s[\s\S]*?from\s*['"][^'"]+['"];?$/gm);
}

const used = (body, name) => new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(body);

/** Every dead binding in one file's source, both shapes, as message strings. */
export function deadBindings(src) {
  // Templates are blanked to FIND declarations — a real one can never sit
  // inside backticks — but left intact for the usage search below, so a name
  // used only inside a template literal still reads as used. Widening this
  // guard to the test trees without that asymmetry produced four false
  // positives in `cloudflare-worker/test/wellbeing_route.test.mjs`, where
  // import-looking lines sit inside a template the test evaluates at runtime.
  // TWO SCAN COPIES, both length-preserving so offsets stay valid against
  // `src`. The import half needs `from '…'` intact to match at all; the
  // destructuring half needs quoted strings gone, or an example declaration
  // inside one reads as real.
  const scan = withoutSafeComments(withoutTemplates(src));
  const bindings = destructureBindings(withoutStrings(scan));
  const body = prepareBody(src, bindings);
  const out = [];
  for (const { name } of namedImports(scan)) {
    if (!used(body, name)) out.push({ name, kind: 'imported' });
  }
  const seen = new Set();
  for (const { name } of bindings) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (!used(body, name)) out.push({ name, kind: 'destructured' });
  }
  return out;
}

// ---------------------------------------------------------------------------

function main() {
  const findings = [];
  for (const tree of TREES) {
    for (const file of walk(join(ROOT, tree))) {
      const src = readFileSync(file, 'utf8');
      for (const { name, kind } of deadBindings(src)) {
        findings.push(`${relative(ROOT, file)} — \`${name}\` is ${kind} and never used`);
      }
    }
  }

  if (findings.length) {
    console.error('✖ check-unused-imports:\n' + findings.map((f) => `  - ${f}`).join('\n'));
    console.error('\nRemove the name from its import or its destructuring pattern. CodeQL\nreports these as alerts, so the choice is here or in a CI round trip.');
    process.exit(1);
  }
  console.log(`✓ check-unused-imports: every named import and destructured const across ${TREES.join(', ')} is used.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
