/** D7674 part 2 (#7674): the organisation-only controlled apply over the migrated schema. Synthetic organisations only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import directory from '../src/routes/network_directory.ts';
import { readiness } from '../src/services/networkDirectory.ts';
import { APPLY_CONTRACT, APPLY_SCHEMA, recordsDigest, replan } from '../src/services/networkDirectoryApply.ts';
import { VERSION, buildDirectoryPlan } from '../../scripts/lib/networkDirectoryPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

test.after(removeMigratedDatabases);
const SECRET = 'synthetic-7674-apply-secret-'.repeat(3);
const PATH = '/admin/organisation-apply';
const T1 = '2026-11-20T10:00:00.000Z';
const T2 = '2026-11-21T10:00:00.000Z';

/** Member 1, plain admin 8, Super Admin 9, each with a stepped-up TOTP session. */
function fixture(environment = 'development') {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,email,name,role,is_active) VALUES
      (1,'member@example.test','Synthetic member','founder',1),
      (8,'admin@example.test','Synthetic admin','admin',1),
      (9,'super@example.test','Synthetic super admin','admin',1);
    INSERT INTO super_admins(user_id) VALUES (9);
  `);
  for (const id of [1, 8, 9]) db.prepare(`INSERT INTO user_sessions(user_id,jti,factor,assurance_level,last_step_up_at) VALUES (?,?,'totp','totp',datetime('now'))`).run(id, 'synthetic-' + id);
  const app = new Hono<any>().route('/api/network/directory', directory);
  app.onError((e, c) => c.json({ error: 'refused' }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: environment } as any;
  async function call(path: string, method = 'POST', who: number | null = 9, body?: unknown, opts: { claims?: Record<string, unknown>; env?: any; raw?: string } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who !== null) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who, jti: 'synthetic-' + who, ...(opts.claims ?? {}) })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const pending: Promise<unknown>[] = [];
    const r = await app.request('https://unit.test/api/network/directory' + path,
      { method, headers, body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)) }, opts.env ?? env,
      { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} } as any);
    await Promise.allSettled(pending);
    return { status: r.status, body: await r.json() as any };
  }
  const n = (sql: string) => Number((db.prepare(sql).get() as any).n);
  const counts = () => Object.fromEntries(['network_directory_entries', 'network_directory_source_records', 'network_directory_private_sources',
    'network_directory_import_rows', 'network_directory_import_runs', 'network_directory_reviews', 'network_directory_affiliations']
    .map(t => [t, n(`SELECT COUNT(*) AS n FROM ${t}`)]));
  return { db, env, call, n, counts };
}

const org = (id: string, name: string, observedAt = T1, extra: Record<string, unknown> = {}) => ({
  source: 'airtable_angels', source_record_id: id, observed_at: observedAt,
  raw_fields: { Name: name, Type: ['VC'], Headquarters: 'Example Region', 'Sector Focus': ['Software'], 'Currently investing?': 'Yes',
    LinkedIn: `https://www.linkedin.com/company/${id.toLowerCase()}`, ...extra },
});
const row = (id: string, disposition = 'accept', extra: Record<string, unknown> = {}) =>
  ({ source: 'airtable_angels', source_record_id: id, entity_kind: 'organization', disposition, ...extra });

/** What a Super Admin's browser sends: the reviewed records and manifest, and the digest and run id the offline planner printed. */
async function upload(records: any[], manifest: any, over: Record<string, unknown> = {}) {
  const plan = buildDirectoryPlan({ records, manifest });
  return { contract: APPLY_CONTRACT, target_environment: 'development', schema: APPLY_SCHEMA, planner_version: VERSION,
    snapshot: { records_sha256: await recordsDigest(records), record_count: records.length },
    plan: { run_uid: plan.summary.run_uid, review_manifest_hash: plan.summary.review_manifest_hash }, manifest, records, ...over };
}

const THREE = [org('recOrgA', 'Alpha Example Ventures'), org('recOrgB', 'Beta Example Capital'), org('recOrgC', 'Gamma Example Partners')];
const THREE_MANIFEST = { version: 1, rows: [row('recOrgA'), row('recOrgB'), row('recOrgC', 'review', { reasons: ['synthetic_website_check'] })] };
const SIDE_EFFECT_TABLES = ['partner_relationships', 'network_connections', 'notifications_inbox', 'network_directory_book_links', 'user_company_links',
  'company_people', 'company_profiles', 'network_directory_publication_events', 'network_directory_research_links'];

