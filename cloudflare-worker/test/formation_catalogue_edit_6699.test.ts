/**
 * D6699 (#6699, plan key H3 of #6680): HQ edits the formation catalogue in a
 * draft — revision-checked, with a reason — diffs it against the published
 * version, records source checks, and changes the restricted places.
 *
 * Real schema (`loadSchema`, which already holds the seeded version 1,
 * D6690), real routes and services, synthetic catalogue. The fixture lays its
 * own version 2 and publishes it as the current one; its rows take ids from
 * 9001. Every firm, person, source and figure is fictional.
 *
 *   v2 (published, current)
 *     GB         gb_ltd   facts min_directors (recorded), share_capital (not recorded),
 *                         old_fact (provisional, checked 2024), argued (disputed);
 *                         fee registry_fee (sourced amount); pack item with template gb_articles;
 *                         a question; a scenario
 *     US         us_llc   no children
 *     rules      block_sanctioned, prefer_gb
 *
 * The issue's Done-when cases, each a test below:
 *   · a published version cannot be edited
 *   · a stale revision is refused with a conflict and nothing saved
 *   · a fact cannot be saved as `recorded` without a source and a date
 *   · the diff lists every changed fact, fee line and rule
 *   · a restricted-place change needs no deploy and is read by the next request
 * and the SHA-256s are deterministic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/formation_catalogue_edit_6699.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminRouter from '../src/routes/admin_formation_catalogue.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  canonicalContent, canonicalJson, contentSha256, diffContent, formTemplatesSha256, restrictedPlaces, rulesSha256, specOf, rowRevision,
  versionContent, type VersionContent,
} from '../src/services/formationCatalogueEdit.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { grantWriteBar } from './_write_bar_session.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'formation-edit-6699-'));
const seedPath = join(scratch, 'schema.sqlite');
const seed = new DatabaseSync(seedPath, SCHEMA_OPTIONS);
loadSchema(seed); seed.close();
after(() => rmSync(scratch, { recursive: true, force: true }));

const JWT_SECRET = 'synthetic-6699-only-not-a-real-credential'.repeat(2);
const SUPER = 1, ADMIN = 2, FOUNDER = 3;
const V = 9001, PUB = 2, GB = V, US = V + 1, GB_LTD = V, US_LLC = V + 1, SRC = V, SRC2 = V + 1;
const GB_BODY = '# Articles of association (synthetic)';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
let n = 0;

function fixture() {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, SCHEMA_OPTIONS);
  const user = db.prepare('INSERT INTO users(id, email, name, role) VALUES (?, ?, ?, ?)');
  user.run(SUPER, 'super@example.invalid', 'Sam Super', 'admin');
  user.run(ADMIN, 'plain@example.invalid', 'Pat Plain', 'admin');
  user.run(FOUNDER, 'founder@example.invalid', 'Fay Founder', 'founder');
  db.prepare('DELETE FROM super_admins').run();
  db.prepare('INSERT INTO super_admins(user_id) VALUES (?)').run(SUPER);
  db.exec(`UPDATE formation_catalogue_versions SET is_current = 0 WHERE is_current = 1`);
  db.exec(`
    INSERT INTO formation_catalogue_versions (id, version, status, is_current, notes) VALUES (${V}, ${PUB}, 'draft', 0, 'synthetic');
    INSERT INTO formation_sources (id, kind, title, url) VALUES
      (${SRC}, 'registry', 'Synthetic registry guidance', 'https://registry.example.invalid/guide'),
      (${SRC2}, 'statute', 'Synthetic act', 'https://law.example.invalid/act');
    INSERT INTO formation_jurisdictions (id, version_id, country, registry_name, vocabulary_json) VALUES
      (${GB}, ${V}, 'GB', 'Synthetic Registry', '{"b":2,"a":1}'), (${US}, ${V}, 'US', NULL, '{}');
    INSERT INTO formation_entity_forms (id, version_id, jurisdiction_id, form_key, label, offer_mode) VALUES
      (${GB_LTD}, ${V}, ${GB}, 'gb_ltd', 'Private limited company', 'orderable'),
      (${US_LLC}, ${V}, ${US}, 'us_llc', 'Limited liability company', 'guided');
    INSERT INTO formation_form_facts (version_id, form_id, fact_key, value, status, blocking, source_id, checked_on, checked_by) VALUES
      (${V}, ${GB_LTD}, 'min_directors', '1', 'recorded', 1, ${SRC}, '2026-10-01', ${ADMIN}),
      (${V}, ${GB_LTD}, 'share_capital', NULL, 'not_recorded', 0, NULL, NULL, NULL),
      (${V}, ${GB_LTD}, 'old_fact', 'x', 'provisional', 0, ${SRC}, '2024-01-01', ${ADMIN}),
      (${V}, ${GB_LTD}, 'argued', 'y', 'disputed', 0, ${SRC}, '2026-10-01', ${ADMIN});
    INSERT INTO formation_fee_lines (version_id, form_id, line_key, label, payee, collected_by, currency, amount_cents, timing, source_id, checked_on) VALUES
      (${V}, ${GB_LTD}, 'registry_fee', 'Registry fee', 'Synthetic Registry', 'payee', 'GBP', 5000, 'at_formation', ${SRC}, '2026-10-01');
    INSERT INTO formation_pack_items (version_id, form_id, item_key, phase, kind, acting_party, title, template_key, counsel_required, position) VALUES
      (${V}, ${GB_LTD}, 'articles', 'before_filing', 'document', 'axal', 'Articles of association', 'gb_articles', 1, 1);
    INSERT INTO formation_fact_schema (version_id, form_id, question_key, label, answer_kind) VALUES
      (${V}, ${GB_LTD}, 'company_name', 'Company name', 'text'), (${V}, NULL, 'founder_email', 'Your email', 'text');
    INSERT INTO formation_scenarios (version_id, form_id, scenario_key, route, conditions_json) VALUES
      (${V}, ${GB_LTD}, 'standard', 'axal_files', '{}');
    INSERT INTO formation_rules (version_id, rule_key, kind, rule_json, position) VALUES
      (${V}, 'block_sanctioned', 'block', '{"if":{"place_restricted":"sanctioned"}}', 1),
      (${V}, 'prefer_gb', 'recommend', '{"if":{"country":"GB"},"then":"gb_ltd"}', 2);
  `);
  db.exec(`UPDATE formation_catalogue_versions SET status = 'published', is_current = 1, published_by = ${SUPER}, published_at = '2026-11-01T00:00:00Z' WHERE id = ${V}`);
  db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, version, is_active, is_stub) VALUES ('gb_articles', 'Articles', 'formation', ?, 1, 1, 0)`).run(GB_BODY);
  const jti = grantWriteBar(db, SUPER);
  const d1 = d1Over(db);
  const env = { DB: d1 as any, JWT_SECRET, ENVIRONMENT: 'development' } as any;
  return { db, env, d1, jti };
}
type F = ReturnType<typeof fixture>;

const app = new Hono<any>();
app.route('/api/admin/formation/catalogue', adminRouter);
app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
const BASE = '/api/admin/formation/catalogue';
async function call(f: F, who: number | null, method: string, path: string, body?: unknown, bar = false, env = f.env) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who !== null) {
    const claims: Record<string, unknown> = { user_id: who };
    if (bar) claims.jti = f.jti;
    headers.Authorization = `Bearer ${await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await app.request(`${BASE}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const audit = (f: F) => (f.db.prepare(`SELECT action, filters_json FROM admin_audit_log ORDER BY id`).all() as any[]).map((r) => ({ action: r.action, ...JSON.parse(r.filters_json || '{}') }));
const fact = (f: F, version: number, key: string) => f.db.prepare(
  `SELECT x.value, x.status, x.source_id, x.checked_on, x.checked_by FROM formation_form_facts x JOIN formation_catalogue_versions v ON v.id = x.version_id
    JOIN formation_entity_forms fm ON fm.id = x.form_id WHERE v.version = ? AND fm.form_key = 'gb_ltd' AND x.fact_key = ?`,
).get(version, key) as any;
// node:sqlite rows have a null prototype; spread them for deepEqual.
async function draft(f: F) {
  const r = await call(f, ADMIN, 'POST', '/drafts', { reason: 'Annual review' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.version as number;
}
async function revisionOf(f: F, version: number, entity: string, match: (row: any) => boolean) {
  const r = await call(f, ADMIN, 'GET', `/versions/${version}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = r.body.content[entity].find(match);
  assert.ok(row, `no ${entity} row`);
  return row.revision as string;
}
const MIN_DIRECTORS = { form_key: 'gb_ltd', fact_key: 'min_directors' };

test('HQ authoring only: a founder is refused; an HQ admin reads the versions', async () => {
  const f = fixture();
  assert.equal((await call(f, null, 'GET', '/versions')).status, 401);
  assert.equal((await call(f, FOUNDER, 'GET', '/versions')).status, 403);
  assert.equal((await call(f, FOUNDER, 'POST', '/drafts', { reason: 'x' })).status, 403);
  const r = await call(f, ADMIN, 'GET', '/versions');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.versions.map((v: any) => [v.version, v.status, v.is_current]), [[2, 'published', true], [1, 'published', false]]);
});

test('a published version cannot be edited; nor can one in review; nothing is saved', async () => {
  const f = fixture();
  const rev = await revisionOf(f, PUB, 'facts', (x) => x.fact_key === 'min_directors');
  const r = await call(f, ADMIN, 'PUT', `/drafts/${PUB}/facts`, { key: MIN_DIRECTORS, fields: { value: '2' }, revision: rev, reason: 'Fix' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'version_not_draft');
  // mutation: the route's draft check dropped → the store's trigger answers, with another sentence.
  assert.match(r.body.message, /Version 2 is published, and only a draft is edited/);
  const del = await call(f, ADMIN, 'DELETE', `/drafts/${PUB}/facts`, { key: MIN_DIRECTORS, revision: rev, reason: 'Fix' });
  assert.equal(del.body.error, 'version_not_draft');
  assert.equal(fact(f, PUB, 'min_directors').value, '1', 'the published fact is unchanged');
  // In review is not a draft either, though the store would let it change.
  const v = await draft(f);
  f.db.exec(`UPDATE formation_catalogue_versions SET status = 'in_review' WHERE version = ${v}`);
  const rev3 = await revisionOf(f, v, 'facts', (x) => x.fact_key === 'min_directors');
  const inReview = await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key: MIN_DIRECTORS, fields: { value: '2' }, revision: rev3, reason: 'Fix' });
  assert.equal(inReview.status, 409);
  assert.equal(inReview.body.error, 'version_not_draft');
  assert.equal(fact(f, v, 'min_directors').value, '1', 'nothing saved in review');
  assert.deepEqual(audit(f).map((a) => a.action), ['formation_catalogue_draft_created'], 'no edit recorded');
});

test('a draft is a copy of the current version: same content SHA-256, one open at a time, logged with its reason', async () => {
  const f = fixture();
  assert.equal((await call(f, ADMIN, 'POST', '/drafts', {})).body.error, 'reason_required');
  const v = await draft(f);
  assert.equal(v, 3);
  const pub = (await call(f, ADMIN, 'GET', `/versions/${PUB}`)).body;
  const dr = (await call(f, ADMIN, 'GET', `/versions/${v}`)).body;
  assert.equal(dr.version.status, 'draft');
  assert.equal(dr.content_sha256, pub.content_sha256, 'the copy holds the same content');
  assert.equal(dr.rules_sha256, pub.rules_sha256);
  assert.deepEqual(dr.form_templates, pub.form_templates);
  for (const e of ['countries', 'forms', 'facts', 'fees', 'pack', 'questions', 'scenarios', 'rules']) {
    assert.ok(dr.content[e].length > 0, `${e} copied`);
    assert.deepEqual(dr.content[e], pub.content[e], `${e} copied row for row, revisions included`);
  }
  const again = await call(f, ADMIN, 'POST', '/drafts', { reason: 'Second' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'draft_open');
  assert.deepEqual(audit(f).map((a) => [a.action, a.reason, a.version, a.from_version]), [['formation_catalogue_draft_created', 'Annual review', 3, 2]]);
});

test('a stale revision is refused with a conflict and nothing is saved', async () => {
  const f = fixture();
  const v = await draft(f);
  const rev = await revisionOf(f, v, 'facts', (x) => x.fact_key === 'min_directors');
  const first = await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key: MIN_DIRECTORS, fields: { value: '2' }, revision: rev, reason: 'Registry changed' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.notEqual(first.body.revision, rev, 'the revision moves with the content');
  // Someone else still holds the old revision.
  const stale = await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key: MIN_DIRECTORS, fields: { value: '3' }, revision: rev, reason: 'Mine' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'revision_conflict');
  assert.equal(stale.body.current_revision, first.body.revision);
  assert.equal(fact(f, v, 'min_directors').value, '2', 'nothing saved');
  const staleDelete = await call(f, ADMIN, 'DELETE', `/drafts/${v}/facts`, { key: MIN_DIRECTORS, revision: rev, reason: 'Mine' });
  assert.equal(staleDelete.body.error, 'revision_conflict');
  assert.ok(fact(f, v, 'min_directors'), 'not removed');
  // Creating a row that exists is a conflict too.
  const dup = await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key: MIN_DIRECTORS, fields: { value: '4' }, revision: null, reason: 'Mine' });
  assert.equal(dup.body.error, 'revision_conflict');
  assert.equal(fact(f, v, 'min_directors').value, '2');
  assert.deepEqual(audit(f).map((a) => a.action), ['formation_catalogue_draft_created', 'formation_catalogue_row_edited']);
});

test('a write that loses a race after its revision was checked changes nothing (compare-and-set)', async () => {
  const f = fixture();
  const v = await draft(f);
  const rev = await revisionOf(f, v, 'facts', (x) => x.fact_key === 'min_directors');
  // Another request lands between the revision check and the write.
  const racing = { ...f.env, DB: { ...f.d1, batch: async (stmts: any[]) => {
    f.db.exec(`UPDATE formation_form_facts SET value = 'raced' WHERE fact_key = 'min_directors' AND version_id = (SELECT id FROM formation_catalogue_versions WHERE version = ${v})`);
    return f.d1.batch(stmts);
  } } };
  const r = await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key: MIN_DIRECTORS, fields: { value: '2' }, revision: rev, reason: 'Mine' }, false, racing);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'revision_conflict');
  // mutation: a column dropped from the update's WHERE → the raced value is overwritten.
  assert.equal(fact(f, v, 'min_directors').value, 'raced', 'the other write stands');
  assert.deepEqual(audit(f).map((a) => a.action), ['formation_catalogue_draft_created'], 'no record of a write that did not happen');
});

test('a fact cannot be saved as recorded without a source and a date; with both, the checker is recorded', async () => {
  const f = fixture();
  const v = await draft(f);
  const key = { form_key: 'gb_ltd', fact_key: 'share_capital' };
  let rev = await revisionOf(f, v, 'facts', (x) => x.fact_key === 'share_capital');
  const none = await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key, fields: { value: '100', status: 'recorded' }, revision: rev, reason: 'Known' });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, 'fact_unsourced');
  const noDay = await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key, fields: { value: '100', status: 'recorded', source_id: SRC }, revision: rev, reason: 'Known' });
  assert.equal(noDay.body.error, 'fact_unsourced');
  const noSource = await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key, fields: { value: '100', status: 'recorded', checked_on: '2026-11-01' }, revision: rev, reason: 'Known' });
  assert.equal(noSource.body.error, 'fact_unsourced');
  const newFact = await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key: { form_key: 'gb_ltd', fact_key: 'brand_new' }, fields: { value: '1', status: 'recorded' }, revision: null, reason: 'New' });
  assert.equal(newFact.body.error, 'fact_unsourced', 'a new row is held to the same rule');
  assert.deepEqual({ ...fact(f, v, 'share_capital') }, { value: null, status: 'not_recorded', source_id: null, checked_on: null, checked_by: null }, 'nothing saved');
  assert.equal(fact(f, v, 'brand_new'), undefined);
  const future = await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key, fields: { value: '100', status: 'recorded', source_id: SRC, checked_on: '2999-01-01' }, revision: rev, reason: 'Known' });
  assert.equal(future.body.error, 'invalid_field', 'a check day is not in the future');
  const ok = await call(f, SUPER, 'PUT', `/drafts/${v}/facts`, { key, fields: { value: '100', status: 'recorded', source_id: SRC, checked_on: '2026-11-01' }, revision: rev, reason: 'Read the registry' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual({ ...fact(f, v, 'share_capital') }, { value: '100', status: 'recorded', source_id: SRC, checked_on: '2026-11-01', checked_by: SUPER });
  // A fee amount is held to the same rule.
  rev = await revisionOf(f, v, 'fees', (x) => x.line_key === 'registry_fee');
  const fee = await call(f, ADMIN, 'PUT', `/drafts/${v}/fees`, { key: { form_key: 'gb_ltd', line_key: 'registry_fee' }, fields: { source_id: null }, revision: rev, reason: 'x' });
  assert.equal(fee.body.error, 'fee_unsourced');
  const missing = await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key, fields: { source_id: 424242 }, revision: ok.body.revision, reason: 'x' });
  assert.equal(missing.body.error, 'source_not_found');
  assert.equal((await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key, fields: { value: '1' }, revision: ok.body.revision })).body.error, 'reason_required');
  assert.equal((await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key, fields: { colour: 'red' }, revision: ok.body.revision, reason: 'x' })).body.error, 'unknown_field');
});

test('the diff lists every changed fact, fee line and rule, and every other row, with each field', async () => {
  const f = fixture();
  const v = await draft(f);
  const save = async (entity: string, key: any, fields: any, match: (x: any) => boolean | null) => {
    const revision = match ? await revisionOf(f, v, entity, match) : null;
    const r = await call(f, ADMIN, 'PUT', `/drafts/${v}/${entity}`, { key, fields, revision, reason: 'Review' });
    assert.ok(r.status === 200 || r.status === 201, `${entity}: ${JSON.stringify(r.body)}`);
  };
  const remove = async (entity: string, key: any, match: (x: any) => boolean) => {
    const r = await call(f, ADMIN, 'DELETE', `/drafts/${v}/${entity}`, { key, revision: await revisionOf(f, v, entity, match), reason: 'Gone' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  await save('facts', MIN_DIRECTORS, { value: '2' }, (x) => x.fact_key === 'min_directors');
  await save('facts', { form_key: 'gb_ltd', fact_key: 'max_shareholders' }, { value: '50', status: 'provisional' }, null as any);
  await remove('facts', { form_key: 'gb_ltd', fact_key: 'argued' }, (x) => x.fact_key === 'argued');
  await save('fees', { form_key: 'gb_ltd', line_key: 'registry_fee' }, { amount_cents: 5500, checked_on: '2026-11-02' }, (x) => x.line_key === 'registry_fee');
  await save('fees', { form_key: 'us_llc', line_key: 'state_fee' }, { label: 'State fee', payee: 'Synthetic State', collected_by: 'payee', currency: 'USD', timing: 'at_formation' }, null as any);
  await save('rules', { rule_key: 'prefer_gb' }, { rule: { if: { country: 'GB' }, then: 'gb_ltd', weight: 2 } }, (x) => x.rule_key === 'prefer_gb');
  await remove('rules', { rule_key: 'block_sanctioned' }, (x) => x.rule_key === 'block_sanctioned');
  await save('rules', { rule_key: 'warn_counsel' }, { kind: 'warn', rule: { if: { counsel_only: true } } }, null as any);
  await save('countries', { country: 'SG' }, { registry_name: 'Synthetic ACRA' }, null as any);
  await save('forms', { form_key: 'sg_pte' }, { label: 'Private limited (SG)', jurisdiction: { country: 'SG' } }, null as any);
  await save('scenarios', { form_key: 'gb_ltd', scenario_key: 'standard' }, { waiver_allowed: true }, (x) => x.scenario_key === 'standard');
  await save('questions', { form_key: null, question_key: 'founder_email' }, { required: false }, (x) => x.question_key === 'founder_email');
  await save('pack', { form_key: 'gb_ltd', item_key: 'articles' }, { position: 5 }, (x) => x.item_key === 'articles');

  const d = await call(f, ADMIN, 'GET', `/versions/${v}/diff`);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.deepEqual(d.body.from, { version: 2, status: 'published' });
  const seen = d.body.changes.map((x: any) => `${x.entity} ${x.change} ${Object.values(x.key).join('/')}`).sort();
  assert.deepEqual(seen, [
    'countries added SG/',
    'facts added gb_ltd/max_shareholders',
    'facts changed gb_ltd/min_directors',
    'facts removed gb_ltd/argued',
    'fees added us_llc/state_fee',
    'fees changed gb_ltd/registry_fee',
    'forms added sg_pte',
    'pack changed gb_ltd/articles',
    'questions changed /founder_email',
    'rules added warn_counsel',
    'rules changed prefer_gb',
    'rules removed block_sanctioned',
    'scenarios changed gb_ltd/standard',
  ]);
  assert.deepEqual(d.body.totals, { added: 5, removed: 2, changed: 6 });
  const one = (entity: string, k: string) => d.body.changes.find((x: any) => x.entity === entity && Object.values(x.key).join('/') === k);
  assert.deepEqual(one('facts', 'gb_ltd/min_directors').fields, [{ field: 'value', from: '1', to: '2' }]);
  assert.deepEqual(one('fees', 'gb_ltd/registry_fee').fields.map((x: any) => [x.field, x.from, x.to]),
    [['amount_cents', 5000, 5500], ['checked_by', null, ADMIN], ['checked_on', '2026-10-01', '2026-11-02']]);
  assert.deepEqual(one('rules', 'prefer_gb').fields, [{ field: 'rule', from: { if: { country: 'GB' }, then: 'gb_ltd' }, to: { if: { country: 'GB' }, then: 'gb_ltd', weight: 2 } }]);
  assert.equal(one('rules', 'block_sanctioned').fields.find((x: any) => x.field === 'kind').from, 'block');
  // The draft against itself, and the published version against itself, have nothing to show.
  assert.deepEqual((await call(f, ADMIN, 'GET', `/versions/${v}/diff?against=${v}`)).body.changes, []);
  assert.deepEqual((await call(f, ADMIN, 'GET', `/versions/${PUB}/diff`)).body.changes, []);
  // Every edit was logged with its reason.
  const edits = audit(f).filter((a) => a.action !== 'formation_catalogue_draft_created');
  assert.equal(edits.length, 13);
  assert.ok(edits.every((a) => a.reason === 'Review' || a.reason === 'Gone'));
  assert.deepEqual(edits.filter((a) => a.action === 'formation_catalogue_row_removed').map((a) => a.entity), ['facts', 'rules']);
});

test('a row other rows hang from is not removed; a country must exist before its form', async () => {
  const f = fixture();
  const v = await draft(f);
  const formRev = await revisionOf(f, v, 'forms', (x) => x.form_key === 'gb_ltd');
  assert.equal((await call(f, ADMIN, 'DELETE', `/drafts/${v}/forms`, { key: { form_key: 'gb_ltd' }, revision: formRev, reason: 'x' })).body.error, 'row_in_use');
  const usRev = await revisionOf(f, v, 'countries', (x) => x.country === 'US');
  assert.equal((await call(f, ADMIN, 'DELETE', `/drafts/${v}/countries`, { key: { country: 'US' }, revision: usRev, reason: 'x' })).body.error, 'row_in_use');
  const llcRev = await revisionOf(f, v, 'forms', (x) => x.form_key === 'us_llc');
  assert.equal((await call(f, ADMIN, 'DELETE', `/drafts/${v}/forms`, { key: { form_key: 'us_llc' }, revision: llcRev, reason: 'Withdrawn' })).status, 200);
  assert.equal((await call(f, ADMIN, 'PUT', `/drafts/${v}/forms`, { key: { form_key: 'fr_sas' }, fields: { label: 'SAS', jurisdiction: { country: 'FR' } }, revision: null, reason: 'x' })).body.error, 'country_not_found');
  assert.equal((await call(f, ADMIN, 'PUT', `/drafts/${v}/facts`, { key: { form_key: 'nope', fact_key: 'a' }, fields: {}, revision: null, reason: 'x' })).body.error, 'form_not_found');
  assert.equal((await call(f, ADMIN, 'PUT', `/drafts/${v}/widgets`, { key: {}, reason: 'x' })).body.error, 'unknown_entity');
  assert.equal((await call(f, ADMIN, 'DELETE', `/drafts/${v}/facts`, { key: MIN_DIRECTORS, reason: 'x' })).body.error, 'revision_required');
});

test('a source check records the day, the checker and the result; stale and disputed facts are listed', async () => {
  const f = fixture();
  const added = await call(f, ADMIN, 'POST', '/sources', { kind: 'registry', title: 'Synthetic fees page', url: 'https://fees.example.invalid', reason: 'New source' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal((await call(f, ADMIN, 'POST', '/sources', { kind: 'registry', title: 'Plain', url: 'http://insecure.example.invalid', reason: 'x' })).body.error, 'invalid_field');
  assert.equal((await call(f, ADMIN, 'POST', `/sources/${SRC}/checks`, { checked_on: '2999-01-01', outcome: 'unchanged', reason: 'x' })).body.error, 'invalid_field');
  assert.equal((await call(f, ADMIN, 'POST', `/sources/${SRC}/checks`, { checked_on: '2026-11-10', outcome: 'gone', reason: 'x' })).body.error, 'invalid_field');
  assert.equal((await call(f, ADMIN, 'POST', `/sources/424242/checks`, { checked_on: '2026-11-10', outcome: 'unchanged', reason: 'x' })).status, 404);
  const check = await call(f, SUPER, 'POST', `/sources/${SRC}/checks`, { checked_on: '2026-11-10', outcome: 'changed', note: 'Fee went up', reason: 'Quarterly check' });
  assert.equal(check.status, 201, JSON.stringify(check.body));
  const list = (await call(f, ADMIN, 'GET', '/sources')).body.sources;
  assert.deepEqual(list.find((s: any) => s.id === SRC).last_check, { checked_on: '2026-11-10', outcome: 'changed', checked_by: SUPER });
  assert.equal(list.find((s: any) => s.id === SRC2).last_check, null, 'never checked reads null');
  assert.ok(list.some((s: any) => s.title === 'Synthetic fees page'));
  const row = f.db.prepare(`SELECT checked_on, checked_by, outcome, note FROM formation_source_checks WHERE source_id = ?`).get(SRC) as any;
  assert.deepEqual({ ...row }, { checked_on: '2026-11-10', checked_by: SUPER, outcome: 'changed', note: 'Fee went up' });
  const a = (await call(f, ADMIN, 'GET', `/versions/${PUB}/attention`)).body;
  assert.equal(a.max_age_days, 183);
  assert.deepEqual(a.stale.map((x: any) => x.fact_key), ['old_fact']);
  assert.deepEqual(a.disputed.map((x: any) => x.fact_key), ['argued']);
  assert.deepEqual(audit(f).map((x) => [x.action, x.reason]), [['formation_source_added', 'New source'], ['formation_source_checked', 'Quarterly check']]);
});

test('restricted places: Super Admin, with a reason, a source and a checked day; a change is read by the next request', async () => {
  const f = fixture();
  const place = { place: 'ir', kind: 'sanctioned', source_id: SRC2, checked_on: '2026-11-01', reason: 'Sanctions list' };
  const plain = await call(f, ADMIN, 'POST', '/restricted', place);
  assert.equal(plain.status, 403);
  assert.equal(plain.body.error, 'super_admin_required');
  assert.equal((await call(f, SUPER, 'POST', '/restricted', place)).status, 403, 'the write bar is needed');
  assert.equal((await call(f, SUPER, 'POST', '/restricted', { ...place, reason: '' }, true)).body.error, 'reason_required');
  assert.equal((await call(f, SUPER, 'POST', '/restricted', { ...place, source_id: undefined }, true)).body.error, 'source_required');
  assert.equal((await call(f, SUPER, 'POST', '/restricted', { ...place, checked_on: undefined }, true)).body.error, 'checked_on_required');
  assert.equal((await call(f, SUPER, 'POST', '/restricted', { ...place, source_id: 424242 }, true)).body.error, 'source_not_found');
  assert.deepEqual(await restrictedPlaces(f.env), [], 'nothing saved by a refused write');
  const added = await call(f, SUPER, 'POST', '/restricted', place, true);
  assert.equal(added.status, 201, JSON.stringify(added.body));
  // The very next read sees it: no cache, no deploy.
  let now = (await call(f, ADMIN, 'GET', '/restricted')).body.places;
  assert.deepEqual(now.map((p: any) => [p.place, p.kind, p.source.id, p.checked_on, p.checked_by]), [['IR', 'sanctioned', SRC2, '2026-11-01', SUPER]]);
  assert.equal((await call(f, SUPER, 'POST', '/restricted', place, true)).body.error, 'place_exists');
  const id = added.body.id;
  assert.equal((await call(f, SUPER, 'PATCH', `/restricted/${id}`, { kind: 'counsel_only', source_id: SRC2, reason: 'x' }, true)).body.error, 'checked_on_required');
  const edited = await call(f, SUPER, 'PATCH', `/restricted/${id}`, { kind: 'counsel_only', source_id: SRC, checked_on: '2026-11-15', reason: 'Licence granted' }, true);
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  now = await restrictedPlaces(f.env);
  assert.deepEqual(now.map((p) => [p.place, p.kind, p.source.id, p.checked_on]), [['IR', 'counsel_only', SRC, '2026-11-15']]);
  assert.equal((await call(f, ADMIN, 'DELETE', `/restricted/${id}`, { reason: 'x' })).status, 403);
  assert.equal((await call(f, SUPER, 'DELETE', `/restricted/${id}`, {}, true)).body.error, 'reason_required');
  assert.equal((await call(f, SUPER, 'DELETE', `/restricted/${id}`, { reason: 'Lifted' }, true)).status, 200);
  assert.deepEqual((await call(f, ADMIN, 'GET', '/restricted')).body.places, [], 'removed on the next read');
  assert.deepEqual(audit(f).map((a) => [a.action, a.reason]), [
    ['formation_restricted_place_added', 'Sanctions list'], ['formation_restricted_place_edited', 'Licence granted'], ['formation_restricted_place_removed', 'Lifted'],
  ]);
});

// ── the SHA-256s ──

const empty = (): VersionContent => ({ countries: [], forms: [], facts: [], fees: [], pack: [], questions: [], scenarios: [], rules: [] });

test('content_sha256 is the SHA-256 of the canonical content: pinned, and blind to ids, row order and JSON key order', async () => {
  const raw = {
    ...empty(),
    countries: [{ id: 1, country: 'GB', subdivision: null, registry_name: null, vocabulary_json: '{}' }],
    rules: [
      { id: 7, rule_key: 'b', kind: 'warn', rule_json: '{"y":1,"x":2}', position: 0 },
      { id: 3, rule_key: 'a', kind: 'block', rule_json: '{}', position: 1 },
    ],
  } as any;
  const content = canonicalContent(raw);
  const expected = '{"countries":[{"country":"GB","registry_name":null,"subdivision":null,"vocabulary":{}}],"facts":[],"fees":[],"forms":[],"pack":[],"questions":[],'
    + '"rules":[{"kind":"block","position":1,"rule":{},"rule_key":"a"},{"kind":"warn","position":0,"rule":{"x":2,"y":1},"rule_key":"b"}],"scenarios":[]}';
  assert.equal(canonicalJson(content), expected);
  assert.equal(await contentSha256(content), sha(expected), 'pinned: the hash of exactly this text');
  const shuffled = canonicalContent({ ...raw, rules: [{ ...raw.rules[1], id: 99 }, { ...raw.rules[0], id: 100, rule_json: '{"x":2,"y":1}' }] });
  assert.equal(await contentSha256(shuffled), await contentSha256(content), 'ids, row order and key order do not count');
  assert.equal(await rulesSha256(shuffled), await rulesSha256(content));
  assert.equal(await rulesSha256(content), sha(canonicalJson(content.rules)));
  const changed = canonicalContent({ ...raw, rules: [raw.rules[0], { ...raw.rules[1], position: 2 }] });
  assert.notEqual(await contentSha256(changed), await contentSha256(content), 'any value counts');
  assert.notEqual(await rulesSha256(changed), await rulesSha256(content));
  const factOnly = canonicalContent({ ...raw, countries: [{ ...raw.countries[0], registry_name: 'Synthetic' }] });
  assert.notEqual(await contentSha256(factOnly), await contentSha256(content));
  assert.equal(await rulesSha256(factOnly), await rulesSha256(content), 'the rule set\'s hash covers only the rules');
  // A row's revision is the hash of its canonical row.
  const spec = specOf('rules')!;
  assert.equal(await rowRevision(spec, raw.rules[1]), sha('{"kind":"block","position":1,"rule":{},"rule_key":"a"}'));
});

test('each form\'s templates hash covers its template items and their bodies, form by form', async () => {
  const content = canonicalContent({
    ...empty(),
    forms: [
      { id: 1, form_key: 'gb_ltd', country: 'GB', subdivision: null, label: 'L', offer_mode: 'off', legal_form_family: null, legacy_gate: null, legacy_display_json: null, allow_axal_collection: 0 },
      { id: 2, form_key: 'us_llc', country: 'US', subdivision: null, label: 'L', offer_mode: 'off', legal_form_family: null, legacy_gate: null, legacy_display_json: null, allow_axal_collection: 0 },
    ],
    pack: [
      { id: 1, form_key: 'gb_ltd', item_key: 'articles', phase: 'before_filing', kind: 'document', acting_party: 'axal', title: 'A', template_key: 'gb_articles', counsel_required: 1, position: 0 },
      { id: 2, form_key: 'gb_ltd', item_key: 'file', phase: 'filing', kind: 'filing', acting_party: 'provider', title: 'F', template_key: null, counsel_required: 1, position: 1 },
      { id: 3, form_key: 'us_llc', item_key: 'operating', phase: 'before_filing', kind: 'document', acting_party: 'axal', title: 'O', template_key: 'llc_oa', counsel_required: 0, position: 0 },
    ],
  } as any);
  const bodies: Record<string, string | null> = { gb_articles: 'Body one', llc_oa: null };
  const run = () => formTemplatesSha256(content, async (slug) => bodies[slug] ?? null);
  const a = await run();
  const b = await run();
  assert.deepEqual(a, b, 'deterministic');
  const gb = a.find((x) => x.form_key === 'gb_ltd')!;
  assert.deepEqual(gb.templates, [{ item_key: 'articles', template_key: 'gb_articles', counsel_required: 1, body_sha256: sha('Body one') }], 'only items that name a template');
  assert.equal(gb.templates_sha256, sha(canonicalJson({ form_key: 'gb_ltd', templates: gb.templates })));
  assert.equal(a.find((x) => x.form_key === 'us_llc')!.templates[0].body_sha256, null, 'no active body reads null');
  bodies.gb_articles = 'Body two';
  const c = await run();
  assert.notEqual(c.find((x) => x.form_key === 'gb_ltd')!.templates_sha256, gb.templates_sha256, 'a body change changes the form\'s hash');
  assert.equal(c.find((x) => x.form_key === 'us_llc')!.templates_sha256, a.find((x) => x.form_key === 'us_llc')!.templates_sha256, 'and no other form\'s');
});

test('the diff of canonical content compares values, not ids', async () => {
  const f = fixture();
  const v = await draft(f);
  const [pub, dr] = await Promise.all([
    versionContent(f.env, (f.db.prepare('SELECT id FROM formation_catalogue_versions WHERE version = ?').get(PUB) as any).id),
    versionContent(f.env, (f.db.prepare('SELECT id FROM formation_catalogue_versions WHERE version = ?').get(v) as any).id),
  ]);
  assert.deepEqual(diffContent(pub, dr), []);
  assert.equal(await contentSha256(pub), await contentSha256(dr));
  assert.deepEqual(pub.countries.find((x) => x.country === 'GB')!.vocabulary, { a: 1, b: 2 }, 'a JSON column is read as its value');
});
