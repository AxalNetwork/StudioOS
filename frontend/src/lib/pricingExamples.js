/**
 * D5958 (#5958, canvas D5957 boards PR-E1 to PR-E8): "What a paid plan produces" on /pricing's Founder tab.
 *
 * Static copy written by Axal VC. Every figure, name, quote and date is bracketed sample data, and every example is
 * labelled "Demonstration": nothing on main records which customer evidence Axal VC may show, so the canvas's "Real
 * evidence, shared with permission" variant is not built (D5957 question 4, option A). Each example keeps its source
 * facts, Eadwyn's generated interpretation and its limitations under their own headings.
 *
 * No price, plan, limit or entitlement is stated here: the plan is named only so "See <plan>" can scroll to its card.
 * The Investor research example is held until Research v2 (#3701) and is not listed; nothing stands in its place.
 */

/** The label every built example carries, in words. */
export const DEMONSTRATION = 'Demonstration';
export const EXAMPLES_NOTE = 'Examples written by Axal VC with sample data. Not your data.';
export const EXAMPLES_KICK = 'Outcome examples';
export const EXAMPLES_TITLE = 'What a paid plan produces';

/** The tabs that show the section. Investors, Advisors, Operating Partners and Models do not (PR-E3, PR-E4). */
export const EXAMPLE_TABS = Object.freeze(['founder']);

const VENTURE = '[Sample venture “Harbourline”]';

/**
 * A line is `{ label?, text?, quote?, who? }`: a bold label, its text, or a quoted note and who said it.
 * `plan` is the founder plan card id the example belongs to; `planName` names it.
 */
export const OUTCOME_EXAMPLES = Object.freeze([
  Object.freeze({
    id: 'evidence-planning',
    plan: 'growth',
    planName: 'Validate + Build',
    label: DEMONSTRATION,
    title: 'Evidence synthesis and company planning',
    summary: 'Customer interview notes become pain themes, a hypothesis verdict and the next OKRs.',
    facts: Object.freeze([
      { label: 'Interviews logged in Validate', text: `[n] of [m] planned, for ${VENTURE}` },
      { quote: '[We re-key every shipping manifest by hand.]', who: '[Interviewee A], [operations lead]' },
      { quote: '[A late customs document holds a container for a day.]', who: '[Interviewee B], [customs broker]' },
      { label: 'Hypothesis recorded', text: '[Freight forwarders will pay to stop re-keying manifests.]' },
    ]),
    generated: Object.freeze([
      { label: 'Pain themes', text: '[Manual re-keying], [n] interviews · [Document delays], [n] interviews' },
      { label: 'Hypothesis verdict', text: '[Supported], citing [n] of [m] interviews' },
      { label: 'Next OKRs', text: '[Run paid pilots with [n] forwarders by [date]] · KR [[n] letters of intent]' },
    ]),
    limitations: 'Sample data. What Eadwyn drafts depends on what you record. In StudioOS you accept, edit or discard each draft before it is used.',
  }),
  Object.freeze({
    id: 'fundraising-workflow',
    plan: 'studio',
    planName: 'Raise + Grow',
    label: DEMONSTRATION,
    title: 'A connected fundraising workflow',
    summary: 'A finding from the interviews becomes a slide, the deck goes out with the data room, and the founder follows up an introduction.',
    facts: Object.freeze([
      { label: 'Finding from Validate', text: '[Document delays], [n] of [m] interviews' },
      { label: 'Pitch deck', text: '[Harbourline seed deck], [Problem] slide edited by the founder' },
      { label: 'Share link', text: '[1] link to the deck and the data room for [Investor A], expires [date]' },
      { label: 'Introduction', text: '[Investor A] accepted on [date]' },
    ]),
    generated: Object.freeze([
      { label: 'Problem slide draft', text: '“[Forwarders lose a day to each late customs document.]” cited to [n] interviews' },
      { label: 'Follow-up draft', text: 'a note to [Investor A] naming the deck and the data room. Not sent.' },
    ]),
    limitations: 'Sample data. You accept, edit or discard each draft, and nothing is shared or sent until you do it yourself.',
  }),
]);

/** How it connects (PR-E1): customer evidence, the narrative, controlled sharing and follow-up, in order. */
export const HOW_IT_CONNECTS = Object.freeze([
  Object.freeze({ step: 'Customer evidence', where: 'Validate › Customer interviews' }),
  Object.freeze({ step: 'Fundraising narrative', where: 'Raise › Pitch deck' }),
  Object.freeze({ step: 'Controlled sharing', where: 'Raise › Share links and the data room' }),
  Object.freeze({ step: 'Follow-up', where: 'Network › Introductions' }),
]);

/** After the raise (PR-E1): what keeps giving value, named as the Raise + Grow card already lists it. */
export const AFTER_THE_RAISE = Object.freeze({
  title: 'After the raise',
  plan: 'studio',
  line: 'Included in Raise + Grow.',
  items: Object.freeze(['Revenue and traction', 'Distribution and co-marketing', 'Team expansion', 'Partner network']),
});

const RANK = Object.freeze({ free: 0, growth: 1, studio: 2 });

/**
 * PR-E5: a signed-in founder's line beside an example. `held` is `heldCard(...)` on the Founder tab: a founder plan id,
 * or null for a visitor or an unknown plan, which marks nothing.
 */
export function inPlanLine(example, held) {
  if (!held || !Object.prototype.hasOwnProperty.call(RANK, held) || !Object.prototype.hasOwnProperty.call(RANK, example?.plan)) return null;
  return RANK[held] >= RANK[example.plan] ? { yes: true, text: 'In your plan' } : { yes: false, text: 'Not in your plan' };
}

/** The examples a tab shows: the Founder tab's, else none (and nothing in their place). */
export const examplesFor = (tab) => (EXAMPLE_TABS.includes(tab) ? OUTCOME_EXAMPLES : []);
