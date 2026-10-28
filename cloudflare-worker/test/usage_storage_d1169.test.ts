/** D1169 (#3082): the grown storage read, over the actual migrated schema. Synthetic rows only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, migratedTemplate, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import usage from '../src/routes/usage.ts';
import { STORAGE_KINDS, storageState } from '../src/services/storageUsage.ts';
import { storagePlan } from '../src/services/storagePlans.ts';

const SECRET = 'synthetic-storage-read-secret-'.repeat(3);
test.after(() => removeMigratedDatabases());


/**
 * Member 11 is the primary admin of Acme (ventures 701 and 702, 702 founded by
 * cofounder 33) and the founder of 704, which has no company. Member 22 owns
 * Bluefern (703) and 705. Every size is distinct so each figure has one source.
 */
function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(202,'Two','two@example.test'),(303,'Three','three@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Owner','owner@example.test','founder',101,1),(22,'Other','other@example.test','founder',202,1),
      (33,'Cofounder','cofounder@example.test','founder',303,1),(44,'Staff','staff@example.test','admin',NULL,1),
      (55,'Investor','investor@example.test','investor',NULL,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-acme','Acme Robotics'),(2,'co-blue','Bluefern Health');
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin,created_at) VALUES
      ('l1',1,11,1,'2026-01-01'),('l2',1,33,0,'2026-01-02'),('l3',2,22,1,'2026-01-01');
    INSERT INTO projects(id,uid,name,founder_id,company_id,entity_id) VALUES
      (701,'v-field','Acme Field',101,1,9),(702,'v-labs','Acme Labs',303,1,NULL),(703,'v-clinic','Bluefern Clinic',202,2,8),
      (704,'v-solo','Solo venture',101,NULL,NULL),(705,'v-other','Other venture',202,NULL,NULL);

    INSERT INTO data_room_files(id,uid,project_id,name,r2_key,size_bytes,uploaded_by_user_id,source_kind) VALUES
      (1,'f-own',701,'Deck.pdf','room/1',100,11,'document'),(2,'f-cofounder',702,'Plan.pdf','room/2',200,33,'document'),
      (3,'f-by-other',701,'Model.xlsx','room/3',300,22,'document'),(4,'f-elsewhere',703,'Theirs.pdf','room/4',5000,11,'document'),
      (5,'f-signed',701,'Signed SAFE.pdf','room/5',7000,11,'signed');
    INSERT INTO data_room_file_versions(file_id,version,r2_key,size_bytes) VALUES (1,1,'room/1v1',50),(5,1,'room/5v1',7000),(4,1,'room/4v1',5000);
    INSERT INTO discovery_interviews(id,project_id,interviewee_name,recording_r2_key,recording_size_bytes) VALUES
      (1,701,'Customer A','validate-audio/1',400),(2,702,'Customer B','validate-audio/2',500),(3,703,'Customer C','validate-audio/3',5000),
      (4,701,'No recording',NULL,NULL);
    INSERT INTO interview_sessions(id,uid,interview_id,project_id,created_by_user_id,channel) VALUES
      (1,'s-one',1,701,33,'in_person'),(2,'s-solo',4,704,11,'video'),(3,'s-other',3,703,22,'phone');
    INSERT INTO interview_session_chunks(session_id,seq,r2_key,mime,size_bytes) VALUES
      (1,0,'interview-audio/1/0','audio/webm',60),(1,1,'interview-audio/1/1','audio/webm',70),
      (2,0,'interview-audio/2/0','audio/webm',90),(3,0,'interview-audio/3/0','audio/webm',5000);
    INSERT INTO deck_reviews(id,user_id,project_id,filename,size,r2_key,raw_retained) VALUES
      ('d-own',11,701,'Series A deck.pdf',1000,'deck-reviews/11/a.pdf',1),('d-forged',11,703,'Borrowed deck.pdf',1100,'deck-reviews/11/b.pdf',1),
      ('d-dropped',11,701,'Not kept.pdf',9000,NULL,0),('d-other',22,701,'Their deck.pdf',5000,'deck-reviews/22/c.pdf',1);
    INSERT INTO demand_signals(id,project_id,kind,signal_date,evidence_file_key,evidence_file_name,size_bytes,size_missing_at) VALUES
      (1,701,'loi','2026-01-01','validate-evidence/701/a.pdf','LOI.pdf',210,NULL),
      (2,702,'loi','2026-01-01','validate-evidence/702/b.pdf','Gone.pdf',NULL,'2026-02-01'),
      (3,703,'loi','2026-01-01','validate-evidence/703/c.pdf','Theirs.pdf',5000,NULL);
    INSERT INTO formation_steps(id,project_id,title,created_by,proof_file_key,size_bytes) VALUES (1,701,'Incorporate',11,'build-proof/701/a.pdf',220);
    INSERT INTO entity_obligations(id,uid,entity_id,kind,title,cadence,proof_file_key,size_bytes) VALUES
      (1,'o-own',9,'annual_report','Annual report','annual','build-proof/701/b.pdf',230),
      (2,'o-other',8,'annual_report','Their report','annual','build-proof/703/c.pdf',5000),
      (3,'o-foreign-key',9,'annual_report','Mislabelled','annual','build-proof/703/d.pdf',3000);
    INSERT INTO compliance_events(id,project_id,title,jurisdiction,event_type,due_date) VALUES (1,701,'Board meeting','US','board_meeting','2026-01-01');
    INSERT INTO obligation_occurrences(uid,event_id,held_on,minutes_file_key,size_bytes,size_missing_at) VALUES
      ('m-own',1,'2026-01-02','grow-minutes/701/a.pdf',240,NULL),('m-gone',1,'2026-01-03','grow-minutes/701/b.pdf',NULL,'2026-02-01'),
      ('m-blank',1,'2026-01-04','  ',NULL,NULL);
    INSERT INTO member_files(uid,r2_key,owner_user_id,kind,size_bytes) VALUES
      ('p-photo','headshots/11/a.png',11,'headshot',25),('p-logo','brand-logos/11/a.svg',11,'brand_logo',35),
      ('p-other','headshots/22/a.png',22,'headshot',5000);
    INSERT INTO data_imports(user_id,source,target,raw_file_r2_key,size_bytes) VALUES (11,'spreadsheet','contacts','imports/11/a.csv',45),(22,'spreadsheet','contacts','imports/22/a.csv',5000);
    INSERT INTO research_documents(uid,owner_user_id,title,r2_key,size_bytes) VALUES ('r-own',11,'Market sizing','research/11/a',600),('r-other',22,'Theirs','research/22/a',5000),('r-lp',55,'Sector notes','research/55/a',64);
    INSERT INTO dd_attachments(case_id,file_key,filename,size_bytes,uploaded_by_user_id) VALUES (1,'dd/11/a','NDA.pdf',800,11),(1,'dd/22/a','Theirs.pdf',5000,22);
  `);
  const native = d1Over(db);
  let fail: RegExp | null = null;
  const env: any = { JWT_SECRET: SECRET, DB: { prepare(sql: string) { if (fail?.test(sql)) throw new Error('synthetic-private-failure'); return native.prepare(sql); }, batch: (s: any[]) => native.batch(s) } };
  const app = new Hono<any>();
  app.route('/api/usage', usage);
  app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  async function call(who = 11, query = '') {
    const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
    const response = await app.request(`https://unit.test/api/usage/storage${query}`, { headers: { Authorization: `Bearer ${token}` } }, env);
    return { response, body: await response.json() as any };
  }
  return { db, env, call, fail: (r: RegExp | null) => { fail = r; } };
}
const area = (body: any, key: string) => body.areas.find((r: any) => r.key === key);
const kind = (body: any, key: string) => body.kinds.find((r: any) => r.key === key);
const ok = (files: number, bytes: number) => ({ files, bytes, measured_bytes: bytes, unknown_size_files: 0, recorded: true });

