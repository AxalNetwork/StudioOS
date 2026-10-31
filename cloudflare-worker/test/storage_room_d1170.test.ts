/**
 * D1170 (#3083, part 4 of #2449) — the storage guard in every member upload,
 * the 80/95/100% notices, and HQ's totals. On the actual migrated schema
 * (`_storage_schema.ts`), synthetic rows only. Every allowance comes from the
 * catalogue (`storagePlan`); no test holds a byte figure of its own for one.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/storage_room_d1170.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import adminPlatform from '../src/routes/admin_platform.ts';
import research from '../src/routes/research.ts';
import { readStorageByOwner, readStorageUsage, storageUsedBytes, STORAGE_KINDS } from '../src/services/storageUsage.ts';
import { storagePlan } from '../src/services/storagePlans.ts';
import { assertStorageRoom, crossed, noteStorageLanded, storageText, ventureStorageOwner } from '../src/services/storageRoom.ts';
import { putChunk, loadSession } from '../src/services/interviewSessions.ts';

const SECRET = 'synthetic-storage-room-secret-'.repeat(3);
test.after(() => removeMigratedDatabases());

const FREE = storagePlan('founder:free')!.allowance_bytes!;

/**
 * D1169's fixture, reduced: member 11 is the primary admin of Acme (ventures
 * 701 and 702, 702 founded by cofounder 33) and the founder of 704; member 22
 * owns Bluefern (703); 44 is staff; 55 an investor; 66 HQ's Super Admin.
 */
