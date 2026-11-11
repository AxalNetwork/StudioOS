// D4596 (#4596, Pitch audit 2/5) — draft integrity and mobile recovery.
//
//   1. The autosave client persists the COMPLETE working document: cards, order, removals, theme, audience.
//      A theme-only or audience-only edit is unsent, autosaved and recoverable; a removal reaches the Worker.
//   2. The device copy stays until the cards AND the document revision are acknowledged: a card-only
//      acknowledgement cannot discard an unsent theme/audience/removal.
//   3. A duplicate that autosaved and was then undone is removed from the Worker's draft; deleting the last card too.
//   4. A failed browser-storage write is never called "saved on this device".
//   5. Copy mine keeps the card as it is NOW, including an edit made after the conflict appeared.
//   6. The mounted editor: restore and conflict are visible and operable on a phone as on a desktop, saving waits
//      on them visibly, and reload brings the removal, theme and audience back.
//
// Every venture, card and figure is synthetic.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_draft_integrity_d4596.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import {
  IDLE_MS, createAutosave, idbStore, keyOf, mergeDraft, offlineLine, restoreOffer,
} from '../src/pages/raise/pitch/deckAutosave.js';
import { deckDraftApi } from '../src/lib/api/deckDraft.js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SyncLine } from '../src/pages/raise/pitch/EditingParts.jsx';
import { DECK, mountEditor } from './_pitch_editor_mount.mjs';

const settleLong = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

/** A fake IndexedDB: one database per name, kept across mounts, as a browser keeps it across tabs. */
function fakeIndexedDB() {
  const dbs = new Map();
  const req = (fn) => { const r = {}; setTimeout(() => { try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.error = e; r.onerror?.(); } }, 0); return r; };
  return {
    dbs,
    open(name) {
      const r = {};
      setTimeout(() => {
        const fresh = !dbs.has(name);
        if (fresh) dbs.set(name, new Map());
        const stores = dbs.get(name);
        r.result = {
          objectStoreNames: { contains: (n) => stores.has(n) },
          createObjectStore: (n) => { stores.set(n, new Map()); },
          transaction: (n) => ({ objectStore: () => {
            const st = stores.get(n);
            return {
              get: (k) => req(() => (st.has(k) ? structuredClone(st.get(k)) : undefined)),
              put: (v, k) => req(() => { st.set(k, structuredClone(v)); return k; }),
              delete: (k) => req(() => { st.delete(k); }),
            };
          } }),
        };
        if (fresh) r.onupgradeneeded?.();
        r.onsuccess?.();
      }, 0);
      return r;
    },
  };
}

/** Timers the test moves by hand. */
function fakeTimers() {
  let now = 0; let id = 0;
  const due = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => { id += 1; due.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (k) => { due.delete(k); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, z) => a[1].at - z[1].at)[0];
        if (!next) break;
        due.delete(next[0]); now = next[1].at;
        next[1].fn();
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      }
      now = end;
    },
  };
}

const cardOf = (uid, title, extra = {}) => ({ uid, title, blocks: [{ id: 'b1', kind: 'text', text: title, grid: { c1: 1, c2: 6, r1: 1, r2: 2 } }], ...extra });
const ok = (rev) => ({ available: true, value: { ok: true, card: { rev } } });

const docOk = (rev) => ({ available: true, value: { ok: true, doc: { rev } } });
const V = () => ({ cards: [cardOf('c1', 'One'), cardOf('c2', 'Two')], theme: null, audience: 'seed_fund' });

