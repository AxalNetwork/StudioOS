/**
 * D1552 (#3799, deck v2 C4): the design critic. Synthetic data, the mounted
 * Worker routes and the real migrated schema; `env.AI` is a stub, `fetch`
 * throws and no browser is bound.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_critique_d1552.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckCritique, { base64Of } from '../src/routes/deck_critique.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import {
  CAP, CRITIC_MODELS, MAX_PASSES, PENALTY, QUALITY_THRESHOLD, autoCritique, codeFindings, critiqueScore, leftReason, pickCritic, styleFindings, visionFindings,
  type Finding,
} from '../src/services/decks/critique.ts';
import { familyOf } from '../src/services/decks/critic.ts';
import { jobStep, offerable } from '../src/services/ai/modelUseCases.ts';
import { deckRubric } from '../src/services/decks/rubric.ts';
import { buildCards, standardOutline } from '../src/services/decks/newDeck.ts';
import * as fixtures from './fixtures/pitchStoryFixtures.ts';
import { VENTURES } from '../../scripts/lib/deckEval.mjs';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { CONTRACTS } from '../src/contracts/index.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'deck-critique-d1552-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(schema); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1552-only-not-a-real-credential'.repeat(2);
const schemaOf = (name: keyof typeof CONTRACTS) => JSON.parse(readFileSync(`cloudflare-worker/src/contracts/${CONTRACTS[name].schema}`, 'utf8'));

const LONG = 'Finance teams lose days every month reconciling ledgers by hand across spreadsheets, banks and invoices, '.repeat(6).trim();
const OPTS = { aspect: '16:9' as const, contrastAa: true };

/** What one click builds for a sample venture (as D1518's zero-edit arm). */
function ventureDeck(venture: keyof typeof VENTURES) {
  const rec = (fixtures as any)[VENTURES[venture]]();
  const outline = standardOutline('standard', 'seed_fund');
  const exclude = new Set(rec.items.filter((i: any) => i.state !== 'recorded').map((i: any) => i.source_key));
  return buildCards(outline, rec.items, fixtures.wordsFor(outline), 'Synthetic venture', exclude, { series: rec.series, diagrams: rec.diagrams, rows: rec.rows }).slides;
}

/** A deck that overflows: three cards, each with a paragraph far too long for a small area. */
const badDeck = () => [0, 1, 2].map((i) => ({
  uid: `c-${i}`, layout: i ? 'content' : 'title',
  blocks: [
    { id: `h${i}`, kind: 'text', style: 'heading', text: `Card ${i}`, grid: { c1: 1, c2: 13, r1: 1, r2: 2 } },
    { id: `p${i}`, kind: 'text', style: 'body', text: LONG, grid: { c1: 1, c2: 7, r1: 3, r2: 4 } },
  ],
}));

// ─────────────────────────────────────────────────────────── pure

test('the critic\'s score is within 5 of the panel (rubric v0) on the three sample ventures', () => {
  // Mutation checked: a density penalty of 6 → the full venture drifts past 5.
  for (const v of Object.keys(VENTURES) as Array<keyof typeof VENTURES>) {
    const slides = ventureDeck(v);
    const panel = deckRubric(slides).score;
    const s = critiqueScore(slides, codeFindings(slides, OPTS));
    assert.equal(s.rubric, panel, `${v}: the rubric is the panel's`);
    assert.ok(Math.abs(s.score - panel) <= 5, `${v}: critic ${s.score} vs panel ${panel}`);
    assert.equal(s.cards.length, slides.length);
  }
});

