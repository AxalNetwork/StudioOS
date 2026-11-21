/**
 * D6972 (#6972) — Perks' presentation content: the five sections of the page (PGP01) and the
 * slides of the PDF (PGP04), from the landed canvas's wording, which the owner approves in review
 * (2026-11-19). One story, two formats: slide 2 is section 1, slide 3 is the offer anatomy of
 * section 3, slide 4 is section 2, slide 5 is the rest of section 3, slide 6 is sections 4 and 5.
 *
 * Facts, and where they come from:
 *   - only founders claim, once per offer; the price is perk credits, a plan, or payment to the
 *     partner, who invoices offline; fulfilment is a code, a link or an introduction; the cap,
 *     the end date and the balance are checked with the claim and the debit in one batch; a claim
 *     expires with its offer and no reminder is sent; a new or edited listing goes to review
 *     unless the edit only raises the cap; the partner is not told who claimed
 *     (`routes/perks.ts`);
 *   - the claim button's five reasons, Marketplace and My perks (`pages/PerksPage.jsx`);
 *   - `/perks` is open to every signed-in role, a partner is sent to `/offers/perk-deals`
 *     (`App.jsx`); the login page honours `?next=`, the route guard keeps no `/perks`
 *     destination, so the page links `/login?next=%2Fperks` itself (`lib/pendingNext.js`);
 *   - 1 credit is worth $1 of perk value, and where credits come from (migration 560);
 *   - on a studio deployment, approving a listing needs the studio's Perks grant
 *     (`services/programEnforcement.ts`).
 *
 * What is NOT here: any partner, offer, discount or count (main records no partner offer as
 * public; the offer in section 3 is a labelled, bracketed sample); a live status read (the
 * status is "running, as of this edition"); a general "Ask a question" (#6987). The studio
 * licence enquiry is drawn by the canvas, so it stays, on `/contact?topic=licence` (owner,
 * 2026-11-19).
 */

export const PERKS_HREF = '/perks';
export const SIGN_IN_HREF = `/login?next=${encodeURIComponent(PERKS_HREF)}`;
export const PARTNER_SIGN_IN_HREF = `/login?next=${encodeURIComponent('/offers/perk-deals')}`;
export const LICENCE_HREF = '/contact?topic=licence';

/** The claim button's own reasons (`PerksPage.jsx`), in its order. */
export const CLAIM_REASONS = ['Founders only', 'Upgrade to claim', 'Not enough credits', 'Claim limit reached', 'Offer ended'];

const WHO = [
  ['Founders', 'Find an offer, check they qualify and claim it. Only founders claim.'],
  ['Other members', 'Investors, advisors and people whose membership is under review can browse the catalogue. They cannot claim.'],
  ['Partners', 'Submit offers from their own partner console. Each offer is reviewed before founders see it.'],
];

export const STEPS = [
  { k: 'Step 1 · Find', t: 'Browse the catalogue', items: ['Sign in and open Perks. Every listed offer has been reviewed by Axal VC.', 'An offer past its end date leaves the catalogue.'] },
  { k: 'Step 2 · Check', t: 'Read its conditions', items: ['Who can claim, what it costs you, how it is fulfilled and when it ends.', 'The claim button names the reason if you cannot claim.'] },
  { k: 'Step 3 · Claim', t: 'Claim it in Perks', items: ['Founders claim each offer once. Perk credits come off in the same step.', 'A paid offer records your request; the partner invoices you.'] },
  { k: 'Step 4 · Redeem', t: 'Use it with the partner', items: ['A code, a link or a claim reference, kept under My perks.', 'The partner marks it redeemed; then you can rate it.'] },
];

const CHECKED = {
  label: 'Checked when you claim',
  note: 'A founder account, the offer live and not ended, under its claim limit, and the credits, plan or payment it names. If one fails, nothing is claimed and nothing is spent.',
};

export const STEPS_ALT = 'Four steps: 1 Find, browse the reviewed catalogue after signing in; 2 Check, read who can claim, the cost, how it is fulfilled and when it ends; 3 Claim, founders claim once, with perk credits, through their plan or as a paid request; 4 Redeem, use the code, link or claim reference with the partner, who marks it redeemed. The founder account, the end date, the claim limit and the price are checked when you claim.';

