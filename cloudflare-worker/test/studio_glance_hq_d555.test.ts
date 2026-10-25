/**
 * D555 (#1155) — HQ's own figures on the studio glance: accounts, the approval
 * lanes, and the headline insights, labelled as HQ's. Aggregates only.
 *
 * Run on node:sqlite with the tables cut from `schema_baseline.sql`. A lane
 * whose table is left out reads as unreadable while the others answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  studioGlance, HQ_SCOPE_LABEL, HQ_BENCHMARK_REASON, CONTENT_TO_HQ_REASON,
} from '../src/services/studioGlance.ts';
import { NOT_LANED } from '../src/services/approvalSources.ts';
import { ACTIVE_ACCOUNT_BASIS } from '../src/services/activeAccounts.ts';

const NOW = Date.parse('2026-10-07T12:00:00Z'); // a Wednesday
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x; return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
  };
}

const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

function seeded() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'user_role_review', 'partner_profiles', 'projects', 'tickets', 'ai_usage_logs', 'activity_logs', 'esign_envelopes']) db.exec(ddl(t));
  // D990: a Draft is read off migration 275's answer columns too.
  db.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/275_partner_profiles_columns.sql'), 'utf8'));
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, created_at, kyc_status, kyc_submitted_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  u.run(1, 'admin', 'Ada Admin', 'ada@secret.example', 1, ago(400), 'approved', null);
  u.run(2, 'founder', 'Fay Founder', 'fay@secret.example', 1, ago(3), 'pending', ago(5));
  u.run(3, 'founder', 'Finn Founder', 'finn@secret.example', 1, ago(20), 'approved', null);
  u.run(4, 'investor', 'Ivy Investor', 'ivy@secret.example', 1, ago(2), 'approved', null);
  u.run(5, 'exploring', 'Eve Explorer', 'eve@secret.example', 1, ago(10), 'approved', null);
  // D1039: the Exploring lane counts an Explorer whose binding agreement is signed.
  db.prepare(`INSERT INTO esign_envelopes (id, envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, completed_at)
              VALUES (70, 'env-70', 5, 'binding_agreement', 'Binding agreement', 'Synthetic', 'synthetic', 'completed', 1, ?)`).run(ago(2));
  db.prepare('INSERT INTO user_role_review (user_id, binding_envelope_id) VALUES (5, 70)').run();
  u.run(6, 'investor', 'Gone Person', 'gone@secret.example', 0, ago(1), 'approved', null);
  db.prepare(`INSERT INTO partner_profiles (email, persona, admin_status, created_at) VALUES (?, ?, 'pending', ?)`)
    .run('pp@secret.example', 'agency', ago(9));
  db.prepare(`INSERT INTO projects (id, name, deleted_at) VALUES (1, 'Kept', NULL), (2, 'Binned', ?)`).run(ago(1));
  db.prepare(`INSERT INTO tickets (title, description, status, user_id) VALUES ('a', 'x', 'open', 2), ('b', 'x', 'closed', 3), ('c', 'x', 'in_progress', 4)`).run();
  const ai = db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, est_cost_usd, created_at) VALUES (?, 'workspace_explain', 'm', ?, ?)`);
  ai.run(2, 0.25, '2026-10-02 10:00:00');
  ai.run(3, 0.5, '2026-10-06 10:00:00');
  ai.run(4, 9, '2026-09-30 23:00:00'); // last month
  // D893: last week (Mon 2026-09-28) had users 2 and 3 active; user 4's row is not a middleware row.
  const act = db.prepare(`INSERT INTO activity_logs (user_id, action, endpoint, created_at) VALUES (?, 'request', ?, ?)`);
  act.run(2, '/api/projects', '2026-09-20 09:00:00');
  act.run(2, '/api/projects', '2026-09-29 09:00:00');
  act.run(3, '/api/inbox', '2026-10-04 23:59:59');
  act.run(3, '/api/inbox', '2026-10-01 10:00:00');
  act.run(4, null, '2026-09-30 10:00:00');
  act.run(4, '/api/inbox', '2026-10-06 10:00:00'); // this week, not last
  return db;
}

test('HQ accounts: counts by role over active accounts, new in 7 and 30 days, exploring, Trash; labelled HQ', async () => {
  const g: any = await studioGlance({ DB: makeD1(seeded()) } as any, NOW);
  assert.equal(g.tier, 'hq');
  const a = g.accounts;
  assert.equal(a.recorded, true);
  assert.equal(a.label, HQ_SCOPE_LABEL);
  assert.equal(HQ_SCOPE_LABEL, 'HQ-held accounts · axal.vc');
  assert.equal(a.total, 5, 'the deactivated account is not in the total');
  assert.deepEqual(a.by_role, [
    { role: 'founder', count: 2 }, { role: 'admin', count: 1 }, { role: 'exploring', count: 1 }, { role: 'investor', count: 1 },
  ]);
  assert.deepEqual([a.new_7d, a.new_30d, a.deactivated], [2, 4, 1]);
  assert.equal(a.exploring, 1, 'every account in the holding role, from the Exploring lane\'s `holding` figure (D1039)');
  assert.equal(a.trash_projects, 1);
});

test('HQ approvals: each lane counted by its console\'s predicate, worst first; a failing lane is unreadable and the others answer', async () => {
  const g: any = await studioGlance({ DB: makeD1(seeded()) } as any, NOW);
  const ap = g.approvals;
  assert.equal(ap.recorded, true);
  assert.equal(ap.label, HQ_SCOPE_LABEL);
  const by = Object.fromEntries(ap.lanes.map((l: any) => [l.key, l]));
  assert.equal(by.kyc.count, 1);
  assert.equal(by.partner_profiles.count, 1);
  assert.equal(by.exploring.count, 1);
  assert.equal(by.kyc.oldest_age_hours, 120);
  // lp_applications, referral_submissions and the rest are absent from this database.
  assert.equal(by.lp.count, null);
  assert.match(by.lp.reason, /could not be read/);
  assert.equal(by.lp.sla, 'unknown');
  assert.ok(ap.unreadable.includes('LP applications'));
  assert.equal(ap.pending_total, null, 'no total over the lanes that answered');
  assert.equal(ap.lanes[0].count, null, 'an unreadable lane sorts first');
  const measured = ap.lanes.filter((l: any) => l.count !== null);
  assert.deepEqual(measured.slice(0, 3).map((l: any) => l.key), ['exploring', 'partner_profiles', 'kyc'], 'oldest first');
  assert.deepEqual(ap.no_queue.map((n: any) => n.label), NOT_LANED.map((n) => n.label));
  assert.ok(ap.no_queue.every((n: any) => n.reason.length > 10));
  assert.deepEqual(ap.not_applicable, [{ label: 'Content to HQ', reason: CONTENT_TO_HQ_REASON }]);
});

test('HQ approvals: when every lane answers, the total is their sum', async () => {
  const db = seeded();
  for (const t of ['lp_applications', 'referral_submissions', 'cohort_applicants',
    'job_postings', 'events', 'admin_consultation_bookings', 'dd_cases']) db.exec(ddl(t));
  db.exec(readFileSync(new URL('../sql/migrations/546_events_review_columns.sql', import.meta.url), 'utf8'));
  // Declared by migration 287, not the baseline; the lane reads these three columns.
  db.exec('CREATE TABLE spinout_moderation_cases (id INTEGER PRIMARY KEY, status TEXT, resolved_at TEXT, created_at TEXT)');
  db.prepare(`INSERT INTO spinout_moderation_cases (status, resolved_at, created_at) VALUES ('under_review', NULL, ?), ('active', NULL, ?)`).run(ago(30), ago(31));
  const g: any = await studioGlance({ DB: makeD1(db) } as any, NOW);
  assert.deepEqual(g.approvals.unreadable, []);
  assert.equal(g.approvals.pending_total, 4, 'KYC, partner profile, exploring, one moderation case under review');
  assert.equal(g.approvals.lanes[0].key, 'moderation', 'the oldest pending item leads');
});

test('HQ insights: eight weeks of sign-ups, this month\'s AI spend, open tickets; active accounts not recorded', async () => {
  const g: any = await studioGlance({ DB: makeD1(seeded()) } as any, NOW);
  const i = g.insights;
  assert.equal(i.recorded, true);
  assert.equal(i.label, HQ_SCOPE_LABEL);
  const weeks = i.signups_by_week.weeks;
  assert.equal(weeks.length, 8);
  assert.equal(weeks.at(-1).week_start, '2026-10-05', 'the current week starts on Monday');
  assert.equal(weeks.at(-1).to_date, true);
  assert.equal(weeks[0].to_date, false);
  assert.equal(weeks.at(-1).count, 2, 'users 4 and 6 (deactivated since) signed up this week; user 2 on the Sunday before');
  assert.equal(weeks.find((w: any) => w.week_start === '2026-09-28').count, 1);
  assert.equal(weeks[0].count, 0, 'a week with nobody is a measured zero');
  assert.deepEqual([i.ai_spend_month.month, i.ai_spend_month.usd, i.ai_spend_month.calls], ['2026-10', 0.75, 2]);
  assert.equal(i.open_tickets.open, 2, 'open and in_progress');
  assert.deepEqual(i.active_accounts, {
    available: true, week: '2026-09-28', value: 2, basis: ACTIVE_ACCOUNT_BASIS,
  }, 'D893: distinct signed-in accounts last week, middleware rows only');
  assert.equal(i.benchmark.recorded, false);
  assert.equal(i.benchmark.reason, HQ_BENCHMARK_REASON);
});

test('each insight answers alone: an unreadable store is that figure\'s own gap, never zero', async () => {
  const db = seeded();
  db.exec('DROP TABLE ai_usage_logs; DROP TABLE tickets; DROP TABLE activity_logs;');
  const g: any = await studioGlance({ DB: makeD1(db) } as any, NOW);
  assert.equal(g.insights.ai_spend_month.available, false);
  assert.equal(g.insights.ai_spend_month.usd, undefined);
  assert.match(g.insights.ai_spend_month.reason, /not the same as no spend/);
  assert.equal(g.insights.open_tickets.available, false);
  assert.equal(g.insights.open_tickets.open, undefined);
  assert.equal(g.insights.active_accounts.available, false);
  assert.equal(g.insights.active_accounts.value, undefined);
  assert.match(g.insights.active_accounts.reason, /not the same as nobody active/);
  assert.equal(g.insights.signups_by_week.available, true, 'the others still answer');
  assert.equal(g.accounts.recorded, true);
});

test('an unreadable account table is not "no accounts"', async () => {
  const db = new DatabaseSync(':memory:');
  const g: any = await studioGlance({ DB: makeD1(db) } as any, NOW);
  assert.equal(g.accounts.available, false);
  assert.equal(g.accounts.total, undefined);
  assert.match(g.accounts.reason, /not the same as no accounts/);
  assert.equal(g.insights.signups_by_week.available, false);
});

test('no personal data reaches the payload: no name, email or account id', async () => {
  const g: any = await studioGlance({ DB: makeD1(seeded()) } as any, NOW);
  const text = JSON.stringify({ accounts: g.accounts, approvals: g.approvals, insights: g.insights });
  assert.doesNotMatch(text, /secret\.example|Ada Admin|Fay Founder|Eve Explorer|Ivy|Finn|Gone Person/);
  assert.doesNotMatch(text, /"(user_id|email|name|id)"\s*:/);
});

test('seats, the share rate and the licence stay per-subsidiary on HQ (U1); the branch path is unchanged', async () => {
  const g: any = await studioGlance({ DB: makeD1(seeded()) } as any, NOW);
  assert.equal(g.seats.recorded, false);
  assert.match(g.seats.reason, /U1/);
  assert.equal(g.revenue.recorded, false);
  assert.equal(g.licence.recorded, false);
  const b: any = await studioGlance({ DB: makeD1(seeded()), BRANCH_CODE: 'fr' } as any, NOW);
  assert.equal(b.tier, 'branch');
  assert.equal(b.accounts, undefined, 'the branch glance gains no HQ figures');
  assert.ok(Array.isArray(b.approvals.lanes));
});
