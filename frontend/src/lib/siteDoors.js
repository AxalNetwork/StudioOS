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
 *     carries `{price}` and its tier. A plan is called by its tier's name, so
 *     the door and `/pricing` never name one plan two ways; its `desc` says
 *     what the plan is for in plain words, and a door that sells plans says
 *     how AI use is paid under them (`tokens`, the shared `AI_TOKENS`).
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

/**
 * How AI use is paid, in plain words, under the plans of every door that sells
 * them (owner, 2026-10-13: "include tokens as this is a different revenue
 * model"). It is D629's model and nothing more:
 *   - every licence, free ones included, has a daily and a monthly AI allowance
 *     (`ai_licence_caps`, else the deployment's cap), and a run draws on it
 *     first (`services/aiBudget.ts`);
 *   - past it, the run draws on a paid balance the member tops up through
 *     checkout ("Add tokens"), one dollar paid before tax for one dollar of AI
 *     use, and that balance never expires;
 *   - the Worker and Assist rails show the allowance, what was used, and the
 *     balance.
 * No allowance amount is typed: the Super Admin sets each licence's, and today
 * they are all the same deployment default, so no plan is said to include more.
 */
export const AI_TOKENS = {
  k: 'AI use',
  t: 'The plan pays for the workspace. Tokens pay for the AI.',
  d: 'Eadwyn and the AI tools run on tokens, billed apart from your plan, so past your allowance you pay only for the AI you use.',
  points: [
    'Every plan, Free included, comes with an AI allowance that resets each day and each month.',
    'AI work draws on that allowance first.',
    'When it runs out, add tokens: each dollar you add is a dollar of AI use.',
    'Tokens you buy never expire.',
    'Your allowance, what you have used, and your token balance are shown in the product.',
  ],
};

