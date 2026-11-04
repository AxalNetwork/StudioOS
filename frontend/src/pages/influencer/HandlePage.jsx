import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import NotFoundPage from '../NotFoundPage';
import SitePage from '../../components/site/SitePage';
import { setSuppressAuthRedirect } from '../../lib/api';
import { publicHandlesApi } from '../../lib/api/publicHandles';
import { keepFirstTouch, visitorId } from '../../lib/referralRef';
import { PRICE_UNREAD_LINE, priceText, usePlansRead } from '../../lib/planPrices';
import { HANDLE_PLANS, disclosureOf, offerLines } from './influencerPublicModel';

/**
 * `axal.vc/@handle` and `/@handle/<channel>` — IN7 (D4297, #4297; the read is
 * P2's D4291, #4291). A live handle shows the influencer's card (photo, name,
 * tier, line), their featured offer (P4 #4293), Join with their reference, the
 * disclosure, and the four plans with prices read from Stripe's mirror
 * (`lib/planPrices.js`), never typed. It keeps the first-touch cookie
 * (`h:<handle>[:<channel>]`, 90 days) for a live handle only.
 *
 * States (in7s): an unknown handle says so, with Join anyway; a paused or
 * ended influencer is a neutral page with no name, offer or attribution; a
 * moved handle redirects; a read that failed says so. A first segment without
 * `@` is not a handle: the app's 404.
 */
export default function HandlePage() {
  const { at = '', channel = null } = useParams();
  const isHandle = at.startsWith('@');
  const handle = isHandle ? at.slice(1) : '';
  const [state, setState] = useState({ status: 'loading' });
  const plans = usePlansRead();

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
  const isLive = state.status === 'ok' && d?.state === 'live';
  const offer = isLive ? offerLines(d.offer) : null;
  const first = isLive ? String(d.name || '').split(' ')[0] || d.name : '';

  return (
    <SitePage title={isLive ? `${d.name} invites you to Axal VC` : 'Axal VC'} signup={false}>
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14" data-testid="handle-page">
        {state.status === 'loading' && <p className="text-sm text-[#6b6577]">Loading…</p>}
        {state.status === 'error' && (
          <p className="text-sm text-[#6b6577]" data-testid="handle-error">This page could not be read. That is not the same as it not existing. Try again in a moment.</p>
        )}
        {(state.status === 'unknown' || (state.status === 'ok' && d?.state === 'unknown')) && (
          <section data-testid="handle-unknown">
            <h1 className="text-2xl font-semibold text-[#18181b]">This page doesn’t exist</h1>
            <p className="mt-2 text-sm text-[#6b6577]">{`axal.vc/@${handle} is not an Axal Influencer handle.`}</p>
            <Link to="/register" className="mt-6 inline-block rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white">Join anyway</Link>
          </section>
        )}
        {state.status === 'ok' && d?.state === 'unavailable' && (
          <section data-testid="handle-unavailable">
            <h1 className="text-2xl font-semibold text-[#18181b]">Axal VC</h1>
            <p className="mt-2 text-sm text-[#6b6577]">No offer is shown and no sign-up is credited while this page is paused.</p>
            <Link to="/register" className="mt-6 inline-block rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white">Join Axal VC</Link>
          </section>
        )}
        {isLive && (
          <section data-testid="handle-live" className="flex flex-col gap-6">
            <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
              {d.photo
                ? <img src={d.photo} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover" />
                : <span aria-hidden="true" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xl font-semibold text-violet-800">{String(d.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>}
              <div className="flex flex-col gap-1">
                <h1 className="m-0 text-2xl font-semibold text-[#18181b]">{d.name} invites you to Axal VC</h1>
                {d.tier_label && <p className="m-0 text-xs font-semibold text-violet-700" data-testid="handle-tier">{`✓ ${d.tier_label}`}</p>}
                {d.line && <p className="m-0 mt-2 text-base text-[#18181b]" data-testid="handle-line">{d.line}</p>}
              </div>
            </div>

            {offer && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4" data-testid="handle-offer">
                <p className="m-0 text-lg font-semibold text-[#18181b]">{offer.discount}</p>
                <p className="m-0 mt-1 text-sm text-[#6b6577]">{`${offer.plans} · ${offer.who} · ${offer.ends}`}</p>
                <p className="m-0 mt-2 text-xs text-[#6b6577]">Applied automatically at checkout when you join through this page.</p>
              </div>
            )}

            <Link to={`/register?ref=${encodeURIComponent(d.ref)}`} className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white sm:w-auto sm:self-start" data-testid="handle-join">
              {offer ? `Join with ${first}’s offer` : `Join with ${d.name}`}
            </Link>
            <p className="m-0 text-sm text-[#6b6577]" data-testid="handle-disclosure">{disclosureOf(d)}</p>

            <p className="m-0 text-sm text-[#18181b]">Axal VC is a platform where founders build companies through four cycles. Investors, advisors and operating partners work beside them. Each plan is a monthly software membership.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="handle-plans">
              {HANDLE_PLANS.map((p) => (
                <div key={p.key} className="rounded-xl border border-[#e4e0ec] bg-white p-4" data-testid={`handle-plan-${p.key}`}>
                  <p className="m-0 font-semibold text-[#18181b]">{p.name}</p>
                  <p className="m-0 mt-1 font-mono text-sm text-[#18181b]">{priceText(plans, p.key)}</p>
                  <p className="m-0 mt-1 text-xs text-[#6b6577]">{p.line}</p>
                </div>
              ))}
            </div>
            {plans.status === 'error' && <p className="m-0 text-xs text-[#6b6577]" data-testid="handle-prices-unread">{PRICE_UNREAD_LINE}</p>}
          </section>
        )}
      </div>
    </SitePage>
  );
}
