// D780 part 2 (#2105) — `/admin/x` "Generate alt text": Eadwyn's caption for an
// image is a `draft` proposal (`draft:x/alt-text`, on `x_post:<id>`, the image
// index in the payload), never `x_posts.alt_texts`. The run stays the
// `image_alt_text` system call (D766: user 0, unbilled). The Super Admin's Save
// (PUT `alt_text`) or Approve (`alt_text_proposal_uids`) writes the caption and
// keeps the proposal; a newer caption for the same image withdraws the older.
//
// Real SQLite, with the table from migration 506; env.AI is stubbed with the
// guard stub. Each case names the mutations it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/rail_x_alt_text_d780.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { ensureXSchema } from '../src/services/xSchema.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import x, { X_ALT_TEXT_OPTION } from '../src/routes/admin_x.ts';
import { proposeRail, withdrawRailUid } from '../src/services/railProposals.ts';

const MIGRATION = readFileSync(new URL('../sql/migrations/506_ai_rail_proposals.sql', import.meta.url), 'utf8');
const SUPER = 1;
const OTHER = 4;
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

function makeAI(texts: string[]) {
  let n = 0;
  return { async run() { return { response: texts[Math.min(n++, texts.length - 1)], usage: { prompt_tokens: 40, completion_tokens: 6 } }; } };
}

