// #3662: the Pitch acceptance fixtures. Synthetic only: no real venture, person, investor or
// figure, and no production data. Each deck is one version as `GET /api/decks/:id` returns it
// (D898's slide model: blocks on the 12 × 6 grid).
//
//   complete      every block kind, bound and typed figures, a chart, an image with alt text
//   sparse        what a new venture has: a figure nobody recorded, an empty chart, no image
//   multilingual  Japanese, Arabic (right to left), a long German compound, markup characters
//   lossy         a block off the grid and two that overlap: the read drops them, so the harness
//                 must report exactly those as lost
//
// `readerTexts(deck)` is every word a reader of the card should find in an export, in the order
// the cards draw them. Used by cloudflare-worker/test/pitch_acceptance_exports_3662.test.ts and
// frontend/test/pitch_acceptance_render_3662.test.mjs.

const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
const bound = (as_of) => ({ source_key: 'fixture.metric', record_ref: 'metric:1', as_of, grade: 'verified', snapshot_hash: 'f'.repeat(64) });
export const NOT_RECORDED = 'Not recorded';

export const COMPLETE = {
  id: 7001, version: 3, title: 'Fixture complete deck', theme: { kind: 'neutral_light' },
  slides: [
    { title: 'Opening', layout: 'title', notes: 'Open with the problem.', blocks: [
      { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 2, 3), text: 'Fixture Robotics schedules site inspections' },
      { id: 'b2', kind: 'text', style: 'paragraph', grid: g(1, 12, 4, 4), text: 'A synthetic deck for acceptance tests.' },
    ] },
    { title: 'Traction', layout: 'metric_tiles', blocks: [
      { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Traction' },
      { id: 'b2', kind: 'metric', grid: g(1, 3, 2, 4), label: 'Pilots', value: '3', binding: bound('2026-10-01') },
      { id: 'b3', kind: 'metric', grid: g(4, 6, 2, 4), label: 'Monthly revenue', value: '$4,200', binding: bound('2026-10-01') },
      { id: 'b4', kind: 'chart', grid: g(7, 12, 2, 6), chart_type: 'columns', series: [{ label: 'Pilots by quarter', points: [{ x: 'Q1', y: 1 }, { x: 'Q2', y: 3 }] }], range: 'all', previous: false, labels: true },
    ] },
    { title: 'Team', layout: 'image_text', blocks: [
      { id: 'b1', kind: 'image', grid: g(1, 6, 1, 6), image_url: 'https://img.example.test/team.png', alt: 'Two synthetic founders at a whiteboard' },
      { id: 'b2', kind: 'text', style: 'heading', grid: g(7, 12, 1, 1), text: 'Team' },
      { id: 'b3', kind: 'text', style: 'list', grid: g(7, 12, 2, 6), text: 'Founder A, operations\nFounder B, software & data' },
    ] },
    { title: 'Ask', blocks: [
      { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 2), text: 'The ask' },
      { id: 'b2', kind: 'link', grid: g(1, 3, 3, 3), url: 'https://example.test/data-room', label: 'Read the data room' },
    ] },
  ],
};

export const SPARSE = {
  id: 7002, version: 1, title: 'Fixture sparse deck', theme: { kind: 'neutral_dark' },
  slides: [
    { title: 'Traction', blocks: [
      { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Early traction' },
      { id: 'b2', kind: 'metric', grid: g(1, 3, 2, 3), label: 'Paying customers', value: null },
      { id: 'b3', kind: 'chart', grid: g(4, 12, 2, 6), chart_type: 'line', series: [], range: 'all', previous: false, labels: true },
      { id: 'b4', kind: 'image', grid: g(1, 3, 4, 6), image_url: null, alt: '' },
    ] },
    { title: 'Empty card', blocks: [] },
  ],
};

export const MULTILINGUAL = {
  id: 7003, version: 2, title: 'Fixture multilingual deck', theme: { kind: 'neutral_light' },
  slides: [
    { title: '概要', blocks: [
      { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: '現場検査を自動でスケジュールします' },
      { id: 'b2', kind: 'text', style: 'paragraph', grid: g(1, 12, 2, 3), text: 'نحن نجدول عمليات التفتيش تلقائيا' },
      { id: 'b3', kind: 'text', style: 'paragraph', grid: g(1, 12, 4, 4), text: 'Baustellenbegehungsterminplanungssoftware' },
      { id: 'b4', kind: 'text', style: 'paragraph', grid: g(1, 12, 5, 6), text: 'Margins < 40% & "quoted" text' },
    ] },
  ],
};

export const LOSSY = {
  id: 7004, version: 1, title: 'Fixture lossy deck', theme: { kind: 'neutral_light' },
  slides: [
    { title: 'Faults', blocks: [
      { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Kept heading' },
      { id: 'b2', kind: 'text', style: 'paragraph', grid: g(1, 6, 1, 2), text: 'Overlaps the heading' },
      { id: 'b3', kind: 'text', style: 'paragraph', grid: g(11, 14, 3, 3), text: 'Off the grid' },
      { id: 'b4', kind: 'text', style: 'paragraph', grid: g(1, 12, 4, 4), text: 'Kept paragraph' },
    ] },
  ],
};
/** What the read must drop from LOSSY, and so what the harness must report lost. */
export const LOSSY_DROPPED = Object.freeze(['Overlaps the heading', 'Off the grid']);

export const DECKS = Object.freeze({ complete: COMPLETE, sparse: SPARSE, multilingual: MULTILINGUAL, lossy: LOSSY });

/** Every word a reader should find in an export of this deck, card by card. */
export function readerTexts(deck) {
  const out = [];
  for (const [card, s] of (deck?.slides || []).entries()) {
    for (const b of s.blocks || []) {
      const at = (text) => { if (String(text ?? '').trim()) out.push({ card, block: b.id, text: String(text).trim() }); };
      if (b.kind === 'text' && b.style === 'list') String(b.text || '').split('\n').forEach(at);
      else if (b.kind === 'text') at(b.text);
      else if (b.kind === 'metric') { at(b.label); at(b.value ?? NOT_RECORDED); }
      else if (b.kind === 'link' || b.kind === 'audio') at(b.label);
      else if (b.kind === 'chart') (b.series || []).forEach((x) => at(x.label));
    }
  }
  return out;
}

/** The texts of `expected` an export's text does not hold, after the export's own escaping. */
export function missingTexts(expected, exported, escape = (s) => s) {
  return expected.filter((e) => !exported.includes(escape(e.text)));
}