test('access: members, plain admins, a stale step-up and a support session are refused, and nothing is written', async () => {
  const f = fixture();
  const body = await upload(THREE, THREE_MANIFEST);
  assert.equal((await f.call(PATH, 'POST', null, body)).status, 401);
  assert.equal((await f.call(PATH, 'POST', 1, body)).status, 403, 'a member');
  assert.equal((await f.call(PATH, 'POST', 8, body)).status, 403, 'a plain admin');
  const support = await f.call(PATH, 'POST', 9, body, { claims: { impersonated_by: 8 } });
  assert.equal(support.status, 403);
  assert.equal(support.body.error, 'support_session_refused');
  f.db.exec("UPDATE user_sessions SET created_at=datetime('now','-2 days'), last_step_up_at=datetime('now','-2 days') WHERE user_id=9");
  const stale = await f.call(PATH, 'POST', 9, body);
  assert.ok(stale.status >= 400 && stale.status < 500, 'a stale step-up does not pass the write bar: ' + stale.status);
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_import_runs'), 0);
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_entries'), 0);
});

test('a reviewed organisation upload is re-planned, applied, read back and left staged', async () => {
  const f = fixture();
  const before = Object.fromEntries(SIDE_EFFECT_TABLES.map(t => [t, f.n(`SELECT COUNT(*) AS n FROM ${t}`)]));
  const r = await f.call(PATH, 'POST', 9, await upload(THREE, THREE_MANIFEST));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'complete');
  assert.equal(r.body.replayed, false);
  assert.equal(r.body.read_back.reconciled, true);
  assert.deepEqual(r.body.read_back.actual, { checkpoints: 3, accepted: 2, review: 1, skipped: 0, private_sources: 3, organizations: 2,
    people: 0, affiliations: 0, review_records_without_item: 0 });
  assert.equal(r.body.applied_batches, r.body.total_batches - 1, 'every batch but the final complete one is counted');
  assert.deepEqual(f.db.prepare('SELECT kind, publication_status, verification_status FROM network_directory_entries ORDER BY display_name').all().map((e: any) => [e.kind, e.publication_status, e.verification_status]),
    [['organization', 'staged', 'unverified_source_claim'], ['organization', 'staged', 'unverified_source_claim']]);
  assert.equal((f.db.prepare('SELECT status FROM network_directory_import_runs').get() as any).status, 'complete');
  assert.equal(f.n("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='network_directory_organisation_apply'"), 1);
  assert.doesNotMatch(JSON.stringify(f.db.prepare("SELECT * FROM admin_audit_log WHERE action='network_directory_organisation_apply'").get()), /Example|linkedin/);
  assert.deepEqual(Object.fromEntries(SIDE_EFFECT_TABLES.map(t => [t, f.n(`SELECT COUNT(*) AS n FROM ${t}`)])), before);
  assert.equal((await f.call('/entries', 'GET', 1)).body.total, 0, 'nothing is published by an apply');
});

test('replay: the same upload again is a no-op that adds no row and no audit', async () => {
  const f = fixture();
  const body = await upload(THREE, THREE_MANIFEST);
  assert.equal((await f.call(PATH, 'POST', 9, body)).status, 200);
  const after = f.counts();
  const again = await f.call(PATH, 'POST', 9, body);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.applied_batches, 0);
  assert.deepEqual(f.counts(), after);
  assert.equal(f.n("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='network_directory_organisation_apply'"), 1);
});

