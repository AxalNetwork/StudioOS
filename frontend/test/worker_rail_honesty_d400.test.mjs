/**
 * D400 — the AI rails say when a read failed, and stop calling the assistant
 * an advisor.
 *
 * Four defects, each of which put a false statement on screen:
 *
 *   1. A failed usage read rendered "Not recorded" on WorkerRail, and "$0.00"
 *      on AssistRail — `eadwynConfig` passed `spend_usd ?? 0`, and AssistRail
 *      fell back to a sum over pages that carry no spend. "Not recorded" says
 *      the log was read and holds nothing; "$0.00" says nothing was spent.
 *      Neither is known when the read failed.
 *   2. A failed PRICING read removed the model block without a word, so the
 *      page looked like one with no model to offer.
 *   3. The `advisory` surface's label rendered "Advisory assist".
 *   4. The RECOMMENDED badge (covered in worker_rail_models.test.mjs).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/worker_rail_honesty_d400.test.mjs
 * (from the repo root — the paths below are repo-relative)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import AssistRail from '../src/ui/AssistRail.jsx';
import { eadwynConfig, ASSIST_SURFACES } from '../src/ui/eadwynConfig.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = 'frontend/src/ui/WorkerRail.jsx';
const HOOK = 'frontend/src/hooks/useAiSpend.js';

/** The rendered `Usage this month` block of WorkerRail, from source. */
function usageBlock() {
  const src = codeOnly(read(RAIL));
  const from = src.indexOf('<span>Usage this month</span>');
  assert.ok(from > 0, 'the usage block was not found');
  return src.slice(from, src.indexOf('</section>', from));
}

// ── The hook ────────────────────────────────────────────────────────────

test('the hook reports a failed pricing read, separately from spend', () => {
  const src = codeOnly(read(HOOK));
  // The pricing branch must record its own error. It used to set pricing on
  // success and do nothing otherwise, so a failed read was indistinguishable
  // from a slow one.
  assert.match(src, /if \(p && !p\.__err\) \{[^}]*\} else \{[^}]*setPricingError\(/,
    'a failed /api/ai/pricing read is dropped rather than recorded');
  assert.match(src, /if \(s && !s\.__err\) \{[^}]*\} else \{[^}]*setSpendError\(/,
    'a failed /api/ai/me/spend read is dropped rather than recorded');
  assert.match(src, /return \{[^}]*\bspendError\b[^}]*\bpricingError\b[^}]*\breload\b[^}]*\}/,
    'the hook no longer hands callers both errors and a retry');
});

test('reload re-runs the reads', () => {
  const src = codeOnly(read(HOOK));
  // A Retry that calls a function which changes nothing is a dead control.
  // The counter must be in the effect's dependency list or bumping it does
  // nothing.
  assert.match(src, /const reload = useCallback\(\(\) => setAttempt\(/);
  assert.match(src, /\}, \[enabled, attempt\]\);/,
    'the retry counter is not a dependency of the fetch, so Retry fetches nothing');
});

// ── WorkerRail ──────────────────────────────────────────────────────────

test('WorkerRail: a failed usage read is Unreadable with a retry, never "Not recorded"', () => {
  const block = usageBlock();
  assert.doesNotMatch(block, /Not recorded/,
    'the usage block says "Not recorded" — that claims the log was read');
  assert.match(block, /<Unreadable[\s\S]{0,200}?onRetry=\{reload\}/,
    'the usage block has no Unreadable with a retry');
  // Both failures reach it: the request failing, and `recorded: false`. The
  // `known` gate is what routes `recorded: false` there.
  assert.match(codeOnly(read(RAIL)), /const known = !!spend\?\.recorded && typeof spend\?\.month\?\.spend_usd === 'number';/);
});

