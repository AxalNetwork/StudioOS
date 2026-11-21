/**
 * D6966 (#6966) — Spin-Out Lab's presentation content: the five sections of the page
 * (PGS01) and the slides of the PDF (PGS04), from the landed canvas's wording, which the
 * owner approves in review (2026-11-19). One story, two formats: slide 2 is section 1,
 * slide 3 is section 2, slide 4 is section 3, slide 5 is sections 4 and 5.
 *
 * What is NOT here, on the owner's answers of 2026-11-19: the line "Axal VC takes no equity
 * for a place on the programme" (G1 unanswered), a general "Ask a question" action (#6987 is
 * not shipped) and Demo Day (J1). #6990's corrections stand: no funded-company headline, no
 * time-to-incorporation figure, and introductions "Not promised". Cohort names, dates and
 * places are not written here: the page reads them from `GET /api/spinout-lab/brief`, and the
 * PDF does not carry them at all.
 *
 * The week names and day ranges are the Lab's own (`LAB_WEEKS`, owner decision F1), read
 * rather than copied, so the presentation cannot name a week the Lab does not run.
 */
import { LAB_WEEKS } from '../../../lib/spinoutLab.js';

/** The four weeks' two pieces of work each (the public Lab page's activities). */
const WORK = [
  ['Talk to potential customers and record what they say.', 'Write down who your ideal customer is and the problem you solve for them.'],
  ['Decide what the first version must do, and set goals for it.', 'Build your brand and a landing page that collects interest.'],
  ['Build your pitch deck from what customers told you.', 'Estimate your market size and show where each number comes from.'],
  ['Record who owns what in the company and plan how you would use the money.', 'Prepare the documents investors ask for and practise the conversation.'],
];

export const WEEKS = LAB_WEEKS.map((w, i) => ({ k: `${w.n} · ${w.days}`, t: w.name, items: WORK[i] }));

const SPAN = {
  label: 'Registering the company',
  note: 'Which week depends on your starting point. When a company is registered depends on eligibility and the jurisdiction.',
};

/** The journey's text alternative: the accessible name of the list on the page and slide 3's alt text. */
export const JOURNEY_ALT = `The four weeks: ${WEEKS.map((w, i) => `Week ${i + 1} ${w.t}`).join(', ')}. Registering the company falls in a week that depends on the starting point.`;

const STARTING_POINTS = [
  ['No company yet', 'You have an idea, a prototype or research, and no company registered.'],
  ['Company formed, still finding customers', 'Your company is registered, and you are still finding out who will pay for it.'],
  ['Company running, testing a new product', 'Your company already trades, and you want to test a second product.'],
];

const APPLYING = [
  'Create your free account',
  'Confirm your email',
  'Complete your application',
  'Axal VC reviews your membership and sends an agreement',
  'Sign the agreement; your workspace opens',
];

const SUPPORT = [
  ['Office Hours', 'Book sessions with investors, advisors and partners whom Axal VC has approved as hosts.'],
  ['Co-founder Match', 'Looking for a co-founder? Find one among other founders, inside StudioOS.'],
  ['Advisors', 'Matched against your founder profile.'],
  ['Introductions', 'Not promised.'],
];

const HOW_RUN = [
  ['Cohorts', 'One a month, starting on the 1st.'],
  ['Applications close', 'Seven days before a cohort starts, at 23:59 ET.'],
  ['Programme length', '28 days · four weeks.'],
  ['Who decides', 'The studio team reviews each application.'],
];

const NOT_PROMISED = 'The programme lasts four weeks. Incorporation, revenue and funding are not guaranteed. When a company is registered depends on eligibility and the jurisdiction.';

export const APPLY_HREF = '/spinout-lab/apply';
export const SIGN_IN_HREF = `/login?next=${encodeURIComponent(APPLY_HREF)}`;
export const LICENCE_HREF = '/contact?topic=licence';

