/**
 * Task #5 — Landing page template library.
 *
 * Five server-rendered layouts that share the same brand kit + audience copy.
 * All templates are pure functions that return a full HTML string; no client-side
 * JS is required for rendering.
 */

/**
 * Honeypot field name, shared by the form renderer below and the capture route
 * (routes/brand.ts) that rejects on it.
 *
 * Lives HERE, not in brand.ts, because brand.ts already imports this module —
 * defining it there and importing it back would be a cycle.
 *
 * Deliberately plausible: a bot's heuristic is "does this look like a field
 * worth filling", so `company_website` gets filled where a name like
 * `honeypot_do_not_fill` would be skipped. Exported so the renderer, the route
 * and the tests all use one string — a rename that hit only one side would
 * silently disable the trap, which is how this defence usually rots.
 */
export const HONEYPOT_FIELD = 'company_website';

export const TEMPLATE_KEYS = ['minimal', 'bold-hero', 'video-first', 'editorial', 'product-mock', 'advisor-connect', 'proof-builder', 'capital-ready-kit', 'capital-storyteller', 'seed-stage-spark', 'distribution-deck', 'pilot-partner-page', 'partner-hub', 'partner-pipeline-pro', 'co-founder-builder', 'co-founder-canvas', 'cofounder-connect', 'co-founder-quest', 'mentor-connect', 'mentor-connect-page', 'builders-launchpad'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface TemplateMeta {
  key: TemplateKey;
  label: string;
  description: string;
  thumbnailPlaceholder: string;
  usesHero: boolean;
  usesProduct: boolean;
}

export const TEMPLATE_REGISTRY: TemplateMeta[] = [
  {
    key: 'minimal',
    label: 'Minimal',
    description: 'Clean, centered layout with the essentials.',
    thumbnailPlaceholder: 'minimal',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'bold-hero',
    label: 'Bold Hero',
    description: 'A striking, high-contrast headline with full-width background.',
    thumbnailPlaceholder: 'bold-hero',
    usesHero: true,
    usesProduct: false,
  },
  {
    key: 'video-first',
    label: 'Video First',
    description: 'Hero media — video or image — dominates above the fold.',
    thumbnailPlaceholder: 'video-first',
    usesHero: true,
    usesProduct: false,
  },
  {
    key: 'editorial',
    label: 'Editorial',
    description: 'Long-form, narrative style with typographic hierarchy.',
    thumbnailPlaceholder: 'editorial',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'product-mock',
    label: 'Product Mock',
    description: 'Show your product front and centre with a screenshot.',
    thumbnailPlaceholder: 'product-mock',
    usesHero: false,
    usesProduct: true,
  },
  // Task #24 — ported uploaded landing designs (batch 1). Each is a distinct,
  // self-contained server-rendered layout driven by the primary brand fields
  // (name, headline, subheadline, CTA, logo, palette). Deeper narrative
  // sections render with on-brand default copy. No hero/product media needed.
  {
    key: 'advisor-connect',
    label: 'Advisor Connect',
    description: 'Warm editorial invite for domain experts — thesis, ask and terms.',
    thumbnailPlaceholder: 'advisor-connect',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'proof-builder',
    label: 'Proof Builder',
    description: 'Evidence-first customer page — claims you can verify, with receipts.',
    thumbnailPlaceholder: 'proof-builder',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'capital-ready-kit',
    label: 'Capital Ready Kit',
    description: 'Dark investor brief — raise, traction, round and use of funds.',
    thumbnailPlaceholder: 'capital-ready-kit',
    usesHero: false,
    usesProduct: false,
  },
  // Task #25 — ported uploaded landing designs (batches 2+). Each is a distinct,
  // self-contained server-rendered layout driven by the primary brand fields,
  // with on-brand default narrative copy. No hero/product media needed.
  {
    key: 'capital-storyteller',
    label: 'Capital Storyteller',
    description: 'Dark confidential investor brief — numbered memo with stat grids.',
    thumbnailPlaceholder: 'capital-storyteller',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'seed-stage-spark',
    label: 'Seed Stage Spark',
    description: 'High-energy dark seed teaser — grid backdrop, live metrics, pillars.',
    thumbnailPlaceholder: 'seed-stage-spark',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'distribution-deck',
    // Posts `partner`, not `investor`: the design is a partnership memo
    // (customer-overlap tables, channel economics, integration options,
    // "Discuss distribution fit"). It was mis-filed as an investor deck from
    // the name, which routed its signups to Capital instead of Marketplace.
    label: 'Distribution Deck',
    description: 'Blueprint partnership memo — overlap tables, channel value, rollout.',
    thumbnailPlaceholder: 'distribution-deck',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'pilot-partner-page',
    label: 'Pilot Partner Page',
    description: 'Swiss-grid pilot recruiter — at-a-glance stats, who/includes/process.',
    thumbnailPlaceholder: 'pilot-partner-page',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'partner-hub',
    label: 'Partner Hub',
    description: 'Calm BD landing — teal serif, shared-fit overlap, collaboration models.',
    thumbnailPlaceholder: 'partner-hub',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'partner-pipeline-pro',
    label: 'Partner Pipeline Pro',
    description: 'Financial-tech distribution pitch — overlap, channel economics, rollout.',
    thumbnailPlaceholder: 'partner-pipeline-pro',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'co-founder-builder',
    label: 'Co-Founder Builder',
    description: 'Engineering-doc co-founder brief — signal-green grid, shipped vs gaps.',
    thumbnailPlaceholder: 'co-founder-builder',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'co-founder-canvas',
    label: 'Co-Founder Canvas',
    description: 'Editorial founder letter — serif canvas, the-gap section, offer grid.',
    thumbnailPlaceholder: 'co-founder-canvas',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'cofounder-connect',
    label: 'Co-founder Connect',
    description: 'Warm founder letter — grain hero, built rows with status, role terms.',
    thumbnailPlaceholder: 'cofounder-connect',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'co-founder-quest',
    label: 'Co-Founder Quest',
    description: 'Mission-framed co-founder call — ideal-profile box, transparent equity.',
    thumbnailPlaceholder: 'co-founder-quest',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'mentor-connect',
    label: 'Mentor Connect',
    description: 'Minimal mentor note — single column, where-we-need-help, low-friction ask.',
    thumbnailPlaceholder: 'mentor-connect',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'mentor-connect-page',
    label: 'Mentor Connect Page',
    description: 'Narrative mentor letter — serif editorial with sidebar labels & timeline.',
    thumbnailPlaceholder: 'mentor-connect-page',
    usesHero: false,
    usesProduct: false,
  },
  {
    key: 'builders-launchpad',
    // Posts `cofounder`, not `customer`: despite the launch-y name the design
    // is a technical co-founder brief (hiring badge, shipped-vs-missing lists,
    // equity terms, "Join as technical co-founder"). Mis-filed as a customer
    // launch teaser, it routed applicants to Discovery instead of Co-founder
    // Match.
    label: "Builder's Launchpad",
    description: 'Dark terminal co-founder brief — quick facts, build status, apply CTA.',
    thumbnailPlaceholder: 'builders-launchpad',
    usesHero: false,
    usesProduct: false,
  },
];

export const TEMPLATE_MAP = new Map<string, TemplateMeta>(
  TEMPLATE_REGISTRY.map((t) => [t.key, t]),
);

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] as string));
}

function svgLogo(name: string, color = '#7c3aed'): string {
  const initial = (name || 'A').trim().slice(0, 1).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">`
    + `<circle cx="50" cy="50" r="46" fill="${color}"/>`
    + `<text x="50" y="62" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="44" font-weight="700" fill="#fff">${initial}</text>`
    + `</svg>`;
}

// Same monogram as svgLogo, but sized to fill its container (100% w/h) so it can
// be dropped into a fixed-size nav/footer logo chip without its intrinsic 200px
// leaking out. svgLogo is left untouched because the original hero layouts rely
// on its intrinsic size.
function svgLogoInline(name: string, color = '#7c3aed'): string {
  const initial = (name || 'A').trim().slice(0, 1).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="width:100%;height:100%;display:block">`
    + `<circle cx="50" cy="50" r="46" fill="${color}"/>`
    + `<text x="50" y="62" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="44" font-weight="700" fill="#fff">${initial}</text>`
    + `</svg>`;
}

// Self-contained brand-logo chip for nav/footer placement. Inline styles only:
// CSP allows style attributes and there is no shared stylesheet across the
// per-template documents. The fixed-size, overflow-hidden wrapper plus the
// 100%-sized inner logo (img / svgLogoInline) guarantees a configured logo_url
// renders at a sane size in ANY template without per-template CSS. A custom
// logo_svg of unknown size is clipped to the chip rather than blowing out the
// nav.
function logoChip(bk: BrandKit, size = 28, radius = 7): string {
  return `<span class="axl-logo" style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:${radius}px;overflow:hidden;flex:0 0 auto;vertical-align:middle">${bk.logoInline}</span>`;
}

function hex6(v: string | null | undefined, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(v || '') ? v! : fallback;
}

function validMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = String(url).trim();
  // Accept same-origin (starts with /) or https://
  if (u.startsWith('/')) return u;
  try {
    const parsed = new URL(u);
    if (parsed.protocol === 'https:') return u;
  } catch { /* invalid URL */ }
  return null;
}

interface BrandKit {
  color: string;
  bgColor: string;
  inkColor: string;
  secondary: string;
  accent: string;
  fontPairing: string;
  logoMarkup: string;
  logoInline: string;
  name: string;
  slug: string;
  apiWaitlist: string;
  noindex: boolean;
  nonce?: string;
  heroMediaUrl?: string | null;
  productScreenshotUrl?: string | null;
  /** Absolute canonical URL of this page, when the caller knows it. */
  canonical?: string | null;
  /** Absolute https image URL for the social card, when one is available. */
  socialImage?: string | null;
}

/**
 * Open Graph / Twitter Card / canonical block, shared by every renderer.
 *
 * WHY A HELPER. Each of the 21 renderers inlines its own `<head>` as a
 * template literal, so before this existed the head was copy-pasted 21 times
 * and carried NO social metadata at all — a shared /landing/:slug link
 * rendered in Slack, iMessage, WhatsApp or X as a bare URL with no title,
 * no description and no image. Founders are told to share these pages, so
 * that was the single highest-impact gap on the public surface. Emitting the
 * tags from one function means the next field lands in one place, not 21.
 *
 * A note on `og:image`: there is no per-page card generation. The repo's
 * OG pipeline (scripts/generate-og-images.mjs) is build-time, renders a
 * fixed key registry with headless Chromium, and ships committed PNGs for
 * the MARKETING site — it cannot produce a card per founder page at request
 * time, and the Worker has no image renderer. So the card image is the
 * founder's own uploaded logo when they have one, and is omitted otherwise
 * (an absent og:image degrades to a text-only card, which is correct;
 * pointing at a wrong or generic image would be worse). Generated per-page
 * cards need an image-rendering path that does not exist yet.
 */
function socialMeta(bk: BrandKit, a: { h: string; b: string; c: string }): string {
  // A preview must never be indexed or unfurled — it is a private draft link.
  if (bk.noindex) return '';
  const title = bk.name;
  const desc = a.b || '';
  const out = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:site_name" content="${title}" />`,
  ];
  if (desc) out.push(`<meta property="og:description" content="${desc}" />`);
  if (bk.canonical) {
    out.push(`<meta property="og:url" content="${escapeHtml(bk.canonical)}" />`);
    out.push(`<link rel="canonical" href="${escapeHtml(bk.canonical)}" />`);
  }
  if (bk.socialImage) {
    out.push(`<meta property="og:image" content="${escapeHtml(bk.socialImage)}" />`);
    out.push(`<meta name="twitter:image" content="${escapeHtml(bk.socialImage)}" />`);
    // A logo is square-ish; summary (not summary_large_image) is the honest
    // card shape for it, and avoids X cropping a logo into a letterbox.
    out.push(`<meta name="twitter:card" content="summary" />`);
  } else {
    out.push(`<meta name="twitter:card" content="summary" />`);
  }
  out.push(`<meta name="twitter:title" content="${title}" />`);
  if (desc) out.push(`<meta name="twitter:description" content="${desc}" />`);
  return out.join('\n');
}

function buildBrandKit(
  row: any,
  opts: { slug?: string; token?: string; noindex?: boolean; nonce?: string; canonical?: string | null },
): BrandKit {
  const color = hex6(row.theme_color, '#7c3aed');
  const bgColor = hex6(row.palette_bg, '#fafafa');
  const inkColor = hex6(row.palette_ink, '#0f172a');
  const secondary = hex6(row.palette_secondary, '#c4b5fd');
  const accent = hex6(row.palette_accent, '#f59e0b');
  const fontPairing = String(row.font_pairing || 'editorial').trim();
  const name = escapeHtml(row.name);
  const logoMarkup = row.logo_url
    ? `<img src="${escapeHtml(row.logo_url)}" alt="${name}" style="width:96px;height:96px;border-radius:24px;object-fit:cover" />`
    : (row.logo_svg || svgLogo(row.name, color));
  // Container-filling variant for the nav/footer logo chip (see logoChip).
  const logoInline = row.logo_url
    ? `<img src="${escapeHtml(row.logo_url)}" alt="${name}" style="width:100%;height:100%;object-fit:cover;display:block" />`
    : (row.logo_svg || svgLogoInline(row.name, color));
  const slug = opts.slug || '';
  const apiWaitlist = opts.slug ? `/api/brand/landing/${encodeURIComponent(opts.slug)}/waitlist` : '';
  // The social card can only use an ABSOLUTE https image — a crawler fetching
  // the card has no origin to resolve `/uploads/x.png` against. validMediaUrl
  // deliberately allows same-origin paths (they're fine inside the document),
  // so re-check here rather than reusing it.
  const rawLogo = typeof row.logo_url === 'string' ? row.logo_url.trim() : '';
  const socialImage = /^https:\/\/\S+$/.test(rawLogo) ? rawLogo : null;
  return {
    color, bgColor, inkColor, secondary, accent, fontPairing, logoMarkup, logoInline, name, slug,
    apiWaitlist, noindex: !!opts.noindex, nonce: opts.nonce,
    heroMediaUrl: validMediaUrl(row.hero_media_url),
    productScreenshotUrl: validMediaUrl(row.product_screenshot_url),
    canonical: opts.canonical || null,
    socialImage,
  };
}

function buildAudienceData(row: any): Record<string, { h: string; b: string; c: string }> {
  return {
    customer: {
      h: escapeHtml(row.audience_customer_headline || row.headline || row.tagline || row.name),
      b: escapeHtml(row.audience_customer_body || row.subheadline || row.tagline || ''),
      c: escapeHtml(row.audience_customer_cta || row.cta_text || 'Join the waitlist'),
    },
    partner: {
      h: escapeHtml(row.audience_partner_headline || row.headline || row.tagline || row.name),
      b: escapeHtml(row.audience_partner_body || row.subheadline || row.tagline || ''),
      c: escapeHtml(row.audience_partner_cta || row.cta_text || 'Join the waitlist'),
    },
    investor: {
      h: escapeHtml(row.audience_investor_headline || row.headline || row.tagline || row.name),
      b: escapeHtml(row.audience_investor_body || row.subheadline || row.tagline || ''),
      c: escapeHtml(row.audience_investor_cta || row.cta_text || 'Join the waitlist'),
    },
    advisor: {
      h: escapeHtml(row.audience_advisor_headline || row.headline || row.tagline || row.name),
      b: escapeHtml(row.audience_advisor_body || row.subheadline || row.tagline || ''),
      c: escapeHtml(row.audience_advisor_cta || row.cta_text || 'Join the waitlist'),
    },
    mentor: {
      h: escapeHtml(row.audience_mentor_headline || row.headline || row.tagline || row.name),
      b: escapeHtml(row.audience_mentor_body || row.subheadline || row.tagline || ''),
      c: escapeHtml(row.audience_mentor_cta || row.cta_text || 'Join the waitlist'),
    },
    cofounder: {
      h: escapeHtml(row.audience_cofounder_headline || row.headline || row.tagline || row.name),
      b: escapeHtml(row.audience_cofounder_body || row.subheadline || row.tagline || ''),
      c: escapeHtml(row.audience_cofounder_cta || row.cta_text || 'Join the waitlist'),
    },
  };
}

// ── Task #3: Template-driven editable content ──────────────────────────────
// Per-template editable fields shown in the Brand & Landing step-3 editor and
// rendered into the page. This schema is the single source of truth for the
// worker renderers AND (mirrored as TEMPLATE_CONTENT_SCHEMA in
// frontend/src/lib/brand/templates.js, guarded by landing_content_schema.test.ts)
// the editor form + AI auto-fill. Defaults are RAW text (NOT HTML-escaped) — the
// renderer escapes them on the way out, so write "Run & learn", not "Run &amp; learn".
export type ContentFieldKind = 'text' | 'textarea' | 'groupList';
export interface ContentItemField {
  key: string;
  label: string;
  kind: 'text' | 'textarea';
}
export interface ContentField {
  key: string;
  label: string;
  kind: ContentFieldKind;
  default: string | Array<Record<string, string>>;
  itemFields?: ContentItemField[];
  max?: number;
}

// Shared hero fields — stored in existing landing_pages columns (NOT content_json),
// listed here so the editor + auto-fill know the full editable surface.
export const SHARED_LANDING_FIELDS: ContentField[] = [
  { key: 'name', label: 'Brand name', kind: 'text', default: '' },
  { key: 'headline', label: 'Headline', kind: 'text', default: '' },
  { key: 'subheadline', label: 'Subheadline', kind: 'textarea', default: '' },
  { key: 'cta_text', label: 'Button text', kind: 'text', default: '' },
];

// Per-template content blocks. Originals (minimal/bold-hero/video-first/editorial/
// product-mock) carry no extra fields. Signature templates are filled in below.
export const LANDING_CONTENT_SCHEMA: Record<TemplateKey, ContentField[]> = {
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

function parseLandingContent(row: any): Record<string, any> {
  const raw = row && row.content_json;
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, any>;
  try {
    const o = JSON.parse(String(raw));
    return o && typeof o === 'object' ? (o as Record<string, any>) : {};
  } catch {
    return {};
  }
}

interface ContentItemAccessor {
  t(key: string): string;
  pct(key: string): string;
}
interface ContentAccessor {
  t(field: string): string;
  list(field: string): ContentItemAccessor[];
}

// Build an accessor over a row's saved content for one template. `.t(field)`
// returns the escaped string (falling back to the schema default when blank);
// `.list(field)` returns escaped per-item accessors (falling back to the schema
// default list when the user left it empty, clamped to the field's max).
function landingContent(row: any, templateKey: TemplateKey): ContentAccessor {
  const all = parseLandingContent(row);
  const tc: Record<string, any> = (all && typeof all[templateKey] === 'object' && all[templateKey]) || {};
  const fields = LANDING_CONTENT_SCHEMA[templateKey] || [];
  const byKey: Record<string, ContentField> = {};
  for (const f of fields) byKey[f.key] = f;

  function itemAccessor(item: any): ContentItemAccessor {
    return {
      t(key: string): string {
        const v = item && typeof item === 'object' ? item[key] : '';
        return escapeHtml(typeof v === 'string' ? v : '');
      },
      pct(key: string): string {
        const v = item && typeof item === 'object' ? item[key] : '';
        const n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10);
        if (!isFinite(n)) return '0';
        return String(Math.max(0, Math.min(100, n)));
      },
    };
  }

  return {
    t(field: string): string {
      const spec = byKey[field];
      const def = spec && typeof spec.default === 'string' ? spec.default : '';
      const v = tc[field];
      const s = typeof v === 'string' && v.trim() ? v : def;
      return escapeHtml(s);
    },
    list(field: string): ContentItemAccessor[] {
      const spec = byKey[field];
      const defList: Array<Record<string, string>> = spec && Array.isArray(spec.default) ? spec.default : [];
      const max = (spec && spec.max) || 12;
      let items: any[] = Array.isArray(tc[field]) ? tc[field] : [];
      items = items.filter(
        (it) => it && typeof it === 'object' && Object.values(it).some((x) => typeof x === 'string' && x.trim()),
      );
      if (items.length === 0) items = defList;
      return items.slice(0, max).map(itemAccessor);
    },
  };
}

