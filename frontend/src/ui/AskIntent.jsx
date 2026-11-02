import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { endAskIntent, openAskIntent, useAskPanel } from './eadwynPanel.js';

/**
 * D1443 part 4 (#3992) — a page's own Eadwyn task, drawn IN the Ask panel.
 *
 * It replaced D1317's `Sheet` for the two Fill surfaces (`FillSheet`, a form's
 * Sources and Preview; `FillRowsPanel`, a module's row proposals): there is no
 * separate proposals container (#3706, the owner's decision 3). While mounted,
 * it opens the Ask panel holding this intent (`openAskIntent`) and portals its
 * body (eyebrow, title, the content and the footer line) into the panel's
 * slot, above the conversation. Its host keeps the state and the callbacks, so
 * nothing about Accept, Edit or Discard changes: Accept still only places
 * values or keeps rows, and the form's Save still writes.
 *
 * Where no Ask panel serves the viewer (no rail on the page), or before the
 * panel has drawn its slot, the same region is drawn in place, so the task is
 * never lost. Closing the panel (×, Escape, a route change) calls `onClose`;
 * so does the region's own Close.
 *
 * Focus is D1317's contract, kept: it moves into the region when it opens and
 * returns to whatever opened it when it closes.
 */
export default function AskIntent({ label, eyebrow = 'Ask Eadwyn', title, footer = null, onClose, testId, children }) {
  const titleId = useId();
  const ask = useAskPanel();
  const id = useRef(null);
  const closer = useRef(onClose);
  closer.current = onClose;
  const box = useRef(null);

  // D1317's focus contract: into the region on open, back to the opener on close.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const opener = document.activeElement;
    box.current?.focus?.();
    return () => { if (opener && opener.isConnected !== false) opener.focus?.(); };
  }, []);

  useEffect(() => {
    id.current = openAskIntent({ label: label || title, onClose: () => { id.current = null; closer.current?.(); } });
    return () => { if (id.current != null) endAskIntent(id.current); };
    // The intent is opened once per mount; its label is fixed for its life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const region = (
    <section ref={box} tabIndex={-1} role="region" aria-labelledby={titleId} aria-label={label} className="ead-ask-intent-body flex flex-col gap-3" data-testid={testId}>
      <span className="ead-ask-intent-head flex items-start justify-between gap-2">
        <span className="flex flex-col">
          <span className="ead-ask-eyebrow">{eyebrow}</span>
          <b id={titleId} className="text-[14px] text-axal-ink dark:text-gray-100">{title}</b>
        </span>
        <button type="button" className="ead-ask-btn is-ghost" aria-label={`Close ${title}`} onClick={() => { const live = id.current; id.current = null; if (live != null) endAskIntent(live); closer.current?.(); }} data-testid={`${testId}-close`}>Close</button>
      </span>
      {children}
      {footer ? <span className="ead-ask-intent-foot flex flex-col gap-2">{footer}</span> : null}
    </section>
  );
  const inPanel = ask.open && ask.intent && id.current != null && ask.intent.id === id.current && ask.slot;
  return inPanel ? createPortal(region, ask.slot) : region;
}
