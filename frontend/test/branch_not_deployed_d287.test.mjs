/**
 * D287 — S21's strip for a licence administrator whose branch is not deployed
 * yet: shows without a live deployment, gone once live, "Unreadable" on a
 * failed read, no invented time, no storage write, no way to dismiss it.
 *
 * THE MODEL IS PURE (`lib/branchNotDeployed.js`), so the read states are put
 * through it directly; the component, the hook and the shell are pinned by
 * source, because what they must NOT do — persist, dismiss, label a time —
 * is a property of their text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  notDeployedStrip, brandOf, NOT_DEPLOYED_STEPS, NOT_DEPLOYED_RULES, NOT_DEPLOYED_SUBLINE, NO_STEP_TIME_REASON, UNREADABLE,
} from '../src/lib/branchNotDeployed.js';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const BAR = read('frontend/src/components/BranchNotDeployedBar.jsx');
const BAR_CODE = codeOnly(BAR);
const HOOK = read('frontend/src/hooks/useBranchDeployment.js');
const HOOK_CODE = codeOnly(HOOK);
const LIB_CODE = codeOnly(read('frontend/src/lib/branchNotDeployed.js'));
const APP = read('frontend/src/App.jsx');
const LICENCE_TS = read('cloudflare-worker/src/routes/licence.ts');
const API = read('frontend/src/lib/api.js');

const licence = { brand_name: 'Axal VC France', legal_entity_name: 'Axal VC France SAS', licence_ref: 'AXL-001' };
const at = (status, extra = {}) => ({ licence, deployment: { readable: true, requested: true, live: false, code: 'fr', hostname: 'fr.axal.vc', status, status_note: null, ...extra } });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the strip shows for a licence admin without a live deployment, lit to the step the record reached', () => {
  const s = notDeployedStrip(at('requested'));
  assert.ok(s, 'no strip for a requested deployment');
  assert.equal(s.brand, 'Axal VC France');
  assert.equal(s.unreadable, false);
  assert.equal(s.failed, false);
  assert.deepEqual(s.chips.map((c) => c.state), ['wait', 'ok', 'wait', 'wait', 'wait', 'wait', 'wait', 'wait', 'wait']);
  const later = notDeployedStrip(at('hostname_active'));
  assert.deepEqual(later.chips.map((c) => c.state), ['wait', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'wait']);
  assert.equal(later.status, 'hostname_active');
});

test('the nine chips are S21\'s, in its order and its words, and the three rules are verbatim', () => {
  assert.deepEqual(NOT_DEPLOYED_STEPS.map(([, l]) => l), [
    'not requested', 'requested', 'database created', 'schema applied', 'secrets present',
    'principal seeded', 'worker live', 'hostname active', 'linked to HQ',
  ]);
  assert.deepEqual(NOT_DEPLOYED_RULES, [
    'Cannot be dismissed. It is the fact of the account, not a notice.',
    'Stores nothing. It reads the deployment record on the licence.',
    'Disappears the moment the branch is live; the shell then reads the branch database.',
  ]);
  assert.equal(NOT_DEPLOYED_SUBLINE, 'The eight rows below the strip are the S20 shell. Nothing on this page reads the branch database, because it does not exist yet.');
  assert.deepEqual(notDeployedStrip(at('requested')).chips.map((c) => c.key), NOT_DEPLOYED_STEPS.map(([k]) => k));
});

test('the strip is gone once the branch is live — the worker\'s word, not a status read here', () => {
  assert.equal(notDeployedStrip(at('linked', { live: true })), null);
  // The word is the worker's: a status this file would call the last step,
  // answered not live, still draws the strip; a status it would not, answered
  // live, does not.
  assert.ok(notDeployedStrip(at('linked', { live: false })), 'live is re-derived from the status');
  assert.equal(notDeployedStrip(at('worker_live', { live: true })), null);
});

test('no strip for someone who administers no licence, or when the worker answered no deployment field', () => {
  assert.equal(notDeployedStrip({ none: true }), null);
  assert.equal(notDeployedStrip(null), null);
  assert.equal(notDeployedStrip(undefined), null);
  assert.equal(notDeployedStrip({ licence }), null, 'an older worker without the field drew a strip');
  assert.equal(notDeployedStrip({ licence, deployment: 'requested' }), null);
});

test('"not requested" is requested === false and never a stored value', () => {
  const s = notDeployedStrip({ licence, deployment: { readable: true, requested: false, live: false } });
  assert.ok(s);
  assert.deepEqual(s.chips.map((c) => c.state), ['ok', 'wait', 'wait', 'wait', 'wait', 'wait', 'wait', 'wait', 'wait']);
  assert.equal(s.chips[0].key, 'not_requested');
  // A row whose status reads 'not_requested' is a request that exists; which
  // step it reached is unknown, and the first chip is NOT lit.
  const odd = notDeployedStrip(at('not_requested'));
  assert.equal(odd.chips[0].state, 'unknown', 'a stored value lit "not requested"');
  assert.equal(odd.failed, true);
});

test('an unreadable read renders Unreadable, with every chip unknown, never "not requested"', () => {
  const s = notDeployedStrip({ licence, deployment: { readable: false, reason: 'The deployment record on this licence could not be read.' } });
  assert.ok(s, 'an unreadable read drew no strip — the account is still not on a branch');
  assert.equal(s.unreadable, true);
  assert.equal(s.note, 'The deployment record on this licence could not be read.');
  assert.deepEqual(new Set(s.chips.map((c) => c.state)), new Set(['unknown']));
  assert.notEqual(s.chips[0].state, 'ok', 'an unreadable read rendered as "not requested"');
  assert.equal(UNREADABLE, 'Unreadable');
  assert.match(BAR_CODE, /strip\.unreadable\s*\?\s*`\$\{UNREADABLE\} — /, 'the bar does not render Unreadable for a failed read');
});

test('a failed deployment says so and marks every step unknown, with the record\'s note', () => {
  const s = notDeployedStrip(at('failed', { status_note: 'GitHub refused the dispatch (403).' }));
  assert.equal(s.failed, true);
  assert.equal(s.note, 'GitHub refused the dispatch (403).');
  assert.deepEqual(new Set(s.chips.map((c) => c.state)), new Set(['unknown']));
});

test('the brand is the licence\'s, or its entity, or its reference — never invented', () => {
  assert.equal(brandOf(licence), 'Axal VC France');
  assert.equal(brandOf({ legal_entity_name: 'Nordics Holdings AB', licence_ref: 'AXL-002' }), 'Nordics Holdings AB');
  assert.equal(brandOf({ licence_ref: 'AXL-002' }), 'AXL-002');
  assert.equal(brandOf({}), null);
  assert.equal(notDeployedStrip({ licence: {}, deployment: { readable: true, requested: false, live: false } }).brand, null);
});

/* ------------------------------------------------------------------ *
 * No invented time
 * ------------------------------------------------------------------ */

