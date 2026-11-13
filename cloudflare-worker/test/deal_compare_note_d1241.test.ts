/**
 * D1241 (#3254, part 5 of #2423) — Compare's Eadwyn note: drafted from
 * SCORING's bands only, never a value; nothing saved until Save to notes;
 * a deal the investor may not read refuses the draft. The model runner and
 * the stored scorecard are stubs: no test reaches a provider. Every firm,
 * person and venture is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_compare_note_d1241.test.ts
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import routes, { noteDeps } from '../src/routes/deal_flow.ts';
import { noteMaterial, parseNote, parseIds } from '../src/services/dealCompareNote.ts';
import { AI_SURFACE } from '../src/services/aiSurfaces.ts';

const SECRET = 'fixture-only-d1241-0123456789abcdef0123';
test.after(() => removeMigratedDatabases());
const saved = { ...noteDeps };
afterEach(() => { Object.assign(noteDeps, saved); });

// Scores carry a value (78, 41) the stub plants on purpose: it must never reach the prompt or the note.
const CARDS: Record<number, any[]> = {
  11: [{ scope: 'team', state: 'scored', value: 78, band: 'strong', confidence_word: 'High' }, { scope: 'market', state: 'scored', value: 41, band: 'weak', confidence_word: 'Low' }],
  12: [{ scope: 'team', state: 'scored', value: 55, band: 'fair', confidence_word: 'Medium' }, { scope: 'market', state: 'not_enough' }],
  13: [{ scope: 'team', state: 'not_read' }],
};

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,kyc_status,is_active) VALUES (1,'Ivy','ivy@example.test','investor','approved',1),(2,'Oona','oona@example.test','investor','approved',1),(3,'Fay','fay@example.test','founder','approved',1);
    INSERT INTO projects(id,uid,name,sector,stage) VALUES (11,'acme','Acme Robotics','Robotics','seed'),(12,'blue','Bluefern Health','Health','seed'),(13,'cob','Cobalt','Climate','seed'),(14,'priv','Private Co','AI','seed');
    INSERT INTO deals(id,project_id,status) VALUES (101,11,'active'),(102,12,'active'),(103,13,'active'),(104,14,'active');
    INSERT INTO deal_invitations(deal_id,investor_user_id,status) VALUES (101,1,'invited'),(102,1,'invited'),(103,1,'invited');
    INSERT INTO venture_score_sharing(project_id,audience,user_id,enabled) VALUES (13,'investors',0,0);`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, SCORING_HMAC_SECRET: SECRET, ENVIRONMENT: 'development' };
  const runs: any[] = [];
  let reply: any = { ok: true, output: JSON.stringify({ text: 'Acme Robotics has the stronger band on Team; Bluefern Health has no Market score yet. Acme Robotics’s Market score has low confidence.' }), usage: { est_cost_usd: 0.0002 } };
  noteDeps.run = (async (_e: any, opts: any) => { runs.push(opts); return typeof reply === 'function' ? reply(opts) : reply; }) as any;
  noteDeps.scorecard = (async (_e: any, projectId: number) => CARDS[projectId] ?? []) as any;
  const app = new Hono<any>(); app.route('/api/deals/flow', routes);
  app.onError((e, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request('/api/deals/flow' + path, { method, headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const count = (t: string, w = '1=1') => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${w}`).get() as any).n);
  return { db, env, runs, call, count, set: (r: any) => { reply = r; } };
}

test('a draft is made from bands and confidence words only, on its surface; nothing is saved until Save to notes', async () => {
  const f = fixture();
  const d = await f.call(1, 'POST', '/compare-note', { deal_ids: [101, 102, 103] });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.match(d.body.note.text, /stronger band on Team/);
  assert.deepEqual(d.body.note.ventures, [{ deal_id: 101, name: 'Acme Robotics', locked: false }, { deal_id: 102, name: 'Bluefern Health', locked: false }, { deal_id: 103, name: 'Cobalt', locked: true }]);
  assert.equal(f.runs.length, 1);
  assert.equal(f.runs[0].surface, AI_SURFACE.dealsCompare);
  assert.equal(f.runs[0].surface, '/deals/compare');
  const material = JSON.parse(f.runs[0].text.split('\n').at(-1));
  assert.deepEqual(material[0].scopes, [{ label: 'Team', state: 'scored', band: 'strong', confidence: 'High' }, { label: 'Market', state: 'scored', band: 'weak', confidence: 'Low' }]);
  assert.deepEqual(material[2], { ref: 'v3', name: 'Cobalt', locked: true, scopes: [] }, 'a venture that has not shared its scores carries none');
  assert.doesNotMatch(f.runs[0].text, /\b(78|41|55)\b/, 'a score’s value never reaches the prompt');
  assert.match(f.runs[0].text, /Never recommend, advise/);
  assert.equal(f.count('research_zone_drafts'), 0, 'a draft writes nothing');
  assert.equal(f.count('activity_logs', "action = 'eadwyn_compare_note_saved'"), 0);

  const k = await f.call(1, 'POST', '/compare-note/keep', { receipt: d.body.receipt });
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(k.body.saved.text, d.body.note.text);
  const row = f.db.prepare('SELECT owner_user_id, surface, scope_key, cost_micro_usd, accepted_at IS NOT NULL AS kept FROM research_zone_drafts').get() as any;
  assert.deepEqual({ ...row }, { owner_user_id: 1, surface: 'deals/compare-note', scope_key: 'deals:101,102,103', cost_micro_usd: 200, kept: 1 });
  assert.equal((await f.call(1, 'POST', '/compare-note/keep', { receipt: d.body.receipt })).status, 200, 'saving twice is one row');
  assert.equal(f.count('research_zone_drafts'), 1);
  const logs = f.db.prepare("SELECT user_id, entity_type, details FROM activity_logs WHERE action = 'eadwyn_compare_note_saved'").all() as any[];
  assert.deepEqual(logs.map((l) => ({ ...l })), [{ user_id: 1, entity_type: 'deals.compare', details: '{"deals":3}' }], 'ids and a count, never the note');

  const read = await f.call(1, 'GET', '/compare-note?ids=103,101,102');
  assert.deepEqual(read.body.items.map((n: any) => n.text), [d.body.note.text], 'the same set, in any order');
  assert.deepEqual((await f.call(1, 'GET', '/compare-note?ids=101,102')).body.items, [], 'another set has its own notes');
  assert.deepEqual((await f.call(2, 'GET', '/compare-note?ids=101,102,103')).body, { items: [], unreadable: 0 }, 'another investor reads none, and none is counted against them');
});

test('refusals: two to four ventures; a deal not shared refuses the whole draft; a founder; too few scores; a forged or stale receipt', async () => {
  const f = fixture();
  assert.equal((await f.call(1, 'POST', '/compare-note', { deal_ids: [101] })).body.code, 'bad_compare');
  assert.equal((await f.call(1, 'POST', '/compare-note', { deal_ids: [101, 102, 103, 104, 105] })).body.code, 'bad_compare');
  const priv = await f.call(1, 'POST', '/compare-note', { deal_ids: [101, 104] });
  assert.deepEqual([priv.status, priv.body.code], [404, 'not_shared']);
  assert.equal((await f.call(3, 'POST', '/compare-note', { deal_ids: [101, 102] })).status, 403);
  const few = await f.call(1, 'POST', '/compare-note', { deal_ids: [101, 103] });
  assert.deepEqual([few.status, few.body.code], [409, 'scores_not_recorded']);
  assert.equal(f.runs.length, 0, 'no run for any refusal');

  const d = await f.call(1, 'POST', '/compare-note', { deal_ids: [101, 102] });
  const forged = { ...d.body.receipt, payload: d.body.receipt.payload.replace('stronger', 'weaker') };
  assert.equal((await f.call(1, 'POST', '/compare-note/keep', { receipt: forged })).body.code, 'invalid_note');
  assert.equal((await f.call(2, 'POST', '/compare-note/keep', { receipt: d.body.receipt })).body.code, 'note_expired', 'another investor cannot save it');
  const realNow = Date.now;
  Date.now = () => realNow() + 16 * 60 * 1000;
  try { assert.equal((await f.call(1, 'POST', '/compare-note/keep', { receipt: d.body.receipt })).body.code, 'note_expired', 'a draft older than 15 minutes is drafted again'); }
  finally { Date.now = realNow; }
  assert.equal(f.count('research_zone_drafts'), 0);
});

test('the material carries a scope\'s state, band and confidence, never its value', async () => {
  const f = fixture();
  const m = await noteMaterial(f.env, { id: 1, role: 'investor' } as any, [101, 103], noteDeps.scorecard);
  assert.deepEqual(m[0].scopes[0], { scope: 'team', label: 'Team', state: 'scored', band: 'strong', confidence: 'High' });
  assert.deepEqual(Object.keys(m[1]), ['ref', 'deal_id', 'name', 'locked', 'scopes']);
});

test('a draft that names a value or gives advice is not shown; a refused run answers in its own words', async () => {
  const f = fixture();
  f.set({ ok: true, output: JSON.stringify({ text: 'Acme Robotics scores 78 on Team.' }), usage: { est_cost_usd: 0.0001 } });
  const n = await f.call(1, 'POST', '/compare-note', { deal_ids: [101, 102] });
  assert.deepEqual([n.status, n.body.code], [503, 'note_ungrounded']);
  assert.doesNotMatch(JSON.stringify(n.body), /78/);
  f.set({ ok: false, refusal: 'budget_user_month', error: 'private-provider-detail' });
  const b = await f.call(1, 'POST', '/compare-note', { deal_ids: [101, 102] });
  assert.equal(b.status, 402);
  assert.doesNotMatch(JSON.stringify(b.body), /private-provider-detail/);
  f.set({ ok: false, error: 'private-provider-detail' });
  const u = await f.call(1, 'POST', '/compare-note', { deal_ids: [101, 102] });
  assert.deepEqual([u.status, u.body.code], [503, 'note_unreadable']);
  assert.doesNotMatch(JSON.stringify(u.body), /private-provider-detail/);
});

test('the note check: counts of scopes pass; a score, a percentage, a decimal or advice fails', () => {
  assert.equal(parseNote('{"text":"Acme is stronger on 6 of 11 scopes."}'), 'Acme is stronger on 6 of 11 scopes.');
  assert.equal(parseNote('```json\n{"text":"Both have low confidence on Market."}\n```'), 'Both have low confidence on Market.');
  for (const bad of ['{"text":"Acme is at 12 on Team."}', '{"text":"Acme is 5% ahead."}', '{"text":"Acme scores 6.5."}', '{"text":"You should invest in Acme."}',
    '{"text":"We recommend Bluefern."}', '{"text":""}', 'not json', '{"note":"x"}', JSON.stringify({ text: 'a'.repeat(1501) })]) assert.equal(parseNote(bad), null, bad);
  assert.deepEqual(parseIds('101,102'), [101, 102]);
  assert.deepEqual(parseIds([5, '5', 6]), [5, 6], 'duplicates count once');
  assert.throws(() => parseIds('101,x'));
});
