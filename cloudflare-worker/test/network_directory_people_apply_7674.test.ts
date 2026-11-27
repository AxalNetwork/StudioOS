/**
 * D7674 part 4 (#7674): the people-only controlled apply and the professional-only person projection, over the
 * migrated schema and the mounted router. Synthetic, invented people and organisations only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import directory from '../src/routes/network_directory.ts';
import { APPLY_CONTRACT, APPLY_SCHEMA, recordsDigest } from '../src/services/networkDirectoryApply.ts';
import { LINKEDIN_PROFILE, PEOPLE_APPLY_CONTRACT, peopleEnvelope, replanPeople } from '../src/services/networkDirectoryPeopleApply.ts';
import { VERSION, buildDirectoryPlan } from '../../scripts/lib/networkDirectoryPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

test.after(removeMigratedDatabases);
// A fresh per-run signing key for the synthetic JWTs: no literal secret sits in the file.
const SECRET = `${crypto.randomUUID()}${crypto.randomUUID()}`;
const PATH = '/admin/people-apply';
const T1 = '2026-11-20T10:00:00.000Z';
const MARKER = 'PLANTED7674CONTACTMARKER';

/** Members 1 and 2, plain admin 8, Super Admin 9, each with a stepped-up TOTP session. */
function fixture(environment = 'development') {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,email,name,role,is_active) VALUES
      (1,'member-one@example.test','Synthetic member one','founder',1),
      (2,'member-two@example.test','Synthetic member two','investor',1),
      (8,'admin@example.test','Synthetic admin','admin',1),
      (9,'super@example.test','Synthetic super admin','admin',1);
    INSERT INTO super_admins(user_id) VALUES (9);
  `);
  for (const id of [1, 2, 8, 9]) db.prepare(`INSERT INTO user_sessions(user_id,jti,factor,assurance_level,last_step_up_at) VALUES (?,?,'totp','totp',datetime('now'))`).run(id, 'synthetic-' + id);
  const app = new Hono<any>().route('/api/network/directory', directory);
  app.onError((e, c) => c.json({ error: 'refused' }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: environment } as any;
  async function call(path: string, method = 'POST', who: number | null = 9, body?: unknown, opts: { claims?: Record<string, unknown>; env?: any } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who !== null) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who, jti: 'synthetic-' + who, ...(opts.claims ?? {}) })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const pending: Promise<unknown>[] = [];
    const r = await app.request('https://unit.test/api/network/directory' + path,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) } as any, opts.env ?? env,
      { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} } as any);
    await Promise.allSettled(pending);
    return { status: r.status, body: await r.json() as any };
  }
  const n = (sql: string) => Number((db.prepare(sql).get() as any).n);
  const counts = () => Object.fromEntries(['network_directory_entries', 'network_directory_source_records', 'network_directory_private_sources',
    'network_directory_import_rows', 'network_directory_import_runs', 'network_directory_reviews', 'network_directory_affiliations']
    .map(t => [t, n(`SELECT COUNT(*) AS n FROM ${t}`)]));
  /** Every cell of every directory table, for a "this value is stored nowhere" check. */
  const dump = () => JSON.stringify(['network_directory_entries', 'network_directory_source_records', 'network_directory_private_sources',
    'network_directory_import_rows', 'network_directory_import_runs', 'network_directory_reviews', 'network_directory_affiliations', 'admin_audit_log']
    .map(t => db.prepare(`SELECT * FROM ${t}`).all()));
  return { db, env, call, n, counts, dump };
}

const NORTHWIND = 'Northwind Example Partners';
const folk = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  source: 'folk_french_vcs', source_record_id: id, observed_at: T1,
  raw_fields: { Person: name, 'First name': name.split(' ')[0], 'Last name': name.split(' ').slice(1).join(' '),
    Urls: `https://www.linkedin.com/in/${id.toLowerCase()}`, Industry: ['Software'], Companies: [NORTHWIND], 'Job title': 'Partner', ...extra },
});
const angel = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  source: 'airtable_angels', source_record_id: id, observed_at: T1,
  raw_fields: { Name: name, Headquarters: 'Example Region', 'Sector Focus': ['Climate'], LinkedIn: `https://linkedin.com/in/${id.toLowerCase()}`, ...extra },
});
const prow = (r: { source: string; source_record_id: string }, disposition = 'accept', extra: Record<string, unknown> = {}) => ({
  source: r.source, source_record_id: r.source_record_id, entity_kind: 'person', disposition,
  ...(r.source === 'folk_french_vcs' ? { affiliation_disposition: 'accept_source_claim' } : {}), ...extra,
});
const NORTHWIND_ORG = { source: 'folk_french_vcs', source_organization_key: NORTHWIND, name: NORTHWIND, website: 'https://northwind.example', disposition: 'accept' };
const manifestFor = (records: any[], over: Record<string, unknown> = {}) => ({
  version: 1, rows: records.map(r => prow(r)), ...(records.some(r => r.source === 'folk_french_vcs') ? { organizations: [NORTHWIND_ORG] } : {}), ...over,
});

