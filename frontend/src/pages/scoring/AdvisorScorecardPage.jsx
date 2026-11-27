/**
 * D1258 (#3281) — SC21: an advisor's read-only view of a venture scorecard at
 * `/practice/scorecards/:projectId`, open only when the founder has shared it
 * with them by name (owner question 10 A). The Worker refuses anyone else; the
 * advisor reaches it from the notice sent when the founder shares. Bands,
 * values and confidence; inputs stay hidden. Every read is logged by the Worker.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ventureScoresApi } from '../../lib/api/ventureScores.js';
import { reportError } from '../../lib/log';
import { ScopeList } from '../../components/scoring/scorecard/FounderScorecard';

const MUTED = 'text-axal-muted dark:text-gray-400';
const CARD = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

export default function AdvisorScorecardPage({ api = ventureScoresApi }) {
  const { projectId } = useParams();
  const valid = /^[1-9][0-9]{0,15}$/.test(String(projectId || ''));
  const [s, setS] = useState({ status: valid ? 'loading' : 'refused', data: null, error: null });
  const load = useCallback(async () => {
    if (!valid) return;
    setS({ status: 'loading', data: null, error: null });
    try { setS({ status: 'ready', data: await api.venture(projectId), error: null }); } catch (e) {
      reportError('AdvisorScorecard:read', e);
      setS({ status: e?.status === 403 || e?.status === 404 ? 'refused' : 'unreadable', data: null, error: e });
    }
  }, [projectId, valid, api]);
  useEffect(() => { load(); }, [load]);
  const read = s.data;
  return (
    <main className="flex flex-col gap-4 p-5 text-axal-ink dark:text-gray-100" data-testid="advisor-scorecard">
      <div>
        <p className="m-0 font-mono text-[11px] uppercase tracking-[.07em] text-axal-muted">Practice › Scorecard</p>
        <div className="flex items-center gap-2">
          <h1 className="m-0 text-2xl font-extrabold tracking-tight">Venture scorecard</h1>
          <span className="rounded-full border border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-600 dark:border-gray-600 dark:text-gray-300">Read only</span>
        </div>
      </div>
      {s.status === 'loading' ? <p className={`m-0 text-sm ${MUTED}`}>Reading the scorecard…</p>
        : s.status === 'refused' ? <p className="m-0 text-sm" data-testid="advisor-scorecard-refused">This scorecard has not been shared with you. A founder shares it from their Investor scorecard; you are told when they do.</p>
          : s.status === 'unreadable' ? (
            <div className={CARD} data-testid="advisor-scorecard-unreadable">
              <p className="m-0 text-[13px]">The scorecard could not be read. That is not the same as none.</p>
              <button type="button" className="w-fit rounded-lg border border-axal-hairline px-3 py-1.5 text-[13px] font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800" onClick={load}>Try again</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <ScopeList read={read} projectId={Number(projectId)} readOnly />
              <section className={CARD} data-testid="advisor-scorecard-scope">
                <span className="font-semibold">What you can see</span>
                <ul className="m-0 list-disc pl-5 text-[13px]"><li>Bands, values and confidence for every scope</li><li>Coverage, and any review in force</li></ul>
                <p className={`m-0 text-[12px] ${MUTED}`}>Inputs stay hidden. Personal and team-only inputs are counted, not shown. The founder can stop sharing at any time. Your read is recorded.</p>
              </section>
            </div>
          )}
    </main>
  );
}
