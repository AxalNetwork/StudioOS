import React, { useEffect, useState } from 'react';
import { Lightbox } from '../../../ui';
import { api } from '../../../lib/api';
import { referralPartnersApi } from '../../../lib/api/referralPartners';
import { reportError } from '../../../lib/log';
import { ruleDraftOf, ruleEditInput } from '../../../lib/partnerEarnings';
import { RuleEditor } from '../AdminCommissions';
import { actionGhost, actionPrimary } from '../../../ui';
import { DIALOG_BODY, DIALOG_LINES, DialogButtons, Done, FIELD_LABEL, Field, INPUT, Refusal, SUB, Skeleton } from './parts';
import {
  CONTRACTS, FIRING_TRIGGERS, STEPS, TERMS_FOOT, TERMS_WORD, SEGMENT_ONE, contractLabel, formOf, partnerRefusal,
  stepOf, termsBody, termsInDialog, termsSentence,
} from './referralPartnersModel';

/**
 * D963 (#2796) — Referral partners' writes, each a dialog (N9) on part 5's
 * routes (D958): Custom terms (PG8), Approve, Send contract, End terms, and a
 * standard rule's edit. A refusal is one sentence in place, keyed on its code
 * (`partnerRefusal`); the result sits in the dialog. Approve is the Super
 * Admin's behind the step-up bar: `request()` opens the shared authenticator
 * prompt (`StepUpModal`) on `step_up_required` and retries once.
 *
 * NOT DRAWN in Custom terms: Studio, because terms are HQ's until #2376 and
 * part 3; and Payout method, because the partner picks it on each payout
 * request, and credits wait for OD6.
 */

/** One partner's terms, read for the dialog that acts on them. */
function usePartnerTerms(userId) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (userId == null) return undefined;
    let live = true;
    setRead({ status: 'loading', data: null });
    referralPartnersApi.partnerTerms(userId).then(
      (d) => { if (live) setRead(Array.isArray(d?.items) ? { status: 'ready', data: d } : { status: 'error', data: null }); },
      (e) => { reportError('admin-programs:partner-terms', e); if (live) setRead({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [userId, tick]);
  return { read, reload: () => setTick((t) => t + 1) };
}

function TermsUnreadable({ onRetry }) {
  return (
    <div className="flex flex-col gap-1" role="alert" data-testid="programs-terms-unreadable">
      <span className="text-[13px] font-bold text-red-700 dark:text-red-300">This partner’s terms could not be read. That is not the same as none.</span>
      <button type="button" onClick={onRetry} className="self-start text-[12px] font-semibold text-red-700 underline dark:text-red-300">Try again</button>
    </div>
  );
}

/** The five steps, the current one marked. */
function Steps({ state }) {
  const at = stepOf(state);
  return (
    <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Steps" data-testid="programs-terms-steps">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={at === i ? 'step' : undefined}
          className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${at === i
            ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300'
            : at !== null && i < at ? 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}>
          {`${i + 1}. ${s}`}
        </li>
      ))}
    </ol>
  );
}

