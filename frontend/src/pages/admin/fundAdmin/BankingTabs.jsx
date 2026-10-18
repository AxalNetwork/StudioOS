import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, Unrecorded, Unreadable } from '../../../ui';
import { FundActControl } from '../../../lib/fundActs';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import { Group, Row } from '../../account/ConnectorSheet';
import { MercuryEntityConnections } from '../../account/MercurySheet';
import {
  PAYMENT_INSTRUCTIONS_ADMIN, PAYMENT_INSTRUCTIONS_LINK, REJECT_REASON_MIN, actRow, balanceText, ending, money, refusalText,
} from './fundAdminModel';
import { useRead } from './useRead';

/**
 * Banking and Reconciliation (decision 8). Every read here is #1775's, and
 * each one writes its audit row before it answers. Bank text (counterparty
 * names, memos, organization names) is drawn as text, never as HTML.
 */

function ReadFailed({ read, what, claim }) {
  const audit = read.error?.status === 503;
  return <div className="px-3 py-2"><Unreadable what={what} claim={audit ? 'Nothing was read, because its audit row could not be written.' : claim} onRetry={read.reload} /></div>;
}

function Accounts({ apis }) {
  const read = useRead(() => apis.mercury.accounts(), [apis]);
  return (
    <Group label="Accounts">
      {read.status === 'loading' ? <div className="px-3 py-2"><LoadingRows lines={2} /></div>
        : read.status === 'unreadable' ? <ReadFailed read={read} what="The entity accounts" claim="This is not a claim that there is none." />
          : (read.data?.items || []).length === 0 ? <Row a="No account recorded" b="An account appears here after its entity's first sync." />
            : read.data.items.map((a) => (
              <Row key={a.uid} a={`${a.entity_key} · ${a.nickname || a.kind} · ${ending(a.last_four)}`}
                b={`Current ${balanceText(a.current)} · Available ${balanceText(a.available)}${a.balance_read_at ? ` · read ${a.balance_read_at}` : ''}`}
                pill={a.registered ? null : <Pill tone="warn">Not in the registry</Pill>} />
            ))}
    </Group>
  );
}

function Transactions({ apis }) {
  const [page, setPage] = useState(1);
  const read = useRead(() => apis.mercury.transactions({ page }), [apis, page]);
  const total = Number(read.data?.total ?? 0);
  const size = Number(read.data?.page_size ?? 50);
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <Group label="Transactions">
      {read.status === 'loading' ? <div className="px-3 py-2"><LoadingRows lines={3} /></div>
        : read.status === 'unreadable' ? <ReadFailed read={read} what="The transactions" claim="This is not a claim that no money moved." />
          : (read.data?.items || []).length === 0 ? <Row a="No transaction recorded" b="Lines appear after a sync." />
            : <>
              {read.data.items.map((t) => (
                <Row key={t.uid} a={`${t.posted_on || t.created_on} · ${money(t.amount_cents) ?? 'Not recorded'}`}
                  b={`${t.counterparty_name || 'No counterparty recorded'} · ${ending(t.last_four)} · ${t.status || 'status not recorded'}`}
                  pill={<Pill tone={t.match ? 'ok' : 'neutral'}>{t.match ? t.match.state : 'Unmatched'}</Pill>} />
              ))}
              <div className="flex items-center justify-between px-3 py-2 text-[12px] text-axal-muted dark:text-gray-400">
                <span data-testid="transactions-page">Page {page} of {pages} · {total} lines</span>
                <span className="flex gap-2">
                  <button type="button" className={BTN.ghost} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                  <button type="button" className={BTN.ghost} disabled={page >= pages} onClick={() => setPage(page + 1)} data-testid="transactions-next">Next</button>
                </span>
              </div>
            </>}
    </Group>
  );
}

export function BankingTab({ apis, access }) {
  const superAdmin = access?.super_admin === true;
  return (
    <div data-testid="banking">
      <MercuryEntityConnections superAdmin={superAdmin} api={apis.mercury} />
      <Accounts apis={apis} />
      <Transactions apis={apis} />
      <Group label="Payment instructions">
        {actRow(access, 'bank_account.see')?.allowed === true
          ? <Row a="The entities' bank accounts" b="Entered, retired and revealed from the bank accounts console, behind your step-up."
            action={<Link className={BTN.link} to={PAYMENT_INSTRUCTIONS_LINK.href} data-testid="payment-instructions-link">{PAYMENT_INSTRUCTIONS_LINK.text}</Link>} />
          : <Row a="The entities' bank accounts" b={<span data-testid="payment-instructions-admin">{PAYMENT_INSTRUCTIONS_ADMIN}</span>} />}
      </Group>
    </div>
  );
}

const STATES = [['', 'Every state'], ['proposed', 'Proposed'], ['needs_review', 'Needs review'], ['confirmed', 'Confirmed'], ['rejected', 'Rejected']];
const targetName = (m) => (m.target_kind === 'fee_period' ? `Fee period #${m.target_id}` : `Capital-call line #${m.target_id}`);