function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(202,'Two','two@example.test'),(303,'Three','three@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Owner','owner@example.test','founder',101,1),(22,'Other','other@example.test','founder',202,1),
      (33,'Cofounder','cofounder@example.test','founder',303,1),(44,'Staff','staff@example.test','admin',NULL,1),
      (55,'Investor','investor@example.test','investor',NULL,1),(66,'Hq','hq@example.test','admin',NULL,1);
    INSERT INTO super_admins(user_id) VALUES (66);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-acme','Acme Robotics'),(2,'co-blue','Bluefern Health');
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin,created_at) VALUES
      ('l1',1,11,1,'2026-01-01'),('l2',1,33,0,'2026-01-02'),('l3',2,22,1,'2026-01-01');
    INSERT INTO projects(id,uid,name,founder_id,company_id,entity_id) VALUES
      (701,'v-field','Acme Field',101,1,9),(702,'v-labs','Acme Labs',303,1,NULL),(703,'v-clinic','Bluefern Clinic',202,2,8),
      (704,'v-solo','Solo venture',101,NULL,NULL),(706,'v-orphan','No owner',NULL,NULL,NULL);
    INSERT INTO data_room_files(id,uid,project_id,name,r2_key,size_bytes,uploaded_by_user_id,source_kind) VALUES
      (1,'f-own',701,'Deck.pdf','room/1',100,11,'document'),(2,'f-cofounder',702,'Plan.pdf','room/2',200,33,'document'),
      (3,'f-by-other',701,'Model.xlsx','room/3',300,22,'document'),(4,'f-elsewhere',703,'Theirs.pdf','room/4',5000,11,'document'),
      (5,'f-signed',701,'Signed SAFE.pdf','room/5',7000,11,'signed'),(6,'f-unknown',704,'Unsized.pdf','room/6',NULL,11,'document');
    INSERT INTO data_room_file_versions(file_id,version,r2_key,size_bytes) VALUES (1,1,'room/1v1',50),(5,1,'room/5v1',7000);
    INSERT INTO discovery_interviews(id,project_id,interviewee_name,recording_r2_key,recording_size_bytes) VALUES
      (1,701,'Customer A','validate-audio/1',400),(3,703,'Customer C','validate-audio/3',5000),(4,701,'No recording',NULL,NULL);
    INSERT INTO interview_sessions(id,uid,interview_id,project_id,created_by_user_id,channel) VALUES
      (1,'s-one',1,701,33,'in_person'),(3,'s-other',3,703,22,'phone');
    INSERT INTO interview_session_chunks(session_id,seq,r2_key,mime,size_bytes) VALUES
      (1,0,'interview-audio/1/0','audio/webm',60),(1,1,'interview-audio/1/1','audio/webm',70),(3,0,'interview-audio/3/0','audio/webm',5000);
    INSERT INTO deck_reviews(id,user_id,project_id,filename,size,r2_key,raw_retained) VALUES
      ('d-own',11,701,'Series A deck.pdf',1000,'deck-reviews/11/a.pdf',1),('d-other',22,701,'Their deck.pdf',5000,'deck-reviews/22/c.pdf',1);
    INSERT INTO demand_signals(id,project_id,kind,signal_date,evidence_file_key,evidence_file_name,size_bytes) VALUES
      (1,701,'loi','2026-01-01','validate-evidence/701/a.pdf','LOI.pdf',210);
    INSERT INTO formation_steps(id,project_id,title,created_by,proof_file_key,size_bytes) VALUES (1,701,'Incorporate',11,'build-proof/701/a.pdf',220);
    INSERT INTO entity_obligations(id,uid,entity_id,kind,title,cadence,proof_file_key,size_bytes) VALUES
      (1,'o-own',9,'annual_report','Annual report','annual','build-proof/701/b.pdf',230),
      (2,'o-other',8,'annual_report','Their report','annual','build-proof/703/c.pdf',5000);
    INSERT INTO compliance_events(id,project_id,title,jurisdiction,event_type,due_date) VALUES (1,701,'Board meeting','US','board_meeting','2026-01-01');
    INSERT INTO obligation_occurrences(uid,event_id,held_on,minutes_file_key,size_bytes) VALUES ('m-own',1,'2026-01-02','grow-minutes/701/a.pdf',240);
    INSERT INTO member_files(uid,r2_key,owner_user_id,kind,size_bytes) VALUES
      ('p-photo','headshots/11/a.png',11,'headshot',25),('p-other','headshots/22/a.png',22,'headshot',5000);
    INSERT INTO member_files(uid,r2_key,owner_user_id,kind,size_bytes,size_missing_at) VALUES ('p-gone','headshots/11/gone.png',11,'headshot',NULL,'2026-02-01');
    INSERT INTO data_imports(user_id,source,target,raw_file_r2_key,size_bytes) VALUES (11,'spreadsheet','contacts','imports/11/a.csv',45);
    INSERT INTO research_documents(uid,owner_user_id,title,r2_key,size_bytes) VALUES ('r-own',11,'Market sizing','research/11/a',600),('r-lp',55,'Sector notes','research/55/a',64);
    INSERT INTO dd_attachments(case_id,file_key,filename,size_bytes,uploaded_by_user_id) VALUES (1,'dd/11/a','NDA.pdf',800,11);
  `);
  const native = d1Over(db);
  let fail: RegExp | null = null;
  const puts: string[] = [];
  const env: any = {
    JWT_SECRET: SECRET, ENVIRONMENT: 'development',
    DB: { prepare(sql: string) { if (fail?.test(sql)) throw new Error('synthetic-private-failure'); return native.prepare(sql); }, batch: (s: any[]) => native.batch(s) },
    FILES: { async put(key: string) { puts.push(key); }, async delete() {}, async get() { return null; } },
  };
  const user = (id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  /** Fill a member's plan to `bytes` with one sized research file of their own. */
  const fill = (id: number, bytes: number) => db.prepare(
    "INSERT INTO research_documents(uid,owner_user_id,title,r2_key,size_bytes) VALUES (?,?,?,?,?)",
  ).run(`fill-${id}-${bytes}`, id, 'Filler', `research/${id}/fill`, bytes);
  const app = new Hono<any>();
  app.route('/api/admin/platform', adminPlatform);
  app.route('/api/research', research);
  app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  async function call(who: number, method: string, path: string, body?: BodyInit) {
    const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
    // As production: a thrown Response is the answer (`index.ts`, `withThrownResponses`).
    const response = await withThrownResponses(() => app.request(`https://unit.test${path}`, { method, body, headers: { Authorization: `Bearer ${token}` } }, env));
    let parsed: any = null;
    try { parsed = await response.clone().json(); } catch { parsed = null; }
    return { status: response.status, body: parsed };
  }
  return { db, env, puts, user, fill, call, fail: (r: RegExp | null) => { fail = r; } };
}

