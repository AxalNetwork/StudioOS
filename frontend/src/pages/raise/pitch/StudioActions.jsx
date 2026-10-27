import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { railPressHeaders } from '../../../lib/railPage';
import { Lightbox } from '../../../ui';
import { useRailOption } from '../../../ui/railCrumbs';
import { NEW_PATH } from './newDeckModel';
import {
  BRANDING_FAILED, BRANDING_TITLE, FILL_SENTENCE, FILL_TITLE, READINESS_FAILED, READINESS_TITLE, WATERMARK_BAD, WATERMARK_PLAN,
  brandingView, fillRefusal, isSpinoutDeck, proposalHref, readinessView, watermarkInput, watermarkSentence,
} from './studioActionsModel';

/**
 * D898 group E (#2676) — the old template builder's four actions, each now a
 * studio action (the owner's call, 2026-10-27). The builder is retired;
 * `/raise/pitch/builder` opens the studio.
 *
 *   FillFromProject   on the Decks tab's current deck. Its proposal is kept
 *                     card by card at New deck's step 4, as a template start's is.
 *   SpinoutReadiness  beside it, for a Spin-Out deck: what is still empty, and
 *                     whether an export is a draft. A read.
 *   BrandingCard      beside it: the plan, the footer and the watermark, which
 *                     a Studio plan changes behind a dialog.
 *   (Recommended)     New deck's Start from marks the recommended template
 *                     (`NewDeck.jsx`, `markRecommended`).
 *
 * Every write opens a dialog that says what it changes, and is one
 * `raise.pitch-deck` line on the venture's activity (the Worker writes it).
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold disabled:opacity-50';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const PILL = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILL_OK = `${PILL} border-emerald-200 bg-emerald-50 text-axal-positive dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`;
const PILL_AMBER = `${PILL} border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200`;
const INPUT = 'w-full rounded-[8px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const SKEL = 'animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800';

/** The dialog every write here opens: what it changes, then Confirm or Cancel. */
function Confirm({ title, sentence, action, busy, onConfirm, onClose, testId }) {
  return (
    <Lightbox label={title} title={title} width={520} onClose={() => !busy && onClose()} testId={testId}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={onConfirm} disabled={busy} data-testid={`${testId}-confirm`}>{busy ? 'Working…' : action}</button>
        </div>
      )}>
      <p className={`m-0 ${MUTED}`}>{sentence}</p>
    </Lightbox>
  );
}

