// D716 (#1866) — the Subscription Booklet on screen. The client's five calls go
// through the real `request()` with `fetch` stubbed; the tick queue and Submit's
// rules are `bookletFormModel.js`'s; the components render on node with no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fundBookletsApi } from '../src/lib/api/fundBooklets.js';
import {
  BOOKLET_RAIL_LABELS, PART_STUB, answersOf, canSubmit, formParts, groupsOf, missingLine, phoneSteps,
  queueTick, railRow, submitDigest, submittedLine, tickCounts, withQueued,
} from '../src/lib/bookletFormModel.js';
import { BookletDesktop, BookletPhone, BookletRail, CheckRow, SubmitBlock } from '../src/pages/SpinoutLabLpBooklet.jsx';
import { SUBSCRIPTION_BOOKLET_PARTS } from '../src/lib/legalDocFormat.js';
import { renderedText } from './_renderedText.mjs';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document ??= { cookie: '' };

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = (el) => renderToStaticMarkup(el);
// The shared character scan, not a tag regex (CodeQL: incomplete multi-character sanitization).
const text = (h) => renderedText(h);

const F = (id, part, t, group, checked = false) => ({ id, part, text: t, group, checked });
const VIEW = {
  uid: 'bk-1', status: 'open', submitted_at: null, digest: 'a1b2c3d4e5f6'.padEnd(64, '0'), missing_parts: [],
  parts: [
    { part: 1, title: 'Cover', slug: 'securities_legend', missing: false, fields: [] },
    { part: 2, title: 'Instructions and Checklist', slug: null, missing: false, fields: [] },
    { part: 3, title: 'Subscription Agreement', slug: 'subscription', missing: false, fields: [
      F('subscription:1:aaaaaaaaaaaa', 3, 'I have read the memorandum.', 'Article 1 Subscription'),
    ] },
    { part: 4, title: 'Investor Questionnaire', slug: 'lp_investor_questionnaire', missing: false, fields: [
      F('lp_investor_questionnaire:1:bbbbbbbbbbbb', 4, 'I am an accredited investor.', 'Accredited investor'),
      F('lp_investor_questionnaire:2:cccccccccccc', 4, 'My net worth is over the bar.', 'Accredited investor'),
      F('lp_investor_questionnaire:3:dddddddddddd', 4, 'No plan assets.', 'ERISA'),
      F('lp_investor_questionnaire:4:eeeeeeeeeeee', 4, 'No bad actor event.', null),
    ] },
    ...[5, 6, 7, 8, 9].map((n) => ({ part: n, title: SUBSCRIPTION_BOOKLET_PARTS[n - 1].title, slug: SUBSCRIPTION_BOOKLET_PARTS[n - 1].slug, missing: false, fields: [] })),
  ],
};
const Q1 = 'lp_investor_questionnaire:1:bbbbbbbbbbbb';
const submit = { enabled: true, submitting: false, onSubmit: () => {}, notice: '' };

async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('D716 #1866 the client: five calls, each method, path and body', async () => {
  const seen = [];
  const fake = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*\/api/, '/api'), init.body ?? null]);
    return new Response(JSON.stringify(VIEW), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await withFetch(fake, async () => {
    await fundBookletsApi.open();
    await fundBookletsApi.mine();
    await fundBookletsApi.paper({ part: 4 });
    const answered = await fundBookletsApi.answer([{ field_id: Q1, checked: true }]);
    assert.deepEqual(answered, VIEW, 'the view the Worker answers is what the page takes');
    await fundBookletsApi.submit('d'.repeat(64));
  });
  assert.deepEqual(seen, [
    ['POST', '/api/fund-booklets/mine', null],
    ['GET', '/api/fund-booklets/mine', null],
    ['GET', '/api/fund-booklets/mine/paper?part=4', null],
    ['PUT', '/api/fund-booklets/mine/answers', JSON.stringify({ answers: [{ field_id: Q1, checked: true }] })],
    ['POST', '/api/fund-booklets/mine/submit', JSON.stringify({ digest: 'd'.repeat(64) })],
  ]);
});