/** The signature: one generic offer in four numbered parts. Every value is a bracketed sample. */
export const ANATOMY = [
  ['1 · Provider', '[Partner name] · [Category] · reviewed by Axal VC'],
  ['2 · Eligibility', 'Founders claim · one claim each. Price: [N perk credits] or [included in a plan] or [paid to the partner]'],
  ['3 · Redemption conditions', 'Fulfilled by [a code, a link or an introduction]. Ends [date, or no end date] · [claim limit, or none]'],
  ['4 · Next step', `[Claim · N credits]. Check before you claim. If you cannot, the button says why: ${CLAIM_REASONS.join(', ')}.`],
];

const PARTS = [
  ['1 · Provider', 'The partner who honours the offer, and its category. Axal VC reviews the listing; the partner delivers it.'],
  ['2 · Eligibility', 'Founders claim. The price is one of three: perk credits, included in a plan, or paid to the partner.'],
  ['3 · Redemption conditions', 'How it is fulfilled (a code, a link or an introduction), when it ends, and any claim limit.'],
  ['4 · Next step', 'Claim in Perks. If you cannot, the button says why before you try.'],
];

const ANATOMY_ALT = 'An offer in four parts, shown on a labelled sample: 1 Provider, the partner and the category; 2 Eligibility, founders claim, and the price is perk credits, a plan or a payment to the partner; 3 Redemption conditions, how it is fulfilled, when it ends and any claim limit; 4 Next step, the claim button, which names the reason when you cannot claim.';

const PRICED = [
  ['Perk credits', '1 credit is worth $1 of perk value. The credits come off your balance in the same step as the claim.'],
  ['Included in a plan', 'The offer names the plan that includes it. Without that plan, the button reads “Upgrade to claim”.'],
  ['Paid', 'The claim records your request. No charge is taken in Axal VC; the partner invoices you directly.'],
];

const PROVIDER_ROLE = [
  'A partner submits an offer from its partner console',
  'Axal VC reviews it. It is listed only once approved; a rejection says why and is final',
  'An edit sends a live offer back to review, unless it only raises the claim limit',
  'The partner marks each claim redeemed by its claim reference',
];

const NOT_THIS = 'An overview of how Perks works. It names no partner, discount or live offer, and it does not promise that any offer will be listed or stay open. Offers, prices and end dates are on each listing in Perks, and change.';

