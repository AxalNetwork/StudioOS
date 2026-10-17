/**
 * D690 (#1691, test 9) — Validate's module reads carry the canvas's lists,
 * each interview's state, the bottom sections' fields and parts, and FVW's
 * three views over the verdict history. Real SQLite: the baseline's tables
 * with migrations 255, 438, 440, 447, 453 and 459 applied over them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleValidate from '../src/routes/cycle_validate.ts';
import { daysBefore, INTERVIEW_STATES, QUOTE_WITHHELD } from '../src/services/cycleValidate.ts';
import { validateContext } from '../src/mcp/tools/context.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const KEY = ['fixture', 'key', 'for', 'd690', 'lists'].join('-');
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');
const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n: number) => daysBefore(TODAY, n);
const FOUNDER = 10, ADMIN = 30, PARTNER = 40;
const P = 1;
const roles: Record<number, string> = { [FOUNDER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
    'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets',
    'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals', 'validate_proposals',
    'mvp_features', 'roadmap_okrs',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  for (const m of ['440_validate_cycle_stores.sql', '438_interview_sessions.sql', '447_assistant_interviews.sql',
    '453_interview_processing.sql', '459_cycle_activity_convention.sql', '460_validate_record_stores.sql']) db.exec(sqlOf(m));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, 0)');
  u.run(FOUNDER, 'founder', 'Fern Founder', 'fern@example.test', 1001);
  u.run(ADMIN, 'admin', 'Ash Admin', 'ash@example.test', null);
  u.run(PARTNER, 'partner', 'Pim Partner', 'pim@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Quillworks', 1001)`);
  return db;
}

async function get(db: DatabaseSync, path: string, who = FOUNDER) {
  const app = new Hono<any>();
  app.route('/api/cycles/validate', cycleValidate);
  app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));
  const token = await new SignJWT({ user_id: who, role: roles[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/validate${path}`, { headers: { Authorization: `Bearer ${token}` } },
      { DB: d1Over(db), JWT_SECRET: KEY, ENVIRONMENT: 'development' } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const mod = (db: DatabaseSync, slug: string, query = '', who = FOUNDER) => get(db, `/modules/${slug}?project=${P}${query}`, who);

let seq = 0;
function interview(db: DatabaseSync, o: Record<string, unknown> = {}) {
  seq += 1;
  const r = db.prepare(
    `INSERT INTO discovery_interviews (project_id, interviewee_name, interviewee_role, interviewee_company, interview_date,
       pains_json, icp_fit, quote_consent, stage, channel, recording_duration_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).get(P, o.name ?? `Person ${seq}`, o.role ?? null, o.company ?? null, o.date === undefined ? TODAY : o.date,
    JSON.stringify(o.pains ?? []), o.fit ?? null, o.consent ?? null, o.stage ?? null, o.channel ?? null, o.recording_sec ?? null) as any;
  return Number(r.id);
}
function session(db: DatabaseSync, interviewId: number, o: Record<string, unknown> = {}) {
  seq += 1;
  const r = db.prepare(
    `INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, submitted_via, processing_stage, active_ms)
     VALUES (?, ?, ?, ?, 'in_person', ?, ?, ?, ?) RETURNING id`,
  ).get(`session-${seq}`, interviewId, P, FOUNDER, o.status ?? 'draft', o.via ?? null, o.processing ?? null, o.active_ms ?? 0) as any;
  return Number(r.id);
}
function group(db: DatabaseSync, id: number, title: string, phrase: string) {
  db.prepare('INSERT INTO pain_groups (id, project_id, title) VALUES (?, ?, ?)').run(id, P, title);
  db.prepare('INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (?, ?, ?, ?)').run(P, id, phrase.toLowerCase(), phrase);
}
function claim(db: DatabaseSync, id: number, code: string, o: Record<string, unknown> = {}) {
  db.prepare('INSERT INTO hypotheses (id, project_id, code, claim, sort_order, retired_at, inconclusive_at, sprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, P, code, o.claim ?? `Claim ${code}`, id, o.retired_at ?? null, o.inconclusive_at ?? null, o.sprint ?? null);
}
/** SQLite's own `datetime('now')` shape. */
const at = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const daysAgoAt = (n: number) => at(Date.now() - n * 86_400_000);
function observe(db: DatabaseSync, hypothesisId: number, observedAt: string, lane: string, verdict: string | null = 'unproven') {
  db.prepare('INSERT INTO hypothesis_verdict_history (project_id, hypothesis_id, verdict, lane, observed_at) VALUES (?, ?, ?, ?, ?)')
    .run(P, hypothesisId, verdict, lane, observedAt);
}
const names = (rows: any[], key = 'interviewee') => rows.map((r) => r[key]);
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));

