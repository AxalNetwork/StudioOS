// D4598 (#4598) part 2 — Share checks the link's own EFFECTIVE content: the picked
// variant together with "What is included" (`POST /api/decks/:id/preflight/link-cards`),
// not the saved version as a whole. Picking another variant, or flipping an include
// toggle, is a new combination: the earlier result (and any "Send anyway") no longer
// counts, and the check runs again before Create link — which stays disabled until that
// check is clean, or its warnings are confirmed through "Send anyway" (`useSendCheck`,
// the same hook and the same confirm flow `ExportDialog.jsx`'s own check uses).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_share_preflight_4598.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { cyclesWrite } from '../src/lib/api/cycles.js';
import { deckCommentsApi } from '../src/lib/api/deckComments.js';
import { deckCardStatusApi } from '../src/lib/api/deckCardStatus.js';
import { deckInvestorLinksApi } from '../src/lib/api/deckInvestorLinks.js';
import { deckPreflightApi } from '../src/lib/api/deckPreflight.js';
import ShareDialog from '../src/pages/raise/pitch/ShareDialog.jsx';

const h = React.createElement;
const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
const card = (text) => ({ title: 'Synthetic card', layout: 'title', blocks: [{ id: 'b1', kind: 'text', style: 'paragraph', grid: g(1, 12, 1, 2), text }] });
/** A bracketed sample is a "worth a look" warning, never a fix: Send anyway applies. */
const CLEAN = { slides: [card('Our synthetic logo is here')], theme: null, version: 5 };
const SAMPLE = { slides: [card('Add [Your logo] here')], theme: null, version: 5 };
const DECK = { id: 50, version: 5, created_at: '2026-10-21 09:00:00' };
const VARIANTS = [{ uid: 'var-a', name: 'Fund A', slide_order: [0] }, { uid: 'var-b', name: 'Fund B', slide_order: [0] }];

const ORIGINAL = {
  formOptions: cyclesWrite.formOptions, deckLink: cyclesWrite.raise.deckLink, approval: deckCommentsApi.approval,
  cardStatusRead: deckCardStatusApi.read, deckVariants: deckInvestorLinksApi.deckVariants, createInvestorLink: deckInvestorLinksApi.createInvestorLink,
  linkCards: deckPreflightApi.linkCards,
};