/** What a Super Admin's browser sends: the reviewed records and manifest, and the digest and run id the offline planner printed. */
async function upload(records: any[], manifest: any, over: Record<string, unknown> = {}) {
  let run = { run_uid: '0'.repeat(32), review_manifest_hash: '0'.repeat(64) };
  try { const p = buildDirectoryPlan({ records, manifest }); run = { run_uid: p.summary.run_uid, review_manifest_hash: p.summary.review_manifest_hash }; } catch { /* a refusal case */ }
  return { contract: PEOPLE_APPLY_CONTRACT, target_environment: 'development', schema: APPLY_SCHEMA, planner_version: VERSION,
    snapshot: { records_sha256: await recordsDigest(records), record_count: records.length }, plan: run, manifest, records, ...over };
}

const PEOPLE = [folk('fkAvery', 'Avery Example'), folk('fkBlair', 'Blair Example'), angel('atCasey', 'Casey Example')];
const SIDE_EFFECT_TABLES = ['partner_relationships', 'network_connections', 'notifications_inbox', 'network_directory_book_links', 'user_company_links',
  'company_people', 'company_profiles', 'network_directory_publication_events', 'network_directory_research_links', 'network_directory_overlays'];
const auditRows = (f: ReturnType<typeof fixture>) => f.n("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='network_directory_people_apply'");

async function applyAndPublish(f: ReturnType<typeof fixture>, records = PEOPLE, manifest = manifestFor(PEOPLE)) {
  const r = await f.call(PATH, 'POST', 9, await upload(records, manifest));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let i = 0;
  for (const e of f.db.prepare("SELECT uid FROM network_directory_entries WHERE publication_status='staged' ORDER BY uid").all() as any[]) {
    const p = await f.call(`/admin/entries/${e.uid}/publish`, 'POST', 9, { idempotency_key: 'synthetic-publish-' + (++i), reason: 'Reviewed synthetic entry.' });
    assert.equal(p.status, 201, JSON.stringify(p.body));
  }
  return r;
}
const uidOf = (f: ReturnType<typeof fixture>, name: string) => (f.db.prepare('SELECT uid FROM network_directory_entries WHERE display_name=?').get(name) as any).uid as string;

test('access: signed out, a member, a plain admin, a support session and a stale step-up are refused, and nothing is written', async () => {
  const f = fixture();
  const body = await upload(PEOPLE, manifestFor(PEOPLE));
  assert.equal((await f.call(PATH, 'POST', null, body)).status, 401);
  assert.equal((await f.call(PATH, 'POST', 1, body)).status, 403, 'a member');
  assert.equal((await f.call(PATH, 'POST', 8, body)).status, 403, 'a plain admin');
  const support = await f.call(PATH, 'POST', 9, body, { claims: { impersonated_by: 8 } });
  assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
  f.db.exec("UPDATE user_sessions SET created_at=datetime('now','-2 days'), last_step_up_at=datetime('now','-2 days') WHERE user_id=9");
  const stale = await f.call(PATH, 'POST', 9, body);
  assert.ok(stale.status >= 400 && stale.status < 500, 'a stale step-up does not pass the write bar: ' + stale.status);
  assert.deepEqual(Object.values(f.counts()), [0, 0, 0, 0, 0, 0, 0]);
});

