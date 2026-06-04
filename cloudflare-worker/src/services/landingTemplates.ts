/**
 * Task #5 — Landing page template library.
 *
 * Five server-rendered layouts that share the same brand kit + audience copy.
 * All templates are pure functions that return a full HTML string; no client-side
 * JS is required for rendering.
 */

export const TEMPLATE_KEYS = ['minimal', 'bold-hero', 'video-first', 'editorial', 'product-mock'] as const;
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
function tabMarkup(aud: Record<string, { h: string; b: string; c: string }>, color: string): string {
  return `
    <div class="tabs" role="tablist" aria-label="Audience">
      <button class="tab active" role="tab" aria-selected="true" aria-controls="p-customer" data-a="customer" onclick="switchTab('customer')">Customer<span class="badge badge-customer">Discovery</span></button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="p-partner" data-a="partner" onclick="switchTab('partner')">Partner</button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="p-investor" data-a="investor" onclick="switchTab('investor')">Investor</button>
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
    </div>`;
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
  ['customer','partner','investor'].forEach(function(aud){
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

// ── Template: Minimal (the original layout) ──────────────────────
function renderMinimal(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, fontPairing, logoMarkup, name } = bk;
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
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 15px; outline:none; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .ok, .err { margin-top: 16px; font-size: 14px; }
  .ok { color: #059669; }
  .err { color: #dc2626; }
  .badge { display:inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-left: 8px; }
  .badge-customer { background: ${color}18; color: ${color}; }
  .badge-partner { background: #6366f118; color: #6366f1; }
  .badge-investor { background: #10b98118; color: #10b981; }
  footer { margin-top: 64px; font-size: 12px; color: #94a3b8; }
  footer a { color: inherit; }
  .sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  @media (max-width: 480px) { .tabs { flex-wrap: wrap; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo">${logoMarkup}</div>
${tabMarkup(aud, color)}
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${waitlistScript(bk.apiWaitlist, bk.nonce)}
</body>
</html>`;
}

// ── Template: Bold Hero ──────────────────────────────────────────
function renderBoldHero(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, fontPairing, logoMarkup, name, heroMediaUrl } = bk;
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
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 15px; outline:none; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .ok, .err { margin-top: 16px; font-size: 14px; }
  .ok { color: #059669; }
  .err { color: #dc2626; }
  .badge { display:inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-left: 8px; }
  .badge-customer { background: ${color}18; color: ${color}; }
  .badge-partner { background: #6366f118; color: #6366f1; }
  .badge-investor { background: #10b98118; color: #10b981; }
  footer { font-size: 12px; color: #94a3b8; padding: 24px; text-align: center; }
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
    ${tabMarkup(aud, color).replace(/h1>/g, 'h2>').replace(/h2>/, 'h1>')}
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${waitlistScript(bk.apiWaitlist, bk.nonce)}
</body>
</html>`;
}

// ── Template: Video First ───────────────────────────────────────
function renderVideoFirst(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, fontPairing, logoMarkup, name, heroMediaUrl } = bk;
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
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 15px; outline:none; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .ok, .err { margin-top: 16px; font-size: 14px; }
  .ok { color: #059669; }
  .err { color: #dc2626; }
  .badge { display:inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-left: 8px; }
  .badge-customer { background: ${color}18; color: ${color}; }
  .badge-partner { background: #6366f118; color: #6366f1; }
  .badge-investor { background: #10b98118; color: #10b981; }
  footer { font-size: 12px; color: #94a3b8; padding: 24px; text-align: center; }
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
    ${tabMarkup(aud, color)}
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${waitlistScript(bk.apiWaitlist, bk.nonce)}
</body>
</html>`;
}

// ── Template: Editorial ──────────────────────────────────────────
function renderEditorial(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, fontPairing, logoMarkup, name } = bk;
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
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 15px; outline:none; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .ok, .err { margin-top: 12px; font-size: 14px; }
  .ok { color: #059669; }
  .err { color: #dc2626; }
  .badge { display:inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-left: 8px; }
  .badge-customer { background: ${color}18; color: ${color}; }
  .badge-partner { background: #6366f118; color: #6366f1; }
  .badge-investor { background: #10b98118; color: #10b981; }
  .rule { border:0; border-top:1px solid ${secondary}; margin: 40px 0; }
  footer { margin-top: 64px; font-size: 12px; color: #94a3b8; }
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
    ${tabMarkup(aud, color)}
    <hr class="rule" />
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${waitlistScript(bk.apiWaitlist, bk.nonce)}
</body>
</html>`;
}

// ── Template: Product Mock ───────────────────────────────────────
function renderProductMock(bk: BrandKit, aud: Record<string, { h: string; b: string; c: string }>, row: any): string {
  const { color, bgColor, inkColor, secondary, fontPairing, logoMarkup, name, productScreenshotUrl } = bk;
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
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 15px; outline:none; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .ok, .err { margin-top: 16px; font-size: 14px; }
  .ok { color: #059669; }
  .err { color: #dc2626; }
  .badge { display:inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-left: 8px; }
  .badge-customer { background: ${color}18; color: ${color}; }
  .badge-partner { background: #6366f118; color: #6366f1; }
  .badge-investor { background: #10b98118; color: #10b981; }
  footer { margin-top: 64px; font-size: 12px; color: #94a3b8; text-align: center; }
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
      ${tabMarkup(aud, color)}
    </div>
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
${waitlistScript(bk.apiWaitlist, bk.nonce)}
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
