/**
 * D1213 (#2424) — one deal's closing room (CP1, CP2, CP14, CP19). The founder
 * sees it under Raise › Capital relationships › Closing, an investor and the
 * staff on the deal page's Closing tab, an Admin at Contracts › Closings › one
 * closing. Each read fails on its own block.
 *
 * D1218 (#3215): when the deal has a closing in the store (D1215), the
 * founder, an investor and an Admin read the room from it (`RecordRoom.jsx`).
 * Until the studio team opens one, and for an Operating Partner (who reads no
 * closing record), the room is the deal's, as D1213 drew it. Anyone else meets
 * the no-permission card, and no read is made (CP19).
 *
 * Who sees what (#2424 owner question 3, its recommended answer):
 * - founder and admin: every line;
 * - investor: their own line, and the round's confirmed total only;
 * - Operating Partner: the checklist, the transfers and the confirmed total.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { closingsApi } from '../../lib/api/closings';
import { Unreadable, Unrecorded } from '../../ui';
import { dealMoney } from '../../components/deals/dealMoney';
import { BTN } from '../account/AccountCenter';
import { NOT_YET, STEPS, WAITS, lineRows } from './closingModel';
import { closingForDeal } from './deskModel';
import RecordRoom, { NoAccess } from './RecordRoom';
import { NO_ACCESS, canEnter } from './roomModel';

const box = 'flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

function useRead(run, deps) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', data: null });
    run().then((data) => { if (live) setState({ status: 'ok', data }); }, () => { if (live) setState({ status: 'error', data: null }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick((n) => n + 1) };
}

export function Wait({ id }) {
  return (
    <section className={box} data-testid={`closing-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-sm text-gray-600 dark:text-gray-400">{WAITS[id]}</p>
    </section>
  );
}

/** Commitments and the deal's totals are dollars; a recorded transfer is cents. */
const Money = ({ value, currency, reason, cents = false }) => {
  const s = dealMoney(value, currency, cents);
  return s ? <span className="tabular-nums">{s}</span> : <Unrecorded reason={reason} />;
};

function Lines({ dealId, role, currency }) {
  const read = useRead(() => api.dealCommitments(dealId), [dealId]);
  if (read.status === 'loading') return <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" data-testid="closing-lines-loading" />;
  if (read.status === 'error') return <section className={box} data-testid="closing-lines"><Unreadable what="The lines" claim="This is not a claim that the round has none." onRetry={read.retry} /></section>;
  // An Operating Partner's read is the confirmed total only, never the lines.
  if (!Array.isArray(read.data)) return null;
  const { rows, committed, received, unrecordedAmounts } = lineRows(read.data);
  return (
    <section className={box} data-testid="closing-lines">
      <h2 className="m-0 text-[15px] font-bold">{role === 'investor' ? 'Your line' : 'Lines'}</h2>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-gray-600 dark:text-gray-400" data-testid="closing-lines-empty">
          {role === 'investor' ? 'You have no commitment on this deal.' : 'No commitment on this deal yet. Lines appear here when an investor commits in the deal room.'}
        </p>
      ) : (
        <table className="w-full text-left text-[13px]">
          <thead><tr className="text-[11px] uppercase text-gray-500"><th className="py-1">Investor</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.uid} data-testid={`closing-line-${r.uid}`} className="border-t border-gray-100 dark:border-gray-800">
                <td className="py-1.5">{r.investor}</td>
                <td><Money value={r.amount} currency={currency} reason="No amount was recorded on this commitment." /></td>
                <td>{r.word}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {role !== 'investor' && rows.length > 0 && (
        <p className="m-0 text-[12px] text-gray-600 dark:text-gray-400" data-testid="closing-lines-sums">
          Committed <Money value={committed} currency={currency} /> · Received <Money value={received} currency={currency} />
          {unrecordedAmounts ? ` · ${unrecordedAmounts} line${unrecordedAmounts === 1 ? '' : 's'} with no amount recorded, not counted` : ''}
        </p>
      )}
    </section>
  );
}