test('a reviewed people upload is re-planned, applied, read back and left staged, with no side effect', async () => {
  const f = fixture();
  const before = Object.fromEntries(SIDE_EFFECT_TABLES.map(t => [t, f.n(`SELECT COUNT(*) AS n FROM ${t}`)]));
  const r = await f.call(PATH, 'POST', 9, await upload(PEOPLE, manifestFor(PEOPLE)));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'complete');
  assert.deepEqual(r.body.read_back.actual, { checkpoints: 4, accepted: 4, review: 0, skipped: 0, private_sources: 4, organizations: 1,
    people: 3, affiliations: 2, review_records_without_item: 0 });
  assert.equal(r.body.read_back.reconciled, true);
  assert.deepEqual(f.db.prepare('SELECT kind, display_name, publication_status, profile_url, website FROM network_directory_entries ORDER BY display_name').all()
    .map((e: any) => [e.kind, e.display_name, e.publication_status, e.profile_url, e.website]), [
    ['person', 'Avery Example', 'staged', 'https://linkedin.com/in/fkavery', null],
    ['person', 'Blair Example', 'staged', 'https://linkedin.com/in/fkblair', null],
    ['person', 'Casey Example', 'staged', 'https://linkedin.com/in/atcasey', null],
    ['organization', NORTHWIND, 'staged', null, 'https://northwind.example'],
  ]);
  assert.deepEqual(f.db.prepare('SELECT relation_kind, title, is_current, start_date, end_date FROM network_directory_affiliations').all()
    .map((a: any) => [a.relation_kind, a.title, a.is_current, a.start_date, a.end_date]),
  [['source_association', 'Partner', null, null, null], ['source_association', 'Partner', null, null, null]], 'a source association, never employment, currentness unknown');
  assert.equal(auditRows(f), 1);
  assert.equal(f.n("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='network_directory_organisation_apply'"), 0, 'the people route audits under its own action');
  assert.doesNotMatch(JSON.stringify(f.db.prepare("SELECT * FROM admin_audit_log WHERE action='network_directory_people_apply'").get()), /Example|linkedin/);
  assert.deepEqual(Object.fromEntries(SIDE_EFFECT_TABLES.map(t => [t, f.n(`SELECT COUNT(*) AS n FROM ${t}`)])), before);
  assert.equal((await f.call('/entries', 'GET', 1)).body.total, 0, 'an apply publishes nothing');
});

test('a contact field is refused and counted, wherever it is planted, and its value is stored and echoed nowhere', async () => {
  const columns = ['Email', 'Personal email', 'Phone', 'Mobile', 'Tel', 'Address', 'Home address', 'Website', 'Personal website', 'Twitter',
    'WhatsApp', 'Telegram', 'Contact', 'Cell', 'Homepage', 'Blog', 'Instagram', 'Facebook', 'Skype', 'Signal', 'URL', 'Links'];
  const cases: [string, any[], any][] = [];
  for (const col of columns) {
    const recs = [folk('fkAvery', 'Avery Example', { [col]: MARKER })];
    cases.push([`column ${col}`, recs, manifestFor(recs)]);
  }
  const value = (label: string, rec: any) => cases.push([label, [rec], manifestFor([rec])]);
  value('an email in a job title', folk('fkAvery', 'Avery Example', { 'Job title': `${MARKER}@example.test` }));
  value('a phone in a geography', angel('atCasey', 'Casey Example', { Headquarters: '+33 6 12 34 56 78 ' + MARKER }));
  value('a personal site in a name', angel('atCasey', `Casey ${MARKER} www.casey.example`));
  value('a personal site in the profile column', folk('fkAvery', 'Avery Example', { Urls: `https://${MARKER}.example/about` }));
  value('an email in the profile column', angel('atCasey', 'Casey Example', { LinkedIn: `${MARKER}@example.test` }));
  value('a phone in a company cell', folk('fkAvery', 'Avery Example', { Companies: [NORTHWIND, '0612345678'] }));
  const avery = [folk('fkAvery', 'Avery Example')];
  cases.push(['an email in a manifest reason', avery, manifestFor(avery, { rows: [prow(avery[0], 'accept', { reasons: [`asked ${MARKER}@example.test`] })] })]);
  cases.push(['a phone in a title override', avery, manifestFor(avery, { rows: [prow(avery[0], 'accept', { title: `Partner +33 6 12 34 56 78 ${MARKER}` })] })]);
  cases.push(['an email channel review', avery, manifestFor(avery, { duplicate_channel_groups: [{ channel_type: 'email', records: [] }] })]);
  cases.push(['a personal profile as a firm website', avery, manifestFor(avery, { organizations: [{ ...NORTHWIND_ORG, website: 'https://linkedin.com/in/' + MARKER.toLowerCase() }] })]);
  const f = fixture();
  for (const [name, records, manifest] of cases) {
    const r = await f.call(PATH, 'POST', 9, await upload(records, manifest));
    assert.equal(r.body.error, 'contact_field_refused', name + ': ' + JSON.stringify(r.body));
    assert.equal(r.status, 422, name);
    assert.ok(r.body.contact_fields >= 1, name);
    assert.doesNotMatch(JSON.stringify(r.body), new RegExp(MARKER, 'i'), name + ': no value is echoed');
  }
  // Every contact column at once, on two records: each cell is counted, nothing is dropped and applied.
  const all = Object.fromEntries(columns.map(c => [c, MARKER]));
  const two = [folk('fkAvery', 'Avery Example', all), angel('atCasey', 'Casey Example', all)];
  const both = await f.call(PATH, 'POST', 9, await upload(two, manifestFor(two)));
  assert.deepEqual([both.body.error, both.body.contact_fields, both.body.records_affected], ['contact_field_refused', columns.length * 2, 2]);
  assert.deepEqual(Object.values(f.counts()), [0, 0, 0, 0, 0, 0, 0]);
  assert.doesNotMatch(f.dump(), new RegExp(MARKER, 'i'), 'no planted value was stored anywhere');
});

