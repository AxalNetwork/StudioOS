/**
 * D6971 (#6971) — Refer & Earn's presentation content: the five sections of the page (PGE01) and
 * the slides of the PDF (PGE04), from the landed canvas's wording, which the owner approves in
 * review (2026-11-19). One story, two formats: slide 2 is section 1, slide 3 is section 2 (one
 * referral in three steps), slide 4 is section 3 (which event earns which credit), slide 5 is
 * sections 4 and 5.
 *
 * Facts, and where they come from:
 *   - the member link is `/register?ref=CODE`, read signed in from `GET /api/refer-earn/overview`
 *     (`routes/refer_earn.ts`); this page and the PDF read nothing live and print no code;
 *   - an account has one referrer and no one refers themselves (`routes/network.ts`
 *     `attachReferral`);
 *   - one introduction credit per referred account once its email is verified; a credit is spent
 *     to accept an introduction, declining is free (`services/introductions.ts`);
 *   - perk credits only for referrals submitted by name, at statuses HQ's rules name; strategic
 *     referrals by invitation, agreed case by case; partner and admin accounts earn no perk
 *     credits (`services/referralSubmissions.ts`, migration 566, `lib/referralRewards.js`);
 *   - 1 credit is US$1 of perk value, no cash value, not transferable (D540, `PerksPage.jsx`);
 *   - `/referrals` is open to signed-in founder, investor, advisor, partner and admin accounts.
 *
 * What is NOT here, on the owner's answers of 2026-11-19: any perk-credit amount (HQ keeps them in
 * Credit rules, shown on the member page); the paused state (PGE02C, ⚑: on main a pause does not
 * stop introduction credits); a studio enquiry (a member program; section 4 states the licence
 * rule only); a general "Ask a question" (#6987). [Member A], [Founder B] and [CODE] are the
 * canvas's bracketed fictional samples.
 */

/** Refer & Earn is `/referrals`, members only; a signed-out visitor signs in first. */
export const REFERRALS_HREF = '/referrals';
export const SIGN_IN_HREF = `/login?next=${encodeURIComponent(REFERRALS_HREF)}`;
export const REGISTER_HREF = '/register';
export const PARTNERS_HREF = '/programs/referral-partners';

export const WHO = [
  ['Members', 'Who refers: founders, investors, advisors and partners with an Axal VC account.'],
  ['Founders', 'Whom you refer: people building a company who should be working on Axal VC.'],
  ['Platform users', 'Whom you refer: advisors, Operating Partners or teams who would use the platform.'],
];

/** One illustrative referral, in three labelled steps, each naming its credit in words. */
export const STEPS = [
  { k: 'Step 1 · You', t: 'Share your link', items: ['[Member A] copies their link from Refer & Earn, or shares it from there to LinkedIn, X, WhatsApp, Facebook or Telegram.', 'It reads axal.vc/register?ref=[CODE].', 'Credit: none yet.'] },
  { k: 'Step 2 · They', t: 'Sign up through it', items: ['[Founder B] opens the link and creates an Axal VC account.', 'The account is recorded as Member A’s referral. An account has one referrer, and no one can refer themselves.', 'Credit: none yet.'] },
  { k: 'Step 3 · They', t: 'Verify their email', items: ['[Founder B] confirms their email address.', 'Member A earns one introduction credit for that account.', 'Credit: +1 introduction credit for you.'] },
];

/**
 * The same three steps at slide scale. Both formats draw the three steps as three cards: the
 * kit's journey (`timeline`) is laid out for four steps, and three would leave a blank column.
 */
const SLIDE_STEPS = [
  { k: 'Step 1 · You', t: 'Share your link', items: ['Copy it from Refer & Earn, or share it from there. No credit yet.'] },
  { k: 'Step 2 · They', t: 'Sign up through it', items: ['They create an account. It is recorded as your referral. No credit yet.'] },
  { k: 'Step 3 · They', t: 'Verify their email', items: ['Once their email is verified, the credit is yours: +1 introduction credit for you.'] },
];

const PERKS_SEPARATE = {
  label: 'Perk credits are a separate event',
  note: 'A sign-up earns no perk credits. They come from a referral you submit by name, once HQ accepts it, the startup forms or the person is onboarded.',
};

