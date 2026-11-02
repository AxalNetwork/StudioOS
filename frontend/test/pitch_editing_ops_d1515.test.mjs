// D1515 (#3767, deck v2 A4c) — editing operations in the Pitch deck editor:
//
//   1. rich text: B · I · Accent · Link on D1500's runs, typing keeps the
//      marks, and the Worker's limits are refused before anything changes;
//   2. the autosave client: 1.5 s after the last edit and never more than
//      10 s while typing goes on, If-Match the revision last seen, offline
//      then "Synced", and a 409 with Keep mine / Keep theirs;
//   3. killing the tab after 3 edits and reopening restores them (a fake
//      IndexedDB, kept across the two mounts), and the replay sends each card
//      with the revision it was edited from;
//   4. the mounted editor: Undo and Redo in the header and on Cmd/Ctrl+Z,
//      "Still charged" after undoing an accepted run, find and replace from
//      ⋯ that skips bound values, the B button, Discard, and the conflict view.
//
// Every venture, card and figure is synthetic.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_editing_ops_d1515.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { charsOf, contrastRatio, marksAt, retext, setMark, toggleMark } from '../src/pages/raise/pitch/richText.js';
import {
  IDLE_MS, MAX_WAIT_MS, clockOf, createAutosave, idbStore, keyOf, mergeDraft, offlineLine, restoreLine, restoreOffer,
} from '../src/pages/raise/pitch/deckAutosave.js';
import { STILL_CHARGED, saveChip } from '../src/pages/raise/pitch/deckV2Model.js';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import * as gridOps from '../src/pages/raise/pitch/gridOps.js';
import { deckDraftApi } from '../src/lib/api/deckDraft.js';
import { CARD, DECK, mountEditor } from './_pitch_editor_mount.mjs';

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

/* ------------------------------------------------------------------ 1 */

test('1. rich text: B and I toggle on a range, typing keeps the marks, a plain block stays plain', () => {
  const block = { id: 'b1', kind: 'text', text: 'Synthetic growth story' };
  const bold = toggleMark(block, 0, 9, 'b').block;
  assert.deepEqual(bold.paras, [{ runs: [{ text: 'Synthetic', b: true }, { text: ' growth story' }] }]);
  assert.equal(bold.text, 'Synthetic growth story', 'the plain copy the Worker rebuilds is the same words');
  assert.deepEqual(marksAt(bold, 0, 9), { b: true });
  assert.deepEqual(marksAt(bold, 0, 12), {}, 'a range only partly bold is not bold');
  const both = toggleMark(bold, 10, 16, 'i').block;
  assert.deepEqual(both.paras[0].runs.map((r) => [r.text, Boolean(r.b), Boolean(r.i)]), [['Synthetic', true, false], [' ', false, false], ['growth', false, true], [' story', false, false]]);
  // Typing inside the bold word keeps it bold; typing after it takes its marks, like a word processor.
  const typed = retext(both, 'Synthetics growth story');
  assert.equal(typed.paras[0].runs[0].text, 'Synthetics');
  assert.equal(typed.text, 'Synthetics growth story');
  // A second line is a second paragraph.
  assert.equal(retext(typed, 'Synthetics growth story\nNext').paras.length, 2);
  // Off again: no mark left, so the block is plain again (no `paras`).
  const off = toggleMark(toggleMark(bold, 0, 9, 'b').block, 0, 0, 'b');
  assert.equal(toggleMark(bold, 0, 9, 'b').block.paras, undefined);
  assert.ok(off.block.paras, 'an empty range marks the whole block');
  assert.equal(retext(block, 'Plain words').paras, undefined, 'typing never adds runs to a plain block');
  assert.deepEqual(charsOf({ text: 'ab' }).map((c) => c.ch), ['a', 'b']);
});

