/**
 * D691 (S19-A, #1698), tests 6, 7 and 9 — Grow's seven records on D690's
 * contract, their actions, and the feedback-theme fill. Test 8, the daily
 * step, is `grow_daily_d691.test.ts`.
 *
 *   6  Records: the canvas shape of all seven reads, Not recorded where no
 *      store holds a value, decision 9's gates, a foreign id a 404 everywhere,
 *      Edit's current values, Open minutes' prefix, and the activity of
 *      today's Grow writes read on their records through `activityFor`'s
 *      older shapes (`ownedRow`'s Grow stores came with #1758).
 *   7  Actions: Mark held, Mark told, and each section action's row.
 *   9  The fill: only the venture's own themes, for its own unthemed rows,
 *      written as `PATCH /feedback/:uid` writes a theme.
 *
 * THE DATABASE IS THE BASELINE PLUS EVERY NUMBERED MIGRATION ABOVE THE CUTOFF,
 * IN ORDER, with foreign keys on, as D1 runs them. Every name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cycle_records_grow_d691.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { ownedRow } from '../src/services/records/owned.ts';
import { activityFor } from '../src/services/cycleActivity.ts';
import { GROW_OLD_ROWS } from '../src/services/records/grow.ts';
import type { Store } from '../src/services/records/types.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { fillKind } from '../src/services/fills/registry.ts';
import { markFeedbackTold, updateFeedback } from '../src/services/growWriters.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
// Assembled at run time, as cycle_activity_d690 does, so no literal reads as a credential.
const JWT_SECRET = ['fixture', 'key', 'for', 'd691', 'grow', 'records'].join('-');

/** People, each with the role the record gate must weigh. Founder ids equal user ids. */
const FOUNDER = 10, OTHER_FOUNDER = 20, COFOUNDER = 11, ADVISOR = 12, PARTNER = 40, ADMIN = 30, INVESTOR = 50;
const A = 1, B = 2;
const PEOPLE: Array<[number, string, string, number | null]> = [
  [FOUNDER, 'founder', 'Ana Wren', FOUNDER], [OTHER_FOUNDER, 'founder', 'Ola Kestrel', OTHER_FOUNDER],
  [COFOUNDER, 'founder', 'Cai Moreno', COFOUNDER], [ADVISOR, 'founder', 'Dee Advisor', ADVISOR],
  [PARTNER, 'partner', 'Pat Partner', null], [ADMIN, 'admin', 'Ada Admin', null], [INVESTOR, 'investor', 'Ivo Investor', null],
];
const MONTH = new Date().toISOString().slice(0, 7);
const TODAY = new Date().toISOString().slice(0, 10);

