import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { Field, SaveNote, buttonClass, ghostButtonClass, inputClass } from '../expertise/kit';
import { SESSION_OUTCOMES, outcomeBody } from './practiceTools';

/**
 * #4712 (D4712): the confirmed-session actions on the mounted Sessions page.
 *
 * Complete, no-show and cancel lived only in the retired Engagements tab
 * (`advisory/EngagementsPage.jsx`), and the page that replaced it pointed users
 * there while carrying none of the controls, so a confirmed session could never
 * be closed from a mounted Practice page. This is the same three actions over
 * the SAME worker routes (`/bookings/:id/complete | no-show | cancel`), nothing
 * new: no booking or payment rail is rebuilt here.
 *
 * A confirmed session only. The worker refuses anything else, and the form says
 * so by not drawing for it. After "held" the session is reviewable under
 * Delivery.
 */
export default function SessionLifecycle({ booking, onChanged }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('complete');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  if (booking.status !== 'confirmed') return null;

  const submit = async (e) => {
    e.preventDefault();
    const res = outcomeBody(outcome, note);
    if (res.error) { setResult({ ok: false, text: res.error }); return; }
    setBusy(true); setResult(null);
    try {
      if (outcome === 'complete') await api.completeAdvisorBooking(booking.id);
      else if (outcome === 'no_show') await api.noShowAdvisorBooking(booking.id, res.note || undefined);
      else await api.cancelAdvisorBooking(booking.id, res.note);
      setOpen(false); setNote('');
      await onChanged?.(`“${booking.topic || 'Session'}” ${SESSION_OUTCOMES[outcome].done}.`);
    } catch (err) {
      setResult({ ok: false, text: err?.message || 'That could not be recorded. Nothing was changed.' });
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button type="button" className={`${ghostButtonClass} mt-2`} data-testid={`lifecycle-open-${booking.id}`}
        onClick={() => setOpen(true)}>
        What happened?
      </button>
    );
  }
  const spec = SESSION_OUTCOMES[outcome];
  return (
    <form onSubmit={submit} data-testid={`lifecycle-form-${booking.id}`}
      className="mt-2 rounded-[10px] border border-axal-hairline p-3 text-left dark:border-gray-700">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What happened to this session">
        {Object.entries(SESSION_OUTCOMES).map(([key, o]) => (
          <button key={key} type="button" role="radio" aria-checked={outcome === key}
            data-testid={`lifecycle-${key}-${booking.id}`}
            className={outcome === key ? buttonClass : ghostButtonClass}
            onClick={() => { setOutcome(key); setResult(null); }}>
            {o.label}
          </button>
        ))}
      </div>
      {spec.reason && (
        <div className="mt-2">
          <Field label={outcome === 'cancel' ? 'Why (the client is told)' : 'Note (optional)'}>
            <textarea className={inputClass} rows={2} value={note} data-testid={`lifecycle-note-${booking.id}`}
              onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
        {outcome === 'complete'
          ? 'Marks the session held. You can then review it under Delivery.'
          : outcome === 'no_show' ? 'Records that the client did not attend.' : 'Cancels the session and tells the client.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="submit" className={buttonClass} disabled={busy}>{busy ? 'Saving…' : `Record: ${spec.label}`}</button>
        <button type="button" className={ghostButtonClass} onClick={() => { setOpen(false); setResult(null); }}>Close</button>
      </div>
      <SaveNote note={result} />
    </form>
  );
}
