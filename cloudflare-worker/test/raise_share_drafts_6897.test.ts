/**
 * D6897 part 3 (#6897, canvas D6054 RA-27 A and RA-30): Eadwyn's drafts for Share outside Axal.
 *
 *   · the pack draft names only items a pack may hold now: a Private item, an unknown uid, a repeated uid and a
 *     reason with an email, a link or a word the product never uses are dropped; what Eadwyn is sent holds no
 *     figure and no Private item;
 *   · no run without the quote: a missing or stale `confirm_quote` is 402 and the model is never called;
 *   · Accept writes the proposal only: a pack returns the uids still shareable (an item made Private since is
 *     dropped and counted), a covering line returns the sentence or the founder's checked edit; no link, pack,
 *     snapshot or item is written; Discard writes the proposal only;
 *   · founders only; another founder's draft is not theirs; the generic decide route cannot accept one.
 *
 * Real SQLite with the production schema; every person, venture and figure is synthetic. `env.AI` is a stub.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/raise_share_drafts_6897.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';
import cycleRaise from '../src/routes/cycle_raise.ts';
import drafts from '../src/routes/raise_share_drafts.ts';
import aiRailProposals from '../src/routes/ai_rail_proposals.ts';
import { buildCandidates, acceptItem, setSharing } from '../src/services/raiseEvidence.ts';
import { lineDraftFrom, packDraftFrom, packFacts, wordsRefused } from '../src/services/raiseShareProposals.ts';

const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db);
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map((r: any) => r.sql); db.close(); return ddl;
})();
const secret = 'd'.repeat(64); // in-memory test signing seed only

function world(answer: () => string) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); for (const sql of DDL) db.exec(sql);
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active,spinout_lab_active,kyc_status) VALUES
   (1,'Synthetic Founder','one@example.invalid','founder',100,1,0,NULL),(2,'Synthetic Cofounder','two@example.invalid','founder',100,1,0,NULL),
   (3,'Synthetic Admin','three@example.invalid','admin',NULL,1,0,NULL),(5,'Synthetic Investor','five@example.invalid','investor',NULL,1,0,'approved');
   INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES(1,'venture-one','Synthetic Venture',100,10);
   INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'company-one','Synthetic One');
   INSERT INTO user_company_links(uid,user_id,company_id) VALUES('one',1,10),('two',2,10),('three',3,10);`);
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(1,5000000),(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const sent: string[] = [];
  const AI = withGuard({
    run: async (_model: string, input: any) => {
      sent.push((input?.messages || []).filter((m: any) => m.role === 'user').map((m: any) => String(m.content || '')).join('\n'));
      return { response: answer(), usage: { prompt_tokens: 500, completion_tokens: 200 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development', AI };
  const ctx: any = { env, user: db.prepare('SELECT * FROM users WHERE id=1').get(), projectId: 1, companyId: 10, founder: true };
  const app = new Hono<any>();
  app.route('/api/cycles/raise', cycleRaise); app.route('/api/cycles/raise', drafts); app.route('/api/ai/rail/proposals', aiRailProposals);
  return { db, env, ctx, app, sent };
}
type World = ReturnType<typeof world>;

function seed(w: World, table: string, values: Record<string, unknown>) {
  if (!/^[a-z_0-9]+$/.test(table)) throw new Error('bad fixture table');
  const row = { ...values }; for (const c of w.db.prepare('PRAGMA table_info(' + table + ')').all() as any[]) if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in row)) row[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : c.name === 'uid' ? table + '-' + String(values.id ?? 'one') : 'synthetic';
  const keys = Object.keys(row); for (const k of keys) if (!/^[a-z_0-9]+$/.test(k)) throw new Error('bad fixture column');
  w.db.prepare('INSERT INTO ' + table + '(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')').run(...keys.map(k => row[k] as any));
}
const proposalOf = (w: World, kind: string, area?: string) => w.db.prepare(`SELECT uid,payload_json FROM ai_rail_proposals WHERE status='proposed' AND json_extract(payload_json,'$.kind')=? AND (? IS NULL OR json_extract(payload_json,'$.area')=?) LIMIT 1`).get(kind, area ?? null, area ?? null) as any;
async function share(w: World, kind: string, visibility: 'private' | 'summary' | 'after_nda', area?: string) {
  const q = proposalOf(w, kind, area); assert.ok(q, 'candidate ' + kind);
  let item: any = await acceptItem(w.ctx, q.uid, JSON.parse(q.payload_json).snapshot_hash);
  if (item.visibility !== visibility) item = await setSharing(w.ctx, item.uid, { version: item.version, visibility });
  return item;
}
/** Two shareable items, one kept Private. The figures are ones no draft may ever carry. */
async function evidence(w: World) {
  seed(w, 'project_metrics', { id: 1, project_id: 1, snapshot_date: '2026-09-10', source: 'manual', mrr: 4200, cash_balance: 987654321 });
  seed(w, 'discovery_interviews', { id: 1, project_id: 1, interviewee_name: 'PRIVATE INTERVIEWEE', interview_date: '2026-09-07', pains_json: '[]', quote_consent: 1, notes: 'PRIVATE QUOTE', icp_fit: 'strong' });
  await buildCandidates(w.ctx);
  const kpi = await share(w, 'kpi-snapshot', 'after_nda', 'Investor narrative and Pitch deck');
  const icp = await share(w, 'icp-fit', 'summary');
  const kept = await share(w, 'kpi-snapshot', 'private', 'Capital model');
  return { kpi, icp, kept };
}
async function call(w: World, who: number, method: string, tail: string, body?: unknown, base = '/api/cycles/raise') {
  const auth = { Authorization: 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret)) };
  const url = base + tail + (base === '/api/cycles/raise' ? (tail.includes('?') ? '&' : '?') + 'project=1' : '');
  const r = await w.app.request(url, { method, headers: { 'Content-Type': 'application/json', 'X-Company-Id': '10', ...auth }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, w.env);
  const text = await r.text(); let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}
