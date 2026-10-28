// #3661: Pitch preflight, the deterministic checks (frontend/src/pages/raise/pitch/preflightModel.js).
//   - a deliberately defective synthetic deck: each check finds its defect, names the card and
//     the block, says what is wrong and what to do, and blocking errors stay apart from warnings;
//   - clipping needs a measurement: without one it is "Not measured", never a pass; with one,
//     a clipped block blocks the export, long titles and CJK text included;
//   - no score anywhere, nothing rewritten, a result shown only beside its own version;
//   - the deck, fixed, passes and exports with its words kept (cloudflare-worker/test/pitch_preflight_export_3661.test.ts);
//   - the measurement helper reads only what the browser gave.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_preflight_3661.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHECKS, MIN_FONT_PX, blockPx, contrast, currentResult, deckKey, exportGate, placeholderIn, runPreflight, summaryLine, textFit, wordCount,
} from '../src/pages/raise/pitch/preflightModel.js';
import { measureBlocks } from '../src/pages/raise/pitch/preflightMeasure.js';

const NOW = Date.parse('2026-10-28T12:00:00Z');
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
const by = (r, check) => r.findings.filter((f) => f.check === check);
const at = (r, check, card, block) => r.findings.find((f) => f.check === check && f.card === card && f.block === block);

