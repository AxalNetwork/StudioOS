/**
 * D7515 (#7515) — Help guides say when they were first verified, flag stale
 * guides, and can carry a "Before you start" section.
 *
 * What is pinned, and why:
 *   - a guide reads "First verified <date>" only when the #4641 ledger records
 *     one; a last verified date alone says the first is not recorded; nothing
 *     recorded is "Verification pending", the word D4641 and D6861 use;
 *   - a malformed date is not a verification;
 *   - stale is measured against REVIEW_WINDOW_DAYS, which is null because no
 *     window is agreed, so today no guide is called stale or current;
 *   - search results add the verification only where one is recorded;
 *   - "Before you start" is an optional list of strings, drawn between
 *     Overview and Steps and listed in On this page, and absent when a guide
 *     has none; the five workflow prerequisites moved into it unchanged.
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/help_verified_7515.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { SECTIONS, filterSectionsForRole } from '../src/pages/docs/sections/index.js';
import {
  PRIORITY_HELP_REVIEW, REVIEW_WINDOW_DAYS, guideVerification, guideVerificationFor, recordedDate, staleWord, verifiedDay,
} from '../src/pages/docs/guideGovernance.js';
import { guideOutline } from '../src/pages/docs/v2/helpV2.js';
import { buildDocsRecords } from '../src/lib/docs/search.js';
import { readingMinutes } from '../src/pages/docs/helpCenter.js';
import { HelpArticle, OwnerReview, ResultVerification } from '../src/pages/docs/DocsLayout.jsx';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const founder = filterSectionsForRole(SECTIONS, 'founder');
const NOW = Date.parse('2026-11-18T12:00:00Z');
const noop = () => {};
const allGuides = SECTIONS.flatMap((s) => s.subsections.map((g) => ({ anchor: `${s.id}/${g.id}`, g })));
const workflow = (id) => SECTIONS.find((s) => s.id === 'workflows').subsections.find((g) => g.id === id);

// ── First verified ─────────────────────────────────────────────────────────

test('a guide reads "First verified" only from a recorded first verified date', () => {
  const first = guideVerification({ firstVerifiedAt: '2026-11-12', lastVerifiedAt: null }, { now: NOW });
  assert.equal(first.state, 'verified');
  assert.equal(first.line, 'First verified 12 Nov 2026');
  const both = guideVerification({ firstVerifiedAt: '2026-03-02', lastVerifiedAt: '2026-11-12' }, { now: NOW });
  assert.equal(both.line, 'First verified 2 Mar 2026 · last verified 12 Nov 2026');
  const same = guideVerification({ firstVerifiedAt: '2026-11-12', lastVerifiedAt: '2026-11-12' }, { now: NOW });
  assert.equal(same.line, 'First verified 12 Nov 2026', 'one check is not repeated as a second date');
  const lastOnly = guideVerification({ firstVerifiedAt: null, lastVerifiedAt: '2026-11-12' }, { now: NOW });
  assert.equal(lastOnly.state, 'last_only');
  assert.equal(lastOnly.line, 'Last verified 12 Nov 2026 · first verified date not recorded');
  const none = guideVerification({ firstVerifiedAt: null, lastVerifiedAt: null }, { now: NOW });
  assert.deepEqual([none.state, none.line], ['pending', 'Verification pending']);
  assert.equal(guideVerification(null).line, 'Verification pending');
});

test('a malformed or impossible date is not a verification', () => {
  for (const bad of ['2026-02-30', '12 Nov 2026', '2026-11-12T00:00:00Z', '', 20261112, true]) {
    assert.equal(recordedDate(bad), null, String(bad));
    assert.equal(guideVerification({ firstVerifiedAt: bad }).state, 'pending', String(bad));
  }
  assert.equal(recordedDate('2026-02-28'), '2026-02-28');
  assert.equal(verifiedDay('2026-01-05'), '5 Jan 2026');
});

test('no guide is verified today: every ledger record is null and reads "Verification pending"', () => {
  for (const [anchor, rec] of Object.entries(PRIORITY_HELP_REVIEW)) {
    assert.equal(rec.firstVerifiedAt, null, `${anchor}: do not invent a first verified date`);
    assert.equal(rec.lastVerifiedAt, null, anchor);
  }
  for (const { anchor } of allGuides) {
    const v = guideVerificationFor(anchor, { now: NOW });
    assert.equal(v.line, 'Verification pending', anchor);
    assert.equal(v.stale.state, 'not_recorded', anchor);
  }
});

// ── Stale ──────────────────────────────────────────────────────────────────

test('stale is measured from the latest check against an agreed window, and only then', () => {
  assert.equal(REVIEW_WINDOW_DAYS, null, 'no review window is agreed (#4641); none is invented');
  const rec = { firstVerifiedAt: '2026-01-10', lastVerifiedAt: '2026-08-01' };
  // No window agreed: neither stale nor current.
  assert.equal(guideVerification(rec, { now: NOW }).stale.state, 'not_recorded');
  assert.equal(staleWord(guideVerification(rec, { now: NOW })), 'stale not recorded');
  // With a window, the latest check is what ages (2026-08-01 → 2026-11-18 is 109 days).
  const old = guideVerification(rec, { now: NOW, windowDays: 90 });
  assert.deepEqual(old.stale, { state: 'stale', since: '2026-08-01', ageDays: 109, windowDays: 90 });
  assert.equal(staleWord(old), 'stale · 109 days since verified');
  const fresh = guideVerification(rec, { now: NOW, windowDays: 109 });
  assert.equal(fresh.stale.state, 'current', 'exactly the window is not past it');
  assert.equal(staleWord(fresh), 'current');
  // Nothing recorded has nothing to age, whatever the window.
  assert.equal(guideVerification({}, { now: NOW, windowDays: 1 }).stale.state, 'not_recorded');
  // A window that is not a positive whole number of days is no window.
  for (const w of [0, -5, 1.5, '90']) assert.equal(guideVerification(rec, { now: NOW, windowDays: w }).stale.state, 'not_recorded', String(w));
});

// ── The guide page and search results ─────────────────────────────────────

test('the guide page shows the recorded verification and Stale beside the owner', () => {
  const pending = renderedText(html(h(OwnerReview, { anchor: 'account/privacy' })));
  assert.match(pending, /OwnerAxal VC Privacy & SupportReviewVerification pending/);
  assert.doesNotMatch(pending, /Stale/);
  const verified = guideVerification({ firstVerifiedAt: '2026-11-12' }, { now: NOW });
  const out = html(h(OwnerReview, { anchor: 'account/privacy', verification: verified }));
  assert.match(renderedText(out), /ReviewFirst verified 12 Nov 2026/);
  assert.doesNotMatch(out, /help-guide-stale/);
  const stale = guideVerification({ firstVerifiedAt: '2026-01-10' }, { now: NOW, windowDays: 90 });
  const staleOut = html(h(OwnerReview, { anchor: 'account/privacy', verification: stale }));
  assert.match(staleOut, /data-testid="help-guide-stale"/);
  assert.match(renderedText(staleOut), /Stale · \d+ (day|month|year)s? old/);
});

test('a search result shows a verification only where one is recorded', () => {
  assert.equal(html(h(ResultVerification, { anchor: 'account/privacy' })), '', 'nothing recorded adds nothing to the row');
  const lastOnly = guideVerification({ lastVerifiedAt: '2026-11-12' }, { now: NOW });
  const out = html(h(ResultVerification, { anchor: 'account/privacy', verification: lastOnly }));
  assert.match(out, /data-testid="help-result-verified"[^>]*>Last verified 12 Nov 2026 · first verified date not recorded</);
  assert.doesNotMatch(out, /help-result-stale/);
  const stale = guideVerification({ firstVerifiedAt: '2026-01-10' }, { now: NOW, windowDays: 30 });
  assert.match(html(h(ResultVerification, { anchor: 'account/privacy', verification: stale })), /data-testid="help-result-stale"/);
});

// ── Before you start ───────────────────────────────────────────────────────

test('"Before you start", where a guide declares it, is a non-empty list of sentences', () => {
  const withIt = allGuides.filter(({ g }) => 'beforeYouStart' in g);
  assert.ok(withIt.length >= 5, 'the five workflow prerequisites moved into the field');
  for (const { anchor, g } of withIt) {
    assert.ok(Array.isArray(g.beforeYouStart) && g.beforeYouStart.length > 0, anchor);
    for (const item of g.beforeYouStart) {
      assert.equal(typeof item, 'string', anchor);
      assert.ok(item.trim().length > 0, anchor);
      assert.doesNotMatch(item, /^Prerequisite:/, `${anchor}: the section heading already says it`);
    }
  }
  for (const { anchor, g } of allGuides) {
    for (const step of g.howto || []) assert.doesNotMatch(step, /^Prerequisite:/, `${anchor}: a prerequisite belongs in Before you start`);
  }
});

test('the workflow prerequisites moved without changing a word', () => {
  assert.deepEqual(workflow('research').beforeYouStart, ['Sign in with an eligible role and choose the correct company or research context. Start at /research/ask.']);
  assert.deepEqual(workflow('record-discovery').beforeYouStart, ['Choose the correct venture, explain the purpose of recording and obtain the participant consent required for your channel and jurisdiction.']);
  assert.ok(workflow('introductions').howto.length >= 4, 'the steps keep a task and recovery procedure (D4639)');
});

test('the guide page draws Before you start between Overview and Steps, and lists it', () => {
  const sub = workflow('build-week');
  assert.deepEqual(guideOutline(sub).slice(0, 3).map((o) => o.id), ['overview', 'before-you-start', 'steps']);
  assert.ok(!guideOutline(workflow('grow')).some((o) => o.id === 'before-you-start'), 'a guide with none lists none');
  assert.ok(!guideOutline({ overview: 'x', beforeYouStart: [] }).some((o) => o.id === 'before-you-start'));

  const out = html(h(HelpArticle, { sections: founder, area: 'workflows', guide: 'build-week', user: { role: 'founder' }, onOpenTicket: noop }));
  const text = renderedText(out);
  assert.match(out, /<section id="before-you-start"[^>]*data-testid="help-guide-before"><h2[^>]*>Before you start<\/h2><ul[^>]*><li>Choose the correct venture; open \/build\/this-week/);
  assert.ok(text.indexOf('Overview') < text.indexOf('Before you start') && text.indexOf('Before you start') < text.indexOf('Steps'));
  assert.match(text, /On this page[\s\S]*Before you start/);

  const none = html(h(HelpArticle, { sections: founder, area: 'workflows', guide: 'grow', user: { role: 'founder' }, onOpenTicket: noop }));
  assert.doesNotMatch(none, /before-you-start|Before you start/);
});

test('search and reading time read Before you start too', () => {
  const rec = buildDocsRecords('founder').find((r) => r.anchor === 'workflows/record-discovery');
  assert.match(rec.text, /obtain the participant consent required/);
  const sub = { overview: 'one', beforeYouStart: [Array.from({ length: 400 }, () => 'word').join(' ')] };
  assert.equal(readingMinutes(sub), 2);
});
