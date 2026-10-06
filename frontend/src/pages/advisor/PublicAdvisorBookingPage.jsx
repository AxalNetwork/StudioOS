import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuthSync';
import { Card } from '../../ui';
import { AdvisorDetail } from '../AdvisorsPage';
import { AdvisorProfileView } from './AdvisorProfilePage';
import { LINK_SLUG } from './practice/practiceTools';

/** D573: the approved A5 profile and existing directory booking dialog. */
export default function PublicAdvisorBookingPage() {
  const { '*': rawSlug = '' } = useParams();
  const slug = LINK_SLUG.test(rawSlug) ? rawSlug : '';
  const { user } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', advisor: null });
  const [booking, setBooking] = useState(null);
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setState({ status: 'loading', advisor: null });
    try {
      const res = await api.openAdvisorBookingLink(slug);
      setState({ status: 'ready', advisor: { ...res.advisor,
        session_types: [res.session_type], booking_links: [{ ...res.link, is_active: true }] } });
    } catch (e) {
      setState({ status: e?.status === 404 || e?.status === 409 ? 'unavailable' : 'unreadable', advisor: null });
    }
  }, [slug, user?.id]);
  useEffect(() => { load(); }, [load]);
  const book = (type, link) => {
    if (!user) { navigate(`/login?next=${encodeURIComponent(`/b/${slug}`)}`); return; }
    if (!['founder', 'admin'].includes(user.role) && !(user.role === 'exploring' && Number(user.spinout_lab_active) === 1)) {
      setNotice('Booking is available to founders and active Lab participants.'); return;
    }
    setBooking({ type, link });
  };
  if (state.status === 'unavailable') return <Card padding="lg">
    <h1 className="text-lg font-bold">This booking link is unavailable</h1>
    <p className="mt-2 text-sm text-axal-muted">It may be disabled, restricted to a cohort, or waiting for a bookable session type and payout account.</p>
    {!user && <button className="mt-3 text-emerald-700 underline dark:text-emerald-300" onClick={() => navigate(`/login?next=${encodeURIComponent(`/b/${slug}`)}`)}>Sign in to check cohort access</button>}
  </Card>;
  return <>
    {notice && <p role="status" className="mb-3 text-sm text-axal-muted">{notice}</p>}
    <AdvisorProfileView state={state} onRetry={load} onBook={book} />
    {booking && <AdvisorDetail advisor={state.advisor} sessionType={booking.type} bookingLinkSlug={booking.link.slug}
      onClose={() => setBooking(null)} onBooked={() => { setBooking(null); setNotice('Your booking request was recorded.'); }} />}
  </>;
}
