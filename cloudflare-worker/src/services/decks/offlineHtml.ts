/**
 * D901 (#2680) — the HTML export: one self-contained file of a deck version.
 *
 * The file opens offline and asks for nothing:
 *   - the faces are inline (`data:` fonts, the same files the legal paper
 *     ships), and every image is a `data:` URI or a line saying it could not
 *     be included — the route fetches them, this file never does;
 *   - its Content-Security-Policy is `default-src 'none'`, so a browser would
 *     refuse any request the markup tried to make;
 *   - the one script is `NAV_SCRIPT`, keyboard navigation and nothing else,
 *     admitted by its SHA-256 in that policy. Without it (or in print) every
 *     card is shown, one after another.
 *
 * Keys, as the canvas draws them ("5 of 12 · use ← → keys", "Esc"): → / Page
 * Down / Space for the next card, ← / Page Up for the previous one, Home and
 * End, and Esc to switch between one card and all of them.
 *
 * A card shows what the version holds and nothing else. A field the template
 * left unfilled reads "Not recorded"; a card with no notes says so when notes
 * are included. The Sources appendix lists every figure a card is bound to
 * (D896's bindings, which D897's New deck writes on each figure): the card, the
 * figure, the module it was read from, its grade and the day it was read
 * (D1111). A version with no binding says it records no source. It also names
 * the cards whose text was written with AI help, which the fields record.
 *
 * `services/decks/render.ts` was not this file: it loaded Tailwind from a CDN
 * and had no caller. Its renderer is gone; its slide types stay for pptx.ts.
 */
import { LEGAL_FACES, bytesToBase64 } from '../legalPaperCss';
import { DECK_SOURCES, bindingsOf } from './sources';

export const NOT_RECORDED = 'Not recorded';
export const NO_NOTES = 'No notes on this card.';
export const IMAGE_MISSING = 'This image could not be included in the file.';
export const NO_SOURCES = 'This version does not record where its figures come from.';
/** A figure bound to a slot its record did not fill when the card was made. */
export const SOURCE_NOT_ON_STUDIOOS = 'Not recorded on StudioOS';
export const EMPTY_CARD = 'Nothing on this card yet.';

/** The faces the file carries: body, bold, and the headings. */
const FACES = ['public-sans-400.woff2', 'public-sans-700.woff2', 'space-grotesk-700.woff2'];

/** Keyboard navigation, the file's only script. Reads and writes the page, nothing else. */
export const NAV_SCRIPT = [
  "(function(){var c=[].slice.call(document.querySelectorAll('section.card'));if(!c.length)return;",
  "var i=0,all=false,n=document.getElementById('count');",
  "function show(k){i=Math.max(0,Math.min(c.length-1,k));for(var j=0;j<c.length;j++)c[j].hidden=!all&&j!==i;",
  "n.textContent=all?'All '+c.length+' cards · Esc for one at a time':(i+1)+' of '+c.length+' · use ← → keys · Esc shows all';",
  "if(all)c[i].scrollIntoView();}",
  "document.addEventListener('keydown',function(e){var k=e.key;",
  "if(k==='ArrowRight'||k==='PageDown'||k===' '){e.preventDefault();show(i+1);}",
  "else if(k==='ArrowLeft'||k==='PageUp'){e.preventDefault();show(i-1);}",
  "else if(k==='Home'){e.preventDefault();show(0);}",
  "else if(k==='End'){e.preventDefault();show(c.length-1);}",
  "else if(k==='Escape'){all=!all;show(i);}});",
  "show(0);})();",
].join('');

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp';

/** The image type from the file's own first bytes; SVG and anything else is refused (an SVG can carry script). */
export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

export const imageDataUri = (kind: ImageKind, bytes: Uint8Array) => `data:image/${kind};base64,${bytesToBase64(bytes)}`;

/** Every image URL the slides name, once each, in card order. */
export function imageUrlsOf(slides: any[]): string[] {
  const out: string[] = [];
  const add = (u: unknown) => { if (typeof u === 'string' && u && !out.includes(u)) out.push(u); };
  for (const s of slides || []) {
    add(s?.image_url);
    if (Array.isArray(s?.fields)) for (const f of s.fields) if (f?.kind === 'image') add(f.value);
  }
  return out;
}

export type OfflineDeck = {
  title: string;
  version: number | null;
  slides: any[];
  /** Each image URL → its `data:` URI, or null when it could not be included. */
  images: ReadonlyMap<string, string | null>;
  /** The plan's footer line, or null when the venture's plan removes it. */
  footer: string | null;
  /** The Studio watermark as a `data:` URI, or null. */
  watermark: string | null;
  notes: boolean;
  sources: boolean;
};

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const text = (s: unknown) => esc(String(s ?? '').trim()).replace(/\r?\n/g, '<br>');

function image(url: unknown, images: OfflineDeck['images'], alt: string): string {
  const uri = typeof url === 'string' ? images.get(url) : null;
  // Only a data: URI the route made reaches the markup; a URL never does.
  if (uri && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(uri)) return `<img src="${uri}" alt="${esc(alt)}">`;
  return `<p class="missing">${IMAGE_MISSING}</p>`;
}

