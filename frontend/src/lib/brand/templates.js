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
 * @typedef {'minimal'|'bold-hero'|'video-first'|'editorial'|'product-mock'|'advisor-connect'|'proof-builder'|'capital-ready-kit'} VisualTemplate
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
export const VISUAL_TEMPLATE_KEYS = ['minimal', 'bold-hero', 'video-first', 'editorial', 'product-mock', 'advisor-connect', 'proof-builder', 'capital-ready-kit'];

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
};

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
    visualTemplate: 'editorial',
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
    visualTemplate: 'bold-hero',
    notes: 'High-energy seed teaser to spark investor interest.',
  },
  {
    id: 'distribution-deck',
    label: 'Distribution Deck',
    audience: 'investor',
    assetType: 'deck',
    primaryGoal: 'request_intro',
    defaultCtaLabel: 'Request intro',
    defaultSlug: 'distribution-deck',
    visualTemplate: 'product-mock',
    notes: 'Go-to-market / distribution story for investor conversations.',
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
    visualTemplate: 'product-mock',
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
    visualTemplate: 'minimal',
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
    visualTemplate: 'bold-hero',
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
    visualTemplate: 'minimal',
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
    visualTemplate: 'editorial',
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
    visualTemplate: 'minimal',
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
    visualTemplate: 'bold-hero',
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
    visualTemplate: 'minimal',
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
    visualTemplate: 'editorial',
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
    audience: 'customer',
    assetType: 'landing',
    primaryGoal: 'join_waitlist',
    defaultCtaLabel: 'Join the waitlist',
    defaultSlug: 'builders-launchpad',
    visualTemplate: 'bold-hero',
    notes: 'Bold product launch teaser for early customers.',
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
