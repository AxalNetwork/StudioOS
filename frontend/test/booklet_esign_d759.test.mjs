// D759 (#1858) PR 2 — signing a Subscription Booklet on screen. The client's
// sign() goes through the real `request()` with `fetch` stubbed; the copy is
// `lib/bookletSigning.js`'s, and #1857's step components render it on node
// with no DOM. A non-booklet envelope keeps #1857's words.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/booklet_esign_d759.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import { fundBookletsApi } from '../src/lib/api/fundBooklets.js';
import {
  ACCOUNT_DOCUMENTS, BOOKLET_PAPER_FALLBACK, SIGN_BOOKLET, bookletSignCopy, canSignBooklet, signingLine,
} from '../src/lib/bookletSigning.js';
import { signingCopy } from '../src/lib/esignSteps.js';
import { DoneScreen, ReadStep, SignerPaper } from '../src/pages/ESignPage.jsx';
import { BookletSigning } from '../src/pages/SpinoutLabLpBooklet.jsx';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document ??= { cookie: '' };

const render = (C, props) => renderToStaticMarkup(createElement(C, props));
const text = (html) => renderedText(html).replace(/\s+/g, ' ').trim();
const noop = () => {};

const BODY = '{"parts":[{"slug":"lp_investor_questionnaire"}],"ticks":[]}';
const envelope = (booklet) => ({
  document_title: 'Subscription Booklet · v2 · Parts 3 to 8',
  document_type: 'subscription_booklet',
  envelope_uuid: '1a2b3c4d-0000-4000-8000-00000000abcd',
  recipient_email: 'lp@example.test',
  expires_at: '2026-11-01T00:00:00Z',
  document_body: BODY,
  ...(booklet ? { booklet } : {}),
});
const copyFor = (env, signedAt) => ({ ...signingCopy(env), ...bookletSignCopy({ ...env.booklet, signedAt }) });

test('the client: sign() posts to /fund-booklets/mine/sign with no body', async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*\/api/, '/api'), init.body ?? null]);
    return new Response(JSON.stringify({ uid: 'b', stage: 'applicant', envelope_uuid: 'e', token: 't' }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  try {
    const r = await fundBookletsApi.sign();
    assert.equal(r.token, 't');
  } finally { globalThis.fetch = real; }
  assert.deepEqual(seen, [['POST', '/api/fund-booklets/mine/sign', null]]);
});

test('signingLine gives each state\'s sentence exactly; not_sent and unknown give none', () => {
  assert.equal(signingLine({ state: 'not_sent' }), null);
  assert.equal(signingLine({ state: 'sent' }), 'Out for your signature. Open the signing link we emailed you.');
  assert.equal(signingLine({ state: 'awaiting_gp' }), 'You signed Parts 3 to 8. The General Partner signs Part 9 to accept.');
  assert.equal(signingLine({ state: 'accepted', accepted_at: '2026-10-18 23:59:59' }), 'Accepted by the General Partner on 2026-10-18. A copy is in your documents.');
  assert.equal(signingLine({ state: 'accepted', accepted_at: '2026-10-18T09:05:41Z' }), 'Accepted by the General Partner on 2026-10-18. A copy is in your documents.');
  assert.equal(signingLine({ state: 'void' }), 'This signature request was voided. Ask Axal VC to withdraw the booklet so you can open a new one.');
  assert.equal(signingLine({ state: 'constructor' }), null);
  assert.equal(signingLine(null), null);
});

