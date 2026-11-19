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

/**
 * The slide master's stylesheet (PGS04–PGS05): one `.d-sl` is one 1920 × 1080 page, printed at
 * 13.333 × 7.5 in; 96px side margins, no text under 22px; `.d-deck.is-gray` is the grayscale
 * print variant (every hue becomes ink, dark fills become outlines, the art turns grey). A string
 * here, not a `.css` file under `src/`, because it names the PDF's embedded faces, which no page
 * stylesheet may (`app_typography.test.mjs`).
 */
export const DECK_CSS = `* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
.d-deck {
  --acc: #6d28d9; --acc-ink: #5b21b6; --wash: #f4f0fe; --line: #dedce4; --mut: #5f5a69; --body: #3f3b47; --ink: #141118;
  font-family: 'Public Sans', sans-serif; color: var(--ink); -webkit-font-smoothing: antialiased;
}
.d-deck ul, .d-deck ol { list-style: none; }
.d-deck a { color: inherit; text-decoration: none; }
.d-deck h1, .d-deck h2, .d-deck h3 { font-family: 'Bricolage Grotesque', 'Public Sans', sans-serif; font-weight: 800; }
.d-sl {
  width: 1920px; height: 1080px; overflow: hidden; display: flex; flex-direction: column; padding: 56px 96px 48px;
  font-size: 28px; line-height: 1.4; background: #fff; break-after: page; page-break-after: always;
}
.d-sl:last-child { break-after: auto; page-break-after: auto; }
.d-top { display: flex; align-items: center; gap: 20px; height: 44px; flex: none; }
.d-logo { display: inline-flex; align-items: center; gap: 12px; }
.d-logo img { width: 36px; height: 36px; }
.d-logo b { font-family: 'Bricolage Grotesque', sans-serif; font-size: 26px; font-weight: 800; letter-spacing: -.02em; }
.d-prog { font-size: 24px; font-weight: 700; color: var(--body); padding-left: 20px; border-left: 2px solid var(--line); line-height: 36px; }
.d-n { margin-left: auto; font-size: 22px; font-weight: 700; color: var(--mut); font-variant-numeric: tabular-nums; }
.d-body { flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0; padding: 20px 0; }
.d-foot { display: flex; justify-content: space-between; align-items: center; flex: none; border-top: 2px solid var(--line); padding-top: 16px; font-size: 22px; color: var(--mut); }
.d-eb { font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; color: var(--acc-ink); }
.d-h { font-size: 76px; line-height: 1.04; letter-spacing: -.04em; margin-top: 14px; max-width: 1560px; }
.d-av { display: inline-flex; align-items: center; gap: 12px; padding: 10px 24px; border-radius: 99px; border: 2px solid #c4b5fd; background: var(--wash); color: var(--acc-ink); font-size: 26px; font-weight: 800; letter-spacing: .02em; }
.d-av i { font-style: normal; font-size: 22px; }

/* Cover */
.d-cov { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, .7fr); gap: 72px; align-items: center; height: 100%; }
.d-cov-name { font-size: 150px; line-height: .92; letter-spacing: -.055em; margin-top: 30px; }
.d-cov-purpose { font-size: 46px; line-height: 1.26; letter-spacing: -.015em; font-weight: 500; margin-top: 34px; }
.d-cov-aud { font-size: 28px; color: var(--body); margin-top: 26px; line-height: 1.45; }
.d-cov-ed { font-size: 24px; color: var(--mut); margin-top: 30px; font-weight: 700; }
.d-cov-img { border-radius: 28px; overflow: hidden; height: 780px; background: #1a1328; }
.d-cov-img img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* The journey */
.d-tl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 60px; }
.d-tl > li { position: relative; padding: 58px 40px 0 0; }
.d-tl > li::before { content: ''; position: absolute; left: 0; right: 0; top: 15px; height: 4px; background: var(--acc); }
.d-tl > li:last-child::before { right: 40px; }
.d-tl-node { position: absolute; left: 0; top: 0; width: 34px; height: 34px; border-radius: 99px; background: #fff; border: 5px solid var(--acc); z-index: 1; }
.d-tl-k { font-size: 24px; font-weight: 700; color: var(--acc-ink); }
.d-tl h3 { font-size: 48px; line-height: 1.06; letter-spacing: -.035em; margin-top: 10px; }
.d-tl p { font-size: 26px; line-height: 1.42; color: var(--body); margin-top: 14px; }
.d-tl-span { margin-top: 48px; border: 3px dashed var(--acc); border-radius: 20px; padding: 22px 30px; font-size: 27px; line-height: 1.4; color: var(--body); background: var(--wash); }
.d-tl-span b { color: var(--ink); }

/* Cards, steps and lists */
.d-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 36px; margin-top: 60px; }
.d-card { border: 2px solid var(--line); border-radius: 24px; padding: 40px 40px 44px; }
.d-card-n { font-size: 26px; font-weight: 700; color: var(--acc-ink); }
.d-card h3 { font-size: 46px; line-height: 1.08; letter-spacing: -.03em; margin-top: 18px; }
.d-card p { font-size: 28px; line-height: 1.42; color: var(--body); margin-top: 16px; }
.d-two { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; margin-top: 36px; }
.d-two-k { font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; color: var(--mut); padding-bottom: 10px; }
.d-stg li { display: flex; gap: 26px; align-items: center; padding: 13px 0; border-top: 2px solid var(--line); font-size: 30px; line-height: 1.26; }
.d-stg li:first-child { border-top: 0; }
.d-stg-n { flex: none; display: inline-grid; place-items: center; width: 54px; height: 54px; border-radius: 99px; border: 3px solid var(--acc); color: var(--acc-ink); font-size: 24px; font-weight: 700; }
.d-list li { padding: 12px 0; border-top: 2px solid var(--line); }
.d-list li:first-child { border-top: 0; }
.d-list b { display: block; font-size: 32px; letter-spacing: -.02em; line-height: 1.2; }
.d-list span { display: block; font-size: 25px; line-height: 1.34; color: var(--body); margin-top: 4px; }

/* Closing */
.d-clo { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, .92fr); gap: 72px; margin-top: 44px; align-items: start; }
.d-clo-rows li { display: grid; grid-template-columns: 270px 1fr; gap: 28px; padding: 16px 0; border-top: 2px solid var(--line); font-size: 28px; line-height: 1.36; }
.d-clo-rows li:first-child { border-top: 0; }
.d-clo-rows b { font-size: 22px; text-transform: uppercase; letter-spacing: .1em; color: var(--mut); padding-top: 5px; line-height: 1.3; }
.d-clo-next { background: var(--ink); color: #fff; border-radius: 28px; padding: 44px 48px; display: flex; flex-direction: column; gap: 30px; }
.d-clo-k { font-size: 22px; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; color: #c4b5fd; }
.d-clo-url { font-size: 34px; font-weight: 700; color: #fff; margin-top: 8px; letter-spacing: -.01em; line-height: 1.25; text-decoration: underline; text-underline-offset: 6px; text-decoration-thickness: 2px; }
.d-clo-w { font-size: 25px; color: rgba(255,255,255,.84); margin-top: 6px; line-height: 1.4; }

/* Grayscale print variant: no fill depends on hue; dark panels print as outlines. */
.d-deck.is-gray { --acc: #141118; --acc-ink: #141118; --wash: #f3f3f3; --line: #c4c4c4; --mut: #4d4d4d; --body: #262626; }
.d-deck.is-gray img { filter: grayscale(1) contrast(1.05); }
.d-deck.is-gray .d-av { background: #fff; border-color: #141118; color: #141118; }
.d-deck.is-gray .d-clo-next { background: #fff; color: #141118; border: 3px solid #141118; }
.d-deck.is-gray .d-clo-k, .d-deck.is-gray .d-clo-url { color: #141118; }
.d-deck.is-gray .d-clo-w { color: #262626; }
.d-deck.is-gray .d-cov-img { background: #fff; }
`;