test('1. rich text: the accent must read on the card and at most 3 accent runs; a link is https', () => {
  const block = { id: 'b1', kind: 'text', text: 'one two three four five' };
  assert.ok(contrastRatio('#6d28d9', '#ffffff') >= 4.5);
  const pale = setMark(block, 0, 3, 'accent', '#fde68a');
  assert.match(pale.error, /does not read against the card \(contrast under 4\.5:1\)\. Nothing changed\./);
  const onDark = setMark(block, 0, 3, 'accent', '#fde68a', { ground: '#111827' });
  assert.equal(onDark.block.paras[0].runs[0].accent, '#fde68a', 'on a dark card background the pale accent reads');
  let b = block;
  for (const [s, e] of [[0, 3], [4, 7], [8, 13]]) b = setMark(b, s, e, 'accent', '#6d28d9').block;
  assert.equal(b.paras[0].runs.filter((r) => r.accent).length, 3);
  assert.match(setMark(b, 14, 18, 'accent', '#6d28d9').error, /at most 3 accent runs/);
  assert.match(setMark(block, 0, 3, 'href', 'http://example.com').error, /https:\/\//);
  assert.match(setMark(block, 0, 3, 'href', 'javascript:alert(1)').error, /https:\/\//);
  const linked = setMark(block, 4, 7, 'href', 'https://example.com/deck').block;
  assert.deepEqual(linked.paras[0].runs[1], { text: 'two', href: 'https://example.com/deck' });
  assert.equal(setMark(linked, 4, 7, 'href', undefined).block.paras, undefined, 'Remove link: plain again');
});

/* ------------------------------------------------------------------ 2 */

test('2. autosave: 1.5 s after the last edit, never more than 10 s while typing goes on, If-Match the last revision', async () => {
  assert.equal(IDLE_MS, 1500);
  assert.equal(MAX_WAIT_MS, 10000);
  const t = fakeTimers();
  const sent = [];
  let rev = 0;
  const a = createAutosave({ deckId: 31, timers: t, now: t.now, save: async (id, uid, card, ifMatch, o) => { sent.push({ id, uid, title: card.title, ifMatch, ord: o.ord }); rev += 1; return ok(rev); } });
  a.base([cardOf('c1', 'One'), cardOf('c2', 'Two')]);
  a.edit({ cards: [cardOf('c1', 'One'), cardOf('c2', 'Two')] });
  assert.equal(a.state().state, 'idle', 'nothing changed: nothing to send');
  // Typing every second for 12 s: the 10 s cap sends once mid-burst.
  for (let k = 1; k <= 12; k += 1) { a.edit({ cards: [cardOf('c1', `One ${k}`), cardOf('c2', 'Two')] }); await t.advance(1000); }
  assert.equal(sent.length, 1, 'one send at the 10 s cap, none on each keystroke');
  assert.deepEqual(sent[0], { id: 31, uid: 'c1', title: 'One 10', ifMatch: 0, ord: 0 }, 'only the changed card, If-Match 0 for its first copy');
  await t.advance(IDLE_MS);
  assert.equal(sent.length, 2, '1.5 s after the last edit');
  assert.equal(sent[1].ifMatch, 1, 'If-Match is the revision the last reply gave');
  assert.equal(a.state().state, 'synced');
  assert.equal(a.pending(), 0);
  // A reorder sends each card that moved, with its new place.
  a.edit({ cards: [cardOf('c2', 'Two'), cardOf('c1', 'One 12')] });
  await t.advance(IDLE_MS);
  assert.deepEqual(sent.slice(2).map((x) => [x.uid, x.ord]).sort(), [['c1', 1], ['c2', 0]]);
  // Before IDLE_MS nothing goes.
  a.edit({ cards: [cardOf('c2', 'Two!'), cardOf('c1', 'One 12')] });
  await t.advance(IDLE_MS - 1);
  assert.equal(sent.length, 4);
  a.dispose();
  await t.advance(IDLE_MS * 2);
  assert.equal(sent.length, 4, 'a disposed autosave sends nothing');
});

test('2. autosave: offline keeps the edits on the device and says so; back online they sync with the same If-Match', async () => {
  const t = fakeTimers();
  const store = idbStore(fakeIndexedDB());
  let online = false;
  const sent = [];
  const a = createAutosave({ deckId: 32, store, timers: t, now: t.now, save: async (_id, uid, _c, ifMatch) => {
    sent.push([uid, ifMatch]);
    return online ? ok(ifMatch + 1) : Object.freeze({ available: false, unreadable: true, reason: 'Failed to fetch', status: null, data: null });
  } });
  a.base([cardOf('c1', 'One'), cardOf('c2', 'Two')]);
  a.prime([{ uid: 'c1', ord: 0, rev: 4, card: cardOf('c1', 'One') }]);
  await a.edit({ cards: [cardOf('c1', 'One!'), cardOf('c2', 'Two!')] });
  await t.advance(IDLE_MS);
  assert.equal(a.state().state, 'offline');
  assert.equal(a.state().queued, 2);
  assert.equal(offlineLine(a.state().queued), "Offline · 2 changes saved on this device. They'll sync when you're back.");
  assert.equal(saveChip({ dirty: true, sync: a.state() }).text, 'Offline · 2 changes saved on this device');
  const kept = await store.get(keyOf(32));
  assert.deepEqual(kept.doc.cards.map((c) => c.title), ['One!', 'Two!'], 'the device holds the edits');
  assert.deepEqual(kept.revs, { c1: 4, c2: 0 });
  online = true;
  a.retry();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(sent.slice(-2), [['c1', 4], ['c2', 0]], 'the replay sends the revision each card was edited from');
  assert.equal(a.state().state, 'synced');
  assert.equal(a.state().recovered, true, '"Synced" after being offline');
  assert.equal(await store.get(keyOf(32)), undefined, 'once the Worker holds every card the device copy is cleared');
});

test('2. autosave: a 409 stops sending and holds both versions; Keep mine sends over theirs, Keep theirs takes theirs', async () => {
  const t = fakeTimers();
  const theirs = cardOf('c1', 'Their words');
  const sent = [];
  let conflictOnce = true;
  const a = createAutosave({ deckId: 33, timers: t, now: t.now, save: async (_id, uid, card, ifMatch) => {
    sent.push([uid, card.title, ifMatch]);
    if (conflictOnce) {
      conflictOnce = false;
      return Object.freeze({ available: false, unreadable: true, status: 409, reason: 'This card changed in another tab or by another member while you were editing. Nothing was saved.', data: { error: 'card_rev_conflict', rev: 7, server: { uid: 'c1', ord: 0, rev: 7, updated_at: '2026-11-02 14:32:05', card: theirs } } });
    }
    return ok(ifMatch + 1);
  } });
  a.base([cardOf('c1', 'One')]);
  a.edit({ cards: [cardOf('c1', 'My words')] });
  await t.advance(IDLE_MS);
  const st = a.state();
  assert.equal(st.state, 'conflict');
  assert.equal(st.conflict.mine.title, 'My words');
  assert.equal(st.conflict.theirs.title, 'Their words');
  assert.equal(st.conflict.rev, 7);
  assert.equal(saveChip({ dirty: true, sync: st }).text, '● Card changed elsewhere');
  a.edit({ cards: [cardOf('c1', 'My words!')] });
  await t.advance(IDLE_MS * 2);
  assert.equal(sent.length, 1, 'nothing more is sent while the conflict waits');
  assert.equal(a.resolve('mine'), null);
  await t.advance(IDLE_MS);
  assert.deepEqual(sent.at(-1), ['c1', 'My words!', 7], 'Keep mine: If-Match their revision, so mine replaces it');
  // Keep theirs: the editor places theirs, and then there is nothing to send.
  const b = createAutosave({ deckId: 34, timers: t, now: t.now, save: async () => Object.freeze({ available: false, unreadable: true, status: 409, reason: 'x', data: { error: 'card_rev_conflict', rev: 2, server: { card: theirs, updated_at: null } } }) });
  b.base([cardOf('c1', 'One')]);
  b.edit({ cards: [cardOf('c1', 'Mine')] });
  await t.advance(IDLE_MS);
  assert.equal(b.resolve('theirs').title, 'Their words');
  b.edit({ cards: [theirs] });
  assert.equal(b.pending(), 0, 'theirs is what the Worker holds');
});

test('2. the restore offer: the device copy first, else the Worker draft over the version; a time is never 00:00', () => {
  const version = { cards: [cardOf('c1', 'One'), cardOf('c2', 'Two')], theme: null, audience: null };
  assert.equal(restoreOffer({ doc: version }), null);
  assert.equal(restoreOffer({ doc: version, local: { at: 1, doc: version, revs: {} } }), null, 'a device copy equal to the version offers nothing');
  const local = { at: Date.UTC(2026, 10, 2, 14, 32), doc: { ...version, cards: [cardOf('c1', 'One edited'), cardOf('c2', 'Two')] }, revs: { c1: 2 } };
  const o = restoreOffer({ doc: version, local, draft: { cards: [{ uid: 'c2', ord: 1, rev: 3, card: cardOf('c2', 'Server') }] } });
  assert.equal(o.from, 'device');
  assert.deepEqual(o.revs, { c1: 2 });
  const s = restoreOffer({ doc: version, draft: { updated_at: '2026-11-02 14:32:05', cards: [{ uid: 'c2', ord: 0, rev: 3, card: cardOf('c2', 'Server') }, { uid: 'k9', ord: 2, rev: 1, card: cardOf('k9', 'New') }] } });
  assert.equal(s.from, 'server');
  assert.deepEqual(s.doc.cards.map((c) => c.title), ['Server', 'One', 'New'], 'a draft card replaces its uid, moves to its place, and a new one joins');
  assert.deepEqual(s.revs, { c2: 3, k9: 1 });
  assert.deepEqual(mergeDraft(version.cards, []).map((c) => c.title), ['One', 'Two']);
  assert.equal(clockOf('2026-11-02 14:32:05', { timeZone: 'UTC' }), '14:32');
  assert.equal(restoreLine(null), 'Restore unsaved changes?', 'no time read: none drawn');
  assert.equal(restoreLine('not a time'), 'Restore unsaved changes?');
});

/* ------------------------------------------------------------------ 3 */

test('3. killing the tab after 3 edits and reopening restores them (controller, fake IndexedDB)', async () => {
  const idb = fakeIndexedDB();
  const t = fakeTimers();
  const version = { cards: [cardOf('c1', 'One'), cardOf('c2', 'Two'), cardOf('c3', 'Three')], theme: null, audience: null };
  const first = createAutosave({ deckId: 35, store: idbStore(idb), timers: t, now: () => 1_700_000_000_000, save: async () => ok(1) });
  first.base(version.cards);
  let doc = version;
  for (const [i, title] of [[0, 'One edited'], [1, 'Two edited'], [2, 'Three edited']]) {
    doc = { ...doc, cards: doc.cards.map((c, j) => (j === i ? { ...c, title } : c)) };
    // eslint-disable-next-line no-await-in-loop
    await first.edit(doc);
  }
  first.dispose(); // the tab is killed before the 1.5 s send
  // Reopen: a new store on the same IndexedDB.
  const store = idbStore(idb);
  const local = await store.get(keyOf(35));
  const offer = restoreOffer({ doc: version, local });
  assert.equal(offer.from, 'device');
  assert.deepEqual(offer.doc.cards.map((c) => c.title), ['One edited', 'Two edited', 'Three edited']);
  const sent = [];
  const second = createAutosave({ deckId: 35, store, timers: t, now: t.now, save: async (_id, uid, card, ifMatch) => { sent.push([uid, card.title, ifMatch]); return ok(ifMatch + 1); } });
  second.base(version.cards);
  second.revisions(offer.revs);
  second.edit(offer.doc);
  await t.advance(IDLE_MS);
  assert.deepEqual(sent, [['c1', 'One edited', 0], ['c2', 'Two edited', 0], ['c3', 'Three edited', 0]], 'the replay sends all three, If-Match their revisions');
});

/* ------------------------------------------------------------------ 4 */

const UID_DECK = { ...DECK, slides: DECK.slides.map((c, i) => ({ ...c, uid: `c${i + 1}` })) };
const node = (m, id) => { const n = m.by(id); assert.ok(n, `no ${id}`); return n; };

/** The draft client, stubbed for one suite and put back after. */
function stubDraft({ draft = async () => ({ deck_id: 31, cards: [] }), saveCard = async (_d, uid, _c, rev) => ({ ok: true, card: { uid, rev: Number(rev) + 1 } }), discard = async () => ({ ok: true }) } = {}) {
  const real = { ...deckDraftApi };
  const calls = [];
  deckDraftApi.draft = async (...a) => { calls.push(['draft', ...a]); return draft(...a); };
  deckDraftApi.saveCard = async (...a) => { calls.push(['saveCard', ...a]); return saveCard(...a); };
  deckDraftApi.discard = async (...a) => { calls.push(['discard', ...a]); return discard(...a); };
  return { calls, restore: () => Object.assign(deckDraftApi, real) };
}

test('3. killing the tab after 3 edits and reopening restores them (the mounted editor, fake IndexedDB)', async () => {
  const idb = fakeIndexedDB();
  const onDocument = () => { globalThis.indexedDB = idb; };
  const d = stubDraft();
  try {
    const m = await mountEditor({ answers: { deckGet: async () => UID_DECK }, onDocument });
    try {
      await m.press(node(m, 'pitch-editor-block-b2'));
      await m.type(node(m, 'pitch-tools-text'), 'Synthetic body words, edited');
      await m.type(node(m, 'pitch-editor-notes'), 'Synthetic note, edited');
      await m.press(node(m, 'pitch-tools-style-list'));
      assert.match(m.text(node(m, 'pitch-editor-save-state')), /^Saving…$/);
    } finally { await m.close(); } // the tab dies before 1.5 s: nothing reached the Worker
    assert.equal(d.calls.filter((c) => c[0] === 'saveCard').length, 0);
    const again = await mountEditor({ answers: { deckGet: async () => UID_DECK }, onDocument });
    try {
      assert.match(again.text(node(again, 'pitch-restore-line')), /^Restore unsaved changes from \d\d:\d\d\?$/);
      assert.match(again.text(node(again, 'pitch-editor-block-b2')), /Synthetic body words$/, 'nothing changes until Restore');
      await again.press(node(again, 'pitch-restore-run'));
      assert.ok(!again.by('pitch-restore'));
      assert.match(again.text(node(again, 'pitch-editor-block-b2')), /Synthetic body words, edited/);
      await again.press(node(again, 'pitch-editor-block-b2'));
      assert.equal(again.pr(node(again, 'pitch-editor-notes')).value, 'Synthetic note, edited');
      assert.equal(again.pr(node(again, 'pitch-tools-style-list'))['aria-pressed'], true, 'all three edits are back');
      // The replay goes to the Worker, If-Match the revision the card was edited from.
      await settleLong(IDLE_MS + 200);
      const saves = d.calls.filter((c) => c[0] === 'saveCard');
      assert.deepEqual(saves.map((c) => [c[1], c[2], c[4]]), [[31, 'c1', 0]]);
      assert.equal(saves[0][3].notes, 'Synthetic note, edited');
      assert.match(again.text(node(again, 'pitch-editor-save-state')), /^✓ All changes saved$/);
      // Undo takes the restore back as one step.
      await again.press(node(again, 'pitch-editor-undo'));
      assert.match(again.text(node(again, 'pitch-editor-block-b2')), /Synthetic body words$/);
    } finally { await again.close(); }
  } finally { d.restore(); delete globalThis.indexedDB; }
});

test('3. Discard throws the draft away (DELETE …/draft) and the device copy with it', async () => {
  const idb = fakeIndexedDB();
  const store = idbStore(idb);
  await store.put(keyOf(31), { deck_id: 31, at: Date.now(), doc: { cards: [{ ...UID_DECK.slides[0], title: 'Device edit' }, UID_DECK.slides[1]], theme: null, audience: 'seed_fund' }, revs: {} });
  const d = stubDraft();
  try {
    const m = await mountEditor({ answers: { deckGet: async () => UID_DECK }, onDocument: () => { globalThis.indexedDB = idb; } });
    try {
      assert.ok(m.by('pitch-restore'));
      // An edit made while the question waits never writes over the copy it offers.
      await m.press(node(m, 'pitch-editor-block-b2'));
      await m.type(node(m, 'pitch-editor-notes'), 'Synthetic note typed meanwhile');
      assert.equal((await idbStore(idb).get(keyOf(31))).doc.cards[0].title, 'Device edit');
      assert.equal(d.calls.filter((c) => c[0] === 'saveCard').length, 0);
      await m.press(node(m, 'pitch-restore-discard'));
      assert.deepEqual(d.calls.filter((c) => c[0] === 'discard'), [['discard', 31]]);
      assert.ok(!m.by('pitch-restore'));
      // The offered copy is gone; what was typed meanwhile is the device's copy now.
      const left = await idbStore(idb).get(keyOf(31));
      assert.equal(left.doc.cards[0].title, 'Synthetic traction');
      assert.equal(left.doc.cards[0].notes, 'Synthetic note typed meanwhile');
    } finally { await m.close(); }
  } finally { d.restore(); delete globalThis.indexedDB; }
});

test('4. Undo and Redo in the header and on Cmd/Ctrl+Z; a text field keeps its own; ⋯ repeats them with 100 steps', async () => {
  const keys = [];
  const onDocument = () => {
    const add = globalThis.addEventListener;
    globalThis.addEventListener = (type, fn, ...rest) => { if (type === 'keydown') keys.push(fn); return add?.(type, fn, ...rest); };
  };
  const m = await mountEditor({ onDocument });
  try {
    assert.equal(m.text(node(m, 'pitch-editor-steps')), '100 steps');
    assert.equal(m.pr(node(m, 'pitch-editor-undo'))['aria-disabled'], true, 'nothing to undo yet');
    await m.press(node(m, 'pitch-editor-block-b2'));
    await m.type(node(m, 'pitch-editor-notes'), 'Synthetic one');
    await m.type(node(m, 'pitch-editor-notes'), 'Synthetic one two');
    assert.equal(m.pr(node(m, 'pitch-editor-undo'))['aria-label'], 'Undo, 1 step', 'typing within 800 ms is one step');
    await m.press(node(m, 'pitch-editor-undo'));
    assert.equal(m.pr(node(m, 'pitch-editor-notes')).value, 'Synthetic note');
    assert.match(m.text(node(m, 'pitch-editor-save-state')), /Saved/, 'back to the version: nothing to save');
    await m.press(node(m, 'pitch-editor-redo'));
    assert.equal(m.pr(node(m, 'pitch-editor-notes')).value, 'Synthetic one two');
    // The keyboard: Cmd/Ctrl+Z undoes outside a text field, and is the field's own inside one.
    assert.equal(keys.length, 1, 'one keydown listener on the window');
    const press = async (e) => { let stopped = false; await act(async () => { keys[0]({ preventDefault() { stopped = true; }, ...e }); }); await m.settle(); return stopped; };
    assert.equal(await press({ key: 'z', metaKey: true, target: { tagName: 'TEXTAREA' } }), false, 'inside a text field Z is native');
    assert.equal(m.pr(node(m, 'pitch-editor-notes')).value, 'Synthetic one two');
    assert.equal(await press({ key: 'z', ctrlKey: true, target: { tagName: 'BODY' } }), true);
    assert.equal(m.pr(node(m, 'pitch-editor-notes')).value, 'Synthetic note');
    await press({ key: 'Z', metaKey: true, shiftKey: true, target: { tagName: 'BODY' } });
    assert.equal(m.pr(node(m, 'pitch-editor-notes')).value, 'Synthetic one two');
    // ⋯ › Undo and Redo.
    await m.press(node(m, 'deck-more-open'));
    assert.equal(m.pr(node(m, 'deck-more-undo'))['aria-disabled'], undefined);
    assert.equal(m.pr(node(m, 'deck-more-redo'))['aria-disabled'], true);
    assert.equal(m.pr(node(m, 'deck-more-redo')).title, 'Nothing to redo.');
    await m.press(node(m, 'deck-more-undo'));
    assert.equal(m.pr(node(m, 'pitch-editor-notes')).value, 'Synthetic note');
    // Cmd/Ctrl+F opens Find and replace (under ⋯), from anywhere.
    assert.equal(await press({ key: 'f', metaKey: true, target: { tagName: 'TEXTAREA' } }), true);
    assert.ok(m.by('pitch-sheet-find'));
  } finally { await m.close(); }
});

test('4. one undo step: a structure and Apply theme to all are each one step', async () => {
  const m = await mountEditor();
  try {
    await m.press(node(m, 'deck-more-open'));
    await m.press(node(m, 'deck-more-structure'));
    await m.press(node(m, 'pitch-structure-big_number'));
    assert.equal(m.pr(node(m, 'pitch-editor-undo'))['aria-label'], 'Undo, 1 step');
    await m.press(node(m, 'pitch-editor-undo'));
    assert.match(m.text(node(m, 'pitch-editor-save-state')), /Saved/, 'the whole structure came back in one step');
  } finally { await m.close(); }
});

test('4. undoing an accepted, charged run says it is still charged; Accept shows no interim line', async () => {
  const m = await mountEditor({ answers: {
    'assist.quote': async () => ({ ai: true, hold_microusd: 1100 }),
    'assist.run': async (_id, _card, body) => ({ proposal: { uid: 'i1' }, before: body.text, after: 'Synthetic warmer words', cost: { charged_microusd: 600 } }),
    'proposals.decide': async () => ({ ok: true }),
  } });
  try {
    await m.press(node(m, 'pitch-editor-block-b2'));
    await m.type(node(m, 'pitch-instruction-field'), 'make it warmer');
    await m.press(node(m, 'pitch-instruction-send'));
    await m.press(node(m, 'pitch-instruction-run'));
    assert.equal(m.by('pitch-instruction-charged'), undefined, 'the interim confirm line is gone');
    await m.press(node(m, 'pitch-instruction-proposal-accept'));
    assert.match(m.text(node(m, 'pitch-editor-block-b2')), /Synthetic warmer words/);
    assert.ok(!m.by('pitch-still-charged'));
    await m.press(node(m, 'pitch-editor-undo'));
    assert.match(m.text(node(m, 'pitch-editor-block-b2')), /Synthetic body words/);
    assert.equal(m.text(node(m, 'pitch-still-charged')).replace(/ OK$/, ''), STILL_CHARGED);
    await m.press(node(m, 'pitch-editor-redo'));
    assert.ok(!m.by('pitch-still-charged'), 'the line goes with the next step');
  } finally { await m.close(); }
});

test('4. find and replace skips bound values: ⋯ › Find and replace…, one undo step, the bound figure untouched', async () => {
  const m = await mountEditor();
  try {
    await m.press(node(m, 'deck-more-open'));
    assert.equal(m.text(node(m, 'deck-more-find')).replace(/\s+/g, ' '), 'Find and replace… · ⌘F');
    assert.ok(!m.by('deck-toolbar-find'), 'never a header control');
    await m.press(node(m, 'deck-more-find'));
    assert.equal(m.text(node(m, 'pitch-find-bound')), 'Bound figures are never replaced.');
    await m.type(node(m, 'pitch-find-field'), 'MRR');
    assert.equal(m.text(node(m, 'pitch-find-count')), '0 matches · 1 in bound figures, left as they are');
    assert.equal(m.pr(node(m, 'pitch-find-run')).disabled, true);
    await m.type(node(m, 'pitch-find-field'), 'synthetic');
    await m.type(node(m, 'pitch-find-replace'), 'Demo');
    assert.equal(m.text(node(m, 'pitch-find-count')), '5 matches on 2 cards');
    await m.press(node(m, 'pitch-find-run'));
    assert.equal(m.text(node(m, 'pitch-find-said')), 'Replaced 5. One undo step puts them back.');
    assert.match(m.text(node(m, 'pitch-editor-block-b1')), /Demo heading/);
    assert.match(m.text(node(m, 'pitch-editor-block-b2')), /Demo body words/);
    assert.match(m.text(node(m, 'pitch-editor-block-b3')), /MRR/, 'the bound metric keeps its label');
    assert.match(m.text(node(m, 'pitch-editor-block-b3')), /4200/, 'and its value');
    assert.equal(m.pr(node(m, 'pitch-editor-undo'))['aria-label'], 'Undo, 1 step');
    await m.press(node(m, 'pitch-editor-undo'));
    assert.match(m.text(node(m, 'pitch-editor-block-b1')), /Synthetic heading/);
  } finally { await m.close(); }
  assert.equal(CARD.blocks[2].binding.source_key, 'revenue.mrr');
});

test('4. B on the selected words: bold runs on the card, spellcheck on the words and the notes', async () => {
  const m = await mountEditor();
  try {
    await m.press(node(m, 'pitch-editor-block-b2'));
    const box = node(m, 'pitch-tools-text');
    assert.equal(m.pr(box).spellCheck, true);
    assert.equal(m.pr(node(m, 'pitch-editor-notes')).spellCheck, true);
    box.selectionStart = 0; box.selectionEnd = 9;
    await m.fire(box, 'onSelect');
    await m.press(node(m, 'pitch-tools-mark-b'));
    assert.ok(m.by('deck-block-rich'), 'the stage draws the runs');
    assert.equal(m.pr(node(m, 'pitch-tools-mark-b'))['aria-pressed'], true);
    await m.press(node(m, 'pitch-tools-mark-link'));
    await m.type(node(m, 'pitch-tools-link-field'), 'http://example.com');
    await m.press(node(m, 'pitch-tools-link-apply'));
    assert.match(m.text(node(m, 'pitch-tools-mark-problem')), /https:\/\//, 'an http link is refused with its reason');
    assert.equal(m.pr(node(m, 'pitch-editor-undo'))['aria-label'], 'Undo, 1 step', 'the refused link changed nothing');
    await m.press(node(m, 'pitch-editor-undo'));
    assert.ok(!m.by('deck-block-rich'), 'one undo: plain again');
  } finally { await m.close(); }
});

test('4. a 409 opens the conflict view: Your version and Their version, then Keep theirs places theirs', async () => {
  const theirs = { ...UID_DECK.slides[0], uid: 'c1', title: 'Their synthetic title', blocks: UID_DECK.slides[0].blocks.map((b) => (b.id === 'b2' ? { ...b, text: 'Their synthetic words' } : b)) };
  const d = stubDraft({ saveCard: async () => { throw Object.assign(new Error('This card changed in another tab or by another member while you were editing. Nothing was saved.'), { status: 409, data: { error: 'card_rev_conflict', rev: 5, server: { uid: 'c1', ord: 0, rev: 5, updated_at: '2026-11-02 14:32:05', card: theirs } } }); } });
  try {
    const m = await mountEditor({ answers: { deckGet: async () => UID_DECK } });
    try {
      await m.press(node(m, 'pitch-editor-block-b2'));
      await m.type(node(m, 'pitch-tools-text'), 'My synthetic words');
      await settleLong(IDLE_MS + 200);
      assert.match(m.text(node(m, 'pitch-conflict-mine')), /Your version.*My synthetic words/);
      assert.match(m.text(node(m, 'pitch-conflict-theirs')), /Their version.*Their synthetic words/);
      assert.equal(m.text(node(m, 'pitch-editor-save-state')), '● Card changed elsewhere');
      await m.press(node(m, 'pitch-conflict-copy'));
      assert.ok(!m.by('pitch-conflict'));
      assert.match(m.text(node(m, 'pitch-editor-block-b2')), /Their synthetic words/, 'theirs is on the card');
      assert.ok(m.by('pitch-editor-rail-2'), 'Copy mine to a new card: a third card');
      assert.ok(!m.by('pitch-editor-rail-3'));
      await m.press(node(m, 'pitch-editor-rail-1'));
      await m.press(node(m, 'pitch-editor-block-b2'));
      assert.equal(m.pr(node(m, 'pitch-tools-text')).value, 'My synthetic words', 'mine is the new card, right after');
    } finally { await m.close(); }
  } finally { d.restore(); }
});

test('the seam and the sources: history is swapped without through(), the editor reads it, and no interim line is left', async () => {
  assert.deepEqual(await adapter.history(), { available: true, value: gridOps });
  assert.equal(adapter.availability('history'), null);
  const server = { server: { uid: 'c1', rev: 7 } };
  const refusal = await adapter.through(async () => { throw Object.assign(new Error('Changed in another tab'), { status: 409, code: 'draft_conflict', data: server }); }, 3751);
  assert.deepEqual([refusal.status, refusal.code, refusal.data], [409, 'draft_conflict', server]);
  const seam = readFileSync('frontend/src/pages/raise/pitch/deckV2Adapter.js', 'utf8');
  assert.match(seam, /^export const history = async \(\) => Object\.freeze\(\{ available: true, value: gridOps \}\);$/m);
  assert.doesNotMatch(seam, /^export const history = [^\n]*through\(/m, 'no contract: history reaches no route');
  const box = readFileSync('frontend/src/pages/raise/pitch/InstructionBox.jsx', 'utf8');
  assert.doesNotMatch(box, /pitch-instruction-charged/);
});
