import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Radar, RefreshCw, Sparkles, Info, ArrowDownWideNarrow } from 'lucide-react';
import { api } from '../lib/api';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import SignalCard from '../components/signals/SignalCard';
import SignalFilterBar from '../components/signals/SignalFilterBar';
import SignalKPIStrip from '../components/signals/SignalKPIStrip';
import SignalEvidencePanel from '../components/signals/SignalEvidencePanel';
import { AdvisorWorkspaceShell } from './advisor/AdvisorWorkspaceShell';
import ZoneToolbar from '../workspaces/ZoneToolbar';
import { Stat } from '../ui';
import { StatedLimit } from './advisor/expertise/kit';

/**
 * SignalsPage — "Public-market evidence for what to build next".
 *
 * A founder decision-support dashboard (NOT a trading terminal): a top filter
 * row, a KPI strip, and a ranked list of founder-actionable signal cards, with
 * a right-hand evidence slide-over for deeper inspection. The same engine backs
 * Founder mode ("what should I build next?") and Advisor mode ("what should I
 * point founders toward?"); the mode toggle changes ordering + copy only.
 */
/**
 * `embedded` — set by `workspaces/ResearchWorkspace`, which already draws the
 * breadcrumb, the h1, the zone pills and the Worker AI rail around this page.
 *
 * IT ALSO HAD TO START PASSING `user`, AND THAT WAS THE REAL BUG. This
 * component derives `mode` from `user?.role`, and the Research workspace
 * mounted it with neither prop. `user` was therefore `undefined` on that route
 * for EVERY role, `mode` fell to `'founder'` unconditionally, and an advisor at
 * /research/markets got the founder ordering, the founder "Build angle" copy,
 * no advisor helper strip, and no `advisor_note` on any card — a field the
 * engine has been returning all along, seed rows included. `isAdmin` was false
 * for admins on the same route, hiding Refresh. Only /signals passed `user`,
 * which is why the advisor view appeared to work when tested there.
 */
/**
 * `zoneActions` is a render prop, called with the signals on screen.
 * `/research/markets` is one route for four licences whose zone actions differ,
 * so the caller decides what the row says and this page renders it. `/signals`
 * passes nothing and gets nothing. See `workspaces/zoneActionsByRole.js`.
 */
const AGE_WINDOWS = {
  advisor: { ageing: 30, stale: 120 },
  partner: { ageing: 30, stale: 90 },
};

/**
 * THE CANVAS'S STAT STRIP, and the two licences that can draw one.
 *
 * Every Markets artboard specifies four tiles, and the four sets do not agree:
 *
 *   founder  Saved analyses · Sources · Confidence · Excluded input
 *   investor Theses · Sourced from active · Excluded input · Last refreshed
 *   advisor  Current · Stale · Sectors covered · Net revenue retention (nr)
 *   partner  Attachable now · Stale · Widest range · Retainer rate (nr)
 *
 * Founder's and investor's eight tiles are all downstream of the same missing
 * thing: a SAVED DEEP-DIVE — an analysis or a thesis, kept with its method, its
 * sources and its run date. Nothing stores one. This page reads a signals feed,
 * which is a different object: evidence gathered on a schedule, not a piece of
 * work someone saved. So those two licences state the absence once, in the
 * sentence below, rather than drawing four tiles that would each read "Not
 * recorded" — the rule D56 records and `LibraryZone` established.
 *
 * Advisor and partner open with an AGE BAND, and that one is real. `ageInDays`
 * already buckets every signal against `AGE_WINDOWS[role]`, which are the
 * artboards' own `AGE_AT`/`STALE_AT` constants transcribed, and the zone's
 * header chips already filter on exactly those bands. A tile that counts what a
 * chip will return is reading the rows the chip reads. Their other two tiles are
 * about a curated figures register — a source and a run date per figure — which
 * does not exist here, and the fourth is marked `nr:true` on the artboard
 * itself, so the canvas already draws it as "Not recorded".
 *
 * The labels are per licence because the artboards' are. `Current` and
 * `Attachable now` count the same band and ask different questions of it, and
 * flattening them to one word would answer the wrong one on one of the two.
 */
