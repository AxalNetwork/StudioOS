/**
 * D6001 (#6001) — Customer research's recruiting pipeline controls, as the
 * Validate v2 Discovery and ICP canvas draws them (V26, VAP26B, VAP28):
 * Add a lead beside Record a session, Move stage on each row, and the
 * Waitlist leads panel the card's "Invite the N new waitlist leads" lands on.
 *
 * Nothing here reads on its own: `defs/validate.jsx` hands every read and
 * write in. Each control is drawn only for a writer (`parts.can_write`); a
 * partner reads the list with no controls. A failed waitlist read says so
 * and never draws the panel as empty.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import FormLightbox from './FormLightbox';
import { addLead, moveStageForm } from './forms';

/** The table's Add a lead, a dialog over the page (Customer research's `/new` stays Record a session). */
export function addLeadButton(ctx, write) {
  if (!ctx?.canWrite || !ctx.projectId || typeof ctx.openDialog !== 'function') return null;
  const close = () => ctx.openDialog(null);
  return {
    text: 'Add a lead',
    onClick: () => ctx.openDialog(
      <FormLightbox key={`add-lead-${ctx.projectId}`} form={addLead} cycle="validate" slug="customer-research" moduleName="Customer research"
        onSubmit={(values) => addLead.submit(write, ctx.projectId, values)}
        onSaved={() => { close(); ctx.reload?.(); }} onClose={close} />,
    ),
  };
}

/** A row's Move stage; null for a row with no record of its own, or for a reader. */
export function moveStageAction(row, ctx, act) {
  if (!ctx?.canWrite || !ctx.projectId || row?.recordId == null || typeof ctx.openDialog !== 'function') return null;
  const form = moveStageForm(row);
  const close = () => ctx.openDialog(null);
  return {
    text: 'Move stage',
    label: `Move stage for ${row.name || 'this interview'}`,
    onClick: () => ctx.openDialog(
      <FormLightbox key={`move-${row.recordId}`} form={form} cycle="validate" slug="customer-research" moduleName="Customer research"
        onSubmit={(values) => act(ctx.projectId, row.recordId, form.toBody(values))}
        onSaved={() => { close(); ctx.reload?.(); }} onClose={close} />,
    ),
  };
}

const STATUS = { new: 'New', invited: 'Invited', followed_up: 'Followed up', promoted: 'Promoted' };
/** One sign-up's words and its one next step, by the CRM status the Worker sends. */
export function waitlistRow(s) {
  const status = Object.hasOwn(STATUS, s?.crm_status) ? s.crm_status : 'new';
  const interview = s?.promoted_interview_id != null ? Number(s.promoted_interview_id) : null;
  return {
    id: s?.id,
    who: (typeof s?.name === 'string' && s.name.trim()) || s?.email || 'Not recorded',
    email: s?.email ?? null,
    status: STATUS[status],
    next: status === 'promoted' ? (interview ? 'open' : null) : status === 'new' ? 'invite' : 'follow_up',
    interview,
  };
}

const BTN = 'inline-flex min-h-11 items-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-violet-deep hover:bg-axal-lavender disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-violet-300 dark:hover:bg-violet-900/30';

/**
 * The customer waitlist's sign-ups, each with Invite or Follow up (the routes
 * Spin-out Lab's page already calls) or, once promoted, its interview. New
 * counts in Lead and Invited or Followed up in Invited, as the card's funnel counts them.
 */
export function WaitlistLeads({ projectId, load, invite, followUp, canWrite = false, projectSearch = '' }) {
  const { hash } = useLocation();
  const [read, setRead] = useState({ status: 'loading', rows: [] });
  const [busy, setBusy] = useState(null);
  const [notes, setNotes] = useState({});
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let alive = true;
    // A re-read after an Invite keeps the rows on screen; only the first read says Reading.
    setRead((r) => ({ ...r, status: r.status === 'ready' ? 'ready' : 'loading' }));
    Promise.resolve().then(load).then((data) => {
      if (alive) setRead({ status: 'ready', rows: (Array.isArray(data?.signups) ? data.signups : []).map(waitlistRow) });
    }).catch(() => { if (alive) setRead({ status: 'unreadable', rows: [] }); });
    return () => { alive = false; };
    // `load` is handed in fresh on each render of the page; the venture and Try again are what re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tries]);

  useEffect(() => {
    if (hash === '#waitlist-leads' && read.status !== 'loading' && typeof document !== 'undefined') document.getElementById('waitlist-leads')?.scrollIntoView?.({ block: 'start' });
  }, [hash, read.status]);

  const run = async (row, send, done) => {
    setBusy(row.id);
    setNotes((n) => ({ ...n, [row.id]: null }));
    try {
      const out = await send(row.id);
      setNotes((n) => ({ ...n, [row.id]: { ok: true, text: out?.email_sent === false ? `${done}. The email was not delivered: email is not set up.` : done } }));
      setTries((t) => t + 1);
    } catch (e) {
      setNotes((n) => ({ ...n, [row.id]: { ok: false, text: e?.message || 'Not sent. Try again.' } }));
    } finally { setBusy(null); }
  };

  return (
    <section id="waitlist-leads" className="flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="waitlist-leads">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[14.5px] font-extrabold text-axal-ink dark:text-gray-100">
          Waitlist leads{read.status === 'ready' ? ` · ${read.rows.length}` : ''}
        </h2>
        <span className="text-[12px] text-axal-muted dark:text-gray-400">New counts in Lead · Invited and Followed up count in Invited</span>
      </div>
      {read.status === 'loading' && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" aria-busy="true">Reading the waitlist…</p>}
      {read.status === 'unreadable' && (
        <div role="alert" className="flex flex-col items-start gap-1.5 text-[12.5px] text-axal-ink dark:text-gray-200" data-testid="waitlist-leads-unreadable">
          <b>The waitlist couldn’t be read.</b>
          <span>Nothing here is shown as empty. The interview list still works.</span>
          <button type="button" className={BTN} onClick={() => setTries((t) => t + 1)}>Try again</button>
        </div>
      )}
      {read.status === 'ready' && read.rows.length === 0 && (
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">No one has signed up to the customer waitlist yet.</p>
      )}
      {read.status === 'ready' && read.rows.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {read.rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-ground pt-2 first:border-t-0 first:pt-0 dark:border-gray-800" data-testid="waitlist-lead">
              <div className="min-w-0">
                <b className="block truncate text-[13px] text-axal-ink dark:text-gray-100">{row.who}</b>
                {row.email && row.email !== row.who && <small className="block truncate text-[11.5px] text-axal-muted dark:text-gray-400">{row.email}</small>}
              </div>
              <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-200">{row.status}</span>
              {row.next === 'open' && <Link className={BTN} to={`/validate/customer-research/${row.interview}${projectSearch}`}>Open interview →</Link>}
              {canWrite && row.next === 'invite' && (
                <button type="button" className={BTN} disabled={busy != null} onClick={() => run(row, invite, 'Invited')}>{busy === row.id ? 'Sending…' : 'Invite'}</button>
              )}
              {canWrite && row.next === 'follow_up' && (
                <button type="button" className={BTN} disabled={busy != null} onClick={() => run(row, followUp, 'Followed up')}>{busy === row.id ? 'Sending…' : 'Follow up'}</button>
              )}
              {notes[row.id] && <p role={notes[row.id].ok ? 'status' : 'alert'} className={`m-0 w-full text-[12px] ${notes[row.id].ok ? 'text-axal-muted dark:text-gray-400' : 'text-red-700 dark:text-red-300'}`}>{notes[row.id].text}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
