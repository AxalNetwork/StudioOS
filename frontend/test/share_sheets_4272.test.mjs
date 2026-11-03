/**
 * #4272 (D4254 P4, the last two rows): the per-investor sheet's next steps (ps7s)
 * and the New link sheet's version or variant and its toggles (ps7n). Every
 * investor, fund and variant below is made up.
 *
 *   ps7s · a link whose investor is in Capital relationships offers Draft follow-up
 *          (Capital relationships' own draft dialog, a follow-up, on that prospect)
 *          and Open in Capital relationships (the prospect's record); a link whose
 *          investor was typed has both off, with the reason, never pointed at nobody.
 *   ps7n · "Version or variant" lists this version and this version's variants; a
 *          variant's link goes through POST /api/decks/:id/investor-links with
 *          variant_uid and no deck_id, this version's through the one link writer as
 *          before; the watermark row is on and fixed; a failed variants read still
 *          offers this version and says so.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/share_sheets_4272.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ViewerAnalyticsSheet from '../src/pages/raise/pitch/ViewerAnalyticsSheet.jsx';
import ShareDialog from '../src/pages/raise/pitch/ShareDialog.jsx';
import { NOT_IN_CAPREL, nextStepsOf } from '../src/pages/raise/pitch/slideAnalyticsModel.js';
import {
  DEFAULT_SHARE, THIS_VERSION, VARIANTS_UNREAD, WATERMARK_LINE, linkTargets, variantOf, whatShareDoes,
} from '../src/pages/raise/pitch/shareModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const DECK = { id: 6, version: 3, created_at: '2026-10-21 09:00:00' };
const ROW = (investor) => ({
  id: 11, investor, version: { variant: null }, nda: { state: 'not_required' }, expires_at: null, view_cap: { limit: null, used: 0 },
  watermark: null, status: 'live', withdrawn_at: null, time_per_slide: true, analytics: { views: 0, last_viewed_at: null, read_seconds: null },
});
const PICKED = { label: '[Pat Partner]', fund: '[Fund A]', prospect_id: 7 };
const TYPED_IN = { label: '[Someone typed]', fund: null, prospect_id: null };
const VARIANTS = [{ uid: 'var-climate', name: '[Climate funds]' }, { uid: 'var-fintech', name: '[Fintech angels]' }];

async function mount(element, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder', name: '[Fay Founder]' }));
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const key = `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`;
    seen.push([key, init.body ? JSON.parse(init.body) : null]);
    return (handle[key] || (() => response({ ok: true })))(init);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, element)));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen, text: () => textOf(document.body), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {}, button: 0 }); }); await settle(); },
    choose: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

const SHEET_READS = { 'GET /api/decks/6/investor-links/11/analytics': () => response({ deck_id: 6, link_id: 11, views: 0, cards: [], timeline: [], time_per_slide: true }) };

// ── ps7s ──────────────────────────────────────────────────────────────────────

test('ps7s rule: a picked investor has a record to draft from and open; a typed one has neither, with the reason', () => {
  assert.deepEqual(nextStepsOf(ROW(PICKED)), { ok: true, prospectId: 7, name: '[Pat Partner] · [Fund A]', href: '/raise/capital-relationships/7' });
  for (const investor of [TYPED_IN, { label: 'x', prospect_id: 0 }, { label: 'x', prospect_id: 'abc' }, null]) {
    assert.deepEqual(nextStepsOf(ROW(investor)), { ok: false, reason: NOT_IN_CAPREL }, JSON.stringify(investor));
  }
});

test('ps7s: Open in Capital relationships goes to the prospect\'s record; Draft follow-up opens the follow-up draft on that prospect', async () => {
  const v = await mount(h(ViewerAnalyticsSheet, { deck: DECK, row: ROW(PICKED), projectId: 5, onClose() {} }), SHEET_READS);
  try {
    const open = v.props('viewer-analytics-open-caprel');
    assert.equal(open.href ?? open.to, '/raise/capital-relationships/7');
    assert.ok(!v.has('viewer-analytics-next-reason'));
    assert.equal(v.props('viewer-analytics-draft').disabled, false);
    assert.ok(!v.has('caprel-draft-dialog'), 'nothing opens, nothing is drafted, until pressed');
    await v.click('viewer-analytics-draft');
    assert.ok(v.has('caprel-draft-dialog'), 'Capital relationships\' own draft dialog');
    assert.match(v.text(), /Draft a message · \[Pat Partner\] · \[Fund A\]/);
    assert.match(v.text(), /Nothing is sent/);
    assert.equal(v.seen.some(([k]) => k.includes('/capital-relationships/drafts')), false, 'opening the dialog runs nothing');
  } finally { await v.close(); }
});

test('ps7s: a typed-in investor has both actions off, with the reason; no project means no draft', async () => {
  const typed = await mount(h(ViewerAnalyticsSheet, { deck: DECK, row: ROW(TYPED_IN), projectId: 5, onClose() {} }), SHEET_READS);
  try {
    assert.equal(typed.props('viewer-analytics-open-caprel').disabled, true);
    assert.equal(typed.props('viewer-analytics-draft').disabled, true);
    assert.match(typed.text(), new RegExp(NOT_IN_CAPREL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally { await typed.close(); }
  const noProject = await mount(h(ViewerAnalyticsSheet, { deck: DECK, row: ROW(PICKED), onClose() {} }), SHEET_READS);
  try {
    assert.equal(noProject.props('viewer-analytics-draft').disabled, true, 'a draft needs the venture');
    assert.ok(noProject.props('viewer-analytics-open-caprel').href, 'the record still opens');
  } finally { await noProject.close(); }
});

// ── ps7n ──────────────────────────────────────────────────────────────────────

test('ps7n rules: this version first, then the variants; a variant names its uid; the sentence names it', () => {
  assert.equal(DEFAULT_SHARE.target, THIS_VERSION);
  assert.deepEqual(linkTargets(DECK, VARIANTS), [
    { value: 'version', label: 'v3 · this version' },
    { value: 'variant:var-climate', label: 'Variant · [Climate funds]' },
    { value: 'variant:var-fintech', label: 'Variant · [Fintech angels]' },
  ]);
  assert.deepEqual(linkTargets(DECK, [{ uid: '', name: 'no uid' }, null]), [{ value: 'version', label: 'v3 · this version' }], 'a variant with no uid is not offered');
  assert.equal(variantOf('variant:var-climate'), 'var-climate');
  assert.equal(variantOf(THIS_VERSION), null);
  assert.equal(variantOf(undefined), null);
  const state = { ...DEFAULT_SHARE, investor: '7', target: 'variant:var-climate' };
  assert.match(whatShareDoes(state, DECK, '[Pat Partner]', '[Climate funds]'), /^Creates one link to the “\[Climate funds\]” variant of v3 for \[Pat Partner\]\./);
  assert.match(whatShareDoes({ ...state, target: THIS_VERSION }, DECK, '[Pat Partner]'), /^Creates one link to v3 for \[Pat Partner\]\./);
});

const FORM_READS = (over = {}) => ({
  'GET /api/decks/6/investor-links': () => response({ links: [] }),
  'GET /api/cycles/raise/modules/pitch-deck/form-options': () => response({ prospects: [{ value: 7, label: '[Pat Partner]' }] }),
  'GET /api/decks/6/variants': () => response({ variants: VARIANTS }),
  'GET /api/decks/6/approval': () => response({ pending: [], approvers: [] }),
  'POST /api/decks/6/investor-links': () => response({ link: { id: 12 }, share_path: '/share/deck/tok-variant' }, 201),
  'POST /api/cycles/raise/deck-links': () => response({ id: 12, share_path: '/share/deck/tok-version' }, 201),
  ...over,
});

async function makeLink(v) {
  await v.click('pitch-share-create');
  if (v.has('pitch-share-anyway')) await v.click('pitch-share-anyway');
}

test('ps7n: a variant\'s link goes through the investor-links route with variant_uid; this version\'s through the one link writer', async () => {
  const v = await mount(h(ShareDialog, { projectId: 5, deck: DECK, onClose() {} }), FORM_READS());
  try {
    const options = v.props('pitch-share-target').children.map((o) => o.props.value);
    assert.deepEqual(options, ['version', 'variant:var-climate', 'variant:var-fintech']);
    assert.equal(v.props('pitch-share-target').value, 'version');
    await v.choose('pitch-share-target', 'variant:var-climate');
    assert.match(v.text(), /the “\[Climate funds\]” variant of v3/);
    await makeLink(v);
    const posts = v.seen.filter(([k]) => k.startsWith('POST'));
    assert.deepEqual(posts.map(([k]) => k), ['POST /api/decks/6/investor-links'], 'one write, to the variant route');
    const body = posts[0][1];
    assert.equal(body.variant_uid, 'var-climate');
    assert.equal('deck_id' in body, false, 'the route takes the deck from its path');
    assert.equal(body.prospect_id, 7);
    assert.ok(v.has('pitch-share-made'));
  } finally { await v.close(); }
  const plain = await mount(h(ShareDialog, { projectId: 5, deck: DECK, onClose() {} }), FORM_READS());
  try {
    await makeLink(plain);
    const posts = plain.seen.filter(([k]) => k.startsWith('POST'));
    assert.deepEqual(posts.map(([k]) => k), ['POST /api/cycles/raise/deck-links'], 'this version: the one link writer, as before');
    assert.equal('variant_uid' in posts[0][1], false);
  } finally { await plain.close(); }
});

test('ps7n: the watermark row is on and fixed; the other toggles are the founder\'s; a failed variants read still offers this version', async () => {
  const v = await mount(h(ShareDialog, { projectId: 5, deck: DECK, onClose() {} }), FORM_READS());
  try {
    const mark = v.props('pitch-share-watermark-toggle');
    assert.equal(mark.checked, true);
    assert.equal(mark.disabled, true, 'every link names its investor: never a choice');
    assert.match(v.text(), new RegExp(WATERMARK_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    for (const id of ['pitch-share-nda', 'pitch-share-download', 'pitch-share-forwarding', 'pitch-share-time-per-slide']) {
      assert.ok(v.has(id), id);
      assert.notEqual(v.props(id).disabled, true, `${id} is the founder's to set`);
    }
    assert.ok(v.has('pitch-share-limit') && v.has('pitch-share-expires-14'), 'view cap and expiry');
  } finally { await v.close(); }
  const failed = await mount(h(ShareDialog, { projectId: 5, deck: DECK, onClose() {} }), FORM_READS({ 'GET /api/decks/6/variants': () => response({ detail: 'down' }, 503) }));
  try {
    assert.deepEqual(failed.props('pitch-share-target').children.map((o) => o.props.value), ['version']);
    assert.match(failed.text(), new RegExp(VARIANTS_UNREAD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally { await failed.close(); }
});
