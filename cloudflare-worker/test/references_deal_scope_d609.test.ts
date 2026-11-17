/**
 * D609 and D6735 — reads require access to the deal and the reference. An
 * investor sees their own checks and checks recorded under their active firm.
 *
 * Driven through the real router (`routes/references.ts`) on real
 * `node:sqlite`, with the tables from `schema_baseline.sql`.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/references_deal_scope_d609.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import references from '../src/routes/references.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
// Users: admin, three investors (invited to deal 1, committed on deal 1, neither), a founder (owns deal 1's project), a partner.
const ADMIN = 1, INV_INVITED = 2, INV_COMMITTED = 3, INV_NONE = 4, FOUNDER = 5, PARTNER = 6, INV_OTHER_FIRM = 7;
const ROLE: Record<number, string> = { 1: 'admin', 2: 'investor', 3: 'investor', 4: 'investor', 5: 'founder', 6: 'partner', 7: 'investor' };
const FIRM = 100, OTHER_FIRM = 200;
const FIRMS: Record<number, number> = { [INV_INVITED]: FIRM, [INV_COMMITTED]: FIRM, [INV_OTHER_FIRM]: OTHER_FIRM };

function freshDb() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  for (const [id, role] of Object.entries(ROLE)) u.run(Number(id), role, `User ${id}`, `u${id}@example.test`);
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id) VALUES (?, ?, ?)');
  for (const [user, firm] of Object.entries(FIRMS)) link.run('link-' + user, Number(user), firm);
  db.exec(`UPDATE users SET founder_id = 50 WHERE id = ${FOUNDER}`);
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (10, 'Deal one co', 50), (20, 'Deal two co', 60)`).run();
  db.prepare(`INSERT INTO deals (id, project_id) VALUES (1, 10), (2, 20)`).run();
  db.prepare(`INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (1, ?)`).run(INV_INVITED);
  db.prepare('INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (1, ?)').run(INV_OTHER_FIRM);
  db.prepare(`INSERT INTO commitments (deal_id, investor_user_id, amount, status) VALUES (1, ?, 1000, 'pending')`).run(INV_COMMITTED);
  const ref = db.prepare(`INSERT INTO reference_checks (id, uid, deal_id, reference_name, reference_email, status, transcript, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, 'scheduled', 'transcript text', '2026-10-07', '2026-10-07')`);
  ref.run(101, 'r101', 1, 'Rita Reference', 'rita@example.test');
  ref.run(201, 'r201', 2, 'Other Deal Ref', 'other@example.test');
  db.exec("UPDATE reference_checks SET created_by = 2, company_id = 100 WHERE id = 101");
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/references', references as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, company = FIRMS[who]) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers = new Headers({ Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' });
  if (company) headers.set('X-Company-Id', String(company));
  const res = await app.fetch(new Request(`http://x/api/references${path}`, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const count = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM reference_checks').get() as any).n;

test('D609: the list needs deal_id; the cross-deal list is gone', async () => {
  const db = freshDb();
  for (const who of [ADMIN, INV_INVITED]) {
    const r = await call(db, who, 'GET', '');
    assert.equal(r.status, 400, `user ${who}`);
    assert.equal(r.body.error, 'deal_id_required');
    assert.doesNotMatch(r.text, /Rita|Other Deal/);
  }
  assert.equal((await call(db, ADMIN, 'GET', '?deal_id=abc')).status, 400);
});

test('D609: the list — admin any deal; invited or committed investor their deal; anyone else 404 or 403', async () => {
  const db = freshDb();
  const names = async (who: number, deal: number) => {
    const r = await call(db, who, 'GET', `?deal_id=${deal}`);
    return [r.status, r.status === 200 ? r.body.map((x: any) => x.reference_name) : null];
  };
  assert.deepEqual(await names(ADMIN, 1), [200, ['Rita Reference']]);
  assert.deepEqual(await names(ADMIN, 2), [200, ['Other Deal Ref']]);
  assert.deepEqual(await names(INV_INVITED, 1), [200, ['Rita Reference']]);
  assert.deepEqual(await names(INV_COMMITTED, 1), [200, ['Rita Reference']]);
  assert.deepEqual(await names(INV_OTHER_FIRM, 1), [404, null]);
  assert.deepEqual(await names(INV_NONE, 1), [404, null], 'an investor with no relationship read the deal');
  assert.deepEqual(await names(INV_INVITED, 2), [404, null], 'an investor read another deal');
  assert.deepEqual(await names(ADMIN, 999), [404, null]);
  assert.equal((await call(db, FOUNDER, 'GET', '?deal_id=1')).status, 403, 'a founder reached references');
  assert.equal((await call(db, PARTNER, 'GET', '?deal_id=1')).status, 403, 'a partner reached references');
});

test('D609: one reference — another deal\'s reads as a 404, the same as a missing one', async () => {
  const db = freshDb();
  const r = await call(db, INV_INVITED, 'GET', '/101');
  assert.deepEqual([r.status, r.body.transcript], [200, 'transcript text']);
  assert.equal((await call(db, INV_COMMITTED, 'GET', '/101')).status, 200);
  const forbidden = await call(db, INV_OTHER_FIRM, 'GET', '/101');
  assert.equal(forbidden.status, 404);
  assert.deepEqual(forbidden.body, (await call(db, INV_OTHER_FIRM, 'GET', '/999')).body);
  assert.equal((await call(db, INV_OTHER_FIRM, 'GET', '/101', undefined, FIRM)).status, 404);
  assert.equal((await call(db, ADMIN, 'GET', '/201')).status, 200);
  const other = await call(db, INV_INVITED, 'GET', '/201');
  const missing = await call(db, INV_INVITED, 'GET', '/999');
  assert.deepEqual([other.status, other.body], [missing.status, missing.body], 'another deal\'s reference is told apart from a missing one');
  assert.equal(other.status, 404);
  assert.doesNotMatch(other.text, /Other Deal|other@example/);
  assert.equal((await call(db, INV_NONE, 'GET', '/101')).status, 404);
  assert.equal((await call(db, FOUNDER, 'GET', '/101')).status, 403);
  assert.equal((await call(db, PARTNER, 'GET', '/101')).status, 403);
});

test('D609: update — only on a deal the caller can open', async () => {
  const db = freshDb();
  assert.equal((await call(db, INV_INVITED, 'PATCH', '/101', { notes: 'ok' })).status, 200);
  assert.equal((await call(db, INV_COMMITTED, 'PATCH', '/101', { notes: 'refused' })).status, 403);
  assert.equal((await call(db, INV_OTHER_FIRM, 'PATCH', '/101', { notes: 'refused' })).status, 404);
  assert.equal((await call(db, ADMIN, 'PATCH', '/201', { notes: 'admin' })).status, 200);
  assert.equal((await call(db, INV_INVITED, 'PATCH', '/201', { notes: 'nope' })).status, 404);
  assert.equal((await call(db, INV_NONE, 'PATCH', '/101', { notes: 'nope' })).status, 404);
  assert.equal((await call(db, FOUNDER, 'PATCH', '/101', { notes: 'nope' })).status, 403);
  assert.equal((await call(db, PARTNER, 'PATCH', '/101', { notes: 'nope' })).status, 403);
  const notes = (db.prepare('SELECT id, notes FROM reference_checks ORDER BY id').all() as any[]).map((r) => [r.id, r.notes]);
  assert.deepEqual(notes, [[101, 'ok'], [201, 'admin']]);
});

test('D609: consent — only on a deal the caller can open', async () => {
  const db = freshDb();
  assert.equal((await call(db, INV_COMMITTED, 'POST', '/101/consent', { consent_given: true })).status, 200);
  assert.equal((await call(db, INV_COMMITTED, 'POST', '/201/consent', { consent_given: false })).status, 404);
  assert.equal((await call(db, PARTNER, 'POST', '/101/consent', { consent_given: false })).status, 403);
  assert.equal((db.prepare('SELECT transcript FROM reference_checks WHERE id = 201').get() as any).transcript, 'transcript text',
    'another deal\'s transcript was wiped');
});

test('D609: delete — only on a deal the caller can open', async () => {
  const db = freshDb();
  assert.equal((await call(db, INV_NONE, 'DELETE', '/101')).status, 404);
  assert.equal((await call(db, INV_INVITED, 'DELETE', '/201')).status, 404);
  assert.equal((await call(db, FOUNDER, 'DELETE', '/101')).status, 403);
  assert.equal(count(db), 2, 'a refused delete removed a row');
  assert.equal((await call(db, INV_COMMITTED, 'DELETE', '/101')).status, 403);
  assert.equal((await call(db, INV_OTHER_FIRM, 'DELETE', '/101')).status, 404);
  assert.equal((await call(db, INV_INVITED, 'DELETE', '/101')).status, 200);
  assert.equal((await call(db, ADMIN, 'DELETE', '/201')).status, 200);
  assert.equal(count(db), 0);
});

test('D609: create — the deal must exist and be one the caller can open', async () => {
  const db = freshDb();
  const make = (who: number, deal: unknown) => call(db, who, 'POST', '', { deal_id: deal, reference_name: 'New Ref' });
  assert.equal((await make(INV_INVITED, 1)).status, 200);
  assert.equal((await make(ADMIN, 2)).status, 200);
  assert.equal((await make(ADMIN, 999)).status, 404, 'a reference was created on a deal that does not exist');
  const blocked = await make(INV_INVITED, 2);
  const missing = await make(INV_INVITED, 999);
  assert.deepEqual([blocked.status, blocked.body], [missing.status, missing.body], 'a deal the caller cannot open is told apart from a missing one');
  assert.equal((await make(INV_NONE, 1)).status, 404);
  assert.equal((await make(FOUNDER, 1)).status, 403);
  assert.equal((await make(PARTNER, 1)).status, 403);
  assert.equal((await make(ADMIN, 'x')).status, 400);
  assert.equal(count(db), 4);
});

test('D6735: creation records the verified firm; old and independent checks stay private', async (t) => {
  const db = freshDb();
  t.after(() => db.close());
  // Clear the stamp to represent a record written before the migration.
  db.exec('UPDATE reference_checks SET company_id = NULL WHERE id = 101');
  const hidden = await call(db, INV_COMMITTED, 'GET', '?deal_id=1');
  assert.equal(hidden.status, 404);
  assert.equal(hidden.body.error, 'no_visible_references');
  assert.equal((await call(db, INV_COMMITTED, 'GET', '/101')).status, 404);
  assert.equal((await call(db, INV_INVITED, 'GET', '/101', undefined, 0)).status, 200);
  assert.equal((await call(db, ADMIN, 'GET', '/101')).status, 200);
  db.exec('DELETE FROM reference_checks WHERE id = 101');
  const empty = await call(db, INV_COMMITTED, 'GET', '?deal_id=1');
  assert.deepEqual([empty.status, empty.body], [hidden.status, hidden.body]);

  const independent = await call(db, INV_INVITED, 'POST', '', { deal_id: 1, reference_name: 'Private' }, 0);
  assert.equal(independent.status, 200);
  const firm = await call(db, INV_INVITED, 'POST', '', { deal_id: 1, reference_name: 'Firm', company_id: OTHER_FIRM });
  assert.equal(firm.status, 200);
  const stamps = db.prepare('SELECT company_id FROM reference_checks WHERE deal_id = 1 ORDER BY id').all();
  assert.deepEqual(stamps.map(row => row.company_id), [null, FIRM]);
  const visible = await call(db, INV_COMMITTED, 'GET', '?deal_id=1');
  assert.equal(visible.status, 200);
  assert.deepEqual(visible.body.map((row: any) => row.id), [firm.body.id]);
});

// ── D6183 (#6183): Eadwyn summarises the typed notes; there is no audio ────────
import { summaryDeps, parseSummary, MIN_NOTES_CHARS } from '../src/routes/references.ts';

const NOTES = 'Former manager. Says the founder hires slowly and well, and shipped the payments rewrite on time.';
function withRun<T>(output: string | null, fn: (calls: any[]) => Promise<T>, extra: Record<string, unknown> = {}): Promise<T> {
  const original = summaryDeps.run;
  const calls: any[] = [];
  summaryDeps.run = (async (_env: any, opts: any) => { calls.push(opts); return { ok: output != null, output, refusal: null, usage: { model: 'test-model' }, ...extra }; }) as any;
  return fn(calls).finally(() => { summaryDeps.run = original; });
}

test('D6183: summarise stores the summary from the notes only, marks it summarised, and says when the notes change', async () => {
  const db = freshDb();
  db.prepare('UPDATE reference_checks SET notes = ? WHERE id = 101').run(NOTES);
  await withRun('{"summary":"The founder hires carefully and delivers.","strengths":["Hires well","Ships on time"],"concerns":[]}', async (calls) => {
    const r = await call(db, INV_INVITED, 'POST', '/101/summarize');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.status, r.body.summary.summary, r.body.summary.strengths, r.body.summary.from, r.body.summary_stale],
      ['summarized', 'The founder hires carefully and delivers.', ['Hires well', 'Ships on time'], 'notes', false]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].surface, '/deals');
    assert.match(calls[0].messages[0].content, /hires slowly and well/, 'the notes are what is summarised');
    assert.doesNotMatch(JSON.stringify(calls[0]), /rita@example\.test/, 'the reference\'s email is not sent to the model');
  });
  // Edit the notes: the summary is kept but says it no longer matches.
  await call(db, INV_INVITED, 'PATCH', '/101', { notes: `${NOTES} Later: also a strong seller.` });
  assert.equal((await call(db, INV_INVITED, 'GET', '/101')).body.summary_stale, true);
});

test('D6183: summarise is refused before any run for short notes, a non-author, a stranger and another deal', async () => {
  const db = freshDb();
  await withRun('{"summary":"x"}', async (calls) => {
    db.prepare('UPDATE reference_checks SET notes = ? WHERE id = 101').run('too short');
    const short = await call(db, INV_INVITED, 'POST', '/101/summarize');
    assert.deepEqual([short.status, short.body.code], [409, 'notes_required']);
    assert.ok('too short'.length < MIN_NOTES_CHARS);
    db.prepare('UPDATE reference_checks SET notes = ? WHERE id IN (101, 201)').run(NOTES);
    assert.equal((await call(db, INV_COMMITTED, 'POST', '/101/summarize')).status, 403, 'only the author or an admin');
    assert.equal((await call(db, INV_NONE, 'POST', '/101/summarize')).status, 404);
    assert.equal((await call(db, INV_INVITED, 'POST', '/201/summarize')).status, 404, 'another deal reads as missing');
    assert.equal((await call(db, FOUNDER, 'POST', '/101/summarize')).status, 403);
    assert.equal(calls.length, 0, 'no refused call reached the model');
  });
});

test('D6183: an unreadable model answer stores nothing; the audio routes are gone', async () => {
  const db = freshDb();
  db.prepare('UPDATE reference_checks SET notes = ? WHERE id = 101').run(NOTES);
  await withRun('not json at all', async () => {
    const r = await call(db, ADMIN, 'POST', '/101/summarize');
    assert.deepEqual([r.status, r.body.code], [503, 'summary_unreadable']);
  });
  await withRun(null, async () => {
    assert.equal((await call(db, ADMIN, 'POST', '/101/summarize')).status, 503);
  });
  const row = db.prepare('SELECT summary_json, status FROM reference_checks WHERE id = 101').get() as any;
  assert.deepEqual([row.summary_json, row.status], [null, 'scheduled']);
  for (const [m, p] of [['POST', '/101/recording'], ['GET', '/101/recording-url'], ['POST', '/101/transcribe']] as const) {
    assert.equal((await call(db, ADMIN, m, p)).status, 404, `${m} ${p} no longer exists`);
  }
  assert.equal(parseSummary('{"summary":"  ","strengths":[]}'), null);
  assert.deepEqual(parseSummary('Here: {"summary":"ok","strengths":["a",3,""],"concerns":"x"}'), { summary: 'ok', strengths: ['a'], concerns: [] });
});
