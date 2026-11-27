import React, { useCallback, useEffect, useState } from 'react';
import { productTestingApi } from '../../../lib/api/productTesting.js';
import { applicationFor, isOpenApplication, noticeTarget } from './testerModel.js';
import { ApplicationSheet, PoolSheet } from './TesterSheets.jsx';
import Sheet from '../../../ui/Sheet.jsx';

/**
 * D1337 (#3542, PT-M4) — the Inbox's Product testing notices open the matching
 * Sheet in place, instead of linking back to `/inbox`:
 *   · a member's testing notice (applied, picked, not picked, withdrawn,
 *     programme closed) opens My application for its programme;
 *   · HQ's tester-status notice opens the member's place in the pool.
 * A notice whose application is still open carries Withdraw, which opens the
 * same sheet with its confirm showing.
 *
 * The applications and the pool are read only when the list holds a notice
 * that needs them. A failed read is said in the sheet, never drawn as "none".
 */
export function useInboxTesting(items, api = productTestingApi) {
  const [apps, setApps] = useState({ status: 'idle' });
  const [pool, setPool] = useState({ status: 'idle' });
  const [open, setOpen] = useState(null);
  const targets = (items || []).map(noticeTarget);
  const needApps = targets.some((t) => t?.kind === 'application');
  const needPool = targets.some((t) => t?.kind === 'pool');

  const readApps = useCallback(async () => {
    setApps({ status: 'loading' });
    try { setApps({ status: 'ok', items: (await api.myApplications())?.items || [] }); } catch { setApps({ status: 'error' }); }
  }, [api]);
  const readPool = useCallback(async () => {
    setPool({ status: 'loading' });
    try { setPool({ status: 'ok', data: await api.tester() }); } catch { setPool({ status: 'error' }); }
  }, [api]);
  useEffect(() => { if (needApps && apps.status === 'idle') readApps(); }, [needApps, apps.status, readApps]);
  useEffect(() => { if (needPool && pool.status === 'idle') readPool(); }, [needPool, pool.status, readPool]);

  /** True when the notice was a testing one and its sheet is now open. */
  const openFor = (n, ask = false) => {
    const target = noticeTarget(n);
    if (!target) return false;
    setOpen({ target, ask });
    return true;
  };
  /** The Withdraw link for a notice whose application is still open, else null. */
  const actionFor = (n) => {
    const target = noticeTarget(n);
    const a = apps.status === 'ok' ? applicationFor(target, apps.items) : null;
    if (!a || !isOpenApplication(a)) return null;
    return (
      <button type="button" onClick={() => setOpen({ target, ask: true })} data-testid={`inbox-withdraw-${n.id}`}
        className="inline-flex min-h-11 shrink-0 items-center px-3 text-[13px] font-semibold text-red-700 hover:underline sm:min-h-10 dark:text-red-400">Withdraw</button>
    );
  };

  const close = () => setOpen(null);
  let sheet = null;
  if (open?.target.kind === 'pool') {
    sheet = pool.status === 'ok'
      ? <PoolSheet read={pool.data} api={api} onClose={close} onChanged={(next) => setPool({ status: 'ok', data: next })} />
      : <NotRead title="Your place in the tester pool" status={pool.status} onRetry={readPool} onClose={close} />;
  } else if (open?.target.kind === 'application') {
    const a = apps.status === 'ok' ? applicationFor(open.target, apps.items) : null;
    sheet = a
      ? <ApplicationSheet key={`${a.uid}-${open.ask ? 'ask' : 'view'}`} application={a} ask={open.ask} api={api} onClose={close} onWithdrawn={readApps} />
      : <NotRead title="My application" status={apps.status === 'ok' ? 'missing' : apps.status} onRetry={readApps} onClose={close} />;
  }
  return { openFor, actionFor, sheet };
}

/** The sheet when its read is still going, failed, or found nothing to show. */
function NotRead({ title, status, onRetry, onClose }) {
  const text = status === 'missing'
    ? 'This application is no longer on your record.'
    : status === 'error' ? 'Could not be read. That isn’t the same as having none.' : 'Reading…';
  return (
    <Sheet title={title} eyebrow="Product testing" onClose={onClose} width={560} testId="pt-notread">
      <div className="flex flex-col items-start gap-2.5 px-5 py-[18px]">
        <p className="m-0 text-[13px] text-gray-700 dark:text-gray-300" data-testid="pt-notread-text">{text}</p>
        {status === 'error' && (
          <button type="button" onClick={onRetry} data-testid="pt-notread-retry"
            className="inline-flex min-h-11 items-center rounded-lg border border-axal-hairline px-3.5 text-[13.5px] font-semibold text-axal-ink sm:min-h-10 dark:border-gray-700 dark:text-gray-100">Try again</button>
        )}
      </div>
    </Sheet>
  );
}
