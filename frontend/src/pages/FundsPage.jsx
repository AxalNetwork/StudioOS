import React, { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { api } from '../lib/api';
import { useEscapeClose } from '../components/useEscapeClose';
import Sheet from '../ui/Sheet.jsx';

/**
 * D1160 (#3067): Fund Ops is retired. Its funds view (`AdminFundsView`) and
 * its create, call and distribution dialogs went with it: an admin runs the
 * Axal VC funds at `/admin/fund-admin` (D714, D1157), and `/funds` forwards an
 * admin there. What stays is the LPA drawer, which the LP workspace's
 * My-commitment card opens (D372).
 */

// Exported for the LP workspace's My-commitment card (D372), which took over
// the LP's "view LPA" from the retired LPPortalView.
export function LPADrawer({ fundId, onClose }) {
  useEscapeClose(onClose);
  // D174 — THE WHOLE RESPONSE IS KEPT, not just `r.doc`. `content_available`
  // and `redacted` are SIBLINGS of `doc` in the payload (see routes/funds.ts),
  // so `setDoc(r.doc)` threw both away. That was the second, independent
  // reason `Download LPA` could never render: even once the server started
  // reporting a body, this would have dropped the report before the JSX
  // could read it.
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dlErr, setDlErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    api.fundsLpa(fundId)
      .then(r => { if (!cancelled) setRes(r); })
      .catch(e => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [fundId]);
  const doc = res?.doc;
  // The click, its busy flag and its own error line. `res.content_available`
  // says a body exists; only this call gets it, and only for a reader the
  // server allows on that hit.
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setDlErr('');
    try {
      await api.downloadFundLpa(fundId);
    } catch (e) {
      setDlErr(e?.message || 'The LPA could not be downloaded. Reload and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet label={`LPA, Fund #${fundId}`} title={<span className="flex items-center gap-2"><ScrollText size={16} className="text-violet-600" /> LPA — Fund #{fundId}</span>} width={640} testId="fund-lpa-sheet" onClose={onClose}>
      <div className="p-6">
        {err && <div className="bg-red-50 text-red-700 text-xs rounded px-2 py-1">{err}</div>}
        {!doc ? <div className="text-xs text-gray-400 py-8 text-center">Loading…</div> : (
          <>
            <div className="text-xs text-gray-500 mb-3">v{doc.version} · {doc.status} · {doc.created_at && new Date(doc.created_at + 'Z').toLocaleString()}</div>
            {/* Security #8: the LPA body is never embedded in this JSON. The
                server reports only whether one exists; `Download LPA` fetches
                it from `/funds/:id/lpa/download`, which re-checks LP
                membership of this fund on that hit.

                D174 — THREE STATES, NOT TWO. This was `content_url ? button :
                "you are not an LP"`, and the backend never sent a
                `content_url` to anyone, so the second branch was what every
                reader got — including an LP the server had just authorised,
                and every admin. Not being an LP is now claimed only when the
                server says so with `redacted`; a record with no stored body
                gets its own sentence, because "we have nothing to give you"
                and "you are not entitled to it" are different facts. */}
            {res.content_available ? (
              <>
                <button
                  type="button"
                  onClick={download}
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  {busy ? 'Preparing…' : 'Download LPA'}
                </button>
                {/* A download that failed must say so. Clearing the spinner is
                    teardown, not an outcome — the D116 lesson, and the whole
                    reason this drawer is being corrected. */}
                {dlErr && <div className="text-xs text-red-600 mt-2 dark:text-red-400">{dlErr}</div>}
              </>
            ) : res.redacted ? (
              <div className="text-xs text-gray-400">Content redacted (you are not an LP of this fund).</div>
            ) : (
              <div className="text-xs text-gray-400">No LPA body is stored against this record yet, so there is nothing to download.</div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
