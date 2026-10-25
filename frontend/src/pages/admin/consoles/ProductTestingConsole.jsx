import React, { useCallback, useEffect, useState } from 'react';
import { adminTestingApi } from '../../../lib/api/productTesting';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { Lightbox, Pill } from '../../../ui';
import { ConsoleUnreadable, CONSOLE_LOADING } from './shared';
import ProgrammeForm from '../../testing/ProgrammeForm';
import ProgrammeApplicants from '../../testing/ProgrammeApplicants';
import {
  ROLE_OPTIONS, byStatus, datesLine, hqSteps, isEditable, placesLine, refusalText, statusLabel, statusTone,
} from '../../testing/programmeModel';

/**
 * HQ › Product testing — `/admin/platform/product-testing` (D815 board D5, #2261).
 * Super Admin only, as D812's `/api/admin/testing` routes are.
 *
 *   · Waiting for approval: a partner's submitted programmes, each with Approve
 *     and "Send back", which needs a reason (the partner reads it in the bell
 *     and on the programme).
 *   · Every programme, by status, with Open and Close as D812 allows them.
 *   · HQ's own: "New programme" for an Axal VC product, with the same form and
 *     the same Pick screen as a partner's.
 */
const btnCls = 'inline-flex items-center gap-1 rounded-md border border-[#dcd9e3] bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';
const primaryCls = 'inline-flex items-center gap-1 rounded-md bg-axal-violet px-3 py-1.5 text-xs font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400';
const cardCls = 'rounded-xl border border-[#dcd9e3] bg-white p-4 dark:border-gray-800 dark:bg-gray-950';
const inputCls = 'mt-1 w-full rounded-md border border-[#dcd9e3] bg-white px-2.5 py-1.5 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const muted = 'text-axal-muted dark:text-gray-400';
const FORM_CLASSES = { input: inputCls, button: primaryCls };
const STEP_LABEL = { approve: 'Approve', reject: 'Send back', open: 'Open', close: 'Close' };
const roleNames = (roles) => (Array.isArray(roles) ? roles : [])
  .map((r) => ROLE_OPTIONS.find(([k]) => k === r)?.[1] || r).join(', ') || 'No role chosen';

export const PRODUCT_TESTING_HOLDER_ONLY = 'Product testing is reviewed by the Super Admin.';

export function ProductTestingPanel({ api = adminTestingApi }) {
  const holder = isSuperAdminUser(useAuth().user);
  if (!holder) {
    return <p className="p-6 text-sm text-gray-700 dark:text-gray-300" data-testid="product-testing-holder-only">{PRODUCT_TESTING_HOLDER_ONLY}</p>;
  }
  return <ProductTestingConsole api={api} />;
}

const NONE = { kind: null, programme: null };