test('code findings: fit and density name the block to shorten, contrast once for the deck, appendix cards skipped', () => {
  const slides = [
    ...badDeck().slice(0, 1),
    { uid: 'c-dense', blocks: [{ id: 'd1', kind: 'text', style: 'heading', text: 'Closing the books '.repeat(5).trim(), grid: { c1: 1, c2: 13, r1: 1, r2: 6 } }, { id: 'd2', kind: 'text', style: 'heading', text: 'Closing the books every single month, by hand', grid: { c1: 1, c2: 2, r1: 7, r2: 8 } }] },
    { uid: 'c-app', appendix: true, blocks: [{ id: 'a1', kind: 'text', text: LONG, grid: { c1: 1, c2: 3, r1: 1, r2: 2 } }] },
    { uid: 'c-nogrid', blocks: [{ id: 'g1', kind: 'text', text: LONG }] },
  ];
  const f = codeFindings(slides, { aspect: '16:9', contrastAa: false });
  assert.deepEqual(f.map((x) => [x.card, x.check, x.block_id, x.fix]), [[0, 'density', 'p0', 'shorten'], [1, 'density', 'd1', 'shorten'], [1, 'fit', 'd2', 'shorten'], [-1, 'contrast', null, null]], JSON.stringify(f));
  const p0 = f.find((x) => x.block_id === 'p0')!;
  assert.equal(p0.before, LONG);
  assert.equal(p0.card_uid, 'c-0');
  assert.ok(p0.limit! >= 8 && p0.limit! < LONG.length);
  assert.ok(!f.some((x) => x.card === 2), 'an appendix card is not checked');
  assert.equal(codeFindings(slides, { aspect: '16:9', contrastAa: null }).filter((x) => x.check === 'contrast').length, 0, 'an unread contrast is no finding');
});

test('vision findings: at most three known notes per card; an unreadable answer is null, never "clean"', () => {
  const answer = JSON.stringify({ issues: [
    { kind: 'crowding', note: 'The chart touches the heading.' },
    { kind: 'wording', note: 'Not a layout note.' },
    { kind: 'alignment', note: '  ' },
    { kind: 'hierarchy', note: 'Two blocks compete for attention.' },
    { kind: 'contrast', note: 'Grey on grey.' },
    { kind: 'legibility', note: 'A fourth one.' },
  ] });
  const f = visionFindings(4, 'c-4', answer)!;
  assert.deepEqual(f.map((x) => x.detail), ['Crowding: The chart touches the heading.', 'Hierarchy: Two blocks compete for attention.', 'Contrast: Grey on grey.']);
  assert.ok(f.every((x) => x.card === 4 && x.card_uid === 'c-4' && x.check === 'vision' && x.fix === null));
  assert.deepEqual(visionFindings(0, null, '{"issues":[]}'), []);
  assert.equal(visionFindings(0, null, 'I cannot see the slide.'), null);
  assert.equal(visionFindings(0, null, null), null);
});

test('style drift: a picture drawn in another style than the deck\'s art direction, with Match deck style', () => {
  const slides = [{ uid: 'c', blocks: [{ id: 'i1', kind: 'image', image_id: 'img-a' }, { id: 'i2', kind: 'image', image_id: 'img-b' }, { id: 'i3', kind: 'image', image_id: 'img-c' }] }];
  const images = [{ uid: 'img-a', style: 'photo' }, { uid: 'img-b', style: 'line_art' }, { uid: 'img-c', style: null }];
  const f = styleFindings(slides, images, 'photo');
  assert.deepEqual(f.map((x) => [x.block_id, x.fix]), [['i2', 'match_style']]);
  assert.match(f[0].detail, /line_art.*photo/);
  assert.deepEqual(styleFindings(slides, images, null), [], 'no art direction, no drift');
});

test('the score: rubric less what the critic adds, vision and style capped', () => {
  const slides = ventureDeck('full');
  const rubric = deckRubric(slides).score;
  const v = (k: number): Finding[] => Array.from({ length: k }, () => ({ card: 0, card_uid: null, block_id: null, check: 'vision', detail: 'x', fix: null }));
  assert.equal(critiqueScore(slides, v(2)).score, Math.max(0, rubric - 2 * PENALTY.vision));
  assert.equal(critiqueScore(slides, v(50)).score, Math.max(0, rubric - CAP.vision), 'vision is capped');
  const dense: Finding = { card: 0, card_uid: null, block_id: 'b', check: 'density', detail: 'x', fix: 'shorten' };
  assert.equal(critiqueScore(slides, [dense, dense]).score, Math.max(0, rubric - 2 * PENALTY.density));
  assert.equal(PENALTY.density, 3, 'a crowded block costs 3');
  const contrast: Finding = { card: -1, card_uid: null, block_id: null, check: 'contrast', detail: 'x', fix: null };
  assert.equal(critiqueScore(slides, [contrast]).score, Math.max(0, rubric - PENALTY.contrast));
  assert.equal(critiqueScore(slides, v(2)).cards[0].score, 100 - 2 * PENALTY.vision);
});

