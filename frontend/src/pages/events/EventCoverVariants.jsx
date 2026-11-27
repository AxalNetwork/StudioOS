import React, { useState } from 'react';
import * as recommendations from './recommendationsAdapter';
import { VARIANTS_PER_DRAW, brandColoursLine, variantsLine } from './eventCoverModel';
import { coverQuoteLine } from '../../ui/coverDraw';

/**
 * #5309 (D5309, D3724 §gaps 9 and 10, board NE2): four variants per press.
 *
 * Price first, always: `Price four variants` shows the one figure for all four
 * draws and their checks, and the brand colours the prompt will carry. `Draw
 * four` then runs on that quote's uid, so the same press retried charges
 * nothing again. Nothing is placed until the member presses `Use this one`.
 *
 * `Regenerate` is a fresh quote for the same prompt. `More like this one` is a
 * fresh quote for the prompt plus the chosen variant's own alt text — the only
 * words a variant carries, and Eadwyn's own, never the member's invented.
 *
 * Every answer here is the adapter's `{ available, value }` or `{ available:
 * false, reason }`: a read that did not answer says so, and never draws as an
 * empty grid (D278).
 */
const BTN = 'min-h-[44px] rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600 dark:text-slate-100';
const GO = 'min-h-[44px] rounded-md bg-slate-900 px-3 text-sm text-white dark:bg-slate-100 dark:text-slate-900';
const MUTED = 'text-xs text-slate-600 dark:text-slate-300';

export default function EventCoverVariants({
  id,
  prompt,
  onChoose,
  quoteFn = recommendations.variantsQuote,
  drawFn = recommendations.drawVariants,
  testid = 'event-cover-variants',
}) {
  const [quote, setQuote] = useState(null);
  const [drawn, setDrawn] = useState(null);
  const [busy, setBusy] = useState(null);
  const [asked, setAsked] = useState('');

  const price = async (words) => {
    setBusy('quoting'); setDrawn(null); setAsked(words);
    setQuote(await quoteFn(id, words));
    setBusy(null);
  };
  const draw = async () => {
    const uid = quote?.available ? quote.value?.quote_uid : null;
    setBusy('drawing');
    setDrawn(await drawFn(id, asked || prompt, uid));
    setBusy(null);
  };
  const moreLikeThis = (variant) => price(`${asked || prompt}. Closer to this one: ${variant.alt || 'the same composition'}`.slice(0, 600));

  const value = quote?.available ? quote.value : null;
  const variants = drawn?.available ? (drawn.value?.variants || []) : [];
  const line = value ? coverQuoteLine(value) : null;

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid={testid}>
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{VARIANTS_PER_DRAW} variants in one press</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} data-testid={`${testid}-price`} disabled={!!busy || !String(prompt || '').trim()}
          onClick={() => price(String(prompt || '').trim())}>{busy === 'quoting' ? 'Pricing…' : 'Price four variants'}</button>
        {value ? (
          <button type="button" className={GO} data-testid={`${testid}-draw`} disabled={!!busy || value.balance?.ok === false}
            onClick={draw}>{busy === 'drawing' ? 'Drawing…' : `Draw ${VARIANTS_PER_DRAW}`}</button>
        ) : null}
        {variants.length ? (
          <button type="button" className={BTN} data-testid={`${testid}-regenerate`} disabled={!!busy}
            onClick={() => price(asked || String(prompt || '').trim())}>Regenerate</button>
        ) : null}
      </div>
      {line ? <p className={MUTED} data-testid={`${testid}-quote`}>{line}</p> : null}
      {value ? <p className={MUTED} data-testid={`${testid}-colours`}>{brandColoursLine(value)}</p> : null}
      {value?.balance?.ok === false ? <p className="text-xs text-amber-700 dark:text-amber-300" data-testid={`${testid}-balance`}>{value.balance.message}</p> : null}
      {quote && !quote.available ? <p className="text-xs text-rose-700 dark:text-rose-300" role="alert" data-testid={`${testid}-quote-error`}>{quote.reason}</p> : null}
      {drawn && !drawn.available ? <p className="text-xs text-rose-700 dark:text-rose-300" role="alert" data-testid={`${testid}-error`}>{drawn.reason}</p> : null}
      {drawn?.available ? <p className={MUTED} data-testid={`${testid}-count`}>{variantsLine(drawn.value)}</p> : null}
      {variants.length ? (
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2" data-testid={`${testid}-grid`}>
          {variants.map((v) => (
            <li key={v.filename} className="space-y-1 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              <img src={v.url} alt={v.alt || 'Variant with no description recorded'} className="aspect-video w-full rounded object-cover" />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{v.alt ? v.alt : 'No description recorded for this variant.'}</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={BTN} data-testid={`${testid}-use-${v.index}`}
                  onClick={() => onChoose?.(v.url, v.alt ?? null)}>Use this one</button>
                <button type="button" className={BTN} data-testid={`${testid}-more-${v.index}`} disabled={!!busy}
                  onClick={() => moreLikeThis(v)}>More like this one</button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
