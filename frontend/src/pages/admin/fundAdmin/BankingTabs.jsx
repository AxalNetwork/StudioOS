import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Pill, Unrecorded, Unreadable } from '../../../ui';
import { FundActControl } from '../../../lib/fundActs';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import { MercuryEntityConnections } from './MercuryEntitySheet';
import {
  NOT_OURS_NOTE_MAX, NOT_OURS_REASONS, PAYMENT_INSTRUCTIONS_ADMIN, PAYMENT_INSTRUCTIONS_LINK, REJECT_REASON_MIN, actRow, balanceText, ending,
  money, notOursText, refusalText,
} from './fundAdminModel';
import { Line, NUM, Note, Panel, Section, Table } from './parts';
import { useRead } from './useRead';

/**
 * Banking and Reconciliation (decision 8), laid out to the brief's boards.
 * Every read here is #1775's, and each one writes its audit row before it
 * answers. Bank text (counterparty names, memos, organization names) is drawn
 * as text, never as HTML.
 *
 * Banking: the entity connections (#1834's `MercuryEntityConnections`, its
 * own rows and controls, never a second copy), the accounts and the paged
 * transactions as the canvas's tables, then payment instructions.
 * Reconciliation: the matches grouped by state, the unmatched credits with
 * the "Not ours" dialog (the shared `Lightbox`), the "Not ours" group with
 * Withdraw, and a manual proposal.
 */

function ReadFailed({ read, what, claim }) {
  const audit = read.error?.status === 503;
  return <div className="px-4 py-3 sm:px-5"><Unreadable what={what} claim={audit ? 'Nothing was read, because its audit row could not be written.' : claim} onRetry={read.reload} /></div>;
}

function Accounts({ apis }) {
  const read = useRead(() => apis.mercury.accounts(), [apis]);
  const items = read.data?.items || [];
  const cols = [
    { key: 'account', label: 'Account', cell: (a) => `${a.nickname || a.kind} · ${ending(a.last_four)}` },
    { key: 'entity', label: 'Entity', cell: (a) => a.entity_key },
    { key: 'current', label: 'Current', align: 'right', mono: true, cell: (a) => balanceText(a.current) },
    { key: 'available', label: 'Available', align: 'right', mono: true, cell: (a) => balanceText(a.available) },
    { key: 'read', label: 'Read', mono: true, cell: (a) => a.balance_read_at || 'Not recorded' },
    { key: 'registry', label: 'Registry', cell: (a) => (a.registered ? <Pill tone="ok">Registered</Pill> : <Pill tone="warn">Not in the registry</Pill>) },
  ];
  return (
    <Panel label="Accounts" testId="banking-accounts">
      {read.status === 'loading' ? <div className="px-4 py-3 sm:px-5"><LoadingRows lines={2} /></div>
        : read.status === 'unreadable' ? <ReadFailed read={read} what="The entity accounts" claim="This is not a claim that there is none." />
          : items.length === 0 ? <Note>No account recorded. An account appears here after its entity's first sync.</Note>
            : <Table cols={cols} rows={items} rowKey={(a) => a.uid} template="1.6fr .9fr 1fr 1fr 1.2fr 1fr" rowTestId={(a) => `account-${a.uid}`} />}
    </Panel>
  );
}

function Transactions({ apis }) {
  const [page, setPage] = useState(1);
  const read = useRead(() => apis.mercury.transactions({ page }), [apis, page]);
  const total = Number(read.data?.total ?? 0);
  const size = Number(read.data?.page_size ?? 50);
  const pages = Math.max(1, Math.ceil(total / size));
  const items = read.data?.items || [];
  const cols = [
    { key: 'date', label: 'Posted', mono: true, cell: (t) => t.posted_on || t.created_on },
    { key: 'counterparty', label: 'Counterparty', cell: (t) => t.counterparty_name || 'No counterparty recorded' },
    { key: 'account', label: 'Account', cell: (t) => ending(t.last_four) },
    { key: 'amount', label: 'Amount', align: 'right', mono: true, cell: (t) => money(t.amount_cents) ?? 'Not recorded' },
    { key: 'status', label: 'Status', cell: (t) => t.status || 'Not recorded' },
    { key: 'match', label: 'Match', cell: (t) => <Pill tone={t.match ? 'ok' : t.not_ours ? 'warn' : 'neutral'}>{t.match ? t.match.state : t.not_ours ? notOursText(t.not_ours) : 'Unmatched'}</Pill> },
  ];
  return (
    <Panel label="Transactions" sub={read.status === 'ready' ? <span data-testid="transactions-page">Page {page} of {pages} · {total} lines</span> : null}
      aside={read.status === 'ready' && pages > 1 ? (
        <span className="flex gap-2">
          <button type="button" className={BTN.ghost} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <button type="button" className={BTN.ghost} disabled={page >= pages} onClick={() => setPage(page + 1)} data-testid="transactions-next">Next</button>
        </span>
      ) : null} testId="banking-transactions">
      {read.status === 'loading' ? <div className="px-4 py-3 sm:px-5"><LoadingRows lines={3} /></div>
        : read.status === 'unreadable' ? <ReadFailed read={read} what="The transactions" claim="This is not a claim that no money moved." />
          : items.length === 0 ? <Note>No transaction recorded. Lines appear after a sync.</Note>
            : <Table cols={cols} rows={items} rowKey={(t) => t.uid} template="1fr 1.8fr 1fr 1fr .8fr 1.2fr" rowTestId={(t) => `transaction-${t.uid}`} />}
    </Panel>
  );
}

