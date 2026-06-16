// Task #41 — Spin-Out deck DATA assembler: pure-map guarantees.
//
// mapToSpinoutDeckData(src: SpinoutDemoDayData) is a PURE remap of the
// existing fillAxalSpinoutDemoDay() output into the NEW 10-slide buildDeck()
// contract. This test pins the two ends of the spectrum WITHOUT any D1 mock:
//
//   1. A FULLY-completed project at Day 28 (days_remaining = 0) =>
//        - every backing Lab module has data => gaps[] is empty
//        - no '[draft — …]' placeholder leaks into the rendered DATA
//        - draft === false (programDay === 28 AND no gaps)
//        - the deck is structurally renderable (3 market rings, 4 solution
//          steps with valid icon keys, a positive funnel max, numeric signal).
//
//   2. A PARTIAL project at Day 16 (days_remaining = 12) with every module
//      empty =>
//        - draft === true, programDay === 16, gaps[] is populated
//        - placeholder copy ('[draft …]') appears for narrative-only fields
//        - the deck is STILL structurally renderable (no NaN/empty charts).
//
// Pure node:test — runs under `npm run test:drift` via the --strip-types list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapToSpinoutDeckData, flattenSpinoutDeckData } from '../src/services/decks/spinoutDeckData.ts';
import type { SpinoutDeckData } from '../src/services/decks/spinoutDeckData.ts';
import type { SpinoutDemoDayData } from '../src/services/decks/axalSpinoutDemoDay.ts';

const SLIDE_KEYS = [
  'brand', 'cover', 'problem', 'validation', 'market',
  'solution', 'roadmap', 'team', 'captable', 'ask', 'deal',
] as const;

const SOLUTION_ICONS = new Set(['ingest', 'score', 'monitor', 'act']);

