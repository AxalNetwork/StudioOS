import { useState } from 'react';
import { Lightbox, Pill } from '../../../ui';
import { FundActControl } from '../../../lib/fundActs';
import { BTN, INPUT } from '../../account/AccountCenter';
import { refusalText } from './fundAdminModel';
import { NUM } from './parts';
import { LABEL } from './FundTabs';
import {
  NOTICE_FINAL, PAGE_SIZES, RECEIPT_INFO, checkNewCall, lpName, money, previewRows, receiptBody, refusedNotice,
} from './callsModel';

/**
 * D1163 — FND8's dialogs: New capital call and its preview (A, B), Record
 * receipt (E) and Call notices (D). Each opens in-page and says what it
 * changes; each act is the Worker's, and one the act table refuses this
 * viewer is drawn as its sentence (`FundActControl`). The step-up (C) is the
 * request helper's: a 403 `step_up_required` opens it, then the act retries.
 */
const todayIso = () => new Date().toISOString().slice(0, 10);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const INFO = 'm-0 rounded-axal-sm border border-axal-hairline bg-gray-50 px-3 py-2 text-[12px] text-axal-ink dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-100';

function useAct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, fallback) => {
    setBusy(true); setError('');
    try { await fn(); return true; } catch (e) { setError(refusalText(e, fallback)); return false; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

function Err({ text, testId }) {
  return text ? <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid={testId}>{text}</p> : null;
}

/** A + B: the call's terms, then its split by commitment, then Issue. Changing a term drops the preview. */
export function NewCallDialog({ apis, access, fund, onClose, onIssued }) {
  const [form, setForm] = useState({ amount: '', due: '', purpose: '' });
  const [terms, setTerms] = useState(null);
  const [preview, setPreview] = useState(null);
  const { busy, error, setError, run } = useAct();
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); setPreview(null); };
  const doPreview = async (e) => {
    e.preventDefault();
    const out = checkNewCall(form);
    if (out.error) { setError(out.error); return; }
    await run(async () => {
      const p = await apis.calls.preview(fund.id, out.cents);
      setTerms(out);
      setPreview({ ...p, amount_cents: out.cents });
    }, 'The split could not be previewed.');
  };
  const issue = () => run(async () => {
    // Exactly the amount and date whose split is on screen.
    await apis.calls.issue(fund.id, terms.cents, terms.purpose, terms.due);
    await onIssued(preview);
  }, 'The call could not be issued.');
  const rows = preview ? previewRows(preview) : [];
  const flagged = rows.filter((r) => r.flag).length;
  return (
    <Lightbox label="New capital call" title={preview ? `Preview · Call ${preview.next_call_number} · ${fund.name}` : 'New capital call'}
      sub={preview ? `${money(preview.amount_cents)} due ${terms.due}, shared by commitment.` : `${fund.name}. Nothing is written until the call is issued.`}
      testId="calls-new-dialog" onClose={onClose} width={560}>
      {!preview ? (
        <form className="flex flex-col gap-3 px-5 py-4" onSubmit={doPreview} data-testid="calls-new-form">
          <label className={LABEL}>Amount ($)<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.amount} onChange={set('amount')} disabled={busy} data-testid="calls-new-amount" /></label>
          <label className={LABEL}>Due date · required
            <input className={`${INPUT} mt-1`} type="date" value={form.due} onChange={set('due')} disabled={busy} data-testid="calls-new-due" />
            <span className="mt-1 block text-[11px] font-normal text-axal-muted dark:text-gray-400">Never filled in for you.</span>
          </label>
          <label className={LABEL}>Note<input className={`${INPUT} mt-1`} value={form.purpose} maxLength={500} onChange={set('purpose')} disabled={busy} placeholder="Optional" data-testid="calls-new-purpose" /></label>
          <Err text={error} testId="calls-new-error" />
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={BTN.primary} disabled={busy} data-testid="calls-new-preview">Preview</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 px-5 py-4" data-testid="calls-preview">
          {rows.length === 0 ? <p className="m-0 text-[12.5px]" data-testid="calls-preview-nobody">This fund has no committed or active LP with a commitment, so a call would bill nobody.</p> : <>
            <div className="divide-y divide-axal-hairline dark:divide-gray-800">
              {rows.map((r) => (
                <div key={r.lp_id} className="flex items-center justify-between gap-3 py-2" data-testid={`calls-preview-line-${r.lp_id}`}>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.name}{r.residual ? ' · carries the residual' : ''}</div>
                    <div className={`text-[11.5px] ${r.flag ? 'text-amber-700 dark:text-amber-300' : 'text-axal-muted dark:text-gray-400'}`}>{`${r.pct} of commitments${r.flag ? ` · ${r.flag}` : ''}`}</div>
                  </div>
                  <div className={`text-[12px] font-bold ${NUM}`}>{money(r.share_cents)}</div>
                </div>
              ))}
              <div className="flex justify-between py-2 text-[13px] font-extrabold"><span>Total</span><span className={NUM} data-testid="calls-preview-total">{money(rows.reduce((n, r) => n + Number(r.share_cents || 0), 0))}</span></div>
              <div className="flex justify-between py-2 text-[12.5px] text-axal-muted dark:text-gray-400"><span>Cents left over</span><span className={NUM}>{preview.residual_cents > 0 ? `${preview.residual_cents} cents, on the largest commitment` : '$0.00'}</span></div>
            </div>
            {flagged > 0 && <p className={INFO} data-testid="calls-preview-flagged">{`${plural(flagged, 'LP')} ${flagged === 1 ? 'has' : 'have'} no approved identity check. Their lines are flagged, not removed.`}</p>}
            {preview.excluded?.length > 0 && <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400">Not billed, for want of a recorded commitment: {preview.excluded.map(lpName).join(', ')}.</p>}
          </>}
          <Err text={error} testId="calls-issue-error" />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" className={BTN.ghost} onClick={() => setPreview(null)} disabled={busy} data-testid="calls-preview-back">Back</button>
            {rows.length > 0 && (
              <FundActControl access={access} act="capital_call.issue" testId="calls-preview-issue-refused" className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">
                <button type="button" className={BTN.primary} disabled={busy} onClick={issue} data-testid="calls-preview-issue">{`Issue call ${preview.next_call_number} to ${plural(rows.length, 'LP')}`}</button>
              </FundActControl>
            )}
          </div>
        </div>
      )}
    </Lightbox>
  );
}

