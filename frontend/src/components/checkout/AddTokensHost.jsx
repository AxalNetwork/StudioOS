import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ADD_TOKENS_EVENT, ADD_TOKENS_PATH, addTokensHref, isAddTokensHref, packOfHref } from '../../lib/aiTokens';
import PackSheet from './PackSheet';

/**
 * D1288 (#3371, CRP9) — the one Add tokens. Mounted once beside the checkout
 * host (App.jsx) for a signed-in member; it renders nothing until asked, then
 * draws D1287's sheet in pack mode over the page the member is on, with no
 * route change. Closing it, or its landing's "Back to [page]", leaves them
 * where they were.
 *
 * It is asked two ways:
 *   - `openAddTokens({ from, pack_uid })`, for a button;
 *   - a plain click on any link to `ADD_TOKENS_PATH` (the rail, the Assist
 *     card, Usage, AI tokens, Build, the narrative, the pitch deck, a session
 *     digest). Each caller keeps one link with one address, so a visitor, a
 *     new tab or a link from outside the app still reaches Pricing's Models
 *     tab, which opens the same sheet (`ADD_TOKENS_HASH`).
 * On `/pricing` itself the link is left to the page, which opens its own.
 */

/** The page a member came from, in the landing's "Back to [page]". */
export const FROM_OF_PATH = Object.freeze([
  ['/account/usage', 'Usage'],
  ['/account/ai-tokens', 'AI tokens'],
  ['/account/billing', 'Billing'],
  ['/account', 'your account'],
  ['/raise/narrative', 'Narrative'],
  ['/raise/pitch', 'Pitch deck'],
  ['/cycles/build', 'Build'],
  ['/cycles', 'your cycle'],
]);
export function fromOfPath(pathname) {
  const p = String(pathname || '');
  const hit = FROM_OF_PATH.find(([prefix]) => p === prefix || p.startsWith(`${prefix}/`));
  return hit ? hit[1] : 'where you were';
}

/** A click the host takes: a plain left click on a same-tab link to Add tokens, off Pricing. */
export function takesClick(e, pathname) {
  if (!e || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  if (pathname === '/pricing') return null;
  const a = typeof e.target?.closest === 'function' ? e.target.closest('a') : null;
  if (!a || (a.getAttribute('target') && a.getAttribute('target') !== '_self')) return null;
  const href = a.getAttribute('href');
  return isAddTokensHref(href) ? a : null;
}

export default function AddTokensHost({ user }) {
  const [ask, setAsk] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onAsk = (e) => setAsk({ from: e?.detail?.from || fromOfPath(window.location?.pathname), pack: e?.detail?.pack_uid || null });
    // Capture, so a router link sees the click already handled and does not navigate.
    const onClick = (e) => {
      const a = takesClick(e, window.location?.pathname);
      if (!a) return;
      e.preventDefault();
      setAsk({ from: fromOfPath(window.location?.pathname), pack: packOfHref(a.getAttribute('href')) });
    };
    window.addEventListener(ADD_TOKENS_EVENT, onAsk);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener(ADD_TOKENS_EVENT, onAsk);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
  if (!user || !ask) return null;
  return <PackSheet pack={ask.pack} from={ask.from} onClose={() => setAsk(null)} />;
}

// D1288 (#3371): the old addresses for buying tokens land on Add tokens
// (ADD_TOKENS_PATH, Pricing's Models tab, which opens the sheet), keeping the
// pack: the old storefront's token-packs anchor, and the checkout page's
// `token_pack` and `ai_topup` queries. Anything else is the page it always was.
export function TokensRedirect({ children }) {
  const loc = useLocation();
  const q = new URLSearchParams(loc.search);
  if (loc.pathname === '/pricing/products' && loc.hash === '#token-packs') return <Navigate to={ADD_TOKENS_PATH} replace />;
  if (loc.pathname === '/checkout' && q.has('token_pack')) return <Navigate to={addTokensHref(q.get('token_pack'))} replace />;
  if (loc.pathname === '/checkout' && q.get('ai_topup') === '1') return <Navigate to={ADD_TOKENS_PATH} replace />;
  return children;
}