test('every check finds its defect, names the card and block, and says what to do', () => {
  const r = runPreflight(DEFECTIVE, { now: NOW });
  assert.deepEqual(r.checks.map((c) => c.key), CHECKS.map((c) => c.key), 'every check reports a state');
  const ph = at(r, 'placeholder', 0, 'b1');
  assert.match(ph.title, /^Card 1, Opening, block b1: "\[Synthetic Labs\]" looks like a bracketed sample\.$/);
  assert.equal(ph.fix, 'Replace it with the real words, or remove it.');
  assert.ok(at(r, 'placeholder', 2, 'b1'), '“TBD” is a note to self');
  assert.match(at(r, 'density', 0, 'b2').detail, /^An estimate: about \d+ lines at its size, with room for 3\. Not measured on the rendered card\.$/);
  assert.match(at(r, 'sources', 1, 'b2').title, /the figure \$12,000 has no source\.$/);
  assert.match(at(r, 'sources', 1, 'b3').title, /the source is 299 days old\.$/);
  assert.equal(at(r, 'sources', 1, 'b4'), undefined, 'a recent bound figure is fine');
  assert.match(at(r, 'sources', 1, 'b5').title, /a series was typed, not bound\.$/);
  assert.equal(at(r, 'layout', 1, 'b4').severity, 'blocking', 'b4 overlaps b3 (column 6)');
  assert.equal(at(r, 'layout', 2, 'b4').severity, 'blocking', 'off the 12 × 6 grid');
  assert.equal(at(r, 'image', 2, 'b2').severity, 'blocking', 'an image block with no image');
  assert.equal(at(r, 'alt', 2, 'b3').severity, 'warning');
  assert.equal(at(r, 'alt', 2, 'b2'), undefined, 'an empty image is the image finding, not alt text');
  assert.match(at(r, 'contrast', 3, 'b1').title, /the text contrast is 1\.\d+:1\.$/, 'dark ink on #111111');
  assert.match(at(r, 'theme', 2, null).title, /its background #fde047 is used on no other card\.$/);
  for (const f of r.findings) {
    assert.ok(Number.isInteger(f.card) && f.title && f.detail && f.fix, f.id);
    assert.equal(f.dismissible, f.severity === 'warning', f.id);
  }
  assert.equal(new Set(r.findings.map((f) => f.id)).size, r.findings.length, 'each finding has its own id');
});

test('clipping is "Not measured" without a measurement, never a pass; a measured clip blocks the export', () => {
  const r = runPreflight(DEFECTIVE, { now: NOW });
  assert.equal(r.checks.find((c) => c.key === 'overflow').state, 'unmeasured');
  assert.equal(r.checks.find((c) => c.key === 'image').state, 'findings');
  assert.match(summaryLine(r), /Not measured: Clipped content\.$/);
  const fine = { id: 1, version: 1, slides: [{ blocks: [{ id: 'b1', kind: 'text', style: 'paragraph', grid: g(1, 12, 1, 6), text: 'Short.' }] }] };
  assert.equal(runPreflight(fine).checks.find((c) => c.key === 'overflow').state, 'unmeasured', 'even a short text is not a pass unmeasured');
  const measured = runPreflight(fine, { measurements: { '0:b1': { clipped: false, font_px: 30 } } });
  assert.equal(measured.checks.find((c) => c.key === 'overflow').state, 'pass');
  const cut = runPreflight(fine, { measurements: { '0:b1': { clipped: true } } });
  assert.equal(by(cut, 'overflow')[0].severity, 'blocking');
  assert.match(by(cut, 'overflow')[0].title, /the text is cut off at export size\.$/);
  assert.equal(exportGate(cut).blocked, true);
  const tiny = runPreflight(fine, { measurements: { '0:b1': { clipped: false, font_px: 18 } } });
  assert.match(by(tiny, 'font')[0].title, /the text is 18px at export size\.$/);
  assert.equal(MIN_FONT_PX, 24);
});

test('long titles and CJK text are estimated by their real width; the estimate is a warning, never a block', () => {
  const heading = { kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'A very long title that keeps going well past one line on the card' };
  assert.equal(textFit(heading).fits, false);
  const cjk = { kind: 'text', style: 'paragraph', grid: g(1, 3, 1, 1), text: '我们的平台自动安排每一次现场检查，让工作人员不再等待。'.repeat(2) };
  assert.equal(textFit(cjk).fits, false, 'a CJK character is one em, not half');
  assert.equal(textFit({ ...cjk, text: '检查' }).fits, true);
  assert.equal(wordCount('自动安排 every inspection'), 6);
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const wordy = runPreflight({ id: 1, version: 1, slides: [{ title: 'Wordy', blocks: [
    { id: 'b1', kind: 'text', style: 'paragraph', grid: g(1, 6, 1, 6), text: words(60) },
    { id: 'b2', kind: 'text', style: 'paragraph', grid: g(7, 12, 1, 6), text: words(55) },
  ] }] });
  assert.equal(at(wordy, 'density', 0, null).title, 'Card 1, Wordy: 115 words on one card.', 'the words of every block on the card count together');
  assert.equal(at(runPreflight({ id: 1, version: 1, slides: [{ blocks: [{ id: 'b1', kind: 'text', style: 'paragraph', grid: g(1, 12, 1, 6), text: words(110) }] }] }), 'density', 0, null), undefined);
  const r = runPreflight({ id: 1, version: 1, slides: [{ blocks: [heading] }] });
  assert.deepEqual(r.findings.map((f) => [f.check, f.severity]), [['density', 'warning']]);
  const { w, h } = blockPx(g(1, 12, 1, 6));
  assert.deepEqual([Math.round(w), Math.round(h)], [1805, 965], 'the print page’s content box');
});

test('blocking errors gate the export; warnings may be dismissed; no score is given', () => {
  const r = runPreflight(DEFECTIVE, { now: NOW });
  const gate = exportGate(r);
  assert.equal(gate.blocked, true);
  assert.deepEqual(gate.blocking.map((f) => [f.check, f.card, f.block]), [['layout', 1, 'b4'], ['layout', 2, 'b4'], ['image', 2, 'b2']]);
  const dismissed = new Set(gate.warnings.map((f) => f.id));
  assert.equal(exportGate(r, dismissed).warnings.length, 0);
  assert.equal(exportGate(r, dismissed).blocked, true, 'dismissing warnings never clears a block');
  assert.match(summaryLine(r), /^3 blocking · \d+ warnings\./);
  assert.ok(!/score|ready|grade|\d+%/i.test(JSON.stringify(r).replace(/"grade":"verified"/g, '')), 'no score, no readiness verdict');
  const src = readFileSync(new URL('../src/pages/raise/pitch/preflightModel.js', import.meta.url), 'utf8');
  assert.ok(!/fetch\(|\.slides\s*=|\.blocks\s*=|splice\(/.test(src), 'it reads; it never writes or fetches');
});

test('a result is shown only beside the version it was run on', () => {
  const r = runPreflight(DEFECTIVE, { now: NOW });
  assert.equal(currentResult(r, DEFECTIVE), r);
  const edited = { ...DEFECTIVE, slides: DEFECTIVE.slides.map((s, i) => (i === 0 ? { ...s, title: 'Opening, edited' } : s)) };
  assert.equal(currentResult(r, edited), null, 'an edit makes the old result stale');
  assert.equal(currentResult(r, { ...DEFECTIVE, version: 5 }), null);
  assert.notEqual(deckKey(DEFECTIVE), deckKey(edited));
  assert.equal(summaryLine(null), 'Preflight has not run on this version.');
  assert.deepEqual(runPreflight(DEFECTIVE, { now: NOW }), r, 'the same version gives the same result');
});

test('stale and gone figures from D896’s refresh, and a background image’s overlay, are found', () => {
  const r = runPreflight({ id: 1, version: 1, slides: [{ title: 'A', blocks: [{ id: 'b1', kind: 'text', style: 'paragraph', grid: g(1, 12, 1, 1), text: 'Hi' }], background: { image_url: 'https://cdn.example.test/bg.png', overlay: 'none' } }, { title: 'B', blocks: [] }] }, { refresh: { rows: [{ slide: 1, state: 'gone' }, { slide: 0, state: 'fresh' }] } });
  assert.match(at(r, 'sources', 1, null).title, /a bound figure is no longer in its store\.$/);
  assert.equal(at(r, 'sources', 0, null), undefined);
  assert.match(at(r, 'contrast', 0, null).title, /text on the background image could read at 1\.04:1\.$/);
  const strong = runPreflight({ id: 1, version: 1, slides: [{ blocks: [{ id: 'b1', kind: 'text', style: 'paragraph', grid: g(1, 12, 1, 1), text: 'Hi' }], background: { image_url: 'https://cdn.example.test/bg.png', overlay: 'strong' } }] });
  assert.equal(by(strong, 'contrast').length, 0);
  assert.equal(contrast('#ffffff', '#000000'), 21);
  assert.equal(contrast('nope', '#000000'), null);
  assert.equal(placeholderIn('Revenue is $1.2M'), null, 'a real figure is not a placeholder');
  assert.equal(placeholderIn('Hello {{company}}').word, 'a template field');
});

test('an image’s pixels against its range: measured, soft when blown up, and "Not measured" otherwise', () => {
  const deck = { id: 1, version: 1, slides: [{ blocks: [{ id: 'b1', kind: 'image', grid: g(1, 12, 1, 6), image_url: 'https://cdn.example.test/a.png', alt: 'A synthetic chart' }] }] };
  assert.equal(runPreflight(deck).checks.find((c) => c.key === 'image').state, 'unmeasured');
  const soft = runPreflight(deck, { measurements: { '0:b1': { natural_w: 400, natural_h: 300 } } });
  assert.match(by(soft, 'image')[0].title, /the image is 400 × 300 pixels for a 1805 × 965 range\.$/);
  const sharp = runPreflight(deck, { measurements: { '0:b1': { natural_w: 2400, natural_h: 1350 } } });
  assert.equal(sharp.checks.find((c) => c.key === 'image').state, 'pass');
});

test('the measurement helper reports only what the browser gave', () => {
  const el = (over = {}) => ({ scrollHeight: 120, clientHeight: 100, scrollWidth: 300, clientWidth: 300, querySelector: (sel) => (sel === 'img' ? over.img ?? null : { tag: 'span' }), ...over });
  const style = () => ({ fontSize: '30px' });
  assert.deepEqual(measureBlocks([{ card: 0, block: 'b1', el: el() }], style), { '0:b1': { clipped: true, font_px: 30 } });
  assert.deepEqual(measureBlocks([{ card: 0, block: 'b1', el: el({ scrollHeight: 100 }) }], style)['0:b1'].clipped, false);
  assert.deepEqual(measureBlocks([{ card: 0, block: 'b1', el: el({ clientHeight: 0 }) }], () => ({})), {}, 'an unsized box tells nothing');
  assert.deepEqual(measureBlocks([{ card: 1, block: 'b2', el: el({ img: { complete: true, naturalWidth: 800, naturalHeight: 600 } }) }], style)['1:b2'], { clipped: true, font_px: 30, natural_w: 800, natural_h: 600 });
  assert.equal(measureBlocks([{ card: 1, block: 'b2', el: el({ img: { complete: false, naturalWidth: 0, naturalHeight: 0 } }) }], style)['1:b2'].natural_w, undefined);
  assert.equal(measureBlocks([{ card: 1, block: 'b2', el: el({ img: { complete: false, naturalWidth: 800, naturalHeight: 600 } }) }], style)['1:b2'].natural_w, undefined, 'an image still loading has no size yet');
  assert.deepEqual(measureBlocks([{ card: 'x', block: 'b1', el: el() }, { card: 0, block: 'b1' }, null]), {});
});
