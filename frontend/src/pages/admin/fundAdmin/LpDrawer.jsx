import { useState } from 'react';
import { Lightbox, Pill, Unrecorded, Unreadable } from '../../../ui';
import { FundActControl } from '../../../lib/fundActs';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import { COMM_KIND_LABELS } from '../../investor/fundLpCommsModel';
import { money, refusalText } from './fundAdminModel';
import {
  BOOKLET_VIEW_NOTE, BOOKLET_VIEW_RECORDED, DRAWER_TABS, LINE_STATE, NOT_RECORDED, RECEIPT_NOTE, WITHDRAW_MAX,
  WITHDRAW_MIN, bookletText, cell, day, identityText, lpCallLines, lpTypeText, receiptBody, withdrawReady,
} from './lpsModel';
import { Line, NUM, Note, Panel } from './parts';
import { useRead } from './useRead';
import { ContactDialog } from './LpDialogs';

/**
 * D1162 (#3069) — FND6, one LP's drawer at `/admin/fund-admin/lps/:id`, over
 * the roster. The LP's row is the roster's own (`?lp=<id>`, audited as the
 * roster is); each tab reads its own store only when it is opened, so a
 * failed tab never blanks the drawer:
 *
 *   Summary            the row's figures, each "Not recorded" with its reason.
 *   Calls & receipts   the LP's lines on the fund's call ledger; Record receipt
 *                      (`capital_call.receipt`) records money already received.
 *   Distributions      the fund's distributions to this LP.
 *   Notices            D716's notices to this LP, each with its kept PDF.
 *   Booklet            the row names the booklet; Open reads its answers, and
 *                      the Worker records that view in the audit log before it
 *                      answers. Withdraw takes a reason of 10 to 200
 *                      characters. Sending it to the General Partner is a Super
 *                      Admin's act (`fund_booklet.accept`): an Admin reads the
 *                      sentence.
 *   Contact log        what was sent to this LP and when; Log a contact.
 */
export function LpDrawer({ apis, access, lpId, onClose, onChanged }) {
  const row = useRead(() => apis.fundAdmin.lps({ lp: lpId, per_page: 1 }), [apis, lpId]);
  const [tab, setTab] = useState('summary');
  const lp = row.status === 'ready' ? row.data?.items?.[0] || null : null;
  const who = lp ? lp.name || lp.email || `LP ${lp.limited_partner_id}` : 'LP';
  const reload = () => { row.reload(); onChanged?.(); };
  return (
    <Lightbox label={`LP · ${who}`} eyebrow="LP" title={who} sub={lp?.email || null} testId="lp-drawer" onClose={onClose} width={680}>
      <div className="flex flex-col gap-3 px-5 py-4" data-testid={`lp-drawer-${lpId}`}>
        {(row.status === 'loading' || row.status === 'idle') && <LoadingRows lines={4} />}
        {row.status === 'unreadable' && <Unreadable what="This LP" claim="This is not a claim that the LP does not exist." onRetry={row.reload} />}
        {row.status === 'ready' && !lp && <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400" data-testid="lp-drawer-missing">No LP with this id is on a fund administered here.</p>}
        {lp && (
          <>
            <div className="flex flex-wrap gap-1.5" data-testid="lp-drawer-tags">
              <Pill tone="neutral">{lp.fund_name || NOT_RECORDED}</Pill>
              <Pill tone="neutral">{lpTypeText(lp.lp_type)}</Pill>
            </div>
            <nav className="flex flex-wrap gap-1.5" role="tablist" aria-label="LP" data-testid="lp-drawer-tabs">
              {DRAWER_TABS.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`lp-tab-${k}`}
                  className={`inline-flex min-h-[30px] items-center rounded-full border px-3 text-[12px] font-semibold max-sm:min-h-[44px] ${tab === k
                    ? 'border-axal-violet bg-axal-violet/10 text-axal-violet-deep dark:text-violet-300'
                    : 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100'}`}>{label}</button>
              ))}
            </nav>
            <div role="tabpanel" data-testid={`lp-panel-${tab}`}>
              {tab === 'summary' && <Summary lp={lp} />}
              {tab === 'calls' && <Calls apis={apis} access={access} lp={lp} onChanged={reload} />}
              {tab === 'distributions' && <Distributions apis={apis} lp={lp} />}
              {tab === 'notices' && <Notices apis={apis} lp={lp} />}
              {tab === 'booklet' && <Booklet apis={apis} access={access} lp={lp} onChanged={reload} />}
              {tab === 'contacts' && <Contacts apis={apis} access={access} lp={lp} />}
            </div>
          </>
        )}
        <div className="flex justify-end"><button type="button" className={BTN.ghost} onClick={onClose} data-testid="lp-drawer-close">Close</button></div>
      </div>
    </Lightbox>
  );
}

