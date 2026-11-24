/**
 * D7121 part 2 (#7121, PGW04–PGW06) — the Wellness deck as HTML, for the committed PDF.
 *
 * `scripts/build-wellness-brief.mjs` renders this with Chromium into
 * `frontend/public/program-briefs/axal-vc-wellness-v1.pdf`, the way
 * `scripts/build-program-briefs.mjs` renders the kit's decks; the SPA never runs it. The words
 * are the canvas's slides (`design/incoming/Program Wellness Presentation Page.dc.html`,
 * `SL[1]`–`SL[5]`), and the purpose, audience and the four steps come from the page's own module,
 * so the page and the PDF tell one story. It reads nothing live: no expert, member, session or
 * journal entry is ever in it.
 *
 * The slide master is the kit's (`../programs/deck.js`: its class names and `DECK_CSS`), so the
 * Wellness deck matches its siblings; `WELLNESS_DECK_CSS` adds what only Wellness draws (the
 * private bracket over steps 1 and 2, the dashed planned box, the dawn line, the cover image).
 * `gray` draws the grayscale print sheet (PGW05): no hue carries meaning and the cover image is
 * left out. Plain functions over strings, every value escaped, no React.
 */
import { DECK_CSS, SITE_HOST } from '../programs/deck.js';
import { WELLNESS_PRESENTATION, AVAILABILITY, PURPOSE, AUDIENCE, FLOW } from './wellnessPresentation.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = (n) => String(n).padStart(2, '0');
const urlLink = (u) => `<a href="https://${esc(u)}">${esc(u)}</a>`;

/** The slides' own words, from the canvas's `SL` (PGW04A–E). */
export const DECK = Object.freeze({
  cover: { line: 'Take a moment to check in.' },
  who: {
    eyebrow: 'Who it helps',
    title: 'Founders, Administrators, and the people who look after them.',
    cards: [
      ['Founders', 'With access to Wellbeing: a private weekly check-in and a way to find support.'],
      ['Administrators', 'The same personal workspace, for themselves only.'],
      ['Studio operators', 'Introduce it and share this deck. They never see what anyone writes or books.'],
    ],
  },
  what: {
    eyebrow: 'What happens',
    title: 'From the heart to a session you book yourself.',
    privateLabel: 'Private to you',
    boundary: ['Private boundary:', 'nothing you write goes to an expert, to HQ or to a model. Eadwyn never reads your check-ins.'],
  },
  scope: {
    eyebrow: 'Available now · planned',
    title: 'What exists today, and what comes next.',
    now: ['Weekly check-in and your past weeks', 'Expert directory', 'Resources library', '1:1 booking and My bookings'],
    later: ['Daily and monthly reflections', 'Recommendations from interests you choose', 'Group sessions with seats'],
    choice: ['Your choice:', 'mindfulness and spiritual or philosophical support are things you choose to look for. The check-in assumes no belief.'],
  },
  closing: {
    title: 'Access and next step.',
    rows: [
      ['Account', 'A signed-in founder or Administrator with access to Wellbeing.'],
      ['Privacy', 'Only you read your check-ins. Eadwyn never reads them.'],
      ['Sessions', 'Each expert sets services and price; you see both before you confirm.'],
      ['Not promised', 'Emergency care, diagnosis, any outcome or endorsement.'],
    ],
    next: [
      ['Read the presentation', 'axal.vc/programs/wellness', 'The same story, kept current.'],
      ['Eligible members open', 'axal.vc/wellbeing', 'Your own workspace, after sign-in.'],
    ],
  },
});

/** The canvas's drawn dawn line: a horizon, a half-sun arc and a few strokes. Decorative. */
const dawn = (w) => `<svg class="w-dawn" viewBox="0 0 200 84" width="${w}" height="${Math.round(w * 0.42)}" fill="none" stroke-linecap="round" aria-hidden="true" focusable="false">`
  + '<path d="M8 70h184" stroke="currentColor" stroke-width="1.4"/>'
  + '<path d="M68 70a32 32 0 0 1 64 0" stroke="currentColor" stroke-width="1.6"/>'
  + '<path d="M100 26v-12M70 38l-8-8M130 38l8-8M52 58H40M148 58h12" stroke="currentColor" stroke-width="1.2" opacity=".7"/>'
  + '<path d="M36 78h36M128 78h36" stroke="currentColor" stroke-width="1" opacity=".5"/></svg>';

