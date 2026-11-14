import React, { useEffect, useState } from 'react';
import { Lightbox } from '../../../ui';
import { reportError } from '../../../lib/log';
import { aiTokens } from './newDeckModel';
import { critique } from './deckV2Adapter';
import { COST, EYE, GHOST, INK, LAV, MUTED, PRIMARY } from './AssistParts';

/**
 * D1552 (#3799, pd13) — ⋯ › Whole deck · uses AI › Fix with critique.
 * "Density, contrast and fit on every card": the quote first ("Holds up to
 * $x · you pay what it uses"), then the run. Its fixes are proposals: each
 * waits in the Ask's "Waiting for you" sheet with Accept and Accept all, and
 * nothing is on a card until Accept. What could not be fixed says why.
 */
export const CRITIQUE_LINE = 'Density, contrast and fit on every card';
export const CRITIQUE_WAITING = (n) => `${n} fix${n === 1 ? '' : 'es'} waiting for you in Ask. Nothing changes until you Accept.`;

export default function CritiqueDialog({ deckId, onClose, onProposals }) {
  const [quote, setQuote] = useState({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    critique(deckId).then((a) => {
      if (!live) return;
      setQuote(a?.available ? { status: 'ok', data: a.value } : { status: 'error', reason: a?.reason || 'The critique cannot run now.' });
    });
    return () => { live = false; };
  }, [deckId]);
  const q = quote.status === 'ok' ? quote.data : null;
  const hold = q?.ai ? Number(q.hold_microusd || 0) : null;
  const go = async () => {
    setBusy(true); setError(null);
    const a = await critique(deckId, { run: true });
    setBusy(false);
    if (!a?.available) { setError(a?.reason || 'The critique could not run.'); reportError('pitch-critique:run', new Error(String(a?.reason))); return; }
    setResult(a.value);
    if ((a.value?.fixes || []).length) onProposals?.();
  };
  const footer = result ? (
    <div className="flex justify-end"><button type="button" className={GHOST} onClick={onClose} data-testid="pitch-critique-close">Close</button></div>
  ) : (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className={`${COST} mr-auto`} data-testid="pitch-critique-hold">
        {quote.status === 'loading' ? 'Reading the cost…' : quote.status === 'error' ? quote.reason
          : q?.ai === false ? q.message : hold ? `Holds up to ${aiTokens(hold)} · you pay what it uses` : 'The free checks only · nothing is charged'}
      </span>
      <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className={PRIMARY} onClick={go} disabled={busy || quote.status !== 'ok' || q?.ai === false} data-testid="pitch-critique-run">{busy ? 'Reading every card…' : 'Fix with critique'}</button>
    </div>
  );
  return (
    <Lightbox label="Fix with critique" title="Fix with critique" width={560} onClose={() => !busy && onClose()} testId="pitch-critique" footer={footer}>
      <div className="flex flex-col gap-2.5">
        <span className={MUTED}>{CRITIQUE_LINE}.</span>
        {q?.ai ? (
          <span className={MUTED} data-testid="pitch-critique-plan">
            {`Score now ${q.score} of 100 · ${q.fixes.count} block${q.fixes.count === 1 ? '' : 's'} to shorten · ${q.vision.available ? `${q.vision.cards} cards read by the vision check` : `vision check: ${q.vision.reason || 'off'}`}`}
          </span>
        ) : null}
        {error ? <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="pitch-critique-error">{error}</p> : null}
        {result ? (
          <div className={`${LAV} flex flex-col gap-2 p-3`} data-testid="pitch-critique-result">
            <span className={`text-[14px] font-extrabold ${INK}`} data-testid="pitch-critique-score">
              Score {result.score} of 100{result.score_if_accepted !== result.score ? ` · ${result.score_if_accepted} once you accept the fixes` : ''}
            </span>
            {result.what_we_fixed?.length ? (
              <>
                <span className={EYE}>What we fixed</span>
                <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-[12.5px]" data-testid="pitch-critique-fixed">{result.what_we_fixed.map((l, i) => <li key={i} className={INK}>{l}</li>)}</ul>
                <span className={MUTED} data-testid="pitch-critique-waiting">{CRITIQUE_WAITING(result.fixes.length)}</span>
              </>
            ) : <span className={MUTED}>Nothing needed shortening.</span>}
            {result.not_fixed?.length ? (
              <>
                <span className={EYE}>Left for you</span>
                <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-[12.5px]" data-testid="pitch-critique-left">
                  {result.not_fixed.map((n, i) => <li key={i} className={MUTED}>{`${n.card >= 0 ? `Card ${n.card + 1}: ` : ''}${n.detail} ${n.reason}`}</li>)}
                </ul>
              </>
            ) : null}
            {result.findings?.filter((f) => f.check === 'vision').length ? (
              <>
                <span className={EYE}>The vision check noted</span>
                <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-[12.5px]" data-testid="pitch-critique-notes">
                  {result.findings.filter((f) => f.check === 'vision').map((f, i) => <li key={i} className={MUTED}>{`Card ${f.card + 1}: ${f.detail}`}</li>)}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Lightbox>
  );
}