export function BankingTab({ apis, access }) {
  const superAdmin = access?.super_admin === true;
  return (
    <Section title="Banking" testId="banking"
      sub="Each Axal entity's Mercury connection, its accounts and their transactions. Every read here is recorded in the admin audit log before it answers.">
      <Panel label="Entity connections" testId="banking-connections">
        <MercuryEntityConnections superAdmin={superAdmin} api={apis.mercury} />
      </Panel>
      <Accounts apis={apis} />
      <Transactions apis={apis} />
      <Panel label="Payment instructions" testId="banking-payment-instructions">
        {actRow(access, 'bank_account.see')?.allowed === true
          ? <Line a="The entities' bank accounts" b="Entered, retired and revealed from the bank accounts console, behind your step-up."
            action={<Link className={BTN.link} to={PAYMENT_INSTRUCTIONS_LINK.href} data-testid="payment-instructions-link">{PAYMENT_INSTRUCTIONS_LINK.text}</Link>} />
          : <Line a="The entities' bank accounts" b={<span data-testid="payment-instructions-admin">{PAYMENT_INSTRUCTIONS_ADMIN}</span>} />}
      </Panel>
    </Section>
  );
}

/** The brief's groups, in its order, with Needs review (a proposal whose line changed) beside Proposed. */
const GROUPS = [['proposed', 'Proposed'], ['needs_review', 'Needs review'], ['confirmed', 'Confirmed'], ['rejected', 'Rejected']];
const targetName = (m) => (m.target_kind === 'fee_period' ? `Fee period #${m.target_id}` : `Capital-call line #${m.target_id}`);
const ERR = 'px-4 pb-2.5 text-[12px] text-red-700 sm:px-5 dark:text-red-300';
const LABEL = 'text-[11.5px] font-semibold text-zinc-700 dark:text-gray-200';

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
      <Line a={`${money(m.amount_cents) ?? 'Not recorded'} · ${targetName(m)}`}
        b={<span className={NUM}>{`${m.posted_on || 'not posted'} · ${m.counterparty_name || 'No counterparty recorded'} · ${m.entity_key} ${ending(m.last_four)}${m.reason ? ` · ${m.reason}` : ''}`}</span>}
        chip={<Pill tone={m.state === 'needs_review' ? 'warn' : m.state === 'confirmed' ? 'ok' : m.state === 'rejected' ? 'danger' : 'neutral'}>{GROUPS.find(([k]) => k === m.state)?.[1] || m.state}</Pill>} action={actions} />
      {rejecting && (
        <form className="flex flex-col gap-2 border-b border-axal-hairline bg-[#faf9fc] px-4 py-3 sm:px-5 dark:border-gray-800 dark:bg-gray-950/40" onSubmit={(e) => { e.preventDefault(); run(() => apis.mercury.rejectMatch(m.uid, reason.trim()), 'The match could not be rejected.'); }}>
          <label className={LABEL}>Why is this not the match?
            <input className={`${INPUT} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} data-testid={`match-reason-${m.uid}`} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN.ghost} onClick={() => setRejecting(false)} disabled={busy}>Cancel</button>
            <button type="submit" className={BTN.danger} disabled={busy || reason.trim().length < REJECT_REASON_MIN} data-testid={`match-reject-submit-${m.uid}`}>Reject</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className={ERR}>{error}</p>}
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
    <Panel label="Propose a match" testId="reconciliation-propose">
      <FundActControl access={access} act="mercury.reconcile" testId="propose-refused" className="block px-4 py-3 text-[12px] text-axal-muted sm:px-5">
        <form className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto_8rem_auto] sm:px-5" onSubmit={submit} data-testid="propose-form">
          <input className={INPUT} placeholder="Transaction id" value={form.transaction_uid} onChange={(e) => setForm({ ...form, transaction_uid: e.target.value })} disabled={busy} aria-label="Transaction id" />
          <select className={INPUT} value={form.target_kind} onChange={(e) => setForm({ ...form, target_kind: e.target.value })} disabled={busy} aria-label="Target">
            <option value="capital_call_line">Capital-call line</option>
            <option value="fee_period">Fee period</option>
          </select>
          <input className={INPUT} placeholder="Target id" inputMode="numeric" value={form.target_id} onChange={(e) => setForm({ ...form, target_id: e.target.value })} disabled={busy} aria-label="Target id" />
          <button type="submit" className={BTN.primary} disabled={busy || !ready}>Propose</button>
        </form>
      </FundActControl>
      {error && <p role="alert" className={ERR}>{error}</p>}
    </Panel>
  );
}

/** D749: the "Not ours" dialog for one unmatched credit, on the shared Lightbox. */
function NotOursDialog({ t, apis, onClose, onChanged }) {
  const [reason, setReason] = useState(NOT_OURS_REASONS[0][0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trimmed = note.trim();
  const ready = trimmed.length <= NOT_OURS_NOTE_MAX && (reason !== 'other' || trimmed.length >= REJECT_REASON_MIN);
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError('');
    try {
      await apis.mercury.markNotOurs(t.uid, { reason, note: trimmed || undefined });
      onClose(); onChanged();
    } catch (err) { setError(refusalText(err, 'The credit could not be marked.')); } finally { setBusy(false); }
  };
  return (
    <Lightbox label="Mark this credit Not ours" title="Not ours" testId={`not-ours-dialog-${t.uid}`} onClose={onClose} width={480}
      sub={`${money(t.amount_cents) ?? 'Not recorded'} from ${t.counterparty_name || 'no counterparty recorded'} · ${t.entity_key} ${ending(t.last_four)}`}>
      <form className="flex flex-col gap-3 px-5 py-4" onSubmit={submit} data-testid={`not-ours-form-${t.uid}`}>
        <p className="text-[12px] leading-relaxed text-axal-muted dark:text-gray-400">The matcher skips a marked credit, and the monthly summary and the quarterly report leave it out of the unmatched count. Any Admin can withdraw the mark.</p>
        <label className={LABEL}>Why is this credit not ours?
          <select className={`${INPUT} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} data-testid={`not-ours-reason-${t.uid}`}>
            {NOT_OURS_REASONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className={LABEL}>{reason === 'other' ? 'Say why (needed for Other)' : 'A note (optional)'}
          <input className={`${INPUT} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} data-testid={`not-ours-note-${t.uid}`} />
        </label>
        {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={BTN.primary} disabled={busy || !ready} data-testid={`not-ours-submit-${t.uid}`}>Mark Not ours</button>
        </div>
      </form>
    </Lightbox>
  );
}

/** D749: one unmatched credit, with its Not ours action. */
function UnmatchedCredit({ t, apis, access, onChanged }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={`unmatched-${t.uid}`}>
      <Line a={t.counterparty_name || 'No counterparty recorded'} b={<span className={NUM}>{`${t.posted_on || t.created_on} · ${t.entity_key} ${ending(t.last_four)}`}</span>}
        figure={money(t.amount_cents) ?? 'Not recorded'}
        chip={t.not_ours ? <Pill tone="warn">{notOursText(t.not_ours)}</Pill> : null}
        action={!t.not_ours && (
          <FundActControl access={access} act="mercury.reconcile" testId={`not-ours-refused-${t.uid}`} className="text-[12px] text-axal-muted">
            <button type="button" className={BTN.ghost} onClick={() => setOpen(true)} data-testid={`not-ours-${t.uid}`}>Not ours</button>
          </FundActControl>
        )} />
      {open && <NotOursDialog t={t} apis={apis} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </div>
  );
}

/** D749: one marked line, with Withdraw and its reason. */
function NotOursRow({ t, apis, access, onChanged }) {
  const mark = t.not_ours;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (reason.trim().length < REJECT_REASON_MIN) return;
    setBusy(true); setError('');
    try { await apis.mercury.withdrawNotOurs(mark.uid, reason.trim()); setOpen(false); setReason(''); onChanged(); }
    catch (err) { setError(refusalText(err, 'The mark could not be withdrawn.')); } finally { setBusy(false); }
  };
  return (
    <div data-testid={`not-ours-mark-${mark.uid}`}>
      <Line a={t.counterparty_name || 'No counterparty recorded'}
        b={<span className={NUM}>{`${t.posted_on || t.created_on} · ${t.entity_key} ${ending(t.last_four)}${mark.note ? ` · ${mark.note}` : ''}`}</span>}
        figure={money(t.amount_cents) ?? 'Not recorded'}
        chip={<Pill tone="warn">{notOursText(mark)}</Pill>}
        action={(
          <FundActControl access={access} act="mercury.reconcile" testId={`not-ours-withdraw-refused-${mark.uid}`} className="text-[12px] text-axal-muted">
            <button type="button" className={BTN.ghost} disabled={busy} onClick={() => setOpen(true)} data-testid={`not-ours-withdraw-${mark.uid}`}>Withdraw</button>
          </FundActControl>
        )} />
      {open && (
        <form className="flex flex-col gap-2 border-b border-axal-hairline bg-[#faf9fc] px-4 py-3 sm:px-5 dark:border-gray-800 dark:bg-gray-950/40" onSubmit={submit}>
          <label className={LABEL}>Why is it ours after all?
            <input className={`${INPUT} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} data-testid={`not-ours-withdraw-reason-${mark.uid}`} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN.ghost} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button type="submit" className={BTN.danger} disabled={busy || reason.trim().length < REJECT_REASON_MIN} data-testid={`not-ours-withdraw-submit-${mark.uid}`}>Withdraw</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className={ERR}>{error}</p>}
    </div>
  );
}

