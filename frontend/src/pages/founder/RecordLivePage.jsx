import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useActiveRecording, useNow } from '../../contexts/ActiveRecordingContext';
import { useAuth } from '../../hooks/useAuthSync';
import { prefersReducedMotion } from '../../components/discovery/RingViz';
import RecordingView from './RecordingView';

/**
 * `/validate/record/live` (D685 §5.6.2, #1588): the Recording View full screen,
 * at every width, bound to the app's one recording. `?session=<id>` names the
 * session for a reload or a deep link; with no active recording for it, the
 * session's own page opens instead.
 *
 * × "Exit full screen" goes back to where the founder was and leaves the
 * recording running: the pill keeps it in the corner (`RecordingPill.jsx`).
 * When processing finishes here, the founder lands on the session's review.
 */

/** Where the live route sends a request it cannot serve. */
export function liveRedirect(state, sessionParam) {
  const sid = state?.session?.id;
  const asked = sessionParam ? String(sessionParam) : null;
  if (state?.phase === 'discarded') return '/validate/interviews';
  if (sid != null && (!asked || asked === String(sid))) return state.phase === 'ready' ? `/validate/session/${encodeURIComponent(sid)}` : null;
  if (asked && /^\d+$/.test(asked)) return `/validate/session/${asked}`;
  return '/validate';
}

function useDarkTheme() {
  const read = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const [dark, setDark] = useState(read);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const o = new MutationObserver(() => setDark(read()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => o.disconnect();
  }, []);
  return dark ? 'dark' : 'light';
}

export default function RecordLivePage() {
  const { state, recorder } = useActiveRecording();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth() || {};
  const theme = useDarkTheme();
  const now = useNow(state.phase === 'recording');
  const to = liveRedirect(state, params.get('session'));
  if (to) return <Navigate to={to} replace state={state.phase === 'ready' ? { interview: state.interview } : undefined} />;

  // Back to the page before the lightbox; with no history (a deep link), to Validate.
  const exit = () => {
    const idx = typeof window !== 'undefined' ? window.history.state?.idx : 0;
    if (location.key !== 'default' && idx > 0) navigate(-1); else navigate('/validate', { replace: true });
  };

  return (
    <RecordingView st={state} now={now} theme={theme} reduced={prefersReducedMotion()} you={user?.name || user?.full_name || ''}
      onExit={exit} actions={recorder} />
  );
}
