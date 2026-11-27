import React from 'react';
import { ShieldAlert, LogOut, Clock } from 'lucide-react';

export default function InactivityWarningModal({ open, secondsLeft, onStay, onLogout }) {
  if (!open) return null;

  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const display = mm > 0 ? `${mm}:${ss}` : `${secondsLeft}`;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inactivity-title"
    >
      <div className="bg-white border border-gray-200 rounded-xl shadow-2xl max-w-md w-[90%] p-6 dark:bg-gray-900 dark:border-gray-800">
        <div className="flex items-start gap-3 mb-4">
          <div className="bg-amber-100 text-amber-600 rounded-lg p-2 flex-shrink-0">
            <ShieldAlert size={20} />
          </div>
          <div>
            <h2 id="inactivity-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
              You're about to be signed out
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              For your security, we'll log you out automatically after a period of inactivity.
            </p>
          </div>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-5 flex items-center gap-3 dark:border-gray-800">
          <Clock size={18} className="text-gray-500" />
          <div className="text-sm text-gray-700 dark:text-gray-300">
            Logging out in{' '}
            <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">{display}</span>
            {mm > 0 ? ' minutes' : ' seconds'}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onLogout}
            className="text-sm text-gray-600 hover:text-red-600 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <LogOut size={14} /> Log out now
          </button>
          <button
            onClick={onStay}
            autoFocus
            className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Stay logged in
          </button>
        </div>
      </div>
    </div>
  );
}
