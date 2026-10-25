/**
 * D695 (S03-B, #1657) — Raise's seven Add forms and their Edits, sent through
 * the real Worker routes (test 11), with another venture's ids and the write
 * gate (test 12). Grow's seven run through `cycle_adapters_d661.test.ts`,
 * which #1657's first PR moved to Grow's canvas bodies.
 *
 * The forms are `frontend/src/pages/cycles/forms.js` itself and the writes
 * `makeCycleWrites`, bound here to the Raise cycle routes, D690's record
 * routes (`form-options`), the data room and the deck viewer. Each form's
 * chips come from its own `loadOptions` over the real `form-options`, as the
 * dialog reads them.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, as cycle_records_raise_d691.test.ts builds one. Every
 * person, venture and fund is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cycle_forms_raise_grow_d695.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleRaise from '../src/routes/cycle_raise.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import dataRoom from '../src/routes/data_room.ts';
import decks from '../src/routes/decks.ts';
import { saveScenario } from '../src/services/capTableWrites.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { FORMS, EDITS, formFor, editFor, initialValues, validate } from '../../frontend/src/pages/cycles/forms.js';
import { makeCycleWrites } from '../../frontend/src/lib/api/cycleWrites.js';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');

const FOUNDER = 10, OTHER = 20, PARTNER = 40, ADVISOR = 41, INVESTOR = 50;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [PARTNER]: 'partner', [ADVISOR]: 'advisor', [INVESTOR]: 'investor' };
const P = 1, PB = 2;
const UID = 'p-kestrel', UID_B = 'p-osprey';
const B_DECK = 6, B_PROSPECT = 9, B_FOLDER = 'fo-b';

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, subscription_tier) VALUES (?, ?, ?, ?, 1, ?, ?)');
  // Share links and cap-table saves keep their tool's studio gate (D691 decision 13).
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001, 'studio');
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002, 'studio');
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null, 'studio');
  u.run(ADVISOR, 'advisor', 'Ari Advisor', 'ari@example.test', null, 'studio');
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null, 'studio');
  db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (${P}, '${UID}', 'Kestrel Labs', 1001), (${PB}, '${UID_B}', 'Osprey Works', 1002)`);
  db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (5, ${P}, 2, '[]', 1), (${B_DECK}, ${PB}, 1, '[]', 1)`);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, firm, email, stage) VALUES
           (5, 'p5', ${P}, 'Northwind Capital', NULL, 'nw@example.test', 'meeting'),
           (${B_PROSPECT}, 'p9', ${PB}, 'Elsewhere Fund', NULL, 'else@example.test', 'meeting')`);
  db.exec(`INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, owner_user_id) VALUES (1, 'c1', 'project', ${P}, 'Kestrel Labs', ${FOUNDER})`);
  db.exec(`INSERT INTO dd_requests (id, case_id, title) VALUES (7, 1, 'Customer contracts')`);
  db.exec(`INSERT INTO data_room_folders (id, uid, project_id, name) VALUES (3, 'fo3', ${P}, 'Financials'), (4, '${B_FOLDER}', ${PB}, 'Legal')`);
  db.exec(`INSERT INTO network_connections (user_id, name, company) VALUES (${FOUNDER}, 'Lin Park', 'Harbour Labs')`);
  db.exec(`INSERT INTO research_fund_sources (source_name, title, terms_status, evidence, verdict, verdict_reason, reviewed_on)
           VALUES ('A served list', 't', 'not found', 'e', 'cite only', 'r', '2026-10-06')`);
  db.exec(`INSERT INTO research_fund_directory (uid, name, sector_focus, source_name, source_url, as_of)
           VALUES ('alder-ventures', 'Alder Ventures', 'Generalist', 'A served list', 'https://example.test/list', '2026-10-04')`);
  db.exec(`INSERT INTO spinout_deck_overrides (project_id, field_key, value, version, investor_type) VALUES (${PB}, '_version', 'angel', 3, 'angel')`);
  // A founder on the register, so Edit holder has an `h-` id.
  const saved = await saveScenario({ DB: d1Over(db) } as any, {
    actor: { id: FOUNDER, email: 'fay@example.test' }, name: 'Kestrel cap table', projectId: P,
    inputs: { founders: [{ name: 'Mira Okafor', shares: 6_000_000 }], option_pool_pct: 10, safes: [], rounds: [] } as any,
  });
  assert.ok(saved.ok);
  return db;
}

/** A stand-in for the R2 bucket. */
function bucket() {
  const objects = new Map<string, Uint8Array>();
  return { objects, put: async (key: string, bytes: Uint8Array) => { objects.set(key, bytes); }, get: async (key: string) => (objects.has(key) ? { body: objects.get(key) } : null), delete: async (key: string) => { objects.delete(key); } };
}