// Validate + clamp an incoming content_json payload against the schema. Drops
// unknown templates/fields, coerces strings, caps lengths and list sizes — so the
// PUT route never persists unbounded or off-schema content.
export function sanitizeLandingContent(input: any): Record<string, Record<string, any>> {
  const out: Record<string, Record<string, any>> = {};
  if (!input || typeof input !== 'object') return out;
  const MAX_STR = 2000;
  for (const tkey of TEMPLATE_KEYS) {
    const fields = LANDING_CONTENT_SCHEMA[tkey];
    if (!fields || !fields.length) continue;
    const src = (input as Record<string, any>)[tkey];
    if (!src || typeof src !== 'object') continue;
    const tout: Record<string, any> = {};
    for (const f of fields) {
      const v = src[f.key];
      if (f.kind === 'groupList') {
        if (!Array.isArray(v)) continue;
        const max = f.max || 12;
        const itemFields = f.itemFields || [];
        tout[f.key] = v.slice(0, max).map((item: any) => {
          const io: Record<string, string> = {};
          if (item && typeof item === 'object') {
            for (const itf of itemFields) {
              const iv = item[itf.key];
              if (typeof iv === 'string') io[itf.key] = iv.slice(0, MAX_STR);
            }
          }
          return io;
        });
      } else if (typeof v === 'string') {
        tout[f.key] = v.slice(0, MAX_STR);
      }
    }
    if (Object.keys(tout).length) out[tkey] = tout;
  }
  return out;
}

function fontStack(pairing: string): string {
  const stacks: Record<string, string> = {
    editorial: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Georgia", "Times New Roman", serif',
    modern: '-apple-system, BlinkMacSystemFont, "Segoe UI", "SF Pro Display", "Roboto", "Helvetica Neue", sans-serif',
    humanist: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Gill Sans", "Gill Sans MT", sans-serif',
    classic: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Palatino", "Book Antiqua", serif',
  };
  return stacks[pairing] || stacks.editorial;
}

// ── Task #3: single-audience capture ───────────────────────────────────────
// Audience is chosen in step 1, so every published page renders copy for ONE
// audience — the old six-tab in-page switcher (and its switchTab script) was
// removed. These helpers pick the selected audience and render a single
// waitlist form (#wl-form / #wl-msg), consumed by singleWaitlistScript — the
// same capture the ported designs already use.
const AUDIENCE_KEYS = ['customer', 'partner', 'investor', 'advisor', 'mentor', 'cofounder'] as const;

function selectedAudience(row: any): string {
  const a = String(row?.audience || '').trim();
  return (AUDIENCE_KEYS as readonly string[]).includes(a) ? a : 'customer';
}

/**
 * Honeypot input, rendered inside every public capture form.
 *
 * MUST live in the static markup, not be injected by script: the bots this
 * catches parse the served HTML and fill every input they find. One that
 * never runs our JS would never see a JS-created field (and one that posts
 * straight to the API skips the form entirely — that is the rate limiter's
 * job, not this one).
 *
 * Hidden four ways because any single one is defeatable: off-screen
 * positioning (not `display:none`, which the cruder scrapers specifically
 * skip), `aria-hidden` so screen readers ignore it, `tabindex="-1"` so it is
 * unreachable by keyboard, and `autocomplete="off"` so no password manager
 * helpfully fills it for a real user — a false positive here silently drops a
 * genuine lead, which is worse than missing a bot.
 *
 * The field name is shared with the route via HONEYPOT_FIELD so a rename can
 * never disable the trap on one side only.
 */
function honeypotField(): string {
  return `
        <div style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden" aria-hidden="true">
          <label for="${HONEYPOT_FIELD}">Company website (leave blank)</label>
          <input id="${HONEYPOT_FIELD}" type="text" name="${HONEYPOT_FIELD}" tabindex="-1" autocomplete="off" />
        </div>`;
}

// One waitlist form for the selected audience. `a.c` (the CTA) is already
// HTML-escaped by buildAudienceData.
function audienceForm(a: { h: string; b: string; c: string }): string {
  return `
      <form id="wl-form">${honeypotField()}
        <label for="email" class="sr">Email</label>
        <input id="email" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit">${a.c}</button>
      </form>
      <div id="wl-msg" aria-live="polite"></div>`;
}

// ── Ported designs (Task #24) — shared helpers ───────────────────
// Relative-luminance pick of a legible text colour for a given accent/brand
// hex, so accent-coloured buttons stay readable even when the palette flows
// through to a light accent (e.g. the lime "signal" of Capital Ready Kit).
function contrastText(hex: string): string {
  const h = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : '000000';
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return L > 0.52 ? '#15140f' : '#ffffff';
}

// Single-audience waitlist capture for the ported designs. Unlike the shared
// six-tab `waitlistScript`, these designs are single-narrative, so we wire one
// form (#wl-form / #wl-msg) and post a fixed audience. CSP-safe (nonce'd).
function singleWaitlistScript(apiWaitlist: string, audience: string, nonce?: string): string {
  return `<script${nonce ? ` nonce="${nonce}"` : ''}>
(function(){
  var api=${JSON.stringify(apiWaitlist)};
  if(!api) return;
  var f=document.getElementById('wl-form'), m=document.getElementById('wl-msg');
  if(!f) return;
  // Attribution, read once at load: which campaign sent this visitor, and what
  // page linked here. Allowlisted client-side too so a crafted querystring
  // can't push arbitrary keys at the API (which allowlists again server-side).
  var utm={}, qs=new URLSearchParams(location.search);
  ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(k){
    var v=qs.get(k); if(v) utm[k]=String(v).slice(0,120);
  });
  var ref=document.referrer||'';
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var email=f.email.value.trim(); if(!email) return;
    var btn=f.querySelector('button'); btn.disabled=true;
    var trap=f.elements[${JSON.stringify(HONEYPOT_FIELD)}];
    fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify({email:email,source:'landing',audience:${JSON.stringify(audience)},utm:utm,referrer:ref.slice(0,300),${JSON.stringify(HONEYPOT_FIELD)}:trap?trap.value:''})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
      .then(function(x){
        if(x.ok){ m.className='wl-ok'; m.textContent="You're on the list. We'll be in touch."; f.reset(); }
        else { m.className='wl-err'; m.textContent=(x.j&&x.j.error)||'Something went wrong.'; }
      })
      .catch(function(){ m.className='wl-err'; m.textContent='Network error. Please try again.'; })
      .finally(function(){ btn.disabled=false; });
  });
})();
</script>`;
}

// Signature palettes for the ported designs. Selecting one of these templates
// seeds these into the editable palette fields (frontend `chooseTemplate`) and
// the public template preview (renderTemplatePreview) so each design looks
// on-brand out of the box — while the palette still flows through and can be
// re-tuned. MIRROR of VISUAL_TEMPLATE_PALETTES in
// frontend/src/lib/brand/templates.js — keep the two in lockstep.
export const TEMPLATE_SIGNATURE_PALETTES: Record<string, {
  theme_color: string; palette_bg: string; palette_ink: string; palette_secondary: string; palette_accent: string;
}> = {
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

// ── Template: Minimal (the original layout) ──────────────────────
function renderMinimal(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, accent, fontPairing, logoMarkup, name } = bk;
  const audKey = selectedAudience(row);
  const a = aud[audKey];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  :root { color-scheme: light; }
  body { margin:0; font-family: ${fontStack(fontPairing)}; background: ${bgColor}; color: ${inkColor}; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 64px 24px 96px; text-align: center; }
  .logo { display:flex; justify-content:center; margin-bottom: 28px; }
  h1 { font-size: clamp(32px, 5vw, 52px); margin: 0 0 12px; line-height: 1.1; letter-spacing: -0.02em; }
  p.sub { font-size: 18px; color: ${inkColor}; opacity: .7; margin: 0 0 36px; }
  form { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; max-width: 480px; margin: 0 auto; }
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid ${inkColor}22; border-radius: 10px; font-size: 15px; outline:none; background: ${bgColor}; color: ${inkColor}; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .wl-ok, .wl-err { margin-top: 16px; font-size: 14px; }
  .wl-ok { color: ${accent}; }
  .wl-err { color: ${color}; opacity: .85; }
  footer { margin-top: 64px; font-size: 12px; color: ${inkColor}55; }
  footer a { color: inherit; }
  .sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo">${logoMarkup}</div>
    <h1>${a.h}</h1>
    ${a.b ? `<p class="sub">${a.b}</p>` : ''}
    ${audienceForm(a)}
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, audKey, bk.nonce)}
</body>
</html>`;
}

// ── Template: Bold Hero ──────────────────────────────────────────
function renderBoldHero(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, accent, fontPairing, logoMarkup, name, heroMediaUrl } = bk;
  const heroBg = heroMediaUrl ? `url(${escapeHtml(heroMediaUrl)})` : bgColor;
  const heroText = heroMediaUrl ? '#fff' : inkColor;
  const audKey = selectedAudience(row);
  const a = aud[audKey];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  :root { color-scheme: light; }
  body { margin:0; font-family: ${fontStack(fontPairing)}; background: ${bgColor}; color: ${inkColor}; }
  .hero { min-height: 60vh; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding: 80px 24px; background: ${heroBg} center/cover no-repeat; color: ${heroText}; }
  .hero-overlay { position:absolute; inset:0; background: rgba(0,0,0,0.4); }
  .hero > * { position:relative; z-index:1; }
  .logo { margin-bottom: 24px; }
  h1 { font-size: clamp(36px, 6vw, 64px); margin: 0 0 12px; line-height: 1.05; letter-spacing: -0.02em; font-weight: 800; }
  p.sub { font-size: 20px; opacity: .85; margin: 0 0 36px; max-width: 560px; }
  .body { max-width: 760px; margin: 0 auto; padding: 48px 24px 80px; text-align: center; }
  form { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; max-width: 480px; margin: 0 auto; }
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid ${inkColor}22; border-radius: 10px; font-size: 15px; outline:none; background: ${bgColor}; color: ${inkColor}; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .wl-ok, .wl-err { margin-top: 16px; font-size: 14px; }
  .wl-ok { color: ${accent}; }
  .wl-err { color: ${color}; opacity: .85; }
  footer { font-size: 12px; color: ${inkColor}55; padding: 24px; text-align: center; }
  footer a { color: inherit; }
  .sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
</style>
</head>
<body>
  <div class="hero">
    ${heroMediaUrl ? '<div class="hero-overlay"></div>' : ''}
    <div class="logo">${logoMarkup}</div>
    <h1>${a.h}</h1>
    <p class="sub">${a.b}</p>
  </div>
  <div class="body">
    ${audienceForm(a)}
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, audKey, bk.nonce)}
</body>
</html>`;
}

// ── Template: Video First ───────────────────────────────────────
function renderVideoFirst(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, accent, fontPairing, logoMarkup, name, heroMediaUrl } = bk;
  const isVideo = heroMediaUrl && /\.(mp4|webm|mov)(\?|$)/i.test(heroMediaUrl);
  const heroEl = isVideo
    ? `<video autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;"><source src="${escapeHtml(heroMediaUrl)}" /></video>`
    : heroMediaUrl
      ? `<img src="${escapeHtml(heroMediaUrl)}" alt="${name}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" />`
      : '';
  const audKey = selectedAudience(row);
  const a = aud[audKey];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  :root { color-scheme: light; }
  body { margin:0; font-family: ${fontStack(fontPairing)}; background: ${bgColor}; color: ${inkColor}; }
  .media-hero { position:relative; width:100%; height: 50vh; overflow:hidden; }
  .hero-overlay { position:absolute; inset:0; background: rgba(0,0,0,0.35); z-index:1; }
  .hero-content { position:absolute; inset:0; z-index:2; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding: 24px; color: #fff; }
  .logo { margin-bottom: 20px; }
  h1 { font-size: clamp(32px, 5vw, 52px); margin: 0 0 12px; line-height: 1.1; letter-spacing: -0.02em; }
  p.sub { font-size: 18px; opacity: .85; margin: 0 0 24px; max-width: 540px; }
  .body { max-width: 760px; margin: 0 auto; padding: 48px 24px 80px; text-align: center; }
  form { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; max-width: 480px; margin: 0 auto; }
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid ${inkColor}22; border-radius: 10px; font-size: 15px; outline:none; background: ${bgColor}; color: ${inkColor}; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .wl-ok, .wl-err { margin-top: 16px; font-size: 14px; }
  .wl-ok { color: ${accent}; }
  .wl-err { color: ${color}; opacity: .85; }
  footer { font-size: 12px; color: ${inkColor}55; padding: 24px; text-align: center; }
  footer a { color: inherit; }
  .sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
</style>
</head>
<body>
  <div class="media-hero">
    ${heroEl}
    ${heroMediaUrl ? '<div class="hero-overlay"></div>' : ''}
    <div class="hero-content">
      <div class="logo">${logoMarkup}</div>
      <h1>${a.h}</h1>
      <p class="sub">${a.b}</p>
    </div>
  </div>
  <div class="body">
    ${audienceForm(a)}
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, audKey, bk.nonce)}
</body>
</html>`;
}

// ── Template: Editorial ──────────────────────────────────────────
function renderEditorial(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, fontPairing, logoMarkup, name } = bk;
  const audKey = selectedAudience(row);
  const a = aud[audKey];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  :root { color-scheme: light; }
  body { margin:0; font-family: ${fontStack(fontPairing)}; background: ${bgColor}; color: ${inkColor}; line-height: 1.6; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 80px 24px 96px; }
  .logo { display:flex; margin-bottom: 48px; }
  h1 { font-size: clamp(36px, 5vw, 56px); margin: 0 0 16px; line-height: 1.1; letter-spacing: -0.02em; font-weight: 700; }
  .lede { font-size: 20px; color: ${inkColor}; opacity: .75; margin: 0 0 48px; }
  form { display:flex; gap:8px; flex-wrap:wrap; max-width: 480px; margin: 24px 0 0; }
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid ${inkColor}22; border-radius: 10px; font-size: 15px; outline:none; background: ${bgColor}; color: ${inkColor}; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .wl-ok, .wl-err { margin-top: 12px; font-size: 14px; }
  .wl-ok { color: ${accent}; }
  .wl-err { color: ${color}; opacity: .85; }
  .rule { border:0; border-top:1px solid ${secondary}; margin: 40px 0; }
  footer { margin-top: 64px; font-size: 12px; color: ${inkColor}55; }
  footer a { color: inherit; }
  .sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo">${logoMarkup}</div>
    <h1>${a.h}</h1>
    <p class="lede">${a.b}</p>
    <hr class="rule" />
    ${audienceForm(a)}
    <hr class="rule" />
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, audKey, bk.nonce)}
</body>
</html>`;
}

// ── Template: Product Mock ───────────────────────────────────────
function renderProductMock(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, fontPairing, logoMarkup, name, productScreenshotUrl } = bk;
  const audKey = selectedAudience(row);
  const a = aud[audKey];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  :root { color-scheme: light; }
  body { margin:0; font-family: ${fontStack(fontPairing)}; background: ${bgColor}; color: ${inkColor}; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 48px 24px 80px; }
  .header { display:flex; align-items:center; gap: 16px; margin-bottom: 40px; }
  .logo { flex-shrink:0; }
  .headline { flex:1; }
  h1 { font-size: clamp(28px, 4vw, 42px); margin: 0 0 8px; line-height: 1.15; }
  p.lede { font-size: 18px; opacity: .75; margin: 0; }
  .screenshot { width: 100%; max-height: 420px; object-fit: cover; border-radius: 12px; border: 1px solid ${secondary}; margin-bottom: 40px; }
  .panel-content { text-align: center; }
  form { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; max-width: 480px; margin: 0 auto; }
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid ${inkColor}22; border-radius: 10px; font-size: 15px; outline:none; background: ${bgColor}; color: ${inkColor}; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .wl-ok, .wl-err { margin-top: 16px; font-size: 14px; }
  .wl-ok { color: ${accent}; }
  .wl-err { color: ${color}; opacity: .85; }
  footer { margin-top: 64px; font-size: 12px; color: ${inkColor}55; text-align: center; }
  footer a { color: inherit; }
  .sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  @media (max-width: 480px) { .header { flex-direction: column; text-align: center; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="logo">${logoMarkup}</div>
      <div class="headline">
        <h1>${a.h}</h1>
        <p class="lede">${a.b}</p>
      </div>
    </div>
    ${productScreenshotUrl ? `<img src="${escapeHtml(productScreenshotUrl)}" alt="${name} product" class="screenshot" />` : ''}
    <div class="panel-content">
      ${audienceForm(a)}
    </div>
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, audKey, bk.nonce)}
</body>
</html>`;
}

// ── Template: Advisor Connect (Task #24) — warm editorial invite ─
function renderAdvisorConnect(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, logoMarkup, name } = bk;
  const a = aud.advisor;
  const c = landingContent(row, 'advisor-connect');
  const brand = name || 'this venture';
  const btnInk = contrastText(color);
  const serif = `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif`;
  const sans = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  :root { color-scheme: light; }
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${serif};line-height:1.6;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}
  .wrap{max-width:1080px;margin:0 auto;padding:0 28px;}
  .eyebrow{font-family:${sans};font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:${accent};font-weight:600;}
  nav{display:flex;align-items:center;justify-content:space-between;padding:26px 0;border-bottom:1px solid ${secondary};}
  .brand{display:flex;align-items:center;gap:12px;font-weight:600;font-size:18px;}
  .brand .mark{width:38px;height:38px;border-radius:10px;overflow:hidden;display:flex;}
  .brand .mark :is(svg,img){width:100%!important;height:100%!important;border-radius:0!important;}
  .nav-cta{font-family:${sans};font-size:13px;text-decoration:none;border:1px solid ${inkColor};border-radius:999px;padding:8px 16px;}
  .hero{display:grid;grid-template-columns:1.6fr .9fr;gap:48px;padding:72px 0 64px;border-bottom:1px solid ${secondary};}
  .hero h1{font-size:clamp(40px,6vw,68px);line-height:1.04;letter-spacing:-.02em;margin:16px 0 20px;font-weight:600;}
  .hero .lede{font-size:21px;opacity:.78;margin:0 0 32px;max-width:36ch;}
  .btn{display:inline-block;font-family:${sans};font-weight:600;font-size:15px;background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:999px;padding:14px 26px;cursor:pointer;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .meta{font-family:${sans};border-left:1px solid ${secondary};padding-left:28px;}
  .meta dt{font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.5;margin-top:18px;}
  .meta dt:first-child{margin-top:0;}
  .meta dd{margin:4px 0 0;font-size:16px;font-weight:600;}
  section{padding:60px 0;border-bottom:1px solid ${secondary};}
  .sec-head{margin-bottom:24px;}
  .sec-head h2{font-size:clamp(26px,3.4vw,38px);margin:8px 0 0;font-weight:600;letter-spacing:-.01em;}
  .lead{font-size:20px;max-width:62ch;opacity:.85;margin:0;}
  .points{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:28px;}
  .point .n{font-family:${sans};font-size:13px;color:${accent};font-weight:700;}
  .point h3{font-size:20px;margin:8px 0 6px;font-weight:600;}
  .point p{margin:0;opacity:.78;font-size:16px;}
  .two{display:grid;grid-template-columns:1.3fr .9fr;gap:40px;align-items:start;}
  .card{font-family:${sans};background:${inkColor}0d;border:1px solid ${secondary};border-radius:16px;padding:26px;}
  .card h3{font-family:${serif};font-size:20px;margin:0 0 12px;}
  .term{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-top:1px solid ${secondary};font-size:15px;}
  .term:first-of-type{border-top:0;}
  .term span:last-child{font-weight:600;text-align:right;}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;}
  .stat .v{font-size:clamp(30px,4vw,46px);font-weight:600;letter-spacing:-.02em;}
  .stat .l{font-family:${sans};font-size:13px;opacity:.6;text-transform:uppercase;letter-spacing:.1em;margin-top:4px;}
  blockquote{margin:0;font-size:clamp(24px,3.4vw,34px);line-height:1.4;font-style:italic;max-width:26ch;}
  blockquote cite{display:block;font-style:normal;font-family:${sans};font-size:14px;opacity:.6;margin-top:18px;}
  .cta{background:${inkColor};color:${bgColor};border-radius:24px;padding:56px;margin:60px 0;text-align:center;}
  .cta h2{font-size:clamp(30px,4vw,46px);margin:0 0 12px;font-weight:600;}
  .cta p{opacity:.82;margin:0 0 28px;font-size:18px;}
  form{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;max-width:460px;margin:0 auto;}
  input{font-family:${sans};flex:1 1 240px;padding:14px 16px;border:1px solid ${bgColor}33;border-radius:999px;font-size:15px;background:${bgColor}1a;color:${bgColor};outline:none;}
  input::placeholder{color:${bgColor}99;}
  input:focus{border-color:${color};box-shadow:0 0 0 3px ${color}55;}
  .cta .btn{background:${color};color:${btnInk};}
  .wl-ok,.wl-err{font-family:${sans};margin-top:14px;font-size:14px;min-height:18px;}
  .wl-ok{color:${accent};font-weight:600;} .wl-err{opacity:.85;}
  footer{font-family:${sans};display:flex;justify-content:space-between;padding:34px 0;font-size:13px;opacity:.6;flex-wrap:wrap;gap:10px;}
  .sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
  @media(max-width:820px){.hero{grid-template-columns:1fr;}.meta{border-left:0;border-top:1px solid ${secondary};padding:24px 0 0;}.points{grid-template-columns:1fr;}.two{grid-template-columns:1fr;}.stats{grid-template-columns:1fr;}.cta{padding:40px 22px;}}
</style>
</head>
<body>
  <div class="wrap">
    <nav>
      <div class="brand"><span class="mark">${logoMarkup}</span><span>${name}</span></div>
      <a class="nav-cta" href="#join">${a.c}</a>
    </nav>

    <header class="hero">
      <div>
        <div class="eyebrow">Advisory invitation</div>
        <h1>${a.h}</h1>
        <p class="lede">${a.b}</p>
        <a class="btn" href="#join">${a.c}</a>
      </div>
      <aside class="meta">
        <dl>
          <dt>Stage</dt><dd>Early &amp; building</dd>
          <dt>Focus</dt><dd>Product, GTM &amp; hiring</dd>
          <dt>Commitment</dt><dd>~2 hours / month</dd>
          <dt>Recognition</dt><dd>Advisory equity</dd>
        </dl>
      </aside>
    </header>

    <section>
      <div class="sec-head"><div class="eyebrow">The thesis</div></div>
      <p class="lead">We're building ${brand} around a simple conviction: the teams that win move faster with the right people in the room early. Here's where we believe the opportunity is.</p>
      <div class="points">
        <div class="point"><div class="n">01</div><h3>A real, urgent problem</h3><p>The people we serve feel this pain every week — and today's tools don't solve it.</p></div>
        <div class="point"><div class="n">02</div><h3>A wedge we can own</h3><p>We start narrow, earn trust, then expand into the workflow around it.</p></div>
        <div class="point"><div class="n">03</div><h3>Timing on our side</h3><p>Shifts in behaviour and technology make now the moment to build this.</p></div>
      </div>
    </section>

    <section>
      <div class="sec-head"><h2>Why ${brand}</h2></div>
      <p class="lead">We've shipped, sold, and supported in this space before. ${brand} is the product we always wished existed — opinionated, fast, and built alongside the people who'll use it. We're looking for advisors who've been here and want to help us skip the avoidable mistakes.</p>
    </section>

    <section>
      <div class="two">
        <div>
          <div class="sec-head"><h2>Where we'd value your guidance</h2></div>
          <p class="lead">Pick the lane where you're strongest — we'll make the time count.</p>
          <div class="points" style="grid-template-columns:1fr 1fr;">
            ${c.list('help_areas').map((it) => `<div class="point"><h3>${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
          </div>
        </div>
        <aside class="card">
          <h3>The arrangement</h3>
          ${c.list('arrangement').map((it) => `<div class="term"><span>${it.t('label')}</span><span>${it.t('value')}</span></div>`).join('')}
        </aside>
      </div>
    </section>

    <section>
      <div class="sec-head"><div class="eyebrow">Early signal</div></div>
      <div class="stats">
        ${c.list('signals').map((it) => `<div class="stat"><div class="v">${it.t('value')}</div><div class="l">${it.t('label')}</div></div>`).join('')}
      </div>
    </section>

    <section style="border-bottom:0;">
      <blockquote>${c.t('quote')}<cite>— Why we're reaching out to you</cite></blockquote>
    </section>

    <div class="cta" id="join">
      <h2>${a.c}</h2>
      <p>Leave your email and we'll send a short brief plus a link to book an intro call.</p>
      <form id="wl-form">${honeypotField()}
        <label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit" class="btn">${a.c}</button>
      </form>
      <div id="wl-msg" aria-live="polite"></div>
    </div>

    <footer>
      <span>${logoChip(bk, 18, 5)} ${name}</span>
      <span>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></span>
    </footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'advisor', bk.nonce)}