async function refusal(p: Promise<unknown>) {
  try { await p; } catch (e) {
    assert.ok(e instanceof Response, 'the refusal is a Response');
    return { status: e.status, body: await e.json() as any };
  }
  assert.fail('expected a refusal');
}

// ---------------------------------------------------------------- one rule

test('the guard and HQ weigh each member by the read\'s own rule: per-owner totals equal each member\'s Storage read', async () => {
  const f = fixture();
  const { owners, unreadable } = await readStorageByOwner(f.env);
  assert.deepEqual(unreadable, []);
  for (const id of [11, 22, 33, 55]) {
    const own = await readStorageUsage(f.env, f.user(id));
    const t = owners.get(id) ?? { files: 0, measured_bytes: 0, unknown_size_files: 0, kinds: {} as any };
    assert.deepEqual([t.files, t.measured_bytes, t.unknown_size_files], [own.files, own.measured_bytes, own.unknown_size_files], `member ${id}`);
    for (const k of own.kinds) assert.equal(t.kinds[k.key] ?? 0, k.measured_bytes, `member ${id} ${k.key}`);
    assert.deepEqual(await storageUsedBytes(f.env, id), { measured_bytes: own.measured_bytes, unknown_size_files: own.unknown_size_files });
  }
  assert.ok((owners.get(11)?.unknown_size_files ?? 0) > 0, 'an unsized file is counted as unknown, never 0 bytes');
  assert.equal(owners.get(33), undefined, 'a cofounder\'s venture counts to the company owner');
  assert.deepEqual([await ventureStorageOwner(f.env, 702), await ventureStorageOwner(f.env, 704), await ventureStorageOwner(f.env, 706)], [11, 11, null]);
});

// ---------------------------------------------------------------- the guard

test('an upload that fits passes; one that does not is refused with the one shape, before anything is written', async () => {
  const f = fixture();
  const used = (await storageUsedBytes(f.env, 11))!.measured_bytes;
  const fits = await assertStorageRoom(f.env, { userId: 11 }, FREE - used, f.user(11));
  assert.deepEqual([fits.passed, fits.used, fits.allowance, fits.incoming, fits.ownerId], ['measured', used, FREE, FREE - used, 11]);
  const r = await refusal(assertStorageRoom(f.env, { userId: 11 }, FREE - used + 1, f.user(11)));
  assert.equal(r.status, 413);
  assert.deepEqual(Object.keys(r.body).sort(), ['allowance_bytes', 'counts_to', 'error', 'incoming_bytes', 'message', 'plan_key', 'used_bytes'].sort());
  assert.deepEqual([r.body.error, r.body.used_bytes, r.body.allowance_bytes, r.body.incoming_bytes, r.body.plan_key, r.body.counts_to],
    ['storage_full', used, FREE, FREE - used + 1, 'founder:free', 'you']);
  assert.match(r.body.message, /Nothing was saved, and every stored file is unchanged\./);
  assert.doesNotMatch(r.body.message, /Owner|owner@|Market sizing/, 'no name, email or file name in the refusal');
});

test('a company file is weighed against the company owner\'s plan, and says so', async () => {
  const f = fixture();
  f.fill(11, FREE);
  const r = await refusal(assertStorageRoom(f.env, { projectId: 702 }, 10, f.user(33)));
  assert.deepEqual([r.body.counts_to, r.body.plan_key], ['company_owner', 'founder:free']);
  assert.match(r.body.message, /company owner/);
  // The cofounder's own personal file is theirs, and fits.
  assert.equal((await assertStorageRoom(f.env, { userId: 33 }, 10, f.user(33))).passed, 'measured');
});

