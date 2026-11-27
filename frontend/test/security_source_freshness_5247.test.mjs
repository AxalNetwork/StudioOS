/**
 * D5247 (#5247) — the Security Overview marks a store Stale past its own age, from the per-store last good read the
 * Worker now returns. A store with no time is "Not recorded" (never 0, never Stale), sanctions are never Stale, and
 * Stale never reads as "nothing needs action". The Worker half is
 * cloudflare-worker/test/security_source_freshness_5247.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/security_source_freshness_5247.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { buildOverview, freshnessOf, storeRows, ageWords } from '../src/pages/hq/security/overviewModel.js';
import OverviewWorkspace from '../src/pages/hq/security/OverviewWorkspace.jsx';
import SourceAvailability from '../src/pages/hq/security/SourceAvailability.jsx';

const h = React.createElement;
const AT = '2026-11-10T12:00:00.000Z';
const H = 3_600_000;
const ago = (hours) => new Date(Date.parse(AT) - hours * H).toISOString();

/** A freshness row as `services/securitySourceFreshness.ts` returns it. */
const fresh = (source, o = {}) => ({
  source, answered: true, last_read_at: AT, evidence_at: null, last_good_at: AT, age_hours: 24, age_from: 'last_read',
  basis: 'How often the store is written.', freshness: 'current', ...o,
});

const LEDGER = ['security_events', 'admin_audit_log', 'activity_logs', 'impersonation_sessions', 'licence_events'];
const AGES = { security_events: 6, admin_audit_log: 24, activity_logs: 24, impersonation_sessions: 168, licence_events: 168 };

/** Every check clear, every store current: the Overview's "nothing needs action" baseline. */
function quiet() {
  const overview = {
    audit: { available: true, total: 41 },
    impersonations: { available: true, active: 0, recent: [] },
    sessions: { available: true, active: 2, token_hours: 24 },
    mfa: { admins_total: 2, admins_with_mfa: 2 },
    dsr: { available: true, clock: { rule: 'calendar_month' }, rows: [] },
    security_events: { available: true, today: 4, failed_signins_24h: 0 },
    ai_safety: {
      window_days: 7,
      verdicts: { available: true, evaluated: 30, safe_count: 30, unsafe_count: 0 },
      enforcement: { available: true },
      token_anomalies: { available: true, count: 0, accounts_checked: 9 },
    },
    sanctions: { available: true, runs_total: 3, last_run_at: '2026-10-30T10:00:00Z', unreviewed_hits: 0 },
    backup_dr: {
      backup: { available: true, fresh: true, at: ago(5) },
      drill: { available: true, state: 'last_run_passed', at: ago(24 * 5), fresh: true },
    },
    sources: [
      fresh('admin_audit_log'),
      fresh('impersonation_sessions', { age_hours: 168 }),
      fresh('security_events', { age_hours: 6 }),
      fresh('sanctions_screenings', { age_hours: null, freshness: 'no_age' }),
      fresh('backup_d1', { age_hours: 26, age_from: 'evidence', evidence_at: ago(5), last_good_at: ago(5) }),
      fresh('backup_kv', { age_hours: 26, age_from: 'evidence', evidence_at: ago(5), last_good_at: ago(5) }),
      fresh('restore_drill', { age_hours: 768, age_from: 'evidence', evidence_at: ago(120), last_good_at: ago(120) }),
    ],
  };
  const feed = {
    filter: 'all', applied: {}, rows: [],
    sources: LEDGER.map((table) => {
      const { source: _s, ...rest } = fresh(table, { age_hours: AGES[table] });
      return { table, available: true, rows: 3, ...rest };
    }),
  };
  return { overview, feed };
}
const model = ({ overview, feed }) => buildOverview({
  overview: { state: 'ready', value: overview, at: AT },
  feed: { state: 'ready', value: feed, at: AT },
});
const text = (el) => renderToStaticMarkup(h(MemoryRouter, null, el)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the baseline: every store current, nothing Stale, and only then "nothing needs action"', () => {
  const m = model(quiet());
  assert.deepEqual(m.findings, []);
  assert.equal(m.sources.stale, 0);
  assert.ok(m.clear.some((c) => c.id === 'sources'));
  assert.match(text(h(OverviewWorkspace, { model: m, onRetry: {} })), /Nothing needs action/);
});

