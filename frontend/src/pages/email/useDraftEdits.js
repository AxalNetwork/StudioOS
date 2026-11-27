/**
 * #4660 (finding 5, part 3): the member's own text of a draft, kept where the
 * Worker keeps it (`PATCH /api/mail/drafts/:uid`, D4660 part 2), one entry per
 * version, with a save state the page can draw honestly.
 *
 *   textOfDraft   the text of a version: the member's saved edit when there is
 *                 one, else what Eadwyn generated, with the recipient the page
 *                 falls back to.
 *   useDraftEdits the saving. A change is queued and saved after a short pause,
 *                 naming the revision it read. The text never leaves the page
 *                 on a failure: a failed or conflicting save keeps it, says so
 *                 and offers Save again. Nothing here claims a text is stored
 *                 until the Worker has answered.
 *
 * States, per version: `idle` (never edited by the member), `dirty` (changed,
 * not sent yet), `saving`, `saved`, `failed`, `conflict` (the version was saved
 * from another window since this one read it). `unsaved` is true while any
 * version is dirty, saving, failed or in conflict; `guardClose` and the
 * `beforeunload` guard use it so closing or leaving never discards text in
 * silence.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const SAVE_DELAY_MS = 700;
export const FAILED_LINE = 'This could not be saved. Your text is still here.';
export const CONFLICT_LINE = 'This draft was saved from another window since you opened it. Save again to keep the text you see here.';

/** The text of one version: the member's saved edit, else the generated text. `to` is the recipient to fall back to. */
export function textOfDraft(draft, to = '') {
  const e = draft?.edit ?? null;
  return { to: (e && e.to) || to || '', subject: e ? e.subject : (draft?.subject ?? ''), body: e ? e.body : (draft?.body ?? '') };
}

const sameText = (a, b) => !!a && !!b && a.to === b.to && a.subject === b.subject && a.body === b.body;
const UNSAVED = new Set(['dirty', 'saving', 'failed', 'conflict']);

export function useDraftEdits({ api, to = '', delayMs = SAVE_DELAY_MS } = {}) {
  const [texts, setTexts] = useState({});
  const [states, setStates] = useState({});
  const [closing, setClosing] = useState(null);
  const revision = useRef({});
  const latest = useRef({});
  const timers = useRef({});
  const inflight = useRef({});
  const dropped = useRef(false);
  const apiRef = useRef(api);
  apiRef.current = api;
  const statesRef = useRef(states);
  statesRef.current = states;

  const mark = useCallback((uid, status, error = null) => setStates((s) => ({ ...s, [uid]: { status, error } })), []);
  const seed = (draft) => { if (!(draft.uid in revision.current)) revision.current[draft.uid] = draft.edit?.revision ?? 0; };

  /** The text to show for a version: what the member typed this session, else what is stored. */
  const textFor = (draft) => { seed(draft); return texts[draft.uid] ?? textOfDraft(draft, to); };
  const stateOf = (draft) => states[draft?.uid] ?? { status: 'idle', error: null };

  // One save per version at a time. A change typed while one is in flight is picked up by the loop, so the
  // revision a save names is always the one the last answer returned.
  const save = useCallback((uid) => {
    if (inflight.current[uid]) return inflight.current[uid];
    const run = (async () => {
      for (;;) {
        const text = latest.current[uid];
        if (!text) return true;
        if (!dropped.current) mark(uid, 'saving');
        try {
          const r = await apiRef.current.saveEdit(uid, { to: text.to, subject: text.subject, body: text.body, expected_revision: revision.current[uid] ?? 0 });
          revision.current[uid] = r?.draft?.edit?.revision ?? ((revision.current[uid] ?? 0) + 1);
          if (sameText(latest.current[uid], text)) { if (!dropped.current) mark(uid, 'saved'); return true; }
        } catch (e) {
          if (e?.status === 409 && e?.code === 'stale_edit') {
            revision.current[uid] = e.data?.draft?.edit?.revision ?? revision.current[uid] ?? 0;
            if (!dropped.current) mark(uid, 'conflict', CONFLICT_LINE);
          } else if (!dropped.current) mark(uid, 'failed', FAILED_LINE);
          return false;
        }
      }
    })().finally(() => { delete inflight.current[uid]; });
    inflight.current[uid] = run;
    return run;
  }, [mark]);

  /** Queue the member's text for a version. It is saved after a short pause; it stays on the page whatever happens. */
  const queue = useCallback((uid, text) => {
    latest.current[uid] = text;
    setTexts((t) => ({ ...t, [uid]: text }));
    mark(uid, 'dirty');
    clearTimeout(timers.current[uid]);
    timers.current[uid] = setTimeout(() => { delete timers.current[uid]; save(uid); }, delayMs);
  }, [delayMs, mark, save]);

  const change = (draft, patch) => { seed(draft); queue(draft.uid, { ...(texts[draft.uid] ?? textOfDraft(draft, to)), ...patch }); };
  /** Adopt a version the page was handed (a draft just accepted): its revision, with no edit yet. */
  const adopt = (draft) => seed(draft);
  const retry = useCallback((uid) => { clearTimeout(timers.current[uid]); delete timers.current[uid]; return save(uid); }, [save]);

  const unsaved = useMemo(() => Object.values(states).some((s) => UNSAVED.has(s.status)), [states]);

  /** Save everything not saved yet, now. Resolves true only when every version is stored. */
  const flush = useCallback(async () => {
    const uids = Object.keys(latest.current).filter((uid) => timers.current[uid] || inflight.current[uid] || UNSAVED.has(statesRef.current[uid]?.status));
    uids.forEach((uid) => { clearTimeout(timers.current[uid]); delete timers.current[uid]; });
    const results = await Promise.all(uids.map((uid) => save(uid)));
    return results.every(Boolean);
  }, [save]);

  /** A close that never discards text in silence: it saves first, and if that fails it stays and says so. */
  const guardClose = (onClose) => async () => {
    if (!unsaved) { onClose?.(); return; }
    setClosing('saving');
    const ok = await flush();
    if (ok) { setClosing(null); onClose?.(); } else setClosing('failed');
  };
  const closeAnyway = (onClose) => () => { setClosing(null); onClose?.(); };

  useEffect(() => {
    if (!unsaved || typeof window === 'undefined' || !window.addEventListener) return undefined;
    const warn = (e) => { e.preventDefault?.(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  useEffect(() => { dropped.current = false; return () => { dropped.current = true; Object.values(timers.current).forEach(clearTimeout); }; }, []);

  return { textFor, stateOf, change, queue, adopt, retry, flush, unsaved, closing, guardClose, closeAnyway };
}
