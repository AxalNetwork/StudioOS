import React, { useEffect, useState } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { onInstallStateChange, triggerInstall, isStandalone } from '../lib/pwa';

const DISMISS_KEY = 'axal_install_dismissed_at';
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

function recentlyDismissed() {
  try {
    const at = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    return at && (Date.now() - at) < DISMISS_TTL_MS;
  } catch { return false; }
}

export default function InstallPrompt() {
  const [state, setState] = useState({ canInstall: false, installed: false });
  const [dismissed, setDismissed] = useState(() => recentlyDismissed());
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => onInstallStateChange(setState), []);

  useEffect(() => {
    // Show iOS Safari hint banner if user is on iPhone, not in standalone,
    // and hasn't recently dismissed. Android/Chrome use the native prompt.
    if (isIos() && !isStandalone() && !recentlyDismissed()) {
      const t = setTimeout(() => setIosHint(true), 4000);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setDismissed(true);
    setIosHint(false);
  };

  if (state.installed || dismissed) return null;

  // Native install (Chrome/Edge/Android)
  if (state.canInstall) {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-40 bg-white border border-slate-200 rounded-lg shadow-lg p-4 flex items-start gap-3 dark:bg-gray-900">
        <div className="bg-purple-100 text-purple-700 rounded-md p-2 flex-shrink-0">
          <Smartphone className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900">Install Axal VC</div>
          <div className="text-xs text-slate-600 mt-0.5">
            Add StudioOS to your home screen for faster access and offline reading.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={async () => { await triggerInstall(); }}
              className="inline-flex items-center gap-1 bg-purple-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-purple-700"
            >
              <Download className="w-3.5 h-3.5" /> Install
            </button>
            <button onClick={dismiss} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5">
              Not now
            </button>
          </div>
        </div>
        <button onClick={dismiss} className="text-slate-400 hover:text-slate-600 -mt-1 -mr-1">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // iOS Safari: must educate the user (no beforeinstallprompt support)
  if (iosHint) {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-40 bg-white border border-slate-200 rounded-lg shadow-lg p-4 flex items-start gap-3 dark:bg-gray-900">
        <div className="bg-purple-100 text-purple-700 rounded-md p-2 flex-shrink-0">
          <Smartphone className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900">Add Axal VC to Home Screen</div>
          <div className="text-xs text-slate-600 mt-0.5">
            Tap <span className="font-semibold">Share</span> in Safari, then choose
            <span className="font-semibold"> "Add to Home Screen"</span>.
          </div>
        </div>
        <button onClick={dismiss} className="text-slate-400 hover:text-slate-600 -mt-1 -mr-1">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return null;
}
