import { useEffect, useState } from 'react';
import { Lock, Loader2, Send, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

export default function LockedFounderCard({
  founderUserId,
  founderHandle,
  sector,
  stage,
  headline,
  onUnlocked,
}) {
  const [status, setStatus] = useState('idle');
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!founderUserId) return;
    (async () => {
      try {
        setStatus('loading');
        const s = await api.trustIntroStatus(founderUserId);
        if (cancelled) return;
        setActive(!!s?.active);
        setPending(!s?.active && s?.status && s.status !== 'none');
        setStatus('ready');
        if (s?.active && onUnlocked) onUnlocked();
      } catch (e) {
        if (cancelled) return;
        setStatus('ready');
        setErr(e?.message || 'Failed to load NDA status');
      }
    })();
    return () => { cancelled = true; };
  }, [founderUserId, onUnlocked]);

  async function requestIntro() {
    setErr(null); setInfo(null);
    try {
      setStatus('sending');
      const res = await api.trustIntroRequest(founderUserId);
      if (res?.status === 'already_active') {
        setActive(true);
        if (onUnlocked) onUnlocked();
      } else {
        setPending(true);
        setInfo('Intro requested — sign the mutual NDA in your Trust Center to unlock this founder.');
      }
    } catch (e) {
      reportError('LockedFounderCard:requestIntro', e);
      setErr(e?.message || 'Request failed');
    } finally {
      setStatus('ready');
    }
  }

  if (active) return null;

  return (
    <div className="bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
          <Lock size={18} className="text-slate-600 dark:text-slate-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
              {founderHandle || `Founder #${founderUserId}`}
            </span>
            {sector && <span className="text-[10px] uppercase tracking-wide text-slate-500">{sector}</span>}
            {stage && <span className="text-[10px] uppercase tracking-wide text-slate-500">· {stage}</span>}
          </div>
          {headline && (
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2 line-clamp-2">{headline}</p>
          )}
          <p className="text-xs text-slate-500 mb-2">
            🔒 NDA required to unlock — request an intro to view the full profile and deal materials.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={requestIntro}
              disabled={status === 'sending' || status === 'loading' || pending}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white"
            >
              {status === 'sending' ? <Loader2 size={12} className="animate-spin" /> :
               pending          ? <CheckCircle2 size={12} /> :
                                  <Send size={12} />}
              {pending ? 'Intro pending — sign NDA' : 'Request intro'}
            </button>
            {info && <span className="text-[11px] text-emerald-600">{info}</span>}
            {err  && <span className="text-[11px] text-red-600">{err}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
