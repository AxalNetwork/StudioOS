import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

/**
 * Task #28 — reusable live-data merge for the Spin-Out deck.
 *
 * Fetches the founder's assembled Spin-Out deck fields (the flat dotted-key
 * map the template's hydrate() consumes, e.g. `cover.signalX_json`,
 * `cover.signalY_json`, and — once Task #29 lands — `problem.pains_json`) so
 * any builder/preview surface can render REAL Lab data instead of the bundled
 * SAMPLE. Returns the FULL field map (not cover-only) so later slides reuse it.
 *
 * A 402 (paywall) or any other error is non-fatal: `fields` stays null and the
 * caller falls back to the template's sample data.
 *
 * @param {object}  opts
 * @param {number|null} opts.projectId  Project to source deck data from.
 * @param {boolean} [opts.enabled=true] Gate the fetch (e.g. spinout decks only).
 * @returns {{ fields: Record<string,string>|null, loading: boolean, error: any }}
 */
export function useSpinoutDeckFields({ projectId, enabled = true }) {
  const [fields, setFields] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !projectId) {
      setFields(null);
      setError(null);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api.spinoutDeck(projectId)
      .then((r) => { if (alive) setFields(r?.fields || null); })
      .catch((e) => {
        if (!alive) return;
        setFields(null);
        // 402 = premium paywall — expected, fall back to sample silently.
        if (e?.status !== 402) {
          setError(e);
          reportError('useSpinoutDeckFields', e);
        }
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, enabled]);

  return { fields, loading, error };
}

export default useSpinoutDeckFields;
