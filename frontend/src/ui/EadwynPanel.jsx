import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useEscapeClose } from '../components/useEscapeClose';
import { FOCUSABLE, inertOutside, lockScroll, tabTarget, tabbable } from './lightboxFocus.js';
import { eadwynPanelEvent, openEadwynPanel, useEadwynPanel, useEadwynTrigger } from './eadwynPanel.js';

/**
 * D698 — THE EADWYN PANEL, the phone form of the rail for a founder (Cycle
 * Overview canvas, CO:30-36). `ui/eadwynPanel.js` holds whether it is open and
 * whom it serves; this draws it.
 *
 *   · A scrim, `rgba(24,24,27,.42)` (CO:31). A tap on it closes the panel.
 *   · A white panel on the right, 300px wide and at most 88% (CO:32).
 *   · A header: the Eadwyn mark at 24px, "Eadwyn AI", the label the opener
 *     passed ("Validate · Customer research"), and a 40px ×. The canvas
 *     labels the × "Close"; here it is "Close Eadwyn AI", so a screen reader
 *     knows which layer it closes (CO:33, a departure D698.md records).
 *   · The rail's own body, passed in by `WorkerRail` (CO:34).
 *
 * A dialog, modal like the lightbox: focus moves to the × on open and back to
 * what opened it on close; everything outside is inert and the page behind
 * does not scroll (`ui/lightboxFocus.js`); Escape joins the one dialog stack
 * (`components/useEscapeClose.js`), so one Escape closes one layer. It sits at
 * z-index 60: above the tab bar (30), the More sheet and the phone sheets (50),
 * below the lightbox (80).
 *
 * `WorkerRail` portals it to <body> after mount, as it does D405's sheet.
 */
export function EadwynPanel({ label, style, children }) {
  const panel = useRef(null);
  const closeRef = useRef(null);
  useEscapeClose(() => eadwynPanelEvent({ type: 'escape' }));

  useEffect(() => {
    const el = panel.current;
    if (!el || typeof document === 'undefined' || typeof el.querySelector !== 'function') return undefined;
    const opener = document.activeElement;
    const release = lockScroll(document.body);
    const restore = inertOutside(el.parentNode || el, document.body);
    (closeRef.current || el.querySelector(FOCUSABLE) || el).focus?.();
    return () => {
      restore(); release();
      if (opener && opener.isConnected !== false) opener.focus?.();
    };
  }, []);

  const onTab = (e) => {
    if (e.key !== 'Tab') return;
    const el = panel.current;
    const list = tabbable(el, document.activeElement);
    const to = tabTarget(list, document.activeElement, e.shiftKey);
    if (to === null) return;
    e.preventDefault();
    (to === -1 ? el : list[to]).focus();
  };

  return (
    <div className="ead-panel-layer" data-testid="eadwyn-panel">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close Eadwyn AI"
        className="ead-panel-scrim"
        onClick={() => eadwynPanelEvent({ type: 'scrim' })}
        data-testid="button-eadwyn-panel-scrim"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Eadwyn AI"
        tabIndex={-1}
        className="fwr ead-panel"
        style={style}
        onKeyDown={onTab}
      >
        <div className="ead-panel-head">
          <img src="/eadwyn-ai.png" alt="" width="24" height="24" className="ead-panel-mark" />
          <span className="ead-panel-titles">
            <b>Eadwyn AI</b>
            {label && <span data-testid="text-eadwyn-panel-label">{label}</span>}
          </span>
          <button
            type="button"
            ref={closeRef}
            className="ead-panel-close"
            aria-label="Close Eadwyn AI"
            onClick={() => eadwynPanelEvent({ type: 'close' })}
            data-testid="button-eadwyn-panel-close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="ead-panel-scroll">{children}</div>
      </div>
    </div>
  );
}

/**
 * The page's own Eadwyn button (CO:26): 40px, radius 12, the Eadwyn mark,
 * "Open Eadwyn for this page". #1661's pushed bar and #1665's cycle pages draw
 * it. While it is mounted the rail hides its floating button. While the panel
 * serves no one (any viewer but a founder on a founder page) it draws nothing
 * and registers nothing.
 */
export function EadwynButton({ label, className = '' }) {
  const available = useEadwynTrigger();
  if (!available) return null;
  return (
    <button
      type="button"
      className={`ead-open ${className}`.trim()}
      aria-label="Open Eadwyn for this page"
      aria-haspopup="dialog"
      onClick={() => openEadwynPanel(label)}
      data-testid="button-eadwyn-open"
    >
      <img src="/eadwyn-ai.png" alt="" width="22" height="22" />
    </button>
  );
}

export { useEadwynPanel };
export default EadwynPanel;
