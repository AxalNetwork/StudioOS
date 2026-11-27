// D5356 part 2 (#5356) — an open exam attempt's choices, held on the server beside the device copy (#4646).
//
// The page keeps choices by option key; the server keeps option indexes. `startFrom` picks what a resumed attempt
// opens with: the newer of the device copy and the server's, so a second device gets the first device's choices
// and a stale server copy never overwrites newer typing on this device. `useServerExamDraft` sends the choices
// after the device write, one revision higher each time, and says truthfully whether the server has them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { answerIndexes, optionRows } from './assessmentModel';

const HOLD_MS = 1200;

/** The server's `{ uid: [index, …] }` as the page's `{ uid: [key, …] }`, for this attempt's questions only. */
export function indexesToKeys(questions, indexes) {
  const out = {};
  if (!indexes || typeof indexes !== 'object') return out;
  for (const q of questions || []) {
    const rows = optionRows(q?.options);
    const picked = (Array.isArray(indexes[q?.uid]) ? indexes[q.uid] : []).map((i) => rows[i]?.key).filter((k) => k !== undefined);
    if (picked.length) out[q.uid] = q.kind === 'multiple' ? picked : picked.slice(0, 1);
  }
  return out;
}

/**
 * What a resumed attempt opens with. `device` is already in keys (restoredAnswers), `deviceAt` its write time in ms;
 * `server` is the start read's `draft` ({ answers: indexes, revision, saved_at }) or null.
 */
export function startFrom({ device, deviceAt, server, questions }) {
  const fromServer = server && server.answers ? indexesToKeys(questions, server.answers) : null;
  const serverAt = server?.saved_at ? Date.parse(server.saved_at) : NaN;
  const hasDevice = device && Object.keys(device).length > 0;
  const hasServer = fromServer && Object.keys(fromServer).length > 0;
  if (hasServer && (!hasDevice || !Number.isFinite(Number(deviceAt)) || (Number.isFinite(serverAt) && serverAt > Number(deviceAt)))) {
    return { answers: fromServer, source: 'server' };
  }
  return { answers: hasDevice ? device : {}, source: hasDevice ? 'device' : null };
}

/** What the page says about the server copy. Empty while nothing has been sent. */
export const SERVER_WORDS = Object.freeze({
  saving: 'Saving to your account…',
  saved: 'Saved to your account, so another device can pick it up. It is not submitted until you submit.',
  failed: 'Not saved to your account. It is still kept on this device, and is sent again when you reconnect.',
  closed: 'This attempt is closed, so nothing more is saved.',
  idle: '',
});

/**
 * Sends `answers` (in keys) to the server after `hold` ms of quiet, at one revision above the last. A 409
 * `stale_revision` (another tab or device saved later) takes the server's revision and sends this tab's choices once
 * more, since they are the newer action here; `already_submitted` and `time_limit_passed` stop saving.
 */
export function useServerExamDraft({ examUid, attempt, questions, answers, save, hold = HOLD_MS }) {
  const [state, setState] = useState('idle');
  const revision = useRef(Number(attempt?.draft?.revision) || 0);
  const timer = useRef(null);
  const first = useRef(true);
  const stopped = useRef(false);
  const pending = useRef(null);

  const send = useCallback(async (keys, retried = false) => {
    if (stopped.current || !attempt?.uid || !save) return;
    const next = revision.current + 1;
    revision.current = next;
    setState('saving');
    try {
      await save(examUid, attempt.uid, answerIndexes(questions, keys), next);
      pending.current = null;
      setState('saved');
    } catch (err) {
      const code = err?.code || err?.data?.code;
      if (code === 'stale_revision' && !retried) {
        revision.current = Math.max(revision.current, Number(err?.data?.draft?.revision ?? err?.draft?.revision) || revision.current);
        return send(keys, true);
      }
      if (code === 'already_submitted' || code === 'time_limit_passed') { stopped.current = true; setState('closed'); return; }
      pending.current = keys;
      setState('failed');
    }
  }, [attempt?.uid, examUid, questions, save]);

  useEffect(() => {
    // The choices the attempt opened with are not news.
    if (first.current) { first.current = false; return undefined; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; send(answers); }, hold);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [answers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Offline, then back: what failed is sent again.
  useEffect(() => {
    const back = () => { if (pending.current) send(pending.current); };
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [send]);

  return { state, words: SERVER_WORDS[state] || '' };
}