test('a full plan refuses a session\'s start (0 bytes), and only a full one; staff, negotiated, no owner and an unreadable read pass', async () => {
  const f = fixture();
  assert.equal((await assertStorageRoom(f.env, { userId: 11 }, 0, f.user(11))).passed, 'measured', 'not full: a start passes');
  f.fill(11, FREE - (await storageUsedBytes(f.env, 11))!.measured_bytes);
  assert.equal((await refusal(assertStorageRoom(f.env, { userId: 11 }, 0, f.user(11)))).status, 413, 'exactly full: a start is refused');
  f.fill(11, FREE);
  assert.equal((await refusal(assertStorageRoom(f.env, { userId: 11 }, 0, f.user(11)))).status, 413, 'full: a start is refused');
  assert.equal((await assertStorageRoom(f.env, { userId: 11 }, 10, f.user(44))).passed, 'staff', 'staff uploading pass');
  assert.equal((await assertStorageRoom(f.env, { userId: 11 }, 10, { id: 44 })).passed, 'staff', 'a role read by id still passes staff');
  assert.equal((await assertStorageRoom(f.env, { userId: 44 }, 10, f.user(11))).passed, 'no_allowance', 'a staff account holds no allowance');
  assert.equal((await assertStorageRoom(f.env, { projectId: 706 }, 10, f.user(11))).passed, 'no_owner');
  f.db.prepare("UPDATE users SET investor_tier = 'institutional' WHERE id = 55").run();
  f.fill(55, FREE * 5);
  assert.equal((await assertStorageRoom(f.env, { userId: 55 }, 10, f.user(55))).passed, 'negotiated', 'a negotiated plan is never refused against a guessed figure');
  f.fail(/account_subscriptions/);
  assert.equal((await assertStorageRoom(f.env, { userId: 11 }, 10, f.user(11))).passed, 'unreadable', 'a plan we cannot read never refuses a file');
  f.fail(/research_documents/);
  assert.equal((await assertStorageRoom(f.env, { userId: 11 }, 10, f.user(11))).passed, 'unreadable', 'nor do stored bytes we cannot read');
});

// ---------------------------------------------------------------- through a route

test('through the research upload: a refused file writes nothing; one that fits is stored and recorded', async () => {
  const f = fixture();
  const form = (bytes: number) => { const fd = new FormData(); fd.append('file', new File([new Uint8Array(bytes)], 'Notes.pdf', { type: 'application/pdf' })); return fd; };
  f.fill(11, FREE - 100);
  const before = (f.db.prepare('SELECT COUNT(*) AS n FROM research_documents WHERE owner_user_id = 11').get() as any).n;
  const refused = await f.call(11, 'POST', '/api/research/documents', form(5000));
  assert.equal(refused.status, 413);
  assert.equal(refused.body.error, 'storage_full');
  assert.deepEqual(f.puts, [], 'nothing reached storage');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM research_documents WHERE owner_user_id = 11').get() as any).n, before, 'no row');
  const ok = await f.call(55, 'POST', '/api/research/documents', form(50));
  assert.equal(ok.status, 200);
  assert.equal(f.puts.length, 1);
});

test('a session in progress is never cut: its chunks are stored on a full plan', async () => {
  const f = fixture();
  f.fill(11, FREE * 2);
  const session = (await loadSession(f.env, 1))!;
  const out = await putChunk(f.env, session, 11, 7, 'audio/webm', new Uint8Array(30).buffer, null);
  assert.equal(out.duplicate, false);
  assert.equal(f.puts.length, 1, 'stored');
  assert.doesNotMatch(readFileSync(new URL('../src/services/interviewSessions.ts', import.meta.url), 'utf8'), /assertStorageRoom/, 'the chunk writer is never guarded');
});

