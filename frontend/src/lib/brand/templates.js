// Brand template catalog — Task #30.
//
// Maps every prebuilt communication-surface template the studio ships to an
// audience + goal so the Brand & Landing wizard can recommend the right one
// and pre-fill copy. Per the agreed approach (catalog + smart matching), a
// published page keeps using one of the built-in *visual* templates — so each
// catalog entry also names the `visualTemplate` it renders with. Some entries
// now map to recreated source designs (Task #24, batch 1): advisor-connect,
// proof-builder and capital-ready-kit each render with their own ported style.
//
// Pure data + pure helpers. No I/O, no network, no React.

/**
 * Audiences a template can target.
 * @typedef {'customer'|'investor'|'partner'|'advisor'|'mentor'|'cofounder'} Audience
 */

/**
 * The kind of asset a template represents.
 * @typedef {'landing'|'deck'|'memo'|'doc'|'email_plus_landing'} AssetType
 */

/**
 * Normalized primary goal of a template's call to action.
 * @typedef {'join_waitlist'|'request_intro'|'start_pilot'|'book_call'|'apply'|'offer_guidance'} Goal
 */

/**
 * One of the existing built-in landing visual styles the page renders with.
 * MUST mirror TEMPLATE_KEYS in
 * `cloudflare-worker/src/services/landingTemplates.ts`.
 * @typedef {'minimal'|'bold-hero'|'video-first'|'editorial'|'product-mock'|'advisor-connect'|'proof-builder'|'capital-ready-kit'|'capital-storyteller'|'seed-stage-spark'|'distribution-deck'|'pilot-partner-page'|'partner-hub'|'partner-pipeline-pro'|'co-founder-builder'|'co-founder-canvas'|'cofounder-connect'|'co-founder-quest'|'mentor-connect'|'mentor-connect-page'|'builders-launchpad'} VisualTemplate
 */

/**
 * @typedef {Object} TemplateConfig
 * @property {string} id            machine id, kebab-case, e.g. "capital-ready-kit"
 * @property {string} label         human label, e.g. "Capital Ready Kit"
 * @property {Audience} audience    who this template is primarily for
 * @property {AssetType} assetType  landing vs deck vs memo vs doc etc.
 * @property {Goal} primaryGoal     normalized goal, e.g. "request_intro"
 * @property {string} defaultCtaLabel  e.g. "Request intro"
 * @property {string} defaultSlug   url-friendly default, e.g. "capital-ready"
 * @property {VisualTemplate} visualTemplate  existing visual style used to render
 * @property {boolean} [recommended]  show as a recommended pick for the audience
 * @property {string} [notes]       free-form usage notes
 */

/** All six audiences, in display order. @type {Audience[]} */
export const AUDIENCES = ['customer', 'investor', 'partner', 'advisor', 'mentor', 'cofounder'];

/** Valid asset types. @type {AssetType[]} */
export const ASSET_TYPES = ['landing', 'deck', 'memo', 'doc', 'email_plus_landing'];

/** Valid normalized goals. @type {Goal[]} */
export const GOALS = ['join_waitlist', 'request_intro', 'start_pilot', 'book_call', 'apply', 'offer_guidance'];

/**
 * Existing built-in visual styles. Mirror of the Worker's TEMPLATE_KEYS — kept
 * here so the catalog + its tests stay self-contained on the frontend.
 * @type {VisualTemplate[]}
 */
export const VISUAL_TEMPLATE_KEYS = ['minimal', 'bold-hero', 'video-first', 'editorial', 'product-mock', 'advisor-connect', 'proof-builder', 'capital-ready-kit', 'capital-storyteller', 'seed-stage-spark', 'distribution-deck', 'pilot-partner-page', 'partner-hub', 'partner-pipeline-pro', 'co-founder-builder', 'co-founder-canvas', 'cofounder-connect', 'co-founder-quest', 'mentor-connect', 'mentor-connect-page', 'builders-launchpad'];

/**
 * Signature palettes for the recreated designs (Task #24). Selecting one of
 * these templates seeds these into the editable palette fields so the design is
 * on-brand by default while still letting the palette flow through. MIRROR of
 * TEMPLATE_SIGNATURE_PALETTES in
 * `cloudflare-worker/src/services/landingTemplates.ts` — keep in lockstep.
 * @type {Record<string, {theme_color:string,palette_bg:string,palette_ink:string,palette_secondary:string,palette_accent:string}>}
 */
export const VISUAL_TEMPLATE_PALETTES = {
  'advisor-connect': { theme_color: '#b06a32', palette_bg: '#f6f1e7', palette_ink: '#33302a', palette_secondary: '#ddd3c0', palette_accent: '#b06a32' },
  'proof-builder': { theme_color: '#1f7a52', palette_bg: '#fbfbf9', palette_ink: '#1f2630', palette_secondary: '#e2e5e1', palette_accent: '#1f7a52' },
  'capital-ready-kit': { theme_color: '#c7e83f', palette_bg: '#1b1a16', palette_ink: '#f4f1e6', palette_secondary: '#3a382f', palette_accent: '#c7e83f' },
  'capital-storyteller': { theme_color: '#f2a618', palette_bg: '#07090b', palette_ink: '#f2f6f8', palette_secondary: '#26292c', palette_accent: '#f2a618' },
  'seed-stage-spark': { theme_color: '#abf051', palette_bg: '#0b0e0f', palette_ink: '#f2f6f8', palette_secondary: '#25292c', palette_accent: '#abf051' },
  'distribution-deck': { theme_color: '#0072d5', palette_bg: '#f9f8f5', palette_ink: '#0e1218', palette_secondary: '#e9e8e2', palette_accent: '#0072d5' },
  'pilot-partner-page': { theme_color: '#25984d', palette_bg: '#f6f5f1', palette_ink: '#1b150f', palette_secondary: '#e7e4dd', palette_accent: '#25984d' },
  'partner-hub': { theme_color: '#429595', palette_bg: '#fbfaf6', palette_ink: '#121c23', palette_secondary: '#dad7cf', palette_accent: '#429595' },
  'partner-pipeline-pro': { theme_color: '#ef852e', palette_bg: '#fbfaf8', palette_ink: '#15110d', palette_secondary: '#dbd7d0', palette_accent: '#ef852e' },
  'co-founder-builder': { theme_color: '#5bbe62', palette_bg: '#fbfaf6', palette_ink: '#14171d', palette_secondary: '#dfded8', palette_accent: '#5bbe62' },
  'co-founder-canvas': { theme_color: '#cc572a', palette_bg: '#f8f5ee', palette_ink: '#1d140d', palette_secondary: '#ede7dd', palette_accent: '#cc572a' },
  'cofounder-connect': { theme_color: '#bf4500', palette_bg: '#fbfaf7', palette_ink: '#15110d', palette_secondary: '#cac3ba', palette_accent: '#bf4500' },
  'co-founder-quest': { theme_color: '#ad524d', palette_bg: '#f9f8f6', palette_ink: '#0d1016', palette_secondary: '#d4d7de', palette_accent: '#ad524d' },
  'mentor-connect': { theme_color: '#c56a3e', palette_bg: '#fbfaf8', palette_ink: '#16100c', palette_secondary: '#e2ddd7', palette_accent: '#c56a3e' },
  'mentor-connect-page': { theme_color: '#b05139', palette_bg: '#fcfaf6', palette_ink: '#221811', palette_secondary: '#e2ddd5', palette_accent: '#b05139' },
  'builders-launchpad': { theme_color: '#dcb400', palette_bg: '#090e11', palette_ink: '#e8ecee', palette_secondary: '#2c343a', palette_accent: '#dcb400' },
};

