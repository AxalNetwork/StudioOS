import React, { useEffect, useRef, useState } from 'react';
import { useEscapeClose } from '../../../components/useEscapeClose';
import {
  CONFIRM_LINE, NOT_KNOWN, NOT_KNOWN_WHY, accountOn, actionsOf, failedLine, placesWord, providerOf, retractNote, statusOf, viewLink,
} from './publishModel.js';

/**
 * D1321 (#3482) — the parts the sheet, the result and the history share: a
 * provider's tile, a status pill, the confirm (PUB4, PUB10B), Mark as not
 * sent (PUB6), Retract (PUB7), and one send's actions. Every dialog is the
 * page's own (no `window.confirm`); Escape closes the one on top; focus
 * starts on Cancel.
 */

export const MUTED = 'text-axal-muted dark:text-gray-400';
export const EYEBROW = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3.5 text-[13px] font-bold disabled:cursor-not-allowed';
export const BTN_PRIMARY = `${BTN} bg-violet-600 text-white hover:bg-violet-700 disabled:bg-[#ece9f2] disabled:text-[#5f5a69] dark:bg-violet-500 dark:hover:bg-violet-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-400`;
export const BTN_SECONDARY = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
export const BTN_TEXT = `${BTN} px-2 text-violet-700 hover:underline dark:text-violet-300`;
export const BTN_NEG = `${BTN} bg-red-700 text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500`;
export const BTN_NEG_O = `${BTN} border border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950`;
export const LINK = 'inline-flex min-h-[44px] items-center whitespace-nowrap text-[12.5px] font-bold text-violet-700 hover:underline dark:text-violet-300';
export const AMBER_BOX = 'rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] font-semibold text-amber-900 dark:border-amber-500/50 dark:bg-amber-400/10 dark:text-amber-200';
export const LAV_BOX = 'rounded-[10px] border border-violet-200 bg-violet-50 px-3 py-2.5 text-[12.5px] text-axal-ink dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-gray-100';

const TILE = {
  X: 'bg-zinc-900 text-white dark:bg-gray-200 dark:text-gray-900',
  B: 'bg-amber-100 text-amber-900 dark:bg-amber-400/20 dark:text-amber-300',
  f: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-300',
  T: 'bg-zinc-800 text-white dark:bg-gray-700',
};
/** A provider's letter tile. Decorative: the account's name beside it says which. */
export function Tile({ provider, size = 26 }) {
  const { letter } = providerOf(provider);
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.5), borderRadius: Math.round(size * 0.27) }}
      className={`grid flex-none place-items-center font-extrabold leading-none ${TILE[letter] || 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100'}`}>{letter}</span>
  );
}

const TONE = {
  pos: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300',
  neg: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-300',
  amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-200',
  violet: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-300',
  muted: 'border-axal-hairline bg-transparent text-axal-muted dark:border-gray-700 dark:text-gray-400',
};
/** A send's status: a glyph and a word, never colour alone. */
export function StatusPill({ status, testId }) {
  const s = typeof status === 'string' ? statusOf(status) : status;
  return (
    <span className={`inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11.5px] font-semibold ${TONE[s.tone]}`} data-testid={testId}>
      <span aria-hidden="true">{s.glyph}</span>{s.word}
    </span>
  );
}

/** A centred dialog on the desk, a bottom sheet on a phone (PUB10B). */
export function Dialog({ title, onCancel, children, actions, testId, width = 540 }) {
  useEscapeClose(onCancel);
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" data-testid={`${testId}-backdrop`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`} style={{ maxWidth: width }}
        className="flex max-h-[90vh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl border border-axal-hairline bg-white p-5 shadow-[0_22px_60px_rgba(9,9,11,.18)] dark:border-gray-700 dark:bg-gray-900 sm:rounded-2xl sm:p-6"
        data-testid={testId}>
        <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-axal-hairline sm:hidden dark:bg-gray-700" />
        <h2 id={`${testId}-title`} className="m-0 text-[18px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{title}</h2>
        {children}
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">{actions}</div>
      </div>
    </div>
  );
}

/** Cancel, focused when the dialog opens. */
function useFirstFocus() {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus?.(); }, []);
  return ref;
}

/** The press, once: busy while it runs, its refusal printed, the dialog left open on one. */
function usePress(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A ref, not the state: two presses in one tick both read the state before it changes.
  const held = useRef(false);
  const go = async () => {
    if (held.current) return;
    held.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e?.message || 'That did not finish. Nothing was sent.'); setBusy(false); held.current = false; }
  };
  return { busy, error, go };
}
const Refusal = ({ error, testId }) => (error ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid={testId}>{error}</p> : null);

/**
 * PUB4: "Send to 3 places?" Every account and audience it will reach, and the
 * one line. Send is the only thing that publishes, and it is pressed here.
 */
