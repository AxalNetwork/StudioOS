/**
 * D6975 (#6975) — Influencers' presentation content: the five sections of `/influencers`
 * (PGF01) and the slides of the PDF (PGF04), from the landed canvas's wording, which the owner
 * approves in review (2026-11-19). One story, two formats: slide 2 is section 1, slide 3 is
 * section 2 (the five stages), slide 4 is section 3 (how a share is earned), slide 5 is
 * sections 4 and 5.
 *
 * The facts are main's: `InfluencersPage.jsx`, `influencerPublicModel.js` and `ApplySheet.jsx`
 * (three steps, three rules, the standing), `routes/influencer.ts` (`GET /tiers` is public; a
 * studio branch refuses an application), `services/influencers.ts` (four tiers; admit at a tier,
 * decline with a reason or ask for more; reapply after 90 days; terms drafted from the tier,
 * approved and signed; Investor Pro while active), `influencerHandles.ts` and
 * `referrals/handleAttribution.ts` (`axal.vc/@handle`, its disclosure sentence, first touch held
 * 90 days and never replaced, self-referral refused) and `influencerCommission.ts` (founder,
 * investor, advisor and partner plans only, the first N paid invoices, held 30 days, bonuses only
 * where the terms set an amount).
 *
 * No rate, period, payout, follower count or bonus amount is written here. The tier table is the
 * page's live read of `GET /api/influencer/tiers` (the block marked `live: 'tiers'`, which
 * `InfluencersPage.jsx` replaces); the PDF prints none and says where they are read. [Creator A],
 * [Founder B] and the handle are bracketed fictional samples.
 *
 * Not here, on the owner's answers of 2026-11-19: a general "Ask a question" (#6987), a studio
 * enquiry (the programme runs at HQ), "premium research" and "private events" (only Investor Pro
 * is recorded on main), and the page's old headline (the kit's h1 is the programme's name).
 */
import { BONUS_MILESTONES, REGISTER_TO_APPLY, SECTION_PATH, disclosureFor } from '../../influencer/influencerPublicModel.js';

export { REGISTER_TO_APPLY, SECTION_PATH };
export const SIGN_IN_TO_APPLY = `/login?next=${encodeURIComponent('/influencers?apply=1')}`;
export const REFER_AND_EARN_HREF = '/programs/refer-and-earn';

/** The one fictional creator of the path and the sample post. */
export const CREATOR = '[Creator A]';
export const HANDLE = 'axal.vc/@[creator-a]';
export const SAMPLE_DISCLOSURE = disclosureFor(CREATOR);

const BONUSES = `A one-time bonus at ${BONUS_MILESTONES.slice(0, -1).join(', ')} and ${BONUS_MILESTONES[BONUS_MILESTONES.length - 1]} paid members, only where your terms set an amount.`;

const WHO = [
  ['People with an audience', 'Who applies: newsletter writers, podcasters, video creators and community leads. Organisations take part by agreement.'],
  ['Axal VC software', 'What you promote: memberships on the Founder, Investor Pro, Advisor and Operating Partner plans.'],
  ['An investment', 'What you never promote: no specific deal, fund or investment return, in any post.'],
];

const NOT_THE_SAME = [
  ['Influencers · this programme', 'You apply; HQ admits you. You share your own handle in disclosed posts. It pays a share of qualifying software subscriptions, for a set period, under signed terms.'],
  ['Refer & Earn · every member', 'Your member link, with nothing to apply for. Introduction credits, and perk credits for referrals submitted by name. No cash.'],
  ['Referral partners · by HQ invitation', 'Event organisers, venture scouts and deal makers HQ adds. Their own signed terms.'],
  ['Investor referrals · not offered here', 'An Influencer never refers anyone to a deal, a fund or an investment. Nothing is paid on fund commitments, deals, fees or carry.'],
];

/** The signature: one illustrative path in five stages, each saying whose step it is. */
export const STAGES = [
  ['Stage 1 · You · Apply', 'Three short steps: where you publish, your audience, and the terms. You tick each rule, one by one.'],
  ['Stage 2 · HQ · HQ reviews', 'HQ admits you at a tier, asks for more, or declines with a reason. After a decline you can apply again 90 days later. HQ approves your terms and you sign them before anything is paid.'],
  ['Stage 3 · You · Your handle', `${HANDLE}, with a link for each channel and any offer HQ sets. The handle page carries the disclosure.`],
  ['Stage 4 · You · A disclosed post', 'Every post about Axal is labelled as a paid partnership, with #ad. It promotes Axal VC memberships, which are software.'],
  ['Stage 5 · They · A qualifying subscription', '[Founder B] subscribes to a software plan: Founder, Investor Pro, Advisor or Operating Partner. It counts for the first handle they came through, within 90 days of that first visit.'],
];

