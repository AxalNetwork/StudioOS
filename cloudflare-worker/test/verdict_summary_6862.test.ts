/**
 * D6862 (#6862, D6021 V17/V18) — Eadwyn's read of the evidence offered for one
 * decision: rows, each citing one evidence key the server checked, grouped by
 * the server, never a choice. The model is a stub; the schema is the real
 * migrated one.
 *
 *   1. parseSummary: lines matched by token, a token the server did not give
 *      dropped, a line that reads as a choice falls back to the row's label,
 *      an unreadable reply is null, and the model cannot move a row's group;
 *   2. the route: the founder's run, Contradicts first, Checked but not counted
 *      with its reason, what would change it from the hypothesis, and the
 *      prompt framed as untrusted record text;
 *   3. refusals before any model runs: not the founder, a support session,
 *      unknown evidence, no evidence, a hypothesis of another venture;
 *   4. the run's own refusals: Eadwyn off, a budget stop, unreachable,
 *      unmatched; and the quote, which runs nothing.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/verdict_summary_6862.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { createVerdictSummaryRouter } from '../src/routes/verdict_summary.ts';
import { parseSummary, type SummaryFacts } from '../src/services/verdictSummary.ts';
import type { EvidenceItem } from '../src/services/verdict.ts';
import { isFramed, UNTRUSTED_RULE } from '../src/services/ai/untrusted.ts';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 10, ADMIN = 30, PARTNER = 40, OTHER_FOUNDER = 20;
const P = 1, P_OTHER = 2;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner', [OTHER_FOUNDER]: 'founder' };

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = OFF');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER_FOUNDER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme Dispatch', 1001), (${P_OTHER}, 'Beta Freight', 1002)`);
  const h = (db.prepare(`INSERT INTO hypotheses (project_id, code, claim, success_bar, deadline)
    VALUES (?, 'H2', 'They will pay', '3 of 10 visitors ask for a trial', '2026-11-30') RETURNING id`).get(P) as any).id;
  const foreignH = (db.prepare("INSERT INTO hypotheses (project_id, code, claim) VALUES (?, 'H1', 'Not yours') RETURNING id").get(P_OTHER) as any).id;
  return { db, h, foreignH };
}

/** Five rows for H2: two contradicting interviews, one supporting signal, a second link to interview 1, an unobserved experiment. */
const evidence = (h: number): EvidenceItem[] => [
  { id: 'pain-1-1', kind: 'interview', ref_id: '1', label: 'Jo Sample · no budget for a tool', strength: 'anecdote', direction: 'contradicts', date: '2026-10-21', hypothesis_id: h },
  { id: 'pain-2-2', kind: 'interview', ref_id: '2', label: 'Tim Sample · buys inside the ERP', strength: 'anecdote', direction: 'contradicts', date: '2026-11-12', hypothesis_id: h },
  { id: 'evidence-3', kind: 'signal', ref_id: 's3', label: 'Waitlist request', strength: 'anecdote', direction: 'supports', date: '2026-10-21', hypothesis_id: h },
  { id: 'pain-4-1', kind: 'interview', ref_id: '1', label: 'Jo Sample · finance owns budgets', strength: null, direction: 'contradicts', date: '2026-10-21', hypothesis_id: h },
  { id: 'evidence-5', kind: 'experiment', ref_id: 'x5', label: 'Pricing page experiment', strength: null, direction: 'supports', date: '2026-11-03', hypothesis_id: h, observed: false },
];
const KEYS = ['pain-1-1', 'pain-2-2', 'evidence-3', 'pain-4-1', 'evidence-5'];

