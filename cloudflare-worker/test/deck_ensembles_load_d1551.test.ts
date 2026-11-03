/**
 * D1551 (#3798, deck v2 C3) — the load test, on the fake binding: five
 * founders build a 12-card deck at once, every text area through its
 * ensemble, each run under its own one hold, driven as the DeckGenRoom drives
 * it (`DRIVERS` drivers, the AiGovernor's per-account caps).
 *
 * THE CLOCK. Model calls take simulated time: a draft 3 to 8 s, a refine 2 to
 * 5 s, a judge 1 to 2 s (uniform, from a seeded generator, so a run is
 * repeatable). One simulated second is `SCALE` real milliseconds, and the
 * governor reads the simulated clock, so its buckets refill in simulated time.
 * What the Worker does between calls (D1, the runtime) takes real time and is
 * counted in, so the figures are, if anything, pessimistic.
 *
 * THE GATE (Phase C's Gamma gate). The first draft of a deck is when every
 * text area has words on screen: each step's first answered draft
 * (`onDraft`). Across the five runs, p50 ≤ 45 s and p95 ≤ 90 s. And the
 * money: one hold per run, settled once, at the sum of what the calls
 * charged, never above the quote.
 *
 * The capped staging run (12 cards × 5 founders on Workers AI) waits on owner
 * decision N, the evaluation spend cap (#3716). It is the PR's follow-up step.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_ensembles_load_d1551.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { D1GenRuntime, stepRecordRef, type PlanLine } from '../src/services/decks/genRuntime.ts';
import { stepExecutor } from '../src/services/decks/stepExecutor.ts';
import { Governor } from '../src/services/decks/aiGovernor.ts';
import { DRIVERS } from '../src/durable-objects/deck-gen-room.ts';
import { REFINE_INSTRUCTION, type RunOptions } from '../src/services/aiRouter.ts';
import { ensembleFor, judgeFor } from '../src/services/decks/ensembles.ts';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';

const mig = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');
const SCALE = 50; // real milliseconds per simulated second
const FOUNDERS = [10, 11, 12, 13, 14];
const CARDS = 12;
const WRITER = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const JUDGE = judgeFor(WRITER);
/** Per-call quotes, in micro-USD: what the plan holds for each call of each line. */
const PER_CALL = 1_000, PER_JUDGE = 300;
/** Each card's text areas, as the narrative build plans them: a title and a body; every third card also a callout. */
const AREAS = (card: number) => ['title', 'body', ...(card % 3 === 0 ? ['callout'] : [])];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };

function plan(founder: number): PlanLine[] {
  const lines: PlanLine[] = [];
  for (let c = 1; c <= CARDS; c++) {
    for (const element of AREAS(c)) {
      const e = ensembleFor(element, 'deck_build', 1);
      const calls = e.mode === 'best-of-n' ? e.n! : 2;
      const judge = e.mode === 'best-of-n' && JUDGE ? PER_JUDGE : 0;
      lines.push({
        card_uid: `c${c}`, area_id: `${element}-${c}`, element, kind: 'text', task: 'rail_write', model: WRITER,
        quote_microusd: calls * PER_CALL + judge,
        input: { messages: [{ role: 'user', content: `Write the ${element} for card ${c} of founder ${founder}.` }], maxTokens: 120, temperature: 0.4, ensemble: { ...e, judge_model: e.mode === 'best-of-n' ? JUDGE : null, judge_microusd: judge } },
      });
    }
  }
  return lines;
}

