/**
 * D6974 (#6974) — Product testing's presentation content: the five sections of the page
 * (PGT01) and the slides of the PDF (PGT04), from the landed canvas's wording, which the owner
 * approves in review (2026-11-19). One story, two formats: slide 2 is section 1, slide 3 is
 * section 2 (the two paths), slide 4 is section 3's two decisions, slide 5 is sections 4 and 5.
 *
 * The facts are main's: `routes/testing.ts` (the member, partner and Super Admin routers),
 * `services/testing.ts` (draft → submitted → approved → open → testing → closed; a partner's
 * campaign opens only after HQ approves it, HQ's own are not reviewed; applying needs an active
 * tester, an eligible role, an open campaign and a place left; up to five questions, `MAX_QUESTIONS`;
 * picks held to the places; the owner sees answers, no email address), `services/testerPool.ts`
 * and `productTesters.ts` (consent to join; HQ approves or declines; reapply after 90 days,
 * `REAPPLY_DAYS`; leave at any time; Admin accounts refused) and `services/programGrants.ts`
 * (`product-testing` readiness `hq`: never granted to a studio, so there is no studio enquiry).
 *
 * The page reads nothing live (PGT02A): no count, campaign name or date, on the page or in the
 * PDF. Open campaigns are listed in Studio for active testers. The open-campaign count of
 * PGT02B to PGT02D is held for the owner and needs a signed-out read that does not exist.
 *
 * Not here, on the owner's answers of 2026-11-19: a general "Ask a question" (#6987) and any
 * place, reward or payment. Prospective partners are pointed at Operating Partners in words;
 * its contact topic (#6976) is not on main.
 */

export const STUDIO_SIGN_IN_HREF = `/login?next=${encodeURIComponent('/studio')}`;
export const REGISTER_HREF = '/register';
export const PARTNER_SIGN_IN_HREF = `/login?next=${encodeURIComponent('/offers/testing')}`;

const WHO = [
  ['Members who test', 'Founders, investors, partners, advisors and members still exploring. Each campaign names the roles it is open to.'],
  ['Partner firms with a product', 'A partner proposes a campaign for its own product. HQ reviews it before any member sees it.'],
  ['Axal VC HQ', 'Runs the tester pool, reviews every partner campaign, opens and closes campaigns, and runs campaigns of its own.'],
];

/** The two paths, each step with who decides it, in words. */
export const TESTER_PATH = [
  ['T1 · Join the tester pool', 'Apply once, and agree to be emailed about campaigns you join. ◆ Decides: Member.'],
  ['T2 · Approved as a tester', 'HQ approves or declines. A declined member can apply again after 90 days. ◆ Decides: HQ.'],
];
export const PARTNER_PATH = [
  ['P1 · Propose a campaign', 'The product, what testers do, time needed, dates, places and eligible roles. ◆ Decides: Partner firm.'],
  ['P2 · Reviewed by HQ', 'HQ approves it or sends it back with a note. HQ’s own campaigns skip this. ◆ Decides: HQ.'],
];
const MEET = { title: 'Both paths meet: one approved campaign, opened by HQ', text: 'Members can apply only once HQ opens it, and only while it takes applications. ◆ Decides: HQ.' };
export const AFTER = [
  { k: '1 · Decides: Active tester', t: 'Apply', items: ['Only if your role is eligible and a place is left. Up to five questions.'] },
  { k: '2 · Decides: Campaign owner', t: 'Selection', items: ['The partner or HQ picks testers, never more than the places.'] },
  { k: '3 · Decides: HQ', t: 'Testing and feedback', items: ['HQ starts testing and picked testers are told. The owner tells them how to give feedback.'] },
];

/** The diagram's text alternative: the accessible name of the list on the page and slide 3's alt text. */
export const PATHS_ALT = 'Two paths meet at one campaign. Tester path: T1 a member joins the tester pool; T2 HQ approves them as a tester. Partner path: P1 a partner firm proposes a campaign; P2 HQ reviews and approves it (HQ’s own campaigns skip review). The paths meet when HQ opens the approved campaign. Then: 1 an active tester whose role is eligible applies; 2 the campaign owner, the partner or HQ, picks testers up to the places; 3 HQ starts testing, picked testers are told, and the owner tells them how to give feedback. Approval as a tester is not selection for a campaign.';

const DECISION_1 = ['Approved as a tester', 'HQ decides, once. It lets you apply to campaigns. It is not a place on any campaign.'];
const DECISION_2 = ['Picked for a campaign', 'The campaign’s owner decides, for that campaign only, up to its places. Applying does not reserve a place.'];

