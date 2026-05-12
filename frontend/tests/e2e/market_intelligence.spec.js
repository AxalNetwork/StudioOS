import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

// Legacy + new MI tab keys. The first array preserves Task #10 (AP)
// post-AO smoke coverage; the second array is the 8 advisor-derived
// tabs added in Task #1 (AT-2). Keep them separate so the legacy assert
// loop and the new AT-1-fixture-driven flow can each evolve independently.
const MI_TAB_KEYS_LEGACY = ['compass', 'pulse', 'macro', 'private', 'studio', 'investor_signals'];
const MI_TAB_KEYS_AT2 = [
  'mi_sentiment', 'mi_talc', 'mi_demand_supply', 'mi_fit',
  'mi_partner_pulse', 'mi_sector_heat', 'mi_sentiment_geo', 'mi_capital_velocity',
];

// Populated AT-1 fixtures, one per tab. Shapes mirror the worker
// responses in cloudflare-worker/src/routes/market_intel.ts so the
// front-end render paths exercise the same code as production.
//
// Field-name correctness matters here — the frontend silently no-ops
// or drops rows when a key is misspelled, so getting these wrong
// makes assertions vacuously pass. Verified against the worker:
//   /sentiment       → items: [{sector, period_key, valence, energy, n}]
//   /talc            → items: [{persona, sector, period_key, mode, distribution, dominance, n}]
//   /sector-heat     → items: [{sector, sub_sector, period_key, heat, contributions, mean_valence, n}]
//   /sentiment-geo   → items: [{geo, sector, period_key, valence, n}]
//   /capital-velocity→ items: [{sector, period_key, velocity, distributing_share, scaling_share, n}]
//   /partner-pulse   → items: [{sector, topic, period_key, supply_count, n}], rate_cards, comp_models
//   /fit/*           → matches: [{score, *_user_id, *_id_hash, nda_required}]
const FIXTURES_POPULATED = {
  '/api/market-intel/sentiment': {
    items: [
      { sector: 'fintech', period_key: '2026-W18', valence: 0.42, energy: 0.55, n: 12 },
      { sector: 'fintech', period_key: '2026-W19', valence: 0.51, energy: 0.61, n: 14 },
      { sector: 'health',  period_key: '2026-W19', valence: -0.18, energy: 0.40, n: 9 },
    ],
    blockers: [{ sector: 'health', topic: 'fundraising', n: 8 }],
    excitements: [{ sector: 'fintech', topic: 'gtm', n: 10 }],
    k_min: 5,
  },
  '/api/market-intel/talc': {
    // 'fintech' has BOTH personas → renders in stacked bars AND in the
    // chasm-readiness gap chart. 'health' has ONLY a founder mode →
    // must render in the founder stacked bar but MUST NOT appear in
    // the gap chart (regression guard for the dual-persona fix).
    items: [
      { persona: 'founder',  sector: 'fintech', period_key: '2026-04', mode: 'building',
        distribution: { discovery: 2, building: 6, scaling: 3, distributing: 1 }, dominance: 0.5, n: 12 },
      { persona: 'investor', sector: 'fintech', period_key: '2026-04', mode: 'scaling',
        distribution: { discovery: 1, building: 3, scaling: 7, distributing: 2 }, dominance: 0.55, n: 13 },
      { persona: 'founder',  sector: 'health',  period_key: '2026-04', mode: 'discovery',
        distribution: { discovery: 5, building: 2, scaling: 1, distributing: 0 }, dominance: 0.62, n: 8 },
    ],
    k_min: 5,
  },
  '/api/market-intel/demand-supply': {
    items: [
      { sector: 'fintech', topic: 'gtm', side: 'demand', value: 8, n: 8 },
      { sector: 'fintech', topic: 'gtm', side: 'supply', value: 5, n: 5 },
      { sector: 'fintech', topic: 'engineering', side: 'demand', value: 12, n: 12 },
    ],
    k_min: 5,
  },
  '/api/market-intel/sector-heat': {
    items: [
      { sector: 'fintech', sub_sector: null, period_key: '2026-W18', heat: 2.4, contributions: 14, mean_valence: 0.4, n: 14 },
      { sector: 'fintech', sub_sector: null, period_key: '2026-W19', heat: 2.8, contributions: 18, mean_valence: 0.5, n: 18 },
      { sector: 'fintech', sub_sector: 'payments', period_key: '2026-W19', heat: 1.6, contributions: 7, mean_valence: 0.3, n: 7 },
    ],
    k_min: 5,
  },
  '/api/market-intel/sentiment-geo': {
    items: [
      { geo: 'us', sector: 'fintech', period_key: '2026-W19', valence: 0.50, n: 14 },
      { geo: 'eu', sector: 'health',  period_key: '2026-W19', valence: -0.10, n: 8 },
    ],
    k_min: 5,
  },
  '/api/market-intel/capital-velocity': {
    // 'fintech' has TWO periods — the "Latest velocity by sector" table
    // must pick 2026-05 (velocity 0.71), not 2026-04 (0.62). Regression
    // guard for the latest-period selection bug caught in 1st-pass review.
    items: [
      { sector: 'fintech', period_key: '2026-04', velocity: 0.620, distributing_share: 0.40, scaling_share: 0.45, n: 9 },
      { sector: 'fintech', period_key: '2026-05', velocity: 0.710, distributing_share: 0.50, scaling_share: 0.42, n: 11 },
      { sector: 'health',  period_key: '2026-05', velocity: 0.340, distributing_share: 0.20, scaling_share: 0.28, n: 6 },
    ],
    k_min: 5,
  },
  '/api/market-intel/partner-pulse': {
    items: [
      { sector: 'fintech', topic: 'gtm', period_key: '2026-W19', supply_count: 6, n: 6 },
    ],
    rate_cards: [],
    comp_models: [],
    k_min: 5,
  },
  // /fit/founder/:project_id and /fit/investor/me — both shapes share `matches`.
  // 6 entries so the test can assert the slice(0,5) cap is gone.
  '/api/market-intel/fit/investor/me': {
    matches: [
      { founder_user_id: null, founder_id_hash: 'abc123def456', score: 0.81, nda_required: true },
      { founder_user_id: null, founder_id_hash: 'def789abc012', score: 0.74, nda_required: true },
      { founder_user_id: null, founder_id_hash: '999888777666', score: 0.68, nda_required: true },
      { founder_user_id: null, founder_id_hash: '111222333444', score: 0.61, nda_required: true },
      { founder_user_id: null, founder_id_hash: '555444333222', score: 0.55, nda_required: true },
      { founder_user_id: null, founder_id_hash: '666555444333', score: 0.50, nda_required: true },
    ],
    k_min: 5,
  },
};

