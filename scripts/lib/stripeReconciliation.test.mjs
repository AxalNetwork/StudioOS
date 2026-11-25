// D8512 (#8512): the Stripe line of the post-deploy smoke. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgeReconciliation, notRead, STATES } from './stripeReconciliation.mjs';

const body = (state, extra = {}) => ({ state, window_hours: 72, stripe_events: 2, receipted: 1, not_received: 1, unfinished: 0, paying_subscriptions: 0, truncated: false, ...extra });

test('the two clean states are ok, the other three warn', () => {
  assert.equal(judgeReconciliation(body('no_events_expected')).level, 'ok');
  assert.equal(judgeReconciliation(body('reconciled')).level, 'ok');
  for (const s of ['delivery_failed_or_absent', 'accepted_state_missing', 'unreadable']) assert.equal(judgeReconciliation(body(s)).level, 'warn', s);
  assert.deepEqual(STATES, ['no_events_expected', 'reconciled', 'delivery_failed_or_absent', 'accepted_state_missing', 'unreadable']);
});

test('the line names the state and counts and nothing else in the body', () => {
  const { line } = judgeReconciliation(body('delivery_failed_or_absent', { event_id: 'evt_secret', key: 'sk_live_secret', truncated: true }));
  assert.equal(line, 'Stripe: delivery_failed_or_absent over 72h (first page only): stripe_events=2 receipted=1 not_received=1 unfinished=0 paying_subscriptions=0');
  assert.match(judgeReconciliation(body('unreadable', { stripe_events: null })).line, /stripe_events=unknown/);
});

test('an answer that is not the reconciliation warns as not read', () => {
  for (const b of [null, 'x', {}, { state: 'fine' }, { detail: 'forbidden' }]) {
    assert.deepEqual(judgeReconciliation(b), { level: 'warn', line: 'Stripe: could not be read (the answer is not the reconciliation).' });
  }
  assert.equal(notRead('why').level, 'warn');
});

test('the script always exits 0 and prints a warning line without a credential', () => {
  const env = { ...process.env, STRIPE_RECONCILIATION_HOST: '', STRIPE_RECONCILIATION_COOKIE: '' };
  const out = execFileSync(process.execPath, ['scripts/check-stripe-reconciliation.mjs'], { env, encoding: 'utf8' });
  assert.match(out, /^::warning title=Stripe reconciliation::Stripe: not read \(the smoke holds no read credential/);
  const dir = mkdtempSync(join(tmpdir(), 'recon-'));
  writeFileSync(join(dir, 'ok.json'), JSON.stringify(body('reconciled', { not_received: 0, receipted: 2 })));
  assert.match(execFileSync(process.execPath, ['scripts/check-stripe-reconciliation.mjs', join(dir, 'ok.json')], { env, encoding: 'utf8' }), /^✓ Stripe: reconciled/);
  writeFileSync(join(dir, 'bad.json'), JSON.stringify(body('accepted_state_missing')));
  assert.match(execFileSync(process.execPath, ['scripts/check-stripe-reconciliation.mjs', join(dir, 'bad.json')], { env, encoding: 'utf8' }), /^::warning .*accepted_state_missing/);
});

test('the post-deploy smoke runs it as a warning step that reads no secret', () => {
  const wf = readFileSync('.github/workflows/post-deploy-smoke.yml', 'utf8');
  const step = wf.slice(wf.indexOf('- name: Stripe reconciliation (warning)'));
  assert.ok(step.startsWith('- name: Stripe reconciliation (warning)'), 'the step exists');
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /run: node scripts\/check-stripe-reconciliation\.mjs\s*$/);
  assert.doesNotMatch(step, /secrets\./);
});