const app = new Hono<any>();
app.route('/api/cycles', createCycleRecords());
app.route('/api/cycles/raise', cycleRaise);
app.route('/api/data-room', dataRoom);
app.route('/api/decks', decks);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

type Call = { path: string; method: string; body: any };
/** `makeCycleWrites` over the real routes, as `who`: a refusal throws the Worker's sentence, as `lib/api.js` does. */
function writesAs(db: DatabaseSync, who = FOUNDER, files = bucket()) {
  const calls: Call[] = [];
  const request = async (path: string, opts: any = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
    const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const res = await withThrownResponses(() => app.request(`/api${path}`, {
        method: opts.method || 'GET', body: opts.body, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: files } as any));
      const raw = await res.text();
      const body = raw ? JSON.parse(raw) : null;
      if (!res.ok) {
        const refused: Error & { status?: number } = new Error(String(body?.detail ?? body?.error ?? res.status));
        refused.status = res.status;
        throw refused;
      }
      return body;
    } finally { [console.warn, console.error] = saved; }
  };
  return { w: makeCycleWrites(request), calls, files };
}

/** A form's fields with what its `loadOptions` answered laid over each, as `FormLightbox`'s `formFields` lays them. */
const withLoaded = (fields: any[], loaded: any): any[] => fields.map((f) => ({ ...f, ...(loaded?.[f.name] ?? {}), ...(f.parts ? { parts: withLoaded(f.parts, loaded) } : {}) }));
/** The fields and values the dialog would hold once `loadOptions` answered, before the founder types. */
async function opened(form: any, w: any, project = P, id?: unknown) {
  const loaded = form.loadOptions ? await form.loadOptions(w, project, id) : {};
  const fields = withLoaded(form.fields, loaded);
  const values: any = initialValues({ ...form, fields });
  // A `value` the read gives is the box's first value (Edit split's stored split).
  const leaves = (list: any[]): any[] => list.flatMap((f) => (f.parts ? leaves(f.parts) : [f]));
  for (const f of leaves(fields)) if (Object.hasOwn(f, 'value')) values[f.name] = String(f.value ?? '');
  return { fields, values, loaded };
}
const choices = (fields: any[], name: string) => {
  const all = (list: any[]): any[] => list.flatMap((f) => (f.parts ? all(f.parts) : [f]));
  return (all(fields).find((f) => f.name === name)?.opts ?? []).map((o: any) => o.value);
};
async function refusal(work: () => Promise<unknown>) {
  try { await work(); } catch (e: any) { return { status: e.status, message: e.message }; }
  assert.fail('expected a refusal');
}
const n = (db: DatabaseSync, sql: string, ...args: any[]) => Number((db.prepare(sql).get(...args) as any).n);
const pdf = (name: string, size = 8) => new File([new Uint8Array(size).fill(37)], name, { type: 'application/pdf' });

// ---------------------------------------------------------------------------
// Test 11: each form's body through its real route, read back on its table
// ---------------------------------------------------------------------------