test('no time is drawn or labelled: not requested_at, not updated_at, not a last_step_at that does not exist', () => {
  for (const [name, code] of [['the bar', BAR_CODE], ['the lib', LIB_CODE], ['the hook', HOOK_CODE]]) {
    assert.doesNotMatch(code, /requested_at|updated_at|last_step_at|live_at/, `${name} reads a time off the record`);
    assert.doesNotMatch(code, /toLocale(?:Date|Time)?String|Intl\.DateTimeFormat|new Date\(/, `${name} formats a time`);
  }
  assert.match(BAR_CODE, /NO_STEP_TIME_REASON/, 'the caption does not say why there is no time');
  assert.match(NO_STEP_TIME_REASON, /no step time is recorded/);
  assert.doesNotMatch(NO_STEP_TIME_REASON, /last step .* at/, 'the caption claims a last-step time');
  // The worker's field carries no time either: the SELECT names its columns.
  const sel = /SELECT ([^']+) FROM licence_deployments WHERE licence_uid = \?/.exec(LICENCE_TS);
  assert.ok(sel, 'the deployment read is no longer a named-column SELECT by licence_uid');
  assert.deepEqual(sel[1].split(',').map((s) => s.trim()).sort(), ['code', 'hostname', 'status', 'status_note']);
});

/* ------------------------------------------------------------------ *
 * No storage, no dismissal
 * ------------------------------------------------------------------ */

test('the strip stores nothing and cannot be dismissed', () => {
  for (const [name, code] of [['the bar', BAR_CODE], ['the hook', HOOK_CODE], ['the lib', LIB_CODE]]) {
    assert.doesNotMatch(code, /localStorage|sessionStorage|document\.cookie|indexedDB/, `${name} writes storage`);
  }
  assert.doesNotMatch(BAR_CODE, /aria-label="Close"|<X\b|setState\(null\)|onClick|dismiss/i, 'the strip has a way to dismiss it');
  assert.doesNotMatch(BAR_CODE, /useState|useEffect/, 'the bar holds state of its own — it draws the model it is given');
  assert.match(BAR_CODE, /if \(!strip\) return null;/, 'the bar draws without a model');
  assert.match(BAR_CODE, /data-testid="branch-not-deployed-bar"/);
  assert.match(BAR_CODE, /role="status"/, 'S21 is the fact of the account, not an alert that interrupts');
});

test('the strip carries S21\'s copy: the sentence, the link, the steps, the sub-line and the rules', () => {
  assert.match(BAR, /· its branch has not been deployed\. You are working on axal\.vc until it is\./);
  assert.match(BAR_CODE, /<Link\s+to="\/admin\/my-licence"[^>]*>\s*Licence summary in Settings →\s*<\/Link>/);
  assert.match(BAR_CODE, /data-testid="branch-not-deployed-steps"/);
  assert.match(BAR_CODE, /NOT_DEPLOYED_SUBLINE/);
  assert.match(BAR_CODE, /NOT_DEPLOYED_RULES\.map/);
});

/* ------------------------------------------------------------------ *
 * The read, and the shell
 * ------------------------------------------------------------------ */

test('one memoised read of /api/licence/mine per user; a 404 is no strip and no error', () => {
  assert.match(HOOK_CODE, /api\.myLicence\(\)/, 'the hook reads something other than /api/licence/mine');
  assert.match(API, /myLicence: \(\) => request\('\/licence\/mine'\)/, 'api.myLicence moved');
  assert.match(HOOK_CODE, /const pending = new Map\(\)/, 'the read is not memoised per user');
  assert.match(HOOK_CODE, /if \(e\?\.status === 404\) return null;/, 'a 404 is treated as a failure');
  assert.match(HOOK_CODE, /reportError\('branch-not-deployed:licence', e\)/, 'a real failure is not reported');
  assert.match(HOOK_CODE, /notDeployedStrip\(data\)/, 'the hook re-derives the model instead of reading the lib');
});

test('the shell mounts the strip above the top bar for the plain Admin shell off a branch, and the badge says BRANCH · NOT DEPLOYED', () => {
  const open = APP.indexOf('<Routes>');
  const chrome = codeOnly(APP.slice(0, open));
  const mount = chrome.indexOf('<BranchNotDeployedBar strip={notDeployed} />');
  const header = chrome.indexOf('<header ');
  assert.ok(mount > 0, 'the strip is not mounted');
  assert.ok(header > mount, 'the strip is not above the top bar');
  assert.match(chrome, /useBranchDeployment\(\s*!branchFact && shellRole === 'admin' && activeRole === 'admin' && !isImpersonating,\s*user\?\.id,?\s*\)/,
    'the read is not confined to the plain Admin shell off a branch');
  assert.match(chrome, /data-testid="branch-not-deployed-badge"/);
  assert.match(chrome, /\{notDeployed\.brand \|\| 'This licence'\} · on axal\.vc/, 'the chip does not read "{brand} · on axal.vc"');
  assert.match(chrome, />BRANCH · NOT DEPLOYED</, 'the badge does not read "BRANCH · NOT DEPLOYED"');
  // …and the HQ-held pair (D286) still draws when there is no strip.
  assert.match(chrome, /data-testid="hq-held-badge"/);
  assert.ok(chrome.indexOf('data-testid="branch-not-deployed-badge"') < chrome.indexOf('data-testid="hq-held-badge"'));
});

test('the worker decides live — linked and nothing else — and reads the deployment in its own try', () => {
  assert.match(LICENCE_TS, /export const DEPLOYMENT_LIVE_STATUS = 'linked';/);
  assert.match(LICENCE_TS, /String\(status \?\? ''\) === DEPLOYMENT_LIVE_STATUS/);
  assert.match(LICENCE_TS, /export async function deploymentField\([\s\S]*?try \{[\s\S]*?FROM licence_deployments WHERE licence_uid = \?/, 'the read is not in its own try');
  assert.match(LICENCE_TS, /if \(!d\) return \{ readable: true, requested: false, live: false \};/, '"not requested" is not the absence of a row');
  assert.match(LICENCE_TS, /return \{ readable: false, reason: /, 'a failed read is not answered as unreadable');
  assert.match(LICENCE_TS, /deployment,\n\s+\.\.\.DERIVED_UNAVAILABLE,/, 'the HQ arm of /mine does not carry the field');
});
