/**
 * D1221 (#2458) — the Calls tab of Capital relationships: Calls for Capital
 * switched off (CLS1), the list (CLS2) and empty (CLS3), from `parts.calls`.
 * Each sent call opens at `/raise/capital-relationships/calls/:uid` (CLS8).
 */
import { Link } from 'react-router-dom';
import { Unreadable, Unrecorded } from '../../../ui';
import { callDate, moneyCents } from '../../founder/roundCallParts';
import { NEW_CALL_OFF, NOT_YET, READINESS, WAITS, WHAT_A_CALL_IS, WHY_OFF, callsState } from './callsModel';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

function Wait({ id }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`calls-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </div>
  );
}

const n = (v) => (v == null ? <Unrecorded reason="Not returned by the calls read." /> : v);

export default function CallsTab({ calls, onRetry }) {
  const st = callsState(calls);
  const newCall = st.kind === 'off'
    ? <button type="button" disabled title={NEW_CALL_OFF} aria-describedby="calls-new-off" className="w-fit rounded-lg bg-gray-200 px-3 py-1.5 text-[13px] font-bold text-gray-500 dark:bg-gray-800" data-testid="calls-new">New call</button>
    : <Link to="/raise/call" className="w-fit rounded-lg bg-violet-600 px-3 py-1.5 text-[13px] font-bold text-white" data-testid="calls-new">New call</Link>;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="calls-page">
      <section className={box}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-[17px] font-extrabold">Calls for Capital</h2>
          {newCall}
        </div>
        <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400">{WHAT_A_CALL_IS}</p>
        {st.kind === 'off' && <p id="calls-new-off" className="m-0 text-[13px]" data-testid="calls-off">{WHY_OFF}</p>}
      </section>
      {st.kind === 'unreadable' && <section className={box}><Unreadable what="Your calls for capital" claim="This is not a claim that you have run none." onRetry={onRetry} /></section>}
      {st.kind === 'off' && (
        <section className={box} data-testid="calls-readiness">
          <h3 className="m-0 text-[15px] font-bold">Get ready</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">{READINESS.map((r) => <li key={r}>○ {r}</li>)}</ul>
          <Wait id="readiness" />
        </section>
      )}
      {st.kind === 'empty' && <section className={box} data-testid="calls-empty"><p className="m-0 text-sm">No call for capital yet. Start one with New call.</p></section>}
      {st.kind === 'list' && (
        <section className={box} data-testid="calls-list">
          <table className="w-full text-left text-[13px]">
            <thead><tr className="text-[11px] uppercase text-gray-500"><th className="py-1">Call</th><th>State</th><th>Sent · closes</th><th>Indicated of target</th><th>Invited · opened · data room · responded</th><th>Unanswered</th></tr></thead>
            <tbody>
              {st.rows.map((r) => (
                <tr key={r.uid} className="border-t border-gray-100 dark:border-gray-800" data-testid={`calls-row-${r.uid}`}>
                  <td className="py-1.5"><Link to={r.href} className="font-semibold underline">{r.name}</Link></td>
                  <td>{r.state}</td>
                  <td>{r.sent ? callDate(r.sent) : 'Not sent'} · {r.close ? callDate(r.close) : <Unrecorded reason="No close date is recorded." />}</td>
                  <td>{r.indicatedCents == null ? n(null) : moneyCents(r.indicatedCents)} of {r.targetCents == null ? n(null) : moneyCents(r.targetCents)}</td>
                  <td>{n(r.recipients)} · {n(r.opened)} · {n(r.dataRoom)} · {n(r.responded)}</td>
                  <td>{n(r.unanswered)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="m-0 text-[12px] text-axal-muted">Indicated amounts are intentions, not payments or commitments.</p>
          <Wait id="delivery" />
        </section>
      )}
      <Wait id="cofounders" />
    </div>
  );
}
