import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { programGrantsApi } from '../../../lib/api/programGrants.js';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderTab } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { LEDGER_PATH } from '../../../lib/programGrants';
import GridView from './GridView';
import StudioView from './StudioView';
import RequestsView from './RequestsView';
import DefaultsView from './DefaultsView';
import { viewOf } from './grantsModel';

/**
 * D981 (#2376), completed by D987 (#2778) — Program grants at
 * /admin/licences/programs, the Super Admin's page for which programs each
 * licensed studio may run, and on what terms, built to the owner's canvas
 * (GR1–GR15) under the shared admin page header (D936). It is the Licences
 * strip's second item, beside the ledger.
 *
 * TWO READS FOR THE WHOLE PAGE, EACH ITS OWN BLOCK (D987 §1): D982's grid
 * (licences × programs, the tiles, the series and every program's defaults)
 * and D983's requests. One failing never blanks the other. One studio's page
 * (GR3) adds that licence's read and its partner deal types (D986).
 *
 * THE ADDRESSES (D987 §2). Grid, Requests and Default terms are tabs at their
 * own addresses; one studio is /admin/licences/programs/studio/:uid. Every
 * write opens an in-page dialog with a reason; the authenticator code is the
 * app's step-up.
 */

const idle = { status: 'loading', data: null };

function useRead(load, key) {
  const [read, setRead] = useState(idle);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    load().then(
      (data) => { if (live) setRead({ status: 'ready', data, at: Date.now() }); },
      (e) => { reportError(`program-grants:${key}`, e); if (live) setRead({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return [read, reload];
}

/** The Requests tab's count (GR1's "● 3"): the waiting requests, a dash when they could not be read. */
function requestsCount(read) {
  if (read.status === 'loading') return { kind: 'load' };
  if (read.status === 'error') return { kind: 'dash', tip: 'Program requests could not be read.' };
  const n = (read.data?.items || []).filter((r) => r.status === 'open').length;
  return n ? { kind: 'num', value: String(n) } : null;
}

function ProgramGrantsPage() {
  const loc = useLocation();
  const { view, uid } = viewOf(loc.pathname);
  const [grid, reloadGrid] = useRead(() => programGrantsApi.grid(), 'grid');
  const [requests, reloadRequests] = useRead(() => programGrantsApi.requests(), 'requests');
  const reload = useCallback(() => { reloadGrid(); reloadRequests(); }, [reloadGrid, reloadRequests]);
  const asOf = grid.at || requests.at;

  const actions = (
    <>
      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="grants-asof">
        {asOf ? `Updated ${new Date(asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'Reading…'}
      </span>
      <button type="button" aria-label="Refresh" onClick={reload} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
    </>
  );

  if (view === 'studio') {
    return <StudioView uid={uid} grid={grid} requests={requests} reloadAll={reload} />;
  }

  // Literal doors, one per tab (D936), so the reachability walk finds each.
  const tabs = (
    <>
      <HeaderTab to="/admin/licences/programs" data-testid="grants-tab-grid">Grid</HeaderTab>
      <HeaderTab to="/admin/licences/programs/requests" count={requestsCount(requests)} data-testid="grants-tab-requests">Requests</HeaderTab>
      <HeaderTab to="/admin/licences/programs/defaults" data-testid="grants-tab-defaults">Default terms</HeaderTab>
    </>
  );

  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="program-grants">
      <AdminPageHeader
        crumb={{ label: 'Licences', to: LEDGER_PATH, current: 'Program grants' }}
        title="Program grants"
        pills={[{ label: 'HQ only', tone: 'hq' }]}
        actions={actions}
        line="Which programs each studio may run, and on what terms. Studios ask; HQ decides."
        tabs={tabs}
        data-testid="grants-header"
      />
      {view === 'grid' && <GridView grid={grid} requests={requests} reload={reload} reloadGrid={reloadGrid} reloadRequests={reloadRequests} />}
      {view === 'requests' && <RequestsView grid={grid} requests={requests} reload={reload} />}
      {view === 'defaults' && <DefaultsView grid={grid} reload={reloadGrid} />}
    </div>
  );
}

/** The page inside its rail frame (D774); the rail is the Licences board's (D981 §1). */
export default function ProgramGrants() {
  return (
    <AdminBoardFrame workspace="Licences" note="Eadwyn reads the grants on this page. It changes nothing." data-testid="admin-board-program-grants">
      <ProgramGrantsPage />
    </AdminBoardFrame>
  );
}
