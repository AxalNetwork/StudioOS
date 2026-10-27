/**
 * D1253 (#2428) — SC8 "Investor scorecard" at `/raise/scorecard`: the founder's
 * own scorecard.
 *
 * D1258 (#3281): live on part 3's read (`GET /api/venture-scores/:projectId`,
 * which recomputes on read). Two tabs at their own addresses: Scorecard
 * (`/raise/scorecard`) and Trajectory (`/raise/scorecard/trajectory`, SC12).
 * Scorecard shows "My view" (every input, Ask to correct on each) or "What
 * investors see" (the Worker's own masking, before and after an NDA), beside
 * Sharing. An Admin opening it reads the staff view, with Add review (SC10).
 * The venture is `?project_id=` (or `?project=`), else the first the caller
 * can open. Nothing here computes a score.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { ventureScoresApi } from '../../lib/api/ventureScores.js';
import { reportError } from '../../lib/log';
import { FOUNDER_PAGE } from '../../components/scoring/scorecard/scorecardModel.js';
import { TRAJECTORY_PATH } from '../../components/scoring/scorecard/founderModel.js';
import { InvestorPreview, ScopeList, SharingCard, Trajectory } from '../../components/scoring/scorecard/FounderScorecard';

const MUTED = 'text-axal-muted dark:text-gray-400';
const BTN = 'rounded-lg border border-axal-hairline bg-white px-3 py-1.5 text-[13px] font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800';
const TAB = 'border-b-2 px-1 pb-2 text-[13.5px] font-semibold';
const TAB_ON = `${TAB} border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300`;
const TAB_OFF = `${TAB} border-transparent ${MUTED}`;

/** The venture this page reads: the address's, else the first the caller can open. */
export function useVenture(projects = api) {
  const [params] = useSearchParams();
  const named = Number(params.get('project_id') || params.get('project')) || null;
  const [s, setS] = useState(named ? { status: 'ready', id: named } : { status: 'loading', id: null });
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (named) { setS({ status: 'ready', id: named }); return undefined; }
    let alive = true;
    setS({ status: 'loading', id: null });
    Promise.resolve(projects.listProjects()).then((list) => {
      if (!alive) return;
      const first = (list || [])[0];
      setS(first ? { status: 'ready', id: first.id } : { status: 'none', id: null });
    }).catch((e) => { reportError('FounderScorecard:projects', e); if (alive) setS({ status: 'unreadable', id: null }); });
    return () => { alive = false; };
  }, [named, key, projects]);
  return { ...s, retry: () => setKey((k) => k + 1) };
}

