import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Pill } from '../../../ui';
import { FundActControl } from '../../../lib/fundActs';
import { BTN, INPUT } from '../../account/AccountCenter';
import { refusalText } from './fundAdminModel';
import { ConfirmAct, Effects, FlowReceipt, FlowSteps, NotOffered } from './MoneyFlow';
import { actButton, actGate, callConsequences, callEffects, receiptEffects } from './moneyFlowModel';
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

/**
 * D4812 part 2 (FA-03): New capital call as the money flow. Prepare (A: the
 * terms), Review (B: the split and the exact effect), Confirm + Authenticate
 * (C: what issuing does, the authenticator code, "Issue $X capital call"),
 * Receipt (D: the server's answer). Changing a term drops the preview. An
 * Admin reviews and reads the act table's sentence where Continue would be;
 * an unread act table stops the flow before Confirm (FA-05d).
 */
export function NewCallDialog({ apis, access, fund, summary = null, onClose, onIssued }) {
  const [form, setForm] = useState({ amount: '', due: '', purpose: '' });
  const [terms, setTerms] = useState(null);
  const [preview, setPreview] = useState(null);
  const [step, setStep] = useState('prepare');
  const [result, setResult] = useState(null);
  const { busy, error, setError, run } = useAct();
  const gate = actGate(access, 'capital_call.issue');
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); setPreview(null); };
  const doPreview = async (e) => {
    e.preventDefault();
    const out = checkNewCall(form);
    if (out.error) { setError(out.error); return; }
    await run(async () => {
      const p = await apis.calls.preview(fund.id, out.cents);
      setTerms(out);
      setPreview({ ...p, amount_cents: out.cents });
      setStep('review');
    }, 'The split could not be previewed.');
  };
  const issue = () => run(async () => {
    // Exactly the amount and date whose split is on screen.
    const out = await apis.calls.issue(fund.id, terms.cents, terms.purpose, terms.due);
    setResult(out || {});
    setStep('receipt');
    await onIssued(preview);
  }, 'The call could not be issued.');
  const rows = preview ? previewRows(preview) : [];
  const flagged = rows.filter((r) => r.flag).length;
  const label = actButton('Issue', preview?.amount_cents, 'capital call');
  const nothingCommitted = summary && Number(summary.committed_cents) === 0;
  const at = { prepare: 0, review: 1, confirm: 3, receipt: 4 }[step];
  const title = { prepare: 'New capital call', review: `Review · Call ${preview?.next_call_number ?? ''} · ${fund.name}`, confirm: 'Confirm and authenticate', receipt: 'Capital call issued' }[step];
  return (
    <Lightbox label="New capital call" title={title}
      sub={step === 'prepare' ? `${fund.name}. Nothing is written until the call is issued.` : `${money(preview?.amount_cents)} due ${terms?.due}, shared by commitment.`}
      testId="calls-new-dialog" onClose={onClose} width={600}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <FlowSteps at={at} skipAuth={false} />
        {step === 'prepare' && (nothingCommitted ? (
          <p className="m-0 rounded-axal-sm border border-axal-hairline px-3 py-2.5 text-[13px]" data-testid="calls-new-no-commitments">
            <span aria-hidden="true">○ </span><strong>{fund.name} has no committed capital.</strong> A capital call needs commitments.{' '}
            <Link className="font-bold text-axal-violet-deep underline dark:text-violet-300" to={`/admin/fund-admin/lps?add=1&fund=${fund.id}`} data-testid="calls-new-add-lps">Add LPs</Link> first.
          </p>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={doPreview} data-testid="calls-new-form">
            <label className={LABEL}>Amount ($)<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.amount} onChange={set('amount')} disabled={busy} data-testid="calls-new-amount" /></label>
            <label className={LABEL}>Due date · required
              <input className={`${INPUT} mt-1`} type="date" value={form.due} onChange={set('due')} disabled={busy} data-testid="calls-new-due" />
              <span className="mt-1 block text-[12px] font-normal text-axal-muted dark:text-gray-400">Never filled in for you.</span>
            </label>
            <label className={LABEL}>Note<input className={`${INPUT} mt-1`} value={form.purpose} maxLength={500} onChange={set('purpose')} disabled={busy} placeholder="Optional" data-testid="calls-new-purpose" /></label>
            <Err text={error} testId="calls-new-error" />
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className={BTN.primary} disabled={busy} data-testid="calls-new-preview">Preview</button>
            </div>
          </form>
        ))}
        {step === 'review' && (
          <div className="flex flex-col gap-3" data-testid="calls-preview">
            {rows.length === 0 ? <p className="m-0 text-[12.5px]" data-testid="calls-preview-nobody">This fund has no committed or active LP with a commitment, so a call would bill nobody.</p> : <>
              <Effects rows={callEffects({ fund, terms, preview, rows, summary })} testId="calls-effects" />
              <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">Previewed by the Worker; split pro rata by commitment.</p>
              <details data-testid="calls-preview-lines">
                <summary className="min-h-[44px] cursor-pointer py-2 text-[13px] font-bold text-axal-violet-deep sm:min-h-0 dark:text-violet-300">{`See the ${plural(rows.length, 'line')}`}</summary>
                <div className="divide-y divide-axal-hairline dark:divide-gray-800">
                  {rows.map((r) => (
                    <div key={r.lp_id} className="flex items-center justify-between gap-3 py-2" data-testid={`calls-preview-line-${r.lp_id}`}>
                      <div className="min-w-0">
                        <div className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.name}{r.residual ? ' · carries the residual' : ''}</div>
                        <div className={`text-[12px] ${r.flag ? 'text-amber-700 dark:text-amber-300' : 'text-axal-muted dark:text-gray-400'}`}>{`${r.pct} of commitments${r.flag ? ` · ${r.flag}` : ''}`}</div>
                      </div>
                      <div className={`text-[13px] font-bold ${NUM}`}>{money(r.share_cents)}</div>
                    </div>
                  ))}
                  <div className="flex justify-between py-2 text-[13px] font-extrabold"><span>Total</span><span className={NUM} data-testid="calls-preview-total">{money(rows.reduce((n, r) => n + Number(r.share_cents || 0), 0))}</span></div>
                  <div className="flex justify-between py-2 text-[12.5px] text-axal-muted dark:text-gray-400"><span>Cents left over</span><span className={NUM}>{preview.residual_cents > 0 ? `${preview.residual_cents} cents, on the largest commitment` : '$0.00'}</span></div>
                </div>
              </details>
              {flagged > 0 && <p className={INFO} data-testid="calls-preview-flagged">{`${plural(flagged, 'LP')} ${flagged === 1 ? 'has' : 'have'} no approved identity check. Their lines are flagged, not removed.`}</p>}
              {preview.excluded?.length > 0 && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">Not billed, for want of a recorded commitment: {preview.excluded.map(lpName).join(', ')}.</p>}
            </>}
            <Err text={error} testId="calls-issue-error" />
            {rows.length > 0 && gate.state !== 'allowed' && <NotOffered gate={gate} testId="calls-preview-issue-refused" />}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" className={BTN.ghost} onClick={() => { setPreview(null); setStep('prepare'); }} disabled={busy} data-testid="calls-preview-back">Back to edit</button>
              {rows.length > 0 && gate.state === 'allowed' && (
                <button type="button" className={BTN.primary} disabled={busy} onClick={() => { setError(''); setStep('confirm'); }} data-testid="calls-preview-continue">Continue to confirm</button>
              )}
            </div>
          </div>
        )}
        {step === 'confirm' && (
          <FundActControl access={access} act="capital_call.issue" testId="calls-confirm-refused" className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">
            <ConfirmAct apis={apis} needsCode testId="calls-confirm" label={label} busy={busy} error={error} run={issue}
              consequences={[`${label} to ${plural(rows.length, 'LP')} of ${fund.name}.`, ...callConsequences({ fund, terms, preview, rows })]}
              onBack={() => setStep('review')} />
          </FundActControl>
        )}
        {step === 'receipt' && (
          <FlowReceipt testId="calls-receipt-flow" onDone={onClose} doneLabel="Done" rows={[
            ['Call', `Call ${result?.call?.call_number ?? preview?.next_call_number ?? ''} · ${fund.name}`],
            ['Amount', `${money(preview?.amount_cents)} across ${plural(Number(result?.lines_written ?? rows.length), 'line')}`],
            ['Due', result?.due_date || terms?.due],
            ['Notices', 'Not issued yet: issue them from Call notices.'],
            ['Audit', 'Recorded as capital_call.issue'],
          ]} />
        )}
      </div>
    </Lightbox>
  );
}

