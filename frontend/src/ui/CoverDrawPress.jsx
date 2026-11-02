import React, { useMemo, useState } from 'react';
import { COVER_INITIAL, coverQuoteLine, makeCoverActions } from './coverDraw';

/**
 * #3935: "Draw a cover", beside a cover-image field. `quote(prompt)` and
 * `draw(prompt)` are the page's client calls; `onDrawn(url, alt)` fills its
 * field. See `coverDraw.js` for the two steps.
 */
export default function CoverDrawPress({ quote, draw, onDrawn, testid = 'cover-draw' }) {
  const [state, setState] = useState(COVER_INITIAL);
  const actions = useMemo(() => makeCoverActions({ quote, draw, set: setState, onDrawn }), [quote, draw, onDrawn]);
  const busy = state.quoting || state.drawing;
  const line = coverQuoteLine(state.quote);
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid={testid}>
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor={`${testid}-prompt`}>Describe a cover for Eadwyn to draw</label>
      <input
        id={`${testid}-prompt`} data-testid={`${testid}-prompt`} type="text" maxLength={600}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        value={state.prompt} onChange={(e) => actions.setPrompt(e.target.value)} placeholder="A harbour at dawn, warm colours"
      />
      <p className="text-xs text-slate-500 dark:text-slate-400">No people: Eadwyn does not draw real people, and checks every image for a face before you see it.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-testid={`${testid}-price`} disabled={busy || !state.prompt.trim()}
          className="min-h-[44px] rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600 dark:text-slate-100"
          onClick={() => actions.price(state.prompt.trim())}>{state.quoting ? 'Pricing…' : 'Price it'}</button>
        {state.quote && (
          <button type="button" data-testid={`${testid}-run`} disabled={busy || state.quote.balance?.ok === false}
            className="min-h-[44px] rounded-md bg-slate-900 px-3 text-sm text-white dark:bg-slate-100 dark:text-slate-900"
            onClick={() => actions.run(state.prompt.trim())}>{state.drawing ? 'Drawing…' : 'Draw'}</button>
        )}
      </div>
      {line && <p className="text-xs text-slate-600 dark:text-slate-300" data-testid={`${testid}-quote`}>{line}</p>}
      {state.quote?.balance?.ok === false && <p className="text-xs text-amber-700 dark:text-amber-300" data-testid={`${testid}-balance`}>{state.quote.balance.message}</p>}
      {state.drawn && <p className="text-xs text-emerald-700 dark:text-emerald-300" data-testid={`${testid}-done`}>Drawn with {state.drawn.model_label || 'the image model'}. Save to keep it.</p>}
      {state.error && <p className="text-xs text-rose-700 dark:text-rose-300" role="alert" data-testid={`${testid}-error`}>{state.error.message}</p>}
    </div>
  );
}