async function world(texts = ['A team at a whiteboard.']) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec(MIGRATION);
  f.db.exec("CREATE TABLE admin_audit_log(id INTEGER PRIMARY KEY, admin_id INTEGER, admin_email TEXT, action TEXT, filters TEXT, created_at TEXT DEFAULT (datetime('now')));");
  const files = new Map<string, Uint8Array>();
  const FILES = { async get(k: string) { const b = files.get(k); return b ? { httpMetadata: { contentType: 'image/png' }, async arrayBuffer() { return b.buffer; } } : null; } };
  const env: any = { DB: f.DB, AI: withGuard(makeAI(texts)), FILES, JWT_SECRET: 'd780-x-fixture-only-secret', ENVIRONMENT: 'development' };
  await ensureXSchema(env);
  f.db.prepare("INSERT INTO x_accounts(id,handle) VALUES(1,'axal')").run();
  f.db.prepare("INSERT INTO x_posts(id,account_id,body,created_by,media_r2_keys) VALUES(7,1,'A post',1,'[\"x/1/7/a.png\",\"x/1/7/b.png\"]')").run();
  files.set('x/1/7/a.png', PNG);
  files.set('x/1/7/b.png', PNG);
  return { f, env };
}
function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/admin/x', x);
  return a;
}
async function call(w: any, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const alts = (w: any) => w.f.db.prepare('SELECT alt_texts FROM x_posts WHERE id = 7').get().alt_texts;
const proposal = (w: any, uid: string) => w.f.db.prepare('SELECT * FROM ai_rail_proposals WHERE uid = ?').get(uid);

// 1 ───────────────────────────────────────────────────────────────────────────
test('the caption is a draft proposal naming the image and the run, and the post is not written', async () => {
  // Mutations checked: the alt_texts write restored; the image index left out of the payload; the run's usage row not named.
  const w = await world();
  const r = await call(w, SUPER, 'POST', '/api/admin/x/posts/7/alt-text', { index: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(alts(w), null, 'Eadwyn\'s caption was written into the post');
  const row = proposal(w, r.body.proposal.uid);
  assert.deepEqual([row.user_id, row.kind, row.rail_option, row.record_ref, row.status], [SUPER, 'draft', X_ALT_TEXT_OPTION, 'x_post:7', 'proposed']);
  assert.deepEqual(JSON.parse(row.payload_json), { index: 1, text: 'A team at a whiteboard.' });
  assert.deepEqual(r.body.proposal, { uid: row.uid, index: 1, text: 'A team at a whiteboard.' });
  // The run is unchanged: the image_alt_text system call, user 0, and the proposal names its row.
  const run = w.f.db.prepare("SELECT id, user_id FROM ai_usage_logs WHERE guard_for IS NULL AND task = 'image_alt_text'").get();
  assert.equal(run.user_id, 0);
  assert.equal(row.usage_log_id, run.id);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('a newer caption for one image withdraws the older; the other image\'s caption stays open', async () => {
  // Mutations checked: every open caption on the post withdrawn (the record, not the image); none withdrawn.
  const w = await world(['First.', 'Other image.', 'Second.']);
  const first = (await call(w, SUPER, 'POST', '/api/admin/x/posts/7/alt-text', { index: 0 })).body.proposal.uid;
  const other = (await call(w, SUPER, 'POST', '/api/admin/x/posts/7/alt-text', { index: 1 })).body.proposal.uid;
  const second = (await call(w, SUPER, 'POST', '/api/admin/x/posts/7/alt-text', { index: 0 })).body.proposal.uid;
  assert.deepEqual([first, other, second].map((u) => proposal(w, u).status), ['withdrawn', 'proposed', 'proposed']);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('Save writes the caption and keeps the proposal as accepted, or as edited', async () => {
  // Mutations checked: Save not deciding the proposal; an edit kept as accepted; the caption written to the wrong image.
  const w = await world(['Caption A.', 'Caption B.']);
  const a = (await call(w, SUPER, 'POST', '/api/admin/x/posts/7/alt-text', { index: 0 })).body.proposal.uid;
  const b = (await call(w, SUPER, 'POST', '/api/admin/x/posts/7/alt-text', { index: 1 })).body.proposal.uid;
  const s1 = await call(w, SUPER, 'PUT', '/api/admin/x/posts/7', { alt_text: { index: 0, text: 'Caption A.', proposal_uid: a } });
  assert.equal(s1.status, 200, JSON.stringify(s1.body));
  assert.deepEqual(JSON.parse(alts(w)), ['Caption A.', '']);
  assert.equal(proposal(w, a).status, 'accepted');
  await call(w, SUPER, 'PUT', '/api/admin/x/posts/7', { alt_text: { index: 1, text: 'My caption.', proposal_uid: b } });
  assert.deepEqual(JSON.parse(alts(w)), ['Caption A.', 'My caption.']);
  const row = proposal(w, b);
  assert.deepEqual([row.status, JSON.parse(row.decided_payload_json)], ['edited', { index: 1, text: 'My caption.' }]);
  // A typed caption with no proposal is the admin's own, and decides nothing.
  assert.equal((await call(w, SUPER, 'PUT', '/api/admin/x/posts/7', { alt_text: { index: 1, text: 'Typed.' } })).status, 200);
  assert.deepEqual(JSON.parse(alts(w)), ['Caption A.', 'Typed.']);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('Save refuses a proposal that is not open, not the admin\'s, or for another image, and writes nothing', async () => {
  // Mutations checked: the open check removed; the owner check removed (getRail unscoped); the image index not compared.
  const w = await world();
  const uid = (await call(w, SUPER, 'POST', '/api/admin/x/posts/7/alt-text', { index: 0 })).body.proposal.uid;
  const put = (who: number, alt: unknown) => call(w, who, 'PUT', '/api/admin/x/posts/7', { alt_text: alt });
  const theirs = await proposeRail(w.env, { userId: OTHER, page: 'admin/x', option: X_ALT_TEXT_OPTION, record: 'x_post:7', kind: 'draft', payload: { index: 0, text: 'Theirs.' } });
  assert.equal((await put(SUPER, { index: 0, text: 'x', proposal_uid: theirs.uid })).status, 409, 'another member\'s proposal kept');
  assert.equal((await put(SUPER, { index: 1, text: 'x', proposal_uid: uid })).status, 409, 'kept on another image');
  assert.equal((await put(SUPER, { index: 2, text: 'x' })).status, 400, 'an image the post does not have');
  assert.equal(alts(w), null);
  assert.equal(proposal(w, uid).status, 'proposed');
  await call(w, SUPER, 'PUT', '/api/admin/x/posts/7', { alt_text: { index: 0, text: 'A team at a whiteboard.', proposal_uid: uid } });
  assert.equal((await put(SUPER, { index: 0, text: 'again', proposal_uid: uid })).status, 409, 'a decided proposal kept twice');
  assert.deepEqual(JSON.parse(alts(w)), ['A team at a whiteboard.', '']);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('Approve keeps the captions it names; one that is not open refuses the Approve and keeps nothing', async () => {
  // Mutations checked: Approve not writing the captions; Approve not deciding them; a stale uid skipped instead of refused.
  const w = await world(['Caption A.', 'Caption B.']);
  const a = (await call(w, SUPER, 'POST', '/api/admin/x/posts/7/alt-text', { index: 0 })).body.proposal.uid;
  const b = (await call(w, SUPER, 'POST', '/api/admin/x/posts/7/alt-text', { index: 1 })).body.proposal.uid;
  await call(w, SUPER, 'POST', `/api/admin/x/posts/7/alt-text`, { index: 1 });  // withdraws b
  const stale = await call(w, SUPER, 'POST', '/api/admin/x/posts/7/approve', { alt_text_proposal_uids: [a, b] });
  assert.equal(stale.status, 409);
  assert.equal(w.f.db.prepare('SELECT status FROM x_posts WHERE id = 7').get().status, 'draft');
  assert.equal(alts(w), null);
  assert.equal(proposal(w, a).status, 'proposed');

  const ok = await call(w, SUPER, 'POST', '/api/admin/x/posts/7/approve', { alt_text_proposal_uids: [a] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(w.f.db.prepare('SELECT status FROM x_posts WHERE id = 7').get().status, 'approved');
  assert.deepEqual(JSON.parse(alts(w)), ['Caption A.', '']);
  assert.equal(proposal(w, a).status, 'accepted');
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('an Approve that names no caption leaves the captions as they were', async () => {
  // Mutations checked: alt_texts cleared by an Approve with no captions.
  const w = await world();
  w.f.db.prepare(`UPDATE x_posts SET alt_texts = '["Kept.",""]' WHERE id = 7`).run();
  assert.equal((await call(w, SUPER, 'POST', '/api/admin/x/posts/7/approve', {})).status, 200);
  assert.deepEqual(JSON.parse(alts(w)), ['Kept.', '']);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('withdrawRailUid takes back only the member\'s own open proposal', async () => {
  // Mutations checked: the withdrawal unscoped by user; a decided proposal withdrawn.
  const w = await world();
  const base = { page: 'admin/x', option: X_ALT_TEXT_OPTION, record: 'x_post:7', kind: 'draft' as const, payload: { index: 0, text: 'A.' } };
  const mine = await proposeRail(w.env, { ...base, userId: SUPER });
  const theirs = await proposeRail(w.env, { ...base, userId: OTHER });
  assert.equal(await withdrawRailUid(w.env, SUPER, theirs.uid), false, 'another member\'s proposal withdrawn');
  assert.equal(proposal(w, theirs.uid).status, 'proposed');
  assert.equal(await withdrawRailUid(w.env, SUPER, mine.uid), true);
  assert.equal(proposal(w, mine.uid).status, 'withdrawn');
  assert.equal(await withdrawRailUid(w.env, SUPER, mine.uid), false, 'withdrawn twice');
});
