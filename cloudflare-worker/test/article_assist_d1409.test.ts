/**
 * D1409 (#3695, part 1): Eadwyn's writing options in the article editor.
 * Synthetic data, the mounted Worker routes and the real migrated schema;
 * `env.AI` is a stub and `fetch` throws.
 *
 *   · each of the eight options is quoted before it runs, runs once through
 *     `run()` with its rail context, is charged to the member who pressed, and
 *     leaves exactly one ai_rail_proposals row of its kind;
 *   · nothing writes the article, not the run and not Accept;
 *   · the gate: the author or an admin; a published article and a support
 *     session are refused; out of tokens is 402, AI off and a pause are 403.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/article_assist_d1409.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import articleAssist from '../src/routes/article_assist.ts';
import articles from '../src/routes/articles.ts';
import railProposals from '../src/routes/ai_rail_proposals.ts';
import { __resetForTest, quoteRun } from '../src/services/aiRouter.ts';
import { AI_SURFACE } from '../src/services/aiSurfaces.ts';
import {
  ARTICLE_OPTIONS, ARTICLE_OPTION_KEYS, articlePage, articleTextOf, cleanText, guardTextOf, inputOf, messageOf, payloadOf,
} from '../src/services/articleAssist.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'article-assist-d1409-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1409-only-not-a-real-credential'.repeat(2);
const BODY = 'Small finance teams close their books faster when the ledger is shared.';

/** The stub model answers by what the press asked for. */
function answerFor(prompt: string): string {
  if (/JSON array of strings/.test(prompt)) return JSON.stringify(['Close the books faster', 'Shared ledgers, shorter months']);
  if (/"seo_title"/.test(prompt)) return '```json\n{"seo_title": "Close your books faster", "excerpt": "How a shared ledger shortens the month-end close."}\n```';
  if (/"claims"/.test(prompt)) return JSON.stringify({ claims: [{ quote: 'close their books faster', why: 'a measured comparison' }] });
  return 'Here is the draft:\nShared ledgers cut the back-and-forth.';
}