test('11: Re-score sends the ticked items and `since`, and only those items get a score', async () => {
  const db = await fixture();
  const { w } = writesAs(db);
  const form = formFor('raise', 'fundraising-readiness');
  const { values, fields } = await opened(form, w);
  assert.deepEqual(choices(fields, 'items'), ['narrative', 'deck', 'data_room', 'cap_table', 'use_of_funds', 'traction', 'team']);
  const v = { ...values, items: values.items.filter((k: string) => k !== 'deck') };
  assert.deepEqual(validate(form, v), {});
  const out = await form.submit(w, P, v);
  assert.deepEqual(out.items.sort(), ['cap_table', 'data_room', 'narrative', 'traction', 'use_of_funds']);
  const scored = (db.prepare(`SELECT i.item_key FROM readiness_scores s JOIN readiness_items i ON i.id = s.item_id WHERE s.project_id = ? ORDER BY 1`).all(P) as any[]).map((r) => r.item_key);
  assert.deepEqual(scored, ['cap_table', 'data_room', 'narrative', 'traction', 'use_of_funds'], 'no deck, and never team');
  // Since the last score re-scores only what may have changed (D691 decision 8), never deck or team;
  // Everything re-scores every ticked item.
  const again = (await form.submit(w, P, v)).items;
  assert.ok(again.length < 5 && !again.includes('deck') && !again.includes('team'), String(again));
  assert.equal((await form.submit(w, P, { ...v, since: 'all' })).items.length, 5);
});

test('11: New version starts from the live deck with none saved, then from the newest version; every word reads back', async () => {
  const db = await fixture();
  const { w } = writesAs(db);
  const form = formFor('raise', 'investor-narrative');
  // D909 (owner question 5 on #2454): the live wording is the Spin-Out deck's, offered to a Spin-Out venture only.
  let { values, fields } = await opened(form, w);
  assert.deepEqual(choices(fields, 'start_from'), ['blank'], 'not a Spin-Out venture: blank only');
  db.prepare("INSERT INTO spinout_deck_overrides (project_id, field_key, value, version) VALUES (?, 'problem.framing', 'Books close by hand.', 0)").run(P);
  ({ values, fields } = await opened(form, w));
  assert.deepEqual(choices(fields, 'start_from'), ['live', 'blank']);
  assert.equal(values.start_from, 'live', 'a Spin-Out venture with no saved version: the Spin-Out wording is chosen');
  const first = await form.submit(w, P, { ...values, one_liner: 'Kestrel finds the leak', why_now: 'Rules changed in 2026', ask: '$1.5M for 18 months' });
  assert.equal(first.version, 1);
  ({ values, fields } = await opened(form, w));
  assert.deepEqual(choices(fields, 'start_from'), ['version-1', 'live', 'blank'], 'saved versions first, newest first');
  assert.equal(values.start_from, 'version-1');
  const second = await form.submit(w, P, { ...values, investor_type: 'angel', check_against: ['metrics'] });
  assert.equal(second.version, 2);
  const words = (v: number) => Object.fromEntries((db.prepare('SELECT field_key, value FROM spinout_deck_overrides WHERE project_id = ? AND version = ?').all(P, v) as any[]).map((r) => [r.field_key, r.value]));
  assert.equal(words(1)['cover.thesis'], 'Kestrel finds the leak');
  assert.equal(words(1)['ask.title'], '$1.5M for 18 months');
  const meta = db.prepare('SELECT why_now, check_against_json, based_on_version FROM narrative_version_meta WHERE project_id = ? AND version = ?');
  assert.equal((meta.get(P, 1) as any).why_now, 'Rules changed in 2026');
  assert.deepEqual([JSON.parse((meta.get(P, 2) as any).check_against_json), (meta.get(P, 2) as any).based_on_version], [['metrics'], 1]);
  // Every investor type the form offers is accepted.
  for (const t of choices(fields, 'investor_type')) assert.ok((await form.submit(w, P, { ...values, start_from: 'blank', investor_type: t })).version > 2, t);
});