test('people records and contact fields are refused before anything is planned or written', async () => {
  const f = fixture();
  const cases: [string, any[], any, string][] = [
    ['a person row', THREE, { version: 1, rows: [row('recOrgA'), row('recOrgB'), row('recOrgC', 'accept', { entity_kind: 'person' })] }, 'people_records_refused'],
    ['an unknown kind', THREE, { version: 1, rows: [row('recOrgA'), row('recOrgB'), row('recOrgC', 'review', { entity_kind: 'unknown' })] }, 'people_records_refused'],
    ['an affiliation decision', THREE, { version: 1, rows: [row('recOrgA', 'accept', { affiliation_disposition: 'accept_source_claim' }), row('recOrgB'), row('recOrgC')] }, 'people_records_refused'],
    ['a title decision', THREE, { version: 1, rows: [row('recOrgA', 'accept', { title: 'Partner' }), row('recOrgB'), row('recOrgC')] }, 'people_records_refused'],
    ['an Email column', [org('recOrgA', 'Alpha Example Ventures', T1, { Email: '' })], { version: 1, rows: [row('recOrgA')] }, 'contact_field_refused'],
    ['a Phone column', [org('recOrgA', 'Alpha Example Ventures', T1, { 'Phone number': '+00 0000' })], { version: 1, rows: [row('recOrgA')] }, 'contact_field_refused'],
    ['an email in a value', [org('recOrgA', 'Alpha Example Ventures', T1, { 'Previous Investments': 'ask partner@example.test' })], { version: 1, rows: [row('recOrgA')] }, 'contact_field_refused'],
    ['an email in the manifest', [org('recOrgA', 'Alpha Example Ventures')], { version: 1, rows: [row('recOrgA', 'accept', { reasons: ['checked with someone@example.test'] })] }, 'contact_field_refused'],
    ['an email channel review', THREE, { ...THREE_MANIFEST, duplicate_channel_groups: [{ channel_type: 'email', records: [] }] }, 'contact_field_refused'],
    ['a personal profile link', [org('recOrgA', 'Alpha Example Ventures', T1, { LinkedIn: 'https://www.linkedin.com/in/synthetic-founder' })], { version: 1, rows: [row('recOrgA')] }, 'personal_profile_refused'],
    ['a Folk person row', [{ source: 'folk_french_vcs', source_record_id: 'p1', observed_at: T1, raw_fields: { Person: 'Synthetic Person' } }],
      { version: 1, rows: [{ source: 'folk_french_vcs', source_record_id: 'p1', entity_kind: 'organization', disposition: 'accept' }] }, 'source_not_organisation_mapped'],
    ['derived organisations', THREE, { ...THREE_MANIFEST, organizations: [{ source: 'folk_french_vcs', source_organization_key: 'X', name: 'X' }] }, 'derived_organizations_refused'],
    ['an unmapped column', [org('recOrgA', 'Alpha Example Ventures', T1, { Notes: 'synthetic' })], { version: 1, rows: [row('recOrgA')] }, 'field_not_permitted'],
    ['an unreviewed record', THREE, { version: 1, rows: [row('recOrgA'), row('recOrgB')] }, 'record_unreviewed'],
  ];
  for (const [name, records, manifest, code] of cases) {
    let body: any;
    try { body = await upload(records, manifest); } catch { body = await upload(records, { version: 1, rows: [] }, { manifest }); }
    const r = await f.call(PATH, 'POST', 9, body);
    assert.equal(r.body.error, code, name + ': ' + JSON.stringify(r.body));
    assert.equal(r.status, 422, name);
    assert.doesNotMatch(JSON.stringify(r.body), /example\.test|synthetic-founder|Synthetic Person/, name + ': no value is echoed');
  }
  assert.deepEqual(Object.values(f.counts()), [0, 0, 0, 0, 0, 0, 0]);
});

test('the server re-plan refuses people on its own, as a second check behind the envelope', async () => {
  const records = [org('recOrgA', 'Synthetic Person Name')];
  const manifest = { version: 1, rows: [row('recOrgA', 'accept', { entity_kind: 'person' })] };
  const body = await upload(records, manifest);
  await assert.rejects(replan({ ...body, max_batches: 1 } as any), (e: any) => e.code === 'people_records_refused');
  await assert.doesNotReject(replan({ ...(await upload(records, { version: 1, rows: [row('recOrgA')] })), max_batches: 1 } as any));
});