const OWNER_AREAS = {
  data_room: ok(3, 600), diligence_files: ok(1, 800), research_library: ok(1, 600),
  interview_recordings: ok(2, 900), data_room_versions: ok(1, 50), session_audio: ok(2, 220), deck_reviews: ok(2, 2100),
  validate_evidence: ok(1, 210), build_proofs: ok(2, 450), grow_minutes: ok(1, 240), brand_files: ok(2, 60), csv_imports: ok(1, 45),
};

test('D1169: every member store counts, company files count to the company owner, and signed copies never count', async () => {
  const f = fixture();
  const { response, body } = await f.call(11);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  for (const [key, want] of Object.entries(OWNER_AREAS)) {
    const { kind: _k, key: _key, ...got } = area(body, key);
    assert.deepEqual(got, want, key);
  }
  assert.equal(body.areas.length, 12);
  assert.deepEqual(body.areas.slice(0, 4).map((a: any) => a.key), ['data_room', 'diligence_files', 'research_library', 'interview_recordings']);
  assert.equal(body.total_bytes, 6275); assert.equal(body.measured_bytes, 6275);
  assert.equal(body.files, 19); assert.equal(body.unknown_size_files, 0);
  // The other member: their venture's files, a file the owner uploaded into
  // their room, and their own deck review filed against Acme Field.
  const other = (await f.call(22)).body;
  assert.equal(area(other, 'data_room').bytes, 5000);
  assert.equal(area(other, 'data_room_versions').bytes, 5000);
  assert.equal(area(other, 'deck_reviews').bytes, 5000);
  assert.equal(area(other, 'build_proofs').bytes, 5000);
  // The cofounder's venture counts to the company owner, not to them.
  assert.equal((await f.call(33)).body.total_bytes, 0);
});

