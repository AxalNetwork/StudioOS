/**
 * D771 (#2097, PR 1): every option the founder's boards offer that runs a
 * model, as data. D764 PR 3 (#2089) gives each one the models that fit its
 * work, and D771's later PRs call `useRailOption(key, label)` for each.
 *
 * Each entry:
 * - `page`: its page key in the canvas's names (`profiles.Founder` in
 *   `design/incoming/airail-every-page-data/canvas.json`):
 *   `Founder · <Section>` or `Founder · <Section> · <Module>`, and the home
 *   is `Founder · Studio` (D720 §5).
 * - `key`: `<verb>:<object>`, unique on its page. A band keeps its Worker
 *   name: `draft:<surface>` for a `DRAFT_SURFACES` entry, `fill:<kind>` for a
 *   `FILL_KINDS` entry.
 * - `label`: the words on the control the member presses.
 * - `kind`: one of the canvas's fourteen (`FOUNDER_KINDS`).
 * - `handler`: `form` (a fill band, or a form Eadwyn fills), `upload` (reads
 *   a file), `draft` (writes text: a draft, an answer, a summary, a review),
 *   `transcribe` (turns audio into text), or `none` (looks like one, runs no
 *   model; the rail never lists it).
 * - `route`: an address it is pressed on. D768's `pageKeyFor` (#2092) must
 *   answer `page` for it once the option's section calls `useRailOption`.
 * - `at`: where it lives, `[file, call]` pairs: the call is a literal in the
 *   file. `railOptions_founder_d771.test.mjs` holds the list to the code both
 *   ways.
 * - `rail` (only where it differs from `at`'s files): the files whose
 *   `useRailOption('<key>', …)` names it to the rail. Each one must.
 *
 * A tool page is listed on the board D768's page map (#2092) gives its route:
 * Pitch deck's editor and the positioning workspace are Pitch deck's, the
 * brand builder is Distribution's. Market intelligence's competitor tracker
 * redirects a founder to Research's Companies, whose board owns it.
 *
 * Pure data: it imports nothing.
 */

export const FOUNDER_KINDS = [
  'chat', 'code', 'legal', 'match', 'multi', 'numbers', 'plan',
  'reason', 'research', 'search', 'speech', 'synth', 'vision', 'write',
];

export const FOUNDER_HANDLERS = ['form', 'upload', 'draft', 'transcribe', 'none'];

const CYCLE = 'frontend/src/pages/cycles/CycleRoute.jsx';
const ADVISOR = 'frontend/src/components/advisor/PersonalAdvisor.jsx';
const SESSION = 'frontend/src/pages/founder/InterviewSessionPage.jsx';
const DECK = 'frontend/src/pages/PitchDeckPage.jsx';
const REVIEWER = 'frontend/src/pages/DeckReviewerPage.jsx';
const BRAND = 'frontend/src/pages/BrandBuilderPage.jsx';
const NETWORK_DESK = 'frontend/src/pages/founder/FounderNetworkDesk.jsx';
const ASK = 'frontend/src/pages/research/AskZone.jsx';
const LIBRARY = 'frontend/src/pages/research/LibraryZone.jsx';
const COMPETITORS = 'frontend/src/components/CompetitorAnalysis.jsx';
const ANALYSIS = 'frontend/src/pages/research/CompanyAnalysis.jsx';
const CANDIDATE = 'frontend/src/pages/research/CompanyCandidate.jsx';

