/**
 * D6967 (#6967) — AI-native Venture's presentation content: the five sections of the page
 * (PGA01) and the four slides of the PDF (PGA04), from the landed canvas's wording, which the
 * owner approves in review (2026-11-19). Slide 2 is section 2, slide 3 is section 3, and the
 * closing slide is sections 1, 4 and 5; the cover is the hero.
 *
 * Every fact is the registry's own text on main: status `proposed` and the seven unset playbook
 * sections (`560_program_registry.sql`), purpose, "Founders" and "By application"
 * (`593_referral_partners_copy.sql`), `not_open` with no modules (`…_4873.sql`), studio offers
 * refused while `notready` (`programGrants.ts`), the four member tools (`App.jsx`) and the twelve
 * AI-native pitch templates (`templateLibrary.ts`, `AI_NATIVE_LAST`).
 *
 * What is NOT here, on the owner's answers of 2026-11-19: "Ask Axal VC a question" and the
 * closing slide's "Ask a question" row (the General contact topic waits on #6987; canvas
 * PGA02B), any equity line (G1), and any application, date, place, fee, funding or result.
 * Nothing opens a studio enquiry: the programme cannot be offered to studios.
 */

const EADWYN = 'Eadwyn, the assistant inside StudioOS, drafts and checks. You make the calls.';
const TOOLS_NOTE = 'These tools exist in StudioOS today, for members. Which of them the programme would include is still to be confirmed.';
const TBC_WORD = '◌ To be confirmed';

/** The signature visual: a founder's question paired with the proposed role of a studio tool. */
export const PAIRS = [
  { q: 'Do customers really have this problem?', tool: 'Customer interviews', route: '/validate', role: 'Record each customer interview and keep what customers said.' },
  { q: 'What must the first version do?', tool: 'Build plan', route: '/build/plan', role: 'Write down what the first version must do, and follow it week by week.' },
  { q: 'How do I tell investors the story?', tool: 'Pitch studio', route: '/raise/pitch', role: 'Build your deck; twelve templates are written for AI-native companies.' },
  { q: 'What backs up my pitch?', tool: 'Evidence', route: '/raise/evidence', role: 'Keep the customer quotes behind each slide. You choose what to share.' },
];

/** The pairs' text alternative: the accessible name of the list on the page and slide 2's alt text. */
export const PAIR_ALT = 'Proposed concept: four founder questions, each paired with a StudioOS tool. Do customers really have this problem: customer interviews. What must the first version do: build plan. How do I tell investors the story: pitch studio. What backs up my pitch: evidence. Eadwyn drafts and checks; the founder makes the calls. Which tools the programme includes is to be confirmed.';

/** What Axal VC has recorded (the registry row). */
const DEFINED = [
  ['Name', 'AI-native Venture'],
  ['Purpose', 'Founders build an AI-native company with Eadwyn and the studio’s tools.'],
  ['Who it is for', 'Founders.'],
  ['Admission, as proposed', 'By application, once it opens.'],
  ['Status today', 'Proposed. Not open to members.'],
];

/** The seven playbook sections the registry holds unset, in its order, in public words. */
export const TO_CONFIRM = ['Thesis', 'Exactly who it is for', 'Length', 'Places per cohort', 'Tools included', 'Capital terms', 'Contracts'];

const NOT_INTRODUCED = 'An application, dates, delivery milestones, fees, funding or local operating rights. Each needs its own approval before it appears here.';

export const SPINOUT_HREF = '/spinout-lab';
export const ADMINISTRATORS_HREF = '/administrators';

