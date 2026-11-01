import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { deckCheckApi } from '../../../lib/api/deckCheck';
import { raiseEvidenceApi } from '../../../lib/api/raiseEvidence';
import { reportError } from '../../../lib/log';
import { Lightbox, Pill } from '../../../ui';
import {
  CHECK_INTRO, CONSISTENCY_EMPTY, CONSISTENCY_FAILED, CONSISTENCY_TITLE, DIRTY_FIRST, NEITHER_RIGHT, NOTE_MAX, STATE_LABELS, STATE_TONE,
  cardsLabel, checkNote, checkPills, claimLine, consistencyView, lastChecked, recordSource,
  isFounderOnly, mayRunCheck, refusalText, sortClaims, summaryLine, useRecordLabel,
} from './checkModel';

/**
 * D900 (#2679, part 6 of #2434) — PD13, the editor's Check panel.
 *
 * For the venture's founder it runs the check on this version when it opens
 * (`POST /api/decks/:id/check`, D1264's claim check: patterns, never a model),
 * and again on Run the check. Anyone else reads the last check's states.
 *
 * #3657: who is the founder is the check read's answer. The panel reads first
 * (`GET`, whose `can_check` is the Worker's), and runs only on `can_check:
 * true`. Editing a deck (HQ may, #3637) never makes a reader the founder: no
 * POST, no Run the check, and a `founder_only` refusal turns the panel to the
 * read view instead of offering Try again.
 *
 *   the counts      "12 figures: 9 Backed, 1 Mismatch …" and "Last checked"
 *   each figure     its card, its state and what that means; a Mismatch shows
 *                   both figures and both sources, presuming neither right
 *   Use [X]'s figure  a dialog, then a new version with the record's figure
 *                   (only when nothing is unsaved: the editor's changes would
 *                   be lost under the new version)
 *   Keep mine, with a note  a dialog; the figure stays a Mismatch, with the note
 *   Open Evidence ›  the claim on its own page
 *
 * D1555 (#3802): "Consistency · free", the deck's own figures card against
 * card (one value per metric, use of funds = raise, runway = cash ÷ burn, the
 * round's terms, forecast year 1 = ARR). It comes in the same reply, needs no
 * model and so works with AI off; each finding names its cards with "Go to
 * card ›". It failed: "Could not be read." with Try again. None: "Every
 * figure is linked and consistent."
 */