function Refusal({ refusal, testId }) {
  if (!refusal) return null;
  return (
    <span role="alert" className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-axal-violet dark:text-violet-300" data-testid={testId}>
      {refusal.message}
      {refusal.link ? <Link to={refusal.link.href} className="underline">{refusal.link.text}</Link> : null}
      {refusal.topUp ? <a href={refusal.topUp.href} className="underline">{refusal.topUp.text}</a> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Fill from project
// ---------------------------------------------------------------------------

/** "Fill from project": the deck's template filled again as a proposal, reviewed at New deck. */
export function FillFromProject({ deck, q }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  // D771: the rail names the option while its run is at the model.
  useRailOption(busy ? 'form:deck' : null, FILL_TITLE);
  const fill = async () => {
    setBusy(true); setRefusal(null);
    try {
      const r = await api.deckAutofill(deck.id, railPressHeaders('form:deck'));
      if (!r?.proposal?.id) throw new Error('No proposal came back.');
      navigate(proposalHref(NEW_PATH, q, r.proposal.id));
    } catch (e) {
      setRefusal(fillRefusal(e, `${NEW_PATH}${q}`)); setOpen(false);
      if (e?.status !== 409 && e?.status !== 402) reportError('pitch-studio:fill', e);
    } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className={GHOST} onClick={() => setOpen(true)} data-testid="pitch-studio-fill">{FILL_TITLE}</button>
      <Refusal refusal={refusal} testId="pitch-studio-fill-refusal" />
      {open ? (
        <Confirm title={FILL_TITLE} sentence={FILL_SENTENCE} action="Fill" busy={busy} onConfirm={fill} onClose={() => setOpen(false)} testId="pitch-studio-fill-dialog" />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Spin-Out readiness
// ---------------------------------------------------------------------------

/** For a Spin-Out deck: what is still empty, and whether an export is a draft. Draws nothing for any other deck. */
export function SpinoutReadiness({ projectId, deck }) {
  const spinout = isSpinoutDeck(deck);
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!spinout || projectId == null) return undefined;
    let live = true;
    setState({ status: 'loading', data: null });
    api.spinoutDeckPreview(projectId).then(
      (d) => { if (live) setState({ status: 'ok', data: d }); },
      (e) => { if (live) setState({ status: 'error', data: null, error: e }); if (e?.status !== 402) reportError('pitch-studio:readiness', e); },
    );
    return () => { live = false; };
  }, [spinout, projectId, tick]);
  if (!spinout || projectId == null) return null;
  const view = state.status === 'ok' ? readinessView(state.data) : null;
  return (
    <section className={`${CARD} flex flex-col gap-2 p-4`} data-testid="pitch-studio-readiness">
      <span className={EYE}>{READINESS_TITLE}</span>
      {state.status === 'loading' ? <div className={`${SKEL} h-14 w-full`} aria-hidden="true" /> : null}
      {state.status === 'error' ? (
        <div role="alert" className="flex flex-col gap-2" data-testid="pitch-studio-readiness-error">
          <span className={MUTED}>{state.error?.status === 402 && state.error?.message ? state.error.message : READINESS_FAILED}</span>
          {state.error?.status !== 402 ? <button type="button" className={`${GHOST} self-start`} onClick={() => setTick((t) => t + 1)}><RefreshCw size={14} aria-hidden="true" /> Try again</button> : null}
        </div>
      ) : null}
      {view && view.state !== 'hidden' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[13.5px] font-bold ${INK}`} data-testid="pitch-studio-readiness-title">{view.title}</span>
            <span className={view.state === 'ready' ? PILL_OK : PILL_AMBER}>{view.state === 'ready' ? 'Final' : 'Draft'}</span>
          </div>
          <span className={MUTED}>{view.line}</span>
          {view.gaps.length ? (
            <ul className="m-0 flex list-none flex-col p-0" data-testid="pitch-studio-readiness-gaps">
              {view.gaps.map((g) => (
                <li key={g} className={`border-t border-axal-hairline py-1.5 text-[12.5px] first:border-t-0 dark:border-gray-700 ${INK}`}>{g}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

/** The plan, the footer and the watermark; a Studio plan changes the watermark behind a dialog. */
export function BrandingCard({ projectId, readOnly }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', data: null });
    api.deckMethods().then(
      (d) => { if (live) { setState({ status: 'ok', data: d }); setDraft(d?.watermark_url || ''); } },
      (e) => { if (live) setState({ status: 'error', data: null }); reportError('pitch-studio:branding', e); },
    );
    return () => { live = false; };
  }, [tick]);
  const view = state.status === 'ok' ? brandingView(state.data) : null;
  const next = watermarkInput(draft);

  const save = async (url) => {
    setBusy(true); setRefusal(null);
    try {
      const r = await api.deckSetWatermark(url, projectId);
      const saved = r?.brand?.watermark_url || '';
      setState((s) => ({ ...s, data: { ...s.data, watermark_url: saved } }));
      setDraft(saved);
      setDialog(null);
    } catch (e) {
      setRefusal({ message: e?.message || 'The watermark was not changed.' }); setDialog(null);
      reportError('pitch-studio:watermark', e);
    } finally { setBusy(false); }
  };

  return (
    <section className={`${CARD} flex flex-col gap-2 p-4`} data-testid="pitch-studio-branding">
      <span className={EYE}>{BRANDING_TITLE}</span>
      {state.status === 'loading' ? <div className={`${SKEL} h-14 w-full`} aria-hidden="true" /> : null}
      {state.status === 'error' ? (
        <div role="alert" className="flex flex-col gap-2" data-testid="pitch-studio-branding-error">
          <span className={MUTED}>{BRANDING_FAILED}</span>
          <button type="button" className={`${GHOST} self-start`} onClick={() => setTick((t) => t + 1)}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
        </div>
      ) : null}
      {view ? (
        <>
          <span className={`text-[12.5px] ${INK}`}>Plan: <span className="font-bold" data-testid="pitch-studio-branding-plan">{view.plan}</span></span>
          <span className={MUTED}>{view.footer}</span>
          <span className={MUTED} data-testid="pitch-studio-branding-watermark">
            {view.watermark ? <>Watermark: <span className="break-all font-mono text-[11.5px]">{view.watermark}</span></> : 'No watermark.'}
          </span>
          {!view.canWatermark ? <span className={MUTED}>{WATERMARK_PLAN}</span> : null}
          {view.canWatermark && !readOnly ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-bold text-axal-muted dark:text-gray-400">Watermark image address</span>
                <input className={INPUT} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://…" data-testid="pitch-studio-watermark-input" />
              </label>
              {next === null ? <span className="text-[11.5px] font-semibold text-axal-destructive dark:text-red-400">{WATERMARK_BAD}</span> : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={PRIMARY} disabled={!next || next === (view.watermark || '')}
                  onClick={() => setDialog({ url: next })} data-testid="pitch-studio-watermark-save">Save watermark</button>
                {view.watermark ? (
                  <button type="button" className={GHOST} onClick={() => setDialog({ url: null })} data-testid="pitch-studio-watermark-clear">Remove</button>
                ) : null}
              </div>
            </div>
          ) : null}
          <Refusal refusal={refusal} testId="pitch-studio-watermark-refusal" />
        </>
      ) : null}
      {dialog ? (
        <Confirm title={dialog.url ? 'Save watermark' : 'Remove watermark'} sentence={watermarkSentence(dialog.url, view?.watermark)}
          action={dialog.url ? 'Save' : 'Remove'} busy={busy} onConfirm={() => save(dialog.url)} onClose={() => setDialog(null)} testId="pitch-studio-watermark-dialog" />
      ) : null}
    </section>
  );
}