test('a bad envelope or manifest is refused: contract, environment, schema, mapping, snapshot, shape, size and submitted SQL', async () => {
  const f = fixture();
  const good = await upload(THREE, THREE_MANIFEST);
  const plan = buildDirectoryPlan({ records: THREE, manifest: THREE_MANIFEST });
  const cases: [string, unknown, number, string][] = [
    ['contract', { ...good, contract: 'v0' }, 400, 'contract_unknown'],
    ['target', { ...good, target_environment: 'production' }, 409, 'wrong_target_environment'],
    ['schema', { ...good, schema: '202601010000_0000_other' }, 409, 'schema_version_mismatch'],
    ['mapping', { ...good, planner_version: 'network-directory-7672-v0' }, 409, 'mapping_version_mismatch'],
    ['digest', { ...good, snapshot: { ...good.snapshot, records_sha256: '0'.repeat(64) } }, 409, 'snapshot_mismatch'],
    ['count', { ...good, snapshot: { ...good.snapshot, record_count: 4 } }, 409, 'snapshot_mismatch'],
    ['records edited after review', { ...good, records: [THREE[0], THREE[1], org('recOrgC', 'Gamma Renamed Partners')] }, 409, 'snapshot_mismatch'],
    ['manifest version', { ...good, manifest: { ...THREE_MANIFEST, version: 2 } }, 400, 'manifest_invalid'],
    ['duplicate manifest row', { ...good, manifest: { version: 1, rows: [...THREE_MANIFEST.rows, row('recOrgA')] } }, 400, 'manifest_invalid'],
    ['bad disposition', { ...good, manifest: { version: 1, rows: [row('recOrgA', 'publish'), row('recOrgB'), row('recOrgC')] } }, 400, 'manifest_invalid'],
    ['row for no record', { ...good, manifest: { version: 1, rows: [...THREE_MANIFEST.rows, row('recOrgZ')] } }, 400, 'manifest_invalid'],
    ['no records', { ...good, records: [] }, 400, 'records_invalid'],
    ['max batches', { ...good, max_batches: 0 }, 400, 'max_batches_invalid'],
    ['submitted batches', { ...good, batches: plan.batches }, 400, 'submitted_sql_refused'],
    ['submitted plan', { ...good, plan: plan }, 400, 'submitted_sql_refused'],
    ['unknown field', { ...good, apply_to: 'everything' }, 400, 'upload_field_unknown'],
  ];
  for (const [name, body, status, code] of cases) {
    const r = await f.call(PATH, 'POST', 9, body);
    assert.equal(r.body.error, code, name + ': ' + JSON.stringify(r.body));
    assert.equal(r.status, status, name);
  }
  assert.equal((await f.call(PATH, 'POST', 9, undefined, { raw: '{not json' })).body.error, 'invalid_json');
  const big = await f.call(PATH, 'POST', 9, undefined, { raw: JSON.stringify({ ...good, pad: 'x'.repeat(4 * 1024 * 1024) }) });
  assert.equal(big.status, 413);
  assert.deepEqual(Object.values(f.counts()), [0, 0, 0, 0, 0, 0, 0]);

  const prod = fixture('production');
  const held = await prod.call(PATH, 'POST', 9, { ...good, target_environment: 'production' });
  assert.equal(held.status, 409);
  assert.equal(held.body.error, 'production_apply_held', 'no real production apply while the queue alert is open (#7739 Q4 A)');
  assert.equal(prod.n('SELECT COUNT(*) AS n FROM network_directory_import_runs'), 0);

  const bare = fixture();
  bare.db.exec('DROP TABLE network_directory_reviews');
  assert.equal((await bare.call(PATH, 'POST', 9, good)).body.error, 'schema_not_ready');
});

test('a stale plan is refused: the server’s re-plan must equal the reviewed run', async () => {
  const f = fixture();
  const good = await upload(THREE, THREE_MANIFEST);
  const r1 = await f.call(PATH, 'POST', 9, { ...good, plan: { ...good.plan, run_uid: 'f'.repeat(32) } });
  assert.equal(r1.status, 409);
  assert.equal(r1.body.error, 'plan_stale');
  // The manifest was changed after the plan was reviewed: the reviewed run id no longer matches.
  const r2 = await f.call(PATH, 'POST', 9, { ...good, manifest: { version: 1, rows: [row('recOrgA'), row('recOrgB'), row('recOrgC')] } });
  assert.equal(r2.body.error, 'plan_stale');
  const r3 = await f.call(PATH, 'POST', 9, { ...good, plan: { ...good.plan, review_manifest_hash: '0'.repeat(64) } });
  assert.equal(r3.body.error, 'plan_stale');
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_import_runs'), 0);
});