function Fact({ k, children, testId }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-axal-hairline px-4 py-2.5 last:border-b-0 sm:px-5 dark:border-gray-800" data-testid={testId}>
      <span className="text-[12px] text-axal-muted dark:text-gray-400">{k}</span>
      <span className={`text-right text-[12px] font-bold text-axal-ink dark:text-gray-100 ${NUM}`}>{children}</span>
    </div>
  );
}

function Money({ lp, k }) {
  const c = cell(lp, k);
  return c.reason ? <Unrecorded reason={c.reason}>{`${c.text}: ${c.reason}`}</Unrecorded> : c.text;
}

function Summary({ lp }) {
  return (
    <Panel label={`${lp.name || lp.email || `LP ${lp.limited_partner_id}`} · ${lp.fund_name || NOT_RECORDED}`} testId="lp-summary">
      <Fact k="Commitment" testId="lp-summary-commitment"><Money lp={lp} k="commitment_cents" /></Fact>
      <Fact k="Called" testId="lp-summary-called"><Money lp={lp} k="called_cents" /></Fact>
      <Fact k="Received" testId="lp-summary-received"><Money lp={lp} k="received_cents" /></Fact>
      <Fact k="Outstanding" testId="lp-summary-outstanding"><Money lp={lp} k="outstanding_cents" /></Fact>
      <Fact k="Distributed" testId="lp-summary-distributed"><Money lp={lp} k="distributed_cents" /></Fact>
      <Fact k="LPA signed" testId="lp-summary-lpa">{lp.lpa_signed ? day(lp.lpa_signed_at) || 'Signed, date not recorded' : 'Pending'}</Fact>
      <Fact k="Identity" testId="lp-summary-identity">{lp.kyc_status ? identityText(lp.kyc_status) : <Unrecorded reason={lp.unavailable?.kyc_status}>{`${NOT_RECORDED}: ${lp.unavailable?.kyc_status || ''}`}</Unrecorded>}</Fact>
      <Fact k="Booklet" testId="lp-summary-booklet">{lp.booklet ? bookletText(lp.booklet) : <Unrecorded reason={lp.unavailable?.booklet}>{NOT_RECORDED}</Unrecorded>}</Fact>
    </Panel>
  );
}

const Busy = () => <div className="px-4 py-3 sm:px-5"><LoadingRows lines={3} /></div>;
function Failed({ read, what, claim }) {
  return <div className="px-4 py-3 sm:px-5"><Unreadable what={what} claim={claim} onRetry={read.reload} /></div>;
}

