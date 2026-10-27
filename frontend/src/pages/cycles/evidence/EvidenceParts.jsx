/**
 * D1266 (#3289) — the small parts every Evidence surface draws: a claim's state,
 * a Source label, a strength, a sharing level and Stale as the canvas's pills
 * (VR1–VR5), the drawer an address opens (VR2, VR3), and the in-page dialog
 * every change opens before it is made. No browser pop-up anywhere.
 */
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lightbox } from '../../../ui';
import Sheet from '../../../ui/Sheet.jsx';
import { CLAIM_STATE } from './evidenceModel';
import { day, providerWord, sharingWord, sourceWord } from './evidenceView';

export const CARD = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
export const H2 = 'm-0 text-[15px] font-bold text-axal-ink dark:text-gray-100';
export const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
export const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold disabled:opacity-50';
export const BTN_S = `${BTN} border-axal-hairline bg-white text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
export const BTN_L = `${BTN} border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-900/50`;
export const BTN_P = `${BTN} border-axal-violet bg-axal-violet text-white hover:bg-axal-violet-deep dark:hover:bg-violet-500`;
export const BTN_D = `${BTN} border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/40`;
export const LINK = 'text-[12.5px] font-semibold text-axal-violet underline-offset-2 hover:underline dark:text-violet-300 dark:hover:text-violet-200';

const PILL = 'inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold';
const STATE_TONE = {
  backed: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  founders_figure: 'border-axal-hairline bg-gray-50 text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  mismatch: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  not_backed: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
};
/** A claim's state, as the Worker decided it. An unknown state is "Not checked yet". */
export function StatePill({ state }) {
  const word = CLAIM_STATE[state] || 'Not checked yet';
  return <span className={`${PILL} ${STATE_TONE[state] || 'border-dashed border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400'}`} data-testid="claim-state" data-state={state || 'unchecked'}>{word}</span>;
}
export function StalePill() {
  return <span className={`${PILL} border-dashed border-amber-300 bg-white text-amber-800 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-300`} data-testid="evidence-stale">Stale</span>;
}
export function ChangedPill() {
  return <span className={`${PILL} border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300`} data-testid="evidence-changed">Changed since pinned</span>;
}
const SOURCE_DOT = { connector: 'bg-violet-600 dark:bg-violet-400', document: 'bg-sky-500', recorded: 'bg-amber-500', signed: 'bg-emerald-500', typed: 'bg-gray-500' };
/** A Source label, set by code from the record, with what it names beside it. */
export function SourcePill({ source, provider, on, rest }) {
  const word = sourceWord(source);
  if (!word) return <span className="text-[12px] italic text-axal-muted dark:text-gray-400" data-testid="evidence-source" data-source="none">No record of this kind on StudioOS</span>;
  const detail = rest ?? [providerWord(provider), day(on) ? `as of ${day(on)}` : null].filter(Boolean).join(' · ');
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-axal-ink dark:text-gray-200" data-testid="evidence-source" data-source={source}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${SOURCE_DOT[source]}`} />
      <span className="font-semibold">{word}</span>{detail ? <span className="text-axal-muted dark:text-gray-400">· {detail}</span> : null}
    </span>
  );
}
export function StrengthMark({ strength }) {
  const n = { anecdote: 1, pattern: 2, measured: 3 }[strength];
  if (!n) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="evidence-strength">
      <span aria-hidden="true" className="inline-flex gap-0.5">{[1, 2, 3].map((i) => <span key={i} className={`h-2.5 w-1 rounded-sm ${i <= n ? 'bg-axal-violet dark:bg-violet-400' : 'bg-gray-200 dark:bg-gray-700'}`} />)}</span>
      Strength: {strength[0].toUpperCase() + strength.slice(1)}
    </span>
  );
}
export function SharingPill({ visibility }) {
  const word = sharingWord(visibility);
  if (!word) return null;
  const tone = visibility === 'after_nda' ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300'
    : visibility === 'summary' ? 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
      : 'border-axal-hairline bg-gray-50 text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400';
  return <span className={`${PILL} ${tone}`} data-testid="evidence-sharing" data-sharing={visibility}>{word}</span>;
}

/** A block the read could not answer: its own sentence and its own Try again, never a zero. */
export function BlockUnreadable({ id, reason, onRetry }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" data-testid={`evidence-unreadable-${id}`}>
      <span>Unreadable. {reason || 'This block could not be read.'}</span>
      {onRetry ? <button type="button" className={BTN_S} onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

/**
 * Every change opens this first: what it changes, in words, then Confirm. A
 * refusal shows the Worker's own sentence and changes nothing.
 */
export function ChangeDialog({ title, says, confirm = 'Confirm', danger = false, onConfirm, onClose, children = null, testId = 'evidence-change' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { await onConfirm(); onClose(); }
    catch (e) { setError(e?.message || 'Nothing was saved. Try again.'); setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} onClose={busy ? () => {} : onClose} width={520} phone="sheet" testId={testId}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_S} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={danger ? BTN_D : BTN_P} onClick={go} disabled={busy} data-testid={`${testId}-confirm`}>{busy ? 'Saving…' : confirm}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13.5px] text-axal-ink dark:text-gray-100" data-testid={`${testId}-says`}>{says}</p>
        {children}
        {error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid={`${testId}-error`}>{error}</p> : null}
      </div>
    </Lightbox>
  );
}

/**
 * VR2, VR3: a drawer named by the address, drawn as the shared Sheet at the
 * canvas's 480 (D1317). Closing goes back to the view, keeping the query.
 * The link keeps that address in the markup; the sheet's own close does too.
 */
export function Drawer({ label, eyebrow, title, closeTo, children, footer = null, testId }) {
  const navigate = useNavigate();
  return (
    <Sheet label={label} eyebrow={eyebrow} title={title} width={480} onClose={() => navigate(closeTo)} testId={testId}
      footer={(
        <>
          {footer}
          <Link to={closeTo} className={LINK}>Back to evidence</Link>
        </>
      )}>
      <div className="flex flex-col divide-y divide-axal-hairline px-5 dark:divide-gray-800">{children}</div>
    </Sheet>
  );
}
export function Section({ title, children, testId }) {
  return (
    <section className="flex flex-col gap-2 py-4" data-testid={testId}>
      {title ? <h3 className="m-0 text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">{title}</h3> : null}
      {children}
    </section>
  );
}