test('the latest source decides: an older acceptance cannot land behind a newer hold, and protected entries are untouched', async () => {
  const f = fixture();
  // T2 holds recOrgA; an upload reviewed from an older T1 acceptance of the same row is stale.
  assert.equal((await f.call(PATH, 'POST', 9, await upload([org('recOrgA', 'Alpha Example Ventures', T2)], { version: 1, rows: [row('recOrgA', 'review')] }))).status, 200);
  const stale = await f.call(PATH, 'POST', 9, await upload([org('recOrgA', 'Alpha Example Ventures', T1)], { version: 1, rows: [row('recOrgA')] }));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'manifest_stale');
  assert.equal(stale.body.stale_rows, 1);
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_entries'), 0, 'the older acceptance created no entry');

  const g = fixture();
  assert.equal((await g.call(PATH, 'POST', 9, await upload(THREE.slice(0, 2), { version: 1, rows: [row('recOrgA'), row('recOrgB')] }))).status, 200);
  const [alpha, beta] = (g.db.prepare('SELECT uid FROM network_directory_entries ORDER BY display_name').all() as any[]).map(e => e.uid);
  const pub = await g.call(`/admin/entries/${alpha}/publish`, 'POST', 9, { idempotency_key: 'synthetic-key-alpha', reason: 'Reviewed synthetic organisation.' });
  assert.equal(pub.status, 201, JSON.stringify(pub.body));
  // A newer source: Alpha renamed and accepted, Beta held.
  const newer = await g.call(PATH, 'POST', 9, await upload([org('recOrgA', 'Alpha Renamed Ventures', T2), org('recOrgB', 'Beta Example Capital', T2)],
    { version: 1, rows: [row('recOrgA'), row('recOrgB', 'review')] }));
  assert.equal(newer.status, 200, JSON.stringify(newer.body));
  assert.equal(newer.body.protected_entries, 1);
  const a = g.db.prepare('SELECT display_name, publication_status, observed_at FROM network_directory_entries WHERE uid=?').get(alpha) as any;
  assert.deepEqual([a.display_name, a.publication_status, a.observed_at], ['Alpha Example Ventures', 'published', T1], 'a published entry is not refreshed by a routine apply');
  assert.deepEqual((await readiness(g.env, beta)).blockers, ['latest_observation_not_accepted', 'open_review'], 'the later hold blocks the older accepted projection');
  assert.equal((await g.call(`/admin/entries/${beta}/publish`, 'POST', 9, { idempotency_key: 'synthetic-key-beta', reason: 'Should be refused.' })).body.error, 'publication_not_ready');
});

test('a planned organisation that already exists as a person is refused before any batch', async () => {
  const f = fixture();
  const body = await upload([org('recOrgA', 'Alpha Example Ventures')], { version: 1, rows: [row('recOrgA')] });
  const plan = buildDirectoryPlan({ records: body.records, manifest: body.manifest });
  const uid = plan.batches.flatMap(b => b.statements).find(s => s.sql.startsWith('INSERT INTO network_directory_entries'))!.params[0];
  f.db.exec("INSERT INTO network_directory_sources(uid,name,url) VALUES ('airtable_angels','Airtable Angels directory','https://example.org')");
  f.db.prepare("INSERT INTO network_directory_entries(uid,kind,source_uid,source_external_id,display_name,observed_at) VALUES (?,'person','airtable_angels','other','Synthetic Person',?)").run(uid, T1);
  const r = await f.call(PATH, 'POST', 9, body);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'entity_kind_conflict');
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_import_runs'), 0);
});

