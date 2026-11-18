/**
 * D5924 (#5924) — Licences v2 boards L14 (deployment healthy) and L15
 * (deployment failed): the branch-sync card and its Sources, from `sync` on
 * `GET /api/admin/licences/:uid` (`licence_sync_state`, `licence_push_pending`),
 * and the provisioning line with Reconcile, from
 * `GET /api/admin/licences/:uid/deployment` and `POST /deploy/reconcile`.
 *
 *   - healthy: Synced with HQ, the revision and when;
 *   - problem: HQ revision against branch revision, the failed attempt's time
 *     and code, and Retry sync (drawn, disabled, with the reason);
 *   - a failed provisioning offers Reconcile, never a dead-end record;
 *   - the branch line says "last accepted a copy", never "responded";
 *   - an unreadable sync is never drawn as synced.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_deployment_sync_d5924.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import {
  BRANCH_LINE_NOTE, RETRY_SYNC_REASON, SYNC_RETRY_WINDOW_MINUTES, agoText, canReconcile, noticeForSettled,
  provisioningLine, syncBoard, syncSources,
} from '../src/pages/admin/licenceDeploymentModel.js';
import { LicenceSyncStrip } from '../src/pages/admin/licences/LicenceSyncStrip.jsx';
import LicenceDeploymentAttempts, { ProvisioningLine } from '../src/pages/admin/LicenceDeploymentAttempts.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const h = React.createElement;
const NOW = '2026-11-09T12:00:00Z';
const DEPLOYMENT = { hostname: 'fr.axal.vc', status: 'linked' };

const SYNCED = {
  available: true, hq_revision: 143, branch_revision: 143, last_success_at: '2026-11-09 11:56:00',
  pending: null, pending_available: true, termination: null, termination_available: true,
};
const PENDING = {
  ...SYNCED, branch_revision: 142, last_success_at: '2026-11-08 09:00:00',
  pending: { revision: 143, failure_code: 'unreachable', attempts: 2, last_attempt_at: '2026-11-09 11:54:00' },
};
// D4805: a row queued with the change, dated 1970 so the next retry picks it up, not yet tried.
const QUEUED = { ...PENDING, pending: { revision: null, failure_code: null, attempts: 0, last_attempt_at: '1970-01-01T00:00:00.000Z' } };

const strip = (props) => renderToStaticMarkup(h(LicenceSyncStrip, { part: 'strip', deployment: DEPLOYMENT, deploymentAvailable: true, now: NOW, onReread: () => {}, ...props }));
const stateOf = (html) => /data-testid="licence-sync-card" data-state="([a-z_]+)"/.exec(html)?.[1];

test('L14: synced with HQ, the revision, and when the branch accepted it', () => {
  const b = syncBoard(SYNCED, NOW);
  assert.equal(b.state, 'synced');
  assert.equal(b.word, 'Synced with HQ');
  assert.equal(b.hq, 143);
  assert.equal(b.accepted, '4 min ago · 9 Nov 2026, 11:56 UTC');
  const html = strip({ sync: SYNCED });
  const text = renderedText(html);
  assert.equal(stateOf(html), 'synced');
  assert.match(text, /Synced with HQRevision 143 · 4 min ago · 9 Nov 2026, 11:56 UTC/);
  assert.doesNotMatch(text, /Retry sync|Update pending/, 'a synced branch offers no retry');
});

test('L15: HQ revision against the branch revision, the failed attempt’s time and code, and Retry sync', () => {
  const b = syncBoard(PENDING, NOW);
  assert.equal(b.state, 'pending');
  assert.equal(b.word, 'Update pending');
  assert.deepEqual([b.hq, b.branch, b.target], [143, 142, 143]);
  assert.equal(b.attempt.code, 'unreachable');
  assert.equal(b.attempt.when, '6 min ago · 9 Nov 2026, 11:54 UTC');
  assert.equal(b.attempt.attempts, 2);
  assert.equal(b.effect, 'The branch keeps the copy it last accepted (revision 142) until it accepts revision 143.');
  assert.equal(b.nextTry, `The next try is not before 9 Nov 2026, 12:54 UTC.`);
  const html = strip({ sync: PENDING });
  const text = renderedText(html);
  assert.equal(stateOf(html), 'pending');
  assert.match(text, /HQ revision 143 · branch revision 142 · last attempt failed 6 min ago/);
  assert.match(text, /The branch did not answer\. \(attempt 2\)/);
  assert.match(text, /6 min ago · 9 Nov 2026, 11:54 UTC · code unreachable/);
  assert.match(text, /Retry sync/);
  assert.match(html, /<button type="button" disabled="" data-testid="licence-sync-retry" aria-describedby="licence-sync-retry-reason"/,
    'without a handler Retry sync is drawn, and disabled');
  // D4819 part 21 (#5928): the page passes the route's handler, and the button sends.
  const live = strip({ sync: PENDING, onRetry: () => {} });
  assert.match(live, /<button type="button" data-testid="licence-sync-retry" aria-describedby="licence-sync-retry-reason"/, 'with a handler it is live');
  assert.match(text, new RegExp(`${RETRY_SYNC_REASON.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} The next try is not before 9 Nov 2026, 12:54 UTC\\.`));
  assert.match(html, /data-testid="licence-sync-reread"/, 'Read again re-reads the licence');
});

test('a copy queued with the change is pending, never a failure dated 1970', () => {
  const b = syncBoard(QUEUED, NOW);
  assert.equal(b.state, 'pending');
  assert.equal(b.attempt, null);
  assert.equal(b.target, 143, 'a row with no revision waits for the one HQ numbered');
  const text = renderedText(strip({ sync: QUEUED }));
  assert.match(text, /not attempted yet/);
  assert.match(text, /queued with the change and goes out on the next retry run/);
  assert.doesNotMatch(text, /failed|1970/);
});

test('an unreadable sync is never drawn as synced', () => {
  const cases = [
    ['record unreadable', { ...SYNCED, available: false }, 'unreadable'],
    ['no record at all', null, 'unreadable'],
    ['queue unreadable, revisions equal', { ...SYNCED, pending_available: false }, 'unconfirmed'],
    ['queue unreadable, branch behind', { ...SYNCED, branch_revision: 141, pending_available: false }, 'out_of_sync'],
  ];
  for (const [name, sync, state] of cases) {
    assert.equal(syncBoard(sync, NOW).state, state, name);
    const html = strip({ sync });
    assert.equal(stateOf(html), state, name);
    assert.doesNotMatch(renderedText(html), /Synced with HQ/, name);
    assert.match(renderedText(html), /could not be read/, `${name}: says what could not be read`);
  }
  // The registry unreadable is as unknown as the sync record.
  const reg = strip({ sync: SYNCED, deployment: undefined, deploymentAvailable: false });
  assert.equal(stateOf(reg), 'unreadable');
  assert.doesNotMatch(renderedText(reg), /Synced with HQ/);
  // The Retry on an unreadable record is there.
  assert.match(strip({ sync: { ...SYNCED, available: false } }), /<button type="button" class="[^"]*"[^>]*><svg[^>]*>.*?<\/svg> Retry<\/button>/);
  assert.equal(syncBoard({ ...SYNCED, branch_revision: 141 }, NOW).queueUnread, false);
  assert.equal(syncBoard({ ...SYNCED, branch_revision: 141, pending_available: false }, NOW).queueUnread, true);
});

test('the other states: out of sync, not recorded, no branch deployed', () => {
  const behind = syncBoard({ ...SYNCED, branch_revision: 141 }, NOW);
  assert.deepEqual([behind.state, behind.effect], ['out_of_sync', 'The branch keeps revision 141 until HQ’s next push lands.']);
  assert.equal(syncBoard({ ...SYNCED, branch_revision: null }, NOW).state, 'out_of_sync', 'a branch that never accepted a copy is not synced');
  assert.equal(syncBoard({ ...SYNCED, hq_revision: null, branch_revision: null }, NOW).state, 'not_recorded');
  assert.match(renderedText(strip({ sync: { ...SYNCED, branch_revision: 141 } })), /HQ revision 143 · branch revision 141 · no copy is queued/);
  const none = strip({ sync: SYNCED, deployment: null });
  assert.equal(stateOf(none), 'none');
  assert.match(renderedText(none), /No branch deployed/);
  assert.doesNotMatch(renderedText(none), /Synced with HQ|Last accepted/);
  // An age is never invented for a time that is not one, or in the future.
  assert.equal(agoText('not a time', NOW), null);
  assert.equal(agoText('2026-11-09T12:30:00Z', NOW), null);
  assert.equal(agoText('2026-11-07T11:00:00Z', NOW), '2 days ago');
});

test('the branch line keeps “last accepted a copy” and never says “responded”', () => {
  const [hq, branch] = syncSources(PENDING, 'fr.axal.vc');
  assert.equal(hq.text, 'Current · revision 143');
  assert.equal(branch.label, 'Branch at fr.axal.vc');
  assert.equal(branch.text, 'Last accepted a copy 8 Nov 2026, 09:00 UTC · revision 142');
  assert.equal(syncSources({ ...SYNCED, last_success_at: null }, null)[1].text, 'Last accepted copy not recorded');
  assert.equal(syncSources({ ...SYNCED, hq_revision: null }, null)[0].state, 'not_recorded');
  for (const sync of [SYNCED, PENDING, QUEUED, { ...SYNCED, available: false }, { ...SYNCED, pending_available: false }]) {
    const text = renderedText(strip({ sync }));
    assert.doesNotMatch(text, /respond/i);
  }
  assert.match(renderedText(strip({ sync: SYNCED })), /Branch at fr\.axal\.vcLast accepted a copy 9 Nov 2026, 11:56 UTC · revision 143/);
  assert.ok(renderedText(strip({ sync: SYNCED })).includes(BRANCH_LINE_NOTE));
});

test('the retry window is the Worker’s own, and the on-demand retry route exists (D4819 part 21)', () => {
  const push = read('cloudflare-worker/src/services/licencePush.ts');
  assert.equal(Number(/LICENCE_PUSH_RETRY_WINDOW_MINUTES = (\d+);/.exec(push)?.[1]), SYNC_RETRY_WINDOW_MINUTES);
  // D5924 drew Retry sync disabled until a route served it; #5928 added `POST /:uid/sync/retry`, and the page wires it.
  const routes = ['admin_deployments.ts', 'admin_licences.ts', 'admin_licences_lifecycle.ts'].map((f) => read(`cloudflare-worker/src/routes/${f}`)).join('\n');
  assert.match(routes, /r\.post\('\/:uid\/sync\/retry'/);
  const detailSrc = read('frontend/src/pages/admin/licences/LicenceDetail.jsx');
  assert.match(detailSrc, /const retrySync = \(\) => act\('syncRetry', adminLicenceSyncApi\.retry, d\.uid\);/);
  assert.match(detailSrc, /<LicenceSyncStrip [\s\S]*?onRetry=\{retrySync\}/);
});

const FAILED = {
  licence_uid: 'lic_fr', code: 'fr', hostname: 'fr.axal.vc', status: 'failed', status_note: 'The provisioning run ended failure.',
  phase: 'refused', current_attempt: 1, do_jurisdiction: 'eu', retryable: true, reconcilable: false,
  current_attempt_row: { attempt_no: 1, status: 'failed' },
  last_failure: { attempt_no: 1, status: 'failed', failure_code: 'run_failed', failure_note: 'The provisioning run ended failure.', settled_at: '2026-11-03 14:38:00' },
  last_success: null, attempts: [],
};

test('a failed provisioning shows its time and code, and offers Reconcile', () => {
  const line = provisioningLine(FAILED);
  assert.deepEqual([line.state, line.word, line.at, line.code], ['failed', 'Failed', '2026-11-03 14:38:00', 'run_failed']);
  assert.equal(canReconcile(FAILED), true);
  assert.equal(canReconcile({ ...FAILED, status: 'linked', phase: 'committed', reconcilable: false }), false);
  assert.equal(canReconcile({ status: 'requested', phase: 'pending', reconcilable: true }), true);
  assert.equal(canReconcile(null), false);
  assert.equal(provisioningLine({ status: 'linked', phase: 'committed' }).word, 'Linked');
  const html = renderToStaticMarkup(h(ProvisioningLine, { view: FAILED, onReconcile: () => {} }));
  assert.match(renderedText(html), /ProvisioningFailed3 Nov 2026, 14:38 UTC · code run_failed/);
  assert.match(html, /data-testid="deploy-reconcile"/);
  assert.match(renderedText(html), /Reconcile deployment/);
  // While an attempt is open, Check status is the reconcile; it is not drawn twice.
  assert.doesNotMatch(renderToStaticMarkup(h(ProvisioningLine, { view: { ...FAILED, status: 'requested', phase: 'pending', reconcilable: true } })), /deploy-reconcile/);
  const n = noticeForSettled(FAILED);
  assert.equal(n.outcome, 'committed');
  assert.equal(n.message, 'Reconciled. Attempt 1 is recorded as failed (run_failed), and nothing was sent. Retry starts attempt 2.');
});

// ── mounted on fake Worker reads ────────────────────────────────────────────

const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

async function mount(handle) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, options = {}) => {
    const p = new URL(String(u), 'http://x').pathname.replace(/^\/api/, '');
    calls.push([options.method || 'GET', p]);
    return handle(p, options, calls);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(h(LicenceDeploymentAttempts, { licence: { uid: 'lic_fr' } })));
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    calls, has: (id) => Boolean(byId(id)), text: () => text(container),
    async click(id) { await act(async () => { await props(byId(id)).onClick({ preventDefault() {} }); }); await flush(); },
    // D4819 part 21: a press that opens the consequence sheet resolves only when the sheet is answered.
    async press(id) { await act(async () => { props(byId(id)).onClick({ preventDefault() {} }); }); await flush(); },
    async clickText(label) {
      const n = walk(container).find((x) => x.tagName === 'BUTTON' && text(x).includes(label));
      assert.ok(n, `a ${label} button`);
      await act(async () => { await props(n).onClick({ preventDefault() {} }); }); await flush();
    },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('mounted: Reconcile on a failed deployment asks the Worker, dispatches nothing, and says what the record holds', async () => {
  const v = await mount((p, options) => {
    if (p === '/admin/licences/lic_fr/deployment') return response({ deployment: FAILED });
    if (p === '/admin/licences/lic_fr/deploy/reconcile' && options.method === 'POST') return response({ ok: true, checked: 'settled', deployment: FAILED });
    return response({ error: 'not_found' }, 404);
  });
  try {
    assert.ok(v.has('deploy-provisioning'));
    assert.ok(v.has('deploy-retry-form'), 'Retry stays beside it');
    await v.press('deploy-reconcile');
    assert.ok(v.has('licence-consequence-sheet'), 'Reconcile asks in the consequence sheet first (D4819 part 21)');
    assert.deepEqual(v.calls.filter(([m]) => m === 'POST'), [], 'nothing is sent before the sheet is confirmed');
    assert.match(v.text(), /Reconcile never starts a run/);
    await v.press('licence-consequence-confirm');
    assert.deepEqual(v.calls.filter(([m]) => m === 'POST'), [['POST', '/admin/licences/lic_fr/deploy/reconcile']], 'Reconcile is the read-only check; no retry is sent');
    assert.match(v.text(), /Reconciled\. Attempt 1 is recorded as failed \(run_failed\), and nothing was sent\. Retry starts attempt 2\./);
  } finally { await v.close(); }
});

test('mounted: an unreadable deployment is Unreadable with Try again, and Try again reads it again', async () => {
  let down = true;
  const v = await mount((p) => {
    if (p === '/admin/licences/lic_fr/deployment') return down ? response({ error: 'down' }, 500) : response({ deployment: FAILED });
    return response({ error: 'not_found' }, 404);
  });
  try {
    assert.ok(v.has('deploy-attempts-unreadable'));
    assert.match(v.text(), /This deployment's attempts could not be read\. This is not a sign that there are none\./);
    assert.doesNotMatch(v.text(), /None yet/);
    down = false;
    await v.clickText('Retry');
    assert.equal(v.calls.filter(([, p]) => p === '/admin/licences/lic_fr/deployment').length, 2);
    assert.ok(v.has('deploy-provisioning'), 'the record is drawn once it reads');
  } finally { await v.close(); }
});
