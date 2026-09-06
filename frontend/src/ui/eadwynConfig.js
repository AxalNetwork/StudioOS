import { priceForTask } from '../hooks/useAiSpend';

/**
 * Per-surface configuration for the AI rail, built from the router's own
 * routing table and the caller's own usage — not from hand-written figures.
 *
 * WHICH SURFACES. The rail belongs where a user DELIBERATELY RUNS AI WORK
 * AGAINST THEIR OWN BUDGET. "Reaches aiRouter" is necessary but not
 * sufficient: `OnboardingChatPage` reaches it (task `role_detect` via
 * /api/profiling) and is deliberately excluded. That page is a signup-funnel
 * step for a user whose role is still `pending`; the call there is the
 * platform profiling THEM, not them spending anything, and a first-touch
 * screen is the worst possible place to put a dollar meter. See DECISIONS D15.
 *
 * WHAT A RUN COSTS. The canvases each carried invented token counts —
 * `tin: 1800, tout: 600` and similar — with no source. There is no honest one:
 * nothing knows how many tokens a deck review takes before it takes them.
 *
 * So the estimate is not modelled at all. It is the caller's OWN observed
 * average for that task class, from `ai_usage_logs` via /api/ai/me/spend. That
 * is a real number about real runs, it improves as they use the surface, and
 * when they have no history it is honestly absent rather than guessed. A rail
 * that says "no runs yet" is worth more than one that quotes a number nobody
 * measured.
 */

/**
 * The surfaces, and the aiRouter task class each one's work routes to.
 *
 * `task` is the join key to the router: it decides the model, the price and
 * the usage rows this surface's numbers are drawn from. Getting it wrong
 * misreports every figure on the rail, so each is traced to a call site.
 */
export const ASSIST_SURFACES = {
  // routes/advisor.ts → aiRouterRun({ task: 'advisor_explain' })
  advisory: {
    task: 'advisor_explain',
    label: 'Advisory',
    unit: 'per explanation',
    modeNote: 'Eadwyn explains scores and next steps on request.',
    footer: { kind: 'screened', note: 'Every answer passes a safety screen first.' },
  },
  // services/deckExtract.ts → aiRun({ task: 'dd_synthesis' })
  deck_review: {
    task: 'dd_synthesis',
    label: 'Deck reviewer',
    unit: 'per deck',
    modeNote: 'Eadwyn reads the deck and writes the critique.',
    footer: { kind: 'screened', note: 'Feedback is generated, not a human review.' },
  },
  // NO ENTRY FOR RESEARCH · ASK, and the omission is deliberate.
  //
  // `POST /api/research/ask` runs `task: 'research_ask'`, so its spend IS
  // attributed separately — `/api/ai/me/spend` groups by task class, on the
  // worker side, with no help from this file. What a surface here additionally
  // buys is a model card on an `AssistLayout` rail, and Ask has no such rail:
  // it is a zone inside a workspace that already renders `WorkerRail`. Adding
  // one would draw two rails on one page, which is the doubled-chrome failure
  // this repo has fixed on Network, on Partner, and on the Research zones
  // themselves.
  //
  // A first draft did add an entry here, and `ui_assist_rail_and_sidebar`
  // caught it as dead config — correctly. The rule that test states is the
  // right one: config follows a mount, never the other way round.

  // routes/brand.ts → aiRouterRun({ task: 'brand_autofill' | 'brand_palette' | …)
  brand: {
    task: 'brand_autofill',
    label: 'Brand builder',
    unit: 'per section',
    modeNote: 'Eadwyn drafts copy you then edit.',
    footer: { kind: 'neutral', chip: 'Draft', note: 'Nothing publishes without your click.' },
  },
  // routes/ai.ts → POST /api/ai/workspace/explain → aiRun({ task: 'workspace_explain' })
  //
  // The one surface every workspace zone shares, on all four licences. It was
  // absent for a long time and the absence was correct: the rail must not name
  // a model for a page that never calls one, and until that route existed no
  // workspace did. The route came first and this entry followed — which is the
  // order the guards in workspace_frame_contract.test.mjs now enforce, having
  // previously enforced that the card could not exist at all.
  //
  // ONE surface rather than one per bucket, because the task is the same on
  // every zone — read back the lines the page is already showing — and
  // `/api/ai/me/spend` groups by task. Twenty surfaces over one task class
  // would report the same average twenty times and call it per-page data.
  workspace: {
    task: 'workspace_explain',
    label: 'Read back',
    unit: 'per page',
    modeNote: 'Eadwyn reads back what this page is showing. It is given the summary lines beside it and nothing else.',
    footer: { kind: 'screened', note: 'Drafted from this page only, and kept nowhere.' },
    // THE FIRST SURFACE TO DECLARE A REAL CHOICE, and DECISIONS D17 is the
    // reason it took this long. D17 refused a mode toggle "until a page
    // branches on the mode", because "turning the switch off would change
    // nothing any of the six surfaces does, so shipping it puts a control on
    // screen that cannot affect the product". Founder Validate now branches:
    // off, no proposal is ever written and nothing is spent; on, Eadwyn tags
    // logged phrases into themes the founder named and drafts hypothesis
    // cards, each as a proposal to accept or throw away.
    //
    // `manualNote` is what OFF means, in the founder's terms rather than as
    // the absence of something. The AssistRail machinery has rendered it
    // behind `kind: 'choice'` since it was written and no surface has ever
    // emitted one.
    mode: {
      kind: 'choice',
      label: 'AI fills the blanks',
      // Two things, not the canvas's three. "Transcribes uploads" has nowhere
      // to write a transcript — `discovery_interviews` has no such column and
      // no R2 path admits audio — so naming it here would be a promise the
      // worker cannot keep. It joins this sentence in the migration that gives
      // it a column.
      note: 'Tags logged phrases into your themes and drafts hypothesis cards. Every one is a proposal you accept, edit or discard.',
      manualNote: 'Nothing runs and nothing is spent. You log interviews and group pains yourself.',
    },
  },
  // services/competitorAnalysis.ts → aiRun(…)
  market: {
    task: 'explain',
    label: 'Market',
    unit: 'per comparison',
    modeNote: 'Eadwyn summarises what the sources say.',
    footer: { kind: 'neutral', chip: 'Sourced', note: 'Summaries cite the rows they came from.' },
  },
};