test('a member never reads a contact field, a raw cell, a note or an account link: a marker planted in every one appears in no response', async () => {
  const f = fixture();
  await applyAndPublish(f);
  const avery = uidOf(f, 'Avery Example'), casey = uidOf(f, 'Casey Example'), org = uidOf(f, NORTHWIND);
  const raw = JSON.stringify({ fields: { Email: MARKER + '@example.test', Phone: MARKER, Address: MARKER, Website: 'https://' + MARKER + '.example' }, review: { note: MARKER } });
  f.db.prepare('UPDATE network_directory_private_sources SET raw_json=?').run(raw);
  f.db.prepare('UPDATE network_directory_source_records SET claims_json=?, reasons_json=?').run(JSON.stringify({ email: MARKER }), JSON.stringify([MARKER]));
  // Fields a person row can hold but the person projection never carries, each with the marker.
  f.db.prepare(`UPDATE network_directory_entries SET website=?, stages_json=?, source_categories_json=?, previous_investments_raw=?, currently_investing=1,
    profile_url=?, linked_user_id=2, link_verified_by=9, link_verified_at='2026-11-20' WHERE uid=?`)
    .run('https://' + MARKER + '.example', JSON.stringify([MARKER]), JSON.stringify([MARKER]), MARKER, 'https://' + MARKER + '.example/in/x', avery);
  f.db.prepare(`UPDATE network_directory_entries SET profile_url=? WHERE uid=?`).run(`https://linkedin.com/in/x?${MARKER}=1`, casey);
  f.db.prepare("INSERT INTO network_directory_reviews(uid,source_record_uid,reason) SELECT 'rev-marker', uid, ? FROM network_directory_source_records LIMIT 1").run(MARKER);
  f.db.prepare("INSERT INTO network_directory_overlays(owner_user_id,entry_uid,entry_kind,saved,private_note,updated_at) VALUES (2,?,'person',1,?,datetime('now'))").run(avery, MARKER);
  const responses = [
    await f.call('/entries', 'GET', 1), await f.call('/entries?kind=person', 'GET', 1), await f.call('/entries?q=Example', 'GET', 1),
    await f.call(`/entries/${avery}`, 'GET', 1), await f.call(`/entries/${casey}`, 'GET', 1), await f.call(`/entries/${org}`, 'GET', 1),
    await f.call(`/entries/${avery}/overlay`, 'GET', 1),
  ];
  for (const r of responses) assert.equal(r.status, 200, JSON.stringify(r.body));
  const text = JSON.stringify(responses.map(r => r.body));
  assert.doesNotMatch(text, new RegExp(MARKER, 'i'));
  assert.doesNotMatch(text, /linked_user|link_verified|example\.test|rev-marker/);
  const personText = JSON.stringify([responses[1].body, responses[3].body.entry, responses[4].body.entry]);
  assert.doesNotMatch(personText, /website|stages|previous_investments|currently_investing|source_categories/, 'a person carries none of these keys');
  assert.equal(responses[1].body.total, 3);
  const person = responses[3].body.entry;
  assert.deepEqual(Object.keys(person).sort(), ['first_name', 'geography', 'kind', 'last_name', 'name', 'profile_url', 'sectors', 'source', 'uid', 'verification']);
  assert.equal(person.profile_url, null, 'a stored link that is not a strict LinkedIn profile reads null');
  assert.equal(responses[4].body.entry.profile_url, null, 'a profile link with a query string is not a strict profile');
  assert.equal((await f.call(`/entries?q=${MARKER}`, 'GET', 1)).body.total, 0, 'a search matches the name, never a hidden cell');
  assert.deepEqual(responses[5].body.affiliations.map((a: any) => [a.person.name, a.current, a.relation]),
    [['Avery Example', 'unknown', 'source_association'], ['Blair Example', 'unknown', 'source_association']]);
});