test('D716 #1866 the tick queue: the last tap per id, drawn at once, and only ids the view carries', () => {
  const q1 = queueTick([], VIEW, Q1, true);
  assert.deepEqual(answersOf(q1), [{ field_id: Q1, checked: true }]);
  const q2 = queueTick(queueTick(q1, VIEW, Q1, false), VIEW, Q1, true);
  assert.deepEqual(answersOf(queueTick(q1, VIEW, Q1, false)), [{ field_id: Q1, checked: false }], 'two taps keep the last');
  assert.deepEqual(answersOf(q2), [{ field_id: Q1, checked: true }]);
  const shown = withQueued(VIEW, q1);
  assert.equal(shown.parts[3].fields[0].checked, true, 'drawn ticked before the Worker answers');
  assert.equal(VIEW.parts[3].fields[0].checked, false, 'the view itself is not mutated');
  const row = html(createElement(CheckRow, { field: shown.parts[3].fields[0], size: 'desktop' }));
  assert.match(row, /checked=""/);
  assert.equal(queueTick(q1, VIEW, 'lp_investor_questionnaire:9:000000000000', true), q1, 'an unknown id leaves the queue as it was');
  assert.equal(queueTick([], VIEW, 'made-up', true).length, 0);
});

test('D716 #1866 no field id is built on the page', () => {
  for (const f of ['../src/pages/SpinoutLabLpBooklet.jsx', '../src/lib/bookletFormModel.js']) {
    const s = src(f);
    assert.ok(!s.includes('crypto.subtle') && !/sha256/i.test(s), `${f} hashes nothing`);
    assert.ok(!s.includes('[ ]'), `${f} parses no task item`);
    assert.ok(!/\$\{[^}]*(slug|part)[^}]*\}:/.test(s), `${f} joins no slug or part with a colon`);
  }
});

test('D716 #1866 the rows are at least 44 px, and 48 on a phone; each wraps a native box', () => {
  for (const [size, min] of [['desktop', 44], ['phone', 48]]) {
    for (const checked of [false, true]) {
      const h = html(createElement(CheckRow, { field: F(Q1, 4, 'Text', null, checked), size }));
      const label = h.match(/^<label class="([^"]*)"/);
      assert.ok(label, `${size}: a label`);
      const px = Number(label[1].match(/min-h-\[(\d+)px\]/)[1]);
      assert.ok(px >= min, `${size} row is ${px}px`);
      assert.match(h, /^<label[^>]*><input type="checkbox"/);
      assert.equal(label[1].split(/\s+/).includes('border-indigo-200'), checked, `${size} ticked=${checked}`);
    }
  }
});

test('D716 #1866 Submit is off while the Worker reports a refusal, a tick is pending, or it was just refused', () => {
  assert.equal(canSubmit({ view: VIEW, queued: [], inFlight: null, refused: false }), true);
  assert.equal(canSubmit({ view: { ...VIEW, missing_parts: [1, 4] } }), false);
  assert.equal(canSubmit({ view: { ...VIEW, status: 'submitted' } }), false);
  assert.equal(canSubmit({ view: VIEW, queued: [{ field_id: Q1, checked: true }] }), false);
  assert.equal(canSubmit({ view: VIEW, inFlight: [{ field_id: Q1, checked: true }] }), false);
  assert.equal(canSubmit({ view: VIEW, refused: true }), false);
  assert.equal(canSubmit({ view: null }), false);
  assert.equal(submitDigest(VIEW, {}), VIEW.digest);
  assert.equal(submitDigest(VIEW, { queued: queueTick([], VIEW, Q1, true) }), null, 'never a digest from before the last tick');
  assert.equal(submitDigest({ ...VIEW, missing_parts: [4] }, {}), null);
  const missing = { ...VIEW, missing_parts: [4, 1] };
  const h = html(createElement(SubmitBlock, { view: missing, enabled: canSubmit({ view: missing }) }));
  assert.match(h, /<button[^>]*disabled=""/);
  assert.ok(h.includes('The booklet cannot be submitted yet: Part 1 and Part 4 have no text from counsel.'));
  assert.ok(h.includes('Submitting freezes your answers. They can no longer change.'));
  assert.equal(missingLine([4]), 'The booklet cannot be submitted yet: Part 4 has no text from counsel.');
  assert.equal(missingLine([1, 4, 5]), 'The booklet cannot be submitted yet: Part 1, Part 4 and Part 5 have no text from counsel.');
  assert.equal(missingLine([]), null);
});

