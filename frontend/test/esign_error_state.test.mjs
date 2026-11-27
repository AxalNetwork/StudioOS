/**
 * Regression test for a CodeQL "useless conditional" finding on
 * ESignPage.jsx that turned out to be a real bug, not a false positive.
 *
 * Before the fix, `error`/`setError` was a single state shared by two very
 * different jobs:
 *   1. A full-page gate (`if (error) return <ErrorCard .../>`) for the
 *      initial envelope fetch failing — nothing to sign, show a dead end.
 *   2. An inline, in-flow alert rendered below the signature pad for a
 *      failed submit/reject *after* the signing UI is already up.
 *
 * `submit()` and `reject()` both call `setError(...)` from deep inside a
 * click handler, long after the initial load succeeded. Because that same
 * state also drove the early-return gate, a failed signature submission or
 * decline re-rendered the page, hit the gate first, and replaced the whole
 * interactive signing UI (typed name, drawn signature, acceptance checkbox)
 * with the generic "Unable to load signing envelope" full-page card — the
 * same one shown for an expired/missing link — discarding everything the
 * founder had just done instead of showing the inline retry alert that was
 * clearly built for exactly this case.
 *
 * The fix splits the state: `loadError` gates the page (initial fetch
 * only); `error` stays inline-only (submit/reject failures + client-side
 * validation), rendered next to the signature pad without ever triggering
 * the full-page early return.
 *
 * Run with:  node --test frontend/test/esign_error_state.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SRC = read('../src/pages/ESignPage.jsx');

test('loadError and error are two distinct state hooks', () => {
  assert.match(SRC, /const \[loadError, setLoadError\] = useState\(/);
  assert.match(SRC, /const \[error, setError\] = useState\(/);
});

test('the initial envelope-fetch failure sets loadError, not error', () => {
  const fetchBlock = SRC.slice(SRC.indexOf('api.esignFetchByToken'), SRC.indexOf('}, [token]);'));
  assert.match(
    fetchBlock,
    /\.catch\(\(e\) => \{ if \(alive\) setLoadError\(/,
    'the initial-load .catch must call setLoadError so it cannot trip the inline-only error state',
  );
  assert.doesNotMatch(
    fetchBlock,
    /setError\(/,
    'the initial-load effect must never call setError — that would re-couple it to the inline alert',
  );
});

test('the full-page early-return gate checks loadError, not error', () => {
  assert.match(SRC, /if \(loadError\) return <PageShell><ErrorCard message=\{loadError\} \/><\/PageShell>;/);
  // The old gate must be gone, not just shadowed — a stray `if (error) return`
  // before the interactive UI would reintroduce the exact bug this guards.
  assert.doesNotMatch(SRC, /if \(error\) return/);
});

test('submit() and reject() failures still set the inline error, not loadError', () => {
  const submitStart = SRC.indexOf('const submit = async');
  const rejectEnd = SRC.indexOf('return (', SRC.indexOf('const reject = async'));
  const handlers = SRC.slice(submitStart, rejectEnd);
  assert.match(handlers, /setError\('Please accept the terms before signing\.'\)/);
  assert.match(handlers, /setError\('Please draw your signature in the box\.'\)/);
  assert.match(handlers, /setError\(e\.message \|\| 'Signing failed\.'\)/);
  assert.match(handlers, /setError\(e\.message \|\| 'Could not decline\.'\)/);
  assert.doesNotMatch(
    handlers,
    /setLoadError\(/,
    'submit/reject must never set loadError — that would re-trigger the full-page gate on a failed signature',
  );
});

test('the inline alert panel renders error, not loadError, and sits with the signature pad', () => {
  const panelStart = SRC.indexOf('<SignaturePad');
  const panelEnd = SRC.indexOf('Decline to sign');
  const panel = SRC.slice(panelStart, panelEnd);
  assert.match(panel, /\{error && \(/, 'the inline alert must render from the inline-only error state');
  assert.doesNotMatch(panel, /\{loadError && \(/, 'loadError must never drive the inline alert');
});