test('D1169: kinds group the areas in the canvas order and sum exactly', async () => {
  const { body } = await fixture().call(11);
  assert.deepEqual(body.kinds.map((k: any) => k.key), [...STORAGE_KINDS]);
  assert.deepEqual(STORAGE_KINDS, ['data_room', 'documents', 'recordings', 'decks_exports', 'brand', 'other']);
  const want: Record<string, [number, number]> = { data_room: [4, 650], documents: [6, 2300], recordings: [4, 1120], decks_exports: [2, 2100], brand: [2, 60], other: [1, 45] };
  for (const [key, [files, bytes]] of Object.entries(want)) assert.deepEqual(kind(body, key), { key, ...ok(files, bytes) }, key);
  const kindOf: Record<string, string> = { data_room: 'data_room', data_room_versions: 'data_room', research_library: 'documents', validate_evidence: 'documents',
    build_proofs: 'documents', grow_minutes: 'documents', diligence_files: 'documents', interview_recordings: 'recordings', session_audio: 'recordings',
    deck_reviews: 'decks_exports', brand_files: 'brand', csv_imports: 'other' };
  for (const a of body.areas) assert.equal(a.kind, kindOf[a.key], a.key);
});

test('D1169: companies list every company with its ventures, then files tied to none; a forged deck project names nothing', async () => {
  const { body } = await fixture().call(11);
  assert.deepEqual(body.companies, [
    { uid: 'co-acme', name: 'Acme Robotics', personal: false, files: 12, bytes: 3580, measured_bytes: 3580, unknown_size_files: 0, ventures: [
      { uid: 'v-field', name: 'Acme Field', files: 10, bytes: 2880, measured_bytes: 2880, unknown_size_files: 0 },
      { uid: 'v-labs', name: 'Acme Labs', files: 2, bytes: 700, measured_bytes: 700, unknown_size_files: 0 },
    ] },
    { uid: null, name: null, personal: true, files: 7, bytes: 2695, measured_bytes: 2695, unknown_size_files: 0, ventures: [
      { uid: 'v-solo', name: 'Solo venture', files: 1, bytes: 90, measured_bytes: 90, unknown_size_files: 0 },
    ] },
  ]);
  assert.ok(!JSON.stringify(body).includes('Bluefern'), 'another member’s company is never named');
  const lp = (await fixture().call(55)).body;
  assert.deepEqual(lp.companies, [{ uid: null, name: null, personal: true, ...ok(1, 64), ventures: [] }].map(({ recorded: _r, ...c }) => c));
});

