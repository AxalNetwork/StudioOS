import React from 'react';
import { Lightbox } from '../../../ui';
import { costLine } from './deckAssistModel';

/**
 * D899 (#2678) — the pieces the card tools share: the press dialog that shows
 * a press's cost before it runs, the tokens dialog (PD25) a 402 opens, and a
 * text proposal drawn as PD7 draws it. Each tool file calls its own run.
 */

export const BTN = 'inline-flex min-h-[32px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50';
export const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
export const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
export const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
export const INK = 'text-axal-ink dark:text-gray-100';
export const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const FIELD = 'rounded-[9px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
export const LAV = 'rounded-[10px] border border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/40';
export const COST = 'font-mono text-[10.5px] font-bold text-axal-violet dark:text-violet-300';

/** A refused press: its sentence, and Add tokens when it was out of tokens. */
export function RefusalLine({ refusal, testId }) {
  if (!refusal) return null;
  return (
    <span role="alert" className="flex flex-col gap-1 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400" data-testid={testId}>
      {refusal.message}
      {refusal.topUp ? <a className="font-bold text-axal-violet underline dark:text-violet-300" href={refusal.topUp.href}>{refusal.topUp.text}</a> : null}
    </span>
  );
}

/** Every press opens this first: what runs, what it costs, then Run or Cancel. */
export function PressDialog({ title, sentence, quote, busy, refusal, onRun, onClose, testId, children }) {
  const blocked = !quote || quote.ai === false;
  return (
    <Lightbox label={title} title={title} width={520} onClose={() => !busy && onClose()} testId={testId}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={onRun} disabled={busy || blocked} data-testid={`${testId}-run`}>{busy ? 'Running…' : 'Run'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-2.5">
        {sentence ? <span className={`text-[13px] ${INK}`}>{sentence}</span> : null}
        {children}
        <span className={COST} data-testid={`${testId}-cost`}>{costLine(quote)}</span>
        <span className={MUTED}>Figures come from your records. Eadwyn changes words only, and nothing is placed until you accept.</span>
        <RefusalLine refusal={refusal} testId={`${testId}-refusal`} />
      </div>
    </Lightbox>
  );
}

/** PD25: out of AI tokens. The figures still fill from records; Add tokens goes to billing. */
export function TokensDialog({ refusal, onClose }) {
  return (
    <Lightbox label="Out of AI tokens" title="You are out of AI tokens" width={480} onClose={onClose} testId="pitch-assist-tokens"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose}>Not now</button>
          <a className={PRIMARY} href={refusal?.topUp?.href || '/billing'}>Add tokens</a>
        </div>
      )}>
      <div className="flex flex-col gap-2">
        <span className={`text-[13px] ${INK}`}>{refusal?.message || 'This press needs AI tokens.'}</span>
        <span className={MUTED}>Your records still fill every figure, at no cost. Nothing was run and nothing was charged.</span>
      </div>
    </Lightbox>
  );
}

/** PD7's result: the before struck, the after on lavender, then Accept or Discard. */
export function TextProposal({ proposal, busy, onAccept, onDiscard, testId }) {
  return (
    <div className={`${LAV} flex flex-col gap-2 p-3`} data-testid={testId}>
      <span className={EYE}>Proposed by Eadwyn{proposal.cost ? ` · ${proposal.cost}` : ''}</span>
      <del className="text-[12.5px] text-axal-muted line-through dark:text-gray-400" data-testid={`${testId}-before`}>{proposal.before}</del>
      <span className={`rounded-[8px] bg-white/70 px-2 py-1.5 text-[13px] ${INK} dark:bg-violet-950/60`} data-testid={`${testId}-after`}>{proposal.after}</span>
      <span className={MUTED}>Accept places it on the card. Nothing is a version until you save.</span>
      <div className="flex gap-2">
        <button type="button" className={PRIMARY} onClick={onAccept} disabled={busy} data-testid={`${testId}-accept`}>Accept</button>
        <button type="button" className={GHOST} onClick={onDiscard} disabled={busy} data-testid={`${testId}-discard`}>Discard</button>
      </div>
    </div>
  );
}
