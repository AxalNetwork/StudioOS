/**
 * D5373 (#5373) — no money value in the financial UI or the Worker is converted between minor and major units by a
 * bare factor of 100 outside the allow-list below. Every conversion of an amount whose currency can vary goes through
 * `frontend/src/lib/money.js` (D5029), which knows JPY and KRW have no minor unit and KWD and BHD have three.
 *
 * The scan (`_moneyConversionScan.mjs`) flags a line that divides, multiplies or takes a remainder by 100 and names
 * money. A flagged file must be listed here with its KIND and the exact number of flagged lines it holds:
 *
 *   usd / eur   the currency is fixed by contract (the ledger, the fund, the pack is sold in it); the file must name it.
 *   not-money   the line is a percentage, a ratio or a rounding to two places that a money word sits beside.
 *   pending     a variable-currency path this issue did not migrate. Each is named in D5373.md; the list may only shrink.
 *
 * The count is exact, so a NEW `/ 100` in a listed file fails (the count goes up) and so does removing one without
 * lowering it here (the list never carries slack a later line could hide in). A file that is not listed at all fails on
 * its first flagged line. Mutations checked, both ways: `/ 100` added to a migrated file (money.js's callers); `* 100`
 * added to a listed file; a listed file's conversion removed without editing the count; a `usd` entry whose file never
 * names the currency; a `pending` file missing from the decision file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scanFile, scanTree } from './_moneyConversionScan.mjs';

const root = new URL('../../', import.meta.url);
const rootPath = root.pathname;

/** [kind, reason, files] groups: file -> exact number of flagged lines. */
const ALLOW = [
  { kind: 'not-money', reason: "A percentage, ratio or rounding to two places, not an amount of currency: the line has a money word beside it.", files: {
    "frontend/src/pages/PortfolioPerformancePage.jsx": 1,
    "frontend/src/pages/SpinoutLabLpWorkspacePage.jsx": 1,
    "frontend/src/pages/SpinoutLabMarketPage.jsx": 2,
    "frontend/src/pages/admin/insights/insightsModel.js": 1,
    "frontend/src/pages/admin/payments/dialogModel.js": 1,
    "frontend/src/pages/founder/callsModel.js": 1,
    "frontend/src/pages/founder/recordSetup.js": 1,
    "frontend/src/pages/hq/aiUsageModel.js": 1,
    "frontend/src/pages/hq/tokenPacksModel.js": 1,
    "frontend/src/pages/raise/captable/scenariosModel.js": 1,
    "frontend/src/ui/skillEnergyModel.js": 1,
    "frontend/src/lib/licenceTermsForm.js": 1,
    "frontend/src/pages/raise/pitch/typedChartsModel.js": 1,
    "cloudflare-worker/src/services/analyticsReports.ts": 3,
    "cloudflare-worker/src/routes/admin_assessment.ts": 1,
    "cloudflare-worker/src/routes/advisors_engagements.ts": 1,
    "cloudflare-worker/src/routes/advisory.ts": 2,
    "cloudflare-worker/src/routes/monitoring.ts": 1,
    "cloudflare-worker/src/routes/positions.ts": 1,
    "cloudflare-worker/src/routes/private-data.ts": 1,
    "cloudflare-worker/src/routes/progress.ts": 1,
    "cloudflare-worker/src/services/agents/alerts.ts": 1,
    "cloudflare-worker/src/services/aiUsageAdmin.ts": 2,
    "cloudflare-worker/src/services/bdAnalytics.ts": 1,
    "cloudflare-worker/src/services/deckConsistency.ts": 1,
    "cloudflare-worker/src/services/decks/gridHealth.ts": 1,
    "cloudflare-worker/src/services/decks/pptxEditable.ts": 1,
    "cloudflare-worker/src/services/market-data.ts": 1,
    "cloudflare-worker/src/services/planCheckout.ts": 1,
    "cloudflare-worker/src/services/portfolioHealthSources.ts": 1,
    "cloudflare-worker/src/services/portfolioMetrics.ts": 1,
    "cloudflare-worker/src/services/revenueMovements.ts": 1,
    "cloudflare-worker/src/services/roundMath.ts": 1,
    "cloudflare-worker/src/services/secondaryProceeds.ts": 1,
    "cloudflare-worker/src/services/ventureScoring/collectors.ts": 2,
  } },
  { kind: 'eur', reason: "Research directory sizes are recorded in euros only (the EUR_SOURCE rule); the read refuses any other size currency.", files: {
    "frontend/src/pages/research/GeographyProfile.jsx": 1,
    "frontend/src/pages/research/fundDirectoryRead.js": 1,
    "cloudflare-worker/src/routes/research_markets.ts": 1,
  } },
  { kind: 'usd', reason: "Fund, LP, capital-call and distribution amounts are US dollars: the legacy REAL dollar columns and the `*_cents` columns beside them carry no currency column.", files: {
    "frontend/src/lib/fundAnalytics.js": 1,
    "frontend/src/lib/lpCommitmentModel.js": 1,
    "frontend/src/lib/proofOfFunds.js": 2,
    "frontend/src/lib/quarterlyReportViewModel.js": 4,
    "frontend/src/pages/FundPerformancePage.jsx": 1,
    "frontend/src/pages/FundReportPeriodPage.jsx": 1,
    "frontend/src/pages/admin/fundAdmin/FeesReportsTabs.jsx": 1,
    "frontend/src/pages/admin/fundAdmin/callsModel.js": 2,
    "frontend/src/pages/admin/fundAdmin/fundsModel.js": 2,
    "frontend/src/pages/admin/fundAdmin/lpsModel.js": 1,
    "frontend/src/pages/admin/fundAdmin/performanceModel.js": 5,
    "frontend/src/pages/hq/HqFundsPage.jsx": 1,
    "frontend/src/pages/investor/FundLedgerPanel.jsx": 1,
    "frontend/src/pages/investor/InvestorFundLPs.jsx": 2,
    "frontend/src/pages/investor/InvestorFundLanding.jsx": 3,
    "frontend/src/pages/investor/ProofOfFunds.jsx": 1,
    "frontend/src/pages/investor/fundCallsModel.js": 1,
    "frontend/src/pages/investor/proofOfFundsModel.js": 3,
    "frontend/src/pages/investor/deals/ClosingZone.jsx": 4,
    "cloudflare-worker/src/routes/_capital_call_writes.ts": 1,
    "cloudflare-worker/src/routes/capital.ts": 1,
    "cloudflare-worker/src/routes/funds.ts": 5,
    "cloudflare-worker/src/routes/liquidity.ts": 2,
    "cloudflare-worker/src/routes/networkfx.ts": 1,
    "cloudflare-worker/src/services/capitalAttestationTerms.ts": 2,
    "cloudflare-worker/src/services/capitalAttestations.ts": 3,
    "cloudflare-worker/src/services/fundAdminLps.ts": 1,
    "cloudflare-worker/src/services/fundCallLedger.ts": 7,
    "cloudflare-worker/src/services/fundCallSplit.ts": 1,
    "cloudflare-worker/src/services/fundDistributionSplit.ts": 1,
    "cloudflare-worker/src/services/fundFees.ts": 1,
    "cloudflare-worker/src/services/fundLpComms.ts": 2,
    "cloudflare-worker/src/services/fundNotices.ts": 2,
    "cloudflare-worker/src/services/fundPerformance.ts": 1,
    "cloudflare-worker/src/services/fundReportBuild.ts": 2,
    "cloudflare-worker/src/services/fundReportDrafts.ts": 1,
    "cloudflare-worker/src/services/fundReports.ts": 1,
    "cloudflare-worker/src/services/fundRollup.ts": 2,
    "cloudflare-worker/src/services/queueWorker.ts": 1,
    "cloudflare-worker/src/services/mercury/investorFeeds.ts": 3,
    "cloudflare-worker/src/services/mercury/match.ts": 2,
    "cloudflare-worker/src/routes/contacts.ts": 1,
    "cloudflare-worker/src/routes/spinout_lab.ts": 1,
  } },
  { kind: 'usd', reason: "AI tokens, token packs, credits and AI spend are US dollars (micro-USD ledger; packs are sold in USD only).", files: {
    "frontend/src/components/checkout/packModel.js": 9,
    "frontend/src/components/checkout/checkoutModel.js": 1,
    "frontend/src/lib/aiTokens.js": 2,
    "frontend/src/lib/labCredits.js": 1,
    "frontend/src/lib/pricingModel.js": 2,
    "frontend/src/lib/plansPricing.js": 2,
    "frontend/src/pages/admin/payments/payModel.js": 2,
    "cloudflare-worker/src/routes/admin_credit_rules.ts": 2,
    "cloudflare-worker/src/routes/catalog.ts": 3,
    "cloudflare-worker/src/rpc/branchOps.ts": 3,
    "cloudflare-worker/src/services/agents/reads.ts": 1,
    "cloudflare-worker/src/services/agents/rosterAdmin.ts": 1,
    "cloudflare-worker/src/services/aiAutoReload.ts": 1,
    "cloudflare-worker/src/services/aiCredits.ts": 6,
    "cloudflare-worker/src/services/aiSpendLimit.ts": 3,
    "cloudflare-worker/src/services/creditGrants.ts": 1,
  } },
  { kind: 'usd', reason: "Mercury reports US dollars only; the figures the Mercury feeds and Grow spend read are USD.", files: {
    "frontend/src/lib/mercurySpend.js": 1,
    "frontend/src/pages/investor/FromMercury.jsx": 1,
    "frontend/src/pages/cycles/mercuryRaise.js": 1,
    "cloudflare-worker/src/services/mercury/growFeeds.ts": 3,
    "cloudflare-worker/src/services/mercury/parse.ts": 1,
    "cloudflare-worker/src/services/mercury/raiseFeeds.ts": 3,
    "cloudflare-worker/src/services/mercurySpend.ts": 1,
    "frontend/src/pages/admin/consoles/bankCashModel.js": 1,
    "cloudflare-worker/src/services/reportFigures.ts": 1,
  } },
  { kind: 'usd', reason: "The spin-out revenue ledger is US dollars only: the Worker refuses any other currency (`currency_unsupported`).", files: {
    "frontend/src/components/spinout/RevenueLedger.jsx": 1,
    "frontend/src/lib/revenueLedger.js": 1,
    "cloudflare-worker/src/services/revenueLedger.ts": 1,
    "frontend/src/components/spinout/SafeIssuancesCard.jsx": 1,
  } },
  { kind: 'usd', reason: "Admin, advisor-firm, partner, network and founder surfaces that name US dollars in the column or the copy (`price_usd`, `hourly_rate_usd`, \"in dollars\", `$` in the string).", files: {
    "frontend/src/lib/moneyInput.js": 1,
    "frontend/src/lib/partnerSettlements.js": 1,
    "frontend/src/pages/ServiceCatalogPage.jsx": 2,
    "frontend/src/pages/admin/advisors/apOverviewModel.js": 1,
    "frontend/src/pages/admin/advisors/firmsModel.js": 1,
    "frontend/src/pages/admin/contracts/SettlementsDesk.jsx": 1,
    "frontend/src/pages/calendarAgentModel.js": 1,
    "frontend/src/pages/cycles/adapters/grow.js": 5,
    "frontend/src/pages/cycles/distribution/AdsTab.jsx": 3,
    "frontend/src/pages/cycles/distribution/OverviewTab.jsx": 1,
    "frontend/src/pages/cycles/distribution/adsModel.js": 1,
    "frontend/src/pages/cycles/distribution/campaignModel.js": 3,
    "frontend/src/pages/cycles/distribution/overviewModel.js": 1,
    "frontend/src/pages/cycles/distribution/resultsModel.js": 2,
    "frontend/src/pages/cycles/forms.js": 2,
    "frontend/src/pages/duediligence/ddListModel.js": 1,
    "frontend/src/pages/founder/FounderTeamPage.jsx": 2,
    "frontend/src/pages/founder/RoundCallSheet.jsx": 4,
    "frontend/src/pages/founder/raiseCallModel.js": 1,
    "frontend/src/pages/founder/roundCallParts.jsx": 2,
    "frontend/src/pages/partner/PartnerHomeP2.jsx": 1,
    "frontend/src/pages/partner/delivery/boardAttention.js": 2,
    "frontend/src/pages/PerksPage.jsx": 7,
    "frontend/src/pages/research/FundDossier.jsx": 2,
    "frontend/src/pages/research/FundReportsPanel.jsx": 2,
    "frontend/src/pages/research/FundsZone.jsx": 1,
    "frontend/src/pages/research/MarketZone.jsx": 3,
    "frontend/src/pages/research/marketReadingRead.js": 5,
    "frontend/src/pages/wellbeing/wellbeingModel.js": 1,
    "cloudflare-worker/src/routes/admin_network_reads.ts": 1,
    "cloudflare-worker/src/routes/admin_partner_firms.ts": 1,
    "cloudflare-worker/src/routes/network.ts": 3,
    "cloudflare-worker/src/routes/partner_delivery.ts": 1,
    "cloudflare-worker/src/routes/partner_pipeline.ts": 1,
    "cloudflare-worker/src/routes/partnernet.ts": 2,
    "cloudflare-worker/src/routes/research.ts": 7,
    // #4680 snapshots a legacy USD-only price in the atomic INSERT … SELECT.
    "cloudflare-worker/src/routes/services.ts": 4,
    "cloudflare-worker/src/services/conversationItems.ts": 1,
    "cloudflare-worker/src/services/decks/newDeck.ts": 1,
    "cloudflare-worker/src/services/decks/recordSources.ts": 2,
    "cloudflare-worker/src/services/growCycle.ts": 1,
    "cloudflare-worker/src/services/growKpis.ts": 3,
    "cloudflare-worker/src/services/mail/blocks.ts": 1,
    "cloudflare-worker/src/services/marketReadingRead.ts": 1,
    "cloudflare-worker/src/services/publishSources.ts": 1,
    "cloudflare-worker/src/services/raiseClaims.ts": 1,
    "cloudflare-worker/src/services/raiseCycle.ts": 5,
    "cloudflare-worker/src/services/records/raise.ts": 5,
    "cloudflare-worker/src/services/researchFundRead.ts": 1,
    "cloudflare-worker/src/services/roundCallPolicy.ts": 2,
    "cloudflare-worker/src/services/roundCalls.ts": 1,
    "cloudflare-worker/src/services/subscriptionPlans.ts": 1,
    "cloudflare-worker/src/services/captable.ts": 1,
  } },
  { kind: 'pending', reason: "Use of Funds money paths (scenario and hire amounts carry a currency column). Owned by #5375, which edits these files; migrating them here would collide. Named in D5373 as a follow-up.", files: {
    "frontend/src/pages/raise/useoffunds/ScenariosForecast.jsx": 1,
    "frontend/src/pages/raise/useoffunds/UseOfFundsParts.jsx": 1,
    "frontend/src/pages/raise/useoffunds/scenariosForecastModel.js": 5,
    "frontend/src/pages/raise/useoffunds/useOfFundsModel.js": 3,
    "cloudflare-worker/src/services/useOfFunds/legacy.ts": 2,
    "cloudflare-worker/src/services/useOfFunds/read.ts": 1,
    "cloudflare-worker/src/services/useOfFunds/store.ts": 4,
  } },
  { kind: 'pending', reason: "Advisor practice ledger, partner pipeline retainers and proposals, pitch chart sources and the Stripe MRR import hold amounts whose currency is a column of the row; the forms were not rebuilt here. Named in D5373 as a follow-up.", files: {
    "frontend/src/pages/advisor/practice/EarningsZone.jsx": 2,
    "frontend/src/pages/advisor/practice/SessionsZone.jsx": 1,
    "frontend/src/pages/advisor/practice/engagementCorrection.js": 1,
    "frontend/src/pages/advisor/practice/practiceTools.js": 2,
    "frontend/src/pages/partner/offers/AudienceFitZone.jsx": 1,
    "frontend/src/pages/partner/pipeline/ProposalsZone.jsx": 2,
    "frontend/src/pages/partner/pipeline/RetainersZone.jsx": 2,
    "frontend/src/pages/raise/pitch/chartModel.js": 1,
    "frontend/src/pages/raise/pitch/sourcesModel.js": 1,
    "cloudflare-worker/src/integrations/providers/stripe.ts": 3,
  } },
];

