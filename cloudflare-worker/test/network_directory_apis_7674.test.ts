/** D7674 (#7674): directory reads, private overlays and reviewed publication over the migrated schema. Synthetic people and organisations only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import directory from '../src/routes/network_directory.ts';
import { publishEntry, readiness } from '../src/services/networkDirectory.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';

test.after(removeMigratedDatabases);
const SECRET = 'synthetic-7674-directory-secret-'.repeat(3);
const MARKER = 'PLANTED-7674-PRIVATE-MARKER';
const migration = readFileSync(new URL('../sql/migrations/202611220337_7674_network_directory_overlay_publication.sql', import.meta.url), 'utf8');

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
    INSERT INTO network_directory_sources(uid,name,url) VALUES ('src-a','Synthetic source A','https://example.org/a');
  `);
  for (const id of [1, 2, 8, 9]) db.prepare(`INSERT INTO user_sessions(user_id,jti,factor,assurance_level,last_step_up_at) VALUES (?,?,'totp','totp',datetime('now'))`).run(id, 'synthetic-' + id);
  const entry = (uid: string, kind: string, name: string, publication = 'staged', extra: Record<string, unknown> = {}) => {
    db.prepare(`INSERT INTO network_directory_entries(uid,kind,source_uid,source_external_id,display_name,geography,sectors_json,currently_investing,publication_status,verification_status,observed_at,linked_user_id,linked_company_id,link_verified_by,link_verified_at)
      VALUES (?,?,'src-a',?,?,?,?,?,?,?,'2026-11-19T12:00:00.000Z',?,?,?,?)`).run(uid, kind, 'ext-' + uid, name, (extra.geography as string) ?? null,
      JSON.stringify(extra.sectors ?? []), (extra.investing as number | null) ?? null, publication, (extra.verification as string) ?? 'unverified_source_claim',
      (extra.user as number) ?? null, null, extra.user ? 9 : null, extra.user ? '2026-11-19' : null);
    record(uid, kind, 'accept', '2026-11-19T12:00:00.000Z');
  };
  let seq = 0;
  const record = (entryUid: string | null, kind: string | null, disposition: string, observedAt: string, external = entryUid, content = 'c1') => {
    const uid = 'rec-' + (++seq);
    db.prepare(`INSERT INTO network_directory_source_records(uid,source_uid,external_record_id,content_hash,decision_hash,entry_uid,entry_kind,disposition,observed_at)
      VALUES (?,'src-a',?,?,?,?,?,?,?)`).run(uid, 'ext-' + external, content + seq, 'd' + seq, disposition === 'accept' ? entryUid : null, disposition === 'accept' ? kind : null, disposition, observedAt);
    db.prepare(`INSERT INTO network_directory_private_sources(source_record_uid,raw_json) VALUES (?,?)`).run(uid, JSON.stringify({ Email: MARKER + '@example.test', Note: MARKER }));
    return uid;
  };
  entry('org-alpha', 'organization', 'Alpha Example Ventures', 'published', { sectors: ['Software'], geography: 'Example Region' });
  entry('org-beta', 'organization', 'Beta Example Capital', 'staged');
  entry('org-hidden', 'organization', 'Hidden Example Fund', 'suppressed');
  entry('org-withdrawn', 'organization', 'Withdrawn Example Partners', 'published', { verification: 'withdrawn' });
  entry('person-ada', 'person', 'Ada Example', 'published', { investing: 0, user: 2 });
  entry('person-bo', 'person', 'Bo Example', 'staged');
  entry('person-cy', 'person', 'Cy 100% Example', 'published', { investing: null });
  const aff = (uid: string, person: string, org: string, extra: Record<string, unknown> = {}) => {
    const rec = db.prepare("SELECT uid FROM network_directory_source_records WHERE entry_uid=? ORDER BY uid LIMIT 1").get(person) as any;
    db.prepare(`INSERT INTO network_directory_affiliations(uid,person_uid,organization_uid,source_record_uid,title,is_current,verification_status,observed_at)
      VALUES (?,?,?,?,?,?,?,'2026-11-19T12:00:00.000Z')`).run(uid, person, org, rec.uid, (extra.title as string) ?? null, (extra.current as number | null) ?? null, (extra.verification as string) ?? 'unverified_source_claim');
  };
  aff('aff-1', 'person-ada', 'org-alpha', { title: 'Partner' });
  aff('aff-2', 'person-bo', 'org-alpha');
  aff('aff-3', 'person-cy', 'org-alpha', { verification: 'withdrawn' });
  aff('aff-4', 'person-ada', 'org-hidden', { current: 1 });

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
  return { db, env, call, record, n };
}

const SIDE_EFFECT_TABLES = ['partner_relationships', 'network_connections', 'notifications_inbox', 'network_directory_book_links', 'user_company_links', 'company_people', 'company_profiles'];
const sideEffects = (f: ReturnType<typeof fixture>) => Object.fromEntries(SIDE_EFFECT_TABLES.map(t => [t, f.n(`SELECT COUNT(*) AS n FROM ${t}`)]));

test('the migration adds the overlay and the publication ledger with their constraints, and replays', () => {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const cols = (t: string) => (db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as any[]).map(r => r.name);
  assert.deepEqual(cols('network_directory_overlays'), ['owner_user_id', 'entry_uid', 'entry_kind', 'saved', 'private_note', 'updated_at']);
  assert.ok(cols('network_directory_publication_events').includes('idempotency_key'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_network_directory_publication_entry'").get());
  db.exec(migration);
  db.exec("INSERT INTO users(id,email,name,role) VALUES (1,'a@example.test','A','founder'); INSERT INTO network_directory_sources VALUES ('s','S','https://example.org');");
  db.exec("INSERT INTO network_directory_entries(uid,kind,source_uid,source_external_id,display_name,observed_at) VALUES ('p','person','s','1','P','2026'),('o','organization','s','2','O','2026')");
  db.exec("INSERT INTO network_directory_overlays(owner_user_id,entry_uid) VALUES (1,'p')");
  assert.throws(() => db.exec("INSERT INTO network_directory_overlays(owner_user_id,entry_uid,entry_kind) VALUES (1,'o','organization')"), /CHECK/);
  assert.throws(() => db.exec(`INSERT INTO network_directory_overlays(owner_user_id,entry_uid,private_note) VALUES (1,'q','${'x'.repeat(2001)}')`), /CHECK|FOREIGN/);
  db.exec("INSERT INTO network_directory_publication_events(uid,idempotency_key,entry_uid,action,from_status,to_status,reason,actor_user_id) VALUES ('e1','key-00001','o','publish','staged','published','because',1)");
  assert.throws(() => db.exec("INSERT INTO network_directory_publication_events(uid,idempotency_key,entry_uid,action,from_status,to_status,reason,actor_user_id) VALUES ('e2','key-00001','o','suppress','published','suppressed','because',1)"), /UNIQUE/);
  db.close();
});

test('members search published, unwithdrawn entries only, with a true total, cursor pages and a literal search', async () => {
  const f = fixture();
  const all = await f.call('/entries?limit=2');
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.total, 3);
  assert.deepEqual(all.body.entries.map((e: any) => e.uid), ['person-ada', 'org-alpha']);
  const second = await f.call('/entries?limit=2&cursor=' + encodeURIComponent(all.body.next_cursor));
  assert.deepEqual(second.body.entries.map((e: any) => e.uid), ['person-cy']);
  assert.equal(second.body.next_cursor, null);
  assert.equal(second.body.total, 3);
  assert.deepEqual((await f.call('/entries?kind=organization')).body.entries.map((e: any) => e.uid), ['org-alpha']);
  const literal = await f.call('/entries?q=' + encodeURIComponent('100%'));
  assert.deepEqual(literal.body.entries.map((e: any) => e.uid), ['person-cy'], 'a % in a search is the character, not a wildcard');
  assert.equal((await f.call('/entries?q=' + encodeURIComponent('%'))).body.total, 1);
  for (const bad of ['?limit=0', '?limit=51', '?kind=fund', '?cursor=not-a-cursor', '?q=' + 'x'.repeat(101)]) assert.equal((await f.call('/entries' + bad)).status, 400, bad);
  assert.equal((await f.call('/entries', 'GET', null)).status, 401);
});

test('a member read never carries account links, private source cells, source row ids or review items', async () => {
  const f = fixture();
  f.db.exec("INSERT INTO network_directory_reviews(uid,source_record_uid,reason) VALUES ('rev-dup','rec-1','synthetic_duplicate_candidate')");
  const list = JSON.stringify((await f.call('/entries')).body);
  const one = await f.call('/entries/person-ada');
  const text = list + JSON.stringify(one.body);
  assert.doesNotMatch(text, new RegExp(MARKER));
  assert.doesNotMatch(text, /linked_user_id|linked_company_id|link_verified|source_external_id|ext-person|rec-\d|rev-dup|synthetic_duplicate|example\.test|publication_status/);
  const ada = one.body.entry;
  assert.equal(ada.currently_investing, undefined, 'a person’s projection carries no investing status (D7674 part 4)');
  f.db.exec("UPDATE network_directory_entries SET currently_investing=0 WHERE uid='org-alpha'");
  assert.equal((await f.call('/entries/org-alpha')).body.entry.currently_investing, false);
  f.db.exec("UPDATE network_directory_entries SET currently_investing=NULL WHERE uid='org-alpha'");
  assert.equal((await f.call('/entries/org-alpha')).body.entry.currently_investing, null, 'unknown stays unknown');
  assert.deepEqual(ada.source, { name: 'Synthetic source A', observed_at: '2026-11-19T12:00:00.000Z' });
});

test('detail lists sourced associations to visible entries only, with unknown currentness kept unknown', async () => {
  const f = fixture();
  const org = await f.call('/entries/org-alpha');
  assert.equal(org.status, 200);
  assert.deepEqual(org.body.affiliations.map((a: any) => [a.person.uid, a.title, a.current, a.verification, a.relation]),
    [['person-ada', 'Partner', 'unknown', 'unverified_source_claim', 'source_association']],
    'a staged person and a withdrawn association are left out; currentness is never inferred');
  const ada = await f.call('/entries/person-ada');
  assert.deepEqual(ada.body.affiliations.map((a: any) => a.organization.uid), ['org-alpha'], 'an association to a suppressed organisation is not shown');
  for (const uid of ['org-beta', 'org-hidden', 'org-withdrawn', 'person-bo', 'no-such']) assert.equal((await f.call('/entries/' + uid)).status, 404, uid);
  assert.equal((await f.call('/entries/' + encodeURIComponent('bad uid!'))).status, 400);
});

test('an overlay is the caller’s alone, on a published person, and creates no relationship', async () => {
  const f = fixture();
  const before = sideEffects(f);
  assert.deepEqual((await f.call('/entries/person-ada/overlay')).body, { overlay: null, merged_overlays: [] });
  const put = await f.call('/entries/person-ada/overlay', 'PUT', 1, { saved: true, private_note: '  Met at a synthetic event.  ' });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.overlay.saved, true);
  assert.equal(put.body.overlay.private_note, 'Met at a synthetic event.');
  const partial = await f.call('/entries/person-ada/overlay', 'PUT', 1, { saved: false });
  assert.equal(partial.body.overlay.private_note, 'Met at a synthetic event.', 'a partial change keeps the other field');
  assert.equal(partial.body.overlay.saved, false);
  assert.deepEqual((await f.call('/entries/person-ada/overlay', 'GET', 2)).body, { overlay: null, merged_overlays: [] }, 'member two never reads member one’s note');
  assert.doesNotMatch(JSON.stringify((await f.call('/entries/person-ada', 'GET', 2)).body), /synthetic event/);
  assert.equal((await f.call('/entries/person-ada/overlay', 'GET', 1, undefined, { impersonated_by: 9 })).status, 403);
  assert.equal((await f.call('/entries/person-ada/overlay', 'PUT', 1, { saved: true }, { impersonated_by: 9 })).status, 403);
  assert.equal((await f.call('/entries/org-alpha/overlay', 'PUT', 1, { saved: true })).status, 409);
  assert.equal((await f.call('/entries/person-bo/overlay', 'PUT', 1, { saved: true })).status, 404, 'a staged person takes no overlay');
  for (const bad of [{}, { saved: 'yes' }, { private_note: 7 }, { private_note: 'x'.repeat(2001) }]) assert.equal((await f.call('/entries/person-ada/overlay', 'PUT', 1, bad)).status, 400, JSON.stringify(bad));
  assert.equal((await f.call('/entries/person-ada/overlay', 'DELETE', 1)).status, 200);
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_overlays WHERE owner_user_id=1'), 0);
  assert.deepEqual(sideEffects(f), before);
});

test('operators read readiness and review items without raw source cells; members and plain admins cannot', async () => {
  const f = fixture();
  f.db.exec("INSERT INTO network_directory_reviews(uid,source_record_uid,candidate_record_uid,reason) VALUES ('rev-1','rec-2','rec-6','synthetic_shared_channel')");
  for (const who of [1, 8]) {
    assert.equal((await f.call('/admin/entries', 'GET', who)).status, 403, String(who));
    assert.equal((await f.call('/admin/reviews', 'GET', who)).status, 403, String(who));
  }
  const staged = await f.call('/admin/entries', 'GET', 9);
  assert.equal(staged.status, 200, JSON.stringify(staged.body));
  assert.deepEqual(staged.body.entries.map((e: any) => [e.uid, e.readiness.blockers]),
    [['org-beta', ['open_review']], ['person-bo', ['open_review']]]);
  const reviews = await f.call('/admin/reviews', 'GET', 9);
  assert.equal(reviews.body.total, 1);
  assert.equal(reviews.body.reviews[0].reason, 'synthetic_shared_channel');
  assert.equal(reviews.body.reviews[0].candidate.source_record_uid, 'rec-6');
  assert.doesNotMatch(JSON.stringify(staged.body) + JSON.stringify(reviews.body), new RegExp(MARKER));
});

const key = (s: string) => 'synthetic-key-' + s;

test('publishing an organisation is write-barred, idempotent, audited and read back', async () => {
  const f = fixture();
  const before = sideEffects(f);
  const req = { idempotency_key: key('beta-1'), reason: 'Reviewed against the source page.' };
  assert.equal((await f.call('/admin/entries/org-beta/publish', 'POST', 1, req)).status, 403);
  assert.equal((await f.call('/admin/entries/org-beta/publish', 'POST', 8, req)).status, 403);
  f.db.exec("UPDATE user_sessions SET created_at=datetime('now','-2 days'), last_step_up_at=datetime('now','-2 days') WHERE user_id=9");
  assert.notEqual((await f.call('/admin/entries/org-beta/publish', 'POST', 9, req)).status, 201, 'a stale step-up does not pass the write bar');
  f.db.exec("UPDATE user_sessions SET last_step_up_at=datetime('now') WHERE user_id=9");
  const r = await f.call('/admin/entries/org-beta/publish', 'POST', 9, req);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.entry.publication_status, 'published');
  assert.equal(r.body.event.checked_source_record_uid, 'rec-2');
  assert.equal(r.body.event.actor_user_id, 9);
  assert.equal(r.body.replayed, false);
  const again = await f.call('/admin/entries/org-beta/publish', 'POST', 9, req);
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.event.uid, r.body.event.uid);
  assert.equal(f.n("SELECT COUNT(*) AS n FROM network_directory_publication_events WHERE entry_uid='org-beta'"), 1);
  assert.equal(f.n("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='network_directory_publish'"), 1);
  assert.equal((await f.call('/admin/entries/org-alpha/publish', 'POST', 9, req)).body.error, 'idempotency_key_reused');
  assert.equal((await f.call('/entries/org-beta')).status, 200, 'members now read it');
  assert.equal((await f.call('/admin/entries/org-beta/publish', 'POST', 9, { ...req, idempotency_key: key('beta-2') })).body.error, 'already_published');
  for (const bad of [{ reason: 'ok reason' }, { idempotency_key: 'short', reason: 'ok reason' }, { idempotency_key: key('x'), reason: 'no' }]) {
    assert.equal((await f.call('/admin/entries/org-beta/publish', 'POST', 9, bad)).status, 400, JSON.stringify(bad));
  }
  assert.deepEqual(sideEffects(f), before);
});

test('a ready person is published through the same reviewed action, and members read the professional projection (D7674 part 4)', async () => {
  const f = fixture();
  const r = await f.call('/admin/entries/person-bo/publish', 'POST', 9, { idempotency_key: key('bo'), reason: 'Reviewed synthetic person.' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((f.db.prepare("SELECT publication_status FROM network_directory_entries WHERE uid='person-bo'").get() as any).publication_status, 'published');
  assert.deepEqual(Object.keys((await f.call('/entries/person-bo')).body.entry).sort(),
    ['first_name', 'geography', 'kind', 'last_name', 'name', 'profile_url', 'sectors', 'source', 'uid', 'verification']);
  const held = fixture();
  held.record(null, null, 'review', '2026-11-20T09:00:00.000Z', 'person-bo');
  const refused = await held.call('/admin/entries/person-bo/publish', 'POST', 9, { idempotency_key: key('bo'), reason: 'Should be refused.' });
  assert.equal(refused.body.error, 'publication_not_ready', 'a person is held to the same readiness as an organisation');
  assert.equal(held.n('SELECT COUNT(*) AS n FROM network_directory_publication_events'), 0);
});

test('the latest observation decides: a later hold, a same-time conflict or an open review blocks publication', async () => {
  const later = fixture();
  later.record(null, null, 'review', '2026-11-20T09:00:00.000Z', 'org-beta');
  const held = await later.call('/admin/entries/org-beta/publish', 'POST', 9, { idempotency_key: key('held'), reason: 'Should be refused.' });
  assert.equal(held.status, 409);
  assert.deepEqual(held.body.blockers, ['latest_observation_not_accepted']);

  const tie = fixture();
  tie.record(null, null, 'review', '2026-11-19T12:00:00.000Z', 'org-beta', 'c-other');
  assert.deepEqual(await readiness(tie.env, 'org-beta'), { ready: false, blockers: ['same_time_conflict'], checked_source_record_uid: null },
    'two different observations at the same time need review, whichever sorts first');

  const older = fixture();
  older.record(null, null, 'review', '2026-11-01T00:00:00.000Z', 'org-beta');
  assert.deepEqual(await readiness(older.env, 'org-beta'), { ready: true, blockers: [], checked_source_record_uid: 'rec-2' }, 'an older hold does not block a newer acceptance');

  const review = fixture();
  review.db.exec("INSERT INTO network_directory_reviews(uid,source_record_uid,reason) VALUES ('rev-b','rec-2','synthetic_title_review')");
  assert.deepEqual((await readiness(review.env, 'org-beta')).blockers, ['open_review']);
  review.db.exec("UPDATE network_directory_reviews SET status='resolved'");
  assert.equal((await readiness(review.env, 'org-beta')).ready, true);

  const none = fixture();
  none.db.exec("DELETE FROM network_directory_private_sources WHERE source_record_uid='rec-2'; DELETE FROM network_directory_source_records WHERE uid='rec-2'");
  assert.deepEqual((await readiness(none.env, 'org-beta')).blockers, ['no_source_record']);
});

test('concurrent publication of one entry writes one event; suppressed and withdrawn entries are not published', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([
    f.call('/admin/entries/org-beta/publish', 'POST', 9, { idempotency_key: key('race-a'), reason: 'First request.' }),
    f.call('/admin/entries/org-beta/publish', 'POST', 9, { idempotency_key: key('race-b'), reason: 'Second request.' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(f.n("SELECT COUNT(*) AS n FROM network_directory_publication_events WHERE entry_uid='org-beta'"), 1);
  assert.equal((await f.call('/admin/entries/org-hidden/publish', 'POST', 9, { idempotency_key: key('hidden'), reason: 'Not staged.' })).body.error, 'entry_not_staged');
  assert.equal((await f.call('/admin/entries/org-withdrawn/publish', 'POST', 9, { idempotency_key: key('wd'), reason: 'Withdrawn.' })).body.error, 'entry_withdrawn');
  assert.equal((await f.call('/admin/entries/no-such/publish', 'POST', 9, { idempotency_key: key('none'), reason: 'Missing.' })).status, 404);
});

test('an entry that changes between the checks and the write gets no event and no move', async () => {
  const f = fixture();
  // Another operator suppresses the entry after this request's checks passed and before its batch runs.
  const raced = { ...f.env, DB: { ...f.env.DB, prepare: f.env.DB.prepare.bind(f.env.DB),
    async batch(statements: unknown[]) { f.db.exec("UPDATE network_directory_entries SET publication_status='suppressed' WHERE uid='org-beta'"); return f.env.DB.batch(statements); } } };
  await assert.rejects(publishEntry(raced, 9, 'org-beta', { key: key('raced'), reason: 'Checks passed, then the entry moved.' }), (e: any) => e.code === 'entry_changed');
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_publication_events'), 0);
  assert.equal((f.db.prepare("SELECT publication_status FROM network_directory_entries WHERE uid='org-beta'").get() as any).publication_status, 'suppressed');
});

test('suppressing hides an entry from members and keeps its sources, overlays and history', async () => {
  const f = fixture();
  assert.equal((await f.call('/entries/person-ada/overlay', 'PUT', 1, { saved: true })).status, 200);
  const r = await f.call('/admin/entries/person-ada/suppress', 'POST', 9, { idempotency_key: key('ada-s'), reason: 'Source correction requested.' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.event.from_status, 'published');
  assert.equal((await f.call('/entries/person-ada')).status, 404);
  assert.equal((await f.call('/entries')).body.total, 2);
  assert.deepEqual((await f.call('/entries/org-alpha')).body.affiliations, [], 'the suppressed person leaves the organisation’s list');
  assert.equal(f.n('SELECT COUNT(*) AS n FROM network_directory_overlays'), 1);
  assert.equal(f.n("SELECT COUNT(*) AS n FROM network_directory_source_records WHERE entry_uid='person-ada'"), 1);
  assert.equal((await f.call('/admin/entries/person-ada/suppress', 'POST', 9, { idempotency_key: key('ada-s'), reason: 'Source correction requested.' })).body.replayed, true);
  assert.equal((await f.call('/admin/entries/person-ada/suppress', 'POST', 9, { idempotency_key: key('ada-s2'), reason: 'Again.' })).body.error, 'already_suppressed');
  assert.equal((await f.call('/admin/entries/person-ada/suppress', 'POST', 8, { idempotency_key: key('ada-s3'), reason: 'Plain admin.' })).status, 403);
});

test('no route in the directory router reads the operator-only private table', () => {
  const route = readFileSync(new URL('../src/routes/network_directory.ts', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/services/networkDirectory.ts', import.meta.url), 'utf8');
  for (const src of [route, service]) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /network_directory_private_sources/);
    assert.doesNotMatch(code, /INSERT INTO (users|partner_relationships|notifications_inbox|network_connections|network_directory_book_links)\b/);
  }
});
