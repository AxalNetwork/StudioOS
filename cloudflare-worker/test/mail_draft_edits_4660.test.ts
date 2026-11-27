/**
 * D4660 (#4660, finding 5, the Worker half): a member's edits to a draft are
 * stored beside the text Eadwyn generated. Synthetic data, the mounted Worker
 * routes and the real migrated schema; `env.AI` is a stub and `fetch` throws.
 *
 *   · a save is a plain write: no model run, no charge, and nothing about the
 *     generated text changes;
 *   · it names the revision it read, and a stale one is 409 with the current draft;
 *   · the text is kept exactly as typed, and survives a read and a list;
 *   · a revision starts from the member's saved edit, not the older generated text;
 *   · a member can edit only their own draft.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import mail from '../src/routes/mail_drafts.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-d4660-only-not-a-real-credential'.repeat(2);
const GENERATED = { subject: 'Thank you', body: 'Thank you for the conversation.' };
const SHORTER = JSON.stringify({ subject: 'Thanks', body: 'Thanks for talking.' });

async function fixture() {
  __resetForTest();
  const db = migratedDatabase();
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[2, 'founder', 100], [3, 'founder', 300]] as const) insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  db.exec(`INSERT INTO discovery_interviews(id,project_id,interviewee_name,interviewee_company,stage,done_at,notes,pains_json,updated_at)
           VALUES (11,1,'Synthetic Ada','Synthetic Co','done','2026-10-01','Synthetic notes','[]','2026-10-02 09:00:00')`);
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,2)').run(key);
  const calls: string[] = [];
  const AI = withGuard({ run: async (_m: string, input: any) => { calls.push((input?.messages || []).map((m: any) => String(m.content || '')).join('\n')); return { response: SHORTER, usage: { prompt_tokens: 80, completion_tokens: 40 } }; } });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  // One stored draft for member 2, exactly as a generated draft is stored.
  db.prepare(`INSERT INTO mail_drafts (uid, user_id, person_ref, intent, tone, length, refs_json, blocks_json, subject, body, cost_micro_usd)
              VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 2, 'interviewee:11', 'thank_follow_up', 'warm', 'short', '[]', '[]', ?, ?, 12345)`).run(GENERATED.subject, GENERATED.body);
  const app = new Hono<any>().route('/api/mail', mail);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const rows = () => db.prepare('SELECT uid, parent_uid, subject, body, edited_to, edited_subject, edited_body, edit_revision, cost_micro_usd FROM mail_drafts ORDER BY id').all() as any[];
  const runs = () => db.prepare("SELECT id FROM ai_usage_logs WHERE task = 'mail_draft'").all() as any[];
  return { db, env, app, calls, rows, runs, close: () => { globalThis.fetch = real; db.close(); } };
}
type F = Awaited<ReturnType<typeof fixture>>;
const UID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function rawCall(f: F, who: number, method: string, path: string, json?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
/** D4666: a revision press brings its own estimate's quote, as the composer does; `rawCall` is the bare request. */
async function call(f: F, who: number, method: string, path: string, json?: any) {
  if (method === 'POST' && /\/revise$/.test(path) && json && !json.estimate && !('quote' in json)) {
    const e = await rawCall(f, who, method, path, { ...json, estimate: true });
    if (e.status === 200 && e.body?.estimate?.quote) json = { ...json, quote: e.body.estimate.quote };
  }
  return rawCall(f, who, method, path, json);
}
const save = (f: F, who: number, expected: unknown, edit: Record<string, unknown> = { to: 'ada@example.test', subject: 'My subject', body: 'My own words.\n\n  Indented, untrimmed.  ' }) =>
  call(f, who, 'PATCH', `/api/mail/drafts/${UID}`, { ...edit, expected_revision: expected });

test('a saved edit is stored beside the generated text, exactly as typed, with no run and no charge', async () => {
  const f = await fixture();
  try {
    const before = (await call(f, 2, 'GET', `/api/mail/drafts/${UID}`)).body.draft;
    assert.equal(before.edit, null, 'never edited');
    const r = await save(f, 2, 0);
    assert.equal(r.status, 200);
    const d = r.body.draft;
    assert.deepEqual([d.subject, d.body], [GENERATED.subject, GENERATED.body], 'the generated source snapshot is untouched');
    assert.deepEqual(d.edit, { to: 'ada@example.test', subject: 'My subject', body: 'My own words.\n\n  Indented, untrimmed.  ', revision: 1, at: d.edit.at });
    assert.ok(d.edit.at, 'when it was saved');
    assert.equal(f.runs().length, 0, 'no model run');
    assert.equal(f.calls.length, 0, 'the model was never called');
    assert.equal(f.rows()[0].cost_micro_usd, 12345, 'the draft’s charge is what the router charged for its generation, unchanged');
    // The text survives a read and a list, so a closed composer can be reopened.
    assert.equal((await call(f, 2, 'GET', `/api/mail/drafts/${UID}`)).body.draft.edit.body, 'My own words.\n\n  Indented, untrimmed.  ');
    assert.equal((await call(f, 2, 'GET', '/api/mail/drafts?person=interviewee%3A11')).body.drafts[0].edit.subject, 'My subject');
  } finally { f.close(); }
});