function useRead(load, key) {
  const [s, setS] = useState({ status: 'loading', data: null, error: null });
  const reload = useCallback(async () => {
    if (!key) return;
    setS((x) => ({ status: x.data ? 'ready' : 'loading', data: x.data, error: null }));
    try { setS({ status: 'ready', data: await load(), error: null }); } catch (e) {
      reportError('FounderScorecard:read', e);
      setS({ status: 'unreadable', data: null, error: e });
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return { ...s, reload };
}

function ReadFailed({ what, error, onRetry, testId }) {
  const refused = error?.status === 403 || error?.status === 404;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid={testId}>
      <p className="m-0 text-[13px]">{refused ? (error?.data?.message || `${what} is not open to you.`) : `${what} could not be read. That is not the same as none.`}</p>
      {refused ? null : <button type="button" className={`${BTN} w-fit`} onClick={onRetry} data-testid={`${testId}-retry`}>Try again</button>}
    </div>
  );
}

export default function FounderScorecardPage({ tab = 'scorecard', api: scoresApi = ventureScoresApi, projects = api }) {
  const venture = useVenture(projects);
  const pid = venture.id;
  const q = pid ? `?project_id=${pid}` : '';
  const card = useRead(() => scoresApi.venture(pid), tab === 'scorecard' && pid ? `card:${pid}` : null);
  const traj = useRead(() => scoresApi.trajectory(pid), tab === 'trajectory' && pid ? `traj:${pid}` : null);
  const [view, setView] = useState('mine');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const recompute = async () => {
    if (busy || !pid) return;
    setBusy(true); setNotice('');
    try {
      const r = await scoresApi.recompute(pid);
      setNotice(r?.changed ? `Recomputed. ${r.changed} ${r.changed === 1 ? 'scope' : 'scopes'} changed.` : 'Recomputed. Nothing changed: no input moved.');
      await (tab === 'trajectory' ? traj.reload() : card.reload());
    } catch (e) {
      reportError('FounderScorecard:recompute', e);
      setNotice(e?.data?.message || 'The scorecard could not be recomputed. Nothing was changed.');
    } finally { setBusy(false); }
  };
  const changed = (line) => { setNotice(line); card.reload(); };
  const read = card.data;

  let body;
  if (venture.status === 'loading') body = <p className={`m-0 text-sm ${MUTED}`}>Reading your venture…</p>;
  else if (venture.status === 'none') body = <p className="m-0 text-sm" data-testid="founder-scorecard-no-venture">You have no venture yet. Your scorecard starts once you create one.</p>;
  else if (venture.status === 'unreadable') body = <ReadFailed what="Your ventures" onRetry={venture.retry} testId="founder-scorecard-ventures-unreadable" />;
  else if (tab === 'trajectory') {
    body = traj.status === 'loading' ? <p className={`m-0 text-sm ${MUTED}`}>Reading the trajectory…</p>
      : traj.status === 'unreadable' ? <ReadFailed what="The trajectory" error={traj.error} onRetry={traj.reload} testId="founder-scorecard-trajectory-unreadable" />
        : <Trajectory read={traj.data} />;
  } else if (card.status === 'loading') body = <p className={`m-0 text-sm ${MUTED}`}>Reading your scorecard…</p>;
  else if (card.status === 'unreadable') body = <ReadFailed what="Your scorecard" error={card.error} onRetry={card.reload} testId="founder-scorecard-unreadable" />;
  else {
    body = (
      <>
        {read?.viewer === 'founder' ? (
          <div role="radiogroup" aria-label="View" className="flex flex-wrap items-center gap-1.5">
            {[['mine', 'My view'], ['investors', 'What investors see']].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)} data-testid={`founder-scorecard-view-${k}`}
                className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${view === k ? 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950 dark:text-violet-200' : 'border-axal-hairline dark:border-gray-700'}`}>{l}</button>
            ))}
            <span className={`ml-2 text-[12.5px] ${MUTED}`}>{view === 'mine' ? 'You see every input value. Open a scope to see its inputs and ask to correct any of them.' : 'The same masking an investor’s read gets.'}</span>
          </div>
        ) : <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="founder-scorecard-staff">You are reading as studio staff. Your read is recorded. Add review shows beside the computed value; the founder is told.</p>}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {view === 'investors' && read?.investor_preview ? <InvestorPreview preview={read.investor_preview} />
              : <ScopeList read={read} projectId={pid} onChanged={changed} />}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {read?.viewer === 'founder' ? <SharingCard projectId={pid} sharing={read.sharing} onChanged={changed} /> : null}
          </div>
        </div>
      </>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-5 text-axal-ink dark:text-gray-100" data-testid="founder-scorecard">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 font-mono text-[11px] uppercase tracking-[.07em] text-axal-muted">Raise › Investor scorecard{tab === 'trajectory' ? ' › Trajectory' : ''}</p>
          <h1 className="m-0 text-2xl font-extrabold tracking-tight">Investor scorecard</h1>
          <p className="m-0 text-sm text-axal-muted">How investors in your deal flow read your venture, scope by scope, and what would raise confidence.</p>
        </div>
        {pid ? <button type="button" className={BTN} onClick={recompute} disabled={busy} data-testid="founder-scorecard-recompute">{busy ? 'Recomputing…' : 'Recompute'}</button> : null}
      </div>
      <nav className="flex gap-5 border-b border-axal-hairline dark:border-gray-800" aria-label="Investor scorecard">
        <Link to={`${FOUNDER_PAGE}${q}`} aria-current={tab === 'scorecard' ? 'page' : undefined} className={tab === 'scorecard' ? TAB_ON : TAB_OFF} data-testid="founder-scorecard-tab-scorecard">Scorecard</Link>
        <Link to={`${TRAJECTORY_PATH}${q}`} aria-current={tab === 'trajectory' ? 'page' : undefined} className={tab === 'trajectory' ? TAB_ON : TAB_OFF} data-testid="founder-scorecard-tab-trajectory">Trajectory</Link>
      </nav>
      {notice ? <p className="m-0 text-[12.5px]" role="status" data-testid="founder-scorecard-notice">{notice}</p> : null}
      {body}
    </main>
  );
}
