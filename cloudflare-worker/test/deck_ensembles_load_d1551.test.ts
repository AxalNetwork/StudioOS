/**
 * D1551 (#3798, deck v2 C3) — the load test on the fake binding: 12 cards ×
 * 5 founders at once, each a whole-deck build drafted and refined (AUTO-1),
 * each run with its six drivers (`DeckGenRoom.DRIVERS`) under its one hold.
 *
 * The Gamma gate for Phase C: the first full draft (every area of every card
 * has its first words) lands at p50 ≤ 45 s and p95 ≤ 90 s across the founders.
 *
 * THE FAKE BINDING. No model is called. Each call takes a latency drawn,
 * from a fixed seed, from 1.5 s to 6 s, skewed to its low end (median about
 * 2.6 s), the range a short text run on the routed models answers in. Time is
 * scaled down by `SCALE`, and the run's own work (D1, the claims, the usage
 * rows) is counted at the same scale, so the figures read high, never low.
 * What this measures is the runtime: the fan-out, the order of drafts before
 * second passes, and one hold per run. The AiGovernor's pacing has its own
 * tests and is stubbed open here. The capped staging run with real models
 * waits on owner decision N (#3716) and is a follow-up step, not this test.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_ensembles_load_d1551.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { parseRequest, planAreas, type PlanCtx } from '../src/services/decks/areas.ts';
import { D1GenRuntime } from '../src/services/decks/genRuntime.ts';
import { stepExecutor } from '../src/services/decks/stepExecutor.ts';
import { DRIVERS } from '../src/durable-objects/deck-gen-room.ts';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const FOUNDERS = 5, CARDS = 12;
/** Simulated milliseconds per real millisecond. */
const SCALE = 20;
const P50_S = 45, P95_S = 90;