/** The baseline and every later migration, built once into a file each test copies (seeds included). */
const BUILT = join(mkdtempSync(join(tmpdir(), 'grow-d691-')), 'built.db');
function fresh(): DatabaseSync {
  if (!existsSync(BUILT)) {
    const db = new DatabaseSync(BUILT, { enableDoubleQuotedStringLiterals: true });
    db.exec(BASELINE);
    for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
    db.close();
  }
  const copy = join(mkdtempSync(join(tmpdir(), 'grow-d691-')), 'test.db');
  copyFileSync(BUILT, copy);
  const db = new DatabaseSync(copy, { enableDoubleQuotedStringLiterals: true });
  db.exec('PRAGMA foreign_keys = ON');
  for (const [id, role, name, founder] of PEOPLE) {
    if (founder != null) db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(founder, name, `f${id}@example.test`);
    db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, role, name, `u${id}@example.test`, founder);
  }
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}), (${B}, 'Kestrel Mill', ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${A}, ${COFOUNDER}, 'cofounder', 'accepted'), (${A}, ${ADVISOR}, 'advisor', 'accepted')`);
  return db;
}

/** One row in each store per venture. B's uids extend A's, so a prefix match must stop at the colon. */
function fixture() {
  const db = fresh();
  db.exec(`INSERT INTO product_feedback (uid, project_id, body, source, from_name, from_email, from_company, theme, status, notify_on_ship, created_by, created_at) VALUES
    ('fba1', ${A}, 'Exports are slow', 'customer', 'Rui Tomas', 'rui@example.test', 'Harbour Mill', 'Speed', 'shipped', 1, ${FOUNDER}, '2026-09-01 09:00:00'),
    ('fba2', ${A}, 'Reports time out', 'customer', NULL, NULL, NULL, 'Speed', 'open', 0, ${FOUNDER}, '2026-09-02 09:00:00'),
    ('fba3', ${A}, 'The export takes minutes', 'team', NULL, NULL, NULL, NULL, 'open', 0, ${FOUNDER}, '2026-09-03 09:00:00'),
    ('fba12', ${B}, 'Needs a dark mode', 'customer', NULL, NULL, NULL, NULL, 'open', 0, ${OTHER_FOUNDER}, '2026-09-01 09:00:00')`);
  db.exec(`INSERT INTO revenue_entries (uid, project_id, customer, amount_cents, revenue_type, received_on) VALUES ('rv1', ${A}, 'Harbour Mill', 90000, 'recurring', '${TODAY}')`);
  db.exec(`INSERT INTO growth_channels (id, uid, project_id, name, utm_source, kind, cac_bar_cents, bar_currency, created_by) VALUES
    (1, 'cha1', ${A}, 'Newsletter', 'newsletter', 'content', 20000, 'usd', ${FOUNDER}), (2, 'cha12', ${B}, 'Podcast', 'podcast', NULL, NULL, NULL, ${OTHER_FOUNDER}),
    (3, 'chb1', ${A}, 'Search', 'search', NULL, NULL, NULL, ${FOUNDER})`);
  db.exec(`INSERT INTO channel_spend (channel_id, month, spend_cents) VALUES (1, '${MONTH}', 50000)`);
  db.exec(`INSERT INTO contacts (uid, project_id, audience, name, email, utm_json, created_at) VALUES
    ('ct1', ${A}, 'customer', 'Ines Reyes', 'ines@example.test', '{"utm_source":"newsletter"}', datetime('now'))`);
  db.exec(`INSERT INTO job_postings (id, slug, host_user_id, project_id, title, team, status) VALUES
    (31, 'lantern-engineer', ${FOUNDER}, ${A}, 'Engineer', 'Engineering', 'draft'), (32, 'mill-designer', ${OTHER_FOUNDER}, ${B}, 'Designer', NULL, 'draft'),
    (33, 'lantern-analyst', ${COFOUNDER}, ${A}, 'Analyst', NULL, 'published')`);
  db.exec(`INSERT INTO job_applications (id, posting_id, name, email, stage) VALUES
    (41, 31, 'Lena Park', 'lena@example.test', 'interview'), (42, 33, 'Omar Diaz', 'omar@example.test', 'applied'),
    (43, 31, 'Sol Ito', 'sol@example.test', 'offer')`);
  db.exec(`INSERT INTO growth_partners (id, uid, project_id, name, type, stage, terms_kind, terms_pct, contact_name, created_by) VALUES
    (1, 'pta1', ${A}, 'Lantern Resellers', 'reseller', 'signed', 'rev_share', 20, 'Pia Lund', ${FOUNDER}),
    (2, 'pta12', ${B}, 'Mill Agency', 'agency', 'talking', NULL, NULL, NULL, ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO markets (id, uid, project_id, name, demand_score, demand_source, created_by) VALUES
    (1, 'mka1', ${A}, 'Portugal', 7, 'Interviews', ${FOUNDER}), (2, 'mka12', ${B}, 'Chile', NULL, NULL, ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO compliance_events (id, project_id, jurisdiction, event_type, title, due_date, kind, recurrence, remind_days_json, reminders_sent_json, created_by_user_id) VALUES
    (51, ${A}, 'Unspecified', 'board_meeting', 'Board meeting', '2026-11-30', 'governance', 'quarterly', '[14]', '[14]', ${FOUNDER}),
    (52, ${B}, 'Unspecified', 'annual_report', 'Annual report', '2026-12-01', NULL, 'annual', NULL, '[]', ${OTHER_FOUNDER}),
    (53, ${A}, 'Unspecified', 'other', 'Insurance renewal', '2026-12-15', 'compliance', 'one_time', NULL, '[]', ${FOUNDER})`);
  db.exec(`INSERT INTO obligation_occurrences (id, uid, event_id, held_on, minutes_file_key) VALUES
    (61, 'oc61', 51, '2026-08-30', 'grow-minutes/1/aaa.pdf'), (62, 'oc62', 52, '2026-06-01', 'grow-minutes/2/bbb.pdf'),
    (63, 'oc63', 51, '2026-05-30', 'elsewhere/ccc.pdf')`);
  db.exec(`INSERT INTO custom_kpis (id, uid, project_id, label, unit) VALUES (1, 'kpa1', ${A}, 'NPS', 'count'), (2, 'kpb1', ${B}, 'Logos', 'count')`);
  return db;
}

const envOf = (db: DatabaseSync, extra: Record<string, unknown> = {}) =>
  ({ DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', ...extra }) as any;

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, method: string, path: string, { who = FOUNDER, body, form, env }: { who?: number; body?: unknown; form?: FormData; env?: Record<string, unknown> } = {}) {
  const role = PEOPLE.find(([id]) => id === who)?.[1] ?? 'founder';
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) }, envOf(db, env)));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const rec = (db: DatabaseSync, slug: string, id: string | number, opts: { who?: number; project?: number; tail?: string } = {}) =>
  call(db, 'GET', `/api/cycles/grow/modules/${slug}/records/${encodeURIComponent(String(id))}${opts.tail ?? ''}?project=${opts.project ?? A}`, { who: opts.who });
const act = (db: DatabaseSync, slug: string, id: string | number, key: string, body: unknown = {}, opts: { who?: number; project?: number; form?: FormData; env?: Record<string, unknown> } = {}) =>
  call(db, 'POST', `/api/cycles/grow/modules/${slug}/records/${encodeURIComponent(String(id))}/actions/${key}?project=${opts.project ?? A}`,
    { who: opts.who, body: opts.form ? undefined : body, form: opts.form, env: opts.env });
const patch = (db: DatabaseSync, slug: string, id: string | number, body: unknown, opts: { who?: number; project?: number } = {}) =>
  call(db, 'PATCH', `/api/cycles/grow/modules/${slug}/records/${encodeURIComponent(String(id))}?project=${opts.project ?? A}`, { who: opts.who, body });

const titles = (sections: any[]) => sections.map((s) => s.title);
const sectionOf = (r: any, key: string) => [...r.body.main, ...r.body.side].find((s: any) => s.key === key);
const actionKeys = (r: any) => r.body.actions.map((a: any) => a.key);

// ---------------------------------------------------------------------------
// Test 6: records
// ---------------------------------------------------------------------------

/** CO:382-388: each record's facts, and its main and side section titles. */
const CANVAS: Array<[string, string, string[], string[], string[]]> = [
  ['product-improvement', 'fba1', ['Source', 'Theme', 'Roadmap item', 'Status'], ['Theme', 'Closing the loop'], ['Customer']],
  ['distribution', 'cha1', ['Spend · 30 d', 'Customers', 'CAC', 'Bar'], ['Funnel', 'Experiments'], ['Customers acquired']],
  ['revenue-and-traction', 'mrr', ['Value', 'Change · 30 d', 'Source', 'As of'], ['History', 'Split'], ['Alerts', 'Shared']],
  ['team-expansion', '31', ['Team', 'Applicants', 'In interview', 'Target start'], ['Pipeline', 'Shortlist'], ['Compensation', 'Posted on']],
  ['partner-network', 'pta1', ['Type', 'Stage', 'Terms', 'Revenue sourced'], ['Deals sourced', 'Terms'], ['Contact', 'Introductions']],
  ['market-expansion', 'mka1', ['Demand evidence', 'Regulation', 'Partners', 'Cost to enter'], ['Entry plan', 'Localisation'], ['Attached', 'Sizing']],
  ['durable-company-building', '51', ['Kind', 'Due', 'Owner', 'Repeats'], ['Agenda', 'Past meetings'], ['Reminders', 'Documents']],
];

test('6: each of the seven reads is in the canvas shape', async () => {
  const db = fixture();
  for (const [slug, id, facts, main, side] of CANVAS) {
    const r = await rec(db, slug, id);
    assert.equal(r.status, 200, `${slug} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.cycle, 'grow');
    assert.ok(r.body.title && typeof r.body.sub === 'string' && r.body.pills.length >= 1, `${slug} title, sub and pills`);
    assert.deepEqual(r.body.facts.map((f: any) => f.label), facts, `${slug} facts`);
    assert.deepEqual(titles(r.body.main), main, `${slug} main`);
    assert.deepEqual(titles(r.body.side), side, `${slug} side`);
    for (const f of r.body.facts) assert.ok(f.value != null || typeof f.reason === 'string', `${slug} ${f.label} is a value or a reason`);
  }
  const fb = await rec(db, 'product-improvement', 'fba1');
  assert.equal(fb.body.title, '"Exports are slow"');
  assert.equal(fb.body.sub, 'Customer · Rui Tomas · 1 Sep');
  assert.deepEqual(sectionOf(fb, 'theme').rows[0], { a: 'Speed', b: '2 items', c: 'Planned', tone: 'vio' });
  assert.deepEqual(sectionOf(fb, 'customer').rows.map((r: any) => [r.a, r.b]), [['Rui Tomas · Harbour Mill', 'Customers →'], ['Plan', 'Paid']]);
  assert.equal(sectionOf(fb, 'closing-the-loop').rows[0].c, 'Due');
  const partner = await rec(db, 'partner-network', 'pta1');
  assert.equal(partner.body.facts[2].value, 'Rev-share 20%');
  const market = await rec(db, 'market-expansion', 'mka1');
  assert.deepEqual(market.body.facts[0], { label: 'Demand evidence', value: '7 / 10 · Interviews' });
  assert.deepEqual(market.body.facts[1], { label: 'Regulation', value: null, reason: 'No source yet' });
  const role = await rec(db, 'team-expansion', 31);
  assert.deepEqual(role.body.facts.slice(1, 3).map((f: any) => f.value), [2, 1]);
  const ob = await rec(db, 'durable-company-building', 51);
  assert.deepEqual(ob.body.pills.map((p: any) => p.text), ['Scheduled', 'Quarterly']);
  assert.deepEqual(sectionOf(ob, 'reminders').rows[0], { a: '14 days before', c: 'Sent', tone: 'grey' });
  assert.deepEqual(sectionOf(ob, 'documents').rows.map((r: any) => [r.a, r.c ?? null]), [['Minutes', null], ['Resolutions', 'Not recorded']]);
  // A custom KPI is a record too; another venture's is not.
  assert.equal((await rec(db, 'revenue-and-traction', 'custom-kpa1')).body.title, 'NPS');
  assert.equal((await rec(db, 'revenue-and-traction', 'custom-kpb1')).status, 404);
  assert.equal((await rec(db, 'revenue-and-traction', 'arr')).status, 404);
});