/** `linkCardsFor({ variantUid, include })` answers each combination the dialog checks. */
async function mountDialog({ linkCardsFor, createInvestorLink, deckLink } = {}) {
  const calls = [];
  cyclesWrite.formOptions = async (...a) => { calls.push(['formOptions', ...a]); return { prospects: [{ value: 5, label: 'Fund A' }] }; };
  cyclesWrite.raise.deckLink = async (...a) => { calls.push(['deckLink', ...a]); return (deckLink || (async () => ({ id: 1, share_path: '/share/deck/tok.a' })))(...a); };
  deckCommentsApi.approval = async (...a) => { calls.push(['approval', ...a]); return { pending: [], message: null }; };
  deckCardStatusApi.read = async (...a) => { calls.push(['cardStatus', ...a]); return { tracked: false, not_done: { count: 0, cards: [] } }; };
  deckInvestorLinksApi.deckVariants = async (...a) => { calls.push(['deckVariants', ...a]); return { variants: VARIANTS }; };
  deckInvestorLinksApi.createInvestorLink = async (...a) => { calls.push(['createInvestorLink', ...a]); return (createInvestorLink || (async () => ({ id: 2, share_path: '/share/deck/tok.b' })))(...a); };
  deckPreflightApi.linkCards = async (id, body) => { calls.push(['linkCards', id, body]); return linkCardsFor(body); };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const created = [];
  await act(async () => { root.render(h(ShareDialog, { projectId: 7, deck: DECK, onClose() {}, onCreated: (r) => created.push(r) })); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, created, by, pr, settle,
    text: (n = container) => text(n).replace(/\s+/g, ' '),
    async change(id, value) { await act(async () => { pr(by(id)).onChange?.({ target: { value, checked: value } }); }); await settle(); },
    async press(id) { await act(async () => { await pr(by(id)).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() {
      await act(async () => root.unmount()); restore();
      cyclesWrite.formOptions = ORIGINAL.formOptions; cyclesWrite.raise.deckLink = ORIGINAL.deckLink;
      deckCommentsApi.approval = ORIGINAL.approval; deckCardStatusApi.read = ORIGINAL.cardStatusRead;
      deckInvestorLinksApi.deckVariants = ORIGINAL.deckVariants; deckInvestorLinksApi.createInvestorLink = ORIGINAL.createInvestorLink;
      deckPreflightApi.linkCards = ORIGINAL.linkCards;
    },
  };
}

test('Create link stays blocked on the picked variant\'s own warning, until Send anyway confirms it; a different variant is a new combination', async () => {
  const m = await mountDialog({ linkCardsFor: async ({ variantUid }) => (variantUid === 'var-a' ? SAMPLE : CLEAN) });
  try {
    await m.change('pitch-share-target', 'variant:var-a');
    const check = m.by('pitch-share-gate-check');
    assert.ok(check, 'var-a\'s own content has the sample');
    assert.match(m.text(check), /\[Your logo\]/);
    assert.equal(m.pr(m.by('pitch-share-create')).disabled, true, 'blocked: not yet confirmed at this check');
    await m.press('pitch-share-gate-check-anyway');
    assert.ok(m.by('pitch-share-confirmed'));
    assert.equal(m.pr(m.by('pitch-share-create')).disabled, false);

    // A different variant is a new combination: the confirmation does not carry over, and
    // its own (clean) content is read and checked fresh, not just inherited.
    await m.change('pitch-share-target', 'variant:var-b');
    assert.equal(m.by('pitch-share-confirmed'), undefined, 'var-a\'s confirmation was not var-b\'s');
    assert.equal(m.by('pitch-share-gate-check'), undefined, 'var-b is clean on its own content');
    assert.equal(m.pr(m.by('pitch-share-create')).disabled, false);
    await m.press('pitch-share-create');
    assert.ok(m.by('pitch-share-made'));
    const writes = m.calls.filter(([n]) => n === 'createInvestorLink');
    assert.equal(writes.length, 1);
    assert.equal(writes[0][2].variant_uid, 'var-b', 'the link made is of the variant that was actually checked clean, not var-a');
  } finally { await m.unmount(); }
});

test('flipping "What is included" is also a new combination: the check runs again on it', async () => {
  const m = await mountDialog({ linkCardsFor: async ({ include }) => (include?.sources === false ? SAMPLE : CLEAN) });
  try {
    assert.equal(m.by('pitch-share-gate-check'), undefined, 'the Sources appendix is included by default: clean');
    assert.equal(m.pr(m.by('pitch-share-create')).disabled, false);
    await m.change('pitch-share-include-sources', false);
    const check = m.by('pitch-share-gate-check');
    assert.ok(check, 'excluding the Sources appendix is a different combination, and it has the sample');
    assert.equal(m.pr(m.by('pitch-share-create')).disabled, true);
    // Switching it back on is, again, a fresh combination — the clean one.
    await m.change('pitch-share-include-sources', true);
    assert.equal(m.by('pitch-share-gate-check'), undefined);
    assert.equal(m.pr(m.by('pitch-share-create')).disabled, false);
  } finally { await m.unmount(); }
});

test('a link content read that fails blocks Create link, with a Try again, never a silent pass', async () => {
  let fail = true;
  const m = await mountDialog({ linkCardsFor: async () => { if (fail) throw new Error('offline'); return CLEAN; } });
  try {
    assert.ok(m.by('pitch-share-content-failed'));
    assert.equal(m.pr(m.by('pitch-share-create')).disabled, true);
    fail = false;
    await m.press('pitch-share-content-retry');
    assert.equal(m.by('pitch-share-content-failed'), undefined);
    assert.equal(m.pr(m.by('pitch-share-create')).disabled, false);
  } finally { await m.unmount(); }
});
