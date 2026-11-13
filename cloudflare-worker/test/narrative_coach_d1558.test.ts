/**
 * D1558 (#3805, deck v2 C10) — the narrative coach and the "deck ready to
 * send" readiness item, on real SQLite with the real AI router and a stubbed
 * model. Synthetic venture, deck and narrative.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/narrative_coach_d1558.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleRaise from '../src/routes/cycle_raise.ts';
import { COACH_OPTION, areaParam, coachCards, coachFindings, coachPrompt, deckReadyRows, editorHref } from '../src/services/narrative/coach.ts';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';

const PAGE = 'Founder · Raise · Investor narrative';
const mig = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const between = (sql: string, from: string) => { const at = sql.indexOf(from); return sql.slice(at, sql.indexOf(');', at) + 2); };

const g = (c1: number, c2: number, r1: number, r2: number) => ({ c1, c2, r1, r2 });
const BOUND = { source_key: 'revenue.mrr', as_of: '2026-10-01', grade: 'Measured' };
/** Four cards: a ready one, one with an empty area and a placeholder, one with a figure and no source, one with no title and no image. */
const SLIDES = [
  { uid: 'c-problem', title: 'Problem', blocks: [{ id: 'h1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Teams close the month by hand.' }] },
  { uid: 'c-solution', title: 'Solution', blocks: [
    { id: 's1', kind: 'text', style: 'paragraph', grid: g(1, 6, 2, 4), text: '' },
    { id: 's2', kind: 'text', style: 'paragraph', grid: g(7, 12, 2, 4), text: '[Write how it works]' },
  ] },
  { uid: 'c-traction', title: 'Traction', blocks: [
    { id: 't1', kind: 'text', style: 'paragraph', grid: g(1, 7, 2, 6), text: 'MRR is $18.4k, up 40% this quarter.' },
    { id: 't2', kind: 'metric', grid: g(8, 10, 2, 3), label: 'MRR', value: '18400', binding: BOUND },
    { id: 't3', kind: 'text', style: 'paragraph', grid: g(8, 12, 4, 6), text: 'Two founders, three regions.' },
    { id: 't4', kind: 'text', style: 'paragraph', grid: g(11, 12, 2, 3), text: 'ARR $220k', binding: BOUND },
  ] },
  { title: '', blocks: [
    { id: 'x1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Team' },
    { id: 'x2', kind: 'image', grid: g(1, 4, 2, 5), image_url: null, alt: '' },
  ] },
];

// ─────────────────────────────────────────────────────────── pure

test('ready to send: each row names one area of one card, and links the editor to that card and area', () => {
  const rows = deckReadyRows(SLIDES, 7);
  assert.deepEqual(rows.map((r) => [r.kind, r.card_index, r.area?.id]), [
    ['empty_area', 1, 's1'], ['placeholder', 1, 's2'], ['figure_unsourced', 2, 't1'], ['untitled', 3, 'x1'], ['image_missing', 3, 'x2'],
  ], 'a bound metric, a bound text area with an amount and a bare count are not flagged; the ready card has no row');
  assert.equal(rows[0].href, '/raise/pitch/edit?project_id=7&card=c-solution&area=c1-6r2-4');
  assert.equal(rows[2].href, '/raise/pitch/edit?project_id=7&card=c-traction&area=c1-7r2-6');
  assert.equal(rows[3].href, '/raise/pitch/edit?project_id=7&card=4&area=c1-12r1-1', 'a card with no uid is linked by its place');
  assert.equal(rows[0].label, 'Card 2 · Solution: an area is empty.');
  assert.equal(rows[3].label, 'Card 4 has no title.');
  assert.equal(areaParam(g(3, 7, 2, 4)), 'c3-7r2-4');
  assert.equal(editorHref(7, { uid: null, index: 0 }, null), '/raise/pitch/edit?project_id=7&card=1');
  assert.deepEqual(deckReadyRows([SLIDES[0]], 7), [], 'a card with a title and words is ready');
  const unbound = deckReadyRows([{ uid: 'm', title: 'Traction', blocks: [{ id: 'm1', kind: 'metric', grid: g(1, 3, 1, 2), label: 'MRR', value: '18400' }] }], 7);
  assert.deepEqual(unbound.map((r) => r.kind), ['figure_unsourced'], 'a metric tile with no record behind it');
});

