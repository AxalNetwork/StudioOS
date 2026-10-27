/**
 * D1219 (#3216) — the three routes that go through a vehicle, for one line:
 *
 * - CP6 `SyndicatePanel`: the SPV, its members and what each committed, read
 *   from the syndicate the line's vehicle names (`syndicate:<id>`; D1214 lets
 *   only its lead, a member or an admin read it). It is exported so the room
 *   (part 5, #3215) can draw it for the SPV's lead.
 * - CP7 `FundCard`: the Axal VC fund route, the same card for a Super Admin
 *   and an Admin. Its capital call lives in Fund admin (#2388), linked, never
 *   redrawn. The fund's commitment and release have no route yet (D1215 §3).
 * - CP8 `ThirdPartyDrawer`: a record of another fund's investment and its
 *   evidence only; StudioOS does not run that fund's calls or hold its money.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { closingsApi } from '../../lib/api/closings';
import { Unreadable, Unrecorded } from '../../ui';
import { BTN, INPUT } from '../account/AccountCenter';
import { Err, NotYet } from './ClosingDialogs';
import {
  DESK_WAITS, FUND_CALLS_PATH, NO_ROUTE_YET, actControl, lineStatus, moneyCents, paperWord, routeBody, syndicateIdOf,
} from './deskModel';
import Sheet from '../../ui/Sheet.jsx';

const box = 'flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const EYEBROW = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-gray-500 dark:text-gray-400';
const Money = ({ cents, currency, reason }) => {
  const s = moneyCents(cents, currency);
  return s ? <span className="tabular-nums">{s}</span> : <Unrecorded reason={reason} />;
};

/** CP6: the SPV a syndicate line goes through, and its one payment to the company. */
export function SyndicatePanel({ line, currency }) {
  const id = syndicateIdOf(line.vehicle_ref);
  const [state, setState] = useState({ status: id ? 'loading' : 'none', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    setState({ status: 'loading', data: null });
    api.networkFxSyndicate(id).then((d) => { if (live) setState({ status: 'ok', data: d }); }, () => { if (live) setState({ status: 'error', data: null }); });
    return () => { live = false; };
  }, [id, tick]);
  const members = Array.isArray(state.data?.members) ? state.data.members : [];
  return (
    <section className={box} data-testid="closing-spv">
      <span className={EYEBROW}>Syndicate (SPV)</span>
      <h3 className="m-0 text-[15px] font-bold">{state.data?.name || line.vehicle_ref || 'The SPV is not named'}</h3>
      <p className="m-0 text-[12.5px]">The SPV’s one payment to the company: <b data-testid="closing-spv-payment">{lineStatus(line.status)}</b> · <Money cents={line.amount_cents} currency={currency} reason="No amount is recorded on this line." /></p>
      {state.status === 'none' && <p className="m-0 text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="closing-spv-unnamed">This vehicle names no syndicate on StudioOS, so its members are not read here. Choose the SPV on the route.</p>}
      {state.status === 'loading' && <div className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />}
      {state.status === 'error' && <Unreadable what="The SPV’s members" claim="This is not a claim that it has none." onRetry={() => setTick((n) => n + 1)} />}
      {state.status === 'ok' && (members.length === 0
        ? <p className="m-0 text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="closing-spv-empty">No member has joined this SPV yet.</p>
        : (
          <table className="w-full text-left text-[12.5px]" data-testid="closing-spv-members">
            <thead><tr className="text-[11px] uppercase text-gray-500 dark:text-gray-400"><th className="py-1">Member</th><th>Commitment</th><th>Paid to the SPV</th></tr></thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={m.id ?? i} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-1.5">{m.name || 'Name not recorded'}</td>
                  <td><Money cents={m.commitment_cents} currency={currency} reason="No commitment is recorded for this member." /></td>
                  <td><NotYet>{DESK_WAITS.members}</NotYet></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      <p className="m-0 text-[12px] text-gray-600 dark:text-gray-400">{DESK_WAITS.members} Joining needs an approved identity check.</p>
    </section>
  );
}

function Step({ title, line, children, testId }) {
  return (
    <li className="flex flex-col gap-1 border-l-2 border-gray-200 py-2 pl-3 dark:border-gray-700" data-testid={testId}>
      <span className="font-semibold">{title}</span>
      {line && <span className="text-gray-600 dark:text-gray-400">{line}</span>}
      {children}
    </li>
  );
}

/** A Super Admin act with no route yet: the Super Admin reads why; an Admin reads the act's sentence. */
function SaAct({ user, access, act, testId }) {
  const c = actControl(user, access, act);
  return <span className="text-[12px] text-gray-600 dark:text-gray-400" data-testid={testId}>{c.enabled ? NO_ROUTE_YET : c.sentence}</span>;
}

/** CP7: the Axal VC fund route, one card for a Super Admin and an Admin. */
export function FundCard({ line, currency, user, access }) {
  const call = actControl(user, access, 'capital_call.issue');
  return (
    <section className={box} data-testid="closing-fund-card">
      <span className={EYEBROW}>Axal VC fund route</span>
      <h3 className="m-0 text-[15px] font-bold">{line.vehicle_ref || 'The fund is not named'} invests <Money cents={line.amount_cents} currency={currency} reason="No amount is recorded on this line." /></h3>
      <ol className="m-0 flex list-none flex-col p-0 text-[12.5px]">
        <Step title="Fund money committed" line={DESK_WAITS.fundCommit} testId="closing-fund-commit">
          <SaAct user={user} access={access} act="fund_investment.commit" testId="closing-fund-commit-act" />
        </Step>
        <Step title="Cash and the capital call" line="Read in Fund admin, where a shortfall is called from the fund’s LPs." testId="closing-fund-call">
          <Link to={FUND_CALLS_PATH} className={BTN.link} data-testid="closing-fund-call-link">Open in Fund admin</Link>
          {!call.enabled && <span className="text-[12px] text-gray-600 dark:text-gray-400" data-testid="closing-fund-call-act">{call.sentence}</span>}
        </Step>
        <Step title="Investment released" line={`${DESK_WAITS.fundRelease} Record it after the wire leaves the fund’s bank; StudioOS does not send it.`} testId="closing-fund-release">
          <SaAct user={user} access={access} act="fund_investment.release" testId="closing-fund-release-act" />
        </Step>
        <Step title="Position recorded" line={DESK_WAITS.position} testId="closing-fund-position" />
      </ol>
    </section>
  );
}

/** CP8: record a third-party fund on the line. Only its name is stored, as the line's vehicle. */
export function ThirdPartyDrawer({ closing, line, envelopes, onClose, onSaved }) {
  const [name, setName] = useState(line.route === 'third_party_fund' ? line.vehicle_ref || '' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const evidence = Array.isArray(line.evidence) ? line.evidence.filter((e) => !e.withdrawn_at) : [];
  const save = async () => {
    const body = routeBody('third_party_fund', name);
    if (body.error) { setError(body.error); return; }
    setBusy(true); setError('');
    try { await closingsApi.setRoute(closing.uid, line.uid, body.route, body.vehicle_ref); onSaved?.(); }
    catch (e) { setError(typeof e?.message === 'string' && e.message.trim() ? e.message.trim() : 'The record could not be saved. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <Sheet label="Record a third-party fund" eyebrow="Third-party fund" title="Record a third-party fund" sub={`${line.investor_name || 'This line'} · sets the line’s route to Third-party fund`}
      testId="closing-third-party" onClose={onClose} width={560}>
      <div className="flex flex-col gap-3 px-5 py-4 text-[12.5px]">
        <p className="m-0 rounded-lg bg-sky-50 px-3 py-2 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">StudioOS keeps a record of this fund’s investment and its evidence. It does not run the fund’s calls or hold its money.</p>
        <label className="flex flex-col gap-1 font-semibold">Fund, by its legal name
          <input className={INPUT} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} data-testid="closing-third-party-name" />
        </label>
        <p className="m-0 flex items-center justify-between gap-2">Amount <span><Money cents={line.amount_cents} currency={line.currency || closing.currency} reason="No amount is recorded on this line." /> · from the line</span></p>
        <p className="m-0 flex items-center justify-between gap-2">Signed paper <b data-testid="closing-third-party-paper">{paperWord(envelopes)}</b></p>
        <p className="m-0 flex items-center justify-between gap-2">Business check <span className="flex items-center gap-2"><NotYet>{DESK_WAITS.thirdParty}</NotYet><Link to="/admin/kyc" className={BTN.link}>Open in KYC &amp; KYB</Link></span></p>
        <p className="m-0 text-[12px] text-gray-600 dark:text-gray-400" data-testid="closing-third-party-gap">{DESK_WAITS.thirdParty}</p>
        <span className={EYEBROW}>Evidence of transfer</span>
        {evidence.length === 0
          ? <p className="m-0 text-gray-600 dark:text-gray-400" data-testid="closing-third-party-no-evidence">No evidence recorded for this line yet. Each piece shows who added it and when.</p>
          : <ul className="m-0 flex flex-col gap-1 pl-4" data-testid="closing-third-party-evidence">{evidence.map((e) => <li key={e.uid}>{e.side === 'receiving' ? 'Receiving side' : 'Sending side'} · {e.kind} · {String(e.created_at || '').slice(0, 10) || 'date not recorded'}</li>)}</ul>}
        <Err text={error} testId="closing-third-party-error" />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-axal-hairline px-5 py-3 dark:border-gray-800">
        <button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN.primary} disabled={busy} onClick={save} data-testid="closing-third-party-save">Save the record</button>
      </div>
    </Sheet>
  );
}