</body>
</html>`;
}

// ── Template: Proof Builder (Task #24) — evidence-first ──────────
function renderProofBuilder(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, logoMarkup, name } = bk;
  const a = aud.customer;
  const c = landingContent(row, 'proof-builder');
  const btnInk = contrastText(color);
  const serif = `Georgia, "Times New Roman", "Iowan Old Style", serif`;
  const sans = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  :root { color-scheme: light; }
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${sans};line-height:1.6;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}
  .wrap{max-width:1100px;margin:0 auto;padding:0 28px;}
  h1,h2,h3{font-family:${serif};font-weight:400;}
  .eyebrow{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${accent};font-weight:600;}
  nav{display:flex;align-items:center;justify-content:space-between;padding:22px 0;}
  .brand{display:flex;align-items:center;gap:12px;font-weight:600;font-size:18px;}
  .brand .mark{width:36px;height:36px;border-radius:9px;overflow:hidden;display:flex;}
  .brand .mark :is(svg,img){width:100%!important;height:100%!important;border-radius:0!important;}
  .nav-cta{font-size:13px;font-weight:600;text-decoration:none;background:${color};color:${btnInk};border-radius:8px;padding:9px 16px;}
  .hero{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;padding:48px 0 64px;}
  .hero h1{font-size:clamp(38px,5.4vw,60px);line-height:1.08;letter-spacing:-.01em;margin:14px 0 18px;}
  .hero .lede{font-size:20px;opacity:.8;margin:0 0 26px;max-width:42ch;}
  .btn{display:inline-block;font-weight:600;font-size:15px;font-family:${sans};background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:10px;padding:14px 24px;cursor:pointer;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .ghost{display:inline-block;margin-left:10px;font-weight:600;font-size:15px;text-decoration:none;color:${inkColor};opacity:.7;}
  .proof-card{background:#fff;border:1px solid ${secondary};border-radius:18px;padding:24px;box-shadow:0 24px 60px -42px ${inkColor}80;}
  .proof-card .ph{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${secondary};padding-bottom:14px;margin-bottom:6px;}
  .proof-card .ph .t{font-family:${serif};font-size:18px;}
  .tag{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${accent};background:${accent}1a;border-radius:999px;padding:5px 10px;}
  .prow{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 0;border-top:1px solid ${secondary};font-size:14px;}
  .prow:first-of-type{border-top:0;}
  .prow .k{opacity:.6;} .prow .v{font-weight:600;}
  .src{font-size:12px;opacity:.55;margin-top:14px;}
  section{padding:58px 0;border-top:1px solid ${secondary};}
  .sec-head{margin-bottom:30px;}
  .sec-head h2{font-size:clamp(26px,3.2vw,38px);margin:8px 0 0;}
  .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;}
  .step .n{font-family:${serif};font-size:34px;color:${accent};}
  .step h3{font-size:20px;margin:6px 0;}
  .step p{margin:0;opacity:.78;}
  .logos{display:flex;flex-wrap:wrap;gap:14px 40px;align-items:center;}
  .logos .lab{font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.5;width:100%;}
  .logos .org{font-family:${serif};font-size:20px;opacity:.55;}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:40px;}
  .panel{border:1px solid ${secondary};border-radius:16px;padding:26px;background:#fff;}
  .panel h3{font-size:21px;margin:0 0 10px;}
  .panel p{margin:0;opacity:.8;}
  .panel.alt{background:${accent}0d;border-color:${accent}33;}
  .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;}
  .metric .v{font-family:${serif};font-size:clamp(30px,4vw,46px);color:${accent};}
  .metric .l{font-size:14px;opacity:.65;margin-top:4px;}
  .cases{display:grid;grid-template-columns:1fr 1fr;gap:26px;}
  .case{border:1px solid ${secondary};border-radius:16px;padding:26px;background:#fff;}
  .case blockquote{font-family:${serif};font-size:20px;line-height:1.45;margin:0 0 16px;}
  .case .who{font-size:14px;opacity:.6;}
  .cta{background:${inkColor};color:${bgColor};border-radius:22px;padding:54px;margin:58px 0;text-align:center;}
  .cta h2{font-size:clamp(28px,3.6vw,42px);margin:0 0 10px;color:${bgColor};}
  .cta p{opacity:.82;margin:0 0 26px;font-size:17px;}
  form{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;max-width:460px;margin:0 auto;}
  input{font-family:${sans};flex:1 1 240px;padding:14px 16px;border:1px solid ${bgColor}33;border-radius:10px;font-size:15px;background:${bgColor}1a;color:${bgColor};outline:none;}
  input::placeholder{color:${bgColor}99;}
  input:focus{border-color:${color};box-shadow:0 0 0 3px ${color}55;}
  .wl-ok,.wl-err{margin-top:14px;font-size:14px;min-height:18px;}
  .wl-ok{color:${accent};font-weight:600;} .wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:32px 0;font-size:13px;opacity:.6;flex-wrap:wrap;gap:10px;border-top:1px solid ${secondary};}
  .sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
  @media(max-width:840px){.hero{grid-template-columns:1fr;}.steps{grid-template-columns:1fr;}.two{grid-template-columns:1fr;}.metrics{grid-template-columns:1fr;}.cases{grid-template-columns:1fr;}.cta{padding:40px 22px;}}
</style>
</head>
<body>
  <div class="wrap">
    <nav>
      <div class="brand"><span class="mark">${logoMarkup}</span><span>${name}</span></div>
      <a class="nav-cta" href="#join">${a.c}</a>
    </nav>

    <header class="hero">
      <div>
        <div class="eyebrow">Built on evidence</div>
        <h1>${a.h}</h1>
        <p class="lede">${a.b}</p>
        <a class="btn" href="#join">${a.c}</a>
        <a class="ghost" href="#how">See how it works →</a>
      </div>
      <aside class="proof-card">
        <div class="ph"><span class="t">Proof snapshot</span><span class="tag">Verified</span></div>
        <div class="prow"><span class="k">Status</span><span class="v">Live in the wild</span></div>
        <div class="prow"><span class="k">Signal</span><span class="v">Growing weekly</span></div>
        <div class="prow"><span class="k">Evidence</span><span class="v">Real customer use</span></div>
        <div class="prow"><span class="k">Updated</span><span class="v">This week</span></div>
        <div class="src">Every claim on this page is backed by something you can check.</div>
      </aside>
    </header>

    <section id="how">
      <div class="sec-head"><div class="eyebrow">How it works</div><h2>Claims you can verify</h2></div>
      <div class="steps">
        ${c.list('steps').map((it, i) => `<div class="step"><div class="n">${i + 1}</div><h3>${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
      </div>
    </section>

    <section>
      <div class="logos">
        <span class="lab">The kind of teams we build for</span>
        <span class="org">Operators</span><span class="org">Builders</span><span class="org">Early teams</span><span class="org">Domain experts</span>
      </div>
    </section>

    <section>
      <div class="sec-head"><div class="eyebrow">Before &amp; after</div><h2>What actually changes</h2></div>
      <div class="two">
        ${c.list('transformation').map((it, i) => `<div class="panel${i === 0 ? '' : ' alt'}"><h3>${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
      </div>
    </section>

    <section>
      <div class="metrics">
        ${c.list('metrics').map((it) => `<div class="metric"><div class="v">${it.t('value')}</div><div class="l">${it.t('label')}</div></div>`).join('')}
      </div>
    </section>

    <section>
      <div class="sec-head"><div class="eyebrow">In their words</div><h2>What people tell us</h2></div>
      <div class="cases">
        ${c.list('testimonials').map((it) => `<div class="case"><blockquote>${it.t('quote')}</blockquote><div class="who">${it.t('who')}</div></div>`).join('')}
      </div>
    </section>

    <div class="cta" id="join">
      <h2>${a.c}</h2>
      <p>Join the early list. We'll share what we're seeing and bring you in as we open access.</p>
      <form id="wl-form">${honeypotField()}
        <label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit" class="btn">${a.c}</button>
      </form>
      <div id="wl-msg" aria-live="polite"></div>
    </div>

    <footer>
      <span>${logoChip(bk, 18, 5)} ${name}</span>
      <span>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></span>
    </footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'customer', bk.nonce)}
</body>
</html>`;
}

// ── Template: Capital Ready Kit (Task #24) — dark investor brief ──
function renderCapitalReadyKit(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, logoMarkup, name } = bk;
  const a = aud.investor;
  const c = landingContent(row, 'capital-ready-kit');
  const brand = name || 'our company';
  const btnInk = contrastText(color);
  const mono = `"SF Mono", "JetBrains Mono", ui-monospace, "Cascadia Code", Menlo, Consolas, monospace`;
  const serif = `"Iowan Old Style", Georgia, "Times New Roman", serif`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  :root { color-scheme: dark; }
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${mono};line-height:1.65;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}
  .wrap{max-width:1080px;margin:0 auto;padding:0 28px;}
  .eyebrow{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:${accent};}
  nav{position:sticky;top:0;z-index:5;background:${bgColor}cc;backdrop-filter:blur(8px);border-bottom:1px solid ${secondary};}
  nav .row{display:flex;align-items:center;justify-content:space-between;padding:16px 0;}
  .brand{display:flex;align-items:center;gap:12px;font-size:15px;letter-spacing:.02em;}
  .brand .mark{width:34px;height:34px;border-radius:8px;overflow:hidden;display:flex;}
  .brand .mark :is(svg,img){width:100%!important;height:100%!important;border-radius:0!important;}
  .nav-cta{font-size:12px;text-decoration:none;background:${color};color:${btnInk};border-radius:7px;padding:9px 15px;font-weight:600;}
  .hero{padding:84px 0 56px;border-bottom:1px solid ${secondary};}
  .hero h1{font-family:${serif};font-size:clamp(42px,6.4vw,76px);line-height:1.02;letter-spacing:-.02em;margin:18px 0 20px;font-weight:400;}
  .hero .lede{font-size:18px;opacity:.78;max-width:60ch;margin:0 0 30px;}
  .btn{display:inline-block;font-family:${mono};font-size:14px;font-weight:600;background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:9px;padding:14px 24px;cursor:pointer;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .ghost{display:inline-block;margin-left:8px;font-size:14px;text-decoration:none;border:1px solid ${inkColor}33;border-radius:9px;padding:13px 20px;opacity:.85;}
  .raise{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:${secondary};border:1px solid ${secondary};border-radius:14px;overflow:hidden;margin-top:48px;}
  .raise .cell{background:${bgColor};padding:22px 20px;}
  .raise .k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.5;}
  .raise .v{font-family:${serif};font-size:clamp(22px,2.6vw,30px);margin-top:6px;color:${accent};}
  section{padding:64px 0;border-bottom:1px solid ${secondary};}
  .sec-head{margin-bottom:26px;}
  .sec-head h2{font-family:${serif};font-size:clamp(26px,3.4vw,40px);margin:8px 0 0;font-weight:400;}
  .lead{font-size:18px;opacity:.82;max-width:64ch;margin:0;}
  .points{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;margin-top:8px;}
  .point .n{font-size:12px;color:${accent};}
  .point h3{font-family:${serif};font-size:20px;font-weight:400;margin:8px 0 6px;}
  .point p{margin:0;opacity:.75;font-size:15px;}
  .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;}
  .metric .v{font-family:${serif};font-size:clamp(26px,3vw,38px);color:${accent};}
  .metric .l{font-size:12px;opacity:.6;text-transform:uppercase;letter-spacing:.08em;margin-top:6px;}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start;}
  .card{border:1px solid ${secondary};border-radius:16px;padding:26px;}
  .card h3{font-family:${serif};font-size:20px;font-weight:400;margin:0 0 14px;}
  .term{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid ${secondary};font-size:14px;}
  .term:first-of-type{border-top:0;}
  .term .v{color:${accent};}
  .fund{margin:14px 0 0;}
  .fund .row{display:flex;justify-content:space-between;font-size:13px;margin-bottom:7px;}
  .fund .track{height:8px;border-radius:999px;background:${inkColor}1a;overflow:hidden;margin-bottom:16px;}
  .fund .fill{height:100%;background:${accent};border-radius:999px;}
  .team{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;}
  .member{border:1px solid ${secondary};border-radius:14px;padding:22px;}
  .member .av{width:46px;height:46px;border-radius:50%;background:${accent}26;border:1px solid ${accent}55;margin-bottom:14px;}
  .member h3{font-family:${serif};font-size:18px;font-weight:400;margin:0 0 4px;}
  .member p{margin:0;opacity:.65;font-size:13px;}
  .cta{border:1px solid ${accent}55;background:${accent}12;border-radius:22px;padding:54px;margin:64px 0;text-align:center;}
  .cta h2{font-family:${serif};font-size:clamp(28px,3.8vw,44px);margin:0 0 10px;font-weight:400;}
  .cta p{opacity:.8;margin:0 0 26px;font-size:16px;}
  form{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;max-width:460px;margin:0 auto;}
  input{font-family:${mono};flex:1 1 240px;padding:14px 16px;border:1px solid ${inkColor}33;border-radius:9px;font-size:14px;background:${inkColor}0d;color:${inkColor};outline:none;}
  input::placeholder{color:${inkColor}66;}
  input:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}33;}
  .wl-ok,.wl-err{margin-top:14px;font-size:13px;min-height:18px;}
  .wl-ok{color:${accent};} .wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:30px 0;font-size:12px;opacity:.55;flex-wrap:wrap;gap:10px;}
  .sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
  @media(max-width:860px){.raise{grid-template-columns:1fr 1fr;}.points{grid-template-columns:1fr;}.metrics{grid-template-columns:1fr 1fr;}.two{grid-template-columns:1fr;}.team{grid-template-columns:1fr;}.cta{padding:40px 22px;}}