export function ConfirmSend({ rows, onCancel, onSend }) {
  const cancel = useFirstFocus();
  const { busy, error, go } = usePress(onSend);
  const n = placesWord(rows.length);
  return (
    <Dialog title={`Send to ${n}?`} onCancel={onCancel} testId="publish-confirm" actions={(<>
      <button type="button" ref={cancel} className={BTN_SECONDARY} onClick={onCancel} data-testid="publish-confirm-cancel">Cancel</button>
      <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={go} data-testid="publish-confirm-send">{busy ? 'Sending…' : `Send to ${n}`}</button>
    </>)}>
      <ul className="m-0 list-none overflow-hidden rounded-xl border border-axal-hairline p-0 dark:border-gray-700" data-testid="publish-confirm-rows">
        {rows.map((r) => (
          <li key={r.uid} className="flex items-center gap-3 border-t border-axal-hairline px-3.5 py-3 first:border-t-0 dark:border-gray-700" data-testid={`publish-confirm-row-${r.uid}`}>
            <Tile provider={r.provider_key} />
            <div className="min-w-0 flex-1"><div className="font-bold text-axal-ink dark:text-gray-100">{r.title}</div><div className={`text-[12px] ${MUTED}`}>{r.line}</div></div>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[13.5px] text-axal-ink dark:text-gray-100">{CONFIRM_LINE}</p>
      <Refusal error={error} testId="publish-confirm-error" />
    </Dialog>
  );
}

/** PUB6's dialog: it may post twice, and it says so. */
export function MarkNotSentDialog({ send, onCancel, onMark }) {
  const cancel = useFirstFocus();
  const { busy, error, go } = usePress(onMark);
  const p = providerOf(send.provider_key).name;
  return (
    <Dialog title="Mark as not sent?" width={480} onCancel={onCancel} testId="publish-not-sent" actions={(<>
      <button type="button" ref={cancel} className={BTN_SECONDARY} onClick={onCancel} data-testid="publish-not-sent-cancel">Cancel</button>
      <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={go} data-testid="publish-not-sent-yes">Mark as not sent</button>
    </>)}>
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">Do this only after you checked {p} and the post is not there.</p>
      <div className={AMBER_BOX}>If it did arrive, sending it again posts it twice.</div>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>The history then reads “Marked not sent”, and Retry opens the confirm step again.</p>
      <Refusal error={error} testId="publish-not-sent-error" />
    </Dialog>
  );
}

/** PUB7: delete where the place lets Axal VC. */
export function RetractDialog({ send, onCancel, onRetract }) {
  const cancel = useFirstFocus();
  const { busy, error, go } = usePress(onRetract);
  return (
    <Dialog title={`Delete this post from ${accountOn(send.destination, send.provider_key)}?`} width={480} onCancel={onCancel} testId="publish-retract" actions={(<>
      <button type="button" ref={cancel} className={BTN_SECONDARY} onClick={onCancel} data-testid="publish-retract-cancel">Cancel</button>
      <button type="button" className={BTN_NEG} disabled={busy} onClick={go} data-testid="publish-retract-yes">{busy ? 'Deleting…' : 'Delete post'}</button>
    </>)}>
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">People who saw it may have copied it.</p>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>The row then reads Retracted. Your text stays in the history.</p>
      <Refusal error={error} testId="publish-retract-error" />
    </Dialog>
  );
}

/**
 * One send's state and what may be done with it, for the result and the
 * detail. A failed send has its reason and Retry (which opens the confirm
 * again, for that place only); an outcome not known has PUB6's words, Check
 * and Mark as not sent, and never Retry; a sent post that Axal VC cannot
 * delete has PUB7's "Delete it on X ↗" and Mark as removed.
 */
export function SendActions({ send, canPublish, api, onChanged, onRetry, compact = false }) {
  const [asking, setAsking] = useState(null);
  const [note, setNote] = useState('');
  const act = actionsOf(send, canPublish);
  const p = providerOf(send.provider_key).name;
  const link = viewLink(send);
  const run = (fn) => async () => {
    setNote('');
    try { const r = await fn(); if (r?.found === false) setNote(`${p} did not find this post.`); onChanged?.(r?.send || null); } catch (e) { setNote(e?.message || 'That did not finish.'); }
  };
  return (
    <div className="flex flex-col gap-2" data-testid={`publish-actions-${send.uid}`}>
      {send.status === 'failed' && <div className="text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid={`publish-failed-${send.uid}`}>{failedLine(send)}</div>}
      {send.status === 'unknown' && (<>
        <div className={AMBER_BOX} data-testid={`publish-unknown-${send.uid}`}>{NOT_KNOWN(p)}</div>
        {!compact && <p className={`m-0 text-[12.5px] ${MUTED}`}>{NOT_KNOWN_WHY(p)}</p>}
      </>)}
      {act.markRemoved && !compact && <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{retractNote(send)}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {link && compact && <a href={link.href} target="_blank" rel="noopener noreferrer" className={LINK}>{link.label}</a>}
        {act.retry && onRetry && <button type="button" className={BTN_SECONDARY} onClick={() => onRetry(send)} data-testid={`publish-retry-${send.uid}`}>Retry</button>}
        {act.check && <button type="button" className={BTN_SECONDARY} onClick={run(() => api.check(send.uid))} data-testid={`publish-check-${send.uid}`}>Check {p}</button>}
        {act.markNotSent && <button type="button" className={BTN_TEXT} onClick={() => setAsking('not-sent')} data-testid={`publish-mark-not-sent-${send.uid}`}>Mark as not sent</button>}
        {act.deleteOutside && !compact && <a href={send.external_url} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>Delete it on {p} ↗</a>}
        {act.markRemoved && !compact && <button type="button" className={BTN_SECONDARY} onClick={run(() => api.markRemoved(send.uid))} data-testid={`publish-mark-removed-${send.uid}`}>Mark as removed</button>}
        {act.retract && !compact && <button type="button" className={BTN_NEG_O} onClick={() => setAsking('retract')} data-testid={`publish-retract-open-${send.uid}`}>Retract…</button>}
      </div>
      {note && <p role="status" className={`m-0 text-[12.5px] ${MUTED}`} data-testid={`publish-note-${send.uid}`}>{note}</p>}
      {asking === 'not-sent' && <MarkNotSentDialog send={send} onCancel={() => setAsking(null)} onMark={async () => { const r = await api.markNotSent(send.uid); setAsking(null); onChanged?.(r?.send || null); }} />}
      {asking === 'retract' && <RetractDialog send={send} onCancel={() => setAsking(null)} onRetract={async () => { const r = await api.retract(send.uid); setAsking(null); onChanged?.(r?.send || null); }} />}
    </div>
  );
}