test('affiliations read current, former or unknown with the dates as recorded; nothing is inferred', async () => {
  const f = fixture();
  await applyAndPublish(f);
  f.db.prepare("UPDATE network_directory_affiliations SET is_current=0, start_date='2019-01', end_date='2023-06' WHERE person_uid=?").run(uidOf(f, 'Avery Example'));
  f.db.prepare("UPDATE network_directory_affiliations SET is_current=1, start_date='2024-02' WHERE person_uid=?").run(uidOf(f, 'Blair Example'));
  const org = await f.call(`/entries/${uidOf(f, NORTHWIND)}`, 'GET', 1);
  assert.deepEqual(org.body.affiliations.map((a: any) => [a.person.name, a.current, a.start_date, a.end_date]),
    [['Avery Example', 'former', '2019-01', '2023-06'], ['Blair Example', 'current', '2024-02', null]]);
  const casey = await f.call(`/entries/${uidOf(f, 'Casey Example')}`, 'GET', 1);
  assert.deepEqual(casey.body.affiliations, [], 'an Airtable person has no affiliation: none is inferred');
});

test('namesakes stay separate entries; two people sharing one LinkedIn are held for review and never shown', async () => {
  const f = fixture();
  const records = [
    folk('fkCam1', 'Camille Example'), folk('fkCam2', 'Camille Example'), angel('atCam3', 'Camille Example', { LinkedIn: '' }),
    folk('fkDup1', 'Dominique Example', { Urls: 'https://www.linkedin.com/in/shared-profile' }),
    angel('atDup2', 'Dominique Example', { LinkedIn: 'https://linkedin.com/in/shared-profile' }),
  ];
  const r = await applyAndPublish(f, records, manifestFor(records));
  assert.equal(r.body.read_back.actual.people, 3);
  const cams = await f.call('/entries?q=Camille', 'GET', 1);
  assert.equal(cams.body.total, 3);
  assert.equal(new Set(cams.body.entries.map((e: any) => e.uid)).size, 3, 'three namesakes, three identities');
  assert.deepEqual(cams.body.entries.map((e: any) => String(e.profile_url)).sort(), ['https://linkedin.com/in/fkcam1', 'https://linkedin.com/in/fkcam2', 'null']);
  const dups = await f.call('/entries?q=Dominique', 'GET', 1);
  assert.equal(dups.body.total, 0, 'hidden duplicate candidates are not exposed');
  assert.doesNotMatch(JSON.stringify(cams.body), /shared-profile|duplicate|review/);
  const reviews = await f.call('/admin/reviews', 'GET', 9);
  assert.ok(reviews.body.reviews.some((v: any) => v.reason === 'duplicate_profile_identity'), 'the shared LinkedIn is an operator review item');
});

