/**
 * Task #5 — Landing page template library.
 *
 * Five server-rendered layouts that share the same brand kit + audience copy.
 * All templates are pure functions that return a full HTML string; no client-side
 * JS is required for rendering.
 */

export const TEMPLATE_KEYS = ['minimal', 'bold-hero', 'video-first', 'editorial', 'product-mock', 'advisor-connect', 'proof-builder', 'capital-ready-kit'] as const;
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
  name: string;
  slug: string;
  apiWaitlist: string;
  noindex: boolean;
  nonce?: string;
  heroMediaUrl?: string | null;
  productScreenshotUrl?: string | null;
}

function buildBrandKit(row: any, opts: { slug?: string; token?: string; noindex?: boolean; nonce?: string }): BrandKit {
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
  const slug = opts.slug || '';
  const apiWaitlist = opts.slug ? `/api/brand/landing/${encodeURIComponent(opts.slug)}/waitlist` : '';
  return {
    color, bgColor, inkColor, secondary, accent, fontPairing, logoMarkup, name, slug,
    apiWaitlist, noindex: !!opts.noindex, nonce: opts.nonce,
    heroMediaUrl: validMediaUrl(row.hero_media_url),
    productScreenshotUrl: validMediaUrl(row.product_screenshot_url),
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

function fontStack(pairing: string): string {
  const stacks: Record<string, string> = {
    editorial: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Georgia", "Times New Roman", serif',
    modern: '-apple-system, BlinkMacSystemFont, "Segoe UI", "SF Pro Display", "Roboto", "Helvetica Neue", sans-serif',
    humanist: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Gill Sans", "Gill Sans MT", sans-serif',
    classic: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Palatino", "Book Antiqua", serif',
  };
  return stacks[pairing] || stacks.editorial;
}

// Shared tab markup for audience switching.
function tabMarkup(aud: Record<string, { h: string; b: string; c: string }>, color: string, secondary: string, accent: string): string {
  return `
    <div class="tabs" role="tablist" aria-label="Audience">
      <button class="tab active" role="tab" aria-selected="true" aria-controls="p-customer" data-a="customer" onclick="switchTab('customer')">Customer<span class="badge badge-customer">Discovery</span></button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="p-partner" data-a="partner" onclick="switchTab('partner')">Partner</button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="p-investor" data-a="investor" onclick="switchTab('investor')">Investor</button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="p-advisor" data-a="advisor" onclick="switchTab('advisor')">Advisor</button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="p-mentor" data-a="mentor" onclick="switchTab('mentor')">Mentor</button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="p-cofounder" data-a="cofounder" onclick="switchTab('cofounder')">Co-founder</button>
    </div>
    <div class="panel active" id="p-customer" role="tabpanel" data-a="customer">
      <h1>${aud.customer.h}</h1>
      ${aud.customer.b ? `<p class="sub">${aud.customer.b}</p>` : ''}
      <form id="wl-customer">
        <label for="email-customer" class="sr">Email</label>
        <input id="email-customer" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit">${aud.customer.c}</button>
      </form>
      <div id="msg-customer" aria-live="polite"></div>
    </div>
    <div class="panel" id="p-partner" role="tabpanel" data-a="partner">
      <h1>${aud.partner.h}</h1>
      ${aud.partner.b ? `<p class="sub">${aud.partner.b}</p>` : ''}
      <form id="wl-partner">
        <label for="email-partner" class="sr">Email</label>
        <input id="email-partner" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit">${aud.partner.c}</button>
      </form>
      <div id="msg-partner" aria-live="polite"></div>
    </div>
    <div class="panel" id="p-investor" role="tabpanel" data-a="investor">
      <h1>${aud.investor.h}</h1>
      ${aud.investor.b ? `<p class="sub">${aud.investor.b}</p>` : ''}
      <form id="wl-investor">
        <label for="email-investor" class="sr">Email</label>
        <input id="email-investor" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit">${aud.investor.c}</button>
      </form>
      <div id="msg-investor" aria-live="polite"></div>
    </div>
    <div class="panel" id="p-advisor" role="tabpanel" data-a="advisor">
      <h1>${aud.advisor.h}</h1>
      ${aud.advisor.b ? `<p class="sub">${aud.advisor.b}</p>` : ''}
      <form id="wl-advisor">
        <label for="email-advisor" class="sr">Email</label>
        <input id="email-advisor" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit">${aud.advisor.c}</button>
      </form>
      <div id="msg-advisor" aria-live="polite"></div>
    </div>
    <div class="panel" id="p-mentor" role="tabpanel" data-a="mentor">
      <h1>${aud.mentor.h}</h1>
      ${aud.mentor.b ? `<p class="sub">${aud.mentor.b}</p>` : ''}
      <form id="wl-mentor">
        <label for="email-mentor" class="sr">Email</label>
        <input id="email-mentor" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit">${aud.mentor.c}</button>
      </form>
      <div id="msg-mentor" aria-live="polite"></div>
    </div>
    <div class="panel" id="p-cofounder" role="tabpanel" data-a="cofounder">
      <h1>${aud.cofounder.h}</h1>
      ${aud.cofounder.b ? `<p class="sub">${aud.cofounder.b}</p>` : ''}
      <form id="wl-cofounder">
        <label for="email-cofounder" class="sr">Email</label>
        <input id="email-cofounder" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit">${aud.cofounder.c}</button>
      </form>
      <div id="msg-cofounder" aria-live="polite"></div>
    </div>
    <style>
      .badge { display:inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-left: 8px; }
      .badge-customer { background: ${color}18; color: ${color}; }
      .badge-partner { background: ${secondary}18; color: ${secondary}; }
      .badge-investor { background: ${accent}18; color: ${accent}; }
    </style>`;
}

function waitlistScript(apiWaitlist: string, nonce?: string): string {
  return `<script${nonce ? ` nonce="${nonce}"` : ''}>
function switchTab(aud){
  document.querySelectorAll('.tab').forEach(function(t){
    var on = t.dataset.a===aud;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.panel').forEach(function(p){ p.classList.toggle('active', p.dataset.a===aud); });
}
(function(){
  var api=${JSON.stringify(apiWaitlist)};
  if(!api) return;
  ['customer','partner','investor','advisor','mentor','cofounder'].forEach(function(aud){
    var f=document.getElementById('wl-'+aud), m=document.getElementById('msg-'+aud);
    f.addEventListener('submit',function(e){
      e.preventDefault();
      var email=f.email.value.trim(); if(!email) return;
      var btn=f.querySelector('button'); btn.disabled=true;
      fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,source:'landing',audience:aud})})
        .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
        .then(function(x){
          if(x.ok){ m.className='ok'; m.textContent="You're on the list. We'll be in touch."; f.reset(); }
          else { m.className='err'; m.textContent=(x.j&&x.j.error)||'Something went wrong.'; }
        })
        .catch(function(){ m.className='err'; m.textContent='Network error. Please try again.'; })
        .finally(function(){ btn.disabled=false; });
    });
  });
})();
</script>`;
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
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var email=f.email.value.trim(); if(!email) return;
    var btn=f.querySelector('button'); btn.disabled=true;
    fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,source:'landing',audience:${JSON.stringify(audience)}})})
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
};