const SHARE = 'You earn a share of that member’s paid subscription invoices for the number of invoices your tier sets. The rate and the period come from your tier and your signed terms. After that period, or if they cancel, their invoices earn you nothing more.';

/** The path's text alternative: slide 3's alt text and the page's. */
export const PATH_ALT = `One illustrative path in five stages. Stage 1, you apply. Stage 2, HQ reviews and admits you at a tier. Stage 3, you get your handle, ${HANDLE}, with the disclosure. Stage 4, you publish a post labelled as a paid partnership. Stage 5, [Founder B] subscribes to an Axal VC software plan through your handle. You then earn a share of their subscription for the set period your tier and signed terms give, and nothing after it.`;

const RULES = [
  ['Label every post', 'As a paid partnership, with #ad.'],
  ['Never promote an investment', 'No specific deal, fund or investment return.'],
  ['Never use your own handle', 'Not to sign up yourself or your company.'],
];

const EARNED = [
  ['What qualifies', 'A paid subscription to a Founder, Investor, Advisor or Operating Partner plan, by someone who came through your handle.'],
  ['What never qualifies', 'LP access, deals, fund commitments, management fees or carry.'],
  ['Whose referral it is', 'The first handle they came through, within 90 days of that first visit. It is never replaced.'],
  ['When it is paid', 'Each share is held 30 days in case of a refund, then becomes payable. Payouts are monthly, once your balance reaches the minimum in your terms.'],
  ['Bonuses', BONUSES],
];

const POST = [
  [`${CREATOR} · Paid partnership · #ad`, `[Your own words about using Axal VC’s software.] ${HANDLE}`],
  ['On the handle page', `“${SAMPLE_DISCLOSURE}”`],
];

const NOT_PROMISED = 'Applying does not guarantee admission. A share is paid only on qualifying software subscriptions, only for the period your tier sets and only under terms you have signed. A refund or dispute inside the 30-day hold cancels it. No rate, payout or audience figure is promised on this page or in the PDF.';

/** Section 3's live tier table: `InfluencersPage.jsx` replaces this block with the read. */
export const TIERS_BLOCK = { type: 'card', live: 'tiers', title: 'What each tier earns', text: 'Reading the tiers…' };