</style>
</head>
<body>
  <nav><div class="wrap row">
    <div class="brand"><span class="mark">${logoMarkup}</span><span>${name}</span></div>
    <a class="nav-cta" href="#intro">${a.c}</a>
  </div></nav>
  <div class="wrap">
    <header class="hero">
      <div class="eyebrow">Investor brief · raising now</div>
      <h1>${a.h}</h1>
      <p class="lede">${a.b}</p>
      <a class="btn" href="#intro">${a.c}</a>
      <a class="ghost" href="#round">Round details →</a>
      <div class="raise">
        ${c.list('raise_summary').map((it) => `<div class="cell"><div class="k">${it.t('label')}</div><div class="v">${it.t('value')}</div></div>`).join('')}
      </div>
    </header>

    <section>
      <div class="sec-head"><div class="eyebrow">What we do</div><h2>${brand} in one line</h2></div>
      <p class="lead">We're building ${brand} to remove the busywork between ambitious teams and the outcomes they're after — and we're raising to do it faster.</p>
    </section>

    <section>
      <div class="sec-head"><div class="eyebrow">Why now</div><h2>The timing is the moat</h2></div>
      <div class="points">
        ${c.list('why_now').map((it, i) => `<div class="point"><div class="n">${String(i + 1).padStart(2, '0')}</div><h3>${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
      </div>
    </section>

    <section>
      <div class="sec-head"><div class="eyebrow">Traction</div><h2>Signal so far</h2></div>
      <div class="metrics">
        ${c.list('traction').map((it) => `<div class="metric"><div class="v">${it.t('value')}</div><div class="l">${it.t('label')}</div></div>`).join('')}
      </div>
    </section>

    <section id="round">
      <div class="sec-head"><div class="eyebrow">The round</div><h2>Round &amp; use of funds</h2></div>
      <div class="two">
        <div class="card">
          <h3>Round details</h3>
          ${c.list('round_details').map((it) => `<div class="term"><span>${it.t('label')}</span><span class="v">${it.t('value')}</span></div>`).join('')}
        </div>
        <div class="card">
          <h3>Where it goes</h3>
          <div class="fund">
            ${c.list('use_of_funds').map((it) => `<div class="row"><span>${it.t('label')}</span><span>${it.pct('pct')}%</span></div><div class="track"><div class="fill" style="width:${it.pct('pct')}%"></div></div>`).join('')}
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="sec-head"><div class="eyebrow">Team</div><h2>Who's building ${brand}</h2></div>
      <div class="team">
        ${c.list('team').map((it) => `<div class="member"><div class="av"></div><h3>${it.t('name')}</h3><p>${it.t('role')}</p></div>`).join('')}
      </div>
    </section>

    <div class="cta" id="intro">
      <h2>${a.c}</h2>
      <p>Leave your email for the data room and a 30-minute intro with the founders.</p>
      <form id="wl-form">${honeypotField()}
        <label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@fund.com" required />
        <button type="submit" class="btn">${a.c}</button>
      </form>
      <div id="wl-msg" aria-live="polite"></div>
    </div>

    <footer>
      <span>${logoChip(bk, 18, 5)} ${name}</span>
      <span>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></span>
    </footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'investor', bk.nonce)}
</body>
</html>`;
}

// ── Shared system-font stacks for the ported designs (CSP: no @import) ──
const PORT_SERIF = `"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif`;
const PORT_SANS = `-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif`;
const PORT_MONO = `"SF Mono","JetBrains Mono",ui-monospace,"Cascadia Code",Menlo,Consolas,monospace`;

// ── Template: Capital Storyteller (Task #25) — dark numbered investor memo ──
function renderCapitalStoryteller(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, logoMarkup, name } = bk;
  const a = aud.investor; const brand = name || 'our company'; const btnInk = contrastText(color);
  const c = landingContent(row, 'capital-storyteller');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  :root{color-scheme:dark;}*{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_SANS};line-height:1.6;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:1120px;margin:0 auto;padding:0 32px;}
  .mono{font-family:${PORT_MONO};font-size:11px;letter-spacing:.2em;text-transform:uppercase;}
  nav{border-bottom:1px solid ${secondary};}
  nav .row{display:flex;align-items:center;justify-content:space-between;padding:18px 0;}
  .brand{display:flex;align-items:center;gap:11px;}.brand .mark{width:30px;height:30px;border-radius:7px;overflow:hidden;display:flex;}
  .brand .mark :is(svg,img){width:100%!important;height:100%!important;border-radius:0!important;}
  .brand b{font-family:${PORT_SERIF};font-weight:400;font-size:19px;}
  .conf{color:${accent};}
  .navcta{font-family:${PORT_MONO};font-size:11px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;border:1px solid ${accent};color:${accent};border-radius:6px;padding:8px 14px;}
  .hero{padding:88px 0 64px;border-bottom:1px solid ${secondary};}
  .hero h1{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(46px,7vw,86px);line-height:1.0;letter-spacing:-.02em;margin:22px 0 22px;}
  .hero .lede{font-size:19px;opacity:.74;max-width:62ch;margin:0 0 34px;}
  .diamond{display:inline-block;width:7px;height:7px;background:${accent};transform:rotate(45deg);margin-right:10px;vertical-align:middle;}
  .btn{display:inline-block;font-family:${PORT_MONO};font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:8px;padding:14px 24px;cursor:pointer;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .raise{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:${secondary};border:1px solid ${secondary};margin-top:52px;}
  .raise .cell{background:${bgColor};padding:24px 22px;}
  .raise .k{font-family:${PORT_MONO};font-size:10px;letter-spacing:.16em;text-transform:uppercase;opacity:.5;}
  .raise .v{font-family:${PORT_SERIF};font-size:clamp(26px,3vw,34px);margin-top:8px;color:${accent};}
  section{padding:66px 0;border-bottom:1px solid ${secondary};}
  .num{display:flex;align-items:center;gap:16px;margin-bottom:24px;}
  .num span{font-family:${PORT_MONO};font-size:11px;letter-spacing:.2em;color:${accent};}
  .num .ln{flex:1;height:1px;background:${secondary};}
  h2{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(28px,3.6vw,44px);margin:0 0 18px;letter-spacing:-.01em;}
  .lead{font-size:18px;opacity:.8;max-width:66ch;margin:0;}
  .bento{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:${secondary};border:1px solid ${secondary};margin-top:8px;}
  .bento .cell{background:${bgColor};padding:30px 26px;}
  .bento .v{font-family:${PORT_SERIF};font-size:clamp(30px,4vw,48px);color:${accent};}
  .bento .l{opacity:.72;font-size:15px;margin-top:8px;}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:${secondary};border:1px solid ${secondary};margin-top:8px;}
  .two .pane{background:${bgColor};padding:30px 26px;}
  .two h3{font-family:${PORT_SERIF};font-weight:400;font-size:20px;margin:0 0 16px;}
  .term{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid ${secondary};font-size:14px;}
  .term:first-of-type{border-top:0;}.term .v{color:${accent};font-family:${PORT_MONO};}
  .cta{padding:80px 0 88px;text-align:center;}
  .cta h2{font-size:clamp(32px,4.4vw,52px);}
  .cta p{opacity:.78;margin:0 auto 28px;max-width:52ch;}
  form{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;max-width:460px;margin:0 auto;}
  input{font-family:${PORT_MONO};flex:1 1 240px;padding:14px 16px;border:1px solid ${inkColor}33;border-radius:8px;font-size:14px;background:${inkColor}0d;color:${inkColor};outline:none;}
  input::placeholder{color:${inkColor}66;}input:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}33;}
  .wl-ok,.wl-err{margin-top:14px;font-size:13px;min-height:18px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:28px 0;font-size:11px;opacity:.5;flex-wrap:wrap;gap:8px;font-family:${PORT_MONO};letter-spacing:.08em;text-transform:uppercase;}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:820px){.raise,.bento,.two{grid-template-columns:1fr;}}
</style></head><body>
  <nav><div class="wrap row">
    <div class="brand"><span class="mark">${logoMarkup}</span><b>${name}</b> <span class="mono conf">· Confidential</span></div>
    <a class="navcta" href="#raise">${a.c}</a>
  </div></nav>
  <div class="wrap">
    <header class="hero">
      <div class="mono conf"><span class="diamond"></span>Investor brief · Series Seed</div>
      <h1>${a.h}</h1>
      <p class="lede">${a.b}</p>
      <a class="btn" href="#raise">${a.c}</a>
      <div class="raise">
        ${c.list('raise_summary').map((it) => `<div class="cell"><div class="k">${it.t('label')}</div><div class="v">${it.t('value')}</div></div>`).join('')}
      </div>
    </header>
    <section>
      <div class="num"><span>01 — Thesis</span><div class="ln"></div></div>
      <h2>The story behind ${brand}</h2>
      <p class="lead">${c.t('thesis')}</p>
    </section>
    <section>
      <div class="num"><span>02 — Market</span><div class="ln"></div></div>
      <h2>Why the window is open now</h2>
      <div class="bento">
        ${c.list('market').map((it) => `<div class="cell"><div class="v">${it.t('value')}</div><div class="l">${it.t('label')}</div></div>`).join('')}
      </div>
    </section>
    <section>
      <div class="num"><span>03 — Traction</span><div class="ln"></div></div>
      <h2>Signal so far</h2>
      <div class="bento">
        ${c.list('traction').map((it) => `<div class="cell"><div class="v">${it.t('value')}</div><div class="l">${it.t('label')}</div></div>`).join('')}
      </div>
    </section>
    <section id="raise">
      <div class="num"><span>04 — The round</span><div class="ln"></div></div>
      <h2>Round &amp; use of funds</h2>
      <div class="two">
        <div class="pane"><h3>Round details</h3>
          ${c.list('round_details').map((it) => `<div class="term"><span>${it.t('label')}</span><span class="v">${it.t('value')}</span></div>`).join('')}
        </div>
        <div class="pane"><h3>Use of funds</h3>
          ${c.list('use_of_funds').map((it) => `<div class="term"><span>${it.t('label')}</span><span class="v">${it.pct('pct')}%</span></div>`).join('')}
        </div>
      </div>
    </section>
    <div class="cta">
      <h2>${a.c}</h2>
      <p>Leave your email for the full data room and a 30-minute intro with the founding team.</p>
      <form id="wl-form">${honeypotField()}<label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@fund.com" required />
        <button type="submit" class="btn">${a.c}</button></form>
      <div id="wl-msg" aria-live="polite"></div>
    </div>
    <footer><span>${logoChip(bk, 18, 5)} ${name} · Confidential</span><span>Built with Axal VC</span></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'investor', bk.nonce)}
</body></html>`;
}

// ── Template: Seed Stage Spark (Task #25) — dark grid-backed seed teaser ──
function renderSeedStageSpark(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, logoMarkup, name } = bk;
  const a = aud.investor; const brand = name || 'our company'; const btnInk = contrastText(color);
  const c = landingContent(row, 'seed-stage-spark');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  :root{color-scheme:dark;}*{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_SANS};line-height:1.6;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:1180px;margin:0 auto;padding:0 32px;}
  .mono{font-family:${PORT_MONO};font-size:10px;letter-spacing:.2em;text-transform:uppercase;}
  nav{position:sticky;top:0;z-index:5;height:56px;display:flex;align-items:center;background:${bgColor}d9;backdrop-filter:blur(8px);border-bottom:1px solid ${secondary};}
  nav .row{display:flex;align-items:center;justify-content:space-between;width:100%;}
  .brand{display:flex;align-items:center;gap:10px;}
  .brand .mark{width:26px;height:26px;border-radius:6px;overflow:hidden;display:flex;}.brand .mark :is(svg,img){width:100%!important;height:100%!important;border-radius:0!important;}
  .brand b{font-family:${PORT_MONO};font-weight:600;font-size:14px;letter-spacing:.02em;}
  .pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:${accent};box-shadow:0 0 0 0 ${accent};animation:pg 1.8s infinite;}
  @keyframes pg{0%{box-shadow:0 0 0 0 ${accent}66;}70%{box-shadow:0 0 0 8px ${accent}00;}100%{box-shadow:0 0 0 0 ${accent}00;}}
  .navcta{font-family:${PORT_MONO};font-size:11px;text-decoration:none;background:${color};color:${btnInk};border-radius:5px;padding:7px 13px;font-weight:600;}
  .hero{position:relative;padding:96px 0 64px;border-bottom:1px solid ${secondary};overflow:hidden;}
  .hero .grid{position:absolute;inset:0;background-image:linear-gradient(${secondary}55 1px,transparent 1px),linear-gradient(90deg,${secondary}55 1px,transparent 1px);background-size:44px 44px;-webkit-mask-image:radial-gradient(ellipse at 30% 20%,#000,transparent 75%);mask-image:radial-gradient(ellipse at 30% 20%,#000,transparent 75%);opacity:.6;}
  .hero .in{position:relative;}
  .badge{display:inline-flex;align-items:center;gap:9px;font-family:${PORT_MONO};font-size:11px;letter-spacing:.1em;text-transform:uppercase;border:1px solid ${secondary};border-radius:999px;padding:6px 13px;color:${accent};}
  .hero h1{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(46px,7vw,80px);line-height:1.04;letter-spacing:-.02em;margin:24px 0 18px;}
  .hero h1 em{font-style:italic;color:${accent};}
  .hero .lede{font-size:18px;opacity:.76;max-width:60ch;margin:0 0 30px;}
  .btn{display:inline-block;font-family:${PORT_MONO};font-size:12px;font-weight:600;background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:7px;padding:13px 22px;cursor:pointer;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .ghost{display:inline-block;margin-left:8px;font-family:${PORT_MONO};font-size:12px;text-decoration:none;opacity:.8;}
  .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:${secondary};border:1px solid ${secondary};margin-top:48px;}
  .metrics .cell{background:${bgColor};padding:22px 20px;}
  .metrics .v{font-family:${PORT_MONO};font-size:clamp(22px,2.6vw,30px);color:${accent};}
  .metrics .l{font-size:11px;text-transform:uppercase;letter-spacing:.1em;opacity:.55;margin-top:6px;}
  .logos{padding:26px 0;border-bottom:1px solid ${secondary};display:flex;align-items:center;gap:26px;flex-wrap:wrap;}
  .logos .lbl{font-family:${PORT_MONO};font-size:10px;letter-spacing:.16em;text-transform:uppercase;opacity:.5;}
  .logos .n{font-family:${PORT_MONO};font-size:13px;opacity:.75;}
  section{padding:64px 0;border-bottom:1px solid ${secondary};}
  .eyebrow{font-family:${PORT_MONO};font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${accent};margin-bottom:12px;}
  h2{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(28px,3.6vw,42px);margin:0 0 26px;letter-spacing:-.01em;}
  .pillars{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;}
  .pill{border:1px solid ${secondary};border-radius:14px;padding:24px;background:${secondary}26;}
  .pill .v{font-family:${PORT_MONO};font-size:30px;color:${accent};}
  .pill h3{font-size:16px;margin:12px 0 6px;}.pill p{margin:0;opacity:.7;font-size:14px;}
  .bars{display:flex;align-items:flex-end;gap:14px;height:160px;margin-top:10px;}
  .bars .b{flex:1;background:${accent};border-radius:6px 6px 0 0;position:relative;opacity:.85;}
  .bars .b span{position:absolute;bottom:-22px;left:0;right:0;text-align:center;font-family:${PORT_MONO};font-size:10px;opacity:.6;}
  .cta{padding:84px 0;text-align:center;}
  .cta h2{font-size:clamp(32px,4.4vw,52px);}
  .cta p{opacity:.76;margin:0 auto 26px;max-width:50ch;}
  form{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;max-width:460px;margin:0 auto;}
  input{font-family:${PORT_MONO};flex:1 1 240px;padding:14px 16px;border:1px solid ${inkColor}33;border-radius:7px;font-size:14px;background:${inkColor}0d;color:${inkColor};outline:none;}
  input::placeholder{color:${inkColor}66;}input:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}33;}
  .wl-ok,.wl-err{margin-top:14px;font-size:13px;min-height:18px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:26px 0;font-size:11px;opacity:.5;flex-wrap:wrap;gap:8px;font-family:${PORT_MONO};}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:820px){.metrics,.pillars{grid-template-columns:1fr 1fr;}}
</style></head><body>
  <nav><div class="wrap row">
    <div class="brand"><span class="mark">${logoMarkup}</span><b>${name}</b></div>
    <a class="navcta" href="#raise">${a.c}</a>
  </div></nav>
  <div class="wrap">
    <header class="hero"><div class="grid"></div><div class="in">
      <span class="badge"><span class="pulse"></span> Round open · Seed</span>
      <h1>${a.h}</h1>
      <p class="lede">${a.b}</p>
      <a class="btn" href="#raise">${a.c}</a><a class="ghost" href="#traction">See traction ↓</a>
      <div class="metrics">
        ${c.list('metrics').map((it) => `<div class="cell"><div class="v">${it.t('value')}</div><div class="l">${it.t('label')}</div></div>`).join('')}
      </div>
    </div></header>
    <div class="logos"><span class="lbl">Built for teams like</span><span class="n">Operators</span><span class="n">Builders</span><span class="n">Early adopters</span><span class="n">Design partners</span></div>
    <section>
      <div class="eyebrow">01 / Product</div><h2>What makes ${brand} spark</h2>
      <div class="pillars">
        ${c.list('pillars').map((it, i) => `<div class="pill"><div class="v">${i + 1}</div><h3>${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
      </div>
    </section>
    <section id="traction">
      <div class="eyebrow">02 / Traction</div><h2>Momentum is building</h2>
      <div class="bars">
        ${c.list('traction_bars').map((it) => `<div class="b" style="height:${it.pct('pct')}%"><span>${it.t('label')}</span></div>`).join('')}
      </div>
    </section>
    <div class="cta" id="raise">
      <h2>${a.c}</h2>
      <p>We're sharing the deck and metrics with a small group of seed investors. Add your email.</p>
      <form id="wl-form">${honeypotField()}<label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@fund.com" required />
        <button type="submit" class="btn">${a.c}</button></form>
      <div id="wl-msg" aria-live="polite"></div>
    </div>
    <footer><span>${logoChip(bk, 18, 5)} ${name}</span><span>Built with Axal VC</span></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'investor', bk.nonce)}
</body></html>`;
}

// ── Template: Distribution Deck (Task #25) — light blueprint partnership memo ──
function renderDistributionDeck(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, name } = bk;
  const a = aud.investor; const brand = name || 'our company'; const btnInk = contrastText(color);
  const ctaInk = contrastText(inkColor);
  const c = landingContent(row, 'distribution-deck');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_SANS};line-height:1.6;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:1120px;margin:0 auto;padding:0 32px;}
  .mono{font-family:${PORT_MONO};font-size:10px;letter-spacing:.16em;text-transform:uppercase;}
  nav{position:sticky;top:0;z-index:5;background:${bgColor}e6;backdrop-filter:blur(8px);border-bottom:1px solid ${secondary};}
  nav .row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;}
  .brand{display:flex;align-items:center;gap:10px;}
  .mark{width:24px;height:24px;border-radius:5px;background:${accent};display:flex;align-items:center;justify-content:center;color:${contrastText(accent)};font-weight:800;font-size:13px;}
  .brand b{font-weight:700;font-size:15px;}.brand .tag{font-family:${PORT_MONO};font-size:10px;opacity:.55;letter-spacing:.12em;}
  .navcta{font-size:13px;text-decoration:none;background:${color};color:${btnInk};border-radius:6px;padding:8px 14px;font-weight:600;}
  .strip{border-bottom:1px solid ${secondary};background:${secondary}55;}
  .strip .row{padding:9px 0;font-family:${PORT_MONO};font-size:10px;letter-spacing:.1em;text-transform:uppercase;opacity:.6;}
  .eyebrow{display:flex;align-items:center;gap:12px;margin-bottom:18px;}
  .eyebrow .n{font-family:${PORT_MONO};font-size:11px;color:${accent};letter-spacing:.12em;}
  .eyebrow .ln{width:48px;height:1px;background:${secondary};}
  .eyebrow .t{font-family:${PORT_MONO};font-size:10px;letter-spacing:.16em;text-transform:uppercase;opacity:.55;}
  .hero{padding:64px 0;border-bottom:1px solid ${secondary};display:grid;grid-template-columns:1.6fr 1fr;gap:48px;align-items:start;}
  .hero h1{font-size:clamp(36px,5vw,58px);line-height:1.05;letter-spacing:-.025em;margin:0 0 18px;font-weight:700;}
  .hero h1 .hl{color:${accent};}
  .hero p{font-size:17px;opacity:.78;margin:0 0 24px;}
  .btn{display:inline-block;font-size:13px;font-weight:600;background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:7px;padding:12px 20px;cursor:pointer;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .side{border:1px solid ${secondary};border-radius:10px;padding:6px 18px;}
  .side .r{display:flex;justify-content:space-between;gap:12px;padding:14px 0;border-top:1px solid ${secondary};font-size:13px;}
  .side .r:first-child{border-top:0;}.side .r .v{font-family:${PORT_MONO};color:${accent};}
  section{padding:60px 0;border-bottom:1px solid ${secondary};}
  h2{font-size:clamp(24px,3vw,34px);margin:0 0 8px;letter-spacing:-.01em;font-weight:700;}
  .lead{font-size:16px;opacity:.76;max-width:62ch;margin:0 0 28px;}
  table{width:100%;border-collapse:collapse;font-size:14px;}
  th,td{text-align:left;padding:13px 12px;border-bottom:1px solid ${secondary};}
  th{font-family:${PORT_MONO};font-size:10px;letter-spacing:.1em;text-transform:uppercase;opacity:.55;}
  td .track{height:7px;border-radius:99px;background:${secondary};overflow:hidden;margin-top:6px;}
  td .fill{height:100%;background:${accent};}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:${secondary};border:1px solid ${secondary};}
  .cards .c{background:${bgColor};padding:22px 18px;}
  .cards .v{font-family:${PORT_MONO};font-size:clamp(22px,2.6vw,30px);color:${accent};}
  .cards .l{font-size:13px;opacity:.7;margin-top:6px;}
  .opts{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:${secondary};border:1px solid ${secondary};}
  .opts .o{background:${bgColor};padding:24px 20px;}
  .opts .o h3{margin:0 0 6px;font-size:17px;}.opts .o p{margin:0 0 14px;opacity:.72;font-size:14px;}
  .opts .meta{font-family:${PORT_MONO};font-size:11px;border-top:1px solid ${secondary};padding-top:12px;display:flex;justify-content:space-between;opacity:.7;}
  .ctaSec{background:${inkColor};color:${ctaInk};border:0;}
  .ctaSec .two{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;}
  .ctaSec h2{color:${ctaInk};}
  .ctaSec p{opacity:.82;font-size:15px;}
  form{display:flex;flex-direction:column;gap:10px;max-width:380px;}
  input{font-size:14px;padding:13px 14px;border:0;border-bottom:1px solid ${ctaInk}4d;background:transparent;color:${ctaInk};outline:none;}
  input::placeholder{color:${ctaInk}80;}input:focus{border-color:${accent};}
  .ctaSec .btn{align-self:flex-start;}
  .wl-ok,.wl-err{font-size:13px;min-height:18px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:24px 0;font-size:11px;opacity:.55;font-family:${PORT_MONO};flex-wrap:wrap;gap:8px;}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:840px){.hero,.ctaSec .two{grid-template-columns:1fr;}.cards{grid-template-columns:1fr 1fr;}.opts{grid-template-columns:1fr;}}
</style></head><body>
  <nav><div class="wrap row">
    <div class="brand">${logoChip(bk, 26, 6)}<b>${name}</b><span class="tag">Distribution brief</span></div>
    <a class="navcta" href="#next">${a.c}</a>
  </div></nav>
  <div class="strip"><div class="wrap row">Read-me · A partnership memo — edit the bracketed figures with your real numbers before sending.</div></div>
  <div class="wrap">
    <header class="hero">
      <div>
        <div class="eyebrow"><span class="n">01</span><span class="ln"></span><span class="t">Hero</span></div>
        <h1>A distribution case for <span class="hl">${brand}</span>, written for partners.</h1>
        <p>${a.b}</p>
        <a class="btn" href="#next">${a.c}</a>
      </div>
      <div class="side">
        ${c.list('side_facts').map((it) => `<div class="r"><span>${it.t('label')}</span><span class="v">${it.t('value')}</span></div>`).join('')}
      </div>
    </header>
    <section>
      <div class="eyebrow"><span class="n">02</span><span class="ln"></span><span class="t">Overlap</span></div>
      <h2>Where our customers already meet</h2>
      <p class="lead">The fastest distribution is the customer you both already serve. Here's the shape of the overlap.</p>
      <table>
        <tr><th>Segment</th><th>Shared base</th><th>Overlap</th></tr>
        ${c.list('overlap').map((it) => `<tr><td>${it.t('segment')}</td><td>${it.t('base')}</td><td><div class="track"><div class="fill" style="width:${it.pct('pct')}%"></div></div></td></tr>`).join('')}
      </table>
    </section>
    <section>
      <div class="eyebrow"><span class="n">03</span><span class="ln"></span><span class="t">Channel value</span></div>
      <h2>The unit economics of the channel</h2>
      <div class="cards">
        ${c.list('channel_value').map((it) => `<div class="c"><div class="v">${it.t('value')}</div><div class="l">${it.t('label')}</div></div>`).join('')}
      </div>
    </section>
    <section>
      <div class="eyebrow"><span class="n">04</span><span class="ln"></span><span class="t">Rollout</span></div>
      <h2>Three ways to integrate</h2>
      <div class="opts">
        ${c.list('rollout').map((it) => `<div class="o"><h3>${it.t('title')}</h3><p>${it.t('body')}</p><div class="meta"><span>${it.t('lift')}</span><span>${it.t('time')}</span></div></div>`).join('')}
      </div>
    </section>
    <section class="ctaSec" id="next"><div class="wrap two" style="padding:0;max-width:none;">
      <div><h2>${a.c}</h2><p>Send your overlap assumptions and we'll come back with a modelled channel plan — no slideware.</p></div>
      <form id="wl-form">${honeypotField()}<label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@partner.com" required />
        <button type="submit" class="btn">${a.c}</button>
        <div id="wl-msg" aria-live="polite"></div>
      </form>
    </div></section>
    <footer><span>${logoChip(bk, 18, 5)} ${name} · Distribution brief</span><span>Built with Axal VC</span></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'partner', bk.nonce)}
</body></html>`;
}