// ---------------------------------------------------------------------------
// The lists: titles, columns, filters and sorts
// ---------------------------------------------------------------------------

const LISTS: Record<string, { title: string; cols: string[]; filters: Array<[string, string, string[]]>; sorts: string[] }> = {
  'problem-discovery': {
    title: 'Pain themes', cols: ['Theme', 'Mentions', 'Severity', 'Trend', 'Supports'],
    filters: [['severity', 'Severity', ['severe', 'real', 'mild', 'not_recorded']], ['hypothesis', 'Hypothesis', ['linked', 'unlinked']],
      ['icp', 'ICP only', ['yes']], ['need', 'Need-to-have', ['yes']]],
    sorts: ['mentions', 'trend', 'theme', 'recent'],
  },
  'customer-research': {
    title: 'Interviews', cols: ['Interviewee', 'Company', 'Date', 'ICP fit', 'Consent', 'State'],
    filters: [['icp', 'ICP fit', ['strong', 'partial', 'none', 'not_recorded']], ['consent', 'Consent', ['agreed', 'declined', 'not_asked']],
      ['channel', 'Channel', ['in_person', 'video', 'phone', 'text']]],
    sorts: ['newest', 'oldest', 'name'],
  },
  'ideal-customer-profile': {
    title: 'Segments', cols: ['Segment', 'Interviews', 'Strong fit', 'Evidence', 'Updated'],
    filters: [['evidence', 'Evidence', ['anecdote', 'pattern', 'measured', 'not_recorded']], ['fit', 'Fit', ['strong', 'none']]],
    sorts: ['evidence'],
  },
  'market-intelligence': {
    title: 'Competitors tracked', cols: ['Company', 'Kind', 'Latest signal', 'Date', 'Source'],
    filters: [['kind', 'Kind', ['direct', 'adjacent']], ['signal', 'Signal', ['has', 'none']]],
    sorts: ['latest'],
  },
  'demand-signals': {
    title: 'Signals', cols: ['Signal', 'Who', 'Amount', 'Date', 'Counts'],
    filters: [['kind', 'Kind', ['loi', 'pre_sale', 'waitlist', 'need_to_have', 'would_pay']], ['period', 'Period', ['30', '90']]],
    sorts: ['newest'],
  },
  experiments: {
    title: 'Hypotheses', cols: ['Hypothesis', 'Status', 'Evidence', 'Sprint', 'Owner', 'Source'],
    filters: [['status', 'Status', ['untested', 'testing', 'supported', 'refuted', 'inconclusive', 'not_recorded', 'retired']],
      ['sprint', 'Sprint', ['Sprint 2', 'Sprint 3']], ['strength', 'Strength', ['anecdote', 'pattern', 'measured', 'not_recorded']],
      ['moved', 'Recently moved', ['recent']], ['history', 'History', ['last_week', 'this_month']]],
    sorts: ['updated', 'status', 'code'],
  },
};