test('11: New link names its investor, its expiry and its settings; the raw link it shows once opens the deck', async () => {
  const db = await fixture();
  const { w } = writesAs(db);
  const form = formFor('raise', 'pitch-deck');
  const { values, fields } = await opened(form, w);
  assert.deepEqual(choices(fields, 'deck_id'), ['5'], 'this venture\'s deck only');
  assert.deepEqual(choices(fields, 'prospect_id'), ['5', 'typed']);
  assert.equal(form.blocked(fields.map((f: any) => ({ ...f, options: f.opts }))), false);
  const result = await form.submit(w, P, { ...values, allow: ['download'] });
  const done = form.done(result);
  assert.equal(done.text, 'Copy the link now. It is shown only once.');
  const token = /\/share\/deck\/(.+)$/.exec(done.copy)?.[1];
  assert.ok(token);
  const row = db.prepare('SELECT prospect_id, investor_label, allow_download, allow_forwarding, expires_at, token_hash FROM pitch_deck_share_tokens WHERE id = ?').get(result.id) as any;
  assert.deepEqual([row.prospect_id, row.investor_label, row.allow_download, row.allow_forwarding], [5, null, 1, 0]);
  assert.notEqual(row.token_hash, token, 'only a hash is stored');
  const viewer = await app.request(`/api/decks/share/${token}`, {}, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  assert.equal(viewer.status, 200, 'the raw link opens the deck through the share viewer');
  // Every other expiry, and a typed name. (A second link to one deck with the same expiry in the
  // same second mints the same token, which the store refuses: reported on the PR, not changed here.)
  for (const e of choices(fields, 'expires_days').filter((x: string) => x !== values.expires_days)) {
    const r = await form.submit(w, P, { ...values, prospect_id: 'typed', investor_label: 'Juno Angels', expires_days: e });
    const t = db.prepare('SELECT investor_label, expires_at FROM pitch_deck_share_tokens WHERE id = ?').get(r.id) as any;
    assert.equal(t.investor_label, 'Juno Angels');
    assert.equal(e === 'never', String(t.expires_at).startsWith('9999'), e);
  }
});

test('11: Upload puts each file behind the NDA gate with its tier; a new folder name makes a top-level folder; an oversize file is refused by name', async () => {
  const db = await fixture();
  const { w, calls, files } = writesAs(db);
  const form = formFor('raise', 'data-room');
  const { values, fields } = await opened(form, w);
  assert.deepEqual(choices(fields, 'folder'), ['fo3', 'name:Legal', 'name:Team', 'name:Product', 'name:Customers'], 'the room\'s folder, then the canvas\'s names not made');
  assert.equal(values.answers, 'request-7', 'the first open request is chosen');
  assert.ok(choices(fields, 'answers').includes('item-customer_contracts'));
  assert.equal(choices(fields, 'answers').at(-1), '');
  await form.submit(w, P, { ...values, files: [pdf('a.pdf'), pdf('b.pdf')], folder: 'name:Legal', access_tier: 'committed', protect: ['expire'], access_expires_at: '2999-06-30' });
  const posts = calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts.map((c) => c.path), [`/data-room/${UID}/files`, `/data-room/${UID}/files`], 'one POST per file, the uid from form-options');
  assert.equal(calls.filter((c) => /\/folders/.test(c.path)).length, 0, 'no folders call of its own');
  const rows = db.prepare('SELECT name, visibility, access_tier, access_expires_at, dd_request_id, folder_id FROM data_room_files WHERE project_id = ? ORDER BY name').all(P) as any[];
  assert.deepEqual(rows.map((r) => [r.name, r.visibility, r.access_tier, r.access_expires_at, r.dd_request_id]),
    [['a.pdf', 'nda', 'committed', '2999-06-30', 7], ['b.pdf', 'nda', 'committed', '2999-06-30', 7]]);
  const legal = db.prepare('SELECT id, parent_id FROM data_room_folders WHERE project_id = ? AND name = ?').get(P, 'Legal') as any;
  assert.deepEqual([rows[0].folder_id, rows[1].folder_id, legal.parent_id], [legal.id, legal.id, null], 'one new top-level folder, used by both');
  assert.equal(files.objects.size, 2);
  // An existing folder by uid, a checklist item, each tier; a file over 20 MB refused by name while the other goes.
  for (const tier of choices(fields, 'access_tier')) {
    await form.submit(w, P, { ...values, files: [pdf(`${tier}.pdf`)], folder: 'fo3', answers: 'item-customer_contracts', access_tier: tier });
    const r = db.prepare('SELECT folder_id, checklist_item, access_tier, access_expires_at FROM data_room_files WHERE name = ?').get(`${tier}.pdf`) as any;
    assert.deepEqual([r.folder_id, r.checklist_item, r.access_tier, r.access_expires_at], [3, 'customer_contracts', tier, null]);
  }
  const big = { name: 'huge.pdf', size: 21 * 1024 * 1024, type: 'application/pdf', arrayBuffer: async () => assert.fail('never read') } as any;
  const refused = await refusal(() => form.submit(w, P, { ...values, files: [big, pdf('small.pdf')] }));
  assert.equal(refused.message, 'Uploaded small.pdf. huge.pdf: Larger than 20 MB.');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM data_room_files WHERE name = 'small.pdf'"), 1);
});