test('D1169: the ten largest files are the caller’s own, across every area, with where each lives', async () => {
  const { body } = await fixture().call(11);
  assert.deepEqual(body.largest.map((r: any) => [r.area, r.bytes]), [
    ['deck_reviews', 1100], ['deck_reviews', 1000], ['diligence_files', 800], ['research_library', 600],
    ['interview_recordings', 500], ['interview_recordings', 400], ['data_room', 300], ['grow_minutes', 240], ['build_proofs', 230], ['build_proofs', 220],
  ]);
  assert.equal(body.largest_complete, true);
  const forged = body.largest[0];
  assert.deepEqual(forged, { area: 'deck_reviews', kind: 'decks_exports', name: 'Borrowed deck.pdf', version: null, bytes: 1100,
    added_at: forged.added_at, ref: 'd-forged', brand: null, venture_uid: null, venture_name: null, company_uid: null, company_name: null });
  const room = body.largest.find((r: any) => r.area === 'data_room');
  assert.deepEqual([room.name, room.ref, room.venture_uid, room.venture_name, room.company_uid, room.company_name],
    ['Model.xlsx', 'f-by-other', 'v-field', 'Acme Field', 'co-acme', 'Acme Robotics']);
  for (const secret of ['Theirs', 'Their deck', 'Signed SAFE', 'Not kept']) assert.ok(!JSON.stringify(body.largest).includes(secret), secret);
  // A smaller list still reaches versions, sessions and profile files.
  const f = fixture();
  f.db.exec("DELETE FROM deck_reviews; DELETE FROM dd_attachments; DELETE FROM research_documents; DELETE FROM discovery_interviews WHERE recording_size_bytes IS NOT NULL; DELETE FROM data_room_files WHERE id <> 1; DELETE FROM formation_steps");
  const small = (await f.call(11)).body.largest;
  const session = small.find((r: any) => r.area === 'session_audio');
  assert.deepEqual([session.bytes, session.ref, session.venture_uid], [130, 's-one', 'v-field']);
  assert.deepEqual(small.find((r: any) => r.area === 'data_room_versions').version, 1);
  assert.deepEqual(small.filter((r: any) => r.area === 'brand_files').map((r: any) => [r.name, r.brand]), [[null, 'brand_logo'], [null, 'headshot']]);
});

// Session chunks (migration 438) and deck reviews (the baseline) declare their size NOT NULL.
test('D1169: a missing size is unknown, never 0, in every new store; a missing object is not a file', async () => {
  for (const [key, sql] of [
    ['data_room_versions', 'UPDATE data_room_file_versions SET size_bytes=NULL WHERE file_id=1'],
    ['validate_evidence', 'UPDATE demand_signals SET size_bytes=NULL WHERE id=1'],
    ['build_proofs', 'UPDATE entity_obligations SET size_bytes=NULL WHERE id=1'],
    ['grow_minutes', 'UPDATE obligation_occurrences SET size_bytes=NULL'],
    ['brand_files', "UPDATE member_files SET size_bytes=NULL, size_unmeasurable_at='2026-01-01' WHERE uid='p-photo'"],
    ['csv_imports', 'UPDATE data_imports SET size_bytes=NULL WHERE user_id=11'],
  ] as const) {
    const f = fixture(); f.db.exec(sql);
    const body = (await f.call(11)).body;
    assert.equal(area(body, key).bytes, null, key);
    assert.equal(area(body, key).unknown_size_files, 1, key);
    assert.equal(area(body, key).recorded, true, key);
    assert.ok(area(body, key).measured_bytes < OWNER_AREAS[key].bytes, key);
    assert.equal(body.total_bytes, null, key); assert.equal(body.unknown_size_files, 1, key); assert.equal(body.files, 19, key);
    assert.equal(kind(body, area(body, key).kind).bytes, null, key);
    assert.ok(body.measured_bytes < 6275, key);
  }
  for (const sql of ["UPDATE member_files SET size_bytes=NULL, size_missing_at='2026-01-01' WHERE uid='p-photo'",
    "UPDATE data_imports SET size_bytes=NULL, size_missing_at='2026-01-01' WHERE user_id=11"]) {
    const f = fixture(); f.db.exec(sql);
    const body = (await f.call(11)).body;
    assert.equal(body.files, 18, sql); assert.equal(body.unknown_size_files, 0, sql); assert.equal(body.total_bytes, body.measured_bytes, sql);
  }
});

