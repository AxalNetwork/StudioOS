/**
 * D772 (#2098) PR 1 — every option on the investor's boards that runs a model.
 *
 * The input D764 PR 3 (#2089) reads to give each option the models that fit
 * its work (D720 §11, the owner's "keep the models that are best for the
 * concerned sections, modules and options"). One row per option:
 *
 *   page     the canvas board, by its names in
 *            `design/incoming/airail-every-page-data/canvas.json`
 *            ("Investor · <section>" or "Investor · <section> · <board>");
 *   key      `<verb>:<object>`, unique on its page;
 *   label    what the member sees on the control;
 *   kind     one of the canvas's fourteen task kinds, for the work this
 *            option does, which can differ from its board's own kind;
 *   handler  form, upload, draft, transcribe or none;
 *   source   where the control is: `file` (under `frontend/src/`) and `match`,
 *            the band's `surface` or the API call, which the parity test
 *            (`frontend/test/rail_options_investor_d772.test.mjs`) finds.
 *
 * An option that runs no model (a CRUD write, a client-side CSV export, the
 * Network's heuristic propositions) is not listed, and the rail lists none.
 * Boards with no row offer no such option today: Deals, Portfolio, Performance,
 * Axal VC Fund, Fund, Overview, LPs, Distributions, Reporting, Network and its
 * three boards, Benchmarking and Markets.
 */
export const INVESTOR_RAIL_OPTIONS = Object.freeze([
  // Deals
  { page: 'Investor · Deals · Pipeline', key: 'draft:stale-deal-notes', label: 'Draft the notes', kind: 'write', handler: 'draft',
    source: { file: 'pages/investor/deals/PipelineZone.jsx', match: 'surface="deals/pipeline"' } },
  { page: 'Investor · Deals · Screening', key: 'draft:screening-memo', label: 'Draft the memo', kind: 'reason', handler: 'draft',
    source: { file: 'pages/investor/deals/ScreeningZone.jsx', match: 'surface="deals/screening"' } },
  { page: 'Investor · Deals · Commit', key: 'draft:ic-memo', label: 'Draft the memo', kind: 'reason', handler: 'draft',
    source: { file: 'pages/investor/deals/CommitZone.jsx', match: 'surface="deals/commit"' } },
  { page: 'Investor · Deals · Closing', key: 'draft:closing-cover-note', label: 'Draft the note', kind: 'write', handler: 'draft',
    source: { file: 'pages/investor/deals/ClosingZone.jsx', match: 'surface="deals/closing"' } },
  // Portfolio
  { page: 'Investor · Portfolio · Positions', key: 'draft:multiple-narrative', label: 'Draft the narrative', kind: 'numbers', handler: 'draft',
    source: { file: 'pages/investor/InvestorPortfolioPositions.jsx', match: 'surface="portfolio/positions"' } },
  { page: 'Investor · Portfolio · Updates', key: 'draft:updates-read', label: 'Draft the read', kind: 'synth', handler: 'draft',
    source: { file: 'pages/investor/InvestorPortfolioUpdates.jsx', match: 'surface="portfolio/updates"' } },
  { page: 'Investor · Portfolio · Value-add', key: 'draft:support-summary', label: 'Draft the summary', kind: 'write', handler: 'draft',
    source: { file: 'pages/investor/InvestorPortfolioValueAdd.jsx', match: 'surface="portfolio/value-add"' } },
  // Fund
  { page: 'Investor · Fund · Capital calls', key: 'draft:lp-reminder', label: 'Draft the reminder', kind: 'write', handler: 'draft',
    source: { file: 'pages/investor/InvestorFundCalls.jsx', match: 'surface="funds/calls"' } },
  // Research
  { page: 'Investor · Research', key: 'ask:evidence', label: 'Find evidence', kind: 'research', handler: 'form',
    source: { file: 'pages/investor/InvestorResearchWorkspace.jsx', match: 'api.research.ask(' } },
  { page: 'Investor · Research · Ask', key: 'ask:question', label: 'Ask', kind: 'research', handler: 'form',
    source: { file: 'pages/research/AskZone.jsx', match: 'api.research.ask(' } },
  { page: 'Investor · Research · Ask', key: 'draft:session-brief', label: 'Draft the brief', kind: 'synth', handler: 'draft',
    source: { file: 'pages/research/AskZone.jsx', match: 'surface="research/ask"' } },
  { page: 'Investor · Research · Diligence', key: 'draft:thin-evidence', label: 'Draft', kind: 'reason', handler: 'draft',
    source: { file: 'pages/research/DiligenceRoom.jsx', match: 'surface="research/diligence"' } },
  { page: 'Investor · Research · Library', key: 'upload:document', label: 'Add to library', kind: 'search', handler: 'upload',
    source: { file: 'pages/research/LibraryZone.jsx', match: 'api.research.upload(' } },
  { page: 'Investor · Research · Library', key: 'reindex:document', label: 'Re-index', kind: 'search', handler: 'upload',
    source: { file: 'pages/research/LibraryZone.jsx', match: 'api.research.reindex(' } },
  { page: 'Investor · Research · Library', key: 'draft:index-gaps', label: 'Draft the gaps', kind: 'synth', handler: 'draft',
    source: { file: 'pages/research/LibraryZone.jsx', match: 'surface="research/library"' } },
]);

/** The handlers a row may name (D771 and D772, S1 2026-10-19). */
export const RAIL_OPTION_HANDLERS = Object.freeze(['form', 'upload', 'draft', 'transcribe', 'none']);

/**
 * Every file an investor board renders that could hold a model-running
 * control. The parity test reads each for `<ZoneDraft surface=…>` bands and
 * `api.research.ask|upload|reindex(` calls; each one found must be a row.
 */
export const INVESTOR_BOARD_FILES = Object.freeze([
  'workspaces/investor/InvestorDealsRoutes.jsx',
  'pages/investor/deals/PipelineZone.jsx', 'pages/investor/deals/ScreeningZone.jsx',
  'pages/investor/deals/CommitZone.jsx', 'pages/investor/deals/ClosingZone.jsx',
  'pages/investor/InvestorPortfolioCanvas.jsx', 'pages/investor/InvestorPortfolioPositions.jsx',
  'pages/PortfolioPerformancePage.jsx', 'pages/investor/InvestorPortfolioUpdates.jsx',
  'pages/investor/InvestorPortfolioValueAdd.jsx', 'pages/SpinoutLabLpWorkspacePage.jsx',
  'pages/investor/InvestorFundLanding.jsx', 'pages/investor/InvestorFundLPs.jsx',
  'pages/investor/InvestorFundCalls.jsx', 'pages/investor/InvestorFundAccounting.jsx',
  'pages/investor/InvestorFundReporting.jsx', 'pages/investor/InvestorNetworkWorkspace.jsx',
  'pages/investor/InvestorResearchWorkspace.jsx', 'pages/research/AskZone.jsx',
  'pages/research/DiligenceZone.jsx', 'pages/research/DiligenceRoom.jsx', 'pages/research/DiligenceFile.jsx',
  'pages/research/BenchmarkingZone.jsx', 'pages/research/BenchmarkDetail.jsx',
  'pages/research/MarketDirectoryZone.jsx', 'pages/research/MarketReading.jsx', 'pages/research/MarketSectorProfile.jsx',
  'pages/research/LibraryZone.jsx',
]);