/** A fully-completed project at Day 28 — every Lab module carries real data. */
function makeFullSrc(): SpinoutDemoDayData {
  return {
    meta: {
      project_name: 'Basepoint', sector: 'Fintech / AI',
      founder_name: 'Maya Osei', contact_email: 'maya@basepoint.xyz',
      presented_on: '2026-06-15', week: 4, days_remaining: 0,
      lab_active: true, is_sample: false,
    },
    cover: {
      eyebrow: 'Demo Day', headline: 'Basepoint', sub: 'Real-time risk scoring for private-market lenders.',
      location: 'SF',
      activity_log: [
        { date: 'd1', count: 3, modules: { interview: 3 } },
        { date: 'd2', count: 5, modules: { interview: 5 } },
        { date: 'd3', count: 6, modules: { interview: 6 } },
        { date: 'd4', count: 8, modules: { interview: 8 } },
      ],
    },
    brand_kit: { present: true, bg: '#fff', accent: '#000', ink: '#111', fonts: 'Inter' },
    problem: {
      eyebrow: 'Problem', headline: 'Three pains surface in every lender conversation.',
      body: 'Synthesized from 28 discovery interviews with credit teams.',
      signals: ['stale data', 'manual review'],
      pain_themes: [
        { theme: 'Stale data at decision time', mentions: 23 },
        { theme: 'Manual, slow review cycles', mentions: 19 },
        { theme: 'Thin coverage of private borrowers', mentions: 15 },
      ],
    },
    validation: {
      eyebrow: 'Validation', headline: 'Empirical signal from a 28-day sprint.',
      body: '',
      metrics: [
        { label: 'Interviews completed', value: '28' },
        { label: 'Distinct pains', value: '21' },
        { label: 'Mean solution-fit', value: '7.8' },
        { label: 'Design-partner LOIs', value: '5' },
      ],
      quotes: [
        { name: 'Head of Credit', role: 'mid-market lender', takeaway: 'We re-underwrite on three-week-old data.' },
      ],
      question: 'How likely would you adopt?',
      ratings: [0, 1, 2, 4, 9, 12],
      revenue_proof: {
        status: 'pilot_signed', total_revenue: null, mrr: null,
        paying_customers: null, first_payment_date: null,
      },
    },
    market: {
      eyebrow: 'Market', headline: 'A $3.2B serviceable market.',
      tam: '$14B', sam: '$3.2B', som: '$180M',
      why_now: [
        'Private credit has scaled fast. AUM has roughly doubled since 2020.',
        "Data infra is in, risk tooling isn't. Lenders warehouse data but score manually.",
        'Monitoring pressure is rising. LPs expect continuous reporting.',
      ],
    },
    solution: {
      eyebrow: 'Solution', headline: 'From raw borrower data to a live risk score.',
      body: 'A scoring engine.',
      capabilities: [
        'Connect loan tapes, bank feeds, and filings in minutes.',
        'Generate a real-time risk score with explainable drivers.',
        'Continuously watch every borrower, not just at review.',
        'Trigger alerts and repricing the moment risk moves.',
      ],
    },
    roadmap: {
      eyebrow: 'Roadmap', headline: 'Now, next, later.',
      quarter: 'Q3',
      now: ['28 discovery interviews completed', 'Working risk-score prototype', '5 design partners signed'],
      next: ['Live pilot with 3 design partners', 'Scoring API v1 in production'],
      later: ['SOC 2 Type I underway', 'Seed round opened'],
    },
    brand: {
      eyebrow: 'Brand', headline: 'Basepoint',
      tagline: 'Real-time risk scoring for private-market lenders.',
      vision: 'Score every private loan continuously.',
      brand_kit_ready: true, pitch_deck_ready: true, incorporated: true,
    },
    venture_readiness: {
      eyebrow: 'Readiness', headline: 'Ready', total_score: '78', tier: 'A',
      is_sandbox: false, breakdown: [{ label: 'Market', value: '80' }], ai_notes: '',
    },
    team: {
      eyebrow: 'Team', headline: 'A founder backed by an operating network.',
      founders: [
        { name: 'Maya Osei', role: 'Founder & CEO', bio: 'Ex-credit-risk lead.', company: 'Basepoint' },
      ],
      team_intro: 'Solo founder + advisors.',
    },
    mentor_network: {
      eyebrow: 'Network', headline: 'Mentors', body: '',
      mentors: ['Daniel Kerr', 'Rina Patel'],
      network_signals: ['intro pipeline'],
      profiles: [
        { name: 'Daniel Kerr', role: 'Former CRO', bio: '', skills: ['credit'] },
        { name: 'Rina Patel', role: 'Fintech GTM', bio: '', skills: ['gtm'] },
      ],
      skill_coverage: [{ label: 'Credit', value: 0.8 }],
      network: [{ category: 'legal', count: 2 }],
      team_radar: null,
    },
    cap_table: {
      eyebrow: 'Cap table', headline: 'Entity-ready: clean cap table.',
      holders: [
        { name: 'Maya Osei', role: 'Founder', ownership_pct: '80', kind: 'founder' },
        { name: 'Option pool', role: 'Pool', ownership_pct: '15', kind: 'pool' },
        { name: 'SAFE (reserved)', role: 'Investor', ownership_pct: '5', kind: 'safe' },
      ],
      note: 'Post-formation.',
    },
    ask: {
      eyebrow: 'Ask', headline: 'Raising $750K pre-seed to reach revenue.',
      raise_amount: '$750K', runway: '18 mo',
      use_of_funds: [
        { label: 'Engineering & product', pct: 45 },
        { label: 'Go-to-market', pct: 25 },
        { label: 'Data & infrastructure', pct: 20 },
        { label: 'Operations & legal', pct: 10 },
      ],
      next_milestones: ['10 paying lenders and seed-ready metrics.'],
    },
    axal_signal: {
      eyebrow: 'Axal', headline: 'Lab', body: '',
      lab_weeks: [],
    },
    contact: {
      eyebrow: 'Contact', headline: 'Data room open. Ready to move.',
      body: '', contact_email: 'maya@basepoint.xyz', signoff: 'Open to diligence this week.',
      deal_access: {
        deal_room_url: 'https://example.com/room', nda_required: false,
        data_room_ready: true, cta_label: 'SAFE — close in 8 weeks',
      },
    },
    product_demo: {
      eyebrow: 'Demo', headline: 'Product', body: '',
      loop_url: '', screenshot_url: '', caption: '',
    },
  } as SpinoutDemoDayData;
}