export const DOORS = {
  founders: {
    path: '/for-founders',
    meta: 'founders',
    accent: '#6d28d9',
    soft: '#f4f0fe',
    catalogue: 'founder',
    label: 'For Founders',
    img: '/site/lane-founders.webp',
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
      'Validate, Build, Raise, and Grow run the company after that, in the same workspace',
      'Network, Research, and Eadwyn work across all four',
      'Introductions are earned and proceed under a three-way NDA',
    ],
    // Owner, 2026-10-13: the page showed the Spin-Out Lab and three tools, and
    // a founder gets the whole workspace. The chapters now walk it: the two
    // ways in, the four founder cycles, Network, Research, and the founder's
    // own profile. `doors_d676.test.mjs` holds a chapter for every bucket the
    // founder shell registers, each listing that bucket's screens by the names
    // the founder's own menu gives them, so neither can drift off the page.
    chaptersTitle: 'One workspace, from first idea to a company that lasts.',
    chapters: [
      {
        k: 'Idea to company',
        t: 'The 28-day Spin-Out Lab takes an idea to an incorporated company.',
        d: 'Four weeks, four gates. Problem and customer, then solution and roadmap, then validation and team, then the entity, founder stock, and cap table. Its tools carry the work, from customer discovery and market sizing to incorporation.',
        flow: ['Week 1 · Idea & customer', 'Week 2 · Solution & roadmap', 'Week 3 · Validate & team', 'Week 4 · Incorporate & capital'],
      },
      {
        k: 'Already a company',
        t: 'Already have a company? Skip the Lab and start in the workspace.',
        d: 'Import what you have and keep building the record. Nothing is re-entered.',
        flow: ['Validate', 'Build', 'Raise', 'Grow'],
      },
      {
        k: 'Validate',
        t: 'Prove someone wants it.',
        d: 'Log customer interviews, or record one in person, on a video or phone call, or by text chat; audio starts only once the person has consented. Interviews feed a pain map, the pain map feeds hypotheses, and the evidence reaches a verdict.',
        list: ['Interviews', 'Pain map', 'Hypotheses', 'Verdict'],
      },
      {
        k: 'Build',
        t: 'Run the company week by week.',
        d: 'Plan the week, work the board, keep the product roadmap, run your operating rituals such as the weekly review, and enter the numbers you track.',
        list: ['This week', 'Board', 'Roadmap', 'Cadence', 'KPI entry'],
      },
      {
        k: 'Raise',
        t: 'Raise money, and stay legal.',
        d: 'See where the round stands, build your pitch deck and share it by link, and keep SAFEs, the option pool, and dilution on the cap table. Track investor prospects and who can introduce you, keep a data room, and see your legal documents, signatures, and deadlines, the 83(b) among them, in one place.',
        list: ['Status', 'Pitch', 'Capital', 'Investor match', 'Legal', 'Data room', 'Liquidity'],
      },
      {
        k: 'Grow',
        t: 'Find customers, people, and reach.',
        d: 'Set targets for the numbers that matter, hire from applicants to a shortlist, run customers and partnerships as pipelines, keep your brand in one place, and plan launches and events.',
        list: ['Focus', 'Talent', 'Customers', 'Partnerships', 'Brand', 'Launch'],
      },
      {
        k: 'Network',
        t: 'Introductions are earned, and proceed under a three-way NDA once you accept.',
        d: 'They come from your venture-readiness record, not from a paid list. When an investor asks to meet, you decide. Your relationships and organizations sit beside them.',
        flow: ['Investor asks', 'You accept', 'Three-way NDA'],
      },
      {
        k: 'Research',
        t: 'Go deep on a market or a company.',
        d: 'Ask a question and get an answer with its sources. Read markets, countries, companies, and funds, and keep what you find in your library.',
        list: ['Ask', 'Markets', 'Geographies', 'Companies', 'Funds', 'Library'],
      },
      {
        k: 'Your profile',
        t: 'Your founder profile goes with you.',
        d: 'Profiling maps your skills and values to a founder archetype card. The venture-readiness score reads your record and shows the evidence behind it. Your public profile has its own address, co-founder match looks for a partner who fits, and wellbeing sessions and Academy lessons are in the same account.',
        list: ['Archetype card', 'Venture-readiness score', 'Public profile', 'Co-founder match', 'Wellbeing', 'Academy'],
      },
    ],
    eadwynT: 'Eadwyn, the assistant inside the product',
    eadwynD: 'Eadwyn drafts, checks, and keeps your record moving inside the workspace. You make the calls.',
    statusTitle: 'What is live today, and what is not yet.',
    // Cut: ", and it is labelled that way in the product" — nothing in the
    // product labels a slide reviewer.
    statusNote: 'The pitch deck builder is live; the AI slide reviewer is not yet. Connecting your own AI assistant to the workspace is coming soon.',
    live: [
      { t: 'Spin-Out Lab', route: '/spinout-lab' },
      { t: 'Customer interviews', route: '/validate/interviews' },
      { t: 'Record a session', route: '/validate/session/:id' },
      { t: 'Pain map, hypotheses, and verdict', route: '/validate/hypotheses' },
      { t: 'This week and the board', route: '/build/this-week' },
      { t: 'Roadmap', route: '/build/roadmap' },
      { t: 'Cadence and KPIs', route: '/build/cadence' },
      { t: 'Pitch deck builder', route: '/raise/pitch' },
      { t: 'Cap table', route: '/build/captable' },
      { t: 'Investor match', route: '/raise/capital-match' },
      { t: 'Data room', route: '/raise/data-room' },
      { t: 'Legal and 83(b)', route: '/raise/legal' },
      { t: 'Talent', route: '/grow/talent' },
      { t: 'Customers and partnerships', route: '/grow/customers' },
      { t: 'Brand', route: '/grow/brand' },
      { t: 'Launches and events', route: '/grow/launch' },
      { t: 'Warm introductions', route: '/network/introductions' },
      { t: 'Research and Ask', route: '/research/ask' },
      { t: 'Venture-readiness score', route: '/spinout-lab/scoring' },
      { t: 'Archetype card', route: '/studio/archetype' },
      { t: 'Public profile', route: '/u/:handle' },
      { t: 'Co-founder match', route: '/spinout-lab/cofounder-match' },
      { t: 'Wellbeing sessions', route: '/wellbeing' },
      { t: 'Academy', route: '/academy' },
    ],
    // The AI-assistant connector (#1555) is built and switched off until its
    // OAuth store exists in production.
    soon: ['AI slide reviewer', 'Connecting your own AI assistant'],
    // The canvas drew a four-step ladder (Validate, + Build, + Raise, + Grow)
    // that the catalogue never had. Owner, 2026-10-13: the page shows the
    // plans /pricing sells, each with what it is for in plain words, and how
    // AI use is paid (tokens) under them. The name is the catalogue's.
    plansTitle: 'A plan for the workspace. Tokens for the AI.',
    plansSub: 'Your plan decides what the workspace opens. AI use beyond what your plan includes is paid in tokens, separately.',
    plans: [
      { name: 'Free', tier: 'free', desc: 'One startup, taken through the 28-day Spin-Out Lab, with your public profile.', cta: 'Start free' },
      { name: 'Growth', tier: 'growth', desc: 'Build and pitch: unlimited projects and interviews, the pitch deck with share links, cap table scenarios, and advisor time.', cta: 'Start with Growth', highlight: true, tag: 'Recommended' },
      { name: 'Studio', tier: 'studio', desc: 'Raise and stay legal: capital, legal and the 83(b), liquidity, and co-founder matching, on top of Growth.', cta: 'Start with Studio' },
    ],
    tokens: AI_TOKENS,
    faq: [
      { q: 'Do I pay to start?', a: 'No. The Free plan takes one startup through the Spin-Out Lab and stays free. Growth and Studio are monthly plans for when you need more.' },
      { q: 'What are tokens?', a: 'Tokens pay for AI use, apart from your plan. Every plan includes an AI allowance each day and each month; if you use it up, you add tokens, and each dollar you add is a dollar of AI use. Tokens you buy never expire.' },
      { q: 'How do introductions work?', a: 'They are earned through your venture-readiness record. When an investor wants to meet, the introduction proceeds under a three-way NDA once you accept.' },
      { q: 'Can I bring an existing startup?', a: 'Yes. Import your company and start in Validate, Build, Raise, or Grow. You do not have to take the Lab.' },
      // Cut: "and is labelled as such in the product" (no such label exists).
      { q: 'Is the slide reviewer live?', a: 'Not yet. The AI slide reviewer is coming soon. The pitch deck builder is live today.' },
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
    // Owner, 2026-10-13: the plans are the ones /pricing sells, by the
    // catalogue's names (the canvas said Starter, Pro and a custom-priced
    // Enterprise, none of which the catalogue has), each with what it is for
    // in plain words, and how AI use is paid under them.
    plansSub: 'Browse for free. Professional opens the full deal flow, and Institutional adds what a fund needs. AI use beyond your allowance is paid in tokens.',
    plans: [
      { name: 'Free', desc: 'Browse the public deal index and watch the companies you follow.', tier: 'free', cta: 'Start free' },
      { name: 'Professional', desc: 'Work deals: full deal flow, warm introductions every quarter, deal rooms, and founder reference checks.', tier: 'professional', cta: 'Start trial', highlight: true, tag: 'Recommended' },
      { name: 'Institutional', desc: 'Run a fund: more introductions, unlimited deal rooms, co-investing, LP reporting, and seats for your team.', tier: 'institutional', cta: 'Start with Institutional' },
    ],
    planNote: 'Every account can start a 14-day Professional trial with no card.',
    tokens: AI_TOKENS,
    faq: [
      { q: 'Where do companies come from?', a: 'From the Axal workspace: founders building in the Spin-Out Lab or bringing an existing company, each with a venture-readiness record. Nothing arrives as cold inbound.' },
      { q: 'I am an LP, not a GP. Do I belong here?', a: 'Yes. LPs can see portfolio reporting today. A dedicated LP data room and capital-account portal is coming soon.' },
      { q: 'Can I try before paying?', a: 'Yes. Every account can start a 14-day Professional trial with no card. The Free plan stays free.' },
      { q: 'What are tokens?', a: 'Tokens pay for AI use, apart from your plan. Every plan includes an AI allowance each day and each month; if you use it up, you add tokens, and each dollar you add is a dollar of AI use. Tokens you buy never expire.' },
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
