import { useState } from 'react';
import { Lightbox } from '../../../ui';
import { FundActControl, fundActRefusal } from '../../../lib/fundActs';
import { BTN, INPUT } from '../../account/AccountCenter';
import { COMM_KIND_LABELS } from '../../investor/fundLpCommsModel';
import { refusalText } from './fundAdminModel';
import { ADD_LP_NOTE, ADD_WITHOUT_CALL, FIRST_CALL_NOTE, LP_TYPES, LP_TYPE_LABELS, NOT_RECORDED, addLpBody } from './lpsModel';
import { NUM } from './parts';

/**
 * D1162 (#3069) — the LPs tab's dialogs, shared by FND5's row menu and FND6's
 * drawer. Each says what it changes and opens in-page, never a browser
 * pop-up; each act is the Worker's to decide, and one the act table refuses
 * this viewer is drawn as its sentence (`FundActControl`).
 */
const LABEL = 'text-[11.5px] font-semibold text-zinc-700 dark:text-gray-200';

function Form({ onSubmit, error, busy, submit, onClose, testId, children, disabled = false }) {
  return (
    <form className="flex flex-col gap-3 px-5 py-4" onSubmit={onSubmit} data-testid={testId}>
      {children}
      {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid={`${testId}-error`}>{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className={BTN.primary} disabled={busy || disabled} data-testid={`${testId}-submit`}>{submit}</button>
      </div>
    </form>
  );
}

const useAct = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, fallback) => {
    setBusy(true); setError('');
    try { await fn(); return true; } catch (e) { setError(refusalText(e, fallback)); return false; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
};

/**
 * Add LP (FND5a, FND5s). A first call is drawn only for a viewer the act table
 * lets issue one; an Admin reads its sentence in its place, never a disabled
 * field. The type is set after the LP is written, through the LP type route.
 */
export function AddLpDialog({ apis, access, funds, fundId, onClose, onAdded }) {
  const [form, setForm] = useState({ fundId: fundId || (funds.length === 1 ? String(funds[0].id) : ''), name: '', email: '', commitment: '', lpType: '', firstCall: '', firstDue: '' });
  const { busy, error, setError, run } = useAct();
  const [done, setDone] = useState(null);
  // The act table decides: a viewer it refuses adds the LP with no first call.
  const canIssue = !fundActRefusal(access, 'capital_call.issue');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const out = addLpBody(form, { canIssue });
    if (out.error) { setError(out.error); return; }
    await run(async () => {
      const res = await apis.lps.add(form.fundId, out.body);
      const id = res?.lp?.id;
      let typeNote = null;
      if (out.lpType && id) {
        try { await apis.lps.setType(form.fundId, id, out.lpType); } catch (err) { typeNote = `The LP was added; its type was not set: ${refusalText(err, 'the type could not be saved.')}`; }
      }
      setDone({ typeNote, firstCall: !!out.body.first_call_cents });
      onAdded?.();
    }, 'The LP could not be added.');
  };
  return (
    <Lightbox label="Add LP" title="Add LP" sub={ADD_LP_NOTE} testId="lps-add-dialog" onClose={onClose} width={520}>
      {done ? (
        <div className="flex flex-col gap-3 px-5 py-4" data-testid="lps-add-done">
          <p role="status" className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{done.firstCall ? 'The LP was added, and its first call was queued to issue.' : 'The LP was added.'}</p>
          {done.typeNote && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300">{done.typeNote}</p>}
          <div className="flex justify-end"><button type="button" className={BTN.primary} onClick={onClose} data-testid="lps-add-close">Close</button></div>
        </div>
      ) : (
        <Form onSubmit={submit} error={error} busy={busy} submit="Add LP" onClose={onClose} testId="lps-add-form">
          <label className={LABEL}>Fund
            <select className={`${INPUT} mt-1`} value={form.fundId} onChange={set('fundId')} disabled={busy} data-testid="lps-add-fund">
              <option value="">Choose a fund</option>
              {funds.map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
            </select>
          </label>
          <label className={LABEL}>LP name<input className={`${INPUT} mt-1`} value={form.name} onChange={set('name')} maxLength={200} disabled={busy} data-testid="lps-add-name" /></label>
          <label className={LABEL}>Email<input className={`${INPUT} mt-1`} type="email" value={form.email} onChange={set('email')} maxLength={320} disabled={busy} data-testid="lps-add-email" /></label>
          <label className={LABEL}>Commitment ($)<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.commitment} onChange={set('commitment')} disabled={busy} data-testid="lps-add-commitment" /></label>
          <label className={LABEL}>Type
            <select className={`${INPUT} mt-1`} value={form.lpType} onChange={set('lpType')} disabled={busy} data-testid="lps-add-type">
              <option value="">Not recorded</option>
              {LP_TYPES.map((t) => <option key={t} value={t}>{LP_TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400">The commitment date is recorded as the day the LP is added.</p>
          <FundActControl access={access} act="capital_call.issue" testId="lps-add-first-call-refused" className="block text-[12px] font-semibold text-axal-muted dark:text-gray-400">
            <label className={LABEL}>First capital call ($) · optional<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.firstCall} onChange={set('firstCall')} disabled={busy} data-testid="lps-add-first-call" /></label>
            {String(form.firstCall).trim() && (
              <label className={LABEL}>First call due date · required<input className={`${INPUT} mt-1`} type="date" value={form.firstDue} onChange={set('firstDue')} disabled={busy} data-testid="lps-add-first-due" /></label>
            )}
            <p className="m-0 rounded-axal-sm border border-axal-hairline bg-gray-50 px-3 py-2 text-[12px] text-axal-ink dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-100" data-testid="lps-add-first-call-note">{FIRST_CALL_NOTE}</p>
          </FundActControl>
          {!canIssue && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="lps-add-without-call">{ADD_WITHOUT_CALL}</p>}
        </Form>
      )}
    </Lightbox>
  );
}

/** Set LP type (`fund.write`): one of five, or Not recorded to clear it. */
export function LpTypeDialog({ apis, access, row, onClose, onChanged }) {
  const [lpType, setLpType] = useState(row.lp_type || '');
  const { busy, error, run } = useAct();
  const who = row.name || row.email || `LP ${row.limited_partner_id}`;
  const submit = async (e) => {
    e.preventDefault();
    if (await run(() => apis.lps.setType(row.fund_id, row.limited_partner_id, lpType || null), 'The type could not be saved.')) { onChanged?.(); onClose(); }
  };
  return (
    <Lightbox label="Set LP type" title="Set LP type" sub={`${who} · ${row.fund_name || NOT_RECORDED}. It changes how this LP is counted in the chart by type.`} testId="lps-type-dialog" onClose={onClose} width={440}>
      <FundActControl access={access} act="fund.write" testId="lps-type-refused" className="block px-5 py-4 text-[12px] font-semibold text-axal-muted">
        <Form onSubmit={submit} error={error} busy={busy} submit="Save type" onClose={onClose} testId="lps-type-form">
          <label className={LABEL}>Type
            <select className={`${INPUT} mt-1`} value={lpType} onChange={(e) => setLpType(e.target.value)} disabled={busy} data-testid="lps-type-select">
              <option value="">Not recorded</option>
              {LP_TYPES.map((t) => <option key={t} value={t}>{LP_TYPE_LABELS[t]}</option>)}
            </select>
          </label>
        </Form>
      </FundActControl>
    </Lightbox>
  );
}

/** Log a contact (`fund.write`): what was sent to this LP and when. The log keeps no message body. */
export function ContactDialog({ apis, access, row, onClose, onLogged }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ kind: 'update', subject: '', sentAt: today });
  const { busy, error, setError, run } = useAct();
  const who = row.name || row.email || `LP ${row.limited_partner_id}`;
  const submit = async (e) => {
    e.preventDefault();
    const subject = form.subject.trim();
    if (!subject || subject.length > 200) { setError('Give the subject of what was sent, up to 200 characters.'); return; }
    if (await run(() => apis.lps.logContact(row.fund_id, { lp_id: row.limited_partner_id, kind: form.kind, subject, sent_at: form.sentAt || undefined }), 'The contact could not be logged.')) {
      onLogged?.(); onClose();
    }
  };
  return (
    <Lightbox label="Log a contact" title="Log a contact" sub={`${who}: adds one line to this LP's contact log. It sends nothing.`} testId="lps-contact-dialog" onClose={onClose} width={460}>
      <FundActControl access={access} act="fund.write" testId="lps-contact-refused" className="block px-5 py-4 text-[12px] font-semibold text-axal-muted">
        <Form onSubmit={submit} error={error} busy={busy} submit="Log contact" onClose={onClose} testId="lps-contact-form">
          <label className={LABEL}>Kind
            <select className={`${INPUT} mt-1`} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} disabled={busy} data-testid="lps-contact-kind">
              {Object.entries(COMM_KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className={LABEL}>Subject<input className={`${INPUT} mt-1`} value={form.subject} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} disabled={busy} data-testid="lps-contact-subject" /></label>
          <label className={LABEL}>Sent on<input className={`${INPUT} mt-1`} type="date" max={today} value={form.sentAt} onChange={(e) => setForm((f) => ({ ...f, sentAt: e.target.value }))} disabled={busy} data-testid="lps-contact-sent" /></label>
        </Form>
      </FundActControl>
    </Lightbox>
  );
}