/** A partial project at Day 16 — every backing module is empty/missing. */
function makePartialSrc(): SpinoutDemoDayData {
  const full = makeFullSrc();
  return {
    ...full,
    meta: { ...full.meta, days_remaining: 12, contact_email: '' },
    cover: { ...full.cover, sub: '', activity_log: [] },
    problem: { ...full.problem, headline: '', body: '', pain_themes: [] },
    validation: { ...full.validation, headline: '', body: '', metrics: [], quotes: [], ratings: [] },
    market: { ...full.market, headline: '', tam: '', sam: '', som: '', why_now: [] },
    solution: { ...full.solution, headline: '', capabilities: [] },
    roadmap: { ...full.roadmap, headline: '', now: [], next: [], later: [] },
    brand: { ...full.brand, tagline: '', brand_kit_ready: false, pitch_deck_ready: false, incorporated: false },
    team: { ...full.team, headline: '', founders: [] },
    mentor_network: { ...full.mentor_network, profiles: [], mentors: [] },
    cap_table: { ...full.cap_table, headline: '', holders: [] },
    ask: { ...full.ask, headline: '', raise_amount: '', runway: '', use_of_funds: [], next_milestones: [] },
    contact: {
      ...full.contact, headline: '', signoff: '', contact_email: '',
      deal_access: { deal_room_url: '', nda_required: false, data_room_ready: false, cta_label: '' },
    },
  } as SpinoutDemoDayData;
}

/** Deep scan for the '[draft' placeholder marker anywhere in the DATA. */
function hasDraftPlaceholder(data: unknown): boolean {
  return JSON.stringify(data).includes('[draft');
}

test('full project (Day 28) => no gaps, no placeholders, not draft', () => {
  const { data, notes, gaps, draft, programDay } = mapToSpinoutDeckData(makeFullSrc());

  assert.equal(programDay, 28, 'days_remaining 0 => programDay 28');
  assert.equal(gaps.length, 0, `expected zero gaps, got: ${JSON.stringify(gaps)}`);
  assert.equal(draft, false, 'a complete Day-28 project is not a draft');
  assert.equal(hasDraftPlaceholder(data), false, 'no [draft …] placeholder should leak into a full deck');

  // Speaker notes exist for every rendered slide (cover..deal).
  for (const k of SLIDE_KEYS) {
    if (k === 'brand') continue; // brand is chrome, not a noted slide
    assert.ok(typeof notes[k] === 'string' && notes[k].length > 0, `notes.${k} present`);
  }
});

test('full project => structurally renderable (rings/steps/funnel/signal)', () => {
  const { data } = mapToSpinoutDeckData(makeFullSrc());

  for (const k of SLIDE_KEYS) {
    assert.ok((data as any)[k], `data.${k} present`);
  }

  // Market donut needs exactly 3 rings.
  assert.equal(data.market.rings.length, 3, 'market needs 3 rings');

  // Solution needs exactly 4 steps with valid icon keys.
  assert.equal(data.solution.steps.length, 4, 'solution needs 4 steps');
  for (const step of data.solution.steps) {
    assert.ok(SOLUTION_ICONS.has(step[0]), `solution icon key "${step[0]}" is valid`);
  }

  // Funnel renderer divides by the max — it must be positive.
  const funnelMax = Math.max(...data.validation.stages.map((s) => s[1]));
  assert.ok(funnelMax > 0, 'validation funnel max must be > 0');

  // Cover area chart needs a non-empty, all-numeric series.
  assert.ok(data.cover.signalY.length > 0, 'cover signalY non-empty');
  assert.ok(data.cover.signalY.every((n) => Number.isFinite(n)), 'cover signalY all finite');
});

test('partial project (Day 16) => draft, gaps populated, placeholders present', () => {
  const { data, gaps, draft, programDay } = mapToSpinoutDeckData(makePartialSrc());

  assert.equal(programDay, 16, 'days_remaining 12 => programDay 16');
  assert.equal(draft, true, 'a Day-16 project with gaps is a draft');
  assert.ok(gaps.length > 5, `expected several gaps, got ${gaps.length}: ${JSON.stringify(gaps)}`);
  assert.equal(hasDraftPlaceholder(data), true, 'narrative-only empty fields should read as [draft …]');
});