// ---------------------------------------------------------------- every member upload

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
/** Each member upload: the file, a marker inside its handler, and its write. The guard sits between them. */
const SITES: Array<[string, string, string]> = [
  // D1089: the upload's storage step is `storeDataRoomFile`, which the route and a Notion snapshot both call.
  ['routes/data_room.ts', 'export async function storeDataRoomFile', 'await env.FILES.put(key, bytes'],
  ['routes/data_room.ts', 'export async function replaceDataRoomFile', 'await env.FILES.put(key, a.bytes'],
  ['routes/dd.ts', "dd.post('/cases/:uid/sections/:sectionId/nda'", 'await c.env.FILES.put(storageKey, buf'],
  ['routes/dd.ts', "dd.post('/cases/:uid/items/:itemId/evidence'", 'await c.env.FILES.put(key, buf'],
  ['routes/research.ts', "research.post('/documents', async", 'await c.env.FILES.put(r2Key'],
  ['routes/founder_validate.ts', "founderValidate.post('/interviews/:id/recording'", 'await c.env.FILES.put(key, await file.arrayBuffer()'],
  ['routes/deck_reviewer.ts', "deckReviewer.post('/upload'", 'await c.env.FILES.put(r2Key, bytes'],
  ['routes/imports.ts', 'async function maybeStoreRaw', "await env.FILES.put(key, csv"],
  ['routes/brand.ts', "brand.post('/logo/upload'", 'await files.put(key, logoBytes'],
  ['routes/captable.ts', "captable.post('/register/:projectId/snapshot'", 'await c.env.FILES.put(key, bytes'],
  ['services/r2.ts', 'export async function putHeadshotFromDataUri', 'await env.FILES.put(fileKey, bytes'],
  ['services/validateWriters.ts', 'export async function attachDemandEvidence', 'await env.FILES.put(key, await input.file.arrayBuffer()'],
  ['services/records/build.ts', 'async function uploadProof', 'await files.put(key, bytes'],
  ['services/growWriters.ts', 'export async function markHeld', 'await env.FILES.put(key, await file.arrayBuffer()'],
  ['services/mercury/raiseFeeds.ts', 'async function acceptStatement', 'await env.FILES.put(key, pdf.bytes'],
  // D1094: a Drive file copied into the data room is the member's, weighed before it lands.
  ['services/google/raise.ts', 'async function copyFile', 'await env.FILES.put(key, bytes'],
  // D903: a deck image is the member's file. Room is checked before either write; the bytes are not in the usage total yet.
  ['routes/deck_images.ts', "deckImages.post('/:id/images', async", 'await c.env.FILES!.put(key, r.image.bytes'],
  ['routes/deck_images.ts', "deckImages.post('/:id/images/upload'", 'await c.env.FILES.put(key, bytes'],
  ['routes/founder_validate_sessions.ts', 'async function openOn', 'const insert = env.DB.prepare('],
  ['services/interviewIntake.ts', 'export async function openSession', 'const [inserted] = await env.DB.batch(['],
];

test('every member upload calls the guard before its write', () => {
  for (const [file, handler, write] of SITES) {
    const s = src(file);
    const h = s.indexOf(handler);
    assert.ok(h >= 0, `${file}: ${handler}`);
    const w = s.indexOf(write, h);
    assert.ok(w > h, `${file}: its write`);
    const g = s.indexOf('assertStorageRoom(', h);
    assert.ok(g > h && g < w, `${file}: the guard runs before the write in ${handler}`);
  }
});

