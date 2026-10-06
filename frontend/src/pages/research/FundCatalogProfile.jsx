import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Card } from '../../ui';
import { api } from '../../lib/api';
import { researchFundsApi } from '../../lib/api/researchFunds.js';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import EuroTechFundHistoryChart from './EuroTechFundHistoryChart';
import { FundDetails, UnreadableBadge } from './FundDirectory';

/**
 * `/research/funds/catalog/:id` — one fund from the public directory (D535,
 * #1081 steps 4–5), the Funds canvas's drawer as a page of its own.
 *
 * IT USED TO SWALLOW ITS ERRORS. It read the bundled `fundDirectory.json`
 * first, then asked the Worker and dropped any failure on the floor
 * (`catch (_) {}`), so a failed read showed the stale bundled row as if it
 * were the directory's answer, and a failed read of the founder's own list
 * hid the "Add" button's state. Now the Worker is the only source: a failed
 * read says "Unreadable", a missing fund says so, and the list's own read
 * failing says "Unreadable" beside the button rather than offering an add
 * that may duplicate a row.
 *
 * THE TWO ETF ROWS ARE GONE WITH THE BUNDLE. `fundDirectory.json` carried two
 * public-market ETFs (SPY, QQQ) with tearsheet figures; the D1 directory never
 * held them, and a VC fund directory is the wrong home for them.
 */

const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const GHOST = 'inline-flex items-center gap-1 rounded-lg border border-axal-hairline px-3 py-2 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';

/**
 * The page body from props alone (the tests render it with react-dom/server).
 * `fund` is { loading, error, status, data }; `list` is the founder's own
 * shortlist read, { loading, error, existing }.
 */
export function FundCatalogView({ fund, list = { loading: false, error: null, existing: null }, onAdd = null, notice = null, onRetry = () => {} }) {
  // The directory is the Funds page's second tab (D593); `/research/funds`
  // alone opens My funds.
  const back = (
    <Link to="/research/funds?view=directory" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet underline dark:text-violet-300">
      <ArrowLeft size={13} /> Fund directory
    </Link>
  );
  if (fund.loading) {
    return <div className="space-y-3">{back}<Card variant="dashed" padding="lg" aria-busy="true"><p className="text-[12.5px] text-axal-muted">Loading this fund…</p></Card></div>;
  }
  if (fund.status === 404) {
    return (
      <div className="space-y-3">{back}
        <Card variant="dashed" padding="lg" data-testid="fund-catalog-missing">
          <h1 className="text-sm font-extrabold">Fund not found</h1>
          <p className="mt-2 text-[12.5px] text-axal-muted">No fund in the directory has this id. A link from before the directory moved to the server may name a row it no longer holds.</p>
        </Card>
      </div>
    );
  }
  if (fund.error) {
    return (
      <div className="space-y-3">{back}
        <Card padding="lg" className="border-red-200 dark:border-red-900" data-testid="fund-catalog-unreadable">
          <div className="flex items-center gap-2"><UnreadableBadge /><span className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Read failed</span></div>
          <h1 className="mt-2 text-sm font-extrabold">This fund could not be read.</h1>
          <p className="mt-1 text-[12.5px] text-axal-muted">{fund.error} Nothing is shown in its place, because an old copy would pass for the directory’s answer.</p>
          <button type="button" className={`${GHOST} mt-3`} onClick={onRetry}>Try again</button>
        </Card>
      </div>
    );
  }
  const { item, reports, reports_status: reportsStatus, source_boundary: boundary } = fund.data;
  const reportsState = reportsStatus === 'unreadable' ? 'unreadable' : 'ok';
  return (
    <div data-testid="fund-catalog-profile" className="space-y-4">
      {back}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-axal-faint">Public fund profile</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{item.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {list.loading && <span className="text-[12px] text-axal-muted">Checking your list…</span>}
          {!list.loading && list.error && (
            <span className="flex items-center gap-2 text-[12px] text-axal-muted"><UnreadableBadge /> Your list could not be read, so this page cannot tell whether the fund is on it.</span>
          )}
          {!list.loading && !list.error && (list.existing
            ? <Link to={`/research/funds/${encodeURIComponent(list.existing.uid)}`} className="rounded-lg bg-violet-700 px-3 py-2 text-[12px] font-semibold text-white dark:bg-violet-600">Open your dossier →</Link>
            : <button type="button" onClick={onAdd || undefined} disabled={!onAdd} className="inline-flex items-center gap-1 rounded-lg bg-violet-700 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-violet-600"><Plus size={14} /> Add to my funds</button>)}
        </div>
      </div>
      {notice && <p className={`text-[12px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{notice.text}</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card padding="lg"><FundDetails item={item} reports={reports} reportsState={reportsState} /></Card>
        <div className="space-y-4">
          {reportsState === 'ok' && item.size_currency === 'EUR' ? <EuroTechFundHistoryChart reports={reports} /> : null}
          <Card padding="lg">
            <h2 className="text-sm font-extrabold tracking-tight">What this record is</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-axal-muted">{boundary}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-axal-muted">Public fund lists go stale. Check the fund’s own site before relying on a size, a vintage or a backer.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function FundCatalogProfile({ role = 'founder' }) {
  const { id } = useParams();
  const [fund, setFund] = useState({ loading: true, error: null, status: null, data: null });
  const [list, setList] = useState({ loading: true, error: null, existing: null });
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setFund({ loading: true, error: null, status: null, data: null });
    try {
      const data = await researchFundsApi.get(id);
      setFund({ loading: false, error: null, status: 200, data });
    } catch (e) {
      setFund({ loading: false, error: e?.message || 'Unreadable.', status: e?.status ?? null, data: null });
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const name = fund.data?.item?.name;
  useEffect(() => {
    if (!name) return undefined;
    let alive = true;
    setList({ loading: true, error: null, existing: null });
    api.research.funds()
      .then((r) => { if (alive) setList({ loading: false, error: null, existing: (r.items || []).find((x) => normalize(x.name) === normalize(name)) || null }); })
      .catch((e) => { if (alive) setList({ loading: false, error: e?.message || 'Unreadable', existing: null }); });
    return () => { alive = false; };
  }, [name]);

  const add = async () => {
    const item = fund.data?.item;
    if (!item || list.existing || list.error) return;
    try {
      const row = await api.research.fundCreate({ name: item.name, source_url: item.website || null });
      setList({ loading: false, error: null, existing: row });
      setNotice({ ok: true, text: 'Added to My funds.' });
    } catch (e) {
      setNotice({ ok: false, text: e?.message || 'That fund did not save.' });
    }
  };

  return (
    <WorkspaceShell
      role={role}
      title={name || 'Fund profile'}
      activeSlug="funds"
    >
      <FundCatalogView fund={fund} list={list} onAdd={add} notice={notice} onRetry={load} />
    </WorkspaceShell>
  );
}
