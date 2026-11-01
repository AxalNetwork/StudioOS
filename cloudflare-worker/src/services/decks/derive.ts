/**
 * D1583 (#3830, deck builder v2 F4) — a teaser, a one-pager and a memo from one
 * frozen deck version.
 *
 * Pure: plain values in, plain values out, no binding and no D1.
 * `routes/deck_derive.ts` reads the version and the venture, calls these, files
 * the result as a proposal, and on Accept stores it in `deck_derivatives`.
 *
 * ONE SOURCE. Every derived output is made from the master version's own
 * cards, first through `shareSlides()` with figures on and sources, notes and
 * bands off (`shareInclude.ts`'s never-rules: no internal score, no bank
 * field, no quote without consent), then rebuilt from a whitelist
 * (`cleanCard`). A cleaned card holds no binding, so no provenance badge or
 * source chip can be drawn from it, and no speaker notes.
 *
 * NO MODEL WRITES A FIGURE. The teaser and the one-pager are made by code and
 * cost nothing. The memo is `memo_write`'s prose around placeholders: every
 * number the cards state becomes `{{Fn}}` before the model reads them, and
 * `memoFrom` puts the deck's own value back. A sentence where the model wrote
 * a digit, or named a placeholder that does not exist, is dropped. So every
 * figure a memo states is one the deck states (`figuresOf`).
 *
 * BLIND (`blindCards`, `redact`): the venture's, the company's and the
 * founders' names are replaced, a team or founders card is left out, and a
 * logo, a photo, a background picture, a link, a video and an audio block are
 * removed, so no NDA or data room travels with it.
 */
import { figuresOf } from './variants';
import { shareSlides } from './shareInclude';
import { reflowSlides } from './reflow';

export const DERIVE_FORMATS = ['teaser', 'one_pager', 'memo'] as const;
export type DeriveFormat = (typeof DERIVE_FORMATS)[number];
export const DERIVE_PAGE = 'Founder · Raise · Pitch deck';
export const DERIVE_OPTIONS: Readonly<Record<DeriveFormat, string>> = Object.freeze({
  teaser: 'derive:teaser', one_pager: 'derive:one_pager', memo: 'derive:memo',
});
export const FORMAT_LABEL: Readonly<Record<DeriveFormat, string>> = Object.freeze({
  teaser: 'Teaser', one_pager: 'One-pager', memo: 'Memo',
});

/** At most this many cards in a teaser, the cover included. */
export const TEASER_MAX = 6;
/** A memo's text is at most this long. */
export const MEMO_MAX = 6000;
/** The one-pager is laid out for a page: 4:3, the nearest aspect the grid has (D1554). */
export const ONE_PAGER_ASPECT = '4:3';

export const BLIND_COMPANY = 'the company';
export const BLIND_FOUNDER = 'a founder';

/** Who a blind output must not name. */
export type Identity = { venture: string[]; founders: string[] };

