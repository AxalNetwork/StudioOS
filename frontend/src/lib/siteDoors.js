/**
 * The four door pages' copy (D676, #1550), from the DOORS view of the owner's
 * canvas `design/canvases/integrated/Axal VC Website.dc.html` (its `DOORS`
 * object in the logic script). `pages/site/DoorPage.jsx` renders one door.
 *
 * The words are the owner's. Four rules sit on top of them:
 *
 *   - **"Live" names a route.** Every `live` item carries the `route` it runs
 *     at in `App.jsx`, and `doors_d676.test.mjs` fails if that path is not
 *     routed or is only a redirect. A canvas item that does not run today is
 *     left out, with the reason beside it.
 *   - **No price is typed here.** A plan names its catalogue tier (`tier`), the
 *     tier `/pricing` reads (`data/pricing.js`). The page takes the price and
 *     the feature list from that tier; a plan whose tier the catalogue does not
 *     have (`tier: null`) does not render. A chapter line that quotes a price
 *     carries `{price}` and its tier.
 *   - **A claim that is not true of the code is dropped, not reworded.** Where
 *     only part of a sentence was false, that part is cut and the rest is the
 *     owner's text unchanged. Each cut is noted where it was made; D676.md
 *     lists them all.
 *   - **The primary CTA is the door's lane link,** the one the site already
 *     uses for that audience.
 *
 * `catalogue` names the `data/pricing.js` list a door's tiers come from
 * (`founder` → FOUNDER_TIERS, `investor` → INVESTOR_TIERS); a door without one
 * has no catalogue entry and shows no plans. `meta` is the door's key in
 * `data/productPages.js`, which holds its title and description.
 */

export const DOOR_ORDER = ['founders', 'investors', 'partners', 'advisors'];