/**
 * Shared hero fields — stored in existing landing_pages columns (NOT content_json).
 * Listed for the step-3 editor + AI auto-fill. MIRROR of SHARED_LANDING_FIELDS in
 * `cloudflare-worker/src/services/landingTemplates.ts` — guarded by
 * landing_content_schema.test.ts.
 */
export const SHARED_CONTENT_FIELDS = [
  { key: 'name', label: 'Brand name', kind: 'text', default: '' },
  { key: 'headline', label: 'Headline', kind: 'text', default: '' },
  { key: 'subheadline', label: 'Subheadline', kind: 'textarea', default: '' },
  { key: 'cta_text', label: 'Button text', kind: 'text', default: '' },
];

/**
 * Per-template editable content blocks. Switching templates changes which fields
 * the step-3 editor shows. MIRROR of LANDING_CONTENT_SCHEMA in
 * `cloudflare-worker/src/services/landingTemplates.ts` — guarded by
 * landing_content_schema.test.ts. Defaults are RAW text; the worker escapes them.
 */
export const TEMPLATE_CONTENT_SCHEMA = {
  'minimal': [],
  'bold-hero': [],
  'video-first': [],
  'editorial': [],
  'product-mock': [],
  'advisor-connect': [
    {
      key: 'help_areas', label: 'Where you can help', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'title', label: 'Area', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'text' },
      ],
      default: [
        { title: 'Go-to-market', body: 'Positioning, first customers, pricing.' },
        { title: 'Product', body: 'Scope, sequencing, what to say no to.' },
        { title: 'Hiring', body: 'Early team, founding engineers, networks.' },
        { title: 'Fundraising', body: 'Story, metrics, and warm introductions.' },
      ],
    },
    {
      key: 'arrangement', label: 'The arrangement', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { label: 'Commitment', value: '~2 hrs / month' },
        { label: 'Format', value: 'Calls + async' },
        { label: 'Term', value: '12 months, renewable' },
        { label: 'Recognition', value: 'Advisory equity' },
        { label: 'Start', value: 'A 30-min intro' },
      ],
    },
    {
      key: 'signals', label: 'Early signal', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'value', label: 'Stat', kind: 'text' },
        { key: 'label', label: 'Caption', kind: 'text' },
      ],
      default: [
        { value: 'Live', label: 'Product in market' },
        { value: 'Weekly', label: 'Active conversations' },
        { value: 'Growing', label: 'Waitlist & pipeline' },
      ],
    },
    {
      key: 'quote', label: 'Closing quote', kind: 'textarea',
      default: `The best advisors don't just open doors — they help you see around the next corner.`,
    },
  ],
  'proof-builder': [
    {
      key: 'steps', label: 'How it works', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'title', label: 'Step', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'text' },
      ],
      default: [
        { title: 'Show the problem', body: `We name the pain precisely — the way the people living it would.` },
        { title: 'Show the change', body: `What's different, demonstrated rather than asserted.` },
        { title: 'Show the receipts', body: 'Quotes, usage, and outcomes you can trace back to a source.' },
      ],
    },
    {
      key: 'transformation', label: 'Before & after', kind: 'groupList', max: 2,
      itemFields: [
        { key: 'title', label: 'Heading', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'textarea' },
      ],
      default: [
        { title: 'Today', body: `The work is manual, scattered, and hard to trust. People route around the tools instead of through them — and the evidence lives in someone's head.` },
        { title: 'With it', body: `One clear flow, less busywork, and a trail of proof at every step — so the next person doesn't have to take your word for it.` },
      ],
    },
    {
      key: 'metrics', label: 'Signal metrics', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'value', label: 'Stat', kind: 'text' },
        { key: 'label', label: 'Caption', kind: 'text' },
      ],
      default: [
        { value: 'Live', label: 'In real customer hands' },
        { value: 'Weekly', label: 'New signal coming in' },
        { value: 'Traceable', label: 'Every claim has a source' },
      ],
    },
    {
      key: 'testimonials', label: 'In their words', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'quote', label: 'Quote', kind: 'textarea' },
        { key: 'who', label: 'Attribution', kind: 'text' },
      ],
      default: [
        { quote: `"It did in an afternoon what used to take us a week — and we could show our team exactly why."`, who: 'Early customer · operations' },
        { quote: `"The difference is you can actually check the claims. That's rare, and it's why we stayed."`, who: 'Design partner · founder' },
      ],
    },
  ],
  'capital-ready-kit': [
    {
      key: 'raise_summary', label: 'Raise summary', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'label', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { label: 'Raising', value: 'Seed' },
        { label: 'Stage', value: 'Early' },
        { label: 'Use', value: '18 mo' },
        { label: 'Status', value: 'Open' },
      ],
    },
    {
      key: 'why_now', label: 'Why now', kind: 'groupList', max: 3,
      itemFields: [
        { key: 'title', label: 'Heading', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'text' },
      ],
      default: [
        { title: 'The market shifted', body: 'Behaviour and technology just changed in a way that makes this buildable today.' },
        { title: 'The wedge is clear', body: 'We start where the pain is sharpest and own that workflow end to end.' },
        { title: 'Early but real', body: 'Live product, real users, and a roadmap the capital directly accelerates.' },
      ],
    },
    {
      key: 'traction', label: 'Traction', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'value', label: 'Stat', kind: 'text' },
        { key: 'label', label: 'Caption', kind: 'text' },
      ],
      default: [
        { value: 'Live', label: 'In market' },
        { value: 'Weekly', label: 'Active use' },
        { value: 'Growing', label: 'Pipeline' },
        { value: 'Lean', label: 'Burn' },
      ],
    },
    {
      key: 'round_details', label: 'Round details', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { label: 'Stage', value: 'Seed' },
        { label: 'Instrument', value: 'SAFE' },
        { label: 'Runway', value: '~18 months' },
        { label: 'Lead', value: 'Open to a lead' },
        { label: 'Close', value: 'Rolling' },
      ],
    },
    {
      key: 'use_of_funds', label: 'Use of funds', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'Line', kind: 'text' },
        { key: 'pct', label: 'Percent', kind: 'text' },
      ],
      default: [
        { label: 'Product & engineering', pct: '45' },
        { label: 'Go-to-market', pct: '30' },
        { label: 'Operations', pct: '15' },
        { label: 'Reserve', pct: '10' },
      ],
    },
    {
      key: 'team', label: 'Team', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'name', label: 'Name / role', kind: 'text' },
        { key: 'role', label: 'Detail', kind: 'text' },
      ],
      default: [
        { name: 'Founder', role: 'Sets the vision and owns the product.' },
        { name: 'Co-founder', role: 'Leads build and the technical roadmap.' },
        { name: 'Early team', role: 'Operators close to the customer.' },
      ],
    },
  ],
  'capital-storyteller': [
    {
      key: 'raise_summary', label: 'Raise summary', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'label', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { label: 'Raising', value: 'Seed' },
        { label: 'Stage', value: 'Early' },
        { label: 'Runway', value: '18 mo' },
        { label: 'Status', value: 'Open' },
      ],
    },
    {
      key: 'thesis', label: 'Thesis', kind: 'textarea',
      default: `The gap between intent and outcome is still paved with manual work. We close it — and the market is finally ready to pay for that.`,
    },
    {
      key: 'market', label: 'Why now', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'value', label: 'Headline', kind: 'text' },
        { key: 'label', label: 'Detail', kind: 'text' },
      ],
      default: [
        { value: 'Large', label: 'Addressable market expanding as the workflow goes digital.' },
        { value: 'Shifting', label: 'Buyer behaviour just changed in our favour.' },
        { value: 'Underserved', label: 'Incumbents are slow and built for a prior era.' },
        { value: 'Timed', label: 'The wedge is clear and defensible from day one.' },
      ],
    },
    {
      key: 'traction', label: 'Traction', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'value', label: 'Headline', kind: 'text' },
        { key: 'label', label: 'Detail', kind: 'text' },
      ],
      default: [
        { value: 'Live', label: 'In market with real, recurring usage.' },
        { value: 'Growing', label: 'Pipeline compounding week over week.' },
      ],
    },
    {
      key: 'round_details', label: 'Round details', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { label: 'Stage', value: 'Seed' },
        { label: 'Instrument', value: 'SAFE' },
        { label: 'Runway', value: '~18 months' },
        { label: 'Close', value: 'Rolling' },
      ],
    },
    {
      key: 'use_of_funds', label: 'Use of funds', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'Line', kind: 'text' },
        { key: 'pct', label: 'Percent', kind: 'text' },
      ],
      default: [
        { label: 'Product & engineering', pct: '45' },
        { label: 'Go-to-market', pct: '30' },
        { label: 'Operations', pct: '15' },
        { label: 'Reserve', pct: '10' },
      ],
    },
  ],
  'seed-stage-spark': [
    {
      key: 'metrics', label: 'Hero metrics', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'value', label: 'Stat', kind: 'text' },
        { key: 'label', label: 'Caption', kind: 'text' },
      ],
      default: [
        { value: 'Live', label: 'In market' },
        { value: 'Weekly', label: 'Active use' },
        { value: 'Growing', label: 'Pipeline' },
        { value: 'Lean', label: 'Burn' },
      ],
    },
    {
      key: 'pillars', label: 'Product pillars', kind: 'groupList', max: 3,
      itemFields: [
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'text' },
      ],
      default: [
        { title: 'One sharp wedge', body: 'We own the moment of highest pain and expand from there.' },
        { title: 'Built to compound', body: 'Every user makes the product more useful for the next.' },
        { title: 'Defensible by design', body: 'Data and workflow lock-in deepen with usage.' },
      ],
    },
    {
      key: 'traction_bars', label: 'Traction bars', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'Label', kind: 'text' },
        { key: 'pct', label: 'Height %', kind: 'text' },
      ],
      default: [
        { label: 'Q1', pct: '34' },
        { label: 'Q2', pct: '52' },
        { label: 'Q3', pct: '71' },
        { label: 'Q4', pct: '100' },
      ],
    },
  ],
  'distribution-deck': [
    {
      key: 'side_facts', label: 'At a glance', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { label: 'Partner type', value: 'Platform' },
        { label: 'Addressable overlap', value: 'High' },
        { label: 'Revenue model', value: 'Rev-share' },
        { label: 'Time to value', value: 'Weeks' },
      ],
    },
    {
      key: 'overlap', label: 'Customer overlap', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'segment', label: 'Segment', kind: 'text' },
        { key: 'base', label: 'Shared base', kind: 'text' },
        { key: 'pct', label: 'Overlap %', kind: 'text' },
      ],
      default: [
        { segment: 'Enterprise', base: 'Strong', pct: '72' },
        { segment: 'Mid-market', base: 'Core', pct: '58' },
        { segment: 'SMB', base: 'Emerging', pct: '34' },
      ],
    },
    {
      key: 'channel_value', label: 'Channel economics', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'value', label: 'Headline', kind: 'text' },
        { key: 'label', label: 'Detail', kind: 'text' },
      ],
      default: [
        { value: '+ARPU', label: 'Lift per shared account' },
        { value: 'Lower', label: 'Blended CAC' },
        { value: 'Higher', label: 'Retention together' },
        { value: 'Faster', label: 'Time to revenue' },
      ],
    },
    {
      key: 'rollout', label: 'Integration options', kind: 'groupList', max: 3,
      itemFields: [
        { key: 'title', label: 'Option', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'text' },
        { key: 'lift', label: 'Eng lift', kind: 'text' },
        { key: 'time', label: 'Timeline', kind: 'text' },
      ],
      default: [
        { title: 'Referral handoff', body: 'Lightest lift — a clean handoff between teams.', lift: 'Eng lift: low', time: '2–4 wks' },
        { title: 'Embedded surface', body: 'The default — it lives inside your product.', lift: 'Eng lift: med', time: '6–8 wks' },
        { title: 'Native rebuild', body: 'Deepest — fully co-built and co-branded.', lift: 'Eng lift: high', time: '12+ wks' },
      ],
    },
  ],
  'pilot-partner-page': [
    {
      key: 'glance', label: 'At a glance', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { label: 'Commitment', value: '~2 hrs / week' },
        { label: 'Length', value: '6 weeks' },
        { label: 'Cost', value: 'No fee' },
        { label: 'Output', value: 'Joint findings memo' },
      ],
    },
    {
      key: 'who', label: "Who it's for", kind: 'groupList', max: 3,
      itemFields: [
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'text' },
      ],
      default: [
        { title: 'Has the pain', body: 'Lives the problem we solve, today.' },
        { title: 'Can decide', body: 'One owner who can say yes within the team.' },
        { title: 'Will engage', body: 'Shows up weekly and tells us the truth.' },
      ],
    },
    {
      key: 'includes', label: 'What it includes', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'text' },
      ],
      default: [
        { title: 'Hands-on setup', body: 'We configure the product around your real workflow.' },
        { title: 'Weekly sessions', body: 'Direct line to the founders, every week.' },
        { title: 'Priority shaping', body: 'Your feedback steers what we build next.' },
        { title: 'Closing memo', body: 'A written read-out you can act on.' },
      ],
    },
    {
      key: 'steps', label: 'Process', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'When', kind: 'text' },
        { key: 'value', label: 'Step', kind: 'text' },
      ],
      default: [
        { label: 'Day 0', value: 'Fit call' },
        { label: 'Wk 1', value: 'Setup' },
        { label: 'Wk 2–5', value: 'Run & learn' },
        { label: 'Wk 6', value: 'Memo & next steps' },
      ],
    },
  ],
  'partner-hub': [
    {
      key: 'stats', label: 'Hero stats', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'value', label: 'Stat', kind: 'text' },
        { key: 'label', label: 'Caption', kind: 'text' },
      ],
      default: [
        { value: 'Pilot', label: '90-day model' },
        { value: 'Named', label: 'Owners both sides' },
        { value: 'Shared', label: 'Success criteria' },
        { value: 'On date', label: 'We ship' },
      ],
    },
    {
      key: 'why', label: 'Why partner', kind: 'groupList', max: 3,
      itemFields: [
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'text' },
      ],
      default: [
        { title: 'Shared accountability', body: 'Named owners on both sides, and a plan we both sign.' },
        { title: 'Productized surfaces', body: 'Real integration points, not a one-off favour.' },
        { title: 'We ship on date', body: 'A 90-day pilot with criteria agreed up front.' },
      ],
    },
    {
      key: 'shared_fit', label: 'Shared fit', kind: 'textarea',
      default: `We start where our ideal customers already overlap — so the pilot proves value fast and the economics are obvious to both teams.`,
    },
    {
      key: 'models', label: 'Ways to work together', kind: 'groupList', max: 3,
      itemFields: [
        { key: 'tag', label: 'Tag', kind: 'text' },
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'li1', label: 'Point 1', kind: 'text' },
        { key: 'li2', label: 'Point 2', kind: 'text' },
        { key: 'li3', label: 'Point 3', kind: 'text' },
      ],
      default: [
        { tag: 'Commercial', title: 'Co-sell', li1: 'Joint pipeline', li2: 'Shared targets', li3: 'Rev-share' },
        { tag: 'Technical', title: 'Integrate', li1: 'Embedded surface', li2: 'Shared data model', li3: 'Co-built roadmap' },
        { tag: 'Distribution', title: 'Channel', li1: 'Bundled offer', li2: 'Referral motion', li3: 'Co-marketing' },
      ],
    },
    {
      key: 'quote', label: 'Quote', kind: 'textarea',
      default: `The pilot paid for itself before it ended — and our customers noticed.`,
    },
    {
      key: 'quote_by', label: 'Quote attribution', kind: 'text',
      default: `Head of Partnerships`,
    },
  ],
  'partner-pipeline-pro': [
    {
      key: 'glance', label: 'At a glance', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { label: 'Partner type', value: 'Platform' },
        { label: 'Addressable overlap', value: 'High' },
        { label: 'ARPU lift', value: 'Net new' },
        { label: 'Revenue timing', value: 'Quarter one' },
      ],
    },
    {
      key: 'overlap_nums', label: 'Customer overlap', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'value', label: 'Stat', kind: 'text' },
        { key: 'label', label: 'Caption', kind: 'text' },
      ],
      default: [
        { value: '61%', label: 'Shared ICP' },
        { value: 'High', label: 'Geographic fit' },
        { value: 'Strong', label: 'Income match' },
        { value: 'Aligned', label: 'Buying preference' },
      ],
    },
    {
      key: 'levers', label: 'Channel value', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'lever', label: 'Lever', kind: 'text' },
        { key: 'baseline', label: 'Baseline', kind: 'text' },
        { key: 'with', label: 'With us', kind: 'text' },
        { key: 'delta', label: 'Delta', kind: 'text' },
      ],
      default: [
        { lever: 'ARPU', baseline: 'Flat', with: 'Higher', delta: '+lift' },
        { lever: 'Retention', baseline: 'Standard', with: 'Stickier', delta: '+pts' },
        { lever: 'CAC', baseline: 'Full', with: 'Shared', delta: '−cost' },
      ],
    },
    {
      key: 'options', label: 'Integration options', kind: 'groupList', max: 3,
      itemFields: [
        { key: 'pin', label: 'Pin', kind: 'text' },
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'text' },
      ],
      default: [
        { pin: 'Lightest', title: 'Referral', body: 'Clean handoff, minimal lift.' },
        { pin: 'Default', title: 'Embedded', body: 'It lives inside your product surface.' },
        { pin: 'Deepest', title: 'Native', body: 'Fully co-built and co-branded.' },
      ],
    },
    {
      key: 'timeline', label: 'Timeline', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'When', kind: 'text' },
        { key: 'value', label: 'Step', kind: 'text' },
      ],
      default: [
        { label: 'Wk 0', value: 'Scoping' },
        { label: 'Wk 4', value: 'Build' },
        { label: 'Wk 8', value: 'Pilot' },
        { label: 'Wk 14', value: 'Scale' },
      ],
    },
    {
      key: 'quote', label: 'Quote', kind: 'textarea',
      default: `We saw the overlap immediately. The model held up under our own assumptions.`,
    },
    {
      key: 'quote_by', label: 'Quote attribution', kind: 'text',
      default: `VP, Strategic Partnerships`,
    },
  ],
  'co-founder-builder': [
    {
      key: 'data', label: 'Hero data', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'key', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { key: 'Stage', value: 'Pre-seed' },
        { key: 'Users', value: 'Early' },
        { key: 'Working', value: 'Core' },
        { key: 'Equity', value: 'Founding' },
      ],
    },
    {
      key: 'vision', label: 'Vision', kind: 'textarea',
      default: `Teams are shipping faster than they can reason about what they ship. We're the layer that gives them confidence — and it's a problem worth a decade.`,
    },
    {
      key: 'shipped', label: 'Shipped', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Item', kind: 'textarea' },
      ],
      default: [
        { body: 'Core engine running in production.' },
        { body: 'First users on real workflows.' },
        { body: 'The hard primitive works.' },
      ],
    },
    {
      key: 'weak', label: 'Weak points', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Item', kind: 'textarea' },
      ],
      default: [
        { body: 'Billing is duct tape.' },
        { body: 'No real test coverage yet.' },
        { body: 'Ops is one person deep.' },
      ],
    },
    {
      key: 'roadmap', label: 'First 90 days', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Step', kind: 'textarea' },
      ],
      default: [
        { body: 'Own the runtime end to end and harden it.' },
        { body: 'Stand up the durable replay and event-sourcing layer.' },
        { body: 'Turn the prototype billing into something real.' },
      ],
    },
    {
      key: 'equity', label: 'The offer', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Term', kind: 'textarea' },
      ],
      default: [
        { body: 'Founding equity — single to low-double-digit %.' },
        { body: 'Standard vesting, 1-year cliff.' },
        { body: 'Market-aware salary once we raise.' },
        { body: 'Real ownership of the technical direction.' },
      ],
    },
  ],
  'co-founder-canvas': [
    {
      key: 'facts', label: 'Hero facts', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'key', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { key: 'Stage', value: 'Early' },
        { key: 'Team', value: 'Small' },
        { key: 'Runway', value: 'Funded' },
        { key: 'Equity', value: 'Co-founder' },
      ],
    },
    {
      key: 'building', label: 'What we are building', kind: 'textarea',
      default: `We're the execution layer for work that's currently held together by people copying things between tools. We're turning that into something dependable.`,
    },
    {
      key: 'whynow', label: 'Why now', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'textarea' },
      ],
      default: [
        { title: 'The tools arrived', body: 'What needed a team last year is buildable by two people now.' },
        { title: 'The buyers shifted', body: 'People will finally pay to remove this work.' },
        { title: 'The window is short', body: 'Whoever owns the workflow first, owns it.' },
      ],
    },
    {
      key: 'built', label: 'Already built', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'textarea' },
      ],
      default: [
        { title: 'The core, working', body: 'The hard part runs in production today.' },
        { title: 'First believers', body: "Real users who'd be upset if it disappeared." },
        { title: 'A clear next mile', body: 'We know exactly what comes next.' },
      ],
    },
    {
      key: 'gap', label: "What's missing", kind: 'groupList', max: 2,
      itemFields: [
        { key: 'body', label: 'Paragraph', kind: 'textarea' },
      ],
      default: [
        { body: "I can hold the vision and talk to customers all day. What I can't do is be the depth on the build — the architecture, the rigor, the parts that have to be right." },
        { body: "That's the seat. Not a hire reporting to me — a partner who owns the half of this company I can't." },
      ],
    },
    {
      key: 'role_have', label: 'You have probably', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Item', kind: 'text' },
      ],
      default: [
        { body: 'Built and shipped real systems' },
        { body: 'Owned something end to end' },
        { body: 'Been the person others trust to be right' },
      ],
    },
    {
      key: 'role_not', label: 'You probably do not', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Item', kind: 'text' },
      ],
      default: [
        { body: 'Need a detailed spec to start' },
        { body: 'Want to be managed' },
        { body: 'Care about titles over ownership' },
      ],
    },
    {
      key: 'offer', label: 'Offer', kind: 'groupList', max: 3,
      itemFields: [
        { key: 'key', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { key: 'Equity', value: 'Co-founder' },
        { key: 'Salary', value: 'On raise' },
        { key: 'Location', value: 'Flexible' },
      ],
    },
    {
      key: 'steps', label: 'Next steps', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Step', kind: 'text' },
      ],
      default: [
        { body: 'You email me and we trade notes.' },
        { body: 'We spend a day building something small.' },
        { body: 'If it clicks, we go.' },
      ],
    },
  ],
  'cofounder-connect': [
    {
      key: 'stats', label: 'Hero stats', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'key', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { key: 'Stage', value: 'Early' },
        { key: 'Team', value: 'Small' },
        { key: 'Runway', value: 'Funded' },
        { key: 'Equity', value: 'Co-founder' },
      ],
    },
    {
      key: 'mission', label: 'Mission', kind: 'textarea',
      default: `We're the accountability layer for autonomous work — so teams can trust what their software does on their behalf.`,
    },
    {
      key: 'whynow', label: 'Why now', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'textarea' },
      ],
      default: [
        { title: 'Capability jumped', body: 'What was research last year is shippable today.' },
        { title: 'Trust is missing', body: "Everyone's adopting; nobody can verify." },
        { title: 'First mover wins', body: "The standard isn't set yet. It could be ours." },
      ],
    },
    {
      key: 'built', label: 'What is built', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'desc', label: 'Detail', kind: 'textarea' },
        { key: 'pill', label: 'Status label', kind: 'text' },
        { key: 'on', label: 'Highlight (yes/no)', kind: 'text' },
      ],
      default: [
        { name: 'Core engine', desc: 'The hard primitive, running in production.', pill: 'Working', on: 'yes' },
        { name: 'First users', desc: 'Real teams on real workflows.', pill: 'Live', on: 'yes' },
        { name: 'Billing', desc: 'Functional, but held together with tape.', pill: 'Rough', on: 'no' },
        { name: 'Test suite', desc: 'Not yet — this is part of the job.', pill: 'Open', on: 'no' },
      ],
    },
    {
      key: 'missing', label: "What's missing", kind: 'groupList', max: 6,
      itemFields: [
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'textarea' },
      ],
      default: [
        { title: 'Depth on the build', body: "The architecture and rigor I can't give it alone." },
        { title: 'A true partner', body: 'Someone who owns half of this, not reports to me.' },
      ],
    },
    {
      key: 'role_terms', label: 'The role', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'key', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { key: 'Equity', value: 'Co-founder' },
        { key: 'Salary', value: 'On raise' },
        { key: 'Location', value: 'Flexible' },
      ],
    },
    {
      key: 'cols3', label: 'Role columns', kind: 'groupList', max: 3,
      itemFields: [
        { key: 'heading', label: 'Heading', kind: 'text' },
        { key: 'li1', label: 'Point 1', kind: 'text' },
        { key: 'li2', label: 'Point 2', kind: 'text' },
        { key: 'li3', label: 'Point 3', kind: 'text' },
      ],
      default: [
        { heading: 'First 90 days', li1: 'Own the runtime', li2: 'Harden the core', li3: 'Ship to users' },
        { heading: 'You look like', li1: 'A builder', li2: 'An owner', li3: 'Direct' },
        { heading: 'Not looking for', li1: 'A spec-follower', li2: 'A title-chaser', li3: 'A spectator' },
      ],
    },
    {
      key: 'steps', label: 'Next steps', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Step', kind: 'text' },
      ],
      default: [
        { body: 'You send a note — anything, even a paragraph.' },
        { body: 'We trade context and spend a day building.' },
        { body: 'If it clicks, we make it official.' },
      ],
    },
  ],
  'co-founder-quest': [
    {
      key: 'timing', label: 'Why now', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'body', label: 'Paragraph', kind: 'textarea' },
      ],
      default: [
        { body: 'The capability to build this only just arrived. The teams who plant a flag in this space this year will define how it works for everyone else.' },
        { body: "We'd rather be early and right than safe and late." },
      ],
    },
    {
      key: 'built', label: 'What we have built', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'Label', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'textarea' },
      ],
      default: [
        { label: 'Product', body: 'core engine live in production.' },
        { label: 'Traction', body: 'first users on real workflows.' },
        { label: 'Team', body: 'small, senior, and shipping.' },
        { label: 'Runway', body: 'funded to find product-market fit.' },
      ],
    },
    {
      key: 'mission_cards', label: 'What we need', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'textarea' },
      ],
      default: [
        { title: 'Own the runtime', body: 'Architecture, reliability, the parts that must be right.' },
        { title: 'Set the pace', body: 'Decide what ships and make it ship.' },
        { title: 'Raise the bar', body: 'Bring rigor the whole team levels up to.' },
      ],
    },
    {
      key: 'ideal', label: 'Ideal profile', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Item', kind: 'text' },
      ],
      default: [
        { body: 'Shipped real systems end to end' },
        { body: 'Comfortable with ambiguity' },
        { body: 'Argues well, decides fast' },
      ],
    },
    {
      key: 'first90', label: 'First 90 days', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Item', kind: 'text' },
      ],
      default: [
        { body: 'Own and harden the core' },
        { body: 'Ship to first users' },
        { body: 'Set the technical direction' },
      ],
    },
    {
      key: 'equity', label: 'Equity & collaboration', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'key', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { key: 'Role', value: 'Co-founder' },
        { key: 'Equity', value: 'Significant' },
        { key: 'Salary', value: 'Funded' },
        { key: 'How we work', value: 'Direct & fast' },
      ],
    },
    {
      key: 'team', label: 'The team so far', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'textarea' },
      ],
      default: [
        { name: 'The founder', body: "Owns vision, customers, and the company's story." },
        { name: 'Early team', body: 'Operators close to the problem, shipping weekly.' },
      ],
    },
    {
      key: 'steps', label: 'Next steps', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Step', kind: 'text' },
      ],
      default: [
        { body: 'Send a note — no résumé required.' },
        { body: 'We trade context over a call.' },
        { body: 'We build something small together.' },
      ],
    },
  ],
  'mentor-connect': [
    {
      key: 'building', label: "What we're building", kind: 'textarea',
      default: `We remove the busywork between a team's intent and the outcome they're after.`,
    },
    {
      key: 'oneline', label: 'One-line summary', kind: 'textarea',
      default: `One line: we make a painful manual workflow feel automatic.`,
    },
    {
      key: 'help', label: 'Where we need help', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'textarea' },
      ],
      default: [
        { title: 'Pricing & packaging', body: 'How to price without leaving value — or trust — on the table.' },
        { title: 'Positioning', body: 'Which wedge to lead with for the sharpest pull.' },
        { title: 'Go-to-market', body: 'The first repeatable motion that actually compounds.' },
      ],
    },
    {
      key: 'qual', label: 'Experience that matters', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Item', kind: 'textarea' },
      ],
      default: [
        { body: "You've built or scaled in this space." },
        { body: "You've made the calls we're facing now." },
        { body: "You're generous with hard-won lessons." },
      ],
    },
    {
      key: 'stats', label: 'Progress so far', kind: 'groupList', max: 3,
      itemFields: [
        { key: 'key', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { key: 'Product', value: 'Live' },
        { key: 'Users', value: 'Early' },
        { key: 'Stage', value: 'Pre-seed' },
      ],
    },
  ],
  'mentor-connect-page': [
    {
      key: 'building', label: "What we're building", kind: 'textarea',
      default: `We take a workflow that's currently stitched together by hand and make it dependable — so teams stop babysitting it.`,
    },
    {
      key: 'stuck', label: "Where we're stuck", kind: 'groupList', max: 6,
      itemFields: [
        { key: 'label', label: 'Label', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'textarea' },
      ],
      default: [
        { label: 'Pricing', body: 'what to charge without capping value.' },
        { label: 'Positioning', body: 'which wedge pulls hardest.' },
        { label: 'Playbook', body: 'the first motion that repeats.' },
      ],
    },
    {
      key: 'why', label: 'Why you', kind: 'textarea',
      default: `You've sat where we're sitting and made these calls for real. Even your hypothetical feedback would save us months — and we're not afraid to hear that we were wrong.`,
    },
    {
      key: 'ask_options', label: 'The ask — options', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'key', label: 'Marker', kind: 'text' },
        { key: 'body', label: 'Option', kind: 'textarea' },
      ],
      default: [
        { key: 'A', body: 'A 30-minute call, whenever suits.' },
        { key: 'B', body: 'A few lines by email — async is great.' },
        { key: 'C', body: 'An intro to someone better placed.' },
      ],
    },
    {
      key: 'timeline', label: 'How we got here', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'year', label: 'Year', kind: 'text' },
        { key: 'body', label: 'Milestone', kind: 'textarea' },
      ],
      default: [
        { year: '2024', body: 'The idea, and the first ugly prototype.' },
        { year: '2025', body: 'First users, and the hard parts working.' },
        { year: '2026', body: "Finding the motion that repeats — that's now." },
      ],
    },
  ],
  'builders-launchpad': [
    {
      key: 'facts', label: 'Hero facts', kind: 'groupList', max: 4,
      itemFields: [
        { key: 'key', label: 'Label', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'text' },
      ],
      default: [
        { key: 'Stage', value: 'Beta' },
        { key: 'Access', value: 'Invite' },
        { key: 'Status', value: 'Live' },
        { key: 'Next', value: 'v1' },
      ],
    },
    {
      key: 'vision', label: 'Product vision', kind: 'textarea',
      default: `We take the manual, error-prone parts of your day and make them automatic — so you ship instead of babysitting tools.`,
    },
    {
      key: 'state', label: 'Current state', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'badge', label: 'Badge', kind: 'text' },
        { key: 'tone', label: 'Tone (ok/warn/dn)', kind: 'text' },
        { key: 'body', label: 'Detail', kind: 'textarea' },
      ],
      default: [
        { badge: 'Working', tone: 'ok', body: 'Core flow is live and used daily.' },
        { badge: 'Half', tone: 'warn', body: 'Integrations — the big ones are in.' },
        { badge: 'Soon', tone: 'dn', body: 'Polish and onboarding still rough.' },
      ],
    },
    {
      key: 'road', label: 'What ships next', kind: 'groupList', max: 6,
      itemFields: [
        { key: 'body', label: 'Item', kind: 'textarea' },
      ],
      default: [
        { body: 'Smoother onboarding for new teams.' },
        { body: 'The two integrations you keep asking for.' },
        { body: 'v1, stable enough to depend on.' },
      ],
    },
  ],
};

