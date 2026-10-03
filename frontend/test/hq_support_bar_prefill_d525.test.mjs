/**
 * D525 — the HQ support bar's "Raise a concern" arrives with the form filled.
 *
 * Since D445, `/branch/approvals` reads `?kind=` and `?subject=` through
 * `prefillFromSearch` and every other door passes them. The support bar linked
 * a bare `/branch/approvals`, so a branch admin who raised a concern from
 * inside an HQ session started with an empty form and had to say, by hand, what
 * the bar had just told them. The bar now builds its link with `approvalsHref`
 * from what the stored session already carries: the kind is `other` (D445 named
 * it as the prefill this bar would use) and the subject names the session, the
 * HQ actor when the redeem response carried one, and the reason when it did.
 *
 * Rendered, not matched: the bar is pure over `localStorage.supportSession`
 * once `activeSupportSession` has read it, so each case is rendered through
 * `renderToStaticMarkup` under a fake store, and the href it draws is parsed
 * back through the same `prefillFromSearch` the Approvals page uses.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_support_bar_prefill_d525.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { prefillFromSearch, approvalsHref } from '../src/lib/escalationPrefill.js';
import { KEY } from '../src/lib/supportSession.js';

// The bar reads the store at module evaluation time through `useState(() =>
// activeSupportSession())`, so the fake store must exist before the import.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { default: HqSupportSessionBar } = await import('../src/components/HqSupportSessionBar.jsx');

const SRC = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/components/HqSupportSessionBar.jsx'), 'utf8'));
const live = (fields) => JSON.stringify({ expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), branch: 'fr', ...fields });
const render = () => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(HqSupportSessionBar)));
const hrefOf = (html) => {
  const m = html.match(/<a[^>]*href="([^"]+)"[^>]*>Raise a concern<\/a>/);
  assert.ok(m, 'the bar no longer draws a "Raise a concern" link');
  return m[1].replaceAll('&amp;', '&');
};
const prefillOf = (href) => {
  const u = new URL(href, 'https://fr.axal.vc');
  assert.equal(u.pathname, '/branch/approvals', 'the concern no longer goes to the Approvals page');
  return prefillFromSearch(u.searchParams);
};

test('D525: the link carries kind=other and a subject naming the session, the HQ actor and the reason', () => {
  store.set(KEY, live({ actor_name: 'T. Okafor', reason: 'ticket #4192' }));
  const href = hrefOf(render());
  const p = prefillOf(href);
  assert.equal(p.kind, 'other', 'the Approvals form would not read a kind off this link');
  assert.equal(p.subject, 'HQ support session by T. Okafor: ticket #4192');
  // Built by the one helper every other door uses, so the encoding and the
  // 300-character cut are the page's own and not a second copy of them.
  assert.equal(href, approvalsHref({ kind: 'other', subject: 'HQ support session by T. Okafor: ticket #4192' }));
});

test('D525: a session the redeem response described less fully still arrives with a kind and a subject', () => {
  store.set(KEY, live({ actor_name: null, reason: null }));
  const bare = prefillOf(hrefOf(render()));
  assert.equal(bare.kind, 'other');
  assert.equal(bare.subject, 'HQ support session', 'a missing actor or reason is left out, not invented');

  store.set(KEY, live({ actor_name: 'T. Okafor', reason: null }));
  assert.equal(prefillOf(hrefOf(render())).subject, 'HQ support session by T. Okafor');

  store.set(KEY, live({ actor_name: null, reason: 'ticket #4192' }));
  assert.equal(prefillOf(hrefOf(render())).subject, 'HQ support session: ticket #4192');
});

test('D525: a long reason is cut where the route cuts it, and the subject survives URL encoding', () => {
  // No space near the cut: the page trims what it reads, so a cut that lands
  // on a space would read one shorter and the pin would be about the trim.
  const reason = 'x'.repeat(400) + ' ampersand & question? plus+sign';
  store.set(KEY, live({ actor_name: 'Ana & Co', reason }));
  const href = hrefOf(render());
  const p = prefillOf(href);
  assert.equal(p.kind, 'other');
  assert.equal(p.subject.length, 300, 'the subject is not cut at the route\'s 300-character limit');
  // Cut before it travels, not only when it is read: the URL carries 300.
  assert.equal(new URL(href, 'https://fr.axal.vc').searchParams.get('subject').length, 300, 'the href carries the uncut subject');
  assert.ok(p.subject.startsWith('HQ support session by Ana & Co: xxx'), 'the ampersand in the actor name did not survive the round trip');
  assert.ok(!href.includes(' '), 'the href carries a raw space');
});

test('D525: the link is built by approvalsHref, from the session, and nothing else about the bar moved', () => {
  assert.match(SRC, /import \{ approvalsHref \} from '\.\.\/lib\/escalationPrefill';/, 'the bar does not import the helper');
  assert.match(SRC, /to=\{approvalsHref\(\{ kind: 'other', subject: concernSubject\(session\) \}\)\}/, 'the Link is not built from the helper and the session');
  assert.ok(!SRC.includes("to=\"/branch/approvals\""), 'the bar still links a bare /branch/approvals');
  assert.ok(!/\?kind=/.test(SRC), 'the bar spells the query by hand instead of through the helper');
  // What D142 pinned stays: nothing persisted, no close button.
  assert.ok(!SRC.includes('localStorage'), 'the bar writes to localStorage');
  assert.ok(!/aria-label="Close"/.test(SRC), 'the bar grew a close button');
  // With no live session the bar draws nothing, link included.
  store.delete(KEY);
  assert.equal(render(), '');
});
