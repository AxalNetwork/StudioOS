// #4646 — the hook over `learningDrafts.js`: what to start from, how to keep it, and what to say about it.
//
//   const draft = useLearningDraft({ kind: 'exercise', uid, attempt });
//   const [text, setText] = useState(draft.initial ?? '');
//   useEffect(() => { draft.write(text); }, [text]);
//   …on a send that the server accepted: draft.clear();
//
// `initial` is the saved value of THIS learner for THIS content (and attempt), read once; `state` is 'none',
// 'restored', 'saved' or 'failed', so the page can say exactly what is on the device. Writes are held back 400 ms and
// the last one is written when the page is hidden or the panel goes away, so a close mid-typing keeps what was typed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuthSync';
import { browserStore, clearDraft, draftKey, isBlankDraft, loadDraft, saveDraft } from './learningDrafts';

const HOLD_MS = 400;

export function useLearningDraft({ kind, uid, attempt = null }, { hold = HOLD_MS } = {}) {
  const userId = useAuth()?.user?.id;
  const key = draftKey({ userId, kind, uid, attempt });
  const found = useMemo(() => loadDraft(browserStore(), key), [key]);
  const [state, setState] = useState(found ? 'restored' : 'none');
  const timer = useRef(null);
  const latest = useRef(null);
  const keyRef = useRef(key);
  keyRef.current = key;

  const commit = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    const row = latest.current;
    latest.current = null;
    if (!row || row.key !== keyRef.current) return;
    if (isBlankDraft(row.value)) { clearDraft(browserStore(), row.key); setState('none'); return; }
    setState(saveDraft(browserStore(), row.key, row.value) ? 'saved' : 'failed');
  }, []);

  const write = useCallback((value) => {
    if (!keyRef.current) return;
    // The value the page started from is not news.
    if (!latest.current && found && JSON.stringify(found.value) === JSON.stringify(value)) return;
    latest.current = { key: keyRef.current, value };
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(commit, hold);
  }, [commit, found, hold]);

  const clear = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    latest.current = null;
    clearDraft(browserStore(), keyRef.current);
    setState('none');
  }, []);

  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') commit(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', commit);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', commit); commit(); };
  }, [commit]);

  // D5356 part 2: when the device copy was written, so a resume can prefer the newer of it and the server's.
  return { initial: found ? found.value : undefined, initialAt: found ? found.at : null, state, write, clear, key };
}
