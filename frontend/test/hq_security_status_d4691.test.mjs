/**
 * D4691 (#4691) — HQ · Security draws identities by kind, stale and invalid
 * evidence as such, and a partial read as unreadable beside what was read.
 *
 * Each assertion renders with a payload shaped like the worker's and reads the
 * text a person would see. The worker half is proved against a real database
 * in cloudflare-worker/test/hq_security_status_d4691.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildOverview } from '../src/pages/hq/security/overviewModel.js';
import { renderedText } from './_renderedText.mjs';
import {
  AiSafety, BackupDr, SessionsPanel, backupSentence, drillSentence, identityLine, impersonationNote,
} from '../src/pages/hq/SecurityPage.jsx';

const html = (C, props) => renderToStaticMarkup(React.createElement(C, props));
const text = (C, props) => renderedText(html(C, props));

const HB = {
  available: true, state: 'fresh', fresh: true, kind: 'd1', at: '2026-11-07T02:25:00Z',
  recovery_point: '2026-11-07T02:11:00Z', stale_after_hours: 26, source: 'gha', size_bytes: 4096,
};
const PASSED = {
  available: true, state: 'last_run_passed', fresh: true, at: '2026-11-01T06:03:10Z', stale_after_days: 32,
  exit_code: 0, backup_key: 'd1/studioos-db/backup-2026-10-31.sql', rpo_met: true, rto_met: true,
};

test('identities are drawn with their kind: a support operator names the account it acted for', () => {
  assert.deepEqual(identityLine({ kind: 'user', label: 'Hana Holder' }), { kind: 'account', text: 'Hana Holder' });
  assert.deepEqual(
    identityLine({ kind: 'support', label: 'Sam Super', on_behalf_of: { user_id: 2, label: 'Hana Holder' } }),
    { kind: 'support', text: 'Sam Super for Hana Holder' },
  );
  assert.deepEqual(identityLine({ kind: 'network', label: 'network 198.51.100.0/24' }).kind, 'network');
  assert.deepEqual(identityLine({ kind: 'system', label: 'System' }).kind, 'system');
  assert.equal(identityLine(null), null);
});

test('a heartbeat is fresh, stale, invalid, never written or unreadable — and only fresh reads as a backup', () => {
  assert.match(backupSentence(HB), /^Last D1 export of 2026-11-07 02:11/);
  assert.match(backupSentence({ ...HB, state: 'stale', fresh: false }), /^Stale — .*older than 26 hours/);
  assert.match(backupSentence({ available: false, state: 'invalid', reason: 'x is not valid evidence.' }), /^Invalid — /);
  assert.match(backupSentence({ available: false, state: 'never_written', reason: 'none.' }), /^Not recorded — /);
  assert.match(backupSentence({ available: false, state: 'unreadable', reason: 'unbound.' }), /^Unreadable — /);

  const staleText = text(BackupDr, { block: { backup: { ...HB, state: 'stale', fresh: false }, drill: PASSED } });
  assert.match(staleText, /Stale/);
  assert.doesNotMatch(staleText, /Last D1 export/, 'a stale heartbeat was drawn as a recorded backup');
  assert.match(html(BackupDr, { block: { backup: { ...HB, state: 'stale', fresh: false }, drill: PASSED } }), /data-testid="hq-backup-stale"/);
});

test('a drill pass older than its window is stale; an invalid marker is invalid; a missed target is said', () => {
  assert.match(drillSentence(PASSED), /^Last run passed on 2026-11-01/);
  assert.match(drillSentence({ ...PASSED, fresh: false }), /^Stale — older than 32 days/);
  assert.match(drillSentence({ available: false, state: 'invalid', reason: 'its outcome and its exit code disagree.' }), /^Invalid — /);
  assert.match(drillSentence({ ...PASSED, rpo_met: false }), /missed its recovery-point target/);
  assert.match(html(BackupDr, { block: { backup: HB, drill: { ...PASSED, fresh: false } } }), /text-amber-800/,
    'a stale pass was drawn in the passing tone');
});

test('the live-impersonation note counts records past the limit apart, never as live', () => {
  assert.equal(impersonationNote({ active: 2, not_closed: 0 }), 'token could still be valid');
  assert.match(impersonationNote({ active: 2, not_closed: 3 }), /3 open records past the limit, not live/);
});

test('AI safety: an unreadable rollup is Unreadable, and a failed rule breakdown is not "no rule fired"', () => {
  const down = text(AiSafety, {
    block: { available: false, reason: 'x', token_anomalies: { available: false, reason: 'y' }, not_counted: [] },
  });
  assert.match(down, /The AI guardrail counters could not be read/);
  assert.doesNotMatch(down, /Guard verdicts/, 'tiles drawn for a rollup that was not read');

  const block = {
    available: true, window_days: 7,
    verdicts: { available: true, evaluated: 4, safe_count: 4, unsafe_count: 0, no_verdict_count: 0, safe_rate: 1 },
    enforcement: { available: true, blocked: 1, flagged: 0, breakdown_available: false, breakdown_reason: 'did not complete.', rules: null, states: null, unclassified: null },
    guard: { available: false, reason: 'n/a' },
    token_anomalies: null, not_counted: [],
  };
  const partial = text(AiSafety, { block });
  assert.match(partial, /What tripped the guard\s*Unreadable — did not complete\./);
  assert.doesNotMatch(partial, /No turn in this window named a violated rule/, 'an unread breakdown read as no rule fired');
  const read = text(AiSafety, { block: { ...block, enforcement: { ...block.enforcement, breakdown_available: true, rules: [], states: [], unclassified: 0 } } });
  assert.match(read, /No turn in this window named a violated rule/);
});

test('the Sessions list shows a network bucket and marks a support-held session', () => {
  const list = {
    token_hours: 24, total: 2, expiry_minutes: 30, impersonations: { available: true, rows: [] },
    rows: [
      { id: 1, user_id: 7, name: 'Hana Holder', role: 'founder', user_agent: 'Safari', network: '203.0.113.0/24', created_at: '2026-11-07 08:00:00', last_seen_at: '2026-11-07 09:00:00', is_current: false, holder: { kind: 'user', label: 'Hana Holder' } },
      { id: 2, user_id: 8, name: 'Olu Other', role: 'founder', user_agent: null, network: 'unknown', created_at: '2026-11-07 08:00:00', last_seen_at: '2026-11-07 09:00:00', is_current: false, holder: { kind: 'support', label: 'HQ support operator', on_behalf_of: { label: 'Olu Other' } } },
    ],
  };
  const out = text(SessionsPanel, { list, onAct: async () => ({}), onRetry: () => {} });
  assert.match(out, /network 203\.0\.113\.0\/24/);
  assert.match(out, /no network recorded/);
  assert.match(out, /held by HQ support operator/);
});

// ── D4691 on the Security v2 Overview (D4800's model): the same rules hold there ──


const OV_BASE = () => ({
  mfa: { admins_total: 2, admins_with_mfa: 2 },
  impersonations: { available: true, active: 0, recent: [] },
  sessions: { available: true, active: 1, token_hours: 24 },
  dsr: { clock: { rule: 'calendar_month', label: 'One calendar month from receipt, to the end of that UTC day' }, rows: [] },
  sanctions: { available: true, runs_total: 1, unreviewed_hits: 0 },
  backup_dr: {
    backup: { available: true, state: 'fresh', fresh: true, kind: 'd1', at: '2026-11-07T02:00:00Z' },
    drill: { available: true, state: 'last_run_passed', fresh: true, at: '2026-11-01T03:00:00Z', backup_key: 'd1/x.sql' },
  },
});
const overviewOf = (ov) => buildOverview({
  overview: { state: 'ready', value: ov, at: '2026-11-07T14:30:00.000Z' },
  feed: { state: 'ready', value: { sources: [], rows: [] }, at: '2026-11-07T14:30:00.000Z' },
});
const recovery = (m) => m.areas.find((a) => a.id === 'recovery');

test('Overview: an unreadable deletion-request read is a could-not-check, never "0 near deadline"', () => {
  const ok = overviewOf(OV_BASE());
  assert.ok(ok.clear.some((c) => c.id === 'dsr'), 'a readable empty list is a measured zero');
  const ov = OV_BASE();
  ov.dsr = { available: false, reason: 'dsr store down' };
  const m = overviewOf(ov);
  assert.ok(!m.clear.some((c) => c.id === 'dsr'), 'an unreadable list is not a measured zero');
  const f = m.findings.find((x) => x.id === 'dsr-unreadable');
  assert.ok(f, 'the unreadable read is its own finding');
  assert.equal(f.state, 'unavailable');
  assert.equal(f.detail, 'dsr store down');
});

test('Overview: a stale drill pass or a stale heartbeat is never verified recovery', () => {
  assert.equal(recovery(overviewOf(OV_BASE())).state, 'verified');
  const staleDrill = OV_BASE();
  staleDrill.backup_dr.drill = { ...staleDrill.backup_dr.drill, fresh: false, stale_after_days: 32 };
  const m = overviewOf(staleDrill);
  assert.equal(recovery(m).state, 'stale');
  assert.match(recovery(m).fact, /passed, out of date/);
  const f = m.findings.find((x) => x.id === 'drill-stale');
  assert.ok(f && f.state === 'stale', 'a stale pass is a finding');
  assert.match(f.detail, /more than 32 days ago/);
  const staleBackup = OV_BASE();
  staleBackup.backup_dr.backup = { ...staleBackup.backup_dr.backup, fresh: false, state: 'stale' };
  const b = recovery(overviewOf(staleBackup));
  assert.equal(b.state, 'stale');
  assert.match(b.fact, /^Backup stale/);
  const invalid = OV_BASE();
  invalid.backup_dr.backup = { available: false, state: 'invalid', reason: 'schema 9' };
  assert.match(recovery(overviewOf(invalid)).fact, /^Backup heartbeat invalid/);
  assert.notEqual(recovery(overviewOf(invalid)).state, 'verified');
});
