/**
 * D6061 (#6061, Pitch Studio v2 build 7/9, PS-07): the investor-first Share page.
 *
 *   · "What [name] will receive" is built from the form's own state and the cards the link-content read
 *     answers for the chosen variant and "What is included": the same two inputs the link is made from.
 *   · The chosen investor's own links on this version say live until a day, withdrawn or expired, and
 *     the table behind "Investor links (n)" has a Status column for every investor.
 *   · The Walkthrough row reads HQ's switch and the takes as they are; Attach attaches them to the new link.
 *
 * Every investor, fund and card below is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_share_ps07_6061.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ShareDialog from '../src/pages/raise/pitch/ShareDialog.jsx';
import {
  DEFAULT_SHARE, TYPED, expiryDay, includedLine, linkStatusLine, linksButton, linksForInvestor, recipientName, recipientPreview, watermarkPreview,
} from '../src/pages/raise/pitch/shareModel.js';
import { WALK_ATTACHED, WALK_NONE, WALK_NOT_ATTACHED, walkthroughOption } from '../src/pages/raise/pitch/walkthroughModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const DECK = { id: 6, version: 3, title: '[Synthetic deck]', created_at: '2026-10-21 09:00:00' };
const NOW = Date.parse('2026-11-08T10:00:00Z');
const card = (text) => ({ title: 'Synthetic card', layout: 'title', blocks: [{ id: 'b1', kind: 'text', style: 'paragraph', grid: { c1: 1, c2: 12, r1: 1, r2: 2 }, text }] });
const ROW = (over = {}) => ({
  id: 11, investor: { label: '[Pat Partner]', fund: '[Fund A]', prospect_id: 7 }, version: { variant: null }, nda: { state: 'not_required' },
  expires_at: '2026-11-22 09:00:00', view_cap: { limit: null, used: 0 }, watermark: 'Prepared for [Pat Partner] · [Fund A]', status: 'live',
  withdrawn_at: null, time_per_slide: true, analytics: { views: 2, last_viewed_at: null, read_seconds: null }, ...over,
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the preview is the form: watermark, NDA step, what they can and cannot do, and when it stops opening', () => {
  const state = { ...DEFAULT_SHARE, investor: '7', viewLimit: '3' };
  const p = recipientPreview({ state, deck: DECK, investorName: '[Pat Partner] · [Fund A]', content: { slides: [card('a'), card('b')], version: 3 }, now: NOW });
  assert.equal(p.title, 'What [Pat Partner] will receive');
  assert.equal(p.header, '[Synthetic deck] · v3', 'the viewer\'s own header line');
  assert.equal(p.watermark, 'Prepared for [Pat Partner] · [Fund A]');
  assert.equal(p.gate, 'Accept the NDA to open this deck', 'the NDA step the viewer shows first');
  assert.equal(p.cards, '2 cards · appendix included · speaker notes hidden');
  assert.equal(p.limits, 'No download · Expires 22 Nov');
  assert.equal(p.summary, 'v3 · NDA first · no download');
  assert.equal(p.sees, 'v3 as saved 21 Oct · not your draft');
  assert.deepEqual(p.can, ['View the cards']);
  assert.deepEqual(p.cannot, ['Save as PDF', 'Open the link in another browser', 'See a card before accepting the NDA', 'Open it more than 3 times']);
  assert.equal(p.timing, 'Seconds per card are measured');

  const open = recipientPreview({
    state: { ...state, ndaRequired: false, allowDownload: true, allowForwarding: true, expires: null, viewLimit: '', timePerSlide: false, target: 'variant:v1' },
    deck: DECK, investorName: '[Pat Partner]', variantName: '[Climate funds]', content: null, walkthrough: true, now: NOW,
  });
  assert.equal(open.gate, null, 'no NDA, no NDA step');
  assert.deepEqual(open.can, ['View the cards', 'Save as PDF', 'Open the link in another browser', 'Watch your walkthrough']);
  assert.deepEqual(open.cannot, []);
  assert.equal(open.limits, 'Download on · Never expires');
  assert.equal(open.sees, 'The “[Climate funds]” variant of v3 as saved 21 Oct · not your draft');
  assert.equal(open.timing, 'Visit counts only');
  assert.equal(open.cards, 'Reading the cards… · appendix included · speaker notes hidden', 'never a count before the read answers');
});

test('the card count is the read\'s, never 0 for unread; a failed read says so', () => {
  assert.equal(includedLine(null, DEFAULT_SHARE.include), 'Reading the cards… · appendix included · speaker notes hidden');
  assert.equal(includedLine(null, DEFAULT_SHARE.include, true), 'Cards could not be read · appendix included · speaker notes hidden');
  assert.equal(includedLine({ slides: [card('a')] }, { sources: false, notes: true }), '1 card · appendix hidden · speaker notes included');
  assert.equal(includedLine({ slides: [] }, DEFAULT_SHARE.include), '0 cards · appendix included · speaker notes hidden', 'a read that answered none is a measured 0');
  assert.equal(expiryDay(null, NOW), null);
  assert.equal(expiryDay(7, NOW), '15 Nov');
  assert.equal(watermarkPreview('  '), null);
  assert.equal(recipientName('[Pat Partner] · [Fund A]'), '[Pat Partner]');
  assert.equal(linksButton(null), 'Investor links', 'no count before the read');
  assert.equal(linksButton(0), 'Investor links (0)');
});

test('revoke and expiry per investor: each link\'s state with its day, and the investor\'s own links found', () => {
  assert.equal(linkStatusLine(ROW()), 'Live until 2026-11-22');
  assert.equal(linkStatusLine(ROW({ expires_at: null })), 'Live · never expires');
  assert.equal(linkStatusLine(ROW({ status: 'withdrawn', withdrawn_at: '2026-11-02 10:00:00' })), 'Withdrawn 2026-11-02');
  assert.equal(linkStatusLine(ROW({ status: 'expired', expires_at: '2026-11-01 00:00:00' })), 'Expired 2026-11-01');
  assert.equal(linkStatusLine(ROW({ status: 'used_up' })), 'Used up: its view limit is reached');
  assert.equal(linkStatusLine({}), 'Not recorded');
  const rows = [ROW(), ROW({ id: 12, investor: { label: '[Ola Angel]', prospect_id: null } }), ROW({ id: 13, investor: { label: '[Other]', prospect_id: 8 } }), ROW({ id: 14, investor: { label: '[Someone else]', prospect_id: null } })];
  assert.deepEqual(linksForInvestor(rows, { investor: '7' }).map((r) => r.id), [11]);
  assert.deepEqual(linksForInvestor(rows, { investor: TYPED, label: ' [ola angel] ' }).map((r) => r.id), [12]);
  assert.deepEqual(linksForInvestor(rows, { investor: TYPED, label: '' }), []);
});

test('the walkthrough row reads its switch honestly: reading, unreadable, off, nothing recorded, ready', () => {
  assert.equal(walkthroughOption(null).kind, 'reading');
  assert.equal(walkthroughOption({ available: false, unreadable: true, reason: 'x' }).kind, 'unreadable');
  const off = walkthroughOption({ available: false, reason: 'Not switched on yet.' });
  assert.deepEqual([off.kind, off.line], ['off', 'Not switched on yet.']);
  assert.doesNotMatch(off.line, /Coming later/);
  assert.deepEqual(walkthroughOption({ available: true, value: { cards: [null, null], recorded: 0, links: [] } }), { kind: 'none', line: WALK_NONE, recorded: 0 });
  const ready = walkthroughOption({ available: true, value: { cards: [{ take: 1 }, { take: 2 }, null], links: [] } });
  assert.deepEqual([ready.kind, ready.recorded, ready.line], ['ready', 2, 'Attach your recorded pitch · 2 slides']);
});

/* ------------------------------------------------------------------ *
 * The page, mounted
 * ------------------------------------------------------------------ */