test('partial project => still structurally renderable (no NaN/empty charts)', () => {
  const { data } = mapToSpinoutDeckData(makePartialSrc());

  assert.equal(data.market.rings.length, 3, 'market still has 3 rings');
  assert.equal(data.solution.steps.length, 4, 'solution still has 4 steps');

  const funnelMax = Math.max(...data.validation.stages.map((s) => s[1]));
  assert.ok(funnelMax > 0, 'partial funnel max must still be > 0 (no divide-by-zero)');

  assert.ok(data.cover.signalY.length > 0, 'cover signalY non-empty even when empty');
  assert.ok(data.cover.signalY.every((n) => Number.isFinite(n)), 'cover signalY all finite even when empty');

  // Task #65 — honest zero-state: no logged interviews => a flat baseline at 0
  // and a 0 total, NOT a fabricated rising curve. The day axis still spans the
  // 30-day sprint so the chart renders.
  assert.ok(data.cover.signalY.every((n) => n === 0), 'zero-interview cover signalY is a flat-0 baseline');
  assert.equal(data.cover.signalY[data.cover.signalY.length - 1], 0, 'zero-interview total is 0');
  assert.ok(data.cover.signalX.length > 0, 'zero-interview cover still has a day axis');
});

// ─────────────────────────── Task #55 ───────────────────────────────────────
// flattenSpinoutDeckData: dotted-key field map used by the print view's
// hydrate() contract so live Lab data reaches the React template.

test('flattenSpinoutDeckData: scalars become dotted keys, arrays become _json keys', () => {
  const { data } = mapToSpinoutDeckData(makeFullSrc());
  const fields = flattenSpinoutDeckData(data);

  // Every key must contain a dot (section.field or section.field_json).
  for (const k of Object.keys(fields)) {
    assert.ok(k.includes('.'), `key "${k}" must be a dotted path`);
  }

  // Scalar string fields go out as-is.
  assert.ok(typeof fields['cover.thesis'] === 'string' && fields['cover.thesis'].length > 0, 'cover.thesis is a string');

  // Array fields get a _json suffix and parse back as arrays.
  assert.ok('cover.meta_json' in fields, 'cover.meta (array) → cover.meta_json');
  const meta = JSON.parse(fields['cover.meta_json']);
  assert.ok(Array.isArray(meta) && meta.length > 0, 'cover.meta_json parses to a non-empty array');

  // All SLIDE_KEYS sections present.
  const sections = new Set(Object.keys(fields).map((k) => k.split('.')[0]));
  for (const s of ['cover', 'problem', 'validation', 'market', 'solution', 'roadmap', 'team', 'captable', 'ask', 'deal']) {
    assert.ok(sections.has(s), `section "${s}" present in flat fields`);
  }
});

test('flattenSpinoutDeckData: mapToSpinoutDeckData.fields matches standalone call', () => {
  // The bundle returned by mapToSpinoutDeckData must include fields that equal
  // a standalone call to flattenSpinoutDeckData on the same data.
  const bundle = mapToSpinoutDeckData(makeFullSrc());
  const standalone = flattenSpinoutDeckData(bundle.data);
  assert.deepEqual(bundle.fields, standalone, 'bundle.fields === flattenSpinoutDeckData(bundle.data)');
});

test('flattenSpinoutDeckData: prototype-pollution guard — __proto__ keys never emitted', () => {
  // Craft a SpinoutDeckData with a forbidden key in a nested object.
  const { data } = mapToSpinoutDeckData(makeFullSrc());
  // Force a poisoned section onto the object — TypeScript widened via cast.
  (data as any).__proto__ = { evil: 'yes' };
  (data.cover as any)['__proto__'] = { x: 1 };
  const fields = flattenSpinoutDeckData(data);
  for (const k of Object.keys(fields)) {
    assert.ok(!k.includes('__proto__'), `key "${k}" must not contain __proto__`);
    assert.ok(!k.includes('evil'), `key "${k}" must not contain prototype-pollution payload`);
  }
});

test('flattenSpinoutDeckData: empty strings and DASH placeholders are skipped', () => {
  // A partial project has many empty strings — they should NOT appear in the
  // flat map so that hydrate() falls back to SAMPLE_DATA for those slots.
  const { data } = mapToSpinoutDeckData(makePartialSrc());
  const fields = flattenSpinoutDeckData(data);
  for (const [k, v] of Object.entries(fields)) {
    if (k.endsWith('_json')) continue; // arrays/objects always emitted
    assert.ok(typeof v === 'string' && v.length > 0 && v !== '—', `field "${k}" must be a non-empty non-DASH string`);
  }
});
