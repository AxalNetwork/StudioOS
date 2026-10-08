/**
 * D580 (#1207) — the 83(b) page's Operator assist row and HQ's 83(b) review tab.
 *
 * The owner chose 1A (an Axal admin assigned per startup), 2A (the 83(b)
 * filing record is reviewed) and 3A (no graduation gate). The row shows the
 * operator, the last review and the next follow-up date, each "Not recorded"
 * with its reason until HQ records it, and "Unreadable" when the read fails.
 * The Worker's half is cloudflare-worker/test/section83b_operator_review_d580.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_83b_operator_review_d580.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import OperatorAssistRow, { OPERATOR_REASONS, OPERATOR_ROLE_NOTE } from '../src/components/spinout/OperatorAssistRow.jsx';
import { StartupRow, WRITE_ERRORS, canSubmitReview, errorText } from '../src/pages/admin/AdminSection83bReview.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/SpinoutLab83bPage.jsx');
const HQ = read('frontend/src/pages/admin/AdminSpinoutLab.jsx');
const WORKER = read('cloudflare-worker/src/services/section83bOperatorReview.ts');

const row = (review) => renderToStaticMarkup(h(OperatorAssistRow, { review }));
// The text between a cell's opening tag and the first `</span></div>` after it.
// Plain string search, not a RegExp built from `id` (Semgrep 6238).
const cell = (html, id) => {
  const open = `data-testid="${id}">`;
  const at = html.indexOf(open);
  assert.ok(at >= 0, `${id} is not rendered`);
  const start = at + open.length;
  const end = html.indexOf('</span></div>', start);
  assert.ok(end >= 0, `${id} is not closed`);
  return html.slice(start, end);
};

const OPERATOR = { user_id: 3, name: 'Olu Operator', assigned_at: '2026-10-01 09:00:00' };

test('nothing recorded: each value says Not recorded with its reason', () => {
  const html = row({ status: 'ready', data: { operator: null, last_review: null, next_follow_up: null } });
  assert.ok(cell(html, 'text-83b-operator').includes(`title="${OPERATOR_REASONS.noOperator}">Not recorded`));
  assert.match(cell(html, 'text-83b-last-review'), /Not recorded/);
  assert.match(cell(html, 'text-83b-next-follow-up'), /Not recorded/);
  assert.doesNotMatch(html, /Olu Operator/);
});

test('an operator with no review: the name, and no review or follow-up on record', () => {
  const html = row({ status: 'ready', data: { operator: OPERATOR, last_review: null, next_follow_up: null } });
  assert.equal(cell(html, 'text-83b-operator'), 'Olu Operator');
  assert.ok(cell(html, 'text-83b-last-review').includes(`title="${OPERATOR_REASONS.noReview}">Not recorded`));
  assert.ok(cell(html, 'text-83b-next-follow-up').includes(`title="${OPERATOR_REASONS.noReview}">Not recorded`));
});

test('an operator with a review: its outcome and date, and the next follow-up', () => {
  const html = row({ status: 'ready', data: {
    operator: OPERATOR,
    last_review: { uid: 'r1', outcome: 'incomplete', note: null, follow_up_date: '2099-03-01', reviewed_at: '2026-10-05 14:00:00', operator_name: 'Olu Operator' },
    next_follow_up: '2099-03-01',
  } });
  assert.equal(cell(html, 'text-83b-operator'), 'Olu Operator');
  assert.equal(cell(html, 'text-83b-last-review'), 'Record incomplete · Oct 5, 2026');
  assert.equal(cell(html, 'text-83b-next-follow-up'), 'Mar 1, 2099');

  const noNext = row({ status: 'ready', data: {
    operator: OPERATOR,
    last_review: { uid: 'r2', outcome: 'complete', note: null, follow_up_date: null, reviewed_at: '2026-10-06 10:00:00', operator_name: 'Olu Operator' },
    next_follow_up: null,
  } });
  assert.equal(cell(noNext, 'text-83b-last-review'), 'Record complete · Oct 6, 2026');
  assert.ok(cell(noNext, 'text-83b-next-follow-up').includes(`title="${OPERATOR_REASONS.noFollowUp}">Not recorded`));
});

test('a failed read is Unreadable on every value, and no company record says so', () => {
  const html = row({ status: 'unreadable', data: null });
  for (const id of ['text-83b-operator', 'text-83b-last-review', 'text-83b-next-follow-up']) {
    assert.match(cell(html, id), />Unreadable<\/span>$/, id);
  }
  const none = row({ status: 'no-project', data: null });
  for (const id of ['text-83b-operator', 'text-83b-last-review', 'text-83b-next-follow-up']) {
    assert.match(cell(none, id), /Not recorded/, id);
  }
  assert.match(none, /no company record yet/);
});

test('the role\'s wording is shown, and is the Worker\'s own line', () => {
  assert.equal(OPERATOR_ROLE_NOTE, 'Operator review is a check that the filing record is complete. It is not tax or legal advice.');
  assert.ok(row({ status: 'loading' }).includes(OPERATOR_ROLE_NOTE));
  assert.ok(WORKER.includes(`'${OPERATOR_ROLE_NOTE}'`), 'the Worker serves another wording');
});

test('the page reads the operator review for its project and folds no failure into an empty read', () => {
  const code = codeOnly(PAGE);
  assert.match(code, /<OperatorAssistRow review=\{opReview\} \/>/);
  assert.match(code, /section83bReviewApi\.read\(p\.id\)\.then\(\s*\(data\) => \(\{ status: 'ready', data \}\),\s*\(e\) => \{[\s\S]*?return \{ status: 'unreadable', data: null \};/);
  assert.match(code, /: Promise\.resolve\(\{ status: failed\.projects \? 'unreadable' : 'no-project', data: null \}\)/);
  assert.match(code, /setOpReview\(op\);/);
  assert.doesNotMatch(PAGE, /operator review needs an owner decision/);
});

test('the API module calls the Worker routes D580 adds', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, ''), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { section83bReviewApi } = await import('../src/lib/api/section83bReview.js');
    await section83bReviewApi.read(7);
    await section83bReviewApi.adminList();
    await section83bReviewApi.adminAssign(7, 3);
    await section83bReviewApi.adminAssign(7, null);
    await section83bReviewApi.adminReview(7, { outcome: 'complete' });
    assert.deepEqual(calls, [
      ['GET', '/legal/83b/operator-review?project_id=7', null],
      ['GET', '/admin/83b-review', null],
      ['PUT', '/admin/83b-review/projects/7/operator', { operator_user_id: 3 }],
      ['PUT', '/admin/83b-review/projects/7/operator', { operator_user_id: null }],
      ['POST', '/admin/83b-review/projects/7/reviews', { outcome: 'complete' }],
    ]);
  } finally { globalThis.fetch = original; }
  const index = read('cloudflare-worker/src/index.ts');
  assert.match(index, /app\.route\('\/api\/admin\/83b-review', admin83bReview\);/);
});

test('HQ: the Spin-Out Lab has an 83(b) review tab that renders the review list', () => {
  const code = codeOnly(HQ);
  assert.match(code, /import AdminSection83bReview from '\.\/AdminSection83bReview';/);
  assert.match(code, /onClick=\{\(\) => setSection\('review83b'\)\}/);
  assert.match(code, /section === 'review83b' \? \(\s*<AdminSection83bReview \/>/);
});

test('HQ row: unassigned by default, the admins to choose from, and no review without an operator', () => {
  const ops = [{ id: 1, name: 'Hq Admin', email: 'hq@axal.example' }, { id: 3, name: 'Olu Operator', email: 'olu@axal.example' }];
  const bare = { project_id: 1, project_name: 'Acme', trackers: 1, operator: null, last_review: null, next_follow_up: null };
  const html = renderToStaticMarkup(h('table', null, h('tbody', null, h(StartupRow, { startup: bare, operators: ops, onSaved: () => {} }))));
  assert.match(html, /<option value="" selected="">Unassigned<\/option>/);
  assert.match(html, /<option value="3">Olu Operator<\/option>/);
  assert.match(html, /<button type="submit" disabled=""[^>]*>Record review<\/button>/);
  assert.ok(html.includes(WRITE_ERRORS.no_operator_assigned));

  const assigned = { ...bare, operator: { user_id: 3, name: 'Olu Operator' }, next_follow_up: '2099-03-01',
    last_review: { outcome: 'complete', reviewed_at: '2026-10-06 10:00:00', note: 'All six items present.' } };
  const html2 = renderToStaticMarkup(h('table', null, h('tbody', null, h(StartupRow, { startup: assigned, operators: ops, onSaved: () => {} }))));
  assert.match(html2, /<option value="3" selected="">Olu Operator<\/option>/);
  assert.match(html2, /Record complete · 2026-10-06 · All six items present\./);
  assert.match(html2, />2099-03-01</);
  assert.ok(!html2.includes(WRITE_ERRORS.no_operator_assigned));
  assert.equal(canSubmitReview({ busy: false, outcome: 'complete', operator: assigned.operator }), true);
  assert.equal(canSubmitReview({ busy: false, outcome: 'complete', operator: null }), false, 'no review without an operator');
  assert.equal(canSubmitReview({ busy: false, outcome: '', operator: assigned.operator }), false, 'no review without an outcome');
  assert.equal(canSubmitReview({ busy: true, outcome: 'complete', operator: assigned.operator }), false, 'no second send while one is in flight');
});

test('a refused write prints the sentence for the Worker\'s code', () => {
  assert.equal(errorText({ code: 'no_operator_assigned', message: 'no_operator_assigned' }), WRITE_ERRORS.no_operator_assigned);
  assert.equal(errorText({ data: { error: 'follow_up_date_past' } }), WRITE_ERRORS.follow_up_date_past);
  assert.equal(errorText({ message: 'Network down' }), 'Network down');
  assert.equal(errorText({ message: 'no_operator_assigned' }), 'no_operator_assigned', 'the table is keyed by e.code, never by the sentence');
  // Every code the Worker can refuse with has a sentence.
  for (const code of ['no_operator_assigned', 'operator_not_an_admin', 'outcome_invalid', 'follow_up_date_invalid', 'follow_up_date_past', 'tracker_not_on_project']) {
    assert.ok(WORKER.includes(`'${code}'`), `the Worker no longer refuses with ${code}`);
    assert.ok(WRITE_ERRORS[code], `no sentence for ${code}`);
  }
});