function slide(p, n, body, label, cls = '', bg = '') {
  return `<section class="d-sl${cls}" aria-label="${esc(`Slide ${n} of ${p.slides}: ${label}`)}">${bg}`
    + `<header class="d-top"><span class="d-logo"><img src="{{MARK}}" alt=""><b>Axal VC</b></span><span class="d-prog">${esc(p.name)}</span><span class="d-n">${pad(n)} / ${pad(p.slides)}</span></header>`
    + `<div class="d-body">${body}</div>`
    + `<footer class="d-foot"><span>${urlLink(`${SITE_HOST}${p.url}`)}</span><span>${esc(p.edition)}</span></footer>`
    + '</section>';
}

const head = (eyebrow, title) => `<div class="d-eb">${esc(eyebrow)}</div><h2 class="d-h">${esc(title)}</h2>`;

/**
 * The five slides, in order, each `{ title, html, alt }`. The entry's availability and edition
 * are the page's (`wellnessPresentation.js`); a deck without an edition throws, because the
 * footer of every slide carries it.
 */
export function wellnessSlides(entry = WELLNESS_PRESENTATION, { gray = false } = {}) {
  if (!entry.edition) throw new Error('wellness deck: the map entry has no edition');
  const a = AVAILABILITY[entry.availability];
  if (!a) throw new Error(`wellness deck: availability "${entry.availability}" has no words`);
  const avail = `<span class="d-av is-${esc(entry.availability)}"><i aria-hidden="true">${esc(a.glyph)}</i>${esc(a.label)}</span>`;

  const coverBg = gray ? '' : '<img class="w-bg" src="{{ART}}" alt=""><span class="w-scrim" aria-hidden="true"></span>';
  const cover = `<div class="d-cov"><div>${avail}<h1 class="d-cov-name">${esc(entry.name)}</h1>`
    + `<p class="d-cov-purpose">${esc(PURPOSE)}</p><p class="d-cov-aud">${esc(AUDIENCE)}</p><p class="d-cov-ed">${esc(entry.edition)}</p></div>`
    + `<div class="w-cov-dawn">${gray ? dawn(560) : ''}<p>${esc(DECK.cover.line)}</p></div></div>`;

  const who = head(DECK.who.eyebrow, DECK.who.title)
    + `<div class="d-cards">${DECK.who.cards.map(([t, x], i) => `<div class="d-card"><span class="d-card-n">${pad(i + 1)}</span><h3>${esc(t)}</h3><p>${esc(x)}</p></div>`).join('')}</div>`;

  const what = head(DECK.what.eyebrow, DECK.what.title)
    + `<div class="w-sfl"><div class="w-spriv"><span>${esc(DECK.what.privateLabel)}</span></div><ol>`
    + FLOW.map((s) => `<li class="w-sfn is-${s.n}"><div class="w-sfn-top"><span class="w-sfn-g" aria-hidden="true">${esc(s.g)}</span><span class="w-sfn-n">${s.n}</span></div>`
      + `<span class="w-sfn-k">${esc(s.k)}</span><h3>${esc(s.t)}</h3><p class="w-sfn-who">Seen by: <b>${esc(s.who.toLowerCase())}</b></p></li>`).join('')
    + `</ol><p class="w-sbound"><b>${esc(DECK.what.boundary[0])}</b> ${esc(DECK.what.boundary[1])}</p></div>`;

  const scope = head(DECK.scope.eyebrow, DECK.scope.title)
    + '<div class="w-sscope"><div class="is-now"><h3><i aria-hidden="true">✓</i>Available now</h3><ul>'
    + DECK.scope.now.map((t) => `<li>${esc(t)}</li>`).join('') + '</ul></div>'
    + '<div class="is-later"><h3><i aria-hidden="true">◌</i>Planned · not available yet</h3><ul>'
    + DECK.scope.later.map((t) => `<li><span class="w-pl">Planned · </span>${esc(t)}</li>`).join('') + '</ul></div></div>'
    + `<p class="w-schoice"><b>${esc(DECK.scope.choice[0])}</b> ${esc(DECK.scope.choice[1])}</p>`;

  const c = DECK.closing;
  const closing = head('Taking part', c.title)
    + `<div class="d-clo"><ul class="d-clo-rows">${c.rows.map(([k, v]) => `<li><b>${esc(k)}</b><span>${esc(v)}</span></li>`).join('')}</ul>`
    + `<div class="d-clo-next">${c.next.map(([k, u, w]) => `<div><div class="d-clo-k">${esc(k)}</div><p class="d-clo-url">${urlLink(u)}</p><p class="d-clo-w">${esc(w)}</p></div>`).join('')}</div></div>`;

  // Text alternatives: the canvas's PGW06, with the cover's availability in the page's words.
  return [
    { title: 'Cover', html: slide(entry, 1, cover, 'Cover', gray ? ' w-cov' : ' w-cov is-img', coverBg), alt: `Cover: Wellness, ${a.label.toLowerCase()}; purpose and audience; ${entry.edition}; the words “${DECK.cover.line}”${gray ? ' beside a drawn dawn line' : ' over a calm dawn landscape (decorative background)'}.` },
    { title: 'Who it helps', html: slide(entry, 2, who, 'Who it helps'), alt: 'Three audiences: founders with access to Wellbeing, Administrators for their own workspace, and studio operators who introduce it but never see entries.' },
    { title: 'What happens', html: slide(entry, 3, what, 'What happens'), alt: 'Four steps from the heart in the header to private reflection, discovery and a 1:1 session the member books; who sees each step; the private boundary.' },
    { title: 'Available now and planned', html: slide(entry, 4, scope, 'Available now and planned'), alt: 'Available now: weekly check-in and past weeks, expert directory, resources, 1:1 booking. Planned, not available yet: daily and monthly reflections, recommendations from chosen interests, group sessions. Spiritual support is a choice.' },
    { title: 'Access and next step', html: slide(entry, 5, closing, 'Access and next step'), alt: 'Conditions: account, privacy, sessions, not promised; two addresses; public page URL and edition date.' },
  ];
}