/** The worked example's text alternative: slide 3's alt text. */
export const STEPS_ALT = 'One illustrative referral in three steps. Step 1, you share your link: no credit yet. Step 2, they sign up through it: no credit yet. Step 3, they verify their email: you earn one introduction credit. Perk credits are a separate event, for a referral submitted by name.';

export const INTRO_CREDIT = [
  ['What earns it', 'Someone signs up through your link and verifies their email. One credit per account.'],
  ['What it is for', 'Accepting an introduction that Network suggests to you. Declining one is free.'],
  ['How much', 'One per verified sign-up.'],
];

export const PERK_CREDITS = [
  ['What earns it', 'A referral you submit by name is accepted, the startup forms, or the person you referred is onboarded. HQ reviews each one.'],
  ['What it is for', 'Perks from partners. 1 credit is worth $1 of perk value; credits have no cash value.'],
  ['How much', 'Set by HQ and shown on your Refer & Earn page. Not printed here.'],
];

const SUBMITTING = [
  'Sign in and open Refer & Earn',
  'Submit the person by name, with why they fit',
  'HQ reviews it and moves it through its statuses',
  'You follow its status and next step on your page',
  'Perk credits are paid at the statuses HQ’s rules name',
];

const GOOD_TO_KNOW = [
  ['Not every referral is accepted', 'Review is against a quality bar, not a quota.'],
  ['Partner accounts', 'Partner and admin accounts earn no perk credits; their referrals are still reviewed.'],
  ['Strategic introductions', 'By invitation only, with terms agreed case by case.'],
];

const NOT_PROMISED = 'A sign-up alone earns no perk credits. A submitted referral may not be accepted. An introduction credit lets you accept an introduction; it does not promise one. Perk credits have no cash value and cannot be transferred.';

