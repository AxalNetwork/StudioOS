import { useEffect } from 'react';
import { Rocket, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { useToast } from './useToast';

// Task #15 — Global listener for the `spinout-lab:advanced` window event
// dispatched from `frontend/src/lib/spinoutLabHooks.js`. On every fired
// event we (a) re-pull `/api/auth/me` so `user.spinout_lab_week` and the
// sidebar reflect the new state without a manual refresh, and (b) flash
// a toast so the user gets immediate feedback that the milestone landed.
//
// Mounted once inside <AuthProvider> in App.jsx so it has access to the
// auth `refresh()` and is alive across every route.
export default function SpinoutLabListener() {
  const { refresh } = useAuth();
  const { toast, showToast, dismissToast } = useToast(4000);

  useEffect(() => {
    const onAdvanced = () => {
      try { refresh({ force: true }); } catch { /* no-op */ }
      showToast('Milestone completed — Spin-Out Lab updated');
    };
    window.addEventListener('spinout-lab:advanced', onAdvanced);
    return () => window.removeEventListener('spinout-lab:advanced', onAdvanced);
  }, [refresh, showToast]);

  if (!toast) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 max-w-sm bg-violet-600 text-white shadow-lg rounded-lg px-4 py-3 flex items-start gap-3"
      role="status"
      aria-live="polite"
    >
      <Rocket size={16} className="mt-0.5 shrink-0" />
      <div className="text-sm flex-1">{toast}</div>
      <button
        type="button"
        onClick={dismissToast}
        aria-label="Dismiss"
        className="text-white/80 hover:text-white"
      >
        <X size={14} />
      </button>
    </div>
  );
}
