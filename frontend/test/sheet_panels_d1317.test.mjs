/**
 * D1317 — every detail panel opens as the shared Sheet. One row per panel
 * moved: the file draws `<Sheet …>` with the panel's testId (so its tests
 * still find it), and no `<Lightbox …>` or hand-rolled overlay carries that
 * testId any more.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/sheet_panels_d1317.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

// [area, file under frontend/src, the panel's testId as its source writes it]
export const SHEET_PANELS = [
  ['Account › Builder', 'pages/account/builder/BuilderSection.jsx', 'testId={`builder-drawer-${drawer.kind}`}'],
  ['Accounts', 'pages/admin/consoles/UsersConsole.jsx', 'testId="account-drawer"'],
  ['Approvals › item', 'pages/admin/approvals/AdminApprovals.jsx', 'testId="approvals-item"'],
  ['Approvals › product tester', 'pages/admin/approvals/TesterBoard.jsx', 'testId="tester-drawer"'],
  ['Approvals › co-marketing pitch', 'pages/admin/approvals/PitchBoard.jsx', 'testId="pitch-drawer"'],
  ['Approvals › wellbeing expert', 'pages/admin/approvals/ExpertBoard.jsx', 'testId="expert-drawer"'],
  ['Advisors & Partners › person', 'pages/admin/advisors/PersonDrawer.jsx', 'testId="person-drawer"'],
  ['Advisors & Partners › firm', 'pages/admin/advisors/FirmDrawer.jsx', 'testId="ap-firm-drawer"'],
  ['Advisors & Partners › deck card', 'pages/admin/advisors/DeckRosterDialogs.jsx', 'testId="deck-card-dialog"'],
  ['Bank accounts › account', 'pages/admin/consoles/BankAccountLightbox.jsx', 'testId="bank-account-lightbox"'],
  ['Bank accounts › missing', 'pages/admin/consoles/BankAccountLightbox.jsx', 'testId="bank-account-missing"'],
  ['Promo codes › code', 'pages/admin/promos/PromoParts.jsx', 'testId="promo-drawer"'],
  ['Insights › group', 'pages/admin/insights/AdminInsights.jsx', 'testId="insights-group"'],
  ['Partner invitations › invitation', 'pages/admin/partners/InvitationRecord.jsx', 'testId="partners-invitation'],
  ['Partner invitations › deal', 'pages/admin/partners/DealRecord.jsx', 'testId="partners-deal'],
  ['Partner profiles › profile', 'pages/admin/profiles/ProfileRecord.jsx', 'testId="pp-record"'],
  ['KYC › document', 'pages/admin/kyc/KycViewer.jsx', 'testId="kyc-viewer"'],
  ['Deal page › syndicate', 'components/deals/DealSyndicates.jsx', 'testId="dr-syndicate-drawer"'],
  ['Deal page › note', 'pages/deal/DealNotes.jsx', 'testId={`deal-note-${mode}-dialog`}'],
  ['Deal flow › filters', 'pages/investor/dealflow/FlowControls.jsx', 'testId="dealflow-filters"'],
  ['Studio lens › terms', 'pages/investor/dealflow/StudioLens.jsx', 'testId="studio-terms'],
  ['Venture scorecard › scope', 'components/scoring/scorecard/Scorecard.jsx', 'testId={`scorecard-drawer-'],
  ['Spin-Out scoring › dimension', 'components/scoring/DimensionDrawer.jsx', 'testId="scoring-drawer"'],
  ['Portfolio company › report', 'pages/investor/CompanyReports.jsx', 'testId="company-reader"'],
  ['Portfolio company › period', 'pages/investor/CompanyReports.jsx', 'testId="company-period-sheet"'],
  ['Portfolio › position', 'pages/PortfolioPositionsPage.jsx', 'testId="portfolio-position-sheet"'],
  ['Portfolio › update', 'pages/PortfolioUpdatesPage.jsx', 'testId="portfolio-update-sheet"'],
  ['Portfolio › health', 'pages/PortfolioHealthPage.jsx', 'testId="portfolio-health-sheet"'],
  ['Pipeline › deal', 'pages/PipelinePage.jsx', 'testId="pipeline-deal-sheet"'],
  ['Funds › LPA', 'pages/FundsPage.jsx', 'testId="fund-lpa-sheet"'],
];

/** The panel frame that carries `needle`: the nearest Sheet, Lightbox or hand-rolled overlay opened before it. */
function tagAround(src, needle) {
  const at = src.indexOf(needle);
  if (at < 0) return null;
  const head = src.slice(0, at);
  const frames = [['Sheet', /<Sheet\b/g], ['Lightbox', /<Lightbox\b/g], ['overlay', /<(?:div|aside)\b[^>]*\bfixed (?:inset-0|inset-y-0)/g]];
  let best = null; let bestAt = -1;
  for (const [name, re] of frames) {
    for (const m of head.matchAll(re)) if (m.index > bestAt) { bestAt = m.index; best = name; }
  }
  return best;
}

test('every moved detail panel is drawn by the shared Sheet, under its own testId', () => {
  for (const [area, file, needle] of SHEET_PANELS) {
    const src = read(file);
    assert.ok(src.includes(needle), `${area}: ${file} no longer carries ${needle}`);
    assert.equal(tagAround(src, needle), 'Sheet', `${area}: ${needle} is not on a <Sheet>`);
    assert.match(src, /import Sheet from '[./]+\/?(?:ui\/)?Sheet\.jsx';|import Sheet from '(?:\.\.\/)+ui\/Sheet\.jsx';/, `${area}: ${file} does not import the shared Sheet`);
  }
});

test('Payments: the product record is a Sheet; Stripe’s dialogs, which change something, stay centred', () => {
  const ui = read('pages/admin/payments/payUi.jsx');
  assert.match(ui, /const Frame = sheet \? Sheet : Lightbox;/);
  assert.match(read('pages/admin/payments/ProductLightbox.jsx'), /<PayDialog sheet label=\{title\}[^>]*testId="pay-product">/);
  assert.doesNotMatch(read('pages/admin/payments/StripeDialogs.jsx'), /<PayDialog sheet/);
});

test('what stays centred: confirmations and action dialogs beside the moved panels', () => {
  for (const [file, needle] of [
    ['pages/admin/advisors/PersonDrawer.jsx', 'testId={`person-${act}-dialog`}'],
    ['pages/admin/advisors/FirmDrawer.jsx', 'testId={testId}'],
    ['pages/admin/partners/DealRecord.jsx', 'testId="partners-rerun-dialog"'],
    ['pages/investor/dealflow/FlowControls.jsx', 'testId="dealflow-delete-view"'],
    ['pages/investor/dealflow/StudioLens.jsx', 'testId="studio-move-'],
    ['pages/investor/CompanyReports.jsx', 'testId="company-ask'],
  ]) {
    const src = read(file);
    if (!src.includes(needle)) continue; // a dialog renamed since is checked by its own suite
    assert.equal(tagAround(src, needle), 'Lightbox', `${file}: ${needle} should stay a centred Lightbox`);
  }
});