test('a store aged from its last read: a failed ledger store past its age is Stale beside its Unavailable finding', () => {
  // security_events, 6 h. Mutations checked: Stale dropped from the failed finding; a second finding for one store;
  // the sources clear row kept while a store is Stale.
  const q = quiet();
  const failed = { answered: false, last_read_at: ago(8), last_good_at: ago(8), freshness: 'stale' };
  q.feed.sources[0] = { ...q.feed.sources[0], available: false, reason: 'down', rows: undefined, ...failed };
  // The same store as /overview counted it: also unanswered, so neither read vouches for it now.
  q.overview.sources = q.overview.sources.map((r) => (r.source === 'security_events' ? { ...r, ...failed } : r));
  const m = model(q);
  const f = m.findings.find((x) => x.id === 'source-security_events');
  assert.ok(f, 'the Unavailable finding stands');
  assert.equal(f.stale, true);
  assert.match(f.detail, /Stale · last good read 2026-11-10 04:00 UTC, 8 h ago; its age is 6 h/);
  assert.equal(m.findings.some((x) => x.id === 'stale-security_events'), false, 'one store, one item');
  assert.equal(m.clear.some((c) => c.id === 'sources'), false);
  const events = m.areas.find((a) => a.id === 'events');
  assert.equal(events.state, 'unavailable', 'a worse state is kept');
  assert.equal(events.stale, true);
  assert.match(events.freshness, /Security ledger \(refusals and step-ups\): Stale/);
  const html = text(h(OverviewWorkspace, { model: m, onRetry: {} }));
  assert.doesNotMatch(html, /Nothing needs action/);
});

test('a store aged from its evidence: an old backup heartbeat that answered is its own Stale finding and marks Recovery', () => {
  // backup_d1, 26 h. Mutations checked: no finding for an answered Stale store; the Recovery card left Verified.
  const q = quiet();
  q.overview.sources = q.overview.sources.map((r) => (r.source === 'backup_d1'
    ? { ...r, evidence_at: ago(30), last_good_at: ago(30), freshness: 'stale' } : r));
  const m = model(q);
  const f = m.findings.find((x) => x.id === 'stale-backup_d1');
  assert.ok(f);
  assert.equal(f.state, 'stale');
  assert.equal(f.title, 'D1 backup heartbeat is out of date');
  assert.match(f.detail, /Stale · last good evidence 2026-11-09 06:00 UTC, 30 h ago; its age is 26 h/);
  assert.match(f.detail, /not a claim that nothing is open/);
  assert.equal(f.tab, 'resilience');
  assert.equal(m.areas.find((a) => a.id === 'recovery').state, 'stale', 'Verified becomes Stale');
  assert.equal(m.marks.resilience.state, 'stale');
  const html = text(h(OverviewWorkspace, { model: m, onRetry: {} }));
  assert.doesNotMatch(html, /Nothing needs action/, 'Stale never reads as nothing open');
  assert.match(html, /D1 backup heartbeat is out of date/);
});

test('a store with no age: sanctions are never Stale, however old the last read', () => {
  // Mutation checked: no_age read as stale.
  const q = quiet();
  q.overview.sources = q.overview.sources.map((r) => (r.source === 'sanctions_screenings'
    ? { ...r, answered: false, last_read_at: ago(24 * 400), last_good_at: ago(24 * 400) } : r));
  q.overview.sanctions = { available: true, runs_total: 3, unreviewed_hits: 0 };
  const m = model(q);
  assert.deepEqual(m.findings, []);
  assert.notEqual(m.areas.find((a) => a.id === 'trust').state, 'stale');
  const words = freshnessOf(q.overview.sources.find((r) => r.source === 'sanctions_screenings'), AT);
  assert.equal(words.state, null);
  assert.match(words.text, /no age: it runs on request/);
});