export default {
  sections: [
    {
      title: 'Founders who want to build an AI-native company.',
      lead: 'The proposal is written for founders. Which founders, at what stage and with what team, is one of the points still to be confirmed.',
      blocks: [
        { type: 'terms', items: [
          ['For', 'Founders. This is what Axal VC has recorded.'],
          ['Exactly who', TBC_WORD],
        ] },
        { type: 'aside', label: 'Studio operators', text: 'The programme is not offered to studios yet. See', link: { href: '#access', label: 'Access required' } },
      ],
    },
    {
      title: 'Your question, and the tool that would help answer it.',
      lead: 'The concept, not a programme outline: each question a founder asks is paired with the studio tool the programme proposes for it.',
      band: true,
      blocks: [
        {
          type: 'timeline', label: PAIR_ALT,
          steps: PAIRS.map((p) => ({ k: `${p.tool} · ${p.route}`, t: p.q, items: [p.role] })),
          span: { label: 'Across all four', note: EADWYN },
          along: `◌ ${TOOLS_NOTE}`,
        },
      ],
    },
    {
      title: 'What Axal VC has defined, and what is still to be confirmed.',
      lead: 'How the programme would run is not decided yet. Nothing below is a date, a place or a term you can rely on until it is confirmed here.',
      blocks: [
        { type: 'cols', items: [
          { title: '● Defined by Axal VC', block: { type: 'terms', items: DEFINED } },
          { title: '◌ Still to be confirmed', block: { type: 'list', items: TO_CONFIRM.map((t) => [t, TBC_WORD]) } },
        ] },
        { type: 'limits', title: 'Not introduced until separately approved', text: NOT_INTRODUCED },
      ],
    },
    {
      title: 'What you need to take part.',
      band: true,
      blocks: [
        { type: 'terms', items: [
          ['Admission', 'Proposed to be by application. No application is open, so there is nothing to apply for yet.'],
          ['Reading this', 'No account needed. This page and the PDF are public.'],
          ['The tools', 'Inside StudioOS, for members only. Nothing opens from this page.'],
          ['Fees, funding, equity', '◌ Not set. Capital terms are one of the points still to be confirmed.'],
          ['Studios', 'Not offered to studios yet. When Axal VC publishes the programme, a studio’s Administrator can request it for the studio, on its licence.'],
        ] },
      ],
    },
  ],
  next: {
    title: 'Choose your next step.',
    band: 'Nothing to apply for yet. Here is what you can do.',
    actions: [
      { id: 'spinout', who: 'Founders ready to start now', label: 'See the Spin-Out Lab →', kind: 'link', to: SPINOUT_HREF, note: 'A four-week programme for founders, by application.' },
      { id: 'studios', who: 'Studio Administrators', label: 'How studio licences work →', kind: 'link', to: ADMINISTRATORS_HREF, note: 'This programme is not offered to studios yet.' },
    ],
  },
  // Nothing reads live: the panel states this edition's status, with no action (no violet primary).
  panel: {
    text: 'Proposed. Not open. No applications are taken. No dates, places or fees are set.',
    note: 'Founders: not open to members yet. Studios: not offered to studios yet.',
  },
  // ead-hero.webp is decorative on the cover (canvas PGA06): empty alt.
  cover: { art: 'ead-hero.webp', alt: '' },
  slides: [
    {
      eyebrow: 'The proposal', title: 'Your question, and the tool for it.',
      blocks: [{
        type: 'timeline', label: PAIR_ALT,
        steps: PAIRS.map((p) => ({ k: p.tool, t: p.q, items: [p.role] })),
        span: { label: 'Across all four', note: `${EADWYN} Which tools the programme would include is still to be confirmed.` },
      }],
      alt: PAIR_ALT,
    },
    {
      eyebrow: 'Where it stands', title: 'Defined, and still to be confirmed.',
      blocks: [{ type: 'two', items: [
        { label: '● Defined by Axal VC', block: { type: 'list', items: DEFINED } },
        // At slide scale the seven rows fit only as names: the column's label carries "to be confirmed".
        { label: '◌ Still to be confirmed', block: { type: 'list', items: TO_CONFIRM.map((t) => [t, '']) } },
      ] }],
      alt: 'Defined by Axal VC: name, purpose, for founders, admission by application once it opens, status proposed. Still to be confirmed: thesis, exactly who it is for, length, places per cohort, tools included, capital terms, contracts.',
    },
  ],
  closing: {
    title: 'Access and next step.',
    rows: [
      ['Status', 'Proposed. Not open; no applications are taken.'],
      ['For', 'Founders. Exactly who is to be confirmed.'],
      ['Admission', 'By application, once it opens.'],
      ['Not set', 'Dates, places, fees, funding and capital terms.'],
      ['Studios', 'Not offered to studios yet.'],
    ],
    next: [
      ['Read the proposal', 'axal.vc/programs/ai-native-venture', 'The public page for this programme.'],
      ['Open now for founders', 'axal.vc/spinout-lab', 'Spin-Out Lab, four weeks, by application.'],
    ],
    alt: 'Conditions today: proposed and not open, for founders, no dates, places, fees or funding, not offered to studios. Next steps with addresses; public URL and edition date.',
  },
};