test('11: Add holder writes a SAFE on the scenario and a founder on the register, with vesting', async () => {
  const db = await fixture();
  const { w } = writesAs(db);
  const form = formFor('raise', 'cap-table');
  const { values, fields } = await opened(form, w);
  assert.deepEqual(choices(fields, 'prospect_id'), ['', '5']);
  const safe = await form.submit(w, P, { ...values, name: 'Northwind Capital', amount: '$500k', cap: '$8M cap', prospect_id: '5' });
  assert.match(safe.id, /^e-\d+$/);
  const inputs = JSON.parse((db.prepare('SELECT inputs_json FROM cap_table_scenarios WHERE project_id = ? AND is_variant = 0').get(P) as any).inputs_json);
  const entry = inputs.safes.find((s: any) => s.key === safe.id);
  assert.deepEqual([entry.name, entry.amount, entry.cap, entry.prospect_id], ['Northwind Capital', 500000, 8000000, 5]);
  const note = await form.submit(w, P, { ...values, name: 'Juno Angels', instrument: 'note', amount: '250,000', cap: '10M' });
  const after = JSON.parse((db.prepare('SELECT inputs_json FROM cap_table_scenarios WHERE project_id = ? AND is_variant = 0').get(P) as any).inputs_json);
  assert.equal(after.safes.find((s: any) => s.key === note.id).instrument, 'note');
  const founder = await form.submit(w, P, { ...values, group: 'founders', name: 'Tomas Reyes', shares: '4000000', vesting: '4y-1y', vesting_start: '2026-01-01' });
  assert.match(founder.id, /^h-\d+$/);
  const holderId = Number(founder.id.slice(2));
  assert.equal((db.prepare('SELECT security_type FROM cap_table_holders WHERE id = ?').get(holderId) as any).security_type, 'common');
  assert.deepEqual({ ...(db.prepare('SELECT start_date, total_months, cliff_months FROM cap_table_vesting WHERE holder_id = ?').get(holderId) as any) },
    { start_date: '2026-01-01', total_months: 48, cliff_months: 12 });
});

test('11: Edit split opens with the stored split, sends a milestone per section and the runway, and refuses 95%', async () => {
  const db = await fixture();
  db.exec(`UPDATE projects SET funding_needed = 1200000, use_of_funds = '[{"label":"Product & engineering","pct":30},{"label":"GTM: sales and marketing","pct":50},{"label":"Hiring / runway reserve","pct":20}]',
           use_of_funds_meta = '{"runway_months":12,"milestones":{"product":{"label":"Launch v2","by":"2027-03"}},"keep":"me"}' WHERE id = ${P}`);
  const { w } = writesAs(db);
  const form = formFor('raise', 'use-of-funds');
  const { values } = await opened(form, w);
  assert.deepEqual([values.amount_to_raise, values['pct.product'], values['pct.go-to-market'], values['pct.reserve'], values['milestone_label.product'], values.runway, values.runway_months],
    ['1,200,000', '30', '50', '20', 'Launch v2', 'custom', '12'], 'it opens with the stored split');
  assert.match(validate(form, { ...values, 'pct.reserve': '15' })['pct.product'], /^The split adds up to 95%\. It must add up to 100%\.$/);
  await form.submit(w, P, { ...values, amount_to_raise: '$1.5M', 'milestone_by.reserve': '2027-09', 'milestone_label.reserve': 'Nine months of buffer', runway: '24' });
  const p = db.prepare('SELECT funding_needed, use_of_funds, use_of_funds_meta FROM projects WHERE id = ?').get(P) as any;
  assert.equal(p.funding_needed, 1500000);
  const meta = JSON.parse(p.use_of_funds_meta);
  assert.deepEqual([meta.runway_months, meta.milestones.reserve, meta.milestones.product, meta.keep], [24, { label: 'Nine months of buffer', by: '2027-09' }, { label: 'Launch v2', by: '2027-03' }, 'me']);
  assert.equal(JSON.parse(p.use_of_funds).reduce((s: number, x: any) => s + x.pct, 0), 100);
});

