/**
 * D637 (#1395) — one co-marketing pitch at `/comarketing/:pitch`, rendered
 * from the real component: the prefilled form while Proposed, locked with a
 * note after, and results that read "Not recorded" before any visit, never 0.
 * The Published feed's View link records the visit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CoMarketingPitchView, draftOf, lockNote, resultsOf } from '../src/pages/CoMarketingPitchPage.jsx';
import { recordFeedVisit } from '../src/pages/CoMarketingPage.jsx';
import { codeOnly } from './_codeOnly.mjs';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const words = (markup) => {
  let out = '';
  let inTag = false;
  for (const ch of String(markup)) {
    if (ch === '<') { inTag = true; out += ' '; } else if (ch === '>' && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
};

const ZERO = { visit: 0, signup: 0, lead: 0, conversion: 0, total: 0 };
const PROPOSED = {
  uid: 'p-1', status: 'proposed', title: 'Webinar on fintech', asset_type: 'webinar', angle: 'One sharp line',
  target_audience: 'Seed founders', what_you_bring: '12k newsletter', summary: 'A long enough summary', attribution: ZERO,
};
const view = (pitch) => html(h(CoMarketingPitchView, { read: { kind: 'ready', pitch }, draft: draftOf(pitch), setDraft: () => {} }));

test('a proposed pitch shows the form prefilled and editable', () => {
  const markup = view(PROPOSED);
  assert.match(markup, /<option value="webinar" selected="">Webinar<\/option>/);
  for (const v of ['Webinar on fintech', 'One sharp line', 'Seed founders']) assert.ok(markup.includes(`value="${v}"`), v);
  assert.match(markup, />12k newsletter<\/textarea>/);
  assert.doesNotMatch(markup, /disabled=""/, 'nothing is locked while Proposed');
  assert.match(words(markup), /Save changes/);
  assert.doesNotMatch(markup, /data-testid="pitch-locked"/);
});

test('an approved, rejected or withdrawn pitch is locked, with a note', () => {
  const approved = view({ ...PROPOSED, status: 'approved', reviewed_at: '2026-10-12T09:00:00Z' });
  assert.match(words(approved), /Approved on 12 Oct 2026\. The form is locked; to change the pitch, withdraw it and propose again\./);
  assert.equal((approved.match(/disabled=""/g) || []).length, 6, 'every field is locked');
  assert.doesNotMatch(words(approved), /Save changes/);
  assert.match(lockNote({ status: 'rejected', reviewed_at: '2026-10-02' }), /^Rejected on 2 Oct 2026\. The form is locked; propose a new pitch instead\.$/);
  assert.match(lockNote({ status: 'withdrawn', updated_at: '2026-10-03' }), /^Withdrawn on 3 Oct 2026\./);
  assert.equal(lockNote(PROPOSED), null);
});

test('results read Not recorded before any visit, never 0', () => {
  const text = words(view(PROPOSED));
  assert.match(text, /Results Visits Not recorded Sign-ups Not recorded Leads Not recorded Conversions Not recorded/);
  assert.match(text, /Nothing is recorded for this pitch yet\. Visits are counted from the Published feed once the piece is live\./);
  const markup = view(PROPOSED);
  assert.doesNotMatch(markup.slice(markup.indexOf('data-testid="pitch-results"')), />0</);
});

test('a recorded visit shows its count, and the kinds still at nothing read Not recorded', () => {
  const text = words(view({ ...PROPOSED, status: 'published', attribution: { ...ZERO, visit: 3, total: 3 } }));
  assert.match(text, /Visits 3 Sign-ups Not recorded Leads Not recorded Conversions Not recorded/);
  assert.match(text, /nothing records sign-ups, leads or conversions yet/);
  assert.deepEqual(resultsOf(null).map((r) => r.n), [null, null, null, null]);
});

test('loading, missing and unreadable', () => {
  const base = { draft: draftOf(null), setDraft: () => {} };
  assert.match(words(html(h(CoMarketingPitchView, { ...base, read: { kind: 'loading' } }))), /Co-marketing Loading the pitch…/);
  const unread = words(html(h(CoMarketingPitchView, { ...base, read: { kind: 'unreadable', message: '' } })));
  assert.match(unread, /This pitch could not be read just now\. Try again/);
  assert.doesNotMatch(unread, /Not recorded|Results/);
  assert.match(words(html(h(CoMarketingPitchView, { ...base, read: { kind: 'missing', message: 'This pitch does not exist, or it is not yours.' } }))),
    /This pitch does not exist, or it is not yours\./);
});

test('the View link records a visit, and a failed record never throws', async () => {
  const calls = [];
  await recordFeedVisit({ attribution_code: 'code-pub' }, { trackCoMarketing: (d) => { calls.push(d); return Promise.resolve({ ok: true }); } });
  assert.deepEqual(calls, [{ code: 'code-pub', event_kind: 'visit', landing_path: '/comarketing' }]);
  assert.equal(await recordFeedVisit({ attribution_code: 'x' }, { trackCoMarketing: () => Promise.reject(new Error('down')) }), null);
  assert.equal(recordFeedVisit({}, { trackCoMarketing: () => { throw new Error('never'); } }), null, 'no code, no call');

  const page = codeOnly(readFileSync(new URL('../src/pages/CoMarketingPage.jsx', import.meta.url), 'utf8'));
  assert.match(page, /onClick=\{\(\) => \{ recordFeedVisit\(p\); \}\} data-testid=\{`feed-view-\$\{p\.uid\}`\}/);
  assert.match(page, /to=\{`\/comarketing\/\$\{encodeURIComponent\(p\.uid\)\}`\}/);
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/comarketing\/:pitch" element=\{guard\(\['admin', 'partner'\]/);
  const pitch = codeOnly(readFileSync(new URL('../src/pages/CoMarketingPitchPage.jsx', import.meta.url), 'utf8'));
  assert.match(pitch, /client\.editCoMarketingPitch\(uid, draft\)/);
});