test('6: Visits and Shared are Not recorded, with the reason', async () => {
  const db = fixture();
  const ch = await rec(db, 'distribution', 'cha1');
  assert.deepEqual(sectionOf(ch, 'funnel').rows[0], { a: 'Visits', b: 'No page-visit store', c: 'Not recorded', tone: 'grey' });
  assert.equal(sectionOf(ch, 'funnel').rows[2].c, '1');
  const kpi = await rec(db, 'revenue-and-traction', 'mrr');
  assert.deepEqual(sectionOf(kpi, 'shared').rows[0], { a: 'Metrics page', b: 'There is no public metrics page', c: 'Not recorded', tone: 'grey' });
  // No MRR is recorded, so the facts say so instead of a 0.
  assert.equal(kpi.body.facts[0].value, null);
  assert.match(kpi.body.facts[0].reason, /Not recorded|not recorded/i);
});

test('6: decision 9 — names for writers and the posting\'s host, counts for the rest', async () => {
  const db = fixture();
  const shortlist = async (who: number) => sectionOf(await rec(db, 'team-expansion', 31, { who }), 'shortlist').rows.map((r: any) => r.a);
  assert.deepEqual(await shortlist(FOUNDER), ['Sol Ito', 'Lena Park']);
  assert.deepEqual(await shortlist(ADMIN), ['Sol Ito', 'Lena Park']);
  for (const who of [COFOUNDER, ADVISOR, PARTNER]) {
    const rows = await shortlist(who);
    assert.deepEqual(rows, ['1 at interview · 1 at offer'], `user ${who} sees counts`);
  }
  // An advisor reads, without a third party's name, and with no action.
  const adv = await rec(db, 'product-improvement', 'fba1', { who: ADVISOR });
  assert.equal(adv.status, 200);
  assert.equal(sectionOf(adv, 'customer'), undefined);
  assert.equal(sectionOf(adv, 'closing-the-loop'), undefined);
  assert.equal(adv.body.sub, 'Customer · 1 Sep');
  assert.deepEqual(adv.body.actions, []);
  assert.equal(JSON.stringify(adv.body).includes('Rui Tomas'), false);
  const advPartner = await rec(db, 'partner-network', 'pta1', { who: ADVISOR });
  assert.equal(sectionOf(advPartner, 'contact'), undefined);
  assert.equal(JSON.stringify(advPartner.body).includes('Pia Lund'), false);
  const advChannel = await rec(db, 'distribution', 'cha1', { who: ADVISOR });
  assert.deepEqual(sectionOf(advChannel, 'customers-acquired').rows, [{ a: '1 customer', b: 'this month' }]);
  assert.deepEqual(sectionOf(await rec(db, 'distribution', 'cha1'), 'customers-acquired').rows, [{ a: 'Ines Reyes', b: 'this month' }]);
  assert.equal((await act(db, 'product-improvement', 'fba3', 'change-theme', { theme: 'Speed' }, { who: ADVISOR })).status, 403);
  // Close role and Edit's publish: the posting's host and an admin only (decision 6).
  for (const who of [FOUNDER, ADMIN]) {
    const r = await rec(db, 'team-expansion', 31, { who });
    assert.ok(actionKeys(r).includes('close-role'), `user ${who} may close`);
    assert.ok(r.body.actions.find((a: any) => a.key === 'edit').form.fields.some((f: any) => f.key === 'publish'), `user ${who} may publish`);
    assert.equal(sectionOf(r, 'posted-on').rows[0].href, '/jobs/31/manage');
  }
  const co = await rec(db, 'team-expansion', 31, { who: COFOUNDER });
  assert.equal(actionKeys(co).includes('close-role'), false);
  assert.equal(co.body.actions.find((a: any) => a.key === 'edit').form.fields.some((f: any) => f.key === 'publish'), false);
  assert.equal(sectionOf(co, 'posted-on').rows[0].href, undefined);
  // On the posting the co-founder hosts, they are the host.
  assert.ok(actionKeys(await rec(db, 'team-expansion', 33, { who: COFOUNDER })).includes('close-role'));
  // A partner is a writer (projectAccess): names and actions.
  const pt = await rec(db, 'product-improvement', 'fba1', { who: PARTNER });
  assert.ok(sectionOf(pt, 'customer'));
  assert.ok(actionKeys(pt).includes('edit'));
});