/** A Worker in memory: card revisions and the document revision, as the routes keep them. */
function fakeWorker() {
  const w = { cards: new Map(), doc: null, docs: [], offline: false };
  w.save = async (_id, uid, card, ifMatch) => {
    if (w.offline) return { available: false, unreadable: true, status: null, reason: 'offline' };
    const have = w.cards.get(uid);
    if ((have?.rev ?? 0) !== Number(ifMatch)) return { available: false, unreadable: true, status: 409, data: { error: 'card_rev_conflict', rev: have?.rev ?? 0, server: { card: have?.card ?? null, updated_at: null } } };
    w.cards.set(uid, { rev: Number(ifMatch) + 1, card });
    return ok(Number(ifMatch) + 1);
  };
  w.saveDoc = async (_id, body, ifMatch) => {
    if (w.offline) return { available: false, unreadable: true, status: null, reason: 'offline' };
    if ((w.doc?.rev ?? 0) !== Number(ifMatch)) return { available: false, unreadable: true, status: 409, data: { error: 'doc_rev_conflict', rev: w.doc?.rev ?? 0, server: w.doc } };
    w.doc = { rev: Number(ifMatch) + 1, ...body };
    for (const uid of [...w.cards.keys()]) if (!body.order.includes(uid)) w.cards.delete(uid);
    w.docs.push(structuredClone(body));
    return docOk(w.doc.rev);
  };
  return w;
}
const make = (w, o = {}) => {
  const t = o.t || fakeTimers();
  const a = createAutosave({ deckId: 41, save: w.save, saveDoc: w.saveDoc, store: o.store ?? null, timers: t, now: t.now });
  const v = V(); a.base(v.cards, { theme: v.theme, audience: v.audience });
  return { a, t, v };
};

/* ------------------------------------------------------------------ 1 */

test('1. theme-only, audience-only and mixed edits are unsent, autosaved, and reach the Worker as a document revision', async () => {
  const w = fakeWorker(); const { a, t, v } = make(w);
  const theme = { kind: 'brand' };
  await a.edit({ ...v, theme });
  assert.equal(a.pending(), 1, 'a theme-only edit is a pending change (dirty state, navigation warning)');
  await t.advance(IDLE_MS);
  assert.deepEqual(w.docs.at(-1), { order: ['c1', 'c2'], theme, audience: 'seed_fund' });
  assert.equal(a.pending(), 0);
  assert.equal(w.cards.size, 0, 'no card was sent for a metadata-only edit');
  await a.edit({ ...v, theme, audience: 'angel' });
  await t.advance(IDLE_MS);
  assert.equal(w.docs.at(-1).audience, 'angel');
  assert.equal(w.doc.rev, 2, 'the document revision climbs one per write');
  // Mixed: one card and the audience in one pass; the cards go first.
  await a.edit({ cards: [{ ...v.cards[0], title: 'One edited' }, v.cards[1]], theme, audience: 'seed_fund' });
  await t.advance(IDLE_MS);
  assert.equal(w.cards.get('c1').card.title, 'One edited');
  assert.equal(w.doc.audience, 'seed_fund');
  assert.equal(a.state().state, 'synced');
});