export const FOUNDER_OPTIONS = [
  // ── Studio: the founder's home chat (`StudioInterview` → `PersonalAdvisor`).
  {
    page: 'Founder · Studio', key: 'ask:studio', route: '/studio', label: 'Send', kind: 'chat', handler: 'draft',
    at: [[ADVISOR, 'api.advisor.answer('], [ADVISOR, 'api.advisor.toolAuto(']],
  },
  {
    page: 'Founder · Studio', key: 'explain:question', route: '/studio', label: 'Explain', kind: 'chat', handler: 'draft',
    at: [[ADVISOR, 'api.advisor.explainUrl(']],
  },
  {
    page: 'Founder · Studio', key: 'transcribe:voice-answer', route: '/studio', label: 'Record a voice answer', kind: 'speech', handler: 'transcribe',
    at: [[ADVISOR, 'api.advisor.transcribe(']],
  },

  // ── Validate.
  {
    page: 'Founder · Validate · Problem discovery', key: 'fill:pain_tag', route: '/validate/problem-discovery', label: 'Tag ungrouped phrases', kind: 'synth', handler: 'form',
    at: [[CYCLE, "'pain_tag'"]],
  },
  // Record a session opens from every Validate page; it is Customer research's Add.
  {
    page: 'Founder · Validate · Customer research', key: 'transcribe:interview', route: '/validate/record', label: 'Record a session', kind: 'speech', handler: 'transcribe',
    at: [['frontend/src/pages/founder/RecordLightbox.jsx', 'sessions.create('], ['frontend/src/pages/founder/RecordLightbox.jsx', 'sessions.open(']],
    // D768 names it where the lightbox is mounted (`RecordMount`).
    rail: [CYCLE],
  },
  {
    page: 'Founder · Validate · Customer research', key: 'transcribe:session', route: '/validate/record/live', label: 'Stop and process', kind: 'speech', handler: 'transcribe',
    at: [['frontend/src/lib/activeRecording.js', 'api.finish('], ['frontend/src/lib/activeRecording.js', 'api.process(']],
    // The store runs it; the live view, which draws the processing, names it.
    rail: ['frontend/src/pages/founder/RecordingView.jsx'],
  },
  {
    page: 'Founder · Validate · Customer research', key: 'transcribe:recording', route: '/validate/customer-research/1', label: 'Transcribe', kind: 'speech', handler: 'transcribe',
    at: [['frontend/src/workspaces/founder/InterviewRecording.jsx', 'api.transcribeInterview('], [SESSION, 'api.transcribe(']],
  },
  {
    page: 'Founder · Validate · Customer research', key: 'summarise:session', route: '/validate/customer-research/1', label: 'Summarise', kind: 'synth', handler: 'draft',
    at: [['frontend/src/pages/founder/InterviewReviewPage.jsx', 'sessions.summarise('], [SESSION, 'api.summarise(']],
  },
  {
    page: 'Founder · Validate · Customer research', key: 'structure:transcript', route: '/validate/session/1', label: 'Structure the transcript', kind: 'synth', handler: 'draft',
    at: [[SESSION, 'api.structure(']],
  },
  {
    page: 'Founder · Validate · Customer research', key: 'ask:transcript', route: '/validate/session/1', label: 'Ask', kind: 'research', handler: 'draft',
    at: [[SESSION, 'api.ask(']],
  },
  {
    page: 'Founder · Validate · Experiments and evidence', key: 'fill:hypothesis', route: '/validate/experiments', label: 'Draft a hypothesis', kind: 'reason', handler: 'form',
    at: [[CYCLE, "experiments: 'hypothesis'"]],
  },
  {
    page: 'Founder · Validate · Verdict', key: 'export:summary', route: '/validate/verdict', label: 'Export summary', kind: 'reason', handler: 'none',
    at: [[CYCLE, 'api.exportValidateSummary(']],
  },

  // ── Build.
  {
    page: 'Founder · Build · Product roadmap', key: 'draft:build/roadmap', route: '/build/product-roadmap', label: 'Argue the ordering', kind: 'plan', handler: 'draft',
    at: [[CYCLE, "surface: 'build/roadmap'"]],
  },
  {
    page: 'Founder · Build · Operating systems', key: 'draft:build/this-week', route: '/build/operating-systems', label: 'Draft a Monday plan', kind: 'plan', handler: 'draft',
    at: [[CYCLE, "surface: 'build/this-week'"]],
  },
  {
    page: 'Founder · Build · Operating systems', key: 'draft:build/retro', route: '/build/operating-systems', label: 'Draft a retro summary', kind: 'synth', handler: 'draft',
    at: [[CYCLE, "surface: 'build/retro'"]],
  },
  {
    page: 'Founder · Build · Operating systems', key: 'draft:build/kpi', route: '/build/operating-systems', label: 'Draft an annotation', kind: 'numbers', handler: 'draft',
    at: [[CYCLE, "surface: 'build/kpi'"]],
  },

  // ── Raise.
  {
    page: 'Founder · Raise · Fundraising readiness', key: 'draft:raise/data-room', route: '/raise/fundraising-readiness', label: 'Read the room', kind: 'reason', handler: 'draft',
    at: [[CYCLE, "surface: 'raise/data-room'"]],
  },
  {
    page: 'Founder · Raise · Fundraising readiness', key: 'draft:raise/legal', route: '/raise/fundraising-readiness', label: 'Explain the clauses', kind: 'legal', handler: 'draft',
    at: [[CYCLE, "surface: 'raise/legal'"]],
  },
  {
    page: 'Founder · Raise · Investor narrative', key: 'draft:raise/narrative-fix', route: '/raise/investor-narrative', label: 'Phrase the fix', kind: 'write', handler: 'draft',
    at: [[CYCLE, "surface: 'raise/narrative-fix'"]],
  },
  // The positioning workspace: Investor narrative's tool link opens it inside the
  // pitch workspace, which D768's page map keys to Pitch deck.
  {
    page: 'Founder · Raise · Pitch deck', key: 'draft:positioning', route: '/raise/pitch/positioning', label: 'Generate positioning', kind: 'write', handler: 'draft',
    at: [['frontend/src/pages/PitchPositioningPage.jsx', 'api.deckPositioning(']],
  },
  // The pitch deck's editor, the module's tool link, and its Review tab.
  {
    page: 'Founder · Raise · Pitch deck', key: 'form:deck', route: '/raise/pitch?mode=workspace', label: 'Fill from project', kind: 'write', handler: 'form',
    at: [[DECK, 'api.deckAutofill(']],
  },
  {
    page: 'Founder · Raise · Pitch deck', key: 'form:deck-template', route: '/raise/pitch?mode=workspace', label: 'Use this template', kind: 'write', handler: 'form',
    at: [[DECK, 'api.deckApplyMethod(']],
  },
  {
    page: 'Founder · Raise · Pitch deck', key: 'review:deck-file', route: '/raise/pitch/review', label: 'Drop your deck here or click to browse', kind: 'vision', handler: 'upload',
    at: [[REVIEWER, '/api/deck-reviewer/upload']],
  },
  {
    page: 'Founder · Raise · Pitch deck', key: 'review:deck-text', route: '/raise/pitch/review', label: 'Review pasted text', kind: 'reason', handler: 'draft',
    at: [[REVIEWER, 'deckReviewer.paste(']],
  },
  {
    page: 'Founder · Raise · Pitch deck', key: 'review:deck-again', route: '/raise/pitch/review', label: 'Regenerate review', kind: 'reason', handler: 'draft',
    at: [[REVIEWER, 'deckReviewer.regenerate(']],
  },
  {
    page: 'Founder · Raise · Cap table', key: 'draft:raise/capital', route: '/raise/cap-table', label: 'Read the round back', kind: 'numbers', handler: 'draft',
    at: [[CYCLE, "surface: 'raise/capital'"]],
  },
  {
    page: 'Founder · Raise · Cap table', key: 'draft:raise/liquidity', route: '/raise/cap-table', label: 'Explain the order of payment', kind: 'numbers', handler: 'draft',
    at: [[CYCLE, "surface: 'raise/liquidity'"]],
  },

  // ── Grow. Share an update is the section's action, on every Grow page.
  {
    page: 'Founder · Grow', key: 'draft:update', route: '/grow/update', label: 'Share an update', kind: 'write', handler: 'draft',
    at: [['frontend/src/pages/founder/ShareUpdateSheet.jsx', 'shareUpdateApi.draftLines(']],
  },
  {
    page: 'Founder · Grow · Product improvement', key: 'fill:feedback_theme', route: '/grow/product-improvement', label: 'Propose themes', kind: 'synth', handler: 'form',
    at: [[CYCLE, "'feedback_theme'"]],
  },
  {
    page: 'Founder · Grow · Distribution', key: 'draft:grow/customers', route: '/grow/distribution', label: 'Draft a sequence', kind: 'write', handler: 'draft',
    at: [[CYCLE, "surface: 'grow/customers'"]],
  },
  // The brand builder, Distribution's "Open landing-page builder" door.
  {
    page: 'Founder · Grow · Distribution', key: 'form:landing', route: '/build/brand', label: 'Auto-fill with AI', kind: 'write', handler: 'form',
    at: [[BRAND, 'api.brandAutofillLanding(']],
  },
  {
    page: 'Founder · Grow · Distribution', key: 'draft:logo', route: '/build/brand', label: 'Regenerate logo', kind: 'vision', handler: 'draft',
    at: [[BRAND, 'api.brandLogo(']],
  },
  {
    page: 'Founder · Grow · Distribution', key: 'form:palette', route: '/build/brand', label: 'Suggest AI palette', kind: 'write', handler: 'form',
    at: [[BRAND, 'api.brandSuggestPalette(']],
  },
  {
    page: 'Founder · Grow · Distribution', key: 'draft:taglines', route: '/build/brand', label: 'Iterate', kind: 'write', handler: 'draft',
    at: [[BRAND, 'api.brandSuggestTaglines(']],
  },
  {
    page: 'Founder · Grow · Team expansion', key: 'draft:grow/talent', route: '/grow/team-expansion', label: 'Rank the applicants', kind: 'match', handler: 'draft',
    at: [[CYCLE, "surface: 'grow/talent'"]],
  },

  // ── Network. The desk's two bands, and the workspace's Relationships and Introductions tabs.
  {
    page: 'Founder · Network', key: 'draft:network/re-engagement', route: '/network', label: 'Draft a re-engagement note', kind: 'write', handler: 'draft',
    at: [[NETWORK_DESK, 'surface="network/re-engagement"']],
  },
  {
    page: 'Founder · Network', key: 'draft:network/intro-email', route: '/network', label: 'Draft an intro email', kind: 'write', handler: 'draft',
    at: [[NETWORK_DESK, 'surface="network/intro-email"']],
  },
  {
    page: 'Founder · Network · Relationships', key: 'draft:network/relationships', route: '/network?mode=workspace&tab=relationships', label: 'Draft the reassignment', kind: 'match', handler: 'draft',
    at: [['frontend/src/pages/RelationshipsPage.jsx', 'surface="network/relationships"']],
  },
  {
    page: 'Founder · Network · Introductions', key: 'draft:network/introductions', route: '/network?mode=workspace&tab=introductions', label: 'Suggest paths', kind: 'match', handler: 'draft',
    at: [['frontend/src/pages/IntroductionsPanel.jsx', 'surface="network/introductions"']],
  },

  // ── Research.
  {
    page: 'Founder · Research', key: 'ask:research', route: '/research', label: 'Ask', kind: 'research', handler: 'draft',
    at: [['frontend/src/pages/founder/FounderResearchDesk.jsx', 'api.research.ask(']],
  },
  {
    page: 'Founder · Research · Ask', key: 'ask:library', route: '/research/ask', label: 'Ask', kind: 'research', handler: 'draft',
    at: [[ASK, 'api.research.ask(']],
  },
  {
    page: 'Founder · Research · Ask', key: 'draft:research/ask', route: '/research/ask', label: 'Draft the brief', kind: 'research', handler: 'draft',
    at: [[ASK, 'surface="research/ask"']],
  },
  {
    page: 'Founder · Research · Library', key: 'upload:document', route: '/research/library', label: 'Add to library', kind: 'search', handler: 'upload',
    at: [[LIBRARY, 'api.research.upload(']],
  },
  {
    page: 'Founder · Research · Library', key: 'upload:reindex', route: '/research/library', label: 'Re-index', kind: 'search', handler: 'upload',
    at: [[LIBRARY, 'api.research.reindex(']],
  },
  {
    page: 'Founder · Research · Library', key: 'draft:research/library', route: '/research/library', label: 'Draft the gaps', kind: 'search', handler: 'draft',
    at: [[LIBRARY, 'surface="research/library"']],
  },
  {
    page: 'Founder · Research · Funds', key: 'draft:research/funds', route: '/research/funds/1', label: 'Draft the brief', kind: 'research', handler: 'draft',
    at: [['frontend/src/pages/research/FundDossier.jsx', 'surface="research/funds"']],
  },
  {
    page: 'Founder · Research · Companies', key: 'analyse:competitors', route: '/research/companies?tab=analyses', label: 'Analyze competitors', kind: 'research', handler: 'draft',
    at: [[COMPETITORS, 'api.competitors.analyze(']],
  },
  {
    page: 'Founder · Research · Companies', key: 'analyse:again', route: '/research/companies/1', label: 'Re-run', kind: 'research', handler: 'draft',
    at: [[COMPETITORS, 'api.competitors.rerun('], [ANALYSIS, 'api.competitors.rerun(']],
  },
  {
    page: 'Founder · Research · Companies', key: 'analyse:sources', route: '/research/companies/1', label: 'Refresh sources', kind: 'research', handler: 'draft',
    at: [[COMPETITORS, 'api.competitors.refresh('], [ANALYSIS, 'api.competitors.refresh(']],
  },
  // Runs a model only with "Crawl site" ticked and a URL given.
  {
    page: 'Founder · Research · Companies', key: 'extract:candidate', route: '/research/companies/1', label: 'Add', kind: 'research', handler: 'draft',
    at: [[COMPETITORS, 'api.competitors.addCandidate('], [ANALYSIS, 'api.competitors.addCandidate(']],
  },
  {
    page: 'Founder · Research · Companies', key: 'extract:site', route: '/research/companies/1/1', label: 'Crawl site', kind: 'research', handler: 'draft',
    at: [[CANDIDATE, 'api.competitors.crawlCandidate(']],
  },
  // The two "Draft" buttons build their text in the browser.
  {
    page: 'Founder · Research · Companies', key: 'draft:landscape', route: '/research/companies/1', label: 'Draft', kind: 'research', handler: 'none',
    at: [[ANALYSIS, 'landscapeRead(analysis)'], [CANDIDATE, 'draftText(candidate.summary, sources)']],
  },
  {
    page: 'Founder · Research · Markets', key: 'draft:reading', route: '/research/markets/1', label: 'Draft', kind: 'research', handler: 'none',
    at: [['frontend/src/pages/research/MarketReading.jsx', 'it does not call a model']],
  },
];

