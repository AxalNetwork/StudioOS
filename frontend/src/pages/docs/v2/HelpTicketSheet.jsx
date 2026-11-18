// D6861 (#6861) — HC7 and HC13D of the Help Center v2 canvas (D4957): one
// sheet, opened from a guide's "What next", a search that found nothing,
// Still stuck? or a phone's Need help?. It asks first what kind of help this
// is, because the two go to different places:
//
//   Ordinary ticket   POST /api/tickets (`api.createTicket`), exactly as the
//                     ticket page files one. It may be mirrored to a public
//                     tracker and takes no attachments, and the sheet says so
//                     before Submit.
//   Security concern  POST /api/help/security-reports (`securityReportsApi`,
//                     D1075), the same report the Trust Center files: private,
//                     HQ's security team only, five in 24 hours, refused on a
//                     branch. It never becomes a ticket.
//
// Neither contract changes. A refusal shows the Worker's own sentence.
// Signed out, the sheet is not offered: both endpoints need a member.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { api } from '../../../lib/api';
import { securityReportsApi } from '../../../lib/api/trustContent';
import { TICKET_CATEGORIES } from '../../../lib/ticketCategories';
import { TICKET_PRIORITIES, TICKET_TYPES, formErrors } from '../../../lib/ticketScreens';
import { reportError } from '../../../lib/log';

const LABEL = 'font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-gray-500 dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-gray-200 bg-white px-3 py-2.5 text-[13.5px] text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const BUTTON = 'inline-flex min-h-[40px] items-center justify-center rounded-[9px] border border-gray-200 bg-white px-3.5 text-[13px] font-semibold text-gray-700 hover:border-violet-200 hover:text-violet-700 disabled:cursor-wait disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:text-violet-300';
const PRIMARY = 'inline-flex min-h-[40px] items-center justify-center rounded-[9px] border border-violet-600 bg-violet-600 px-4 text-[13px] font-bold text-white hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60';

export const SECURITY_AFFECTED_MAX = 200;
export const SECURITY_TEXT_MAX = 5000;
export const SECURITY_PER_DAY = 5;
export const ADVISORY_URL = 'https://github.com/AxalNetwork/StudioOS/security/advisories/new';
export const SECURITY_EMAIL = 'security@axal.vc';

/** What the sheet says once `POST /api/tickets` answers: filed, and whether it reached the public tracker. */
export function ticketFiledOutcome(res) {
  const id = res?.id ?? null;
  return { id, mirrored: res?.github_sync_status === 'synced' };
}

/** The security form's own checks, the Worker's limits (`services/securityReports.ts`). */
export function securityErrors(form) {
  const errors = {};
  const affected = String(form?.affected || '').trim();
  const what = String(form?.what || '').trim();
  if (!affected || affected.length > SECURITY_AFFECTED_MAX) errors.affected = `Say what is affected: a page or a feature, up to ${SECURITY_AFFECTED_MAX} characters.`;
  if (!what || what.length > SECURITY_TEXT_MAX) errors.what = 'Describe what happened, up to 5,000 characters.';
  if (String(form?.how || '').trim().length > SECURITY_TEXT_MAX) errors.how = 'How to reproduce it is at most 5,000 characters.';
  return errors;
}

function KindChoice({ kind, onKind }) {
  const option = (id, title, text) => (
    <label className={`flex min-h-[44px] cursor-pointer gap-3 rounded-xl border px-3.5 py-3 ${kind === id
      ? 'border-violet-500 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/40'
      : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'}`}
    >
      <input type="radio" name="help-sheet-kind" value={id} checked={kind === id} onChange={() => onKind(id)} className="mt-1 accent-violet-600" data-testid={`help-sheet-kind-${id}`} />
      <span className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">
        <b className="block text-[13.5px] text-gray-900 dark:text-gray-100">{title}</b>
        {text}
      </span>
    </label>
  );
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className={`${LABEL} mb-1.5`}>What kind of help?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {option('ticket', 'Ordinary ticket', 'May be mirrored to a public tracker. No attachments. Do not paste secrets or confidential records.')}
        {option('security', 'Security concern', 'Private. Read only by HQ’s security team and you. Never becomes a ticket.')}
      </div>
    </fieldset>
  );
}

