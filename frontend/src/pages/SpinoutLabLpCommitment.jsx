// I5 · "My commitment" — the LP's own position, per fund, on the LP workspace
// (D372). It is also where `/lp-portal` now lands: every job the old portal
// did is here — the commitment table, called / due / uncalled, the capital
// calls, distributions, TVPI and DPI, and viewing and signing the LPA.
//
// Every figure is summed from the caller's own rows in GET /api/funds/lp-portal
// by `lib/lpCommitmentModel.js`. A read that failed says so with a retry; a
// figure with nothing behind it says "not recorded". Neither is ever a zero.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { Unreadable, Unrecorded } from '../ui';
import { api } from '../lib/api';
import { commitmentsByFund, commitmentBar } from '../lib/lpCommitmentModel';
import { formatCents } from './investor/fundCallsModel';
import { LPADrawer } from './FundsPage';

const CARD = 'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900';
const LBL = 'text-[11px] font-bold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500';
const MONO = 'font-mono tabular-nums';

const money = (cents) => formatCents(cents);
const STATE = {
  paid: ['Paid', 'text-emerald-700 dark:text-emerald-400'],
  part_received: ['Part received', 'text-amber-700 dark:text-amber-400'],
  overdue: ['Overdue', 'text-red-700 dark:text-red-400'],
  pending: ['Due', 'text-amber-700 dark:text-amber-400'],
};
const multiple = (x) => (typeof x === 'number' ? `${x.toFixed(2)}×` : null);

/** The whole section: an anchor `/lp-portal` redirects to, and one card per fund. */
export function MyCommitment({ portal, failed, onReload }) {
  const rows = useMemo(() => commitmentsByFund(portal), [portal]);
  const [lpaFor, setLpaFor] = useState(null);
  const [signing, setSigning] = useState(null);
  const [signErr, setSignErr] = useState('');

  async function sign(row) {
    setSigning(row.lp_id); setSignErr('');
    try { await api.fundsSignLpa(row.lp_id); await onReload(); }
    catch (e) { setSignErr(e?.message || 'The LPA could not be signed.'); }
    finally { setSigning(null); }
  }

  return (
    <section id="my-commitment" data-testid="section-my-commitment" className="scroll-mt-20">
      <div className="mb-2.5 flex items-end justify-between gap-3">
        <div className={LBL}>My commitment</div>
        <span className="text-[11.5px] text-gray-400 dark:text-gray-500">Your own rows on each fund's register</span>
      </div>
      {failed ? (
        <div className={`${CARD} p-5`} data-testid="status-commitment-unreadable">
          <Unreadable what="Your LP position" claim="This is not a claim that you hold no commitment." onRetry={onReload} />
        </div>
      ) : rows.length === 0 ? (
        <div className={`${CARD} p-5 text-[12.5px] text-gray-500 dark:text-gray-400`} data-testid="status-no-commitment">
          No commitment is recorded for your account. A commitment appears here once the fund's general partner
          records it on the register.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.length > 1 && <Totals rows={rows} />}
          {rows.map((row) => (
            <FundCommitment
              key={`${row.fund_id}-${row.lp_id}`}
              row={row}
              onViewLpa={() => setLpaFor(row.fund_id)}
              onSign={() => sign(row)}
              signing={signing === row.lp_id}
              onRetry={onReload}
            />
          ))}
          {signErr && <p className="text-[11.5px] text-red-600 dark:text-red-400" role="alert">{signErr}</p>}
          {/* The rest of the I5 artboard, said rather than drawn empty. */}
          <div className={`${CARD} p-4 text-[11.5px] text-gray-500 dark:text-gray-400`} data-testid="commitment-not-built">
            <div><span className="font-semibold text-gray-700 dark:text-gray-300">Co-invest offers</span> · Not recorded: no store holds a co-invest offer, so none can be listed, taken or passed here.</div>
            <div className="mt-1"><span className="font-semibold text-gray-700 dark:text-gray-300">Ask the report</span> · Not built: Eadwyn has no investor reading surface for issued reports yet.</div>
          </div>
        </div>
      )}
      {lpaFor && <LPADrawer fundId={lpaFor} onClose={() => setLpaFor(null)} />}
    </section>
  );
}

