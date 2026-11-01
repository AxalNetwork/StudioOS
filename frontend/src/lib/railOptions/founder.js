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
 * - `kind`: one of the canvas's fourteen (`FOUNDER_KINDS`), or an option-only
 *   kind (`OPTION_KINDS`, D1478: `image`), which also names its `task`.
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
/** D1478 (#3721): kinds only an option takes, each run by the fixed job its `task` names. */
export const OPTION_KINDS = ['image'];

const CYCLE = 'frontend/src/pages/cycles/CycleRoute.jsx';
const PMF = 'frontend/src/workspaces/PmfExplain.jsx';
const UOF = 'frontend/src/workspaces/UseOfFundsEadwyn.jsx';
const ADVISOR = 'frontend/src/components/advisor/PersonalAdvisor.jsx';
const SESSION = 'frontend/src/pages/founder/InterviewSessionPage.jsx';
const REVIEWER = 'frontend/src/pages/DeckReviewerPage.jsx';
const NEW_DECK = 'frontend/src/pages/raise/pitch/NewDeck.jsx';
// D1604 (#3716, pd1): the one-click moved from PitchStudio.jsx to the studio's home.
const ONE_CLICK = 'frontend/src/pages/raise/pitch/OneClickBuild.jsx';
const TEMPLATES = 'frontend/src/pages/raise/pitch/TemplatesGallery.jsx';
const STUDIO_ACTIONS = 'frontend/src/pages/raise/pitch/StudioActions.jsx';
const REHEARSE = 'frontend/src/pages/raise/pitch/RehearsePanel.jsx';
const PITCH_REVIEW = 'frontend/src/pages/raise/pitch/PitchReview.jsx';
const AREA_LIGHTBOX = 'frontend/src/pages/raise/pitch/AreaLightbox.jsx';
const INSTRUCTION_BOX = 'frontend/src/pages/raise/pitch/InstructionBox.jsx';
const ADD_MENU = 'frontend/src/pages/raise/pitch/AddMenu.jsx';
const IMAGE_LIGHTBOX = 'frontend/src/pages/raise/pitch/ImageLightbox.jsx';
const CONNECTOR_CARD = 'frontend/src/pages/raise/pitch/ConnectorLightbox.jsx';
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
    // D1455 (#3710, REC2): the session page's Try again runs the same processing again.
    at: [['frontend/src/lib/activeRecording.js', 'api.finish('], ['frontend/src/lib/activeRecording.js', 'api.process('], [SESSION, 'api.process(']],
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
  // D1071 (#2941): Plan the build's "Word with Eadwyn" — the rules' items worded, kept only by an item's Save.
  {
    page: 'Founder · Build', key: 'draft:build/plan', route: '/build/plan', label: 'Word with Eadwyn', kind: 'write', handler: 'draft',
    at: [['frontend/src/pages/cycles/BuildPlan.jsx', 'buildPlanApi.word(']],
  },
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
    page: 'Founder · Raise · Use of funds', key: 'draft:raise/use-of-funds-check', route: '/raise/use-of-funds', label: 'Check this plan', kind: 'reason', handler: 'draft',
    at: [[UOF, 'useOfFundsApi.previewReading(']],
  },
  {
    page: 'Founder · Raise · Use of funds', key: 'draft:raise/use-of-funds-runway', route: '/raise/use-of-funds/runway', label: 'Explain the runway', kind: 'numbers', handler: 'draft',
    at: [[UOF, 'useOfFundsApi.previewReading(']],
  },
  {
    page: 'Founder · Raise · Use of funds', key: 'form:uof-milestone-wording', route: '/raise/use-of-funds/new', label: 'Suggest milestone wording', kind: 'write', handler: 'form',
    at: [[UOF, 'useOfFundsApi.previewReading(']],
  },
  {
    page: 'Founder · Raise · Fundraising readiness', key: 'draft:raise/pmf-explain', route: '/raise/fundraising-readiness', label: 'Explain this score', kind: 'reason', handler: 'draft',
    at: [[PMF, "explain: 'draft:raise/pmf-explain'"]],
  },
  {
    page: 'Founder · Raise · Fundraising readiness', key: 'draft:raise/pmf-questions', route: '/raise/fundraising-readiness', label: 'Questions for the next interviews', kind: 'write', handler: 'draft',
    at: [[PMF, "questions: 'draft:raise/pmf-questions'"]],
  },
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
  // D911 (#2695): positioning moved into the Investor narrative tool, so its
  // option moved from Pitch deck's page to the narrative's (was draft:positioning).
  {
    page: 'Founder · Raise · Investor narrative', key: 'draft:narrative-positioning', route: '/raise/investor-narrative/positioning', label: 'Propose positioning', kind: 'write', handler: 'draft',
    at: [['frontend/src/pages/raise/narrative/PositioningTab.jsx', 'narrativeApi.proposePositioning(']],
  },
  // D1114 (#2994): Story's "Ask Eadwyn ▾" — draft this section, shorten it, or plain words.
  {
    page: 'Founder · Raise · Investor narrative', key: 'draft:narrative-section', route: '/raise/investor-narrative/story', label: 'Draft this section', kind: 'write', handler: 'draft',
    at: [['frontend/src/pages/raise/narrative/StoryTab.jsx', 'narrativeApi.draftSection(']],
  },
  // D913 (#2697, NAR10): Story's Objections panel — "Answer it" drafts the open section to answer one objection.
  {
    page: 'Founder · Raise · Investor narrative', key: 'draft:narrative-objection', route: '/raise/investor-narrative/story', label: 'Answer an objection', kind: 'write', handler: 'draft',
    at: [['frontend/src/pages/raise/narrative/StoryTab.jsx', 'narrativeApi.draftObjection(']],
  },
  // The pitch deck's two template fills. D898 group E (#2676): the template
  // builder retired; Ask Eadwyn to draft from project (#3930: was "Fill from project") is on the studio's Decks tab, and a
  // template is started from New deck.
  {
    page: 'Founder · Raise · Pitch deck', key: 'form:deck', route: '/raise/pitch', label: 'Ask Eadwyn to draft from project', kind: 'write', handler: 'form',
    at: [[STUDIO_ACTIONS, 'api.deckAutofill(']],
  },
  {
    page: 'Founder · Raise · Pitch deck', key: 'form:deck-template', route: '/raise/pitch/new', label: 'Use this template', kind: 'write', handler: 'form',
    at: [[NEW_DECK, 'api.deckApplyMethod('], [TEMPLATES, 'api.deckApplyMethod(']],
  },
  // D897 (#2677): New deck (PD5, PD6) and the studio's fast path (PD2), which D1604 (#3716) made
  // `OneClickBuild.jsx`: on the studio's home and on top of New deck. The gallery (pd29) uses a template.
  {
    page: 'Founder · Raise · Pitch deck', key: 'deck:outline', route: '/raise/pitch/new', label: 'Regenerate outline', kind: 'write', handler: 'draft',
    at: [[NEW_DECK, 'newDeckApi.outline(']],
  },
  {
    page: 'Founder · Raise · Pitch deck', key: 'deck:build', route: '/raise/pitch/new', label: 'Build deck', kind: 'write', handler: 'draft',
    at: [[NEW_DECK, 'newDeckApi.build('], [ONE_CLICK, 'newDeckApi.build(']],
  },
  // D899 (#2678): Eadwyn's card tools in the editor (PD7, PD9d). Ask and the connector card's headline are rewrites.
  // D1604 (#3716): run from "Generate into N areas" (AreaLightbox) and the instruction box, which retire CardAssistBar.
  {
    page: 'Founder · Raise · Pitch deck', key: 'deck:rewrite', route: '/raise/pitch/edit', label: 'Rewrite', kind: 'write', handler: 'draft',
    at: [[AREA_LIGHTBOX, 'deckAssistApi.run('], [INSTRUCTION_BOX, 'deckAssistApi.run('], [CONNECTOR_CARD, 'deckAssistApi.run(']],
  },
  {
    page: 'Founder · Raise · Pitch deck', key: 'deck:shorten', route: '/raise/pitch/edit', label: 'Shorten', kind: 'write', handler: 'draft',
    at: [[AREA_LIGHTBOX, 'deckAssistApi.run(']],
  },
  {
    page: 'Founder · Raise · Pitch deck', key: 'deck:expand', route: '/raise/pitch/edit', label: 'Expand', kind: 'write', handler: 'draft',
    at: [[AREA_LIGHTBOX, 'deckAssistApi.run(']],
  },
  // D1604 (#3716, plan §0): Change tone and Translate are typed in the instruction box ("warmer", "in French"),
  // which runs words that are only a tone or a language under these two options (`instructionModel.typedChange`).
  {
    page: 'Founder · Raise · Pitch deck', key: 'deck:tone', route: '/raise/pitch/edit', label: 'Change tone', kind: 'write', handler: 'draft',
    at: [[INSTRUCTION_BOX, 'deckAssistApi.run(']],
  },
  {
    page: 'Founder · Raise · Pitch deck', key: 'deck:translate', route: '/raise/pitch/edit', label: 'Translate', kind: 'write', handler: 'draft',
    at: [[INSTRUCTION_BOX, 'deckAssistApi.run(']],
  },
  {
    page: 'Founder · Raise · Pitch deck', key: 'deck:chart', route: '/raise/pitch/edit', label: 'Chart from your records', kind: 'write', handler: 'draft',
    at: [[AREA_LIGHTBOX, 'deckAssistApi.run('], [ADD_MENU, 'deckAssistApi.run(']],
  },
  {
    page: 'Founder · Raise · Pitch deck', key: 'deck:table', route: '/raise/pitch/edit', label: 'Table from your records', kind: 'write', handler: 'draft',
    at: [[AREA_LIGHTBOX, 'deckAssistApi.run('], [ADD_MENU, 'deckAssistApi.run(']],
  },
  {
    page: 'Founder · Raise · Pitch deck', key: 'deck:timeline', route: '/raise/pitch/edit', label: 'Timeline from your records', kind: 'write', handler: 'draft',
    at: [[AREA_LIGHTBOX, 'deckAssistApi.run('], [ADD_MENU, 'deckAssistApi.run(']],
  },
  // D903 (#2682): the image lightbox's Generate (PD12), through run() (the `deck_image` task).
  // D1478 (#3721): kind `image`, so its list is the draw models and the run reads the pick.
  {
    page: 'Founder · Raise · Pitch deck', key: 'deck:image', route: '/raise/pitch/edit', label: 'Generate', kind: 'image', task: 'deck_image', handler: 'draft',
    at: [[AREA_LIGHTBOX, 'deckImagesApi.generate('], [IMAGE_LIGHTBOX, 'deckImagesApi.generate('], [ONE_CLICK, 'deckImagesApi.generate(']],
  },
  // D1580 F1 (#3827): Present › Rehearse transcribes the rehearsal; the member's pick here is the run's model.
  {
    page: 'Founder · Raise · Pitch deck', key: 'transcribe:rehearsal', route: '/raise/pitch/present', label: 'Rehearse', kind: 'speech', handler: 'transcribe',
    at: [[REHEARSE, 'deckRehearsalsApi.run(']],
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
    page: 'Founder · Raise · Pitch deck', key: 'review:deck-version', route: '/raise/pitch/review', label: 'Review this version', kind: 'reason', handler: 'draft',
    at: [[PITCH_REVIEW, 'api.deckReviewVersion(']],
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
    // D1478 (#3721): kind `image`; the `brand_logo` task reads the pick.
    page: 'Founder · Grow · Distribution', key: 'draft:logo', route: '/build/brand', label: 'Regenerate logo', kind: 'image', task: 'brand_logo', handler: 'draft',
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
  'Founder · Build · Solution design': 'Its records and forms only.',
  'Founder · Build · Prototype / MVP': 'Its records and forms only.',
  'Founder · Build · Founding team': 'Its tool is the cap table, which runs no model.',
  'Founder · Build · Company creation': 'Its legal and e-signature doors run no model; the legal generator refuses founders.',
  'Founder · Raise': 'Call for Capital matches by rule.',
  'Founder · Raise · Data room': 'The Data room tool runs no model; the room is read on Fundraising readiness.',
  'Founder · Raise · Capital relationships': 'The pipeline, the investor match and Match to my Mercury run no model.',
  'Founder · Grow · Revenue and traction': 'The metric log runs no model.',
  'Founder · Grow · Partner network': 'Its records only.',
  'Founder · Grow · Market expansion': 'Its records only; no translation runs.',
  'Founder · Grow · Durable company-building': 'Its Share an update is the section’s; the checklist and the compliance calendar run no model.',
  'Founder · Network · Organizations': 'The founder’s zone runs no model; the organizations band is a partner’s.',
  'Founder · Research · Markets': 'Recording a reading and its Draft run no model.',
  'Founder · Research · Geographies': 'Read only.',
};

// D1420 (#3864): Ask-panel chips that run a model on POST /api/ai/rail/run but
// are not rail actions (the AIRail holds only model choice and consumption,
// the owner, 2026-10-31), so they stay out of the rail-option list and its
// wiring tests. `scripts/build-rail-matrix.mjs` lists each one with its kind's
// models, so `GET /api/ai/rail?page=` offers it with its own pick. S1 draws
// the chip in the Ask panel (#3706).
export const FOUNDER_ASK_CHIPS = [
  // D1420 (#3864): Eadwyn proposes layout changes as cards in the Ask panel; nothing changes until Accept.
  { page: 'Founder · Studio', route: '/studio', key: 'studio:layout', label: 'Arrange my Studio for this stage', kind: 'plan', handler: 'form' },
];