const MARKETS_STRIP = {
  advisor: {
    fresh: { label: 'Current', note: (w) => `newest evidence within ${w.ageing} days` },
    stale: { label: 'Stale', note: (w) => `nothing dated inside ${w.stale} days` },
    gaps: [
      { label: 'Sectors covered', note: 'the feed is not scoped to your declared sectors, and nothing here reads Expertise · Profile' },
      { label: 'Net revenue retention', note: 'the artboard marks this one unrecorded too — no source covers enough companies' },
    ],
  },
  partner: {
    fresh: { label: 'Attachable now', note: (w) => `newest evidence within ${w.ageing} days` },
    stale: { label: 'Stale', note: (w) => `nothing dated inside ${w.stale} days` },
    gaps: [
      { label: 'Widest range', note: 'a comparable price range needs a readings register with a range per row, and none is stored' },
      { label: 'Retainer rate', note: 'the artboard marks this one unrecorded too — it has never been run' },
    ],
  },
};

/**
 * How old a signal is, from its own evidence — or null when nothing is dated.
 *
 * NOT `updated_at`, WHICH LOOKS RIGHT AND IS NOT. The ingestion job computes one
 * timestamp per run and binds it to every row it touches, so that column would
 * sort every signal into the same bucket and any age filter over it would
 * return the whole feed or none of it. `evidence_items[].observed_at` is the
 * per-item date, and it is what the freshness score decays from.
 */
function ageInDays(signal) {
  let newest = null;
  for (const evidence of signal?.evidence_items || []) {
    const at = Date.parse(evidence?.observed_at || '');
    if (Number.isFinite(at) && (newest === null || at > newest)) newest = at;
  }
  return newest === null ? null : (Date.now() - newest) / 86400000;
}

