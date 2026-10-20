// D780 part 3 (#2105): Approve keeps the offered alt-text captions on top of
// part 2's per-image proposals and dedicated Save endpoint (#2222).
// A stale caption refuses the entire approval; no caption leaves stored text alone.
// Real SQLite and migration 506, with the AI guard stub.
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

const MIGRATION = readFileSync(new URL('../sql/migrations/506_ai_rail_proposals.sql', import.meta.url), 'utf8');
const SUPER = 1;
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

// 2 ───────────────────────────────────────────────────────────────────────────
test('an Approve that names no caption leaves the captions as they were', async () => {
  // Mutations checked: alt_texts cleared by an Approve with no captions.
  const w = await world();
  w.f.db.prepare(`UPDATE x_posts SET alt_texts = '["Kept.",""]' WHERE id = 7`).run();
  assert.equal((await call(w, SUPER, 'POST', '/api/admin/x/posts/7/approve', {})).status, 200);
  assert.deepEqual(JSON.parse(alts(w)), ['Kept.', '']);
});

