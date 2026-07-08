import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import {
  Check, Copy, Download, Smartphone, ShieldCheck,
  ChevronDown, ChevronRight, HelpCircle, ExternalLink, XCircle,
} from 'lucide-react';

// Task #11 — shared first-time authenticator (TOTP) enrolment wizard.
// Used by VerifyEmailPage (post-verification optional step) and the
// Settings → Security tab (for magic-link / Google users with no TOTP).
//
// Two-phase against /api/settings/totp/enrol/*:
//   1. start   → server PROPOSES a secret (nothing persisted); we render the
//                QR + manual secret + otpauth:// deep link and ask for a live
//                6-digit code to prove the authenticator actually works.
//   2. confirm → server persists the enrolment, upgrades the current session
//                to full assurance, and returns one-time recovery codes that
//                the user must acknowledge saving before finishing.
//
// Props:
//   onDone(recoveryCodes)  — called after the user acknowledges their codes.
//   onCancel()             — optional; renders a "Not now" escape hatch.

const MANUAL_APPS = [
  {
    key: 'google',
    name: 'Google Authenticator',
    steps: [
      'Open Google Authenticator on your phone.',
      'Tap the + button (bottom right) → "Enter a setup key".',
      'Account: type "Axal VC" (or your email). Key: paste the secret key above.',
      'Time-based should be selected (default). Tap "Add".',
      "A new 6-digit code will appear — enter it below to finish.",
    ],
  },
  {
    key: 'authy',
    name: 'Authy',
    steps: [
      'Open Authy and tap "Add Account" (or the + icon).',
      'Tap "Enter Code Manually".',
      'Paste the secret key above and tap the arrow.',
      'Account name: "Axal VC". Logo: search for "Axal VC" or skip. Tap "Save".',
      "Authy will start showing a 6-digit code — enter it below to finish.",
    ],
  },
  {
    key: '1password',
    name: '1Password',
    steps: [
      'Open 1Password → find or create the login item for Axal VC.',
      'Edit the item and tap "Add more" → "One-Time Password".',
      'Tap "From QR Code or Setup Code" → "Enter setup code manually".',
      'Paste the secret key above. Save the item.',
      '1Password will start generating a 6-digit code — enter it below to finish.',
    ],
  },
  {
    key: 'bitwarden',
    name: 'Bitwarden',
    steps: [
      'Open Bitwarden → find or create the login item for Axal VC. Premium is required for built-in TOTP.',
      'Edit the item and find the "Authenticator key (TOTP)" field.',
      'Paste the secret key above into that field and save.',
      'Bitwarden will display a rotating 6-digit code under the item.',
      'Enter that code below to finish.',
    ],
  },
];

