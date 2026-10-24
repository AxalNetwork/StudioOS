// Task #14 — Deck autofill: zero-whole-slide-placeholder guarantee.
//
// Builds a fake D1 env populated with a fully-filled project +
// financial_models.computed_json + cap_table_holders rows, then runs
// `autofillDeck()` against the three core templates (YC seed, Series A
// growth, Series B diligence) and asserts:
//
//   1. No SLIDE renders entirely as the '—' placeholder — every slide
//      gets at least one data-sourced field. (The bug we are fixing
//      was "whole slides fade to dashes".)
//   2. Every field whose `sources` includes a `project.*` /
//      `financials.*` / `captable.*` expression resolves to actual
//      data, never the placeholder. AI-only fields are allowed to
//      stay '—' when the AI binding is offline (the deliberate stub
//      in this test) — those are creative hints layered on top, not
//      the schema-coverage problem #14 is fixing.
//
// Pure node:test — runs in the worker package's `npm test` alongside
// auth_google.test.ts, telegram.redactCheck.test.ts, etc.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autofillDeck } from '../src/services/decks/autofill.ts';
import { getMethod } from '../src/services/decks/methods.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';

/** Fake D1 env where every prepare() returns the project / financials /
 *  cap-table row the autofill resolver expects, regardless of the SQL.
 *  D767 (#2096): any other statement (the router's hold, guard and usage
 *  row) goes to a real AI-budget ledger, funded for user 2. */
function makeEnv(opts: { project: any; financials: any; holders: any[] }) {
  __resetForTest();
  const ledger = aiBudgetFixture();
  ledger.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:free',0,0,1)").run();
  ledger.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  const { project, financials, holders } = opts;
  const matcher = (sql: string) => {
    const s = sql.toLowerCase();
    if (s.includes('from projects')) return { first: async () => project, all: async () => ({ results: [project] }) };
    if (s.includes('from financial_models')) return { first: async () => financials, all: async () => ({ results: [financials] }) };
    if (s.includes('from cap_table_holders')) return { first: async () => holders[0] || null, all: async () => ({ results: holders }) };
    if (s.includes('from scoring_snapshots')) return { first: async () => null, all: async () => ({ results: [] }) };
    return null;
  };
  return {
    DB: {
      batch: (stmts: any[]) => ledger.DB.batch(stmts),
      prepare(sql: string) {
        const r = matcher(sql);
        if (!r) return ledger.DB.prepare(sql);
        return {
          bind: (..._args: any[]) => ({
            first: r.first,
            all: r.all,
            run: async () => ({ success: true }),
          }),
          first: r.first,
          all: r.all,
        };
      },
    },
    ENVIRONMENT: 'development',
    // D767: the fill is one router run on Workers AI. This stub answers a
    // value for every requested hint, so AI-only fields (gtm.*,
    // competition.*, etc.) resolve too, as they do in production.
    AI: withGuard({ run: async (_model: string, input: any) => ({ response: JSON.stringify(stubHints(input)), usage: { prompt_tokens: 10, completion_tokens: 10 } }) }),
  } as any;
}

function stubHints(input: any): Record<string, any> {
  const prompt = (input?.messages || []).map((m: any) => (typeof m?.content === 'string' ? m.content : '')).join('\n');
  const m = prompt.match(/Hints:\s*(\[[^\]]+\])/);
  let hints: string[] = [];
  if (m) { try { hints = JSON.parse(m[1]); } catch { /* none */ } }
  const out: Record<string, any> = {};
  for (const h of hints) {
    out[h] = /_bullets|_channels|_motion|_landscape|_quarters|_uses|_milestones|_hiring/.test(h)
      ? ['stubbed bullet one', 'stubbed bullet two', 'stubbed bullet three']
      : `Stubbed AI value for ${h}`;
  }
  return out;
}

const WHO = { userId: 2, railOption: 'fill_from_project' as const, projectId: 1 };

// D767: no network. The fill never reaches api.openai.com; a fetch throws.
globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;

const FULL_PROJECT = {
  id: 1,
  founder_id: 1,
  name: 'Acme AI',
  description: 'Agentic CRM for SMBs.',
  sector: 'B2B SaaS',
  stage: 'Seed',
  tagline: 'The CRM that closes itself.',
  logo_url: 'https://example.com/logo.png',
  vision: 'A world where every SMB owner has an AI co-pilot for sales.',
  traction_summary: '40 paying logos, $35k MRR, 18% MoM growth.',
  contact_email: 'founders@acme.ai',
  problem_statement: 'SMB founders spend 12h/wk on CRM data entry.',
  solution: 'An agent that fills the CRM from email + calls automatically.',
  why_now: 'LLM cost dropped 40x; SMB tooling budgets unfrozen post-2025.',
  tam: 80_000_000_000,
  sam: 12_000_000_000,
  som: 600_000_000,
  users_count: 1240,
  revenue: 420_000,
  growth_signals: '18% MoM, 3.2x net retention, 28 inbound demos/wk.',
  funding_needed: 3_000_000,
  use_of_funds: 'Eng (60%), GTM (30%), G&A (10%).',
  cost_to_mvp: 250_000,
  cac: 220,
  gross_margin_pct: 78,
};