test('the same LinkedIn name on a person and an organisation: a company link is not a person profile, and the two identities stay apart', async () => {
  const f = fixture();
  const asCompany = [angel('atEllis', 'Ellis Example', { LinkedIn: 'https://www.linkedin.com/company/acme-example' })];
  const refused = await f.call(PATH, 'POST', 9, await upload(asCompany, manifestFor(asCompany)));
  assert.deepEqual([refused.status, refused.body.error, refused.body.invalid_linkedin_urls], [422, 'linkedin_url_invalid', 1]);
  // The organisation route holds the company page; the people route holds a person whose profile shares its name.
  const orgRec = { source: 'airtable_angels', source_record_id: 'atAcme', observed_at: T1,
    raw_fields: { Name: 'Acme Example Fund', LinkedIn: 'https://www.linkedin.com/company/acme-example' } };
  const orgManifest = { version: 1, rows: [{ source: 'airtable_angels', source_record_id: 'atAcme', entity_kind: 'organization', disposition: 'accept' }] };
  const orgPlan = buildDirectoryPlan({ records: [orgRec], manifest: orgManifest });
  const orgBody = { contract: APPLY_CONTRACT, target_environment: 'development', schema: APPLY_SCHEMA, planner_version: VERSION,
    snapshot: { records_sha256: await recordsDigest([orgRec]), record_count: 1 },
    plan: { run_uid: orgPlan.summary.run_uid, review_manifest_hash: orgPlan.summary.review_manifest_hash }, manifest: orgManifest, records: [orgRec] };
  assert.equal((await f.call(PATH, 'POST', 9, orgBody)).body.error, 'contract_unknown', 'an organisation upload is not taken by the people route');
  assert.equal((await f.call('/admin/organisation-apply', 'POST', 9, orgBody)).status, 200);
  const person = [angel('atEllis', 'Acme Example Person', { LinkedIn: 'https://www.linkedin.com/in/acme-example' })];
  await applyAndPublish(f, person, manifestFor(person));
  const both = await f.call('/entries?q=Acme', 'GET', 1);
  assert.deepEqual(both.body.entries.map((e: any) => [e.kind, e.profile_url]),
    [['organization', 'https://linkedin.com/company/acme-example'], ['person', 'https://linkedin.com/in/acme-example']]);
  assert.equal(f.n("SELECT COUNT(*) AS n FROM network_directory_reviews WHERE reason LIKE '%duplicate%'"), 0, 'different kinds are never duplicate candidates');
  // Each route refuses the other's records.
  const personToOrg = await f.call('/admin/organisation-apply', 'POST', 9, { ...orgBody, manifest: { version: 1, rows: [{ ...orgManifest.rows[0], entity_kind: 'person' }] } });
  assert.equal(personToOrg.body.error, 'people_records_refused');
  const orgToPeople = await f.call(PATH, 'POST', 9, await upload(person, { version: 1, rows: [{ ...prow(person[0]), entity_kind: 'organization' }] }));
  assert.equal(orgToPeople.body.error, 'organisation_records_refused');
});

test('a malformed LinkedIn URL is refused and counted; only https linkedin.com/in/<slug> is accepted', () => {
  const good = ['https://linkedin.com/in/avery-example', 'https://www.linkedin.com/in/avery-example', 'https://www.linkedin.com/in/avery-example/',
    'https://linkedin.com/in/ren%C3%A9-example'];
  const bad = ['http://www.linkedin.com/in/avery-example', 'linkedin.com/in/avery-example', 'www.linkedin.com/in/avery-example',
    'https://fr.linkedin.com/in/avery-example', 'https://linkedin.com/company/avery-example', 'https://linkedin.com/in/', 'https://linkedin.com/in/ab',
    'https://linkedin.com/in/avery-example?trk=public', 'https://linkedin.com/in/avery-example#about', 'https://linkedin.com/in/avery/detail',
    'https://linkedin.com.evil.example/in/avery', 'https://user:pw@linkedin.com/in/avery-example', 'https://linkedin.com:443/in/avery-example',
    'https://LINKEDIN.COM/in/avery-example', 'https://evil.example/linkedin.com/in/avery', 'Avery Example on LinkedIn', 'https://linkedin.com/in/avery example'];
  for (const u of good) assert.match(u, LINKEDIN_PROFILE, u);
  for (const u of bad) assert.doesNotMatch(u, LINKEDIN_PROFILE, u);
});