const TEAM = /\b(team|founders?|leadership|people)\b/i;
/** The sections a teaser keeps, in the order an investor reads them (plan §F4). */
const TEASER_SECTIONS: readonly RegExp[] = [
  /\bproblem\b/i, /\b(solution|product)\b/i, /\b(traction|metrics|growth|customers)\b/i,
  /\b(market|opportunity)\b/i, /\b(business model|revenue|pricing)\b/i, /\b(ask|raise|round|funding|use of funds)\b/i,
];

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace every name, longest first, as a whole word and in any case. */
export function redact(text: string, who: Identity): string {
  let out = String(text ?? '');
  const names = [
    ...who.venture.map((n) => [n, BLIND_COMPANY] as const),
    ...who.founders.map((n) => [n, BLIND_FOUNDER] as const),
  ].filter(([n]) => n.trim().length >= 2).sort((a, b) => b[0].length - a[0].length);
  for (const [name, put] of names) {
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name.trim())}(?=$|[^\\p{L}\\p{N}])`, 'giu'), (_m, pre) => `${pre}${put}`);
  }
  return out;
}

/** The words a card shows, in reading order. */
export function cardText(card: any): string {
  const parts: string[] = [str(card?.title, 120), str(card?.subtitle, 200), str(card?.body)];
  for (const b of Array.isArray(card?.bullets) ? card.bullets : []) parts.push(str(b, 400));
  for (const b of Array.isArray(card?.blocks) ? card.blocks : []) {
    if (b?.kind === 'text') parts.push(str(b.text));
    if (b?.kind === 'metric' && b.value) parts.push(`${str(b.label, 60)}: ${str(b.value, 80)}`);
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * One card rebuilt from a whitelist: its words, its layout, and blocks that
 * carry no binding. A legacy card's fields fold into its body and bullets.
 */
export function cleanCard(card: any, blind: boolean): any {
  const out: any = { title: str(card?.title, 120) || 'Slide' };
  const sub = str(card?.subtitle, 200);
  if (sub) out.subtitle = sub;
  const body: string[] = [str(card?.body)].filter(Boolean);
  const bullets: string[] = (Array.isArray(card?.bullets) ? card.bullets : []).map((b: unknown) => str(b, 400)).filter(Boolean);
  for (const f of Array.isArray(card?.fields) ? card.fields : []) {
    if (f?.kind === 'paragraph' || f?.kind === 'quote' || f?.kind === 'subtitle') { const v = str(f.value); if (v) body.push(v); }
    else if (f?.kind === 'bullets') for (const v of Array.isArray(f.value) ? f.value : []) { const s = str(v, 400); if (s) bullets.push(s); }
    else if (f?.kind === 'metric_grid') for (const m of Array.isArray(f.value) ? f.value : []) { const v = str(m?.value, 80); if (v) bullets.push(`${str(m?.label, 60)}: ${v}`); }
  }
  if (body.length) out.body = body.join('\n\n').slice(0, 4000);
  if (bullets.length) out.bullets = bullets.slice(0, 16);
  for (const k of ['layout', 'structure'] as const) if (typeof card?.[k] === 'string') out[k] = card[k];
  if (Array.isArray(card?.areas)) out.areas = card.areas;
  if (!blind && card?.background && typeof card.background === 'object') out.background = card.background;
  const blocks: any[] = [];
  for (const b of Array.isArray(card?.blocks) ? card.blocks : []) {
    const base = { id: b?.id, kind: b?.kind, grid: b?.grid };
    if (b?.kind === 'text') blocks.push({ ...base, style: b.style, text: str(b.text) });
    else if (b?.kind === 'metric') blocks.push({ ...base, label: str(b.label, 60), value: b.value == null ? null : str(b.value, 80) || null });
    else if (b?.kind === 'chart') {
      // Only a series the founder typed keeps its points; a bound series is the record's, and leaves.
      const series = (Array.isArray(b.series) ? b.series : [])
        .filter((s: any) => !s?.binding && Array.isArray(s?.points) && s.points.length)
        .map((s: any) => ({ label: str(s.label, 80), points: s.points }));
      if (series.length) blocks.push({ ...base, chart_type: b.chart_type, series, range: b.range, labels: b.labels !== false });
    } else if (b?.kind === 'graphic') {
      blocks.push({ ...base, graphic: b.graphic, ratio: b.ratio, ...(b.diagram ? { diagram: b.diagram } : {}) });
    } else if (b?.kind === 'image') {
      if (blind && (b.tag === 'logo' || b.tag === 'photo')) continue;
      blocks.push({ ...base, image_url: b.image_url, alt: str(b.alt, 200), tag: b.tag, ...(b.fit ? { fit: b.fit } : {}), ...(b.crop ? { crop: b.crop } : {}) });
    } else if (!blind && (b?.kind === 'video' || b?.kind === 'audio' || b?.kind === 'link')) {
      const { binding: _drop, ...rest } = b;
      blocks.push(rest);
    }
  }
  if (blocks.length) out.blocks = blocks;
  return out;
}

/** The master's cards as a derived output may start from: shared-safe, then whitelisted. */
export function sourceCards(slides: unknown, blind: boolean): any[] {
  return shareSlides(slides, { figures: true, sources: false, notes: false, bands: false })
    .filter((c: any) => c && !c.hidden)
    .map((c: any) => cleanCard(c, blind));
}

/** Every string in a card, redacted. */
function redactCard(card: any, who: Identity): any {
  const walk = (v: any): any => (typeof v === 'string' ? redact(v, who)
    : Array.isArray(v) ? v.map(walk)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'image_url' || k === 'url' ? x : walk(x)]))
        : v);
  return walk(card);
}

/** A blind set: no team card, and no name of the venture, the company or a founder. */
export function blindCards(cards: any[], who: Identity): any[] {
  return cards.filter((c, i) => i === 0 || !TEAM.test(String(c?.title ?? ''))).map((c) => redactCard(c, who));
}

/** The teaser: the cover, then the investor's sections in deck order, at most TEASER_MAX cards. */
export function teaserCards(slides: unknown, opts: { blind: boolean; who: Identity }): any[] {
  const cards = sourceCards(slides, opts.blind);
  if (!cards.length) return [];
  const [cover, ...rest] = cards;
  const eligible = rest.filter((c) => !(opts.blind && TEAM.test(String(c.title ?? ''))));
  const picked = eligible.filter((c) => TEASER_SECTIONS.some((re) => re.test(`${c.title} ${c.subtitle ?? ''}`)));
  const chosen = (picked.length >= 2 ? picked : eligible).slice(0, TEASER_MAX - 1);
  const out = [cover, ...chosen];
  if (!opts.blind) return out;
  const blind = blindCards(out, opts.who);
  blind[0] = { ...blind[0], title: redact(String(blind[0].title ?? ''), opts.who) || 'Teaser' };
  return blind;
}

const firstSentence = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = /^(.{1,220}?[.!?])(\s|$)/.exec(t);
  return m ? m[1] : t.slice(0, 220);
};

/** The figures a set of cards shows as metrics, label and value. */
function metricsOf(cards: any[]): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const c of cards) for (const b of Array.isArray(c?.blocks) ? c.blocks : []) {
    if (b?.kind === 'metric' && b.value) out.push({ label: str(b.label, 60) || 'Figure', value: str(b.value, 80) });
  }
  return out;
}

/**
 * The one-pager: one card holding the teaser's sections, one line each, and up
 * to four of its metrics, laid out at 4:3 and reflowed there (D1554), so
 * whatever does not fit goes to the card's notes and nothing overflows.
 */
export function onePagerCard(slides: unknown, opts: { blind: boolean; who: Identity }): any[] {
  const cards = teaserCards(slides, opts);
  if (!cards.length) return [];
  const [cover, ...sections] = cards;
  const metrics = metricsOf(cards).slice(0, 4);
  const lines = sections.map((c) => {
    const words = firstSentence(str(c.body) || (Array.isArray(c.bullets) ? c.bullets[0] ?? '' : '') || cardText({ blocks: c.blocks }));
    return words ? `${c.title}: ${words}` : String(c.title);
  });
  const blocks: any[] = [{ id: 'title', kind: 'text', style: 'heading', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, text: str(cover.title, 120) }];
  const top = metrics.length ? 4 : 2;
  metrics.forEach((m, i) => blocks.push({ id: `m${i + 1}`, kind: 'metric', grid: { c1: i * 3 + 1, c2: i * 3 + 3, r1: 2, r2: 3 }, label: m.label, value: m.value }));
  const half = Math.ceil(lines.length / 2);
  [lines.slice(0, half), lines.slice(half)].forEach((group, i) => {
    if (group.length) blocks.push({ id: `s${i + 1}`, kind: 'text', style: 'list', grid: { c1: i * 6 + 1, c2: i * 6 + 6, r1: top, r2: 6 }, text: group.join('\n') });
  });
  const card = { title: str(cover.title, 120) || 'One-pager', layout: 'custom', blocks };
  return reflowSlides([card], ONE_PAGER_ASPECT, '16:9').slides;
}

/** A figure the memo may state: its placeholder and the deck's own value. */
export type Figure = { ref: string; value: string; label?: string };
const NUMBER = /[$€£]?\d[\d,.]*\s?(?:%|[kmb]\b|x\b)?/gi;

/**
 * What `memo_write` reads: each card's words with every number replaced by a
 * placeholder, and the figure each placeholder stands for. Metrics come first
 * so a tile's figure keeps its label.
 */
export function memoFacts(cards: any[]): { cards: Array<{ title: string; text: string }>; figures: Figure[] } {
  const figures: Figure[] = [];
  const refOf = (value: string, label?: string) => {
    const v = value.trim();
    const have = figures.find((f) => f.value === v);
    if (have) return have.ref;
    const ref = `F${figures.length + 1}`;
    figures.push({ ref, value: v, ...(label ? { label } : {}) });
    return ref;
  };
  for (const m of metricsOf(cards)) refOf(m.value, m.label);
  const out = cards.map((c) => ({
    title: String(c.title ?? '').replace(NUMBER, (n) => `{{${refOf(n)}}}`),
    text: cardText({ ...c, title: '' }).replace(NUMBER, (n) => `{{${refOf(n)}}}`),
  }));
  return { cards: out, figures };
}

export const MEMO_SECTIONS = ['Summary', 'Problem', 'Solution', 'Traction', 'Market', 'Team', 'The ask', 'Risks'] as const;

/** The model's instructions and the facts, as messages. */
export function memoMessages(facts: ReturnType<typeof memoFacts>, blind: boolean) {
  const sections = MEMO_SECTIONS.filter((s) => !(blind && s === 'Team'));
  const system = [
    'You write a short investment memo from a startup\'s pitch deck, for an investor.',
    `Use these sections, each as a line "## <name>" followed by one or two short paragraphs: ${sections.join(', ')}.`,
    'NEVER write a digit. Where a figure belongs, write its placeholder exactly as given, for example {{F2}}. Use only the placeholders listed.',
    'Say only what the deck says. Where the deck says nothing about a section, write "Not recorded in the deck."',
    blind ? 'Do not name the company, its product brand or any person.' : '',
  ].filter(Boolean).join('\n');
  const user = JSON.stringify({ figures: facts.figures.map((f) => ({ ref: f.ref, label: f.label ?? null })), cards: facts.cards });
  return { system, user };
}

/**
 * The memo from `memo_write`'s answer: placeholders replaced by the deck's
 * values; a sentence holding a digit or an unknown placeholder dropped; names
 * redacted on a blind memo. `figures` lists what the memo states.
 */
export function memoFrom(output: unknown, facts: { figures: Figure[] }, opts: { blind: boolean; who: Identity }): { memo: string; figures: Figure[]; dropped: number } {
  const byRef = new Map(facts.figures.map((f) => [f.ref, f]));
  const used = new Map<string, Figure>();
  let dropped = 0;
  const lines = String(output ?? '').replace(/\r/g, '').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*##\s+/.test(line)) { kept.push(line.trim().replace(/\d/g, '')); continue; }
    const sentences = line.split(/(?<=[.!?])\s+/);
    const good: string[] = [];
    for (const s of sentences) {
      const refs = [...s.matchAll(/\{\{\s*(F\d+)\s*\}\}/g)].map((m) => m[1]);
      const bare = s.replace(/\{\{\s*F\d+\s*\}\}/g, '');
      if (/\d/.test(bare) || refs.some((r) => !byRef.has(r))) { if (s.trim()) dropped += 1; continue; }
      good.push(s.replace(/\{\{\s*(F\d+)\s*\}\}/g, (_m, r) => { const f = byRef.get(r)!; used.set(r, f); return f.value; }));
    }
    kept.push(good.join(' '));
  }
  let memo = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MEMO_MAX);
  if (opts.blind) memo = redact(memo, opts.who);
  return { memo, figures: [...used.values()], dropped };
}

/** The figures a set of cards states in the words it shows (never a grid coordinate or an id). */
export function statedFigures(cards: unknown): Set<string> {
  return figuresOf((Array.isArray(cards) ? cards : []).map((c) => cardText(c)));
}

/** The figures an output (cards, or a memo's text) states that the master does not: always empty. */
export function strayFigures(master: unknown, derived: unknown): string[] {
  const have = statedFigures(sourceCards(master, false));
  const said = typeof derived === 'string' ? figuresOf([derived]) : statedFigures(derived);
  return [...said].filter((f) => !have.has(f));
}

/** A derived output's title. */
export const derivedTitle = (format: DeriveFormat, blind: boolean, version: number | null) =>
  `${blind ? 'Blind ' : ''}${FORMAT_LABEL[format].toLowerCase()}${version != null ? ` · from v${version}` : ''}`.replace(/^./, (c) => c.toUpperCase());