const M716 = readFileSync('cloudflare-worker/sql/migrations/716_deck_area_batches.sql', 'utf8');
const M752 = readFileSync('cloudflare-worker/sql/migrations/752_deck_area_batches_seen.sql', 'utf8');
const RUNTIME_COLUMN = readFileSync('cloudflare-worker/sql/migrations/202611022120_deck_batch_runtime.sql', 'utf8');
const HOLD_COLUMNS = ['525_ai_reservation_idempotency.sql', '632_ai_hold_context.sql'].map((n) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8')).join('\n');

/** A seeded generator (mulberry32), so every run of the test draws the same latencies. */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** 1.5 s to 6 s, skewed low (the square of a uniform draw). */
const latencyMs = (r: () => number) => 1500 + 4500 * r() ** 2;

function deckCards(founder: number) {
  return Array.from({ length: CARDS }, (_, i) => ({
    uid: `f${founder}-card-${i + 1}`, title: `Card ${i + 1} of founder ${founder}`, notes: '',
    blocks: [
      { id: `t${i}`, kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: `Kestrel, card ${i + 1}` },
      { id: `b${i}`, kind: 'text', grid: { c1: 1, c2: 7, r1: 2, r2: 6 }, style: 'paragraph', text: 'Audits take weeks. Kestrel reads the ledger and flags what matters.' },
    ],
  }));
}

function planCtx(founder: number, cards: any[]): PlanCtx {
  return {
    userId: 60 + founder, projectId: 10 + founder, deckId: 500 + founder, cards, aspect: '16:9', voice: null,
    quote: async (o: any) => ({ ok: true, hold_microusd: 1200, model: o.model ?? MODEL }),
    modelFor: async (element: string) => ({ element, model: MODEL, source: 'default', locked: false, set_by: null, stale: [], plan_blocked: [], notice: null, switched_off: [] }) as any,
    venture: async () => ({ available: false, code: 'x', line: 'x' }) as any,
    sources: async () => [], art: async () => ({ seed_base: 'a'.repeat(32), art: {} as any }),
  } as any;
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

test(`load: ${CARDS} cards × ${FOUNDERS} founders, drafted and refined, first full draft at p50 ≤ ${P50_S} s and p95 ≤ ${P95_S} s`, async () => {
  const f = aiBudgetFixture();
  f.db.exec(HOLD_COLUMNS);
  f.db.exec('CREATE TABLE IF NOT EXISTS pitch_decks (id INTEGER PRIMARY KEY, project_id INTEGER, version INTEGER, slides TEXT, title TEXT, is_current INTEGER)');
  f.db.exec(M716); f.db.exec(M752); f.db.exec(RUNTIME_COLUMN);
  setFixtureAllowance(f.db, 0);
  try {
    const draw = rng(3798);
    const firstDraftAt = new Map<string, number>(); // run uid → when its last draft landed (real ms)
    const draftsLeft = new Map<string, number>();
    const run = async (_env: any, o: any) => {
      await new Promise((r) => setTimeout(r, latencyMs(draw) / SCALE));
      const ref = String(o.rail?.record ?? '');
      const row = f.db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, ?, ?, ?, ?, ?)')
        .run(o.userId, o.task, o.model ?? MODEL, 400, o.parentHold?.uid ?? null, ref);
      const refining = /improve one draft/.test(String(o.systemPrompt ?? ''));
      if (!refining) {
        const uid = ref.split(':')[1];
        const left = (draftsLeft.get(uid) ?? 0) - 1;
        draftsLeft.set(uid, left);
        if (left === 0) firstDraftAt.set(uid, Date.now());
      }
      return { ok: true, output: refining ? 'Kestrel flags what matters in hours.' : 'Kestrel reads the ledger.', usage: { model: o.model ?? MODEL }, usageLogId: Number(row.lastInsertRowid), attempts: [] };
    };
    const governor = { acquire: async () => ({ ok: true, lease: { id: 'open' } }), release: async () => {} } as any;
    const runtime = new D1GenRuntime({ DB: f.DB } as any, stepExecutor({ DB: f.DB } as any, { run, governor, sleep: async () => {} }));

    const runs: Array<{ uid: string; quote: number; drafts: number }> = [];
    for (let k = 1; k <= FOUNDERS; k++) {
      const cards = deckCards(k);
      f.db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(500 + k, 10 + k, JSON.stringify(cards), `Deck ${k}`);
      f.db.prepare('INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (?, ?)').run(60 + k, 50_000_000);
      // Three text areas a card: the heading, the paragraph and an empty callout.
      const areas = cards.flatMap((c) => [
        { id: c.blocks[0].id, grid: c.blocks[0].grid, element: 'title', card: c.uid },
        { id: c.blocks[1].id, grid: c.blocks[1].grid, element: 'body', card: c.uid },
        { id: `free:${c.uid}`, grid: { c1: 8, c2: 12, r1: 2, r2: 4 }, element: 'callout', card: c.uid },
      ]);
      const req = parseRequest({ class: 'deck_build', areas });
      assert.ok(!('refusal' in req), JSON.stringify(req));
      if ('refusal' in req) return;
      const plan = await planAreas(planCtx(k, cards), req);
      const drafts = plan.lines.filter((l) => l.kind === 'text').length;
      assert.equal(drafts, CARDS * 3, 'every area drafted');
      assert.equal(plan.lines.filter((l) => l.kind === 'refine').length, drafts, 'and each draft refined');
      const a = await runtime.admit({ deckId: 500 + k, projectId: 10 + k, userId: 60 + k, cls: 'deck_build', idemKey: `load-founder-${k}`, lines: plan.lines });
      assert.equal(a.ok, true, JSON.stringify(a));
      if (!a.ok) return;
      draftsLeft.set(a.uid, drafts);
      runs.push({ uid: a.uid, quote: a.quote_microusd, drafts });
    }

    const t0 = Date.now();
    await Promise.all(runs.map((r) => Promise.all(Array.from({ length: DRIVERS }, () => runtime.startBatch(r.uid)))));

    const seconds = runs.map((r) => {
      const at = firstDraftAt.get(r.uid);
      assert.ok(at, `run ${r.uid} drafted every area`);
      return ((at! - t0) * SCALE) / 1000;
    });
    const p50 = pct(seconds, 50), p95 = pct(seconds, 95);
    console.log(`first full draft, simulated: ${seconds.map((s) => s.toFixed(1)).join(' s, ')} s; p50 ${p50.toFixed(1)} s, p95 ${p95.toFixed(1)} s`);
    assert.ok(p50 <= P50_S, `p50 ${p50.toFixed(1)} s is over ${P50_S} s`);
    assert.ok(p95 <= P95_S, `p95 ${p95.toFixed(1)} s is over ${P95_S} s`);

    // Every run: every step done, one hold, settled within its one quote.
    for (const r of runs) {
      const st = f.db.prepare('SELECT state, charged_microusd, quote_microusd, reservation_uid FROM deck_area_batches WHERE uid = ?').get(r.uid) as any;
      assert.equal(st.state, 'done');
      assert.ok(Number(st.charged_microusd) <= Number(st.quote_microusd), 'never above the quote');
      const left = f.db.prepare("SELECT COUNT(*) AS n FROM deck_area_batch_steps WHERE batch_uid = ? AND state <> 'done'").get(r.uid) as any;
      assert.equal(left.n, 0);
    }
    const holds = f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get() as any;
    assert.equal(holds.n, FOUNDERS, 'one hold per run, none per step');
  } finally { f.db.close(); }
});
