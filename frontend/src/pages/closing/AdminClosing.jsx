/**
 * D1219 (#3216) — CP14, one closing as the Super Admin and as an Admin see
 * it, from `GET /api/closings/:uid` (D1215): its figures, every line with its
 * route, paper and status, Axal's acts, and the activity (CP15). Each line's
 * paper is read on its own (D1216's staged envelopes), so one failed read
 * blanks only its own cell.
 *
 * An Admin never sees a Super Admin act enabled: `actControl` gives the act's
 * sentence instead. A Super Admin's live act says it asks for their
 * authenticator code; the request helper opens the step-up on the Worker's 403.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { closingsApi, stagedSigningApi } from '../../lib/api/closings';
import { useAuth } from '../../hooks/useAuthSync';
import { useFundActs } from '../../lib/fundActs';
import { Unreadable, Unrecorded } from '../../ui';
import { BTN } from '../account/AccountCenter';
import ActivityDrawer, { ActivityRow } from './ActivityDrawer';
import { CompleteDialog, CountersignDialog, RouteDialog, WithdrawLineDialog } from './ClosingDialogs';
import PaperDrawer from './PaperDrawer';
import { FundCard, SyndicatePanel, ThirdPartyDrawer } from './RoutePanels';
import {
  FUND_CALLS_PATH, NO_ROUTE_YET, actControl, activityRows, awaitingRelease, closeState, closingFigures, lineStatus, moneyCents, paperWord, routeWord,
} from './deskModel';

const box = 'flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const Money = ({ cents, currency, reason }) => {
  const s = moneyCents(cents, currency);
  return s ? <span className="tabular-nums">{s}</span> : <Unrecorded reason={reason} />;
};

function useLoad(run, deps) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ status: s.data ? 'ok' : 'loading', data: s.data }));
    run().then((data) => { if (live) setState({ status: 'ok', data }); }, () => { if (live) setState({ status: 'error', data: null }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick((n) => n + 1) };
}

/** Each line's staged envelopes, read on its own: `{ [lineUid]: {status, envelopes} }`. */
function usePaper(lines, tick) {
  const [paper, setPaper] = useState({});
  const key = lines.map((l) => `${l.uid}:${l.commitment_id ?? ''}`).join(',');
  useEffect(() => {
    let live = true;
    const next = {};
    for (const l of lines) next[l.uid] = l.commitment_id ? { status: 'loading', envelopes: [] } : { status: 'none', envelopes: [] };
    setPaper(next);
    for (const l of lines) {
      if (!l.commitment_id) continue;
      stagedSigningApi.line(l.commitment_id).then(
        (d) => { if (live) setPaper((p) => ({ ...p, [l.uid]: { status: 'ok', envelopes: Array.isArray(d?.envelopes) ? d.envelopes : [] } })); },
        () => { if (live) setPaper((p) => ({ ...p, [l.uid]: { status: 'error', envelopes: [] } })); },
      );
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return paper;
}

function Tile({ label, children, testId }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid={testId}>
      <span className="text-[11px] text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-xl font-bold">{children}</span>
    </div>
  );
}

/** CP14's Axal acts: the countersign is live for a Super Admin; the fund's acts have no route yet. */
function ActsPanel({ user, access, waiting, onCountersign }) {
  const sign = actControl(user, access, 'closing.countersign');
  const row = (title, line, control, testId) => (
    <li className="flex flex-col gap-1 border-t border-gray-100 py-2 first:border-t-0 dark:border-gray-800" data-testid={testId}>
      <span className="font-semibold">{title}</span>
      <span className="text-gray-600 dark:text-gray-400">{line}</span>
      {control}
    </li>
  );
  const muted = (text, testId) => <span className="text-[12px] text-gray-600 dark:text-gray-400" data-testid={testId}>{text}</span>;
  const sa = (act, testId) => {
    const c = actControl(user, access, act);
    return muted(c.enabled ? NO_ROUTE_YET : c.sentence, testId);
  };
  return (
    <section className={box} data-testid="closing-acts">
      <h2 className="m-0 text-[15px] font-bold">Axal acts</h2>
      <p className="m-0 text-[12.5px] text-gray-600 dark:text-gray-400">{sign.enabled ? 'Every act asks for your authenticator code.' : 'These acts commit Axal money or speak for Axal. A Super Admin takes them.'}</p>
      <ul className="m-0 flex list-none flex-col p-0 text-[12.5px]">
        {row('Countersign for Axal', waiting.length ? `${waiting.length} paper${waiting.length === 1 ? '' : 's'} wait${waiting.length === 1 ? 's' : ''} for Axal’s countersign.` : 'No paper waits for Axal’s countersign.',
          sign.enabled
            ? waiting.map((e) => (
              <span key={e.uid} className="flex flex-wrap items-center gap-2">
                <button type="button" className={BTN.primary} onClick={() => onCountersign(e)} data-testid={`closing-act-countersign-${e.uid}`}>Countersign {e.title || 'for Axal'}</button>
                {muted(sign.sentence, `closing-act-countersign-stepup-${e.uid}`)}
              </span>
            ))
            : muted(sign.sentence, 'closing-act-countersign-sentence'), 'closing-act-countersign')}
        {row('Commit fund money', 'An Axal VC fund’s money for a line on the fund route.', sa('fund_investment.commit', 'closing-act-commit-sentence'), 'closing-act-commit')}
        {row('Issue capital call', 'Fund admin issues the call when a fund needs cash.', (
          <span className="flex flex-wrap items-center gap-2"><Link to={FUND_CALLS_PATH} className={BTN.link} data-testid="closing-act-call-link">Open in Fund admin</Link>
            {!actControl(user, access, 'capital_call.issue').enabled && muted(actControl(user, access, 'capital_call.issue').sentence, 'closing-act-call-sentence')}</span>
        ), 'closing-act-call')}
        {row('Record the release', 'After the wire leaves the fund’s bank. StudioOS does not send it.', sa('fund_investment.release', 'closing-act-release-sentence'), 'closing-act-release')}
      </ul>
    </section>
  );
}

export default function AdminClosing({ summary, onChanged }) {
  const { user } = useAuth() || {};
  const access = useFundActs();
  const [rev, setRev] = useState(0);
  const read = useLoad(() => closingsApi.read(summary.uid), [summary.uid, rev]);
  const deals = useLoad(() => api.listDeals(), []);
  const closing = read.data;
  const lines = Array.isArray(closing?.lines) ? closing.lines : [];
  const paper = usePaper(lines, rev);
  const [open, setOpen] = useState(null); // { kind, line?, envelope? }
  const [panel, setPanel] = useState(null);
  const done = () => { setOpen(null); setRev((n) => n + 1); onChanged?.(); };

  if (read.status === 'loading' && !closing) return <div className="h-40 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" data-testid="closing-detail-loading" />;
  if (read.status === 'error') return <section className={box}><Unreadable what="This closing" claim="This is not a claim that it has no lines." onRetry={read.retry} /></section>;

  const f = closingFigures(closing);
  const currency = closing.currency || 'USD';
  const editable = closing.status === 'open';
  const founderUserId = Array.isArray(deals.data) ? deals.data.find((d) => Number(d.id) === Number(closing.deal_id))?.founder_user_id ?? null : null;
  const waiting = lines.flatMap((l) => awaitingRelease(paper[l.uid]?.envelopes));
  const activity = activityRows(closing.events);
  const close = closeState(closing);
  const company = summary.project_name || null;
  const shownLine = panel ? lines.find((l) => l.uid === panel) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="closing-detail">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11.5px] font-bold text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200">{closing.instrument || 'Instrument not recorded'}</span>
        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11.5px] font-bold text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" data-testid="closing-detail-status">{closing.status === 'open' ? 'Open' : closing.status === 'closed' ? 'Closed' : 'Cancelled'}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <button type="button" className={BTN.ghost} onClick={() => setOpen({ kind: 'activity' })} data-testid="closing-open-activity">Open activity</button>
          {editable && (close.ok
            ? <button type="button" className={BTN.primary} onClick={() => setOpen({ kind: 'complete' })} data-testid="closing-complete">Mark Closed</button>
            : <span className="self-center text-[12px] text-gray-600 dark:text-gray-400" data-testid="closing-complete-why">{close.why}</span>)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Lines" testId="closing-tile-lines">{f.lines}</Tile>
        <Tile label="Committed" testId="closing-tile-committed"><Money cents={f.committed} currency={currency} reason="The round’s total was not returned." /></Tile>
        <Tile label="Received" testId="closing-tile-received"><Money cents={f.received} currency={currency} /></Tile>
        <Tile label="Deadline" testId="closing-tile-deadline">{closing.deadline ? String(closing.deadline).slice(0, 10) : <Unrecorded reason="No deadline is recorded on this closing." />}</Tile>
      </div>

      <section className={box} data-testid="closing-detail-lines">
        <h2 className="m-0 text-[15px] font-bold">Lines</h2>
        {lines.length === 0 ? <p className="m-0 text-sm text-gray-600 dark:text-gray-400" data-testid="closing-detail-no-lines">No line yet. A line is a live commitment on the deal with an amount, or a Raise prospect of the venture.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[12.5px]">
              <thead><tr className="text-[11px] uppercase text-gray-500 dark:text-gray-400"><th className="py-1">Investor</th><th>Amount</th><th>Route</th><th>Paper</th><th>Status</th><th><span className="sr-only">Acts</span></th></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const p = paper[l.uid] || { status: 'none', envelopes: [] };
                  const live = editable && l.status !== 'withdrawn';
                  return (
                    <tr key={l.uid} className="border-t border-gray-100 align-top dark:border-gray-800" data-testid={`closing-line-row-${l.uid}`}>
                      <td className="py-1.5 font-semibold">{l.investor_name || 'Name not recorded'}</td>
                      <td><Money cents={l.amount_cents} currency={l.currency || currency} reason="No amount is recorded on this line." /></td>
                      <td data-testid={`closing-line-route-${l.uid}`}>{routeWord(l.route) || <Unrecorded reason="No capital route is chosen for this line.">No route chosen</Unrecorded>}{l.vehicle_ref && l.route !== 'direct' ? <span className="block text-[11px] text-gray-500 dark:text-gray-400">{l.vehicle_ref}</span> : null}</td>
                      <td data-testid={`closing-line-paper-${l.uid}`}>{p.status === 'none' ? <Unrecorded reason="A Raise prospect has no commitment, so its paper is not read here.">Not read here</Unrecorded> : p.status === 'loading' ? 'Reading…' : p.status === 'error' ? <span className="text-red-700 dark:text-red-300">Unreadable</span> : paperWord(p.envelopes)}</td>
                      <td data-testid={`closing-line-status-${l.uid}`}>{lineStatus(l.status)}</td>
                      <td className="flex flex-wrap justify-end gap-1.5 py-1">
                        {live && <button type="button" className={BTN.ghost} onClick={() => setOpen({ kind: 'route', line: l })} data-testid={`closing-line-route-btn-${l.uid}`}>Choose the route</button>}
                        {live && l.commitment_id && <button type="button" className={BTN.ghost} onClick={() => setOpen({ kind: 'paper', line: l })} data-testid={`closing-line-paper-btn-${l.uid}`}>Prepare paper</button>}
                        {live && <button type="button" className={BTN.ghost} onClick={() => setOpen({ kind: 'third', line: l })} data-testid={`closing-line-third-btn-${l.uid}`}>Third-party fund</button>}
                        {['syndicate', 'axal_fund'].includes(l.route) && <button type="button" className={BTN.ghost} aria-expanded={panel === l.uid} onClick={() => setPanel(panel === l.uid ? null : l.uid)} data-testid={`closing-line-panel-btn-${l.uid}`}>{panel === l.uid ? 'Hide the route' : 'Open the route'}</button>}
                        {live && <button type="button" className={BTN.danger} onClick={() => setOpen({ kind: 'withdraw', line: l })} data-testid={`closing-line-withdraw-btn-${l.uid}`}>Withdraw</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {f.noRoute > 0 && <p className="m-0 text-[12px] text-amber-700 dark:text-amber-300" data-testid="closing-detail-no-route">{`${f.noRoute} line${f.noRoute === 1 ? ' has' : 's have'} no capital route yet.`}</p>}
      </section>

      {shownLine?.route === 'syndicate' && <SyndicatePanel line={shownLine} currency={currency} />}
      {shownLine?.route === 'axal_fund' && <FundCard line={shownLine} currency={currency} user={user} access={access} />}

      <ActsPanel user={user} access={access} waiting={waiting} onCountersign={(e) => setOpen({ kind: 'countersign', envelope: e })} />

      <section className={box} data-testid="closing-detail-activity">
        <div className="flex items-center justify-between gap-2"><h2 className="m-0 text-[15px] font-bold">Activity</h2>
          <button type="button" className={BTN.link} onClick={() => setOpen({ kind: 'activity' })}>Open activity</button></div>
        {activity.length === 0 ? <p className="m-0 text-sm text-gray-600 dark:text-gray-400">Nothing recorded on this closing yet.</p>
          : <ul className="m-0 flex list-none flex-col p-0">{activity.slice(0, 5).map((r) => <ActivityRow key={r.key} r={r} />)}</ul>}
      </section>

      {open?.kind === 'route' && <RouteDialog closing={closing} line={open.line} envelopes={paper[open.line.uid]?.envelopes} onClose={() => setOpen(null)} onSaved={done} />}
      {open?.kind === 'paper' && <PaperDrawer closing={closing} company={company} line={open.line} founderUserId={founderUserId} onClose={() => setOpen(null)} onSent={done} />}
      {open?.kind === 'third' && <ThirdPartyDrawer closing={closing} line={open.line} envelopes={paper[open.line.uid]?.envelopes} onClose={() => setOpen(null)} onSaved={done} />}
      {open?.kind === 'withdraw' && <WithdrawLineDialog closing={closing} line={open.line} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'complete' && <CompleteDialog closing={closing} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'countersign' && <CountersignDialog envelope={open.envelope} onClose={() => setOpen(null)} onDone={() => setRev((n) => n + 1)} />}
      {open?.kind === 'activity' && <ActivityDrawer title={`Closing · ${company || 'Venture not recorded'}${summary.round_label ? ` ${summary.round_label}` : ''}`} rows={activity} onClose={() => setOpen(null)} />}
    </div>
  );
}
