// D717 (#1857) — signing in four steps at /esign/:token: read the paper,
// tick the consent on a 44 px row, adopt a typed or drawn signature once, then
// confirm and Sign. Sign exists only on the confirm sheet; a typed signature is
// the same PNG data URL a drawn one is; nothing is stored in the browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  SIGN_STEPS,
  SIGNATURE_PNG_PREFIX,
  initialSigning,
  signingReducer,
  canSign,
  typedSignatureFont,
  fitTypedSignature,
  drawTypedSignature,
  whenFontReady,
  utcDate,
  utcClock,
  signingCopy,
} from '../src/lib/esignSteps.js';
import { ReadStep, ConsentStep, AdoptStep, ConfirmSheet, DoneScreen } from '../src/pages/ESignPage.jsx';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const PAGE_RAW = src('../src/pages/ESignPage.jsx');
const PAGE = codeOnly(PAGE_RAW);
const STEPS = codeOnly(src('../src/lib/esignSteps.js'));

const ENVELOPE = {
  document_title: 'Founder NDA',
  document_type: 'nda',
  envelope_uuid: '1a2b3c4d-0000-4000-8000-00000000abcd',
  recipient_email: 'jane@example.com',
  expires_at: '2026-11-01T00:00:00Z',
  document_body: 'The parties agree.',
};
const COPY = signingCopy(ENVELOPE);
const PNG = `${SIGNATURE_PNG_PREFIX}AAAA`;
const CONSENT = 'I agree that my electronic signature is the legal equivalent of my handwritten signature and that I am bound by the terms of this Agreement.';
const noop = () => {};

const run = (state, ...actions) => actions.reduce((s, a) => signingReducer(s, a), state);
const atAdopt = (name = 'Jane Doe') => run(initialSigning(name), { type: 'continue' }, { type: 'accept', value: true }, { type: 'continue' });
const atConfirm = (name = 'Jane Doe') => run(atAdopt(name), { type: 'adopt', dataUrl: PNG });
const render = (C, props) => renderToStaticMarkup(createElement(C, props));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const buttons = (html) => [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]));

/** A 2D context that records what was drawn, 10 px per character. */
function stubContext() {
  const calls = [];
  const ctx = {
    calls,
    _fill: '',
    _font: '',
    set fillStyle(v) { this._fill = v; calls.push(['fillStyle', v]); },
    get fillStyle() { return this._fill; },
    set font(v) { this._font = v; calls.push(['font', v]); },
    get font() { return this._font; },
    textBaseline: '',
    fillRect: (...a) => calls.push(['fillRect', ...a]),
    fillText: (...a) => calls.push(['fillText', ...a]),
    measureText: (s) => ({ width: s.length * 10 }),
  };
  return ctx;
}

// ── Sign is unreachable before the confirm step ─────────────────────────────

test('D717: canSign is true only on confirm, with a PNG adoption under the current name', () => {
  assert.deepEqual(SIGN_STEPS, ['read', 'consent', 'adopt', 'confirm']);
  const adoption = { dataUrl: PNG, mode: 'type', name: 'Jane Doe' };
  for (const step of ['read', 'consent', 'adopt']) {
    for (const accepted of [true, false]) {
      for (const adopted of [null, adoption]) {
        for (const name of ['Jane Doe', '', '  ']) {
          assert.equal(canSign({ step, accepted, mode: 'type', name, adopted }), false, `${step}/${accepted}/${!!adopted}/${name}`);
        }
      }
    }
  }
  assert.equal(canSign(atConfirm()), true);
  assert.equal(canSign({ ...atConfirm(), accepted: false }), false);
  assert.equal(canSign({ ...atConfirm(), name: 'Someone Else' }), false);
  assert.equal(canSign({ ...atConfirm(), adopted: { ...adoption, dataUrl: 'data:image/jpeg;base64,AAAA' } }), false);
});

test('D717: consent needs the tick, adopt needs its step, a PNG and a name', () => {
  const consent = run(initialSigning('Jane'), { type: 'continue' });
  assert.equal(consent.step, 'consent');
  assert.equal(signingReducer(consent, { type: 'continue' }), consent, 'continue without accepted stays put');

  for (const s of [initialSigning('Jane'), consent]) {
    assert.equal(signingReducer(s, { type: 'adopt', dataUrl: PNG }), s, `adopt is ignored on ${s.step}`);
  }
  const adopt = atAdopt();
  assert.equal(signingReducer(adopt, { type: 'adopt', dataUrl: 'data:image/jpeg;base64,AAAA' }), adopt);
  const blank = run(adopt, { type: 'name', value: '   ' });
  assert.equal(signingReducer(blank, { type: 'adopt', dataUrl: PNG }).step, 'adopt');
  assert.equal(signingReducer(adopt, { type: 'nonsense' }), adopt);
  assert.equal(signingReducer(adopt, { type: 'cancel' }), adopt, 'cancel applies to confirm only');
});

