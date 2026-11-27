/**
 * D6001 (#6001) — Customer research's recruiting pipeline: the listed Stage
 * filter (and the "Invited · no slot yet" rows the card's next link names),
 * the interview record's `set-stage` action and its activity, and Add a
 * lead through `POST /progress/discovery/:projectId` at stage `lead`.
 * Real SQLite: the baseline's tables with the Validate migrations over them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';
import progress from '../src/routes/progress.ts';
import { RECORD_SPECS } from '../src/services/records/index.ts';
import { stageOptions } from '../src/services/records/validate.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

const BASE = readFileSync(resolve('cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const migration = (name: string) => readFileSync(resolve('cloudflare-worker/sql/migrations', name), 'utf8');
const KEY = ['fixture', 'key', 'for', 'd6001', 'tests'].join('-');
const FOUNDER = 10, PARTNER = 40;
const P = 1;
const roles: Record<number, string> = { [FOUNDER]: 'founder', [PARTNER]: 'partner' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'pain_groups', 'hypotheses', 'mvp_features', 'roadmap_okrs',
    'discovery_interviews', 'hypothesis_pain_links', 'competitor_analyses', 'competitor_candidates', 'competitor_signals',
    'waitlist_signups', 'metric_targets', 'interview_pain_severities', 'pain_group_aliases', 'competitor_sources',
    'validate_proposals']) db.exec(tableFromBaseline(BASE, t));
  for (const m of ['311_revenue_entries.sql', '440_validate_cycle_stores.sql', '202611220319_6007_segment_primary_profile.sql', '438_interview_sessions.sql']) db.exec(migration(m));
  applySessionTranslationColumns(db);
  for (const m of ['447_assistant_interviews.sql', '453_interview_processing.sql', '531_meeting_bots.sql', '459_cycle_activity_convention.sql',
    '460_validate_record_stores.sql', '755_posthog_metrics.sql', '439_validate_proposals_structuring.sql', '446_interview_structure_receipts.sql',
    '246_fills_the_blanks_everywhere.sql', '489_interview_findings.sql', '228_research_company_directory.sql', '249_project_metrics.sql']) db.exec(migration(m));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, 0)');
  u.run(FOUNDER, 'founder', 'Fern Founder', 'fern@example.test', 1001);
  u.run(PARTNER, 'partner', 'Pim Partner', 'pim@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Quillworks', 1001), (2, 'Other venture', 1002)`);
  return db;
}

async function call(db: DatabaseSync, method: string, path: string, body?: unknown, who = FOUNDER) {
  const app = new Hono<any>();
  app.route('/api/cycles', createCycleRecords(RECORD_SPECS));
  app.route('/api/cycles/validate', cycleValidate);
  app.route('/api/progress', progress);
  // index.ts maps the auth helpers' plain `Error('Forbidden')` to a 403; so does this app.
  app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, err?.message === 'Forbidden' ? 403 : 500));
  const token = await new SignJWT({ user_id: who, role: roles[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) }, { DB: d1Over(db), JWT_SECRET: KEY, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

function interview(db: DatabaseSync, name: string, stage: string | null, o: { booked_at?: string; project?: number } = {}) {
  const r = db.prepare('INSERT INTO discovery_interviews (project_id, interviewee_name, stage, booked_at) VALUES (?, ?, ?, ?) RETURNING id')
    .get(o.project ?? P, name, stage, o.booked_at ?? null) as any;
  return Number(r.id);
}
const names = (r: any) => r.body.records.rows.map((x: any) => x.interviewee).sort();
const list = (db: DatabaseSync, query: string, who = FOUNDER) => call(db, 'GET', `/cycles/validate/modules/customer-research?project=${P}${query}`, undefined, who);
const rec = (id: number, suffix = '') => `/cycles/validate/modules/customer-research/records/${id}${suffix}?project=${P}`;

function pipeline() {
  const db = fixture();
  interview(db, 'Lia Lead', 'lead');
  interview(db, 'Ivo Invited', 'invited');
  interview(db, 'Ida Invited', 'invited');
  // Booked once, moved back to Invited: the slot's stamp is kept, so it has one.
  interview(db, 'Ike Rebooked', 'invited', { booked_at: '2026-11-01T09:00:00Z' });
  interview(db, 'Bo Booked', 'booked', { booked_at: '2026-11-02T09:00:00Z' });
  interview(db, 'Dee Done', 'done');
  interview(db, 'Nell Nostage', null);
  interview(db, 'Their Invite', 'invited', { project: 2 });
  return db;
}

test('D6001: Customer research lists a Stage filter, each option the rows at that stage now', async () => {
  const db = pipeline();
  const r = await list(db, '');
  const stage = r.body.records.filters.find((f: any) => f.key === 'stage');
  assert.ok(stage, 'the Stage filter is listed');
  assert.deepEqual(stage.options.map((o: any) => o.value), ['lead', 'invited', 'invited_no_slot', 'booked', 'done']);
  assert.match(stage.options.find((o: any) => o.value === 'done').label, /no stage/, 'Done says it holds the rows with no stage');
  assert.deepEqual(names(await list(db, '&filter=stage:lead')), ['Lia Lead']);
  assert.deepEqual(names(await list(db, '&filter=stage:invited')), ['Ida Invited', 'Ike Rebooked', 'Ivo Invited']);
  assert.deepEqual(names(await list(db, '&filter=stage:booked')), ['Bo Booked']);
  // Stage is never guessed: no stage stays Done, as the State and the funnel read it.
  assert.deepEqual(names(await list(db, '&filter=stage:done')), ['Dee Done', 'Nell Nostage']);
  const done = await list(db, '&filter=stage:done');
  assert.equal(done.body.records.rows.find((x: any) => x.interviewee === 'Nell Nostage').stage, 'done');
  assert.equal(done.body.records.total, 2);
  // The recruiting picker's filter is unchanged.
  assert.deepEqual(names(await list(db, '&filter=stage:pipeline')), ['Bo Booked', 'Ida Invited', 'Ike Rebooked', 'Ivo Invited', 'Lia Lead']);
});

test('D6001: the card\'s "Book the N invited leads" lands on exactly the N rows it counted', async () => {
  const db = pipeline();
  const overview = await call(db, 'GET', `/cycles/validate/overview?project=${P}`);
  const next = overview.body.cards.find((c: any) => c.slug === 'customer-research').next;
  assert.equal(next.text, 'Book the 2 invited leads with no slot yet');
  const url = new URL(next.href, 'https://axal.vc');
  assert.equal(url.pathname, '/validate/customer-research');
  assert.equal(url.searchParams.get('filter'), 'stage:invited_no_slot');
  const landed = await list(db, `&filter=${url.searchParams.get('filter')}`);
  assert.deepEqual(names(landed), ['Ida Invited', 'Ivo Invited'], 'the rebooked lead has a slot; the other venture\'s is not read');
  assert.equal(landed.body.records.total, 2, 'the list counts what the card counted');
});

test('D6001: with no slot to book, "Invite the N new waitlist leads" lands on the Waitlist leads panel', async () => {
  const db = fixture();
  interview(db, 'Dee Done', 'done');
  db.exec("INSERT INTO waitlist_signups (project_id, email, audience, crm_status) VALUES (1, 'n@example.test', 'customer', 'new'), (1, 'm@example.test', 'customer', NULL)");
  const overview = await call(db, 'GET', `/cycles/validate/overview?project=${P}`);
  const next = overview.body.cards.find((c: any) => c.slug === 'customer-research').next;
  assert.deepEqual(next, { text: 'Invite the 2 new waitlist leads', href: `/validate/customer-research?project=${P}#waitlist-leads` });
});

test('D6001: the interview record declares Move stage, nothing chosen, the current stage marked', async () => {
  const db = pipeline();
  const id = interview(db, 'Ann Invited', 'invited');
  db.prepare("UPDATE discovery_interviews SET invited_at = '2026-11-09T10:00:00Z' WHERE id = ?").run(id);
  const read = await call(db, 'GET', rec(id));
  const move = read.body.actions.find((a: any) => a.key === 'set-stage');
  assert.ok(move, 'Move stage is declared');
  assert.equal(move.kind, 'form');
  assert.equal(move.label, 'Move stage');
  const stage = move.form.fields.find((f: any) => f.key === 'stage');
  assert.equal(stage.required, true);
  assert.equal(stage.value, undefined, 'no stage is preselected');
  assert.deepEqual(stage.options.map((o: any) => o.label), ['Lead', 'Invited · current · 9 Nov', 'Booked', 'Done']);
  assert.equal('execute' in move, false, 'the server callback is not sent');
  // A row with no stage reads as Done, and says the stage was not recorded.
  assert.deepEqual(stageOptions({ stage: null }).map((o) => o.label), ['Lead', 'Invited', 'Booked', 'Done · current · no stage recorded']);
  // A partner reads the record with no actions.
  assert.equal((await call(db, 'GET', rec(id), undefined, PARTNER)).body.actions.some((a: any) => a.key === 'set-stage'), false);
});

test('D6001: Add a lead, then move it to Invited, Booked and Done; each move is in the record\'s activity', async () => {
  const db = fixture();
  const added = await call(db, 'POST', `/progress/discovery/${P}`, { interviewee_name: 'Hana Sato', interviewee_company: 'Kobe Freight', interviewee_role: 'Ops lead', channel: 'video', stage: 'lead' });
  assert.equal(added.status, 200);
  const id = Number(added.body.id);
  const row = () => ({ ...db.prepare('SELECT stage, channel, interview_date, invited_at, booked_at, done_at FROM discovery_interviews WHERE id = ?').get(id) as any });
  assert.deepEqual(pickOf(row(), ['stage', 'channel', 'interview_date']), { stage: 'lead', channel: 'video', interview_date: null }, 'a lead has not been held, so it has no interview date');
  assert.deepEqual(names(await list(db, '&filter=stage:lead')), ['Hana Sato']);

  for (const [stage, stamp] of [['invited', 'invited_at'], ['booked', 'booked_at'], ['done', 'done_at']] as const) {
    const moved = await call(db, 'POST', rec(id, '/actions/set-stage'), { stage, at: '2026-11-14' });
    assert.equal(moved.status, 200, stage);
    assert.equal(row().stage, stage);
    assert.match(String(row()[stamp]), /^2026-11-14/, `${stage} keeps the date it was reached`);
  }
  const activity = (await call(db, 'GET', rec(id))).body.activity.map((a: any) => a.a);
  for (const stage of ['invited', 'booked', 'done']) {
    assert.ok(activity.some((a: string) => a === `Interview stage ${stage} by Fern Founder`), `${stage}: ${JSON.stringify(activity)}`);
  }
  // The move left the date it was given; with none, it is today.
  const back = await call(db, 'POST', rec(id, '/actions/set-stage'), { stage: 'lead' });
  assert.equal(back.status, 200);
  assert.equal(row().stage, 'lead');
});

test('D6001: Move stage refuses a stage that is not one of the four, a reader, and another venture\'s interview', async () => {
  const db = pipeline();
  const id = interview(db, 'Ann Invited', 'invited');
  const bad = await call(db, 'POST', rec(id, '/actions/set-stage'), { stage: 'held' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.detail, /stage must be one of lead, invited, booked, done/);
  const none = await call(db, 'POST', rec(id, '/actions/set-stage'), {});
  assert.equal(none.status, 400, 'no stage is never read as Done');
  assert.equal((await call(db, 'POST', rec(id, '/actions/set-stage'), { stage: 'booked' }, PARTNER)).status, 403);
  assert.equal((db.prepare('SELECT stage FROM discovery_interviews WHERE id = ?').get(id) as any).stage, 'invited');
  const theirs = Number((db.prepare("SELECT id FROM discovery_interviews WHERE interviewee_name = 'Their Invite'").get() as any).id);
  assert.equal((await call(db, 'POST', rec(theirs, '/actions/set-stage'), { stage: 'booked' })).status, 404);
  assert.equal((db.prepare('SELECT stage FROM discovery_interviews WHERE id = ?').get(theirs) as any).stage, 'invited');
});

test('D6001: the interview create route takes stage lead or none, and a known channel', async () => {
  const db = fixture();
  const plain = await call(db, 'POST', `/progress/discovery/${P}`, { interviewee_name: 'Logged Later' });
  assert.equal(plain.status, 200);
  const stored = db.prepare('SELECT stage, channel, interview_date FROM discovery_interviews WHERE id = ?').get(Number(plain.body.id)) as any;
  assert.equal(stored.stage, null, 'a logged interview keeps no stage, which reads as Done');
  assert.equal(stored.channel, null);
  assert.ok(stored.interview_date, 'a logged interview keeps today as its date');
  const later = await call(db, 'POST', `/progress/discovery/${P}`, { interviewee_name: 'Too Far', stage: 'booked' });
  assert.equal(later.status, 400);
  assert.match(later.body.detail, /stage lead, or no stage/);
  const channel = await call(db, 'POST', `/progress/discovery/${P}`, { interviewee_name: 'Odd Channel', stage: 'lead', channel: 'carrier pigeon' });
  assert.equal(channel.status, 400);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM discovery_interviews WHERE interviewee_name IN ('Too Far', 'Odd Channel')").get() as any).n, 0);
  assert.equal((await call(db, 'POST', `/progress/discovery/${P}`, { interviewee_name: 'Not Mine', stage: 'lead' }, PARTNER)).status, 403);
});

function pickOf(o: any, keys: string[]) { return Object.fromEntries(keys.map((k) => [k, o[k]])); }
