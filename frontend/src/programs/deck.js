/**
 * D6966 (#6966, PGS04–PGS06) — a program's 16:9 slide deck as HTML, for the committed PDF.
 *
 * `scripts/build-program-briefs.mjs` renders this with Chromium into
 * `frontend/public/program-briefs/axal-vc-<key>-v<n>.pdf`; the SPA never runs it. It reads the
 * same map entry and content the page draws, so the two formats tell one story: slide 1 is the
 * cover (availability, name, purpose, audience, edition), the content's `slides` follow, and
 * the last slide is the closing (conditions, next step, the public address and the edition).
 *
 * The slide master (PGS00 §5): 1920 × 1080, 96px side margins, nothing under 22px, one idea per
 * slide, text kept as text. Every slide's header carries the mark, the program and "nn / nn";
 * its footer the public URL and the edition. `gray` draws the grayscale print variant (no hue
 * carries meaning; the dark closing panel prints as an outline).
 *
 * Plain functions over strings, every value escaped, no React: the builder runs it in Node.
 */
import { AVAILABILITY } from './collect.js';

export const SITE_HOST = 'axal.vc';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = (n) => String(n).padStart(2, '0');

/** "axal.vc/contact?topic=licence" → a live link to https://axal.vc/contact?topic=licence. */
const urlLink = (u) => `<a href="https://${esc(u)}">${esc(u)}</a>`;

const avail = (p) => {
  const a = AVAILABILITY[p.avail];
  return `<span class="d-av"><i aria-hidden="true">${esc(a.glyph)}</i>${esc(p.availText || a.label)}</span>`;
};

function slide(p, n, total, body, label) {
  return `<section class="d-sl" aria-label="${esc(`Slide ${n} of ${total}: ${label}`)}">`
    + `<header class="d-top"><span class="d-logo"><img src="{{MARK}}" alt=""><b>Axal VC</b></span><span class="d-prog">${esc(p.name)}</span><span class="d-n">${pad(n)} / ${pad(total)}</span></header>`
    + `<div class="d-body">${body}</div>`
    + `<footer class="d-foot"><span>${urlLink(`${SITE_HOST}${p.canonical}`)}</span><span>${esc(p.edition)}</span></footer>`
    + '</section>';
}

const head = (eyebrow, title) => `<div class="d-eb">${esc(eyebrow)}</div><h2 class="d-h">${esc(title)}</h2>`;

/** One slide-scale block, by type (`cards`, `timeline`, `two`, `stages`, `list`). */
export function slideBlock(b) {
  switch (b.type) {
    case 'cards':
      return `<div class="d-cards">${b.items.map(([t, x], i) => `<div class="d-card"><span class="d-card-n">${pad(i + 1)}</span><h3>${esc(t)}</h3><p>${esc(x)}</p></div>`).join('')}</div>`;
    case 'timeline':
      return `<ol class="d-tl" aria-label="${esc(b.label || 'Steps')}">${b.steps.map((s) => `<li><span class="d-tl-node" aria-hidden="true"></span><span class="d-tl-k">${esc(s.k)}</span><h3>${esc(s.t)}</h3><p>${esc(s.items[0])}</p></li>`).join('')}</ol>`
        + (b.span ? `<p class="d-tl-span"><b>${esc(b.span.label)}:</b> ${esc(b.span.note)}</p>` : '');
    case 'two':
      return `<div class="d-two">${b.items.map((c) => `<div><div class="d-two-k">${esc(c.label)}</div>${slideBlock(c.block)}</div>`).join('')}</div>`;
    case 'stages':
      return `<ol class="d-stg">${b.items.map((t, i) => `<li><span class="d-stg-n" aria-hidden="true">${i + 1}</span><span>${esc(t)}</span></li>`).join('')}</ol>`;
    case 'list':
      return `<ul class="d-list">${b.items.map(([k, v]) => `<li><b>${esc(k)}</b><span>${esc(v)}</span></li>`).join('')}</ul>`;
    default:
      throw new Error(`program deck: unknown slide block type "${b.type}"`);
  }
}

/**
 * The deck's slides, in order, each `{ title, html, alt }`. The count must equal the map entry's
 * `slides`, which the page's Download PDF control prints.
 */
export function deckSlides(program, content) {
  const total = 2 + content.slides.length;
  if (total !== program.slides) throw new Error(`${program.key}: the map entry says ${program.slides} slides, the content draws ${total}`);
  const cover = `<div class="d-cov"><div>${avail(program)}<h1 class="d-cov-name">${esc(program.name)}</h1>`
    + `<p class="d-cov-purpose">${esc(program.purpose)}</p><p class="d-cov-aud">${esc(program.audience)}</p><p class="d-cov-ed">${esc(program.edition)}</p></div>`
    + (content.cover?.art ? `<div class="d-cov-img"><img src="{{ART}}" alt="${esc(content.cover.alt || '')}"></div>` : '<div></div>')
    + '</div>';
  const out = [{ title: 'Cover', html: slide(program, 1, total, cover, 'Cover'), alt: `Cover: ${program.name}, ${AVAILABILITY[program.avail].label.toLowerCase()}; purpose and audience; ${program.edition}.` }];
  content.slides.forEach((s, i) => {
    out.push({ title: s.eyebrow, html: slide(program, i + 2, total, head(s.eyebrow, s.title) + s.blocks.map(slideBlock).join(''), s.eyebrow), alt: s.alt });
  });
  const c = content.closing;
  const closing = head('Taking part', c.title)
    + `<div class="d-clo"><ul class="d-clo-rows">${c.rows.map(([k, v]) => `<li><b>${esc(k)}</b><span>${esc(v)}</span></li>`).join('')}</ul>`
    + `<div class="d-clo-next">${c.next.map(([k, u, w]) => `<div><div class="d-clo-k">${esc(k)}</div><p class="d-clo-url">${urlLink(u)}</p>${w ? `<p class="d-clo-w">${esc(w)}</p>` : ''}</div>`).join('')}</div></div>`;
  out.push({ title: 'Access and next step', html: slide(program, total, total, closing, 'Access and next step'), alt: c.alt });
  return out;
}

/** The whole deck as one HTML document body; `{{MARK}}` and `{{ART}}` are filled by the builder. */
export function deckHtml(program, content, { gray = false } = {}) {
  return `<main class="d-deck${gray ? ' is-gray' : ''}" lang="en">${deckSlides(program, content).map((s) => s.html).join('')}</main>`;
}