test('D717: no step but the confirm sheet draws a Sign button, and the sheet draws one', () => {
  const steps = [
    render(ReadStep, { copy: COPY, envelope: ENVELOPE, paper: { loading: true }, onContinue: noop }),
    render(ConsentStep, { copy: COPY, accepted: true, onAccept: noop, onContinue: noop, onBack: noop }),
    render(AdoptStep, { copy: COPY, envelope: ENVELOPE, mode: 'type', name: 'Jane Doe', adopted: null, disabled: false, onBack: noop, onName: noop, onMode: noop, onInk: noop, onAdopt: noop }),
    render(AdoptStep, { copy: COPY, envelope: ENVELOPE, mode: 'draw', name: 'Jane Doe', adopted: null, disabled: false, onBack: noop, onName: noop, onMode: noop, onInk: noop, onAdopt: noop }),
  ];
  for (const html of steps) assert.ok(!buttons(html).includes('Sign'), 'a step before confirm draws Sign');
  const sheet = render(ConfirmSheet, { copy: COPY, adopted: { dataUrl: PNG, mode: 'type', name: 'Jane Doe' }, date: '2026-10-18', submitting: false, disabled: false, onSign: noop, onCancel: noop });
  assert.equal(buttons(sheet).filter((b) => b === 'Sign').length, 1);
});