export function ReconciliationTab({ apis, access }) {
  // One counter reloads the three reads after any act, so a mark moves between groups at once.
  const [tick, setTick] = useState(0);
  const changed = () => setTick((n) => n + 1);
  const read = useRead(() => apis.mercury.matches({}), [apis, tick]);
  const unmatched = useRead(() => apis.mercury.transactions({ match: 'none' }), [apis, tick]);
  const marked = useRead(() => apis.mercury.transactions({ match: 'not_ours' }), [apis, tick]);
  const credits = (unmatched.data?.items || []).filter((t) => Number(t.amount_cents) > 0);
  const marks = (marked.data?.items || []).filter((t) => t.not_ours);
  const matches = read.data?.items || [];
  return (
    <Section title="Reconciliation" testId="reconciliation"
      sub="Bank lines paired with capital-call lines and fee periods. Any Admin confirms, rejects with a reason, or proposes a pair; a credit that is not the fund's is marked Not ours.">
      {read.status === 'loading' ? <Panel label="Matches"><div className="px-4 py-3 sm:px-5"><LoadingRows lines={3} /></div></Panel>
        : read.status === 'unreadable' ? <Panel label="Matches"><ReadFailed read={read} what="The bank matches" claim="This is not a claim that none waits." /></Panel>
          : matches.length === 0 ? <Panel label="Matches" testId="matches-empty"><Note><Unrecorded>No match yet</Unrecorded></Note></Panel>
            : GROUPS.map(([state, label]) => {
              const group = matches.filter((m) => m.state === state);
              return (
                <Panel key={state} label={`${label} · ${group.length}`} testId={`matches-${state}`}>
                  {group.length === 0 ? <Note>{`None ${label.toLowerCase()}.`}</Note>
                    : group.map((m) => <MatchRow key={m.uid} m={m} apis={apis} access={access} onChanged={changed} />)}
                </Panel>
              );
            })}
      <Panel label="Unmatched credits" testId="reconciliation-unmatched">
        {unmatched.status === 'loading' ? <div className="px-4 py-3 sm:px-5"><LoadingRows lines={2} /></div>
          : unmatched.status === 'unreadable' ? <ReadFailed read={unmatched} what="The unmatched credits" claim="This is not a claim that every credit is matched." />
            : credits.length === 0 ? <Note><Unrecorded>No unmatched credit. Every posted credit read so far is matched or marked.</Unrecorded></Note>
              : credits.map((t) => <UnmatchedCredit key={t.uid} t={t} apis={apis} access={access} onChanged={changed} />)}
      </Panel>
      <Panel label="Not ours" testId="reconciliation-not-ours">
        {marked.status === 'loading' ? <div className="px-4 py-3 sm:px-5"><LoadingRows lines={2} /></div>
          : marked.status === 'unreadable' ? <ReadFailed read={marked} what="The credits marked Not ours" claim="This is not a claim that none is marked." />
            : marks.length === 0 ? <Note><Unrecorded>No credit marked Not ours.</Unrecorded></Note>
              : marks.map((t) => <NotOursRow key={t.not_ours.uid} t={t} apis={apis} access={access} onChanged={changed} />)}
      </Panel>
      <ProposeForm apis={apis} access={access} onChanged={changed} />
    </Section>
  );
}
