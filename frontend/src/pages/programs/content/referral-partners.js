/**
 * D6970 (#6970) — Referral partners' presentation content: the five sections of the page (PGR01)
 * and the slides of the PDF (PGR04), from the landed canvas's wording, which the owner approves
 * in review (2026-11-19). One story, two formats: slide 2 is section 1, slide 3 is section 3 (the
 * two paths), slide 4 is section 2 (the event introduction), slide 5 is sections 4 and 5. The
 * deck puts the paths before the example so a room sees the structure first.
 *
 * Facts, and where they come from:
 *   - the three segments: `referralPartnerTerms.ts` (Event organisers, Venture scouts, Deal
 *     makers; Influencers join through their own program);
 *   - HQ adds each partner, every route `requireHqAdmin`, only the Super Admin approves terms:
 *     `admin_referral_partners.ts`; terms go from draft to signed, then active;
 *   - "By invitation. HQ adds the partner; their own referral code earns." and "Today only a
 *     referred member's identity check pays.": migration 593;
 *   - strategic access is a signed-in member's request (`POST /api/refer-earn/strategic-access`),
 *     granted or declined by an admin, a decline with a reason, and it writes
 *     `referral_strategic_access` only, never `referral_partners`: `refer_earn.ts` and
 *     `referralSubmissions.ts`. The two paths are two records.
 *
 * What is NOT here, on the owner's answers of 2026-11-19: any rate, amount or schedule; the
 * "Enquire about partnering" action and its contact topic (⚑ held on the canvas: no contact
 * topic exists, so the third door is not drawn); a studio enquiry (the program is HQ-held); a
 * general "Ask a question" (#6987 is not shipped). The sample organiser, attendee and meetup are
 * in brackets, as the canvas draws them. The page reads nothing live.
 */

/** Refer & Earn is `/referrals`, members only; a signed-out visitor signs in first. */
export const REFERRALS_HREF = '/referrals';
export const SIGN_IN_HREF = `/login?next=${encodeURIComponent(REFERRALS_HREF)}`;

export const SEGMENTS = [
  ['Event organisers', 'You run events. You bring Axal VC the people you meet there.'],
  ['Venture scouts', 'You find startups early. You bring Axal VC their founders.'],
  ['Deal makers', 'You work on deals. You bring Axal VC deals and LPs.'],
];

/** The event introduction, in four labelled steps (the canvas's worked example). */
export const INTRO_STEPS = [
  { k: 'Step 1 · Introduce', t: 'Share your link', items: ['[An event organiser] shares their own referral link with [the people at a founder meetup].', 'The link carries the partner’s referral code.'] },
  { k: 'Step 2 · Sign up', t: 'Someone joins', items: ['[An attendee] creates an Axal VC account with that code.', 'HQ counts it as the partner’s introduction.'] },
  { k: 'Step 3 · Qualify', t: 'Identity check', items: ['The new member’s identity check is approved.', 'Today, this is the event that earns a partner a commission.'] },
  { k: 'Step 4 · Earn', t: 'Agreed terms', items: ['The commission follows the standard rules or the partner’s signed terms.', 'It counts as paid when the payout completes.'] },
];

const NO_AMOUNTS = {
  label: 'No amounts here',
  note: 'What an introduction earns is set by the standard rules or by terms the partner has signed. This page and the PDF state no rate, amount or schedule.',
};

/** The worked example's text alternative: the accessible name of the list on the page and slide 4's alt text. */
export const INTRO_ALT = 'An event introduction in four steps: 1 the partner shares their referral link; 2 someone signs up with the code; 3 their identity check is approved; 4 a commission follows the standard rules or the partner’s signed terms.';

/** Path A: a member's request for strategic referral access, on Refer & Earn. */
export const PATH_A = [
  ['Who starts it', 'Any signed-in member, on Refer & Earn.'],
  ['Step 1', 'You request strategic referral access on Refer & Earn, with a note on the introductions you expect to make.'],
  ['Step 2', 'An Axal VC admin grants or declines it. A decline comes with a reason you can read.'],
  ['Step 3', 'Granted: you can submit strategic and capital introductions. Each one is reviewed on its own.'],
  ['What it starts', 'A review of whether you may submit strategic and capital introductions. Their economics are agreed case by case.'],
  ['What it does not', 'It does not add you to the referral-partner roster or give you terms.'],
];

/** Path B: HQ enrolment in the referral-partner roster, by invitation. */
export const PATH_B = [
  ['Who starts it', 'Axal VC HQ, by invitation.'],
  ['Step 1', 'HQ adds you as a referral partner in one segment: Event organisers, Venture scouts or Deal makers.'],
  ['Step 2', 'Your own referral code earns under the standard commission rules.'],
  ['Step 3', 'Custom terms, if agreed: an admin drafts them, the Super Admin approves them, you sign them. They apply from their start date.'],
  ['What it starts', 'Formal entry into the HQ roster, with your segment and, where agreed, your own signed terms.'],
  ['What it does not', 'There is no form for it. HQ invites each partner.'],
];

const KEPT_APART = 'Two separate records. Being granted strategic access does not make you a referral partner, and a referral partner does not need strategic access.';

const NOT_PROMISED = 'No rate, amount or payment date is stated here. Submitting an introduction, or being granted strategic access, does not make you a partner or guarantee a reward. Introductions are not promised either way.';

