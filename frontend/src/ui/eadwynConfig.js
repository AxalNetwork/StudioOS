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
    // 'Score explainer', not 'Advisory' (D400). The mode card renders
    // `${label} assist`, so this read "Advisory assist" — the assistant
    // named as giving advice, which the voice rule forbids. The regulated-
    // wording scanner treats a one-word literal as an identifier and missed
    // it. The surface explains scores and next steps, and the label says so.
    // The ROUTE `/advisory` keeps its name: that page also holds the human
    // advisors, who are a real persona.
    label: 'Score explainer',
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
      // ONE CARD, FOUR DESKS (D424). This sentence used to be Validate's list —
      // transcription, pain tags, hypothesis cards — because Validate was the
      // only host that passed `fills`. Build, Raise and Grow pass it now, and
      // the card reads this one surface on every one of them, so a Validate
      // list here would promise transcription on the Raise desk. The card says
      // what is true everywhere; what the switch does on THIS desk is the
      // desk's own sentence in `desks` below, which the host passes as the
      // rail's `note` and the rail prints under the cards.
      note: 'Drafts proposals for the bands on this workspace, each only when you press its button. Every one is yours to accept, edit or discard.',
      manualNote: 'Nothing runs and nothing is spent. Every entry here is one you wrote.',
    },
    // WHAT THE SWITCH DOES ON EACH FOUNDER DESK (D424), keyed by the rail's
    // `workspace`, which is also the key `useAssistMode` stores the choice
    // under — so a desk's sentence and its switch cannot name two workspaces.
    //
    // `fills` is a list of promises, and `validate_fills_the_blanks` checks it
    // clause by clause: each clause must match a band that desk mounts, over a
    // route or draft surface that exists. The order is the order the bands sit
    // on the desk. Validate's order is the order a founder meets them: a
    // recording becomes text, the text's pains become themes, the themes
    // become claims (migration 215 gave the first one somewhere to write).
    //
    // `none` is a desk with no band at all, and it says why there is no
    // switch rather than drawing one that changes nothing (D17). Network's
    // draft surfaces are the partner firm's book, not a founder's contacts;
    // Research's one run is Ask, which is a question pressed on purpose, not
    // a blank filled.
    desks: {
      Validate: { fills: 'Transcribes recordings, tags logged phrases into your themes, and drafts hypothesis cards.' },
      Build: { fills: 'Drafts a Monday plan from what moved, argues one roadmap ordering, and annotates the metric that moved most.' },
      Raise: { fills: 'Reads your round back step by step, explains the clauses in stored documents, reads the data room, and explains the order of payment.' },
      Grow: { fills: 'Ranks applicants with reasons, and drafts an outreach sequence opened on your own recorded pains.' },
      Network: { none: 'No switch here. This desk summarises stored relationship records and drafts, sends and changes nothing: no draft surface reads the contacts a founder keeps yet.' },
      Research: { none: 'No switch here. A question runs only when you press Ask, and is answered from your own library; nothing on this desk fills a blank.' },
    },
  },
  // `market` lived here until D317: the Spin-Out Lab's market page was its
  // only mount, and the Lab carries no Eadwyn rail. The page's own switch now
  // drives its two fill bands through `useAssistMode('market')`.
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
    // NULL, NEVER ZERO (D400). These were `?? 0`, and a `recorded: false`
    // response — the usage table could not be read, `spend_usd: null` — came
    // out as a $0.00 meter: a failed read drawn as a fact. `null` is what
    // AssistRail reads as "unknown".
    planCap: typeof spend?.month?.cap_usd === 'number' ? spend.month.cap_usd : null,
    totalSpend: spend?.recorded && typeof spend?.month?.spend_usd === 'number' ? spend.month.spend_usd : null,
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
          // No token counts and no rates, on purpose: nothing here has
          // modelled a run, so there is nothing to multiply. runCost() of an
          // empty profile is 0, AssistRail treats a 0 model as "no modelled
          // figure", and the card falls back to `observed` or says it has
          // none. (This used to type `tin: 0` and `pin: priced?.pin ?? 0` —
          // the same absence, spelled as zeros. D400.)
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
