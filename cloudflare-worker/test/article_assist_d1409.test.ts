/**
 * D1409 (#3695): Eadwyn's writing options in the article editor, and its
 * images. Synthetic data, the mounted Worker routes and the real migrated
 * schema; `env.AI` is a stub, R2 is a map and `fetch` throws.
 *
 *   · each of the eight options is quoted before it runs, runs once through
 *     `run()` with its rail context, is charged to the member who pressed, and
 *     leaves exactly one ai_rail_proposals row of its kind;
 *   · nothing writes the article, not the run and not Accept;
 *   · the gate: the author or an admin; a published article and a support
 *     session are refused; out of tokens is 402, AI off and a pause are 403;
 *   · images: a real person is refused before any quote or hold; the balance
 *     is checked for every image before any hold; each image is one charged
 *     run, one R2 object under `articles/<id>/` and one proposal, read at an
 *     absolute https URL; discard keeps bytes the article shows; the cover
 *     from an image is a copy.
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
import articleAssist, { articleImageUrl } from '../src/routes/article_assist.ts';
import articles from '../src/routes/articles.ts';
import railProposals from '../src/routes/ai_rail_proposals.ts';
import { __resetForTest, quoteRun } from '../src/services/aiRouter.ts';
import { AI_SURFACE } from '../src/services/aiSurfaces.ts';
import {
  ARTICLE_OPTIONS, ARTICLE_OPTION_KEYS, articlePage, articleTextOf, cleanText, guardTextOf, imageAskOf, imagePromptOf, inputOf, messageOf, payloadOf,
} from '../src/services/articleAssist.ts';
import { REAL_PERSON_MESSAGE } from '../src/services/aiImages.ts';
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
const ORIGIN = 'https://axal.vc';
// A 1 × 1 PNG, as FLUX's `{ image: base64 }` would carry it.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** The stub model answers by what the press asked for. */
function answerFor(prompt: string): string {
  if (/JSON array of strings/.test(prompt)) return JSON.stringify(['Close the books faster', 'Shared ledgers, shorter months']);
  if (/"seo_title"/.test(prompt)) return '```json\n{"seo_title": "Close your books faster", "excerpt": "How a shared ledger shortens the month-end close."}\n```';
  if (/"claims"/.test(prompt)) return JSON.stringify({ claims: [{ quote: 'close their books faster', why: 'a measured comparison' }] });
  return 'Here is the draft:\nShared ledgers cut the back-and-forth.';
}