function Totals({ rows }) {
  const add = (key) => (rows.every((r) => r[key] != null) ? rows.reduce((s, r) => s + r[key], 0) : null);
  const items = [
    ['Committed', add('commitment_cents')],
    ['Called', add('called_cents')],
    ['Due now', add('due_cents')],
    ['Distributed', add('distributed_cents')],
  ];
  return (
    <div className={`${CARD} grid grid-cols-2 gap-3 p-4 sm:grid-cols-4`} data-testid="commitment-totals">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{k} · {rows.length} funds</div>
          <div className={`${MONO} mt-1 text-base font-bold text-gray-900 dark:text-gray-100`}>
            {v == null ? <Unrecorded reason="One fund's figure could not be read or is not recorded, so no total is given." /> : money(v)}
          </div>
        </div>
      ))}
    </div>
  );
}

function FundCommitment({ row, onViewLpa, onSign, signing, onRetry }) {
  const bar = commitmentBar(row);
  return (
    <div className={`${CARD} p-5`} data-testid={`commitment-fund-${row.fund_id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100">{row.fund_name || `Fund #${row.fund_id}`}</div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          {row.lpa_signed
            ? `LPA signed${row.lpa_signed_at ? ` ${row.lpa_signed_at}` : ''}`
            : 'LPA not signed'}
          {row.committed_on ? ` · committed ${row.committed_on}` : ''}
        </div>
      </div>
      <div className={`${MONO} mt-2 text-2xl font-extrabold text-gray-900 dark:text-gray-100`}>
        {row.commitment_cents == null ? <Unrecorded reason="The register records no commitment amount for you on this fund." /> : money(row.commitment_cents)}
        <span className="ml-1.5 text-xs font-semibold text-gray-400 dark:text-gray-500">committed</span>
      </div>

      {!row.calls_known ? (
        <div className="mt-3" data-testid="status-calls-unreadable">
          <Unreadable what="Your capital calls" claim="This is not a claim that nothing has been called." onRetry={onRetry} />
        </div>
      ) : (
        <>
          {bar && (
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true">
              <div className="h-full bg-violet-600" style={{ width: `${bar.settled}%` }} />
              <div className="h-full bg-amber-400" style={{ width: `${bar.due}%` }} />
            </div>
          )}
          <div className={`${MONO} mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-gray-600 dark:text-gray-400`} data-testid="commitment-split">
            <span>{money(row.called_cents)} called</span>
            <span><span className="text-violet-600">■</span> {money(row.settled_cents)} paid</span>
            <span><span className="text-amber-500">■</span> {money(row.due_cents)} due{row.next_due ? ` · next ${row.next_due}` : ''}</span>
            <span>{row.uncalled_cents == null ? 'Uncalled not recorded' : `${money(row.uncalled_cents)} uncalled`}</span>
          </div>
          {row.over_called && (
            <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              More has been called than the register records as your commitment. Ask the GP which figure is right.
            </p>
          )}
          <div className="mt-3 overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800">
            {row.calls.length === 0 ? (
              <div className="px-3 py-3 text-[11.5px] text-gray-500 dark:text-gray-400">Nothing has been called on this commitment.</div>
            ) : row.calls.map((c) => {
              const [label, tone] = STATE[c.state] || STATE.pending;
              return (
                <div key={c.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-gray-100 dark:border-gray-800 px-3 py-2 last:border-b-0 text-[11.5px]" data-testid={`commitment-call-${c.id}`}>
                  <span className="text-gray-700 dark:text-gray-300">
                    {c.call_number != null ? `Call ${c.call_number}` : 'Capital call'}
                    <span className="text-gray-400 dark:text-gray-500"> · {c.state === 'paid'
                      ? `paid ${c.paid_date || 'date not recorded'}`
                      : c.due_date ? `due ${c.due_date}` : `issued ${c.issued_on || 'date not recorded'}, no due date recorded`}</span>
                  </span>
                  <span className={`${MONO} text-gray-900 dark:text-gray-100`}>{money(c.owed_cents) ?? 'Not recorded'}</span>
                  <span className={`font-semibold ${tone}`}>{label}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-[10.5px] text-gray-400 dark:text-gray-500">
            Calls not yet issued are not listed: the fund keeps no schedule of future calls. A call is paid when
            the general partner records your wire.
          </p>
        </>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 dark:border-gray-800 pt-4 text-xs sm:grid-cols-4">
        <Fact k="Paid in" v={money(row.invested_cents)} />
        <Fact k="Distributed" v={money(row.distributed_cents)} note={`${row.distributions.length} distribution${row.distributions.length === 1 ? '' : 's'}`} />
        <Fact k="TVPI" v={multiple(row.tvpi)} reason="Nothing has been paid in yet, so there is no multiple." />
        <Fact k="DPI" v={multiple(row.dpi)} reason="Nothing has been paid in yet, so there is no multiple." />
      </dl>
      {row.distributions.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] text-gray-600 dark:text-gray-400" data-testid={`commitment-distributions-${row.fund_id}`}>
          {row.distributions.map((d) => (
            <li key={d.id} className="flex justify-between gap-2">
              <span>{d.on || 'Date not recorded'} · {d.status || 'status not recorded'}</span>
              <span className={MONO}>{money(d.amount_cents) ?? 'Not recorded'}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onViewLpa} data-testid={`button-view-lpa-${row.fund_id}`}
          className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
          View LPA
        </button>
        {!row.lpa_signed && (
          <button type="button" onClick={onSign} disabled={signing} data-testid={`button-sign-lpa-${row.lp_id}`}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {signing ? 'Signing…' : 'Sign LPA'}
          </button>
        )}
      </div>
    </div>
  );
}

function Fact({ k, v, note, reason }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{k}</dt>
      <dd className={`${MONO} mt-0.5 font-bold text-gray-900 dark:text-gray-100`}>
        {v ?? <Unrecorded reason={reason || 'Not recorded on the register.'} />}
      </dd>
      {note && <div className="text-[10px] text-gray-400 dark:text-gray-500">{note}</div>}
    </div>
  );
}

/**
 * "Message the GP" (D372). It linked to /help. The fund's general partner of
 * record has a platform account (`funds[id].gp.contact_email` on the LP's own
 * portal), and `POST /api/messages` starts a thread with an account, so the
 * message goes to them and lands in both inboxes. A fund with no GP account
 * says so instead of offering a button that cannot deliver.
 */
export function MessageGp({ portal }) {
  const rows = useMemo(() => commitmentsByFund(portal), [portal]);
  const reachable = rows.filter((r) => r.gp?.contact_email);
  const [fundId, setFundId] = useState(null);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [state, setState] = useState({ busy: false, err: '', sent: false });
  const target = reachable.find((r) => r.fund_id === fundId) || reachable[0] || null;

  if (!reachable.length) {
    return (
      <p className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="status-no-gp-contact">
        {rows.length
          ? 'No general partner of record with a platform account is set on your fund, so there is no one to message here. '
          : 'Questions before you invest go to the fund team. '}
        <Link to="/help" className="font-semibold text-violet-700 dark:text-violet-400">Contact the fund team</Link>
      </p>
    );
  }

  async function send(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setState({ busy: true, err: '', sent: false });
    try {
      await api.messageStartThread({
        to_email: target.gp.contact_email,
        subject: `${target.fund_name || 'Fund'} · LP question`,
        body: body.trim(),
      });
      setBody('');
      setState({ busy: false, err: '', sent: true });
    } catch (ex) {
      setState({ busy: false, err: ex?.message || 'The message could not be sent.', sent: false });
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid="button-message-gp"
        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
        <MessageSquare size={13} /> Message the GP
      </button>
    );
  }
  return (
    <form onSubmit={send} className="flex w-full flex-col gap-2" data-testid="form-message-gp">
      {reachable.length > 1 && (
        <select value={target.fund_id} onChange={(e) => setFundId(Number(e.target.value))} data-testid="select-message-gp-fund"
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs text-gray-900 dark:text-gray-100">
          {reachable.map((r) => <option key={r.fund_id} value={r.fund_id}>{r.fund_name || `Fund #${r.fund_id}`}</option>)}
        </select>
      )}
      <div className="text-[11px] text-gray-500 dark:text-gray-400">
        To {target.gp.name || 'the general partner of record'} · {target.fund_name || `Fund #${target.fund_id}`}
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} required data-testid="input-message-gp"
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs text-gray-900 dark:text-gray-100" />
      <div className="flex gap-2">
        <button type="submit" disabled={state.busy || !body.trim()} data-testid="button-send-message-gp"
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {state.busy ? 'Sending…' : 'Send'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300">Close</button>
      </div>
      {state.err && <p className="text-[11px] text-red-600 dark:text-red-400" role="alert">{state.err}</p>}
      {state.sent && <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Sent. The conversation is in <Link to="/messages" className="font-semibold underline">Messages</Link>.</p>}
    </form>
  );
}