// ── Template: Pilot Partner Page (Task #25) — Swiss 12-col pilot recruiter ──
function renderPilotPartnerPage(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, name } = bk;
  const a = aud.partner; const btnInk = contrastText(color);
  const ctaInk = contrastText(inkColor);
  const c = landingContent(row, 'pilot-partner-page');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_SANS};line-height:1.6;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:1080px;margin:0 auto;padding:0 32px;}
  .label{font-family:${PORT_MONO};font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${accent};}
  .muted{opacity:.6;}
  nav{border-bottom:1px solid ${secondary};}
  nav .row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;}
  .brand{display:flex;align-items:center;gap:9px;}
  .brand b{font-family:${PORT_SERIF};font-weight:400;font-size:20px;}
  .brand .vc{font-family:${PORT_MONO};font-size:10px;letter-spacing:.14em;opacity:.55;}
  .navcta{font-size:13px;text-decoration:none;background:${color};color:${btnInk};border-radius:999px;padding:8px 16px;font-weight:600;}
  hr{border:0;border-top:1px solid ${secondary};margin:0;}
  .sec{display:grid;grid-template-columns:4fr 8fr;gap:40px;padding:56px 0;}
  .sec .head .t{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(24px,3vw,34px);margin:10px 0 0;letter-spacing:-.01em;}
  .hero .h1{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(40px,6vw,72px);line-height:1.02;letter-spacing:-.02em;margin:14px 0 18px;}
  .hero p{font-size:18px;opacity:.78;margin:0 0 26px;max-width:54ch;}
  .btn{display:inline-block;font-size:13px;font-weight:600;background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:999px;padding:13px 24px;cursor:pointer;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .glance{border:1px solid ${secondary};border-radius:12px;padding:6px 20px;}
  .glance .r{display:flex;justify-content:space-between;gap:12px;padding:14px 0;border-top:1px dashed ${secondary};font-size:14px;}
  .glance .r:first-child{border-top:0;}.glance .r .v{font-family:${PORT_MONO};color:${accent};}
  .who{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
  .who .c{border:1px solid ${secondary};border-radius:10px;padding:20px;background:${secondary}33;}
  .who .c h3{font-family:${PORT_SERIF};font-weight:400;font-size:18px;margin:0 0 6px;}.who .c p{margin:0;font-size:14px;opacity:.72;}
  .incl{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:${secondary};border:1px solid ${secondary};border-radius:10px;overflow:hidden;}
  .incl .c{background:${bgColor};padding:22px 20px;}
  .incl .n{font-family:${PORT_MONO};font-size:11px;color:${accent};}
  .incl h3{font-size:16px;margin:8px 0 6px;}.incl p{margin:0;font-size:14px;opacity:.72;}
  .steps{display:flex;gap:0;flex-wrap:wrap;}
  .steps .s{flex:1;min-width:120px;border-left:1px solid ${secondary};padding:0 16px;}
  .steps .s:first-child{border-left:0;padding-left:0;}
  .steps .k{font-family:${PORT_MONO};font-size:11px;color:${accent};}
  .steps .v{font-size:14px;margin-top:6px;}
  .ctaSec{background:${inkColor};color:${ctaInk};padding:64px 0;}
  .ctaSec .in{display:grid;grid-template-columns:4fr 8fr;gap:40px;align-items:center;}
  .ctaSec h2{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(28px,4vw,44px);margin:0;color:${ctaInk};}
  .ctaSec p{opacity:.82;margin:0 0 20px;}
  form{display:flex;gap:10px;flex-wrap:wrap;max-width:440px;}
  input{flex:1 1 220px;font-size:14px;padding:13px 15px;border:1px solid ${ctaInk}40;border-radius:999px;background:transparent;color:${ctaInk};outline:none;}
  input::placeholder{color:${ctaInk}80;}input:focus{border-color:${accent};}
  .wl-ok,.wl-err{font-size:13px;min-height:18px;margin-top:10px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:22px 0;font-size:11px;opacity:.55;font-family:${PORT_MONO};flex-wrap:wrap;gap:8px;}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:820px){.sec,.ctaSec .in{grid-template-columns:1fr;}.who{grid-template-columns:1fr;}.incl{grid-template-columns:1fr;}}
</style></head><body>
  <nav><div class="wrap row">
    <div class="brand">${logoChip(bk, 26, 6)}<b>${name}</b><span class="vc">/ pilot</span></div>
    <a class="navcta" href="#apply">${a.c}</a>
  </div></nav>
  <div class="wrap">
    <header class="sec hero">
      <div class="head"><div class="label">Pilot cohort · rolling intake</div></div>
      <div>
        <div class="h1">${a.h}</div>
        <p>${a.b}</p>
        <a class="btn" href="#apply">${a.c}</a>
        <div class="label muted" style="margin-top:16px;">Next kickoff — within 2 weeks of fit call</div>
      </div>
    </header>
    <hr/>
    <section class="sec">
      <div class="head"><div class="label">At a glance</div><div class="t">The shape of the pilot</div></div>
      <div class="glance">
        ${c.list('glance').map((it) => `<div class="r"><span>${it.t('label')}</span><span class="v">${it.t('value')}</span></div>`).join('')}
      </div>
    </section>
    <hr/>
    <section class="sec">
      <div class="head"><div class="label">01 — Who it's for</div><div class="t">A good pilot partner</div></div>
      <div class="who">
        ${c.list('who').map((it) => `<div class="c"><h3>${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
      </div>
    </section>
    <hr/>
    <section class="sec">
      <div class="head"><div class="label">02 — What it includes</div><div class="t">What you get</div></div>
      <div class="incl">
        ${c.list('includes').map((it, i) => `<div class="c"><div class="n">${String(i + 1).padStart(2, '0')}</div><h3>${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
      </div>
    </section>
    <hr/>
    <section class="sec">
      <div class="head"><div class="label">03 — Process</div><div class="t">From hello to results</div></div>
      <div class="steps">
        ${c.list('steps').map((it) => `<div class="s"><div class="k">${it.t('label')}</div><div class="v">${it.t('value')}</div></div>`).join('')}
      </div>
    </section>
  </div>
  <section class="ctaSec" id="apply"><div class="wrap in">
    <h2>${a.c}</h2>
    <div><p>Tell us where it hurts. If there's a fit, we'll set up a 30-minute call this week.</p>
      <form id="wl-form">${honeypotField()}<label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@company.com" required />
        <button type="submit" class="btn">${a.c}</button></form>
      <div id="wl-msg" aria-live="polite"></div>
    </div>
  </div></section>
  <div class="wrap"><footer><span>${logoChip(bk, 18, 5)} ${name} · Pilot</span><span>Built with Axal VC</span></footer></div>
${singleWaitlistScript(bk.apiWaitlist, 'partner', bk.nonce)}
</body></html>`;
}

// ── Template: Partner Hub (Task #25) — calm teal BD landing ──
function renderPartnerHub(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, name } = bk;
  const a = aud.partner; const btnInk = contrastText(color);
  const ctaInk = contrastText(inkColor);
  const c = landingContent(row, 'partner-hub');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_SANS};line-height:1.65;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:1100px;margin:0 auto;padding:0 32px;}
  .eyebrow{display:inline-flex;align-items:center;gap:12px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${accent};font-weight:600;}
  .eyebrow::before{content:"";width:24px;height:1px;background:${accent};}
  nav{position:sticky;top:0;z-index:5;height:64px;display:flex;align-items:center;background:${bgColor}cc;backdrop-filter:blur(8px);border-bottom:1px solid ${secondary};}
  nav .row{display:flex;align-items:center;justify-content:space-between;width:100%;}
  .brand{display:flex;align-items:center;gap:10px;}
  .mark{width:28px;height:28px;border-radius:7px;background:${inkColor};display:flex;align-items:center;justify-content:center;color:${ctaInk};font-weight:800;font-size:14px;}
  .brand b{font-family:${PORT_SERIF};font-weight:400;font-size:20px;}
  .navcta{font-size:13px;text-decoration:none;background:${color};color:${btnInk};border-radius:8px;padding:9px 16px;font-weight:600;}
  .hero{padding:84px 0 60px;background:linear-gradient(180deg,${accent}14,transparent);}
  .hero h1{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(42px,6.2vw,74px);line-height:1.04;letter-spacing:-.02em;margin:18px 0 18px;}
  .hero p{font-size:19px;opacity:.78;max-width:60ch;margin:0 0 28px;}
  .btn{display:inline-block;font-size:14px;font-weight:600;background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:9px;padding:13px 22px;cursor:pointer;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .ghost{display:inline-block;margin-left:8px;font-size:14px;text-decoration:none;border:1px solid ${secondary};border-radius:9px;padding:12px 20px;}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;border-top:1px solid ${secondary};margin-top:48px;padding-top:28px;}
  .stats .v{font-family:${PORT_SERIF};font-size:clamp(26px,3vw,38px);color:${accent};}
  .stats .l{font-size:11px;text-transform:uppercase;letter-spacing:.1em;opacity:.6;margin-top:4px;}
  section{padding:60px 0;border-top:1px solid ${secondary};}
  h2{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(26px,3.4vw,40px);margin:14px 0 0;letter-spacing:-.01em;}
  .split{display:grid;grid-template-columns:1fr 2fr;gap:40px;align-items:start;}
  .split p{opacity:.76;font-size:16px;margin:14px 0 0;}
  .why{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:${secondary};border:1px solid ${secondary};border-radius:14px;overflow:hidden;}
  .why .c{background:${bgColor};padding:26px 22px;}
  .why .n{font-family:${PORT_MONO};font-size:12px;color:${accent};}
  .why h3{font-family:${PORT_SERIF};font-weight:400;font-size:19px;margin:10px 0 6px;}.why p{margin:0;opacity:.74;font-size:14px;}
  .models{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;}
  .model{border:1px solid ${secondary};border-radius:14px;padding:24px;box-shadow:0 10px 30px ${inkColor}0d;}
  .model .tag{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:${accent};font-weight:700;}
  .model h3{font-family:${PORT_SERIF};font-weight:400;font-size:20px;margin:10px 0 12px;}
  .model ul{margin:0;padding-left:18px;font-size:14px;opacity:.78;}.model li{margin-bottom:6px;}
  .quote{border:1px solid ${secondary};border-radius:16px;padding:30px;background:${secondary}33;}
  .quote p{font-family:${PORT_SERIF};font-size:clamp(20px,2.4vw,26px);margin:0 0 14px;line-height:1.35;}
  .quote .who{font-size:13px;opacity:.6;}
  .ctaSec{background:${inkColor};color:${ctaInk};}
  .ctaSec .in{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start;padding:64px 0;}
  .ctaSec h2{color:${ctaInk};margin:0 0 14px;}.ctaSec p{opacity:.82;}
  .ctaSec ul{padding-left:18px;opacity:.82;font-size:14px;}
  .card{background:${bgColor};color:${inkColor};border-radius:14px;padding:26px;}
  form{display:flex;flex-direction:column;gap:12px;}
  input,textarea{font-family:inherit;font-size:14px;padding:12px 14px;border:1px solid ${secondary};border-radius:9px;background:${bgColor};color:${inkColor};outline:none;}
  input:focus,textarea:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}26;}
  .card .btn{align-self:flex-start;}
  .wl-ok,.wl-err{font-size:13px;min-height:18px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:24px 0;font-size:12px;opacity:.55;flex-wrap:wrap;gap:8px;}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:840px){.stats,.why,.models{grid-template-columns:1fr;}.split,.ctaSec .in{grid-template-columns:1fr;}}
</style></head><body>
  <nav><div class="wrap row">
    <div class="brand">${logoChip(bk, 26, 6)}<b>${name}</b></div>
    <a class="navcta" href="#partner">${a.c} →</a>
  </div></nav>
  <header class="hero"><div class="wrap">
    <div class="eyebrow">Partnerships</div>
    <h1>${a.h}</h1>
    <p>${a.b}</p>
    <a class="btn" href="#partner">${a.c}</a><a class="ghost" href="#models">See models</a>
    <div class="stats">
      ${c.list('stats').map((it) => `<div><div class="v">${it.t('value')}</div><div class="l">${it.t('label')}</div></div>`).join('')}
    </div>
  </div></header>
  <div class="wrap">
    <section><div class="split">
      <div><div class="eyebrow">Why partner</div><h2>Serious collaboration, not logos</h2></div>
      <div class="why">
        ${c.list('why').map((it, i) => `<div class="c"><div class="n">${String(i + 1).padStart(2, '0')}</div><h3>${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
      </div>
    </div></section>
    <section><div class="split">
      <div><div class="eyebrow">Shared fit</div><h2>The same customer wins twice</h2></div>
      <p>${c.t('shared_fit')}</p>
    </div></section>
    <section id="models"><div class="eyebrow">Models</div><h2 style="margin-bottom:24px;">Three ways to work together</h2>
      <div class="models">
        ${c.list('models').map((it) => `<div class="model"><div class="tag">${it.t('tag')}</div><h3>${it.t('title')}</h3><ul><li>${it.t('li1')}</li><li>${it.t('li2')}</li><li>${it.t('li3')}</li></ul></div>`).join('')}
      </div>
    </section>
    <section><div class="split">
      <div><div class="eyebrow">Traction</div><h2>What partners say</h2></div>
      <div class="quote"><p>"${c.t('quote')}"</p><div class="who">${c.t('quote_by')}</div></div>
    </div></section>
  </div>
  <section class="ctaSec" id="partner"><div class="wrap in">
    <div><h2>${a.c}</h2><p>Tell us about your customers and we'll come back with a concrete partnership shape.</p>
      <ul><li>Who your customers are</li><li>The overlap you see</li><li>What a win looks like</li></ul>
    </div>
    <div class="card"><form id="wl-form">${honeypotField()}
      <label for="wl-email" class="sr">Email</label>
      <input id="wl-email" type="email" name="email" placeholder="you@partner.com" required />
      <button type="submit" class="btn">${a.c}</button>
    </form><div id="wl-msg" aria-live="polite"></div></div>
  </div></section>
  <div class="wrap"><footer><span>${logoChip(bk, 18, 5)} ${name}</span><span>Built with Axal VC</span></footer></div>
${singleWaitlistScript(bk.apiWaitlist, 'partner', bk.nonce)}
</body></html>`;
}

// ── Template: Partner Pipeline Pro (Task #25) — financial-tech distribution pitch ──
function renderPartnerPipelinePro(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, name } = bk;
  const a = aud.partner; const brand = name || 'our company'; const btnInk = contrastText(color);
  const ctaInk = contrastText(inkColor);
  const c = landingContent(row, 'partner-pipeline-pro');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_SANS};line-height:1.6;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:1100px;margin:0 auto;padding:0 32px;}
  .slabel{display:flex;align-items:center;gap:12px;margin-bottom:18px;}
  .slabel .n{font-family:${PORT_MONO};font-size:11px;color:${accent};letter-spacing:.1em;}
  .slabel .ln{width:40px;height:1px;background:${secondary};}
  .slabel .t{font-family:${PORT_MONO};font-size:10px;letter-spacing:.16em;text-transform:uppercase;opacity:.55;}
  nav{position:sticky;top:0;z-index:5;background:${bgColor}e6;backdrop-filter:blur(8px);border-bottom:1px solid ${secondary};}
  nav .row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;}
  .brand{display:flex;align-items:center;gap:10px;}
  .mark{width:26px;height:26px;border-radius:6px;background:${inkColor};color:${ctaInk};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;}
  .brand b{font-weight:700;font-size:15px;}.brand .tag{font-size:12px;opacity:.55;}
  .navcta{font-size:13px;text-decoration:none;background:${color};color:${btnInk};border-radius:7px;padding:8px 15px;font-weight:600;}
  .hero{padding:66px 0;border-bottom:1px solid ${secondary};display:grid;grid-template-columns:2fr 1fr;gap:44px;align-items:start;}
  .hero h1{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(40px,5.6vw,68px);line-height:1.02;letter-spacing:-.02em;margin:0 0 18px;}
  .hero h1 em{font-style:italic;color:${accent};}
  .hero p{font-size:17px;opacity:.78;margin:0 0 24px;}
  .btn{display:inline-block;font-size:13px;font-weight:600;background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:7px;padding:12px 22px;cursor:pointer;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .glance{border:1px solid ${secondary};border-radius:10px;padding:6px 18px;}
  .glance .r{display:flex;justify-content:space-between;gap:12px;padding:13px 0;border-top:1px solid ${secondary};font-size:13px;}
  .glance .r:first-child{border-top:0;}.glance .r .v{font-family:${PORT_MONO};color:${accent};}
  section{padding:58px 0;border-bottom:1px solid ${secondary};}
  h2{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(26px,3.2vw,40px);margin:0 0 8px;letter-spacing:-.01em;}
  .lead{font-size:16px;opacity:.76;max-width:62ch;margin:0 0 26px;}
  .nums{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:${secondary};border:1px solid ${secondary};border-radius:10px;overflow:hidden;}
  .nums .c{background:${bgColor};padding:22px 18px;}
  .nums .v{font-family:${PORT_SERIF};font-style:italic;font-size:clamp(26px,3vw,38px);color:${accent};}
  .nums .l{font-size:12px;opacity:.7;margin-top:6px;}
  table{width:100%;border-collapse:collapse;font-size:14px;}
  th,td{text-align:left;padding:13px 12px;border-bottom:1px dashed ${secondary};}
  th{font-family:${PORT_MONO};font-size:10px;letter-spacing:.1em;text-transform:uppercase;opacity:.55;}
  td.delta{color:${accent};font-family:${PORT_MONO};}
  .opts{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
  .opt{border:1px solid ${secondary};border-radius:12px;padding:22px;}
  .opt.hl{border-color:${accent};box-shadow:0 0 0 1px ${accent};background:${accent}0d;}
  .opt h3{margin:0 0 6px;font-size:17px;}.opt p{margin:0;opacity:.72;font-size:14px;}
  .opt .pin{font-family:${PORT_MONO};font-size:10px;color:${accent};letter-spacing:.12em;text-transform:uppercase;}
  .timeline{display:flex;gap:0;flex-wrap:wrap;margin-top:24px;}
  .timeline .s{flex:1;min-width:110px;border-left:1px solid ${secondary};padding:0 14px;}
  .timeline .s:first-child{border-left:0;padding-left:0;}
  .timeline .k{font-family:${PORT_MONO};font-size:11px;color:${accent};}.timeline .v{font-size:14px;margin-top:6px;}
  .quote{border-left:3px solid ${accent};padding-left:20px;}
  .quote p{font-family:${PORT_SERIF};font-size:clamp(20px,2.4vw,26px);margin:0 0 10px;}.quote .w{font-size:13px;opacity:.6;}
  .ctaBox{border:1px dashed ${secondary};border-radius:14px;padding:30px;margin-top:8px;}
  .ctaBox h2{margin-bottom:8px;}
  form{display:flex;gap:10px;flex-wrap:wrap;max-width:460px;margin-top:8px;}
  input{flex:1 1 240px;font-size:14px;padding:13px 15px;border:1px solid ${secondary};border-radius:8px;background:${bgColor};color:${inkColor};outline:none;}
  input:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}26;}
  .wl-ok,.wl-err{font-size:13px;min-height:18px;margin-top:10px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:22px 0;font-size:11px;opacity:.55;font-family:${PORT_MONO};flex-wrap:wrap;gap:8px;}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:840px){.hero{grid-template-columns:1fr;}.nums,.opts{grid-template-columns:1fr;}}
</style></head><body>
  <nav><div class="wrap row">
    <div class="brand">${logoChip(bk, 26, 6)}<b>${name}</b><span class="tag">Distribution brief</span></div>
    <a class="navcta" href="#fit">${a.c} →</a>
  </div></nav>
  <div class="wrap">
    <header class="hero">
      <div>
        <h1>The <em>${brand}</em> distribution case, modelled — not asserted.</h1>
        <p>${a.b}</p>
        <a class="btn" href="#fit">${a.c}</a>
      </div>
      <div class="glance">
        ${c.list('glance').map((it) => `<div class="r"><span>${it.t('label')}</span><span class="v">${it.t('value')}</span></div>`).join('')}
      </div>
    </header>
    <section>
      <div class="slabel"><span class="n">01</span><span class="ln"></span><span class="t">Customer overlap</span></div>
      <h2>The same customers, twice the value</h2>
      <p class="lead">We don't have to convince you the market exists — you already serve it. Here's the overlap.</p>
      <div class="nums">
        ${c.list('overlap_nums').map((it) => `<div class="c"><div class="v">${it.t('value')}</div><div class="l">${it.t('label')}</div></div>`).join('')}
      </div>
    </section>
    <section>
      <div class="slabel"><span class="n">02</span><span class="ln"></span><span class="t">Channel value</span></div>
      <h2>What changes with ${brand}</h2>
      <table>
        <tr><th>Lever</th><th>Baseline</th><th>With ${brand}</th><th>Delta</th></tr>
        ${c.list('levers').map((it) => `<tr><td>${it.t('lever')}</td><td>${it.t('baseline')}</td><td>${it.t('with')}</td><td class="delta">${it.t('delta')}</td></tr>`).join('')}
      </table>
    </section>
    <section>
      <div class="slabel"><span class="n">03</span><span class="ln"></span><span class="t">Integration &amp; rollout</span></div>
      <h2>Pick the path your risk team will sign</h2>
      <div class="opts">
        ${c.list('options').map((it, i) => `<div class="opt${i === 1 ? ' hl' : ''}"><div class="pin">${it.t('pin')}</div><h3>${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
      </div>
      <div class="timeline">
        ${c.list('timeline').map((it) => `<div class="s"><div class="k">${it.t('label')}</div><div class="v">${it.t('value')}</div></div>`).join('')}
      </div>
    </section>
    <section>
      <div class="slabel"><span class="n">04</span><span class="ln"></span><span class="t">Proof of demand</span></div>
      <div class="quote"><p>"${c.t('quote')}"</p><div class="w">${c.t('quote_by')}</div></div>
    </section>
    <div class="ctaBox" id="fit">
      <h2>${a.c}</h2>
      <p class="lead">Send your overlap assumptions ahead and we'll bring a modelled channel plan to a working session.</p>
      <form id="wl-form">${honeypotField()}<label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@partner.com" required />
        <button type="submit" class="btn">${a.c}</button></form>
      <div id="wl-msg" aria-live="polite"></div>
    </div>
    <footer><span>${logoChip(bk, 18, 5)} ${name} · Distribution brief</span><span>Built with Axal VC</span></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'partner', bk.nonce)}
</body></html>`;
}

// ── Template: Co-Founder Builder (Task #25) — engineering-doc co-founder brief ──
function renderCoFounderBuilder(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, name } = bk;
  const a = aud.cofounder; const brand = name || 'our company'; const btnInk = contrastText(color);
  const c = landingContent(row, 'co-founder-builder');
  const danger = '#c2452f';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_SANS};line-height:1.6;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:1080px;margin:0 auto;padding:0 32px;}
  .lm{font-family:${PORT_MONO};font-size:10px;letter-spacing:.16em;text-transform:uppercase;}
  nav{position:sticky;top:0;z-index:5;height:56px;display:flex;align-items:center;background:${bgColor}d9;backdrop-filter:blur(6px);border-bottom:1px solid ${secondary};}
  nav .row{display:flex;align-items:center;justify-content:space-between;width:100%;}
  .brand{display:flex;align-items:center;gap:9px;}
  .sq{width:12px;height:12px;border-radius:3px;background:${accent};}
  .brand b{font-family:${PORT_MONO};font-size:13px;}.brand .m{font-family:${PORT_MONO};font-size:13px;opacity:.5;}
  .navcta{font-family:${PORT_MONO};font-size:12px;text-decoration:none;background:${color};color:${btnInk};border-radius:6px;padding:7px 14px;font-weight:600;}
  .hero{position:relative;padding:84px 0 56px;border-bottom:1px solid ${secondary};overflow:hidden;}
  .hero .grid{position:absolute;inset:0;background-image:linear-gradient(${secondary} 1px,transparent 1px),linear-gradient(90deg,${secondary} 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse at 25% 15%,#000,transparent 70%);mask-image:radial-gradient(ellipse at 25% 15%,#000,transparent 70%);opacity:.5;}
  .hero .in{position:relative;}
  .badge{display:inline-flex;align-items:center;gap:9px;font-family:${PORT_MONO};font-size:11px;border:1px solid ${secondary};border-radius:999px;padding:6px 13px;}
  .pulse{width:8px;height:8px;border-radius:50%;background:${accent};box-shadow:0 0 0 0 ${accent};animation:pg 1.8s infinite;}
  @keyframes pg{0%{box-shadow:0 0 0 0 ${accent}66;}70%{box-shadow:0 0 0 8px ${accent}00;}100%{box-shadow:0 0 0 0 ${accent}00;}}
  .hero h1{font-size:clamp(38px,5.4vw,64px);line-height:1.05;letter-spacing:-.02em;margin:22px 0 16px;font-weight:600;}
  .hero p{font-size:18px;opacity:.74;max-width:58ch;margin:0 0 26px;}
  .btn{display:inline-block;font-family:${PORT_MONO};font-size:12px;font-weight:600;background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:7px;padding:13px 22px;cursor:pointer;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .ghost{display:inline-block;margin-left:8px;font-family:${PORT_MONO};font-size:12px;text-decoration:none;border:1px solid ${secondary};border-radius:7px;padding:12px 18px;}
  .data{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:${secondary};border:1px solid ${secondary};margin-top:44px;}
  .data .c{background:${bgColor};padding:20px 18px;}
  .data .k{font-family:${PORT_MONO};font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.5;}
  .data .v{font-family:${PORT_MONO};font-size:20px;margin-top:6px;color:${accent};}
  section{padding:58px 0;border-bottom:1px solid ${secondary};}
  .eyebrow{display:flex;align-items:center;gap:14px;margin-bottom:18px;}
  .eyebrow .n{font-family:${PORT_MONO};font-size:12px;color:${accent};}
  .eyebrow .t{font-family:${PORT_MONO};font-size:10px;letter-spacing:.16em;text-transform:uppercase;opacity:.55;}
  .eyebrow .ln{flex:1;height:1px;background:${secondary};}
  h2{font-size:clamp(24px,3vw,34px);margin:0 0 16px;font-weight:600;letter-spacing:-.01em;}
  .lead{font-size:16px;opacity:.78;max-width:60ch;}
  .panes{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:${secondary};border:1px solid ${secondary};}
  .panes .p{background:${bgColor};padding:24px 22px;}
  .panes h3{font-family:${PORT_MONO};font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 14px;}
  .panes ul{list-style:none;margin:0;padding:0;font-size:14px;}
  .panes li{display:flex;gap:10px;margin-bottom:10px;opacity:.85;}
  .panes li .ic{font-family:${PORT_MONO};font-weight:700;}
  .ship .ic{color:${accent};}.weak .ic{color:${danger};}
  ol.road{counter-reset:r;list-style:none;margin:0;padding:0;}
  ol.road li{display:flex;gap:14px;padding:14px 0;border-top:1px solid ${secondary};font-size:15px;}
  ol.road li:first-child{border-top:0;}
  ol.road li::before{counter-increment:r;content:"0" counter(r);font-family:${PORT_MONO};color:${accent};font-size:13px;}
  .equity{border:1px solid ${secondary};border-radius:12px;padding:24px;}
  .equity .r{display:flex;gap:12px;padding:11px 0;border-top:1px solid ${secondary};font-size:14px;}
  .equity .r:first-child{border-top:0;}.equity .r .arr{color:${accent};font-family:${PORT_MONO};}
  .ctaSec{position:relative;padding:76px 0;text-align:center;overflow:hidden;}
  .ctaSec .grid{position:absolute;inset:0;background-image:linear-gradient(${secondary} 1px,transparent 1px),linear-gradient(90deg,${secondary} 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse at 50% 50%,#000,transparent 70%);mask-image:radial-gradient(ellipse at 50% 50%,#000,transparent 70%);opacity:.45;}
  .ctaSec .in{position:relative;}
  .ctaSec h2{font-size:clamp(28px,4vw,46px);}
  .ctaSec p{opacity:.76;margin:0 auto 24px;max-width:48ch;}
  form{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;max-width:440px;margin:0 auto;}
  input{font-family:${PORT_MONO};flex:1 1 230px;font-size:14px;padding:13px 15px;border:1px solid ${secondary};border-radius:7px;background:${bgColor};color:${inkColor};outline:none;}
  input:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}26;}
  .wl-ok,.wl-err{font-size:13px;min-height:18px;margin-top:12px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:22px 0;font-family:${PORT_MONO};font-size:10px;letter-spacing:.1em;text-transform:uppercase;opacity:.5;flex-wrap:wrap;gap:8px;}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:820px){.data,.panes{grid-template-columns:1fr;}}
</style></head><body>
  <nav><div class="wrap row">
    <div class="brand">${logoChip(bk, 24, 5)}<b>${name}</b><span class="m">/founding-eng</span></div>
    <a class="navcta" href="#apply">${a.c}</a>
  </div></nav>
  <div class="wrap">
    <header class="hero"><div class="grid"></div><div class="in">
      <span class="badge"><span class="pulse"></span> Pre-seed · Founding engineer · Equity-led</span>
      <h1>${a.h}</h1>
      <p>${a.b}</p>
      <a class="btn" href="#apply">${a.c}</a><a class="ghost" href="#state">Where we actually are</a>
      <div class="data">
        ${c.list('data').map((it) => `<div class="c"><div class="k">${it.t('key')}</div><div class="v">${it.t('value')}</div></div>`).join('')}
      </div>
    </div></header>
    <section>
      <div class="eyebrow"><span class="n">01</span><span class="t">Vision</span><span class="ln"></span></div>
      <h2>What ${brand} is really building</h2>
      <p class="lead">${c.t('vision')}</p>
    </section>
    <section id="state">
      <div class="eyebrow"><span class="n">02</span><span class="t">Current state</span><span class="ln"></span></div>
      <h2>Honest, not polished</h2>
      <div class="panes">
        <div class="p ship"><h3>Shipped</h3><ul>
          ${c.list('shipped').map((it) => `<li><span class="ic">+</span><span>${it.t('body')}</span></li>`).join('')}
        </ul></div>
        <div class="p weak"><h3>Weak points</h3><ul>
          ${c.list('weak').map((it) => `<li><span class="ic">!</span><span>${it.t('body')}</span></li>`).join('')}
        </ul></div>
      </div>
    </section>
    <section>
      <div class="eyebrow"><span class="n">03</span><span class="t">Roadmap</span><span class="ln"></span></div>
      <h2>Your first 90 days</h2>
      <ol class="road">
        ${c.list('roadmap').map((it) => `<li>${it.t('body')}</li>`).join('')}
      </ol>
    </section>
    <section>
      <div class="eyebrow"><span class="n">04</span><span class="t">Equity</span><span class="ln"></span></div>
      <h2>The offer, plainly</h2>
      <div class="equity">
        ${c.list('equity').map((it) => `<div class="r"><span class="arr">&rarr;</span><span>${it.t('body')}</span></div>`).join('')}
      </div>
    </section>
  </div>
  <section class="ctaSec" id="apply"><div class="grid"></div><div class="in wrap">
    <h2>${a.c}</h2>
    <p>No CV theater — we'd rather read your code. Drop your email and we'll send the brief and a time.</p>
    <form id="wl-form">${honeypotField()}<label for="wl-email" class="sr">Email</label>
      <input id="wl-email" type="email" name="email" placeholder="you@email.com" required />
      <button type="submit" class="btn">${a.c}</button></form>
    <div id="wl-msg" aria-live="polite"></div>
  </div></section>
  <div class="wrap"><footer><span>${logoChip(bk, 18, 5)} ${name} · founding eng</span><span>Built with Axal VC</span></footer></div>
${singleWaitlistScript(bk.apiWaitlist, 'cofounder', bk.nonce)}
</body></html>`;
}

// ── Template: Co-Founder Canvas (Task #25) — editorial serif founder letter ──
function renderCoFounderCanvas(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, name } = bk;
  const a = aud.cofounder; const btnInk = contrastText(color);
  const c = landingContent(row, 'co-founder-canvas');
  const gapInk = contrastText(inkColor);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_SANS};line-height:1.7;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:1040px;margin:0 auto;padding:0 32px;}
  .lm{font-family:${PORT_MONO};font-size:10px;letter-spacing:.2em;text-transform:uppercase;}
  nav{padding:22px 0;}
  nav .row{display:flex;align-items:center;justify-content:space-between;}
  .brand{display:flex;align-items:center;gap:9px;}
  .dot{width:8px;height:8px;border-radius:50%;background:${accent};}
  .brand b{font-family:${PORT_SERIF};font-size:22px;}
  .navcta{font-size:13px;text-decoration:none;border:1px solid ${inkColor};border-radius:999px;padding:8px 18px;}
  .slabel{display:flex;align-items:center;gap:14px;margin-bottom:18px;}
  .slabel .n{font-family:${PORT_MONO};font-size:11px;color:${accent};}
  .slabel .ln{flex:1;height:1px;background:${secondary};}
  .slabel .t{font-family:${PORT_MONO};font-size:10px;letter-spacing:.18em;text-transform:uppercase;opacity:.55;}
  .hero{padding:48px 0 56px;}
  .hero h1{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(46px,7.4vw,88px);line-height:1.0;letter-spacing:-.02em;margin:16px 0 26px;}
  .hero h1 em{font-style:italic;color:${accent};}
  .hero .body{font-size:20px;max-width:62ch;margin:0 0 16px;}
  .hero .body.muted{opacity:.7;font-size:17px;}
  .actions{margin:28px 0 0;}
  .btn{display:inline-block;font-size:14px;font-weight:600;background:${inkColor};color:${gapInk};text-decoration:none;border:0;border-radius:999px;padding:13px 26px;cursor:pointer;}
  .btn.acc{background:${color};color:${btnInk};}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .link{margin-left:16px;font-family:${PORT_MONO};font-size:12px;text-decoration:underline;}
  .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;border-top:1px solid ${secondary};margin-top:44px;padding-top:24px;}
  .facts .k{font-family:${PORT_MONO};font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.55;}
  .facts .v{font-size:20px;margin-top:6px;}
  section{padding:54px 0;border-top:1px solid ${secondary};}
  .split{display:grid;grid-template-columns:5fr 7fr;gap:40px;align-items:start;}
  h2{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(28px,4vw,48px);margin:0;letter-spacing:-.01em;line-height:1.08;}
  .split p{font-size:17px;opacity:.82;margin:0;}
  .three{display:grid;grid-template-columns:repeat(3,1fr);gap:30px;}
  .three .c .n{font-family:${PORT_MONO};font-size:12px;color:${accent};border-top:1px solid ${secondary};padding-top:14px;display:block;}
  .three .c h3{font-family:${PORT_SERIF};font-weight:400;font-size:22px;margin:10px 0 8px;}.three .c p{margin:0;opacity:.78;font-size:15px;}
  .builtlist{margin:0;padding:0;list-style:none;}
  .builtlist li{border-left:2px solid ${accent};padding:4px 0 4px 18px;margin-bottom:18px;}
  .builtlist li h3{font-family:${PORT_SERIF};font-weight:400;font-size:19px;margin:0 0 4px;}.builtlist li p{margin:0;opacity:.78;font-size:15px;}
  .gap{background:${inkColor};color:${gapInk};}
  .gap h2{color:${gapInk};font-size:clamp(40px,6vw,72px);}
  .gap .two{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin-top:24px;}
  .gap p{opacity:.85;font-size:16px;margin:0;}
  .cmp{display:grid;grid-template-columns:1fr 1fr;gap:36px;}
  .cmp h3{font-family:${PORT_MONO};font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 14px;}
  .cmp ul{margin:0;padding:0;list-style:none;font-size:15px;}.cmp li{padding:7px 0;opacity:.82;}.cmp li::before{content:"— ";color:${accent};}
  .offer{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:${secondary};border:1px solid ${secondary};margin-top:26px;}
  .offer .c{background:${bgColor};padding:24px 20px;}
  .offer .k{font-family:${PORT_MONO};font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.55;}
  .offer .v{font-size:clamp(20px,2.4vw,28px);margin-top:6px;}
  .cta{text-align:center;padding:72px 0;}
  .cta h2{font-size:clamp(40px,6vw,72px);}
  .cta h2 em{font-style:italic;color:${accent};}
  .steps{max-width:420px;margin:24px auto 28px;text-align:left;list-style:none;padding:0;counter-reset:s;}
  .steps li{display:flex;gap:14px;padding:12px 0;border-top:1px solid ${secondary};font-size:15px;}.steps li:first-child{border-top:0;}
  .steps li::before{counter-increment:s;content:"0" counter(s);font-family:${PORT_MONO};color:${accent};font-size:12px;}
  form{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;max-width:440px;margin:0 auto;}
  input{flex:1 1 230px;font-size:14px;padding:13px 16px;border:1px solid ${secondary};border-radius:999px;background:${bgColor};color:${inkColor};outline:none;}
  input:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}26;}
  .sig{font-family:${PORT_SERIF};font-style:italic;font-size:24px;margin-top:30px;}
  .sig .ti{font-family:${PORT_MONO};font-style:normal;font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.6;display:block;margin-top:6px;}
  .wl-ok,.wl-err{font-size:13px;min-height:18px;margin-top:12px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:22px 0;font-family:${PORT_MONO};font-size:10px;letter-spacing:.1em;text-transform:uppercase;opacity:.5;flex-wrap:wrap;gap:8px;}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:820px){.facts,.three,.offer{grid-template-columns:1fr;}.split,.gap .two,.cmp{grid-template-columns:1fr;}}
