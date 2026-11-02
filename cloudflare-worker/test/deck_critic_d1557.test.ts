/**
 * D1557 (#3804, deck v2 C9): the investor critic. Synthetic data, the mounted
 * Worker routes and the real migrated schema; `env.AI` is a stub and `fetch`
 * throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_critic_d1557.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckCritic from '../src/routes/deck_critic.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { criticCards, criticFindings, criticMessage, criticModelFor, familyOf, otherFamily, personaOf, ruleFindings } from '../src/services/decks/critic.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'deck-critic-d1557-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1557-only-not-a-real-credential'.repeat(2);

const SLIDES = [
  { uid: 'c-title', title: 'Synthetic', spec_id: 'new:title', blocks: [] },
  { uid: 'c-problem', title: 'Problem', spec_id: 'new:problem', blocks: [{ id: 'p1', kind: 'text', text: 'Finance teams lose 3 days a month to closing.' }] },
  { uid: 'c-market', title: 'Market', spec_id: 'new:market', blocks: [{ id: 'm1', kind: 'text', text: 'A large market of finance teams.' }] },
];

// ─────────────────────────────────────────────────────────── pure

test('the family rule: a model\'s family, and a critic of another family than the writer\'s', () => {
  assert.equal(familyOf('@cf/meta/llama-3.3-70b-instruct-fp8-fast'), 'meta');
  assert.equal(familyOf('@cf/openai/gpt-oss-120b'), 'openai');
  assert.equal(familyOf('claude-sonnet-4'), 'anthropic');
  assert.equal(familyOf(''), null);
  const writer = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  assert.equal(criticModelFor(['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/openai/gpt-oss-120b'], writer), '@cf/openai/gpt-oss-120b', 'the writer\'s family is skipped');
  assert.equal(criticModelFor(['@cf/meta/llama-4-scout-17b-16e-instruct'], writer), null, 'no other family, no critic');
  assert.equal(criticModelFor(['@cf/openai/gpt-oss-120b'], null), null, 'an unknown writer, no critic');
  assert.equal(otherFamily('@cf/openai/gpt-oss-120b', writer), true);
  assert.equal(otherFamily('@cf/meta/llama-4-scout-17b-16e-instruct', writer), false, 'the critic\'s family differs from the writer\'s, or its answer is not shown');
  assert.equal(otherFamily(null, writer), false);
  assert.match(personaOf('series_a_fund'), /Series A partner/);
  // The route applies both halves of the rule: the pick, and the answer's own model after any fallback.
  const route = readFileSync(new URL('../src/routes/deck_critic.ts', import.meta.url), 'utf8');
  assert.match(route, /const model = writer && writer !== 'off' \? criticModelFor\(candidates\(\), writer\) : null;/);
  assert.match(route, /if \(!otherFamily\(answered, writer\)\) \{/);
  assert.equal(personaOf('nobody'), personaOf('other'));
});

test('rule findings: a missing card is a deal-breaker, missing proof will be asked, a market with no source and a Not backed figure flag their cards', () => {
  const cards = criticCards(SLIDES, (s) => String(s.spec_id).slice(4));
  const f = ruleFindings({
    cards,
    warnings: [
      { card: 'traction', code: 'missing_card', message: 'Seed deck with no traction slide', action: 'Add a traction slide' },
      { card: 'problem', code: 'missing_proof', message: 'Problem has no recorded evidence', action: 'Add a source' },
      { card: 'market', code: 'missing_proof', message: 'Market has no recorded evidence', action: 'Add a source' },
      { card: 'team', code: 'unchecked_proof', message: 'Team: unchecked', action: 'Open its sources' },
    ],
    order: [{ card: 'traction', in_deck: null, proof: 'missing' }, { card: 'problem', in_deck: 1, proof: 'missing' }, { card: 'market', in_deck: 2, proof: 'missing' }, { card: 'team', in_deck: null, proof: 'unchecked' }],
    notBacked: [{ uid: 'claim-1', slide: 1, label: 'MRR' }],
  });
  assert.deepEqual(f.map((x) => [x.code, x.severity, x.card_uid]), [
    ['missing_card', 'deal_breaker', null],
    ['missing_proof', 'will_be_asked', 'c-problem'],
    ['market_unsourced', 'will_be_asked', 'c-market'],
    ['not_backed', 'will_be_asked', 'c-problem'],
  ]);
  assert.equal(f.find((x) => x.code === 'market_unsourced')?.message, 'Market size has no source');
});

test('the critic\'s findings: a known severity on a card of the deck, and no number that is not on that card or a cited benchmark', () => {
  const cards = criticCards(SLIDES, () => null);
  const { findings, dropped } = criticFindings({ findings: [
    { card: 'c-problem', severity: 'will_be_asked', finding: 'How do you know teams lose 3 days?' },
    { card: 'c-problem', severity: 'urgent', finding: 'x' },
    { card: 'c-nowhere', severity: 'polish', finding: 'x' },
    { card: 'c-market', severity: 'deal_breaker', finding: 'A market of 40 billion is not shown.' },
    { card: 'c-market', severity: 'polish', finding: 'Seed rounds here grow 12% a month; say where you stand.' },
  ] }, cards, ['Month-on-month growth: 12% (Synthetic survey, 40 companies)']);
  assert.deepEqual(findings.map((x) => [x.card_uid, x.severity]), [['c-problem', 'will_be_asked'], ['c-market', 'deal_breaker'], ['c-market', 'polish']]);
  assert.equal(dropped, 2);
  const none = criticFindings({ findings: [{ card: 'c-market', severity: 'polish', finding: 'Seed rounds here grow 12% a month.' }] }, cards, null);
  assert.equal(none.findings.length, 0, 'with no benchmark recorded, a figure that is not on the card is not shown');
  assert.match(criticMessage({ persona: 'x', stageLabel: 'Seed', cards, already: [], benchmarks: null }), /No stage benchmark is recorded/);
});

// ─────────────────────────────────────────────────────────── the route

async function fixture(opts: { norms?: boolean } = {}) {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[1, 'admin', null], [2, 'founder', 100]] as const) insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  db.exec("INSERT INTO projects(id,name,founder_id,stage) VALUES (1,'Synthetic venture',100,'seed')");
  db.prepare("INSERT INTO pitch_decks (id, project_id, version, slides, is_current, audience) VALUES (7, 1, 3, ?, 1, 'seed_fund')").run(JSON.stringify(SLIDES));
  if (opts.norms) db.exec("INSERT INTO stage_norms(uid,project_id,entered_by,stage,metric,value,source,sample_size) VALUES ('n1',1,2,'seed','Month-on-month growth','12%','Synthetic survey',40)");
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const models: string[] = [];
  const AI = withGuard({
    run: async (model: string) => {
      models.push(model);
      return { response: JSON.stringify({ findings: [{ card: 'c-problem', severity: 'will_be_asked', finding: 'Who told you teams lose 3 days?' }] }), usage: { prompt_tokens: 60, completion_tokens: 40 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckCritic).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT rail_option, model FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  return { db, app, env, models, runs, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function post(f: F, who: number, path: string, json: unknown = {}) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

test('the run: rule findings and the critic\'s, on a model of another family than the writer\'s, under deck:critic', async () => {
  const f = await fixture();
  try {
    const q = await post(f, 2, '/api/decks/7/critic/quote');
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.ai, true, JSON.stringify(q.body));
    assert.notEqual(q.body.family, q.body.writer_family);
    assert.equal(f.models.length, 0, 'a quote runs nothing');
    const r = await post(f, 2, '/api/decks/7/critic', { investor_type: 'seed_fund' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.critic.state, 'ok', JSON.stringify(r.body.critic));
    assert.notEqual(r.body.critic.family, r.body.critic.writer_family, 'the critic\'s family differs from the writer\'s');
    assert.ok(f.runs().every((x) => x.rail_option === 'deck:critic'));
    assert.equal(familyOf(f.runs()[0].model), r.body.critic.family);
    const codes = r.body.findings.map((x: any) => x.code);
    assert.ok(codes.includes('missing_card'), 'A23\'s rules are findings');
    assert.ok(codes.includes('critic'));
    assert.equal(r.body.findings[0].severity, 'deal_breaker', 'deal-breakers first');
    assert.deepEqual(r.body.benchmark, { available: false, reason: 'No stage benchmark recorded' });
    assert.match(r.body.persona, /seed fund partner/);
  } finally { f.close(); }
});

test('a stage norm the venture recorded is the only benchmark cited', async () => {
  const f = await fixture({ norms: true });
  try {
    const r = await post(f, 2, '/api/decks/7/critic');
    assert.equal(r.body.benchmark.available, true);
    assert.match(r.body.benchmark.value[0], /Month-on-month growth: 12% \(Synthetic survey, 40 companies/);
  } finally { f.close(); }
});

test('with AI off the rule findings still answer, at no cost; an admin and a bad investor type are refused', async () => {
  const f = await fixture();
  try {
    f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES('off-2',2,?,'','manual')").run('founder · raise · pitch deck');
    const r = await post(f, 2, '/api/decks/7/critic');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.critic.state, 'off', JSON.stringify(r.body.critic));
    assert.equal((await post(f, 2, '/api/decks/7/critic/quote')).body.reason, 'assist_off');
    assert.ok(r.body.findings.some((x: any) => x.code === 'missing_card'));
    assert.equal(f.models.length, 0);
    assert.equal((await post(f, 1, '/api/decks/7/critic')).status, 403);
    assert.equal((await post(f, 2, '/api/decks/7/critic', { investor_type: 'nobody' })).status, 400);
  } finally { f.close(); }
});