export default function SignalsPage({ user, embedded = false, mode: modeProp = null, zoneActions, zoneFilters, role = 'founder' }) {
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  // Two different questions, so two props. `user` answers "who is this?" and
  // gates the admin-only Refresh. `mode` answers "which workspace am I in?"
  // and drives the ordering and the copy — a workspace that already knows the
  // role states it, rather than leaving this to re-derive it and disagree. It
  // would disagree today: an admin previewing the Advisor role gets an advisor
  // shell, but their own `user.role` is still `admin`, so the body underneath
  // would have ordered itself for a founder.
  const mode = modeProp
    || (String(user?.role || '').toLowerCase() === 'advisor' ? 'advisor' : 'founder');

  const [filters, setFilters] = useState({});
  // TWO DIFFERENT FILTER SURFACES ON ONE PAGE, and they are not rivals.
  // `filters` above is `SignalFilterBar`'s nine server-driven facets — region,
  // sector, signal type and the rest — sent to the API and narrowed there.
  // `zoneView` is the zone header row's, which the canvas draws above
  // everything and which asks one question the facets do not: how old is what I
  // am looking at. It runs here, over rows already loaded.
  const [zoneView, setZoneView] = useState('all');
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
      // eslint-disable-next-line no-console
      console.error('[SignalsPage] load failed:', e);
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

  // The age windows are the CANVAS'S OWN, per licence, transcribed rather than
  // chosen: `Pages · Advisor Research` declares `const STALE_AT = 120, AGE_AT =
  // 30` and `Pages · Partner Research` declares 90 and 30. Founder and investor
  // are absent because their artboards ask this zone for a saved deep-dive
  // instead, which nothing stores — their header row is prose, and no key here
  // is reachable for them.
  const window_ = AGE_WINDOWS[role];
  const visible = !window_ || zoneView === 'all' ? signals : signals.filter((s) => {
    const days = ageInDays(s);
    // An undated signal is in no age bucket and stays in `All` — the same call
    // the artboard makes for the figure whose source has no run date.
    if (days === null) return false;
    if (zoneView === 'current') return days <= window_.ageing;
    if (zoneView === 'ageing') return days > window_.ageing && days <= window_.stale;
    if (zoneView === 'stale') return days > window_.stale;
    return true;
  });
  const chooseZoneView = (key) => setZoneView((current) => (current === key ? 'all' : key));

  // COUNTED OVER `signals`, NEVER `visible`. `visible` is already narrowed by
  // the chip the reader has selected, so counting it would make `Current` read
  // zero the moment they clicked `Stale` — a tile that changes because you
  // looked at it is not reporting the population it claims to.
  const strip = embedded ? MARKETS_STRIP[role] : null;
  const bands = !strip || !window_ ? null : signals.reduce((acc, s) => {
    const days = ageInDays(s);
    // An undated signal is in no band, exactly as the chip filter treats it.
    if (days === null) acc.undated += 1;
    else if (days <= window_.ageing) acc.fresh += 1;
    else if (days > window_.stale) acc.stale += 1;
    else acc.ageing += 1;
    return acc;
  }, { fresh: 0, ageing: 0, stale: 0, undated: 0 });

  const content = (
    <div className="space-y-5 pb-10">
      {zoneActions && (
        <ZoneToolbar
          role={role}
          className="mb-3"
          filters={zoneFilters ? zoneFilters({ value: zoneView, onChange: chooseZoneView }) : []}
          actions={zoneActions(visible)}
        />
      )}
      {/* Header */}
      {mode !== 'advisor' && !embedded && <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
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
      </div>}

      {/* Data-provenance disclosure. `data_state` comes from the engine:
          'illustrative' means D1 holds no ingested signals yet and every card
          below is a curated example — this banner is the required honesty
          label for that state (audit: "wire the real pipeline or label as
          illustrative" — we did both). 'live' means every evidence line was
          fetched from a public source by an ingestion run. */}
      {data?.data_state === 'illustrative' && (
        <div
          data-testid="signals-illustrative-banner"
          className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 px-4 py-2.5 text-sm text-amber-900 dark:text-amber-200"
        >
          <Info size={15} className="mt-0.5 shrink-0 text-amber-500" />
          <span>
            <strong className="font-semibold">Illustrative examples.</strong>{' '}
            Live ingestion hasn&rsquo;t populated this environment yet, so these cards are
            curated examples of what a signal looks like — not live observations.
            {isAdmin
              ? ' Run Refresh to ingest real evidence from the public sources.'
              : ' An admin can switch this to live public-source data.'}
          </span>
        </div>
      )}

      {/* Advisor-mode helper strip */}
      {mode === 'advisor' && (
        <div className="flex items-start gap-2 rounded-lg bg-violet-50/60 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/40 px-4 py-2.5 text-sm text-violet-900 dark:text-violet-200">
          <Sparkles size={15} className="mt-0.5 shrink-0 text-violet-500" />
          <span>
            Advisor mode — signals ordered by how confidently you can point a founder toward them.
          </span>
        </div>
      )}

      {/* THE CANVAS'S STRIP, above the one this page already had. They are not
          rivals and neither is redundant: `SignalKPIStrip` answers how big this
          feed is and where it comes from — every one of its four tiles is
          sourced — and the strip below answers how much of it is still worth
          quoting. The bands are also the counts behind the header chips, so a
          reader can see a chip is empty before clicking it. */}
      {strip && bands && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label={strip.fresh.label}
            value={loading && !data ? undefined : bands.fresh}
            note={strip.fresh.note(window_)}
          />
          <Stat
            label={strip.stale.label}
            value={loading && !data ? undefined : bands.stale}
            note={strip.stale.note(window_)}
          />
          {strip.gaps.map((g) => (
            <Stat key={g.label} label={g.label} value="Not recorded" mono={false} note={g.note} />
          ))}
        </div>
      )}

      {embedded && !strip && (
        <StatedLimit>
          The canvas puts four figures here — a count of saved analyses, their
          sources, the confidence behind them and the input excluded for being
          too old — and an instrument card listing each one with its method and
          run date. All of it describes a saved deep-dive: a piece of work
          someone kept, with the method named and the date it was run. Nothing
          stores one. What this page reads is a signals feed, gathered on a
          schedule from public evidence, which is a different object — so the
          figures are stated here rather than drawn over rows that would not be
          answering the question the labels ask.
        </StatedLimit>
      )}

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
          {/* A zone view that finds nothing says so against the total, because
              an empty grid under a selected chip reads as "no signals match
              your facets" — a different and wrong answer. */}
          {visible.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              No signal here is in this age band. {signals.length} match your filters in total.
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {visible.map((s, i) => (
                <SignalCard
                  key={s.id}
                  signal={s}
                  mode={mode}
                  rank={i + 1}
                  onOpen={(sig) => setSelectedId(sig.id)}
                />
              ))}
            </div>
          )}
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

  if (mode === 'advisor') {
    return (
      <AdvisorWorkspaceShell
        eyebrow="Research"
        title="Know more than the room"
        description="Public-market evidence you can use to point founders toward the next useful question — with provenance intact."
        icon={Radar}
        rail={!embedded}
        embedded={embedded}
      >
        {content}
      </AdvisorWorkspaceShell>
    );
  }
  return content;
}