/** Writes that are not a member's upload into a store that counts (D1169 §2), each with why. */
const NOT_MEMBER_UPLOADS: Record<string, string> = {
  'routes/admin_x.ts': 'HQ media for X posts',
  'routes/admin_publications.ts': 'HQ content',
  'routes/admin_insights_export.ts': 'an HQ export',
  'routes/articles.ts': 'HQ articles',
  'routes/admin_team.ts': 'HQ team photos',
  'routes/dd.ts:dd_reports': 'a generated diligence report, not a counted store',
  'routes/wellbeing_expert_review.ts': 'an expert\'s credentials, reviewed by HQ',
  'routes/monitoring_analytics.ts': 'platform analytics',
  'routes/admin_telegram.ts': 'HQ broadcast media',
  'routes/legal_83b.ts': 'an 83(b) receipt, never counted',
  'routes/admin_licences.ts': 'licence documents',
  'routes/news.ts': 'HQ news',
  'routes/admin_programs.ts': 'an HQ export',
  'routes/kyb_admin.ts': 'identity documents, never counted',
  'routes/reporting_reports.ts': 'a generated investor report, not a counted store',
  'routes/admin_contracts.ts': 'HQ contract previews',
  'routes/admin_network_profiles.ts': 'HQ-managed profiles',
  'routes/admin_trust_center.ts': 'HQ content',
  'routes/esign.ts': 'signed legal copies, never counted',
  'routes/wellbeing.ts': 'not a counted store',
  'services/r2.ts:kyc': 'identity documents, never counted',
  'services/r2.ts:resume': 'a public job applicant\'s resume, not a member',
  'services/fundNoticeStore.ts': 'fund documents, never counted',
  'services/interviewSessions.ts': 'a session\'s chunks: checked once at its start, never cut',
  'services/articleCovers.ts': 'HQ article covers',
  'services/backup.ts': 'platform backups',
  'services/mercury/investorFeeds.ts': 'a GP\'s Mercury statements: fund documents, never counted',
  'services/meetingBotDiagnose.ts': 'an HQ owner\'s bot diagnostic record and screenshot (#3708), never counted',
};

test('every R2 write in the Worker is a guarded member upload or named as something else', () => {
  const walk = (dir: string): string[] => readdirSync(new URL(`../src/${dir}`, import.meta.url), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []));
  const guarded = new Set(SITES.map(([file]) => file));
  const unknown: string[] = [];
  for (const file of [...walk('routes'), ...walk('services')]) {
    const s = src(file);
    const writes = (s.match(/\b(?:FILES|files|r2|bucket)\??\.put\(/g) || []).length;
    if (!writes) continue;
    const named = Object.keys(NOT_MEMBER_UPLOADS).some((k) => k === file || k.startsWith(`${file}:`));
    if (!guarded.has(file) && !named) unknown.push(file);
  }
  assert.deepEqual(unknown, [], 'a new R2 write: guard it, or name why it is not a member upload');
});

// ---------------------------------------------------------------- notices

test('one notice per crossing of 80, 95 and 100%, to the member the file counts to', async () => {
  assert.deepEqual(crossed(0, 79, 100), []);
  assert.deepEqual(crossed(79, 80, 100), [80]);
  assert.deepEqual(crossed(80, 94, 100), [], 'already past 80: no second notice');
  assert.deepEqual(crossed(70, 100, 100), [80, 95, 100]);
  assert.deepEqual(crossed(96, 99, 100), []);
  assert.deepEqual(crossed(94, 95, 100), [95]);
  const f = fixture();
  const used = (await storageUsedBytes(f.env, 11))!.measured_bytes;
  const toEighty = Math.ceil(FREE * 0.8) - used;
  const t = await assertStorageRoom(f.env, { projectId: 702 }, toEighty, f.user(33));
  assert.equal(await noteStorageLanded(f.env, t), 80);
  const rows = f.db.prepare("SELECT user_id, title, body, link FROM notifications_inbox WHERE type = 'storage_threshold'").all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, 11, 'the company owner, not the uploader');
  assert.equal(rows[0].title, `You have used 80% of your ${storageText(FREE)} of storage`);
  assert.equal(rows[0].link, '/account/usage/storage');
  assert.match(rows[0].body, /stored files are never removed/);
  // The next file below 95% sends nothing.
  f.fill(11, toEighty);
  const again = await assertStorageRoom(f.env, { userId: 11 }, 1, f.user(11));
  assert.equal(await noteStorageLanded(f.env, again), null);
  assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE type = 'storage_threshold'").get() as any).n, 1);
  // A pass sends nothing, and a notice that cannot be sent never throws.
  assert.equal(await noteStorageLanded(f.env, await assertStorageRoom(f.env, { userId: 11 }, FREE, f.user(44))), null);
  f.fail(/notifications_inbox/);
  const full = await assertStorageRoom(f.env, { userId: 11 }, FREE - (await storageUsedBytes(f.env, 11))!.measured_bytes, f.user(11));
  await assert.doesNotReject(noteStorageLanded(f.env, full));
});