test('the critic is DK9\'s first model of another family than the writer\'s; an unknown writer gets none', () => {
  // DK9's models come from the job table (D760), never a second list.
  const dk9 = jobStep('DK9')!;
  assert.deepEqual(CRITIC_MODELS.slice(0, 3), [dk9.default, dk9.alternative, dk9.deeper]);
  assert.ok(CRITIC_MODELS.every(offerable), 'a model HQ does not offer (or held for legal review) is never the critic');
  assert.ok(dk9.more.some((id) => !offerable(id)) ? CRITIC_MODELS.length < 3 + dk9.more.length : true);
  assert.doesNotMatch(readFileSync('cloudflare-worker/src/services/decks/critique.ts', 'utf8'), /@cf\//, 'no model id is written in the critic');
  assert.equal(familyOf(pickCritic('@cf/google/gemma-3-12b-it')), 'meta', 'a Google writer skips Gemma');
  assert.equal(pickCritic('@cf/openai/gpt-oss-120b'), CRITIC_MODELS[0]);
  assert.equal(pickCritic(null), null);
  for (const w of ['@cf/google/gemma-3-12b-it', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/qwen/qwen3-30b-a3b-fp8']) {
    assert.notEqual(familyOf(pickCritic(w)), familyOf(w), w);
  }
});

test('AUTO-5: a bad deck is shortened above the threshold in at most two passes, never past the budget', async () => {
  const slides = badDeck();
  const before = critiqueScore(slides, codeFindings(slides, OPTS)).score;
  assert.ok(before < QUALITY_THRESHOLD, `the seeded deck starts below the threshold (${before})`);
  const calls: Finding[] = [];
  const r = await autoCritique(slides, { aspect: '16:9', contrastAa: true, perFixMicrousd: 1000, budgetMicrousd: 10_000, shorten: async (f) => { calls.push(f); return { after: 'Teams lose days to manual closes.', charged_microusd: 800 }; } });
  assert.equal(r.met, true, JSON.stringify(r));
  assert.ok(r.score >= QUALITY_THRESHOLD);
  assert.equal(r.before, before);
  assert.ok(r.passes >= 1 && r.passes <= MAX_PASSES);
  assert.deepEqual(r.reported, []);
  assert.equal(r.fixed.length, 3);
  assert.equal(r.charged_microusd, 2400);
  assert.equal(slides[0].blocks[1].text, LONG, 'nothing is changed in place');
  assert.equal(r.slides[1].blocks[1].text, 'Teams lose days to manual closes.');

  // A budget for one fix: one shortened, the rest reported, nothing past the quote.
  const tight = await autoCritique(badDeck(), { aspect: '16:9', contrastAa: true, perFixMicrousd: 1000, budgetMicrousd: 1500, shorten: async () => ({ after: 'Short.', charged_microusd: 5000 }) });
  assert.equal(tight.fixed.length, 1);
  assert.ok(tight.charged_microusd <= 1500, 'never past the quote');
  assert.equal(tight.met, false);
  assert.ok(tight.reported.length >= 2, 'what is left is reported');

  // A shorten that never helps: at most MAX_PASSES passes, then reported.
  let k = 0;
  const stuck = await autoCritique(badDeck(), { aspect: '16:9', contrastAa: true, perFixMicrousd: 1, budgetMicrousd: 1_000_000, shorten: async (f) => { k += 1; return { after: `${f.before} more`, charged_microusd: 1 }; } });
  assert.equal(stuck.passes, MAX_PASSES);
  assert.equal(stuck.met, false);
  assert.equal(k, 3 * MAX_PASSES, 'each pass works from the words the last one left');
  assert.ok(stuck.charged_microusd <= 3 * MAX_PASSES);
  // At the threshold nothing runs, whatever is left; and what is left is reported, met or not.
  const at = await autoCritique(badDeck(), { aspect: '16:9', contrastAa: true, threshold: 0, perFixMicrousd: 1, budgetMicrousd: 10, shorten: async () => { throw new Error('not called'); } });
  assert.deepEqual([at.passes, at.met, at.reported.length], [0, true, 3]);
  // A deck already above the threshold runs nothing.
  const clean = await autoCritique(ventureDeck('full'), { aspect: '16:9', contrastAa: true, perFixMicrousd: 1, budgetMicrousd: 10, shorten: async () => { throw new Error('not called'); } });
  assert.equal(clean.passes, 0);
});

test('what no shortening fixes is left with why: contrast in Theme, style on the picture; a vision note is shown as a note', () => {
  const f = (check: any): Finding => ({ card: 0, card_uid: null, block_id: null, check, detail: 'x', fix: null });
  assert.equal(leftReason(f('contrast')), 'Change it in Theme.');
  assert.equal(leftReason(f('style')), 'Open the picture and choose Match deck style.');
  assert.equal(leftReason(f('vision')), null);
  assert.equal(leftReason(f('density')), null, 'a shorten finding is a fix, or left by its run with its own reason');
  const route = readFileSync('cloudflare-worker/src/routes/deck_critique.ts', 'utf8');
  assert.match(route, /const reason = leftReason\(f\);\n\s*if \(reason\) notFixed\.push/);
});

test('a slide\'s bytes as base64, a chunk at a time', () => {
  const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
  assert.equal(base64Of(bytes), Buffer.from(bytes).toString('base64'));
});

// ─────────────────────────────────────────────────────────── the route

async function fixture(opts: { slides?: any[] } = {}) {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[1, 'admin', null], [2, 'founder', 100], [3, 'founder', 300]] as const) insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  db.exec("INSERT INTO projects(id,name,founder_id,stage) VALUES (1,'Synthetic venture',100,'seed')");
  db.prepare("INSERT INTO pitch_decks (id, project_id, version, slides, is_current, audience) VALUES (7, 1, 3, ?, 1, 'seed_fund')").run(JSON.stringify(opts.slides ?? badDeck()));
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const models: string[] = [];
  let reply = 'Teams lose days to manual closes.';
  const AI = withGuard({
    run: async (model: string) => {
      models.push(model);
      return { response: reply, usage: { prompt_tokens: 60, completion_tokens: 20 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckCritique).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT rail_option, task FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const proposals = () => db.prepare('SELECT uid, rail_option, record_ref, kind, status, payload_json FROM ai_rail_proposals ORDER BY id').all() as any[];
  return { db, app, env, models, runs, proposals, close, setReply: (r: string) => { reply = r; } };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function post(f: F, who: number, path: string, json: unknown = {}) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

test('the quote: the free checks\' score, the fixes priced, and the vision pass\'s reason with no browser, running nothing', async () => {
  const f = await fixture();
  try {
    const q = await post(f, 2, '/api/decks/7/critique/quote');
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.ai, true, JSON.stringify(q.body));
    assert.equal(q.body.fixes.count, 3);
    assert.ok(q.body.fixes.per_microusd > 0);
    assert.equal(q.body.fixes.microusd, q.body.fixes.per_microusd * 3);
    assert.equal(q.body.vision.available, false);
    assert.match(q.body.vision.reason, /cannot be pictured/);
    assert.equal(q.body.hold_microusd, q.body.fixes.microusd, 'the hold is what will run');
    assert.ok(q.body.score < QUALITY_THRESHOLD);
    assert.equal(f.models.length, 0, 'a quote runs nothing');
    assert.deepEqual(contractErrors(schemaOf('critique'), q.body), []);
    assert.notDeepEqual(contractErrors(schemaOf('critique'), { ...q.body, vision: { ...q.body.vision, model: '@cf/x/y' } }), [], 'no model id rides on the reply');
  } finally { f.close(); }
});

test('the run: each fix a deck:shorten rail proposal in the shape a card\'s Shorten leaves, the score if accepted above the threshold, nothing placed', async () => {
  const f = await fixture();
  try {
    const r = await post(f, 2, '/api/decks/7/critique', { vision: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(contractErrors(schemaOf('critique'), r.body), []);
    assert.equal(r.body.fixes.length, 3, JSON.stringify(r.body.not_fixed));
    assert.ok(r.body.score_before < QUALITY_THRESHOLD);
    assert.ok(r.body.score_if_accepted >= QUALITY_THRESHOLD, JSON.stringify(r.body));
    assert.equal(r.body.threshold, QUALITY_THRESHOLD);
    assert.equal(r.body.what_we_fixed.length, 3);
    assert.match(r.body.what_we_fixed[0], /^Card 1: shortened to read in seconds$/);
    assert.equal(r.body.vision.ran, false);
    assert.match(r.body.vision.reason, /cannot be pictured/);
    assert.ok(f.runs().length === 3 && f.runs().every((x) => x.rail_option === 'deck:shorten' && x.task === 'rail_write'), JSON.stringify(f.runs()));
    const rows = f.proposals();
    assert.equal(rows.length, 3);
    for (const [i, row] of rows.entries()) {
      assert.equal(row.rail_option, 'deck:shorten');
      assert.equal(row.record_ref, 'deck:7');
      assert.equal(row.kind, 'proposal');
      assert.equal(row.status, 'proposed');
      const p = JSON.parse(row.payload_json);
      // `cardEdit` (deckV2Model.js) reads deck_id, card, card_uid, action, before, after.
      assert.deepEqual({ deck_id: p.deck_id, card: p.card, card_uid: p.card_uid, action: p.action, before: p.before, after: p.after, source: p.source }, { deck_id: 7, card: i, card_uid: `c-${i}`, action: 'shorten', before: LONG, after: 'Teams lose days to manual closes.', source: 'critique' });
      assert.equal(r.body.fixes[i].proposal_uid, row.uid);
    }
    const deck = f.db.prepare('SELECT slides FROM pitch_decks WHERE id = 7').get() as any;
    assert.deepEqual(JSON.parse(deck.slides).map((x: any) => x.blocks[1].text), [LONG, LONG, LONG], 'nothing is placed until the founder accepts');
    for (const x of r.body.findings) assert.deepEqual(Object.keys(x).sort(), ['block_id', 'card', 'card_uid', 'check', 'detail', 'fix'], 'the words a fix works from stay on the server');
  } finally { f.close(); }
});

test('a shortening that names a figure the text did not, or still overflows, is left for the founder with why', async () => {
  const f = await fixture();
  try {
    f.setReply('Teams lose 40 days to closes.');
    const r = await post(f, 2, '/api/decks/7/critique');
    assert.equal(r.body.fixes.length, 0);
    assert.equal(r.body.not_fixed.length, 3);
    assert.match(r.body.not_fixed[0].reason, /named a figure/);
    assert.equal(f.proposals().length, 0);
    f.setReply(LONG);
    const r2 = await post(f, 2, '/api/decks/7/critique');
    assert.match(r2.body.not_fixed[0].reason, /still do not fit/);
    assert.equal(r2.body.score_if_accepted, r2.body.score_before, 'nothing kept, nothing gained');
  } finally { f.close(); }
});

test('with AI off the free checks still answer and nothing runs; another venture\'s founder and an admin are refused', async () => {
  const f = await fixture();
  try {
    f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES('off-2',2,?,'','manual')").run('founder · raise · pitch deck');
    const q = await post(f, 2, '/api/decks/7/critique/quote');
    assert.deepEqual([q.body.ai, q.body.reason], [false, 'assist_off'], JSON.stringify(q.body));
    const r = await post(f, 2, '/api/decks/7/critique');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.fixes.length, 0);
    assert.ok(r.body.findings.some((x: any) => x.check === 'density'), 'the free checks still ran');
    assert.match(r.body.not_fixed[0].reason, /AI assistance is off/);
    assert.equal(r.body.not_fixed.length, 1, 'the first refusal stops the rest');
    assert.equal(f.models.length, 0);
    assert.equal((await post(f, 3, '/api/decks/7/critique')).status, 403);
    assert.equal((await post(f, 1, '/api/decks/7/critique/quote')).status, 403);
    assert.equal((await post(f, 2, '/api/decks/999/critique')).status, 404);
  } finally { f.close(); }
});

test('a clean deck: no fixes to price, no run, the score its rubric', async () => {
  const slides = ventureDeck('full');
  const f = await fixture({ slides });
  try {
    const q = await post(f, 2, '/api/decks/7/critique/quote');
    assert.equal(q.body.fixes.count, 0, JSON.stringify(q.body));
    assert.equal(q.body.fixes.per_microusd, null, 'no fix, no price: null, never 0');
    const r = await post(f, 2, '/api/decks/7/critique');
    assert.equal(r.body.fixes.length, 0);
    assert.ok(Math.abs(r.body.score - deckRubric(slides).score) <= 5);
    assert.equal(f.models.length, 0);
  } finally { f.close(); }
});