function Done({ title, text, children }) {
  return (
    <div className="grid gap-3" data-testid="help-sheet-done">
      <div role="status" className="flex gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[13px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        <span aria-hidden="true" className="font-bold">✓</span>
        <span><b>{title}</b> {text}</span>
      </div>
      {children}
    </div>
  );
}

function Refused({ text }) {
  return (
    <p role="alert" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12.5px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" data-testid="help-sheet-refused">
      <span aria-hidden="true" className="font-bold">✕</span>
      <span>{text}</span>
    </p>
  );
}

/**
 * The sheet's body, without the reads: `state` is { kind, ticket, security,
 * errors, busy, failed, done }. Exported so a test can draw every state.
 */
export function HelpTicketSheetView({ from, state, onKind, onTicket, onSecurity, onSubmit, onClose }) {
  const { kind, ticket, security, errors, busy, failed, done } = state;
  const heading = from ? 'Get help with this guide' : 'Get help';
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-gray-200 px-5 pb-3.5 pt-4 dark:border-gray-800">
        <div className="flex items-center justify-between gap-3">
          <span className={LABEL}>{from ? `From ${from.title}` : 'Help Center'}</span>
          <button type="button" onClick={onClose} aria-label={from ? 'Close, back to the guide' : 'Close'} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
            <X size={18} aria-hidden />
          </button>
        </div>
        <h2 id="help-sheet-title" className="mt-0.5 text-[19px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{heading}</h2>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {done ? (
          done.kind === 'security' ? (
            <Done title="Sent privately." text="Only HQ’s security team reads it.">
              <p className="text-[12.5px] text-gray-600 dark:text-gray-300">It stays private and never becomes a ticket.</p>
            </Done>
          ) : (
            <Done title={done.id ? `Ticket #${done.id} filed.` : 'Ticket filed.'} text={ticket.title}>
              {!done.mirrored && (
                <p className="text-[12.5px] text-gray-600 dark:text-gray-300" data-testid="help-sheet-not-mirrored">
                  <b>Not mirrored.</b> Not copied to the public tracker yet. Nothing to do.
                </p>
              )}
              <Link to={done.id ? `/help/tickets/${done.id}` : '/help/tickets'} className={`${BUTTON} self-start`}>
                {done.id ? `Open ticket #${done.id}` : 'Your tickets'}
              </Link>
            </Done>
          )
        ) : (
          <>
            <KindChoice kind={kind} onKind={onKind} />
            {kind === 'ticket' ? (
              <>
                <div className="grid gap-1.5">
                  <label htmlFor="help-sheet-title-field" className="text-[12.5px] font-bold text-gray-800 dark:text-gray-200">Title</label>
                  <input id="help-sheet-title-field" value={ticket.title} maxLength={200} onChange={(e) => onTicket({ title: e.target.value })} aria-invalid={!!errors.title} className={FIELD} />
                  {errors.title && <span className="text-[12px] text-red-700 dark:text-red-300">{errors.title}</span>}
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="help-sheet-description" className="text-[12.5px] font-bold text-gray-800 dark:text-gray-200">Description</label>
                  <textarea id="help-sheet-description" rows={5} value={ticket.description} onChange={(e) => onTicket({ description: e.target.value })} className={FIELD} />
                  {from && <span className="text-[11.5px] text-gray-500 dark:text-gray-400">Only the guide’s link and your own words were carried over. Edit freely.</span>}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <fieldset className="m-0 grid gap-1.5 border-0 p-0">
                    <legend className="mb-1.5 text-[12.5px] font-bold text-gray-800 dark:text-gray-200">Type</legend>
                    <div role="radiogroup" aria-label="Type" className="flex rounded-[9px] border border-gray-200 p-0.5 dark:border-gray-700">
                      {TICKET_TYPES.map((t) => (
                        <button key={t.id} type="button" role="radio" aria-checked={ticket.type === t.id} onClick={() => onTicket({ type: t.id })}
                          className={`min-h-[36px] flex-1 rounded-[7px] px-2 text-[12.5px] font-semibold ${ticket.type === t.id ? 'bg-violet-600 text-white' : 'text-gray-700 hover:text-violet-700 dark:text-gray-300 dark:hover:text-violet-300'}`}
                        >{t.label}</button>
                      ))}
                    </div>
                    {errors.type && <span className="text-[12px] text-red-700 dark:text-red-300">{errors.type}</span>}
                  </fieldset>
                  <div className="grid gap-1.5">
                    <label htmlFor="help-sheet-priority" className="text-[12.5px] font-bold text-gray-800 dark:text-gray-200">Priority</label>
                    <select id="help-sheet-priority" value={ticket.priority} onChange={(e) => onTicket({ priority: e.target.value })} className={FIELD}>
                      {TICKET_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <label htmlFor="help-sheet-category" className="text-[12.5px] font-bold text-gray-800 dark:text-gray-200">Category <span className="font-normal text-gray-500 dark:text-gray-400">· optional</span></label>
                    <select id="help-sheet-category" value={ticket.category} onChange={(e) => onTicket({ category: e.target.value })} className={FIELD}>
                      <option value="">No category</option>
                      {TICKET_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
                <p role="note" className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <span aria-hidden="true">▲</span>
                  <span><b>Before you submit:</b> this ticket and its replies may be mirrored to a public tracker, and attachments are not supported. Do not paste secrets, passwords or confidential records.</span>
                </p>
              </>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <label htmlFor="help-sheet-affected" className="text-[12.5px] font-bold text-gray-800 dark:text-gray-200">What is affected</label>
                  <input id="help-sheet-affected" value={security.affected} maxLength={SECURITY_AFFECTED_MAX} onChange={(e) => onSecurity({ affected: e.target.value })} aria-describedby="help-sheet-affected-count" aria-invalid={!!errors.affected} className={FIELD} />
                  <span id="help-sheet-affected-count" className="flex justify-between font-mono text-[11px] text-gray-500 dark:text-gray-400"><span>A page or a feature</span><span>{security.affected.length} / {SECURITY_AFFECTED_MAX}</span></span>
                  {errors.affected && <span className="text-[12px] text-red-700 dark:text-red-300">{errors.affected}</span>}
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="help-sheet-what" className="text-[12.5px] font-bold text-gray-800 dark:text-gray-200">What happened</label>
                  <textarea id="help-sheet-what" rows={4} maxLength={SECURITY_TEXT_MAX} value={security.what} onChange={(e) => onSecurity({ what: e.target.value })} aria-invalid={!!errors.what} className={FIELD} />
                  {errors.what && <span className="text-[12px] text-red-700 dark:text-red-300">{errors.what}</span>}
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="help-sheet-how" className="text-[12.5px] font-bold text-gray-800 dark:text-gray-200">How to reproduce <span className="font-normal text-gray-500 dark:text-gray-400">· optional</span></label>
                  <textarea id="help-sheet-how" rows={3} maxLength={SECURITY_TEXT_MAX} value={security.how} onChange={(e) => onSecurity({ how: e.target.value })} placeholder="Steps, if you know them" className={FIELD} />
                </div>
                <p className="flex gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[12.5px] text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
                  <span aria-hidden="true">🔒</span>
                  <span>Sent privately to HQ’s security team. At most {SECURITY_PER_DAY} reports in 24 hours.</span>
                </p>
                <p className="text-[12px] text-gray-500 dark:text-gray-400">
                  Other ways: <a href={ADVISORY_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-violet-700 underline dark:text-violet-300">private security advisory on the code host ↗</a> · <a href={`mailto:${SECURITY_EMAIL}`} className="font-semibold text-violet-700 underline dark:text-violet-300">{SECURITY_EMAIL}</a>
                </p>
              </>
            )}
            {failed && (
              kind === 'ticket'
                ? <Refused text={`The ticket was not filed. Your title and description are kept. ${failed}`} />
                : <Refused text={failed} />
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-3.5 dark:border-gray-800">
        <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
          {done ? '' : kind === 'ticket' ? 'Opens /help/tickets/<id> once filed' : 'Never becomes a ticket'}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={BUTTON}>{done ? 'Close' : 'Cancel'}</button>
          {!done && (
            <button type="submit" disabled={busy} className={PRIMARY} data-testid="help-sheet-submit">
              {busy ? (kind === 'ticket' ? 'Submitting…' : 'Sending…') : (kind === 'ticket' ? 'Submit ticket' : 'Send privately')}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

const freshState = (initial) => ({
  kind: initial?.kind === 'security' ? 'security' : 'ticket',
  ticket: { title: initial?.title || '', description: initial?.description || '', type: '', priority: 'medium', category: '' },
  security: { affected: '', what: '', how: '' },
  errors: {},
  busy: false,
  failed: null,
  done: null,
});

/**
 * The sheet. `initial` is { kind, from: { anchor, title } | null, title,
 * description }; a new `initial` starts a new draft. Esc closes it, focus is
 * held inside while it is open and returns to what opened it.
 */
export default function HelpTicketSheet({ initial, onClose }) {
  const [state, setState] = useState(() => freshState(initial));
  const panelRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => { setState(freshState(initial)); }, [initial]);

  useEffect(() => {
    openerRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    panelRef.current?.querySelector('input, textarea, button')?.focus?.();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const els = [...panelRef.current.querySelectorAll('a[href], button:not([disabled]), input, select, textarea')];
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      openerRef.current?.focus?.();
    };
  }, [onClose]);

  const patch = (key) => (values) => setState((s) => ({ ...s, [key]: { ...s[key], ...values }, failed: null }));

  const submit = async () => {
    if (state.kind === 'ticket') {
      const errors = formErrors(state.ticket);
      setState((s) => ({ ...s, errors }));
      if (Object.keys(errors).length) return;
      setState((s) => ({ ...s, busy: true, failed: null }));
      try {
        const t = state.ticket;
        const res = await api.createTicket({
          title: t.title.trim(), description: t.description.trim() || undefined, type: t.type, priority: t.priority,
          ...(t.category ? { category: t.category } : {}),
        });
        setState((s) => ({ ...s, busy: false, done: { kind: 'ticket', ...ticketFiledOutcome(res) } }));
      } catch (e) {
        reportError('HelpCenter:sheet-ticket', e);
        setState((s) => ({ ...s, busy: false, failed: e?.message || 'Try again in a moment.' }));
      }
      return;
    }
    const errors = securityErrors(state.security);
    setState((s) => ({ ...s, errors }));
    if (Object.keys(errors).length) return;
    setState((s) => ({ ...s, busy: true, failed: null }));
    try {
      const r = state.security;
      await securityReportsApi.send({
        affected: r.affected.trim(), what_happened: r.what.trim(), ...(r.how.trim() ? { how_to_reproduce: r.how.trim() } : {}),
      });
      setState((s) => ({ ...s, busy: false, done: { kind: 'security' } }));
    } catch (e) {
      reportError('HelpCenter:sheet-security', e);
      setState((s) => ({ ...s, busy: false, failed: e?.message || 'The report was not sent. Try again in a moment.' }));
    }
  };

  return (
    <div className="fixed inset-0 z-50" data-testid="help-sheet">
      <div className="absolute inset-0 bg-gray-950/40 dark:bg-black/60" aria-hidden="true" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-sheet-title"
        className="absolute inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-2xl border border-gray-200 bg-white shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[580px] md:rounded-none md:border-y-0 md:border-r-0 dark:border-gray-800 dark:bg-gray-900"
      >
        <span aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-300 md:hidden dark:bg-gray-700" />
        <HelpTicketSheetView
          from={initial?.from || null}
          state={state}
          onKind={(kind) => setState((s) => ({ ...s, kind, errors: {}, failed: null }))}
          onTicket={patch('ticket')}
          onSecurity={patch('security')}
          onSubmit={submit}
          onClose={onClose}
        />
      </aside>
    </div>
  );
}