async function mount(handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder', name: '[Fay Founder]' }));
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const key = `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`;
    seen.push([key, typeof init.body === 'string' ? JSON.parse(init.body) : null]);
    return (handle[key] || (() => response({ ok: true })))(init);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(ShareDialog, { projectId: 5, deck: DECK, onClose() {} }))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen, has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    text: (id) => textOf(id ? byId(id) : document.body),
    // Create link waits for the check on the link's own content; under load that takes more turns.
    create: async () => {
      for (let i = 0; i < 200 && props(byId('pitch-share-create'))?.disabled; i += 1) await settle();
      assert.equal(props(byId('pitch-share-create'))?.disabled, false, 'Create link is ready');
      await act(async () => { await props(byId('pitch-share-create')).onClick({ preventDefault() {} }); }); await settle();
    },
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n).onClick({ preventDefault() {} }); }); await settle(); },
    toggle: async (id, checked) => { await act(async () => { props(byId(id)).onChange({ target: { checked, value: checked } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

const READS = (over = {}) => ({
  'GET /api/decks/6/investor-links': () => response({ links: [ROW(), ROW({ id: 12, status: 'withdrawn', withdrawn_at: '2026-11-02 10:00:00' }), ROW({ id: 13, investor: { label: '[Other]', prospect_id: 8 } })] }),
  'GET /api/cycles/raise/modules/pitch-deck/form-options': () => response({ prospects: [{ value: 7, label: '[Pat Partner] · [Fund A]' }, { value: 8, label: '[Other]' }] }),
  'GET /api/decks/6/variants': () => response({ variants: [] }),
  'GET /api/decks/6/approval': () => response({ pending: [], approvers: [] }),
  'GET /api/decks/6/recordings': () => response({ error: 'not_switched_on' }, 404),
  'POST /api/decks/6/preflight/link-cards': (init) => {
    const b = JSON.parse(init.body);
    // The link-content read: two cards with the Sources appendix, one without it.
    return response({ deck_id: 6, version: 3, theme: null, slides: b.include?.sources === false ? [card('Synthetic one')] : [card('Synthetic one'), card('Synthetic two')] });
  },
  'POST /api/cycles/raise/deck-links': () => response({ id: 21, share_path: '/share/deck/tok-new' }, 201),
  ...over,
});

test('PS-07: the preview follows the link-content read and the form, and the read is the one Create link would send', async () => {
  const v = await mount(READS());
  try {
    assert.ok(v.has('pitch-share-preview'));
    assert.equal(v.text('pitch-share-preview-cards'), '2 cards · appendix included · speaker notes hidden');
    assert.equal(v.text('pitch-share-included'), '2 cards · appendix included · speaker notes hidden');
    assert.equal(v.text('pitch-share-preview-watermark'), 'Prepared for [Pat Partner] · [Fund A]');
    assert.match(v.text('pitch-share-preview-gate'), /Accept the NDA to open this deck/);
    assert.match(v.text('pitch-share-preview-cannot'), /Save as PDF/);
    assert.match(v.text('pitch-share-create'), /Create link for \[Pat Partner\]/);

    await v.toggle('pitch-share-include-sources', false);
    assert.equal(v.text('pitch-share-preview-cards'), '1 card · appendix hidden · speaker notes hidden', 'the count is the read\'s for this combination');
    await v.toggle('pitch-share-nda', false);
    assert.equal(v.has('pitch-share-preview-gate'), false, 'no NDA, no NDA step in the preview');
    await v.toggle('pitch-share-download', true);
    assert.match(v.text('pitch-share-preview-can'), /Save as PDF/);
    assert.doesNotMatch(v.text('pitch-share-preview-cannot'), /Save as PDF/);

    await v.create();
    const reads = v.seen.filter(([k]) => k === 'POST /api/decks/6/preflight/link-cards').map(([, b]) => b);
    const write = v.seen.find(([k]) => k === 'POST /api/cycles/raise/deck-links')?.[1];
    assert.ok(write, 'the link was written');
    assert.deepEqual(reads.at(-1).include, write.include, 'the preview\'s cards were read for exactly what the link includes');
    assert.equal(write.nda_required, false);
    assert.equal(write.allow_download, true);
  } finally { await v.close(); }
});

test('PS-07: the investor\'s own links show live until a day or withdrawn; the table behind Investor links (n) has a Status column', async () => {
  const v = await mount(READS());
  try {
    assert.match(v.text('pitch-share-links-toggle'), /^Investor links \(3\)/);
    assert.equal(v.props('pitch-share-links-toggle')['aria-expanded'], false, 'one investor at a time: the table starts folded');
    assert.match(v.text('pitch-share-theirs-11'), /Live until 2026-11-22/);
    assert.match(v.text('pitch-share-theirs-12'), /Withdrawn 2026-11-02/);
    assert.equal(v.has('pitch-share-theirs-13'), false, 'another investor\'s link is not theirs');
    await v.click('pitch-share-theirs-manage');
    assert.equal(v.props('pitch-share-links-toggle')['aria-expanded'], true);
    assert.equal(v.text('investor-link-status-11'), 'Live until 2026-11-22');
    assert.equal(v.text('investor-link-status-12'), 'Withdrawn 2026-11-02');
    assert.equal(v.has('investor-link-withdraw-11'), true, 'a live link keeps Withdraw');
    assert.equal(v.has('investor-link-withdraw-12'), false);
  } finally { await v.close(); }
});

test('PS-07: walkthrough switched off says so, with nothing to attach; a read that fails offers Try again', async () => {
  const off = await mount(READS());
  try {
    assert.equal(off.props('pitch-share-walkthrough')['data-kind'], 'off');
    assert.match(off.text('pitch-share-walkthrough'), /Not switched on yet\./);
    assert.doesNotMatch(off.text('pitch-share-walkthrough'), /Coming later/);
    assert.equal(off.has('pitch-share-walkthrough-attach'), false);
  } finally { await off.close(); }
  let down = true;
  const bad = await mount(READS({
    'GET /api/decks/6/recordings': () => (down ? response({ error: 'boom' }, 500) : response({ cards: [null], recorded: 0, links: [] })),
  }));
  try {
    assert.equal(bad.props('pitch-share-walkthrough')['data-kind'], 'unreadable');
    assert.doesNotMatch(bad.text('pitch-share-walkthrough'), /Not switched on|Record/, 'a failed read is not "off" and not "nothing recorded"');
    down = false;
    await bad.click('pitch-share-walkthrough-retry');
    assert.equal(bad.props('pitch-share-walkthrough')['data-kind'], 'none');
    assert.ok(bad.has('pitch-share-walkthrough-record'), 'nothing recorded: Record ›');
  } finally { await bad.close(); }
});

test('PS-07: Attach the walkthrough attaches the takes to the new link, and says when it could not', async () => {
  const takes = { cards: [{ take: 1, uid: 'a' }, { take: 1, uid: 'b' }], recorded: 2, links: [] };
  const v = await mount(READS({ 'GET /api/decks/6/recordings': () => response(takes), 'PUT /api/decks/6/recordings/links/21': () => response({ links: [21] }) }));
  try {
    assert.equal(v.props('pitch-share-walkthrough')['data-kind'], 'ready');
    assert.equal(v.props('pitch-share-walkthrough-attach').checked, false, 'the founder chooses to attach');
    await v.toggle('pitch-share-walkthrough-attach', true);
    assert.match(v.text('pitch-share-preview-can'), /Watch your walkthrough/);
    await v.create();
    const put = v.seen.find(([k]) => k === 'PUT /api/decks/6/recordings/links/21');
    assert.ok(put, 'attached to the link just made');
    assert.deepEqual(put[1], { attach: true });
    assert.equal(v.text('pitch-share-walkthrough-result'), WALK_ATTACHED);
  } finally { await v.close(); }
  const no = await mount(READS({ 'GET /api/decks/6/recordings': () => response(takes), 'PUT /api/decks/6/recordings/links/21': () => response({ error: 'boom' }, 500) }));
  try {
    await no.create();
    assert.equal(no.has('pitch-share-walkthrough-result'), false, 'not chosen, not attached');
    assert.equal(no.seen.some(([k]) => k.startsWith('PUT /api/decks/6/recordings/links/')), false);
  } finally { await no.close(); }
  const fails = await mount(READS({
    'GET /api/decks/6/recordings': () => response(takes),
    'PUT /api/decks/6/recordings/links/21': () => response({ code: 'nothing_recorded', message: 'Record at least one card before attaching the walkthrough.' }, 409),
  }));
  try {
    await fails.toggle('pitch-share-walkthrough-attach', true);
    await fails.create();
    assert.ok(fails.has('pitch-share-made'), 'the link stands');
    assert.match(fails.text('pitch-share-walkthrough-result'), new RegExp(WALK_NOT_ATTACHED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(fails.text('pitch-share-walkthrough-result'), /Record at least one card before attaching the walkthrough\./, 'the Worker\'s own refusal, after the line that the link stands');
  } finally { await fails.close(); }
});