export function ProductTestingConsole({ api = adminTestingApi }) {
  const [state, setState] = useState({ status: 'loading', items: [] });
  // { kind: 'new' | 'edit' | 'applicants' | 'reject', programme }
  const [dialog, setDialog] = useState(NONE);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => Promise.resolve()
    .then(() => api.programmes())
    .then((r) => setState({ status: 'ready', items: Array.isArray(r?.items) ? r.items : [] }))
    .catch(() => setState({ status: 'unreadable', items: [] })), [api]);
  useEffect(() => { load(); }, [load]);
  const close = useCallback(() => { setDialog(NONE); setReason(''); }, []);

  async function step(p, which, note) {
    setBusy(`${p.uid}:${which}`);
    setNotice(null);
    try {
      if (which === 'approve') await api.approve(p.uid);
      else if (which === 'reject') await api.reject(p.uid, note);
      else if (which === 'open') await api.open(p.uid);
      else await api.close(p.uid);
      setNotice({ ok: true, text: {
        approve: `${p.product_name} is approved. Open it when it should take applications.`,
        reject: `${p.product_name} was sent back to ${p.owner_name || 'its owner'}.`,
        open: `${p.product_name} is open to applications.`,
        close: `${p.product_name} is closed.`,
      }[which] });
      close();
      await load();
    } catch (e) {
      setNotice({ ok: false, text: refusalText(e, 'Axal could not change this programme. Try again.') });
    } finally {
      setBusy(null);
    }
  }

  async function save(payload) {
    if (dialog.kind === 'edit') await api.edit(dialog.programme.uid, payload);
    else await api.create(payload);
    setNotice({ ok: true, text: `${payload.product_name} is saved as a draft. Open it when it should take applications.` });
    close();
    await load();
  }

  if (state.status === 'loading') return <p className={`p-6 text-sm ${muted}`}>{CONSOLE_LOADING}</p>;
  if (state.status === 'unreadable') return <ConsoleUnreadable what="Testing programmes" onRetry={load} />;

  const waiting = state.items.filter((p) => p.status === 'submitted' && p.owner_kind === 'partner');
  const groups = byStatus(state.items);

  const actions = (p) => (
    <div className="flex flex-wrap gap-2">
      {hqSteps(p).map((which) => (
        <button key={which} type="button" disabled={busy === `${p.uid}:${which}`}
          className={which === 'approve' || which === 'open' ? primaryCls : btnCls}
          onClick={() => (which === 'reject' ? setDialog({ kind: 'reject', programme: p }) : step(p, which))}
          data-testid={`testing-${which}-${p.uid}`}>
          {STEP_LABEL[which]}
        </button>
      ))}
      {p.owner_kind === 'hq' && isEditable(p) && (
        <button type="button" className={btnCls} onClick={() => setDialog({ kind: 'edit', programme: p })}
          data-testid={`testing-edit-${p.uid}`}>Edit</button>
      )}
      {p.owner_kind === 'hq' && (
        <button type="button" className={btnCls} onClick={() => setDialog({ kind: 'applicants', programme: p })}
          data-testid={`testing-applicants-${p.uid}`}>Applicants</button>
      )}
    </div>
  );

  const row = (p, detail) => (
    <li key={p.uid} className={cardCls} data-testid={`testing-programme-${p.uid}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-bold">{p.product_name}</span>
            <Pill tone={statusTone(p.status)}>{statusLabel(p.status)}</Pill>
            <span className={`text-[12px] ${muted}`}>{p.owner_kind === 'hq' ? 'Axal VC' : (p.owner_name || 'Partner not recorded')}</span>
          </div>
          <p className={`mt-1 text-[12px] ${muted}`}>
            {placesLine(p)} · {p.applicant_count} {p.applicant_count === 1 ? 'applicant' : 'applicants'} · {datesLine(p)}
          </p>
          {detail && (
            <div className="mt-2 space-y-1 text-[12.5px]">
              {p.summary && <p>{p.summary}</p>}
              {p.tester_tasks && <p><span className="font-semibold">What testers do:</span> {p.tester_tasks}</p>}
              {p.time_needed && <p><span className="font-semibold">Time needed:</span> {p.time_needed}</p>}
              <p><span className="font-semibold">Who can apply:</span> {roleNames(p.eligible_roles)}</p>
              {(p.questions || []).length > 0 && (
                <ol className="ml-4 list-decimal">{p.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
              )}
            </div>
          )}
          {p.status === 'rejected' && p.review_note && <p className="mt-1 text-[12px] text-red-700 dark:text-red-300">Sent back: {p.review_note}</p>}
        </div>
        {actions(p)}
      </div>
    </li>
  );

  return (
    <div className="space-y-6 p-4" data-testid="product-testing-console">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Product testing</h2>
          <p className={`text-[12.5px] ${muted}`}>A partner&rsquo;s programme opens once you approve it. Testers hear from the owner through Axal VC Mail.</p>
        </div>
        <button type="button" className={primaryCls} onClick={() => { setNotice(null); setDialog({ kind: 'new', programme: null }); }}
          data-testid="testing-new-programme">New programme</button>
      </div>
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} data-testid="testing-notice"
          className={`text-[12.5px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
          {notice.text}
        </p>
      )}

      <section data-testid="testing-waiting">
        <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Waiting for approval · {waiting.length}</h3>
        {waiting.length === 0
          ? <p className={`text-[12.5px] ${muted}`} data-testid="testing-waiting-empty">No programme is waiting for approval.</p>
          : <ul className="space-y-2">{waiting.map((p) => row(p, true))}</ul>}
      </section>

      <section data-testid="testing-all">
        <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-[.09em] text-axal-faint">All programmes</h3>
        {groups.length === 0 ? (
          <p className={`text-[12.5px] ${muted}`} data-testid="testing-all-empty">No testing programmes yet. Start one for an Axal VC product with New programme.</p>
        ) : groups.map((g) => (
          <div key={g.status} className="mb-4" data-testid={`testing-group-${g.status}`}>
            <h4 className={`mb-1 text-[12px] font-bold ${muted}`}>{g.label} · {g.items.length}</h4>
            <ul className="space-y-2">{g.items.map((p) => row(p, false))}</ul>
          </div>
        ))}
      </section>

      {(dialog.kind === 'new' || dialog.kind === 'edit') && (
        <Lightbox label={dialog.kind === 'edit' ? 'Edit programme' : 'New programme'} onClose={close} testId="testing-form-dialog"
          title={dialog.kind === 'edit' ? `Edit ${dialog.programme.product_name}` : 'New programme for an Axal VC product'}
          sub="Saved as a draft. Open it when it should take applications.">
          <ProgrammeForm programme={dialog.kind === 'edit' ? dialog.programme : null} onSave={save} onCancel={close} classes={FORM_CLASSES} />
        </Lightbox>
      )}
      {dialog.kind === 'applicants' && (
        <Lightbox label="Applicants" onClose={close} testId="testing-applicants-dialog" title={dialog.programme.product_name} sub="Applicants" width={720}>
          <ProgrammeApplicants uid={dialog.programme.uid} classes={FORM_CLASSES} onChanged={load}
            api={{ applicants: api.applicants, pick: api.pick, decline: api.decline }} />
        </Lightbox>
      )}
      {dialog.kind === 'reject' && (
        <Lightbox label="Send back" onClose={close} testId="testing-reject-dialog" title={`Send back ${dialog.programme.product_name}`}
          sub="The partner reads your reason in the bell and on the programme, then edits it and submits again.">
          <label className="block text-[12px] font-semibold">
            What should change?
            <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} data-testid="testing-reject-reason" />
          </label>
          <div className="mt-3 flex gap-2">
            <button type="button" className={primaryCls} disabled={!reason.trim() || busy !== null}
              onClick={() => { if (reason.trim()) step(dialog.programme, 'reject', reason.trim()); }} data-testid="testing-reject-send">Send back</button>
            <button type="button" className={btnCls} onClick={close}>Cancel</button>
          </div>
        </Lightbox>
      )}
    </div>
  );
}