const STORES: Record<string, RegExp> = {
  data_room_versions: /data_room_file_versions/, session_audio: /interview_session_chunks/, deck_reviews: /FROM deck_reviews/,
  validate_evidence: /demand_signals/, build_proofs: /formation_steps/, grow_minutes: /obligation_occurrences/,
  brand_files: /FROM member_files/, csv_imports: /FROM data_imports/,
};
test('D1169: an unreadable area blanks only itself and its kind; no total, company figure or state is shown', async () => {
  for (const [key, re] of Object.entries(STORES)) {
    const f = fixture(); const original = (await f.call(11)).body;
    f.fail(re);
    const { response, body } = await f.call(11);
    assert.equal(response.status, 200, key);
    assert.deepEqual(area(body, key), { key, kind: area(original, key).kind, files: null, bytes: null, measured_bytes: null, unknown_size_files: null, recorded: false }, key);
    assert.deepEqual(body.areas.filter((a: any) => a.key !== key), original.areas.filter((a: any) => a.key !== key), key);
    assert.equal(body.total_bytes, null, key); assert.equal(body.files, null, key); assert.equal(body.measured_bytes, null, key);
    assert.equal(body.state, null, key);
    assert.equal(kind(body, area(body, key).kind).recorded, false, key);
    assert.equal(kind(body, area(body, key).kind).bytes, null, key);
    for (const k of body.kinds.filter((k: any) => k.key !== area(body, key).kind)) assert.deepEqual(k, kind(original, k.key), key);
    for (const c of body.companies) { assert.equal(c.bytes, null, key); assert.equal(c.files, null, key); assert.ok(c.ventures.every((v: any) => v.bytes === null), key); }
    assert.deepEqual(body.companies.map((c: any) => c.name), original.companies.map((c: any) => c.name), key);
    assert.equal(body.largest_complete, false, key);
    assert.ok(!JSON.stringify(body).includes('synthetic-private'), key);
  }
  // Without the venture read, every company area is unknown; personal areas still count.
  const f = fixture(); f.fail(/LEFT JOIN company_profiles/);
  const body = (await f.call(11)).body;
  assert.equal(body.companies, null);
  for (const key of ['data_room', 'data_room_versions', 'interview_recordings', 'session_audio', 'validate_evidence', 'build_proofs', 'grow_minutes']) assert.equal(area(body, key).recorded, false, key);
  for (const key of ['research_library', 'diligence_files', 'brand_files', 'csv_imports', 'deck_reviews']) assert.equal(area(body, key).recorded, true, key);
  // A failed largest-files query keeps the area's figures and says the list is incomplete.
  const g = fixture(); g.fail(/FROM research_documents WHERE owner_user_id = \? AND size_bytes IS NOT NULL/);
  const partial = (await g.call(11)).body;
  assert.deepEqual(area(partial, 'research_library').bytes, 600);
  assert.equal(partial.total_bytes, 6275);
  assert.equal(partial.largest_complete, false);
  assert.ok(!partial.largest.some((r: any) => r.area === 'research_library'));
});

test('D1169: the allowance is the catalogue’s, and the state follows it; staff have no allowance', async () => {
  const f = fixture();
  const owner = (await f.call(11)).body;
  assert.equal(owner.plan_key, 'founder:free');
  assert.equal(owner.allowance_bytes, storagePlan('founder:free')!.allowance_bytes);
  assert.equal(owner.allowance_reason, null); assert.equal(owner.plan_recorded, true);
  assert.equal(owner.state, 'ok');
  const staff = (await f.call(44)).body;
  assert.deepEqual([staff.plan_key, staff.allowance_bytes, staff.state], ['admin', null, 'no_allowance']);
  assert.equal(staff.allowance_reason, storagePlan('admin')!.allowance_reason);
  // A plan that cannot be read blanks only the plan.
  f.fail(/FROM account_subscriptions/);
  const blind = (await f.call(11)).body;
  assert.deepEqual([blind.plan_key, blind.allowance_bytes, blind.state, blind.plan_recorded], [null, null, null, false]);
  assert.equal(blind.allowance_reason, 'Storage plan unreadable');
  assert.equal(blind.total_bytes, 6275);
});

