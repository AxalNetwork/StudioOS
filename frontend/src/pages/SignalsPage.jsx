import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Radar, RefreshCw, Sparkles, Info, ArrowDownWideNarrow } from 'lucide-react';
import { api } from '../lib/api';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import SignalCard from '../components/signals/SignalCard';
import SignalFilterBar from '../components/signals/SignalFilterBar';
import SignalKPIStrip from '../components/signals/SignalKPIStrip';
import SignalModeToggle from '../components/signals/SignalModeToggle';
import SignalEvidencePanel from '../components/signals/SignalEvidencePanel';

/**
 * SignalsPage — "Public-market evidence for what to build next".
 *
 * A founder decision-support dashboard (NOT a trading terminal): a top filter
 * row, a KPI strip, and a ranked list of founder-actionable signal cards, with
 * a right-hand evidence slide-over for deeper inspection. The same engine backs
 * Founder mode ("what should I build next?") and Advisor mode ("what should I
 * point founders toward?"); the mode toggle changes ordering + copy only.
 */
export default function SignalsPage({ user }) {
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const isAdvisorRole = ['mentor', 'partner', 'investor', 'admin'].includes(
    String(user?.role || '').toLowerCase(),
  );

  const [mode, setMode] = useState(isAdvisorRole && String(user?.role).toLowerCase() === 'mentor' ? 'advisor' : 'founder');
  const [filters, setFilters] = useState({});
  const [facets, setFacets] = useState(null);
  const [data, setData] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const debounceRef = useRef(null);

  // Facets load once.
  useEffect(() => {
    api.signals.filters()
      .then((f) => setFacets(f.facets))
      .catch(() => setFacets({}));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, k] = await Promise.all([
        api.signals.list({ ...filters, mode }),
        api.signals.kpis(mode),
      ]);
      setData(list);
      setKpis(k);
    } catch (e) {
      setError(e.message || 'Failed to load signals.');
    } finally {
      setLoading(false);
    }
  }, [filters, mode]);

  // Debounced reload on filter/mode change (so typing in search doesn't spam).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, 250);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [load]);

  const onFilterChange = (key, value) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const onReset = () => setFilters({});

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await api.signals.refresh();
      await load();
    } catch (e) {
      setError(e.message || 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  };

  const signals = data?.signals || [];

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300">
              <Radar size={20} />
            </span>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Signals</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Public-market evidence for what to build next.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SignalModeToggle mode={mode} onChange={setMode} />
          {isAdmin && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              title="Run a background ingestion refresh"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {/* Mode helper strip */}
      <div className="flex items-start gap-2 rounded-lg bg-violet-50/60 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/40 px-4 py-2.5 text-sm text-violet-900 dark:text-violet-200">
        <Sparkles size={15} className="mt-0.5 shrink-0 text-violet-500" />
        <span>
          {mode === 'advisor'
            ? 'Advisor mode — signals ordered by how confidently you can point a founder toward them.'
            : 'Founder mode — signals ordered by how buildable and actionable the opportunity is right now.'}
        </span>
      </div>

      {/* KPI strip */}
      <SignalKPIStrip kpis={kpis} loading={loading && !kpis} />

      {/* Filters */}
      <SignalFilterBar
        facets={facets}
        filters={filters}
        onChange={onFilterChange}
        onReset={onReset}
        resultCount={data?.total}
      />

      {/* Results */}
      {error ? (
        <ErrorState message={error} onRetry={load} supportTopic="signals" />
      ) : loading && !signals.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-64 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 animate-pulse" />
          ))}
        </div>
      ) : signals.length === 0 ? (
        <EmptyState
          icon={Info}
          title="No signals match these filters"
          body="Try clearing a filter or widening the region and sector. Signals are derived from public-company evidence and refresh in the background — new opportunities appear as the data updates."
          cta={{ label: 'Clear filters', onClick: onReset }}
        />
      ) : (
        <>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <ArrowDownWideNarrow size={13} />
            Ranked by signal strength, freshness and relevance{data?.cached ? ' · cached' : ''}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {signals.map((s, i) => (
              <SignalCard
                key={s.id}
                signal={s}
                mode={mode}
                rank={i + 1}
                onOpen={(sig) => setSelectedId(sig.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Evidence slide-over */}
      {selectedId && (
        <SignalEvidencePanel
          signalId={selectedId}
          mode={mode}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