function field(f: any, images: OfflineDeck['images'], cardTitle: string): string {
  const unfilled = f?.source === 'placeholder';
  switch (f?.kind) {
    case 'title': return '';
    case 'subtitle': return unfilled || !String(f.value ?? '').trim() ? '' : `<p class="sub">${text(f.value)}</p>`;
    case 'bullets': {
      const items = Array.isArray(f.value) ? f.value.filter((b: unknown) => String(b ?? '').trim()) : [];
      if (unfilled || !items.length) return `<p class="nr">${esc(f.label || 'List')}: ${NOT_RECORDED}</p>`;
      return `<ul>${items.map((b: unknown) => `<li>${text(b)}</li>`).join('')}</ul>`;
    }
    case 'image': return image(unfilled ? null : f.value, images, f.label || cardTitle);
    case 'metric_grid': {
      const cells = Array.isArray(f.value) ? f.value : [];
      if (!cells.length) return `<p class="nr">${esc(f.label || 'Figures')}: ${NOT_RECORDED}</p>`;
      return `<dl class="grid">${cells.map((c: any) => {
        const v = unfilled || !String(c?.value ?? '').trim() ? NOT_RECORDED : text(c.value);
        return `<div><dt>${text(c?.label)}</dt><dd>${v}</dd>${c?.sub ? `<dd class="cell-sub">${text(c.sub)}</dd>` : ''}</div>`;
      }).join('')}</dl>`;
    }
    case 'quote': return unfilled || !String(f.value ?? '').trim() ? '' : `<blockquote>${text(f.value)}</blockquote>`;
    default: {
      if (unfilled) return `<p class="nr">${esc(f?.label || 'Text')}: ${NOT_RECORDED}</p>`;
      return String(f?.value ?? '').trim() ? `<p>${text(f.value)}</p>` : '';
    }
  }
}

