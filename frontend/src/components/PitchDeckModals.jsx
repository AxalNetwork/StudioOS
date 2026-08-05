// Pitch Deck Builder — export + share modals.
//
// Design reference: spin-out-lab-pipeline/project/Pitch Deck Builder.dc.html
// (EXPORT MODAL L225-243, SHARE MODAL L246-282). Both wrap the app's REAL
// backends rather than the design's simulated ones:
//   - Export: the caller runs the real POST /decks/:id/export (with its PPTX
//     fallback); this modal renders the design's progress → "ready" states
//     around that promise. Progress is indeterminate-but-monotonic (the
//     backend reports no percentage), so it eases toward 90% while the request
//     is in flight and completes on resolve — honest, never fake-finishing.
//   - Share: the caller issues the real 24h token link; this modal shows it
//     with a REAL QR (the `qrcode` dep already used elsewhere in the app),
//     copy-to-clipboard, and the expiry choice fed back to the caller.
//     The design's password/PIN toggle has no backend and is omitted rather
//     than stubbed as a dead control.

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, FileDown, Loader2, X } from 'lucide-react';

/** Export progress modal. `phase` is 'running' | 'done' | null. */
export function PitchDeckExportModal({ phase, progress, filename, error, onClose }) {
  if (!phase) return null;
  const done = phase === 'done';
  return (
    <div
      className="fixed inset-0 z-[80] bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-6"
      data-testid="export-modal"
    >
      <div className="w-full max-w-[420px] rounded-2xl bg-white dark:bg-gray-900 p-7 text-center shadow-2xl border border-gray-200 dark:border-gray-700">
        {done ? (
          <>
            <div className="w-13 h-13 mx-auto mb-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center p-3">
              <Check size={26} />
            </div>
            <h2 className="text-[18px] font-extrabold text-gray-900 dark:text-gray-50">
              {error ? 'Export finished with a fallback' : 'Deck ready'}
            </h2>
            <p className="mt-2 mb-5 text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed">
              {error || 'Your download has started.'}
              {filename && (
                <>
                  <br />
                  <span className="font-semibold text-gray-700 dark:text-gray-200 break-all">{filename}</span>
                </>
              )}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full h-[42px] rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[13.5px] font-bold"
              data-testid="button-export-done"
            >
              Done
            </button>
          </>
        ) : (
          <>
            <div className="w-13 h-13 mx-auto mb-4 rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-300 flex items-center justify-center p-3">
              <FileDown size={26} />
            </div>
            <h2 className="text-[18px] font-extrabold text-gray-900 dark:text-gray-50">Preparing your deck…</h2>
            <p className="mt-2 mb-4 text-[13px] text-gray-500 dark:text-gray-400">
              Rendering 11 slides · Axal VC Spin-Out
            </p>
            <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-violet-600 transition-[width] duration-300 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-2 text-[12px] text-gray-400 dark:text-gray-500 tabular-nums">{progress}%</div>
          </>
        )}
      </div>
    </div>
  );
}

const EXPIRY_OPTS = [
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
];

/** Share sheet: real read-only link + QR + expiry. */
export function PitchDeckShareModal({ open, url, busy, expiryHours, onExpiryChange, onClose }) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    if (!open || !url) { setQr(''); return; }
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      .then((d) => { if (alive) setQr(d); })
      .catch(() => { if (alive) setQr(''); });
    return () => { alive = false; };
  }, [open, url]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!open) return null;

  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); } catch { /* clipboard blocked */ }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
      data-testid="share-modal"
    >
      <div
        className="w-full max-w-[460px] rounded-2xl bg-white dark:bg-gray-900 overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-[17px] font-extrabold text-gray-900 dark:text-gray-50">Share deck</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-[30px] h-[30px] rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700"
            data-testid="button-close-share"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          <div className="flex gap-4 items-center">
            {/* dark-mode-exempt: a QR code needs a white quiet zone to scan. */}
            <div className="flex-none w-24 h-24 rounded-xl border border-gray-200 dark:border-gray-700 bg-white p-2 flex items-center justify-center">
              {qr
                ? <img src={qr} alt="QR code for the deck share link" className="w-full h-full" />
                : <Loader2 size={18} className="animate-spin text-gray-300" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                Read-only link
              </div>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0 h-[38px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center px-3 text-[12.5px] text-gray-600 dark:text-gray-300 truncate">
                  {busy ? 'Creating link…' : (url || 'No link yet')}
                </div>
                <button
                  type="button"
                  onClick={copy}
                  disabled={!url}
                  className="flex-none h-[38px] px-3.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"
                  data-testid="button-copy-share-link"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-800">
            <div>
              <div className="text-[13px] font-semibold text-gray-700 dark:text-gray-200">Link expires</div>
              <div className="text-[11.5px] text-gray-400 dark:text-gray-500">Re-share any time to issue a new link</div>
            </div>
            <div className="flex gap-1.5">
              {EXPIRY_OPTS.map((o) => (
                <button
                  key={o.hours}
                  type="button"
                  onClick={() => onExpiryChange(o.hours)}
                  className={`h-[30px] px-2.5 rounded-lg text-[12px] font-semibold border ${
                    expiryHours === o.hours
                      ? 'bg-violet-600 border-violet-600 text-white'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                  }`}
                  data-testid={`share-expiry-${o.hours}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