test('the coach reads every figure masked, and keeps only findings that point at a real card and area with no figure', () => {
  const cards = coachCards(SLIDES);
  const prompt = coachPrompt([{ key: 'traction', label: 'Traction', body: 'MRR reached $16,950 from 42 customers.' }], cards);
  assert.doesNotMatch(prompt, /16,950|18\.4|40%|\b42\b/, 'no figure reaches the model');
  assert.match(prompt, /\[figure\]/);
  const got = coachFindings({ findings: [
    { section: 'traction', card: 'c-traction', area: 't3', kind: 'unclear', message: 'The traction card does not say who pays.', proposal: 'Name the kind of team that pays.' },
    { section: 'problem', card: null, area: null, kind: 'missing', message: 'No card says why the close is slow.', proposal: 'Add the cause to the problem card.' },
    { section: 'team', card: 'c-gone', area: null, kind: 'unclear', message: 'x', proposal: 'y' },
    { section: 'traction', card: 'c-traction', area: 'zz', kind: 'unclear', message: 'x', proposal: 'y' },
    { section: 'traction', card: 'c-traction', area: 't1', kind: 'contradicts', message: 'The card says 40 teams.', proposal: 'Fix it.' },
    { section: 'pricing', card: 'c-traction', area: null, kind: 'unclear', message: 'x', proposal: 'y' },
    { section: 'solution', card: 'c-solution', area: null, kind: 'chat', message: 'x', proposal: 'y' },
    { section: 'solution', card: null, area: null, kind: 'unclear', message: 'No card.', proposal: 'y' },
    { section: 'solution', card: 'c-solution', area: 's2', kind: 'unclear', message: 'See https://x.example for more.', proposal: 'y' },
  ] }, cards, 7);
  assert.deepEqual(got.findings.map((f) => [f.section, f.kind, f.card_uid, f.area?.id ?? null, f.href]), [
    ['traction', 'unclear', 'c-traction', 't3', '/raise/pitch/edit?project_id=7&card=c-traction&area=c8-12r4-6'],
    ['problem', 'missing', null, null, null],
  ]);
  assert.equal(got.findings[0].proposal, 'Name the kind of team that pays.');
  assert.deepEqual(got.dropped.map((d) => d.reason), ['card_not_on_deck', 'area_not_on_card', 'figure', 'unknown_section', 'unknown_kind', 'no_card', 'link_added']);
  assert.equal(COACH_OPTION, 'review:narrative-coach');
});

// ─────────────────────────────────────────────────────────── the routes

async function fixture({ answer = { findings: [] } as unknown, balance = 5000000, slides = SLIDES as unknown, deck = true } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec(mig('465_ai_rail_preferences.sql'));
  f.db.exec(mig('506_ai_rail_proposals.sql'));
  f.db.exec(`ALTER TABLE users ADD COLUMN founder_id INTEGER;
    UPDATE users SET founder_id = 20, subscription_tier = 'studio', name = 'Fay Founder' WHERE id = 2;
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    ALTER TABLE activity_logs ADD COLUMN entity_type TEXT;
    ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;
    ALTER TABLE activity_logs ADD COLUMN created_at TEXT DEFAULT (datetime('now'));
    CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, name TEXT, solution TEXT);
    INSERT INTO projects VALUES (1, 20, NULL, 'Kestrel Labs', NULL);
    CREATE TABLE project_members (project_id INTEGER, user_id INTEGER, role TEXT, status TEXT);
    CREATE TABLE pitch_decks (id INTEGER PRIMARY KEY, project_id INTEGER, version INTEGER, slides TEXT, is_current INTEGER, card_hashes TEXT);`);
  f.db.exec(`CREATE TABLE spinout_deck_overrides (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, field_key TEXT NOT NULL, value TEXT,
    updated_by INTEGER, updated_at TEXT DEFAULT (datetime('now')), version INTEGER NOT NULL DEFAULT 0, investor_type TEXT, deck_version INTEGER,
    UNIQUE (project_id, version, field_key))`);
  f.db.exec(between(mig('463_raise_record_stores.sql'), 'CREATE TABLE IF NOT EXISTS narrative_version_meta'));
  f.db.exec(mig('544_narrative_sections.sql'));
  f.db.exec(`INSERT INTO spinout_deck_overrides (project_id, field_key, value, version, investor_type) VALUES
      (1, '__version__', 'seed_fund', 2, 'seed_fund'),
      (1, 'traction.takeaway', 'MRR reached $16,950 from 42 paying customers in 6 months.', 2, 'seed_fund'),
      (1, '__version__', 'seed_fund', 3, 'seed_fund');
    INSERT INTO narrative_version_meta (project_id, version, start_from, created_by) VALUES (1, 2, 'blank', 2), (1, 3, 'blank', 2);`);
  if (deck) {
    f.db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (30, 1, 4, ?, 0), (31, 1, 5, ?, 1)')
      .run(JSON.stringify([SLIDES[0]]), typeof slides === 'string' ? slides : JSON.stringify(slides));
  }
  setFixtureAllowance(f.db, 0);
  if (balance) f.db.exec(`INSERT INTO ai_topup_accounts(user_id, balance_microusd) VALUES (2, ${balance})`);
  const prompts: string[] = [];
  const env: any = {
    DB: f.DB, JWT_SECRET: 'p'.repeat(64), ENVIRONMENT: 'development',
    AI: withGuard({ run: async (_model: string, input: any) => {
      prompts.push(JSON.stringify(input?.messages ?? input));
      return { response: typeof answer === 'string' ? answer : JSON.stringify(answer), usage: { prompt_tokens: 30, completion_tokens: 20 } };
    } }),
  };
  const jwt = async (id: number) => new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const app = new Hono(); app.route('/api/cycles/raise', cycleRaise);
  const call = async (method: string, path: string, body?: unknown, { who = 2, headers = {} as Record<string, string> } = {}) => {
    const sep = path.includes('?') ? '&' : '?';
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const r = await app.request(`/api/cycles/raise${path}${sep}project=1`, {
        method, headers: { Authorization: `Bearer ${await jwt(who)}`, 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }, env);
      const raw = await r.text();
      return { status: r.status, body: raw ? JSON.parse(raw) : null };
    } finally { [console.warn, console.error] = saved; }
  };
  const usage = () => f.db.prepare('SELECT task, rail_option FROM ai_usage_logs ORDER BY id').all() as any[];
  const count = (t: string) => Number((f.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n);
  return { ...f, call, prompts, usage, count };
}

const PRESS = { 'X-Rail-Option': encodeURIComponent(COACH_OPTION), 'X-Rail-Page': encodeURIComponent(PAGE) };

test('GET /deck-ready reads the current version, free: its rows link to each card and area, with no run', async () => {
  const f = await fixture();
  const r = await f.call('GET', '/deck-ready');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.state, 'not_ready');
  assert.equal(r.body.deck_id, 31, 'the current version, not the older one');
  assert.equal(r.body.label, 'Deck ready to send · 5 to fix');
  assert.equal(r.body.rows[0].href, '/raise/pitch/edit?project_id=1&card=c-solution&area=c1-6r2-4');
  assert.equal(f.usage().length, 0, 'nothing runs');
  const ready = await fixture({ slides: [SLIDES[0]] });
  assert.deepEqual((await ready.call('GET', '/deck-ready')).body, { state: 'ready', deck_id: 31, version: 5, rows: [], label: 'Deck ready to send' });
  const none = await fixture({ deck: false });
  assert.equal((await none.call('GET', '/deck-ready')).body.state, 'no_deck');
  const broken = await fixture({ slides: '{not json' });
  const b = await broken.call('GET', '/deck-ready');
  assert.equal(b.status, 503, 'an unreadable deck is never "ready"');
  const notList = await fixture({ slides: '{"cards":[]}' });
  assert.equal((await notList.call('GET', '/deck-ready')).status, 503, 'cards that are not a list are unreadable, never an empty deck');
});