/** E: a receipt against one LP's line. It records money already received. */
export function ReceiptDialog({ apis, fund, line, call, onClose, onDone }) {
  const [form, setForm] = useState({ which: 'full', amount: '', date: todayIso(), reference: '' });
  const { busy, error, setError, run } = useAct();
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); };
  const who = lpName(line);
  const submit = async (e) => {
    e.preventDefault();
    const out = receiptBody(form, line.outstanding_cents);
    if (out.error) { setError(out.error); return; }
    await run(async () => { await apis.calls.receipt(fund.id, line.id, out.body); await onDone(); }, 'The receipt could not be recorded.');
  };
  return (
    <Lightbox label="Record receipt" title={`Record receipt · ${who}${call?.call_number != null ? ` · Call ${call.call_number}` : ''}`}
      sub={`Outstanding on this line: ${money(line.outstanding_cents)}.`} testId="calls-receipt-dialog" onClose={onClose} width={480}>
      <form className="flex flex-col gap-3 px-5 py-4" onSubmit={submit} data-testid="calls-receipt-form">
        <label className="flex items-center gap-2 text-[12.5px]"><input type="radio" name="which" checked={form.which === 'full'} onChange={() => setForm((f) => ({ ...f, which: 'full' }))} data-testid="calls-receipt-full" />The full outstanding <span className={NUM}>{money(line.outstanding_cents)}</span></label>
        <label className="flex items-center gap-2 text-[12.5px]"><input type="radio" name="which" checked={form.which === 'other'} onChange={() => setForm((f) => ({ ...f, which: 'other' }))} data-testid="calls-receipt-other" />Another amount</label>
        {form.which === 'other' && <label className={LABEL}>Amount ($)<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.amount} onChange={set('amount')} disabled={busy} data-testid="calls-receipt-amount" /></label>}
        <label className={LABEL}>Received on<input className={`${INPUT} mt-1`} type="date" value={form.date} max={todayIso()} onChange={set('date')} disabled={busy} data-testid="calls-receipt-date" /></label>
        <label className={LABEL}>Reference<input className={`${INPUT} mt-1`} value={form.reference} maxLength={120} onChange={set('reference')} disabled={busy} placeholder="Optional" data-testid="calls-receipt-reference" /></label>
        <p className={INFO}>{RECEIPT_INFO}</p>
        <Err text={error} testId="calls-receipt-error" />
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={BTN.primary} disabled={busy} data-testid="calls-receipt-submit">Record receipt</button>
        </div>
      </form>
    </Lightbox>
  );
}

