/** D7674 part 3 (#7674): reviewed merge, stable redirects, organisation aliases and review decisions. Synthetic people and organisations only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import directory from '../src/routes/network_directory.ts';
import { readiness } from '../src/services/networkDirectory.ts';
import { aliasKey, mergeEntries, mergeInput } from '../src/services/networkDirectoryMerge.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';

test.after(removeMigratedDatabases);
const SECRET = `${crypto.randomUUID()}${crypto.randomUUID()}`;
const MARKER = 'PLANTED-7674-MERGE-PRIVATE-MARKER';
const migration = readFileSync(new URL('../sql/migrations/202611271715_7674_network_directory_merge_alias.sql', import.meta.url), 'utf8');
const T0 = '2026-11-19T12:00:00.000Z';

/** Members 1 and 2, a plain admin 8 and a Super Admin 9; every one has a stepped-up TOTP session. */
function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,email,name,role,is_active) VALUES
      (1,'member-one@example.test','Synthetic member one','founder',1),
      (2,'member-two@example.test','Synthetic member two','investor',1),
      (8,'admin@example.test','Synthetic admin','admin',1),
      (9,'super@example.test','Synthetic super admin','admin',1);
    INSERT INTO super_admins(user_id) VALUES (9);
    INSERT INTO network_directory_sources(uid,name,url) VALUES ('src-a','Synthetic source A','https://example.org/a'),('src-b','Synthetic source B','https://example.org/b');
  `);
  for (const id of [1, 2, 8, 9]) db.prepare(`INSERT INTO user_sessions(user_id,jti,factor,assurance_level,last_step_up_at) VALUES (?,?,'totp','totp',datetime('now'))`).run(id, 'synthetic-' + id);
  let seq = 0;
  const record = (entryUid: string | null, kind: string | null, disposition: string, observedAt: string, external: string | null = entryUid, source = 'src-a') => {
    const uid = 'rec-' + (++seq);
    db.prepare(`INSERT INTO network_directory_source_records(uid,source_uid,external_record_id,content_hash,decision_hash,entry_uid,entry_kind,disposition,observed_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(uid, source, 'ext-' + external, 'c' + seq, 'd' + seq, disposition === 'accept' ? entryUid : null, disposition === 'accept' ? kind : null, disposition, observedAt);
    db.prepare(`INSERT INTO network_directory_private_sources(source_record_uid,raw_json) VALUES (?,?)`).run(uid, JSON.stringify({ Email: MARKER + '@example.test', Note: MARKER }));
    return uid;
  };
  const entry = (uid: string, kind: string, name: string, publication = 'staged', extra: Record<string, unknown> = {}) => {
    const source = (extra.source as string) ?? 'src-a';
    db.prepare(`INSERT INTO network_directory_entries(uid,kind,source_uid,source_external_id,display_name,publication_status,observed_at,linked_user_id,link_verified_by,link_verified_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(uid, kind, source, 'ext-' + uid, name, publication, T0, (extra.user as number) ?? null, extra.user ? 9 : null, extra.user ? '2026-11-19' : null);
    return record(uid, kind, 'accept', T0, uid, source);
  };
  entry('org-alpha', 'organization', 'Alpha Example Ventures', 'published');                         // rec-1
  entry('org-alpha-dup', 'organization', 'Alpha Example Ventures LP', 'staged', { source: 'src-b' }); // rec-2
  entry('org-gamma', 'organization', 'Gamma Example Capital', 'published');                          // rec-3
  entry('org-delta', 'organization', 'Delta Example Partners', 'staged');                            // rec-4
  entry('person-ada', 'person', 'Ada Example', 'published', { user: 2 });                            // rec-5
  entry('person-ada-dup', 'person', 'Ada Example', 'published', { source: 'src-b' });               // rec-6
  entry('person-bo', 'person', 'Bo Example', 'staged');                                              // rec-7
  const aff = (uid: string, person: string, org: string, title: string | null = null) => {
    const rec = db.prepare('SELECT uid FROM network_directory_source_records WHERE entry_uid=? ORDER BY uid LIMIT 1').get(person) as any;
    db.prepare(`INSERT INTO network_directory_affiliations(uid,person_uid,organization_uid,source_record_uid,title,observed_at) VALUES (?,?,?,?,?,?)`)
      .run(uid, person, org, rec.uid, title, T0);
  };
  aff('aff-1', 'person-ada', 'org-alpha', 'Partner');
  aff('aff-2', 'person-ada-dup', 'org-alpha-dup', 'Partner');
  aff('aff-3', 'person-ada-dup', 'org-gamma', 'Advisor');

  const app = new Hono<any>().route('/api/network/directory', directory);
  app.onError((e, c) => c.json({ error: 'refused' }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  async function call(path: string, method = 'GET', who: number | null = 1, body?: unknown, extra: Record<string, unknown> = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who !== null) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who, jti: 'synthetic-' + who, ...extra })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const pending: Promise<unknown>[] = [];
    const r = await app.request('https://unit.test/api/network/directory' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env,
      { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} } as any);
    await Promise.allSettled(pending);
    return { status: r.status, body: await r.json() as any };
  }
  const n = (sql: string) => Number((db.prepare(sql).get() as any).n);
  const rows = (sql: string) => (db.prepare(sql).all() as any[]).map(r => ({ ...r }));
  return { db, env, call, record, n, rows };
}

const key = (s: string) => 'synthetic-merge-' + s;
const merge = (into: string, k: string, extra: Record<string, unknown> = {}) => ({ into_uid: into, idempotency_key: key(k), reason: 'Same firm in two sources.', ...extra });
const SIDE_EFFECT_TABLES = ['partner_relationships', 'network_connections', 'notifications_inbox', 'network_directory_book_links', 'user_company_links', 'company_people', 'company_profiles', 'network_directory_publication_events'];
const sideEffects = (f: ReturnType<typeof fixture>) => Object.fromEntries(SIDE_EFFECT_TABLES.map(t => [t, f.n(`SELECT COUNT(*) AS n FROM ${t}`)]));
/** Every evidence row an entry has, as stored. A merge must leave these byte-for-byte as they were. */
const evidence = (f: ReturnType<typeof fixture>) => JSON.stringify([
  f.rows('SELECT * FROM network_directory_source_records ORDER BY uid'),
  f.rows('SELECT * FROM network_directory_private_sources ORDER BY source_record_uid'),
  f.rows('SELECT * FROM network_directory_affiliations ORDER BY uid'),
  f.rows('SELECT * FROM network_directory_overlays ORDER BY owner_user_id, entry_uid'),
  f.rows('SELECT * FROM network_intro_requests ORDER BY uid'),
]);

test('the migration adds merges, redirects, review decisions and aliases with their constraints, and replays', () => {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const cols = (t: string) => (db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as any[]).map(r => r.name);
  assert.deepEqual(cols('network_directory_redirects'), ['from_uid', 'to_uid', 'merge_uid', 'updated_at']);
  assert.ok(cols('network_directory_merges').includes('from_publication_status'));
  assert.ok(cols('network_directory_review_decisions').includes('merge_uid'));
  assert.ok(cols('network_directory_aliases').includes('alias_key'));
  db.exec(migration);
  db.exec(`INSERT INTO users(id,email,name,role) VALUES (1,'a@example.test','A','founder'); INSERT INTO network_directory_sources VALUES ('s','S','https://example.org');
    INSERT INTO network_directory_entries(uid,kind,source_uid,source_external_id,display_name,observed_at) VALUES ('p','person','s','1','P','2026'),('o','organization','s','2','O','2026'),('o2','organization','s','3','O2','2026');
    INSERT INTO network_directory_source_records(uid,source_uid,external_record_id,content_hash,decision_hash,disposition,observed_at) VALUES ('r','s','x','c','d','review','2026');
    INSERT INTO network_directory_reviews(uid,source_record_uid,reason) VALUES ('rv','r','synthetic');`);
  const m = (uid: string, k: string, kind: string, from: string, to: string) =>
    db.exec(`INSERT INTO network_directory_merges(uid,idempotency_key,kind,from_uid,to_uid,from_publication_status,reason,actor_user_id) VALUES ('${uid}','${k}','${kind}','${from}','${to}','staged','because',1)`);
  assert.throws(() => m('m0', 'key-00000', 'organization', 'o', 'o'), /CHECK/, 'never into itself');
  m('m1', 'key-00001', 'organization', 'o2', 'o');
  assert.throws(() => m('m2', 'key-00002', 'organization', 'o2', 'o'), /UNIQUE/, 'an entry is merged away once');
  assert.throws(() => db.exec("INSERT INTO network_directory_review_decisions(uid,idempotency_key,review_uid,decision,reason,actor_user_id) VALUES ('d','key-00003','rv','resolved','because',1)"), /CHECK/,
    'resolved only through a merge');
  db.exec("INSERT INTO network_directory_review_decisions(uid,idempotency_key,review_uid,decision,reason,actor_user_id) VALUES ('d','key-00003','rv','dismissed','because',1)");
  assert.throws(() => db.exec("INSERT INTO network_directory_review_decisions(uid,idempotency_key,review_uid,decision,reason,actor_user_id) VALUES ('d2','key-00004','rv','kept_separate','because',1)"), /UNIQUE/,
    'one decision per review');
  const a = (uid: string, k: string, entry: string, kind = 'organization') =>
    db.exec(`INSERT INTO network_directory_aliases(uid,idempotency_key,entry_uid,entry_kind,alias,alias_key,origin,reason,created_by) VALUES ('${uid}','${k}','${entry}','${kind}','Other','other','operator','because',1)`);
  assert.throws(() => a('a0', 'key-00005', 'p', 'person'), /CHECK/, 'organisations only');
  a('a1', 'key-00006', 'o');
  assert.throws(() => a('a2', 'key-00007', 'o'), /UNIQUE/, 'one active alias per name per organisation');
  assert.throws(() => db.exec("UPDATE network_directory_aliases SET status='withdrawn' WHERE uid='a1'"), /CHECK/, 'a withdrawal records who and why');
  db.close();
});

test('identity writes need the write bar and the operator’s own session; the operator detail needs a Super Admin', async () => {
  const f = fixture();
  const writes: [string, unknown][] = [
    ['/admin/entries/org-alpha-dup/merge', merge('org-alpha', 'gate')],
    ['/admin/entries/org-alpha/aliases', { alias: 'Alpha Example', idempotency_key: key('gate-a'), reason: 'Known short name.' }],
  ];
  for (const [path, body] of writes) {
    assert.equal((await f.call(path, 'POST', null, body)).status, 401, path);
    assert.equal((await f.call(path, 'POST', 1, body)).status, 403, path);
    assert.equal((await f.call(path, 'POST', 8, body)).status, 403, path);
    const support = await f.call(path, 'POST', 9, body, { impersonated_by: 9 });
    assert.equal(support.status, 403, path);
    assert.equal(support.body.error, 'support_session_refused');
  }
  f.db.exec("UPDATE user_sessions SET created_at=datetime('now','-2 days'), last_step_up_at=datetime('now','-2 days') WHERE user_id=9");
  assert.notEqual((await f.call(writes[0][0], 'POST', 9, writes[0][1])).status, 201, 'a stale step-up does not pass the write bar');
  for (const who of [1, 8]) assert.equal((await f.call('/admin/entries/org-alpha', 'GET', who)).status, 403);
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_merges') + f.n('SELECT COUNT(*) AS n FROM network_directory_aliases'), 0);
});

test('merging organisations archives and redirects the duplicate and rewrites no evidence', async () => {
  const f = fixture();
  // The same claim recorded against both organisations: listed once after the merge, and both rows kept.
  f.db.exec("INSERT INTO network_directory_affiliations(uid,person_uid,organization_uid,source_record_uid,title,observed_at) VALUES ('aff-4','person-ada','org-alpha-dup','rec-5','Partner','2026-11-18T00:00:00.000Z')");
  const before = sideEffects(f);
  const kept = evidence(f);
  const r = await f.call('/admin/entries/org-alpha-dup/merge', 'POST', 9, merge('org-alpha', 'orgs'));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.replayed, false);
  assert.deepEqual([r.body.merge.from_uid, r.body.merge.to_uid, r.body.merge.kind, r.body.merge.from_publication_status, r.body.merge.actor_user_id],
    ['org-alpha-dup', 'org-alpha', 'organization', 'staged', 9]);
  assert.deepEqual(r.body.preserved, { source_records: 1, affiliations: 2, overlays: 0, intro_requests: 0, book_links: 0, research_links: 0 });
  assert.equal(evidence(f), kept, 'observations, private rows, affiliations, overlays and requests are untouched');
  assert.equal((f.db.prepare("SELECT publication_status FROM network_directory_entries WHERE uid='org-alpha-dup'").get() as any).publication_status, 'archived');
  assert.deepEqual(f.rows('SELECT from_uid, to_uid FROM network_directory_redirects'), [{ from_uid: 'org-alpha-dup', to_uid: 'org-alpha' }]);
  assert.equal(f.n("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='network_directory_merge'"), 1);
  assert.deepEqual(sideEffects(f), before, 'no account, relationship, notice, book link, company row or publication');

  const old = await f.call('/entries/org-alpha-dup');
  assert.equal(old.status, 200, 'the old reference still resolves');
  assert.equal(old.body.entry.uid, 'org-alpha');
  assert.equal(old.body.redirected_from, 'org-alpha-dup');
  assert.equal((await f.call('/entries/org-alpha')).body.redirected_from, null);
  assert.deepEqual(old.body.affiliations.map((a: any) => [a.person.uid, a.title, a.observed_at]),
    [['person-ada', 'Partner', T0], ['person-ada-dup', 'Partner', T0]], 'one claim held by both entries is listed once, from its latest observation');
  assert.deepEqual(old.body.aliases, ['Alpha Example Ventures LP'], 'the merged-away name is kept as an alias');
  assert.deepEqual((await f.call('/entries/person-ada-dup')).body.affiliations.map((x: any) => [x.organization.uid, x.title]),
    [['org-alpha', 'Partner'], ['org-gamma', 'Advisor']], 'a claim on the merged-away organisation names its canonical entry');
  const found = await f.call('/entries?q=' + encodeURIComponent('Ventures LP'));
  assert.deepEqual(found.body.entries.map((e: any) => e.uid), ['org-alpha'], 'a search by the old name finds the canonical entry');
  assert.equal(found.body.total, 1);

  const again = await f.call('/admin/entries/org-alpha-dup/merge', 'POST', 9, merge('org-alpha', 'orgs'));
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.merge.uid, r.body.merge.uid);
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_merges') + f.n('SELECT COUNT(*) AS n FROM network_directory_redirects'), 2);
  assert.equal(f.n("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='network_directory_merge'"), 1, 'a replay writes no second audit row');
  assert.equal((await f.call('/admin/entries/org-delta/merge', 'POST', 9, merge('org-alpha', 'orgs'))).body.error, 'idempotency_key_reused');
});

test('merging people keeps each member’s own overlays and every request where they were, and follows the redirect', async () => {
  const f = fixture();
  f.db.exec(`INSERT INTO network_directory_overlays(owner_user_id,entry_uid,saved,private_note) VALUES (1,'person-ada-dup',1,'Synthetic note on the duplicate.'),(2,'person-ada-dup',0,'Member two note.');
    INSERT INTO network_intro_requests(uid,requester_user_id,idempotency_key,target_entry_uid) VALUES ('req-1',1,'synthetic-req-1','person-ada-dup');`);
  const kept = evidence(f);
  const r = await f.call('/admin/entries/person-ada-dup/merge', 'POST', 9, merge('person-ada', 'people'));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.preserved.overlays, 2);
  assert.equal(r.body.preserved.intro_requests, 1);
  assert.equal(evidence(f), kept, 'overlays and the request keep their rows and targets');
  assert.equal(f.n("SELECT COUNT(*) AS n FROM network_directory_aliases"), 0, 'no alias is kept for a person');

  const mine = await f.call('/entries/person-ada-dup/overlay', 'GET', 1);
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.overlay, null);
  assert.deepEqual(mine.body.merged_overlays.map((o: any) => [o.merged_from, o.saved, o.private_note]), [['person-ada-dup', true, 'Synthetic note on the duplicate.']]);
  const theirs = await f.call('/entries/person-ada/overlay', 'GET', 2);
  assert.deepEqual(theirs.body.merged_overlays.map((o: any) => o.private_note), ['Member two note.'], 'each member reads only their own');
  assert.equal((await f.call('/entries/person-ada-dup/overlay', 'PUT', 1, { saved: true })).status, 200);
  assert.equal(f.n("SELECT COUNT(*) AS n FROM network_directory_overlays WHERE owner_user_id=1 AND entry_uid='person-ada'"), 1, 'a write through the old uid lands on the canonical entry');
  assert.equal((await f.call('/entries/person-ada-dup/overlay', 'DELETE', 1)).status, 200);
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_overlays WHERE owner_user_id=1'), 0, 'the member clears their own notes on the person');
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_overlays WHERE owner_user_id=2'), 1, 'and nobody else’s');

  const ada = await f.call('/entries/person-ada-dup');
  assert.equal(ada.body.entry.uid, 'person-ada');
  assert.deepEqual(ada.body.affiliations.map((a: any) => [a.organization.uid, a.title]), [['org-alpha', 'Partner'], ['org-gamma', 'Advisor']],
    'its own and the merged entry’s claims are listed; one to an unpublished organisation is not');
  assert.doesNotMatch(JSON.stringify(ada.body) + JSON.stringify(mine.body), new RegExp(MARKER + '|linked_user_id|rec-\\d'));
  assert.deepEqual((await f.call('/entries/org-gamma')).body.affiliations.map((x: any) => [x.person.uid, x.title]), [['person-ada', 'Advisor']],
    'a claim on the merged-away person names its canonical entry');
});

test('a later merge of the canonical entry keeps every redirect one hop', async () => {
  const f = fixture();
  assert.equal((await f.call('/admin/entries/org-alpha-dup/merge', 'POST', 9, merge('org-alpha', 'hop-1'))).status, 201);
  assert.equal((await f.call('/admin/entries/org-alpha/merge', 'POST', 9, merge('org-gamma', 'hop-2'))).status, 201);
  assert.deepEqual(f.rows('SELECT from_uid, to_uid FROM network_directory_redirects ORDER BY from_uid'),
    [{ from_uid: 'org-alpha', to_uid: 'org-gamma' }, { from_uid: 'org-alpha-dup', to_uid: 'org-gamma' }]);
  const old = await f.call('/entries/org-alpha-dup');
  assert.equal(old.body.entry.uid, 'org-gamma');
  assert.deepEqual(old.body.aliases, ['Alpha Example Ventures', 'Alpha Example Ventures LP'], 'aliases of entries merged in are kept');
  assert.deepEqual(old.body.affiliations.map((a: any) => [a.person.uid, a.title]), [['person-ada', 'Partner'], ['person-ada-dup', 'Partner'], ['person-ada-dup', 'Advisor']],
    'the canonical entry’s own claim and those of both entries merged into it');
});

test('a merge is refused, writing nothing, across kinds, into itself, from a linked entry, twice, or into a merged entry', async () => {
  const f = fixture();
  assert.equal((await f.call('/admin/entries/org-alpha-dup/merge', 'POST', 9, merge('org-alpha', 'first'))).status, 201);
  const merges = () => f.n('SELECT COUNT(*) AS n FROM network_directory_merges') * 100 + f.n('SELECT COUNT(*) AS n FROM network_directory_redirects') * 10
    + f.n("SELECT COUNT(*) AS n FROM network_directory_entries WHERE publication_status='archived'");
  const at = merges();
  const cases: [string, unknown, number, string][] = [
    ['/admin/entries/org-delta/merge', merge('person-bo', 'kind'), 409, 'kind_mismatch'],
    ['/admin/entries/org-delta/merge', merge('org-delta', 'self'), 400, 'merge_into_self'],
    ['/admin/entries/person-ada/merge', merge('person-bo', 'linked'), 409, 'merge_source_linked'],
    ['/admin/entries/org-alpha-dup/merge', merge('org-gamma', 'twice'), 409, 'already_merged'],
    ['/admin/entries/org-delta/merge', merge('org-alpha-dup', 'into-merged'), 409, 'merge_target_merged'],
    ['/admin/entries/org-delta/merge', merge('no-such', 'missing'), 404, 'merge_target_not_found'],
    ['/admin/entries/no-such/merge', merge('org-alpha', 'missing-from'), 404, 'entry_not_found'],
    ['/admin/entries/org-delta/merge', { idempotency_key: key('no-into'), reason: 'No target.' }, 400, 'invalid_into_uid'],
    ['/admin/entries/org-delta/merge', merge('org-alpha', 'bad-review', { review_uid: 'bad review!' }), 400, 'invalid_review_uid'],
    ['/admin/entries/org-delta/merge', merge('org-alpha', 'short', { reason: 'no' }), 400, 'invalid_reason'],
  ];
  for (const [path, body, status, code] of cases) {
    const r = await f.call(path, 'POST', 9, body);
    assert.deepEqual([r.status, r.body.error], [status, code], code);
  }
  const target = await f.call('/admin/entries/org-delta/merge', 'POST', 9, merge('org-alpha-dup', 'canonical-named'));
  assert.equal(target.body.canonical_uid, 'org-alpha', 'the refusal names the canonical entry');
  assert.equal(merges(), at);
});

test('an entry that changes between the checks and the batch is not merged', async () => {
  const f = fixture();
  const raced = { ...f.env, DB: { ...f.env.DB, prepare: f.env.DB.prepare.bind(f.env.DB),
    // Another operator verifies an account link on the entry after this request's checks passed.
    async batch(statements: unknown[]) {
      f.db.exec("UPDATE network_directory_entries SET linked_user_id=1, link_verified_by=9, link_verified_at='2026-11-20' WHERE uid='person-bo'");
      return f.env.DB.batch(statements);
    } } };
  await assert.rejects(mergeEntries(raced, 9, 'person-bo', mergeInput(merge('person-ada-dup', 'raced'))), (e: any) => e.code === 'entry_changed');
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_merges') + f.n('SELECT COUNT(*) AS n FROM network_directory_redirects'), 0);
  assert.equal((f.db.prepare("SELECT publication_status FROM network_directory_entries WHERE uid='person-bo'").get() as any).publication_status, 'staged', 'a linked entry is never merged away');
});

test('review items stay inspectable: a merge resolves the review it names, and an operator keeps separate or dismisses', async () => {
  const f = fixture();
  f.db.exec(`INSERT INTO network_directory_reviews(uid,source_record_uid,candidate_record_uid,reason) VALUES
    ('rev-dup','rec-1','rec-2','synthetic_duplicate_candidate'),
    ('rev-other','rec-3',NULL,'synthetic_title_review'),
    ('rev-kind','rec-4','rec-7','shared_source_linkedin_review');`);
  assert.equal((await f.call('/admin/entries/org-alpha-dup/merge', 'POST', 9, merge('org-alpha', 'rv-wrong', { review_uid: 'rev-other' }))).body.error, 'review_not_about_entries');
  assert.equal((await f.call('/admin/entries/org-alpha-dup/merge', 'POST', 9, merge('org-alpha', 'rv-none', { review_uid: 'rev-none' }))).body.error, 'review_not_found');
  const r = await f.call('/admin/entries/org-alpha-dup/merge', 'POST', 9, merge('org-alpha', 'rv', { review_uid: 'rev-dup' }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(f.rows("SELECT status FROM network_directory_reviews WHERE uid='rev-dup'"), [{ status: 'resolved' }]);
  assert.deepEqual(f.rows("SELECT decision, merge_uid FROM network_directory_review_decisions WHERE review_uid='rev-dup'"), [{ decision: 'resolved', merge_uid: r.body.merge.uid }]);

  // A person and an organisation sharing an identifier are never merged: the operator keeps them separate.
  const body = { decision: 'kept_separate', idempotency_key: key('kind'), reason: 'A person and their firm.' };
  assert.equal((await f.call('/admin/reviews/rev-kind/decision', 'POST', 1, body)).status, 403);
  const d = await f.call('/admin/reviews/rev-kind/decision', 'POST', 9, body);
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.equal(d.body.decision.decision, 'kept_separate');
  assert.equal((await f.call('/admin/reviews/rev-kind/decision', 'POST', 9, body)).body.replayed, true);
  assert.equal((await f.call('/admin/reviews/rev-kind/decision', 'POST', 9, { ...body, idempotency_key: key('kind-2') })).body.error, 'review_not_pending');
  assert.equal((await f.call('/admin/reviews/rev-other/decision', 'POST', 9, { ...body, decision: 'resolved', idempotency_key: key('res') })).body.error, 'invalid_decision');
  assert.equal((await f.call('/admin/reviews/rev-other/decision', 'POST', 9, { ...body })).body.error, 'idempotency_key_reused');
  assert.equal((await f.call('/admin/reviews/rev-none/decision', 'POST', 9, { ...body, idempotency_key: key('none') })).status, 404);
  assert.equal(f.n("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='network_directory_review_decision'"), 1);

  const listed = await f.call('/admin/reviews?status=all', 'GET', 9);
  assert.deepEqual(listed.body.reviews.map((x: any) => [x.uid, x.status]), [['rev-dup', 'resolved'], ['rev-kind', 'kept_separate'], ['rev-other', 'pending']],
    'decided reviews are still listed with their observations');
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_source_records'), 7);
});

test('the merged entity’s readiness reads every merged source row: a later hold on the duplicate blocks it', async () => {
  const f = fixture();
  f.db.exec("UPDATE network_directory_entries SET publication_status='staged' WHERE uid='org-alpha'");
  assert.equal((await f.call('/admin/entries/org-alpha-dup/merge', 'POST', 9, merge('org-alpha', 'ready'))).status, 201);
  assert.deepEqual(await readiness(f.env, 'org-alpha'), { ready: true, blockers: [], checked_source_record_uid: 'rec-1' }, 'the entry’s own observation is the one checked');
  const other = fixture();
  assert.equal((await other.call('/admin/entries/org-alpha/merge', 'POST', 9, merge('org-delta', 'ready-own'))).status, 201);
  assert.equal((await readiness(other.env, 'org-delta')).checked_source_record_uid, 'rec-4', 'its own observation, though the merged row sorts first');
  f.record(null, null, 'review', '2026-11-25T00:00:00.000Z', 'org-alpha-dup', 'src-b');
  assert.deepEqual((await readiness(f.env, 'org-alpha')).blockers, ['latest_observation_not_accepted']);
  const refused = await f.call('/admin/entries/org-alpha/publish', 'POST', 9, { idempotency_key: key('pub'), reason: 'Should be held.' });
  assert.deepEqual([refused.status, refused.body.error], [409, 'publication_not_ready']);
});

test('aliases are organisation-only operator names; a competing name is refused for review; a withdrawal keeps the row', async () => {
  const f = fixture();
  const add = (uid: string, alias: string, k: string) => f.call(`/admin/entries/${uid}/aliases`, 'POST', 9, { alias, idempotency_key: key(k), reason: 'Known by this name.' });
  const r = await add('org-alpha', '  Alpha   Example  ', 'a1');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.alias.alias, 'Alpha Example');
  assert.equal((await add('org-alpha', 'Alpha Example', 'a1')).body.replayed, true);
  assert.equal(f.n("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='network_directory_alias_add'"), 1);
  const search = await f.call('/entries?q=' + encodeURIComponent('Alpha Example'));
  assert.deepEqual(search.body.entries.map((e: any) => e.uid), ['org-alpha']);
  assert.deepEqual((await f.call('/entries/org-alpha')).body.aliases, ['Alpha Example']);
  const refusals: [string, string, string, number, string][] = [
    ['org-alpha', 'alpha example', 'a2', 409, 'alias_exists'],
    ['org-alpha', 'ALPHA EXAMPLE VENTURES', 'a3', 409, 'alias_is_name'],
    ['org-gamma', 'Alpha Example Ventures LP', 'a4', 409, 'alias_conflict'],
    ['org-gamma', 'Alpha Example', 'a5', 409, 'alias_conflict'],
    ['person-bo', 'Bo', 'a6', 409, 'alias_organisation_only'],
    ['org-gamma', 'partners@example.test', 'a7', 400, 'alias_not_a_name'],
    ['org-gamma', 'https://example.org/gamma', 'a8', 400, 'alias_not_a_name'],
    ['org-gamma', '+1 555 010 0000', 'a9', 400, 'alias_not_a_name'],
    ['org-gamma', 'x'.repeat(301), 'a10', 400, 'invalid_alias'],
    ['org-beta-none', 'Beta', 'a11', 404, 'entry_not_found'],
  ];
  for (const [uid, alias, k, status, code] of refusals) {
    const x = await add(uid, alias, k);
    assert.deepEqual([x.status, x.body.error], [status, code], code + ' ' + alias);
  }
  const conflict = await add('org-gamma', 'Alpha Example', 'a12');
  assert.deepEqual(conflict.body.conflicting_uids, ['org-alpha'], 'the competing organisation is named for the operator');
  assert.equal((await add('org-alpha', 'Gamma Short', 'a1')).body.error, 'idempotency_key_reused');

  const w = await f.call(`/admin/aliases/${r.body.alias.uid}/withdraw`, 'POST', 9, { idempotency_key: key('w1'), reason: 'Not a name the firm uses.' });
  assert.equal(w.status, 201, JSON.stringify(w.body));
  assert.deepEqual([w.body.alias.status, w.body.alias.withdrawn_by], ['withdrawn', 9]);
  assert.equal((await f.call(`/admin/aliases/${r.body.alias.uid}/withdraw`, 'POST', 9, { idempotency_key: key('w1'), reason: 'Not a name the firm uses.' })).body.replayed, true);
  assert.equal((await f.call(`/admin/aliases/${r.body.alias.uid}/withdraw`, 'POST', 9, { idempotency_key: key('w2'), reason: 'Again.' })).body.error, 'alias_already_withdrawn');
  assert.equal((await f.call('/admin/aliases/no-such/withdraw', 'POST', 9, { idempotency_key: key('w3'), reason: 'Missing.' })).status, 404);
  assert.equal((await f.call('/entries?q=' + encodeURIComponent('Alpha Example'))).body.total, 1, 'only the name matches now');
  assert.deepEqual((await f.call('/entries/org-alpha')).body.aliases, []);
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_aliases'), 1, 'the withdrawn alias row is kept');
  assert.equal((await add('org-gamma', 'Alpha Example', 'a13')).status, 201, 'a withdrawn alias no longer competes');
  assert.equal((await add('org-alpha-dup', 'Alpha LP', 'a14')).status, 201);
  assert.equal((await f.call('/admin/entries/org-alpha-dup/merge', 'POST', 9, merge('org-alpha', 'al'))).status, 201);
  assert.equal((await add('org-alpha-dup', 'Alpha Two', 'a15')).body.error, 'alias_on_merged_entry');
  assert.equal(aliasKey('  Ünïcode   ACME '), 'Ünïcode acme', 'only ASCII letters fold, as SQLite lower() does');
});

test('the operator detail shows merges, observations, reviews with decisions and aliases, and no private cell', async () => {
  const f = fixture();
  f.db.exec("INSERT INTO network_directory_reviews(uid,source_record_uid,candidate_record_uid,reason) VALUES ('rev-dup','rec-1','rec-2','synthetic_duplicate_candidate')");
  f.record(null, null, 'review', '2026-11-20T00:00:00.000Z', 'org-alpha-dup', 'src-b');
  assert.equal((await f.call('/admin/entries/org-alpha-dup/merge', 'POST', 9, merge('org-alpha', 'detail', { review_uid: 'rev-dup' }))).status, 201);
  const d = await f.call('/admin/entries/org-alpha', 'GET', 9);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.deepEqual(d.body.merged_from, ['org-alpha-dup']);
  assert.equal(d.body.merged_into, null);
  assert.deepEqual(d.body.observations.map((o: any) => [o.uid, o.disposition]), [['rec-1', 'accept'], ['rec-8', 'review'], ['rec-2', 'accept']]);
  assert.deepEqual(d.body.reviews.map((r: any) => [r.uid, r.status, r.decision?.decision]), [['rev-dup', 'resolved', 'resolved']]);
  assert.deepEqual(d.body.aliases.map((a: any) => [a.alias, a.origin]), [['Alpha Example Ventures LP', 'merge']]);
  assert.deepEqual(d.body.readiness.blockers, ['latest_observation_not_accepted']);
  assert.equal(d.body.entry.account_linked, false);
  const old = await f.call('/admin/entries/org-alpha-dup', 'GET', 9);
  assert.equal(old.body.merged_into, 'org-alpha');
  assert.equal(old.body.readiness, null);
  assert.equal(old.body.preserved.source_records, 1);
  assert.doesNotMatch(JSON.stringify(d.body) + JSON.stringify(old.body), new RegExp(MARKER));
  assert.equal((await f.call('/admin/entries/no-such', 'GET', 9)).status, 404);
});

test('a redirect never reveals a hidden canonical entry, and a staged duplicate merged into nothing visible stays hidden', async () => {
  const f = fixture();
  assert.equal((await f.call('/admin/entries/org-gamma/merge', 'POST', 9, merge('org-delta', 'hidden'))).status, 201);
  const r = await f.call('/entries/org-gamma');
  assert.deepEqual([r.status, r.body.error], [404, 'entry_not_found'], 'the published duplicate now redirects to a staged entry, which members cannot see');
  assert.doesNotMatch(JSON.stringify(r.body), /org-delta|Delta/);
  assert.equal((await f.call('/entries?q=Gamma')).body.total, 0);
  assert.equal((await f.call('/entries/org-gamma/overlay', 'GET', 1)).status, 404);
});

test('the merge service reads no private source cell and creates no account, relationship or notice', () => {
  const src = readFileSync(new URL('../src/services/networkDirectoryMerge.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /network_directory_private_sources/);
  assert.doesNotMatch(code, /INSERT INTO (users|partner_relationships|notifications_inbox|network_connections|network_directory_book_links|network_intro_requests)\b/);
  assert.doesNotMatch(code, /UPDATE (network_directory_source_records|network_directory_affiliations|network_directory_overlays|network_intro_requests)\b/);
  assert.doesNotMatch(code, /DELETE FROM/);
});
