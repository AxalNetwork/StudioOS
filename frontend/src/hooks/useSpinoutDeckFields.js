import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

/**
 * Task #28 — reusable live-data merge for the Spin-Out deck.
 *
 * Fetches the founder's assembled Spin-Out deck bundle so any builder/preview
 * surface can render REAL Lab data instead of the bundled SAMPLE.
 *
 * WHAT IT RETURNS, AND WHY IT IS NOT JUST `fields`
 * ===============================================
 * `fields` is the flat dotted-key map the template's hydrate() consumes. It is
 * the right input for RENDERING and the wrong one for READINESS, because
 * flattenSpinoutDeckData omits empty scalars: a slide falling back to template
 * figures emits the same shape as one the founder filled in, and a project with
 * nothing done produces a field map with zero empty entries. Anything deciding
 * "has the founder done this yet?" from `fields` alone concludes yes, always —
 * which is how the Pitch Deck Builder came to caption eleven slides of template
 * content "Data populated from your work".
 *
 * The worker already knows the truth and always sent it: `gaps` (one line per
 * empty module) with `gap_sections` naming the slide each belongs to. This hook
 * used to keep only `fields` and drop the rest. It no longer does.
 *
 * A 402 (paywall) or any other error is non-fatal: everything stays null and
 * the caller falls back to the template's sample data.
 *
 * @param {object}  opts
 * @param {number|null} opts.projectId  Project to source deck data from.
 * @param {boolean} [opts.enabled=true] Gate the fetch (e.g. spinout decks only).
 * @param {number}  [opts.reloadKey=0]  Bump to force a re-fetch (e.g. after the
 *   founder edits Use-of-Funds) so the live bundle reflects the new data.
 * @returns {{ fields: Record<string,string>|null, gaps: string[]|null,
 *   gapSections: Array<string|null>|null, draft: boolean|null,
 *   programDay: number|null, loading: boolean, error: any }}
 */
export function useSpinoutDeckFields({ projectId, enabled = true, reloadKey = 0 }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !projectId) {
      setBundle(null);
      setError(null);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api.spinoutDeck(projectId)
      .then((r) => {
        if (!alive) return;
        if (!r?.fields) { setBundle(null); return; }
        setBundle({
          fields: r.fields,
          // Present-but-empty is meaningful: it means "no gaps", i.e. every
          // module is filled. Only a response MISSING the key is unknown, so
          // normalise that to null rather than [] — a worker that does not send
          // it must read as "cannot tell", never as "everything is complete".
          gaps: Array.isArray(r.gaps) ? r.gaps : null,
          gapSections: Array.isArray(r.gap_sections) ? r.gap_sections : null,
          draft: typeof r.draft === 'boolean' ? r.draft : null,
          programDay: Number.isFinite(r.program_day) ? r.program_day : null,
        });
      })
      .catch((e) => {
        if (!alive) return;
        setBundle(null);
        // 402 = premium paywall — expected, fall back to sample silently.
        if (e?.status !== 402) {
          setError(e);
          reportError('useSpinoutDeckFields', e);
        }
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, enabled, reloadKey]);

  return {
    fields: bundle?.fields ?? null,
    gaps: bundle?.gaps ?? null,
    gapSections: bundle?.gapSections ?? null,
    draft: bundle?.draft ?? null,
    programDay: bundle?.programDay ?? null,
    loading,
    error,
  };
}

export default useSpinoutDeckFields;