</style></head><body>
  <nav><div class="wrap row">
    <div class="brand">${logoChip(bk, 22, 6)}<b>${name}</b></div>
    <a class="navcta" href="#talk">Talk to me</a>
  </div></nav>
  <div class="wrap">
    <header class="hero">
      <div class="lm">A letter from the founder · 2026</div>
      <h1>${a.h} <em>I can't do it alone.</em></h1>
      <p class="body">${a.b}</p>
      <p class="body muted">I'd rather you see the shape of the hole than read a polished pitch. So here's the whole thing.</p>
      <div class="actions"><a class="btn acc" href="#talk">${a.c}</a><a class="link" href="#building">Read the whole thing first</a></div>
      <div class="facts">
        ${c.list('facts').map((it) => `<div><div class="k">${it.t('key')}</div><div class="v">${it.t('value')}</div></div>`).join('')}
      </div>
    </header>
    <section id="building"><div class="split">
      <h2>What we are building</h2>
      <p>${c.t('building')}</p>
    </div></section>
    <section>
      <div class="slabel"><span class="n">02</span><span class="ln"></span><span class="t">Why now</span></div>
      <div class="three">
        ${c.list('whynow').map((it, i) => `<div class="c"><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
      </div>
    </section>
    <section>
      <div class="slabel"><span class="n">03</span><span class="ln"></span><span class="t">Already built</span></div>
      <div class="split">
        <h2>You're not joining an idea</h2>
        <ul class="builtlist">
          ${c.list('built').map((it) => `<li><h3>${it.t('title')}</h3><p>${it.t('body')}</p></li>`).join('')}
        </ul>
      </div>
    </section>
  </div>
  <section class="gap"><div class="wrap">
    <div class="lm" style="color:${accent}">04 — What's missing</div>
    <h2>The gap is me.</h2>
    <div class="two">
      ${c.list('gap').map((it) => `<p>${it.t('body')}</p>`).join('')}
    </div>
  </div></section>
  <div class="wrap">
    <section>
      <div class="slabel"><span class="n">05</span><span class="ln"></span><span class="t">The role</span></div>
      <div class="cmp">
        <div><h3>You have probably</h3><ul>${c.list('role_have').map((it) => `<li>${it.t('body')}</li>`).join('')}</ul></div>
        <div><h3>You probably do not</h3><ul>${c.list('role_not').map((it) => `<li>${it.t('body')}</li>`).join('')}</ul></div>
      </div>
      <div class="offer">
        ${c.list('offer').map((it) => `<div class="c"><div class="k">${it.t('key')}</div><div class="v">${it.t('value')}</div></div>`).join('')}
      </div>
    </section>
    <div class="cta" id="talk">
      <h2>Let's <em>talk</em>.</h2>
      <ol class="steps">${c.list('steps').map((it) => `<li>${it.t('body')}</li>`).join('')}</ol>
      <form id="wl-form">${honeypotField()}<label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit" class="btn acc">${a.c}</button></form>
      <div id="wl-msg" aria-live="polite"></div>
      <div class="sig">— The founder<span class="ti">${name}</span></div>
    </div>
    <footer><span>${logoChip(bk, 18, 5)} ${name}</span><span>Built with Axal VC</span></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'cofounder', bk.nonce)}
</body></html>`;
}

// ── Template: Co-founder Connect (Task #25) — warm grain founder letter ──
function renderCofounderConnect(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, name } = bk;
  const a = aud.cofounder; const btnInk = contrastText(color);
  const c = landingContent(row, 'cofounder-connect');
  const ctaInk = contrastText(inkColor);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_SANS};line-height:1.7;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:1080px;margin:0 auto;padding:0 32px;}
  .lm{font-family:${PORT_MONO};font-size:11px;letter-spacing:.18em;text-transform:uppercase;}
  nav{position:sticky;top:0;z-index:5;background:${bgColor}cc;backdrop-filter:blur(8px);border-bottom:1px solid ${secondary};}
  nav .row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;}
  .brand{display:flex;align-items:center;gap:9px;}.dot{width:8px;height:8px;border-radius:50%;background:${accent};}
  .brand b{font-family:${PORT_SERIF};font-size:22px;}.brand em{font-style:italic;}
  .navcta{font-size:13px;text-decoration:none;background:${color};color:${btnInk};border-radius:999px;padding:8px 18px;font-weight:600;}
  .hero{position:relative;padding:72px 0 56px;border-bottom:1px solid ${secondary};}
  .hero::before{content:"";position:absolute;inset:0;background-image:radial-gradient(${inkColor}0d 1px,transparent 1px);background-size:5px 5px;opacity:.5;pointer-events:none;}
  .hero .in{position:relative;}
  .eyebrow{display:inline-flex;align-items:center;gap:10px;}
  .pulse{width:9px;height:9px;border-radius:50%;background:${accent};box-shadow:0 0 0 0 ${accent};animation:pg 1.8s infinite;}
  @keyframes pg{0%{box-shadow:0 0 0 0 ${accent}66;}70%{box-shadow:0 0 0 8px ${accent}00;}100%{box-shadow:0 0 0 0 ${accent}00;}}
  .hero h1{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(44px,6.8vw,84px);line-height:1.02;letter-spacing:-.02em;margin:20px 0 22px;}
  .hero h1 em{font-style:italic;color:${accent};}
  .hero p{font-size:19px;max-width:60ch;margin:0 0 14px;}
  .hero p.muted{opacity:.72;font-size:17px;}
  .actions{margin:26px 0 0;}
  .btn{display:inline-block;font-size:14px;font-weight:600;background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:999px;padding:13px 26px;cursor:pointer;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .ghost{display:inline-block;margin-left:10px;font-size:13px;text-decoration:none;border:1px solid ${inkColor};border-radius:999px;padding:12px 22px;}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;border-top:1px solid ${secondary};margin-top:44px;padding-top:24px;}
  .stats .k{font-family:${PORT_MONO};font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.55;}
  .stats .v{font-family:${PORT_SERIF};font-size:24px;margin-top:4px;}
  section{padding:56px 0;border-bottom:1px solid ${secondary};}
  .split{display:grid;grid-template-columns:5fr 7fr;gap:40px;align-items:start;}
  h2{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(26px,3.6vw,42px);margin:0;letter-spacing:-.01em;}
  .split p{font-size:17px;opacity:.82;margin:0;}
  .why{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:${secondary};border:1px solid ${secondary};margin-top:24px;}
  .why .c{background:${bgColor};padding:26px 22px;}
  .why .n{font-family:${PORT_MONO};font-size:12px;color:${accent};}
  .why h3{font-family:${PORT_SERIF};font-weight:400;font-size:20px;margin:10px 0 6px;}.why p{margin:0;opacity:.76;font-size:14px;}
  .rows{margin:0;padding:0;list-style:none;}
  .rows li{display:grid;grid-template-columns:1fr 2fr auto;gap:16px;align-items:center;padding:14px 0;border-top:1px solid ${secondary};}
  .rows li:first-child{border-top:0;}
  .rows .nm{font-family:${PORT_SERIF};font-size:18px;}.rows .ds{opacity:.74;font-size:14px;}
  .pill{font-family:${PORT_MONO};font-size:10px;letter-spacing:.1em;text-transform:uppercase;border:1px solid ${secondary};border-radius:999px;padding:4px 11px;}
  .pill.on{color:${accent};border-color:${accent};}
  .missing{background:${secondary}40;}
  .missing .grid{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:20px;}
  .missing h3{font-family:${PORT_SERIF};font-weight:400;font-size:22px;margin:0 0 8px;}
  .mark{background:linear-gradient(transparent 65%,${accent}40 65%);}
  .missing p{margin:0;opacity:.8;font-size:15px;}
  .role .terms{margin:0;padding:0;list-style:none;}
  .role .terms li{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-top:1px solid ${secondary};font-size:14px;}
  .role .terms li:first-child{border-top:0;}.role .terms .v{font-family:${PORT_MONO};color:${accent};}
  .cols3{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;margin-top:8px;}
  .cols3 h4{font-family:${PORT_MONO};font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 10px;}
  .cols3 ul{margin:0;padding:0;list-style:none;font-size:14px;}.cols3 li{padding:5px 0;opacity:.82;}.cols3 li::before{content:"— ";color:${accent};}
  .ctaSec{background:${inkColor};color:${ctaInk};padding:64px 0;}
  .ctaSec h2{color:${ctaInk};}.ctaSec h2 em{font-style:italic;color:${accent};}
  .ctaSec .steps{counter-reset:s;list-style:none;padding:0;max-width:520px;margin:22px 0 26px;}
  .ctaSec .steps li{display:flex;gap:14px;padding:11px 0;border-top:1px solid ${ctaInk}26;font-size:15px;opacity:.9;}.ctaSec .steps li:first-child{border-top:0;}
  .ctaSec .steps li::before{counter-increment:s;content:"0" counter(s);font-family:${PORT_MONO};color:${accent};font-size:12px;}
  form{display:flex;gap:10px;flex-wrap:wrap;max-width:440px;}
  input{flex:1 1 230px;font-size:14px;padding:13px 16px;border:1px solid ${ctaInk}40;border-radius:999px;background:transparent;color:${ctaInk};outline:none;}
  input::placeholder{color:${ctaInk}80;}input:focus{border-color:${accent};}
  .sig{font-family:${PORT_SERIF};font-style:italic;font-size:22px;margin-top:24px;}
  .wl-ok,.wl-err{font-size:13px;min-height:18px;margin-top:10px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:22px 0;font-size:11px;opacity:.55;flex-wrap:wrap;gap:8px;}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:820px){.stats,.why,.cols3{grid-template-columns:1fr;}.split,.missing .grid{grid-template-columns:1fr;}.rows li{grid-template-columns:1fr;}}
