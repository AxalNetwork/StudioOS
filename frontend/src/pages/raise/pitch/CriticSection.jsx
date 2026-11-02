import React, { useEffect, useState } from 'react';
import { deckCriticApi } from '../../../lib/api/deckCritic';
import { railPressHeaders } from '../../../lib/railPage';
import { reportError } from '../../../lib/log';
import { useRailOption } from '../../../ui/railCrumbs';
import { refusalOf } from './newDeckModel';
import { EYE, GHOST, INK, MUTED, RefusalLine } from './AssistParts';
import { CRITIC_LINE, CRITIC_TITLE, NO_FINDINGS, askLabel, benchmarkLine, criticNote, findingGroups } from './criticModel';

/**
 * D1557 (#3804, pd25): the investor critic inside the Check claims sheet. The
 * founder asks; the quote is read first, the run is one press, and the
 * findings are listed by severity, each with Go to card. Read-only readers
 * (an admin) see nothing here: the run is the founder's to pay for.
 */
const LINK = 'text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300';

export default function CriticSection({ deck, readOnly, onGoToCard }) {
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  useRailOption(busy ? 'deck:critic' : null, 'Read as an investor');

  useEffect(() => {
    if (readOnly || !deck?.id) return undefined;
    let live = true;
    deckCriticApi.quote(deck.id, {}).then((q) => { if (live) setQuote(q); }, (e) => { if (live) setQuote({ ai: false, message: refusalOf(e)?.message || null }); });
    return () => { live = false; };
  }, [deck?.id, readOnly]);

  if (readOnly || !deck?.id) return null;

  const ask = async () => {
    setBusy(true); setError(null);
    try { setResult(await deckCriticApi.run(deck.id, {}, railPressHeaders('deck:critic'))); }
    catch (e) { reportError('pitch-critic:run', e); setError(refusalOf(e)); }
    finally { setBusy(false); }
  };

  const groups = result ? findingGroups(result.findings) : [];
  const note = result ? criticNote(result.critic) : null;
  return (
    <section className="flex flex-col gap-2" aria-label={CRITIC_TITLE} data-testid="pitch-critic">
      <span className={EYE}>{CRITIC_TITLE}</span>
      <span className={MUTED}>{CRITIC_LINE}</span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={GHOST} onClick={ask} disabled={busy} data-testid="pitch-critic-ask">{busy ? 'Reading…' : askLabel(quote)}</button>
        {quote && quote.ai === false && quote.message ? <span className={MUTED} data-testid="pitch-critic-quote-note">{quote.message}</span> : null}
      </div>
      {error ? <RefusalLine refusal={error} testId="pitch-critic-error" /> : null}
      {result ? (
        <div className="flex flex-col gap-2" data-testid="pitch-critic-result">
          <span className={MUTED} data-testid="pitch-critic-persona">{`Read as ${result.persona}, for a ${result.stage_label} deck.`}</span>
          {groups.length ? groups.map((g) => (
            <div key={g.severity} className="flex flex-col gap-1.5" data-testid={`pitch-critic-${g.severity}`}>
              <span className={`text-[12px] font-bold ${INK}`}>{g.label}</span>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {g.rows.map((f) => (
                  <li key={f.key} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid="pitch-critic-row" data-source={f.source}>
                    <span className={`text-[12.5px] ${INK}`}>{f.message}</span>
                    {onGoToCard && Number.isInteger(f.card_index) ? (
                      <button type="button" className={`${LINK} w-fit`} onClick={() => onGoToCard(f.card_index)} data-testid="pitch-critic-go">Go to card ›</button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )) : <span className={MUTED} data-testid="pitch-critic-empty">{NO_FINDINGS}</span>}
          <span className={MUTED} data-testid="pitch-critic-benchmark">{benchmarkLine(result.benchmark)}</span>
          {note ? <span className={MUTED} data-testid="pitch-critic-note">{note}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