/**
 * The founder's pages with no option that runs a model: each still has its
 * page row (D764 PR 1), and the rail lists no option there. The reason is
 * what the survey for #2097 found.
 */
export const FOUNDER_QUIET_PAGES = {
  'Founder · Validate': 'Record a session opens Customer research’s recorder; the overview runs nothing itself.',
  'Founder · Validate · Ideal customer profile': 'Its records and forms only.',
  'Founder · Validate · Market intelligence': 'Its tool link opens Research’s Companies, which owns the competitor analysis.',
  'Founder · Validate · Demand and urgency signals': 'Its records and forms only.',
  'Founder · Validate · Verdict': 'Export summary is a CSV the Worker builds; no model.',
  'Founder · Build': 'Connect a tool and Create your startup run no model.',
  'Founder · Build · Solution design': 'Its records and forms only.',
  'Founder · Build · Prototype / MVP': 'Its records and forms only.',
  'Founder · Build · Founding team': 'Its tool is the cap table, which runs no model.',
  'Founder · Build · Company creation': 'Its legal and e-signature doors run no model; the legal generator refuses founders.',
  'Founder · Raise': 'Call for Capital matches by rule.',
  'Founder · Raise · Data room': 'The files tool and the access view run no model; the room is read on Fundraising readiness.',
  'Founder · Raise · Use of funds': 'The financial model runs no model.',
  'Founder · Raise · Capital relationships': 'The pipeline, the investor match and Match to my Mercury run no model.',
  'Founder · Grow · Revenue and traction': 'The metric log runs no model.',
  'Founder · Grow · Partner network': 'Its records only.',
  'Founder · Grow · Market expansion': 'Its records only; no translation runs.',
  'Founder · Grow · Durable company-building': 'Its Share an update is the section’s; the checklist and the compliance calendar run no model.',
  'Founder · Network · Organizations': 'The founder’s zone runs no model; the organizations band is a partner’s.',
  'Founder · Research · Markets': 'Recording a reading and its Draft run no model.',
  'Founder · Research · Geographies': 'Read only.',
};