test('a save names the revision it read; a stale copy is 409 with the current draft and writes nothing', async () => {
  const f = await fixture();
  try {
    assert.equal((await save(f, 2, 0)).status, 200);
    const stale = await save(f, 2, 0, { to: '', subject: 'From an older tab', body: 'Older text' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code ?? stale.body.error, 'stale_edit');
    assert.equal(stale.body.draft?.edit?.revision ?? stale.body.extra?.draft?.edit?.revision, 1, 'the answer carries the current draft');
    assert.equal(f.rows()[0].edited_subject, 'My subject', 'nothing was overwritten');
    assert.equal((await save(f, 2, 1, { to: '', subject: 'Second', body: 'Second body' })).body.draft.edit.revision, 2);
    // Two saves from one copy at once: one wins, the other is told.
    const both = await Promise.all([save(f, 2, 2, { to: '', subject: 'A', body: 'a' }), save(f, 2, 2, { to: '', subject: 'B', body: 'b' })]);
    assert.deepEqual(both.map((x) => x.status).sort(), [200, 409]);
    assert.equal(f.rows()[0].edit_revision, 3);
  } finally { f.close(); }
});

test('it refuses what is not text, what is too long, and a save that names no revision; nothing is written', async () => {
  const f = await fixture();
  try {
    const refused = async (edit: Record<string, unknown>, expected: unknown, code: string) => {
      const r = await save(f, 2, expected, edit);
      assert.equal(r.status, 400, code);
      assert.equal(r.body.code ?? r.body.error, code);
    };
    await refused({ to: '', subject: 5, body: 'x' }, 0, 'edit_invalid');
    await refused({ to: '', subject: 'x', body: null }, 0, 'edit_invalid');
    await refused({ to: '', subject: 'x'.repeat(201), body: 'x' }, 0, 'edit_too_long');
    await refused({ to: '', subject: 'x', body: 'x'.repeat(8001) }, 0, 'edit_too_long');
    await refused({ to: 'x'.repeat(255), subject: 'x', body: 'x' }, 0, 'edit_too_long');
    await refused({ to: '', subject: 'x', body: 'x' }, undefined, 'revision_required');
    await refused({ to: '', subject: 'x', body: 'x' }, 'one', 'revision_required');
    await refused({ to: '', subject: 'x', body: 'x' }, -1, 'revision_required');
    assert.equal(f.rows()[0].edit_revision, 0);
    // A half-written draft is fine: an empty body or a recipient that is not yet an address.
    assert.equal((await save(f, 2, 0, { to: 'ada@', subject: '', body: '' })).status, 200);
  } finally { f.close(); }
});

test('a member edits only their own draft; another member and an unknown uid are 404 in the same words', async () => {
  const f = await fixture();
  try {
    const other = await save(f, 3, 0);
    const missing = await call(f, 2, 'PATCH', '/api/mail/drafts/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', { to: '', subject: 'x', body: 'x', expected_revision: 0 });
    const malformed = await call(f, 2, 'PATCH', '/api/mail/drafts/not-a-uid', { to: '', subject: 'x', body: 'x', expected_revision: 0 });
    for (const r of [other, missing, malformed]) assert.equal(r.status, 404);
    assert.deepEqual(other.body, missing.body);
    assert.equal(f.rows()[0].edit_revision, 0);
  } finally { f.close(); }
});

test('Shorter starts from the member’s saved edit, not the older generated text, and the result is its own version', async () => {
  const f = await fixture();
  try {
    await save(f, 2, 0, { to: 'ada@example.test', subject: 'Edited subject line', body: 'EDITED BODY the member wrote by hand.' });
    const r = await call(f, 2, 'POST', `/api/mail/drafts/${UID}/revise`, { instruction: 'shorter' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(f.calls.length, 1);
    assert.ok(f.calls[0].includes('EDITED BODY the member wrote by hand.'), 'the model was given the edited text');
    assert.ok(f.calls[0].includes('Edited subject line'));
    assert.ok(!f.calls[0].includes(GENERATED.body), 'not the generated text it replaced');
    const child = r.body.draft;
    assert.equal(child.parent_uid, UID, 'a new version that keeps its parent');
    assert.equal(child.instruction.startsWith('Make it shorter'), true);
    assert.equal(child.edit, null, 'the new version has no edits of its own yet');
    const rows = f.rows();
    assert.equal(rows.length, 2);
    assert.deepEqual([rows[0].subject, rows[0].body, rows[0].edited_body], [GENERATED.subject, GENERATED.body, 'EDITED BODY the member wrote by hand.'], 'the parent keeps both its generated text and the edit');
  } finally { f.close(); }
});

test('with no saved edit, a revision still starts from the generated text, as before', async () => {
  const f = await fixture();
  try {
    const r = await call(f, 2, 'POST', `/api/mail/drafts/${UID}/revise`, { instruction: 'shorter' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(f.calls[0].includes(GENERATED.body));
  } finally { f.close(); }
});