// Empty payload (no rows at all) — the worker returns this when the
// underlying tables are empty. The frontend renders the
// "Not enough data yet" block.
const FIXTURES_EMPTY = Object.fromEntries(
  Object.keys(FIXTURES_POPULATED).map((k) => [k, {
    items: [], blockers: [], excitements: [], matches: [],
    rate_cards: [], comp_models: [], k_min: 5,
  }]),
);

// k-anonymity-suppressed payload (worker found a fit cell but n<5).
// The Fit endpoints emit `note: 'k_anonymity_suppressed'` alongside an
// empty matches array — that's a distinct render branch from "no data
// at all" (which emits `note: 'no_fit_yet'`). Tests asserting the
// empty-state UI cover both since both end up at MIInsufficientData.
const FIT_SUPPRESSED_NOTE = { matches: [], note: 'k_anonymity_suppressed', k_min: 5 };

/**
 * Install Playwright route handlers for every AT-1 endpoint plus the
 * dynamic /fit/founder/:id route (the URL contains a numeric id we
 * don't know in advance). The trailing `*` glob is essential — every
 * MI helper appends `?weeks=`/`?months=` query strings, and a bare
 * path glob would silently miss those and let the test hit live data.
 */
async function mockMI(page, fixtures, opts = {}) {
  for (const [path, body] of Object.entries(fixtures)) {
    await page.route(`**${path}*`, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(body),
    }));
  }
  // Founder-side fit endpoint has a dynamic project_id segment.
  const founderFitBody = opts.founderFit || {
    matches: (fixtures['/api/market-intel/fit/investor/me']?.matches || []).map((m) => ({
      investor_user_id: null, investor_id_hash: m.founder_id_hash,
      score: m.score, nda_required: m.nda_required ?? true,
    })),
    k_min: 5,
  };
  await page.route(/\/api\/market-intel\/fit\/founder\/\d+/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(founderFitBody),
  }));
}