async function fixture(answer: (prompt: string) => string = answerFor, { imageFailsAt = 0 } = {}) {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role] of [[1, 'admin'], [2, 'founder'], [3, 'founder'], [4, 'investor']] as const) {
    insert.run(id, role, null, id === 2 ? 'Ada Quill' : `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
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
  let drawn = 0;
  const AI = withGuard({
    run: async (model: string, input: any) => {
      if (/flux/.test(model)) {
        calls.push({ model, prompt: String(input?.prompt ?? '') });
        drawn += 1;
        if (imageFailsAt && drawn === imageFailsAt) throw new Error('synthetic image failure');
        return { image: PNG };
      }
      const prompt = (input?.messages || []).filter((m: any) => m.role === 'user').map((m: any) => String(m.content || '')).join('\n');
      calls.push({ model, prompt });
      return { response: answer(prompt), usage: { prompt_tokens: 60, completion_tokens: 40 } };
    },
  });
  const r2 = new Map<string, Uint8Array>();
  const FILES = {
    put: async (key: string, bytes: Uint8Array) => { r2.set(key, new Uint8Array(bytes)); },
    get: async (key: string) => {
      if (!r2.has(key)) return null;
      const bytes = r2.get(key)!;
      return { body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.slice().buffer };
    },
    delete: async (key: string) => { r2.delete(key); },
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI, FILES };
  const app = new Hono<any>().route('/api/articles', articleAssist).route('/api/articles', articles).route('/api/ai/rail/proposals', railProposals);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT id, user_id, task, rail_page, rail_option, record_ref, surface, charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const proposals = () => db.prepare('SELECT uid, user_id, rail_page, rail_option, record_ref, kind, status, payload_json, usage_log_id FROM ai_rail_proposals ORDER BY id').all() as any[];
  const article = (id = 5) => db.prepare('SELECT title, subtitle, body_markdown, excerpt, seo_title, status FROM articles WHERE id = ?').get(id) as any;
  const holds = () => (db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get() as any).n as number;
  return { db, env, app, calls, r2, runs, proposals, article, holds, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

const jwtOf = (who: number, claims: Record<string, unknown> = {}) => new SignJWT({ user_id: who, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function call(f: F, who: number, path: string, json: unknown, claims: Record<string, unknown> = {}) {
  const jwt = await jwtOf(who, claims);
  const res = await f.app.request(ORIGIN + path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(json) }, f.env);
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

// ─────────────────────────────────────────────────────────── images (part 2)

const GENERATE = '/api/articles/5/images/generate';
const IMAGES_QUOTE = '/api/articles/5/images/quote';
const ASK = { prompt: 'A tidy desk at month end, ledgers stacked neatly', style: 'photo', aspect: '16:9', count: 2 };

/** GET an image through articles.ts's own route, as `who` (or signed out). */
async function fetchImage(f: F, who: number | null, url: string) {
  const headers: Record<string, string> = who ? { Authorization: `Bearer ${await jwtOf(who)}` } : {};
  const res = await f.app.request(url, { headers }, f.env);
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
}

test('an image ask is checked by field; the prompt says no people, no words', () => {
  assert.deepEqual(imageAskOf({ prompt: 'x' }), { field: 'prompt', error: 'Describe the image first.' });
  assert.deepEqual(imageAskOf({ prompt: 'a desk', count: 5 }), { field: 'count', error: 'Ask for 1 to 4 images.' });
  assert.deepEqual(imageAskOf({ prompt: 'a desk', style: 'line' }), { field: 'style', error: 'style must be one of photo, illustration, diagram, abstract' });
  assert.deepEqual(imageAskOf({ prompt: 'a desk', aspect: '2:1' }), { field: 'aspect', error: 'aspect must be one of 16:9, 4:3, 1:1, 3:4' });
  assert.deepEqual(imageAskOf({ prompt: '  a   desk ' }), { ask: { prompt: 'a desk', style: 'illustration', aspect: '16:9', count: 1 } });
  assert.ok('ask' in imageAskOf({ ...ASK, style: 'photo' }), 'owner step A, pick a: photo is offered');
  assert.match(imagePromptOf((imageAskOf(ASK) as any).ask), /^A tidy desk at month end, ledgers stacked neatly\. a photographic image .*No identifiable people, no faces, no text, no letters, no numbers\.$/);
});

test('a real person is refused before any quote, run or hold: a face word, or the author\'s name', async () => {
  const f = await fixture();
  try {
    for (const prompt of ['portrait of our CEO at her desk', 'Ada Quill closing the books', 'a desk where Quill works']) {
      for (const path of [IMAGES_QUOTE, GENERATE]) {
        const r = await call(f, 2, path, { ...ASK, prompt });
        assert.deepEqual([r.status, r.body.error, r.body.message], [422, 'real_person', REAL_PERSON_MESSAGE], `${path}: ${prompt}`);
      }
    }
    // An admin on the author's article: the author's name is still the one refused.
    assert.equal((await call(f, 1, GENERATE, { ...ASK, prompt: 'Ada Quill at work' })).status, 422);
    assert.deepEqual([f.runs().length, f.holds(), f.r2.size, f.proposals().length], [0, 0, 0, 0]);
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test('a bad ask is 400 by field; the gate refuses as the text options do', async () => {
  const f = await fixture();
  try {
    const five = await call(f, 2, GENERATE, { ...ASK, count: 5 });
    assert.deepEqual([five.status, five.body.error, five.body.field], [400, 'invalid_input', 'count']);
    assert.equal((await call(f, 3, GENERATE, ASK)).status, 404, 'a stranger');
    assert.equal((await call(f, 3, IMAGES_QUOTE, ASK)).status, 404, 'the quote is gated too');
    assert.deepEqual((await call(f, 2, '/api/articles/6/images/generate', ASK)).status, 409, 'published');
    assert.deepEqual((await call(f, 2, GENERATE, ASK, { impersonated_by: 1 })).body.error, 'support_session_refused');
    assert.equal(f.runs().length, 0);
  } finally { f.close(); }
});

test('the quote names the model and its price per image; a balance short for every image is 402 before any hold', async () => {
  const f = await fixture();
  try {
    const q = await call(f, 2, IMAGES_QUOTE, { ...ASK, count: 4 });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.deepEqual([q.body.ai, q.body.model_label, q.body.count, q.body.balance], [true, 'FLUX.1 Schnell', 4, { ok: true }]);
    const per = q.body.per_image_microusd;
    assert.ok(per > 0);
    assert.equal(q.body.total_microusd, per * 4);
    // Enough for one image, not for four.
    f.db.prepare('UPDATE ai_topup_accounts SET balance_microusd = ? WHERE user_id = 2').run(per + 1);
    const short = await call(f, 2, IMAGES_QUOTE, { ...ASK, count: 4 });
    assert.deepEqual([short.body.ai, short.body.balance.ok], [true, false], 'the quote says so before the press');
    const r = await call(f, 2, GENERATE, { ...ASK, count: 4 });
    assert.equal(r.status, 402, JSON.stringify(r.body));
    assert.match(r.body.error, /^budget_user_(day|month)$/);
    assert.deepEqual([f.runs().length, f.holds(), f.r2.size, f.proposals().length], [0, 0, 0, 0], 'nothing ran and nothing was held');
    const one = await call(f, 2, GENERATE, { ...ASK, count: 1 });
    assert.equal(one.status, 200, `one image is covered: ${JSON.stringify(one.body)}`);
    assert.equal(one.body.images.length, 1);
  } finally { f.close(); }
});

test('two images: two charged runs, two R2 objects, two proposals, each read at an absolute https URL', async () => {
  const f = await fixture();
  try {
    const r = await call(f, 2, GENERATE, ASK);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.images.length, 2);
    assert.equal(r.body.stopped, undefined);
    const runs = f.runs();
    assert.equal(runs.length, 2);
    for (const run of runs) {
      assert.deepEqual([run.user_id, run.task, run.rail_page, run.rail_option, run.record_ref, run.surface],
        [2, 'article_image', 'Founder · Articles', 'draft:article-image', 'articles:5', AI_SURFACE.articles]);
      assert.ok(run.charged_microusd > 0);
    }
    assert.deepEqual([...f.r2.keys()].map((k) => /^articles\/5\/img-[0-9a-f-]{36}\.png$/.test(k)), [true, true]);
    const rows = f.proposals();
    assert.equal(rows.length, 2);
    r.body.images.forEach((img: any, i: number) => {
      const row = rows[i];
      assert.deepEqual([row.uid, row.user_id, row.rail_option, row.record_ref, row.kind, row.status, row.usage_log_id],
        [img.uid, 2, 'draft:article-image', 'articles:5', 'proposal', 'proposed', runs[i].id]);
      assert.deepEqual(JSON.parse(row.payload_json), { filename: img.filename, url: img.url, width: img.width, height: img.height, style: 'photo', aspect: '16:9', alt: '' });
      assert.deepEqual([img.charged_microusd, img.usage_log_id], [runs[i].charged_microusd, runs[i].id]);
      assert.equal(img.url, articleImageUrl(ORIGIN, 5, img.filename));
      assert.match(img.url, /^https:\/\/axal\.vc\/api\/articles\/5\/image\/img-/);
    });
    assert.notEqual(rows[0].usage_log_id, rows[1].usage_log_id, 'each image keeps its own run');
    assert.ok(f.calls.every((c) => /No identifiable people/.test(c.prompt)), 'the prompt carries the no-people rule');
    const mine = await fetchImage(f, 2, r.body.images[0].url);
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.bytes, new Uint8Array(Buffer.from(PNG, 'base64')));
    assert.equal((await fetchImage(f, 3, r.body.images[0].url)).status, 404, 'a stranger cannot read a draft\'s image');
    assert.equal((await fetchImage(f, null, r.body.images[0].url)).status, 404);
    assert.deepEqual(f.article().body_markdown, BODY, 'nothing reaches the article until the editor places it');
  } finally { f.close(); }
});

test('the second image failing stops with the first one kept, charged and proposed', async () => {
  const f = await fixture(answerFor, { imageFailsAt: 2 });
  try {
    const r = await call(f, 2, GENERATE, ASK);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.images.length, 1);
    assert.equal(typeof r.body.stopped?.code, 'string');
    assert.equal(f.r2.size, 1);
    assert.equal(f.proposals().length, 1);
    assert.equal(f.holds(), 2, 'each image was held before it ran');
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status = 'pending'").get() as any).n, 0, 'the failed run let its hold go');
  } finally { f.close(); }
  const h = await fixture();
  try {
    h.db.exec("CREATE TRIGGER no_proposal BEFORE INSERT ON ai_rail_proposals BEGIN SELECT RAISE(ABORT, 'synthetic'); END;");
    const r = await call(h, 2, GENERATE, ASK);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.images.length, r.body.stopped?.code], [0, 'proposal_unsaved']);
    assert.equal(h.r2.size, 0, 'bytes no proposal names are not left behind');
    assert.equal(h.runs().length, 1, 'it was charged for the run it made');
  } finally { h.close(); }
  const g = await fixture(answerFor, { imageFailsAt: 1 });
  try {
    const r = await call(g, 2, GENERATE, ASK);
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.equal(r.body.error, 'model_unavailable');
    assert.deepEqual([g.r2.size, g.proposals().length], [0, 0]);
  } finally { g.close(); }
});

test('discard deletes the bytes unless the article shows them; only the presser\'s own image on this article', async () => {
  const f = await fixture();
  try {
    const r = await call(f, 2, GENERATE, ASK);
    const [a, b] = r.body.images;
    assert.equal((await call(f, 1, `/api/articles/5/images/${a.uid}/discard`, {})).status, 404, 'another member\'s proposal, even for an admin');
    const text = (await call(f, 2, ASSIST, { option: 'draft:article-seo', input: {} })).body.proposal.uid;
    assert.equal((await call(f, 2, `/api/articles/5/images/${text}/discard`, {})).status, 404, 'not an image proposal');
    // An image proposal moved to another record, or to another option, is not this article's image.
    f.db.prepare("UPDATE ai_rail_proposals SET record_ref = 'articles:6' WHERE uid = ?").run(a.uid);
    assert.equal((await call(f, 2, `/api/articles/5/images/${a.uid}/discard`, {})).status, 404, 'another article\'s record');
    f.db.prepare("UPDATE ai_rail_proposals SET record_ref = 'articles:5', rail_option = 'draft:article-outline' WHERE uid = ?").run(a.uid);
    assert.equal((await call(f, 2, `/api/articles/5/images/${a.uid}/discard`, {})).status, 404, 'another option');
    f.db.prepare("UPDATE ai_rail_proposals SET rail_option = 'draft:article-image' WHERE uid = ?").run(a.uid);
    assert.equal(f.r2.has(`articles/5/${a.filename}`), true, 'nothing was deleted by a refused discard');
    const gone = await call(f, 2, `/api/articles/5/images/${a.uid}/discard`, {});
    assert.deepEqual([gone.status, gone.body.ok, gone.body.deleted], [200, true, true]);
    assert.equal(f.r2.has(`articles/5/${a.filename}`), false);
    assert.equal(f.proposals().find((p) => p.uid === a.uid).status, 'discarded');
    assert.equal((await call(f, 2, `/api/articles/5/images/${a.uid}/discard`, {})).status, 409, 'once only');
    // The editor placed b in the body and saved: discarding it keeps the bytes.
    f.db.prepare('UPDATE articles SET body_markdown = ? WHERE id = 5').run(`${BODY}\n\n![](${b.url})`);
    const kept = await call(f, 2, `/api/articles/5/images/${b.uid}/discard`, {});
    assert.deepEqual([kept.status, kept.body.deleted], [200, false]);
    assert.equal(f.r2.has(`articles/5/${b.filename}`), true);
  } finally { f.close(); }
});

test('the cover from an image is a copy: a second cover never deletes the body image', async () => {
  const f = await fixture();
  try {
    const [a, b] = (await call(f, 2, GENERATE, ASK)).body.images;
    const one = await call(f, 2, '/api/articles/5/cover', { image: a.filename });
    assert.equal(one.status, 200, JSON.stringify(one.body));
    const cover1 = (f.db.prepare('SELECT cover_r2_key, cover_mime FROM articles WHERE id = 5').get() as any);
    assert.match(cover1.cover_r2_key, /^articles\/5\/cover-[0-9a-f-]{36}\.png$/);
    assert.equal(cover1.cover_mime, 'image/png');
    assert.deepEqual(f.r2.get(cover1.cover_r2_key), f.r2.get(`articles/5/${a.filename}`), 'the same bytes, under the cover key');
    const two = await call(f, 2, '/api/articles/5/cover', { image: b.filename });
    assert.equal(two.status, 200);
    assert.equal(f.r2.has(`articles/5/${a.filename}`), true, 'the first image is still there');
    assert.equal(f.r2.has(cover1.cover_r2_key), false, 'the old cover copy went');
    assert.deepEqual((await call(f, 2, '/api/articles/5/cover', { image: '../x.png' })).body.error, 'invalid_image');
    assert.deepEqual((await call(f, 2, '/api/articles/5/cover', { image: 'img-0000.png' })).body.error, 'image_missing');
    assert.equal((await call(f, 3, '/api/articles/5/cover', { image: b.filename })).status, 404, 'a stranger');
  } finally { f.close(); }
});