function cardBody(s: any, images: OfflineDeck['images']): string {
  const title = String(s?.title || '').trim();
  if (Array.isArray(s?.fields) && s.fields.length) {
    return s.fields.map((f: any) => field(f, images, title)).join('');
  }
  const parts: string[] = [];
  if (String(s?.subtitle ?? '').trim()) parts.push(`<p class="sub">${text(s.subtitle)}</p>`);
  if (String(s?.body ?? '').trim()) parts.push(`<p>${text(s.body)}</p>`);
  const bullets = Array.isArray(s?.bullets) ? s.bullets.filter((b: unknown) => String(b ?? '').trim()) : [];
  if (bullets.length) parts.push(`<ul>${bullets.map((b: unknown) => `<li>${text(b)}</li>`).join('')}</ul>`);
  if (s?.image_url) parts.push(image(s.image_url, images, title));
  return parts.join('');
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function card(s: any, i: number, d: OfflineDeck, mark: string): string {
  const title = String(s?.title || '').trim() || `Card ${i + 1}`;
  const body = cardBody(s, d.images) || `<p class="nr">${EMPTY_CARD}</p>`;
  const notes = d.notes
    ? `<aside class="notes"><span class="eye">Speaker notes</span>${String(s?.notes ?? '').trim() ? `<p>${text(s.notes)}</p>` : `<p class="nr">${NO_NOTES}</p>`}</aside>`
    : '';
  return `<section class="card" id="card-${i + 1}" aria-label="Card ${i + 1} of ${d.slides.length}"><div class="face">`
    + `<span class="eye">${pad2(i + 1)}${s?.appendix ? ' · Appendix' : ''}</span><h2>${esc(title)}</h2>${body}${mark}</div>${notes}</section>`;
}

/** Each slot's name and the module it is read from, by its source key. */
const SLOTS = new Map(DECK_SOURCES.flatMap((a) => a.slots.map((s) => [s.key, { label: s.label, module: a.module }] as const)));
const GRADED = new Set(['Measured', 'Reviewed', 'Sourced', 'Stated']);

/**
 * One line per figure a card is bound to, in card order. A figure the card
 * holds twice (its metric block and its read-only field) is listed once.
 */
export function sourceLines(slides: any[]): Array<{ card: number; title: string; figure: string; line: string }> {
  const seen = new Set<string>();
  const out: Array<{ card: number; title: string; figure: string; line: string }> = [];
  for (const { slide, binding } of bindingsOf(slides)) {
    const id = `${slide}:${binding.source_key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const slot = SLOTS.get(binding.source_key);
    const grade = typeof binding.grade === 'string' && GRADED.has(binding.grade) ? binding.grade : null;
    const asOf = typeof binding.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(binding.as_of) ? binding.as_of : null;
    const line = grade
      ? [slot?.module ?? 'StudioOS', grade, asOf ? `as of ${asOf}` : 'date not recorded'].join(' · ')
      : SOURCE_NOT_ON_STUDIOOS;
    out.push({ card: slide + 1, title: String(slides[slide]?.title || '').trim() || `Card ${slide + 1}`, figure: slot?.label ?? binding.source_key, line });
  }
  return out;
}

function sourcesAppendix(d: OfflineDeck): string {
  const ai = d.slides
    .map((s, i) => ({ i, title: String(s?.title || '').trim() || `Card ${i + 1}`, ai: Array.isArray(s?.fields) && s.fields.some((f: any) => f?.source === 'ai') }))
    .filter((r) => r.ai);
  const aiLine = ai.length
    ? `<p>Written with AI help: ${ai.map((r) => `card ${r.i + 1} (${esc(r.title)})`).join(', ')}.</p>`
    : '';
  const lines = sourceLines(d.slides);
  const list = lines.length
    ? `<dl class="sources">${lines.map((l) => `<div><dt>Card ${l.card} (${esc(l.title)}) · ${esc(l.figure)}</dt><dd>${esc(l.line)}</dd></div>`).join('')}</dl>`
    : `<p>${NO_SOURCES}</p>`;
  return `<section class="card" id="sources" aria-label="Sources"><div class="face"><span class="eye">Appendix</span><h2>Sources</h2>${list}${aiLine}</div></section>`;
}

async function sha256Base64(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return bytesToBase64(new Uint8Array(digest));
}

let fontsMemo: string | null = null;
function fontsCss(): string {
  if (fontsMemo) return fontsMemo;
  fontsMemo = LEGAL_FACES.filter((f) => FACES.includes(f.file)).map((f) =>
    `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weights[0]};font-display:block;`
    + `src:url(data:font/woff2;base64,${bytesToBase64(f.bytes)}) format('woff2');}`).join('');
  return fontsMemo;
}

const CSS = [
  "*{box-sizing:border-box}html,body{margin:0;background:#0b1220;color:#0f2a3d;font-family:'Public Sans',system-ui,sans-serif}",
  "header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 20px;color:#e5e7eb;font-size:13px}",
  "header b{font-family:'Space Grotesk','Public Sans',sans-serif}#count{color:#9ca3af}",
  "main{display:flex;flex-direction:column;gap:20px;padding:0 20px 24px;align-items:center}",
  ".card{width:100%;max-width:1200px}",
  ".face{aspect-ratio:16/9;background:#fbfaf7;border-radius:12px;padding:5% 6%;display:flex;flex-direction:column;gap:12px;overflow:hidden;position:relative}",
  ".eye{font:700 12px 'Public Sans',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6d28d9}",
  "h2{margin:0;font:700 clamp(22px,3.6vw,44px)/1.15 'Space Grotesk','Public Sans',sans-serif}",
  "p,li{font-size:clamp(14px,1.6vw,20px);line-height:1.5;margin:0}.sub{color:#475569}ul{margin:0;padding-left:1.2em}",
  "blockquote{margin:0;padding-left:14px;border-left:3px solid #6d28d9;font-size:clamp(15px,1.8vw,22px)}",
  ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0}.grid div{border:1px solid #e5e7eb;border-radius:9px;padding:10px}",
  "dt{font-size:12px;color:#475569}dd{margin:0;font-weight:700;font-size:clamp(16px,2vw,24px)}dd.cell-sub{font-weight:400;font-size:12px;color:#475569}",
  "img{max-width:100%;max-height:55%;object-fit:contain;align-self:flex-start;border-radius:8px}",
  ".nr,.missing{color:#64748b;font-style:normal}",
  ".sources{display:flex;flex-direction:column;gap:6px;margin:0}.sources dd{font-weight:400;font-size:13px}",
  ".notes{margin-top:10px;background:#111827;color:#e5e7eb;border-radius:10px;padding:12px 14px}.notes .eye{color:#c4b5fd}.notes .nr{color:#9ca3af}",
  ".mark{position:absolute;right:4%;bottom:4%;max-height:8%;max-width:20%}",
  "footer{color:#9ca3af;font-size:12px;text-align:center;padding:0 20px 20px}",
  "@media print{html,body{background:#fff}header{display:none}[hidden]{display:block!important}.card{break-after:page}.notes{background:#fff;color:#0f2a3d;border:1px solid #e5e7eb}}",
].join('');

/** The whole file, as a string. Same input, same bytes: the ledger's hash names this exact file. */
export async function writeOfflineDeck(d: OfflineDeck): Promise<string> {
  const title = String(d.title || '').trim() || 'Pitch deck';
  const label = `${title}${d.version == null ? '' : ` · v${d.version}`}`;
  const csp = `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'sha256-${await sha256Base64(NAV_SCRIPT)}'; base-uri 'none'; form-action 'none'`;
  const mark = d.watermark && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(d.watermark)
    ? `<img class="mark" src="${d.watermark}" alt="">` : '';
  const cards = d.slides.map((s, i) => card(s, i, d, mark));
  if (d.sources) cards.push(sourcesAppendix(d));
  const count = `${cards.length} card${cards.length === 1 ? '' : 's'}`;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${esc(label)}</title><style>${fontsCss()}${CSS}</style></head><body>`
    + `<header><b>${esc(label)}</b><span id="count">${count}</span></header>`
    + `<main>${cards.join('')}</main>`
    + (d.footer ? `<footer>${esc(d.footer)}</footer>` : '')
    + `<script>${NAV_SCRIPT}</script></body></html>`;
}
