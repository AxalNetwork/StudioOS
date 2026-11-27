/**
 * #4170 (D4170) — Eadwyn's data room proposals: checklist matches, folders for
 * top-level files, and gaps, as accept-or-dismiss actions on file metadata.
 *
 *   · the run's output is checked against the room: unknown files, files
 *     already matched or foldered, answered gap items, emails and the words the
 *     product never uses are dropped;
 *   · no run without the quote: a missing or stale `confirm_quote` is 402 and
 *     the model is never called; the index sent holds names, never content;
 *   · Accept writes exactly the one field the proposal names and records who
 *     pressed; a folder move that would change who can open the file is
 *     refused and writes nothing; a gap writes no file;
 *   · Dismiss writes nothing to files;
 *   · a member without write access to the room cannot accept, and the generic
 *     decide route cannot accept a `dataroom:` proposal either;
 *   · Undo puts a match or a move back, once, only while the file is as the
 *     accept left it.
 *
 * Synthetic fixtures only. `env.AI` is a stub and `fetch` throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/data_room_proposals_4170.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import dataRoomProposals from '../src/routes/data_room_proposals.ts';
import dataRoom from '../src/routes/data_room.ts';
import aiRailProposals from '../src/routes/ai_rail_proposals.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { MAX_PROPOSALS, proposalsFrom, roomFacts, type RoomFacts } from '../src/services/dataRoomProposals.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'dataroom-proposals-4170-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(schema); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-4170-only-not-a-real-credential'.repeat(2);
const ROOM = 'room-uid-1';
const BASE = `/api/data-room/${ROOM}/proposals`;

// Every name below is made up. Ada Quill owns the venture, Ben Ward is a co-founder, Cy Other owns another venture.
const ANSWER = JSON.stringify([
  { type: 'match', file_uid: 'f-inc', item: 'incorporation', reason: 'The name says it is the certificate of incorporation.' },
  { type: 'folder', file_uid: 'f-model', folder_name: 'Financials', reason: 'A financial model belongs with the other financial files.' },
  { type: 'folder', file_uid: 'f-pipe', folder_name: 'Customers', reason: 'The pipeline sits with customer files.' },
  { type: 'gap', item: 'security', would_satisfy: 'A short security and privacy overview.', reason: 'No file answers security yet.' },
]);

async function fixture(answer: () => string = () => ANSWER) {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, name] of [[2, 'founder', 100, 'Ada Quill'], [3, 'founder', 300, 'Cy Other'], [4, 'founder', null, 'Ben Ward'], [5, 'investor', null, 'Ivy Investor']] as const) {
    insert.run(id, role, fid, name, `synthetic-${id}@example.invalid`, 'studio');
  }
  db.exec("INSERT INTO founders(id,name,email) VALUES (100,'Ada Quill','ada@example.invalid'),(300,'Cy Other','cy@example.invalid')");
  db.exec(`INSERT INTO projects(id,uid,name,founder_id) VALUES (1,'${ROOM}','Ledgerly',100),(3,'room-uid-3','Other venture',300)`);
  db.exec(`INSERT INTO data_room_folders(id,uid,project_id,parent_id,name,visibility,display_order) VALUES
    (10,'fo-fin',1,NULL,'Financials','open',0),(11,'fo-legal',1,NULL,'Legal','nda',1)`);
  const add = db.prepare('INSERT INTO data_room_files (id, uid, project_id, name, r2_key, content_type, size_bytes, visibility, folder_id, checklist_item) VALUES (?, ?, 1, ?, ?, ?, 100, ?, ?, ?)');
  add.run(20, 'f-inc', 'Certificate of incorporation.pdf', 'data-room/r/a', 'application/pdf', 'open', 10, null);
  add.run(21, 'f-model', 'Financial model v3.xlsx', 'data-room/r/b', 'application/octet-stream', 'open', null, null);
  add.run(22, 'f-pipe', 'Pipeline export.csv', 'data-room/r/c', 'text/csv', 'nda', null, null);
  add.run(23, 'f-done', 'Option plan.pdf', 'data-room/r/d', 'application/pdf', 'open', 10, 'option_plan');
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000),(4,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const calls: Array<{ model: string; prompt: string }> = [];
  const AI = withGuard({
    run: async (model: string, input: any) => {
      const msgs = input?.messages || [];
      calls.push({ model, prompt: msgs.filter((m: any) => m.role === 'user').map((m: any) => String(m.content || '')).join('\n') });
      return { response: answer(), usage: { prompt_tokens: 600, completion_tokens: 300 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  db.prepare("INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,4,'cofounder','accepted')").run();
  const app = new Hono<any>().route('/api/data-room', dataRoom).route('/api/data-room', dataRoomProposals).route('/api/ai/rail/proposals', aiRailProposals);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  /** Every file and folder column a proposal could touch, without timestamps. */
  const room = () => JSON.stringify({
    files: db.prepare('SELECT id, uid, name, folder_id, checklist_item, visibility, access_tier, access_expires_at, dd_request_id FROM data_room_files ORDER BY id').all(),
    folders: db.prepare('SELECT id, uid, parent_id, name, visibility FROM data_room_folders ORDER BY id').all(),
    grants: db.prepare('SELECT * FROM data_room_grants ORDER BY id').all(),
  });
  const rows = () => db.prepare('SELECT uid, user_id, rail_option, status, payload_json, decided_payload_json, decided_by_user_id FROM ai_rail_proposals ORDER BY id').all()
    .map((r: any) => ({ ...r, payload: JSON.parse(r.payload_json) }));
  return { db, env, app, calls, room, rows, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, path: string, json?: unknown, method = 'POST') {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

/** Quote, then run with the quote's confirmation: the proposals the run left. */
async function ask(f: F, who = 2) {
  const q = await call(f, who, `${BASE}/quote`);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const r = await call(f, who, `${BASE}/run`, { confirm_quote: q.body.quote.confirm_quote });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.proposals as any[];
}
const byType = (ps: any[], type: string, file?: string) => ps.find((p) => p.type === type && (!file || p.file?.uid === file));

// ─────────────────────────────────────────────────────────── the output check

test('the run\'s output is checked against the room: only known, unmatched, top-level files; plain words; at most one per file', async () => {
  const f = await fixture();
  try {
    const facts: RoomFacts = await roomFacts(f.env, 1);
    const kept = proposalsFrom(JSON.stringify([
      { type: 'match', file_uid: 'f-model', item: 'financial_model', reason: 'It is the model.' },
      { type: 'match', file_uid: 'f-model', item: 'sales_pipeline', reason: 'A second proposal for the same file.' },
      { type: 'match', file_uid: 'f-done', item: 'employment', reason: 'Already matched to the option plan.' },
      { type: 'match', file_uid: 'f-nope', item: 'security', reason: 'No such file.' },
    ]), facts);
    assert.deepEqual(kept.map((p) => [p.type, (p as any).file_uid]), [['match', 'f-model']]);

    const words = proposalsFrom([
      { type: 'folder', file_uid: 'f-pipe', folder_name: 'Customers', reason: 'Ask ada@example.invalid where it goes.' },
      { type: 'folder', file_uid: 'f-model', folder_name: 'Financials', reason: 'Our advice is to file it here.' },
      { type: 'folder', file_uid: 'f-inc', folder_name: 'Company', reason: 'Already in a folder.' },
      { type: 'gap', item: 'option_plan', would_satisfy: 'An option plan.', reason: 'Answered already.' },
      { type: 'gap', item: 'security', would_satisfy: 'A security overview.', reason: 'Nothing answers it.' },
      { type: 'gap', item: 'made_up', would_satisfy: 'x', reason: 'Not an item.' },
    ], facts);
    // Mutation checked: drop `wordsRefused` → the email and "advice" proposals survive and this fails.
    assert.deepEqual(words.map((p) => p.type), ['gap'], 'emails, "advice", foldered files and answered or unknown items are dropped');

    const many = Array.from({ length: 40 }, (_, i) => ({ type: 'gap', item: ['security', 'employment', 'material_contracts'][i % 3], would_satisfy: 'A file.', reason: `Reason ${i}.` }));
    assert.ok(proposalsFrom(many, facts).length <= MAX_PROPOSALS);
    assert.equal(proposalsFrom(many, facts).length, 3, 'one gap per item');
    assert.deepEqual(proposalsFrom('not json at all', facts), []);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── the quote

test('no run without the quote: a missing or stale confirmation is 402 and calls no model; the index holds names, not content', async () => {
  const f = await fixture();
  try {
    const q = await call(f, 2, `${BASE}/quote`);
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.ok(q.body.quote.hold_microusd > 0 && q.body.quote.model && q.body.quote.confirm_quote);
    assert.equal(f.calls.length, 0, 'a quote runs nothing');

    // Mutation checked: drop the confirm_quote comparison → the model is called here and this fails.
    const none = await call(f, 2, `${BASE}/run`, {});
    assert.equal(none.status, 402);
    assert.equal(none.body.error, 'quote_required');
    const stale = await call(f, 2, `${BASE}/run`, { confirm_quote: 'f'.repeat(64) });
    assert.equal(stale.status, 402);
    assert.equal(f.calls.length, 0, 'no model was called');
    assert.equal(f.rows().length, 0, 'nothing was proposed');

    // A changed room is a new quote: the old confirmation no longer runs.
    f.db.prepare("UPDATE data_room_files SET name = 'Renamed.pdf' WHERE id = 22").run();
    const changed = await call(f, 2, `${BASE}/run`, { confirm_quote: q.body.quote.confirm_quote });
    assert.equal(changed.status, 402, 'the quote named the room as it was');
    assert.equal(f.calls.length, 0);

    const ps = await ask(f);
    assert.equal(f.calls.length, 1, 'one run per press');
    assert.match(f.calls[0].prompt, /Financial model v3\.xlsx/);
    assert.doesNotMatch(f.calls[0].prompt, /data-room\/r\/|r2_key|example\.invalid/, 'no storage key or email is sent');
    assert.deepEqual(ps.map((p) => p.type).sort(), ['folder', 'folder', 'gap', 'match']);
    assert.ok(ps.every((p) => p.status === 'proposed' && p.reason));
    assert.equal(byType(ps, 'match').file.name, 'Certificate of incorporation.pdf');
    assert.equal(byType(ps, 'match').item.label, 'Certificate of incorporation');
    assert.ok(!/@/.test(JSON.stringify(ps)), 'no email in the list');

    // A second reading replaces the first one's open proposals.
    await ask(f);
    assert.equal(f.rows().filter((r: any) => r.status === 'withdrawn').length, 4);
    assert.equal(f.rows().filter((r: any) => r.status === 'proposed').length, 4);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── accept

test('Accept a match writes only that file\'s checklist item, and records who pressed', async () => {
  const f = await fixture();
  try {
    const ps = await ask(f, 4);
    const before = JSON.parse(f.room());
    const m = byType(ps, 'match');
    const r = await call(f, 4, `${BASE}/${m.uid}/accept`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = JSON.parse(f.room());
    const changedFiles = after.files.filter((x: any, i: number) => JSON.stringify(x) !== JSON.stringify(before.files[i]));
    assert.deepEqual(changedFiles, [{ ...before.files.find((x: any) => x.uid === 'f-inc'), checklist_item: 'incorporation' }], 'one field of one file');
    assert.deepEqual(after.folders, before.folders);
    const row = f.rows().find((x: any) => x.uid === m.uid);
    assert.equal(row.status, 'accepted');
    assert.equal(row.decided_by_user_id, 4, 'the actor is recorded');
    const log = f.db.prepare("SELECT user_id, action FROM activity_logs WHERE action = 'proposal_accepted'").all() as any[];
    assert.deepEqual(log.map((x) => ({ ...x })), [{ user_id: 4, action: 'proposal_accepted' }]);

    const again = await call(f, 4, `${BASE}/${m.uid}/accept`);
    assert.equal(again.status, 409, 'a proposal is decided once');
  } finally { f.close(); }
});

test('Accept never overwrites a match the founder made since: it is refused and the proposal stays open', async () => {
  const f = await fixture();
  try {
    const m = byType(await ask(f), 'match');
    f.db.prepare("UPDATE data_room_files SET checklist_item = 'board_consents' WHERE uid = 'f-inc'").run();
    // Mutation checked: drop the "no item yet" condition (check and batch) → the hand match is overwritten and this fails.
    const r = await call(f, 2, `${BASE}/${m.uid}/accept`);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'proposal_stale');
    assert.equal((f.db.prepare("SELECT checklist_item FROM data_room_files WHERE uid = 'f-inc'").get() as any).checklist_item, 'board_consents');
    assert.equal(f.rows().find((x: any) => x.uid === m.uid).status, 'proposed');
  } finally { f.close(); }
});

test('Accept a folder: a new folder takes the file\'s gate; an existing one is used only when the move changes no one\'s access', async () => {
  const f = await fixture();
  try {
    const ps = await ask(f);
    const before = JSON.parse(f.room());
    // f-pipe is NDA-gated; "Customers" does not exist, so it is made with the file's gate.
    const pipe = byType(ps, 'folder', 'f-pipe');
    const r = await call(f, 2, `${BASE}/${pipe.uid}/accept`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = JSON.parse(f.room());
    const made = after.folders.find((x: any) => x.name === 'Customers');
    assert.equal(made.visibility, 'nda');
    assert.equal(made.parent_id, null);
    assert.equal(after.files.find((x: any) => x.uid === 'f-pipe').folder_id, made.id);
    const changedFiles = after.files.filter((x: any, i: number) => JSON.stringify(x) !== JSON.stringify(before.files[i]));
    assert.equal(changedFiles.length, 1);

    // An active grant scoped to "Financials": moving the model there would open it to that investor. Refused.
    f.db.exec("INSERT INTO data_room_grants(id,uid,project_id,investor_user_id,granted_by_user_id,status,folders_scoped) VALUES (30,'g-1',1,5,2,'active',1)");
    f.db.exec('INSERT INTO data_room_grant_folders(grant_id, folder_id) VALUES (30, 10)');
    const snap = f.room();
    const model = byType(ps, 'folder', 'f-model');
    // Mutation checked: drop `folderChangesAccess` (and the batch's grant guard) → the file moves and this fails.
    const refused = await call(f, 2, `${BASE}/${model.uid}/accept`);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, 'would_change_access');
    assert.equal(f.room(), snap, 'nothing was written');
    assert.equal(f.rows().find((x: any) => x.uid === model.uid).status, 'proposed', 'the proposal stays open');

    // A folder of another gate is refused the same way.
    f.db.exec('DELETE FROM data_room_grant_folders');
    f.db.prepare("UPDATE data_room_folders SET visibility = 'nda' WHERE id = 10").run();
    const gate = await call(f, 2, `${BASE}/${model.uid}/accept`);
    assert.equal(gate.body.error, 'would_change_access');
    f.db.prepare("UPDATE data_room_folders SET visibility = 'open' WHERE id = 10").run();
    const ok = await call(f, 2, `${BASE}/${model.uid}/accept`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((f.db.prepare("SELECT folder_id FROM data_room_files WHERE uid = 'f-model'").get() as any).folder_id, 10);
  } finally { f.close(); }
});

test('Accept a gap writes no file; Dismiss writes nothing to files', async () => {
  const f = await fixture();
  try {
    const ps = await ask(f);
    const snap = f.room();
    const gap = byType(ps, 'gap');
    assert.equal((await call(f, 2, `${BASE}/${gap.uid}/accept`)).status, 200);
    assert.equal(f.room(), snap, 'a gap is advisory');
    assert.equal(f.rows().find((x: any) => x.uid === gap.uid).status, 'accepted');

    for (const p of ps.filter((x) => x.type !== 'gap')) {
      const d = await call(f, 2, `${BASE}/${p.uid}/dismiss`);
      assert.equal(d.status, 200, JSON.stringify(d.body));
    }
    // Mutation checked: make dismiss call acceptProposal → a file moves and this fails.
    assert.equal(f.room(), snap, 'dismiss writes nothing to files');
    assert.ok(f.rows().filter((x: any) => x.uid !== gap.uid && x.status !== 'withdrawn').every((x: any) => x.status === 'discarded' && x.decided_by_user_id === 2));
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── who

test('a member without write access to the room cannot accept, and the generic decide route cannot accept one either', async () => {
  const f = await fixture();
  try {
    const ps = await ask(f, 4);
    const m = byType(ps, 'match');
    const snap = f.room();
    // Another venture's founder and an investor: the room is not theirs.
    assert.equal((await call(f, 3, `${BASE}/${m.uid}/accept`)).status, 404);
    assert.equal((await call(f, 5, `${BASE}/${m.uid}/accept`)).status, 404);
    // The owner is a writer, but the proposal is Ben's own.
    assert.equal((await call(f, 2, `${BASE}/${m.uid}/accept`)).status, 409);
    // Ben leaves the venture: his own proposal can no longer be accepted.
    f.db.prepare("UPDATE project_members SET status = 'removed' WHERE user_id = 4").run();
    // Mutation checked: look the room up by its uid alone instead of `roomProject` → Ben's accept lands and this fails.
    assert.equal((await call(f, 4, `${BASE}/${m.uid}/accept`)).status, 404);
    f.db.prepare("UPDATE project_members SET status = 'accepted' WHERE user_id = 4").run();
    // The generic decide route keeps a data room proposal open.
    const generic = await call(f, 4, `/api/ai/rail/proposals/${m.uid}/decide`, { decision: 'accept' });
    assert.notEqual(generic.status, 200);
    assert.equal(f.room(), snap);
    assert.equal(f.rows().find((x: any) => x.uid === m.uid).status, 'proposed');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── undo

test('Undo puts a match or a move back once, and only while the file is as the accept left it', async () => {
  const f = await fixture();
  try {
    const ps = await ask(f);
    const snap = f.room();
    const m = byType(ps, 'match');
    const model = byType(ps, 'folder', 'f-model');
    assert.equal((await call(f, 2, `${BASE}/${m.uid}/accept`)).status, 200);
    assert.equal((await call(f, 2, `${BASE}/${model.uid}/accept`)).status, 200);
    const listed = (await call(f, 2, BASE, undefined, 'GET')).body.proposals;
    assert.ok(listed.find((p: any) => p.uid === m.uid).undoable);

    assert.equal((await call(f, 2, `${BASE}/${m.uid}/undo`)).status, 200);
    assert.equal((await call(f, 2, `${BASE}/${model.uid}/undo`)).status, 200);
    assert.equal(f.room(), snap, 'both files are back as they were');
    assert.equal((await call(f, 2, `${BASE}/${m.uid}/undo`)).status, 409, 'once');
    const row = f.rows().find((x: any) => x.uid === m.uid);
    assert.equal(row.status, 'discarded');
    assert.equal(JSON.parse(row.decided_payload_json).undone, true);

    // Accepted, then changed by hand: undo leaves the founder's change alone.
    const f2 = await fixture();
    try {
      const p2 = await ask(f2);
      const m2 = byType(p2, 'match');
      await call(f2, 2, `${BASE}/${m2.uid}/accept`);
      f2.db.prepare("UPDATE data_room_files SET checklist_item = 'board_consents' WHERE uid = 'f-inc'").run();
      const u = await call(f2, 2, `${BASE}/${m2.uid}/undo`);
      assert.equal(u.status, 409);
      assert.equal((f2.db.prepare("SELECT checklist_item FROM data_room_files WHERE uid = 'f-inc'").get() as any).checklist_item, 'board_consents');
      assert.equal(f2.rows().find((x: any) => x.uid === m2.uid).status, 'accepted');
    } finally { f2.close(); }
    // A gap has nothing to undo.
    const gap = byType(ps, 'gap');
    await call(f, 2, `${BASE}/${gap.uid}/accept`);
    assert.equal((await call(f, 2, `${BASE}/${gap.uid}/undo`)).status, 409);
  } finally { f.close(); }
});