export default {
  sections: [
    {
      title: 'Three kinds of partner.',
      lead: 'HQ adds each partner to one segment. The segment says what you bring; it does not change how a referral is counted.',
      blocks: [
        { type: 'cards', numbered: true, items: SEGMENTS },
        { type: 'aside', label: 'Influencers', text: 'join through their own program, by application:', link: { href: '/influencers', label: 'Influencers' } },
      ],
    },
    {
      title: 'Introduce people. Earn only under agreed terms.',
      lead: 'An example with an event introduction. Sample people and events are in brackets.',
      band: true,
      blocks: [
        { type: 'timeline', label: INTRO_ALT, steps: INTRO_STEPS, span: NO_AMOUNTS },
      ],
    },
    {
      title: 'Two separate paths, never one form.',
      lead: 'A member’s request for strategic referral access is reviewed on Refer & Earn. Formal entry into the HQ roster is by invitation.',
      blocks: [
        { type: 'cols', items: [
          { title: 'Path A · Strategic referral access', block: { type: 'list', items: PATH_A } },
          { title: 'Path B · Referral-partner roster', block: { type: 'list', items: PATH_B } },
        ] },
        { type: 'aside', label: 'Kept apart', text: KEPT_APART },
      ],
    },
    {
      title: 'What you need to take part.',
      band: true,
      blocks: [
        { type: 'terms', items: [
          ['Admission', 'By invitation. HQ adds each partner to the roster; there is no public application.'],
          ['Your account', 'An Axal VC member account. As a partner you earn through your own referral code.'],
          ['Segment', 'One of three: Event organisers, Venture scouts or Deal makers.'],
          ['Terms', 'The standard commission rules, or custom terms the Super Admin approves and you sign. Signed terms pay instead of the standard rule, within their caps.'],
          ['Run by', 'Axal VC HQ holds the program and every partner’s terms.'],
          ['Strategic access', 'A separate request any signed-in member makes on Refer & Earn. Granting it does not make anyone a referral partner.'],
        ] },
        { type: 'limits', title: 'What this program does not promise', text: NOT_PROMISED },
      ],
    },
  ],
  next: {
    title: 'Choose your next step.',
    band: 'Two doors, each for a different person.',
    actions: [
      { id: 'signin', who: 'Invited partners', label: 'Sign in to Refer & Earn →', kind: 'link', to: SIGN_IN_HREF, note: 'Your referral code, your introductions and their status.' },
      { id: 'strategic', who: 'Members · strategic introductions', label: 'Request strategic referral access', kind: 'quiet', to: SIGN_IN_HREF, note: 'On Refer & Earn. Starts an admin’s review of whether you may submit strategic and capital introductions. It does not add you to the partner roster.' },
    ],
  },
  panel: {
    text: 'HQ invites each partner. There is no public application, and nothing on this page signs you up. Already a partner? Your referral code is on Refer & Earn. A member with strategic introductions? That is a separate request, on Refer & Earn: path A below.',
    note: 'Not invited and want to partner? HQ reaches out to partners; an enquiry route is not open yet.',
  },
  cover: { alt: 'No artwork: the cover carries the name, availability, purpose, audience and edition.' },
  slides: [
    {
      eyebrow: 'Who it helps', title: 'Three kinds of partner.',
      blocks: [
        { type: 'cards', items: SEGMENTS },
        { type: 'list', items: [['One segment each', 'HQ adds each partner to one segment. Influencers join through their own program.']] },
      ],
      alt: 'Three partner segments: Event organisers, Venture scouts and Deal makers. HQ adds each partner to one segment.',
    },
    {
      eyebrow: 'How participation works', title: 'Two separate paths, never one form.',
      blocks: [
        { type: 'two', items: [
          { label: 'A · Strategic referral access', block: { type: 'stages', items: ['Request on Refer & Earn', 'An admin grants or declines', 'Submit introductions for review'] } },
          { label: 'B · Referral-partner roster', block: { type: 'stages', items: ['HQ adds you in a segment', 'Your code earns, standard rules', 'Custom terms: approved, then signed'] } },
        ] },
        { type: 'list', items: [['Kept apart', 'Granted strategic access is not roster membership, and neither creates the other. Path A does not add you to the roster; path B takes no form: HQ invites.']] },
      ],
      alt: 'Two separate paths. Path A, strategic referral access: a member requests it on Refer & Earn, an admin grants or declines it, and a granted member submits strategic introductions for review. Path B, the referral-partner roster: HQ adds a partner in one segment, their referral code earns under the standard rules, and custom terms take effect once approved and signed. Neither path creates the other.',
    },
    {
      eyebrow: 'What a partner does · an event introduction', title: 'Earn only under agreed terms.',
      blocks: [{ type: 'timeline', steps: INTRO_STEPS, span: NO_AMOUNTS, label: INTRO_ALT }],
      alt: INTRO_ALT,
    },
  ],
  closing: {
    title: 'Access and next step.',
    rows: [
      ['Admission', 'By invitation. HQ adds each partner; there is no public application.'],
      ['Segments', 'Event organisers, Venture scouts, Deal makers.'],
      ['Terms', 'Standard rules, or custom terms approved by the Super Admin and signed by you.'],
      ['Strategic access', 'A separate member request on Refer & Earn; not roster entry.'],
      ['Not promised', 'Any rate, amount, payment date or reward.'],
    ],
    next: [
      ['Read the presentation', 'axal.vc/programs/referral-partners', 'The same story, kept current.'],
      ['Partners and members sign in at', 'axal.vc/referrals', 'Referral code, introductions, strategic access request.'],
    ],
    alt: 'Conditions to take part: by invitation, three segments, standard or signed terms, strategic access separate, nothing promised; two addresses; public page URL and edition date.',
  },
};
