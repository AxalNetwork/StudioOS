// #3661: the deliberately defective synthetic deck the preflight is run on: in the unit tests
// (frontend/test/pitch_preflight_3661.test.mjs) and in a real browser by the acceptance harness
// (scripts/pitch-preflight-acceptance.mjs), which draws it at export size and measures it.
// Synthetic only: no real company, person or figure.

const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
const bind = (as_of) => ({ source_key: 'stripe.mrr', record_ref: 'metric:1', as_of, grade: 'verified', snapshot_hash: 'a'.repeat(64) });
const LONG = 'Our platform schedules every site inspection automatically, so crews never wait and inspectors never double book. '.repeat(6);

/** Synthetic only: no real company, person or figure. */
export const DEFECTIVE = {
  id: 9001, version: 4, theme: { kind: 'neutral_light' },
  slides: [
    { title: 'Opening', blocks: [
      { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Welcome to [Synthetic Labs]' },
      { id: 'b2', kind: 'text', style: 'paragraph', grid: g(1, 12, 2, 2), text: LONG },
    ] },
    { title: 'Traction', blocks: [
      { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Traction' },
      { id: 'b2', kind: 'metric', grid: g(1, 3, 2, 3), label: 'MRR', value: '$12,000' },
      { id: 'b3', kind: 'metric', grid: g(4, 6, 2, 3), label: 'Customers', value: '40', binding: bind('2026-01-02') },
      { id: 'b4', kind: 'metric', grid: g(6, 8, 2, 3), label: 'Churn', value: '2%', binding: bind('2026-10-20') },
      { id: 'b5', kind: 'chart', grid: g(1, 12, 4, 6), chart_type: 'line', series: [{ label: 'Typed', points: [{ x: 'Jan', y: 1 }] }] },
    ] },
    { title: 'Team', background: { color: '#fde047' }, blocks: [
      { id: 'b1', kind: 'text', style: 'paragraph', grid: g(1, 12, 1, 1), text: 'Two founders, TBD hires.' },
      { id: 'b2', kind: 'image', grid: g(1, 6, 2, 6), image_url: '', alt: '' },
      { id: 'b3', kind: 'image', grid: g(7, 12, 2, 6), image_url: 'https://cdn.example.test/team.png', alt: '' },
      { id: 'b4', kind: 'text', style: 'paragraph', grid: g(13, 14, 1, 1), text: 'Off the grid' },
    ] },
    { title: 'Ask', background: { color: '#111111' }, blocks: [
      { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 2), text: 'The ask' },
    ] },
  ],
};