test('11: Add investor sends a fund found by its search, or a typed name, with its stage, warm path and next step', async () => {
  const db = await fixture();
  const { w, calls } = writesAs(db);
  const form = formFor('raise', 'capital-relationships');
  const { values, fields } = await opened(form, w);
  assert.deepEqual(choices(fields, 'warm_path'), ['Lin Park · Harbour Labs', '']);
  assert.deepEqual(fields.find((f: any) => f.name === 'warm_path').opts.map((o: any) => o.label), ['Lin Park can introduce', 'No path yet']);
  const found = await form.search(w, P, 'alder');
  assert.deepEqual(found, [{ value: 'alder-ventures', label: 'Alder Ventures' }]);
  assert.ok(calls.some((c) => c.path === '/cycles/raise/modules/capital-relationships/form-options?project=1&q=alder'), '`q` follows `project` on the one path');
  const fund = await form.submit(w, P, { ...values, name: 'Alder Ventures', research_fund_uid: 'alder-ventures', next_step: 'Send deck', next_step_due: '2026-11-06' });
  const row = db.prepare('SELECT name, stage, warm_path, next_step, next_step_due, research_fund_uid FROM raise_prospects WHERE id = ?').get(fund.id) as any;
  assert.deepEqual({ ...row }, { name: 'Alder Ventures', stage: 'to_contact', warm_path: 'Lin Park · Harbour Labs', next_step: 'Send deck', next_step_due: '2026-11-06', research_fund_uid: 'alder-ventures' });
  for (const stage of choices(fields, 'stage')) {
    const r = await form.submit(w, P, { ...values, name: `Quinn ${stage}`, stage, warm_path: '' });
    assert.equal((db.prepare('SELECT stage, warm_path FROM raise_prospects WHERE id = ?').get(r.id) as any).stage, stage);
  }
});

// ---------------------------------------------------------------------------
// Test 11: each Edit round-trips with nothing else moved
// ---------------------------------------------------------------------------