export default {
  sections: [
    {
      title: 'Members who know founders and future platform users.',
      lead: 'Every founder, investor, advisor and partner account has its own referral link. You introduce people you know; the platform records who came through your link.',
      blocks: [
        { type: 'cards', numbered: true, items: WHO },
        { type: 'aside', label: 'Not a Referral partner', text: 'A member referral does not make you, or the person you refer, a Referral partner. That is a separate, invited relationship:', link: { href: PARTNERS_HREF, label: 'Referral partners' } },
      ],
    },
    {
      title: 'One referral, three steps.',
      lead: 'An illustrative example: [Member A] shares their link with [Founder B]. Names in brackets are fictional.',
      band: true,
      blocks: [
        { type: 'cards', numbered: true, items: STEPS.map((x) => [x.t, `${x.k.split(' · ')[1]}: ${x.items.join(' ')}`]) },
        { type: 'aside', label: PERKS_SEPARATE.label, text: PERKS_SEPARATE.note },
        { type: 'aside', label: 'Where you see it', text: 'You see the credit in your introduction credit balance, under Network.' },
      ],
    },
    {
      title: 'Two kinds of credit, earned by different events.',
      lead: 'The link earns introduction credits. A referral you submit by name can earn perk credits. Each line below names its event.',
      blocks: [
        { type: 'cols', items: [
          { title: 'Introduction credit', block: { type: 'terms', items: INTRO_CREDIT } },
          { title: 'Perk credits', block: { type: 'terms', items: PERK_CREDITS } },
        ] },
        { type: 'aside', label: 'Strategic and capital introductions', text: 'By invitation only. Agreed case by case.' },
        { type: 'cols', items: [
          { title: 'Submitting a referral by name', block: { type: 'stages', items: SUBMITTING } },
          { title: 'Good to know', block: { type: 'list', items: GOOD_TO_KNOW } },
        ] },
      ],
    },
    {
      title: 'What you need to take part.',
      band: true,
      blocks: [
        { type: 'terms', items: [
          ['Your account', 'A signed-in founder, investor, advisor or partner account. Your link is on your Refer & Earn page.'],
          ['Who you can refer', 'Anyone without an Axal VC account. Not yourself; an account keeps the first referrer it joined through.'],
          ['Current rewards', 'The perk-credit amounts and conditions live on your Refer & Earn page, where HQ keeps them current. This page and the PDF do not print them.'],
          ['Studios', 'A studio’s Administrator offers Refer & Earn to the studio’s members only when the studio’s licence holds the program.'],
          ['Referral partners', 'A separate, invited programme. Taking part here enrols no one in it.'],
        ] },
        { type: 'limits', title: 'What Refer & Earn does not promise', text: NOT_PROMISED },
      ],
    },
  ],
  next: {
    title: 'Get your link.',
    band: 'Three ways forward, kept apart.',
    actions: [
      { id: 'signin', who: 'Members', label: 'Sign in to get your link →', kind: 'primary', to: SIGN_IN_HREF, note: 'You land on your Refer & Earn page, with your link and the current rewards.' },
      { id: 'register', who: 'No account yet', label: 'Create a free account →', kind: 'link', to: REGISTER_HREF, note: 'Once your account is set up, your link is on Refer & Earn.' },
      { id: 'partners', who: 'Event organisers, scouts, deal makers', label: 'Referral partners →', kind: 'quiet', to: PARTNERS_HREF, note: 'A separate, invited relationship. Not this programme.' },
    ],
  },
  panel: {
    text: 'Nothing to apply for. Your link is on your Refer & Earn page. Each verified sign-up earns 1 introduction credit; perk credit amounts are on your page, set by HQ.',
    note: 'New to Axal VC? Create a free account first: see Next step below.',
    action: { id: 'signin', label: 'Sign in to get your link →', to: SIGN_IN_HREF },
  },
  cover: { alt: 'No artwork: the cover carries the name, availability, purpose, audience and edition.' },
  slides: [
    {
      eyebrow: 'Who it helps', title: 'Members introduce founders and future platform users.',
      blocks: [{ type: 'cards', items: [
        ['Who refers', 'Founders, investors, advisors and partners with an Axal VC account.'],
        ['Whom you refer', 'Founders, and people who would use the platform.'],
        ['Not a Referral partner', 'A member referral enrols no one as a Referral partner. That is a separate, invited relationship.'],
      ] }],
      alt: 'Who refers (members), whom they refer (founders and platform users), and that a member referral enrols no one as a Referral partner.',
    },
    {
      eyebrow: 'What happens', title: 'One referral, three steps.',
      blocks: [
        { type: 'cards', items: SLIDE_STEPS.map((x) => [x.t, x.items[0]]) },
        { type: 'list', items: [[PERKS_SEPARATE.label, PERKS_SEPARATE.note]] },
      ],
      alt: STEPS_ALT,
    },
    {
      eyebrow: 'Which event earns which credit', title: 'Two kinds of credit, two different events.',
      blocks: [
        { type: 'two', items: [
          { label: 'I · Introduction credit', block: { type: 'list', items: [['Earned when', INTRO_CREDIT[0][1]], ['Used for', INTRO_CREDIT[1][1]], ['How much', INTRO_CREDIT[2][1]]] } },
          { label: 'P · Perk credits', block: { type: 'list', items: [['Earned when', PERK_CREDITS[0][1]], ['Used for', PERK_CREDITS[1][1]], ['How much', PERK_CREDITS[2][1]]] } },
        ] },
        { type: 'list', items: [['Strategic and capital introductions', 'By invitation only, agreed case by case.']] },
      ],
      alt: 'Two credits compared. Introduction credit: earned when a sign-up through your link verifies their email; used to accept an introduction; one per sign-up. Perk credits: earned when a referral submitted by name is accepted, forms or is onboarded; used on Perks; amounts set by HQ on the member page.',
    },
  ],
  closing: {
    title: 'Access and next step.',
    rows: [
      ['Who', 'Signed-in founders, investors, advisors and partners.'],
      ['Introduction credit', 'One per sign-up through your link, once their email is verified.'],
      ['Perk credits', 'For referrals you submit by name, at HQ’s current amounts.'],
      ['Current rewards', 'On your Refer & Earn page. They can change.'],
      ['Not promised', 'Cash, acceptance of a referral, or an introduction.'],
    ],
    next: [
      ['Read this online', 'axal.vc/programs/refer-and-earn', 'The same story, and the way to sign in.'],
      ['Members: your link', 'axal.vc/referrals', 'After you sign in: your link and the current rewards.'],
      ['All programmes', 'axal.vc/programs', 'Referral partners is a separate, invited relationship.'],
    ],
    alt: 'Conditions to take part, three next steps with their addresses, the public page URL and the edition date.',
  },
};
