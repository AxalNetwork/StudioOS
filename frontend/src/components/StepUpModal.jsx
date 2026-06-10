import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { api } from '../lib/api';
import { useEscapeClose } from './useEscapeClose';

// BLOCK-AUTH-03 — global step-up prompt. Mounted once in ProtectedLayout. Listens
// for `studioos:step_up_required` (fanned out by lib/api.js when the worker
// returns 403 {code:'step_up_required'}), collects a fresh 6-digit TOTP, POSTs
// /auth/step-up, then resolves the original request via the event's done(true)
// callback so the in-flight call is retried. Escape / cancel calls done(false)
// which surfaces the original 403 to the caller.
export default function StepUpModal() {
  const [open, setOpen] = useState(false);
  const [ttl, setTtl] = useState(15);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const doneRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onEvent = (e) => {
      const detail = e?.detail;
      if (!detail || typeof detail.done !== 'function') return;
      // Tell lib/api.js a handler exists so it doesn't fail the request fast.
      detail.ack = true;
      // If a prompt is already open, chain: reject the new one so callers retry
      // after the current step-up (concurrency is coalesced in lib/api.js, so in
      // practice this is rare). Keep the first.
      if (doneRef.current) { detail.done(false); return; }
      doneRef.current = detail.done;
      setTtl(detail.ttlMinutes || 15);
      setCode('');
      setError('');
      setOpen(true);
    };
    window.addEventListener('studioos:step_up_required', onEvent);
    return () => window.removeEventListener('studioos:step_up_required', onEvent);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      const t = setTimeout(() => { try { inputRef.current.focus(); } catch {} }, 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const settle = useCallback((ok) => {
    const done = doneRef.current;
    doneRef.current = null;
    setOpen(false);
    setBusy(false);
    setCode('');
    setError('');
    if (done) done(ok);
  }, []);

  const cancel = useCallback(() => { if (!busy) settle(false); }, [busy, settle]);
  useEscapeClose(cancel);

  const submit = useCallback(async () => {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.stepUp(code);
      settle(true);
    } catch (e) {
      setError(e?.message || 'Could not verify your code. Please try again.');
      setBusy(false);
      setCode('');
      try { inputRef.current?.focus(); } catch {}
    }
  }, [code, busy, settle]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
      role="dialog" aria-modal="true" aria-label="Confirm it's you">
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
              <ShieldCheck size={18} className="text-violet-600 dark:text-violet-300" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Confirm it's you</h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Sensitive action — re-enter your code</p>
            </div>
          </div>
          <button onClick={cancel} disabled={busy}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-40" aria-label="Cancel">
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
          This action requires a recent authenticator check. Enter the current 6-digit code from your
          authenticator app to continue.
        </p>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 mb-3">{error}</div>
        )}

        <input
          ref={inputRef}
          type="text"
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="000000"
          maxLength={6}
          className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2.5 text-2xl text-center tracking-[0.5em] font-mono text-gray-900 dark:text-gray-100"
        />

        <div className="flex gap-2 mt-4">
          <button onClick={cancel} disabled={busy}
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={busy || code.length !== 6}
            className="flex-1 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 py-2 text-sm font-medium text-white">
            {busy ? 'Verifying…' : 'Confirm'}
          </button>
        </div>

        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-3 text-center">
          Keeps you signed in — only confirms this one action. Lasts ~{ttl} minutes.
        </p>
      </div>
    </div>
  );
}
