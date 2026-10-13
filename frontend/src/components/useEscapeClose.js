import { useEffect, useId, useRef } from 'react';
import { pushDialog, topmost } from '../ui/lightboxFocus.js';

/**
 * Escape closes the dialog on top, and only that one (D686 §5.1, #1596).
 *
 * Every caller joins the one stack `ui/Lightbox.jsx` uses (`pushDialog` /
 * `topmost` in `ui/lightboxFocus.js`): it is pushed on mount and popped on
 * unmount, and its listener acts only while it is on top. An Escape it acts on
 * is marked `preventDefault()`, and one already marked is ignored, so a nested
 * dialog and the lightbox under it never both close on one key.
 *
 * One window `keydown` listener per open caller (T21): opening and closing the
 * same modal never accumulates listeners. `onClose` is read through a ref, so
 * an inline arrow does not re-bind or re-order the stack on every render.
 *
 * `active` (default true): a component that stays mounted while closed (the
 * keyboard-shortcuts overlay, the step-up modal, the paywall) passes its
 * `open`, so a closed modal is never on the stack and never swallows another
 * dialog's Escape.
 *
 * MOUNT ORDER: a dialog pushes when it mounts. One mounted after a lightbox
 * opens sits above it, which is right for a dialog opened from inside the
 * lightbox. A modal mounted earlier and left open underneath sits below it.
 */
export function useEscapeClose(onClose, { active = true } = {}) {
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  const on = active && typeof onClose === 'function';
  useEffect(() => {
    if (!on || typeof window === 'undefined') return undefined;
    const pop = pushDialog(id);
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !topmost(id)) return;
      e.preventDefault?.();
      close.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); pop(); };
  }, [id, on]);
}