</style></head><body>
  <nav><div class="wrap row">
    <div class="brand">${logoChip(bk, 22, 6)}<b>${name}</b></div>
    <a class="navcta" href="#talk">Talk about joining</a>
  </div></nav>
  <header class="hero"><div class="wrap in">
    <div class="eyebrow lm"><span class="pulse"></span> A letter from the founder · June 2026</div>
    <h1>${a.h}</h1>
    <p>${a.b}</p>
    <p class="muted">I'd rather you see the shape of the hole than a polished pitch — so this is the honest version.</p>
    <div class="actions"><a class="btn" href="#talk">${a.c}</a><a class="ghost" href="#built">See what's built</a></div>
    <div class="stats">
      ${c.list('stats').map((it) => `<div><div class="k">${it.t('key')}</div><div class="v">${it.t('value')}</div></div>`).join('')}
    </div>
  </div></header>
  <div class="wrap">
    <section><div class="split">
      <h2>The mission, in one line</h2>
      <p>${c.t('mission')}</p>
    </div></section>
    <section>
      <h2 style="margin-bottom:24px;">Why now</h2>
      <div class="why">
        ${c.list('whynow').map((it, i) => `<div class="c"><div class="n">${String(i + 1).padStart(2, '0')}</div><h3>${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
      </div>
    </section>
    <section id="built"><div class="split">
      <h2>You are not joining an idea</h2>
      <ul class="rows">
        ${c.list('built').map((it) => `<li><span class="nm">${it.t('name')}</span><span class="ds">${it.t('desc')}</span><span class="pill${it.t('on') === 'yes' ? ' on' : ''}">${it.t('pill')}</span></li>`).join('')}
      </ul>
    </div></section>
    <section class="missing">
      <h2>What's missing, said plainly</h2>
      <div class="grid">
        ${c.list('missing').map((it) => `<div><h3 class="mark">${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
      </div>
    </section>
    <section class="role">
      <div class="split">
        <div><h2>The role</h2>
          <ul class="terms">
            ${c.list('role_terms').map((it) => `<li><span>${it.t('key')}</span><span class="v">${it.t('value')}</span></li>`).join('')}
          </ul>
        </div>
        <div class="cols3">
          ${c.list('cols3').map((it) => `<div><h4>${it.t('heading')}</h4><ul><li>${it.t('li1')}</li><li>${it.t('li2')}</li><li>${it.t('li3')}</li></ul></div>`).join('')}
        </div>
      </div>
    </section>
  </div>
  <section class="ctaSec" id="talk"><div class="wrap">
    <h2>Let's <em>talk</em> about building this together.</h2>
    <ol class="steps">${c.list('steps').map((it) => `<li>${it.t('body')}</li>`).join('')}</ol>
    <form id="wl-form">${honeypotField()}<label for="wl-email" class="sr">Email</label>
      <input id="wl-email" type="email" name="email" placeholder="you@email.com" required />
      <button type="submit" class="btn">${a.c}</button></form>
    <div id="wl-msg" aria-live="polite"></div>
    <div class="sig">— The founder, ${name}</div>
  </div></section>
  <div class="wrap"><footer><span>${logoChip(bk, 18, 5)} ${name}</span><span>Built with Axal VC</span></footer></div>
${singleWaitlistScript(bk.apiWaitlist, 'cofounder', bk.nonce)}
</body></html>`;
}

// ── Template: Co-Founder Quest (Task #25) — mission-framed co-founder call ──
function renderCoFounderQuest(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, name } = bk;
  const a = aud.cofounder; const btnInk = contrastText(color);
  const c = landingContent(row, 'co-founder-quest');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_SANS};line-height:1.7;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:880px;margin:0 auto;padding:0 28px;}
  .label{font-size:12px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:${accent};}
  nav{padding:24px 0;}
  nav .row{display:flex;align-items:center;justify-content:space-between;}
  .brand{font-weight:700;font-size:18px;}
  .navlink{font-size:14px;opacity:.65;text-decoration:none;}
  .hr{height:1px;background:${secondary};border:0;margin:0;}
  .hero{padding:40px 0 60px;}
  .hero h1{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(44px,7.4vw,80px);line-height:1.04;letter-spacing:-.01em;margin:18px 0 22px;}
  .hero p{font-size:19px;opacity:.82;max-width:60ch;margin:0 0 28px;}
  .btn{display:inline-block;font-size:14px;font-weight:600;background:${inkColor};color:${contrastText(inkColor)};text-decoration:none;border:0;border-radius:10px;padding:13px 24px;cursor:pointer;}
  .btn.acc{background:${color};color:${btnInk};}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .btn.ghost{background:transparent;color:${inkColor};border:1px solid ${secondary};margin-left:10px;}
  section{padding:54px 0;}
  .two{display:grid;grid-template-columns:1fr 1.4fr;gap:36px;align-items:start;}
  h2{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(26px,3.6vw,40px);margin:0;letter-spacing:-.01em;}
  .two p{margin:0 0 14px;opacity:.82;font-size:16px;}
  .built{margin:0;padding:0;list-style:none;}
  .built li{padding:14px 0;border-top:1px solid ${secondary};}
  .built li:first-child{border-top:0;}
  .built b{font-weight:700;}.built span{opacity:.78;}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:24px;}
  .card{border:1px solid ${secondary};border-radius:12px;padding:22px;}
  .card h3{font-family:${PORT_SERIF};font-weight:400;font-size:19px;margin:0 0 8px;}.card p{margin:0;opacity:.78;font-size:14px;}
  .boxes{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:24px;}
  .box{border:1px solid ${secondary};border-radius:12px;padding:22px;}
  .box.ideal{background:${accent}0d;border-color:${accent}55;}
  .box h3{font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin:0 0 12px;}
  .box ul{margin:0;padding:0;list-style:none;font-size:14px;}
  .box li{display:flex;gap:10px;padding:5px 0;opacity:.86;}
  .box li::before{content:"";width:7px;height:7px;border-radius:50%;background:${accent};margin-top:8px;flex:none;}
  .equity{background:${secondary}66;border-radius:14px;padding:26px;}
  .equity h3{font-family:${PORT_SERIF};font-weight:400;font-size:20px;margin:0 0 14px;}
  .equity .r{display:flex;justify-content:space-between;gap:12px;padding:9px 0;font-size:15px;}
  .equity .r .v{font-weight:700;}
  .team{display:grid;grid-template-columns:1fr 1fr;gap:24px;}
  .member b{font-family:${PORT_SERIF};font-weight:400;font-size:18px;}.member p{margin:6px 0 0;opacity:.76;font-size:14px;}
  .cta{text-align:center;padding:68px 0;}
  .cta h2{font-size:clamp(32px,5vw,52px);}
  .steps{max-width:420px;margin:22px auto 26px;text-align:left;list-style:none;padding:0;counter-reset:s;}
  .steps li{display:flex;gap:14px;padding:11px 0;border-top:1px solid ${secondary};font-size:15px;}.steps li:first-child{border-top:0;}
  .steps li::before{counter-increment:s;content:"0" counter(s);color:${accent};font-weight:700;font-size:13px;}
  form{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;max-width:440px;margin:0 auto;}
  input{flex:1 1 230px;font-size:14px;padding:13px 16px;border:1px solid ${secondary};border-radius:10px;background:${bgColor};color:${inkColor};outline:none;}
  input:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}26;}
  .note{font-size:13px;opacity:.6;margin-top:14px;}
  .wl-ok,.wl-err{font-size:13px;min-height:18px;margin-top:12px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  footer{padding:22px 0;font-size:12px;opacity:.55;text-align:center;}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:760px){.two,.boxes,.team{grid-template-columns:1fr;}.cards{grid-template-columns:1fr;}}
</style></head><body>
  <div class="wrap">
    <nav><div class="row"><div class="brand">${logoChip(bk, 24, 6)} ${name}</div><a class="navlink" href="#join">The role →</a></div></nav>
    <header class="hero">
      <div class="label">Co-founder search</div>
      <h1>${a.h}</h1>
      <p>${a.b}</p>
      <a class="btn acc" href="#join">${a.c}</a><a class="btn ghost" href="#need">What we need</a>
    </header>
    <hr class="hr"/>
    <section><div class="two">
      <div><div class="label">Timing</div><h2>Why this matters now</h2></div>
      <div>${c.list('timing').map((it) => `<p>${it.t('body')}</p>`).join('')}</div>
    </div></section>
    <hr class="hr"/>
    <section><div class="two">
      <div><div class="label">Progress</div><h2>What we have built</h2></div>
      <ul class="built">
        ${c.list('built').map((it) => `<li><b>${it.t('label')}</b> — <span>${it.t('body')}</span></li>`).join('')}
      </ul>
    </div></section>
    <hr class="hr"/>
    <section id="need">
      <div class="label">The gap</div><h2 style="margin-bottom:8px;">What we need</h2>
      <p style="opacity:.82;max-width:60ch;">A technical co-founder to own the build while we own the market. Here's the mission, in three parts.</p>
      <div class="cards">
        ${c.list('mission_cards').map((it) => `<div class="card"><h3>${it.t('title')}</h3><p>${it.t('body')}</p></div>`).join('')}
      </div>
      <div class="boxes">
        <div class="box ideal"><h3>Ideal profile</h3><ul>${c.list('ideal').map((it) => `<li>${it.t('body')}</li>`).join('')}</ul></div>
        <div class="box"><h3>First 90 days</h3><ul>${c.list('first90').map((it) => `<li>${it.t('body')}</li>`).join('')}</ul></div>
      </div>
    </section>
    <hr class="hr"/>
    <section><div class="two">
      <div><div class="label">Honest terms</div><h2>Equity &amp; collaboration</h2></div>
      <div class="equity"><h3>No games</h3>
        ${c.list('equity').map((it) => `<div class="r"><span>${it.t('key')}</span><span class="v">${it.t('value')}</span></div>`).join('')}
      </div>
    </div></section>
    <hr class="hr"/>
    <section>
      <div class="label">The team so far</div><h2 style="margin-bottom:20px;">Who you'd build with</h2>
      <div class="team">
        ${c.list('team').map((it) => `<div class="member"><b>${it.t('name')}</b><p>${it.t('body')}</p></div>`).join('')}
      </div>
    </section>
    <hr class="hr"/>
    <div class="cta" id="join">
      <div class="label">Join the build</div>
      <h2>Let's find out if it clicks</h2>
      <ol class="steps">${c.list('steps').map((it) => `<li>${it.t('body')}</li>`).join('')}</ol>
      <form id="wl-form">${honeypotField()}<label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit" class="btn acc">${a.c}</button></form>
      <div id="wl-msg" aria-live="polite"></div>
      <div class="note">No résumé required. A one-line "not now" is a complete reply.</div>
    </div>
    <footer>${logoChip(bk, 18, 5)} ${name} · Built with Axal VC</footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'cofounder', bk.nonce)}
</body></html>`;
}

// ── Template: Mentor Connect (Task #25) — minimal single-column mentor note ──
function renderMentorConnect(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, name } = bk;
  const a = aud.mentor; const btnInk = contrastText(color);
  const c = landingContent(row, 'mentor-connect');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_SANS};line-height:1.7;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:720px;margin:0 auto;padding:0 28px;}
  .mono{font-family:${PORT_MONO};font-size:11px;}
  .eyebrow{font-family:${PORT_MONO};font-size:12px;color:${accent};}
  nav{padding:22px 0;}
  nav .row{display:flex;align-items:center;justify-content:space-between;}
  .brand{display:flex;align-items:center;gap:9px;font-size:15px;}
  .dot{width:8px;height:8px;border-radius:50%;background:${accent};}
  .brand b{font-weight:700;}.brand span{opacity:.55;}
  .navlink{font-size:13px;opacity:.6;text-decoration:none;}
  .hero{padding:34px 0 44px;}
  .hero h1{font-size:clamp(34px,5.4vw,52px);line-height:1.1;letter-spacing:-.02em;font-weight:700;margin:0 0 20px;}
  .hero p{font-size:18px;opacity:.84;margin:0 0 12px;}
  .hero p.muted{opacity:.6;font-size:15px;}
  .toc{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px;}
  .toc a{font-size:13px;text-decoration:none;border:1px solid ${secondary};border-radius:999px;padding:6px 13px;opacity:.8;}
  section{padding:34px 0;border-top:1px solid ${secondary};}
  .sh{display:flex;align-items:baseline;gap:14px;margin-bottom:14px;}
  .sh .n{font-family:${PORT_MONO};font-size:12px;color:${accent};}
  .sh h2{font-size:21px;margin:0;font-weight:700;}
  p.body{margin:0 0 10px;opacity:.85;}
  .oneline{color:${inkColor};font-weight:600;opacity:1;}
  ol.help{margin:0;padding:0 0 0 20px;border-left:1px solid ${secondary};list-style:none;counter-reset:h;}
  ol.help li{padding:0 0 16px;}
  ol.help li b{display:block;}ol.help li span{font-size:14px;opacity:.78;}
  ul.qual{list-style:none;margin:0;padding:0;}
  ul.qual li{display:flex;gap:10px;padding:5px 0;opacity:.85;}
  ul.qual li::before{content:"";width:7px;height:7px;border-radius:50%;background:${accent};margin-top:9px;flex:none;}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;}
  .stats .k{font-family:${PORT_MONO};font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.55;}
  .stats .v{font-size:18px;font-weight:700;margin-top:4px;}
  .ask{border:1px solid ${secondary};border-radius:18px;padding:30px;box-shadow:0 12px 36px ${inkColor}0a;margin:34px 0;}
  .ask .eyebrow{margin-bottom:8px;}
  .ask h2{font-size:24px;margin:0 0 8px;font-weight:700;}
  .ask p{opacity:.82;margin:0 0 18px;}
  .btn{display:inline-block;font-size:14px;font-weight:600;background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:10px;padding:12px 22px;cursor:pointer;}
  .btn.ghost{background:transparent;color:${inkColor};border:1px solid ${secondary};margin-left:8px;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  form{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;}
  input{flex:1 1 220px;font-size:14px;padding:12px 15px;border:1px solid ${secondary};border-radius:10px;background:${bgColor};color:${inkColor};outline:none;}
  input:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}26;}
  .wl-ok,.wl-err{font-size:13px;min-height:18px;margin-top:10px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:20px 0;font-size:12px;opacity:.55;}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:560px){.stats{grid-template-columns:1fr;}}