export default {
  sections: [
    {
      title: 'Creators and audience owners who introduce people to Axal VC’s software.',
      lead: 'Any Axal VC member, in any role, with an audience can apply. Being an Influencer is a membership, not a role.',
      blocks: [
        { type: 'cards', numbered: true, items: WHO },
        { type: 'card', title: 'Not the same as', block: { type: 'terms', items: NOT_THE_SAME } },
      ],
    },
    {
      title: 'From an application to a qualifying subscription.',
      lead: 'An illustrative path: [Creator A] applies, and later [Founder B] subscribes through their handle. Names in brackets are fictional.',
      band: true,
      blocks: [
        { type: 'stages', items: STAGES.map(([k, v]) => `${k}. ${v}`) },
        { type: 'card', title: 'Your share, for a set period', text: SHARE },
        { type: 'aside', label: 'Software only', text: 'The share is a share of a software subscription. Nothing on this path involves a deal, a fund or an investment.' },
      ],
    },
    {
      title: 'Your tier and your signed terms set the share.',
      lead: 'HQ keeps the rates in its settings and this page reads them. Your own signed terms decide what you are paid.',
      blocks: [
        TIERS_BLOCK,
        { type: 'cols', items: [
          { title: 'Rules you agree to', block: { type: 'list', items: RULES } },
          { title: 'How a share is earned', block: { type: 'list', items: EARNED } },
        ] },
        { type: 'card', title: 'What a disclosed post looks like', block: { type: 'list', items: POST } },
      ],
    },
    {
      title: 'What you need to take part.',
      band: true,
      blocks: [
        { type: 'terms', items: [
          ['Your account', 'An Axal VC account. Signed out, Apply creates one first and brings you back to the application.'],
          ['Who can apply', 'Any member, in any role, with an audience. One open application at a time.'],
          ['Where it runs', 'At Axal HQ, on axal.vc. Studios do not run it: a studio’s site refuses the application and points to axal.vc.'],
          ['Your terms', 'Copied from your tier when HQ admits you. HQ approves them and you sign them before anything is paid.'],
          ['While you are active', 'Investor Pro is included.'],
          ['The rules', 'Disclose every post, never promote an investment, never use your own handle.'],
        ] },
        { type: 'limits', title: 'What the Influencers programme does not promise', text: NOT_PROMISED },
      ],
    },
  ],
  next: {
    title: 'Apply to the programme.',
    band: 'Three ways forward, kept apart.',
    actions: [
      { id: 'apply', who: 'Creators and audience owners', label: 'Apply', kind: 'primary', to: REGISTER_TO_APPLY, note: 'Create an account, then the application opens: three short steps.' },
      { id: 'section', who: 'Already admitted', label: 'Open your Influencer section →', kind: 'link', to: SECTION_PATH, note: 'Your handle, links, offers and earnings, after you sign in.' },
      { id: 'refer', who: 'Member referrals', label: 'Refer & Earn →', kind: 'link', to: REFER_AND_EARN_HREF, note: 'Introduction credits from your member link. A different programme.' },
    ],
  },
  cover: { alt: 'No artwork.' },
  slides: [
    {
      eyebrow: 'Who it helps', title: 'Creators who introduce people to Axal VC’s software.',
      blocks: [
        { type: 'cards', items: [
          ['Who applies', 'Any Axal VC member with an audience: newsletters, podcasts, video, communities.'],
          ['What you promote', 'Founder, Investor Pro, Advisor and Operating Partner memberships. Software.'],
          ['What you never promote', 'A deal, a fund or an investment return.'],
        ] },
        { type: 'list', items: [['Not the same as', 'Refer & Earn’s introduction credits, a Referral partner, or an investor referral.']] },
      ],
      alt: 'Who applies (members with an audience), what they promote (Axal VC software plans) and what they never promote (an investment). Not Refer & Earn, not a Referral partner, not an investor referral.',
    },
    {
      eyebrow: 'What happens', title: 'From an application to a qualifying subscription.',
      blocks: [{ type: 'list', items: [
        ['Stage 1 · You · Apply', 'Where you publish, your audience, the terms.'],
        ['Stage 2 · HQ · HQ reviews', 'Admits at a tier, asks for more, or declines.'],
        ['Stage 3 · You · Your handle', `${HANDLE}, with the disclosure.`],
        ['Stage 4 · You · A disclosed post', 'Labelled as a paid partnership, #ad.'],
        ['Stage 5 · They · A software plan', '[Founder B] subscribes through your handle.'],
        ['Then: a share for a set period', 'Of that member’s paid invoices. Your tier and signed terms set the rate and the number of invoices. After that, nothing more.'],
      ] }],
      alt: PATH_ALT,
    },
    {
      eyebrow: 'How a share is earned', title: 'Your tier and signed terms set the share.',
      blocks: [{ type: 'two', items: [
        { label: 'The share', block: { type: 'list', items: [
          ['Qualifies', 'A paid Founder, Investor, Advisor or Operating Partner subscription through your handle.'],
          ['Never', 'LP access, deals, funds, fees or carry.'],
          ['How long', 'The number of paid invoices your tier sets. Then nothing more.'],
          ['Held', '30 days in case of a refund, then payable.'],
        ] } },
        { label: 'A disclosed post', block: { type: 'list', items: [
          ...POST,
          ['Current rates', 'Read live at axal.vc/influencers. This PDF prints none.'],
        ] } },
      ] }],
      alt: 'What qualifies (paid software subscriptions through your handle), what never does (LP access, deals, funds, fees, carry), how long (the paid invoices your tier sets), the 30-day hold, and an illustrative post labelled Paid partnership #ad with the handle page’s disclosure.',
    },
  ],
  closing: {
    title: 'Access and next step.',
    rows: [
      ['Who', 'Any Axal VC member with an audience, by application.'],
      ['Decided by', 'Axal HQ: admits at a tier, asks for more, or declines with a reason.'],
      ['What earns', 'Qualifying software subscriptions through your handle, for a set period.'],
      ['Rate and period', 'Your tier and signed terms. Live at axal.vc/influencers.'],
      ['Rules', 'Disclose every post as paid. No deals, funds or returns. No self sign-ups.'],
    ],
    next: [
      ['Read and apply online', 'axal.vc/influencers', 'Apply creates an account first, then opens the application.'],
      ['Admitted Influencers', 'axal.vc/influencer', 'Your handle, links and earnings, after you sign in.'],
      ['All programmes', 'axal.vc/programs', 'Refer & Earn and Referral partners are separate.'],
    ],
    alt: 'Conditions to take part, three next steps with their addresses, the public page URL and the edition date.',
  },
};