test('the coach: one run under review:narrative-coach, figures masked, findings kept with their links, nothing written', async () => {
  const f = await fixture({ answer: { findings: [
    { section: 'traction', card: 'c-traction', area: 't3', kind: 'unclear', message: 'The traction card does not say who pays.', proposal: 'Name the kind of team that pays.' },
    { section: 'traction', card: 'c-traction', area: 't1', kind: 'contradicts', message: 'It says 40 teams.', proposal: 'Fix it.' },
  ] } });
  const before = f.count('pitch_decks') + f.count('spinout_deck_overrides');
  const r = await f.call('POST', '/narrative/2/coach', {}, { headers: PRESS });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.findings.map((x: any) => [x.card_uid, x.area.id, x.href]), [['c-traction', 't3', '/raise/pitch/edit?project_id=1&card=c-traction&area=c8-12r4-6']]);
  assert.deepEqual(r.body.dropped.map((d: any) => d.reason), ['figure']);
  assert.equal(r.body.deck_id, 31);
  assert.equal(r.body.ready.state, 'not_ready', 'the free item rides along');
  assert.deepEqual(f.usage().filter((u) => u.task === 'rail_write').map((u) => u.rail_option), [COACH_OPTION]);
  assert.equal(f.prompts.length >= 1, true);
  const sent = f.prompts.join('\n');
  assert.doesNotMatch(sent, /16,950|16950|18\.4|40%/, 'the narrative\'s and the cards\' figures never reach the model');
  assert.equal(f.count('pitch_decks') + f.count('spinout_deck_overrides'), before, 'nothing is written');
  // A call without the press's rail headers is still metered under the coach's own option.
  const bare = await fixture({ answer: { findings: [] } });
  assert.equal((await bare.call('POST', '/narrative/2/coach', {})).status, 200);
  assert.deepEqual(bare.usage().filter((u) => u.task === 'rail_write').map((u) => u.rail_option), [COACH_OPTION]);
});

test('the coach is refused before any run: version 0, a version with no words, no deck, a reader with no reason', async () => {
  const f = await fixture();
  assert.equal((await f.call('POST', '/narrative/0/coach', {}, { headers: PRESS })).status, 409);
  const empty = await f.call('POST', '/narrative/3/coach', {}, { headers: PRESS });
  assert.equal(empty.status, 422);
  assert.equal(empty.body.code, 'nothing_to_read');
  const none = await fixture({ deck: false });
  const n = await none.call('POST', '/narrative/2/coach', {}, { headers: PRESS });
  assert.equal(n.status, 409);
  assert.equal(n.body.code, 'no_deck');
  assert.equal((await f.call('POST', '/narrative/2/coach', {}, { headers: PRESS, who: 1 })).status >= 400, true, 'an admin never runs it');
  assert.equal(f.usage().length + none.usage().length, 0);
});