/** Preview a contract template as PDF, in a new tab. */
function PreviewTemplate({ slug }) {
  const [state, setState] = useState('');
  const go = async () => {
    setState('reading');
    try {
      const r = await api.adminTemplateStorePreviewPdfBlob(slug);
      window.open(r.url, '_blank', 'noopener');
      setState('');
    } catch (e) {
      reportError('admin-programs:template-preview', e);
      setState('failed');
    }
  };
  return (
    <span className="flex flex-col gap-0.5">
      <button type="button" onClick={go} disabled={state === 'reading'} className="self-start text-[12.5px] font-bold text-axal-violet dark:text-violet-300" data-testid="programs-terms-preview">{state === 'reading' ? 'Reading…' : 'Preview'}</button>
      {state === 'failed' ? <span role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-300">The preview could not be drawn. Try again.</span> : null}
    </span>
  );
}

const RADIO = 'flex items-center gap-1.5 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100';

/** What pays: one row per trigger, a flat amount or a share, never both. */
function Triggers({ triggers, currency, onChange, disabled }) {
  const set = (i, patch) => onChange(triggers.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const free = FIRING_TRIGGERS.filter((t) => !triggers.some((g) => g.rule_key === t.key));
  return (
    <div className="flex flex-col gap-2" data-testid="programs-terms-triggers">
      <span className={FIELD_LABEL}>What pays</span>
      <span className={SUB}>Each trigger pays a flat amount or a share, never both. Terms pay only on a trigger an event fires today.</span>
      {triggers.map((g, i) => {
        const def = FIRING_TRIGGERS.find((t) => t.key === g.rule_key);
        return (
          <div key={g.rule_key} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`programs-terms-trigger-${g.rule_key}`}>
            <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{def?.label || g.rule_key}</span>
            <fieldset className="flex flex-wrap gap-4" disabled={disabled}>
              <legend className="sr-only">How it pays</legend>
              <label className={RADIO}><input type="radio" checked={g.kind !== 'share'} onChange={() => set(i, { kind: 'flat', value: '' })} data-testid={`programs-terms-trigger-${g.rule_key}-flat`} />Flat</label>
              <label className={`${RADIO} ${def?.flatOnly ? 'opacity-50' : ''}`}>
                <input type="radio" checked={g.kind === 'share'} disabled={def?.flatOnly} onChange={() => set(i, { kind: 'share', value: '' })} data-testid={`programs-terms-trigger-${g.rule_key}-share`} />Share
              </label>
            </fieldset>
            {def?.flatOnly ? <span className={SUB}>An identity check carries no amount, so it pays a flat amount.</span> : null}
            <input className={`${INPUT} w-40`} inputMode="decimal" value={g.value} disabled={disabled} onChange={(e) => set(i, { value: e.target.value })}
              aria-label={g.kind === 'share' ? 'Share, in percent' : `Amount, in ${currency}`} placeholder={g.kind === 'share' ? '%' : currency} data-testid={`programs-terms-trigger-${g.rule_key}-value`} />
            {triggers.length > 1 && !disabled ? <button type="button" className="self-start text-[12px] font-bold text-axal-violet dark:text-violet-300" onClick={() => onChange(triggers.filter((_, j) => j !== i))}>Remove</button> : null}
          </div>
        );
      })}
      {free.length && !disabled ? (
        <button type="button" className="self-start text-[12.5px] font-bold text-axal-violet dark:text-violet-300" onClick={() => onChange([...triggers, { rule_key: free[0].key, kind: 'flat', value: '' }])} data-testid="programs-terms-add-trigger">+ Add a trigger</button>
      ) : null}
      <span className={SUB} data-testid="programs-terms-triggers-foot">{`Triggers today: ${FIRING_TRIGGERS.map((t) => t.label).join(' · ')}. The other standard rules have no event that fires them yet.`}</span>
    </div>
  );
}

/**
 * Custom terms (PG8). The partner's newest draft opens to edit; live terms
 * open read only, with what their step allows; otherwise a new draft. Save
 * draft and Send to HQ for approval are an Admin's; Approve is the Super
 * Admin's; Send contract opens once HQ approves.
 */
export function TermsDialog({ partner, superAdmin, onClose, onChanged, onOpen }) {
  const { read, reload } = usePartnerTerms(partner.user_id);
  const [form, setForm] = useState(null);
  const [current, setCurrent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState('');
  const pick = read.status === 'ready' ? termsInDialog(read.data.items) : null;
  useEffect(() => {
    if (!pick) return;
    setCurrent(pick.terms);
    setForm(formOf(pick.terms));
    // Re-seed only when the read lands.
  }, [read.status, read.data]);
  const mode = current && current.state !== 'draft' ? 'read' : current ? 'edit' : 'new';
  const parsed = form ? termsBody(form) : { error: null };
  const sentence = mode !== 'read' && parsed.body ? termsSentence(partner.name, parsed.body) : (current ? termsSentence(partner.name, current) : null);
  const save = async (submit) => {
    if (!parsed.body) return;
    setBusy(true); setRefusal(''); setDone('');
    try {
      let saved = current?.uid
        ? await referralPartnersApi.editDraft(current.uid, parsed.body)
        : await referralPartnersApi.draft({ user_id: Number(partner.user_id), ...parsed.body });
      setCurrent(saved);
      if (submit) {
        saved = await referralPartnersApi.submit(saved.uid);
        setCurrent(saved);
        setDone('Sent to HQ for approval. The standard rules apply until the partner signs.');
      } else setDone('Saved as a draft. Nothing changes for the partner yet.');
      onChanged?.();
    } catch (e) {
      setRefusal(partnerRefusal(e, 'The terms were not saved. Try again.'));
    } finally { setBusy(false); }
  };
  const editable = mode !== 'read';
  const field = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));
  const sentToHq = current?.state === 'submitted';
  const label = `Custom terms · ${partner.name || 'this partner'}`;
  const next = !editable && current?.state === 'submitted' && superAdmin ? 'approve' : !editable && current?.state === 'approved' ? 'send' : null;
  const footer = (
    <div className="flex flex-col gap-2">
      <p className={`m-0 ${SUB}`} data-testid="programs-terms-foot">{TERMS_FOOT}</p>
      {done ? <Done testId="programs-terms-done">{done}</Done> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={actionGhost} onClick={onClose}>{done ? 'Close' : 'Back'}</button>
        {editable && !sentToHq ? (
          <>
            <button type="button" className={actionGhost} disabled={busy || !parsed.body} onClick={() => save(false)} data-testid="programs-terms-save">Save draft</button>
            <button type="button" className={actionPrimary} disabled={busy || !parsed.body} onClick={() => save(true)} data-testid="programs-terms-submit">{busy ? 'Saving…' : 'Send to HQ for approval'}</button>
          </>
        ) : null}
        {next ? (
          <button type="button" className={actionPrimary} onClick={() => onOpen(next, current)} data-testid={`programs-terms-${next}`}>{next === 'approve' ? 'Approve' : 'Send contract'}</button>
        ) : null}
      </div>
      <Refusal text={refusal || (editable && form && parsed.error ? parsed.error : '')} testId="programs-terms-refusal" />
    </div>
  );
  return (
    <Lightbox label={label} title={label} sub={`${SEGMENT_ONE[partner.segment] || partner.segment_label || ''}${partner.code ? ` · code ${partner.code}` : ''}`} onClose={onClose} width={640} testId="programs-terms-dialog" footer={footer}>
      <div className={DIALOG_BODY}>
        {read.status === 'loading' ? <Skeleton lines={4} testId="programs-terms-loading" /> : null}
        {read.status === 'error' ? <TermsUnreadable onRetry={reload} /> : null}
        {read.status === 'ready' && form ? (
          <>
            <Steps state={current?.state || 'draft'} />
            {current ? <span className={SUB} data-testid="programs-terms-state">{`Now: ${TERMS_WORD[current.state] || current.state}`}</span> : null}
            {editable && !sentToHq ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className={FIELD_LABEL}>Contract</span>
                  <select className={`${INPUT} w-full`} value={form.contract_slug} onChange={(e) => field('contract_slug')(e.target.value)} data-testid="programs-terms-contract">
                    {CONTRACTS.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                  </select>
                  <PreviewTemplate slug={form.contract_slug} />
                </label>
                <Triggers triggers={form.triggers} currency={form.currency} onChange={field('triggers')} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Cap per introduction · ${form.currency}, optional`} value={form.cap_per_intro} onChange={field('cap_per_intro')} testId="programs-terms-cap-intro" />
                  <Field label={`Overall cap · ${form.currency}, optional`} value={form.overall_cap} onChange={field('overall_cap')} testId="programs-terms-cap-all" />
                  <label className="flex flex-col gap-1">
                    <span className={FIELD_LABEL}>Starts</span>
                    <input type="date" className={`${INPUT} w-full`} value={form.starts_on} onChange={(e) => field('starts_on')(e.target.value)} data-testid="programs-terms-starts" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={FIELD_LABEL}>Ends · optional</span>
                    <input type="date" className={`${INPUT} w-full`} value={form.ends_on} onChange={(e) => field('ends_on')(e.target.value)} data-testid="programs-terms-ends" />
                  </label>
                  <Field label="Currency" value={form.currency} onChange={(v) => field('currency')(v.toUpperCase())} max={3} testId="programs-terms-currency" />
                  <Field label="Sectors · optional, comma separated" value={form.sectors} onChange={field('sectors')} testId="programs-terms-sectors" />
                </div>
              </>
            ) : (
              <ul className={DIALOG_LINES} data-testid="programs-terms-readonly">
                <li>{`The contract is ${contractLabel(current.contract_slug)}.`}</li>
                {current.sectors?.length ? <li>{`Sectors: ${current.sectors.join(', ')}.`}</li> : null}
                <li>{`These terms are ${String(TERMS_WORD[current.state] || current.state).toLowerCase()}, so they are read here, not edited.`}</li>
                {current.state === 'submitted' && !superAdmin ? <li>The Super Admin approves them.</li> : null}
              </ul>
            )}
            {sentence ? <p role="status" className="m-0 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3.5 py-2.5 text-[13px] font-semibold text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="programs-terms-sentence">{sentence}</p> : null}
          </>
        ) : null}
      </div>
    </Lightbox>
  );
}

/** A partner's terms in one state, for a dialog the row menu opened. */
function useTermsIn(partner, terms, states) {
  const { read, reload } = usePartnerTerms(terms ? null : partner?.user_id);
  if (terms) return { status: 'ready', terms, reload };
  if (read.status !== 'ready') return { status: read.status, terms: null, reload };
  return { status: 'ready', terms: read.data.items.find((t) => states.includes(t.state)) || null, reload };
}

/** Approve: the Super Admin's, behind the step-up bar (O-TERMS A). */
export function ApproveDialog({ terms, partner = null, onClose, onChanged }) {
  const found = useTermsIn(partner, terms, ['submitted']);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState('');
  const t = found.terms;
  const go = async () => {
    setBusy(true); setRefusal('');
    try {
      await referralPartnersApi.approve(t.uid);
      setDone('Approved. An admin can now send the contract for signature.');
      onChanged?.();
    } catch (e) {
      setRefusal(partnerRefusal(e, 'The terms were not approved. Try again.'));
    } finally { setBusy(false); }
  };
  const label = `Approve ${t?.partner_name || partner?.name || 'these'}’s terms?`;
  return (
    <Lightbox label={label} title={label} onClose={onClose} testId="programs-approve-dialog"
      footer={<DialogButtons onClose={onClose} action="Approve" busy={busy} disabled={!t} onAction={go} refusal={refusal} done={done} testId="programs-approve-go" />}>
      <div className={DIALOG_BODY}>
        {found.status === 'loading' ? <Skeleton lines={2} /> : null}
        {found.status === 'error' ? <TermsUnreadable onRetry={found.reload} /> : null}
        {found.status === 'ready' && !t ? <p className={`m-0 ${SUB}`}>No terms of this partner are waiting for HQ now.</p> : null}
        {t ? (
          <ul className={DIALOG_LINES} data-testid="programs-approve-lines">
            <li>{termsSentence(t.partner_name, t)}</li>
            <li>{`Sent on ${contractLabel(t.contract_slug)}.`}</li>
            <li>The terms take effect only once the partner signs. Until then the standard rules apply.</li>
            <li>Approving asks for your authenticator code.</li>
          </ul>
        ) : null}
      </div>
    </Lightbox>
  );
}

const pdfUrl = (b64) => {
  try {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  } catch { return null; }
};

/** Send contract: the preview first, then the send, which must match it (approved terms only). */
export function SendDialog({ terms = null, partner = null, onClose, onChanged }) {
  const found = useTermsIn(partner, terms, ['approved']);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState('');
  const t = found.terms;
  const look = async () => {
    setBusy(true); setRefusal('');
    try {
      const p = await referralPartnersApi.preview(t.uid, {});
      if (typeof p?.body_sha256 !== 'string') throw new Error('The preview did not come back.');
      setPreview({ ...p, url: p.pdf_base64 ? pdfUrl(p.pdf_base64) : null });
    } catch (e) {
      setRefusal(partnerRefusal(e, 'The contract could not be previewed. Nothing was sent.'));
    } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setRefusal('');
    try {
      await referralPartnersApi.send(t.uid, { preview_sha256: preview.body_sha256, template_version: preview.template_version, provider: 'native' });
      setDone('Sent for signature. The terms take effect once the partner signs.');
      onChanged?.();
    } catch (e) {
      setRefusal(partnerRefusal(e, 'The contract was not sent. Check Agreements before you try again.'));
    } finally { setBusy(false); }
  };
  const label = `Send ${t?.partner_name || partner?.name || 'the partner'} the contract?`;
  return (
    <Lightbox label={label} title={label} onClose={onClose} testId="programs-send-dialog"
      footer={<DialogButtons onClose={onClose} action={preview ? 'Send for signature' : 'Preview the contract'} busy={busy} disabled={!t}
        onAction={preview ? send : look} refusal={refusal} done={done} testId="programs-send-go" />}>
      <div className={DIALOG_BODY}>
        {found.status === 'loading' ? <Skeleton lines={2} /> : null}
        {found.status === 'error' ? <TermsUnreadable onRetry={found.reload} /> : null}
        {found.status === 'ready' && !t ? <p className={`m-0 ${SUB}`} data-testid="programs-send-none">This partner has no approved terms to send.</p> : null}
        {t ? (
          <ul className={DIALOG_LINES} data-testid="programs-send-lines">
            <li>{termsSentence(t.partner_name, t)}</li>
            <li>{`The contract is ${contractLabel(t.contract_slug)}, sent to the partner on record.`}</li>
            <li>Preview it first. The send must match the preview.</li>
          </ul>
        ) : null}
        {preview?.url ? <a href={preview.url} target="_blank" rel="noopener noreferrer" className="self-start text-[13px] font-bold text-axal-violet underline dark:text-violet-300" data-testid="programs-send-preview-link">Open the preview</a> : null}
      </div>
    </Lightbox>
  );
}

/** End terms: signed or active terms, with a reason of 10 characters or more. */
export function EndTermsDialog({ partner, onClose, onChanged }) {
  const found = useTermsIn(partner, null, ['active', 'signed']);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState('');
  const t = found.terms;
  const go = async () => {
    setBusy(true); setRefusal('');
    try {
      await referralPartnersApi.end(t.uid, reason.trim());
      setDone('Ended. The standard rules apply to this partner from now on.');
      onChanged?.();
    } catch (e) {
      setRefusal(partnerRefusal(e, 'The terms were not ended. Try again.'));
    } finally { setBusy(false); }
  };
  const label = `End ${partner?.name || 'this partner'}’s terms?`;
  return (
    <Lightbox label={label} title={label} onClose={onClose} testId="programs-endterms-dialog"
      footer={<DialogButtons onClose={onClose} action="End terms" tone="danger" busy={busy} disabled={!t || reason.trim().length < 10} onAction={go} refusal={refusal} done={done} testId="programs-endterms-go" />}>
      <div className={DIALOG_BODY}>
        {found.status === 'loading' ? <Skeleton lines={2} /> : null}
        {found.status === 'error' ? <TermsUnreadable onRetry={found.reload} /> : null}
        {found.status === 'ready' && !t ? <p className={`m-0 ${SUB}`}>This partner has no signed terms to end.</p> : null}
        {t ? (
          <>
            <ul className={DIALOG_LINES} data-testid="programs-endterms-lines">
              <li>{termsSentence(t.partner_name, t)}</li>
              <li>Commissions already earned under them stay as they are. From now on the standard rules apply.</li>
            </ul>
            <Field label="Reason · at least 10 characters" value={reason} onChange={setReason} max={2000} rows={3} testId="programs-endterms-reason" />
          </>
        ) : null}
      </div>
    </Lightbox>
  );
}

/** A standard rule's edit, for a Super Admin: Commissions' `RuleEditor`, in a dialog. */
export function RuleDialog({ rule, onClose, onChanged }) {
  const [draft, setDraft] = useState(() => ruleDraftOf(rule));
  const [stage, setStage] = useState('edit');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState('');
  const confirm = async () => {
    const parsed = ruleEditInput(draft);
    if (!parsed.body) return;
    setBusy(true); setRefusal('');
    try {
      await api.adminUpdateCommissionRule(rule.rule_key, parsed.body);
      setDone('Saved. Milestones that fire from now on accrue under the rule as saved.');
      onChanged?.();
    } catch (e) {
      setRefusal(partnerRefusal(e, 'The rule was not saved. Try again.'));
      setStage('edit');
    } finally { setBusy(false); }
  };
  const label = `Edit ${rule.rule_key}`;
  return (
    <Lightbox label={label} title={label} onClose={onClose} testId="programs-rule-dialog"
      footer={<DialogButtons onClose={onClose} refusal={refusal} done={done} testId="programs-rule-go" />}>
      <div className={DIALOG_BODY}>
        {done ? null : (
          <RuleEditor rule={rule} stage={stage} draft={draft} busy={busy}
            onDraft={(p) => setDraft((d) => ({ ...d, ...p }))} onReview={() => setStage('confirm')} onConfirm={confirm} onCancel={onClose} />
        )}
      </div>
    </Lightbox>
  );
}
