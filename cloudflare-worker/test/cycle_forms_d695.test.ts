/**
 * D695 (#1656) PR 2b — Validate's five Add forms and their Edits, sent through
 * the real Worker routes (test 12), with another venture's ids (test 13).
 * Build's cases join this file with PR 3b.
 *
 * The forms are `frontend/src/pages/cycles/forms.js` itself and the writes
 * `makeCycleWrites`, bound here to `routes/cycle_validate.ts` and D690's
 * record routes (`form-options`, the record read). Each form's chips come
 * from its own `loadOptions` over the real `form-options`, and each Edit opens
 * as a row or the record page opens it: the record's own Edit values through
 * `recordFormFor`, the spec's `valuesOf` and `editFieldsFor`.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, so `research_company_directory` (228) is there. Every
 * person, venture and company is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cycle_forms_d695.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleValidate from '../src/routes/cycle_validate.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { FORMS, EDITS, formFor, editFor, initialValues, validate } from '../../frontend/src/pages/cycles/forms.js';
import { recordFormFor, recordEditAction } from '../../frontend/src/pages/cycles/recordModel.js';
import { makeCycleWrites } from '../../frontend/src/lib/api/cycleWrites.js';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');

const FOUNDER = 10, OTHER = 20, PARTNER = 40, INVESTOR = 50;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [PARTNER]: 'partner', [INVESTOR]: 'investor' };
const P = 1, PB = 2;

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${PB}, 'Osprey Works', 1002)`);
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (11, ${P}, 'Month-end is manual'), (22, ${PB}, 'Their theme')`);
  // Two unthemed phrases (one with a colon) and one already in a theme.
  db.exec(`INSERT INTO discovery_interviews (id, project_id, interviewee_name, pains_json, quote_consent, stage, done_at) VALUES
           (1, ${P}, 'Ana Example', '["Close takes days", "Two tools: no sync"]', 1, 'done', '2026-10-12 10:00:00'),
           (2, ${P}, 'Ben Example', '["Month-end is manual"]', 1, 'done', '2026-10-09 10:00:00'),
           (22, ${PB}, 'Bea Example', '["Their pain"]', 1, 'done', '2026-10-09 10:00:00')`);
  db.exec(`INSERT INTO hypotheses (id, project_id, code, claim, sort_order) VALUES (5, ${P}, 'H1', 'Controllers pay to skip month-end', 1), (23, ${PB}, 'H1', 'Their claim', 1)`);
  // The venture tracks Routewise; Acme Ledger is in the founder's own Research › Companies analysis, not tracked yet.
  db.exec(`INSERT INTO competitor_analyses (id, user_id, project_id) VALUES ('an1', ${FOUNDER}, ${P}), ('an2', ${OTHER}, ${PB}), ('an3', ${FOUNDER}, NULL)`);
  db.exec(`INSERT INTO competitor_candidates (id, analysis_id, name, category) VALUES ('cand-route', 'an1', 'Routewise', 'direct'),
           ('cand-b', 'an2', 'Their Rival', 'direct'), ('cand-acme', 'an3', 'Acme Ledger', 'direct')`);
  db.exec(`INSERT INTO research_company_directory (uid, name, website, country, source_url, as_of) VALUES ('dir-acme', 'Acme Analytics', 'acme.example.test', 'US', 'https://example.test/directory', '2026-10-01')`);
  db.exec(`INSERT INTO customer_segments (id, project_id, name, name_norm, source) VALUES (32, ${PB}, 'Their segment', 'their segment', 'manual')`);
  db.exec(`INSERT INTO demand_signals (id, project_id, kind, who, signal_date, status, source_kind) VALUES (42, ${PB}, 'waitlist', 'Theirs', '2026-10-01', 'confirmed', 'manual')`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/validate', cycleValidate);
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

type Call = { path: string; method: string; body: any };
/** `makeCycleWrites` over the real routes, as `who`: a refusal throws the Worker's sentence with its status. */
function writesAs(db: DatabaseSync, who = FOUNDER) {
  const calls: Call[] = [];
  const request = async (path: string, opts: any = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
    const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const res = await withThrownResponses(() => app.request(`/api${path}`, {
        method: opts.method || 'GET', body: opts.body, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
      const raw = await res.text();
      const body = raw ? JSON.parse(raw) : null;
      if (!res.ok) throw Object.assign(new Error(String(body?.detail ?? res.status)), { status: res.status });
      return body;
    } finally { [console.warn, console.error] = saved; }
  };
  const record = (slug: string, id: string | number, project = P) => request(`/cycles/validate/modules/${slug}/records/${encodeURIComponent(String(id))}?project=${project}`);
  return { w: makeCycleWrites(request), calls, record };
}

/** A form's fields with what its `loadOptions` answered laid over each, as `FormLightbox`'s `formFields` lays them. */
const withLoaded = (fields: any[], loaded: any): any[] => fields.map((f) => ({ ...f, ...(loaded?.[f.name] ?? {}), ...(f.parts ? { parts: withLoaded(f.parts, loaded) } : {}) }));
const leaves = (list: any[]): any[] => list.flatMap((f) => (f.parts ? leaves(f.parts) : [f]));
async function opened(form: any, w: any, project = P) {
  const loaded = form.loadOptions ? await form.loadOptions(w, project) : {};
  const fields = withLoaded(form.fields, loaded);
  const shaped = { ...form, fields: fields.map((f: any) => (f.options ? { ...f, opts: f.options } : f)) };
  return { fields: shaped.fields, values: initialValues(shaped) as any, loaded };
}
const choices = (fields: any[], name: string) => (leaves(fields).find((f) => f.name === name)?.options ?? leaves(fields).find((f) => f.name === name)?.opts ?? []).map((o: any) => o.value);
async function refusal(work: () => Promise<unknown>) {
  try { await work(); } catch (e: any) { return { status: e.status, message: e.message }; }
  assert.fail('expected a refusal');
}
/** An Edit as the record page and a row open it: the record's Edit values, through `recordFormFor`. */
async function editOpened(slug: string, id: string | number, read: (s: string, i: string | number) => Promise<any>) {
  const rec = await read(slug, id);
  const spec = recordFormFor(recordEditAction(rec), rec, editFor('validate', slug));
  assert.ok(spec, `${slug} ${id}: its record declares an Edit`);
  return spec!;
}
const one = (db: DatabaseSync, sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;

// ---------------------------------------------------------------------------
// Test 12: each Add's body through its real route, read back on its table
// ---------------------------------------------------------------------------

test('12: New theme attaches the loaded unthemed quotes and feeds the chosen hypothesis', async () => {
  const db = fixture();
  const { w } = writesAs(db);
  const form = formFor('validate', 'problem-discovery');
  const { values, fields, loaded } = await opened(form, w);
  assert.equal(loaded.quotes.note, '2 unthemed quotes are waiting.');
  assert.deepEqual(choices(fields, 'hypothesis_id'), ['', '5']);
  assert.deepEqual(values.quotes, ['1:Close takes days', '1:Two tools: no sync'], 'the unthemed quotes, checked');
  const v = { ...values, title: 'Close is slow', hypothesis_id: '5' };
  assert.deepEqual(validate({ ...form, fields }, v), {});
  const out = await form.submit(w, P, v);
  const id = Number(out.id ?? out.theme_id ?? out.group?.id);
  assert.ok(id > 0, JSON.stringify(out));
  assert.equal(one(db, 'SELECT title FROM pain_groups WHERE id = ?', id).title, 'Close is slow');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM hypothesis_pain_links WHERE hypothesis_id = 5 AND pain_group_id = ?', id).n, 1);
  const after = await opened(form, w);
  assert.equal(after.loaded.quotes.note, undefined, 'no unthemed quote waits any more');
  // Every severity is accepted.
  for (const sev of choices(fields, 'severity')) assert.ok(await form.submit(w, P, { ...values, title: `Pain ${sev}`, severity: sev, quotes: [] }), sev);
});

test('12: New segment, Record a signal and New hypothesis save their bodies, every chip accepted', async () => {
  const db = fixture();
  const { w } = writesAs(db);
  const seg = formFor('validate', 'ideal-customer-profile');
  const sv = (await opened(seg, w)).values;
  for (const urgency of ['low', 'medium', 'high']) await seg.submit(w, P, { ...sv, name: `Finance ${urgency}`, urgency });
  await seg.submit(w, P, { ...sv, name: 'Finance since', score_against: 'since', score_since: '2026-09-01' });
  assert.equal(one(db, "SELECT score_since FROM customer_segments WHERE name = 'Finance since'").score_since?.slice(0, 10), '2026-09-01');
  assert.equal(one(db, "SELECT urgency FROM customer_segments WHERE name = 'Finance low'").urgency, 'low');

  const sig = formFor('validate', 'demand-signals');
  const { values: gv, fields: gf } = await opened(sig, w);
  for (const kind of choices(gf, 'kind')) {
    for (const status of choices(gf, 'status')) {
      await sig.submit(w, P, { ...gv, kind, status, who: `${kind} ${status}`, amount: '1,200', signal_date: '2026-10-12' });
      const row = one(db, 'SELECT kind, status, amount_cents FROM demand_signals WHERE project_id = ? AND who = ?', P, `${kind} ${status}`);
      assert.deepEqual([row.kind, row.status], [kind, status]);
      assert.equal(row.amount_cents, ['pre_sale', 'loi'].includes(kind) ? 120000 : null, `${kind}: an amount only where the route takes one`);
    }
  }

  const hyp = formFor('validate', 'experiments');
  const { values: hv, fields: hf } = await opened(hyp, w);
  assert.deepEqual(choices(hf, 'pain_group_id'), ['11']);
  assert.deepEqual(choices(hf, 'owner_user_id'), [String(FOUNDER)]);
  for (const direction of choices(hf, 'direction')) {
    const out = await hyp.submit(w, P, { ...hv, claim: `Claim ${direction}`, direction, pain_group_id: '11', owner_user_id: String(FOUNDER), deadline: '2026-10-31' });
    const id = Number(out.id ?? out.hypothesis_id);
    const h = one(db, 'SELECT owner_user_id, deadline FROM hypotheses WHERE id = ?', id);
    assert.deepEqual([h.owner_user_id, String(h.deadline).slice(0, 10)], [FOUNDER, '2026-10-31']);
    assert.equal(one(db, 'SELECT direction FROM hypothesis_pain_links WHERE hypothesis_id = ? AND pain_group_id = 11', id).direction, direction);
  }
});

test('12: Add competitor\'s search lists the caller\'s own candidates, then the directory; a directory match reads back with its name', async () => {
  const db = fixture();
  const { w, calls } = writesAs(db);
  const form = formFor('validate', 'market-intelligence');
  const found = await form.search(w, P, 'acme');
  assert.deepEqual(found.map((o: any) => [o.group, o.label, o.into]), [
    ['Your competitor analyses', 'Acme Ledger', 'company_ref'], ['Research › Companies', 'Acme Analytics', 'directory_uid'],
  ]);
  assert.ok(calls.some((c) => c.path === '/cycles/validate/modules/market-intelligence/form-options?project=1&q=acme'));
  const base = initialValues(form) as any;
  await form.submit(w, P, { ...base, company: 'Acme Analytics', directory_uid: 'dir-acme', kind: 'adjacent' });
  const fromDir = one(db, "SELECT name, category FROM competitor_candidates WHERE name = 'Acme Analytics'");
  assert.deepEqual([fromDir?.name, fromDir?.category], ['Acme Analytics', 'adjacent']);
  await form.submit(w, P, { ...base, company: 'Acme Ledger', company_ref: 'cand-acme' });
  await form.submit(w, P, { ...base, company: 'Ledgerline' });
  assert.ok(one(db, "SELECT COUNT(*) AS n FROM competitor_candidates WHERE name = 'Ledgerline'").n >= 1, 'a typed name is tracked by name');
  // Once tracked, a candidate is offered no more.
  assert.deepEqual((await form.search(w, P, 'acme')).map((o: any) => o.label), [], 'tracked companies leave the search');
});

// ---------------------------------------------------------------------------
// Test 12: each Edit opens from its record and moves only what it shows
// ---------------------------------------------------------------------------

test('12: each Validate Edit opens with its record\'s values and saves through its PATCH, with nothing else moved', async () => {
  const db = fixture();
  const { w, calls, record } = writesAs(db);
  // Make one of each, then edit it as the record page would.
  const seg = await formFor('validate', 'ideal-customer-profile').submit(w, P, { name: 'Fleet leads', urgency: 'high', who_they_are: 'Ops lead', score_against: 'since', score_since: '2026-09-01' });
  const segId = Number(seg.id ?? seg.segment_id);
  let spec = await editOpened('ideal-customer-profile', segId, record);
  assert.equal(spec.current.score_against, 'since', 'a stored date chooses Interviews since');
  await editFor('validate', 'ideal-customer-profile').submit(w, P, spec.id, { ...spec.current, urgency: 'low' });
  const s = one(db, 'SELECT urgency, who_they_are, score_since FROM customer_segments WHERE id = ?', segId);
  assert.deepEqual([s.urgency, s.who_they_are, String(s.score_since).slice(0, 10)], ['low', 'Ops lead', '2026-09-01'], 'score_since kept, not nulled');

  const sig = await formFor('validate', 'demand-signals').submit(w, P, { kind: 'pre_sale', who: 'Harbour Works', status: 'confirmed' });
  const sigId = `signal-${Number(sig.id ?? sig.signal_id)}`;
  spec = await editOpened('demand-signals', sigId, record);
  assert.equal(spec.current.amount, '', 'no amount is no amount, not 0');
  await editFor('validate', 'demand-signals').submit(w, P, spec.id, { ...spec.current, status: 'to_confirm' });
  const g = one(db, 'SELECT status, amount_cents, who FROM demand_signals WHERE id = ?', Number(sigId.slice(7)));
  assert.deepEqual([g.status, g.amount_cents, g.who], ['to_confirm', null, 'Harbour Works']);

  await w.validate.competitorUpdate(P, 'cand-route', { kind: 'direct', watch: { funding: true, launch: false, hiring: true } });
  spec = await editOpened('market-intelligence', 'cand-route', record);
  assert.deepEqual(spec.current.watch, ['funding', 'hiring'], 'the record\'s list of watched keys');
  await editFor('validate', 'market-intelligence').submit(w, P, spec.id, { ...spec.current, kind: 'adjacent' });
  assert.deepEqual(calls.at(-1)!.body, { kind: 'adjacent', watch: { funding: true, launch: false, hiring: true }, why: null });
  assert.equal(one(db, "SELECT category FROM competitor_candidates WHERE id = 'cand-route'").category, 'adjacent');

  spec = await editOpened('problem-discovery', 11, record);
  await editFor('validate', 'problem-discovery').submit(w, P, spec.id, { ...spec.current, title: 'Month-end takes a week' });
  assert.equal(one(db, 'SELECT title FROM pain_groups WHERE id = 11').title, 'Month-end takes a week');

  spec = await editOpened('experiments', 5, record);
  await editFor('validate', 'experiments').submit(w, P, spec.id, { ...spec.current, success_bar: '5 of 8 interviewees' });
  const h = one(db, 'SELECT claim, success_bar FROM hypotheses WHERE id = 5');
  assert.deepEqual([h.claim, h.success_bar], ['Controllers pay to skip month-end', '5 of 8 interviewees']);
});

// ---------------------------------------------------------------------------
// Test 13: another venture, and the write gate
// ---------------------------------------------------------------------------

test('13: another venture\'s choices are refused, and its ids answer 404 with the Worker\'s sentence; nothing is written', async () => {
  const db = fixture();
  const { w } = writesAs(db);
  for (const slug of Object.keys(FORMS.validate)) {
    const form = formFor('validate', slug);
    if (form.loadOptions) assert.equal((await refusal(() => form.loadOptions(w, PB))).status, 403, `${slug}: B's choices`);
  }
  assert.equal((await refusal(() => formFor('validate', 'market-intelligence').search(w, PB, 'acme'))).status, 403);
  const before = Number(one(db, 'SELECT COUNT(*) AS n FROM activity_logs').n);
  for (const [what, work] of [
    ['B\'s theme', () => w.validate.themeUpdate(P, 22, { title: 'x' })],
    ['B\'s segment', () => w.validate.segmentUpdate(P, 32, { urgency: 'low' })],
    ['B\'s competitor', () => w.validate.competitorUpdate(P, 'cand-b', { kind: 'adjacent' })],
    ['B\'s signal', () => w.validate.signalUpdate(P, 'signal-42', { status: 'to_confirm' })],
    ['B\'s hypothesis', () => w.validate.hypothesisUpdate(P, 23, { claim: 'x' })],
  ] as Array<[string, () => Promise<unknown>]>) {
    const r = await refusal(work);
    assert.equal(r.status, 404, what);
    assert.match(r.message, /not found/i, `${what}: the Worker's sentence`);
  }
  assert.equal(one(db, 'SELECT title FROM pain_groups WHERE id = 22').title, 'Their theme');
  assert.equal(Number(one(db, 'SELECT COUNT(*) AS n FROM activity_logs').n), before, 'nothing logged, so nothing written');
});

test('13: a partner, an investor and another venture\'s founder get the Worker\'s refusal on every Validate form, and nothing is written', async () => {
  const db = fixture();
  for (const who of [PARTNER, INVESTOR, OTHER]) {
    const { w } = writesAs(db, who);
    for (const slug of Object.keys(FORMS.validate)) {
      const form = formFor('validate', slug);
      if (form.loadOptions) assert.equal((await refusal(() => form.loadOptions(w, P))).status, 403, `${slug} choices as ${who}`);
    }
    for (const work of [
      () => w.validate.theme(P, { title: 'x' }), () => w.validate.segment(P, { name: 'x' }), () => w.validate.competitor(P, { name: 'x' }),
      () => w.validate.signal(P, { kind: 'waitlist' }), () => w.validate.hypothesis(P, { claim: 'x' }),
    ]) assert.equal((await refusal(work)).status, 403, `a write as ${who}`);
  }
  assert.equal(Number(one(db, 'SELECT COUNT(*) AS n FROM pain_groups WHERE project_id = ?', P).n), 1);
  assert.equal(Number(one(db, 'SELECT COUNT(*) AS n FROM activity_logs').n), 0);
});

test('12: Validate\'s five Adds and Edits are registered, and every Edit reads its record', () => {
  assert.deepEqual(Object.keys(FORMS.validate), ['problem-discovery', 'ideal-customer-profile', 'market-intelligence', 'demand-signals', 'experiments']);
  for (const [slug, edit] of Object.entries(EDITS.validate) as Array<[string, any]>) assert.equal(edit.readsRecord, true, slug);
});