const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-50`;
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LINK = 'text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300';

export default function CheckPanel({ deck, projectId, readOnly, dirty, onReplaced, onGoToCard }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [dialog, setDialog] = useState(null);
  const run = useCallback(async (write) => {
    setState((s) => ({ status: 'loading', data: s.data, error: null }));
    try {
      const data = write ? await deckCheckApi.run(deck.id) : await deckCheckApi.read(deck.id);
      setState({ status: 'ok', data, error: null });
    } catch (e) {
      reportError('pitch-editor:check', e);
      if (write && isFounderOnly(e)) { setState((s) => ({ status: 'ok', data: { ...(s.data || {}), can_check: false }, error: null })); return; }
      setState((s) => ({ status: 'error', data: s.data, error: refusalText(e, 'The check could not be run.') }));
    }
  }, [deck.id]);
  // Read first; the founder's check runs only when the read says so.
  const open = useCallback(async () => {
    setState({ status: 'loading', data: null, error: null });
    let data;
    try { data = await deckCheckApi.read(deck.id); } catch (e) {
      reportError('pitch-editor:check', e);
      setState({ status: 'error', data: null, error: refusalText(e, 'The check could not be read.') });
      return;
    }
    if (mayRunCheck(data, readOnly)) { setState({ status: 'loading', data, error: null }); await run(true); return; }
    setState({ status: 'ok', data, error: null });
  }, [deck.id, readOnly, run]);
  useEffect(() => { open(); }, [open]);

  const data = state.data;
  const canCheck = mayRunCheck(data, readOnly);
  const claims = sortClaims(data?.claims);
  const consistency = data ? consistencyView(data.consistency) : { kind: 'none', rows: [] };
  return (
    <div className="flex flex-col gap-3" data-testid="pitch-check">
      <span className={MUTED}>{CHECK_INTRO}</span>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400" data-testid="pitch-check-last">{lastChecked(data?.checked_at)}</span>
        {canCheck ? (
          <button type="button" className={GHOST} disabled={state.status === 'loading'} onClick={() => run(true)} data-testid="pitch-check-run">
            <RefreshCw size={14} aria-hidden="true" /> Run the check
          </button>
        ) : null}
      </div>
      {state.status === 'loading' && !data ? <span className={MUTED} data-testid="pitch-check-loading">Checking…</span> : null}
      {state.status === 'error' ? (
        <div role="alert" className="flex flex-col gap-2" data-testid="pitch-check-error">
          <span className="text-[12.5px] text-red-700 dark:text-red-300">{state.error}</span>
          <button type="button" className={`${GHOST} self-start`} onClick={() => (data ? run(canCheck) : open())} data-testid="pitch-check-retry">Try again</button>
        </div>
      ) : null}
      {data && data.checked === false && !canCheck ? <span className={MUTED} data-testid="pitch-check-never">This version has not been checked yet. The venture’s founder runs the check.</span> : null}
      {data && (data.checked !== false || canCheck) && summaryLine(data.counts, data.figures) ? (
        <div className="flex flex-col gap-2" data-testid="pitch-check-summary">
          <span className={`text-[13px] font-bold ${INK}`}>{summaryLine(data.counts, data.figures)}</span>
          <div className="flex flex-wrap gap-1.5">
            {checkPills(data.counts).map((p) => <Pill key={p.key} tone={p.tone}>{p.label}</Pill>)}
          </div>
        </div>
      ) : null}
      {claims.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="pitch-check-rows">
          {claims.map((c) => (
            <li key={c.uid} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid={`pitch-check-row-${c.uid}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-[12.5px] font-bold ${INK}`}>{c.label}{c.slide ? <span className="font-normal text-axal-muted dark:text-gray-400"> · card {c.slide}</span> : null}</span>
                <Pill tone={STATE_TONE[c.display_state] || 'neutral'}>{STATE_LABELS[c.display_state] || STATE_LABELS.not_backed}</Pill>
              </div>
              {c.state === 'mismatch' && c.record ? (
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]" data-testid={`pitch-check-figures-${c.uid}`}>
                  <dt className="text-axal-muted dark:text-gray-400">Your card</dt><dd className={`m-0 font-mono ${INK}`}>{c.stated_shown ?? 'Not recorded'}</dd>
                  <dt className="text-axal-muted dark:text-gray-400">{recordSource(c.record)}</dt>
                  <dd className={`m-0 font-mono ${INK}`}>{c.record.shown ?? 'Not recorded'}{c.record.observed_on ? <span className="text-axal-muted dark:text-gray-400"> · {c.record.observed_on}</span> : null}</dd>
                </dl>
              ) : null}
              <span className={MUTED}>{claimLine(c)}</span>
              {c.note ? <span className="rounded-[8px] bg-axal-ground px-2.5 py-1.5 text-[12px] text-axal-ink dark:bg-gray-800 dark:text-gray-100" data-testid={`pitch-check-note-${c.uid}`}>{`Kept, with your note: ${c.note.text}`}</span> : null}
              {c.note_outdated ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">Your earlier note was about another figure, so it no longer applies.</span> : null}
              <div className="flex flex-wrap items-center gap-2">
                {canCheck && c.state === 'mismatch' && c.record ? (
                  <>
                    <button type="button" className={GHOST} onClick={() => setDialog({ kind: 'use', claim: c })} data-testid={`pitch-check-use-${c.uid}`}>{useRecordLabel(c.record)}</button>
                    {!c.note ? <button type="button" className={GHOST} onClick={() => setDialog({ kind: 'keep', claim: c })} data-testid={`pitch-check-keep-${c.uid}`}>Keep mine, with a note</button> : null}
                  </>
                ) : null}
                <Link className={LINK} to={`/raise/evidence/claim/${encodeURIComponent(c.uid)}?project=${encodeURIComponent(projectId ?? '')}`} data-testid={`pitch-check-evidence-${c.uid}`}>Open Evidence ›</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {consistency.kind !== 'none' ? (
        <section className="flex flex-col gap-2" aria-label={CONSISTENCY_TITLE} data-testid="pitch-check-consistency">
          <span className={EYE}>{CONSISTENCY_TITLE}</span>
          {consistency.kind === 'unreadable' ? (
            <div role="alert" className="flex flex-wrap items-center gap-2" data-testid="pitch-check-consistency-failed">
              <span className="text-[12.5px] text-red-700 dark:text-red-300">{CONSISTENCY_FAILED}</span>
              <button type="button" className={GHOST} onClick={() => run(canCheck)} data-testid="pitch-check-consistency-retry">Try again</button>
            </div>
          ) : null}
          {consistency.kind === 'empty' ? <span className={MUTED} data-testid="pitch-check-consistency-empty">{CONSISTENCY_EMPTY}</span> : null}
          {consistency.kind === 'findings' ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="pitch-check-consistency-rows">
              {consistency.rows.map((f) => (
                <li key={f.key} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid={`pitch-check-consistency-${f.key}`}>
                  <span className={`text-[12.5px] ${INK}`}>{f.message}</span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{cardsLabel(f.cards)}</span>
                    {onGoToCard ? f.cards.map((n) => (
                      <button key={n} type="button" className={LINK} onClick={() => onGoToCard(n - 1)} data-testid={`pitch-check-consistency-go-${f.key}-${n}`}>
                        {f.cards.length > 1 ? `Go to card ${n} ›` : 'Go to card ›'}
                      </button>
                    )) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {dialog?.kind === 'use' ? (
        <UseRecordDialog deck={deck} claim={dialog.claim} dirty={dirty} onClose={() => setDialog(null)}
          onDone={(fresh) => { setDialog(null); onReplaced?.(fresh); }} />
      ) : null}
      {dialog?.kind === 'keep' ? (
        <KeepDialog projectId={projectId} claim={dialog.claim} onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); run(true); }} />
      ) : null}
    </div>
  );
}

/** "Use Stripe’s figure": what changes, then a new version with the record's figure. */
function UseRecordDialog({ deck, claim, dirty, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const who = recordSource(claim.record);
  const go = () => {
    setBusy(true); setError(null);
    deckCheckApi.useRecord(deck.id, claim.uid, claim.record.value).then(
      (r) => { setBusy(false); onDone(r?.deck || r); },
      (e) => { setBusy(false); setError(refusalText(e, 'The figure could not be replaced.')); reportError('pitch-editor:use-record', e); },
    );
  };
  return (
    <Lightbox label={useRecordLabel(claim.record)} title={useRecordLabel(claim.record)} width={520} onClose={onClose} testId="pitch-check-use-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={go} disabled={busy || dirty} data-testid="pitch-check-use-confirm">{`Save a version with ${claim.record.shown}`}</button>
        </div>
      )}>
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5">
        <li className={`text-[13px] ${INK}`}>{`Card ${claim.slide} says ${claim.stated_shown}. ${who} says ${claim.record.shown}${claim.record.observed_on ? `, as of ${claim.record.observed_on}` : ''}.`}</li>
        <li className={`text-[13px] ${INK}`}>{`${claim.stated_shown} becomes ${claim.record.shown} on card ${claim.slide}, and a new version is saved. This version stays as it is.`}</li>
      </ul>
      {dirty ? <p className="mt-3 text-[12.5px] font-bold text-amber-700 dark:text-amber-300" data-testid="pitch-check-use-dirty">{DIRTY_FIRST}</p> : null}
      {error ? <p role="alert" className="mt-3 text-[12.5px] text-red-700 dark:text-red-300" data-testid="pitch-check-use-error">{error}</p> : null}
    </Lightbox>
  );
}

/** "Keep mine, with a note": the figure stays as typed, still a Mismatch, with why. */
function KeepDialog({ projectId, claim, onClose, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = () => {
    const out = checkNote(text);
    if (out.error) { setError(out.error); return; }
    setBusy(true); setError(null);
    raiseEvidenceApi.note(projectId, claim.uid, out.note).then(
      () => { setBusy(false); onDone(); },
      (e) => { setBusy(false); setError(refusalText(e, 'The note could not be saved.')); reportError('pitch-editor:keep-note', e); },
    );
  };
  return (
    <Lightbox label="Keep mine, with a note" title="Keep mine, with a note" width={520} onClose={onClose} testId="pitch-check-keep-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={go} disabled={busy} data-testid="pitch-check-keep-confirm">Keep my figure</button>
        </div>
      )}>
      <div className="flex flex-col gap-2">
        <span className={`text-[13px] ${INK}`}>{`Card ${claim.slide} keeps ${claim.stated_shown}. It stays a Mismatch with ${recordSource(claim.record)}’s ${claim.record?.shown}, shown with your note. ${NEITHER_RIGHT}`}</span>
        <label className="flex flex-col gap-1">
          <span className={EYE}>Why you keep it</span>
          <textarea className={`${FIELD} min-h-[80px]`} value={text} maxLength={NOTE_MAX} onChange={(e) => setText(e.target.value)} data-testid="pitch-check-keep-note" />
        </label>
        {error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="pitch-check-keep-error">{error}</p> : null}
      </div>
    </Lightbox>
  );
}