export default {
  sections: [
    {
      title: 'Founders claim. Members browse. Partners supply.',
      lead: 'One catalogue with three kinds of reader. Who can claim is the same for every offer.',
      blocks: [
        { type: 'cards', numbered: true, items: WHO },
        { type: 'aside', label: 'Studios', text: 'Perks is held by Axal VC HQ. A studio runs it only where HQ grants it on the studio’s licence, and its Administrator acts for the studio.' },
      ],
    },
    {
      title: 'Find, check, claim, redeem.',
      lead: 'How a founder takes an offer, in the order it happens. Everything is kept under My perks.',
      band: true,
      blocks: [
        { type: 'timeline', label: STEPS_ALT, steps: STEPS, span: CHECKED, along: 'The partner is not told who claimed. You give them your claim reference when you get in touch.' },
      ],
    },
    {
      title: 'Every offer reads the same way.',
      lead: 'Provider, eligibility, redemption conditions and next step. The partner’s side is separate.',
      blocks: [
        { type: 'card', title: 'Labelled sample · not a real offer', block: { type: 'terms', items: ANATOMY } },
        { type: 'list', items: PARTS },
        { type: 'cols', items: [
          { title: 'How an offer is priced', block: { type: 'list', items: PRICED } },
          { title: 'The provider’s role', block: { type: 'stages', items: PROVIDER_ROLE } },
        ] },
      ],
    },
    {
      title: 'What taking part requires.',
      band: true,
      blocks: [
        { type: 'terms', items: [
          ['Browse', 'Any signed-in member. Partners use their partner console.'],
          ['Claim', 'Founders only, once per offer.'],
          ['Price', 'Set by each offer: perk credits, included in a plan, or paid to the partner.'],
          ['Perk credits', '1 credit is worth $1 of perk value. Credits come from rules a Super Admin sets, for Spin-Out Lab milestones, bug bounties and approved tasks, or from a grant by hand. They are not introduction credits.'],
          ['Ending', 'Each offer shows its end date, or has none. A claim lasts as long as its offer. No reminder is sent before it ends.'],
          ['Availability', 'Perks is running, as of this edition. The offers in it change; this page lists none, so it stays true when one ends.'],
        ] },
        { type: 'limits', title: 'What this page is not', text: NOT_THIS },
      ],
    },
  ],
  next: {
    title: 'Sign in to see what is open.',
    band: 'The catalogue shows the offers open today, each with its own conditions.',
    actions: [
      { id: 'signin', who: 'Founders and members', label: 'Sign in to Perks →', kind: 'primary', to: SIGN_IN_HREF, note: 'You come back to the catalogue after signing in.' },
      { id: 'partners', who: 'Partners', label: 'Sign in to list an offer →', kind: 'link', to: PARTNER_SIGN_IN_HREF, note: 'Partner accounts submit offers for review.' },
      { id: 'licence', who: 'Studio Administrators', label: 'Enquire about a studio licence', kind: 'quiet', to: LICENCE_HREF, note: 'For a studio that wants to run Perks on its licence. Not a claim.' },
    ],
  },
  panel: {
    text: 'Browse: any signed-in member; partners use their partner console. Claim: founders, offer by offer, once each. Offers change: each shows its own conditions and end date in Perks; this page lists none. Status: running, as of Edition 1 · November 2026.',
    note: 'You come back to Perks after signing in. New to Axal VC? Create an account; membership is reviewed.',
    action: { id: 'signin', label: 'Sign in to Perks →', to: SIGN_IN_HREF },
  },
  cover: { alt: 'No artwork: the cover carries the name, availability, purpose, audience and edition.' },
  slides: [
    {
      eyebrow: 'Who it helps', title: 'Founders claim. Members browse. Partners supply.',
      blocks: [{ type: 'cards', items: WHO }],
      alt: 'Three cards: founders claim; other members browse and cannot claim; partners submit offers for review.',
    },
    {
      eyebrow: 'Every offer', title: 'Every offer reads the same way.',
      blocks: [{ type: 'two', items: [
        { label: 'Labelled sample · not a real offer', block: { type: 'list', items: ANATOMY.slice(0, 2) } },
        { label: 'Every value in brackets is a sample', block: { type: 'list', items: ANATOMY.slice(2) } },
      ] }],
      alt: ANATOMY_ALT,
    },
    {
      eyebrow: 'What happens', title: 'Find, check, claim, redeem.',
      blocks: [{ type: 'timeline', steps: STEPS, span: CHECKED, label: STEPS_ALT }],
      alt: STEPS_ALT,
    },
    {
      eyebrow: 'How participation works', title: 'Each offer names its price. The partner’s side is separate.',
      blocks: [{ type: 'two', items: [
        { label: 'How an offer is priced', block: { type: 'list', items: [['Perk credits', '1 credit is worth $1 of perk value.'], ['Included in a plan', 'The offer names the plan.'], ['Paid', 'The partner invoices you directly.']] } },
        { label: 'The partner', block: { type: 'list', items: [
          ['Submits', 'Each offer from its own partner console.'],
          ['Reviewed', 'Listed only once Axal VC approves it. An edit goes back to review.'],
          ['Delivers', 'Honours the offer and marks each claim redeemed by its reference.'],
          ['Not told', 'Who claimed. The founder brings the claim reference.'],
        ] } },
      ] }],
      alt: 'How an offer is priced: perk credits (1 credit is $1 of perk value), a plan, or paid to the partner. The partner: submits, is reviewed, delivers and marks redeemed, and is not told who claimed.',
    },
  ],
  closing: {
    title: 'Access and current conditions.',
    rows: [
      ['Availability', 'Running, as of this edition. Any signed-in member browses.'],
      ['Who claims', 'Founders, once per offer.'],
      ['Price', 'Set by each offer: perk credits, a plan, or paid to the partner.'],
      ['Offers', 'Listed in Perks with their own conditions and end dates. This deck names none.'],
    ],
    next: [
      ['This page, current', 'axal.vc/programs/perks', 'How Perks works, and this PDF.'],
      ['Members', 'axal.vc/perks', 'Sign in to browse and claim.'],
    ],
    alt: 'Conditions: running as of this edition; founders claim once per offer; price set per offer; offers listed in Perks, none named here. Two addresses; public page URL and edition date.',
  },
};
