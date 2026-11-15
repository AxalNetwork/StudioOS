/**
 * D6205 (#6205): Ask HQ on Positions. An investor requests a mark, a
 * correction or a missing follow-on round from the mark-history Sheet or from
 * "Request…" beside a Stale chip, and reads the request's state afterwards.
 *
 * The panel is prop-driven, so each state renders on its own:
 *   loading · unreadable (no form, Retry) · none · drafting · requested · resolved · declined
 * plus the model the page and the panel share, and the page's wiring.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mark_requests_d6205.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import MarkRequestPanel, { RequestChip } from '../src/pages/investor/MarkRequestPanel.jsx';
import {
  REQUEST_KINDS, defaultKind, draftProblem, refusalWords, requestStatusOf, requestsByCompany,
} from '../src/pages/portfolio/markRequestModel.js';
import { markRequestsApi } from '../src/lib/api/markRequests.js';

const ROW = { key: 'p7', uid: 'p7', name: 'Venture Seven', mark: { kind: 'marked' }, stale: true };
const OPEN = { uid: 'r1', project_uid: 'p7', kind: 'mark', reason: 'Latest mark is from June.', state: 'open', created_at: '2026-11-14T10:00:00Z', resolved_at: null };
const RESOLVED = { ...OPEN, state: 'resolved', resolved_at: '2026-11-15T09:00:00Z', resolved_mark_uid: 'm9', resolution_note: 'Re-marked at the Series A.' };
const DECLINED = { ...OPEN, uid: 'r2', state: 'declined', resolved_at: '2026-11-16T09:00:00Z', resolution_note: 'The June mark is current.' };

const panel = (props) => {
  const html = renderToStaticMarkup(h(MarkRequestPanel, { row: ROW, read: { state: 'ok' }, request: null, onSend: async () => {}, onRetry: () => {}, ...props }));
  return { html, text: renderedText(html) };
};
const state = (html) => /data-testid="mark-request-panel" data-state="([^"]+)"/.exec(html)?.[1];

test('loading and unreadable are their own states; unreadable offers Retry and no form', () => {
  const loading = panel({ read: { state: 'loading' } });
  assert.equal(state(loading.html), 'loading');
  assert.match(loading.text, /Reading your requests/);
  const bad = panel({ read: { state: 'unreadable' } });
  assert.equal(state(bad.html), 'unreadable');
  assert.match(bad.text, /could not be read/);
  assert.match(bad.html, /button-retry-mark-requests/);
  assert.doesNotMatch(bad.html, /mark-request-form|button-open-mark-request/, 'no request is offered while whether one is open is not known');
  assert.doesNotMatch(bad.text, /No request sent/);
});

test('no request: the panel names the company and offers Request…; opened, the form names it, takes a kind and a reason', () => {
  const none = panel({});
  assert.equal(state(none.html), 'none');
  assert.match(none.text, /No request sent for Venture Seven/);
  assert.match(none.html, /button-open-mark-request/);
  const draft = panel({ startOpen: true });
  assert.equal(state(draft.html), 'drafting');
  assert.match(draft.text, /Ask HQ about Venture Seven/);
  for (const k of REQUEST_KINDS) assert.match(draft.text, new RegExp(k.label));
  assert.match(draft.html, /input-mark-request-reason/);
  // An empty reason cannot be sent.
  assert.match(draft.html, /<button type="submit"[^>]*disabled=""[^>]*data-testid="button-send-mark-request"/);
});

test('an open request reads Requested with its date, kind and reason, and offers no second one', () => {
  const p = panel({ request: OPEN, startOpen: true });
  assert.equal(state(p.html), 'requested');
  assert.match(p.text, /Requested · 14 Nov 2026/);
  assert.match(p.text, /Record a current mark · Latest mark is from June\./);
  assert.doesNotMatch(p.html, /mark-request-form|button-open-mark-request/);
});

test('an answered request reads Resolved or Declined with its date and HQ’s note, and a new request may follow', () => {
  const r = panel({ request: RESOLVED });
  assert.equal(state(r.html), 'resolved');
  assert.match(r.text, /Resolved · 15 Nov 2026/);
  assert.match(r.text, /HQ: Re-marked at the Series A\./);
  assert.match(r.text, /the mark recorded is in the history above/);
  assert.match(r.text, /Send another request/);
  const d = panel({ request: DECLINED });
  assert.equal(state(d.html), 'declined');
  assert.match(d.text, /Declined · 16 Nov 2026/);
  assert.match(d.text, /HQ: The June mark is current\./);
});

test('the register chip: Requested with its date when one is open, else Request… for that company', () => {
  const open = renderToStaticMarkup(h(RequestChip, { request: OPEN, name: 'Venture Seven', onRequest: () => {} }));
  assert.match(renderedText(open), /Requested · 14 Nov 2026/);
  assert.doesNotMatch(open, /<button/);
  const none = renderToStaticMarkup(h(RequestChip, { request: null, name: 'Venture Seven', onRequest: () => {} }));
  assert.match(none, /aria-label="Request a mark for Venture Seven"/);
  const answered = renderToStaticMarkup(h(RequestChip, { request: RESOLVED, name: 'Venture Seven', onRequest: () => {} }));
  assert.match(answered, /button-request-mark/, 'an answered request leaves room for a new one');
});

test('model: the open request wins over an older answered one; status, default kind, draft checks and refusals', () => {
  const by = requestsByCompany([{ ...DECLINED, project_uid: 'p7' }, OPEN, { ...RESOLVED, project_uid: 'p8' }]);
  assert.equal(by.get('p7').state, 'open');
  assert.equal(by.get('p8').state, 'resolved');
  assert.equal(requestStatusOf(null), null);
  assert.equal(requestStatusOf({ state: 'odd' }), null);
  assert.equal(defaultKind(ROW), 'mark', 'a stale mark asks for a current one');
  assert.equal(defaultKind({ mark: { kind: 'marked' }, stale: false }), 'correction');
  assert.equal(defaultKind({ mark: { kind: 'none' } }), 'mark');
  assert.equal(draftProblem({ kind: 'mark', reason: '  ' }), 'Say what is wrong or missing.');
  assert.equal(draftProblem({ kind: 'nope', reason: 'x' }), 'Choose what you are asking HQ for.');
  assert.equal(draftProblem({ kind: 'follow_on', reason: 'Series A is missing' }), null);
  assert.match(refusalWords({ code: 'request_open' }), /already have an open request/);
  assert.match(refusalWords({ code: 'not_held' }), /company you hold/);
  // A Worker detail never reaches the page.
  assert.doesNotMatch(refusalWords({ code: 'weird', message: 'SQLITE_ERROR: no such table' }), /SQLITE/);
});

test('the page wires the request: its own read, the chip beside Stale, the panel in the Sheet; Add follow-on is gone', () => {
  const src = readFileSync(new URL('../src/pages/investor/InvestorPortfolioPositions.jsx', import.meta.url), 'utf8');
  assert.match(src, /markRequestsApi\.list\(\)/);
  assert.match(src, /markRequestsApi\.create\(\{ projectUid: row\.uid, kind: draft\.kind, reason: draft\.reason \}\)/);
  assert.match(src, /requests\.state === 'ok' && \(r\.stale \|\| r\.mark\.kind !== 'marked'\)/, 'the chip shows only once the requests are read');
  assert.match(src, /<MarkRequestPanel /);
  assert.match(src, /onOpen\(r, \{ request: true \}\)/, 'Request… opens the Sheet on the form');
  const actions = readFileSync(new URL('../src/workspaces/investorZoneActions.js', import.meta.url), 'utf8');
  assert.doesNotMatch(actions, /label: 'Add follow-on'/);
  assert.equal(typeof markRequestsApi.create, 'function');
  assert.equal(typeof markRequestsApi.list, 'function');
});