test('WorkerRail: a failed pricing read draws the model block, saying so', () => {
  const src = codeOnly(read(RAIL));
  const gate = /\{!priced && pricingError && \(\s*<section[^>]*>\s*<span>Model · this page<\/span>\s*<Unreadable[\s\S]{0,200}?onRetry=\{reload\}/;
  assert.match(src, gate,
    'a failed pricing read renders nothing — the model block vanishes and reads as "no model here"');
});

test('WorkerRail: no zero stands in for the cap', () => {
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /cap_usd \?\? 0|cap_usd \|\| 0/, 'a missing cap is being drawn as $0');
  assert.doesNotMatch(src, /spendMeter\([^)]*: 0,/, 'the meter is fed a zero for an unknown spend');
});

test('WorkerRail imports Unreadable from the house component, not a local copy', () => {
  const src = read(RAIL);
  assert.match(src, /import \{ Unreadable \} from '\.\/Honesty';/);
  assert.doesNotMatch(codeOnly(src), /function Unreadable/);
});

// ── eadwynConfig and AssistRail ─────────────────────────────────────────

const UNREADABLE_SPEND = {
  recorded: false,
  month: { spend_usd: null, cap_usd: 50, calls: null },
  by_task: [],
};
const pricing = {
  prices: { 'x/model': { in: 0.1, out: 0.2 } },
  routes: { advisor_explain: { model: 'x/model', alternates: [] } },
};

test('eadwynConfig passes an unreadable total as null, not zero', () => {
  const cfg = eadwynConfig({ surface: 'advisory', spend: UNREADABLE_SPEND, pricing });
  assert.equal(cfg.totalSpend, null, 'recorded:false became a number');
  assert.equal(cfg.planCap, 50);
  // No cap in the response is no cap, not a $0 cap.
  const noCap = eadwynConfig({ surface: 'advisory', spend: { recorded: true, month: { spend_usd: 1 } }, pricing });
  assert.equal(noCap.planCap, null);
  assert.equal(noCap.totalSpend, 1);
});

test('AssistRail: an unreadable usage log renders Unreadable, never $0.00', () => {
  const cfg = eadwynConfig({ surface: 'advisory', spend: UNREADABLE_SPEND, pricing });
  let retried = 0;
  const html = renderToStaticMarkup(React.createElement(AssistRail, {
    config: cfg, page: 'advisory', onRetrySpend: () => { retried += 1; },
  }));
  const text = renderedText(html);
  assert.doesNotMatch(text, /\$0\.00/, 'an unreadable usage log rendered as $0.00');
  assert.doesNotMatch(text, /This month\s*Not recorded/, 'a failed read is labelled as an empty store');
  assert.match(text, /Unreadable/);
  assert.match(text, /could not be read/);
  assert.match(html, />Retry</, 'the unreadable spend has no retry');
});

test('AssistRail: a readable total still draws the figure and the cap', () => {
  const cfg = eadwynConfig({
    surface: 'advisory',
    spend: { recorded: true, month: { spend_usd: 12.5, cap_usd: 50, calls: 3 }, by_task: [] },
    pricing,
  });
  const text = renderedText(renderToStaticMarkup(React.createElement(AssistRail, { config: cfg, page: 'advisory' })));
  assert.match(text, /\$12\.50/);
  assert.match(text, /\$50\.00/);
  assert.doesNotMatch(text, /Unreadable/);
});

test('AssistRail sums nothing in place of an unknown total', () => {
  const src = codeOnly(read('frontend/src/ui/AssistRail.jsx'));
  assert.doesNotMatch(src, /p\.spend \?\? 0/, 'the page-sum fallback is back: an unknown total sums to $0');
  assert.doesNotMatch(src, /spendMeter\(spendKnown \? spent : 0/);
});

// ── Voice ───────────────────────────────────────────────────────────────

test('no assist surface is labelled as advice', () => {
  // Every label renders as `${label} assist` in the mode card. The regulated-
  // wording scanner treats a one-word literal as an identifier, so it cannot
  // catch this; the rendered label can.
  for (const [key, s] of Object.entries(ASSIST_SURFACES)) {
    assert.doesNotMatch(s.label, /advis|advice|recommend|fiduciar/i,
      `ASSIST_SURFACES.${key}.label is "${s.label}"`);
  }
  const cfg = eadwynConfig({ surface: 'advisory', spend: UNREADABLE_SPEND, pricing });
  assert.equal(cfg.mode.label, 'Score explainer assist');
});

// ── Stale claims corrected in D400 ──────────────────────────────────────

test('the rail docs no longer claim what the code disproves', () => {
  const index = read('frontend/src/ui/index.js');
  assert.doesNotMatch(index, /Mode persistence and a user-selectable model do not exist/,
    'ui/index.js says mode persistence and model choice do not exist; both do');
  const assist = read('frontend/src/ui/AssistRail.jsx');
  assert.doesNotMatch(assist, /declares every surface `kind: 'fixed'`/,
    'AssistRail says every surface is fixed-mode; two declare a choice');
  // A task-class count in prose is only true if it matches the router's union.
  const router = read('cloudflare-worker/src/services/aiRouter.ts');
  const union = router.slice(router.indexOf('export type TaskClass'));
  const n = (union.slice(0, union.indexOf(';')).match(/\| '/g) || []).length;
  assert.ok(n >= 20, `TaskClass union not parsed (${n})`);
  const WORDS = { 23: 'twenty-three', 24: 'twenty-four', 25: 'twenty-five' };
  assert.ok(WORDS[n], `the union has ${n} members; teach this test the word and update the prose`);
  assert.match(assist, new RegExp(`${WORDS[n]} task classes`), 'AssistRail\'s task-class count is stale');
  assert.match(read('cloudflare-worker/src/services/aiSpend.ts'), new RegExp(`${WORDS[n]} task classes`),
    'aiSpend.ts\'s task-class count is stale');
  const rail = read(RAIL);
  assert.doesNotMatch(rail, /returns totals, not the latest row/,
    'WorkerRail says the spend endpoint returns no latest row; it returns last_run');
});
