/**
 * D4210 (#4210, #3661 P2): "Ask Eadwyn to suggest a fix" for one preflight
 * finding, through D899's card tools (`routes/deck_assist.ts`). Synthetic
 * data, the mounted Worker routes and the real migrated schema; `env.AI` is a
 * stub and `fetch` throws.
 *
 *   1. sources, contrast, image and every other non-text check are refused
 *      before anything runs, on the quote and on the run;
 *   2. a fix is quoted, run as deck:shorten, charged no more than its hold,
 *      kept as one proposal, and writes nothing to the deck;
 *   3. a reply that is not shorter, adds a figure or drops one is not proposed;
 *   4. a reader is refused; out of tokens is 402;
 *   5. a bound figure is never rewritten, and the finding names the block sent.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_preflight_fix_4210.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckAssist from '../src/routes/deck_assist.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { PREFLIGHT_FIX_CHECKS, textMessage, wordingProblem } from '../src/services/decks/assist.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'deck-preflight-fix-4210-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(schema); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-4210-only-not-a-real-credential'.repeat(2);
const PAGE = 'Founder · Raise · Pitch deck';

// The version the editor opened: card 0 has a heading, a paragraph and a metric tile bound to paying accounts.
const BOUND = { source_key: 'grow.paying_customers', record_ref: 'project_metrics:1', as_of: '2026-10-10', grade: 'Stated', snapshot_hash: 'a'.repeat(24) };
const SLIDES = [{
  title: 'Traction', layout: 'metric_tiles',
  blocks: [
    { id: 'h1', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: 'Customers on record' },
    { id: 'p1', kind: 'text', grid: { c1: 1, c2: 12, r1: 5, r2: 6 }, style: 'paragraph', text: 'Small finance teams close their books faster with us.' },
    { id: 'm1', kind: 'metric', grid: { c1: 1, c2: 3, r1: 2, r2: 4 }, label: 'Paying customers', value: '42', binding: BOUND },
  ],
}];

async function fixture(answer: (prompt: string) => string = () => 'Finance teams close their books faster.') {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[1, 'admin', null], [2, 'founder', 100], [3, 'founder', 300], [6, 'investor', null]] as const) {
    insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  db.exec("INSERT INTO project_metrics(id,project_id,snapshot_date,source,paying_accounts) VALUES (1,1,'2026-10-10','manual',42)");
  db.exec(`INSERT INTO discovery_interviews(id,project_id,interviewee_name,stage,icp_fit,done_at) VALUES (1,1,'Synthetic A','done','strong','2026-10-01'),(2,1,'Synthetic B','done','weak','2026-10-02')`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (7, 1, 3, ?, 1)').run(JSON.stringify(SLIDES));
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const calls: Array<{ model: string; prompt: string; system: string }> = [];
  const AI = withGuard({
    run: async (model: string, input: any) => {
      const msgs = input?.messages || [];
      const prompt = msgs.filter((m: any) => m.role === 'user').map((m: any) => String(m.content || '')).join('\n');
      const system = msgs.filter((m: any) => m.role === 'system').map((m: any) => String(m.content || '')).join('\n');
      calls.push({ model, prompt, system });
      return { response: answer(prompt), usage: { prompt_tokens: 60, completion_tokens: 40 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckAssist).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT user_id, rail_option, charged_microusd, reservation_uid FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const proposals = () => db.prepare('SELECT user_id, rail_option, record_ref, kind, status, payload_json FROM ai_rail_proposals ORDER BY id').all() as any[];
  const audits = () => (db.prepare("SELECT action FROM activity_logs WHERE entity_type = 'raise.pitch-deck' ORDER BY id").all() as any[]).map((r) => r.action);
  return { db, env, app, calls, runs, proposals, audits, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, path: string, json: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const ASSIST = '/api/decks/7/cards/0/assist';
const QUOTE = `${ASSIST}/quote`;
const P1 = { id: 'p1', kind: 'text' };
const TEXT = 'Small finance teams close their books faster with us.';
const aiOff = (f: F, user = 2) => f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES(?,?,?,'','manual')").run(`off-${user}`, user, PAGE.toLowerCase());

const SHORT = 'Small teams close books faster.';
const fixOf = (check: string, extra: Record<string, unknown> = {}) => ({ tool: 'preflight_fix', finding: { check, block: 'p1', title: 'Card 1, block p1: likely too much text for its range.' }, block: P1, text: TEXT, ...extra });

test('D4210 1: only text checks may be fixed; sources, contrast, image and the rest are refused before anything runs', async () => {
  const f = await fixture(() => SHORT);
  try {
    assert.deepEqual([...PREFLIGHT_FIX_CHECKS], ['overflow', 'density', 'font', 'placeholder']);
    for (const check of ['sources', 'contrast', 'image', 'layout', 'alt', 'theme', '', 'shorten']) {
      for (const path of [QUOTE, ASSIST]) {
        const r = await call(f, 2, path, fixOf(check));
        assert.equal(r.status, 422, `${check} on ${path}: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.error, 'fix_not_offered');
        assert.match(r.body.message, /Nothing was run\.$/);
      }
    }
    const none = await call(f, 2, ASSIST, { tool: 'preflight_fix', block: P1, text: TEXT });
    assert.equal(none.status, 422, 'a fix with no finding is refused');
    assert.equal((await call(f, 2, ASSIST, { tool: 'paint', finding: { check: 'density', block: 'p1' }, block: P1, text: TEXT })).status, 400);
    assert.deepEqual(f.runs(), [], 'nothing ran, nothing was charged');
    assert.deepEqual(f.proposals(), []);
  } finally { f.close(); }
});

test('D4210 2: a fix is quoted, runs as deck:shorten, is charged no more than its hold, and writes nothing to the deck', async () => {
  const f = await fixture(() => SHORT);
  try {
    for (const check of PREFLIGHT_FIX_CHECKS) {
      const q = await call(f, 2, QUOTE, fixOf(check));
      assert.equal(q.status, 200, `${check}: ${JSON.stringify(q.body)}`);
      assert.deepEqual([q.body.action, q.body.option, q.body.ai], ['preflight_fix', 'deck:shorten', true]);
      assert.ok(q.body.hold_microusd > 0, 'the hold is shown before it runs');
      const before = f.runs().length;
      const r = await call(f, 2, ASSIST, fixOf(check));
      assert.equal(r.status, 200, `${check}: ${JSON.stringify(r.body)}`);
      assert.deepEqual([r.body.before, r.body.after], [TEXT, SHORT]);
      const run = f.runs()[before];
      assert.deepEqual([run.user_id, run.rail_option], [2, 'deck:shorten']);
      assert.ok(run.charged_microusd > 0 && run.charged_microusd <= q.body.hold_microusd, `${check}: charged ${run.charged_microusd} of ${q.body.hold_microusd} held`);
      assert.equal(r.body.cost.charged_microusd, run.charged_microusd);
    }
    const props = f.proposals();
    assert.equal(props.length, 4);
    assert.deepEqual(JSON.parse(props[0].payload_json), { deck_id: 7, card: 0, card_uid: 'c1', action: 'preflight_fix', finding: { check: 'overflow', block: 'p1' }, before: TEXT, after: SHORT });
    assert.ok(props.every((p) => p.status === 'proposed' && p.kind === 'proposal'), 'a proposal, never applied by itself');
    const v = f.db.prepare('SELECT slides FROM pitch_decks WHERE project_id = 1').all() as any[];
    assert.deepEqual(v.map((x) => x.slides), [JSON.stringify(SLIDES)], 'no version is written: Accept and Save do that');
    // The prompt names the problem and reads the finding as data.
    const prompt = f.calls.find((c) => /too much text for one slide/.test(c.prompt))!.prompt;
    assert.match(prompt, /shorter text for this one block/);
    assert.match(prompt, /BEGIN_DECK_IMPORT_UNTRUSTED_[0-9a-f]{32}\nCard 1, block p1: likely too much text/);
  } finally { f.close(); }
});

test('D4210 3: a reply that is not shorter, adds a figure or drops one is not proposed', async () => {
  for (const [answer, text, why] of [
    [TEXT, TEXT, /not shorter/],
    ['Small teams close books 3x faster.', TEXT, /named a figure your text did not/],
    ['Teams close books faster.', 'We serve 42 small finance teams who close their books faster.', /dropped a figure/],
  ] as const) {
    const f = await fixture(() => answer);
    try {
      const r = await call(f, 2, ASSIST, fixOf('overflow', { text }));
      assert.equal(r.status, 422, answer);
      assert.match(r.body.message, why);
      assert.match(r.body.message, /It was charged for the run\.$/);
      assert.deepEqual(f.proposals(), [], 'nothing is proposed');
    } finally { f.close(); }
  }
  assert.equal(wordingProblem('preflight_fix', 'We serve 42 teams well.', 'We serve 42 teams.'), null);
  assert.equal(wordingProblem('shorten', 'Same.', 'Same.'), null, 'only a fix must be shorter');
  assert.match(textMessage('preflight_fix', 'x', { check: 'placeholder' }).user, /do not invent what they stand for/);
});

test('D4210 4: a reader is refused, and out of tokens is 402', async () => {
  const f = await fixture(() => SHORT);
  try {
    for (const who of [1, 3, 6]) {
      for (const path of [QUOTE, ASSIST]) assert.equal((await call(f, who, path, fixOf('density'))).status, 403, `user ${who} on ${path}`);
    }
    assert.deepEqual(f.runs(), []);
  } finally { f.close(); }
  const g = await fixture(() => SHORT);
  try {
    g.db.exec('UPDATE ai_topup_accounts SET balance_microusd = 0 WHERE user_id = 2');
    const r = await call(g, 2, ASSIST, fixOf('density'));
    assert.equal(r.status, 402, JSON.stringify(r.body));
    assert.deepEqual(g.proposals(), []);
  } finally { g.close(); }
});

test('D4210 5: a bound figure is never rewritten, and the finding names the block the press sends', async () => {
  const f = await fixture(() => SHORT);
  try {
    const bound = await call(f, 2, ASSIST, { tool: 'preflight_fix', finding: { check: 'overflow', block: 'm1' }, block: { id: 'm1', kind: 'metric' }, text: '42' });
    assert.equal(bound.status, 422);
    assert.equal(bound.body.refusal, 'never_fill');
    const other = await call(f, 2, ASSIST, fixOf('density', { finding: { check: 'density', block: 'h1' } }));
    assert.equal(other.status, 400, 'a finding about another block');
    assert.deepEqual(f.runs(), []);
  } finally { f.close(); }
});
