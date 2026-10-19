import React, { useMemo } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useActiveRecording, useNow } from '../../contexts/ActiveRecordingContext';
import { finishLine, pillVariant, recovering, reviewPath } from '../../lib/activeRecording';
import { useAuth } from '../../hooks/useAuthSync';
import useAssistMode from '../../hooks/useAssistMode';
import { prefersReducedMotion } from '../../components/discovery/RingViz';
import RecordingView, { useDarkTheme } from './RecordingView';
import { focusPillOnShow } from './RecordingPill';

/**
 * `/validate/record/live` (D685 §5.6.2, #1588): the Recording View full screen,
 * at every width, bound to the app's one recording. `?session=<id>` names the
 * session for a reload or a deep link; with no active recording for it, the
 * session's own page opens instead.
 *
 * × "Exit full screen" goes back to where the founder was and leaves the
 * recording running: the pill keeps it in the corner (`RecordingPill.jsx`).
 * When processing finishes here, the founder lands on Customer research
 * (D694), or on the session when Axal drafted its summary (D757, #1927);
 * minimised, the ready pill offers the same destination.
 */


/** Where the live route sends a request it cannot serve. */
export function liveRedirect(state, sessionParam) {
  const sid = state?.session?.id;
  const asked = sessionParam ? String(sessionParam) : null;
  if (state?.phase === 'discarded') return reviewPath(state?.session);
  if (sid != null && (!asked || asked === String(sid))) return state.phase === 'ready' ? (finishLine(state)?.href || reviewPath(state.session)) : null;
  if (asked && /^\d+$/.test(asked)) return `/validate/session/${asked}`;
  return '/validate';
}

export default function RecordLivePage() {
  const { state, recorder } = useActiveRecording();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth() || {};
  const theme = useDarkTheme();
  const now = useNow(state.phase === 'recording');
  // The rail's Manual mode (off by default) stops the Worker after Transcribing (§5.9, `auto: false`).
  const [auto] = useAssistMode('Validate');
  const actions = useMemo(() => Object.assign(Object.create(recorder), { confirmStop: () => recorder.confirmStop({ auto }) }), [recorder, auto]);
  // A reload: the recording comes back once recovery has run (§5.6.7). Until
  // then there is no session to show and none to leave for (#1588).
  if (!state.session && params.get('session') && recovering(state)) {
    return <p role="status" className="p-6 text-[13px] text-gray-500 dark:text-gray-400" data-testid="live-restoring">Restoring the recording…</p>;
  }
  const to = liveRedirect(state, params.get('session'));
  if (to) return <Navigate to={to} replace state={state.phase === 'ready' ? { interview: state.interview } : undefined} />;

  // Back to the page before the lightbox; with no history (a deep link), to Validate.
  const exit = () => {
    // Focus goes to the pill that now holds the recording (§5.6.3), only when
    // one is drawn: a flag left set would later take focus from another page.
    if (pillVariant(state)) focusPillOnShow();
    const idx = typeof window !== 'undefined' ? window.history?.state?.idx : 0;
    if (location.key !== 'default' && idx > 0) navigate(-1); else navigate('/validate', { replace: true });
  };

  return (
    <RecordingView st={state} now={now} theme={theme} reduced={prefersReducedMotion()} you={user?.name || user?.full_name || ''}
      onExit={exit} onOpen={(href) => navigate(href, { replace: true })} actions={actions} />
  );
}
