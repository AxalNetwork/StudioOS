/** Collapsed, lazy deal-flow history with an independent retryable read (#6146). */
import React, { useEffect, useState } from 'react';
import { dealFlowApi } from '../../../lib/api/dealFlow.js';
import { currentReturnLine, flowEventSentence } from './movesModel.js';

const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';

export default function FlowHistory({ row, pass }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [read, setRead] = useState({ state: 'loading', items: [] });
  useEffect(() => {
    let alive = true;
    if (!open || !row.inFlow) return undefined;
    setRead({ state: 'loading', items: [] });
    dealFlowApi.events(row.id).then((r) => {
      if (alive) setRead(Array.isArray(r?.items) ? { state: 'ready', items: [...r.items].reverse() } : { state: 'unreadable', items: [] });
    }).catch(() => { if (alive) setRead({ state: 'unreadable', items: [] }); });
    return () => { alive = false; };
  }, [open, row.id, row.inFlow, version]);
  if (!row.inFlow) return null;
  const returning = currentReturnLine(pass);
  return <section className="border-t border-axal-hairline pt-3 dark:border-gray-800" data-testid="dealflow-history">
    <button type="button" className="flex min-h-11 w-full items-center justify-between text-left text-[13px] font-semibold" aria-expanded={open} aria-controls="dealflow-history-body" onClick={() => setOpen((v) => !v)} data-testid="dealflow-history-toggle">History <span aria-hidden="true">{open ? '−' : '+'}</span></button>
    {open ? <div id="dealflow-history-body" className="space-y-3" data-testid="dealflow-history-body">
      {returning ? <p className={MUTED} data-testid="dealflow-current-return">{returning}</p> : null}
      {read.state === 'loading' ? <p className={MUTED} aria-busy="true">Reading history…</p>
        : read.state === 'unreadable' ? <p className={MUTED} role="status">History is unreadable. <button type="button" className="min-h-11 font-semibold underline" onClick={() => setVersion((v) => v + 1)} data-testid="dealflow-history-retry">Try again</button></p>
          : !read.items.length ? <p className={MUTED}>No move recorded yet</p>
            : <ol className="m-0 list-none space-y-3 p-0">{read.items.map((event, index) => <li key={index} className="break-words" data-testid="dealflow-history-event">
              <p className="m-0 text-[13px]">{flowEventSentence(event, row.enteredVia)}</p>
              <p className={MUTED}>When: {event?.at || 'Not recorded'} · By: {event?.by?.name || 'Not recorded'}</p>
            </li>)}</ol>}
    </div> : null}
  </section>;
}
