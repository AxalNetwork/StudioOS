import React, { useEffect, useState } from 'react';
import { deckActionsApi } from '../../../lib/api/deckActions';
import { railPressHeaders } from '../../../lib/railPage';
import { reportError } from '../../../lib/log';
import { useRailOption } from '../../../ui/railCrumbs';
import { refusalOf } from './newDeckModel';
import { EYE, GHOST, INK, MUTED, RefusalLine } from './AssistParts';
import { WORDING_EMPTY, WORDING_LINE, WORDING_TITLE, wordingLabel } from './deckActionsModel';

/**
 * D1561 (#3808, pd25): the Check claims sheet's Wording section. The quote is
 * read first and drawn on the button; the run is one press, charged only then.
 * Each finding quotes its card and offers Go to card. A failed run says so,
 * with Try again. Read-only readers see nothing here: the run is the founder's.
 */
const LINK = 'text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300';

export default function WordingSection({ deck, readOnly, onGoToCard }) {
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  useRailOption(busy ? 'deck:wording' : null, 'Check wording');

  useEffect(() => {
    if (readOnly || !deck?.id) return undefined;
    let live = true;
    deckActionsApi.wordingQuote(deck.id).then((q) => { if (live) setQuote(q); }, (e) => { if (live) setQuote({ ai: false, message: refusalOf(e)?.message || null }); });
    return () => { live = false; };
  }, [deck?.id, readOnly]);

  if (readOnly || !deck?.id) return null;

  const check = async () => {
    setBusy(true); setError(null);
    try { setResult(await deckActionsApi.wording(deck.id, railPressHeaders('deck:wording'))); }
    catch (e) { reportError('pitch-wording:run', e); setError(refusalOf(e)); }
    finally { setBusy(false); }
  };

  const rows = result?.state === 'ok' && Array.isArray(result.findings) ? result.findings : [];
  return (
    <section className="flex flex-col gap-2" aria-label={WORDING_TITLE} data-testid="pitch-wording">
      <span className={EYE}>{WORDING_TITLE}</span>
      <span className={MUTED}>{WORDING_LINE}</span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={GHOST} onClick={check} disabled={busy} data-testid="pitch-wording-check">{busy ? 'Checking…' : wordingLabel(quote)}</button>
        {quote && quote.ai === false && quote.message ? <span className={MUTED} data-testid="pitch-wording-quote-note">{quote.message}</span> : null}
      </div>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2" data-testid="pitch-wording-failed">
          <RefusalLine refusal={error} testId="pitch-wording-error" />
          <button type="button" className={GHOST} onClick={check} disabled={busy} data-testid="pitch-wording-retry">Try again</button>
        </div>
      ) : null}
      {result?.state === 'off' ? <span className={MUTED} data-testid="pitch-wording-off">{result.message}</span> : null}
      {result?.state === 'ok' ? (
        rows.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="pitch-wording-rows">
            {rows.map((f) => (
              <li key={f.key} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid="pitch-wording-row" data-kind={f.kind}>
                <span className={`text-[12px] font-bold ${INK}`}>{`${f.label} · Card ${f.card_index + 1}`}</span>
                <span className={`text-[12.5px] italic ${INK}`}>{`“${f.quote}”`}</span>
                <span className={MUTED}>{f.message}</span>
                {onGoToCard && Number.isInteger(f.card_index) ? (
                  <button type="button" className={`${LINK} w-fit`} onClick={() => onGoToCard(f.card_index)} data-testid="pitch-wording-go">Go to card ›</button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <span className={MUTED} data-testid="pitch-wording-empty">{WORDING_EMPTY}</span>
      ) : null}
    </section>
  );
}