/**
 * Editable fields for a template = shared hero fields + that template's content
 * blocks. Returns the combined list the step-3 editor renders.
 * @param {string} visualTemplate
 * @returns {{shared: any[], content: any[]}}
 */
export function getEditableFields(visualTemplate) {
  return {
    shared: SHARED_CONTENT_FIELDS,
    content: TEMPLATE_CONTENT_SCHEMA[visualTemplate] || [],
  };
}

/**
 * Human-friendly label per audience, for wizard headings ("Templates for…").
 * @type {Record<Audience, string>}
 */
export const AUDIENCE_LABELS = {
  customer: 'Customers',
  investor: 'Investors',
  partner: 'Partners',
  advisor: 'Advisors',
  mentor: 'Mentors',
  cofounder: 'Co-founders',
};

/**
 * The catalog. First-pass mapping for all 16 supplied templates.
 * @type {TemplateConfig[]}
 */
export const TEMPLATES = [
  // ── Investor ──────────────────────────────────────────────────────
  {
    id: 'capital-ready-kit',
    label: 'Capital Ready Kit',
    audience: 'investor',
    assetType: 'deck',
    primaryGoal: 'request_intro',
    defaultCtaLabel: 'Request intro',
    defaultSlug: 'capital-ready',
    visualTemplate: 'capital-ready-kit',
    recommended: true,
    notes: 'Fundraise one-pager / data room — raise, traction and round details for investors.',
  },
  {
    id: 'capital-storyteller',
    label: 'Capital Storyteller',
    audience: 'investor',
    assetType: 'memo',
    primaryGoal: 'request_intro',
    defaultCtaLabel: 'Request intro',
    defaultSlug: 'capital-story',
    visualTemplate: 'capital-storyteller',
    recommended: true,
    notes: 'Narrative investor memo — long-form story of why now and why you.',
  },
  {
    id: 'seed-stage-spark',
    label: 'Seed Stage Spark',
    audience: 'investor',
    assetType: 'landing',
    primaryGoal: 'request_intro',
    defaultCtaLabel: 'Request intro',
    defaultSlug: 'seed-spark',
    visualTemplate: 'seed-stage-spark',
    notes: 'High-energy seed teaser to spark investor interest.',
  },
  {
    id: 'distribution-deck',
    label: 'Distribution Deck',
    // Recategorized after auditing the ported source (brandtemplates/
    // "Distribution Deck"): the page is a partnership memo — customer-overlap
    // tables, channel-value economics, integration/rollout options, and a
    // "Discuss distribution fit" CTA aimed at a named BD counterpart. Nothing
    // in it addresses investors; the old bucket came from the filename read
    // ("deck"), not the content.
    audience: 'partner',
    assetType: 'deck',
    primaryGoal: 'request_intro',
    defaultCtaLabel: 'Request distribution review',
    defaultSlug: 'distribution-deck',
    visualTemplate: 'distribution-deck',
    notes: 'Blueprint partnership memo — overlap tables, channel value, rollout options.',
  },

  // ── Partner ───────────────────────────────────────────────────────
  {
    id: 'pilot-partner-page',
    label: 'Pilot Partner Page',
    audience: 'partner',
    assetType: 'landing',
    primaryGoal: 'start_pilot',
    defaultCtaLabel: 'Start a pilot',
    defaultSlug: 'pilot-partner',
    visualTemplate: 'pilot-partner-page',
    recommended: true,
    notes: 'Landing page to recruit pilot partners and design partners.',
  },
  {
    id: 'partner-hub',
    label: 'Partner Hub',
    audience: 'partner',
    assetType: 'landing',
    primaryGoal: 'book_call',
    defaultCtaLabel: 'Book a call',
    defaultSlug: 'partner-hub',
    visualTemplate: 'partner-hub',
    notes: 'Clean overview of the partnership program with a booking CTA.',
  },
  {
    id: 'partner-pipeline-pro',
    label: 'Partner Pipeline Pro',
    audience: 'partner',
    assetType: 'deck',
    primaryGoal: 'start_pilot',
    defaultCtaLabel: 'Start a pilot',
    defaultSlug: 'partner-pipeline',
    visualTemplate: 'partner-pipeline-pro',
    notes: 'Pitch the partnership pipeline and value exchange to prospective partners.',
  },

  // ── Co-founder ────────────────────────────────────────────────────
  {
    id: 'co-founder-builder',
    label: 'Co-Founder Builder',
    audience: 'cofounder',
    assetType: 'landing',
    primaryGoal: 'apply',
    defaultCtaLabel: 'Apply to join',
    defaultSlug: 'cofounder-builder',
    visualTemplate: 'co-founder-builder',
    recommended: true,
    notes: 'Recruit a technical/founding co-founder — what you are building and who you need.',
  },
  {
    id: 'co-founder-canvas',
    label: 'Co-Founder Canvas',
    audience: 'cofounder',
    assetType: 'memo',
    primaryGoal: 'apply',
    defaultCtaLabel: 'Apply to join',
    defaultSlug: 'cofounder-canvas',
    visualTemplate: 'co-founder-canvas',
    notes: 'Long-form canvas of the vision, roles and equity for a prospective co-founder.',
  },
  {
    id: 'cofounder-connect',
    label: 'Co-founder Connect',
    audience: 'cofounder',
    assetType: 'landing',
    primaryGoal: 'apply',
    defaultCtaLabel: "Let's talk",
    defaultSlug: 'cofounder-connect',
    visualTemplate: 'cofounder-connect',
    notes: 'Lightweight reach-out page for warm co-founder conversations.',
  },
  {
    id: 'co-founder-quest',
    label: 'Co-Founder Quest',
    audience: 'cofounder',
    assetType: 'landing',
    primaryGoal: 'apply',
    defaultCtaLabel: 'Apply to join',
    defaultSlug: 'cofounder-quest',
    visualTemplate: 'co-founder-quest',
    notes: 'High-energy call for a co-founder framed as a mission to join.',
  },

  // ── Advisor ───────────────────────────────────────────────────────
  {
    id: 'advisor-connect',
    label: 'Advisor Connect',
    audience: 'advisor',
    assetType: 'landing',
    primaryGoal: 'offer_guidance',
    defaultCtaLabel: 'Become an advisor',
    defaultSlug: 'advisor-connect',
    visualTemplate: 'advisor-connect',
    recommended: true,
    notes: 'Invite domain experts to advise — focus areas and time commitment.',
  },

  // ── Mentor ────────────────────────────────────────────────────────
  {
    id: 'mentor-connect',
    label: 'Mentor Connect',
    audience: 'mentor',
    assetType: 'landing',
    primaryGoal: 'offer_guidance',
    defaultCtaLabel: 'Become a mentor',
    defaultSlug: 'mentor-connect',
    visualTemplate: 'mentor-connect',
    recommended: true,
    notes: 'Recruit mentors for the studio / founders — clean directory-style page.',
  },
  {
    id: 'mentor-connect-page',
    label: 'Mentor Connect Page',
    audience: 'mentor',
    assetType: 'landing',
    primaryGoal: 'offer_guidance',
    defaultCtaLabel: 'Become a mentor',
    defaultSlug: 'mentor-connect-page',
    visualTemplate: 'mentor-connect-page',
    notes: 'Narrative variant of the mentor invite with more story.',
  },

  // ── Customer ──────────────────────────────────────────────────────
  {
    id: 'proof-builder',
    label: 'Proof Builder',
    audience: 'customer',
    assetType: 'landing',
    primaryGoal: 'join_waitlist',
    defaultCtaLabel: 'Join the waitlist',
    defaultSlug: 'proof-builder',
    visualTemplate: 'proof-builder',
    recommended: true,
    notes: 'Customer-discovery landing to validate demand and collect a waitlist.',
  },
  {
    id: 'builders-launchpad',
    label: "Builder's Launchpad",
    // Recategorized after auditing the ported source (brandtemplates/
    // "Builder's Launchpad"): despite the launch-y name, the page is a
    // technical co-founder recruiting brief end to end — "Hiring · Technical
    // co-founder" badge, what's-built/what's-missing honesty lists, 25–40%
    // equity terms, and a terminal-styled "Join as technical co-founder"
    // apply CTA. It was never a customer launch teaser.
    audience: 'cofounder',
    assetType: 'landing',
    primaryGoal: 'apply',
    defaultCtaLabel: 'Apply to join',
    defaultSlug: 'builders-launchpad',
    visualTemplate: 'builders-launchpad',
    notes: 'Dark terminal-styled co-founder brief — quick facts, build status, apply CTA.',
  },
];

/**
 * Look up a template by its machine id.
 * @param {string} id
 * @returns {TemplateConfig | undefined}
 */
export function getTemplateById(id) {
  return TEMPLATES.find((t) => t.id === id);
}

/**
 * All templates for an audience, recommended ones first then by label.
 * @param {Audience} audience
 * @returns {TemplateConfig[]}
 */
export function getTemplatesByAudience(audience) {
  return TEMPLATES
    .filter((t) => t.audience === audience)
    .sort((a, b) => {
      const r = Number(!!b.recommended) - Number(!!a.recommended);
      return r !== 0 ? r : a.label.localeCompare(b.label);
    });
}

/**
 * Read the audience / goal / CTA defaults a template implies.
 * @param {string} id
 * @returns {{ audience: Audience, primaryGoal: Goal, defaultCtaLabel: string } | undefined}
 */
export function inferDefaultsFromTemplate(id) {
  const t = getTemplateById(id);
  if (!t) return undefined;
  return { audience: t.audience, primaryGoal: t.primaryGoal, defaultCtaLabel: t.defaultCtaLabel };
}
