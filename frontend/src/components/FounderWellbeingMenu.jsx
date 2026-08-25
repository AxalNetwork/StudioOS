import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Heart, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

function CheckInStatus({ status, submittedToday }) {
  if (status === 'loading') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Loader2 size={13} className="animate-spin" />
        Checking your status…
      </span>
    );
  }

  if (submittedToday) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        You’re checked in today
      </span>
    );
  }

  return (
    <span className="text-xs text-gray-500 dark:text-gray-400">
      Take a minute to check in
    </span>
  );
}

export default function FounderWellbeingMenu() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('idle');
  const [submittedToday, setSubmittedToday] = useState(false);
  const ref = useRef(null);

  const loadToday = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await api.wellbeingDaily(1);
      setSubmittedToday(Boolean(data?.submitted_today));
      setStatus('ready');
    } catch {
      // The full page remains the source of truth if the status request is
      // unavailable; the menu still provides the check-in destination.
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    loadToday();
    const onPointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [loadToday, open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Founder Wellbeing"
        aria-expanded={open}
        aria-haspopup="menu"
        className={`relative rounded-lg p-2 transition-colors ${
          open
            ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
        }`}
      >
        <Heart size={18} />
      </button>

      {open && (
        <div
          className="fixed left-1/2 top-14 z-50 w-[calc(100vw-1rem)] max-w-sm -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:translate-x-0"
          role="menu"
          aria-label="Founder Wellbeing menu"
        >
          <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
              <Heart size={16} />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Founder Wellbeing
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                A private space to check in
              </div>
            </div>
          </div>

          <Link
            to="/wellbeing"
            onClick={() => setOpen(false)}
            className="block border-b border-gray-100 px-4 py-4 transition-colors hover:bg-rose-50/60 dark:border-gray-800 dark:hover:bg-rose-950/20"
            role="menuitem"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Today’s check-in
                </div>
                <div className="mt-1">
                  <CheckInStatus status={status} submittedToday={submittedToday} />
                </div>
              </div>
              <ChevronRight size={16} className="flex-none text-gray-400" />
            </div>
          </Link>

          <div className="px-4 py-3">
            <Link
              to="/wellbeing"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 transition-colors hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-200"
              role="menuitem"
            >
              More
              <ChevronRight size={13} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}