function MatchRow({ m, apis, access, onChanged }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, fallback) => {
    setBusy(true); setError('');
    try { await fn(); setRejecting(false); setReason(''); onChanged(); } catch (e) { setError(refusalText(e, fallback)); } finally { setBusy(false); }
  };
  const open = m.state === 'proposed' || m.state === 'needs_review';
  const actions = open && (
    <FundActControl access={access} act="mercury.reconcile" testId={`match-refused-${m.uid}`} className="text-[12px] text-axal-muted">
      <span className="flex gap-2">
        {m.state === 'proposed' && <button type="button" className={BTN.primary} disabled={busy} data-testid={`match-confirm-${m.uid}`}
          onClick={() => run(() => apis.mercury.confirmMatch(m.uid), 'The match could not be confirmed.')}>Confirm</button>}
        <button type="button" className={BTN.ghost} disabled={busy} data-testid={`match-reject-${m.uid}`} onClick={() => setRejecting(true)}>Reject</button>
      </span>
    </FundActControl>
  );
  return (
    <div data-testid={`match-${m.uid}`}>
      <Row a={`${money(m.amount_cents) ?? 'Not recorded'} · ${targetName(m)}`}
        b={`${m.posted_on || 'not posted'} · ${m.counterparty_name || 'No counterparty recorded'} · ${m.entity_key} ${ending(m.last_four)}${m.reason ? ` · ${m.reason}` : ''}`}
        pill={<Pill tone={m.state === 'needs_review' ? 'warn' : m.state === 'confirmed' ? 'ok' : 'neutral'}>{m.state}</Pill>} action={actions} />
      {rejecting && (
        <form className="flex flex-col gap-2 px-3 pb-3" onSubmit={(e) => { e.preventDefault(); run(() => apis.mercury.rejectMatch(m.uid, reason.trim()), 'The match could not be rejected.'); }}>
          <label className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">Why is this not the match?
            <input className={`${INPUT} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} data-testid={`match-reason-${m.uid}`} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN.ghost} onClick={() => setRejecting(false)} disabled={busy}>Cancel</button>
            <button type="submit" className={BTN.danger} disabled={busy || reason.trim().length < REJECT_REASON_MIN} data-testid={`match-reject-submit-${m.uid}`}>Reject</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="px-3 pb-2 text-[12px] text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}

function ProposeForm({ apis, access, onChanged }) {
  const [form, setForm] = useState({ transaction_uid: '', target_kind: 'capital_call_line', target_id: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = Number(form.target_id);
  const ready = form.transaction_uid.trim() && Number.isSafeInteger(id) && id > 0;
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError('');
    try {
      await apis.mercury.proposeMatch({ transaction_uid: form.transaction_uid.trim(), target_kind: form.target_kind, target_id: id });
      setForm({ transaction_uid: '', target_kind: form.target_kind, target_id: '' });
      onChanged();
    } catch (err) { setError(refusalText(err, 'The pair could not be proposed.')); } finally { setBusy(false); }
  };
  return (
    <Group label="Propose a match">
      <FundActControl access={access} act="mercury.reconcile" testId="propose-refused" className="block px-3 py-2 text-[12px] text-axal-muted">
        <form className="grid gap-2 px-3 py-3 sm:grid-cols-[1fr_auto_8rem_auto]" onSubmit={submit} data-testid="propose-form">
          <input className={INPUT} placeholder="Transaction id" value={form.transaction_uid} onChange={(e) => setForm({ ...form, transaction_uid: e.target.value })} disabled={busy} aria-label="Transaction id" />
          <select className={INPUT} value={form.target_kind} onChange={(e) => setForm({ ...form, target_kind: e.target.value })} disabled={busy} aria-label="Target">
            <option value="capital_call_line">Capital-call line</option>
            <option value="fee_period">Fee period</option>
          </select>
          <input className={INPUT} placeholder="Target id" inputMode="numeric" value={form.target_id} onChange={(e) => setForm({ ...form, target_id: e.target.value })} disabled={busy} aria-label="Target id" />
          <button type="submit" className={BTN.primary} disabled={busy || !ready}>Propose</button>
        </form>
      </FundActControl>
      {error && <p role="alert" className="px-3 pb-2 text-[12px] text-red-700 dark:text-red-300">{error}</p>}
    </Group>
  );
}

export function ReconciliationTab({ apis, access }) {
  const [state, setState] = useState('');
  const read = useRead(() => apis.mercury.matches({ state: state || undefined }), [apis, state]);
  return (
    <div data-testid="reconciliation">
      <div className="mx-5 mt-4">
        <label className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">State{' '}
          <select className={`${INPUT} mt-1 sm:w-56`} value={state} onChange={(e) => setState(e.target.value)} data-testid="match-state">
            {STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <Group label="Matches">
        {read.status === 'loading' ? <div className="px-3 py-2"><LoadingRows lines={3} /></div>
          : read.status === 'unreadable' ? <ReadFailed read={read} what="The bank matches" claim="This is not a claim that none waits." />
            : (read.data?.items || []).length === 0 ? <Row a="No match" b={<Unrecorded>No match in this state</Unrecorded>} />
              : read.data.items.map((m) => <MatchRow key={m.uid} m={m} apis={apis} access={access} onChanged={read.reload} />)}
      </Group>
      <ProposeForm apis={apis} access={access} onChanged={read.reload} />
    </div>
  );
}