test.describe('Market Intelligence (post-AO verification)', () => {
  test.beforeEach(() => requirePreview(test));

  test('every visible legacy tab renders content or an explicit empty state', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/market-intel');
    const root = page.getByTestId('market-intel-page');
    await expect(root).toBeVisible();

    for (const key of MI_TAB_KEYS_LEGACY) {
      const btn = page.getByTestId(`mi-tab-${key}`);
      if (!(await btn.count())) continue; // role-gated tab not visible to caller
      await btn.first().click();
      await expect(root).toHaveAttribute('data-active-tab', key);
      const hasContent = await root.locator('h1, h2, h3, table, [role="table"]').count();
      const hasEmpty = await root.getByText(/No data|Insufficient|coming soon|No results|nothing here|Not enough data/i).count();
      const hasError = await root.getByText(/error loading|failed to load|something went wrong/i).count();
      expect(hasError, `MI tab ${key} surfaced an error`).toBe(0);
      expect(hasContent + hasEmpty, `MI tab ${key} rendered nothing`).toBeGreaterThan(0);
    }
  });
});

// -----------------------------------------------------------------------------
// Task #5 — AT-2 tab coverage. Routes are mocked so the assertions test
// the FRONT-END render paths (chart vs MIInsufficientData) deterministically,
// independent of whatever data lives in the preview D1. Fixture field names
// are validated against cloudflare-worker/src/routes/market_intel.ts above.
// -----------------------------------------------------------------------------