test('D716 #1866 the desktop form: the rail, the part, its groups', () => {
  const done = new Set([2]);
  const h = html(createElement(BookletDesktop, { view: { ...VIEW, missing_parts: [6], parts: VIEW.parts.map((p) => (p.part === 6 ? { ...p, missing: true } : p)) }, current: 4, done, onPick: () => {}, onToggle: () => {}, paperProps: {}, submit }));
  const t = text(h);
  assert.ok(t.includes('Subscription Booklet'));
  assert.ok(t.includes('Done · Part 2 · Instructions'));
  assert.match(h, /aria-current="step"[^>]*>Part 4 · Investor Questionnaire</);
  assert.ok(t.includes('Part 6 · Tax status · Stub'));
  assert.ok(!t.includes('Part 1 ·'), 'the cover is not in the rail');
  assert.ok(t.includes('Part 4 of 9') && t.includes('Investor Questionnaire'));
  assert.ok(t.includes('Tick what applies. Your answers fill the paper page exactly as it will be signed.'));
  const eyebrows = [...h.matchAll(/<div class="mb-1\.5 text-\[11px\][^"]*">([^<]*)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(eyebrows, ['Accredited investor', 'ERISA'], 'a null group draws none');
  assert.ok(t.includes('Next: Part 5 · AML/KYC'));
  assert.deepEqual(groupsOf(VIEW.parts[3].fields).map((g) => [g.heading, g.fields.length]), [['Accredited investor', 2], ['ERISA', 1], [null, 1]]);
  const r = railRow(formParts(VIEW)[2], { current: true, done: true });
  assert.deepEqual([r.text, r.tone], ['Part 4 · Investor Questionnaire', 'current']);
  const rail = html(createElement(BookletRail, { parts: formParts(VIEW), current: 9, done: new Set(), submitted: false, onPick: () => {} }));
  assert.ok(!text(rail).includes('Next:'));
  const last = html(createElement(BookletDesktop, { view: VIEW, current: 9, done, onPick: () => {}, onToggle: () => {}, paperProps: {}, submit }));
  assert.ok(!text(last).includes('Next:'), 'Part 9 has no Next');
  assert.ok(text(last).includes('This part has no boxes to tick.'));
});

test('D716 #1866 a stub part prints the Worker\'s stub sentence', () => {
  const legalPaper = readFileSync(new URL('../../cloudflare-worker/src/services/legalPaper.ts', import.meta.url), 'utf8');
  assert.equal(legalPaper.match(/PART_STUB = '([^']*)'/)[1], PART_STUB);
  const stub = { ...VIEW, missing_parts: [4], parts: VIEW.parts.map((p) => (p.part === 4 ? { ...p, missing: true, fields: [] } : p)) };
  const t = text(html(createElement(BookletDesktop, { view: stub, current: 4, done: new Set(), onPick: () => {}, onToggle: () => {}, paperProps: {}, submit })));
  assert.ok(t.includes(`${PART_STUB}This part has no boxes until counsel writes it.`));
});

test('D716 #1866 the phone: Read, Check and Review', () => {
  const steps = phoneSteps(VIEW);
  assert.deepEqual(steps.map((s) => `${s.kind} ${s.part ?? ''}`.trim()), [
    'read 2', 'read 3', 'check 3', 'read 4', 'check 4', 'read 5', 'read 6', 'read 7', 'read 8', 'read 9', 'review',
  ]);
  const at = (kind, part) => steps.findIndex((s) => s.kind === kind && s.part === part);
  const phone = (step) => html(createElement(BookletPhone, { view: VIEW, step, onStep: () => {}, onClose: () => {}, onToggle: () => {}, paperProps: {}, submit }));
  const read = phone(at('read', 4));
  assert.match(read, /role="dialog" aria-modal="true" aria-label="Subscription Booklet"/);
  assert.match(read, /aria-label="Back"/);
  assert.ok(text(read).includes('Sign the Subscription Booklet') && text(read).includes('Part 4 of 9') && text(read).includes('Continue to the boxes'));
  assert.ok(text(phone(at('read', 5))).endsWith('Continue'), 'a part with no fields reads Continue');
  assert.ok(!text(phone(at('read', 5))).includes('Continue to the boxes'));
  const check = phone(at('check', 4));
  const t = text(check);
  assert.ok(t.includes('‹ Investor Questionnaire') && t.includes('Part 4 of 9'));
  assert.ok(t.includes('Tick what applies. The paper page shows exactly these boxes.') && t.endsWith('Continue'));
  assert.ok(!t.includes('2 of 4'), 'the canvas\'s step count is not this page\'s');
  assert.ok([...check.matchAll(/min-h-\[(\d+)px\]/g)].some((m) => Number(m[1]) >= 48));
  const review = text(phone(steps.length - 1));
  assert.ok(review.includes('‹ Review') && review.includes('Part 4 · Investor Questionnaire0 of 4 ticked') && review.includes('Part 2 · InstructionsNo boxes'));
  assert.ok(review.endsWith('Submit the booklet'));
  assert.deepEqual(tickCounts(withQueued(VIEW, queueTick([], VIEW, Q1, true))).byPart[4], { ticked: 1, total: 4 });
});

test('D716 #1866 the submitted state: the pill, the line, every box disabled, every row Done', () => {
  const sub = { ...VIEW, status: 'submitted', submitted_at: '2026-10-18T14:05:09.000Z' };
  assert.equal(submittedLine(sub), 'Submitted 2026-10-18 14:05 UTC · digest a1b2c3d4e5f6');
  assert.equal(submittedLine({ ...sub, submitted_at: '2026-10-18 14:05:09' }), 'Submitted 2026-10-18 14:05 UTC · digest a1b2c3d4e5f6');
  const h = html(createElement(BookletDesktop, { view: sub, current: 4, done: new Set(), onPick: () => {}, onToggle: () => {}, paperProps: {}, submit }));
  const t = text(h);
  assert.ok(t.includes('Submitted') && t.includes('Submitted 2026-10-18 14:05 UTC · digest a1b2c3d4e5f6') && t.includes('Your answers can no longer change.'));
  const boxes = [...h.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]);
  assert.equal(boxes.length, 4);
  assert.ok(boxes.every((b) => b.includes('disabled=""')));
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) assert.ok(t.includes(`Done · Part ${n} ·`), `Part ${n} reads Done`);
  assert.ok(!t.includes('Submit the booklet'));
});

