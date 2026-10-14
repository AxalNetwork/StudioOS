/**
 * The pure half of `Lightbox.jsx` (D685, #1587): the rules for keeping a
 * dialog modal. They take plain objects, so they are tested without a browser.
 *
 *   · `FOCUSABLE`      what Tab may land on inside the dialog.
 *   · `tabTarget`      where Tab / Shift+Tab goes, so focus never leaves.
 *   · `tabbable`       the controls Tab may reach now, inside the innermost
 *                      modal dialog of the box (D686): drawn, not inert, not
 *                      hidden. Re-read on every Tab.
 *   · `lockScroll`     the page behind stops scrolling, the body and the
 *                      shell's own scroller (`[data-app-scroll]`); counted, so
 *                      two open dialogs release it only when the last closes.
 *   · `inertOutside`   everything that is not the dialog becomes inert and
 *                      hidden from a screen reader, and is put back on close.
 *   · `topmost`        a stack, so Escape closes only the dialog on top.
 */

/** Elements a keyboard can reach. A disabled control, a hidden input and tabindex=-1 are not. */
export const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Where Tab goes. `focusables` is the dialog's tabbable elements in order and
 * `active` the one focused now (or null / outside the list). Returns the index
 * to focus, or null to let the browser move focus on its own because it stays
 * inside the dialog.
 */
export function tabTarget(focusables, active, shift) {
  const n = focusables.length;
  if (n === 0) return -1; // nothing to land on: the dialog itself holds focus
  const at = focusables.indexOf(active);
  if (at === -1) return shift ? n - 1 : 0; // focus is outside the list: pull it in
  if (shift && at === 0) return n - 1;
  if (!shift && at === n - 1) return 0;
  return null;
}

/**
 * The controls Tab may land on inside `box`, in order. The scope is the
 * innermost `[aria-modal="true"]` inside the box, so a dialog opened over the
 * lightbox keeps Tab to itself. A control is drawn when it has a client rect
 * (`offsetParent` is null for every `position: fixed` element, which would
 * drop a nested fixed dialog's buttons); one under an `[inert]` or `[hidden]`
 * ancestor is skipped. `active` is kept even when it has no rect, so focus on
 * it is never lost.
 */
export function tabbable(box, active = null) {
  if (!box || typeof box.querySelectorAll !== 'function') return [];
  const modals = Array.from(box.querySelectorAll('[aria-modal="true"]'));
  const scope = modals.length ? modals[modals.length - 1] : box;
  const blocked = (n) => {
    for (let p = n; p && p !== box; p = p.parentNode) {
      if (typeof p.hasAttribute === 'function' && (p.hasAttribute('inert') || p.hasAttribute('hidden'))) return true;
    }
    return false;
  };
  return Array.from(scope.querySelectorAll(FOCUSABLE)).filter((n) => {
    if (n === active) return true;
    if (blocked(n)) return false;
    return typeof n.getClientRects !== 'function' || n.getClientRects().length > 0;
  });
}

/**
 * Lock the page's scroll: the body, and the shell's own scroller (`scrollers`,
 * by default every `[data-app-scroll]`), whose overflow the body lock alone
 * leaves free. The first lock saves each inline overflow and scroll position
 * and reserves the scrollbar's gutter; the last release puts them back.
 * Returns the release function. Ref-counted.
 */
let locks = 0;
let saved = null;
export function lockScroll(body, scrollers) {
  if (!body || !body.style) return () => {};
  if (locks === 0) {
    const list = scrollers ?? (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function' ? Array.from(document.querySelectorAll('[data-app-scroll]')) : []);
    saved = {
      overflow: body.style.overflow, paddingRight: body.style.paddingRight,
      scrollers: Array.from(list || []).filter((el) => el && el.style).map((el) => ({
        el, overflow: el.style.overflow, gutter: el.style.scrollbarGutter, top: el.scrollTop,
      })),
    };
    body.style.overflow = 'hidden';
    for (const s of saved.scrollers) { s.el.style.overflow = 'hidden'; s.el.style.scrollbarGutter = 'stable'; }
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0 && saved) {
      body.style.overflow = saved.overflow;
      body.style.paddingRight = saved.paddingRight;
      for (const s of saved.scrollers) {
        s.el.style.overflow = s.overflow;
        s.el.style.scrollbarGutter = s.gutter;
        if (typeof s.top === 'number') s.el.scrollTop = s.top;
      }
      saved = null;
    }
  };
}
/** For tests: the live lock count. */
export const scrollLocks = () => locks;

/**
 * Make everything outside `dialog` inert: walk up from it to `root`, and at
 * each level mark every sibling of the path. `inert` stops clicks, focus and
 * the accessibility tree together; `aria-hidden` covers a browser without it.
 * What was already inert or hidden is left alone, and so is not undone on close.
 * Returns the function that puts it back.
 */
export function inertOutside(dialog, root) {
  const marked = [];
  let node = dialog;
  while (node && node !== root && node.parentNode) {
    const parent = node.parentNode;
    for (const sibling of Array.from(parent.children || [])) {
      if (sibling === node || sibling.nodeType !== 1) continue;
      const tag = String(sibling.tagName || '').toLowerCase();
      if (tag === 'script' || tag === 'style') continue;
      const was = { el: sibling, inert: sibling.hasAttribute('inert'), hidden: sibling.getAttribute('aria-hidden') };
      if (!was.inert) sibling.setAttribute('inert', '');
      if (was.hidden == null) sibling.setAttribute('aria-hidden', 'true');
      marked.push(was);
    }
    node = parent;
  }
  return () => {
    for (const was of marked) {
      if (!was.inert) was.el.removeAttribute('inert');
      if (was.hidden == null) was.el.removeAttribute('aria-hidden');
    }
  };
}

/** The stack of open dialogs: only the top one answers Escape. */
const stack = [];
export function pushDialog(id) { stack.push(id); return () => { const i = stack.lastIndexOf(id); if (i >= 0) stack.splice(i, 1); }; }
export const topmost = (id) => stack.length > 0 && stack[stack.length - 1] === id;