const FULL_FINANCIALS = {
  id: 1,
  project_id: 1,
  computed_json: JSON.stringify({
    runway_months: 18,
    avg_monthly_burn: 165_000,
    ending_cash: 2_100_000,
    total_revenue_horizon: 4_800_000,
    ltv: 4_400,
    ltv_cac_ratio: 20,
    breakeven_month: 22,
  }),
};

const FULL_HOLDERS = [
  { id: 1, project_id: 1, name: 'Alice (CEO)', kind: 'founder', shares: 4_500_000 },
  { id: 2, project_id: 1, name: 'Bob (CTO)', kind: 'founder', shares: 4_500_000 },
  { id: 3, project_id: 1, name: 'ESOP', kind: 'option pool', shares: 1_000_000 },
];

// Walk a filled-slide value bag (which may contain strings, arrays, or
// nested arrays of {label, value}) and yield every string leaf. Used to
// assert no leaf equals '—'.
function* leaves(v: any): Generator<string> {
  if (v == null) return;
  if (typeof v === 'string') { yield v; return; }
  if (Array.isArray(v)) {
    for (const x of v) yield* leaves(x);
    return;
  }
  if (typeof v === 'object') {
    for (const k of Object.keys(v)) yield* leaves(v[k]);
  }
}

function hasNonPlaceholderLeaf(field: any): boolean {
  for (const leaf of leaves(field?.value)) {
    if (leaf !== '—' && leaf.trim().length > 0) return true;
  }
  // Image fields with a URL also count as "filled".
  if (field?.kind === 'image' && typeof field.value === 'string' && field.value) return true;
  return false;
}

for (const methodId of ['yc_seed', 'series_a_growth', 'series_b_diligence']) {
  test(`autofill: ${methodId} — zero slides render entirely as '—'`, async () => {
    const method = getMethod(methodId);
    assert.ok(method, `method ${methodId} should exist`);
    const env = makeEnv({ project: FULL_PROJECT, financials: FULL_FINANCIALS, holders: FULL_HOLDERS });
    const filled = await autofillDeck(env, method!, FULL_PROJECT.id, WHO);
    assert.equal(filled.slides.length, method!.slides.length, 'slide count matches template');

    // (1) Every slide must contain at least one non-placeholder leaf.
    const blankSlides: string[] = [];
    for (const slide of filled.slides) {
      const any = Object.values(slide.fields).some(hasNonPlaceholderLeaf);
      if (!any) blankSlides.push(slide.spec_id);
    }
    assert.equal(
      blankSlides.length, 0,
      `expected every slide to have at least one data-sourced field, ` +
      `but these were entirely '—': ${blankSlides.join(', ')}`,
    );

    // (2) Every field whose schema sources include a non-AI expression
    //     must resolve to data (not the placeholder). This is the real
    //     schema-coverage assertion — if a project.* / financials.* /
    //     captable.* source is listed but the column is missing or
    //     the resolver is wrong, this fails.
    const dataOffenders: string[] = [];
    for (let i = 0; i < filled.slides.length; i++) {
      const fSlide = filled.slides[i];
      const spec = method!.slides[i];
      for (const fieldSpec of spec.fields || []) {
        const hasNonAi = (fieldSpec.sources || []).some((s: string) => !s.startsWith('ai.'));
        if (!hasNonAi) continue;
        const filledField: any = (fSlide.fields as any)[fieldSpec.key];
        if (!filledField || filledField.source !== 'data') {
          dataOffenders.push(`${fSlide.spec_id}.${fieldSpec.key}`);
        }
      }
    }
    assert.equal(
      dataOffenders.length, 0,
      `expected every field with a non-AI source to resolve from data, ` +
      `but these did not: ${dataOffenders.slice(0, 20).join(', ')}`,
    );
  });
}

test('D895: an AI-only filled field contributes no recorded coverage', async () => {
  const env = makeEnv({ project: FULL_PROJECT, financials: FULL_FINANCIALS, holders: FULL_HOLDERS });
  const method = { ...getMethod('yc_seed')!, slides: [{ id: 'only-ai', title: 'Only AI', fields: [{ key: 'copy', label: 'Copy', kind: 'paragraph' as const, sources: ['ai.problem_body'] }] }] };
  const filled = await autofillDeck(env, method, FULL_PROJECT.id, WHO);
  assert.equal(filled.slides[0].fields.copy.source, 'ai');
  assert.equal(filled.slides[0].coverage_pct, 0);
  assert.equal(filled.total_coverage_pct, 0);
});
