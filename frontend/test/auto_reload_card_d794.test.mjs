/**
 * D794 (#2219) — Billing's Auto-reload card: the words (`autoReloadModel.js`),
 * the form's states, and what Save sends, against a stubbed API. The Worker's
 * half is cloudflare-worker/test/ai_auto_reload_d794.test.ts. Each case names
 * the mutations it was checked against.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/auto_reload_card_d794.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import { AutoReloadForm } from '../src/pages/account/AutoReloadCard.jsx';
import { OFF_WORDS, cardText, lastSkipped, packOptions, parseThreshold, stateLine } from '../src/pages/account/autoReloadModel.js';

const h = React.createElement;
const PACKS = [{ uid: 'pack25', label: '$25 of tokens' }, { uid: 'pack50', label: '$50 of tokens' }];
const OFF = { enabled: false, pack_uid: null, threshold_usd: null, card: null, card_unreadable: false, last_attempt_at: null, last_outcome: null, disabled_reason: null };
const ON = { ...OFF, enabled: true, pack_uid: 'pack25', threshold_usd: 20, card: { brand: 'visa', last4: '4242' } };

// 1 ───────────────────────────────────────────────────────────────────────────
test('the words: the state, the card, the packs, the threshold, and why a reload was skipped', () => {
  // Mutations checked: the threshold cap removed; a pack with no id offered; the off reason not drawn; a 3-digit last4 accepted; the limit's words dropped.
  assert.equal(stateLine(OFF).text, 'Off. Nothing is charged automatically.');
  assert.equal(stateLine(ON, PACKS).text, 'On: when your token balance drops below $20.00, Visa ending 4242 is charged for $25 of tokens.');
  assert.deepEqual(stateLine({ ...OFF, disabled_reason: 'card_declined' }), { tone: 'warn', text: 'Auto-reload is off: your card was declined. Update it on Billing.' });
  assert.equal(OFF_WORDS.card_declined, 'Auto-reload is off: your card was declined. Update it on Billing.', 'the owner\'s sentence, verbatim');
  assert.equal(cardText({ brand: 'mastercard', last4: '0005' }), 'Mastercard ending 0005');
  assert.equal(cardText({ brand: 'visa', last4: '424' }), null);
  assert.equal(cardText(null), null);
  assert.deepEqual(packOptions({ packs: [{ uid: 'pack25', label: '$25 of tokens', price_id: 'p' }, { uid: null, label: '$15 of tokens' }] }), [{ uid: 'pack25', label: '$25 of tokens' }]);
  assert.equal(parseThreshold('20'), 20);
  assert.equal(parseThreshold('$19.99'), 19.99);
  for (const bad of ['500.01', '-1', '1.234', 'abc', '']) assert.equal(parseThreshold(bad), null, bad);
  assert.equal(lastSkipped({ ...ON, last_outcome: 'token_pack_daily_limit' }), 'The last reload was not made: five token packs were ordered in the last 24 hours.');
  assert.equal(lastSkipped({ ...ON, last_outcome: 'spend_limit' }), 'The last reload was not made: it would pass your monthly AI spend limit. Raise it on Usage › Limits, or it resumes next month.', 'D788');
  assert.equal(lastSkipped({ ...ON, last_outcome: 'charged' }), null);
  assert.equal(lastSkipped({ ...OFF, last_outcome: 'error' }), null, 'only while it is on');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('the form draws the switch, the packs, the threshold and the saved card; Save needs a card to turn it on', () => {
  // Mutations checked: the card requirement dropped from Save; the saved card not drawn; the threshold error not drawn.
  const off = renderToStaticMarkup(h(AutoReloadForm, { settings: OFF, packs: PACKS }));
  assert.match(off, /data-testid="auto-reload-state"/);
  assert.match(off, /<option value="pack25"[^>]*>\$25 of tokens<\/option>/);
  assert.match(off, /No card saved for auto-reload\./);
  assert.match(off, /data-testid="auto-reload-save"[^>]*>Save/);
  assert.doesNotMatch(off, /data-testid="auto-reload-save"[^>]*disabled/, 'off can be saved with no card');
  const on = renderToStaticMarkup(h(AutoReloadForm, { settings: ON, packs: PACKS }));
  assert.match(on, /Card: Visa ending 4242/);
  assert.match(on, />Replace card</);
  const noCard = renderToStaticMarkup(h(AutoReloadForm, { settings: { ...ON, card: null }, packs: PACKS }));
  assert.match(noCard, /data-testid="auto-reload-card-needed"/);
  assert.match(noCard, /disabled=""[^>]*data-testid="auto-reload-save"|data-testid="auto-reload-save"[^>]*disabled=""/);
  assert.match(renderToStaticMarkup(h(AutoReloadForm, { settings: { ...ON, threshold_usd: null }, packs: [] })), /No token pack is on sale right now\./);
  assert.match(renderToStaticMarkup(h(AutoReloadForm, { settings: { ...OFF, disabled_reason: 'card_declined' }, packs: PACKS })), /Auto-reload is off: your card was declined\./);
});

async function mount(settings, api) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let saved = 0;
  await act(async () => { root.render(h(AutoReloadForm, { settings, packs: PACKS, api, onSaved: () => { saved += 1; } })); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const change = (id, value, key = 'value') => act(async () => { props(by(id)).onChange({ target: { [key]: value } }); });
  const submit = () => act(async () => { props(by('auto-reload-form')).onSubmit({ preventDefault() {} }); await new Promise((r) => setTimeout(r, 0)); });
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return { by, change, submit, text, saved: () => saved, async unmount() { await act(async () => root.unmount()); restore(); } };
}

// 3 ───────────────────────────────────────────────────────────────────────────
test('Save sends the switch, the pack and the typed threshold; a refusal is said and nothing reloads', async () => {
  // Mutations checked: the threshold sent as typed text; onSaved not called; a refusal swallowed.
  const sent = [];
  const api = { saveAutoReload: async (body) => { sent.push(body); return {}; } };
  const m = await mount(ON, api);
  try {
    await m.change('auto-reload-pack', 'pack50');
    await m.change('auto-reload-threshold', '1.234');
    assert.match(m.text(m.by('auto-reload-threshold-error')), /from \$0 to \$500/);
    await m.submit();
    assert.deepEqual(sent, [], 'nothing sent with a threshold the Worker would refuse');
    await m.change('auto-reload-threshold', '12.50');
    assert.equal(m.by('auto-reload-threshold-error'), undefined);
    await m.submit();
    assert.deepEqual(sent, [{ enabled: true, pack_uid: 'pack50', threshold_usd: 12.5 }], 'no setup_intent_id: the saved card stays');
    assert.equal(m.saved(), 1);
    await m.change('auto-reload-enabled', false, 'checked');
    await m.submit();
    assert.deepEqual(sent[1], { enabled: false, pack_uid: 'pack50', threshold_usd: 12.5 });
  } finally { await m.unmount(); }
  const failing = await mount(ON, { saveAutoReload: async () => { throw Object.assign(new Error('Add a card before turning auto-reload on.'), { status: 400 }); } });
  try {
    await failing.submit();
    assert.equal(failing.saved(), 0);
    assert.match(failing.text(failing.by('account-outcome-error')), /Add a card before turning auto-reload on\./);
  } finally { await failing.unmount(); }
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('the three calls go to the Worker\'s routes, and Billing mounts the card beside the orders', () => {
  // Mutations checked: the card not mounted; a call pointed elsewhere.
  const src = readFileSync(new URL('../src/lib/api/aiBudget.js', import.meta.url), 'utf8');
  assert.match(src, /autoReload: \(\) => request\('\/ai-budget\/auto-reload'\)/);
  assert.match(src, /saveAutoReload: \(settings\) => request\('\/ai-budget\/auto-reload', \{ method: 'PUT', body: body\(settings\) \}\)/);
  assert.match(src, /autoReloadSetup: \(nonce\) => request\('\/ai-budget\/auto-reload\/setup', \{ method: 'POST', body: body\(\{ nonce \}\) \}\)/);
  const page = readFileSync(new URL('../src/pages/SettingsPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /<Orders \/>\n[^\n]*\n\s*<AutoReloadCard \/>/);
  const worker = readFileSync(new URL('../../cloudflare-worker/src/routes/ai_budget.ts', import.meta.url), 'utf8');
  for (const route of ["r.get('/auto-reload'", "r.put('/auto-reload'", "r.post('/auto-reload/setup'"]) assert.ok(worker.includes(route), route);
});