type Call = { messages?: Array<{ role: string; content: string }>; systemPrompt?: string; surface?: string };
function harness(db: DatabaseSync, h: number, runResult: (call: Call) => any, quoteResult: () => any = () => ({ ok: true, hold_microusd: 40000, model: 'm' })) {
  const calls: Call[] = [];
  const quotes: Call[] = [];
  const router = createVerdictSummaryRouter({
    runner: (async (_env: unknown, opts: Call) => { calls.push(opts); return runResult(opts); }) as any,
    quoter: (async (_env: unknown, opts: Call) => { quotes.push(opts); return quoteResult(); }) as any,
    evidenceSource: async (_env, projectId) => (projectId === P ? evidence(h) : []),
  });
  const app = new Hono<any>();
  app.route('/api/cycles/validate/decision-summary', router);
  const call = async (who: number, body: unknown, { path = '', project = P, extra = {} }: { path?: string; project?: number; extra?: Record<string, unknown> } = {}) => {
    const token = await new SignJWT({ user_id: who, role: ROLE[who], ...extra }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const res = await app.request(`/api/cycles/validate/decision-summary${path}?project=${project}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
      return { status: res.status, body: await res.json() as any };
    } finally { [console.warn, console.error] = saved; }
  };
  return { call, calls, quotes };
}

const reply = (rows: Array<{ row: string; text: string }>) => ({ ok: true, output: JSON.stringify({ rows }), usage: { model: 'm', est_cost_usd: 0.01 } });

test('1. parseSummary keeps the server’s rows and groups, and never a choice', () => {
  const facts = {
    items: [
      { id: 'a', kind: 'interview', label: 'Row A', strength: null, direction: 'contradicts', date: null, excluded: null },
      { id: 'b', kind: 'signal', label: 'Row B', strength: null, direction: 'supports', date: null, excluded: null },
      { id: 'c', kind: 'interview', label: 'Row C', strength: null, direction: 'supports', date: null, excluded: 'duplicate_source' },
    ],
    coverage: { counted: 2, bar: 5, sources: 2, links: 3, interviews: 1, state: 'withheld', excluded: [] },
    change: null,
  } as unknown as SummaryFacts;
  const rows = parseSummary('Here: {"rows":[{"row":"E1","text":"No budget"},{"row":"E9","text":"Invented"},{"row":"E2","text":"You should proceed"},{"row":"E1","text":"Second"}]}', facts)!;
  assert.deepEqual(rows.map((r) => [r.key, r.group, r.text, r.from_label]), [
    ['a', 'contradicts', 'No budget', false],
    // A line that reads as a choice falls back to the row's own label.
    ['b', 'supports', 'Row B', true],
    // A row the model left out keeps its label, and its group is the server's.
    ['c', 'not_counted', 'Row C', true],
  ]);
  assert.equal(rows[2].reason, 'duplicate_source');
  for (const word of ['Pivot now', 'Stop here', 'I recommend this', 'We must act']) {
    assert.equal(parseSummary(JSON.stringify({ rows: [{ row: 'E1', text: word }] }), facts), null, word);
  }
  assert.equal(parseSummary('not json', facts), null);
  assert.equal(parseSummary(JSON.stringify({ rows: [{ row: 'E7', text: 'x' }] }), facts), null);
});

test('2. the founder’s run: Contradicts first, not counted with why, what would change it, framed prompt', async () => {
  const { db, h } = fixture();
  const { call, calls } = harness(db, h, () => reply([
    { row: 'E1', text: 'No budget for a standalone tool' }, { row: 'E2', text: 'Would buy it inside the ERP' },
    { row: 'E3', text: 'Would try it next quarter' }, { row: 'E4', text: 'Same person again' }, { row: 'E5', text: 'No result yet' },
  ]));
  const r = await call(FOUNDER, { for: `h-${h}`, evidence: KEYS });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rows.map((x: any) => [x.key, x.group, x.reason]), [
    ['pain-1-1', 'contradicts', null], ['pain-2-2', 'contradicts', null], ['evidence-3', 'supports', null],
    ['pain-4-1', 'not_counted', 'duplicate_source'], ['evidence-5', 'not_counted', 'no_observed_result'],
  ]);
  assert.deepEqual(r.body.keys, KEYS);
  assert.deepEqual([r.body.coverage.counted, r.body.coverage.bar, r.body.coverage.state], [3, 5, 'withheld']);
  assert.deepEqual(r.body.change, { code: 'H2', disproof: null, success_bar: '3 of 10 visitors ask for a trial', deadline: '2026-11-30' });
  assert.equal(calls.length, 1);
  const prompt = calls[0].messages!.map((m) => m.content).join('\n');
  assert.ok(isFramed(prompt, 'record_text'), 'the rows travel as untrusted record text');
  assert.ok(calls[0].systemPrompt!.includes(UNTRUSTED_RULE));
  assert.ok(!prompt.includes('pain-1-1'), 'the model sees tokens, never the keys');
  assert.equal(calls[0].surface, '/validate/verdict');
  assert.ok(!('reasoning' in r.body) && !('decision' in r.body), 'no choice and nothing to save');
});

test('3. refused before any model runs', async () => {
  const { db, h, foreignH } = fixture();
  const { call, calls, quotes } = harness(db, h, () => reply([{ row: 'E1', text: 'x' }]));
  for (const who of [ADMIN, PARTNER, OTHER_FOUNDER]) {
    assert.equal((await call(who, { for: `h-${h}`, evidence: KEYS })).status, 403, `user ${who}`);
  }
  const support = await call(FOUNDER, { for: `h-${h}`, evidence: KEYS }, { extra: { impersonated_by: ADMIN } });
  assert.equal(support.status, 403);
  assert.equal(support.body.error, 'support_session_refused');
  const unknown = await call(FOUNDER, { for: `h-${h}`, evidence: ['pain-1-1', 'pain-99-9'] });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'evidence_not_found');
  const none = await call(FOUNDER, { for: `h-${h}`, evidence: [] });
  assert.equal(none.status, 409);
  assert.equal(none.body.error, 'no_evidence');
  assert.equal((await call(FOUNDER, { for: `h-${foreignH}`, evidence: KEYS })).status, 404);
  assert.equal((await call(FOUNDER, { for: 'everything', evidence: KEYS })).status, 400);
  assert.equal((await call(FOUNDER, { for: `h-${h}`, evidence: KEYS }, { path: '/quote', extra: { impersonated_by: ADMIN } })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal(quotes.length, 0);
});

test('4. the run’s own refusals, and the quote', async () => {
  const { db, h } = fixture();
  const body = { for: `h-${h}`, evidence: KEYS };
  const off = await harness(db, h, () => ({ ok: false, refusal: 'assist_off', usage: {} })).call(FOUNDER, body);
  assert.equal(off.status, 403);
  assert.equal(off.body.error, 'assist_off');
  const budget = await harness(db, h, () => ({ ok: false, refusal: 'budget_user_month', usage: {} })).call(FOUNDER, body);
  assert.equal(budget.status, 402);
  const down = await harness(db, h, () => ({ ok: false, refusal: 'provider_error', error: 'upstream text', usage: {} })).call(FOUNDER, body);
  assert.equal(down.status, 503);
  assert.equal(down.body.error, 'model_unavailable');
  assert.ok(!JSON.stringify(down.body).includes('upstream text'), 'the provider’s words stay in the log');
  const unmatched = await harness(db, h, () => ({ ok: true, output: 'I think you should pivot.', usage: { model: 'm', est_cost_usd: 0 } })).call(FOUNDER, body);
  assert.equal(unmatched.status, 503);
  assert.equal(unmatched.body.error, 'summary_unmatched');

  const q = harness(db, h, () => { throw new Error('the quote never runs'); });
  const quote = await q.call(FOUNDER, body, { path: '/quote' });
  assert.deepEqual(quote.body, { ai: true, hold_microusd: 40000, model: 'm' });
  assert.equal(q.calls.length, 0);
  const quoteOff = await harness(db, h, () => null, () => ({ ok: false, refusal: 'assist_off', error: '' })).call(FOUNDER, body, { path: '/quote' });
  assert.equal(quoteOff.body.ai, false);
  assert.equal(quoteOff.body.reason, 'assist_off');
});
