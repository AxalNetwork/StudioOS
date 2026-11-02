import React, { useEffect, useState } from 'react';
import { deckDeriveApi } from '../../../lib/api/deckDerive';
import { reportError } from '../../../lib/log';
import Sheet from '../../../ui/Sheet.jsx';
import { refusalOf } from './newDeckModel';
import { BLIND_LABEL, BLIND_LINE, DERIVE_FORMATS, DERIVE_TITLE, PROPOSED_LINE, deriveHold } from './deriveModel';

/**
 * D1583 (#3830, deck builder v2 F4) — ⋯ › This deck › "Teaser, one-pager or
 * memo…" (pd13's THIS DECK section). One sheet: choose the output, choose
 * Blind, read what it costs, Propose. The proposal waits in Ask ("Waiting for
 * you"), where Accept keeps it; nothing is kept from here.
 *
 *   - The teaser and the one-pager run no model: "No model · free".
 *   - The memo runs `memo_write` on the AIRail's pick, and its quote ("Holds up
 *     to $x · you pay what it uses") is read before Propose is offered. With AI
 *     paused or out of tokens the memo is greyed and says why.
 *   - It is made from the saved version (`deckId`): with unsaved changes the
 *     sheet says they are not in it.
 *
 * `source` is the live client; a test hands its own.
 */
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] bg-axal-violet px-3.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-violet-500';
const BAD = 'm-0 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300';
const OK = 'm-0 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200';

export default function DeriveSheet({ deckId, version = null, dirty = false, readOnly = false, aiOn = true, outOfTokens = false, onProposed, onClose, source = deckDeriveApi }) {
  const [format, setFormat] = useState('teaser');
  const [blind, setBlind] = useState(false);
  const [quote, setQuote] = useState({ status: 'idle', data: null });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const memoOff = !aiOn || outOfTokens;

  useEffect(() => {
    setResult(null);
    if (format !== 'memo' || memoOff || deckId == null) { setQuote({ status: 'idle', data: null }); return undefined; }
    let live = true;
    setQuote({ status: 'loading', data: null });
    source.quote(deckId, { format, blind }).then(
      (data) => { if (live) setQuote({ status: 'ok', data }); },
      (e) => { reportError('pitch-derive:quote', e); if (live) setQuote({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [format, blind, deckId, memoOff, source]);

  const hold = format === 'memo' ? (quote.status === 'ok' ? deriveHold('memo', quote.data) : null) : deriveHold(format, null);
  const refusedQuote = format === 'memo' && quote.status === 'ok' && quote.data?.ai === false ? (quote.data.message || 'The memo cannot run now.') : null;
  const canPropose = !readOnly && !busy && deckId != null && (format !== 'memo' || (!memoOff && hold != null));

  const propose = async () => {
    if (!canPropose) return;
    setBusy(true); setResult(null);
    try {
      const r = await source.derive(deckId, { format, blind });
      setResult({ ok: true, title: r?.title || null });
      onProposed?.();
    } catch (e) {
      reportError('pitch-derive:run', e);
      setResult({ ok: false, message: refusalOf(e)?.message || 'That did not work. Nothing was proposed.' });
    } finally { setBusy(false); }
  };

  return (
    <Sheet label={DERIVE_TITLE} title={DERIVE_TITLE} eyebrow="More deck actions" width={520} onClose={onClose} testId="pitch-sheet-derive">
      <div className="flex flex-col gap-3">
        <span className={MUTED}>Made from {version != null ? `v${version}, ` : ''}the saved version, from your deck&apos;s own words and figures.</span>
        {dirty ? <span className={MUTED} role="status" data-testid="pitch-derive-dirty">Your unsaved changes are not in it. Save a version first to include them.</span> : null}
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="What to make">
          {DERIVE_FORMATS.map((f) => {
            const off = f.ai && memoOff;
            return (
              <label key={f.id} className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-[9px] border px-3 py-2 text-[12.5px] ${format === f.id ? 'border-axal-violet dark:border-violet-500' : 'border-axal-hairline dark:border-gray-700'} ${INK} ${off ? 'opacity-60' : ''}`}>
                <input type="radio" name="derive-format" className="mt-1" checked={format === f.id} disabled={readOnly || off}
                  onChange={() => setFormat(f.id)} data-testid={`pitch-derive-${f.id}`} />
                <span className="flex flex-col">
                  <span className="font-bold">{f.label}</span>
                  <span className={MUTED}>{off ? (!aiOn ? 'AI is paused for your studio.' : 'Out of AI tokens. Add tokens to run it.') : f.line}</span>
                </span>
              </label>
            );
          })}
        </div>
        <label className={`flex min-h-[44px] cursor-pointer items-start gap-2 text-[12.5px] ${INK}`}>
          <input type="checkbox" className="mt-1" checked={blind} disabled={readOnly} onChange={(e) => setBlind(e.target.checked)} data-testid="pitch-derive-blind" />
          <span className="flex flex-col"><span className="font-bold">{BLIND_LABEL}</span><span className={MUTED}>{BLIND_LINE}</span></span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={BTN} disabled={!canPropose} onClick={propose} data-testid="pitch-derive-propose">Propose</button>
          {format === 'memo' && quote.status === 'loading' ? <span className={MUTED} role="status">Reading the price…</span> : null}
          {format === 'memo' && quote.status === 'error' ? <span className={MUTED} role="status" data-testid="pitch-derive-quote-error">The price could not be read. Try again in a moment.</span> : null}
          {refusedQuote ? <span className={MUTED} role="status">{refusedQuote}</span> : null}
          {hold && !refusedQuote ? <span className={MUTED} data-testid="pitch-derive-hold">{hold}</span> : null}
        </div>
        {result?.ok ? <p className={OK} role="status" data-testid="pitch-derive-proposed">{result.title ? `${result.title}. ` : ''}{PROPOSED_LINE}</p> : null}
        {result && !result.ok ? <p className={BAD} role="alert" data-testid="pitch-derive-refused">{result.message}</p> : null}
      </div>
    </Sheet>
  );
}
