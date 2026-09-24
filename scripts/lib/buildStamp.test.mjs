/**
 * `docs/.build-source` classification — the difference between a stamp that is
 * absent and one that is unreadable.
 *
 * WHY THIS FILE EXISTS. `check-docs-fresh.mjs` read the stamp as
 * `/^[0-9a-f]{64}$/.test(v) ? v : null` and treated the `null` from a corrupt
 * file exactly like the `null` from a missing one. Missing falls through to the
 * commit-timestamp proxy — the proxy D103 was written to replace, which passes
 * whenever `docs/` was committed after `frontend/src`. A merge commit always
 * satisfies that. So a stamp nobody could parse silently downgraded the gate to
 * the thing it exists instead of, and printed a tick.
 *
 * The case that makes it reachable is D113: `.gitattributes` marks the path
 * `merge=union`, so two branches that both rebuilt produce a TWO-LINE file
 * instead of a conflict. These assertions are what stop that file passing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { classifyStamp, STAMP_RE } from './buildStamp.mjs';

const CHECKER = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'check-docs-fresh.mjs'),
  'utf8',
);

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

test('a real stamp is valid, with and without its trailing newline', () => {
  // The build writes `${hash}\n`, so the newline is the normal case, not an
  // edge one.
  for (const raw of [HASH, `${HASH}\n`, `  ${HASH}  \n`]) {
    const s = classifyStamp(raw);
    assert.equal(s.valid, true, `a real stamp was rejected: ${JSON.stringify(raw)}`);
    assert.equal(s.present, true);
    assert.equal(s.value, HASH, 'the hash did not survive trimming');
    assert.equal(s.why, null);
  }
});

test('an ABSENT stamp classifies as not present (but the checker treats it as strict failure)', () => {
  // The classifier still reports absent as present:false — only the checker's
  // --strict behavior changes. A `docs/` built before D103 genuinely has no
  // stamp, but D103 has been in every build since it was written, so absent
  // now means someone deleted it or ran a bare `vite build` (D218).
  for (const raw of [null, undefined]) {
    const s = classifyStamp(raw);
    assert.equal(s.present, false, 'an unreadable file was reported as present');
    assert.equal(s.valid, false);
    assert.equal(s.value, null);
  }
});

test('a UNION-MERGED stamp is present and invalid, and says how many lines', () => {
  // THE CASE THIS WAS BUILT FOR. Two branches rebuilt, `merge=union` kept both
  // lines, and the result is meaningless — but it is emphatically not "no
  // stamp", because falling back would report fresh without checking.
  const s = classifyStamp(`${HASH}\n${OTHER}\n`);
  assert.equal(s.present, true, 'a merged stamp was reported absent, so the gate would fall back');
  assert.equal(s.valid, false);
  assert.equal(s.value, null, 'a merged stamp handed back one of the two hashes as if it were the answer');
  assert.match(s.why, /2 lines/, 'the reason does not say what is wrong, so the fix is a guess');
});

test('every other malformed shape is present and invalid too', () => {
  for (const [raw, label] of [
    ['', 'empty'],
    ['   \n', 'whitespace only'],
    ['not-a-hash', 'not hex'],
    ['a'.repeat(63), 'one char short'],
    ['a'.repeat(65), 'one char long'],
    ['A'.repeat(64), 'uppercase — the build writes lowercase'],
    ['<<<<<<< HEAD', 'a conflict marker, if the attribute is ever removed'],
  ]) {
    const s = classifyStamp(raw);
    assert.equal(s.present, true, `${label}: reported absent`);
    assert.equal(s.valid, false, `${label}: accepted as a stamp`);
    assert.equal(s.value, null, `${label}: handed back a value`);
    assert.ok(s.why && s.why.length > 0, `${label}: gave no reason`);
  }
});

test('the checker actually REFUSES on present-but-unreadable stamps, not merely importing it', () => {
  // THE WIRING, which a unit test on a pure function cannot see. A correct
  // classifier whose verdict is ignored is the same bug with an extra file in
  // it, so the refusal branch is pinned where it lives.
  assert.match(CHECKER, /import \{ classifyStamp \} from '\.\/lib\/buildStamp\.mjs'/,
    'check-docs-fresh no longer uses the classifier');
  const at = CHECKER.indexOf('if (stamp.present && !stamp.valid)');
  assert.ok(at > 0, 'the present-but-unreadable branch is gone');
  const branch = CHECKER.slice(at, CHECKER.indexOf('const stampedSource', at));
  assert.match(branch, /if \(strict\) process\.exit\(1\)/,
    'a present-but-unreadable stamp no longer fails under --strict, so it falls '
    + 'through to the commit-timestamp proxy — which is what D113 closed');
  assert.match(branch, /stamp\.why/, 'the refusal does not say what is wrong with the file');

  // And the attribute that makes the two-line case reachable is declared.
  const attrs = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.gitattributes'),
    'utf8',
  );
  assert.match(attrs, /^docs\/\.build-source merge=union$/m,
    'the build stamp lost its union merge attribute, so it conflicts again');
});

test('the checker actually REFUSES on absent stamps under --strict (D218)', () => {
  // THE WIRING for the new absent-stamp branch. The classifier reports absent
  // as present:false, but the checker must refuse when --strict is set, because
  // every build since D103 writes the stamp, so absent now means someone deleted
  // it or ran a bare `vite build` — both defects this gate is meant to catch.
  const at = CHECKER.indexOf('if (!stamp.present)');
  assert.ok(at > 0, 'the absent-stamp branch is missing');
  const fallback = CHECKER.indexOf('// FALLBACK: the commit-timestamp proxy');
  const branch = CHECKER.slice(at, fallback);
  assert.match(branch, /if \(strict\) process\.exit\(1\)/,
    'absent stamp does not exit under --strict, so it falls through to the proxy');
  assert.match(branch, /npm run build && git add docs && git commit -m "Rebuild docs\/"/,
    'the fix command is not printed or is wrong');
});

test('the shape the build writes is the shape the regex accepts', () => {
  // Pins the contract to the producer rather than to this file's own idea of
  // it: 64 lowercase hex, nothing else.
  assert.ok(STAMP_RE.test(HASH));
  assert.ok(!STAMP_RE.test(HASH.toUpperCase()), 'uppercase hex would pass, and the build never writes it');
  assert.ok(!STAMP_RE.test(`${HASH}\n${OTHER}`), 'the regex is not anchored against a second line');
});