test('11: each Raise Edit saves through its PATCH and moves only what it sends', async () => {
  const db = await fixture();
  const { w, calls } = writesAs(db);
  await formFor('raise', 'investor-narrative').submit(w, P, { investor_type: 'seed_fund', start_from: 'live', one_liner: 'One', why_now: 'Now', ask: 'Ask', check_against: ['deck', 'metrics'] });
  const version = editFor('raise', 'investor-narrative');
  const record = { id: 1, edit: { id: 1, uid: 1 } };
  assert.equal(version.idOf(record), 1);
  await version.submit(w, P, version.idOf(record), { investor_type: 'seed_fund', one_liner: 'One', why_now: 'Later', ask: 'Ask', check_against: ['deck', 'metrics'] });
  assert.equal((db.prepare('SELECT why_now FROM narrative_version_meta WHERE project_id = ? AND version = 1').get(P) as any).why_now, 'Later');
  assert.deepEqual(calls.at(-1), { path: '/cycles/raise/narrative-versions/1?project=1', method: 'PATCH', body: { investor_type: 'seed_fund', one_liner: 'One', why_now: 'Later', ask: 'Ask', check_against: ['deck', 'metrics'] } });

  const link = await formFor('raise', 'pitch-deck').submit(w, P, { prospect_id: '5', deck_id: '5', expires_days: '30', allow: [] });
  const editLink = editFor('raise', 'pitch-deck');
  await editLink.submit(w, P, editLink.idOf({ id: link.id, edit: { id: link.id } }), { prospect_id: '', investor_label: '', expires_days: '', allow_download: 'yes', allow_forwarding: '' });
  const t = db.prepare('SELECT prospect_id, allow_download, allow_forwarding FROM pitch_deck_share_tokens WHERE id = ?').get(link.id) as any;
  assert.deepEqual([t.prospect_id, t.allow_download, t.allow_forwarding], [5, 1, 0], 'download on; the investor and forwarding kept');
  assert.deepEqual(calls.at(-1).body, { allow_download: true });

  await formFor('raise', 'data-room').submit(w, P, { files: [pdf('deck.pdf')], folder: 'fo3', answers: '', access_tier: 'invited', protect: [] });
  const file = db.prepare("SELECT id, uid FROM data_room_files WHERE name = 'deck.pdf'").get() as any;
  const editFile = editFor('raise', 'data-room');
  assert.equal(editFile.idOf({ id: file.id, edit: { id: file.id, uid: file.uid } }), file.uid);
  const { fields } = await opened(editFile, w, P, file.uid);
  assert.deepEqual(choices(fields, 'folder'), ['fo3'], 'only a folder that exists');
  await editFile.submit(w, P, file.uid, { folder: '', answers: 'request-7', access_tier: 'nobody', access_expires_at: '' });
  assert.equal(calls.at(-1).path, `/data-room/${UID}/files/${file.uid}`, 'the uid, never the integer id');
  const f = db.prepare('SELECT folder_id, dd_request_id, access_tier, visibility FROM data_room_files WHERE id = ?').get(file.id) as any;
  assert.deepEqual([f.folder_id, f.dd_request_id, f.access_tier, f.visibility], [3, 7, 'nobody', 'nda']);

  const holder = editFor('raise', 'cap-table');
  const safe = await formFor('raise', 'cap-table').submit(w, P, { name: 'Harbour Angels', group: 'investors', instrument: 'safe', amount: '100k', cap: '$5M', prospect_id: '' });
  await holder.submit(w, P, holder.idOf({ id: safe.id, edit: { id: safe.id } }), { name: 'Harbour Angels', shares: '', amount: '', cap: '$6M', discount_pct: '', prospect_id: '' });
  const entry = JSON.parse((db.prepare('SELECT inputs_json FROM cap_table_scenarios WHERE project_id = ? AND is_variant = 0').get(P) as any).inputs_json).safes.find((s: any) => s.key === safe.id);
  assert.deepEqual([entry.amount, entry.cap], [100000, 6000000], 'the cap moves; the amount stays');

  const investor = editFor('raise', 'capital-relationships');
  await investor.submit(w, P, investor.idOf({ id: 5, edit: { id: 5 } }), { name: 'Northwind Capital', email: '', stage: 'diligence', warm_path: '', next_step: '', next_step_due: '', notes: '' });
  const pr = db.prepare('SELECT name, email, stage FROM raise_prospects WHERE id = 5').get() as any;
  assert.deepEqual({ ...pr }, { name: 'Northwind Capital', email: 'nw@example.test', stage: 'diligence' }, 'the email it was not sent stays');

  // Use of funds' Edit is its Add; Fundraising readiness has none.
  assert.equal(editFor('raise', 'use-of-funds').key, formFor('raise', 'use-of-funds').key);
  assert.equal(editFor('raise', 'fundraising-readiness'), null);
});

// ---------------------------------------------------------------------------
// Test 12: another venture, and the write gate
// ---------------------------------------------------------------------------

