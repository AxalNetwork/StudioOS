/**
 * #4707 — the HQ licence page's territory. Moved out of `AdminLicences.jsx`
 * unchanged when the page was split by domain; the comments below are the
 * original ones.
 */
import React, { useMemo, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';

/* ------------------------------------------------------------------ *
 * Step 2 — the territory picker that refuses                          *
 * ------------------------------------------------------------------ */

export function TerritoryEditor({ licence, held, onSaved, onOpenLicence }) {
  const [codes, setCodes] = useState((licence.territories || []).join(', '));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Who holds what, excluding this licence's own countries — keeping your own
  // is not a conflict.
  const heldByOthers = useMemo(() => {
    const m = new Map();
    for (const h of held || []) {
      if (h.licence_uid === licence.uid) continue;
      m.set(h.country_code, h);
    }
    return m;
  }, [held, licence.uid]);

  const entered = useMemo(
    () => codes.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    [codes],
  );
  const clashes = entered.filter((c) => heldByOthers.has(c));

  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.licenceSetTerritories(licence.uid, entered);
      onSaved?.();
    } catch (e) {
      reportError('licence_territories_failed', e);
      setErr(e?.message || 'Could not save the territory.');
    } finally { setBusy(false); }
  }

  return (
    <div>
      <label className="text-[11px] uppercase tracking-wide text-gray-500" htmlFor="lic-terr">
        Countries — ISO 3166-1 alpha-2, comma separated
      </label>
      <input
        id="lic-terr"
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700"
        value={codes}
        onChange={(e) => setCodes(e.target.value)}
        placeholder="FR, BE, LU"
      />
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        This refusal is the Axal-subsidiary rule: one country, one Axal licence.
        The ledger stores each licence&apos;s kind, but white-label exclusivity against other
        white-labels is not stored (owner decision D196), so this step refuses any country another
        licence already holds regardless of kind.
      </p>
      {clashes.length > 0 && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <div className="flex items-start gap-1.5">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              {clashes.map((c) => {
                const holder = heldByOthers.get(c);
                return (
                  <div key={c} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span>
                      <strong>{c}</strong> is held by {holder.licence_ref} ({holder.status}).
                    </span>
                    {onOpenLicence && holder.licence_uid && (
                      <button
                        type="button"
                        className="text-xs font-semibold text-red-900 underline hover:no-underline dark:text-red-200"
                        data-testid={`territory-clash-open-${c}`}
                        onClick={() => onOpenLicence(holder.licence_uid)}
                      >
                        Open {holder.licence_ref}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-xs font-semibold text-red-900 underline hover:no-underline dark:text-red-200"
                      data-testid={`territory-clash-remove-${c}`}
                      onClick={() => setCodes(entered.filter((x) => x !== c).join(', '))}
                    >
                      Remove {c} from list
                    </button>
                  </div>
                );
              })}
              <p className="mt-1.5">
                Two licences cannot hold one country, and a suspended holder still holds its
                territory — releasing it is a termination, not a lapse. This will be refused,
                not recorded with a warning.
              </p>
            </div>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <button
        type="button" onClick={save} disabled={busy || clashes.length > 0}
        className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save territory'}
      </button>
    </div>
  );
}