async function ask(w: World, who: number, ask: Record<string, unknown>) {
  const q = await call(w, who, 'POST', '/share-drafts/quote', ask);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const r = await call(w, who, 'POST', '/share-drafts/run', { ...ask, confirm_quote: q.body.quote.confirm_quote });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
/** Every record a draft could reach, without timestamps: links, copies, items and their sharing. */
const records = (w: World) => JSON.stringify({
  links: w.db.prepare('SELECT * FROM raise_evidence_share_links').all(),
  items: w.db.prepare('SELECT uid, visibility, state, version FROM raise_evidence_items ORDER BY uid').all(),
});
const AUDIENCE = { kind: 'pack', audience: '[Seed fund] partner: traction and use of funds' };

test('the pack draft keeps only items a pack may hold now, each once, with plain reasons; Eadwyn never sees a figure or a Private item', async () => {
  let answer = '';
  const w = world(() => answer);
  try {
    const { kpi, icp, kept } = await evidence(w);
    const facts = await packFacts(w.env, 1, 'x');
    assert.ok(facts);
    const uids = facts!.items.map((i) => i.uid).sort();
    // Mutation checked: read the pack with Private items included → kept.uid is offered and this fails.
    assert.deepEqual(uids, [kpi.uid, icp.uid].sort());
    const draft = packDraftFrom(JSON.stringify({
      items: [
        { uid: kpi.uid, reason: 'Traction is what this reader asks about first.' },
        { uid: kpi.uid, reason: 'A second time.' },
        { uid: kept.uid, reason: 'Private items never go in a pack.' },
        { uid: 'invented', reason: 'No such item.' },
        { uid: icp.uid, reason: 'Write to ops@example.invalid for more.' },
      ],
      left_out: 'The cap table, which is not traction.',
    }), facts!);
    assert.deepEqual(draft?.items.map((i) => i.uid), [kpi.uid]);
    assert.equal(draft?.left_out, 'The cap table, which is not traction.');
    assert.equal(packDraftFrom('{"items":[]}', facts!), null, 'nothing left is no draft');
    assert.equal(packDraftFrom('not json', facts!), null);
    for (const bad of ['see https://example.invalid', 'our advisor says', 'a@b.co']) assert.ok(wordsRefused(bad), bad);

    answer = JSON.stringify({ items: [{ uid: icp.uid, reason: 'Who the customer is.' }, { uid: kpi.uid, reason: 'Traction.' }], left_out: 'Nothing else serves this reader.' });
    const before = records(w);
    const r = await ask(w, 1, AUDIENCE);
    assert.equal(r.draft.kind, 'pack');
    assert.equal(r.draft.status, 'proposed');
    assert.equal(r.draft.audience, AUDIENCE.audience);
    assert.deepEqual(r.draft.items.map((i: any) => i.uid), [icp.uid, kpi.uid]);
    assert.equal(records(w), before, 'asking wrote no link, pack or item');
    // What left Axal: no figure, no Private item, nothing from the private fields.
    assert.equal(w.sent.length >= 1, true);
    const out = w.sent.join('\n');
    assert.doesNotMatch(out, /987654321|4200|PRIVATE|value_num/);
    assert.doesNotMatch(out, new RegExp(kept.uid));
    assert.match(out, new RegExp(kpi.uid));
  } finally { w.db.close(); }
});

test('no run without the quote; a refusal names its reason and the model is never called', async () => {
  const w = world(() => '{"line":"Here is where we stand."}');
  try {
    await evidence(w);
    const before = w.sent.length;
    for (const confirm of [undefined, 'stale']) {
      const r = await call(w, 1, 'POST', '/share-drafts/run', { kind: 'covering-line', ...(confirm ? { confirm_quote: confirm } : {}) });
      assert.equal(r.status, 402); assert.equal(r.body.error, 'quote_required');
      assert.ok(r.body.quote?.confirm_quote, 'the refusal carries the quote to confirm');
    }
    // A quote for one audience does not run another.
    const q = await call(w, 1, 'POST', '/share-drafts/quote', AUDIENCE);
    const other = await call(w, 1, 'POST', '/share-drafts/run', { ...AUDIENCE, audience: 'Someone else', confirm_quote: q.body.quote.confirm_quote });
    assert.equal(other.status, 402);
    assert.equal(w.sent.length, before, 'the model was never called');
    assert.equal((await call(w, 1, 'POST', '/share-drafts/quote', { kind: 'memo' })).body.error, 'invalid');
    assert.equal((await call(w, 1, 'POST', '/share-drafts/quote', { kind: 'pack', audience: '' })).body.error, 'invalid_audience');
    assert.equal((await call(w, 1, 'POST', '/share-drafts/quote', { kind: 'pack', audience: 'mail me@example.invalid' })).body.error, 'invalid_audience');
  } finally { w.db.close(); }
});

test('a pack with nothing shared beyond Private is refused before any quote', async () => {
  const w = world(() => '{}');
  try {
    const r = await call(w, 1, 'POST', '/share-drafts/quote', AUDIENCE);
    assert.equal(r.status, 409); assert.equal(r.body.error, 'empty');
  } finally { w.db.close(); }
});

test('Accept on a pack returns the uids still shareable and writes nothing else; an item made Private since is dropped and counted', async () => {
  let answer = '';
  const w = world(() => answer);
  try {
    const { kpi, icp } = await evidence(w);
    answer = JSON.stringify({ items: [{ uid: kpi.uid, reason: 'Traction.' }, { uid: icp.uid, reason: 'Who buys.' }] });
    const { draft } = await ask(w, 1, AUDIENCE);
    // The founder makes one of them Private after Eadwyn proposed it.
    const now: any = w.db.prepare('SELECT version FROM raise_evidence_items WHERE uid=?').get(icp.uid);
    await setSharing(w.ctx, icp.uid, { version: now.version, visibility: 'private' });
    const before = records(w);
    const r = await call(w, 1, 'POST', `/share-drafts/${draft.uid}/accept`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // Mutation checked: return the proposal's uids unfiltered → icp.uid is ticked and this fails.
    assert.deepEqual(r.body.tick, [kpi.uid]);
    assert.equal(r.body.dropped, 1);
    assert.equal(r.body.draft.status, 'accepted');
    assert.equal(records(w), before, 'accepting ticks rows only: no link, pack or sharing change');
    const row: any = w.db.prepare('SELECT status, decided_by_user_id FROM ai_rail_proposals WHERE uid=?').get(draft.uid);
    assert.equal(row.status, 'accepted'); assert.equal(row.decided_by_user_id, 1);
    // Once only.
    assert.equal((await call(w, 1, 'POST', `/share-drafts/${draft.uid}/accept`, {})).body.error, 'not_open');
    assert.equal((await call(w, 1, 'POST', `/share-drafts/${draft.uid}/accept`, { line: 'x' })).status, 409);
  } finally { w.db.close(); }
});

test('the covering line is one checked sentence; Accept keeps it or the founder’s edit, which must pass the same check', async () => {
  let answer = '{"line":"Here is where our seed preparation stands this week; the data room is next."}';
  const w = world(() => answer);
  try {
    assert.deepEqual(lineDraftFrom('{"line":"One sentence."}'), { line: 'One sentence.' });
    assert.equal(lineDraftFrom('{"line":"' + 'x'.repeat(201) + '"}'), null);
    assert.equal(lineDraftFrom('{"line":"Ask our advisor."}'), null);
    assert.equal(lineDraftFrom('{"line":""}'), null);

    const first = await ask(w, 1, { kind: 'covering-line' });
    assert.equal(first.draft.line, 'Here is where our seed preparation stands this week; the data room is next.');
    const kept = await call(w, 1, 'POST', `/share-drafts/${first.draft.uid}/accept`, {});
    assert.equal(kept.body.line, first.draft.line); assert.equal(kept.body.draft.status, 'accepted');

    answer = '{"line":"Data room is the gap; it is next."}';
    const second = await ask(w, 1, { kind: 'covering-line' });
    for (const bad of ['x'.repeat(201), 'line one\nline two', 'Write to me@example.invalid']) {
      const r = await call(w, 1, 'POST', `/share-drafts/${second.draft.uid}/accept`, { line: bad });
      assert.equal(r.status, 400, bad); assert.equal(r.body.error, 'invalid_line');
    }
    const edited = await call(w, 1, 'POST', `/share-drafts/${second.draft.uid}/accept`, { line: '  The data room is our gap,   and it is next. ' });
    assert.equal(edited.body.line, 'The data room is our gap, and it is next.');
    assert.equal(edited.body.draft.status, 'edited');
    const listed = await call(w, 1, 'GET', '/share-drafts');
    assert.equal(listed.body.drafts.find((d: any) => d.kind === 'covering-line').line, 'The data room is our gap, and it is next.');
  } finally { w.db.close(); }
});

test('a new draft withdraws the open one of its kind; Discard writes the proposal only', async () => {
  const w = world(() => '{"line":"Here is where we stand."}');
  try {
    const a = await ask(w, 1, { kind: 'covering-line' });
    const b = await ask(w, 1, { kind: 'covering-line' });
    assert.equal((w.db.prepare('SELECT status FROM ai_rail_proposals WHERE uid=?').get(a.draft.uid) as any).status, 'withdrawn');
    const before = records(w);
    const d = await call(w, 1, 'POST', `/share-drafts/${b.draft.uid}/discard`);
    assert.equal(d.status, 200); assert.equal(d.body.draft.status, 'discarded');
    assert.equal(records(w), before);
    assert.deepEqual((await call(w, 1, 'GET', '/share-drafts')).body.drafts, [], 'a discarded draft is not listed');
  } finally { w.db.close(); }
});

test('founders only; another founder’s draft is not theirs; the generic decide route cannot keep one', async () => {
  const w = world(() => '{"line":"Here is where we stand."}');
  try {
    const { draft } = await ask(w, 1, { kind: 'covering-line' });
    for (const who of [3, 5]) {
      const r = await call(w, who, 'POST', '/share-drafts/quote', { kind: 'covering-line' });
      assert.ok([403, 404].includes(r.status), `user ${who}: ${r.status}`);
      const a = await call(w, who, 'POST', `/share-drafts/${draft.uid}/accept`, {});
      assert.ok([403, 404].includes(a.status), `user ${who} accept: ${a.status}`);
    }
    const other = await call(w, 2, 'POST', `/share-drafts/${draft.uid}/accept`, {});
    assert.equal(other.status, 409); assert.equal(other.body.error, 'not_open');
    const generic = await call(w, 1, 'POST', `/${draft.uid}/decide`, { decision: 'accept' }, '/api/ai/rail/proposals');
    assert.notEqual(generic.status, 200);
    assert.equal((w.db.prepare('SELECT status FROM ai_rail_proposals WHERE uid=?').get(draft.uid) as any).status, 'proposed');
  } finally { w.db.close(); }
});