function Checklist({ dealId }) {
  const read = useRead(() => api.dealClosingChecklist(dealId), [dealId]);
  if (read.status === 'loading') return <div className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />;
  if (read.status === 'error') return <section className={box} data-testid="closing-checklist"><Unreadable what="The closing checklist" claim="This is not a claim that it is empty." onRetry={read.retry} /></section>;
  const list = read.data?.checklist;
  const items = Array.isArray(list?.items) ? list.items : [];
  return (
    <section className={box} data-testid="closing-checklist">
      <h2 className="m-0 text-[15px] font-bold">Closing checklist</h2>
      {!list ? <p className="m-0 text-sm text-gray-600 dark:text-gray-400">No checklist has been applied to this deal.</p>
        : items.length === 0 ? <p className="m-0 text-sm text-gray-600 dark:text-gray-400">The checklist has no items yet.</p>
          : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
              {items.map((i) => <li key={i.uid}>{i.state === 'done' ? '✓' : '○'} {i.label}{i.state === 'done' && i.done_by_name ? ` · ${i.done_by_name}` : ''}</li>)}
            </ul>
          )}
    </section>
  );
}

function Transfers({ dealId, currency }) {
  const read = useRead(() => api.dealTransfers(dealId), [dealId]);
  if (read.status === 'loading') return <div className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />;
  if (read.status === 'error') return <section className={box} data-testid="closing-transfers"><Unreadable what="The recorded transfers" claim="This is not a claim that none was recorded." onRetry={read.retry} /></section>;
  const items = Array.isArray(read.data?.items) ? read.data.items : [];
  return (
    <section className={box} data-testid="closing-transfers">
      <h2 className="m-0 text-[15px] font-bold">Recorded transfers to the company</h2>
      <p className="m-0 text-[12px] text-gray-500">Recorded, not moved here. The platform never moves money.</p>
      {items.length === 0 ? <p className="m-0 text-sm text-gray-600 dark:text-gray-400">No transfer has been recorded on this deal.</p> : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
          {items.map((t) => (
            <li key={t.uid}><Money value={t.amount_cents} currency={currency} cents /> · {t.reference || 'No reference recorded'} · {t.phone_verified ? 'Phone-verified' : 'Not phone-verified'}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The deal's room, as D1213 drew it from today's reads. */
function DealRoom({ dealId, role, deal: given = null }) {
  const read = useRead(() => (given ? Promise.resolve(given) : api.getDeal(dealId)), [dealId, given]);
  if (read.status === 'loading') return <div className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" data-testid="closing-loading" />;
  if (read.status === 'error') return <section className={box} data-testid="closing-room"><Unreadable what="This deal" claim="Its closing could not be drawn." onRetry={read.retry} /></section>;
  const deal = read.data || {};
  const currency = deal.currency || 'USD';
  const staff = role === 'admin' || role === 'partner';
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="closing-room">
      <section className={box} data-testid="closing-head">
        <h2 className="m-0 text-[17px] font-bold">Closing · {deal.project_name || 'Venture not recorded'}{deal.instrument ? ` · ${deal.instrument}` : ''}</h2>
        <p className="m-0 text-[13px] text-gray-600 dark:text-gray-400">
          Deadline {deal.closing_deadline ? String(deal.closing_deadline).slice(0, 10) : <Unrecorded reason="No closing deadline is recorded on this deal." />}
          {' · '}Confirmed in the round <Money value={deal.capital_committed} currency={currency} reason="The confirmed total was not returned." />
        </p>
        <ol className="m-0 flex list-none flex-wrap gap-2 p-0 text-[12px]" aria-label="Closing steps" data-testid="closing-steps">
          {STEPS.map((s, i) => <li key={s} className="rounded-full border border-gray-200 px-2 py-0.5 dark:border-gray-700">{i + 1}. {s}</li>)}
        </ol>
        <p className="m-0 text-[12px] text-gray-500">The platform prepares the paper, records signatures and matches bank lines people accept. It never moves money.</p>
      </section>
      {role === 'investor' && <Wait id="roundTotal" />}
      <Lines dealId={dealId} role={role} currency={currency} />
      {role !== 'investor' && <Checklist dealId={dealId} />}
      {staff && <Transfers dealId={dealId} currency={currency} />}
      <div className="grid gap-3 md:grid-cols-2" data-testid="closing-waits">
        {['paper', 'route', 'instructions', 'evidence', 'captable', 'reporting'].map((id) => <Wait key={id} id={id} />)}
        {staff && <Wait id="activity" />}
      </div>
    </div>
  );
}

/**
 * The room. `deal` is the deal read the host already made, or null to read it
 * here. The deal's closing in the store decides which room is drawn; a failed
 * list read costs only that note, never the room (CP18).
 */
export default function ClosingRoom({ dealId, role, deal = null }) {
  const allowed = canEnter(role);
  const record = role !== 'partner' && allowed;
  const list = useRead(() => (record ? closingsApi.list() : Promise.resolve(null)), [dealId, record]);
  if (!allowed) return <NoAccess text={NO_ACCESS.role} back={<Link className={`${BTN.primary} w-fit`} to="/">Go to your home</Link>} />;
  if (role === 'partner') {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <p className="m-0 w-fit rounded-full border border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-600 dark:border-gray-600 dark:text-gray-400" data-testid="closing-partner-note">Read only · {NO_ACCESS.partner}</p>
        <DealRoom dealId={dealId} role={role} deal={deal} />
      </div>
    );
  }
  if (list.status === 'loading') return <div className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" data-testid="closing-loading" />;
  const entry = list.status === 'ok' ? closingForDeal(list.data?.closings, dealId) : null;
  if (entry) return <RecordRoom entry={entry} viewer={role} deal={deal} />;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {list.status === 'error'
        ? <section className={box} data-testid="closing-record-unread"><Unreadable what="This deal’s closing record" claim="The room below is read from the deal until it can be read." onRetry={list.retry} /></section>
        : <p className="m-0 text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="closing-record-none">The studio team has not opened this deal’s closing yet, so the room is read from the deal.</p>}
      <DealRoom dealId={dealId} role={role} deal={deal} />
    </div>
  );
}

/**
 * The founder's room (CP1) under Raise › Capital relationships › Closing: the
 * venture's deals, the one `?deal=` names (else the nearest deadline, else the
 * newest), and that deal's room.
 */
export function FounderClosing({ projectId, search = '' }) {
  const read = useRead(() => api.listDeals(), [projectId]);
  if (read.status === 'loading') return <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" data-testid="closing-loading" />;
  if (read.status === 'error') return <section className={box} data-testid="closing-founder"><Unreadable what="Your deals" claim="This is not a claim that you have none." onRetry={read.retry} /></section>;
  const deals = (Array.isArray(read.data) ? read.data : []).filter((d) => String(d.project_id) === String(projectId));
  if (!deals.length) {
    return (
      <section className={box} data-testid="closing-founder-empty">
        <h2 className="m-0 text-[15px] font-bold">No closing yet</h2>
        <p className="m-0 text-sm text-gray-600 dark:text-gray-400">This venture has no deal yet. A closing opens when a deal’s terms are agreed.</p>
      </section>
    );
  }
  const asked = new URLSearchParams(String(search)).get('deal');
  const byDeadline = deals.filter((d) => d.closing_deadline).sort((a, b) => String(a.closing_deadline).localeCompare(String(b.closing_deadline)));
  const deal = deals.find((d) => String(d.id) === asked) || byDeadline[0] || deals[0];
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="closing-founder">
      {deals.length > 1 && (
        <nav aria-label="Deals" className="flex flex-wrap gap-2 text-[13px]">
          {deals.map((d) => (
            <Link key={d.id} to={{ search: `?deal=${d.id}` }} aria-current={d.id === deal.id ? 'page' : undefined}
              className={d.id === deal.id ? 'font-bold underline' : 'underline'} data-testid={`closing-founder-deal-${d.id}`}>
              {d.project_name || 'Deal'} · {d.instrument || 'Instrument not recorded'}
            </Link>
          ))}
        </nav>
      )}
      <ClosingRoom dealId={deal.id} role="founder" deal={deal} />
    </div>
  );
}
