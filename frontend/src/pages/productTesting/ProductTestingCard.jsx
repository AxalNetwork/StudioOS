/**
 * D814 (#2260) — "Apply for Product Testing", board D2: the card on the
 * founder's, investor's, advisor's and operating partner's Studio pages.
 *
 * It reads `GET /api/testing/summary` (D812): `open_count`, what the caller
 * could apply to now, and `picked`, each programme they were picked for, which
 * draws a "You're in: <product>" badge. Loading, "Unreadable" with Try again,
 * and ready; the count is always the Worker's, never a placeholder.
 *
 * A role preview draws nothing: the summary is the signed-in account's, so an
 * administrator previewing a Studio page would read their own counts.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleAlert, FlaskConical, Loader2, RefreshCw } from 'lucide-react';
import { productTestingApi } from '../../lib/api.js';
import { reportError } from '../../lib/log.js';
import { Pill } from '../../ui';
import { PRODUCT_TESTING_PATH, openLine } from './productTestingModel.js';

export default function ProductTestingCard({ previewing = false, className = '' }) {
  const [read, setRead] = useState({ state: 'loading' });
  const [n, setN] = useState(0);
  const retry = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (previewing) return undefined;
    let alive = true;
    setRead({ state: 'loading' });
    productTestingApi.summary()
      .then((data) => { if (alive) setRead({ state: 'ready', data }); })
      .catch((e) => { if (alive) { reportError('ProductTestingCard', e); setRead({ state: 'unreadable' }); } });
    return () => { alive = false; };
  }, [previewing, n]);
  if (previewing) return null;

  const count = read.state === 'ready' ? Number(read.data?.open_count) : NaN;
  const picked = read.state === 'ready' && Array.isArray(read.data?.picked) ? read.data.picked : [];
  return (
    <section className={`rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40 ${className}`.trim()}
      data-testid="card-product-testing" data-state={read.state}>
      <header className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/40 dark:text-violet-300"><FlaskConical size={17} /></span>
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold text-axal-ink dark:text-gray-100">Test new products before they launch</h2>
          {read.state === 'loading' && <p className="flex items-center gap-1.5 text-[12.5px] text-axal-muted dark:text-gray-400" role="status"><Loader2 size={12} className="animate-spin" /> Loading…</p>}
          {read.state === 'unreadable' && (
            <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-axal-muted dark:text-gray-400" role="alert" data-testid="product-testing-unreadable">
              <CircleAlert size={12} className="text-red-600 dark:text-red-400" /> <b className="text-axal-ink dark:text-gray-100">Unreadable</b>
              <button type="button" className="inline-flex items-center gap-1 font-semibold underline" onClick={retry} data-testid="product-testing-retry"><RefreshCw size={11} /> Try again</button>
            </p>
          )}
          {read.state === 'ready' && <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="product-testing-count">{Number.isFinite(count) ? openLine(count) : 'Open programmes not recorded'}</p>}
        </div>
      </header>
      {picked.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" data-testid="product-testing-picked">
          {picked.map((p) => <Pill key={p.programme_uid} tone="ok" data-testid={`badge-picked-${p.programme_uid}`}>You&rsquo;re in: {p.product_name}</Pill>)}
        </div>
      )}
      <Link to={PRODUCT_TESTING_PATH} className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" data-testid="link-product-testing">
        See programmes <ArrowUpRight size={12} />
      </Link>
    </section>
  );
}