export default {
  sections: [
    {
      title: 'Founders at one of three starting points.',
      lead: 'The four weeks are the same for everyone. Your starting point changes which tools you use first.',
      blocks: [
        { type: 'cards', numbered: true, items: STARTING_POINTS },
        { type: 'aside', label: 'Studio operators', text: 'Asking how a cohort is run? See', link: { href: '#how', label: 'How participation works' } },
      ],
    },
    {
      title: 'Four weeks, one focus each.',
      lead: 'An outline of the work, not a promised result. Each week has two pieces of work you do inside StudioOS.',
      band: true,
      blocks: [
        {
          type: 'timeline', label: JOURNEY_ALT, steps: WEEKS, span: SPAN,
          along: 'Alongside the four weeks: Office Hours with hosts Axal VC has approved, and Co-founder Match for founders looking for a co-founder.',
        },
      ],
    },
    {
      title: 'Apply, get reviewed, then work alongside other founders.',
      blocks: [
        { type: 'cols', items: [
          { title: 'Applying', block: { type: 'stages', items: APPLYING } },
          { title: 'During the four weeks', block: { type: 'list', items: SUPPORT } },
        ] },
        { type: 'card', title: 'How a cohort is run', text: 'For studio operators.', block: { type: 'terms', items: HOW_RUN } },
      ],
    },
    {
      title: 'What you need to take part.',
      band: true,
      blocks: [
        { type: 'terms', items: [
          ['Admission', 'By application. A cohort’s dates and places come from the cohort record and are shown above, never printed in the PDF.'],
          ['Your account', 'A free Axal VC account. Your membership is reviewed and you sign an agreement before your workspace opens.'],
          ['The tools', 'Inside StudioOS, for members only. Nothing opens from this page.'],
          ['Studios', 'A studio’s Administrator acts for the studio, on its licence. A studio licence is its own enquiry, apart from a founder’s application.'],
        ] },
        { type: 'limits', title: 'What the programme does not promise', text: NOT_PROMISED },
      ],
    },
  ],
  next: {
    title: 'Choose your next step.',
    band: 'Three ways forward, kept apart.',
    actions: [
      { id: 'apply', who: 'Founders', label: 'Apply to the next cohort →', kind: 'primary', to: APPLY_HREF, note: 'You create a free account first, then complete the application.' },
      { id: 'signin', who: 'Already a member', label: 'Sign in to apply →', kind: 'link', to: SIGN_IN_HREF, note: 'Your application continues where you left it.' },
      { id: 'licence', who: 'Studio Administrators', label: 'Enquire about a studio licence', kind: 'quiet', to: LICENCE_HREF, note: 'For a studio that wants to run cohorts on its licence. Not an application.' },
    ],
  },
  cover: { art: 'lab-band.webp', alt: 'Founders at work in a studio (Axal VC site artwork).' },
  slides: [
    {
      eyebrow: 'Who it helps', title: 'Founders at one of three starting points.',
      blocks: [{ type: 'cards', items: STARTING_POINTS }],
      alt: 'Three starting points: no company yet; company formed, still finding customers; company running, testing a new product.',
    },
    {
      eyebrow: 'What happens', title: 'Four weeks, one focus each.',
      blocks: [{ type: 'timeline', steps: WEEKS, span: SPAN, label: JOURNEY_ALT }],
      alt: JOURNEY_ALT,
    },
    {
      eyebrow: 'How participation works', title: 'Apply, get reviewed, then work alongside other founders.',
      blocks: [{ type: 'two', items: [
        { label: 'Applying', block: { type: 'stages', items: APPLYING } },
        { label: 'During the four weeks', block: { type: 'list', items: SUPPORT } },
      ] }],
      alt: 'Five application steps, from creating an account to signing the agreement; support during the four weeks: Office Hours, Co-founder Match, advisors; introductions not promised.',
    },
  ],
  closing: {
    title: 'Access and next step.',
    rows: [
      ['Admission', 'By application. Cohorts start on the 1st of each month.'],
      ['Account', 'A free Axal VC account; membership reviewed; an agreement signed.'],
      ['Not promised', 'Incorporation, revenue, funding and introductions.'],
      ['Dates, places', 'On the public page, from the live cohort record.'],
    ],
    next: [
      ['Read and apply', 'axal.vc/spinout-lab/brief', 'The current cohort, its dates and places.'],
      ['Founders apply at', 'axal.vc/spinout-lab/apply', 'You create a free account first.'],
      ['Studio Administrators', 'axal.vc/contact?topic=licence', 'A studio licence is a separate enquiry.'],
    ],
    alt: 'Conditions to take part, and three next steps with their addresses; public page URL and edition date.',
  },
};