const BECOMING = [
  'Sign in, and open Product testing on your Studio home',
  'Apply to join the tester pool, agreeing to be emailed about campaigns you join',
  'HQ approves or declines; you are told either way',
  'Once approved, campaigns open to your role are listed in Studio',
];
const APPLYING = [
  'Open a campaign and read what testers do and the time it needs',
  'Answer its questions (up to five) and apply',
  'The owner picks testers; you are told if you are picked',
  'Withdraw your application, or leave the pool, at any time',
];
const PROPOSING = [
  'Draft the campaign in your partner workspace, under Offers',
  'Send it to HQ for review',
  'HQ approves it or sends it back with a note to change',
  'HQ opens it; members whose role is eligible apply',
  'You pick testers from the applicants, up to the places',
  'HQ moves it to testing, and closes it',
];
const KEEP = [
  ['Answers, not addresses', 'The campaign owner reads your answers. Your email address is not shown to them.'],
  ['Withdraw', 'You can withdraw an application, and leave the tester pool, at any time.'],
  ['Told, not chased', 'You are told when you apply, when you are picked or not, and when testing starts.'],
];

const NOT_PROMISED = 'Joining the tester pool does not promise a place on a campaign. Campaigns open and close; none is always open. This page promises no place, reward or payment, and shows no campaign that is not real.';

