import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deckAccessApi } from '../../../lib/api/deckAccess';
import { openPaywall } from '../../../components/PaywallModal';
import { TITLE } from './pitchStudioModel';
import { FEATURE, LOCKED_TITLE, PLANS, PLANS_HREF, RETRY, UNREAD_LINE, UNREAD_TITLE, UPGRADE, accessState } from './studioAccessModel';

/**
 * D4359 (#4359, #2434 Q8 = A) — the studio's plan gate. Every studio page is
 * drawn inside it: open when the Worker says this member may use the studio
 * (`GET /api/decks/access`), else the locked card with the upgrade path. A
 * failed read shows that the plan could not be checked, never the studio.
 */
export default function StudioGate({ children }) {
  const [read, setRead] = useState({ status: 'loading' });
  const load = useCallback(() => {
    let live = true;
    setRead({ status: 'loading' });
    deckAccessApi.get()
      .then((data) => { if (live) setRead({ status: 'ready', data }); })
      .catch(() => { if (live) setRead({ status: 'error' }); });
    return () => { live = false; };
  }, []);
  useEffect(() => load(), [load]);

  const s = accessState(read);
  if (s.state === 'open') return children;
  if (s.state === 'loading') return <div className="mx-auto mt-6 max-w-[560px] text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="pitch-studio-gate-loading" aria-busy="true">Checking your plan…</div>;
  const locked = s.state === 'locked';
  return (
    <section className="mx-auto mt-6 flex max-w-[560px] flex-col gap-2.5 rounded-[12px] border border-axal-hairline bg-white p-6 dark:border-gray-700 dark:bg-gray-900"
      data-testid={locked ? 'pitch-studio-locked' : 'pitch-studio-unread'} data-tier={locked ? s.tier : undefined}>
      <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400">{TITLE}</span>
      <h1 className="m-0 text-[16px] font-extrabold leading-snug tracking-[-.02em] text-axal-ink dark:text-gray-100">{locked ? LOCKED_TITLE : UNREAD_TITLE}</h1>
      <p className="m-0 text-[12.5px] leading-[1.5] text-axal-muted dark:text-gray-400">{locked ? s.message : UNREAD_LINE}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {locked ? (
          <>
            <button type="button" data-testid="pitch-studio-upgrade" onClick={() => openPaywall(s.tier, s.message, FEATURE)}
              className="inline-flex min-h-[36px] items-center rounded-full bg-axal-violet-deep px-4 text-[12.5px] font-semibold text-white hover:opacity-90 dark:bg-violet-500">
              {UPGRADE}
            </button>
            <Link to={PLANS_HREF} data-testid="pitch-studio-plans" className="text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">{PLANS}</Link>
          </>
        ) : (
          <button type="button" data-testid="pitch-studio-retry" onClick={load}
            className="inline-flex min-h-[36px] items-center rounded-full border border-axal-hairline px-4 text-[12.5px] font-semibold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800">
            {RETRY}
          </button>
        )}
      </div>
    </section>
  );
}