test('the submitted view: Sign the booklet only for not_sent; a line for the rest; Open my documents once accepted; a refusal as text', () => {
  const view = (state, extra = {}) => ({ status: 'submitted', signing: { state, signed_at: null, accepted_at: '2026-10-18 10:00:00', ...extra } });
  const notSent = render(BookletSigning, { view: view('not_sent'), sign: { onSign: noop } });
  assert.match(notSent, new RegExp(`data-testid="booklet-sign"[^>]*>${SIGN_BOOKLET}<`));
  assert.match(notSent, /bg-\[#4f46e5\]/);
  assert.match(notSent, /min-h-\[50px\]/);
  for (const state of ['sent', 'awaiting_gp', 'accepted', 'void']) {
    const html = render(BookletSigning, { view: view(state), sign: { onSign: noop } });
    assert.doesNotMatch(html, /booklet-sign"/, `${state}: no Sign button`);
    assert.ok(text(html).includes(signingLine({ state, accepted_at: '2026-10-18 10:00:00' })), state);
    assert.equal(html.includes(`href="${ACCOUNT_DOCUMENTS.href}"`), state === 'accepted', `${state}: Open my documents`);
  }
  assert.equal(canSignBooklet({ status: 'open', signing: { state: 'not_sent' } }), false, 'an open booklet is not signed');
  const refused = text(render(BookletSigning, { view: view('not_sent'), sign: { onSign: noop, error: 'Submit the booklet first. Only a submitted booklet is sent for signature.' } }));
  assert.ok(refused.includes('Submit the booklet first. Only a submitted booklet is sent for signature.'));
  // The page navigates to /esign/<token> and keeps the token nowhere else.
  const page = readFileSync(new URL('../src/pages/SpinoutLabLpBooklet.jsx', import.meta.url), 'utf8');
  assert.match(page, /navigate\(`\/esign\/\$\{encodeURIComponent\(r\.token\)\}`\)/);
  assert.doesNotMatch(page, /localStorage|sessionStorage|setToken|token\s*:/);
});

test('bookletSignCopy: the applicant\'s and the GP\'s strings exactly, v[N] from edition and [HH:MM] in UTC', () => {
  const a = bookletSignCopy({ stage: 'applicant', edition: 2, signedAt: '2026-10-18T09:05:41Z' });
  assert.deepEqual(
    [a.readTitle, a.readCounter, a.readContinue, a.adoptTitle, a.typeHint, a.adoptNote, a.adoptAction, a.confirmTitle],
    ['Sign the Subscription Booklet', 'Parts 3 to 8', 'Continue', 'Adopt a signature',
      'Type your full legal name. It is drawn on each signature line of this booklet.',
      'By adopting, you agree it has the same effect as your handwritten signature.', 'Adopt and sign',
      'Apply this signature to Parts 3 to 8?'],
  );
  assert.deepEqual([a.doneTop, a.doneTitle, a.doneLine, a.doneNext], ['Signed', 'You signed Part 8', 'Subscription Booklet · v2 · 09:05 UTC.',
    'The General Partner signs Part 9 to accept. A copy is in your documents.']);
  assert.deepEqual(a.doneAction, { label: 'Open my documents', href: '/account' });
  const g = bookletSignCopy({ stage: 'gp', edition: 1, signedAt: '2026-10-18T23:59:00+02:00' });
  assert.deepEqual([g.readCounter, g.confirmTitle, g.doneTitle, g.doneLine, g.doneNext], ['Part 9', 'Apply this signature to Part 9?', 'You signed Part 9',
    'Subscription Booklet · v1 · 21:59 UTC.', "The booklet is accepted. A copy is in the applicant's documents."]);
  assert.equal(bookletSignCopy({ stage: 'witness' }), null);
});

test('a booklet\'s paper fallback never renders document_body, and Continue waits for the paper', () => {
  const env = envelope({ stage: 'applicant', edition: 2 });
  const copy = copyFor(env);
  const failed = render(SignerPaper, { paper: null, envelope: env, fallback: copy.paperFallback });
  assert.ok(text(failed).includes(BOOKLET_PAPER_FALLBACK));
  assert.doesNotMatch(failed, /lp_investor_questionnaire|parts/);
  assert.equal(render(SignerPaper, { paper: { loading: true }, envelope: env, fallback: copy.paperFallback }), '', 'nothing while it loads');
  const read = render(ReadStep, { copy, envelope: env, paper: null, continueDisabled: true, onContinue: noop });
  assert.match(read, /<button[^>]*disabled=""[^>]*>Continue</, 'Continue is disabled');
  assert.ok(text(read).includes('Sign the Subscription Booklet') && text(read).includes('Parts 3 to 8'));
  assert.doesNotMatch(read, /lp_investor_questionnaire/);
  const page = readFileSync(new URL('../src/pages/ESignPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /continueDisabled=\{!!booklet && !paper\?\.html\}/);
});

test('the done screen for a booklet: the canvas\'s lines and Open my documents; a non-booklet envelope keeps #1857\'s', () => {
  const env = envelope({ stage: 'applicant', edition: 2 });
  const done = { signed_at: '2026-10-18T09:05:41Z', completed: false };
  const html = render(DoneScreen, { envelope: env, done, copy: copyFor(env, done.signed_at) });
  const t = text(html);
  const lines = ['Signed', 'You signed Part 8', 'Subscription Booklet · v2 · 09:05 UTC.',
    'The General Partner signs Part 9 to accept. A copy is in your documents.', 'Open my documents'];
  assert.equal(t.replace(/\s+/g, ''), lines.join('').replace(/\s+/g, ''), t);
  assert.doesNotMatch(t, /Envelope 1a2b3c4d|Partially signed/);
  assert.match(html, /href="\/account"[^>]*>Open my documents</);
  const plain = envelope(null);
  const generic = text(render(DoneScreen, { envelope: plain, done, copy: signingCopy(plain) }));
  assert.ok(generic.includes('Envelope 1a2b3c4d… · 09:05 UTC · Partially signed.'));
  assert.match(render(SignerPaper, { paper: null, envelope: plain }), /lp_investor_questionnaire/, 'a non-booklet still shows its text');
});