test('D717: the page calls submit once, from the confirm sheet\'s onSign', () => {
  const calls = [...PAGE.matchAll(/\bsubmit\(/g)];
  assert.equal(calls.length, 1, 'there is a second way to submit');
  const sheet = PAGE.indexOf('<ConfirmSheet');
  assert.ok(sheet > 0);
  const onSign = PAGE.indexOf('onSign={', sheet);
  const close = PAGE.indexOf('/>', sheet);
  assert.ok(onSign > sheet && onSign < close, 'onSign sits on the page\'s ConfirmSheet');
  assert.ok(calls[0].index > onSign && calls[0].index < close, 'the one submit( is inside onSign');
  assert.match(PAGE.slice(onSign, close), /onSign=\{\(\) => submit\(signing\.adopted\.dataUrl\)\}/);
  assert.match(PAGE, /const submit = async \(sigDataUrl\) => \{\n\s+if \(!canSign\(signing\)\) return;/);
});

// ── Adopt once ──────────────────────────────────────────────────────────────

test('D717: a change to the name, the mode or the ink drops the adoption', () => {
  const confirm = atConfirm();
  assert.equal(confirm.step, 'confirm');
  assert.deepEqual(confirm.adopted, { dataUrl: PNG, mode: 'type', name: 'Jane Doe' });
  for (const a of [{ type: 'name', value: 'Jane Q Doe' }, { type: 'mode', value: 'draw' }, { type: 'ink_changed' }]) {
    const s = signingReducer(confirm, a);
    assert.equal(s.adopted, null, `${a.type} keeps the adoption`);
    assert.equal(s.step, 'adopt', `${a.type} on confirm stays on confirm`);
    assert.equal(canSign(s), false);
  }
  // On the pad, the same changes drop it without moving the step.
  const back = run(confirm, { type: 'back' });
  assert.equal(signingReducer(back, { type: 'name', value: 'X' }).adopted, null);
});

test('D717: cancel, failed, and back then forward keep the adoption', () => {
  const confirm = atConfirm();
  for (const type of ['cancel', 'failed']) {
    const s = signingReducer(confirm, { type });
    assert.equal(s.step, 'adopt');
    assert.deepEqual(s.adopted, confirm.adopted);
  }
  const round = run(confirm, { type: 'back' }, { type: 'back' }, { type: 'continue' });
  assert.equal(round.step, 'adopt');
  assert.deepEqual(round.adopted, confirm.adopted);
  assert.deepEqual(run(atAdopt(), { type: 'start', name: 'Ann' }), initialSigning('Ann'));
});

// ── A typed signature submits a PNG data URL ───────────────────────────────

test('D717: the typed signature fills white, then draws the name in #111827', () => {
  const ctx = stubContext();
  assert.equal(drawTypedSignature(ctx, 'Jane Doe', { width: 300, height: 110 }), true);
  const firstFill = ctx.calls.findIndex((c) => c[0] === 'fillRect');
  assert.deepEqual(ctx.calls[firstFill - 1], ['fillStyle', '#ffffff']);
  assert.deepEqual(ctx.calls[firstFill].slice(1), [0, 0, 300, 110]);
  const text = ctx.calls.find((c) => c[0] === 'fillText');
  assert.deepEqual(text.slice(1), ['Jane Doe', 12, 55]);
  assert.equal(ctx.fillStyle, '#111827');
  assert.equal(ctx.textBaseline, 'middle');
  assert.ok(ctx.calls.indexOf(text) > firstFill);
  assert.match(ctx.font, /^italic 400 \d+px "Public Sans"/);
  assert.doesNotMatch(ctx.font, /Inter/);

  const blank = stubContext();
  assert.equal(drawTypedSignature(blank, '   ', { width: 300, height: 110 }), false);
  assert.ok(!blank.calls.some((c) => c[0] === 'fillText'));
});

test('D717: a typed canvas\'s PNG goes through the adopt path to confirm, and on to the one payload', () => {
  const canvas = { toDataURL: (type) => (type === 'image/png' ? 'data:image/png;base64,AAAA' : 'data:image/jpeg;base64,AAAA') };
  const s = signingReducer(atAdopt(), { type: 'adopt', dataUrl: canvas.toDataURL('image/png') });
  assert.equal(s.step, 'confirm');
  assert.equal(s.adopted.dataUrl, 'data:image/png;base64,AAAA');
  assert.equal(s.adopted.mode, 'type');
  assert.equal(canSign(s), true);

  assert.equal(PAGE.split('api.esignSubmitSignature(').length - 1, 1, 'there is a second payload builder');
  const worker = readFileSync(new URL('../../cloudflare-worker/src/routes/esign.ts', import.meta.url), 'utf8');
  assert.equal(SIGNATURE_PNG_PREFIX, worker.match(/const SIGNATURE_DATAURL_PREFIX = '([^']+)';/)[1]);
});

// ── The typed font is Public Sans, never Inter ─────────────────────────────

test('D717: the typed font names Public Sans italic 400, and a long name shrinks to fit', () => {
  assert.match(typedSignatureFont(32), /^italic 400 32px "Public Sans"/);
  assert.doesNotMatch(typedSignatureFont(32), /Inter/);
  const ctx = stubContext();
  const px = fitTypedSignature(ctx, 'x'.repeat(60), 300);
  assert.ok(px < 32 && px >= 12, `60 characters fit at ${px}px`);
  assert.equal(fitTypedSignature(stubContext(), 'Jane', 300), 32);
  // 10 px per character at any size never fits; the floor holds.
  assert.equal(fitTypedSignature(stubContext(), 'x'.repeat(200), 300), 12);
});

test('D717: index.html asks for Public Sans italic 400 in all three font tags', () => {
  const html = src('../index.html');
  const tags = [...html.matchAll(/fonts\.googleapis\.com\/css2\?[^"]+/g)].map((m) => m[0]);
  assert.equal(tags.length, 3);
  for (const t of tags) {
    assert.match(t, /family=Public\+Sans:ital,wght@/);
    assert.match(t, /Public\+Sans:ital,wght@[\d,;]*\b1,400\b/);
  }
});

test('D717: whenFontReady always resolves', async () => {
  await whenFontReady(undefined, typedSignatureFont(32));
  await whenFontReady({ load: () => Promise.reject(new Error('offline')) }, 'x');
  await whenFontReady({ load: () => { throw new Error('bad'); } }, 'x');
  await whenFontReady({ load: () => Promise.resolve([]) }, 'x');
  const started = Date.now();
  await whenFontReady({ load: () => new Promise(() => {}) }, 'x', 20);
  assert.ok(Date.now() - started < 1000, 'a load that never settles still resolves');
});

// ── The consent row ────────────────────────────────────────────────────────

test('D717: the consent row is a label holding the checkbox, at least 44 px tall', () => {
  const html = render(ConsentStep, { copy: COPY, accepted: false, onAccept: noop, onContinue: noop, onBack: noop });
  const row = html.match(/<label class="([^"]*)">([\s\S]*?)<\/label>/);
  assert.ok(row, 'the row is a label');
  assert.match(row[2], /<input type="checkbox"/);
  const min = row[1].match(/min-h-\[(\d+)px\]/);
  assert.ok(min && Number(min[1]) >= 44, 'the row is shorter than 44 px');
  assert.ok(text(row[2]).includes(CONSENT), 'the consent sentence changed');
  assert.ok(text(html).includes('2 of 4'));
  assert.ok(text(html).includes('Electronic signature is legally binding under E-SIGN (15 U.S.C. § 7001) and UETA.'));
  assert.match(html, /aria-label="Back"/);
  // Continue is held until the tick.
  assert.match(html, /<button type="button" disabled=""[^>]*>Continue<\/button>/);
});

// ── The copy ───────────────────────────────────────────────────────────────

test('D717: Read, Adopt and Confirm say what the issue quotes', () => {
  const read = text(render(ReadStep, { copy: COPY, envelope: ENVELOPE, paper: { loading: true }, onContinue: noop }));
  for (const s of ['Sign Founder NDA', '1 of 4', 'Envelope 1a2b3c4d…abcd', 'Continue']) assert.ok(read.includes(s), s);

  const adoptHtml = render(AdoptStep, { copy: COPY, envelope: ENVELOPE, mode: 'type', name: 'Jane Doe', adopted: null, disabled: false, onBack: noop, onName: noop, onMode: noop, onInk: noop, onAdopt: noop });
  const adopt = text(adoptHtml);
  for (const s of ['Type your full legal name. It is drawn on each signature line.', 'By adopting, you agree it has the same effect as your handwritten signature.', 'Adopt and sign', 'Signing as jane@example.com', '3 of 4']) assert.ok(adopt.includes(s), s);
  assert.match(adoptHtml, /role="radiogroup"/);
  const radios = [...adoptHtml.matchAll(/<input type="radio"[^>]*>/g)].map((m) => m[0]);
  assert.equal(radios.length, 2);
  assert.match(radios.find((r) => r.includes('value="type"')), /checked=""/, 'Type is the default');
  assert.doesNotMatch(radios.find((r) => r.includes('value="draw"')), /checked=""/);
  assert.match(adoptHtml, /aria-label="Full legal name" placeholder="Full legal name"[^>]*maxLength="200"/);
  assert.doesNotMatch(adoptHtml, /touch-none/, 'a Type preview takes no touch');

  const drawHtml = render(AdoptStep, { copy: COPY, envelope: ENVELOPE, mode: 'draw', name: 'Jane Doe', adopted: null, disabled: false, onBack: noop, onName: noop, onMode: noop, onInk: noop, onAdopt: noop });
  for (const s of ['Draw your signature', 'Clear', 'Sign here using mouse, trackpad, or touch']) assert.ok(text(drawHtml).includes(s), s);
  assert.match(drawHtml, /touch-none/);

  const confirm = text(render(ConfirmSheet, { copy: COPY, adopted: { dataUrl: PNG, mode: 'type', name: 'Jane Doe' }, date: '2026-10-18', submitting: false, disabled: false, onSign: noop, onCancel: noop }));
  for (const s of ['Apply this signature to Founder NDA?', 'By:', 'Name: Jane Doe', 'Date: 2026-10-18', 'Sign', 'Cancel']) assert.ok(confirm.includes(s), s);
});

test('D717: the confirm sheet is a modal dialog showing the adopted image', () => {
  const html = render(ConfirmSheet, { copy: COPY, adopted: { dataUrl: PNG, mode: 'draw', name: 'Jane Doe' }, date: '2026-10-18', submitting: true, disabled: false, onSign: noop, onCancel: noop });
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, new RegExp(`<img src="${PNG}"`));
  assert.ok(buttons(html).includes('Signing…'));
});

test('D717: the done screen states the facts in one line, with no footer button', () => {
  const done = (completed) => render(DoneScreen, { envelope: ENVELOPE, copy: COPY, done: { signed_at: '2026-10-18T14:05:00Z', completed } });
  const yes = text(done(true));
  for (const s of ['You signed Founder NDA', 'Envelope 1a2b3c4d…', '14:05 UTC · Completed.', 'You will receive a copy by email shortly. You may now close this window.']) assert.ok(yes.includes(s), s);
  assert.ok(text(done(false)).includes('Partially signed.'));
  assert.doesNotMatch(done(true), /<button|<a /, 'the generic copy draws no footer action');
  assert.equal(COPY.doneAction, undefined);
  const withAction = render(DoneScreen, { envelope: ENVELOPE, done: { signed_at: '2026-10-18T14:05:00Z', completed: true }, copy: { ...COPY, doneAction: { label: 'Open my documents', href: '/fund/documents' } } });
  assert.match(withAction, /<a href="\/fund\/documents"[^>]*>Open my documents<\/a>/);
  assert.equal(utcDate('2026-10-18T23:59:00Z'), '2026-10-18');
  assert.equal(utcClock('2026-10-18T14:05:00Z'), '14:05');
});

test('D717: a decline never reads as a signature', () => {
  const html = text(render(DoneScreen, { envelope: ENVELOPE, copy: COPY, done: { signed_at: '2026-10-18T14:05:00Z', completed: false, rejected: true } }));
  assert.ok(html.includes('You declined to sign Founder NDA'));
  assert.ok(html.includes('The Axal VC team has been notified.'));
  assert.ok(!html.includes('You signed'));
  assert.ok(!/recorded/i.test(html));
  assert.ok(!/Signature received/.test(html));
});

// ── Nothing is stored ──────────────────────────────────────────────────────

test('D717: neither the page nor the steps write browser storage', () => {
  for (const [name, code] of [['ESignPage.jsx', PAGE], ['esignSteps.js', STEPS]]) {
    for (const word of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
      assert.ok(!code.includes(word), `${name} uses ${word}`);
    }
  }
  assert.ok(!PAGE_RAW.includes('Signature received'), 'the old done screen is back');
});