export default function TotpEnrollment({ onDone, onCancel }) {
  const [phase, setPhase] = useState('loading'); // loading | qr | recovery | error
  const [data, setData] = useState(null);        // { totp_secret, provisioning_uri, qr_code }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [manualOpen, setManualOpen] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [ack, setAck] = useState(false);
  const [codesCopied, setCodesCopied] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.enrolTotpStart();
        if (cancelled) return;
        setData(res);
        setPhase('qr');
      } catch (e) {
        if (cancelled) return;
        setError(e.message || 'Could not start authenticator setup.');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Draw the QR client-side from the provisioning URI — works even when the
  // server-side QR render failed (qr_code null).
  useEffect(() => {
    if (phase === 'qr' && data?.provisioning_uri && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, data.provisioning_uri, {
        width: 200, margin: 2, color: { dark: '#000000', light: '#ffffff' },
      });
    }
  }, [phase, data]);

  const confirm = async () => {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.enrolTotpConfirm({ totp_secret: data.totp_secret, totp_code: code });
      setRecoveryCodes(res?.recovery_codes || []);
      setPhase('recovery');
    } catch (e) {
      const msg = e.message || '';
      setError(/invalid_code/i.test(msg)
        ? "That code didn't match. Codes rotate every 30 seconds — wait for a fresh one and try again."
        : (msg || 'Could not confirm your authenticator. Please try again.'));
    }
    setBusy(false);
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(data.totp_secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const copyCodes = async () => {
    if (!recoveryCodes?.length) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCodesCopied(true);
      setTimeout(() => setCodesCopied(false), 2000);
    } catch {}
  };

  const downloadCodes = () => {
    if (!recoveryCodes?.length) return;
    const txt = `Axal VC — TOTP recovery codes\nGenerated ${new Date().toISOString()}\n\n${recoveryCodes.join('\n')}\n\nEach code can be used exactly once if you lose access to your authenticator app.\nDo not share these. Store somewhere safe (password manager, sealed envelope, etc.).\n`;
    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'axal-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (phase === 'loading') {
    return (
      <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        Preparing your authenticator setup…
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="py-4 text-center">
        <div className="flex items-center justify-center w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full mx-auto mb-3">
          <XCircle size={24} className="text-red-500" />
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">{error}</p>
        {onCancel && (
          <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            Close
          </button>
        )}
      </div>
    );
  }

  if (phase === 'recovery') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
          <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
          <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Authenticator added — your account is now protected.</p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Save your recovery codes</h3>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            If you lose your authenticator, these one-time codes are the only way back in.
            They will <span className="font-semibold">not be shown again</span>.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          {recoveryCodes.map((rc, i) => (
            <div key={i} className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2.5 py-1.5 select-all text-gray-900 dark:text-gray-100">{rc}</div>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={copyCodes}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 hover:border-gray-400 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-medium transition-colors">
            {codesCopied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
            {codesCopied ? 'Copied!' : 'Copy all'}
          </button>
          <button onClick={downloadCodes}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 hover:border-gray-400 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-medium transition-colors">
            <Download size={13} /> Download .txt
          </button>
        </div>
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500" />
          <span className="text-xs text-gray-700 dark:text-gray-300">
            I've saved these recovery codes somewhere safe.
          </span>
        </label>
        <button onClick={() => onDone?.(recoveryCodes)} disabled={!ack}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg py-2.5 text-sm font-medium text-white transition-colors">
          Done
        </button>
      </div>
    );
  }

  // phase === 'qr'
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Scan this QR code</h3>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Use any authenticator app — Google Authenticator, Authy, 1Password, Bitwarden…
        </p>
      </div>

      {/* QR stays on white in dark mode too — scanners need the contrast. */}
      <div className="bg-white dark:bg-white rounded-xl p-4 flex items-center justify-center border-2 border-gray-200 dark:border-gray-700">
        <canvas ref={canvasRef} className="rounded" />
      </div>

      {/* On the phone itself? otpauth:// deep link opens the installed app. */}
      <a href={data.provisioning_uri}
        className="flex items-center justify-center gap-1.5 text-xs text-violet-600 dark:text-violet-400 hover:underline font-medium">
        <ExternalLink size={13} /> On this device? Open in your authenticator app
      </a>

      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] text-gray-600 dark:text-gray-400 uppercase mb-0.5 font-medium">Secret key (manual entry)</div>
            <div className="text-xs text-gray-900 dark:text-gray-100 font-mono tracking-wider break-all">{data.totp_secret}</div>
          </div>
          <button onClick={copySecret}
            aria-label={copied ? 'Secret key copied to clipboard' : 'Copy secret key to clipboard'}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 hover:border-gray-400 rounded-md px-2.5 py-1.5 transition-colors">
            {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
            <span className={copied ? 'text-emerald-600 font-medium' : ''}>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
        </div>
        <div role="status" aria-live="polite" className="sr-only">
          {copied ? 'Secret key copied to clipboard.' : ''}
        </div>
      </div>

      {/* No authenticator app yet? */}
      <p className="text-[11px] text-gray-500 dark:text-gray-400 text-center">
        Don't have an app?{' '}
        <a href="https://apps.apple.com/app/google-authenticator/id388497605" target="_blank" rel="noopener noreferrer" className="text-violet-600 dark:text-violet-400 hover:underline">iPhone</a>
        {' · '}
        <a href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2" target="_blank" rel="noopener noreferrer" className="text-violet-600 dark:text-violet-400 hover:underline">Android</a>
        {' '}(Google Authenticator, free)
      </p>

      {/* I can't scan the QR — manual-entry instructions per app */}
      <details className="group" onToggle={(e) => { if (!e.currentTarget.open) setManualOpen(null); }}>
        <summary className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 cursor-pointer select-none px-1 py-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
          <HelpCircle size={14} className="text-gray-500" />
          <span>I can't scan the QR — show manual setup instructions</span>
          <ChevronDown size={14} className="ml-auto transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-gray-500 dark:text-gray-400 px-1">
            Pick your authenticator app below and follow the steps. The secret key is the same value shown above.
          </p>
          {MANUAL_APPS.map(app => {
            const open = manualOpen === app.key;
            return (
              <div key={app.key} className="border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-900">
                <button
                  type="button"
                  onClick={() => setManualOpen(open ? null : app.key)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                >
                  <span className="flex items-center gap-2">
                    <Smartphone size={13} className="text-violet-600" />
                    {app.name}
                  </span>
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                {open && (
                  <ol className="list-decimal list-outside pl-8 pr-3 pb-3 pt-1 space-y-1 text-[11px] text-gray-700 dark:text-gray-300 leading-relaxed">
                    {app.steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      </details>

      {/* Live-code confirmation — proves the app is actually paired before
          anything persists server-side. */}
      <form onSubmit={(e) => { e.preventDefault(); confirm(); }} className="space-y-3">
        <div>
          <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Enter the 6-digit code from your app</label>
          <input
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456" inputMode="numeric" autoComplete="one-time-code"
            className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2.5 text-base sm:text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 focus:border-violet-500 focus:outline-none font-mono tracking-widest text-center"
          />
        </div>
        {error && <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">{error}</div>}
        <button type="submit" disabled={busy || code.length !== 6}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg py-2.5 text-sm font-medium text-white transition-colors">
          {busy ? 'Verifying…' : 'Verify & activate'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="w-full text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 py-1 transition-colors">
            Not now
          </button>
        )}
      </form>
    </div>
  );
}
