// D567 / E3: only the signed-in member's own registration is read or cancelled.
import React, { useCallback, useEffect, useState } from 'react';
import { events } from '../../lib/api';
import { recorded } from '../../pages/events/eventOrganiserModel';
export default function MemberRegistrationPanel({ eventId, refreshKey }) {
  const [registration, setRegistration] = useState(null);
  const [eligibility, setEligibility] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [detail, preview] = await Promise.all([events.get(eventId), events.eligibility(eventId)]);
      if (!detail || (detail.registration !== null && typeof detail.registration?.status !== 'string') || typeof preview?.eligible !== 'boolean') throw new Error('Registration response is incomplete.');
      setRegistration(detail.registration); setEligibility(preview); setApprovalRequired(Boolean(detail.event?.approval_required));
    } catch (e) { setError(e.message || 'Your registration could not be read.'); }
    finally { setLoading(false); }
  }, [eventId]);
  useEffect(() => { load(); }, [load, refreshKey]);
  async function cancel() {
    setBusy(true); setError('');
    try { await events.cancelRegistration(eventId); await load(); }
    catch (e) { setError(e.message || 'Cancellation could not be saved.'); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" aria-label="My registration">
    <h2 className="font-semibold">My registration</h2>
    {loading ? <p role="status">Loading…</p> : error ? <p role="alert">Unreadable — {error}</p> : <>
      <p>{eligibility?.eligible ? 'Eligible' : 'Not eligible'}: {eligibility?.reason}</p>
      {registration ? <><p>Status: {registration.status === 'registered' && approvalRequired ? 'Pending approval' : registration.status}</p>{registration.status === 'waitlisted' && <p>Waitlist place: {recorded(registration.waitlist_position, 'your waitlist place is absent')}</p>}{registration.status === 'declined' && <p>{recorded(registration.decision_reason, 'no decline reason was supplied')}</p>}{!['cancelled', 'declined'].includes(registration.status) && <button disabled={busy} className="mt-3 rounded-lg border px-3 py-2 text-sm" onClick={cancel}>Cancel registration</button>}</> : <p>You have not registered for this event.</p>}
    </>}
  </section>;
}