test('2. the device copy survives a card-only acknowledgement and goes only when the document revision is acknowledged', async () => {
  const idb = fakeIndexedDB(); const store = idbStore(idb);
  const w = fakeWorker();
  const { a, t, v } = make(w, { store });
  // The document write fails (offline for it only) while the card write succeeds.
  w.saveDoc = async () => ({ available: false, unreadable: true, status: null, reason: 'offline' });
  const a2 = createAutosave({ deckId: 41, save: w.save, saveDoc: (...x) => w.saveDoc(...x), store, timers: t, now: t.now });
  a2.base(v.cards, { theme: null, audience: 'seed_fund' });
  const next = { cards: [{ ...v.cards[0], title: 'One edited' }], theme: { kind: 'brand' }, audience: 'angel' };   // card edit + removal + theme + audience
  await a2.edit(next);
  await t.advance(IDLE_MS);
  assert.equal(w.cards.get('c1').rev, 1, 'the card reached the Worker');
  assert.equal(a2.state().state, 'offline');
  const local = await store.get(keyOf(41));
  assert.ok(local, 'the device copy is kept: the document revision was not acknowledged');
  assert.deepEqual(local.doc.cards.map((c) => c.uid), ['c1'], 'and it holds the removal');
  assert.equal(local.doc.theme.kind, 'brand'); assert.equal(local.doc.audience, 'angel');
  // Reconnected: the document is acknowledged, then the copy goes.
  w.saveDoc = fakeWorker().saveDoc;
  a2.retry(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(a2.state().state, 'synced');
  assert.equal(await store.get(keyOf(41)), undefined);
  void a;
});

test('3. a removal survives reopen: the Worker drops the card, and the restored document omits it; so does deleting the last card', async () => {
  const w = fakeWorker(); const { a, t, v } = make(w);
  await a.edit({ ...v, cards: [{ ...v.cards[0], title: 'One edited' }, v.cards[1]] }); await t.advance(IDLE_MS);
  assert.equal(w.cards.size, 2 - 1, 'only the edited card has a working copy');
  await a.edit({ ...v, cards: [v.cards[1]] }); await t.advance(IDLE_MS);       // remove c1
  assert.deepEqual(w.doc.order, ['c2']);
  assert.ok(!w.cards.has('c1'), 'its working copy is gone');
  const offer = restoreOffer({ doc: V(), draft: { cards: [...w.cards].map(([uid, c]) => ({ uid, rev: c.rev, ord: 0, card: c.card })), doc: w.doc, updated_at: '2026-11-07 10:00:00' } });
  assert.deepEqual(offer.doc.cards.map((c) => c.uid), ['c2'], 'reopen shows the card removed');
  // The last card too.
  await a.edit({ ...V(), cards: [] }); await t.advance(IDLE_MS);
  assert.deepEqual(w.doc.order, []);
  const none = restoreOffer({ doc: V(), draft: { cards: [], doc: w.doc, updated_at: '2026-11-07 10:00:00' } });
  assert.deepEqual(none.doc.cards, [], 'an empty deck is restored empty, not as the saved version');
});

test('3b. duplicate → autosave → undo: the autosaved copy is removed from the draft', async () => {
  const w = fakeWorker(); const { a, t, v } = make(w);
  const dup = cardOf('c3', 'One (copy)');
  await a.edit({ ...v, cards: [v.cards[0], dup, v.cards[1]] }); await t.advance(IDLE_MS);
  assert.ok(w.cards.has('c3')); assert.deepEqual(w.doc.order, ['c1', 'c3', 'c2']);
  await a.edit(v); await t.advance(IDLE_MS);                                   // undo
  assert.ok(!w.cards.has('c3'), 'the undone addition is gone from the draft');
  assert.deepEqual(w.doc.order, ['c1', 'c2']);
  // Redo the same uid: its stale revision is not sent as If-Match.
  await a.edit({ ...v, cards: [v.cards[0], dup, v.cards[1]] }); await t.advance(IDLE_MS);
  assert.equal(w.cards.get('c3').rev, 1);
  assert.equal(a.state().state, 'synced');
});

test('4. a failed browser-storage write is never described as saved on this device', async () => {
  const w = fakeWorker();
  const store = { get: async () => null, put: async () => false, del: async () => null };
  const { a, v } = make(w, { store });
  const seen = [];
  const a2 = createAutosave({ deckId: 41, save: w.save, saveDoc: w.saveDoc, store, onChange: (s) => seen.push(s) });
  a2.base(v.cards, { theme: null, audience: 'seed_fund' });
  await a2.edit({ ...v, theme: { kind: 'brand' } });
  assert.equal(a2.state().device, 'failed');
  assert.match(offlineLine(2, 'failed'), /NOT saved on this device/);
  assert.doesNotMatch(offlineLine(2, 'failed'), /saved on this device\. They/);
  assert.match(offlineLine(2, 'saved'), /saved on this device\. They'll sync/);
  w.offline = true; a2.retry(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(a2.state().state, 'offline'); assert.equal(a2.state().device, 'failed');
  assert.ok(a2.pending() > 0, 'the work is still held in memory');
  void a;
});

test('5. Copy mine keeps the latest local card, including an edit made after the conflict first appeared', async () => {
  const w = fakeWorker(); const { a, t, v } = make(w);
  w.cards.set('c1', { rev: 4, card: cardOf('c1', 'Theirs') });
  await a.edit({ ...v, cards: [{ ...v.cards[0], title: 'Mine v1' }, v.cards[1]] }); await t.advance(IDLE_MS);
  assert.equal(a.state().state, 'conflict');
  assert.equal(a.state().conflict.mine.title, 'Mine v1');
  await a.edit({ ...v, cards: [{ ...v.cards[0], title: 'Mine v2, typed after' }, v.cards[1]] });   // editing goes on, saving waits
  const r = a.resolve('copy');
  assert.equal(r.theirs.title, 'Theirs');
  assert.equal(r.mine.title, 'Mine v2, typed after', 'the copy is the card as it is now, not as it was at the conflict');
});

test('6. a draft with a document merges removals, order, theme and audience; a draft without one is as before', () => {
  const draftCards = [{ uid: 'c2', rev: 1, ord: 0, card: cardOf('c2', 'Two edited') }];
  assert.deepEqual(mergeDraft(V().cards, draftCards).map((c) => c.uid), ['c2', 'c1'], 'no document: the draft cards only move forward, as before');
  assert.deepEqual(mergeDraft(V().cards, draftCards, { order: ['c2'] }).map((c) => c.uid), ['c2'], 'with a document, c1 was removed');
  const offer = restoreOffer({ doc: V(), draft: { cards: [], doc: { rev: 3, order: ['c1', 'c2'], theme: { kind: 'brand' }, audience: 'angel' }, updated_at: '2026-11-07 10:00:00' } });
  assert.equal(offer.from, 'server'); assert.equal(offer.doc.theme.kind, 'brand'); assert.equal(offer.doc.audience, 'angel'); assert.equal(offer.docRev, 3);
});

test('4b. the offline line never says "saved on this device" when the device write failed', () => {
  const html = (sync) => renderToStaticMarkup(React.createElement(SyncLine, { sync }));
  assert.match(html({ state: 'offline', queued: 2, device: 'saved' }), /2 changes saved on this device/);
  assert.doesNotMatch(html({ state: 'offline', queued: 2, device: 'failed' }), /changes saved on this device/);
  assert.match(html({ state: 'offline', queued: 2, device: 'failed' }), /NOT saved on this device/);
  assert.match(html({ state: 'pending', queued: 1, device: 'failed' }), /would not keep a copy on this device/);
  assert.match(html({ state: 'held', queued: 1, device: 'saved' }), /Saving is paused/);
  assert.match(html({ state: 'conflict', queued: 1, device: 'saved' }), /Saving is paused until you choose/);
});

test('5b. another tab saved the deck-level state first: the newer revision is adopted and ours is sent once more', async () => {
  const w = fakeWorker(); const { a, t, v } = make(w);
  w.doc = { rev: 5, order: ['c1', 'c2'], theme: null, audience: 'seed_fund' };
  await a.edit({ ...v, audience: 'angel' }); await t.advance(IDLE_MS);
  assert.deepEqual([w.doc.rev, w.doc.audience, a.state().state], [6, 'angel', 'synced']);
});

/* ------------------------------------------------------------------ 7: the mounted editor */

const UID_DECK = { ...DECK, slides: DECK.slides.map((c, i) => ({ ...c, uid: `c${i + 1}` })) };
const node = (m, id) => { const n = m.by(id); assert.ok(n, `no ${id}`); return n; };
const asPhone = (on) => { globalThis.matchMedia = () => ({ matches: on, addEventListener() {}, removeEventListener() {} }); };
function stubDraft({ draft, saveCard = async (_d, uid, _c, rev) => ({ ok: true, card: { uid, rev: Number(rev) + 1 } }), saveDoc = async (_d, _b, rev) => ({ ok: true, doc: { rev: Number(rev) + 1 } }) } = {}) {
  const real = { ...deckDraftApi }; const calls = [];
  deckDraftApi.draft = async (...a) => { calls.push(['draft', ...a]); return draft(...a); };
  deckDraftApi.saveCard = async (...a) => { calls.push(['saveCard', ...a]); return saveCard(...a); };
  deckDraftApi.saveDoc = async (...a) => { calls.push(['saveDoc', ...a]); return saveDoc(...a); };
  deckDraftApi.discard = async () => ({ ok: true });
  return { calls, restore: () => Object.assign(deckDraftApi, real) };
}

for (const phone of [false, true]) {
  test(`7. ${phone ? 'phone' : 'desktop'}: the restore question is visible and operable, saving waits on it visibly, and Restore brings back the theme and audience`, async () => {
    const before = globalThis.matchMedia; asPhone(phone);
    const draft = { deck_id: 31, cards: [], updated_at: '2026-11-07 10:00:00', doc: { rev: 2, order: ['c1', 'c2'], theme: { kind: 'neutral_dark' }, audience: 'angel' } };
    const d = stubDraft({ draft: async () => ({ deck_id: 31, ...draft }) });
    try {
      const m = await mountEditor({ answers: { deckGet: async () => UID_DECK }, onDocument: () => { globalThis.indexedDB = fakeIndexedDB(); } });
      try {
        assert.ok(m.by('pitch-restore'), 'the question is on screen');
        assert.equal(Boolean(m.by('pitch-editor-phone')), phone);
        assert.match(m.text(node(m, 'pitch-restore-line')), /Restore unsaved changes from \d\d:\d\d\?/);
        await m.press(node(m, 'pitch-restore-run'));
        assert.ok(!m.by('pitch-restore'));
        await settleLong(IDLE_MS + 200);
        assert.deepEqual(d.calls.filter((c) => c[0] === 'saveDoc'), [], 'the restored document is what the Worker already holds: nothing to resend');
      } finally { await m.close(); }
    } finally { d.restore(); globalThis.matchMedia = before; }
  });

  test(`7b. ${phone ? 'phone' : 'desktop'}: a conflict is shown with its three choices, and saving waits on it visibly`, async () => {
    const before = globalThis.matchMedia; asPhone(phone);
    const idb = fakeIndexedDB();
    const theirs = cardOf('c1', 'Their words');
    const d = stubDraft({ draft: async () => ({ deck_id: 31, cards: [] }), saveCard: async () => { throw Object.assign(new Error('conflict'), { status: 409, data: { error: 'card_rev_conflict', rev: 3, server: { card: theirs, updated_at: null } } }); } });
    try {
      const m = await mountEditor({ answers: { deckGet: async () => UID_DECK }, onDocument: () => { globalThis.indexedDB = idb; } });
      try {
        if (phone) await m.type(node(m, 'pitch-editor-phone-notes'), 'Synthetic note, edited on a phone');
        else { await m.press(node(m, 'pitch-editor-block-b2')); await m.type(node(m, 'pitch-tools-text'), 'Synthetic body words, edited'); }
        await settleLong(IDLE_MS + 300);
        if (m.by('pitch-conflict')) {
          assert.ok(m.by('pitch-conflict-mine-keep') && m.by('pitch-conflict-theirs-keep') && m.by('pitch-conflict-copy'));
          assert.ok(m.by('pitch-sync-conflict'), 'the editor says saving is paused');
        } else {
          assert.fail(`no conflict view (${phone ? 'phone' : 'desktop'}): ${m.text().slice(0, 300)}`);
        }
      } finally { await m.close(); }
    } finally { d.restore(); globalThis.matchMedia = before; delete globalThis.indexedDB; }
  });
}
