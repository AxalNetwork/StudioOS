// Live-data helpers shared by the investor Pipeline lifecycle pages
// (Screening → Commit → Transactions). All three read from the real deal
// source `GET /api/pipeline/active` — served in prod by the Cloudflare Worker
// (D1: deals / project_stages / metrics_snapshots / decision_gates) and in dev
// by the FastAPI mirror in `pipeline_votes.py`. There are NO backend tables for
// investor-specific artifacts (scorecards, term sheets, wire status, closing
// checklists), so the pages surface what the deal source really provides and
// show clear empty states everywhere a source does not exist yet.
//
// Pure stage-bucketing + formatting helpers live in ./bucketing (no React/api
// imports) so they can be unit-tested directly; we re-export them here so the
// pages keep a single import site.
import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';

export {
  isTransactionDeal, isCommitDeal, isScreeningDeal, prettyStage, fmtDate, fmtMoney, avg,
} from './bucketing';

// ── Shared fetch hook ───────────────────────────────────────────────────────
export function usePipelineDeals() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.pipelineActive();
      setDeals(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || 'Could not load deal data.');
      setDeals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { deals, loading, error, reload };
}