/**
 * E, as the money flow (D4812 part 2): Prepare the receipt, Review its effect
 * on the line, Confirm with "Record $X receipt", Receipt. Recording a receipt
 * is an Admin's act, so Authenticate is not required and says so.
 */
export function ReceiptDialog({ apis, fund, line, call, onClose, onDone }) {
  const [form, setForm] = useState({ which: 'full', amount: '', date: todayIso(), reference: '' });
  const [step, setStep] = useState('prepare');
  const [body, setBody] = useState(null);
  const { busy, error, setError, run } = useAct();
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); };
  const who = lpName(line);
  const toReview = (e) => {
    e.preventDefault();
    const out = receiptBody(form, line.outstanding_cents);
    if (out.error) { setError(out.error); return; }
    setError(''); setBody(out.body); setStep('review');
  };
  const record = () => run(async () => { await apis.calls.receipt(fund.id, line.id, body); setStep('receipt'); await onDone(); }, 'The receipt could not be recorded.');
  const label = actButton('Record', body?.amount_cents, 'receipt');
  const at = { prepare: 0, review: 1, confirm: 2, receipt: 4 }[step];
  return (
    <Lightbox label="Record receipt" title={`Record receipt · ${who}${call?.call_number != null ? ` · Call ${call.call_number}` : ''}`}
      sub={`Outstanding on this line: ${money(line.outstanding_cents)}.`} testId="calls-receipt-dialog" onClose={onClose} width={520}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <FlowSteps at={at} skipAuth testId="receipt-steps" />
        {step === 'prepare' && (
          <form className="flex flex-col gap-3" onSubmit={toReview} data-testid="calls-receipt-form">
            <label className="flex min-h-[44px] items-center gap-2 text-[13px] sm:min-h-0"><input type="radio" name="which" checked={form.which === 'full'} onChange={() => setForm((f) => ({ ...f, which: 'full' }))} data-testid="calls-receipt-full" />The full outstanding <span className={NUM}>{money(line.outstanding_cents)}</span></label>
            <label className="flex min-h-[44px] items-center gap-2 text-[13px] sm:min-h-0"><input type="radio" name="which" checked={form.which === 'other'} onChange={() => setForm((f) => ({ ...f, which: 'other' }))} data-testid="calls-receipt-other" />Another amount</label>
            {form.which === 'other' && <label className={LABEL}>Amount ($)<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.amount} onChange={set('amount')} disabled={busy} data-testid="calls-receipt-amount" /></label>}
            <label className={LABEL}>Received on<input className={`${INPUT} mt-1`} type="date" value={form.date} max={todayIso()} onChange={set('date')} disabled={busy} data-testid="calls-receipt-date" /></label>
            <label className={LABEL}>Reference<input className={`${INPUT} mt-1`} value={form.reference} maxLength={120} onChange={set('reference')} disabled={busy} placeholder="Optional" data-testid="calls-receipt-reference" /></label>
            <p className={INFO}>{RECEIPT_INFO}</p>
            <Err text={error} testId="calls-receipt-error" />
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className={BTN.primary} disabled={busy} data-testid="calls-receipt-submit">Review</button>
            </div>
          </form>
        )}
        {step === 'review' && (
          <div className="flex flex-col gap-3" data-testid="calls-receipt-review">
            <Effects rows={receiptEffects({ line, call, body })} testId="receipt-effects" />
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN.ghost} onClick={() => setStep('prepare')} data-testid="calls-receipt-back">Back to edit</button>
              <button type="button" className={BTN.primary} onClick={() => setStep('confirm')} data-testid="calls-receipt-continue">Continue to confirm</button>
            </div>
          </div>
        )}
        {step === 'confirm' && (
          <ConfirmAct apis={apis} needsCode={false} testId="calls-receipt-confirm" label={label} busy={busy} error={error} run={record}
            consequences={[`${label} from ${who}${call?.call_number != null ? ` on call ${call.call_number}` : ''}.`, 'It records money already received; it moves no money.']}
            onBack={() => setStep('review')} />
        )}
        {step === 'receipt' && (
          <FlowReceipt testId="calls-receipt-done" onDone={onClose} rows={[
            ['LP', who],
            ['Amount', money(body?.amount_cents)],
            ['Received on', body?.received_on],
            ['Audit', 'Recorded as capital_call.receipt'],
          ]} />
        )}
      </div>
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
          <span className="text-[11px] font-extrabold uppercase tracking-[.09em] text-axal-muted">Page size</span>
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
                {l.refusal && <div className="text-[12px] text-red-700 dark:text-red-300" data-testid={`calls-notice-refused-${l.line_id}`}>{refusedNotice(l.refusal)}</div>}
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