/** The product-wide guardrail. ForgeRail's alone in the canvases; true of all. */
export const EADWYN_GUARDRAIL = {
  title: 'Eadwyn never acts for you',
  body: 'It drafts, explains and summarises. Sending, signing and voiding are always a human click.',
};

/**
 * Observed average cost of one run of `task`, from the caller's own history.
 * Returns null when they have no recorded runs of it — an unmeasured cost is
 * unknown, and the rail must say so rather than show a zero.
 */
export function observedRunCost(spend, task) {
  if (!spend?.recorded) return null;
  const row = (spend.by_task || []).find((t) => t.task === task);
  if (!row || !row.calls) return null;
  return { cost: row.spend_usd / row.calls, calls: row.calls };
}

/**
 * Build the config `AssistRail` renders.
 *
 * Returns null when the surface is unknown, so a typo'd key renders nothing
 * rather than a rail full of defaults describing the wrong task.
 */
export function eadwynConfig({ surface, spend, pricing }) {
  const s = ASSIST_SURFACES[surface];
  if (!s) return null;

  const priced = priceForTask(pricing, s.task);
  const observed = observedRunCost(spend, s.task);

  return {
    product: 'Eadwyn',
    accent: 'violet',
    // 'fixed' unless the surface says otherwise. Four of the five surfaces
    // ARE their AI feature — turning "Deck reviewer assist" off on the deck
    // reviewer would be a control over the page's only reason to exist — so
    // 'fixed' stays the default and a 'choice' has to be declared, with a page
    // that branches on it.
    mode: s.mode?.kind === 'choice'
      ? { kind: 'choice', label: s.mode.label, manualNote: s.mode.manualNote }
      : { kind: 'fixed', label: `${s.label} assist` },
    guardrail: EADWYN_GUARDRAIL,
    defaultPage: surface,
    planCap: spend?.month?.cap_usd ?? 0,
    totalSpend: spend?.month?.spend_usd ?? 0,
    pages: {
      [surface]: {
        modeNote: s.mode?.kind === 'choice' ? s.mode.note : s.modeNote,
        // What OFF means. AssistRail renders it under the card when the toggle
        // is off, and it has had nothing to render since it was written.
        manualNote: s.mode?.manualNote,
        // The model the router routes this task to — named, not chosen.
        model: priced ? { id: priced.model, name: priced.model.split('/').pop() } : null,
        run: {
          unit: s.unit,
          label: s.label,
          // Zero token counts on purpose: runCost() then returns 0 and the
          // caller uses `observed` instead. The rail never quotes a modelled
          // figure, because nothing here has modelled one.
          tin: 0, tout: 0, pin: priced?.pin ?? 0, pout: priced?.pout ?? 0,
        },
        observed,
        assistLabel: observed
          ? `Typical run · your last ${observed.calls}`
          : 'Typical run · no history yet',
        footer: s.footer,
      },
    },
  };
}
