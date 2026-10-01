/**
 * D255 — the persona re-tag `<select>` in AdminPage.jsx's PersonasPanel asks
 * before it acts, and a cancelled or failed re-tag leaves the select showing
 * nothing was saved.
 *
 * The row fired `retag(r.user_id, e.target.value)` straight from `onChange`,
 * with no confirm — a fat-fingered click on the dropdown silently retagged a
 * user, matching this file's own idiom elsewhere (`if (!confirm(...)) return;`,
 * used a dozen times). The `<select>` is also UNCONTROLLED
 * (`defaultValue=""`, never `value=`), so a cancelled confirm does not on its
 * own un-pick the option the browser already changed to — the fix has to
 * reset the DOM element itself, not just skip the write.
 *
 * NO DOM HERE (frontend/test/README.md) — this reads the function's own
 * source and pins its control-flow shape, the pattern
 * `api_request_timeout.test.mjs` uses for `_analyticsRead`'s retry
 * exclusion.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ADMIN_PAGE = raw('frontend/src/pages/AdminPage.jsx');

function retagBody() {
  const start = ADMIN_PAGE.indexOf('const retag = async (userId, personaId, selectEl)');
  assert.ok(start >= 0, 'PersonasPanel\'s retag function signature changed or moved — '
    + 'update this test\'s anchor to match');
  const end = ADMIN_PAGE.indexOf('\n  };', start);
  assert.ok(end > start, 'could not find the end of retag()');
  return ADMIN_PAGE.slice(start, end);
}

test('retag() asks for confirmation before it writes anything', () => {
  const body = retagBody();
  const confirmAt = body.indexOf('confirm(');
  const writeAt = body.indexOf('api.retagPersonaAdmin(');
  assert.ok(confirmAt >= 0, 'retag() no longer calls confirm() at all');
  assert.ok(writeAt >= 0, 'retag() no longer calls api.retagPersonaAdmin');
  assert.ok(confirmAt < writeAt,
    'confirm() must run BEFORE the write — a re-tag firing before the operator confirms '
    + 'defeats the point of asking');
});

test('retag() defines a restore helper that resets the <select>\'s own DOM value', () => {
  const body = retagBody();
  // The <select> is UNCONTROLLED (defaultValue, not value), so undoing a pick
  // means writing to the DOM node directly — a state update alone would not
  // move it. Assert the helper actually touches `selectEl.value`, not merely
  // that a function named `restore` exists.
  const restoreDefAt = body.indexOf('const restore = ()');
  assert.ok(restoreDefAt >= 0, 'retag() no longer defines a restore() helper');
  const restoreDef = body.slice(restoreDefAt, body.indexOf('\n', restoreDefAt));
  assert.match(restoreDef, /selectEl\.value\s*=/,
    'restore() no longer resets selectEl.value — a cancelled or failed retag would leave '
    + 'the <select> showing the operator\'s unsaved pick');
});

test('a cancelled confirm calls restore() before the write', () => {
  const body = retagBody();
  const confirmBlock = body.slice(body.indexOf('if (!confirm('), body.indexOf('setSavingId(userId)'));
  assert.match(confirmBlock, /restore\(\)/, 'a cancelled confirm must call restore()');
  assert.match(confirmBlock, /return;/, 'a cancelled confirm must stop before the write');
  assert.ok(confirmBlock.indexOf('restore()') < confirmBlock.indexOf('return;'),
    'restore() must run before the early return, or it never executes');
});

test('a failed write also calls restore(), not just a cancelled confirm', () => {
  const body = retagBody();
  const catchBlock = body.slice(body.indexOf('} catch (e) {'), body.indexOf('} finally'));
  assert.match(catchBlock, /restore\(\)/,
    'a failed retagPersonaAdmin call must also call restore() — otherwise a cancel is '
    + 'safe but a server-side refusal still leaves an unsaved pick on screen');
});

test('the <select> passes itself to retag(), so it has something to reset', () => {
  const onChangeAt = ADMIN_PAGE.indexOf("onChange={(e) => retag(r.user_id, e.target.value");
  assert.ok(onChangeAt >= 0, 'the re-tag <select>\'s onChange handler moved or changed shape');
  const line = ADMIN_PAGE.slice(onChangeAt, ADMIN_PAGE.indexOf('\n', onChangeAt));
  assert.match(line, /e\.target\)/,
    'onChange no longer passes the select element itself to retag() — without it, retag() '
    + 'has no DOM node to reset on cancel or failure');
});