async function fixture(answer: (prompt: string) => string = answerFor) {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role] of [[1, 'admin'], [2, 'founder'], [3, 'founder'], [4, 'investor']] as const) {
    insert.run(id, role, null, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  }
  const art = db.prepare("INSERT INTO articles(id, slug, title, subtitle, body_markdown, status, author_user_id, excerpt, seo_title) VALUES (?, ?, 'Closing faster', 'A note on ledgers', ?, ?, ?, 'Old excerpt', 'Old title')");
  art.run(5, 'closing-faster', BODY, 'draft', 2);
  art.run(6, 'closing-faster-2', BODY, 'published', 2);
  art.run(7, 'investor-note', BODY, 'draft', 4);
  for (const id of [1, 2, 4]) db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,5000000)').run(id);
  for (const key of ['founder:free', 'founder:studio', 'admin:studio', 'investor:studio', 'investor:free']) {
    db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  }
  const calls: Array<{ model: string; prompt: string }> = [];
  const AI = withGuard({
    run: async (model: string, input: any) => {
      const prompt = (input?.messages || []).filter((m: any) => m.role === 'user').map((m: any) => String(m.content || '')).join('\n');
      calls.push({ model, prompt });
      return { response: answer(prompt), usage: { prompt_tokens: 60, completion_tokens: 40 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  const app = new Hono<any>().route('/api/articles', articleAssist).route('/api/articles', articles).route('/api/ai/rail/proposals', railProposals);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT id, user_id, rail_page, rail_option, record_ref, surface, charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const proposals = () => db.prepare('SELECT uid, user_id, rail_page, rail_option, record_ref, kind, status, payload_json, usage_log_id FROM ai_rail_proposals ORDER BY id').all() as any[];
  const article = (id = 5) => db.prepare('SELECT title, subtitle, body_markdown, excerpt, seo_title, status FROM articles WHERE id = ?').get(id) as any;
  return { db, env, app, calls, runs, proposals, article, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, path: string, json: unknown, claims: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: who, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const ASSIST = '/api/articles/5/assist';
const QUOTE = `${ASSIST}/quote`;

/** A valid input for each option. */
const INPUT: Record<string, Record<string, string>> = {
  'draft:article-outline': { brief: 'Why shared ledgers help small finance teams' },
  'draft:article-section': { heading: 'What changes at month end' },
  'rewrite:article': { selection: BODY, tone: 'plainer' },
  'draft:article-continue': { cursor_context: BODY },
  'draft:article-headlines': {},
  'draft:article-seo': {},
  'draft:article-newsletter': {},
  'check:article-facts': {},
};
const aiOff = (f: F, user = 2, page = 'Founder · Articles') => f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES(?,?,?,'','manual')").run(`off-${user}`, user, page.toLowerCase());

// ─────────────────────────────────────────────────────────── pure

test('eight options, each with its proposal kind; the page is the member\'s profile · Articles', () => {
  assert.deepEqual([...ARTICLE_OPTION_KEYS], Object.keys(INPUT));
  assert.deepEqual(Object.fromEntries(ARTICLE_OPTION_KEYS.map((k) => [k, ARTICLE_OPTIONS[k].kind])), {
    'draft:article-outline': 'draft', 'draft:article-section': 'draft', 'rewrite:article': 'proposal', 'draft:article-continue': 'draft',
    'draft:article-headlines': 'proposal', 'draft:article-seo': 'proposal', 'draft:article-newsletter': 'draft', 'check:article-facts': 'note',
  });
  assert.equal(articlePage('founder'), 'Founder · Articles');
  assert.equal(articlePage('partner'), 'Operating Partner · Articles');
  assert.equal(articlePage('super_admin'), 'Super Admin · Articles');
  assert.equal(articlePage('nobody'), 'Member · Articles');
});

test('inputs are checked by field; the guard reads only what the member typed', () => {
  assert.deepEqual(inputOf('draft:article-outline', {}), { field: 'brief', error: 'brief required' });
  assert.deepEqual(inputOf('draft:article-outline', { brief: 'x'.repeat(1001) }), { field: 'brief', error: 'brief is at most 1000 characters' });
  assert.deepEqual(inputOf('rewrite:article', { selection: 'x', tone: 'sarcastic' }), { field: 'tone', error: 'tone must be one of shorter, plainer, formal' });
  assert.deepEqual(inputOf('draft:article-section', { heading: 'H' }), { input: { heading: 'H' } });
  assert.deepEqual(inputOf('draft:article-seo', { brief: 'ignored' }), { input: {} });
  assert.equal(guardTextOf({ heading: 'H', brief: 'B' }), 'B\n\nH');
  assert.equal(guardTextOf({}), '');
  assert.equal(articleTextOf({ title: 'T', subtitle: 'S', body_markdown: 'x'.repeat(20_000) }).length, 12_000);
});

test('an answer that parses to nothing proposes nothing; text is cleaned and capped', () => {
  assert.equal(payloadOf('draft:article-headlines', 'no json here', {}), null);
  assert.equal(payloadOf('draft:article-seo', '{}', {}), null);
  assert.equal(payloadOf('check:article-facts', '{"claims": []}', {}), null);
  assert.equal(payloadOf('draft:article-outline', '   ', {}), null);
  assert.equal(cleanText('```markdown\nHello\n```', 100), 'Hello');
  assert.equal(cleanText('"Quoted."', 100), 'Quoted.');
  assert.deepEqual(payloadOf('draft:article-headlines', JSON.stringify(['a', 'a', 'b', 'c', 'd', 'e', 'f']), {}), { headlines: ['a', 'b', 'c', 'd', 'e'] });
  assert.deepEqual(payloadOf('draft:article-seo', JSON.stringify({ seo_title: 't'.repeat(200), excerpt: 'e' }), {})!.seo_title, 't'.repeat(120));
  assert.deepEqual(payloadOf('check:article-facts', JSON.stringify({ claims: [{ quote: 'q', why: 'w' }, { why: 'no quote' }] }), {}), { claims: [{ quote: 'q', why: 'w', needs_source: true }] });
});

// ─────────────────────────────────────────────────────────── routes

test('each option: quoted at quoteRun\'s hold, then one run with its rail context, charged, and one proposal of its kind', async () => {
  const f = await fixture();
  try {
    for (const option of ARTICLE_OPTION_KEYS) {
      const q = await call(f, 2, QUOTE, { option, input: INPUT[option] });
      assert.equal(q.status, 200, `${option} quote: ${JSON.stringify(q.body)}`);
      assert.deepEqual([q.body.option, q.body.ai], [option, true]);
      assert.ok(q.body.hold_microusd > 0, `${option}: the cost is shown before it runs`);
      const before = f.runs().length;
      const r = await call(f, 2, ASSIST, { option, input: INPUT[option] });
      assert.equal(r.status, 200, `${option}: ${JSON.stringify(r.body)}`);
      const runs = f.runs();
      assert.equal(runs.length, before + 1, `${option}: one run`);
      const last = runs.at(-1);
      assert.deepEqual([last.user_id, last.rail_page, last.rail_option, last.record_ref, last.surface],
        [2, 'Founder · Articles', option, 'articles:5', AI_SURFACE.articles], option);
      assert.ok(last.charged_microusd > 0 && last.charged_microusd <= q.body.hold_microusd, `${option}: charged no more than the quote`);
      assert.deepEqual(r.body.cost, { charged_microusd: last.charged_microusd, usage_log_id: last.id });
      const p = f.proposals().at(-1);
      assert.deepEqual([p.user_id, p.rail_option, p.record_ref, p.kind, p.status, p.usage_log_id],
        [2, option, 'articles:5', ARTICLE_OPTIONS[option].kind, 'proposed', last.id], option);
      assert.equal(r.body.proposal.uid, p.uid);
    }
    assert.equal(f.proposals().length, ARTICLE_OPTION_KEYS.length, 'exactly one proposal per press');
    const byOption = Object.fromEntries(f.proposals().map((p) => [p.rail_option, JSON.parse(p.payload_json)]));
    assert.deepEqual(byOption['draft:article-headlines'], { headlines: ['Close the books faster', 'Shared ledgers, shorter months'] });
    assert.deepEqual(byOption['draft:article-seo'], { seo_title: 'Close your books faster', excerpt: 'How a shared ledger shortens the month-end close.' });
    assert.deepEqual(byOption['rewrite:article'], { before: BODY, after: 'Shared ledgers cut the back-and-forth.', tone: 'plainer' });
    assert.deepEqual(byOption['draft:article-section'], { heading: 'What changes at month end', markdown: 'Shared ledgers cut the back-and-forth.' });
    assert.deepEqual(byOption['check:article-facts'], { claims: [{ quote: 'close their books faster', why: 'a measured comparison', needs_source: true }] });
    assert.ok(f.calls.some((c) => c.prompt.includes(BODY)), 'the model reads the article as stored');
  } finally { f.close(); }
});

test('the quote is quoteRun\'s own hold for the same run', async () => {
  const f = await fixture();
  try {
    const option = 'draft:article-section' as const;
    const q = await call(f, 2, QUOTE, { option, input: INPUT[option] });
    const input = (inputOf(option, INPUT[option]) as any).input;
    const art = f.db.prepare('SELECT title, subtitle, body_markdown FROM articles WHERE id = 5').get() as any;
    const msg = messageOf(option, art, input);
    const direct = await quoteRun(f.env, {
      task: 'rail_write', userId: 2, surface: AI_SURFACE.articles,
      rail: { page: 'Founder · Articles', option, record: 'articles:5' },
      systemPrompt: msg.system, messages: [{ role: 'user', content: msg.user }], guardText: guardTextOf(input),
      temperature: 0.6, maxTokens: ARTICLE_OPTIONS[option].maxTokens,
    });
    assert.ok(direct.ok);
    assert.equal(q.body.hold_microusd, (direct as any).hold_microusd);
  } finally { f.close(); }
});

test('nothing writes the article: not a run, not Accept', async () => {
  const f = await fixture();
  try {
    const before = f.article();
    const r = await call(f, 2, ASSIST, { option: 'draft:article-seo', input: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(f.article(), before);
    const d = await call(f, 2, `/api/ai/rail/proposals/${r.body.proposal.uid}/decide`, { decision: 'accept' });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.deepEqual(f.article(), before, 'Accept places the proposal in the editor; the editor saves');
    assert.equal(f.proposals()[0].status, 'accepted');
  } finally { f.close(); }
});

test('an answer with nothing to place proposes nothing and says what it charged', async () => {
  const f = await fixture(() => 'I cannot think of any.');
  try {
    const r = await call(f, 2, ASSIST, { option: 'draft:article-headlines', input: {} });
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'nothing_proposed');
    assert.ok(r.body.cost.charged_microusd > 0);
    assert.deepEqual(f.proposals(), []);
  } finally { f.close(); }
});

test('the gate: the author and an admin pass; a stranger is 404; published is 409; a support session is 403', async () => {
  const f = await fixture();
  try {
    const body = { option: 'draft:article-headlines', input: {} };
    assert.equal((await call(f, 3, ASSIST, body)).status, 404, 'another member');
    assert.equal((await call(f, 4, ASSIST, body)).status, 404, 'an investor on a founder’s article');
    assert.equal((await call(f, 3, QUOTE, body)).status, 404, 'the quote is gated too');
    assert.equal((await call(f, 2, '/api/articles/999/assist', body)).status, 404);
    const pub = await call(f, 2, '/api/articles/6/assist', body);
    assert.deepEqual([pub.status, pub.body.error], [409, 'already_published']);
    const support = await call(f, 2, ASSIST, body, { impersonated_by: 1 });
    assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
    assert.deepEqual(f.runs(), [], 'nothing ran for a refused press');
    const own = await call(f, 4, '/api/articles/7/assist', body);
    assert.equal(own.status, 200, `an investor on their own article: ${JSON.stringify(own.body)}`);
    assert.equal(f.runs().at(-1).rail_page, 'Investor · Articles');
    const admin = await call(f, 1, ASSIST, body);
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
    const adminRow = f.proposals().at(-1);
    assert.deepEqual([adminRow.user_id, adminRow.rail_page], [1, 'Admin · Articles'], 'an admin’s run is the admin’s own');
  } finally { f.close(); }
});

test('an unknown option or a bad input is 400 and runs nothing', async () => {
  const f = await fixture();
  try {
    const u = await call(f, 2, ASSIST, { option: 'draft:article-poem', input: {} });
    assert.deepEqual([u.status, u.body.error], [400, 'unknown_option']);
    const i = await call(f, 2, ASSIST, { option: 'rewrite:article', input: { selection: BODY, tone: 'loud' } });
    assert.deepEqual([i.status, i.body.error, i.body.field], [400, 'invalid_input', 'tone']);
    assert.deepEqual(f.runs(), []);
  } finally { f.close(); }
});

test('out of tokens is 402 with no proposal; AI off is 403 and the quote says ai:false; a pause is 403', async () => {
  const f = await fixture();
  try {
    f.db.exec('UPDATE ai_topup_accounts SET balance_microusd = 0 WHERE user_id = 2');
    const r = await call(f, 2, ASSIST, { option: 'draft:article-headlines', input: {} });
    assert.equal(r.status, 402, JSON.stringify(r.body));
    assert.match(r.body.error, /^budget_user_(day|month)$|^spend_limit$/);
    assert.deepEqual(f.proposals(), []);
  } finally { f.close(); }
  const g = await fixture();
  try {
    aiOff(g);
    const q = await call(g, 2, QUOTE, { option: 'draft:article-headlines', input: {} });
    assert.deepEqual([q.status, q.body.ai, q.body.reason], [200, false, 'assist_off']);
    const r = await call(g, 2, ASSIST, { option: 'draft:article-headlines', input: {} });
    assert.deepEqual([r.status, r.body.error], [403, 'assist_off']);
    assert.deepEqual(g.runs(), []);
  } finally { g.close(); }
  const h = await fixture();
  try {
    h.db.exec("INSERT INTO member_ai_pauses(user_id, paused_by, reason) VALUES (2, 1, 'synthetic pause for the test')");
    const r = await call(h, 2, ASSIST, { option: 'draft:article-headlines', input: {} });
    assert.deepEqual([r.status, r.body.error], [403, 'ai_paused']);
    assert.deepEqual(h.proposals(), []);
  } finally { h.close(); }
});

test('a charge the usage row does not hold reads null, never 0', async () => {
  const f = await fixture();
  try {
    f.db.exec('CREATE TRIGGER no_charge AFTER UPDATE ON ai_usage_logs BEGIN UPDATE ai_usage_logs SET charged_microusd = NULL WHERE id = NEW.id; END;');
    f.db.exec('CREATE TRIGGER no_charge_ins AFTER INSERT ON ai_usage_logs BEGIN UPDATE ai_usage_logs SET charged_microusd = NULL WHERE id = NEW.id; END;');
    const r = await call(f, 2, ASSIST, { option: 'draft:article-headlines', input: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(f.runs().at(-1).charged_microusd, null);
    assert.equal(r.body.cost.charged_microusd, null);
  } finally { f.close(); }
});
