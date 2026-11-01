/**
 * #3935 (D1478 task 1): the event-cover (EV2) and course-cover (LE8) presses.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/cover_draw_presses_3935.test.mjs
 *
 * - The press prices first, in one figure (the draw and its checks), and offers
 *   Draw only once priced.
 * - A drawn cover fills the form's field and nothing else; a refusal is kept in
 *   the route's words.
 * - The event editor and the course builder each mount it with their own
 *   routes, and each client path is one the Worker serves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CoverDrawPress from '../src/ui/CoverDrawPress.jsx';
import { COVER_INITIAL, coverQuoteLine, makeCoverActions } from '../src/ui/coverDraw.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const QUOTE = { ok: true, model: '@cf/black-forest-labs/flux-1-schnell', model_label: 'FLUX.1 Schnell', hold_microusd: 2100, draw_microusd: 800, checks_microusd: 1300, balance: { ok: true } };

function holder() {
  let st = COVER_INITIAL;
  const seen = [];
  return { set: (fn) => { st = fn(st); seen.push(st); }, get: () => st, seen };
}

test('the quote is one line: the model, the whole figure and its two parts; an unknown part is never $0', () => {
  assert.equal(coverQuoteLine(QUOTE), 'FLUX.1 Schnell · $0.0021 (draw $0.0008, checks $0.0013)');
  assert.equal(coverQuoteLine({ ...QUOTE, checks_microusd: null }), 'FLUX.1 Schnell · $0.0021 (draw $0.0008, checks not recorded)');
  assert.equal(coverQuoteLine({ ...QUOTE, hold_microusd: null }), 'FLUX.1 Schnell · price not available');
  assert.equal(coverQuoteLine(null), null);
});

test('event cover: price, then draw; the drawn URL fills the field and nothing else is called', async () => {
  const calls = [];
  const filled = [];
  const h = holder();
  const a = makeCoverActions({
    quote: async (p) => { calls.push(['quote', p]); return QUOTE; },
    draw: async (p) => { calls.push(['draw', p]); return { url: 'https://axal.vc/api/events/1/cover/cover-x.png', alt: 'A harbour.', model_label: 'FLUX.1 Schnell' }; },
    set: h.set,
    onDrawn: (url, alt) => filled.push([url, alt]),
  });
  await a.price('A harbour at dawn');
  assert.equal(h.seen[0].quoting, true, 'pricing is shown while it runs');
  assert.deepEqual(h.get().quote, QUOTE);
  await a.run('A harbour at dawn');
  assert.deepEqual(calls, [['quote', 'A harbour at dawn'], ['draw', 'A harbour at dawn']]);
  assert.deepEqual(filled, [['https://axal.vc/api/events/1/cover/cover-x.png', 'A harbour.']]);
  assert.equal(h.get().drawn.model_label, 'FLUX.1 Schnell');
  assert.equal(h.get().quote, null, 'a new cover needs a new price');
});

test('course cover: a refusal is kept in the route\'s words, and the field is not touched', async () => {
  const filled = [];
  const h = holder();
  const refusal = Object.assign(new Error('Eadwyn does not draw real people. Upload a photo the person agreed to share.'), { code: 'real_person' });
  const a = makeCoverActions({ quote: async () => QUOTE, draw: async () => { throw refusal; }, set: h.set, onDrawn: (u) => filled.push(u) });
  await a.price('x');
  await a.run('x');
  assert.deepEqual(h.get().error, { code: 'real_person', message: refusal.message });
  assert.equal(h.get().drawing, false);
  assert.deepEqual(filled, []);
  const locked = holder();
  await makeCoverActions({ quote: async () => { throw Object.assign(new Error('This model is on Paid plans. Pick another model, or change your plan.'), { code: 'plan_locked' }); }, draw: async () => null, set: locked.set }).price('x');
  assert.equal(locked.get().error.code, 'plan_locked');
  assert.equal(locked.get().quote, null, 'no Draw without a price');
});

test('the press draws Price it before a quote, never Draw, and says no people', () => {
  const html = renderToStaticMarkup(React.createElement(CoverDrawPress, { quote: async () => QUOTE, draw: async () => null, testid: 'event-cover-draw' }));
  assert.match(html, /data-testid="event-cover-draw-price"/);
  assert.doesNotMatch(html, /data-testid="event-cover-draw-run"/, 'Draw waits for a price');
  assert.match(html, /Eadwyn does not draw real people/);
  assert.match(html, /min-h-\[44px\]/, 'a 44px target');
});

test('the event editor and the course builder mount the press with their own routes, and each path is the Worker\'s', () => {
  const editor = read('frontend/src/pages/events/EventEditorPage.jsx');
  assert.match(editor, /import CoverDrawPress from '..\/..\/ui\/CoverDrawPress'/);
  assert.match(editor, /\{id && <CoverDrawPress testid="event-cover-draw" quote=\{coverQuote\} draw=\{coverDraw\} onDrawn=\{onCoverDrawn\} \/>\}/, 'only a saved event');
  assert.match(editor, /eventsApi\.coverQuote\(id, prompt\)/);
  assert.match(editor, /eventsApi\.coverDraw\(id, prompt\)/);
  assert.match(editor, /setForm\(\(f\) => \(\{ \.\.\.f, cover_url: url \}\)\)/, 'the drawn URL fills cover_url only');
  const builder = read('frontend/src/pages/learning/StudioCourseBuilder.jsx');
  assert.match(builder, /\{course && <CoverDrawPress testid="course-cover-draw"/, 'only a saved course');
  assert.match(builder, /courseCoverQuote\(uid, prompt\)/);
  assert.match(builder, /courseCoverDraw\(uid, prompt\)/);
  const actions = read('frontend/src/pages/learning/studioActions.js');
  assert.match(actions, /export const courseCoverQuote = \(uid, prompt\) => adminLearningApi\.courseCoverQuote\(uid, prompt\);/);
  assert.match(actions, /export const courseCoverDraw = \(uid, prompt\) => adminLearningApi\.courseCoverDraw\(uid, prompt\);/);
  // The client paths, and the Worker routes that answer them.
  const events = read('frontend/src/lib/eventsApi.js');
  assert.match(events, /request\(`\/events\/\$\{id\}\/cover\/quote`/);
  assert.match(events, /request\(`\/events\/\$\{id\}\/cover\/draw`/);
  const learning = read('frontend/src/lib/api/adminLearning.js');
  assert.match(learning, /request\(`\/admin\/learning\/courses\/\$\{enc\(uid\)\}\/cover\/quote`/);
  assert.match(learning, /request\(`\/admin\/learning\/courses\/\$\{enc\(uid\)\}\/cover\/draw`/);
  const workerEvents = read('cloudflare-worker/src/routes/events.ts');
  assert.match(workerEvents, /events\.post\('\/:id\/cover\/quote'/);
  assert.match(workerEvents, /events\.post\('\/:id\/cover\/draw'/);
  const workerCourses = read('cloudflare-worker/src/routes/admin_learning.ts');
  assert.match(workerCourses, /r\.post\('\/courses\/:uid\/cover\/quote'/);
  assert.match(workerCourses, /r\.post\('\/courses\/:uid\/cover\/draw'/);
});