test('the route refuses each malformed LinkedIn cell with its count, writing nothing', async () => {
  const f = fixture();
  for (const url of ['http://www.linkedin.com/in/avery-example', 'https://fr.linkedin.com/in/avery-example', 'https://linkedin.com/in/avery-example?trk=x',
    'https://linkedin.com/company/avery-example', 'Avery on LinkedIn']) {
    const recs = [folk('fkAvery', 'Avery Example', { Urls: url }), folk('fkBlair', 'Blair Example', { Urls: url })];
    const r = await f.call(PATH, 'POST', 9, await upload(recs, manifestFor(recs)));
    assert.deepEqual([r.status, r.body.error, r.body.invalid_linkedin_urls, r.body.records_affected], [422, 'linkedin_url_invalid', 2, 2], url);
  }
  const listed = [folk('fkAvery', 'Avery Example', { Urls: ['https://linkedin.com/in/avery-example'] })];
  assert.equal((await f.call(PATH, 'POST', 9, await upload(listed, manifestFor(listed)))).body.error, 'linkedin_url_invalid', 'a list is not one profile');
  const blank = [folk('fkAvery', 'Avery Example', { Urls: '' })];
  assert.equal((await f.call(PATH, 'POST', 9, await upload(blank, manifestFor(blank)))).status, 200, 'an empty profile cell is no profile, not an error');
  assert.equal(f.n("SELECT COUNT(*) AS n FROM network_directory_entries WHERE kind='person' AND profile_url IS NULL"), 1);
});

test('the envelope: wrong contract, unmapped source, unmapped column, unreviewed record, stray organisation, stale plan and submitted SQL', async () => {
  const f = fixture();
  const good = await upload(PEOPLE, manifestFor(PEOPLE));
  const plan = buildDirectoryPlan({ records: PEOPLE, manifest: manifestFor(PEOPLE) });
  const stage = [angel('atCasey', 'Casey Example', { 'Investment Stage': ['Seed'] })];
  const nfx = [{ source: 'nfx_signal', source_record_id: 'n1', observed_at: T1, raw_fields: { Name: 'Synthetic Person' } }];
  const stray = [folk('fkAvery', 'Avery Example', { Companies: [] })];
  const cases: [string, unknown, number, string][] = [
    ['organisation contract', { ...good, contract: APPLY_CONTRACT }, 400, 'contract_unknown'],
    ['target', { ...good, target_environment: 'production' }, 409, 'wrong_target_environment'],
    ['unmapped column', await upload(stage, manifestFor(stage)), 422, 'field_not_permitted'],
    ['unmapped source', await upload(nfx, { version: 1, rows: [prow(nfx[0])] }), 422, 'source_not_people_mapped'],
    ['unreviewed record', { ...good, manifest: manifestFor(PEOPLE.slice(0, 2)) }, 422, 'record_unreviewed'],
    ['row for no record', { ...good, manifest: manifestFor([...PEOPLE, angel('atZed', 'Zed Example')]) }, 400, 'manifest_invalid'],
    ['organisation no person names', await upload(stray, manifestFor(stray)), 422, 'organisation_records_refused'],
    ['snapshot', { ...good, snapshot: { ...good.snapshot, record_count: 4 } }, 409, 'snapshot_mismatch'],
    ['stale plan', { ...good, plan: { ...good.plan, run_uid: 'f'.repeat(32) } }, 409, 'plan_stale'],
    ['submitted batches', { ...good, batches: plan.batches }, 400, 'submitted_sql_refused'],
  ];
  for (const [name, body, status, code] of cases) {
    const r = await f.call(PATH, 'POST', 9, body);
    assert.equal(r.body.error, code, name + ': ' + JSON.stringify(r.body));
    assert.equal(r.status, status, name);
  }
  assert.deepEqual(Object.values(f.counts()), [0, 0, 0, 0, 0, 0, 0]);
});

test('the server re-plan refuses an organisation record on its own, as a second check behind the envelope', async () => {
  const rec = angel('atCasey', 'Casey Example');
  const asOrg = await upload([rec], { version: 1, rows: [{ ...prow(rec), entity_kind: 'organization' }] });
  await assert.rejects(replanPeople({ ...asOrg, max_batches: 1 } as any), (e: any) => e.code === 'organisation_records_refused');
  await assert.doesNotReject(replanPeople({ ...(await upload([rec], manifestFor([rec]))), max_batches: 1 } as any));
  assert.throws(() => peopleEnvelope(asOrg, { ENVIRONMENT: 'development' }), (e: any) => e.code === 'organisation_records_refused', 'the envelope refuses it first');
  // The planner accepts any /in/<slug>; the re-plan holds a planned profile to the strict form whatever the envelope let through.
  const dotted = angel('atCasey', 'Casey Example', { LinkedIn: 'https://linkedin.com/in/casey.example' });
  await assert.rejects(replanPeople({ ...(await upload([dotted], manifestFor([dotted]))), max_batches: 1 } as any), (e: any) => e.code === 'linkedin_url_invalid');
});

