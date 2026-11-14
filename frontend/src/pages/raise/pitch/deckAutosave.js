/**
 * D1515 (#3767, deck v2 A4c, plan §5.9.1) — THE AUTOSAVE CLIENT, on D1501's
 * working copy (#3751): `PATCH /api/decks/:id/cards/:uid` with `If-Match`,
 * `GET` and `DELETE /api/decks/:id/draft`, reached through
 * `deckV2Adapter.saveCard`, `draft` and `discardDraft`.
 *
 *   when      1.5 s after the last edit, and never more than 10 s after the
 *             first edit not yet sent, while typing goes on (`IDLE_MS`,
 *             `MAX_WAIT_MS`)
 *   what      each card whose words, blocks or place changed since the
 *             Worker last had it, one PATCH each, `If-Match` the revision
 *             this tab last saw (0 for a card the draft does not hold yet)
 *   on device every edit is written at once to IndexedDB (`idbStore`), the
 *             whole working deck with the revisions it was made on, so a
 *             closed tab, a crash or a lost connection loses nothing; it is
 *             cleared once the Worker holds every card
 *   offline   a PATCH that never reached the Worker (no status) keeps the
 *             edits on the device: "Offline · 3 changes saved on this
 *             device. They'll sync when you're back." The `online` event,
 *             or the next edit, sends them again with the same `If-Match`
 *   409       `card_rev_conflict`: another tab or member saved that card
 *             first. Sending stops on it and the editor shows pd9q, "Your
 *             version" and "Their version" (the reply's `server`), with
 *             Keep mine, Keep theirs and Copy mine to a new card (`resolve`)
 *
 * D4596 (#4596): the working document is more than its cards. The deck-level state (which cards it
 * keeps, in what order, the theme and the audience) is its own revision, `PUT /api/decks/:id/draft-doc`
 * with `If-Match`, sent after the cards. A removal, a reorder, a theme-only or an audience-only edit
 * is "unsent" until that revision is acknowledged, and the device copy is kept until the cards AND the
 * document revision are. A write to the device that fails is reported (`device: 'failed'`), never
 * called "saved on this device".
 *
 * `restoreOffer` decides the banner on open, "Restore unsaved changes from
 * [14:32]?": the device's copy when it holds edits the version does not,
 * else the Worker's draft when it differs from the version.
 *
 * Nothing here draws or reads React. The clock, the timers and the store are
 * passed in, so the tests run it on a fake IndexedDB and fake time.
 */

export const IDLE_MS = 1500;
export const MAX_WAIT_MS = 10000;
const DB_NAME = 'studioos-deck-drafts';
const STORE = 'drafts';

export const keyOf = (deckId) => `deck:${deckId}`;

const promised = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error('IndexedDB refused the request.'));
});

/**
 * The device's store: one record per deck version, in IndexedDB. Null when
 * the browser has none (a private window may refuse it); autosave then works
 * without the device copy.
 */
