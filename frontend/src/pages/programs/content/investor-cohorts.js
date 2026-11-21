/**
 * D6969 (#6969) — Investor cohort access's presentation content: the five sections of the page
 * (PGI01, availability PGI02A) and the five slides of the PDF (PGI04), from the landed canvas's
 * wording, which the owner approves in review (2026-11-19). Slide 2 is section 1, slide 3 is
 * section 2, slide 4 is section 3, the closing slide is sections 4 and 5.
 *
 * Every fact is main's: every admin route is `requireAdmin`, giving access creates the grant and
 * sends nothing, Send NDA is separate (`routes/admin_investor_cohorts.ts`); each read checks
 * verified now, the grant open and in date, the NDA signed, and never serves a founder's email
 * (`routes/investor_cohorts.ts`); "verified" is an active account with approved KYC, one NDA per
 * grant, the scope is summary and weekly progress (`services/investorCohortAccess.ts`);
 * `investor-cohorts` is `notready` and cannot be granted to a studio (`programGrants.ts`); "Not
 * running" (`programsModel.js` operation, `NOT_RUNNING_YET`). The investor audience page is linked, not
 * restated (#6978, S1 on #6965).
 *
 * What is NOT here: a primary action (participation is unconfirmed, so the close is
 * informational), "Ask HQ about investor cohorts" (it ships only when HQ approves it), a studio
 * enquiry (not offered to studios), Demo Day (J1), the NDA's terms, any equity line (G1), and
 * any founder record, deal material, return or solicitation.
 */

export const FOR_INVESTORS_HREF = '/for-investors';
export const SIGN_IN_HREF = '/login';

/** The signature visual's text alternative: the journey's accessible name and slide 3's alt text. */
export const STEPS_ALT = 'Four steps: 1 Eligibility, a verified investor; 2 Assignment, an Administrator assigns one cohort with a scope and a last day; 3 Signature, the investor signs the cohort NDA; 4 Scoped access, the investor reads venture summaries and weekly progress within the scope. All three conditions are checked on every read.';

/** Eligibility, assignment, signature, scoped access. */
export const STEPS = [
  { k: 'Step 1 · Eligibility', t: 'A verified investor', items: ['An investor account, active, with approved KYC.', 'Checked again on every read, not only at the start.'] },
  { k: 'Step 2 · Assignment', t: 'Assigned to one cohort', items: ['An Administrator records one named Lab cohort, a scope and a last day of access.', 'Giving access sends nothing by itself.'] },
  { k: 'Step 3 · Signature', t: 'The cohort NDA is signed', items: ['The Administrator sends the cohort NDA from the grant.', 'Until the investor signs it, they read nothing.'] },
  { k: 'Step 4 · Scoped access', t: 'Read within the scope', items: ['Venture summary and weekly progress, as the scope records.', 'It ends on the recorded last day, or when an Administrator ends it.'] },
];
export const EVERY_READ = { label: 'Checked on every read', note: 'verified now, the grant open and within its dates, the NDA signed. If any one fails, the investor reads nothing.' };
const ALONG = 'Founders are told when an investor can read them, and can hide from one investor.';

const WHO = [
  ['Verified investors', 'An investor account that is active, with approved KYC. It is checked again every time they read, not only when access is given.'],
  ['Founders in the cohort', 'They are told when an investor can read them, can hide from one investor, and decide each introduction request.'],
  ['HQ staff presenting it', 'Explaining what cohort access is. This page and the PDF open nothing and change nothing.'],
];
const GIVING = [
  'An Administrator chooses a verified investor and one Lab cohort',
  'The Administrator records the scope and the last day of access',
  'The Administrator sends the cohort NDA',
  'The investor signs; access opens within the scope and dates',
];
const FOUNDERS = [
  ['Told', 'Founders are told when an investor can read them.'],
  ['Can hide', 'A founder can hide from one investor, and show again later.'],
  ['Introductions', 'An investor can ask for an introduction. The founder accepts or declines once, and writes first.'],
  ['Contact details', 'A founder’s email address is never shown to the investor.'],
];
const COVERS = [
  ['Venture summary', 'Each venture’s name, tagline, sector and stage.'],
  ['Weekly progress', 'Where each venture stands in each week of the Lab.'],
  ['Nothing else', 'No pitch decks, no deal materials, no founder email addresses.'],
];

/** This edition's availability: HQ has published no dated decision to open participation. */
export const NOT_RUNNING = 'Not running yet. HQ has not confirmed that participation is open, and has published no decision as of this edition.';

const NOT_AN_OFFER = 'An explanation of how access works. It is not an offer of securities or an invitation to invest. It shows no founder records, deal materials or returns, and it does not open access.';