export default {
  sections: [
    {
      title: 'Members who test, and partners with a product to test.',
      lead: 'Every campaign is approved by Axal VC HQ before members can apply.',
      blocks: [
        { type: 'cards', numbered: true, items: WHO },
        { type: 'aside', label: 'Studios', text: 'Product testing runs at HQ and is not granted to a studio to operate. If HQ delivers testing for a studio as part of an agreed package, that is an HQ service, separate from a studio operating grant.' },
      ],
    },
    {
      title: 'Two paths, one approved campaign, then testing.',
      lead: 'Testers and partners each take their own steps. They meet only at a campaign HQ has approved and opened. Each step names who decides.',
      band: true,
      blocks: [
        { type: 'cols', items: [
          { title: 'Tester path', block: { type: 'list', items: TESTER_PATH } },
          { title: 'Partner path', block: { type: 'list', items: PARTNER_PATH } },
        ] },
        { type: 'card', title: MEET.title, text: MEET.text },
        { type: 'timeline', label: PATHS_ALT, steps: AFTER },
        { type: 'aside', label: 'Two decisions', text: 'Campaign names in examples are illustrative. Approval as a tester and selection for a campaign are two different decisions.' },
      ],
    },
    {
      title: 'Two decisions, kept apart.',
      blocks: [
        { type: 'cols', items: [
          { title: 'Decision 1 · HQ, once', block: { type: 'list', items: [DECISION_1] } },
          { title: 'Decision 2 · the owner, per campaign', block: { type: 'list', items: [DECISION_2] } },
        ] },
        { type: 'cols', items: [
          { title: 'Becoming a tester', block: { type: 'stages', items: BECOMING } },
          { title: 'Applying to a campaign', block: { type: 'stages', items: APPLYING } },
        ] },
        { type: 'cols', items: [
          { title: 'Partners proposing a campaign', block: { type: 'stages', items: PROPOSING } },
          { title: 'What testers keep', block: { type: 'list', items: KEEP } },
        ] },
      ],
    },
    {
      title: 'What taking part requires.',
      band: true,
      blocks: [
        { type: 'terms', items: [
          ['Testers', 'A signed-in Axal VC member, approved into the tester pool by HQ. Admin accounts cannot be testers.'],
          ['Each campaign', 'Open to the roles it names, for its dates, with a set number of places. The owner picks.'],
          ['Consent', 'You agree that the firm running a campaign you join, and Axal VC, may email you about it, and that your answers go to that firm.'],
          ['Partners', 'A partner firm with a partner workspace. Every partner campaign is reviewed by HQ before it opens.'],
          ['Studios', 'Not granted to a studio. An HQ testing service agreed in a package is separate from a studio operating grant.'],
          ['Availability', 'Which campaigns are open is shown in Studio, to active testers. This page does not list them.'],
        ] },
        { type: 'limits', title: 'What the program does not promise', text: NOT_PROMISED },
      ],
    },
  ],
  next: {
    title: 'Choose your next step.',
    band: 'Three ways forward, kept apart.',
    actions: [
      { id: 'tester', who: 'Members', label: 'Sign in to become a tester →', kind: 'primary', to: STUDIO_SIGN_IN_HREF, note: 'Product testing is on your Studio home: join the pool there. Active testers see open campaigns there too.' },
      { id: 'register', who: 'No account yet', label: 'Create a free account →', kind: 'link', to: REGISTER_HREF, note: 'Then join the tester pool from Studio. HQ decides.' },
      { id: 'partner', who: 'Partner firms', label: 'Propose a campaign →', kind: 'quiet', to: PARTNER_SIGN_IN_HREF, note: 'Opens your partner workspace’s testing campaigns. Not a partner yet? Read Operating Partners.' },
    ],
  },
  panel: {
    text: 'By application, in two steps. Become a tester: apply once to join the tester pool; HQ decides. Each campaign: apply to one open to your role; its owner picks the testers.',
    note: 'Open campaigns are listed in Studio for active testers, after sign-in, not on this page. New to Axal VC? Create a free account first. Admin accounts cannot be testers.',
    action: { id: 'tester', label: 'Sign in to become a tester →', to: STUDIO_SIGN_IN_HREF },
  },
  cover: { art: 'tool-discovery.webp', alt: 'The site’s discovery tool illustration (Axal VC site artwork).' },
  slides: [
    {
      eyebrow: 'Who it helps', title: 'Members who test, partners with a product.',
      blocks: [{ type: 'cards', items: WHO }],
      alt: 'Three cards: members who test, in the roles each campaign names; partner firms proposing a campaign for their product; Axal VC HQ, which runs the pool and reviews, opens and closes campaigns.',
    },
    {
      eyebrow: 'What happens', title: 'Two paths meet at one approved campaign.',
      blocks: [
        { type: 'two', items: [
          { label: 'Tester path', block: { type: 'list', items: [['T1 · Join the tester pool', 'Decides: Member'], ['T2 · Approved as a tester', 'Decides: HQ']] } },
          { label: 'Partner path', block: { type: 'list', items: [['P1 · Propose a campaign', 'Decides: Partner firm'], ['P2 · Reviewed by HQ', 'Decides: HQ']] } },
        ] },
        { type: 'timeline', label: PATHS_ALT, steps: [
          { k: 'Both paths meet · Decides: HQ', t: 'Campaign opened', items: ['One approved campaign, opened by HQ.'] },
          { k: '1 · Decides: Active tester', t: 'Apply', items: ['Only if your role is eligible and a place is left.'] },
          { k: '2 · Decides: Campaign owner', t: 'Selection', items: ['The partner or HQ picks, up to the places.'] },
          { k: '3 · Decides: HQ', t: 'Testing and feedback', items: ['Picked testers are told.'] },
        ] },
      ],
      alt: PATHS_ALT,
    },
    {
      eyebrow: 'How participation works', title: 'Two decisions, kept apart.',
      blocks: [{ type: 'two', items: [
        { label: 'Decision 1 · HQ, once', block: { type: 'list', items: [DECISION_1, ['Then', 'Campaigns open to your role are listed in Studio.']] } },
        { label: 'Decision 2 · The owner, per campaign', block: { type: 'list', items: [DECISION_2, ['Then', 'HQ starts testing; picked testers are told.']] } },
      ] }],
      alt: 'Two decisions: approved as a tester (HQ, once; lets you apply, not a place) and picked for a campaign (the owner, per campaign, up to its places).',
    },
  ],
  closing: {
    title: 'Access and current conditions.',
    rows: [
      ['Availability', 'By application, in two steps: the tester pool, then each campaign. Open campaigns are listed in Studio, not here.'],
      ['Testers', 'Signed-in members HQ approves. Each campaign names its eligible roles.'],
      ['Places', 'Set per campaign. The owner picks. No place, reward or open campaign is promised.'],
      ['Partners', 'Propose from the partner workspace. HQ reviews and opens every campaign.'],
      ['Studios', 'Runs at HQ. Not granted to a studio.'],
    ],
    next: [
      ['This presentation', 'axal.vc/programs/product-testing', 'Same story as this deck.'],
      ['Members', 'axal.vc/login?next=/studio', 'Sign in, then join the tester pool in Studio and see open campaigns.'],
    ],
    alt: 'Conditions: by application in two steps; testers approved by HQ; places set per campaign, nothing promised; partners propose, HQ reviews and opens; not granted to studios. Two addresses; public page URL and edition date.',
  },
};
