/**
 * The Intelligence page's words (D678, #1552), from the owner's canvas
 * `design/canvases/integrated/Eadwyn Intelligence Page.dc.html`, and the
 * ledger of what was kept.
 *
 * Every sentence on that canvas is a claim about the product, and a claim
 * ships only if the code makes it true (brief, rule 3). `INTEL_CLAIMS` lists
 * each one the canvas makes, whether it shipped, and why: a kept claim names
 * the code that makes it true, a dropped one says what the code does instead.
 * `methodology_intelligence_d678.test.mjs` reads this ledger: a kept claim must
 * render and its evidence must still be in the file it names; a dropped one
 * must not appear on the page.
 *
 * The model table is not here. It is read from `GET /api/public/ai-models`,
 * the router's own table, and this file names no model.
 */

/** The three research cards, with only the sentences that are true. */
export const RESEARCH_CARDS = [
  { t: 'Markets', q: 'How big is it, and is it moving?', d: 'A stale figure shows its age instead of passing as current.' },
  { t: 'Companies', q: 'Who else is building this?', d: 'Competitor profiles, direct or adjacent, with the public sources behind them.' },
  { t: 'Funds', q: 'Who writes this cheque?', d: 'Funds by thesis, stage, and cheque range, with the path in: warm, cold, or not yet assessed.' },
];

/**
 * Each claim the canvas makes. `evidence` is `[file, text the file holds]`;
 * `instead` is what the code does, for a claim that is not true of it.
 */