test('6: a foreign id is a 404 everywhere; an investor is a 403; an undeclared key is refused', async () => {
  const db = fixture();
  const foreign: Array<[string, string, string]> = [
    ['product-improvement', 'fba12', 'change-theme'], ['distribution', 'cha12', 'pause'], ['revenue-and-traction', 'custom-kpb1', 'set-alert'],
    ['team-expansion', '32', 'close-role'], ['partner-network', 'pta12', 'add-deal'], ['market-expansion', 'mka12', 'add-entry-step'],
    ['durable-company-building', '52', 'mark-held'],
  ];
  for (const [slug, id, key] of foreign) {
    assert.equal((await rec(db, slug, id)).status, 404, `${slug} read`);
    assert.equal((await rec(db, slug, id, { tail: '/activity' })).status, 404, `${slug} activity`);
    assert.equal((await act(db, slug, id, key, {})).status, 404, `${slug} ${key}`);
    assert.equal((await patch(db, slug, id, { title: 'x' })).status, 404, `${slug} PATCH`);
    // And with ?project= set to the id's own venture, its own founder reads it.
    assert.equal((await rec(db, slug, id, { project: B, who: OTHER_FOUNDER })).status, 200, `${slug} in its own venture`);
  }
  for (const [slug, id] of CANVAS.map(([s, i]) => [s, i])) {
    assert.equal((await rec(db, slug, id)).status, 200, `${slug} own`);
    assert.equal((await rec(db, slug, id, { who: INVESTOR })).status, 403, `${slug} investor`);
    assert.equal((await rec(db, slug, id, { who: OTHER_FOUNDER })).status, 403, `${slug} another venture's founder`);
  }
  // Venture B's occurrence, named on venture A's obligation, is a 404.
  assert.equal((await act(db, 'durable-company-building', 51, 'open-minutes', { occurrence: 62 })).status, 404);
  assert.equal((await act(db, 'distribution', 'cha1', 'delete-everything', {})).status, 404);
  // A malformed id never reaches a store.
  assert.equal((await rec(db, 'team-expansion', 'Engineer')).status, 404);
});

test('6: Edit carries the PATCH\'s fields with their current values', async () => {
  const db = fixture();
  const edit = (r: any) => Object.fromEntries(r.body.actions.find((a: any) => a.key === 'edit').form.fields.map((f: any) => [f.key, f.value]));
  const fb = edit(await rec(db, 'product-improvement', 'fba1'));
  assert.deepEqual(Object.keys(fb), ['body', 'source', 'from_name', 'from_email', 'from_company', 'theme', 'roadmap_item_ref', 'status', 'notify_on_ship']);
  assert.equal(fb.body, 'Exports are slow'); assert.equal(fb.theme, 'Speed'); assert.deepEqual(fb.notify_on_ship, ['1']);
  const ch = edit(await rec(db, 'distribution', 'cha1'));
  assert.equal(ch.name, 'Newsletter'); assert.equal(ch.cac_bar_cents, 20000); assert.equal(ch.spend_cents, 50000);
  const role = edit(await rec(db, 'team-expansion', 31));
  assert.equal(role.title, 'Engineer'); assert.equal(role.team, 'Engineering'); assert.equal(role.type, 'full_time');
  const pt = edit(await rec(db, 'partner-network', 'pta1'));
  assert.equal(pt.terms_kind, 'rev_share'); assert.equal(pt.terms_pct, 20); assert.equal(pt.contact_name, 'Pia Lund');
  const mk = edit(await rec(db, 'market-expansion', 'mka1'));
  assert.equal(mk.demand_score, 7); assert.equal(mk.demand_source, 'Interviews');
  const ob = edit(await rec(db, 'durable-company-building', 51));
  assert.equal(ob.title, 'Board meeting'); assert.equal(ob.due_at, '2026-11-30'); assert.equal(ob.repeats, 'quarterly'); assert.deepEqual(ob.remind_days, ['14']);
  // And Edit writes what the PATCH writes.
  assert.equal((await patch(db, 'partner-network', 'pta1', { stage: 'terms', name: 'Lantern Resellers EU', ignored: 'x' })).status, 200);
  assert.deepEqual({ ...db.prepare("SELECT name, stage FROM growth_partners WHERE uid = 'pta1'").get() as any }, { name: 'Lantern Resellers EU', stage: 'terms' });
  // A non-host's publish is refused, as the role PATCH refuses it, and writes nothing.
  const refused = await patch(db, 'team-expansion', 31, { title: 'Senior engineer', publish: ['1'] }, { who: COFOUNDER });
  assert.equal(refused.status, 403);
  assert.equal((db.prepare('SELECT title, status FROM job_postings WHERE id = 31').get() as any).title, 'Engineer');
});

