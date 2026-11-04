import React, { useCallback, useEffect, useState } from 'react';
import Sheet from '../../../ui/Sheet.jsx';
import { deckVoiceApi } from '../../../lib/api/deckVoice.js';
import {
  ACCEPT, ACCEPTED, DISCARD, DISCARDED, MAKE, NOT_SAVED, NO_SCRIPT, SAVE_FIRST, VOICE_LABEL, VOICE_LINE, VOICE_TITLE, hasScript, quoteLine,
} from './voiceModel';

/**
 * D1569 (#3816, deck v2 D8) — ⋯ › This card › AI voice-over. The card's script
 * spoken in an AI voice, always labelled "AI voice":
 *   1. the quote: the model and what the run holds (`POST …/voice/quote`);
 *   2. Make the voice-over: the run, then the clip to hear, "Not saved";
 *   3. Accept (a new version whose card carries it) or Discard (deleted).
 * Nothing is saved on the deck until Accept. A card with no script, a version
 * with unsaved changes, or a reader, runs nothing.
 */
const BTN = 'inline-flex min-h-[36px] items-center rounded-[9px] px-3 text-[12.5px] font-bold disabled:opacity-50';
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const SECONDARY = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const MUTED = 'm-0 text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'm-0 text-[12.5px] leading-[1.45] text-axal-ink dark:text-gray-100';
const why = (e) => (typeof e?.message === 'string' && e.message ? e.message : 'Something went wrong. Nothing was saved.');

export function AiVoiceTag() {
  return <span className="inline-flex items-center rounded-full bg-axal-lavender px-2 py-0.5 text-[11px] font-bold text-axal-violet dark:bg-violet-950/40 dark:text-violet-300" data-testid="ai-voice-label">{VOICE_LABEL}</span>;
}

export default function VoiceSheet({ deckId, card, index, readOnly, dirty, onAccepted, onClose }) {
  const [quote, setQuote] = useState({ status: 'idle' });
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const blocked = readOnly ? 'Read only' : !hasScript(card) ? NO_SCRIPT : dirty ? SAVE_FIRST : null;

  const readQuote = useCallback(() => {
    if (blocked || !deckId || !card?.uid) return undefined;
    let live = true;
    setQuote({ status: 'loading' });
    deckVoiceApi.quote(deckId, card.uid).then((q) => { if (live) setQuote({ status: 'ready', q }); }, (e) => { if (live) setQuote({ status: 'error', message: why(e) }); });
    return () => { live = false; };
  }, [blocked, deckId, card?.uid]);
  useEffect(() => readQuote(), [readQuote]);

  const line = quote.status === 'ready' ? quoteLine(quote.q) : null;
  const make = () => {
    setBusy(true); setError(null);
    deckVoiceApi.make(deckId, card.uid).then((r) => { setBusy(false); setMade(r); }, (e) => { setBusy(false); setError(why(e)); });
  };
  const decide = (accept) => {
    if (!made?.proposal?.uid) return;
    setBusy(true); setError(null);
    (accept ? deckVoiceApi.accept(deckId, made.proposal.uid) : deckVoiceApi.discard(deckId, made.proposal.uid)).then((r) => {
      setBusy(false); setMade(null); setDone(accept ? ACCEPTED : DISCARDED);
      if (accept) onAccepted?.(r);
    }, (e) => { setBusy(false); setError(why(e)); });
  };

  return (
    <Sheet label={VOICE_TITLE} title={VOICE_TITLE} eyebrow={`Card ${index + 1}`} width={480} onClose={onClose} testId="pitch-sheet-voice">
      <div className="flex flex-col gap-3">
        <p className={MUTED}>{VOICE_LINE}</p>
        {blocked ? <p className={INK} role="status" data-testid="pitch-voice-blocked">{blocked}</p> : null}
        {!blocked && quote.status === 'loading' ? <p className={MUTED}>Reading the price…</p> : null}
        {!blocked && quote.status === 'error' ? <p className={INK} role="alert" data-testid="pitch-voice-quote-error">{quote.message}</p> : null}
        {!blocked && line ? <p className={line.ok ? MUTED : INK} data-testid="pitch-voice-quote">{line.text}</p> : null}
        {!blocked && !made && !done ? (
          <div><button type="button" className={PRIMARY} disabled={busy || !line?.ok} onClick={make} data-testid="pitch-voice-make">{busy ? 'Making…' : MAKE}</button></div>
        ) : null}
        {made ? (
          <div className="flex flex-col gap-2 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid="pitch-voice-made">
            <div className="flex items-center gap-2"><AiVoiceTag /><span className={MUTED}>{NOT_SAVED}</span></div>
            {made.url ? <audio controls preload="none" src={made.url} className="w-full" data-testid="pitch-voice-audio" aria-label={`${VOICE_LABEL}: card ${index + 1}`} /> : null}
            <div className="flex gap-2">
              <button type="button" className={PRIMARY} disabled={busy} onClick={() => decide(true)} data-testid="pitch-voice-accept">{ACCEPT}</button>
              <button type="button" className={SECONDARY} disabled={busy} onClick={() => decide(false)} data-testid="pitch-voice-discard">{DISCARD}</button>
            </div>
          </div>
        ) : null}
        {done ? <p className={INK} role="status" data-testid="pitch-voice-done">{done}</p> : null}
        {error ? <p className={INK} role="alert" data-testid="pitch-voice-error">{error}</p> : null}
      </div>
    </Sheet>
  );
}