export function idbStore(idb = globalThis.indexedDB) {
  if (!idb || typeof idb.open !== 'function') return null;
  let opened = null;
  const db = () => {
    if (!opened) {
      opened = new Promise((resolve, reject) => {
        let req;
        try { req = idb.open(DB_NAME, 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames?.contains?.(STORE)) req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB could not be opened.'));
      });
    }
    return opened;
  };
  const tx = async (mode, fn) => { const d = await db(); return promised(fn(d.transaction(STORE, mode).objectStore(STORE))); };
  return {
    get: (key) => tx('readonly', (s) => s.get(key)).catch(() => null),
    // D4596: true only when the browser took the write; a refusal is `false`, so no line says "saved on this device" over it.
    put: (key, value) => tx('readwrite', (s) => s.put(value, key)).then(() => true, () => false),
    del: (key) => tx('readwrite', (s) => s.delete(key)).catch(() => null),
  };
}

// A card's signature: its place and its whole JSON, cached per card object.
const sigs = new WeakMap();
const json = (card) => {
  if (card && typeof card === 'object') {
    if (!sigs.has(card)) sigs.set(card, JSON.stringify(card));
    return sigs.get(card);
  }
  return JSON.stringify(card ?? null);
};
const sigOf = (card, ord) => `${ord}|${json(card)}`;
/** The deck-level state a working copy carries besides its cards: which cards, in order, the theme and the audience. */
const docSigOf = (order, theme, audience) => JSON.stringify([order, theme ?? null, audience ?? null]);
const orderOf = (cards) => (cards || []).map(uidOf).filter(Boolean);
const uidOf = (card) => (typeof card?.uid === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(card.uid) ? card.uid : null);

/**
 * One deck version's autosave. `save(deckId, uid, card, rev, { ord })` is
 * `deckV2Adapter.saveCard`: it answers `{ available: true, value }` or an
 * unavailable answer carrying the Worker's `status` and body (`data`).
 * `onChange(state)` hears every change of `state()`.
 */
export function createAutosave({ deckId, save, saveDoc = null, store = null, now = () => Date.now(), timers = globalThis, onChange = () => {} }) {
  const known = new Map(); // uid → { rev, sig }: what the Worker holds
  let docKnown = { rev: 0, sig: null }; // the deck-level state the Worker holds (D4596)
  let device = store ? 'saved' : 'none';
  let doc = null;
  let idle = null; let cap = null;
  let busy = false; let again = false; let held = false; let gone = false;
  let s = { state: 'idle', queued: 0, at: null, conflict: null, reason: null, recovered: false, device };
  const set = (patch) => { s = { ...s, device, ...patch }; if (!gone) onChange(s); };
  const clear = () => { if (idle) timers.clearTimeout(idle); if (cap) timers.clearTimeout(cap); idle = null; cap = null; };

  /** The cards the Worker does not hold as they are now, each with its place. */
  const unsent = () => {
    const out = [];
    (doc?.cards || []).forEach((card, ord) => {
      const uid = uidOf(card);
      if (!uid) return;
      const k = known.get(uid);
      if (!k || k.sig !== sigOf(card, ord)) out.push({ uid, card, ord, rev: k?.rev ?? 0 });
    });
    return out;
  };
  /** The deck-level state, when the Worker does not hold it as it is now. */
  const unsentDoc = () => (doc && saveDoc && docKnown.sig !== docSigOf(orderOf(doc.cards), doc.theme, doc.audience) ? { rev: docKnown.rev } : null);
  const queuedCount = () => unsent().length + (unsentDoc() ? 1 : 0);
  const revs = () => Object.fromEntries([...known].map(([uid, k]) => [uid, k.rev]));
  const persist = async () => {
    if (!store || !doc) return null;
    const ok = await store.put(keyOf(deckId), { deck_id: deckId, at: now(), doc, revs: revs(), doc_rev: docKnown.rev });
    // D4596: the browser refused the write. Say so; the edits stay in memory and keep being sent.
    const next = ok === false ? 'failed' : 'saved';
    if (next !== device) { device = next; set({}); }
    return ok;
  };

  async function flush() {
    clear();
    if (gone || held || !doc) return;
    if (busy) { again = true; return; }
    if (s.conflict) return;
    busy = true;
    const wasOffline = s.state === 'offline';
    const stop = (answer, conflictItem) => {
      busy = false;
      const queued = queuedCount();
      const data = answer?.data || null;
      if (conflictItem && answer?.status === 409 && data?.error === 'card_rev_conflict') {
        const server = data.server || null;
        set({ state: 'conflict', queued, conflict: { uid: conflictItem.uid, ord: conflictItem.ord, mine: conflictItem.card, theirs: server?.card ?? null, rev: Number(data.rev) || 0, at: server?.updated_at ?? null }, reason: data.message || null });
      } else if (answer?.unreadable && answer.status == null) {
        set({ state: 'offline', queued, reason: null });
      } else if (!answer?.unreadable) {
        // The route answered 404: it is not switched on here. Edits stay on the device.
        set({ state: 'off', queued, reason: answer?.reason || null });
      } else {
        set({ state: 'error', queued, reason: answer.reason || 'Your changes could not be saved.' });
      }
    };
    let todo = unsent();
    if (todo.length || unsentDoc()) set({ state: 'saving', queued: queuedCount() });
    for (const item of todo) {
      // eslint-disable-next-line no-await-in-loop
      const answer = await save(deckId, item.uid, item.card, item.rev, { ord: item.ord });
      if (gone) { busy = false; return; }
      if (answer?.available === true) {
        const rev = Number(answer.value?.card?.rev);
        known.set(item.uid, { rev: Number.isInteger(rev) ? rev : item.rev + 1, sig: sigOf(item.card, item.ord) });
        continue;
      }
      stop(answer, item);
      return;
    }
    // D4596: then the deck-level state, a revision of its own. Another tab's write to it is not a card
    // conflict; the newer one wins, sent once more on the revision the Worker names.
    for (let tries = 0; unsentDoc(); tries += 1) {
      const sent = { order: orderOf(doc.cards), theme: doc.theme ?? null, audience: doc.audience ?? null };
      // eslint-disable-next-line no-await-in-loop
      const answer = await saveDoc(deckId, sent, docKnown.rev);
      if (gone) { busy = false; return; }
      if (answer?.available === true) {
        const rev = Number(answer.value?.doc?.rev);
        docKnown = { rev: Number.isInteger(rev) ? rev : docKnown.rev + 1, sig: docSigOf(sent.order, sent.theme, sent.audience) };
        // A card the document no longer keeps has no working copy: its revision is not ours to send on.
        for (const uid of [...known.keys()]) if (!sent.order.includes(uid)) known.delete(uid);
        continue;
      }
      if (answer?.status === 409 && answer?.data?.error === 'doc_rev_conflict' && tries < 2) {
        docKnown = { rev: Number(answer.data.rev) || 0, sig: null };
        continue;
      }
      stop(answer, null);
      return;
    }
    busy = false;
    if (again) { again = false; todo = unsent(); if (todo.length || unsentDoc()) { flush(); return; } }
    const left = queuedCount();
    // The device copy goes only once the cards AND the document revision are acknowledged.
    if (!left && store) {
      await store.del(keyOf(deckId));
      // An edit that landed while the delete ran must not lose its copy.
      if (queuedCount()) await persist();
    }
    if (gone) return;
    const now2 = queuedCount();
    set({ state: now2 ? 'pending' : 'synced', queued: now2, at: now(), reason: null, recovered: wasOffline || s.recovered });
    if (now2) schedule();
  }

  function schedule() {
    if (idle) timers.clearTimeout(idle);
    idle = timers.setTimeout(flush, IDLE_MS);
    if (!cap) cap = timers.setTimeout(flush, MAX_WAIT_MS);
  }

  return {
    /** What the Worker holds before any edit: the version's cards (revision 0), then the draft's (`prime`). */
    base(cards, meta = {}) {
      known.clear();
      (cards || []).forEach((card, ord) => { const uid = uidOf(card); if (uid) known.set(uid, { rev: 0, sig: sigOf(card, ord) }); });
      docKnown = { rev: 0, sig: docSigOf(orderOf(cards), meta?.theme, meta?.audience) };
    },
    /** The draft read: each card the Worker holds, at its revision. */
    prime(draftCards, draftDoc = null) {
      for (const d of draftCards || []) if (uidOf({ uid: d.uid })) known.set(d.uid, { rev: Number(d.rev) || 0, sig: sigOf(d.card, Number(d.ord) || 0) });
      if (draftDoc && Array.isArray(draftDoc.order)) docKnown = { rev: Number(draftDoc.rev) || 0, sig: docSigOf(draftDoc.order, draftDoc.theme, draftDoc.audience) };
    },
    /** The revisions a device copy was made on: its replay sends them as `If-Match`. */
    revisions(map, docRev = null) {
      for (const [uid, rev] of Object.entries(map || {})) {
        const k = known.get(uid);
        known.set(uid, { rev: Number(rev) || 0, sig: k?.sig ?? null });
      }
      if (docRev != null) docKnown = { rev: Number(docRev) || 0, sig: docKnown.sig };
    },
    /** Hold sending (while "Restore unsaved changes" waits for an answer). */
    hold(on) {
      held = Boolean(on);
      if (!held && doc && queuedCount()) { set({ state: 'pending', queued: queuedCount() }); persist(); schedule(); }
      else if (!held && s.state === 'held') set({ state: 'idle', queued: 0 });
    },
    /** Every change of the working deck. The device copy is written at once; the Worker hears it after 1.5 s idle. */
    edit(next) {
      doc = next;
      const n = queuedCount();
      if (!n) { if (s.state === 'pending' || s.state === 'held') set({ state: held ? 'idle' : 'synced', queued: 0 }); return Promise.resolve(null); }
      // While the restore question waits, nothing is sent or written over the device copy it offers.
      if (held) { set({ state: 'held', queued: n }); return Promise.resolve(null); }
      if (s.state !== 'offline' && s.state !== 'conflict' && s.state !== 'saving') set({ state: 'pending', queued: n, recovered: false });
      else set({ queued: n });
      const written = persist();
      if (s.state !== 'conflict') schedule();
      return written;
    },
    flush,
    /** Back online: send what waits. */
    retry() { if (!s.conflict) flush(); },
    /**
     * pd9q. `mine`: send this tab's card over theirs. `theirs`: the Worker's
     * copy is now this card (the editor places it). `copy`: theirs stays on
     * the card and the editor adds mine as a new card. Answers the card the
     * editor places for `theirs` and `copy` (null when the Worker holds none).
     */
    resolve(choice) {
      const c = s.conflict;
      if (!c) return null;
      // D4596: "mine" is the card as it is NOW, so an edit made after the conflict appeared is kept by Copy mine.
      const latest = (doc?.cards || []).find((x) => uidOf(x) === c.uid) ?? c.mine;
      if (choice === 'mine') known.set(c.uid, { rev: c.rev, sig: null });
      else known.set(c.uid, { rev: c.rev, sig: c.theirs ? sigOf(c.theirs, c.ord) : null });
      set({ state: 'pending', conflict: null, reason: null });
      schedule();
      return choice === 'mine' ? null : { theirs: c.theirs, mine: latest };
    },
    /** Discard: the Worker's draft and the device copy are gone; the version is the base again. */
    async discard(cards, meta = {}) {
      clear();
      if (store) await store.del(keyOf(deckId));
      this.base(cards, meta);
      set({ state: 'idle', queued: 0, conflict: null, reason: null });
    },
    /** Saved as a version: this version's copies are no longer needed. */
    async forget() { clear(); if (store) await store.del(keyOf(deckId)); },
    pending: () => queuedCount(),
    state: () => s,
    dispose() { gone = true; clear(); },
  };
}

// ────────────────────────────────────────────────────────── the restore offer

/**
 * The version's cards with the Worker's draft over them: a draft card
 * replaces the card with its uid, and a card the version lacks joins at its
 * place. Then every card takes its place from the draft (`ord`) where the
 * draft has one, so a reorder comes back too.
 */
export function mergeDraft(cards, draftCards, draftDoc = null) {
  const merged = mergeCards(cards, draftCards);
  const order = Array.isArray(draftDoc?.order) ? draftDoc.order : null;
  if (!order) return merged;
  // D4596: the document names the cards the working copy keeps, in order. A card it does not name was removed.
  const at = new Map(order.map((u, i) => [u, i]));
  return merged.filter((c) => at.has(uidOf(c))).sort((a, z) => at.get(uidOf(a)) - at.get(uidOf(z)));
}

function mergeCards(cards, draftCards) {
  const list = Array.isArray(cards) ? [...cards] : [];
  const drafts = (Array.isArray(draftCards) ? draftCards : []).filter((d) => d && d.card && typeof d.card === 'object' && uidOf({ uid: d.uid }));
  if (!drafts.length) return list;
  const ordOf = new Map(drafts.map((d) => [d.uid, Number(d.ord) || 0]));
  const byUid = new Map(drafts.map((d) => [d.uid, { ...d.card, uid: d.uid }]));
  const out = list.map((c) => (byUid.has(uidOf(c)) ? byUid.get(uidOf(c)) : c));
  for (const d of drafts) if (!out.some((c) => uidOf(c) === d.uid)) out.push(byUid.get(d.uid));
  return out
    .map((c, i) => ({ c, k: ordOf.has(uidOf(c)) ? ordOf.get(uidOf(c)) : i, i }))
    // A draft card states its place, so on a tie it goes first.
    .sort((a, z) => a.k - z.k || (ordOf.has(uidOf(z.c)) ? 1 : 0) - (ordOf.has(uidOf(a.c)) ? 1 : 0) || a.i - z.i)
    .map((x) => x.c);
}

const same = (a, z) => JSON.stringify(a ?? null) === JSON.stringify(z ?? null);

/**
 * The banner's offer on open, or null: `{ from: 'device' | 'server', at,
 * doc, revs }`. The device copy wins when it holds edits the version does
 * not; else the Worker's draft, when it changes the version's cards.
 */
export function restoreOffer({ doc, local = null, draft = null }) {
  if (local && local.doc && Array.isArray(local.doc.cards)) {
    const changes = !same(local.doc.cards, doc.cards) || !same(local.doc.theme ?? null, doc.theme ?? null) || !same(local.doc.audience ?? null, doc.audience ?? null);
    if (changes) return { from: 'device', at: Number(local.at) || null, doc: { cards: local.doc.cards, theme: local.doc.theme ?? null, audience: local.doc.audience ?? null }, revs: local.revs || {}, docRev: local.doc_rev ?? null };
  }
  const cards = Array.isArray(draft?.cards) ? draft.cards : [];
  const draftDoc = draft?.doc && Array.isArray(draft.doc.order) ? draft.doc : null;
  if (cards.length || draftDoc) {
    const merged = mergeDraft(doc.cards, cards, draftDoc);
    const theme = draftDoc ? draftDoc.theme ?? null : doc.theme ?? null;
    const audience = draftDoc ? draftDoc.audience ?? null : doc.audience ?? null;
    if (!same(merged, doc.cards) || !same(theme, doc.theme ?? null) || !same(audience, doc.audience ?? null)) {
      return { from: 'server', at: draft.updated_at ?? null, doc: { ...doc, cards: merged, theme, audience }, revs: Object.fromEntries(cards.map((d) => [d.uid, Number(d.rev) || 0])), docRev: draftDoc ? draftDoc.rev : null };
    }
  }
  return null;
}

/** "14:32": the hour and minute of a device time (ms) or a Worker time ("2026-11-02 14:32:05", UTC). */
export function clockOf(at, { timeZone } = {}) {
  let t = null;
  if (typeof at === 'number') t = at;
  else if (typeof at === 'string' && at) t = Date.parse(at.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? '' : 'Z'));
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) }).format(new Date(t));
}

/** pd9q's restore banner. A time that cannot be read is not drawn as 00:00. */
export const restoreLine = (at) => (clockOf(at) ? `Restore unsaved changes from ${clockOf(at)}?` : 'Restore unsaved changes?');

/** pd9p's offline line. */
export const offlineLine = (n, device = 'saved') => (device === 'saved'
  ? `Offline · ${n} ${n === 1 ? 'change' : 'changes'} saved on this device. They'll sync when you're back.`
  // D4596: no line says "saved on this device" over a write the browser refused.
  : `Offline · ${n} ${n === 1 ? 'change is' : 'changes are'} NOT saved on this device. Keep this tab open until you're back online.`);
export const HELD_LINE = 'Saving is paused. Restore or discard the unsaved changes above to carry on.';
export const CONFLICT_LINE = 'Saving is paused until you choose which version of the card to keep.';
export const DEVICE_FAILED = 'This browser would not keep a copy on this device. Your changes are sent to the server, but they will not survive closing this tab if that fails.';
export const TYPING_WORKS = 'Typing still works.';
export const SYNCED = 'Synced';