test('6: Open minutes refuses a key outside this venture\'s prefix and opens one inside it', async () => {
  const db = fixture();
  const kv = new Map<string, string>();
  const env = { TOKENS: { put: async (k: string, v: string) => { kv.set(k, v); } } };
  const ok = await act(db, 'durable-company-building', 51, 'open-minutes', { occurrence: 61 }, { env });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.open.url, /^\/api\/files\/dl\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal((await act(db, 'durable-company-building', 51, 'open-minutes', { occurrence: 63 }, { env })).status, 404);
  // An occurrence of another of the venture's obligations is not this one's.
  db.exec("INSERT INTO obligation_occurrences (id, uid, event_id, held_on, minutes_file_key) VALUES (64, 'oc64', 53, '2026-07-01', 'grow-minutes/1/ddd.pdf')");
  assert.equal((await act(db, 'durable-company-building', 51, 'open-minutes', { occurrence: 64 }, { env })).status, 404);
  // Advisors read the record; opening minutes is a write-side action.
  assert.equal((await act(db, 'durable-company-building', 51, 'open-minutes', { occurrence: 61 }, { who: ADVISOR, env })).status, 403);
});

test('6: Grow\'s module read sends records.linkable', async () => {
  const db = fixture();
  const r = await call(db, 'GET', `/api/cycles/grow/modules/product-improvement?project=${A}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.records.linkable, true);
});

// ── 6: older activity (#1758's cases, now through the specs' own matchers) ──

/** Today's `logWrite`: a table name, an id, a grow_* action, and no project. */
function legacy(db: DatabaseSync, action: string, entity: string, entityId: string, at = '2026-09-02 10:00:00') {
  db.prepare('INSERT INTO activity_logs (action, details, user_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(action, `grow:${entity}`, FOUNDER, entity, entityId, at);
}
const read = (env: any, module: string, store: Store, id: string, projectId = A) =>
  activityFor(env, { projectId, entityType: `grow.${module}`, entityId: id, oldRows: GROW_OLD_ROWS[module], store });

test('6: ownedRow resolves each Grow store within the venture and refuses another venture\'s ids', async () => {
  const db = fixture(); const env = envOf(db);
  const cases: Array<[Store, string, string]> = [
    ['product_feedback', 'fba1', 'fba12'], ['growth_channels', 'cha1', 'cha12'], ['growth_partners', 'pta1', 'pta12'],
    ['markets', 'mka1', 'mka12'], ['job_postings', '31', '32'], ['compliance_events', '51', '52'],
    ['grow_kpis', 'custom-kpa1', 'custom-kpb1'], ['obligation_occurrences', '61', '62'],
  ];
  for (const [store, own, foreign] of cases) {
    assert.equal(await ownedRow(env, store, own, A), true, `${store} ${own} is venture A's`);
    assert.equal(await ownedRow(env, store, foreign, A), false, `${store} ${foreign} is venture B's`);
    assert.equal(await ownedRow(env, store, own, B), false, `${store} ${own} with ?project=B`);
    assert.equal(await ownedRow(env, store, foreign, B), true, `${store} ${foreign} with ?project=B`);
  }
  assert.equal(await ownedRow(env, 'grow_kpis', 'paying_accounts', A), true);
  assert.equal(await ownedRow(env, 'grow_kpis', 'custom-', A), false);
  for (const bad of ['031', '31abc', '0', 'cha1']) assert.equal(await ownedRow(env, 'job_postings', bad, A), false, bad);
  assert.equal(await ownedRow(env, 'product_feedback', 'cha1', A), false);
  assert.equal(await ownedRow(env, 'compliance_events', 'Board meeting', A), false);
});

test('6: an old product_feedback row reads on its record, and nothing else does', async () => {
  const db = fixture(); const env = envOf(db);
  legacy(db, 'grow_feedback_updated', 'product_feedback', 'fba1');
  legacy(db, 'grow_feedback_updated', 'product_feedback', 'fba12');
  legacy(db, 'feedback_imported', 'product_feedback', 'fba1');
  db.prepare("INSERT INTO activity_logs (project_id, action, details, entity_type, entity_id) VALUES (?, 'grow_feedback_updated', 'Other venture', 'product_feedback', 'fba1')").run(B);
  const out = await read(env, 'product-improvement', 'product_feedback', 'fba1');
  assert.deepEqual(out.items.map((r) => r.action), ['grow_feedback_updated', 'created']);
  assert.equal(out.items[0].a, 'grow:product_feedback by Ana Wren');
  assert.equal(out.items[1].a, 'Created by Ana Wren');
  // Through the route, the record's own activity carries it too.
  const viaRoute = await rec(db, 'product-improvement', 'fba1', { tail: '/activity' });
  assert.deepEqual(viaRoute.body.items.map((r: any) => r.action), ['grow_feedback_updated', 'created']);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE project_id IS NULL AND entity_id = 'fba1'").get() as any).n, 2);
});

test('6: an old channel_spend row (<uid>:<month>) reads on its channel only', async () => {
  const db = fixture(); const env = envOf(db);
  legacy(db, 'grow_channel_spend', 'channel_spend', 'cha1:2026-09');
  legacy(db, 'grow_channel_spend', 'channel_spend', 'cha12:2026-09');
  legacy(db, 'grow_channel_spend', 'channel_spend', 'chb1:2026-09');
  legacy(db, 'grow_channel_spend', 'channel_spend', 'cha1');
  const out = await read(env, 'distribution', 'growth_channels', 'cha1');
  assert.deepEqual(out.items.filter((r) => r.action !== 'created').map((r) => r.action), ['grow_channel_spend']);
  assert.equal(out.total, 2);
  const other = await read(env, 'distribution', 'growth_channels', 'chb1');
  assert.equal(other.items.filter((r) => r.action === 'grow_channel_spend').length, 1);
});