/** The whole deck as one HTML body; `{{MARK}}` and `{{ART}}` are filled by the builder. */
export function wellnessDeckHtml(entry = WELLNESS_PRESENTATION, { gray = false } = {}) {
  const slides = wellnessSlides(entry, { gray });
  if (slides.length !== entry.slides) throw new Error(`wellness deck: the map entry says ${entry.slides} slides, the deck draws ${slides.length}`);
  return `<main class="d-deck w-deck${gray ? ' is-gray' : ''}" lang="en">${slides.map((s) => s.html).join('')}</main>`;
}

/**
 * What only Wellness draws, on top of the kit's master (PGW04, PGW05): the warm off-white page,
 * sage for the private steps, the proposed chip dashed, the cover image under a dark scrim, and
 * the grayscale overrides. Nothing under 22px.
 */
export const WELLNESS_DECK_CSS = `${DECK_CSS}
.w-deck .d-sl { background: #FAF7F2; position: relative; }
.w-deck .d-card { background: #fff; border-color: #E9E3D8; }
.w-deck .d-av.is-proposed { border-style: dashed; border-color: #9a96a8; background: #fff; color: #4a4553; }
.w-deck .d-av.is-elig { border-color: #b9cdbf; background: #EEF3EF; color: #3d5848; }

/* Cover: the owner's dawn image under a dark scrim (colour); the drawn dawn line (grayscale). */
.w-cov .w-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
.w-cov .w-scrim { position: absolute; inset: 0; z-index: 0; background: linear-gradient(90deg, rgba(20,15,32,.9) 0%, rgba(20,15,32,.72) 52%, rgba(20,15,32,.3) 100%); }
.w-cov > .d-top, .w-cov > .d-body, .w-cov > .d-foot { position: relative; z-index: 1; }
.w-cov-dawn { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; color: #6F8F7A; }
.w-cov-dawn p { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 40px; letter-spacing: -.02em; color: #4A6656; text-align: center; }
.w-cov.is-img { background: #1d1530; color: #fff; }
.w-cov.is-img .d-prog, .w-cov.is-img .d-n, .w-cov.is-img .d-cov-name, .w-cov.is-img .d-cov-purpose { color: #fff; }
.w-cov.is-img .d-prog { border-left-color: rgba(255,255,255,.4); }
.w-cov.is-img .d-cov-aud, .w-cov.is-img .d-cov-ed, .w-cov.is-img .d-foot { color: #E4DCF5; }
.w-cov.is-img .d-foot { border-top-color: rgba(255,255,255,.35); }
.w-cov.is-img .d-av { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.45); color: #fff; }
.w-cov.is-img .w-cov-dawn { justify-content: flex-end; height: 100%; padding-bottom: 40px; }
.w-cov.is-img .w-cov-dawn p { color: #fff; }

/* The four steps, with the private bracket over steps 1 and 2. */
.w-sfl { margin-top: 84px; position: relative; }
.w-sfl ol { display: grid; grid-template-columns: repeat(4, 1fr); gap: 64px; }
.w-sfn { position: relative; background: #fff; border: 3px solid #E9E3D8; border-radius: 24px; padding: 30px 30px 28px; }
.w-sfn.is-1, .w-sfn.is-2 { background: #EEF3EF; border-color: #b9cdbf; }
.w-sfn.is-4 { border-color: #141118; border-width: 4px; }
.w-sfn:not(:last-child)::after { content: '→'; position: absolute; right: -52px; top: 50%; transform: translateY(-50%); font-size: 40px; font-weight: 700; color: var(--acc); }
.w-sfn-top { display: flex; align-items: center; gap: 16px; }
.w-sfn-g { display: inline-grid; place-items: center; width: 60px; height: 60px; border-radius: 99px; border: 3px solid #6F8F7A; color: #4A6656; background: #fff; font-size: 30px; font-weight: 700; }
.w-sfn.is-4 .w-sfn-g { border-color: var(--acc); color: var(--acc-ink); }
.w-sfn-n { font-size: 26px; font-weight: 700; color: var(--mut); }
.w-sfn-k { display: block; margin-top: 20px; font-size: 22px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: var(--mut); }
.w-sfn h3 { font-size: 38px; line-height: 1.1; letter-spacing: -.025em; margin-top: 10px; }
.w-sfn-who { font-size: 24px; color: var(--body); margin-top: 18px; padding-top: 14px; border-top: 2px solid #E9E3D8; }
.w-spriv { position: absolute; left: 0; top: -26px; width: calc(50% - 32px); height: 14px; border: 3px solid #6F8F7A; border-bottom: 0; border-radius: 6px 6px 0 0; }
.w-spriv span { position: absolute; left: 50%; top: -18px; transform: translateX(-50%); background: #FAF7F2; padding: 0 16px; font-size: 22px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: #4A6656; line-height: 1.3; white-space: nowrap; }
.w-sbound { margin-top: 40px; border: 3px solid #b9cdbf; background: #EEF3EF; border-radius: 20px; padding: 20px 30px; font-size: 28px; color: var(--body); }
.w-sbound b, .w-schoice b { color: #141118; }

/* Available now, and planned (dashed, ◌ and the word, never hue alone). */
.w-sscope { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 52px; }
.w-sscope > div { border-radius: 24px; padding: 36px 40px; background: #fff; border: 3px solid #E9E3D8; }
.w-sscope > div.is-later { border-style: dashed; border-color: #9a96a8; background: transparent; }
.w-sscope h3 { font-size: 40px; letter-spacing: -.025em; display: flex; align-items: center; gap: 16px; }
.w-sscope h3 i { font-style: normal; color: #4A6656; }
.w-sscope ul { margin-top: 20px; }
.w-sscope li { font-size: 30px; line-height: 1.35; padding: 14px 0; border-top: 2px solid #E9E3D8; color: var(--body); }
.w-pl { color: var(--mut); font-weight: 600; }
.w-schoice { margin-top: 36px; font-size: 28px; color: var(--body); background: #F3F0FA; border-radius: 20px; padding: 20px 30px; }

/* Grayscale print sheet (PGW05). */
.w-deck.is-gray .d-sl { background: #fff; }
.w-deck.is-gray .d-card { border-color: #c4c4c4; }
.w-deck.is-gray .d-av.is-proposed, .w-deck.is-gray .d-av.is-elig { background: #fff; border-color: #141118; color: #141118; }
.w-deck.is-gray .w-cov-dawn, .w-deck.is-gray .w-cov-dawn p { color: #141118; }
.w-deck.is-gray .w-sfn, .w-deck.is-gray .w-sfn.is-1, .w-deck.is-gray .w-sfn.is-2 { background: #fff; border-color: #8a8a8a; }
.w-deck.is-gray .w-sfn.is-4 { border-color: #141118; }
.w-deck.is-gray .w-sfn-g { border-color: #141118; color: #141118; }
.w-deck.is-gray .w-spriv { border-color: #141118; }
.w-deck.is-gray .w-spriv span { background: #fff; color: #141118; }
.w-deck.is-gray .w-sbound { background: #fff; border-color: #141118; }
.w-deck.is-gray .w-sscope > div { border-color: #8a8a8a; }
.w-deck.is-gray .w-sscope h3 i { color: #141118; }
.w-deck.is-gray .w-schoice { background: #fff; border: 3px solid #c4c4c4; }
`;