test('D1169: the state thresholds are 80%, 95%, exactly full and over; unknown, negotiated or unread is no state', () => {
  const a = storagePlan('founder:growth')!.allowance_bytes!;
  const at = (pct: number) => Math.floor((a * pct) / 100);
  assert.equal(storageState(0, a, 'founder:growth'), 'ok');
  assert.equal(storageState(at(80) - 1, a, 'founder:growth'), 'ok');
  assert.equal(storageState(at(80), a, 'founder:growth'), 'near_80');
  assert.equal(storageState(at(95) - 1, a, 'founder:growth'), 'near_80');
  assert.equal(storageState(at(95), a, 'founder:growth'), 'near_95');
  assert.equal(storageState(a - 1, a, 'founder:growth'), 'near_95');
  assert.equal(storageState(a, a, 'founder:growth'), 'full');
  assert.equal(storageState(a + 1, a, 'founder:growth'), 'over');
  assert.equal(storageState(null, a, 'founder:growth'), null);
  assert.equal(storageState(5, null, 'investor:institutional'), null);
  assert.equal(storageState(null, null, 'admin'), 'no_allowance');
  assert.equal(storageState(5, a, null), 'ok');
});

test('D1169: company, project and user selectors never change the caller-only read', async () => {
  const f = fixture(); const original = (await f.call(11)).body;
  for (const q of ['?company_id=2', '?project_id=703&user_id=22', '?user_id=22&company_id=%27%20OR%201=1--']) assert.deepEqual((await f.call(11, q)).body, original, q);
});

test('D1169: the read touches only member stores; fund, legal, identity, 83(b) and HQ stores are never read', () => {
  const src = readFileSync(new URL('../src/services/storageUsage.ts', import.meta.url), 'utf8');
  const tables = new Set([...src.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]).filter((t) => t !== 'json_each'));
  assert.deepEqual([...tables].sort(), [
    'company_profiles', 'compliance_events', 'data_imports', 'data_room_file_versions', 'data_room_files', 'dd_attachments', 'deck_reviews',
    'demand_signals', 'discovery_interviews', 'entity_obligations', 'formation_steps', 'interview_session_chunks', 'interview_sessions',
    'member_files', 'obligation_occurrences', 'projects', 'research_documents', 'user_company_links', 'users',
  ]);
  for (const never of ['legal_notice_files', 'legal_document_files', 'documents', 'kyc', 'fund', 'publications', 'articles']) assert.ok(!tables.has(never), never);
  // Four D1169 queries (each data room area's groups and largest) and D1170's two per-owner statements.
  assert.equal((src.match(/source_kind <> 'signed'/g) ?? []).length, 6, 'every data room query leaves signed copies out');
});

test('D1169: each owner column the read filters on has an index, except the two recorded in D1169.md', () => {
  const db = migratedTemplate();
  const src = readFileSync(new URL('../src/services/storageUsage.ts', import.meta.url), 'utf8');
  const queries = [...src.matchAll(/(?:groups:|largest:|const OWNED =) `([\s\S]*?)`/g)].map((m) => m[1]);
  assert.equal(queries.length, 25);
  const scans = new Set<string>();
  for (const q of queries) {
    for (const row of db.prepare('EXPLAIN QUERY PLAN ' + q).all(...Array(q.split('?').length - 1).fill('[]')) as any[]) {
      const m = /^SCAN (\w+)(?! USING)/.exec(String(row.detail));
      if (m && !String(row.detail).includes('USING') && m[1] !== 'own' && m[1] !== 'json_each') scans.add(m[1]);
    }
  }
  // dd_attachments has no uploader index (D642's query scanned it too), and
  // projects (`p`, in OWNED) has none on founder_id. D1169.md records both.
  assert.deepEqual([...scans].sort(), ['dd_attachments', 'p']);
  db.close();
});