test('12 cards × 5 founders on the fake binding: first draft p50 ≤ 45 s and p95 ≤ 90 s, each run settled once within its quote', async () => {
  assert.ok(JUDGE, 'a judge of another family than the writer is offered');
  const f = aiBudgetFixture();
  f.db.exec(['525_ai_reservation_idempotency.sql', '632_ai_hold_context.sql'].map(mig).join('\n'));
  f.db.exec('CREATE TABLE IF NOT EXISTS pitch_decks (id INTEGER PRIMARY KEY, project_id INTEGER, version INTEGER, slides TEXT, title TEXT, is_current INTEGER)');
  f.db.exec(mig('716_deck_area_batches.sql'));
  f.db.exec(mig('752_deck_area_batches_seen.sql'));
  f.db.exec(mig('202611022120_deck_batch_runtime.sql'));
  setFixtureAllowance(f.db, 0);
  for (const u of FOUNDERS) {
    f.db.prepare("INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, 1, '[]', 'Synthetic', 1)").run(u, u);
    f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(u, 50_000_000);
  }
  const env: any = { DB: f.DB };

  const real0 = Date.now();
  const simNow = () => ((Date.now() - real0) / SCALE) * 1000; // simulated ms
  const sleep = (simMs: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, (simMs / 1000) * SCALE)));
  const g = new Governor();
  const governor = { acquire: async (i: any) => g.acquire(i, simNow()), release: async (id: string) => { g.release(id); } };
  const draw = rng(1551);
  const between = (lo: number, hi: number) => (lo + (hi - lo) * draw()) * 1000;

  // The fake binding: each call takes its simulated time and writes the usage row a real run writes (under the parent, by the step's ref).
  const calls = { draft: 0, refine: 0, judge: 0 };
  const run = async (_e: any, o: RunOptions) => {
    const judge = o.task === 'module_decision';
    const refine = !judge && (o.messages ?? []).some((m) => m.content === REFINE_INSTRUCTION);
    await sleep(judge ? between(1, 2) : refine ? between(2, 5) : between(3, 8));
    calls[judge ? 'judge' : refine ? 'refine' : 'draft']++;
    const charged = Math.round((judge ? PER_JUDGE : PER_CALL) * (0.5 + draw() / 2));
    const row = f.db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, ?, ?, ?, ?, ?)')
      .run(o.userId, o.task, judge ? JUDGE : WRITER, charged, o.parentHold?.uid ?? null, o.rail?.record ?? null);
    if (judge) return { ok: true, output: JSON.stringify({ best: { choice: 'A', confidence: 0.62, probabilities: { A: 0.62, B: 0.2, C: 0.18 } } }), usage: { model: JUDGE } as any, usageLogId: Number(row.lastInsertRowid) };
    return { ok: true, output: refine ? 'Refined, tighter words.' : 'Drafted words for this area.', usage: { model: WRITER } as any, usageLogId: Number(row.lastInsertRowid) };
  };

  const firstDraft = new Map<string, number>(); // batch uid → when its last area's first draft landed (simulated ms from its start)
  const started = new Map<string, number>();
  const drafted = new Map<string, Set<number>>();
  const execute = stepExecutor(env, {
    run: run as any, governor, sleep,
    onDraft: (step) => {
      const set = drafted.get(step.batch_uid) ?? new Set<number>();
      set.add(step.seq);
      drafted.set(step.batch_uid, set);
      firstDraft.set(step.batch_uid, simNow() - (started.get(step.batch_uid) ?? 0));
    },
  });

  const runs = await Promise.all(FOUNDERS.map(async (u) => {
    const rt = new D1GenRuntime(env, execute);
    const lines = plan(u);
    const a = await rt.admit({ deckId: u, projectId: u, userId: u, cls: 'deck_build', idemKey: `load-d1551-${u}`, lines });
    assert.ok(a.ok, JSON.stringify(a));
    started.set(a.ok ? a.uid : '', simNow());
    await Promise.all(Array.from({ length: DRIVERS }, () => rt.startBatch((a as any).uid)));
    const st = (await rt.status((a as any).uid))!;
    return { u, uid: st.uid, st, lines, done: simNow() - started.get(st.uid)! };
  }));

  const first = runs.map((r) => firstDraft.get(r.uid)! / 1000);
  const whole = runs.map((r) => r.done / 1000);
  const p50 = quantile(first, 0.5), p95 = quantile(first, 0.95);
  // Reported, so a reviewer reads the figures the gate was held to.
  console.log(`[D1551 load] first draft (s): ${first.map((x) => x.toFixed(1)).join(', ')} · p50 ${p50.toFixed(1)} · p95 ${p95.toFixed(1)} · whole run (s): ${whole.map((x) => x.toFixed(1)).join(', ')} · calls ${JSON.stringify(calls)}`);
  assert.ok(p50 <= 45, `first draft p50 ${p50.toFixed(1)} s is over 45 s`);
  assert.ok(p95 <= 90, `first draft p95 ${p95.toFixed(1)} s is over 90 s`);

  for (const r of runs) {
    assert.equal(r.st.state, 'done', `founder ${r.u}'s run ended ${r.st.state}`);
    assert.ok(r.st.steps.every((s) => s.state === 'done'), 'every area is written');
    assert.equal(drafted.get(r.uid)!.size, r.lines.length, 'every area had a first draft before its step ended');
    // The money: one hold, settled once, at what the calls charged, never above the quote.
    const holds = f.db.prepare('SELECT * FROM ai_budget_reservations WHERE user_id = ?').all(r.u) as any[];
    assert.equal(holds.length, 1, 'one hold per run');
    const h = holds[0];
    assert.equal(h.status, 'settled');
    const charged = Number((f.db.prepare('SELECT COALESCE(SUM(charged_microusd), 0) AS n FROM ai_usage_logs WHERE reservation_uid = ?').get(h.uid) as any).n);
    const settled = Number(h.actual_included_microusd) + Number(h.actual_topup_microusd);
    assert.equal(settled, charged, 'settled at the sum of every call, the judges included');
    assert.ok(settled <= Number(r.st.quote_microusd), 'never above the quote');
    for (const s of r.st.steps) {
      const byRef = Number((f.db.prepare('SELECT COALESCE(SUM(charged_microusd), 0) AS n FROM ai_usage_logs WHERE reservation_uid = ? AND record_ref = ?').get(h.uid, stepRecordRef(r.uid, s.seq)) as any).n);
      assert.equal(Number(s.charged_microusd), Math.min(byRef, Number(s.quote_microusd)), 'each step charged its own calls');
      const res = JSON.parse(String(s.result));
      assert.equal(res.ensemble.mode, s.element === 'body' ? 'draft-refine' : 'best-of-n');
    }
  }
  // Every title and callout was judged; every body refined.
  const lines = runs.reduce((n, r) => n + r.lines.length, 0);
  const bodies = FOUNDERS.length * CARDS;
  assert.equal(calls.refine, bodies);
  assert.equal(calls.judge, lines - bodies);
  assert.equal(calls.draft, bodies + (lines - bodies) * 3);
});
