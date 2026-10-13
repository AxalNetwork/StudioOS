import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useActiveRecording, useNow } from '../../contexts/ActiveRecordingContext';
import { elapsedMs, pillLabel, pillVariant, reviewPath } from '../../lib/activeRecording';
import RingViz, { prefersReducedMotion } from '../../components/discovery/RingViz';
import { clock } from './RecordingView';

/**
 * The minimised recording (D685 §5.6.4, RV13): a 64px live ring, the timer and
 * "Recording · tap to expand", on every signed-in route while a session is
 * recording, paused or processing. A real button: click, Enter or Space opens
 * `/validate/record/live`. Processing that finishes while minimised never
 * moves the founder: the pill turns "Ready to review", which links there.
 *
 * Placed bottom-right, 300px in from the right at 1024px and wider so the
 * Worker AI rail stays readable; below that, full width above the phone tab bar
 * (z 30) and clear of the rail's button.
 */

const WORDS = { recording: 'Recording', paused: 'Paused', offline: 'Offline', processing: 'Processing', failed: 'Processing stopped' };
const DOT = { recording: 'bg-red-600', paused: 'bg-amber-500', offline: 'bg-amber-500', processing: 'bg-violet-600', failed: 'bg-red-600', ready: 'bg-emerald-600' };

export default function RecordingPill() {
  const { state, recorder } = useActiveRecording();
  const location = useLocation();
  const navigate = useNavigate();
  const variant = pillVariant(state);
  const now = useNow(variant === 'recording' || variant === 'offline');
  if (!variant || location.pathname === '/validate/record/live') return null;
  const t = clock(elapsedMs(state.session, now));
  const label = pillLabel(variant, t);
  const box = 'fixed z-[35] flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-2 pr-4 text-left text-gray-900 shadow-[0_8px_30px_rgba(24,24,27,.18)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 dark:border-[#2a2140] dark:bg-[#130b22] dark:text-gray-100 max-lg:inset-x-3 max-lg:bottom-[calc(76px+env(safe-area-inset-bottom))] max-lg:right-[84px] lg:bottom-6 lg:right-[300px]';
  const ring = (
    <span className="block h-16 w-16 shrink-0" aria-hidden="true">
      <RingViz analyser={state.cap?.analyser || null} mode={variant === 'paused' ? 'paused' : variant === 'processing' || variant === 'failed' || variant === 'ready' ? 'paused' : 'speech'} motion={prefersReducedMotion() ? 'reduced' : undefined} />
    </span>
  );
  if (variant === 'ready') {
    return (
      <Link to={reviewPath(state.session)} state={{ interview: state.interview }} onClick={() => recorder.clear()} aria-label={label} data-testid="recording-pill" data-variant={variant} className={box}>
        {ring}
        <span className="flex flex-col"><span className="inline-flex items-center gap-1.5 text-[13px] font-bold"><span className={`h-2 w-2 rounded-full ${DOT.ready}`} />Ready to review</span><span className="text-[12px] text-gray-500 dark:text-gray-400">Open the review</span></span>
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => navigate(`/validate/record/live?session=${encodeURIComponent(state.session.id)}`)} aria-label={label} data-testid="recording-pill" data-variant={variant} className={box}>
      {ring}
      <span className="flex flex-col">
        {variant !== 'processing' && variant !== 'failed' && <span className="font-mono text-[15px] font-semibold tabular-nums" data-testid="recording-pill-clock">{t}</span>}
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold">
          <span className={`h-2 w-2 rounded-full ${DOT[variant]} ${variant === 'recording' ? 'motion-safe:animate-pulse' : ''}`} />
          {WORDS[variant]} · {variant === 'failed' ? 'tap to retry' : 'tap to expand'}
        </span>
      </span>
    </button>
  );
}