test('6: an old partner_revenue row (<uid>:<month>) reads on its partner only', async () => {
  const db = fixture(); const env = envOf(db);
  legacy(db, 'grow_partner_revenue', 'partner_revenue', 'pta1:2026-08');
  legacy(db, 'grow_partner_revenue', 'partner_revenue', 'pta12:2026-08');
  const out = await read(env, 'partner-network', 'growth_partners', 'pta1');
  assert.deepEqual(out.items.filter((r) => r.action !== 'created').map((r) => r.action), ['grow_partner_revenue']);
});

test('6: an old job_applications stage row reads on its posting, and another posting\'s does not', async () => {
  const db = fixture(); const env = envOf(db);
  legacy(db, 'grow_application_stage', 'job_applications', '41');
  legacy(db, 'grow_application_stage', 'job_applications', '42');
  legacy(db, 'grow_role_updated', 'job_postings', '31', '2026-09-03 10:00:00');
  const out = await read(env, 'team-expansion', 'job_postings', '31');
  assert.deepEqual(out.items.filter((r) => r.action !== 'created').map((r) => r.action), ['grow_role_updated', 'grow_application_stage']);
  assert.equal(out.items.find((r) => r.action === 'created')?.a, 'Created by Ana Wren');
  assert.equal(JSON.stringify(out).includes('Lena'), false);
  const analyst = await read(env, 'team-expansion', 'job_postings', '33');
  assert.deepEqual(analyst.items.filter((r) => r.action !== 'created').map((r) => r.action), ['grow_application_stage']);
});

test('6: market and obligation rows read on their records, with their stored creators', async () => {
  const db = fixture(); const env = envOf(db);
  legacy(db, 'grow_market_updated', 'markets', 'mka1');
  legacy(db, 'grow_obligation_added', 'compliance_events', '51');
  legacy(db, 'grow_obligation_added', 'compliance_events', '52');
  assert.deepEqual((await read(env, 'market-expansion', 'markets', 'mka1')).items.map((r) => r.action), ['grow_market_updated', 'created']);
  const obligation = await read(env, 'durable-company-building', 'compliance_events', '51');
  assert.deepEqual(obligation.items.map((r) => r.action), ['grow_obligation_added', 'created']);
  assert.equal(obligation.items[1].a, 'Created by Ana Wren');
});

test('6: only grow_* actions are read without a project', async () => {
  const db = fixture();
  await assert.rejects(activityFor(envOf(db), { projectId: A, entityType: 'grow.product-improvement', entityId: 'fba1',
    oldRows: { entityTypes: ['product_feedback'], unscopedActions: ['feedback_imported'] } }), /Only grow_\* activity/);
});

// ---------------------------------------------------------------------------
// Test 7: actions
// ---------------------------------------------------------------------------

