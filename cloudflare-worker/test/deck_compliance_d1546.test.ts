/**
 * D1546 (#3790, deck v2 B14) — the deck's compliance labels.
 *
 *   - the forward-looking footnote appears whenever a Projected figure does
 *     (a Projected binding, a projection slot, a chart point after today), and
 *     on no other card;
 *   - round terms counsel has not approved read "Proposed, subject to counsel";
 *   - Confidential is on by default, and a deck may turn it off;
 *   - guarantee language is blocked (fixture): a sentence that promises a
 *     return never reaches a proposal;
 *   - every Worker format draws them: the HTML file, the .odp file, the
 *     editable PowerPoint (Google Slides), and the share and print reads.
 *
 * Every name and figure is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_compliance_d1546.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COMPLIANCE_DEFAULTS, CONFIDENTIAL, FLS_FOOTNOTE, ROUND_TERMS_NOTE, blockGuarantees, cardHasProjection, complianceOf, deckCompliance,
  guaranteeHits, slideFootnotes, withoutGuarantees,
} from '../src/services/decks/compliance.ts';
import { PROJECTION_FOOTNOTE } from '../src/services/decks/recordSources.ts';
import { writeOfflineDeck } from '../src/services/decks/offlineHtml.ts';
import { writeOdp } from '../src/services/decks/odp.ts';
import { writeEditableDeck } from '../src/services/decks/pptxEditable.ts';
import { sanitizeTheme } from '../src/services/decks/slideModel.ts';
import { publicDeckOf } from '../src/routes/decks.ts';

const TODAY = '2026-11-01';
const grid = { c1: 1, c2: 6, r1: 2, r2: 3 };
const metric = (label: string, value: string, source_key: string, grade: string) => ({ id: 'm1', kind: 'metric', grid, label, value, binding: { source_key, grade } });
const chart = (points: Array<{ x: string; y: number }>) => ({ id: 'c1', kind: 'chart', grid, chart_type: 'line', series: [{ label: 'Revenue', points }] });
const PROJECTED = { title: 'Financials', blocks: [metric('Projected revenue, next 12 months', '$3M', 'raise.projection_revenue_12m', 'Projected')] };
const PLAIN = { title: 'Traction', blocks: [metric('ARR', '$1.2M', 'grow.arr', 'Measured')] };
const TERMS = { title: 'The round', blocks: [metric('Pre-money valuation', '$8M', 'raise.pre_money', 'Stated')] };
const APPROVED = { title: 'The round', blocks: [metric('Pre-money valuation', '$8M', 'raise.pre_money', 'Reviewed')] };

test('one place: the footnote is the projection’s own words, and both flags default on (owner decision T, interim)', () => {
  assert.equal(FLS_FOOTNOTE, PROJECTION_FOOTNOTE);
  assert.deepEqual({ ...COMPLIANCE_DEFAULTS }, { compliance_fls: true, confidential: true });
  assert.deepEqual(complianceOf(null), { compliance_fls: true, confidential: true });
  assert.deepEqual(complianceOf({ kind: 'brand', confidential: false }), { compliance_fls: true, confidential: false });
  assert.deepEqual(complianceOf({ confidential: 'no', compliance_fls: 0 }), { compliance_fls: true, confidential: true }, 'only a real false turns a flag off');
});

test('the footnote appears whenever a Projected figure does, and on no other card', () => {
  assert.deepEqual(slideFootnotes(PROJECTED, complianceOf(null), TODAY), [FLS_FOOTNOTE], 'a projection slot');
  assert.deepEqual(slideFootnotes({ blocks: [metric('Revenue', '$3M', 'grow.mrr', 'Projected')] }, complianceOf(null), TODAY), [FLS_FOOTNOTE], 'a Projected grade on any slot');
  assert.deepEqual(slideFootnotes({ blocks: [chart([{ x: '2026-09', y: 1 }, { x: '2027-03', y: 2 }])] }, complianceOf(null), TODAY), [FLS_FOOTNOTE], 'a chart point after today');
  assert.deepEqual(slideFootnotes({ blocks: [chart([{ x: '2026-09', y: 1 }, { x: '2026-11', y: 2 }])] }, complianceOf(null), TODAY), [], 'a chart of records ends this month');
  assert.deepEqual(slideFootnotes(PLAIN, complianceOf(null), TODAY), []);
  assert.equal(cardHasProjection({ fields: [{ key: 'b', binding: { source_key: 'raise.projection_runway', grade: 'Projected' } }] }, TODAY), true, 'a bound field');
  assert.deepEqual(slideFootnotes(PROJECTED, complianceOf({ compliance_fls: false }), TODAY), [], 'compliance_fls off');
});

test('round terms counsel has not approved read "Proposed, subject to counsel"; approved terms do not', () => {
  assert.deepEqual(slideFootnotes(TERMS, complianceOf(null), TODAY), [ROUND_TERMS_NOTE]);
  assert.match(ROUND_TERMS_NOTE, /Proposed, subject to counsel/);
  assert.deepEqual(slideFootnotes(APPROVED, complianceOf(null), TODAY), []);
  assert.deepEqual(slideFootnotes({ blocks: [metric('Instrument', 'SAFE', 'raise.round_terms', 'Stated')] }, complianceOf(null), TODAY), [ROUND_TERMS_NOTE]);
});

test('deckCompliance: Confidential on by default, each card its own lines', () => {
  const d = deckCompliance([PLAIN, PROJECTED, TERMS], null, TODAY);
  assert.deepEqual(d, { confidential: true, footnotes: [[], [FLS_FOOTNOTE], [ROUND_TERMS_NOTE]] });
  assert.equal(deckCompliance([PLAIN], { kind: 'brand', confidential: false }, TODAY).confidential, false);
  assert.deepEqual(deckCompliance('not slides', null, TODAY), { confidential: true, footnotes: [] });
});

test('the theme keeps a flag only when it is turned off, so a deck saved before D1546 hashes as it did', () => {
  const url = (u: string) => u;
  assert.deepEqual(sanitizeTheme({ kind: 'brand', background: null }, url as any), { kind: 'brand', background: null });
  assert.deepEqual(sanitizeTheme({ kind: 'brand', background: null, confidential: true, compliance_fls: true }, url as any), { kind: 'brand', background: null });
  assert.deepEqual(sanitizeTheme({ kind: 'neutral_dark', background: null, confidential: false, compliance_fls: false }, url as any),
    { kind: 'neutral_dark', background: null, compliance_fls: false, confidential: false });
  assert.deepEqual(sanitizeTheme({ kind: 'brand', background: null, confidential: 'false' }, url as any), { kind: 'brand', background: null }, 'not a boolean false');
});

// ------------------------------------------------------------------ guarantee language (fixture)

const BLOCKED = [
  'We guarantee returns of 10x for every investor.',
  'Your returns are guaranteed.',
  'This is a risk-free investment.',
  'Investors can’t lose.',
  'A sure bet in a growing market.',
  'The company will certainly exit within five years.',
  'Investors will make 5x their money.',
  'Guaranteed to double by 2028.',
];
const ALLOWED = [
  'We grew ARR 3x in twelve months.',
  'Our warranty guarantees uptime for customers.',
  'The model projects $3M revenue next year.',
  'We reduce risk for lenders.',
];

test('guarantee language is blocked: each fixture sentence is found, and ordinary claims are not', () => {
  for (const s of BLOCKED) assert.ok(guaranteeHits(s).length > 0, s);
  for (const s of ALLOWED) assert.deepEqual(guaranteeHits(s), [], s);
});

test('a sentence that promises a return is dropped before it is proposed; the rest stays, keys and shape kept', () => {
  assert.deepEqual(withoutGuarantees('We grew ARR 3x. Returns are guaranteed. We hire in Q1.'), { text: 'We grew ARR 3x. We hire in Q1.', dropped: 1 });
  assert.deepEqual(withoutGuarantees('Plain words.'), { text: 'Plain words.', dropped: 0 });
  const proposal = [{ headline: 'A risk-free bet', body: 'We grew 3x. Investors can’t lose.' }, { headline: 'Team', body: null }];
  const r = blockGuarantees(proposal);
  assert.equal(r.dropped, 2);
  assert.deepEqual(r.value, [{ headline: '', body: 'We grew 3x.' }, { headline: 'Team', body: null }]);
  const card = { id: 'risk-free', kind: 'text', binding: { source_key: 'grow.arr' }, text: 'Risk-free growth.' };
  assert.deepEqual(blockGuarantees(card).value, { id: 'risk-free', kind: 'text', binding: { source_key: 'grow.arr' }, text: '' }, 'ids and bindings are never prose');
});

test('the assist and New deck routes run the block before anything is proposed (source)', () => {
  const assist = readFileSync(new URL('../src/routes/deck_assist.ts', import.meta.url), 'utf8');
  assert.match(assist, /withoutGuarantees\(wordingOf\(res\.output/);
  assert.match(assist, /code: 'guarantee_language'/);
  const fresh = readFileSync(new URL('../src/routes/deck_new.ts', import.meta.url), 'utf8');
  assert.match(fresh, /if \(rows\) rows = blockGuarantees\(rows\)\.value;/);
  assert.equal((fresh.match(/blockGuarantees\(w\.byIndex/g) || []).length, 2, 'the build and the one-card rebuild');
});

// ------------------------------------------------------------------ every format

function unzip(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i + 30 <= bytes.length && v.getUint32(i, true) === 0x04034b50) {
    const size = v.getUint32(i + 18, true), nameLen = v.getUint16(i + 26, true), extra = v.getUint16(i + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extra;
    out.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));
    i = start + size;
  }
  return out;
}
const BRAND = { show_footer: false, footer_text: '', watermark_url: null, can_remove_footer: true } as any;
const SLIDES = [PLAIN, PROJECTED, TERMS];
const xmlText = (s: string) => s.replace(/’/g, '&#8217;');

test('the HTML file: each card carries its own lines and Confidential; turned off, none', async () => {
  const html = await writeOfflineDeck({ title: 'Synthetic', version: 1, slides: SLIDES, images: new Map(), footer: null, watermark: null, notes: false, sources: false, compliance: deckCompliance(SLIDES, null, TODAY) });
  const cards = html.split('<section class="card"').slice(1);
  assert.equal(cards.length, 3);
  assert.doesNotMatch(cards[0], /class="fn"/);
  assert.ok(cards[1].includes(FLS_FOOTNOTE.replace(/’/g, '&#39;').replace(/'/g, '&#39;')) || cards[1].includes('Forward-looking projection'), 'the projection card');
  assert.match(cards[2], /Proposed, subject to counsel/);
  for (const c of cards) assert.match(c, /<span class="conf">Confidential<\/span>/);
  const off = await writeOfflineDeck({ title: 'Synthetic', version: 1, slides: SLIDES, images: new Map(), footer: null, watermark: null, notes: false, sources: false, compliance: deckCompliance(SLIDES, { kind: 'brand', confidential: false }, TODAY) });
  assert.doesNotMatch(off, /class="conf"/);
  assert.match(off, /Forward-looking projection/, 'the footnote is not Confidential’s switch');
});

test('the .odp file and the editable PowerPoint carry the same lines and Confidential', async () => {
  const compliance = deckCompliance(SLIDES, null, TODAY);
  const renderable = SLIDES.map((s) => ({ title: s.title, fields: [] }));
  const odp = unzip((await writeOdp({ title: 'Synthetic', version: 1, slides: SLIDES, renderable, images: new Map(), brand: BRAND, notes: false, compliance })).bytes).get('content.xml')!;
  const pages = odp.split('<draw:page ').slice(1);
  assert.equal(pages.length, 3);
  assert.doesNotMatch(pages[0], /Forward-looking/);
  assert.match(pages[1], /Forward-looking projection/);
  assert.match(pages[2], /Proposed, subject to counsel/);
  for (const p of pages) assert.ok(p.includes(`>${CONFIDENTIAL}<`), 'Confidential on every page');
  const none = unzip((await writeOdp({ title: 'Synthetic', version: 1, slides: SLIDES, renderable, images: new Map(), brand: BRAND, notes: false })).bytes).get('content.xml')!;
  assert.doesNotMatch(none, /Forward-looking|Confidential/, 'no compliance given, nothing added');
  const pptx = unzip((await writeEditableDeck({ slides: SLIDES, renderable, brand: BRAND, notes: false, images: new Map(), compliance })).bytes);
  const s2 = pptx.get('ppt/slides/slide2.xml')!, s3 = pptx.get('ppt/slides/slide3.xml')!, s1 = pptx.get('ppt/slides/slide1.xml')!;
  assert.match(s2, /Forward-looking projection/);
  assert.match(s3, /Proposed, subject to counsel/);
  assert.doesNotMatch(s1, /Forward-looking/);
  for (const s of [s1, s2, s3]) assert.match(s, />Confidential</);
  void xmlText;
});

test('the share and print reads carry the answer: publicDeckOf adds `compliance` from the version’s own theme', () => {
  const row = { id: 9, project_id: 7, version: 3, title: 'Synthetic', slides: JSON.stringify(SLIDES), theme_json: JSON.stringify({ kind: 'brand', background: null, confidential: false }) };
  const deck = publicDeckOf(row);
  assert.equal(deck.compliance.confidential, false);
  assert.equal(deck.compliance.footnotes.length, 3);
  assert.deepEqual(deck.compliance.footnotes[2], [ROUND_TERMS_NOTE]);
  assert.match(String(deck.compliance.footnotes[1][0]), /^Forward-looking projection/);
  assert.equal(publicDeckOf({ ...row, theme_json: null }).compliance.confidential, true, 'on by default');
});