/**
 * D: one notice per LP, with the figures of the issued call. Preview reads
 * every line's notice and one digest; Issue sends that digest, all or none.
 * A line that cannot issue is L6: "This notice can't issue: …", and Issue is
 * replaced by why.
 */
export function CallNoticesDialog({ apis, access, call, onClose }) {
  const [page, setPage] = useState('letter');
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const { busy, error, run } = useAct();
  const names = new Map((call.lines || []).map((l) => [Number(l.id), lpName(l)]));
  const doPreview = () => run(async () => setPreview(await apis.notices.callPreview(call.uid)), 'The notices could not be previewed.');
  const issue = () => run(async () => setDone(await apis.notices.callIssue(call.uid, { page_size: page, digest: preview.digest })), 'The notices could not be issued.');
  const lines = preview?.lines || [];
  const refused = lines.filter((l) => l.refusal);
  return (
    <Lightbox label="Call notices" title={`Call notices · Call ${call.call_number}`} sub="One notice per LP, with the figures of the issued call."
      testId="calls-notices-dialog" onClose={onClose} width={540}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Page size">
          <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-muted">Page size</span>
          {PAGE_SIZES.map((p) => (
            <button key={p.key} type="button" role="radio" aria-checked={page === p.key} className={page === p.key ? BTN.primary : BTN.ghost}
              onClick={() => { setPage(p.key); setDone(null); }} disabled={busy} data-testid={`calls-notices-page-${p.key}`}>{p.label}</button>
          ))}
        </div>
        {preview && <div className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="calls-notices-preview">
          {lines.map((l) => (
            <div key={l.line_id} className="flex items-center justify-between gap-3 py-2" data-testid={`calls-notice-${l.line_id}`}>
              <div className="min-w-0">
                <div className="text-[13px] font-bold">{`Notice · ${names.get(Number(l.line_id)) || 'Name not recorded'}`}</div>
                {l.refusal && <div className="text-[11.5px] text-red-700 dark:text-red-300" data-testid={`calls-notice-refused-${l.line_id}`}>{refusedNotice(l.refusal)}</div>}
              </div>
              <div className={`text-[12px] font-semibold ${NUM}`}>{l.figures ? money(l.figures.amount_cents) : 'No figures'}</div>
            </div>
          ))}
        </div>}
        <p className={INFO}>{NOTICE_FINAL}</p>
        {done && <p role="status" className="m-0 text-[12.5px] text-axal-positive dark:text-emerald-300" data-testid="calls-notices-done">
          {done.already_issued ? 'These notices were already issued, with these figures.' : `${plural((done.notices || []).length, 'notice')} issued.`}
        </p>}
        <Err text={error} testId="calls-notices-error" />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={doPreview} disabled={busy} data-testid="calls-notices-preview-submit">Preview notices</button>
          {preview && !done && (refused.length
            ? <span className="text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid="calls-notices-blocked">
              <Pill tone="warn">Not issued</Pill> {`${plural(refused.length, 'notice')} can't issue, so none is issued until each can.`}</span>
            : <FundActControl access={access} act="fund_notice.issue" testId="calls-notices-issue-refused" className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">
              <button type="button" className={BTN.primary} onClick={issue} disabled={busy} data-testid="calls-notices-issue">Issue notices</button>
            </FundActControl>)}
        </div>
      </div>
    </Lightbox>
  );
}