test('D690 decision 10: each module read carries the canvas\'s title, columns, filters and sorts, default sort first', async () => {
  const db = fixture();
  claim(db, 1, 'H1', { sprint: 'Sprint 3' });
  claim(db, 2, 'H2', { sprint: 'Sprint 2' });
  claim(db, 3, 'H3', { sprint: 'Sprint 9', retired_at: '2026-01-01 00:00:00' });
  for (const [slug, want] of Object.entries(LISTS)) {
    const r = await mod(db, slug);
    assert.equal(r.status, 200, `${slug}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.module.records_title, want.title, slug);
    assert.deepEqual(r.body.records.cols, want.cols, slug);
    assert.deepEqual(r.body.records.filters.map((f: any) => [f.key, f.label, f.options.map((o: any) => o.value)]), want.filters, slug);
    assert.deepEqual(r.body.records.sorts.map((s: any) => s.key), want.sorts, slug);
    assert.equal(r.body.parts.can_write, true, `${slug}: the founder writes`);
  }
  const cr = await mod(db, 'customer-research');
  assert.equal(cr.body.records.filters[1].options[0].label, 'Agreed · deck-eligible', 'Deck-eligible is the Agreed option, not a second filter');
  const ex = await mod(db, 'experiments');
  assert.deepEqual(ex.body.records.filters[0].options.slice(-2).map((o: any) => o.label), ['Fit not recorded', 'Retired']);
  assert.deepEqual(ex.body.records.filters[4].options.map((o: any) => o.label), ['As of last week', 'Changed this month']);
});

// ---------------------------------------------------------------------------
// Customer research: each interview's state and the bottom section's fields
// ---------------------------------------------------------------------------

test('D690 decision 9: every state key, from the latest session by id or the stage; the first rule that matches wins', async () => {
  const db = fixture();
  const want: Record<string, string> = {};
  const add = (name: string, state: string, o: Record<string, unknown> = {}, sessions: Array<Record<string, unknown>> = []) => {
    const id = interview(db, { name, ...o });
    for (const s of sessions) session(db, id, s);
    want[name] = state;
    return id;
  };
  add('Ines Failed', 'failed', {}, [{ status: 'stopped', processing: 'failed' }]);
  add('Rhea Recording', 'recording', {}, [{ status: 'recording' }]);
  add('Pia Paused', 'recording', {}, [{ status: 'paused', processing: 'uploading' }]);
  add('Tomas Telegram', 'waiting_messages', {}, [{ status: 'draft', via: 'telegram' }]);
  add('Wren WhatsApp', 'waiting_messages', {}, [{ status: 'draft', via: 'whatsapp' }]);
  add('Zia Zoom', 'waiting_transcript', {}, [{ status: 'draft', via: 'zoom' }]);
  add('Gus Meet', 'waiting_transcript', {}, [{ status: 'draft', via: 'google_meet' }]);
  add('Pax Processing', 'processing', {}, [{ status: 'transcribed', processing: 'summarising' }]);
  add('Sol Stopped', 'processing', {}, [{ status: 'stopped' }]);
  add('Tad Transcribing', 'processing', {}, [{ status: 'transcribing' }]);
  add('Remy Ready', 'ready', {}, [{ status: 'transcribed', processing: 'done' }]);
  add('Sky Structured', 'ready', {}, [{ status: 'structured' }]);
  add('Rue Reviewed', 'reviewed', {}, [{ status: 'reviewed' }]);
  // The latest session by id decides: an older reviewed session does not.
  add('Lex Latest', 'recording', {}, [{ status: 'reviewed' }, { status: 'recording' }]);
  add('Lea Lead', 'lead', { stage: 'lead' });
  add('Ivo Invited', 'invited', { stage: 'invited' }, [{ status: 'draft' }]);
  add('Bea Booked', 'booked', { stage: 'booked' });
  add('Lou Logged', 'logged', { stage: 'done' });
  add('Old Logged', 'logged', { stage: null }, [{ status: 'draft', via: 'claude-assistant' }]);
  const r = await mod(db, 'customer-research');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const got = Object.fromEntries(r.body.records.rows.map((x: any) => [x.interviewee, x.state]));
  assert.deepEqual(got, want);
  assert.deepEqual(new Set(Object.values(got)), new Set(INTERVIEW_STATES), 'every key is reached');
});

test('D690: an interview row carries its role, pains, duration, state and session; the session only for a writer', async () => {
  const db = fixture();
  const a = interview(db, { name: 'Odile Ames', role: 'Ops lead', company: 'Tallow & Co', pains: ['Late invoices', 'Paper forms'], recording_sec: 600 });
  const sid = session(db, a, { status: 'reviewed', active_ms: 125_000 });
  interview(db, { name: 'Bram Cole', recording_sec: 600, date: ago(1) });
  interview(db, { name: 'Cy Dorn', date: ago(2) });
  const r = await mod(db, 'customer-research');
  const by = Object.fromEntries(r.body.records.rows.map((x: any) => [x.interviewee, x]));
  assert.deepEqual(pick(by['Odile Ames'], ['role', 'company', 'pains', 'duration_min', 'state', 'session_id']),
    { role: 'Ops lead', company: 'Tallow & Co', pains: 2, duration_min: 2, state: 'reviewed', session_id: sid });
  assert.equal(by['Bram Cole'].duration_min, 10, 'with no session, the recording\'s own duration');
  assert.equal(by['Cy Dorn'].duration_min, null, 'nothing recorded is null, not 0');
  assert.equal(by['Cy Dorn'].pains, 0);
  const partner = await mod(db, 'customer-research', '', PARTNER);
  const pa = partner.body.records.rows.find((x: any) => x.interviewee === 'Odile Ames');
  assert.equal(pa.state, 'reviewed', 'the state is everyone\'s');
  assert.equal(pa.session_id, null, 'the session is the writer\'s');
  assert.equal(partner.body.parts.can_write, false);
});

test('D690: the recruiting picker still reads id, interviewee, company and stage under stage:pipeline and booked first', async () => {
  const db = fixture();
  interview(db, { name: 'Held One', stage: 'done' });
  interview(db, { name: 'Lia Lead', company: 'Northbeam', stage: 'lead', date: ago(3) });
  interview(db, { name: 'Ike Invite', company: 'Northbeam', stage: 'invited', date: ago(4) });
  interview(db, { name: 'Bo Booking', company: 'Larkspur', stage: 'booked', date: ago(5) });
  const r = await mod(db, 'customer-research', '&filter=stage:pipeline&sort=booked');
  assert.deepEqual(names(r.body.records.rows), ['Bo Booking', 'Ike Invite', 'Lia Lead']);
  for (const row of r.body.records.rows) {
    for (const k of ['id', 'interviewee', 'company', 'stage']) assert.ok(k in row && row[k] != null, `${row.interviewee} keeps ${k}`);
  }
  assert.deepEqual(r.body.records.rows.map((x: any) => x.stage), ['booked', 'invited', 'lead']);
});

test('D690 decision 16: customer research\'s strip counts the whole log, whatever the page or filter', async () => {
  const db = fixture();
  for (let i = 0; i < 30; i += 1) {
    interview(db, { name: `Pat ${String(i).padStart(2, '0')}`, date: ago(i), pains: i < 12 ? [`pain ${i}`] : [],
      consent: i < 7 ? 1 : i < 10 ? 0 : null });
  }
  for (const q of ['', '&page=2', '&filter=consent:declined']) {
    const r = await mod(db, 'customer-research', q);
    assert.deepEqual(r.body.parts.stats, { logged: 30, with_pain: 12, consent_agreed: 7, consent_not_asked: 20 }, q || 'page 1');
  }
  assert.equal((await mod(db, 'customer-research')).body.records.rows.length, 25);
});

// ---------------------------------------------------------------------------
// Problem discovery: the view's counts, its filters and parts
// ---------------------------------------------------------------------------

test('D690: icp:yes and need:yes keep only themes above 0, and sort=recent orders by last mention, across pages', async () => {
  const db = fixture();
  const N = 56;
  for (let k = 0; k < N; k += 1) {
    group(db, 100 + k, `Theme ${String(k).padStart(2, '0')}`, `pain ${k}`);
    const id = interview(db, { pains: [`pain ${k}`], fit: k % 4 === 0 ? 'none' : 'strong', date: k === N - 1 ? '' : ago(k) });
    if (k % 2 === 0) db.prepare("INSERT INTO interview_pain_severities (interview_id, phrase_norm, severity) VALUES (?, ?, 'severe')").run(id, `pain ${k}`);
  }
  const all = async (query: string) => {
    const out: any[] = [];
    for (let page = 1; page <= 3; page += 1) out.push(...(await mod(db, 'problem-discovery', `${query}&page=${page}`)).body.records.rows);
    return out;
  };
  const icp = await mod(db, 'problem-discovery', '&filter=icp:yes');
  assert.equal(icp.body.records.total, 42, 'filtered before paging');
  const icpRows = await all('&filter=icp:yes');
  assert.equal(icpRows.length, 42);
  assert.ok(icpRows.every((t) => t.icp_count > 0));
  const need = await all('&filter=need:yes');
  assert.equal(need.length, 28);
  assert.ok(need.every((t) => t.need_count > 0));
  assert.equal((await mod(db, 'problem-discovery', '&filter=need:yes,icp:yes')).body.records.total, 14);
  const recent = await all('&sort=recent');
  assert.equal(recent.length, N);
  assert.deepEqual(recent.slice(0, 3).map((t) => t.theme), ['Theme 00', 'Theme 01', 'Theme 02']);
  assert.equal(recent[N - 1].theme, `Theme ${N - 1}`, 'a theme with no dated mention comes last');
  assert.equal(recent[N - 1].last_mention_at, null);
  const dated = recent.slice(0, N - 1).map((t) => t.last_mention_at);
  assert.deepEqual(dated, [...dated].sort().reverse(), 'newest first across the pages');
});

test('D690 decision 16: problem discovery\'s parts — whole-venture stats, Assign\'s themes for writers only, and the unthemed phrases', async () => {
  const db = fixture();
  for (let k = 0; k < 27; k += 1) group(db, 200 + k, `Group ${String(k).padStart(2, '0')}`, `grouped ${k}`);
  for (let k = 0; k < 27; k += 1) {
    const id = interview(db, { name: `Vera ${k}`, pains: [`grouped ${k}`], fit: k < 9 ? 'strong' : k < 12 ? 'none' : null, date: ago(k) });
    if (k < 5) db.prepare("INSERT INTO interview_pain_severities (interview_id, phrase_norm, severity) VALUES (?, ?, 'real')").run(id, `grouped ${k}`);
  }
  const quoted = interview(db, { name: 'Quinn Yes', pains: ['Loose phrase', 'grouped 0'], fit: 'strong', consent: 1, date: ago(1) });
  const unquoted = interview(db, { name: 'Nell No', pains: ['Loose phrase', 'Another loose one', 'another   loose one'], consent: 0, date: ago(2) });
  const r = await mod(db, 'problem-discovery');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.parts.stats, { themes: 27, interviews: 29, ungrouped: 2, need_themes: 5, icp_themes: 9, fit_unrecorded_themes: 15 });
  assert.equal(r.body.records.rows.length, 25, 'the table pages; the stats do not');
  assert.equal(r.body.parts.themes.length, 27);
  assert.deepEqual(r.body.parts.themes[0], { id: 200, title: 'Group 00' });
  assert.deepEqual(r.body.parts.unthemed, [
    { interview_id: quoted, interviewee: 'Quinn Yes', date: ago(1), phrase: 'Loose phrase' },
    { interview_id: unquoted, interviewee: 'Nell No', date: ago(2), phrase: 'Loose phrase' },
    { interview_id: unquoted, interviewee: 'Nell No', date: ago(2), phrase: 'Another loose one' },
  ], 'one row per interview and phrase in no group; two wordings of one phrase count once');
  assert.equal(r.body.parts.unthemed_total, 3);

  const partner = await mod(db, 'problem-discovery', '', PARTNER);
  assert.equal(partner.body.parts.can_write, false);
  assert.equal('themes' in partner.body.parts, false, 'Assign\'s list is absent, not empty, for a partner');
  assert.deepEqual(partner.body.parts.unthemed.map((u: any) => u.phrase), ['Loose phrase', QUOTE_WITHHELD, QUOTE_WITHHELD]);
  assert.deepEqual(partner.body.parts.stats, r.body.parts.stats);
  const loose = partner.body.records.rows.find((t: any) => t.theme === 'Another loose one');
  assert.deepEqual(loose.wordings, [QUOTE_WITHHELD], 'a wording said without consent is withheld from a non-writer');
  const quotedTheme = partner.body.records.rows.find((t: any) => t.theme === 'Loose phrase');
  assert.deepEqual(quotedTheme.wordings, ['Loose phrase']);
  const admin = await mod(db, 'problem-discovery', '', ADMIN);
  assert.equal(admin.body.parts.themes.length, 27, 'an admin writes');
});

test('D690: need_themes and icp_themes are null on a venture with no severity and no fit recorded', async () => {
  const db = fixture();
  group(db, 300, 'Dispatch', 'slow dispatch');
  interview(db, { pains: ['slow dispatch'] });
  const r = await mod(db, 'problem-discovery');
  assert.equal(r.body.parts.stats.need_themes, null);
  assert.equal(r.body.parts.stats.icp_themes, null);
  assert.equal(r.body.parts.stats.themes, 1);
});

// ---------------------------------------------------------------------------
// Experiments: retired claims, links, fit gap, stats and FVW's views
// ---------------------------------------------------------------------------

test('D690: retired claims appear only under status:retired; the MCP context keeps its keys and carries none', async () => {
  const db = fixture();
  group(db, 400, 'Dispatch', 'slow dispatch');
  claim(db, 1, 'H1', { claim: 'Fleets pay for dispatch' });
  claim(db, 2, 'H2', { claim: 'Retired claim', retired_at: '2026-09-01 10:00:00' });
  db.exec("INSERT INTO hypothesis_pain_links (id, hypothesis_id, pain_group_id, direction, strength) VALUES (7, 1, 400, 'supports', 'pattern'), (8, 2, 400, 'supports', null)");
  for (let i = 0; i < 2; i += 1) interview(db, { pains: ['slow dispatch'], fit: 'strong' });
  interview(db, { pains: ['slow dispatch'] });
  let r = await mod(db, 'experiments');
  assert.deepEqual(r.body.records.rows.map((x: any) => x.id), [1]);
  assert.equal('retired' in r.body.records.rows[0], false);
  assert.deepEqual(r.body.records.rows[0].links, [{ id: 7, kind: 'pain', pain_group_id: 400, theme: 'Dispatch', direction: 'supports', strength: 'pattern' }]);
  assert.deepEqual(r.body.parts.fit_gap, [{ id: 1, code: 'H1', supporting: 2, bar: 5, fit_unrecorded: 1 }]);
  r = await mod(db, 'experiments', '&filter=status:retired');
  assert.deepEqual(r.body.records.rows.map((x: any) => [x.id, x.retired]), [[2, true]]);
  assert.equal(r.body.parts.stats.hypotheses, 1, 'the counts are the open claims');
  const ctx = await validateContext({ DB: d1Over(db) } as any, P);
  assert.deepEqual(Object.keys(ctx), ['hypotheses', 'pain_themes', 'icp_segments', 'open_questions', 'interviews']);
  assert.deepEqual(ctx.hypotheses.map((h: any) => h.hypothesis), ['H1 · Fleets pay for dispatch']);
  assert.deepEqual(Object.keys(ctx.hypotheses[0]), ['hypothesis', 'status', 'evidence_links', 'strength']);
  assert.equal('parts' in ctx, false);
});

test('D690 decision 16: experiments\' stats count the whole venture, with more than 25 claims', async () => {
  const db = fixture();
  group(db, 500, 'Dispatch', 'slow dispatch');
  group(db, 501, 'Billing', 'billing errors');
  for (let i = 0; i < 5; i += 1) interview(db, { pains: ['slow dispatch'], fit: 'strong' });
  interview(db, { pains: ['billing errors'] });
  interview(db, { pains: [] });
  // 3 supported (dispatch at the bar), 4 withheld (billing, a fit unrecorded), 20 untested.
  for (let i = 1; i <= 27; i += 1) claim(db, i, `H${i}`);
  for (let i = 1; i <= 3; i += 1) db.prepare("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (?, 500, 'supports')").run(i);
  for (let i = 4; i <= 7; i += 1) db.prepare("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (?, 501, 'supports')").run(i);
  claim(db, 99, 'H99', { retired_at: '2026-09-01 10:00:00' });
  for (const q of ['', '&page=2', '&filter=status:untested']) {
    const r = await mod(db, 'experiments', q);
    // D704 decision 7: the read records each live claim, so the venture's history starts with its first read.
    const { history_since: since, ...stats } = r.body.parts.stats;
    assert.deepEqual(stats, {
      hypotheses: 27, supported: 3, refuted: 0, awaiting: 20, withheld: 4, fit_not_recorded: 2, bar: 5,
    }, q || 'page 1');
    assert.match(String(since), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'the first read wrote the first observations');
    assert.equal(r.body.parts.fit_gap.length, 24, 'every open claim, not the page');
  }
});

test('D690 decision 16: Recently moved is a lane change within 14 days; the first observation never is', async () => {
  const db = fixture();
  claim(db, 1, 'H1'); claim(db, 2, 'H2'); claim(db, 3, 'H3');
  // Each claim's last observation is what the read computes today (no evidence: unproven, lane none), so
  // the read's own write (D704 decision 7) adds no row.
  const first = daysAgoAt(20);
  observe(db, 1, first, 'testing'); observe(db, 1, daysAgoAt(13), 'none');
  observe(db, 2, daysAgoAt(20), 'testing'); observe(db, 2, daysAgoAt(15), 'none');
  observe(db, 3, daysAgoAt(1), 'none');
  const r = await mod(db, 'experiments', '&sort=code');
  assert.deepEqual(r.body.records.rows.map((x: any) => [x.id, x.moved]), [[1, 'recent'], [2, null], [3, null]], 'every row says, whatever the filter');
  const m = await mod(db, 'experiments', '&filter=moved:recent');
  assert.deepEqual(m.body.records.rows.map((x: any) => x.id), [1]);
  assert.equal(m.body.records.total, 1);
  assert.equal(m.body.parts.stats.history_since, first, 'the venture\'s first observation');
});

test('D690 decision 16: As of last week shows each claim\'s status seven days ago, and Inconclusive only when it was marked by then', async () => {
  const db = fixture();
  claim(db, 1, 'H1');
  claim(db, 2, 'H2');
  claim(db, 3, 'H3', { inconclusive_at: daysAgoAt(2) });
  claim(db, 4, 'H4', { inconclusive_at: daysAgoAt(9) });
  claim(db, 5, 'H5');
  observe(db, 1, daysAgoAt(10), 'testing'); observe(db, 1, daysAgoAt(2), 'validated', 'validated');
  observe(db, 2, daysAgoAt(3), 'testing');
  observe(db, 3, daysAgoAt(10), 'testing');
  observe(db, 4, daysAgoAt(10), 'testing');
  observe(db, 5, daysAgoAt(30), 'invalidated', 'invalidated');
  const r = await mod(db, 'experiments', '&filter=history:last_week&sort=code');
  assert.deepEqual(r.body.records.rows.map((x: any) => [x.id, x.status]),
    [[1, 'testing'], [3, 'testing'], [4, 'inconclusive'], [5, 'refuted']],
    'H2 is first observed three days ago, so it is left out, never shown at today\'s status');
  const supported = await mod(db, 'experiments', '&filter=history:last_week,status:testing&sort=code');
  assert.deepEqual(supported.body.records.rows.map((x: any) => x.id), [1, 3], 'the status filter reads the status then');
});

test('D690 decision 16: Changed this month keeps a verdict change on the first of the month and drops one the day before', async () => {
  const db = fixture();
  const now = new Date();
  const first = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  claim(db, 1, 'H1'); claim(db, 2, 'H2'); claim(db, 3, 'H3'); claim(db, 4, 'H4');
  // Each claim ends on what the read computes today (no evidence: unproven, lane none), so the read's
  // own write (D704 decision 7) adds no row.
  observe(db, 1, at(first - 5 * 86_400_000), 'validated', 'validated'); observe(db, 1, at(first), 'none');
  observe(db, 2, at(first - 5 * 86_400_000), 'validated', 'validated'); observe(db, 2, at(first - 1000), 'none');
  // A lane change with no verdict change is not a verdict change.
  observe(db, 3, at(first - 5 * 86_400_000), 'testing'); observe(db, 3, at(first + 1000), 'none');
  // A first observation this month is the claim appearing, not changing.
  observe(db, 4, at(first + 1000), 'none');
  const r = await mod(db, 'experiments', '&filter=history:this_month');
  assert.deepEqual(r.body.records.rows.map((x: any) => x.id), [1]);
  assert.equal(r.body.records.rows[0].status, 'untested', 'rows show today\'s status');
  assert.equal(r.body.parts.stats.history_since, at(first - 5 * 86_400_000));
});