// ── Template: Minimal (the original layout) ──────────────────────
function renderMinimal(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, fontPairing, logoMarkup, name } = bk;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${aud.customer.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
<style>
  :root { color-scheme: light; }
  body { margin:0; font-family: ${fontStack(fontPairing)}; background: ${bgColor}; color: ${inkColor}; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 64px 24px 96px; text-align: center; }
  .logo { display:flex; justify-content:center; margin-bottom: 28px; }
  h1 { font-size: clamp(32px, 5vw, 52px); margin: 0 0 12px; line-height: 1.1; letter-spacing: -0.02em; }
  p.sub { font-size: 18px; color: ${inkColor}; opacity: .7; margin: 0 0 36px; }
  .tabs { display:flex; gap: 6px; justify-content:center; margin-bottom: 28px; }
  .tab { cursor:pointer; padding: 8px 16px; border-radius: 8px; border: 1px solid transparent; font-size: 14px; background: transparent; color: ${inkColor}; opacity: .6; }
  .tab.active { opacity: 1; background: ${color}18; border-color: ${color}44; }
  .panel { display:none; }
  .panel.active { display:block; }
  form { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; max-width: 480px; margin: 0 auto; }
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid ${inkColor}22; border-radius: 10px; font-size: 15px; outline:none; background: ${bgColor}; color: ${inkColor}; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .ok, .err { margin-top: 16px; font-size: 14px; }
  .ok { color: ${accent}; }
  .err { color: ${color}; opacity: .85; }
  footer { margin-top: 64px; font-size: 12px; color: ${inkColor}55; }
  footer a { color: inherit; }
  .sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  @media (max-width: 480px) { .tabs { flex-wrap: wrap; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo">${logoMarkup}</div>
${tabMarkup(aud, color, secondary, accent)}
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${waitlistScript(bk.apiWaitlist, bk.nonce)}
</body>
</html>`;
}

// ── Template: Bold Hero ──────────────────────────────────────────
function renderBoldHero(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, fontPairing, logoMarkup, name, heroMediaUrl } = bk;
  const heroBg = heroMediaUrl ? `url(${escapeHtml(heroMediaUrl)})` : bgColor;
  const heroText = heroMediaUrl ? '#fff' : inkColor;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${aud.customer.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
<style>
  :root { color-scheme: light; }
  body { margin:0; font-family: ${fontStack(fontPairing)}; background: ${bgColor}; color: ${inkColor}; }
  .hero { min-height: 60vh; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding: 80px 24px; background: ${heroBg} center/cover no-repeat; color: ${heroText}; }
  .hero-overlay { position:absolute; inset:0; background: rgba(0,0,0,0.4); }
  .hero > * { position:relative; z-index:1; }
  .logo { margin-bottom: 24px; }
  h1 { font-size: clamp(36px, 6vw, 64px); margin: 0 0 12px; line-height: 1.05; letter-spacing: -0.02em; font-weight: 800; }
  p.sub { font-size: 20px; opacity: .85; margin: 0 0 36px; max-width: 560px; }
  .tabs { display:flex; gap: 6px; justify-content:center; margin-bottom: 28px; }
  .tab { cursor:pointer; padding: 8px 16px; border-radius: 8px; border: 1px solid transparent; font-size: 14px; background: transparent; color: ${heroText}; opacity: .6; }
  .tab.active { opacity: 1; background: ${color}18; border-color: ${color}44; }
  .panel { display:none; }
  .panel.active { display:block; }
  .body { max-width: 760px; margin: 0 auto; padding: 48px 24px 80px; text-align: center; }
  form { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; max-width: 480px; margin: 0 auto; }
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid ${inkColor}22; border-radius: 10px; font-size: 15px; outline:none; background: ${bgColor}; color: ${inkColor}; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .ok, .err { margin-top: 16px; font-size: 14px; }
  .ok { color: ${accent}; }
  .err { color: ${color}; opacity: .85; }
  footer { font-size: 12px; color: ${inkColor}55; padding: 24px; text-align: center; }
  footer a { color: inherit; }
  .sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  @media (max-width: 480px) { .tabs { flex-wrap: wrap; } }
</style>
</head>
<body>
  <div class="hero">
    ${heroMediaUrl ? '<div class="hero-overlay"></div>' : ''}
    <div class="logo">${logoMarkup}</div>
    <h1>${aud.customer.h}</h1>
    <p class="sub">${aud.customer.b}</p>
  </div>
  <div class="body">
    ${tabMarkup(aud, color, secondary, accent).replace(/h1>/g, 'h2>').replace(/h2>/, 'h1>')}
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${waitlistScript(bk.apiWaitlist, bk.nonce)}
</body>
</html>`;
}

// ── Template: Video First ───────────────────────────────────────
function renderVideoFirst(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, fontPairing, logoMarkup, name, heroMediaUrl } = bk;
  const isVideo = heroMediaUrl && /\.(mp4|webm|mov)(\?|$)/i.test(heroMediaUrl);
  const heroEl = isVideo
    ? `<video autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;"><source src="${escapeHtml(heroMediaUrl)}" /></video>`
    : heroMediaUrl
      ? `<img src="${escapeHtml(heroMediaUrl)}" alt="${name}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" />`
      : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${aud.customer.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
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
  .tabs { display:flex; gap: 6px; justify-content:center; margin-bottom: 28px; }
  .tab { cursor:pointer; padding: 8px 16px; border-radius: 8px; border: 1px solid transparent; font-size: 14px; background: transparent; color: ${inkColor}; opacity: .6; }
  .tab.active { opacity: 1; background: ${color}18; border-color: ${color}44; }
  .panel { display:none; }
  .panel.active { display:block; }
  form { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; max-width: 480px; margin: 0 auto; }
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid ${inkColor}22; border-radius: 10px; font-size: 15px; outline:none; background: ${bgColor}; color: ${inkColor}; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .ok, .err { margin-top: 16px; font-size: 14px; }
  .ok { color: ${accent}; }
  .err { color: ${color}; opacity: .85; }
  footer { font-size: 12px; color: ${inkColor}55; padding: 24px; text-align: center; }
  footer a { color: inherit; }
  .sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  @media (max-width: 480px) { .tabs { flex-wrap: wrap; } }
</style>
</head>
<body>
  <div class="media-hero">
    ${heroEl}
    ${heroMediaUrl ? '<div class="hero-overlay"></div>' : ''}
    <div class="hero-content">
      <div class="logo">${logoMarkup}</div>
      <h1>${aud.customer.h}</h1>
      <p class="sub">${aud.customer.b}</p>
    </div>
  </div>
  <div class="body">
    ${tabMarkup(aud, color, secondary, accent)}
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${waitlistScript(bk.apiWaitlist, bk.nonce)}
</body>
</html>`;
}

// ── Template: Editorial ──────────────────────────────────────────
function renderEditorial(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, fontPairing, logoMarkup, name } = bk;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${aud.customer.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
<style>
  :root { color-scheme: light; }
  body { margin:0; font-family: ${fontStack(fontPairing)}; background: ${bgColor}; color: ${inkColor}; line-height: 1.6; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 80px 24px 96px; }
  .logo { display:flex; margin-bottom: 48px; }
  h1 { font-size: clamp(36px, 5vw, 56px); margin: 0 0 16px; line-height: 1.1; letter-spacing: -0.02em; font-weight: 700; }
  .lede { font-size: 20px; color: ${inkColor}; opacity: .75; margin: 0 0 48px; }
  .tabs { display:flex; gap: 6px; margin-bottom: 28px; }
  .tab { cursor:pointer; padding: 8px 16px; border-radius: 8px; border: 1px solid transparent; font-size: 14px; background: transparent; color: ${inkColor}; opacity: .6; }
  .tab.active { opacity: 1; background: ${color}18; border-color: ${color}44; }
  .panel { display:none; }
  .panel.active { display:block; }
  .panel h2 { font-size: 28px; margin: 0 0 8px; }
  .panel p { font-size: 17px; margin: 0 0 24px; }
  form { display:flex; gap:8px; flex-wrap:wrap; max-width: 480px; margin: 24px 0 0; }
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid ${inkColor}22; border-radius: 10px; font-size: 15px; outline:none; background: ${bgColor}; color: ${inkColor}; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .ok, .err { margin-top: 12px; font-size: 14px; }
  .ok { color: ${accent}; }
  .err { color: ${color}; opacity: .85; }
  .rule { border:0; border-top:1px solid ${secondary}; margin: 40px 0; }
  footer { margin-top: 64px; font-size: 12px; color: ${inkColor}55; }
  footer a { color: inherit; }
  .sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  @media (max-width: 480px) { .tabs { flex-wrap: wrap; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo">${logoMarkup}</div>
    <h1>${aud.customer.h}</h1>
    <p class="lede">${aud.customer.b}</p>
    <hr class="rule" />
    ${tabMarkup(aud, color, secondary, accent)}
    <hr class="rule" />
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${waitlistScript(bk.apiWaitlist, bk.nonce)}
</body>
</html>`;
}

// ── Template: Product Mock ───────────────────────────────────────
function renderProductMock(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, fontPairing, logoMarkup, name, productScreenshotUrl } = bk;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}${bk.noindex ? ' (Preview)' : ''}</title>
<meta name="description" content="${aud.customer.b}" />
${bk.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
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
  .tabs { display:flex; gap: 6px; justify-content:center; margin-bottom: 28px; }
  .tab { cursor:pointer; padding: 8px 16px; border-radius: 8px; border: 1px solid transparent; font-size: 14px; background: transparent; color: ${inkColor}; opacity: .6; }
  .tab.active { opacity: 1; background: ${color}18; border-color: ${color}44; }
  .panel { display:none; }
  .panel.active { display:block; }
  .panel-content { text-align: center; }
  form { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; max-width: 480px; margin: 0 auto; }
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid ${inkColor}22; border-radius: 10px; font-size: 15px; outline:none; background: ${bgColor}; color: ${inkColor}; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .ok, .err { margin-top: 16px; font-size: 14px; }
  .ok { color: ${accent}; }
  .err { color: ${color}; opacity: .85; }
  footer { margin-top: 64px; font-size: 12px; color: ${inkColor}55; text-align: center; }
  footer a { color: inherit; }
  .sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  @media (max-width: 480px) { .header { flex-direction: column; text-align: center; } .tabs { flex-wrap: wrap; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="logo">${logoMarkup}</div>
      <div class="headline">
        <h1>${aud.customer.h}</h1>
        <p class="lede">${aud.customer.b}</p>
      </div>
    </div>
    ${productScreenshotUrl ? `<img src="${escapeHtml(productScreenshotUrl)}" alt="${name} product" class="screenshot" />` : ''}
    <div class="panel-content">
      ${tabMarkup(aud, color, secondary, accent)}
    </div>
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${waitlistScript(bk.apiWaitlist, bk.nonce)}
</body>
</html>`;
}

// ── Template: Advisor Connect (Task #24) — warm editorial invite ─
function renderAdvisorConnect(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, accent, logoMarkup, name } = bk;
  const a = aud.advisor;
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
            <div class="point"><h3>Go-to-market</h3><p>Positioning, first customers, pricing.</p></div>
            <div class="point"><h3>Product</h3><p>Scope, sequencing, what to say no to.</p></div>
            <div class="point"><h3>Hiring</h3><p>Early team, founding engineers, networks.</p></div>
            <div class="point"><h3>Fundraising</h3><p>Story, metrics, and warm introductions.</p></div>
          </div>
        </div>
        <aside class="card">
          <h3>The arrangement</h3>
          <div class="term"><span>Commitment</span><span>~2 hrs / month</span></div>
          <div class="term"><span>Format</span><span>Calls + async</span></div>
          <div class="term"><span>Term</span><span>12 months, renewable</span></div>
          <div class="term"><span>Recognition</span><span>Advisory equity</span></div>
          <div class="term"><span>Start</span><span>A 30-min intro</span></div>
        </aside>
      </div>
    </section>

    <section>
      <div class="sec-head"><div class="eyebrow">Early signal</div></div>
      <div class="stats">
        <div class="stat"><div class="v">Live</div><div class="l">Product in market</div></div>
        <div class="stat"><div class="v">Weekly</div><div class="l">Active conversations</div></div>
        <div class="stat"><div class="v">Growing</div><div class="l">Waitlist &amp; pipeline</div></div>
      </div>
    </section>

    <section style="border-bottom:0;">
      <blockquote>The best advisors don't just open doors — they help you see around the next corner.<cite>— Why we're reaching out to you</cite></blockquote>
    </section>

    <div class="cta" id="join">
      <h2>${a.c}</h2>
      <p>Leave your email and we'll send a short brief plus a link to book an intro call.</p>
      <form id="wl-form">
        <label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit" class="btn">${a.c}</button>
      </form>
      <div id="wl-msg" aria-live="polite"></div>
    </div>

    <footer>
      <span>${name}</span>
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
  const brand = name || 'our product';
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
        <div class="step"><div class="n">1</div><h3>Show the problem</h3><p>We name the pain precisely — the way the people living it would.</p></div>
        <div class="step"><div class="n">2</div><h3>Show the change</h3><p>What's different with ${brand}, demonstrated rather than asserted.</p></div>
        <div class="step"><div class="n">3</div><h3>Show the receipts</h3><p>Quotes, usage, and outcomes you can trace back to a source.</p></div>
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
        <div class="panel"><h3>Today</h3><p>The work is manual, scattered, and hard to trust. People route around the tools instead of through them — and the evidence lives in someone's head.</p></div>
        <div class="panel alt"><h3>With ${brand}</h3><p>One clear flow, less busywork, and a trail of proof at every step — so the next person doesn't have to take your word for it.</p></div>
      </div>
    </section>

    <section>
      <div class="metrics">
        <div class="metric"><div class="v">Live</div><div class="l">In real customer hands</div></div>
        <div class="metric"><div class="v">Weekly</div><div class="l">New signal coming in</div></div>
        <div class="metric"><div class="v">Traceable</div><div class="l">Every claim has a source</div></div>
      </div>
    </section>

    <section>
      <div class="sec-head"><div class="eyebrow">In their words</div><h2>What people tell us</h2></div>
      <div class="cases">
        <div class="case"><blockquote>"It did in an afternoon what used to take us a week — and we could show our team exactly why."</blockquote><div class="who">Early customer · operations</div></div>
        <div class="case"><blockquote>"The difference is you can actually check the claims. That's rare, and it's why we stayed."</blockquote><div class="who">Design partner · founder</div></div>
      </div>
    </section>

    <div class="cta" id="join">
      <h2>${a.c}</h2>
      <p>Join the early list. We'll share what we're seeing and bring you in as we open access.</p>
      <form id="wl-form">
        <label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit" class="btn">${a.c}</button>
      </form>
      <div id="wl-msg" aria-live="polite"></div>
    </div>

    <footer>
      <span>${name}</span>
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
        <div class="cell"><div class="k">Raising</div><div class="v">Seed</div></div>
        <div class="cell"><div class="k">Stage</div><div class="v">Early</div></div>
        <div class="cell"><div class="k">Use</div><div class="v">18 mo</div></div>
        <div class="cell"><div class="k">Status</div><div class="v">Open</div></div>
      </div>
    </header>

    <section>
      <div class="sec-head"><div class="eyebrow">What we do</div><h2>${brand} in one line</h2></div>
      <p class="lead">We're building ${brand} to remove the busywork between ambitious teams and the outcomes they're after — and we're raising to do it faster.</p>
    </section>

    <section>
      <div class="sec-head"><div class="eyebrow">Why now</div><h2>The timing is the moat</h2></div>
      <div class="points">
        <div class="point"><div class="n">01</div><h3>The market shifted</h3><p>Behaviour and technology just changed in a way that makes this buildable today.</p></div>
        <div class="point"><div class="n">02</div><h3>The wedge is clear</h3><p>We start where the pain is sharpest and own that workflow end to end.</p></div>
        <div class="point"><div class="n">03</div><h3>Early but real</h3><p>Live product, real users, and a roadmap the capital directly accelerates.</p></div>
      </div>
    </section>

    <section>
      <div class="sec-head"><div class="eyebrow">Traction</div><h2>Signal so far</h2></div>
      <div class="metrics">
        <div class="metric"><div class="v">Live</div><div class="l">In market</div></div>
        <div class="metric"><div class="v">Weekly</div><div class="l">Active use</div></div>
        <div class="metric"><div class="v">Growing</div><div class="l">Pipeline</div></div>
        <div class="metric"><div class="v">Lean</div><div class="l">Burn</div></div>
      </div>
    </section>

    <section id="round">
      <div class="sec-head"><div class="eyebrow">The round</div><h2>Round &amp; use of funds</h2></div>
      <div class="two">
        <div class="card">
          <h3>Round details</h3>
          <div class="term"><span>Stage</span><span class="v">Seed</span></div>
          <div class="term"><span>Instrument</span><span class="v">SAFE</span></div>
          <div class="term"><span>Runway</span><span class="v">~18 months</span></div>
          <div class="term"><span>Lead</span><span class="v">Open to a lead</span></div>
          <div class="term"><span>Close</span><span class="v">Rolling</span></div>
        </div>
        <div class="card">
          <h3>Where it goes</h3>
          <div class="fund">
            <div class="row"><span>Product &amp; engineering</span><span>45%</span></div><div class="track"><div class="fill" style="width:45%"></div></div>
            <div class="row"><span>Go-to-market</span><span>30%</span></div><div class="track"><div class="fill" style="width:30%"></div></div>
            <div class="row"><span>Operations</span><span>15%</span></div><div class="track"><div class="fill" style="width:15%"></div></div>
            <div class="row"><span>Reserve</span><span>10%</span></div><div class="track"><div class="fill" style="width:10%"></div></div>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="sec-head"><div class="eyebrow">Team</div><h2>Who's building ${brand}</h2></div>
      <div class="team">
        <div class="member"><div class="av"></div><h3>Founder</h3><p>Sets the vision and owns the product.</p></div>
        <div class="member"><div class="av"></div><h3>Co-founder</h3><p>Leads build and the technical roadmap.</p></div>
        <div class="member"><div class="av"></div><h3>Early team</h3><p>Operators close to the customer.</p></div>
      </div>
    </section>

    <div class="cta" id="intro">
      <h2>${a.c}</h2>
      <p>Leave your email for the data room and a 30-minute intro with the founders.</p>
      <form id="wl-form">
        <label for="wl-email" class="sr">Email</label>
        <input id="wl-email" type="email" name="email" placeholder="you@fund.com" required />
        <button type="submit" class="btn">${a.c}</button>
      </form>
      <div id="wl-msg" aria-live="polite"></div>
    </div>

    <footer>
      <span>${name}</span>
      <span>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></span>
    </footer>
  </div>
${singleWaitlistScript(bk.apiWaitlist, 'investor', bk.nonce)}
</body>
</html>`;
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
