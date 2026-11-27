/**
 * A name declared in one component and read in another is a blank page.
 *
 * THIS SHIPPED, AND CODEQL FOUND IT ON THE PR. `FounderGrowFocus.jsx` declared
 * two counters inside `FounderGrowFocus` and read them only from `FocusContent`,
 * a sibling function thirty lines down:
 *
 *     export default function FounderGrowFocus() {
 *       const metCount = read.filter((t) => t.met === true).length;   // declared
 *     }
 *     function FocusContent({ … }) {
 *       …value={`${metCount} of …`}…                                  // read
 *     }
 *
 * A `ReferenceError` the moment the Target tile renders, which blanks the whole
 * route. **esbuild bundles it without complaint** — the identifier is legal
 * JavaScript that resolves to nothing — and this repo has no lint step for it.
 * `profile_zone_actions.test.mjs` documents the identical class for zone rows in
 * its own words ("a ReferenceError that blanks the whole route at render — and it
 * is NOT a build error"), and a Stat tile is outside that test's reach.
 *
 * CODEQL CAUGHT TWO OF THE THREE, and the reason is worth keeping: it reports an
 * unused DECLARATION, so `read` — used inside the function that declares it AND
 * read from the sibling — was invisible to it. The name it could not see was the
 * one that appeared four times.
 *
 * WHY THIS TEST IS ONE FILE WIDE. A general "no identifier resolves to nothing"
 * check needs real scope analysis: an attempt at one over all 300-odd `.jsx`
 * files reported forty false positives on `App.jsx` alone from destructured
 * props, then eight more from arrow-callback parameters, and a guard that cries
 * wolf collects exclusions until it means nothing — which is the story
 * `scripts/sqlite-table-collisions-baseline.json` already tells about a guard on
 * this repo. Task #200 records the general problem and the measurement.
 *
 * So: this file, exactly, checked exactly. It is where the bug happened and where
 * the next edit to a four-component page will happen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const PATH = 'frontend/src/pages/founder/FounderGrowFocus.jsx';
const SRC = codeOnly(readFileSync(resolve(process.cwd(), PATH), 'utf8'));

/**
 * One top-level function's body, by brace balance from its own `function` line.
 *
 * LOCATED BY STRING SEARCH, NOT A CONSTRUCTED REGEX. Semgrep's
 * `detect-non-literal-regexp` flagged the `new RegExp` this used to build from
 * `name` (alert 6086), and it is right to: a regex compiled from a variable is
 * worth avoiding even where the variable is a literal three lines below in the
 * same file. The two forms a top-level declaration can take are two literal
 * probes, which is also plainer than the alternation it replaces.
 */
function body(name) {
  const at = [`\nfunction ${name}(`, `\nexport default function ${name}(`]
    .map((probe) => SRC.indexOf(probe))
    .filter((i) => i >= 0)
    .reduce((lo, i) => (lo < 0 || i < lo ? i : lo), -1);
  assert.ok(at >= 0, `${PATH} no longer declares ${name}`);
  // Walk past the parameter list — a destructured props object opens a brace of
  // its own, and taking the first `{` after the name gives the props pattern
  // rather than the body.
  let i = SRC.indexOf('(', at);
  let pd = 0;
  for (; i < SRC.length; i += 1) {
    if (SRC[i] === '(') pd += 1;
    else if (SRC[i] === ')') { pd -= 1; if (pd === 0) break; }
  }
  const open = SRC.indexOf('{', i);
  let depth = 0;
  let j = open;
  for (; j < SRC.length; j += 1) {
    if (SRC[j] === '{') depth += 1;
    else if (SRC[j] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return SRC.slice(open, j + 1);
}

test('FocusContent reads nothing that only FounderGrowFocus has', () => {
  const host = body('FounderGrowFocus');
  const child = body('FocusContent');
  // The three names the bug was made of. Each was declared in the host and read
  // in the child; two were reported by CodeQL and the third — `read`, which
  // appeared four times in the child — was not.
  // PARSED ONCE WITH LITERAL PATTERNS, then indexed — same reason as `body`
  // above, and it reads better than compiling two regexes per name. `read` is a
  // BARE identifier: not after a dot (that is a property) and not before a colon
  // (that is a key or a label), which is what the lookaround pair encodes.
  const readInChild = new Set(
    [...child.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)(?![\w$:])/g)].map((m) => m[1]),
  );
  const declaredInChild = new Set(
    [...child.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  );
  for (const name of ['metCount', 'measured', 'readTargets']) {
    assert.ok(host.includes(name) || name === 'metCount' || name === 'measured',
      `${name} left the host, so this assertion no longer describes anything`);
    assert.ok(!readInChild.has(name) || declaredInChild.has(name),
      `FocusContent reads \`${name}\` without declaring it — a ReferenceError at render`);
  }
});

test('the counters are computed where they are read, from the prop that carries them', () => {
  const child = body('FocusContent');
  assert.match(child, /const metCount = targets\.filter/,
    'metCount is not computed in FocusContent');
  assert.match(child, /const measured = targets\.filter/,
    'measured is not computed in FocusContent');
  // `targets` is a PROP, and it has to be one — computing from a name the child
  // does not receive is the same bug with a different identifier.
  const head = SRC.slice(SRC.indexOf('function FocusContent'), SRC.indexOf('{', SRC.indexOf('function FocusContent')) + 400);
  assert.match(head, /targets/, 'FocusContent no longer receives `targets`');
});

/**
 * THERE IS NO GENERIC ASSERTION HERE, and the reason is the same one that stopped
 * a repo-wide guard: this page's own copy contains the words `read`, `value`,
 * `current` and `keys`, so a checker walking identifiers cannot tell a reference
 * from a class name, a heading or a sentence. Three separate attempts reported
 * class names and prose as ReferenceErrors.
 *
 * The identifier that actually broke was renamed instead — `read` became
 * `readTargets`, because a variable named after an English word the page prints
 * six times is indistinguishable from that prose to any tool, and it was exactly
 * the name CodeQL could not see. Task #200 carries the general problem.
 */
