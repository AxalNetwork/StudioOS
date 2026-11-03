import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import NotFoundPage from '../NotFoundPage';
import { setSuppressAuthRedirect } from '../../lib/api';
import { publicHandlesApi } from '../../lib/api/publicHandles';
import { keepFirstTouch, visitorId } from '../../lib/referralRef';

/**
 * D4289 P2 (#4291) — the stub behind `axal.vc/@handle` and `/@handle/<channel>`
 * until P8 draws IN7. It reads the public handle, keeps the first-touch cookie
 * (`h:<handle>[:<channel>]`, 90 days) for a live one, and shows the name, the
 * line, the disclosure and Join. A moved handle redirects; a paused or ended
 * influencer reads as a neutral page with no attribution; an unknown handle
 * says so, with Join anyway. A first segment without `@` is not a handle: the
 * app's 404.
 */
export default function HandlePage() {
  const { at = '', channel = null } = useParams();
  const isHandle = at.startsWith('@');
  const handle = isHandle ? at.slice(1) : '';
  const [state, setState] = useState({ status: 'loading' });

  // A public page: an anonymous visitor's background 401s must not bounce it to /login.
  useLayoutEffect(() => {
    setSuppressAuthRedirect(true);
    return () => setSuppressAuthRedirect(false);
  }, []);

  useEffect(() => {
    if (!isHandle) return undefined;
    let live = true;
    publicHandlesApi.read(handle, channel, visitorId())
      .then((d) => {
        if (!live) return;
        if (d?.state === 'live' && d.ref) keepFirstTouch(d.ref);
        setState({ status: 'ok', data: d });
      })
      .catch((e) => { if (live) setState({ status: e?.status === 404 ? 'unknown' : 'error' }); });
    return () => { live = false; };
  }, [isHandle, handle, channel]);

  if (!isHandle) return <NotFoundPage />;
  const d = state.data;
  if (state.status === 'ok' && d?.state === 'moved' && d.redirect) return <Navigate to={d.redirect} replace />;

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12" data-testid="handle-page">
      {state.status === 'loading' && <p className="text-sm text-[#6b6577] dark:text-gray-400">Loading…</p>}
      {state.status === 'error' && (
        <p className="text-sm text-[#6b6577] dark:text-gray-400" data-testid="handle-error">This page could not be read. That is not the same as it not existing. Try again in a moment.</p>
      )}
      {(state.status === 'unknown' || (state.status === 'ok' && d?.state === 'unknown')) && (
        <section data-testid="handle-unknown">
          <h1 className="text-2xl font-semibold text-[#18181b] dark:text-gray-100">This page doesn't exist</h1>
          <Link to="/register" className="mt-6 inline-block rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white">Join anyway</Link>
        </section>
      )}
      {state.status === 'ok' && d?.state === 'unavailable' && (
        <section data-testid="handle-unavailable">
          <h1 className="text-2xl font-semibold text-[#18181b] dark:text-gray-100">Axal VC</h1>
          <p className="mt-2 text-sm text-[#6b6577] dark:text-gray-400">This invitation is not available right now.</p>
          <Link to="/register" className="mt-6 inline-block rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white">Join Axal VC</Link>
        </section>
      )}
      {state.status === 'ok' && d?.state === 'live' && (
        <section data-testid="handle-live">
          {d.photo && <img src={d.photo} alt="" className="mb-4 h-16 w-16 rounded-full object-cover" />}
          <h1 className="text-2xl font-semibold text-[#18181b] dark:text-gray-100">{d.name} invites you to Axal VC</h1>
          {d.tier_label && <p className="mt-1 text-xs text-[#6b6577] dark:text-gray-400">{d.tier_label}</p>}
          {d.line && <p className="mt-4 text-base text-[#18181b] dark:text-gray-200">{d.line}</p>}
          <p className="mt-6 text-sm text-[#6b6577] dark:text-gray-400" data-testid="handle-disclosure">{d.disclosure}</p>
          <Link to={`/register?ref=${encodeURIComponent(d.ref)}`} className="mt-6 inline-block rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white" data-testid="handle-join">
            Join with {d.name}
          </Link>
        </section>
      )}
    </main>
  );
}