function Calls({ apis, access, lp, onChanged }) {
  const ledger = useRead(() => apis.lps.ledger(lp.fund_id), [apis, lp.fund_id]);
  const [line, setLine] = useState(null);
  const lines = ledger.status === 'ready' ? lpCallLines(ledger.data, lp.limited_partner_id) : [];
  return (
    <Panel label="Calls & receipts" testId="lp-calls">
      {ledger.status === 'loading' && <Busy />}
      {ledger.status === 'unreadable' && <Failed read={ledger} what="The call ledger" claim="This is not a claim that the LP has no call." />}
      {ledger.status === 'ready' && ledger.data?.truncated && <Note>This fund has more call lines than one read returns, so some of this LP's lines may not be shown.</Note>}
      {ledger.status === 'ready' && (lines.length === 0
        ? <Note testId="lp-calls-none"><Unrecorded>No capital call line has been issued to this LP.</Unrecorded></Note>
        : lines.map((l) => {
          const [label, tone] = LINE_STATE[l.state] || [l.state, 'neutral'];
          return (
            <Line key={l.id} testId={`lp-call-${l.id}`} a={`${l.label} · due ${l.due || NOT_RECORDED}`}
              b={<span className={NUM}>Owed {l.owed} · Received {l.received} · Outstanding {l.outstanding}</span>}
              chip={<Pill tone={tone}>{l.days_overdue != null ? `${label} · ${l.days_overdue} days` : label}</Pill>}
              action={l.open ? (
                <FundActControl access={access} act="capital_call.receipt" testId={`lp-receipt-refused-${l.id}`}>
                  <button type="button" className={BTN.ghost} onClick={() => setLine(l)} data-testid={`lp-receipt-${l.id}`}>Record receipt</button>
                </FundActControl>
              ) : null} />
          );
        }))}
      <Note>{RECEIPT_NOTE}</Note>
      {line && <ReceiptDialog apis={apis} lp={lp} line={line} onClose={() => setLine(null)} onRecorded={() => { ledger.reload(); onChanged(); }} />}
    </Panel>
  );
}

function ReceiptDialog({ apis, lp, line, onClose, onRecorded }) {
  const [form, setForm] = useState({ full: true, amount: '', receivedOn: new Date().toISOString().slice(0, 10), reference: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const out = receiptBody(form, line);
    if (out.error) { setError(out.error); return; }
    setBusy(true); setError('');
    try { await apis.lps.receipt(lp.fund_id, line.id, out.body); onRecorded(); onClose(); } catch (err) { setError(refusalText(err, 'The receipt could not be recorded.')); } finally { setBusy(false); }
  };
  const L = 'flex items-center gap-2 text-[12.5px] text-zinc-700 dark:text-gray-200';
  return (
    <Lightbox label="Record receipt" title={`Record receipt · ${lp.name || lp.email || `LP ${lp.limited_partner_id}`} · ${line.label}`} sub={`Outstanding on this line: ${line.outstanding}.`} testId="lp-receipt-dialog" onClose={onClose} width={480}>
      <form className="flex flex-col gap-3 px-5 py-4" onSubmit={submit} data-testid="lp-receipt-form">
        <label className={L}><input type="radio" name="amount" checked={form.full} onChange={() => setForm((f) => ({ ...f, full: true }))} data-testid="lp-receipt-full" />The full outstanding {line.outstanding}</label>
        <label className={L}><input type="radio" name="amount" checked={!form.full} onChange={() => setForm((f) => ({ ...f, full: false }))} data-testid="lp-receipt-other" />Another amount</label>
        {!form.full && <label className="text-[11.5px] font-semibold text-zinc-700 dark:text-gray-200">Amount ($)<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.amount} onChange={set('amount')} disabled={busy} data-testid="lp-receipt-amount" /></label>}
        <label className="text-[11.5px] font-semibold text-zinc-700 dark:text-gray-200">Received on<input className={`${INPUT} mt-1`} type="date" value={form.receivedOn} onChange={set('receivedOn')} disabled={busy} data-testid="lp-receipt-date" /></label>
        <label className="text-[11.5px] font-semibold text-zinc-700 dark:text-gray-200">Reference<input className={`${INPUT} mt-1`} maxLength={120} value={form.reference} onChange={set('reference')} disabled={busy} data-testid="lp-receipt-reference" /></label>
        <p className="m-0 rounded-axal-sm border border-axal-hairline bg-gray-50 px-3 py-2 text-[12px] text-axal-ink dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-100">This records money already received. It moves no money.</p>
        {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="lp-receipt-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={BTN.primary} disabled={busy} data-testid="lp-receipt-submit">Record receipt</button>
        </div>
      </form>
    </Lightbox>
  );
}

function Distributions({ apis, lp }) {
  const list = useRead(() => apis.lps.distributions(lp.fund_id), [apis, lp.fund_id]);
  const items = (list.data?.items || []).filter((d) => Number(d.lp_id) === Number(lp.limited_partner_id));
  return (
    <Panel label="Distributions" testId="lp-distributions">
      {list.status === 'loading' && <Busy />}
      {list.status === 'unreadable' && <Failed read={list} what="The distributions" claim="This is not a claim that none was made." />}
      {list.status === 'ready' && (items.length === 0
        ? <Note testId="lp-distributions-none"><Unrecorded>No distribution to this LP is recorded.</Unrecorded></Note>
        : items.map((d) => (
          <Line key={d.id} testId={`lp-distribution-${d.id}`} a={d.distribution_type ? d.distribution_type.replace(/_/g, ' ') : 'Type not recorded'}
            b={day(d.distributed_at || d.created_at) || 'Date not recorded'} figure={money(d.amount_cents) ?? NOT_RECORDED}
            chip={<Pill tone={d.status === 'paid' ? 'ok' : 'neutral'}>{d.status === 'paid' ? 'Paid' : 'Pending'}</Pill>} />
        )))}
    </Panel>
  );
}

function Notices({ apis, lp }) {
  const list = useRead(() => apis.notices.list({ fundId: lp.fund_id, lpId: lp.limited_partner_id }), [apis, lp.fund_id, lp.limited_partner_id]);
  const [error, setError] = useState('');
  const pdf = async (uid) => {
    setError('');
    try { const { blob, filename } = await apis.notices.pdfBlob(uid); (apis.saveFile || saveBlob)(blob, filename); } catch (e) { setError(refusalText(e, 'The notice PDF could not be downloaded.')); }
  };
  const items = list.data?.notices || [];
  return (
    <Panel label="Issued notices" testId="lp-notices">
      {list.status === 'loading' && <Busy />}
      {list.status === 'unreadable' && <Failed read={list} what="The notices" claim="This is not a claim that none was issued." />}
      {list.status === 'ready' && (items.length === 0
        ? <Note testId="lp-notices-none"><Unrecorded>No notice has been issued to this LP.</Unrecorded></Note>
        : items.map((n) => (
          <Line key={n.uid} testId={`lp-notice-${n.uid}`} tone={null} a={n.title || n.type}
            b={<span className={NUM}>{[n.reference ? `ref ${n.reference}` : null, money(n.amount_cents), day(n.notice_date || n.created_at)].filter(Boolean).join(' · ')}</span>}
            chip={n.superseded ? <Pill tone="neutral">Superseded</Pill> : null}
            action={<button type="button" className={BTN.ghost} onClick={() => pdf(n.uid)} data-testid={`lp-notice-pdf-${n.uid}`}>PDF</button>} />
        )))}
      {error && <p role="alert" className="px-4 pb-2.5 text-[12px] text-red-700 sm:px-5 dark:text-red-300">{error}</p>}
    </Panel>
  );
}

function Booklet({ apis, access, lp, onChanged }) {
  const b = lp.booklet;
  const [view, setView] = useState({ status: 'closed', data: null });
  const [withdrawing, setWithdrawing] = useState(false);
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  if (!b || !b.uid) {
    return (
      <Panel label="Subscription booklet" testId="lp-booklet">
        <Note testId="lp-booklet-none"><Unrecorded reason={lp.unavailable?.booklet}>{b ? 'The LP has not opened a booklet yet.' : `${NOT_RECORDED}: ${lp.unavailable?.booklet || 'no booklet links this LP.'}`}</Unrecorded></Note>
      </Panel>
    );
  }
  const open = async () => {
    setView({ status: 'loading', data: null }); setError('');
    try { setView({ status: 'ok', data: await apis.booklets.one(b.uid) }); } catch (e) { setView({ status: 'closed', data: null }); setError(refusalText(e, 'The booklet could not be opened.')); }
  };
  const send = async () => {
    setError(''); setSent('');
    try { await apis.booklets.sendToGeneralPartner(b.uid); setSent('Sent to the General Partner for acceptance.'); } catch (e) { setError(refusalText(e, 'The booklet could not be sent.')); }
  };
  const v = view.data;
  const ticked = v ? (v.parts || []).reduce((n, p) => n + (p.fields || []).filter((f) => f.checked).length, 0) : 0;
  const fields = v ? (v.parts || []).reduce((n, p) => n + (p.fields || []).length, 0) : 0;
  return (
    <Panel label={`Subscription booklet · ${lp.fund_name || NOT_RECORDED}`} testId="lp-booklet"
      sub={b.submitted_at ? `Submitted ${day(b.submitted_at)}` : bookletText(b)}>
      <Line a={bookletText(b)} b={BOOKLET_VIEW_NOTE} testId="lp-booklet-state"
        action={(
          <>
            {view.status !== 'ok' && <button type="button" className={BTN.ghost} onClick={open} disabled={view.status === 'loading'} data-testid="lp-booklet-open">Open</button>}
            {b.state !== 'withdrawn' && <FundActControl access={access} act="fund_booklet.withdraw" testId="lp-booklet-withdraw-refused">
              <button type="button" className={BTN.danger} onClick={() => setWithdrawing(true)} data-testid="lp-booklet-withdraw">Withdraw</button>
            </FundActControl>}
            {b.state === 'submitted' && <FundActControl access={access} act="fund_booklet.accept" testId="lp-booklet-accept-refused" className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">
              <button type="button" className={BTN.ghost} onClick={send} data-testid="lp-booklet-accept">Send to the General Partner</button>
            </FundActControl>}
          </>
        )} />
      {view.status === 'ok' && v && (
        <div data-testid="lp-booklet-view">
          <Line a={`${ticked} of ${fields} answers ticked`} b={BOOKLET_VIEW_RECORDED} testId="lp-booklet-recorded"
            chip={v.signing?.state ? <Pill tone={v.signing.state === 'accepted' ? 'ok' : 'neutral'}>{v.signing.state.replace(/_/g, ' ')}</Pill> : null} />
          {(v.parts || []).map((p) => (
            <Line key={p.part} a={`Part ${p.part}${p.title ? ` · ${p.title}` : ''}`}
              b={p.missing ? 'This part is missing from the store.' : `${(p.fields || []).filter((f) => f.checked).length} of ${(p.fields || []).length} ticked`} />
          ))}
          {v.withdrawn_reason && <Line a="Withdrawn" b={v.withdrawn_reason} />}
        </div>
      )}
      {sent && <p role="status" className="px-4 pb-2.5 text-[12px] text-axal-positive sm:px-5 dark:text-emerald-300" data-testid="lp-booklet-sent">{sent}</p>}
      {error && <p role="alert" className="px-4 pb-2.5 text-[12px] text-red-700 sm:px-5 dark:text-red-300" data-testid="lp-booklet-error">{error}</p>}
      {withdrawing && <WithdrawDialog apis={apis} lp={lp} uid={b.uid} onClose={() => setWithdrawing(false)} onDone={onChanged} />}
    </Panel>
  );
}

export function WithdrawDialog({ apis, lp, uid, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = withdrawReady(reason);
  const who = lp.name || lp.email || `LP ${lp.limited_partner_id}`;
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) { setError(`Give a reason of ${WITHDRAW_MIN} to ${WITHDRAW_MAX} characters.`); return; }
    setBusy(true); setError('');
    try { await apis.booklets.withdraw(uid, reason.trim()); onDone?.(); onClose(); } catch (err) { setError(refusalText(err, 'The booklet could not be withdrawn.')); } finally { setBusy(false); }
  };
  return (
    <Lightbox label="Withdraw this booklet?" title="Withdraw this booklet?" sub={`${who} is told it was withdrawn. It stays in the booklet’s history.`} testId="lp-withdraw-dialog" onClose={onClose} width={460}>
      <form className="flex flex-col gap-3 px-5 py-4" onSubmit={submit} data-testid="lp-withdraw-form">
        <label className="text-[11.5px] font-semibold text-zinc-700 dark:text-gray-200">Reason · {WITHDRAW_MIN} to {WITHDRAW_MAX} characters
          <textarea className={`${INPUT} mt-1 min-h-[64px]`} maxLength={WITHDRAW_MAX} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} data-testid="lp-withdraw-reason" />
        </label>
        {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="lp-withdraw-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Back</button>
          <button type="submit" className={BTN.dangerSolid} disabled={busy || !ready} data-testid="lp-withdraw-submit">Withdraw</button>
        </div>
      </form>
    </Lightbox>
  );
}

function Contacts({ apis, access, lp }) {
  const log = useRead(() => apis.lps.contacts(lp.fund_id, lp.limited_partner_id), [apis, lp.fund_id, lp.limited_partner_id]);
  const [logging, setLogging] = useState(false);
  const items = log.data?.items || [];
  return (
    <Panel label="Contact log" testId="lp-contacts"
      aside={<FundActControl access={access} act="fund.write" testId="lp-contact-refused">
        <button type="button" className={BTN.ghost} onClick={() => setLogging(true)} data-testid="lp-contact-log">Log a contact</button>
      </FundActControl>}>
      {log.status === 'loading' && <Busy />}
      {log.status === 'unreadable' && <Failed read={log} what="The contact log" claim="This is not a claim that nothing was sent." />}
      {log.status === 'ready' && (items.length === 0
        ? <Note testId="lp-contacts-none"><Unrecorded>No contact with this LP is logged.</Unrecorded></Note>
        : items.map((c) => (
          <Line key={c.id} testId={`lp-contact-${c.id}`} a={c.subject}
            b={`${COMM_KIND_LABELS[c.kind] || c.kind} · ${day(c.sent_at) || 'Date not recorded'} · logged by ${c.logged_by_name || 'an admin'}`} />
        )))}
      {log.status === 'ready' && log.data?.truncated && <Note>Only the latest entries are shown.</Note>}
      {logging && <ContactDialog apis={apis} access={access} row={lp} onClose={() => setLogging(false)} onLogged={log.reload} />}
    </Panel>
  );
}

/** Saves a kept PDF the viewer asked for: an `<a download>` on an object URL, revoked a second later. */
function saveBlob(blob, filename) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