test('7: Mark held moves a quarterly obligation three calendar months and resets its reminders; a one-time one completes', async () => {
  const db = fixture();
  const r = await act(db, 'durable-company-building', 51, 'mark-held', { held_on: '2026-11-29', notes: 'Quorum met' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // 30 Nov + 3 months is clamped to 28 Feb.
  assert.deepEqual({ ...db.prepare('SELECT id, due_date, completion_status, reminders_sent_json FROM compliance_events WHERE id = 51').get() as any },
    { id: 51, due_date: '2027-02-28', completion_status: 'pending', reminders_sent_json: '[]' });
  assert.deepEqual({ ...db.prepare("SELECT held_on, notes, minutes_file_key FROM obligation_occurrences WHERE event_id = 51 ORDER BY id DESC LIMIT 1").get() as any },
    { held_on: '2026-11-29', notes: 'Quorum met', minutes_file_key: null });
  const once = await act(db, 'durable-company-building', 53, 'mark-held', { held_on: '2026-12-14' });
  assert.equal(once.status, 200);
  assert.deepEqual({ ...db.prepare('SELECT due_date, completion_status FROM compliance_events WHERE id = 53').get() as any }, { due_date: '2026-12-15', completion_status: 'completed' });
  // The record stays on one id.
  assert.deepEqual(sectionOf(await rec(db, 'durable-company-building', 51), 'past-meetings').rows.map((x: any) => x.a), ['29 Nov', '30 Aug', '30 May']);
  const log = { ...db.prepare("SELECT project_id, entity_type, entity_id FROM activity_logs WHERE action = 'grow_obligation_held' ORDER BY id LIMIT 1").get() as any };
  assert.deepEqual(log, { project_id: A, entity_type: 'grow.durable-company-building', entity_id: '51' });
});

test('7: Mark held stores minutes under the venture\'s prefix, and a clash answers 409 writing nothing', async () => {
  const db = fixture();
  const files = new Map<string, unknown>();
  const FILES = { put: async (k: string, v: unknown) => { files.set(k, v); }, delete: async (k: string) => { files.delete(k); } };
  const form = new FormData();
  form.set('held_on', '2026-11-30');
  form.set('minutes', new File([new Uint8Array([37, 80, 68, 70])], 'Board minutes Ana Wren.pdf', { type: 'application/pdf' }));
  const ok = await act(db, 'durable-company-building', 51, 'mark-held', undefined, { form, env: { FILES } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const key = (db.prepare('SELECT minutes_file_key AS k FROM obligation_occurrences WHERE event_id = 51 ORDER BY id DESC LIMIT 1').get() as any).k;
  assert.match(key, /^grow-minutes\/1\/[0-9a-f]{32}\.pdf$/);
  assert.ok(files.has(key));
  assert.equal(key.toLowerCase().includes('ana'), false, 'the key carries no file name');
  const wrong = new FormData(); wrong.set('held_on', '2026-11-30');
  wrong.set('minutes', new File(['x'], 'minutes.txt', { type: 'text/plain' }));
  assert.equal((await act(db, 'durable-company-building', 51, 'mark-held', undefined, { form: wrong, env: { FILES } })).status, 415);
  // Another governance obligation already due on the next date.
  db.exec(`INSERT INTO compliance_events (project_id, jurisdiction, event_type, title, due_date, kind, recurrence) VALUES (${A}, 'Unspecified', 'board_meeting', 'Spare board', '2027-05-28', 'governance', 'one_time')`);
  const before = (db.prepare('SELECT COUNT(*) AS n FROM obligation_occurrences').get() as any).n;
  const clash = await act(db, 'durable-company-building', 51, 'mark-held', { held_on: '2027-02-27' });
  assert.equal(clash.status, 409);
  assert.match(clash.body.detail, /Another governance obligation is already due on 2027-05-28\. Pick another date\./);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM obligation_occurrences').get() as any).n, before);
  assert.equal((db.prepare('SELECT due_date FROM compliance_events WHERE id = 51').get() as any).due_date, '2027-02-28');
});

test('7: Mark told sets told_at and returns a mailto draft to writers only', async () => {
  const db = fixture();
  const r = await act(db, 'product-improvement', 'fba1', 'mark-told', { via: 'email' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.open.url, /^mailto:rui%40example\.test\?subject=It%20shipped&body=/);
  const row = db.prepare("SELECT told_at, told_via FROM product_feedback WHERE uid = 'fba1'").get() as any;
  assert.ok(row.told_at); assert.equal(row.told_via, 'email');
  // Told: no longer declared, and the loop reads Told.
  const after = await rec(db, 'product-improvement', 'fba1');
  assert.equal(actionKeys(after).includes('mark-told'), false);
  assert.match(sectionOf(after, 'closing-the-loop').rows[0].c, /^Told · /);
  // The activity names no customer.
  const log = db.prepare("SELECT details FROM activity_logs WHERE action = 'grow_feedback_told'").get() as any;
  assert.equal(log.details.includes('Rui'), false);
  db.exec("UPDATE product_feedback SET told_at = NULL WHERE uid = 'fba1'");
  assert.equal((await act(db, 'product-improvement', 'fba1', 'mark-told', { via: 'email' }, { who: ADVISOR })).status, 403);
  // Not shipped yet, or nobody asked: the writer refuses, whoever calls it.
  db.exec("UPDATE product_feedback SET status = 'planned' WHERE uid = 'fba1'");
  await assert.rejects(markFeedbackTold(envOf(db), A, { id: FOUNDER, role: 'founder' } as any, 'fba1', { via: 'email' }), /once it has shipped/);
  await assert.rejects(markFeedbackTold(envOf(db), A, { id: FOUNDER, role: 'founder' } as any, 'fba2', { via: 'email' }), /Nobody asked/);
  assert.equal((db.prepare("SELECT told_at FROM product_feedback WHERE uid = 'fba1'").get() as any).told_at, null);
});

test('7: each section action writes its row; a non-host cannot close a role', async () => {
  const db = fixture();
  assert.equal((await act(db, 'partner-network', 'pta1', 'add-deal', { customer: 'Mill Bakery', amount_cents: 120000, closed_on: '2026-10-01' })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT customer, amount_cents, currency FROM growth_partner_deals').get() as any }, { customer: 'Mill Bakery', amount_cents: 120000, currency: 'usd' });
  assert.equal((await act(db, 'market-expansion', 'mka1', 'add-entry-step', { text: 'Register the company', due_on: '2027-01-15' })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT text, due_on FROM market_entry_steps').get() as any }, { text: 'Register the company', due_on: '2027-01-15' });
  assert.equal((await act(db, 'market-expansion', 'mka1', 'localisation-check', { key: 'payments', done: true })).status, 200);
  assert.equal((db.prepare("SELECT done_at FROM market_localisation WHERE key = 'payments'").get() as any).done_at != null, true);
  assert.equal((await act(db, 'market-expansion', 'mka1', 'localisation-check', { key: 'payments', done: false })).status, 200);
  assert.equal((db.prepare("SELECT done_at FROM market_localisation WHERE key = 'payments'").get() as any).done_at, null);
  assert.equal((await act(db, 'durable-company-building', 51, 'add-agenda', { text: 'Approve the budget', owner_name: 'Chair' })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT text, owner_name FROM obligation_agenda_items').get() as any }, { text: 'Approve the budget', owner_name: 'Chair' });
  assert.equal((await act(db, 'revenue-and-traction', 'mrr', 'set-alert', { op: 'below', threshold_cents: 500000 })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT kpi_key, measure, op, threshold, threshold_cents, created_by FROM kpi_alerts').get() as any },
    { kpi_key: 'mrr', measure: 'value', op: 'below', threshold: null, threshold_cents: 500000, created_by: FOUNDER });
  assert.equal((await act(db, 'revenue-and-traction', 'mrr', 'set-alert', { op: 'below', threshold: 5, threshold_cents: 5 })).status, 400);
  assert.equal((await act(db, 'distribution', 'cha1', 'add-experiment', { title: 'Sponsor an issue', cac_cents: 9000, currency: 'EUR' })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT title, cac_cents, currency FROM channel_experiments').get() as any }, { title: 'Sponsor an issue', cac_cents: 9000, currency: 'eur' });
  assert.equal((await act(db, 'distribution', 'cha1', 'pause')).status, 200);
  assert.equal((db.prepare("SELECT state FROM growth_channels WHERE uid = 'cha1'").get() as any).state, 'paused');
  // Close role: undeclared for a writer who is neither host nor admin, so refused, and the posting stays open.
  const refused = await act(db, 'team-expansion', 31, 'close-role', {}, { who: COFOUNDER });
  assert.equal(refused.status, 404);
  assert.equal((db.prepare('SELECT status FROM job_postings WHERE id = 31').get() as any).status, 'draft');
  const closed = await act(db, 'team-expansion', 31, 'close-role');
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal((db.prepare('SELECT status FROM job_postings WHERE id = 31').get() as any).status, 'closed');
  // Every write logged one scoped row, and none names a third party.
  const logs = db.prepare("SELECT project_id, entity_type, details FROM activity_logs WHERE entity_type LIKE 'grow.%'").all() as any[];
  assert.ok(logs.length >= 9);
  for (const l of logs) {
    assert.equal(l.project_id, A);
    for (const name of ['Mill Bakery', 'Pia', 'Rui', 'Lena', 'Chair']) assert.equal(String(l.details).includes(name), false, `${l.details} names ${name}`);
  }
});

test('7: form-options answer each module\'s chips to writers only', async () => {
  const db = fixture();
  const fo = async (slug: string, who = FOUNDER) => call(db, 'GET', `/api/cycles/grow/modules/${slug}/form-options?project=${A}`, { who });
  const fb = await fo('product-improvement');
  assert.equal(fb.status, 200);
  assert.deepEqual(fb.body.themes, [{ value: 'Speed', label: 'Speed', count: 2 }]);
  const kpi = (await fo('revenue-and-traction')).body;
  assert.deepEqual(kpi.kpis.filter((k: any) => k.disabled).map((k: any) => k.value), ['new_mrr', 'expansion_mrr', 'runway']);
  assert.ok(kpi.kpis.some((k: any) => k.value === 'custom-kpa1'));
  assert.ok(kpi.kpis.some((k: any) => k.value === 'custom'));
  assert.equal(kpi.kpis.some((k: any) => k.value === 'custom-kpb1'), false);
  assert.deepEqual(kpi.sources.map((s: any) => [s.value, s.disabled, s.reason]), [
    ['manual', false, null], ['stripe', true, 'Stripe is not connected.'],
    ['accounting', true, 'No accounting connector writes KPIs yet.'], ['bank', true, 'No bank connector writes KPIs yet.']]);
  db.exec(`INSERT INTO job_postings (slug, host_user_id, project_id, title, team, status) VALUES ('lantern-ops', ${FOUNDER}, ${A}, 'Ops', 'Field sales', 'draft')`);
  assert.deepEqual((await fo('team-expansion')).body.teams.map((t: any) => t.value), ['Engineering', 'Product', 'Go-to-market', 'Operations', 'Field sales']);
  assert.deepEqual((await fo('durable-company-building')).body.remind_presets.map((p: any) => p.value), ['30', '14', '7', '1', '0']);
  assert.ok(Array.isArray((await fo('market-expansion')).body.geographies));
  assert.equal((await fo('product-improvement', ADVISOR)).status, 403);
});

// ---------------------------------------------------------------------------
// Test 9: the fill
// ---------------------------------------------------------------------------

test('9: feedback_theme proposes only an existing theme, and only for an unthemed row of the venture', async () => {
  const db = fixture();
  const kind = fillKind('feedback_theme')!;
  const ctx = { env: envOf(db), user: { id: FOUNDER, role: 'founder' } as any, projectId: A };
  const g = await kind.gather(ctx);
  assert.equal(g.empty, undefined);
  assert.deepEqual(g.known, ['fba3']);
  assert.match(g.facts, /Themes:\n {2}- Speed/);
  const reply = JSON.stringify([
    { uid: 'fba3', theme: 'Latency' }, // the venture's own row, a theme nobody named
    { uid: 'fba3', theme: 'speed' }, // the venture's own theme, its own spelling kept
    { uid: 'fba3', theme: 'Speed' }, // the same row twice
    { uid: 'fba12', theme: 'Speed' }, // another venture's row
    { uid: 'fba1', theme: 'Speed' }, // already themed
    { uid: 'fba2', theme: 'Reliability' }, // a theme nobody named
  ]);
  const out = await kind.parse(reply, g, ctx);
  assert.deepEqual(out.map((p) => p.payload), [{ uid: 'fba3', theme: 'Speed', body: 'The export takes minutes', readable: 'The export takes minutes → Speed' }]);
  // No theme yet: nothing to propose from, said rather than run.
  const empty = fresh();
  empty.exec(`INSERT INTO product_feedback (uid, project_id, body, source) VALUES ('x1', ${A}, 'Something', 'team')`);
  assert.match(String((await kind.gather({ ...ctx, env: envOf(empty) })).emptyReason), /Give one item a theme by hand first/);
});

test('9: its apply writes the row PATCH /feedback/:uid writes, and refuses another venture\'s uid', async () => {
  const viaFill = fixture();
  const viaPatch = fixture();
  const kind = fillKind('feedback_theme')!;
  const ctx = (db: DatabaseSync) => ({ env: envOf(db), user: { id: FOUNDER, role: 'founder' } as any, projectId: A });
  const applied = await kind.apply(ctx(viaFill), { uid: 'fba3', theme: 'Speed', body: 'The export takes minutes' }, 'product_feedback:fba3');
  assert.equal(applied.written, kind.readable({ uid: 'fba3', theme: 'Speed', body: 'The export takes minutes' }));
  assert.equal(applied.target?.column, 'theme');
  await updateFeedback(envOf(viaPatch), A, { id: FOUNDER, role: 'founder' } as any, 'fba3', { theme: 'Speed' });
  const strip = (r: any) => ({ ...r, id: undefined, updated_at: undefined });
  const row = (db: DatabaseSync) => db.prepare("SELECT * FROM product_feedback WHERE uid = 'fba3'").get();
  assert.deepEqual(strip(row(viaFill)), strip(row(viaPatch)));
  await assert.rejects(kind.apply(ctx(viaFill), { uid: 'fba12', theme: 'Speed', body: '' }, 'product_feedback:fba12'));
  assert.equal((viaFill.prepare("SELECT theme FROM product_feedback WHERE uid = 'fba12'").get() as any).theme, null);
  // A theme that no longer exists, or a row themed meanwhile, is refused on accept.
  await assert.rejects(kind.apply(ctx(viaFill), { uid: 'fba3', theme: 'Gone', body: '' }, 'x'), /no longer exists/);
  await assert.rejects(kind.apply(ctx(viaFill), { uid: 'fba3', theme: 'Speed', body: '' }, 'x'), /already has a theme/);
});