</style></head><body>
  <div class="wrap">
    <nav><div class="row">
      <div class="brand">${logoChip(bk, 22, 6)}<b>${name}</b><span>· a note for a mentor</span></div>
      <a class="navlink" href="#ask">Skip to the ask</a>
    </div></nav>
    <header class="hero">
      <h1>${a.h}</h1>
      <p>${a.b}</p>
      <p class="muted">No pitch, no prep needed — we'd just value 30 minutes of your perspective.</p>
      <div class="toc"><a href="#building">What we're building</a><a href="#help">Where we need help</a><a href="#who">Why you</a><a href="#ask">The ask</a></div>
    </header>
    <section id="building">
      <div class="sh"><span class="n">01</span><h2>What we're building</h2></div>
      <p class="body">${c.t('building')}</p>
      <p class="body oneline">${c.t('oneline')}</p>
    </section>
    <section id="help">
      <div class="sh"><span class="n">02</span><h2>Where we need help</h2></div>
      <ol class="help">
        ${c.list('help').map((it) => `<li><b>${it.t('title')}</b><span>${it.t('body')}</span></li>`).join('')}
      </ol>
    </section>
    <section id="who">
      <div class="sh"><span class="n">03</span><h2>Experience that matters</h2></div>
      <ul class="qual">${c.list('qual').map((it) => `<li>${it.t('body')}</li>`).join('')}</ul>
    </section>
    <section>
      <div class="sh"><span class="n">04</span><h2>Progress so far</h2></div>
      <div class="stats">
        ${c.list('stats').map((it) => `<div><div class="k">${it.t('key')}</div><div class="v">${it.t('value')}</div></div>`).join('')}
      </div>
    </section>
    <div class="ask" id="ask">
      <div class="eyebrow">The ask</div>
      <h2>${a.c}</h2>
      <p>Thirty minutes, whenever suits you. A one-line "not this quarter" is a complete reply.</p>
      <form id="wl-form">${honeypotField()}<label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit" class="btn">${a.c}</button></form>
      <div id="wl-msg" aria-live="polite"></div>
    </div>
    <footer><span>${logoChip(bk, 18, 5)} ${name} · 2026</span><a class="navlink" href="#">Back to top ↑</a></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'mentor', bk.nonce)}
</body></html>`;
}

// ── Template: Mentor Connect Page (Task #25) — narrative serif mentor letter ──
function renderMentorConnectPage(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, name } = bk;
  const a = aud.mentor; const btnInk = contrastText(color);
  const c = landingContent(row, 'mentor-connect-page');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_SANS};line-height:1.7;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:880px;margin:0 auto;padding:0 28px;}
  .lm{font-family:${PORT_MONO};font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.6;}
  nav{padding:20px 0;border-bottom:1px solid ${secondary};}
  nav .row{display:flex;align-items:center;justify-content:space-between;}
  .brand{display:flex;align-items:center;gap:10px;}
  .sq{width:24px;height:24px;border-radius:6px;background:${inkColor};color:${contrastText(inkColor)};display:flex;align-items:center;justify-content:center;font-family:${PORT_MONO};font-size:12px;font-weight:700;}
  .brand b{font-family:${PORT_SERIF};font-size:20px;}
  .hero{padding:60px 0 48px;}
  .hero h1{font-family:${PORT_SERIF};font-weight:400;font-size:clamp(40px,6vw,56px);line-height:1.06;letter-spacing:-.01em;margin:18px 0 22px;}
  .hero h1 em{font-style:italic;opacity:.62;}
  .hero p{font-size:17px;opacity:.84;max-width:54ch;margin:0 0 22px;}
  .actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
  .btn{display:inline-block;font-size:14px;font-weight:600;background:${inkColor};color:${contrastText(inkColor)};text-decoration:none;border:0;border-radius:10px;padding:12px 22px;cursor:pointer;}
  .btn.acc{background:${color};color:${btnInk};}
  .btn.ghost{background:transparent;color:${inkColor};border:1px solid ${secondary};}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .read{font-family:${PORT_MONO};font-size:11px;opacity:.55;}
  section{display:grid;grid-template-columns:140px 1fr;gap:24px;padding:38px 0;border-top:1px solid ${secondary};}
  section .lbl{font-family:${PORT_MONO};font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.55;padding-top:4px;}
  h2{font-family:${PORT_SERIF};font-weight:400;font-size:26px;margin:0 0 12px;letter-spacing:-.01em;}
  p.body{margin:0 0 12px;opacity:.85;}
  ul.arrows{list-style:none;margin:0;padding:0;}
  ul.arrows li{display:flex;gap:12px;padding:7px 0;opacity:.86;}
  ul.arrows li::before{content:"→";color:${accent};font-weight:700;}
  ul.arrows li b{font-weight:700;}
  .card{border:1px solid ${secondary};border-radius:14px;padding:24px;background:${bgColor};}
  .card .opt{display:flex;gap:12px;padding:11px 0;border-top:1px solid ${secondary};font-size:15px;}
  .card .opt:first-child{border-top:0;}.card .opt .k{font-family:${PORT_MONO};color:${accent};font-size:13px;}
  .timeline{list-style:none;margin:0;padding:0;}
  .timeline li{display:grid;grid-template-columns:90px 1fr;gap:14px;padding:9px 0;}
  .timeline .t{font-family:${PORT_MONO};font-size:12px;color:${accent};}
  form{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;}
  input{flex:1 1 220px;font-size:14px;padding:12px 15px;border:1px solid ${secondary};border-radius:10px;background:${bgColor};color:${inkColor};outline:none;}
  input:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}26;}
  .wl-ok,.wl-err{font-size:13px;min-height:18px;margin-top:10px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  .signoff{font-family:${PORT_SERIF};font-style:italic;font-size:22px;margin-top:8px;}
  footer{display:flex;justify-content:space-between;padding:20px 0;font-family:${PORT_MONO};font-size:11px;opacity:.55;flex-wrap:wrap;gap:8px;}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:680px){section{grid-template-columns:1fr;}section .lbl{padding-top:0;}.timeline li{grid-template-columns:1fr;}}
</style></head><body>
  <nav><div class="wrap row">
    <div class="brand">${logoChip(bk, 24, 6)}<b>${name}</b></div>
    <span class="lm">A note for mentors</span>
  </div></nav>
  <div class="wrap">
    <header class="hero">
      <div class="lm">A letter</div>
      <h1>${a.h} <em>We could use your perspective.</em></h1>
      <p>${a.b}</p>
      <div class="actions"><a class="btn acc" href="#ask">${a.c}</a><a class="btn ghost" href="#building">Read first</a><span class="read">3 min read</span></div>
    </header>
    <section id="building"><div class="lbl">01 — Building</div>
      <div><h2>What we're building</h2><p class="body">${c.t('building')}</p></div>
    </section>
    <section><div class="lbl">02 — Stuck</div>
      <div><h2>Where we're stuck</h2>
        <ul class="arrows">${c.list('stuck').map((it) => `<li><b>${it.t('label')}</b> — ${it.t('body')}</li>`).join('')}</ul>
      </div>
    </section>
    <section><div class="lbl">03 — You</div>
      <div><h2>Why you</h2><p class="body">${c.t('why')}</p></div>
    </section>
    <section id="ask"><div class="lbl">04 — The ask</div>
      <div><h2>${a.c}</h2>
        <div class="card">
          ${c.list('ask_options').map((it) => `<div class="opt"><span class="k">${it.t('key')}</span><span>${it.t('body')}</span></div>`).join('')}
        </div>
        <form id="wl-form" style="margin-top:16px;">${honeypotField()}<label for="wl-email" class="sr">Email</label>
          <input id="wl-email" type="email" name="email" placeholder="you@email.com" required />
          <button type="submit" class="btn acc">${a.c}</button></form>
        <div id="wl-msg" aria-live="polite"></div>
      </div>
    </section>
    <section><div class="lbl">05 — Context</div>
      <div><h2>How we got here</h2>
        <ul class="timeline">
          ${c.list('timeline').map((it) => `<li><span class="t">${it.t('year')}</span><span>${it.t('body')}</span></li>`).join('')}
        </ul>
      </div>
    </section>
    <section><div class="lbl">— Thanks</div>
      <div><p class="body">Pick whichever is easiest. There's no wrong answer, and "not now" is completely fine.</p>
        <div class="signoff">Thank you, truly. — the ${name} team</div>
      </div>
    </section>
    <footer><span>${logoChip(bk, 18, 5)} ${name} · 2026</span><span>Private link · please don't share</span></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'mentor', bk.nonce)}
</body></html>`;
}

// ── Template: Builder's Launchpad (Task #25) — dark terminal launch teaser ──
function renderBuildersLaunchpad(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, name } = bk;
  const a = aud.customer; const brand = name || 'our company'; const btnInk = contrastText(color);
  const c = landingContent(row, 'builders-launchpad');
  const ok = '#7bbf5a', warn = accent, danger = '#d9544e';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${a.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${socialMeta(bk, a)}
<style>
  :root{color-scheme:dark;}*{box-sizing:border-box;}
  body{margin:0;background:${bgColor};color:${inkColor};font-family:${PORT_MONO};line-height:1.65;font-size:15px;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}.wrap{max-width:1040px;margin:0 auto;padding:0 28px;}
  .um{font-size:11px;letter-spacing:.14em;text-transform:uppercase;}
  nav{border-bottom:1px solid ${secondary};}
  nav .row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;font-size:13px;}
  .brand{display:flex;align-items:center;gap:9px;}
  .sq{width:11px;height:11px;border-radius:2px;background:${accent};}
  .brand b{font-weight:600;}.brand .m{opacity:.5;}
  .navcta{text-decoration:none;color:${accent};}
  .hero{padding:80px 0 56px;border-bottom:1px solid ${secondary};}
  .hero .sub{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${accent};}
  .hero h1{font-size:clamp(34px,5.2vw,58px);line-height:1.06;letter-spacing:-.02em;font-weight:600;margin:18px 0 18px;font-family:${PORT_MONO};}
  .hero p{font-size:17px;opacity:.74;max-width:60ch;margin:0 0 26px;}
  .btn{display:inline-block;font-family:${PORT_MONO};font-size:13px;font-weight:600;background:${color};color:${btnInk};text-decoration:none;border:0;border-radius:6px;padding:12px 20px;cursor:pointer;}
  .btn[disabled]{opacity:.6;cursor:not-allowed;}
  .ghost{display:inline-block;margin-left:8px;font-size:13px;text-decoration:none;border:1px solid ${secondary};border-radius:6px;padding:11px 17px;opacity:.85;}
  .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:${secondary};border:1px solid ${secondary};margin-top:44px;}
  .facts .c{background:${bgColor};padding:18px 16px;}
  .facts .k{font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.5;}
  .facts .v{font-size:18px;margin-top:6px;color:${accent};}
  section{display:grid;grid-template-columns:200px 1fr;gap:30px;padding:48px 0;border-bottom:1px solid ${secondary};}
  section .side .idx{font-size:13px;color:${accent};}
  section .side .lbl{font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.55;margin-top:4px;}
  h2{font-size:22px;margin:0 0 14px;font-weight:600;letter-spacing:-.01em;}
  p.body{margin:0 0 12px;opacity:.8;}
  .state{list-style:none;margin:0;padding:0;}
  .state li{display:flex;gap:12px;align-items:baseline;padding:10px 0;border-top:1px solid ${secondary};font-size:14px;}
  .state li:first-child{border-top:0;}
  .badge{font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:2px 8px;border-radius:4px;flex:none;}
  .b-ok{background:${ok}26;color:${ok};}.b-warn{background:${warn}26;color:${warn};}.b-dn{background:${danger}26;color:${danger};}
  ol.road{list-style:none;counter-reset:r;margin:0;padding:0;}
  ol.road li{display:flex;gap:14px;padding:10px 0;border-top:1px solid ${secondary};font-size:14px;}ol.road li:first-child{border-top:0;}
  ol.road li::before{counter-increment:r;content:"0" counter(r);color:${accent};}
  .term{border:1px solid ${secondary};border-radius:10px;overflow:hidden;}
  .term .bar{display:flex;align-items:center;gap:7px;background:${secondary};padding:9px 14px;font-size:12px;}
  .term .bar .tl{width:11px;height:11px;border-radius:50%;}
  .tl.r{background:${danger};}.tl.y{background:${warn};}.tl.g{background:${ok};}
  .term .bar .name{margin-left:8px;opacity:.6;}
  .term .body{padding:18px 16px;font-size:13px;background:${bgColor};}
  .term .body .ln{margin:0 0 6px;opacity:.85;}
  .term .body .pr{color:${accent};}
  .term .foot{display:flex;gap:10px;padding:14px 16px;border-top:1px solid ${secondary};flex-wrap:wrap;}
  form{display:flex;gap:10px;flex-wrap:wrap;}
  input{font-family:${PORT_MONO};flex:1 1 220px;font-size:14px;padding:12px 14px;border:1px solid ${secondary};border-radius:6px;background:${inkColor}0d;color:${inkColor};outline:none;}
  input::placeholder{color:${inkColor}66;}input:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}33;}
  .wl-ok,.wl-err{font-size:13px;min-height:18px;margin-top:10px;}.wl-ok{color:${accent};}.wl-err{opacity:.85;}
  footer{display:flex;justify-content:space-between;padding:22px 0;font-size:11px;opacity:.5;flex-wrap:wrap;gap:8px;}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:820px){.facts{grid-template-columns:1fr 1fr;}section{grid-template-columns:1fr;}}
</style></head><body>
  <nav><div class="wrap row">
    <div class="brand">${logoChip(bk, 24, 5)}<b>${name}</b><span class="m">/ launch brief</span></div>
    <a class="navcta" href="#apply">${a.c} →</a>
  </div></nav>
  <div class="wrap">
    <header class="hero">
      <div class="sub">Early access · shipping now</div>
      <h1>${a.h}</h1>
      <p>${a.b}</p>
      <a class="btn" href="#apply">${a.c}</a><a class="ghost" href="#state">See where we are</a>
      <div class="facts">
        ${c.list('facts').map((it) => `<div class="c"><div class="k">${it.t('key')}</div><div class="v">${it.t('value')}</div></div>`).join('')}
      </div>
    </header>
    <section>
      <div class="side"><div class="idx">01</div><div class="lbl">Product vision</div></div>
      <div><h2>What ${brand} does</h2><p class="body">${c.t('vision')}</p></div>
    </section>
    <section id="state">
      <div class="side"><div class="idx">02</div><div class="lbl">Current state</div></div>
      <div><h2>The honest status</h2>
        <ul class="state">
          ${c.list('state').map((it) => `<li><span class="badge b-${it.t('tone')}">${it.t('badge')}</span><span>${it.t('body')}</span></li>`).join('')}
        </ul>
      </div>
    </section>
    <section>
      <div class="side"><div class="idx">03</div><div class="lbl">Roadmap</div></div>
      <div><h2>What ships next</h2>
        <ol class="road">${c.list('road').map((it) => `<li>${it.t('body')}</li>`).join('')}</ol>
      </div>
    </section>
    <section id="apply">
      <div class="side"><div class="idx">04</div><div class="lbl">Get access</div></div>
      <div><h2>${a.c}</h2>
        <div class="term">
          <div class="bar"><span class="tl r"></span><span class="tl y"></span><span class="tl g"></span><span class="name">~/join.sh</span></div>
          <div class="body">
            <p class="ln"><span class="pr">$</span> request access --product ${(name||'app').toLowerCase().replace(/[^a-z0-9]+/g,'-')}</p>
            <p class="ln">› drop your email below and you're on the list.</p>
          </div>
          <div class="foot">
            <form id="wl-form">${honeypotField()}<label for="wl-email" class="sr">Email</label>
              <input id="wl-email" type="email" name="email" placeholder="you@email.com" required />
              <button type="submit" class="btn">${a.c}</button></form>
          </div>
        </div>
        <div id="wl-msg" aria-live="polite"></div>
      </div>
    </section>
    <footer><span>${logoChip(bk, 18, 5)} ${name}</span><span>commit ${(name||'axal').toLowerCase().slice(0,4)}0x9f3a · Built with Axal VC</span></footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'cofounder', bk.nonce)}
</body></html>`;
}

// ── Dispatcher ───────────────────────────────────────────────────
const RENDERERS: Record<TemplateKey, (bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any) => string> = {
  minimal: renderMinimal,
  'bold-hero': renderBoldHero,
  'video-first': renderVideoFirst,
  editorial: renderEditorial,
  'product-mock': renderProductMock,
  'advisor-connect': renderAdvisorConnect,
  'proof-builder': renderProofBuilder,
  'capital-ready-kit': renderCapitalReadyKit,
  'capital-storyteller': renderCapitalStoryteller,
  'seed-stage-spark': renderSeedStageSpark,
  'distribution-deck': renderDistributionDeck,
  'pilot-partner-page': renderPilotPartnerPage,
  'partner-hub': renderPartnerHub,
  'partner-pipeline-pro': renderPartnerPipelinePro,
  'co-founder-builder': renderCoFounderBuilder,
  'co-founder-canvas': renderCoFounderCanvas,
  'cofounder-connect': renderCofounderConnect,
  'co-founder-quest': renderCoFounderQuest,
  'mentor-connect': renderMentorConnect,
  'mentor-connect-page': renderMentorConnectPage,
  'builders-launchpad': renderBuildersLaunchpad,
};

export function renderLandingTemplate(
  row: any,
  opts: { slug?: string; token?: string; noindex?: boolean; nonce?: string } = {},
): string {
  const templateKey = (row.template || 'minimal') as TemplateKey;
  const renderer = RENDERERS[templateKey] || RENDERERS.minimal;
  const bk = buildBrandKit(row, opts);
  const aud = buildAudienceData(row);
  return renderer(bk, aud, row);
}