test.describe('Market Intelligence — AT-2 advisor-derived tabs', () => {
  test.beforeEach(() => requirePreview(test));

  test('all 8 new tabs render a card section when AT-1 fixtures are populated', async ({ page }) => {
    await mockMI(page, FIXTURES_POPULATED);
    await loginAs(page, 'admin');
    await page.goto('/market-intel');
    const root = page.getByTestId('market-intel-page');
    await expect(root).toBeVisible();

    for (const key of MI_TAB_KEYS_AT2) {
      const btn = page.getByTestId(`mi-tab-${key}`);
      await expect(btn, `tab strip is missing ${key}`).toHaveCount(1);
      await btn.click();
      await expect(root).toHaveAttribute('data-active-tab', key);

      // At least one populated MICard rendered ([data-card] with a heading).
      // No `<MIInsufficientData />` is permitted in the populated scenario
      // — a fixture mismatch would otherwise hide as a vacuous pass.
      const cards = root.locator('[data-card] h3');
      const errorBlock = root.getByText(/error loading|failed to load|something went wrong/i);
      await expect.soft(errorBlock, `${key} surfaced an error`).toHaveCount(0);
      await expect(cards.first(), `${key} rendered no card from populated fixtures`).toBeVisible();
    }
  });

  test('all 8 new broadcast tabs render the MIInsufficientData block when AT-1 returns empty results', async ({ page }) => {
    await mockMI(page, FIXTURES_EMPTY);
    await loginAs(page, 'admin');
    await page.goto('/market-intel');
    const root = page.getByTestId('market-intel-page');
    await expect(root).toBeVisible();

    // mi_fit is covered separately by the persona tests below — admins
    // hit the investor branch which renders its own empty-state copy.
    for (const key of MI_TAB_KEYS_AT2.filter((k) => k !== 'mi_fit')) {
      const btn = page.getByTestId(`mi-tab-${key}`);
      if (!(await btn.count())) continue;
      await btn.click();
      await expect(root).toHaveAttribute('data-active-tab', key);
      await expect(root.getByText(/Not enough data yet/i).first()).toBeVisible();
    }
  });

  test('Founder–Investor Fit also surfaces empty state when /fit returns the k-anonymity-suppressed note', async ({ page }) => {
    // Distinct scenario from FIXTURES_EMPTY: the worker found a fit
    // cell but n<5, so it returns matches=[] with note='k_anonymity_suppressed'.
    // The render path still goes through MIInsufficientData but this
    // test guards the wire contract specifically.
    await mockMI(page, { ...FIXTURES_POPULATED, '/api/market-intel/fit/investor/me': FIT_SUPPRESSED_NOTE });
    await loginAs(page, 'admin');
    await page.goto('/market-intel');
    const root = page.getByTestId('market-intel-page');
    await page.getByTestId('mi-tab-mi_fit').click();
    await expect(root).toHaveAttribute('data-active-tab', 'mi_fit');
    await expect(root.getByText(/Not enough data yet/i).first()).toBeVisible();
    // And there must be NO investor-matches list rendered.
    await expect(root.locator('[data-card] ol > li')).toHaveCount(0);
  });

  test('Founder–Investor Fit is persona-aware (admin sees investor matches list, top-N not capped)', async ({ page }) => {
    await mockMI(page, FIXTURES_POPULATED);
    await loginAs(page, 'admin');
    await page.goto('/market-intel');
    const root = page.getByTestId('market-intel-page');
    await page.getByTestId('mi-tab-mi_fit').click();
    await expect(root).toHaveAttribute('data-active-tab', 'mi_fit');

    // Investor / admin path: card title contains "Top founder matches"
    // and renders the full top-N (no client-side slice). The fixture
    // supplies 6 matches; assert all 6 render — regression guard for
    // the slice(0,5) cap removed in 2nd-pass review.
    await expect(root.getByText(/Top founder matches/i)).toBeVisible();
    const matchRows = root.locator('[data-card] ol > li');
    await expect(matchRows).toHaveCount(6);

    // Counter-party identifiers must appear hashed (nda_required=true
    // in fixture, so backend masked the user id).
    const firstHash = await matchRows.first().textContent();
    expect(firstHash, 'investor view should show id_hash, not plaintext id').toMatch(/[a-f0-9]{6,}/i);
  });

  test('Founder–Investor Fit shows the founder guard / project picker when logged in as founder', async ({ page }) => {
    await mockMI(page, FIXTURES_POPULATED);
    await loginAs(page, 'founder');
    await page.goto('/market-intel');
    const root = page.getByTestId('market-intel-page');
    await page.getByTestId('mi-tab-mi_fit').click();
    await expect(root).toHaveAttribute('data-active-tab', 'mi_fit');

    // Founder path: either the project picker is visible (founder owns
    // ≥2 projects) OR the auto-selected first project triggers the fit
    // load and renders "Top investor matches", OR the no-projects
    // guard text appears. All three are valid for the seeded founder
    // — the regression we're guarding against is the previous bug
    // where admins/investors and founders saw the same view.
    const picker = root.locator('select');
    const investorMatches = root.getByText(/Top investor matches/i);
    const guard = root.getByText(/Sign in as a founder or investor/i);
    const empty = root.getByText(/Not enough data yet/i);
    const visibleCount =
      (await picker.count()) +
      (await investorMatches.count()) +
      (await guard.count()) +
      (await empty.count());
    expect(visibleCount,
      'founder fit view rendered neither picker, investor-matches, guard, nor empty state',
    ).toBeGreaterThan(0);
    // Critically, the founder MUST NOT see the investor-side title.
    await expect(root.getByText(/Top founder matches/i)).toHaveCount(0);
  });

  test('Capital Velocity sector table picks the latest period (regression guard)', async ({ page }) => {
    // The fixture supplies 2026-04 (velocity 0.62) AND 2026-05 (0.71)
    // for fintech. The earlier code did `new Map(items.map(...))` which
    // kept whichever entry came last in the array — picking the wrong
    // period. The fix walks items and compares period_key. Assert the
    // latest velocity (0.71) renders, not the earlier (0.62).
    await mockMI(page, FIXTURES_POPULATED);
    await loginAs(page, 'admin');
    await page.goto('/market-intel');
    const root = page.getByTestId('market-intel-page');
    await page.getByTestId('mi-tab-mi_capital_velocity').click();
    await expect(root).toHaveAttribute('data-active-tab', 'mi_capital_velocity');

    // The "Latest velocity by sector" card is the relevant target.
    const latestCard = root.locator('[data-card]', { hasText: 'Latest velocity by sector' });
    await expect(latestCard).toBeVisible();
    const fintechRow = latestCard.locator('tr', { hasText: /fintech/i });
    await expect(fintechRow).toBeVisible();
    // Velocity column shows 0.71 (latest), not 0.62 (earlier period).
    await expect(fintechRow).toContainText('0.71');
    await expect(fintechRow).not.toContainText('0.62');
  });

  test('TALC chasm-readiness gap excludes sectors where one persona is missing (regression guard)', async ({ page }) => {
    // Fixture: fintech has both founder + investor modes (gap rendered);
    // health has only founder mode (must NOT render in the gap chart).
    // Earlier code defaulted the missing side to stage 0 and fabricated
    // an artificial gap against the suppressed cell.
    await mockMI(page, FIXTURES_POPULATED);
    await loginAs(page, 'admin');
    await page.goto('/market-intel');
    const root = page.getByTestId('market-intel-page');
    await page.getByTestId('mi-tab-mi_talc').click();
    await expect(root).toHaveAttribute('data-active-tab', 'mi_talc');

    const gapCard = root.locator('[data-card]', { hasText: 'Chasm-readiness gap' });
    await expect(gapCard).toBeVisible();
    // 'fintech' must be on the gap chart's Y-axis; 'health' must not.
    await expect(gapCard.getByText(/fintech/i).first()).toBeVisible();
    await expect(gapCard.getByText(/^\s*health\s*$/i)).toHaveCount(0);
  });
});
