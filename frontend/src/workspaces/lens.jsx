import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, parsePath, useLocation, useNavigate } from 'react-router-dom';

/**
 * D575 — on a phone, a workspace shows one lens at a time and switches lenses
 * WITHOUT changing the route (mobile canvas M2, the owner's answer on #977).
 *
 * WHAT A LENS IS. Each zone of a workspace already has its own route
 * (`/build/board`, `/fund/lps`), and that stays the address a desktop pill
 * navigates to, a deep link opens and a person shares. On a phone a pill does
 * not navigate: it sets a LENS LOCATION here, and App's one `<Routes>` renders
 * that location instead of the browser's. So the zone's own route element,
 * with its own guard, renders in place, while the URL and the history stack
 * stay exactly where they were.
 *
 * WHAT THE ROUTES STILL GIVE.
 *  - A deep link opens its lens: with no lens set, `<Routes>` renders the URL.
 *  - Back leaves the workspace: switching pushes nothing, so the entry before
 *    the workspace is the one Back returns to, as on a single page.
 *  - Any real navigation (a link, Back, Forward) clears the lens, because a
 *    lens belongs to the history entry it was opened on (`forKey`).
 *  - A pill is still a real `<a href>` to the lens's route, so long-press →
 *    Copy link shares that lens, and a modified click opens it in a new tab.
 *  - Widening past the phone breakpoint with a lens open REPLACES the URL with
 *    the lens's route, so the desktop pill row and the address bar agree. It
 *    replaces rather than pushes, so it still adds no history entry.
 *
 * THE BREAKPOINT is the phone tab bar's (D425, `lg:hidden`): below 1024px.
 */
export const PHONE_QUERY = '(max-width: 1023px)';

export function isPhoneWidth() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia(PHONE_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Whether a click on a pill switches the lens in place. Only a plain primary
 * click on a phone does: a modified or middle click, a link opening another
 * target, or a click something else already handled keeps the browser's own
 * behaviour, which for a NavLink is to navigate.
 */
export function switchesInPlace(event, phone) {
  if (!phone || !event) return false;
  if (event.defaultPrevented) return false;
  if (event.button !== undefined && event.button !== 0) return false;
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return false;
  const target = event.currentTarget?.getAttribute?.('target');
  if (target && target !== '_self') return false;
  return true;
}

const pathOf = (loc) => `${loc.pathname || '/'}${loc.search || ''}`;

/**
 * The lens a switch to `to` opens from the real `location`. Switching to the
 * lens the URL already names is no lens at all — the route renders as it is.
 */
export function openLens(location, to, state = null) {
  const target = typeof to === 'string' ? parsePath(to) : { ...(to || {}) };
  const lens = {
    pathname: target.pathname || location.pathname,
    search: target.search || '',
    hash: target.hash || '',
    state,
  };
  if (pathOf(lens) === pathOf(location)) return null;
  return { forKey: location.key, location: { ...lens, key: `lens:${pathOf(lens)}` } };
}

/** The lens to render on `location`, or null. A lens opened on another history entry is spent. */
export function activeLens(lens, location) {
  return lens && lens.forKey === location.key ? lens.location : null;
}

const LensContext = createContext(null);

/**
 * `initial` opens a lens on first render. Nothing in the app passes it: it is
 * how a render with no click to make (the tests) shows a switched lens.
 */
export function LensProvider({ children, initial = null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [lens, setLens] = useState(() => (initial ? openLens(location, initial) : null));
  const current = activeLens(lens, location);

  const switchLens = useCallback((to, state) => setLens(openLens(location, to, state)), [location]);

  useEffect(() => {
    if (!current || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = () => {
      if (!mq.matches) {
        const { pathname, search, hash, state } = current;
        navigate({ pathname, search, hash }, { replace: true, state });
      }
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [current, navigate]);

  const value = useMemo(() => ({ lens: current, switchLens }), [current, switchLens]);
  return <LensContext.Provider value={value}>{children}</LensContext.Provider>;
}

/** The location App's `<Routes>` renders: the lens when one is open, else null (the URL). */
export function useLensLocation() {
  return useContext(LensContext)?.lens || null;
}

/**
 * What a pill does with a click. On a phone it cancels the NavLink's own
 * navigation (`preventDefault`, which Link checks before it navigates) and
 * switches the lens; anywhere else it leaves the click to the NavLink.
 */
export function pillClick(event, { phone, ctx, to, state, onClick }) {
  onClick?.(event);
  if (ctx && switchesInPlace(event, phone)) {
    event.preventDefault();
    ctx.switchLens(to, state);
  }
}

function useLensClick(to, state, onClick) {
  const ctx = useContext(LensContext);
  return (event) => pillClick(event, { phone: isPhoneWidth(), ctx, to, state, onClick });
}

/**
 * A zone pill. A NavLink on a desktop, a lens switch on a phone. Outside a
 * LensProvider it is a plain NavLink.
 */
export function LensNavLink({ to, state, onClick, ...rest }) {
  const handle = useLensClick(to, state, onClick);
  return <NavLink to={to} state={state} onClick={handle} {...rest} />;
}

/** The same, for the hand-built zone rows that use a plain Link. */
export function LensLink({ to, state, onClick, ...rest }) {
  const handle = useLensClick(to, state, onClick);
  return <Link to={to} state={state} onClick={handle} {...rest} />;
}
