/** D4829: focus a cockpit destination's exact existing record after its zone finishes loading; no record is written. */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
export function recordTarget(pathname, search) {
  const p = new URLSearchParams(search), id = p.get('id');
  if (!/^[1-9]\d*$/.test(id || '') || !Number.isSafeInteger(Number(id))) return null;
  const targets = {
    request: ['/practice/opportunities', `row-pr1-awaiting-${id}`],
    engagement: ['/practice/engagements', `card-pr2-${id}`],
    // D8732 (#8732): SessionActions draws each session as session-card-<id>; lifecycle-<id> named no node, so the focus never landed.
    session: ['/practice/sessions', `session-card-${id}`],
    delivery: ['/practice/delivery', `row-pr3-${id}`],
  };
  const target = targets[p.get('record')];
  return target?.[0] === pathname ? target[1] : null;
}
export default function PracticeRecordFocus() {
  const { pathname, search } = useLocation();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setMissing(false);
    const target = recordTarget(pathname, search);
    if (!target || typeof document.querySelector !== 'function') return undefined;
    let observer, timer;
    const focus = () => {
      const node = document.querySelector(`[data-testid="${target}"]`);
      if (!node) return false;
      observer?.disconnect(); clearTimeout(timer);
      node.setAttribute('tabindex', '-1'); node.scrollIntoView?.({ block: 'center' }); node.focus?.({ preventScroll: true });
      return true;
    };
    if (focus()) return undefined;
    if (typeof MutationObserver === 'function') { observer = new MutationObserver(focus); observer.observe(document.body, { childList: true, subtree: true }); }
    timer = setTimeout(() => { observer?.disconnect(); if (!focus()) setMissing(true); }, 15000);
    return () => { observer?.disconnect(); clearTimeout(timer); };
  }, [pathname, search]);
  return missing ? <p role="status">That record could not be located in this view. Check the source state or reload the zone.</p> : null;
}
