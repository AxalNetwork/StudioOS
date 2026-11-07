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
import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../../lib/api';

export {
  isTransactionDeal, isCommitDeal, isScreeningDeal, prettyStage, fmtDate, fmtMoney, avg,
} from './bucketing';

// ── Shared fetch hook ───────────────────────────────────────────────────────
// #4701: every page of the list, a request generation so a slow older answer
// cannot land over a newer one, and `partial` when a later page could not be
// read (the rows are real; the list is not known to be all of them).
export function usePipelineDeals() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [partial, setPartial] = useState(false);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const mine = (generation.current += 1);
    setLoading(true);
    setError('');
    try {
      const data = await api.pipelineActiveAll();
      if (generation.current !== mine) return;
      setDeals(Array.isArray(data?.items) ? data.items : []);
      setPartial(data?.complete === false);
    } catch (e) {
      if (generation.current !== mine) return;
      setError(e?.message || 'Could not load deal data.');
      setDeals([]);
      setPartial(false);
    } finally {
      if (generation.current === mine) setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); return () => { generation.current += 1; }; }, [reload]);
  return { deals, loading, error, partial, reload };
}
