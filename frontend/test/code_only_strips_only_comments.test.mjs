/**
 * `codeOnly` gained the brace-comment rule, and this is what says it eats only
 * comments.
 *
 * The rule removes `{/* … *\/}` and `catch { /* … *\/ }`. Its whole risk is the
 * one the helper's own docblock names: a stripper that opens on a `/*` inside a
 * string once ate half of SpinoutLabScoringPage.jsx and reported `useState` —
 * used nineteen times in it — as unused. A helper that silently removes live
 * code does not fail loudly; it makes every assertion downstream weaker and
 * some of them false.
 *
 * So the assertion is a property over the real tree rather than a fixture: for
 * every `.jsx` under `frontend/src`, stripping must leave the count of three
 * markers that only ever appear in live code — `useState`, `className`,
 * `return` — exactly as it found them, EXCEPT where a comment genuinely
 * contained one, which is measured rather than assumed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { codeOnly, codeOnlyJsx, BRACE_COMMENT } from './_codeOnly.mjs';

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, 'frontend', 'src');
// The SAME shape codeOnly removes, so "what the comments themselves contained"
// is measured with the rule under test rather than a looser approximation of
// it — a looser one spans differently and reports prose as lost code.
const BRACE_SRC = BRACE_COMMENT.source;
const braceAll = () => new RegExp(BRACE_SRC, 'g');
const MARKERS = ['useState', 'className', 'return'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.jsx')) out.push(p);
  }
  return out;
}
const count = (s, needle) => s.split(needle).length - 1;

// codeOnly as it stood BEFORE the brace rule, so the comparison isolates the
// new rule from the two line-oriented strips that were always there — those
// legitimately remove a `// return …` comment line, and measuring against the
// raw file blames the new rule for them.
function codeOnlyWithoutBraceRule(src) {
  return String(src)
    .replace(/^\/\*[\s\S]*?\*\//gm, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/^\s*\*[^\n]*$/gm, '');
}

test('the brace rule removes ONLY text that was inside a brace comment', () => {
  const files = walk(SRC);
  assert.ok(files.length > 200, `expected the real tree, walked ${files.length} files`);

  const damaged = [];
  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const before = codeOnlyWithoutBraceRule(raw);
    const after = codeOnly(raw);
    // What the brace comments THEMSELVES contained. Anything the new rule
    // removed beyond this came out of live code, which is the defect.
    const inComments = (raw.match(braceAll()) ?? []).join('\n');
    for (const m of MARKERS) {
      const lost = count(before, m) - count(after, m);
      const allowed = count(inComments, m);
      if (lost > allowed) {
        damaged.push(`${relative(ROOT, file)} — lost ${lost} "${m}", only ${allowed} were in comments`);
      }
    }
  }
  assert.deepEqual(damaged, [],
    'the brace rule removed live code, not prose — it is pairing an opening `{` '
    + 'with a close marker further down than the comment it started in:\n  '
    + damaged.join('\n  '));
});

test('the brace rule actually fires on this tree, so the test above is not vacuous', () => {
  const withBrace = walk(SRC).filter((f) => new RegExp(BRACE_SRC).test(readFileSync(f, 'utf8')));
  assert.ok(withBrace.length > 50,
    `only ${withBrace.length} files carry a brace comment — if this has gone to zero the `
    + 'property test above passes without exercising the rule it exists for');
});

test('a bare inline comment is still left alone, which is the caution being kept', () => {
  const src = 'const s = "a /* b"; useState(); // trailing banned-word\nuseState();';
  assert.ok(codeOnly(src).includes('/* b'),
    'a bare `/*` inside a string must survive — opening on it is what ate '
    + 'SpinoutLabScoringPage.jsx, and widening to the brace pair must not widen to this');
});

test('codeOnlyJsx is the same function, so its six callers did not change behaviour', () => {
  assert.equal(codeOnlyJsx, codeOnly);
});

test('no single match spans two comments — the rule cannot reach past its own close', () => {
  // This is the assertion the property test above cannot make. A lazy
  // `[\\s\\S]*?` body matches the first `*/` and then BACKTRACKS when the next
  // character is not `}`, pairing the opening `{` with a close marker much
  // further down and swallowing everything between — it ate ten `return`s out
  // of App.jsx before the body was written so it cannot contain `*/` at all.
  const offenders = [];
  for (const file of walk(SRC)) {
    const raw = readFileSync(file, 'utf8');
    for (const m of raw.match(braceAll()) ?? []) {
      const closes = count(m, '*/');
      if (closes !== 1) offenders.push(`${relative(ROOT, file)} — one match holds ${closes} close markers`);
    }
  }
  assert.deepEqual(offenders, [],
    'a brace-comment match ran past its own `*/`, so everything between two '
    + `comments was removed as if it were prose:\n  ${offenders.join('\n  ')}`);
});

test('two adjacent comments are two matches, never one span', () => {
  // The hazard the explicit body exists for, as a fixture rather than a claim
  // about this tree: a lazy body backtracks past the first close marker looking
  // for a `}`, joins both comments into one match and removes the live `x`
  // between them. Measured, no file under frontend/src triggers it today — so
  // this is the assertion that keeps the body from being "simplified" back.
  const src = 'A{/* one */ x /* two */}B';
  const out = codeOnly(src);
  assert.ok(out.includes('x'),
    'the brace rule joined two comments into one match and ate the code between '
    + `them — got ${JSON.stringify(out)}`);
});

test('a brace comment is actually removed — the rule is applied, not merely declared', () => {
  // Without this, deleting the .replace() line escapes every assertion above:
  // the property test only bounds what the rule may remove, and bounds hold
  // trivially when it removes nothing.
  for (const src of ['A{/* banned-word */}B', 'catch { /* banned-word */ }']) {
    assert.ok(!codeOnly(src).includes('banned-word'),
      `codeOnly left a brace comment in place — the rule is not being applied to ${JSON.stringify(src)}`);
  }
});