test('no recorded time is "Not recorded": never 0, never Stale, never a time', () => {
  const words = freshnessOf(fresh('backup_kv', { age_from: 'evidence', last_good_at: null, evidence_at: null, freshness: 'not_recorded' }), AT);
  assert.deepEqual(words, { state: null, text: 'Last good evidence: Not recorded' });
  const q = quiet();
  q.overview.sources = q.overview.sources.map((r) => (r.source === 'backup_kv'
    ? { ...r, last_good_at: null, evidence_at: null, freshness: 'not_recorded' } : r));
  const m = model(q);
  assert.deepEqual(m.findings, []);
  const html = text(h(SourceAvailability, { sources: m.sources }));
  assert.match(html, /backup_kv · Last good evidence: Not recorded/);
  assert.doesNotMatch(html, /backup_kv[^·]*· 0/);
  assert.equal(freshnessOf({ table: 'x', available: true }, AT), null, 'an older Worker claims nothing');
});

test('the source details carry each store\'s last good read and age, and name a Stale store in the summary', () => {
  const q = quiet();
  q.overview.sources = q.overview.sources.map((r) => (r.source === 'backup_d1'
    ? { ...r, evidence_at: ago(30), last_good_at: ago(30), freshness: 'stale' } : r));
  const m = model(q);
  const html = text(h(SourceAvailability, { sources: m.sources, 'data-testid': 's' }));
  assert.match(html, /security_events · 3 rows read · Last good read 2026-11-10 12:00 UTC · age 6 h/);
  assert.match(html, /licence_events · 3 rows read · Last good read 2026-11-10 12:00 UTC · age 7 days/);
  assert.match(html, /D1 backup heartbeat is past its age/);
  const raw = renderToStaticMarkup(h(SourceAvailability, { sources: m.sources, 'data-testid': 's' }));
  assert.match(raw, /data-testid="s-stale"/);
  assert.match(raw, /data-testid="security-source-stale"/);
});

test('a source row marked Stale keeps "n of n sources read" out of Checked and clear, even when it answered', () => {
  // Defensive: today a ledger store is Stale only when it did not answer. Mutation checked: the Stale guard removed.
  const q = quiet();
  q.feed.sources[2] = { ...q.feed.sources[2], last_good_at: ago(30), last_read_at: ago(30), freshness: 'stale' };
  const m = model(q);
  assert.equal(m.clear.some((c) => c.id === 'sources'), false);
  assert.ok(m.findings.some((f) => f.id === 'stale-activity_logs' && f.state === 'stale'));
});

test('the two reads agree on one row per store: the later last good read wins, so the one that answered', () => {
  // Mutation checked: the first row kept whatever came later.
  const swapped = storeRows(
    { sources: [fresh('admin_audit_log', { answered: true, last_read_at: AT })] },
    { sources: [{ table: 'admin_audit_log', available: false, ...fresh('x', { answered: false, last_read_at: ago(30), freshness: 'stale' }), source: undefined }] },
  );
  assert.equal(swapped.admin_audit_log.freshness, 'current');
  const rows = storeRows(
    { sources: [fresh('security_events', { answered: false, last_read_at: ago(9), freshness: 'stale' })] },
    { sources: [{ table: 'security_events', available: true, ...fresh('x', { age_hours: 6 }), source: undefined }] },
  );
  assert.equal(rows.security_events.freshness, 'current');
  assert.equal(ageWords(26), '26 h');
  assert.equal(ageWords(768), '32 days');
  assert.equal(ageWords(null), null);
});
