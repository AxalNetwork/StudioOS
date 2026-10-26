/**
 * D1213 (#2424) — Contracts › Closings, the admin's desk (CP13), and one
 * closing (CP14) at its own address. The desk lists every deal with a closing
 * deadline, by deadline, from `GET /api/deals`; a closing is its deal until the
 * closings store lands (part 2), so lines waiting, next actor and owner say
 * "Not read here yet".
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Unreadable, Unrecorded } from '../../ui';
import AdminPageHeader from '../../ui/AdminPageHeader';
import { dealMoney } from '../../components/deals/dealMoney';
import ClosingRoom, { Wait } from './ClosingRoom';
import { DESK_PATH, SOON_DAYS, deskRows } from './closingModel';

const CONTRACTS = { label: 'Contracts', to: '/admin/contracts' };

function money(v, currency) {
  const s = dealMoney(v, currency);
  return s || <Unrecorded reason="Not recorded on this deal." />;
}

export function ClosingsDeskPage() {
  const [state, setState] = useState({ status: 'loading', rows: [] });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', rows: [] });
    api.listDeals().then((d) => { if (live) setState({ status: 'ok', rows: deskRows(d) }); }, () => { if (live) setState({ status: 'error', rows: [] }); });
    return () => { live = false; };
  }, [tick]);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="closings-desk">
      <AdminPageHeader crumb={{ ...CONTRACTS, current: 'Closings' }} title="Closings"
        line="Every deal round from terms agreed to money in the company's account. The platform records and matches; it never moves money." />
      <Wait id="closings" />
      {state.status === 'loading' && <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />}
      {state.status === 'error' && <Unreadable what="The deals" claim="This is not a claim that no closing is open." onRetry={() => setTick((n) => n + 1)} />}
      {state.status === 'ok' && (state.rows.length === 0
        ? <p className="m-0 text-sm text-gray-600 dark:text-gray-400" data-testid="closings-desk-empty">No deal has a closing deadline recorded. Set one on the deal to see its closing here.</p>
        : (
          <table className="w-full text-left text-[13px]" data-testid="closings-desk-table">
            <thead><tr className="text-[11px] uppercase text-gray-500"><th className="py-1">Company</th><th>Instrument</th><th>Target</th><th>Confirmed</th><th>Deadline</th></tr></thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800" data-testid={`closings-desk-row-${r.id}`}>
                  <td className="py-1.5"><Link to={`/admin/contracts/closings/${r.id}`} className="font-semibold underline">{r.name}</Link></td>
                  <td>{r.instrument || <Unrecorded reason="No instrument is recorded on this deal." />}</td>
                  <td>{money(r.target, r.currency)}</td>
                  <td>{money(r.confirmed, r.currency)}</td>
                  <td>{r.deadline}{r.left != null && <span className={r.soon ? 'ml-1 font-bold text-amber-700 dark:text-amber-300' : 'ml-1 text-gray-500'}>{r.left < 0 ? ` · ${-r.left} days past` : ` · in ${r.left} days`}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      <p className="m-0 text-[12px] text-gray-500">Deadlines under {SOON_DAYS} days are marked.</p>
    </div>
  );
}

export function AdminClosingPage() {
  const { dealId } = useParams();
  const ok = /^[1-9]\d*$/.test(String(dealId || ''));
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="admin-closing">
      <AdminPageHeader crumb={{ label: 'Closings', to: DESK_PATH, current: 'One closing' }} title="Closing" line="One deal round: its lines, checklist and recorded transfers, and what waits on the closings store." />
      {ok ? <ClosingRoom dealId={Number(dealId)} role="admin" /> : <p className="m-0 text-sm" data-testid="admin-closing-missing">There is no closing at this address. <Link to={DESK_PATH} className="underline">Open Closings.</Link></p>}
    </div>
  );
}