export default {
  sections: [
    {
      title: 'Investors who are verified, and the founders they read.',
      lead: 'Access is given to one investor for one cohort. The founders in that cohort keep control of what happens next.',
      blocks: [
        { type: 'cards', numbered: true, items: WHO },
        { type: 'aside', label: 'Studios', text: 'Investor cohort access is run by Axal VC HQ. It is not offered to studios.' },
      ],
    },
    {
      title: 'Eligibility, assignment, signature, then access.',
      lead: 'How access is given, in the order it happens. Each step is recorded on the investor’s grant.',
      band: true,
      blocks: [{ type: 'timeline', label: STEPS_ALT, steps: STEPS, span: EVERY_READ, along: ALONG }],
    },
    {
      title: 'An Administrator gives access; founders stay in control.',
      blocks: [
        { type: 'cols', items: [
          { title: 'Giving access', block: { type: 'stages', items: GIVING } },
          { title: 'Founders, while access is open', block: { type: 'list', items: FOUNDERS } },
        ] },
        { type: 'card', title: 'What access covers', text: 'Set on each grant. Only these two can be opened.', block: { type: 'terms', items: COVERS } },
      ],
    },
    {
      title: 'What access requires.',
      band: true,
      blocks: [
        { type: 'terms', items: [
          ['Who', 'Verified investors: an active investor account with approved KYC.'],
          ['How you join', 'Assigned by an Administrator at Axal VC HQ. There is no application.'],
          ['Agreement', 'The cohort NDA, one per grant, signed before anything is read.'],
          ['Scope', 'Venture summary and weekly progress, as the grant records.'],
          ['Dates', 'One cohort, until the last day the grant records.'],
          ['Availability', 'HQ has not confirmed that participation is open. This page changes when HQ publishes a dated decision.'],
        ] },
        { type: 'limits', title: 'What this page is not', text: NOT_AN_OFFER },
      ],
    },
  ],
  next: {
    title: 'Learn more. Nothing here opens access.',
    band: 'Two ways to learn more.',
    actions: [
      { id: 'investors', who: 'Investors', label: 'Investing with Axal VC →', kind: 'link', to: FOR_INVESTORS_HREF, note: 'How investors work with Axal VC. Accounts are reviewed before they are verified.' },
      { id: 'signin', who: 'Already a member', label: 'Sign in →', kind: 'link', to: SIGN_IN_HREF, note: 'Cohort access is not requested from your account. An Administrator assigns it.' },
    ],
  },
  // HQ's publication decision, as of this edition: none. Nothing reads live; no action.
  panel: {
    text: NOT_RUNNING,
    note: 'How you join: assigned by an Administrator; there is no application. This page explains how access works. It does not open access.',
  },
  // lane-investors.webp is decorative on the cover (canvas PGI06): empty alt.
  cover: { art: 'lane-investors.webp', alt: '' },
  slides: [
    {
      eyebrow: 'Who it helps', title: 'Verified investors, and the founders they read.',
      blocks: [{ type: 'cards', items: WHO }],
      alt: 'Three cards: verified investors; founders in the cohort, who are told, can hide and decide introductions; HQ staff presenting it.',
    },
    {
      eyebrow: 'What happens', title: 'Eligibility, assignment, signature, then access.',
      blocks: [{ type: 'timeline', label: STEPS_ALT, steps: STEPS, span: EVERY_READ }],
      alt: STEPS_ALT,
    },
    {
      eyebrow: 'How participation works', title: 'Access stays in its scope. Founders stay in control.',
      blocks: [{ type: 'two', items: [
        { label: 'What access covers', block: { type: 'list', items: COVERS } },
        { label: 'What founders control', block: { type: 'list', items: FOUNDERS.slice(0, 3) } },
      ] }],
      alt: 'What access covers: venture summary and weekly progress, nothing else. What founders control: they are told, can hide from one investor, and accept or decline introductions once.',
    },
  ],
  closing: {
    title: 'Access and current conditions.',
    rows: [
      ['Availability', 'Not running yet. HQ has not published a decision to open participation, as of this edition.'],
      ['How you join', 'Assigned by an Administrator at HQ. There is no application.'],
      ['Who', 'Verified investors: an active account and approved KYC.'],
      ['Agreement', 'The cohort NDA, signed before anything is read.'],
      ['Covers', 'Venture summary and weekly progress, within the recorded dates.'],
    ],
    next: [
      ['Current availability', 'axal.vc/programs/investor-cohorts', 'Updated when HQ publishes a dated decision.'],
      ['Investors', 'axal.vc/for-investors', 'How investors work with Axal VC.'],
    ],
    alt: 'Conditions: not running yet, no HQ decision published as of this edition; assigned, no application; verified investors; cohort NDA; scope. Two addresses; public page URL and edition date.',
  },
};
