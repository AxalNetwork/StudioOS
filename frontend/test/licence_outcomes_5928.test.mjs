/**
 * D4819 part 21 (#5928) — Licences v2 board L18: five outcome states, drawn
 * differently; partial never looks like success; unknown says not to repeat
 * and offers a re-read; a refusal shows the Worker's words; and the nine
 * actions the canvas names go through the one consequence sheet.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_outcomes_5928.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LicenceOutcomeCard from '../src/pages/admin/LicenceOutcomeCard.jsx';
import { OUTCOME_STATES, licenceWriteOutcome, refusalWords } from '../src/pages/admin/licenceOutcomeModel.js';
import { SHEET_ACTIONS, licenceConsequence } from '../src/pages/admin/licenceConsequenceModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const LICENCE = { uid: 'lic_fr', licence_ref: 'AXL-FR-001', brand_name: 'Axal VC France', status: 'active', territories: ['FR'], deployment: { hostname: 'fr.axal.vc' } };
const err = (status, data) => Object.assign(new Error('x'), { status, data });
const card = (outcome, props = {}) => renderToStaticMarkup(h(LicenceOutcomeCard, { outcome, onRetrySync: () => {}, onReread: () => {}, ...props }));

test('five states, each with its own word, shape and look', () => {
  const outcomes = {
    pending: licenceWriteOutcome({ action: 'suspend', phase: 'pending' }),
    completed: licenceWriteOutcome({ action: 'suspend', phase: 'done', result: { ok: true, pushed: { ok: true, code: 'fr', revision: 144 } } }),
    partial: licenceWriteOutcome({ action: 'suspend', phase: 'done', result: { ok: true, pushed: { ok: false, code: 'fr', revision: 144 } } }),
    refused: licenceWriteOutcome({ action: 'suspend', phase: 'failed', error: err(409, { error: 'bad_transition', message: 'A terminated licence can’t be suspended.' }) }),
    unknown: licenceWriteOutcome({ action: 'suspend', phase: 'failed', error: Object.assign(new Error('timeout'), { code: 'timeout' }) }),
  };
  const looks = new Set();
  for (const [state, o] of Object.entries(outcomes)) {
    assert.equal(o.state, state, state);
    const html = card(o);
    assert.match(html, new RegExp(`data-outcome="${state}"`));
    assert.ok(html.includes(OUTCOME_STATES[state].label), `${state} says its word`);
    assert.ok(html.includes(OUTCOME_STATES[state].shape), `${state} draws its shape`);
    looks.add(html.match(/class="([^"]+)"/)[1]);
  }
  assert.equal(looks.size, 5, 'no two states share a look');
  assert.equal(new Set(Object.values(OUTCOME_STATES).map((s) => s.shape)).size, 5, 'no two states share a shape');
  assert.equal(outcomes.pending.title, 'Suspending…');
  assert.equal(outcomes.pending.detail, 'Waiting for HQ to confirm.');
  assert.equal(outcomes.completed.detail, 'HQ and FR confirmed revision 144.');
});

test('partial never looks like success: HQ holds it, the branch has not taken it, Retry branch sync — not the write', () => {
  const o = licenceWriteOutcome({
    action: 'suspend', phase: 'done',
    result: { ok: true, pushed: { ok: false, code: 'fr', revision: 144, reason: 'The branch did not answer.' } },
    sync: { pending: { attempts: 2 }, branch_report: { state: 'reported', revision: 143 } },
  });
  assert.deepEqual([o.state, o.title, o.next], ['partial', 'Licence suspended at HQ', 'retrySync']);
  assert.equal(o.detail, 'FR has not yet acknowledged revision 144. Retrying the suspension itself is not necessary.');
  assert.deepEqual(o.lines, ['The branch did not answer.', 'The branch reports it holds revision 143.', 'HQ retries on its own as well (attempt 2 so far).']);
  const html = card(o);
  assert.match(html, /data-testid="licence-outcome-retry-sync"[^>]*>Retry branch sync</);
  assert.doesNotMatch(html, /green|Completed/, 'a partial is never drawn as done');
  assert.match(html, /border-dashed/);
  // A copy the branch took only in part is partial too, and names what it left.
  const sections = licenceWriteOutcome({ action: 'renew', phase: 'done', result: { ok: true, pushed: { ok: true, partial: true, failed_sections: ['seats'], revision: 9 } } });
  assert.equal(sections.state, 'partial');
  assert.match(sections.lines[0], /not: seats/);
  // An unreadable branch read is said, not hidden.
  assert.ok(licenceWriteOutcome({ action: 'suspend', phase: 'done', result: { pushed: { ok: false } }, sync: { branch_report: { state: 'unreadable' } } }).lines.includes('What the branch holds could not be read just now.'));
});

test('unknown: no answer means do not repeat; the only button re-reads', () => {
  for (const error of [Object.assign(new Error('t'), { code: 'timeout' }), err(504, {}), err(503, {}), err(502, null)]) {
    const o = licenceWriteOutcome({ action: 'terminate', phase: 'failed', error });
    assert.equal(o.state, 'unknown', String(error.status));
    assert.equal(o.title, 'No response from HQ');
    assert.match(o.detail, /^Re-read the licence before trying again\. The termination may or may not have been made/);
    assert.equal(o.next, 'reread');
    const html = card(o);
    assert.match(html, /Re-read licence/);
    assert.doesNotMatch(html, /Retry branch sync/);
    assert.match(html, /role="alert"/);
  }
});

test('a refusal shows the Worker\'s words, never a code or a database string', () => {
  const o = licenceWriteOutcome({ action: 'suspend', phase: 'failed', error: err(409, { error: 'bad_transition', message: 'A terminated licence can’t be suspended.' }) });
  assert.deepEqual([o.state, o.title, o.detail, o.next], ['refused', 'Not suspended', 'A terminated licence can’t be suspended.', null]);
  assert.equal(refusalWords(err(400, { error: 'a suspension must record why' })), 'a suspension must record why', 'a sentence in `error` is the Worker\'s words');
  assert.equal(refusalWords(err(404, { error: 'not_found' })), null, 'a bare code is not shown as words');
  assert.equal(licenceWriteOutcome({ action: 'voidInvoice', phase: 'failed', error: err(404, { error: 'not_found' }) }).detail, 'HQ refused it and changed nothing.');
  assert.match(card(o), /role="alert"/);
});

test('a write with no branch, or none to push, is completed and says so', () => {
  assert.equal(licenceWriteOutcome({ action: 'activate', phase: 'done', result: { pushed: { ok: false, no_deployment: true } } }).state, 'completed');
  assert.match(licenceWriteOutcome({ action: 'activate', phase: 'done', result: { pushed: { no_deployment: true } } }).detail, /no branch deployment yet/);
  const inv = licenceWriteOutcome({ action: 'issueInvoice', phase: 'done', result: { invoice: {} } });
  assert.deepEqual([inv.state, inv.title, inv.detail], ['completed', 'Invoice issued', null]);
});

test('the nine actions L18 names, and the lifecycle five, each open the one four-question sheet', () => {
  const nine = ['addAdmin', 'removeAdmin', 'issueInvoice', 'voidInvoice', 'sendAgreement', 'deploy', 'retryDeploy', 'reconcileDeploy', 'syncRetry'];
  assert.deepEqual(SHEET_ACTIONS.slice(0, 9), nine);
  for (const a of SHEET_ACTIONS) {
    const s = licenceConsequence(a, LICENCE, { target: { email: 'x@example.test', adminRole: 'principal', reference: 'AXL-1' } });
    assert.ok(s, a);
    assert.ok(s.title && s.confirm && s.happens.length && s.affects.length, `${a} answers what happens and what it affects`);
    assert.ok(s.reason.min === null ? s.reason.statement : s.reason.question, `${a} says what reason is recorded`);
    assert.equal(typeof s.undo.reversible, 'boolean', `${a} says whether it can be undone`);
  }
  // The reasons the Worker requires, and only those.
  const min = (a) => licenceConsequence(a, LICENCE, { target: {} }).reason.min;
  assert.deepEqual(nine.map(min), [10, 10, null, 10, null, null, null, null, null]);
  assert.equal(licenceConsequence('voidInvoice', LICENCE, { target: {} }).undo.reversible, false);
  assert.equal(licenceConsequence('removeAdmin', LICENCE, { target: {} }).tone, 'danger');
});

test('each control asks in the sheet before it writes, and the lifecycle actions report in the L18 card', () => {
  const src = (p) => read(`frontend/src/pages/admin/${p}`);
  const asks = {
    'licences/AdminsEditor.jsx': ["ask('addAdmin'", "ask('removeAdmin'"],
    'LicenceFeeInvoices.jsx': ["ask('issueInvoice'", "ask('voidInvoice'"],
    'licences/ContractStep.jsx': ["ask('sendAgreement'"],
    'licences/DeployStep.jsx': ["ask('deploy'"],
    'LicenceDeploymentAttempts.jsx': ["ask('retryDeploy'", "ask('reconcileDeploy'"],
  };
  for (const [file, needles] of Object.entries(asks)) for (const n of needles) assert.ok(src(file).includes(n), `${file}: ${n}`);
  const detail = src('licences/LicenceDetail.jsx');
  assert.match(detail, /const retrySync = \(\) => act\('syncRetry', adminLicenceSyncApi\.retry, d\.uid\);/);
  assert.match(detail, /<LicenceOutcomeCard[\s\S]*onRetrySync=\{retrySync\}/);
  assert.match(detail, /licenceWriteOutcome\(\{ \.\.\.actOutcome, sync: d\.sync \}\)/, 'the card reads the licence\'s sync as last read');
  for (const a of ['activate', 'reinstate', 'renew', 'suspend', 'terminate']) assert.ok(detail.includes(`act('${a}', `), a);
  assert.doesNotMatch(src('LicenceFeeInvoices.jsx'), /fee-invoice-void-form/, 'Void no longer writes from an inline form');
});