test('12: another venture\'s project, ids, room, deck, prospect and folder are refused, and nothing is written', async () => {
  const db = await fixture();
  const { w } = writesAs(db);
  const before = n(db, 'SELECT COUNT(*) AS n FROM activity_logs');
  // A's founder reading B's choices: refused, so the form shows the refusal and sends nothing.
  for (const slug of Object.keys(FORMS.raise)) {
    const form = formFor('raise', slug);
    if (!form.loadOptions) continue;
    assert.equal((await refusal(() => form.loadOptions(w, PB))).status, 403, slug);
  }
  const cases: Array<[string, () => Promise<unknown>, number]> = [
    ['B\'s version', () => w.raise.narrativeVersionUpdate(P, 3, { why_now: 'x' }), 404],
    ['B\'s link', () => w.raise.deckLinkUpdate(P, 90, { allow_download: true }), 404],
    ['B\'s prospect', () => w.raise.prospectUpdate(P, B_PROSPECT, { stage: 'passed' }), 404],
    ['B\'s room', () => w.raise.upload(UID_B, { name: 'x.pdf', data: 'data:application/pdf;base64,JQ==', visibility: 'nda' }), 404],
    ['B\'s file', () => w.raise.fileUpdate(UID_B, 'f-x', { access_tier: 'nobody' }), 404],
    ['a link to B\'s deck', () => w.raise.deckLink(P, { deck_id: B_DECK, investor_label: 'x', expires_days: 7 }), 404],
    ['a link for B\'s prospect', () => w.raise.deckLink(P, { deck_id: 5, prospect_id: B_PROSPECT, expires_days: 7 }), 404],
    ['a holder for B\'s prospect', () => w.raise.holder(P, { name: 'x', group: 'investors', instrument: 'safe', amount_cents: 100, prospect_id: B_PROSPECT }), 404],
    ['an upload into B\'s folder', () => w.raise.upload(UID, { name: 'x.pdf', data: 'data:application/pdf;base64,JQ==', visibility: 'nda', folder_uid: B_FOLDER }), 404],
    ['a version based on B\'s', () => w.raise.narrativeVersion(P, { investor_type: 'angel', start_from: 'version', based_on_version: 3 }), 404],
  ];
  for (const [what, work, status] of cases) assert.equal((await refusal(work)).status, status, what);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM activity_logs'), before, 'nothing logged, so nothing written');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM data_room_files'), 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM pitch_deck_share_tokens'), 0);
});

test('12: a partner, an advisor member and an investor get the Worker\'s refusal on every Raise form, and nothing is written', async () => {
  const db = await fixture();
  for (const who of [PARTNER, ADVISOR, INVESTOR, OTHER]) {
    const { w } = writesAs(db, who);
    for (const [slug, [form]] of Object.entries(FORMS.raise) as Array<[string, any[]]>) {
      if (form.loadOptions) assert.equal((await refusal(() => form.loadOptions(w, P))).status, 403, `${slug} choices as ${who}`);
    }
    for (const work of [
      () => w.raise.rescore(P, { items: ['deck'] }),
      () => w.raise.narrativeVersion(P, { investor_type: 'angel' }),
      () => w.raise.deckLink(P, { deck_id: 5, investor_label: 'x', expires_days: 7 }),
      () => w.raise.holder(P, { name: 'x', group: 'investors', instrument: 'safe', amount_cents: 100 }),
      () => w.raise.useOfFunds(P, { sections: [{ key: 'product', pct: 100 }] }),
      () => w.raise.prospect(P, { name: 'x' }),
    ]) assert.ok([403, 404].includes((await refusal(work)).status), `a write as ${who}`);
    assert.ok([403, 404].includes((await refusal(() => w.raise.upload(UID, { name: 'x.pdf', data: 'data:application/pdf;base64,JQ==' }))).status), `an upload as ${who}`);
  }
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM activity_logs'), 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM raise_prospects'), 2);
});

test('11: every Raise form and Edit is registered, and every chip it draws before its read is one its route accepts', () => {
  assert.deepEqual(Object.keys(FORMS.raise).sort(), ['cap-table', 'capital-relationships', 'data-room', 'fundraising-readiness', 'investor-narrative', 'pitch-deck', 'use-of-funds']);
  assert.deepEqual(Object.keys(EDITS.raise).sort(), ['cap-table', 'capital-relationships', 'data-room', 'investor-narrative', 'pitch-deck', 'use-of-funds']);
  const start = initialValues(formFor('raise', 'cap-table'));
  assert.deepEqual([start.group, start.instrument, start.vesting], ['investors', 'safe', 'none'], 'Investors and SAFE, as the canvas chooses them');
});
