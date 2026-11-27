/** D9071 (#9071): distinct published people per published organization, by affiliation status. Synthetic entries only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import directory from '../src/routes/network_directory.ts';
import { countUids } from '../src/services/networkDirectoryOrgPeople.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

test.after(removeMigratedDatabases);
const SECRET = 'synthetic-9071-directory-secret-'.repeat(3);
const NOTE = 'PLANTED-9071-PRIVATE-NOTE';

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,email,name,role,is_active) VALUES
      (1,'member-one@example.test','Synthetic member one','founder',1),
      (2,'member-two@example.test','Synthetic member two','investor',1);
    INSERT INTO network_directory_sources(uid,name,url) VALUES ('src-a','Synthetic source A','https://example.org/a');
  `);
  for (const id of [1, 2]) db.prepare(`INSERT INTO user_sessions(user_id,jti,factor,assurance_level,last_step_up_at) VALUES (?,?,'totp','totp',datetime('now'))`).run(id, 'synthetic-' + id);
  let seq = 0;
  const entry = (uid: string, kind: string, name: string, publication = 'published', verification = 'unverified_source_claim') => {
    db.prepare(`INSERT INTO network_directory_entries(uid,kind,source_uid,source_external_id,display_name,publication_status,verification_status,observed_at)
      VALUES (?,?,'src-a',?,?,?,?,'2026-11-19T12:00:00.000Z')`).run(uid, kind, 'ext-' + uid, name, publication, verification);
    const rec = 'rec-' + (++seq);
    db.prepare(`INSERT INTO network_directory_source_records(uid,source_uid,external_record_id,content_hash,decision_hash,entry_uid,entry_kind,disposition,observed_at)
      VALUES (?,'src-a',?,?,?,?,?,'accept','2026-11-19T12:00:00.000Z')`).run(rec, 'ext-' + uid, 'c' + seq, 'd' + seq, uid, kind);
  };
  let a = 0;
  const aff = (person: string, org: string, current: number | null, verification = 'unverified_source_claim') => {
    const rec = db.prepare('SELECT uid FROM network_directory_source_records WHERE entry_uid=? LIMIT 1').get(person) as any;
    db.prepare(`INSERT INTO network_directory_affiliations(uid,person_uid,organization_uid,source_record_uid,title,is_current,verification_status,observed_at)
      VALUES (?,?,?,?,'Partner',?,?,'2026-11-19T12:00:00.000Z')`).run('aff-' + (++a), person, org, rec.uid, current, verification);
  };
  entry('org-alpha', 'organization', 'Alpha Example Ventures');
  entry('org-empty', 'organization', 'Empty Example Partners');
  entry('org-staged', 'organization', 'Staged Example Fund', 'staged');
  entry('org-withdrawn', 'organization', 'Withdrawn Example Capital', 'published', 'withdrawn');
  entry('p-cur', 'person', 'Current Example');
  entry('p-both', 'person', 'Both Example');
  entry('p-former', 'person', 'Former Example');
  entry('p-undated', 'person', 'Undated Example');
  entry('p-staged', 'person', 'Staged Example', 'staged');
  entry('p-withdrawn', 'person', 'Withdrawn Example', 'published', 'withdrawn');
  entry('p-gone', 'person', 'Withdrawn Claim Example');
  aff('p-cur', 'org-alpha', 1);
  aff('p-both', 'org-alpha', 0);
  aff('p-both', 'org-alpha', 1);           // one person, a former and a current claim: counted once, as current
  aff('p-former', 'org-alpha', 0);
  aff('p-undated', 'org-alpha', null);     // undated: status not recorded, never assumed current
  aff('p-staged', 'org-alpha', 1);         // an unpublished person is not counted
  aff('p-withdrawn', 'org-alpha', 1);      // a withdrawn person is not counted
  aff('p-gone', 'org-alpha', 1, 'withdrawn'); // a withdrawn affiliation is not counted
  aff('p-cur', 'org-staged', 1);
  db.prepare(`INSERT INTO network_directory_overlays(owner_user_id,entry_uid,entry_kind,saved,private_note) VALUES (1,'p-cur','person',1,?)`).run(NOTE);

  const app = new Hono<any>().route('/api/network/directory', directory);
  app.onError((e, c) => c.json({ error: 'refused' }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  async function call(path: string, who: number | null = 2) {
    const headers: Record<string, string> = {};
    if (who !== null) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who, jti: 'synthetic-' + who })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request('https://unit.test/api/network/directory' + path, { headers }, env,
      { waitUntil() {}, passThroughOnException() {} } as any);
    const text = await r.text();
    return { status: r.status, text, body: JSON.parse(text) as any };
  }
  return { call };
}

test('distinct published people per published organization, by status; hidden entries and claims are not counted', async () => {
  const f = fixture();
  const r = await f.call('/organizations/people-counts?uids=org-alpha,org-empty,org-staged,org-withdrawn,p-cur,org-unknown,org-alpha');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    counts: {
      'org-alpha': { people: 4, current: 2, former: 1, unknown: 1 },
      'org-empty': { people: 0, current: 0, former: 0, unknown: 0 },
    },
  });
  assert.doesNotMatch(r.text, /Example|PLANTED|p-cur/, 'counts only: no name, no person id, no private note');
});

test('the counts read is signed in and takes 1 to 50 well-formed references', async () => {
  const f = fixture();
  assert.equal((await f.call('/organizations/people-counts?uids=org-alpha', null)).status, 401);
  const none = await f.call('/organizations/people-counts');
  assert.equal(none.status, 400);
  assert.equal(none.body.error, 'uids_required');
  const many = Array.from({ length: 51 }, (_, i) => 'org-' + i).join(',');
  assert.equal((await f.call('/organizations/people-counts?uids=' + many)).body.error, 'too_many_uids');
  assert.equal((await f.call('/organizations/people-counts?uids=' + Array.from({ length: 50 }, (_, i) => 'org-' + i).join(','))).status, 200);
  assert.equal((await f.call('/organizations/people-counts?uids=org-alpha,bad%20uid')).body.error, 'invalid_uid');
  assert.deepEqual(countUids(' a , b,a,, '), ['a', 'b']);
});