export const INTEL_CLAIMS = [
  // Hero
  { id: 'assistant', kept: true, text: 'Eadwyn is the Personal Assistant inside Axal VC.',
    evidence: ['cloudflare-worker/src/services/advisor/guardrails.ts', 'You are Eadwyn, the Axal StudioOS assistant.'] },
  { id: 'beta', kept: false, text: 'Beta 1.0',
    instead: 'No release of Eadwyn is named or versioned in the code, and nothing can withdraw a beta.' },
  { id: 'intro', kept: false,
    text: 'Eadwyn keeps every profile’s backlog in order, lets you choose the model behind each feature, and reads a research base of markets, companies, and funds.',
    instead: 'Two of its three parts are false; see "backlog" and "model-pick".' },

  // 01 · Backlog
  { id: 'backlog', kept: false, text: 'The next task, across every feature you use.',
    instead: 'Studio’s Eadwyn panel has Proposed, Pending and Completed buckets (AdvisorProgressWidget), but they hold Eadwyn’s interview questions from `GET /api/advisor/queue`, ranked by the state machine (focus page, Lab week, milestones, recent activity), not open work from every feature ranked oldest and most blocking first.' },
  { id: 'backlog-order', kept: false, text: 'The oldest and most blocking item rises first.',
    instead: 'The queue is ranked by `pickNext` in services/advisor/stateMachine.ts, not by age or blocking.' },

  // 02 · Models
  { id: 'model-pick', kept: false, text: 'Pick the model behind each feature page.',
    instead: 'The rail lets a member pick a model only for Validate’s two fill bands (`pick: true` in ui/railModels.js); every other page shows the router’s model with no choice.' },
  { id: 'rail-everywhere', kept: false, text: 'Every feature page has a side rail.',
    instead: 'The Worker AI rail is mounted by the workspace pages, not by every feature page.' },
  { id: 'rail-switch', kept: false, text: 'lets you switch to another for that page',
    instead: 'See "model-pick".' },
  { id: 'no-silent-swap', kept: false, text: 'Nothing swaps silently.',
    instead: 'The router falls back to a smaller sibling on a failure or a slow answer (`fallbackChain` in services/aiRouter.ts). Each run records it (`fallback_used`), but D678 could not show that every surface tells the member, so the claim is not proven.' },
  { id: 'safety-screen', kept: false, text: 'A safety screen (Llama Guard) runs before any answer is shown.',
    instead: 'Llama Guard screens the member’s message on the Eadwyn chat (`classifyInput` in routes/advisor.ts, ai.ts, eadwyn.ts). The feature pages’ AI runs (Validate’s fills, Research Ask, interview structuring) are not screened, and the screen reads the question, not the answer.' },
  { id: 'model-table', kept: true, text: 'Default model',
    evidence: ['cloudflare-worker/src/routes/public.ts', "publicRoutes.get('/ai-models'"] },

  // 03 · Language
  { id: 'language', kept: false, text: 'It answers in the way you speak.',
    instead: 'Nothing in Eadwyn’s prompts or routes adapts its wording to the member’s language, terms or level of detail.' },
  { id: 'read-aloud', kept: false, text: 'replies can be read back aloud',
    instead: 'The router has no text-to-speech model and the app no speech output. Voice notes are transcribed (`POST /api/advisor/transcribe`), but the sentence pairs that with read-back, so it goes.' },

  // 04 · Persona
  { id: 'persona', kept: false, text: 'It learns who you are from the work, not a form.',
    instead: 'The archetype card (`/studio/archetype`, D602, D619) reads Eadwyn’s conversational archetype and skills, but the section’s other claims (values from answers feeding values alignment, activity raising or lowering confidence, every part saying what would make it surer, a persona the member can correct) were not matched to code. An unproven claim does not ship.' },

  // 05 · Research
  { id: 'research-base', kept: true, text: 'Intelligence includes Research: a large database of markets, companies, and funds.',
    evidence: ['frontend/src/App.jsx', 'path="/research/funds"'] },
  { id: 'research-uses', kept: false, text: 'Use it to size a market, compare yourself with competitors, and find where to raise.',
    instead: 'Market sizing (TAM, SAM, SOM) lives on the project, not in Research.' },
  { id: 'research-dates', kept: false, text: 'Every figure carries its source and date.',
    instead: 'A fund directory row cites its list and publisher but no date (`citationOf` in pages/research/fundDirectoryRead.js).' },
  { id: 'research-rows', kept: false, text: 'Eadwyn cites the rows it read.',
    instead: 'Research Ask cites the member’s own documents; no code has Eadwyn cite research rows.' },
  { id: 'research-stale', kept: true, text: 'A stale figure shows its age instead of passing as current.',
    evidence: ['frontend/src/pages/research/MarketZone.jsx', 'AGE IS A GATE, NOT A LABEL'] },
  { id: 'research-companies', kept: true, text: 'Competitor profiles, direct or adjacent, with the public sources behind them.',
    evidence: ['frontend/src/pages/research/CompanyAnalysis.jsx', '<option value="adjacent">Adjacent</option>'] },
  { id: 'research-pricing', kept: false, text: 'Compare positioning and pricing side by side.',
    instead: 'A competitor analysis has no pricing field.' },
  { id: 'research-funds', kept: true, text: 'Funds by thesis, stage, and cheque range, with the path in: warm, cold, or not yet assessed.',
    evidence: ['frontend/src/pages/research/FundsZone.jsx', 'const lo = usd(row.cheque_min_cents);'] },
  { id: 'research-ask', kept: true, text: 'Answers without a retrievable source are shown as unanswered, not guessed.',
    evidence: ['cloudflare-worker/src/routes/research.ts', "reason: 'no_source'"] },

  // 06 · Architecture
  { id: 'federated', kept: false, text: 'An open, federated model, grown by everyone who contributes.',
    instead: 'Every model runs on Cloudflare Workers AI (`provider` in the router’s table); nothing trains locally or merges updates.' },

  // Closing
  { id: 'never-acts', kept: true, text: 'Eadwyn never acts for you.',
    evidence: ['cloudflare-worker/src/services/advisor/tools.ts', 'Find & deep-link tool registry.'] },
  { id: 'drafts', kept: true, text: 'It drafts, explains and summarises.',
    evidence: ['cloudflare-worker/src/routes/ai.ts', 'nothing you write is sent, saved or shared by you.'] },
  { id: 'human-click', kept: true, text: 'Sending, signing and voiding are always a human click.',
    evidence: ['cloudflare-worker/src/services/advisor/guardrails.ts', 'I can deep-link you there, but I won\'t execute them.'] },
  { id: 'beta-withdrawn', kept: false, text: 'the beta can be withdrawn',
    instead: 'See "beta".' },
];