const listed = new Map();
for (const g of ALLOW) for (const [file, n] of Object.entries(g.files)) listed.set(file, { ...g, n });

const NAMES = { usd: /\bUSD\b|'usd'|"usd"|\bdollars?\b|micro_?usd|_usd\b|\$\{?|US\$/i, eur: /\bEUR\b|\beuros?\b|€/i };

test('the scan flags a hand-written factor of 100 on a money value, and only that', () => {
  const flagged = (line) => scanFile(line).length === 1;
  assert.ok(flagged('const price = cents / 100;'));
  assert.ok(flagged('const cents = Math.round(Number(amount) * 100);'));
  assert.ok(flagged('const whole = Math.floor(abs_cents / 100);'));
  assert.ok(flagged('return `${(price.unit_amount / 100).toFixed(2)} ${cur}`;'));
  assert.ok(flagged('const fee = 100 * dollars;'));
  assert.ok(!flagged('const pct = (paid / total) * 100;'), 'a percentage is not money');
  assert.ok(!flagged('const share_bps = rate * 100;'));
  assert.ok(!flagged('// the price is cents / 100 in a comment'));
  assert.ok(!flagged('/* amount * 100 */ const x = 1;'));
  assert.ok(!flagged("className=\"text-violet-100/70 amount\""), 'a Tailwind class is not an expression');
  assert.ok(!flagged('const price = formatMinor(cents, code);'));
  assert.ok(!flagged('const n = amount * 1000;'));
});

test('every flagged file is listed, with exactly the flagged lines it holds', () => {
  const found = scanTree(rootPath);
  const unlisted = Object.keys(found).filter((f) => !listed.has(f));
  assert.deepEqual(unlisted, [], `a money value is converted by a factor of 100 in a file the guard does not list; move it onto lib/money.js (formatMinor, parseMinor, toMajorString, formatStripeAmount ...):\n${unlisted.map((f) => `  ${f} (${found[f]})`).join('\n')}`);
  const changed = [...listed].filter(([f, g]) => found[f] !== g.n).map(([f, g]) => `${f}: lists ${g.n}, holds ${found[f] ?? 0}`);
  assert.deepEqual(changed, [], `a listed file gained or lost a flagged line; migrate it or fix the count:\n${changed.join('\n')}`);
});

test('a fixed-currency entry names the currency in its file, and every entry says why', () => {
  for (const [file, g] of listed) {
    assert.ok(g.reason.length >= 40, `${file}: the reason is a sentence`);
    if (g.kind === 'usd' || g.kind === 'eur') {
      const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      assert.match(text, NAMES[g.kind], `${file}: listed as ${g.kind.toUpperCase()} by contract but never names that currency`);
    }
  }
  assert.deepEqual([...new Set(ALLOW.map((g) => g.kind))].sort(), ['eur', 'not-money', 'pending', 'usd']);
});

test('every pending file is named in the decision file, so the follow-up list is explicit', () => {
  const decision = readFileSync(new URL('../../documentation/architecture/decisions/D5373.md', import.meta.url), 'utf8');
  const missing = [...listed].filter(([, g]) => g.kind === 'pending').map(([f]) => f).filter((f) => !decision.includes(f));
  assert.deepEqual(missing, [], 'a pending path is not named in D5373.md');
});

test('the surfaces D5373 migrated whole are off the allow-list and use the money layer (checkout, payModel and wellbeing keep USD-only lines, so they are listed and tested in money_surfaces_5373)', () => {
  const migrated = [
    'frontend/src/lib/partnerEarnings.js:formatMinor',
    'frontend/src/pages/events/myEventsModel.js:formatMinorOrCount',
    'frontend/src/pages/events/eventDrawersModel.js:formatMinorOrCount',
    'frontend/src/pages/admin/events/eventsDeskModel.js:formatMinorOrCount',
    'frontend/src/components/deals/dealMoney.js:formatMinor',
    'frontend/src/components/deals/dealRoomCopy.js:parseMinor',
    'frontend/src/pages/admin/licenceFeeInvoicesModel.js:parseMinor',
    'frontend/src/pages/admin/grants/grantsModel.js:parseMinor',
    'frontend/src/pages/admin/programs/referralPartnersModel.js:parseMinor',
    'frontend/src/pages/admin/programs/influencersModel.js:parseMinor',
    'frontend/src/pages/cycles/suggestionForms.js:parseMinor',
    'cloudflare-worker/src/services/licenceContract.ts:exponentOf',
    'cloudflare-worker/src/services/orders.ts:suffixAmount',
    'cloudflare-worker/src/services/influencer/payoutReadiness.ts:suffixAmount',
    'frontend/src/pages/raise/captable/instrumentsModel.js:toMajorString',
    'frontend/src/pages/raise/captable/overviewModel.js:majorToMinor',
    'cloudflare-worker/src/services/capTableAccessRecord.ts:toMajorString',
    'cloudflare-worker/src/services/capTableToday.ts:majorToMinor',
    'cloudflare-worker/src/services/capTableWrites.ts:toMajorString',
  ];
  for (const entry of migrated) {
    const [file, fn] = entry.split(':');
    assert.ok(!listed.has(file), `${file}: migrated, so it is not on the allow-list`);
    assert.match(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), new RegExp(`\\b${fn}\\b`), `${file} uses ${fn}`);
  }
});