test('D716 #1866 the rail labels are Parts 2 to 9 of the booklet', () => {
  assert.deepEqual(Object.keys(BOOKLET_RAIL_LABELS).map(Number), SUBSCRIPTION_BOOKLET_PARTS.filter((p) => p.part >= 2).map((p) => p.part));
});

test('D716 #1866 the mount: only for an approved application, and the old sentence is gone', () => {
  const page = src('../src/pages/SpinoutLabLpWorkspacePage.jsx');
  assert.match(page, /derived\.applicationStatus === 'approved' && <SubscriptionBooklet \/>/);
  assert.equal((page.match(/<SubscriptionBooklet/g) || []).length, 1);
  assert.ok(!page.includes('The fund team is preparing your subscription documents.'));
  assert.ok(page.includes('Your Subscription Booklet is below: read each part, tick what applies, then submit it. Reporting and participation activate once the general partner records your commitment on the fund’s register.'));
});

test('D716 #1866 nothing is stored in the browser', () => {
  for (const f of ['../src/pages/SpinoutLabLpBooklet.jsx', '../src/lib/bookletFormModel.js', '../src/lib/api/fundBooklets.js']) {
    const s = src(f);
    for (const w of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) assert.ok(!s.includes(w), `${f}: ${w}`);
  }
});