test('production: the people apply is held by the same constant, and nothing is written', async () => {
  const prod = fixture('production');
  const held = await prod.call(PATH, 'POST', 9, await upload(PEOPLE, manifestFor(PEOPLE), { target_environment: 'production' }));
  assert.deepEqual([held.status, held.body.error], [409, 'production_apply_held']);
  assert.deepEqual(Object.values(prod.counts()), [0, 0, 0, 0, 0, 0, 0]);
  const service = readFileSync(new URL('../src/services/networkDirectoryPeopleApply.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(service, /PRODUCTION_APPLY_HELD\s*=/, 'the people route has no hold of its own to lift');
});

test('replay is a no-op; a bounded call and a failed batch resume from durable state with exact counts', async () => {
  const f = fixture();
  const body = await upload(PEOPLE, manifestFor(PEOPLE));
  const part = await f.call(PATH, 'POST', 9, { ...body, max_batches: 2 });
  assert.deepEqual([part.status, part.body.status, part.body.applied_batches, part.body.read_back], [202, 'in_progress', 2, null]);
  let calls = 0;
  const failing = { ...f.env, DB: { ...f.env.DB, prepare: f.env.DB.prepare.bind(f.env.DB),
    async batch(s: unknown[]) { if (++calls === 2) throw new Error('synthetic batch failure quoting Avery Example'); return f.env.DB.batch(s); } } };
  const failed = await f.call(PATH, 'POST', 9, body, { env: failing });
  assert.deepEqual([failed.status, failed.body.error, failed.body.applied_batches], [503, 'apply_batch_failed', 1]);
  assert.doesNotMatch(JSON.stringify(failed.body), /Avery/);
  assert.equal((f.db.prepare('SELECT status FROM network_directory_import_runs').get() as any).status, 'planned');
  const resumed = await f.call(PATH, 'POST', 9, body);
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.read_back.reconciled, true);
  const done = f.counts();
  assert.deepEqual(done, { network_directory_entries: 4, network_directory_source_records: 4, network_directory_private_sources: 4,
    network_directory_import_rows: 4, network_directory_import_runs: 1, network_directory_reviews: 0, network_directory_affiliations: 2 });
  const audits = auditRows(f);
  const again = await f.call(PATH, 'POST', 9, body);
  assert.deepEqual([again.status, again.body.replayed, again.body.applied_batches, again.body.wrote], [200, true, 0, false]);
  assert.deepEqual(f.counts(), done, 'a retry adds no row');
  assert.equal(auditRows(f), audits, 'a replay that writes nothing is not audited');
});

test('a planned person that already exists as an organisation is refused before any batch', async () => {
  const f = fixture();
  const rec = angel('atCasey', 'Casey Example');
  const body = await upload([rec], manifestFor([rec]));
  const uid = buildDirectoryPlan({ records: [rec], manifest: manifestFor([rec]) }).batches.flatMap(b => b.statements)
    .find(s => s.sql.startsWith('INSERT INTO network_directory_entries'))!.params[0];
  f.db.exec("INSERT INTO network_directory_sources(uid,name,url) VALUES ('airtable_angels','Airtable Angels directory','https://example.org')");
  f.db.prepare("INSERT INTO network_directory_entries(uid,kind,source_uid,source_external_id,display_name,observed_at) VALUES (?,'organization','airtable_angels','other','Synthetic Org',?)").run(uid, T1);
  const r = await f.call(PATH, 'POST', 9, body);
  assert.deepEqual([r.status, r.body.error], [409, 'entity_kind_conflict']);
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_import_runs'), 0);
});

test('the people service accepts no SQL, selects no private source cell and never publishes', () => {
  const service = readFileSync(new URL('../src/services/networkDirectoryPeopleApply.ts', import.meta.url), 'utf8');
  const code = service.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /raw_json|network_directory_private_sources/);
  assert.doesNotMatch(code, /prepare\(/, 'every statement is the shared apply’s, built from the server’s own plan');
  assert.doesNotMatch(code, /published/);
});