test('the 100% notice says uploads pause and nothing is removed', async () => {
  const f = fixture();
  const used = (await storageUsedBytes(f.env, 11))!.measured_bytes;
  const t = await assertStorageRoom(f.env, { userId: 11 }, FREE - used, f.user(11));
  assert.equal(await noteStorageLanded(f.env, t), 100);
  const row = f.db.prepare("SELECT title, body FROM notifications_inbox WHERE type = 'storage_threshold'").get() as any;
  assert.equal(row.title, `Your storage is full: ${storageText(FREE)} used`);
  assert.match(row.body, /New uploads are paused until there is room\. Every stored file stays readable and downloadable\./);
});

// ---------------------------------------------------------------- HQ

test('HQ\'s read: Super Admin only, totals by kind, plan and state, and no name, email, id or file name', async () => {
  const f = fixture();
  f.fill(22, FREE);
  assert.equal((await f.call(44, 'GET', '/api/admin/platform/storage')).status, 403, 'a plain Admin is refused');
  assert.equal((await f.call(11, 'GET', '/api/admin/platform/storage')).status, 403);
  const { status, body } = await f.call(66, 'GET', '/api/admin/platform/storage');
  assert.equal(status, 200);
  const { owners } = await readStorageByOwner(f.env);
  const sum = [...owners.values()].reduce((n, t) => n + t.measured_bytes, 0);
  assert.equal(body.totals.measured_bytes, sum);
  assert.equal(body.totals.members, 6);
  assert.deepEqual(body.by_kind.map((k: any) => k.key), [...STORAGE_KINDS]);
  assert.equal(body.by_kind.reduce((n: number, k: any) => n + k.measured_bytes, 0), sum);
  const founderFree = body.by_plan.find((p: any) => p.plan_key === 'founder:free');
  assert.equal(founderFree.members, 3);
  assert.equal(founderFree.allowance_bytes, FREE);
  assert.equal(founderFree.measured_bytes, (owners.get(11)?.measured_bytes ?? 0) + (owners.get(22)?.measured_bytes ?? 0));
  assert.equal(body.by_state.over, 1, 'member 22 is over their plan');
  assert.equal(body.by_state.no_allowance, 2, 'two staff accounts');
  assert.equal(Object.values(body.by_state).reduce((n: number, v: any) => n + v, 0), 6, 'every member in one state');
  const text = JSON.stringify(body);
  for (const leak of ['Owner', 'owner@example.test', 'Market sizing', 'Deck.pdf', 'Acme', 'v-field', 'research/11']) assert.ok(!text.includes(leak), `no ${leak}`);
  const keys = new Set<string>();
  const walk = (v: any) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
  walk(body);
  for (const k of ['name', 'email', 'user_id', 'id', 'uid', 'filename', 'title']) assert.ok(!keys.has(k), `no ${k} key`);
});

test('HQ\'s read says what it could not read, and never states a guessed figure', async () => {
  const f = fixture();
  f.fail(/FROM research_documents/);
  const { body } = await f.call(66, 'GET', '/api/admin/platform/storage');
  assert.deepEqual(body.unreadable_areas, ['research_library']);
  assert.deepEqual([body.complete, body.by_state, body.by_plan[0].measured_bytes], [false, null, null]);
  assert.match(body.by_state_reason, /no member’s total is complete/);
  f.fail(/account_subscriptions/);
  const plans = (await f.call(66, 'GET', '/api/admin/platform/storage')).body;
  assert.deepEqual([plans.by_plan, plans.by_state, plans.totals.members], [null, null, null]);
  assert.equal(plans.by_plan_reason, 'The plans could not be read.');
});