export const DOORS = {
  founders: {
    path: '/for-founders',
    meta: 'founders',
    accent: '#6d28d9',
    soft: '#f4f0fe',
    catalogue: 'founder',
    label: 'For Founders',
    img: '/site/door-founders.webp',
    imgAlt: 'Two founders in violet cloaks look out over a valley city at sunset, beside a workshop of builders.',
    imgPos: '68% 38%',
    closePos: '50% 62%',
    h1: 'Go from idea to funded — on one operating platform.',
    who: 'For early-stage founders validating a first idea, and founders who already have a company and are preparing a raise.',
    primary: { t: 'Start free', to: '/register?lane=founder' },
    secondary: { t: 'See Spin-Out Lab', to: '/spinout-lab' },
    problem: 'Founders lose months stitching together tools, templates, and cold outreach before anyone serious looks at the company.',
    facts: [
      'The 28-day Spin-Out Lab takes an idea to an incorporated company',
      'Pitch deck, cap table, and fundraise in one workspace for an existing company',
      'Introductions are earned and proceed under a three-way NDA',
    ],
    chaptersTitle: 'One record, from first idea to first close.',
    chapters: [
      {
        k: 'Idea to company',
        t: 'The 28-day Spin-Out Lab takes an idea to an incorporated company.',
        d: 'Four weeks, four gates. Problem and customer, then solution and roadmap, then validation and team, then the entity, founder stock, and cap table.',
        flow: ['Week 1 · Idea & customer', 'Week 2 · Solution & roadmap', 'Week 3 · Validate & team', 'Week 4 · Incorporate & capital'],
      },
      {
        k: 'Already a company',
        t: 'An existing company uses the same workspace for pitch deck, cap table, and fundraise.',
        d: 'Import what you have and keep building the record. Nothing is re-entered.',
        list: ['Pitch deck builder', 'Cap table', 'Fundraise'],
      },
      {
        k: 'Introductions',
        t: 'Introductions are earned, and proceed under a three-way NDA once you accept.',
        d: 'They come from your venture-readiness record, not from a paid list. When an investor asks to meet, you decide.',
        flow: ['Investor asks', 'You accept', 'Three-way NDA'],
      },
      {
        k: 'Plans',
        t: 'Starter is free forever. Pro is for an active raise.',
        d: 'Start on Starter and stay as long as you like. Move to Pro when you are raising.',
        // The canvas types "$0"; the price is the catalogue's free tier.
        list: [{ t: 'Starter · {price}, forever', tier: 'free' }, 'Pro · monthly, for an active raise'],
      },
    ],
    eadwynT: 'Eadwyn, the assistant inside the product',
    eadwynD: 'Eadwyn drafts, checks, and keeps your record moving inside the workspace. You make the calls.',
    statusTitle: 'What is live today, and what is not yet.',
    // Cut: ", and it is labelled that way in the product" — nothing in the
    // product labels a slide reviewer.
    statusNote: 'The pitch deck builder is live. The AI slide reviewer is not.',
    live: [
      { t: 'Startup workspace', route: '/build' },
      { t: 'Roadmap', route: '/build/roadmap' },
      { t: 'Brand', route: '/build/brand' },
      { t: 'Cap table', route: '/build/captable' },
      { t: 'Pitch deck builder', route: '/raise/pitch' },
      { t: 'Venture-readiness score', route: '/spinout-lab/scoring' },
      { t: 'Public profile', route: '/u/:handle' },
      { t: 'Warm introductions', route: '/network/introductions' },
    ],
    soon: ['AI slide reviewer'],
    // The canvas's founder plans are a four-step ladder at monthly prices.
    // The catalogue's founder tiers are Free, Growth and Studio: none of the
    // ladder is in it, so no founder plan renders and there is no plans
    // section (the Starter strip sits inside that section in the canvas).
    plans: [
      { step: 'Step 1', name: 'Validate', tier: null },
      { step: 'Step 2', name: '+ Build', tier: null },
      { step: 'Step 3', name: '+ Raise', tier: null },
      { step: 'Step 4', name: '+ Grow', tier: null },
    ],
    faq: [
      { q: 'Do I pay to start?', a: 'No. Starter is free forever. Pro is a monthly plan for an active raise.' },
      { q: 'How do introductions work?', a: 'They are earned through your venture-readiness record. When an investor wants to meet, the introduction proceeds under a three-way NDA once you accept.' },
      // Cut: "and is labelled as such in the product" (no such label exists).
      { q: 'Is the slide reviewer live?', a: 'Not yet. The AI slide reviewer is coming soon. The pitch deck builder is live today.' },
      { q: 'Can I bring an existing startup?', a: 'Yes. Import your company and use the same workspace for pitch deck, cap table, and fundraise.' },
    ],
    closing: 'Build your startup where the investors already are.',
    closeNote: '',
  },

  investors: {
    path: '/for-investors',
    meta: 'investors',
    accent: '#059669',
    soft: '#e9f8f1',
    catalogue: 'investor',
    label: 'For Investors & LPs',
    img: '/site/lane-investors.webp',
    imgAlt: 'Two figures in green cloaks stand in a library hall overlooking a valley city at sunset.',
    imgPos: '68% 38%',
    closePos: '50% 62%',
    h1: 'Better deals, less noise. From first look to portfolio.',
    who: 'For angels, syndicates, emerging managers, funds, and LPs.',
    primary: { t: 'Create an investor account', to: '/register?lane=lp' },
    secondary: { t: 'Compare investor plans', to: '/pricing/investor' },
    problem: 'Most deal flow is cold inbound: decks without evidence, numbers without verification, and notes scattered across tools.',
    facts: [
      'A curated pipeline instead of cold inbound',
      // Cut: ", and numbers verified via Stripe and Plaid" — no Plaid
      // integration exists in the worker.
      'A venture-readiness score with the evidence behind it',
      'Pipeline, relationships, and notes are the CRM',
    ],
    chaptersTitle: 'From first look to portfolio, on one record.',
    chapters: [
      {
        k: 'Pipeline',
        t: 'A curated pipeline instead of cold inbound.',
        d: 'Companies arrive from the Axal workspace with a record behind them, not as unsolicited decks.',
        flow: ['Spin-Out Lab or existing company', 'Workspace record', 'Your pipeline'],
      },
      {
        k: 'Evidence',
        t: 'Each company carries a venture-readiness score, with the evidence behind it.',
        d: 'Open the score and read what produced it.',
        list: ['Customer interviews', 'Experiments and roadmap', 'Documents and data room'],
      },
      // Dropped: the "Verification" chapter ("Founder numbers can be verified
      // via Stripe and Plaid"). Plaid is not integrated.
      {
        k: 'CRM',
        t: 'Pipeline, relationships, and notes are the CRM.',
        d: 'Deal flow is the CRM. There is no separate system to keep in sync.',
      },
      {
        k: 'LPs',
        t: 'LPs can see portfolio reporting today.',
        // Cut: ", and is labelled that way in the product".
        d: 'A dedicated LP data room and capital-account portal is coming soon.',
        soon: 'LP data room and capital-account portal',
      },
    ],
    eadwynT: 'Eadwyn, the assistant inside the product',
    // Cut: "and keeps your notes current" — Eadwyn writes no notes.
    eadwynD: 'Eadwyn summarises each record inside the product.',
    statusTitle: 'What is live today, and what is not yet.',
    statusNote: 'Portfolio reporting for LPs is live. The dedicated LP data room and capital-account portal is coming soon.',
    live: [
      { t: 'Curated pipeline', route: '/deals/pipeline' },
      { t: 'Venture-readiness score with evidence', route: '/scoring' },
      // Dropped: "Stripe and Plaid verification" (no Plaid integration).
      { t: 'Deal rooms', route: '/deals/:dealId' },
      { t: 'Relationships and notes', route: '/network/relationships' },
      { t: 'Portfolio reporting for LPs', route: '/funds/reporting' },
    ],
    soon: ['Dedicated LP data room and capital-account portal'],
    plansTitle: 'Scaled to how you invest.',
    // Cut: "Funds investing at scale get a plan shaped around them." — its
    // plan (Enterprise) is not in the catalogue.
    plansSub: 'Browse the network for free. Pro opens the full deal flow.',
    plans: [
      { name: 'Starter', desc: 'Browse the network', tier: 'free', cta: 'Start free' },
      { name: 'Pro', desc: 'Full deal flow', tier: 'professional', cta: 'Start trial', highlight: true, tag: 'Recommended' },
      // The canvas's custom-priced Enterprise plan. The catalogue's top
      // investor tier (Institutional) is a fixed monthly price with a capped
      // seat and intro count, so it is not this plan.
      { name: 'Enterprise', desc: 'For funds investing at scale', tier: null, cta: 'Talk to sales' },
    ],
    // Cut: "Enterprise is priced per fund." (Enterprise does not render).
    planNote: 'Every account can start a 14-day Pro trial with no card.',
    faq: [
      { q: 'Where do companies come from?', a: 'From the Axal workspace: founders building in the Spin-Out Lab or bringing an existing company, each with a venture-readiness record. Nothing arrives as cold inbound.' },
      { q: 'I am an LP, not a GP. Do I belong here?', a: 'Yes. LPs can see portfolio reporting today. A dedicated LP data room and capital-account portal is coming soon.' },
      { q: 'Can I try before paying?', a: 'Yes. Every account can start a 14-day Professional trial with no card. Starter stays free.' },
      { q: 'Do I still need a separate CRM?', a: 'No. Pipeline, relationships, and notes live in one place. Deal flow is the CRM.' },
    ],
    closing: 'Spend your time on the deals that matter.',
    closeNote: '',
  },

  partners: {
    path: '/for-service-partners',
    meta: 'service-partners',
    accent: '#2563eb',
    soft: '#eaf1fd',
    catalogue: null,
    label: 'For Operating Partners',
    img: '/site/lane-partners.webp',
    imgAlt: 'Two figures in blue cloaks stand on a bridge terrace above a valley city at sunset, one gesturing outward.',
    imgPos: '68% 38%',
    closePos: '50% 62%',
    h1: 'Get in front of funded founders who need what you do.',
    who: 'For operators who sell into startups: legal, design, GTM, recruiting, finance, data, technical diligence, and fractional operators.',
    primary: { t: 'List your services', to: '/register?lane=partner' },
    secondary: { t: 'Browse the marketplace', to: '/directory' },
    problem: 'Finding funded founders at the moment they need help is slow, and the paperwork around each engagement slows it further.',
    facts: [
      'A provider profile in the marketplace and the public directory',
      'Founders post needs; you answer live requests',
      // Dropped: "KYB, conflicts, and contracts handled; payouts through
      // Stripe Connect". KYB has no working satisfier, no conflict check
      // exists, and Stripe Connect is not configured for partners.
    ],
    // Cut: "verified, paid" — see the dropped Trust and Payouts chapters.
    chaptersTitle: 'Listed, requested.',
    chapters: [
      {
        k: 'Profile',
        t: 'A provider profile in the marketplace and the public directory.',
        d: 'Founders find you where they already work.',
      },
      {
        k: 'Requests',
        t: 'Founders post needs. You answer live requests.',
        d: 'Live requests come from funded founders who need what you do.',
        flow: ['Founder posts a need', 'You answer', 'Engagement'],
        soon: 'Automated lead alerts',
      },
      // Dropped: "Trust" (verification badges are never set; KYB and conflict
      // checks do not run), "Insights" (nothing counts profile views; partner
      // insights reads founder demand) and "Payouts" (Stripe Connect is not
      // configured for partners).
      {
        k: 'Placement',
        t: 'Featured placement, curated by Axal VC.',
        d: 'Partners also source thesis-aligned companies and can co-invest.',
        soon: 'A slot you can buy yourself',
      },
    ],
    eadwynT: 'Eadwyn, the assistant inside the product',
    // Cut: "Eadwyn drafts replies to requests and keeps your profile current."
    // No AI task drafts a request reply or edits a profile.
    eadwynD: 'Advisor is a separate human role, with its own page.',
    statusTitle: 'What is live today, and what is not yet.',
    statusNote: 'Featured placement is live and curated by Axal VC. A self-serve slot and automated lead alerts are coming soon.',
    live: [
      { t: 'Provider profile', route: '/partners/:slug' },
      { t: 'Public directory listing', route: '/directory' },
      { t: 'Live founder requests', route: '/partner/needs' },
      // Dropped: "Verification badges", "KYB, conflicts, and contracts".
      { t: 'Partner insights', route: '/partner/insights' },
      // Dropped: "Stripe Connect payouts".
      { t: 'Featured placement, curated by Axal VC', route: '/directory' },
    ],
    soon: ['Self-serve featured slot', 'Automated lead alerts'],
    // The canvas draws Starter, Pro and Enterprise. The catalogue has no
    // partner tier at all, so none renders.
    plans: [
      { name: 'Starter', tier: null },
      { name: 'Pro', tier: null },
      { name: 'Enterprise', tier: null },
    ],
    aside: {
      t: 'Listing is free.',
      // Cut: ", and get paid through Stripe Connect".
      d: 'There is no price grid for partners. List your services, answer requests.',
      // Dropped: "Payouts through Stripe Connect".
      items: ['Provider profile in the marketplace and the public directory', 'Answer live requests from funded founders'],
      cta: 'List your services',
      to: '/register?lane=partner',
    },
    faq: [
      { q: 'What can be listed?', a: 'Services operators sell into startups: legal, design, GTM, recruiting, finance, data, technical diligence, and fractional operating work.' },
      { q: 'How do leads arrive?', a: 'Founders post needs and you answer live requests. Founders also reach you from your marketplace profile and the public directory. Automated lead alerts are coming soon.' },
      { q: 'How does featured placement work?', a: 'Featured placement is curated by Axal VC. A slot you can buy yourself is coming soon and will be labelled when it arrives.' },
      // Dropped: "How do payouts work?" (Stripe Connect, KYB, conflicts).
    ],
    closing: 'Put your services where the demand already is.',
    closeNote: 'List for free.',
  },

  advisors: {
    path: '/for-advisors',
    meta: 'advisors',
    accent: '#d97706',
    soft: '#fdf3e4',
    catalogue: null,
    label: 'For Advisors',
    img: '/site/lane-advisors.webp',
    imgAlt: 'Two figures in orange cloaks stand on a terrace above a valley city at sunset, beside a table of maps.',
    imgPos: '68% 38%',
    closePos: '50% 62%',
    h1: 'Work with the founders you were built to help.',
    who: 'For human advisors: operators, domain experts, and seasoned founders.',
    // The canvas leads with "Apply to advise"; the primary CTA is the lane
    // link (D676), so the canvas's two buttons trade places.
    primary: { t: 'Create an account', to: '/register?lane=advisor' },
    secondary: { t: 'Apply to advise', to: '/contact' },
    problem: 'Founders who need a specific gap closed rarely find the person who has closed it before.',
    facts: [
      'A public profile with expertise and availability',
      // Dropped: "Matching by sector, expertise, and availability". Advisor
      // matching scores expertise against the founder's skill gaps, values
      // and skill complementarity; it reads no sector and no availability.
      'Office hours and one-off sessions in one workspace, with a visible record',
    ],
    chaptersTitle: 'One workspace for the work of advising.',
    chapters: [
      {
        k: 'Profile',
        t: 'A public profile with expertise and availability.',
        d: 'Say what you know and when you are available. Founders and the matching engine read the same profile.',
      },
      // Dropped: "Matching" ("Matched by sector, expertise, and availability").
      {
        k: 'Sessions',
        t: 'Office hours and one-off sessions in one workspace.',
        d: 'Sessions are scheduled and held next to the founder’s record.',
        flow: ['Matched', 'Office hours or a one-off session', 'Recorded'],
      },
      {
        k: 'Record',
        t: 'A visible record of engagements.',
        d: 'Every engagement is recorded, so your work with a company is visible to the founder and to you.',
      },
    ],
    eadwynT: 'Eadwyn is the assistant inside the product, not an advisor.',
    // Cut: "It handles scheduling and notes so sessions stay about the work."
    // No AI task schedules sessions or writes session notes.
    eadwynD: 'Advisor is the human role.',
    statusTitle: 'What is live today.',
    statusNote: 'Everything listed here is in the product now. Nothing is queued for this door.',
    live: [
      { t: 'Public advisor profile', route: '/advisors/:uid' },
      // Dropped: "Matching by sector, expertise, and availability".
      { t: 'Office hours', route: '/practice/opportunities' },
      { t: 'One-off sessions', route: '/practice/sessions' },
      { t: 'Engagement record', route: '/practice/engagements' },
    ],
    soon: [],
    // The canvas draws Starter, Pro and Enterprise. The catalogue has no
    // advisor tier at all, so none renders.
    plans: [
      { name: 'Starter', tier: null },
      { name: 'Pro', tier: null },
      { name: 'Enterprise', tier: null },
    ],
    aside: {
      t: 'A human role, not a plan.',
      d: 'There is no session cap, no listed hourly price, and no plan grid. Advisors are admitted by application.',
      items: ['Operators, domain experts, and seasoned founders', 'Office hours and one-off sessions', 'A visible record of engagements'],
      cta: 'Apply to advise',
      to: '/contact',
    },
    faq: [
      { q: 'Who is this for?', a: 'Operators, domain experts, and seasoned founders who want to work with founders whose gap they have closed before.' },
      // Dropped: "How does matching work?" ("By sector, expertise, and
      // availability, read from your public profile.").
      { q: 'How do sessions run?', a: 'As office hours and one-off sessions, scheduled and held in one workspace, with a visible record of each engagement.' },
    ],
    closing: 'Bring what you have built to the founders who need it.',
    closeNote: 'Admission is by application.',
  },
};