test('a bounded call reports in progress, and a failed batch resumes from durable state without duplicates', async () => {
  const f = fixture();
  const body = await upload(THREE, THREE_MANIFEST);
  const part = await f.call(PATH, 'POST', 9, { ...body, max_batches: 2 });
  assert.equal(part.status, 202, JSON.stringify(part.body));
  assert.equal(part.body.status, 'in_progress');
  assert.equal(part.body.applied_batches, 2);
  assert.equal(part.body.pending_batches, 2);
  assert.equal(part.body.read_back, null, 'no completion is claimed before every batch is applied');
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_import_rows'), 1);

  // The next call's second batch fails: it rolls back alone and the first is kept.
  let calls = 0;
  const failing = { ...f.env, DB: { ...f.env.DB, prepare: f.env.DB.prepare.bind(f.env.DB),
    async batch(s: unknown[]) { if (++calls === 2) throw new Error('synthetic batch failure quoting Alpha Example Ventures'); return f.env.DB.batch(s); } } };
  const failed = await f.call(PATH, 'POST', 9, body, { env: failing });
  assert.equal(failed.status, 503, JSON.stringify(failed.body));
  assert.equal(failed.body.error, 'apply_batch_failed');
  assert.equal(failed.body.applied_batches, 1);
  assert.equal(failed.body.pending_batches, 1);
  assert.doesNotMatch(JSON.stringify(failed.body), /Alpha Example/);
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_import_rows'), 2);
  assert.equal((f.db.prepare('SELECT status FROM network_directory_import_runs').get() as any).status, 'planned');
  assert.equal(f.n("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='network_directory_organisation_apply'"), 2, 'the failed call that committed a batch is audited');

  const resumed = await f.call(PATH, 'POST', 9, body);
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.applied_batches, 1, 'only the missing batch is applied');
  assert.equal(resumed.body.read_back.reconciled, true);
  assert.deepEqual(f.counts(), { network_directory_entries: 2, network_directory_source_records: 3, network_directory_private_sources: 3,
    network_directory_import_rows: 3, network_directory_import_runs: 1, network_directory_reviews: 1, network_directory_affiliations: 0 });
});

test('a read-back mismatch is reported, never completion', async () => {
  const f = fixture();
  const body = await upload(THREE, THREE_MANIFEST);
  assert.equal((await f.call(PATH, 'POST', 9, { ...body, max_batches: 2 })).status, 202);
  // A private source row of an applied record disappears between calls.
  f.db.exec('DELETE FROM network_directory_private_sources');
  const r = await f.call(PATH, 'POST', 9, body);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'read_back_mismatch');
  assert.deepEqual(r.body.read_back.mismatches, ['private_sources']);
  assert.equal(r.body.read_back.actual.private_sources, 2);
  assert.equal((f.db.prepare('SELECT status FROM network_directory_import_runs').get() as any).status, 'planned', 'the run is not marked complete');
  assert.equal((await f.call(PATH, 'POST', 9, body)).body.error, 'read_back_mismatch', 'a retry does not paper over it');

  // A protected entry changed by something else while this call applied.
  const g = fixture();
  assert.equal((await g.call(PATH, 'POST', 9, await upload([org('recOrgA', 'Alpha Example Ventures')], { version: 1, rows: [row('recOrgA')] }))).status, 200);
  const alpha = (g.db.prepare('SELECT uid FROM network_directory_entries').get() as any).uid;
  g.db.prepare("UPDATE network_directory_entries SET publication_status='published' WHERE uid=?").run(alpha);
  const interfering = { ...g.env, DB: { ...g.env.DB, prepare: g.env.DB.prepare.bind(g.env.DB),
    async batch(s: unknown[]) { g.db.prepare("UPDATE network_directory_entries SET display_name='Changed Elsewhere' WHERE uid=?").run(alpha); return g.env.DB.batch(s); } } };
  const changed = await g.call(PATH, 'POST', 9, await upload([org('recOrgA', 'Alpha Example Ventures', T2)], { version: 1, rows: [row('recOrgA')] }), { env: interfering });
  assert.equal(changed.status, 409, JSON.stringify(changed.body));
  assert.equal(changed.body.error, 'read_back_mismatch');
  assert.equal(changed.body.protected_entry_changed, true);
});

test('the apply service accepts no SQL and selects no private source cell', () => {
  const route = readFileSync(new URL('../src/routes/network_directory.ts', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/services/networkDirectoryApply.ts', import.meta.url), 'utf8');
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code(route), /network_directory_private_sources/);
  assert.doesNotMatch(code(service), /raw_json/, 'private cells are counted, never selected');
  assert.doesNotMatch(code(service), /prepare\((?:body|input)\b/, 'no statement text comes from the request');
  assert.doesNotMatch(code(service), /publication_status\s*=\s*'published'/, 'an apply never publishes');
});
