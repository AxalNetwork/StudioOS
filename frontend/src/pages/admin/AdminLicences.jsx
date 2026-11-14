// Territory licences — the HQ ledger for the subsidiary model.
//
// Design handoff: Admin · Super.dc.html, "Licences" nav row and the five-step
// issue flow (Entity → Territory → Seats → Terms → Activate). Recreated
// natively in the admin shell like AdminLpApplications and AdminExploring,
// rather than ported as a standalone page, so it inherits auth, nav and dark
// mode.
//
// WHAT THIS IS. The ledger: who holds a licence, over which countries, on what
// terms, until when. Migration 187 + routes/admin_licences.ts.
//
// WHAT IT IS NOT, AND WHAT THAT COSTS ON SCREEN. It is not the tenancy SCOPE.
// No account carries a licence, so nothing here can say how many seats are
// used, how many accounts a subsidiary has, or what revenue it generated —
// three of the canvas's headline numbers. Those are shown as unavailable with
// the reason, not as zero and not as an estimate: "0 of 325 seats used" is a
// false statement about a real business, and a plausible-looking dashboard is
// exactly how a false number gets quoted in a board meeting.
//
// TWO RULES THE CANVAS IS RIGHT ABOUT, AND WHICH THE UI MUST NOT SOFTEN:
//
//   1. A territory conflict is REFUSED, not flagged. The canvas: "a conflict
//      found after signature is an amendment to two contracts, found here it
//      is one click." The picker will not let a held country be selected.
//   2. Suspension does not release territory. A suspended holder still blocks
//      its countries; releasing them is a termination. The status chip says so
//      explicitly, because the intuition runs the other way.
//
// D110 — THE COVERAGE MAP IS DRAWN, AS A 27-CELL GRID. The refusal that stood
// here said a map was "presentation of the same data the territory list
// already carries", which was true of a map of what is HELD and missed what
// the canvas asks for: the white space. A list of holders cannot show which
// countries are still available, and that is the question H2 exists to answer.
// A grid rather than a choropleth because the shape of a country carries no
// information here and a projection is a large dependency for none.
//
// Still not reproduced: the token P&L and the per-subsidiary health grid. Both
// need account attribution that does not exist, and inventing the numbers
// under them is the thing this file refuses.
//
// D4819 (#4819), BUILD PART 1 — THE LEDGER AS AN OPERATING CONSOLE. Licences
// v2 boards L00 to L02 and L19. With no licence the page is the true zero
// state (`licences/LedgerZero.jsx`): "No licences have been issued" and Issue
// first licence lead, and search, the kind filter, the status filter and the
// renewal pipeline are not drawn. Once a licence exists: the counts line, a
// Needs HQ summary whose items filter the table (`?needs=`), and the
// nine-column ledger (`licences/LedgerTable.jsx`) whose rows deep-link to
// `/admin/licences/:uid/:section`. A licence opens as its own view in place
// of the ledger. The two rules above still hold; they are said where they
// apply — the territory step, the suspend and terminate dialogs, the coverage
// grid's legend — and no longer in the ledger's header.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useRecordCrumb from './useRecordCrumb';
import { RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { licenceLedgerApi } from '../../lib/api/licenceLedger';
import { reportError } from '../../lib/log';
import { RailFrame, Unreadable, WorkerRail } from '../../ui';
import { DEFAULT_TAB, LICENCE_TABS, kindFromParam, ledgerSelection, tabFromParam } from './licenceNavModel';
import {
  LEDGER_STATUSES, countsLine, filterByNeeds, ledgerIsEmpty, needsFromParam, needsSummary, needsToParam, statusFromParam, tabForSection,
} from './licenceLedgerModel';
import { UNAVAILABLE } from './licences/licenceShared';
import { Coverage } from './licences/Coverage';
import { Detail } from './licences/LicenceDetail';
import { CountsAndNeeds, LedgerTable } from './licences/LedgerTable';
import { CoverageLine, LedgerZero, SeatUtilisation } from './licences/LedgerZero';
import { FamilyChips, RegistryLedger } from './licences/RegistryLedger';
import { familyFromParam, familyToParam } from './licenceRegistryModel';

// #4707 — re-exported for the tests and pages that import it from here.
export { TerritoryEditor } from './licences/TerritoryEditor';

const KIND_FILTERS = [
  ['all', 'All'],
  ['subsidiary', 'Axal'],
  ['white_label', 'White-label'],
];

/** How long the search box waits after a keystroke before it asks the server. */
const SEARCH_DEBOUNCE_MS = 300;

/** How many of the loaded licences' request counts are read at once. */
const REQUEST_READS_AT_ONCE = 4;

/** No licence named in the URL: the ledger is shown and nothing is selected. */
const NO_SELECTION = Object.freeze({ sel: null, finding: false, settle: false });

/** The time a read answered, as the ledger's freshness line says it. */
const readClock = (d) => `${d.toISOString().slice(11, 16)} UTC`;

export default function AdminLicences() {
  // #4700 — ONE PAGE OF THE LEDGER, read from the server with its search and
  // kind filter; `data.total` is every match. The coverage grid and renewal
  // pipeline read `summary`, which is over every licence, so they are right
  // whichever page is open.
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [held, setHeld] = useState([]);
  const [heldUnreadable, setHeldUnreadable] = useState(false);
  // D4707 — the licence, its tab and the kind filter live in the URL, so a
  // link reopens the same licence on the same tab. Choosing a licence pushes
  // a history entry; reconciling one a filter hid replaces it.
  const [params, setParams] = useSearchParams();
  const kindFilter = kindFromParam(params.get('kind'));
  const wanted = params.get('licence');
  const setParam = useCallback((patch, { replace = false } = {}) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '' || (k === 'kind' && v === 'all')) next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace });
  }, [setParams]);
  const setKindFilter = (k) => setParam({ kind: k });
  // D5060 (#5060, part 3) — the licence family (board L36). Operator / territory is this ledger; All and the four
  // user families are the registry (`licences/RegistryLedger.jsx`). `?holder=` narrows the registry to one holder.
  const family = familyFromParam(params.get('family'));
  const holderParam = params.get('holder');
  const [holderName, setHolderName] = useState(null);
  const [familyCounts, setFamilyCounts] = useState(null);
  const setFamily = (k) => setParam({ family: familyToParam(k), holder: null });
  // D4819 — the status filter runs on the server (`?status=`); the Needs HQ
  // items filter the loaded rows (`?needs=`). Both are in the URL, so a
  // filtered ledger is a link.
  const statusFilter = statusFromParam(params.get('status'));
  const needs = needsFromParam(params.get('needs'));
  const toggleNeed = (k) => setParam({ needs: needsToParam(needs.includes(k) ? needs.filter((x) => x !== k) : [...needs, k]) });
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  // D4707 — the filters the loaded page was read for. Until the page for the
  // current filters has arrived, the rows on screen are the old filter's, and
  // reconciling against them would move the selection for the wrong reason.
  const [dataFor, setDataFor] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ licence_ref: '', legal_entity_name: '', brand_name: '', kind: 'subsidiary' });
  const [err, setErr] = useState('');
  // #4700: `data.items` is the server's page for the current search and kind,
  // so it is exactly the rows the list draws.
  const allItems = Array.isArray(data?.items) ? data.items : [];
  // The server applies the kind and the search (#4700), so the loaded rows
  // are already the visible ones.
  const visible = allItems;
  const filters = useMemo(() => ({ q: search, kind: kindFilter === 'all' ? '' : kindFilter, status: statusFilter, limit: 50 }), [search, kindFilter, statusFilter]);
  // Never the hidden row (D4707, over #4700's paged ledger): see
  // `ledgerSelection`. `ready` means the loaded page is the one for the
  // current search and kind, so the rows on screen are the filter's own.
  const ready = Boolean(data) && data !== UNAVAILABLE && dataFor === filters && query.trim() === search;
  // D4819 — the ledger is its own view: with no licence named nothing is
  // opened (the first row used to open by default). A named licence is looked
  // for by D4707's rule; one that is not in the ledger once every page is read
  // sends the page back to the ledger and says so, rather than opening a
  // different licence on a view where no list shows why.
  const nav = wanted
    ? ledgerSelection({ wanted, visible, ready, hasMore: Boolean(data?.next_cursor) })
    : NO_SELECTION;
  const missing = Boolean(wanted) && nav.settle && nav.sel !== wanted;
  const { sel, finding, settle } = missing ? { sel: null, finding: false, settle: true } : nav;
  const [notFound, setNotFound] = useState(false);
  useEffect(() => { if (missing) setNotFound(true); }, [missing]);
  useEffect(() => {
    if (settle && sel !== wanted) setParam({ licence: sel }, { replace: true });
  }, [settle, sel, wanted, setParam]);
  // Opening a licence the filter hides (a coverage cell, a link from another
  // licence) widens the filter rather than opening a row nobody can see.
  const setSel = (uid) => {
    const shown = visible.some((l) => l.uid === uid);
    if (shown) { setParam({ licence: uid }); return; }
    // Hidden by the search or the kind: clear both, then the paging above
    // finds it if it is past the first page.
    setQuery('');
    setParam({ licence: uid, kind: 'all' });
  };
  // A row's link is a real deep link (`/admin/licences/:uid/:section`). A plain
  // click opens it here, keeping the page; a modified click is the browser's.
  const openRow = (e, uid, section) => {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0)) return;
    e?.preventDefault?.();
    const t = section ? tabForSection(section, LICENCE_TABS.map((x) => x.key)) : null;
    setNotFound(false);
    setParam({ licence: uid, tab: t && t !== DEFAULT_TAB ? t : null });
  };
  const closeLicence = (e) => { e?.preventDefault?.(); setNotFound(false); setParam({ licence: null, tab: null }); };
  // D775 (#2101): the licence open in the detail pane is the rail's record.
  const open = allItems.find((l) => l.uid === sel) || null;
  const tab = tabFromParam(params.get('tab'), open?.kind).key;
  useRecordCrumb(open ? (open.brand_name || open.licence_ref) : null, 'licence', open?.uid);

  // The search waits for the typing to stop, so one search is one request.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Each read carries its own sequence number: a slow answer to an older
  // search never replaces a newer one.
  const seq = React.useRef(0);
  const [readAt, setReadAt] = useState(null);
  const loadPage = useCallback(() => {
    const mine = ++seq.current;
    return licenceLedgerApi.page(filters)
      .then((d) => {
        if (mine !== seq.current) return;
        setData(d);
        setDataFor(filters);
        setReadAt(new Date());
      })
      .catch((e) => { if (mine === seq.current) { reportError('licences_failed', e); setData(UNAVAILABLE); } });
  }, [filters]);
  // D4819 — each loaded licence's open requests, counted by the same read the
  // detail's panel makes (`limit=1`, so only the total crosses). `{ ok, total }`
  // per uid, `{ ok: false }` when it could not be read: unknown, never none.
  const [reads, setReads] = useState({});
  const readGen = useRef(0);
  const asked = useRef(new Set());
  const readRequests = useCallback((uids) => {
    const gen = readGen.current;
    const queue = uids.filter((u) => !asked.current.has(u));
    queue.forEach((u) => asked.current.add(u));
    const next = () => {
      const uid = queue.shift();
      if (!uid) return Promise.resolve();
      return licenceLedgerApi.requests(uid, { limit: 1 })
        .then((r) => (r && r.available !== false && Number.isFinite(Number(r.total)) ? { ok: true, total: Number(r.total) } : { ok: false }))
        .catch((e) => { reportError('licence_requests_count_failed', e); return { ok: false }; })
        .then((read) => { if (gen === readGen.current) setReads((cur) => ({ ...cur, [uid]: read })); })
        .then(next);
    };
    for (let i = 0; i < REQUEST_READS_AT_ONCE; i += 1) next();
  }, []);
  const retryRequests = (uid) => {
    asked.current.delete(uid);
    setReads((cur) => { const n = { ...cur }; delete n[uid]; return n; });
    readRequests([uid]);
  };
  const load = useCallback(() => {
    readGen.current += 1;
    asked.current = new Set();
    setReads({});
    const ledger = loadPage();
    licenceLedgerApi.summary()
      .then(setSummary)
      .catch((e) => { reportError('licence_summary_failed', e); setSummary(UNAVAILABLE); });
    api.licenceTerritories()
      .then((d) => { setHeld(d?.items || []); setHeldUnreadable(false); })
      .catch((e) => { reportError('licence_territories_load_failed', e); setHeldUnreadable(true); });
    return ledger;
  }, [loadPage]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  // A new search or kind re-reads the first page; the summary does not change with it.
  const first = React.useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } loadPage(); }, [loadPage]);
  const loadMore = useCallback(() => {
    if (!data?.next_cursor) return;
    const mine = seq.current;
    setLoadingMore(true);
    licenceLedgerApi.page({ ...filters, cursor: data.next_cursor })
      .then((d) => {
        if (mine !== seq.current) return;
        setData((cur) => ({ ...d, items: [...(cur?.items || []), ...(d?.items || []).filter((l) => !(cur?.items || []).some((c) => c.uid === l.uid))] }));
      })
      .catch((e) => reportError('licences_more_failed', e))
      .finally(() => setLoadingMore(false));
  }, [data, filters]);
  // D4707 — a licence the URL names that is not on the loaded page yet is
  // looked for by reading the next page, so a link past the first page still
  // reopens it. The selection waits meanwhile (see `sel`).
  useEffect(() => {
    if (finding && !loadingMore) loadMore();
  }, [finding, loadingMore, loadMore]);
  // The ledger's rows read their request counts; a licence open on its own does not need them.
  useEffect(() => {
    if (!wanted && Array.isArray(data?.items) && data.items.length) readRequests(data.items.map((l) => l.uid));
  }, [data, wanted, readRequests]);

  async function create(e) {
    e.preventDefault();
    setErr('');
    try {
      const payload = {
        licence_ref: form.licence_ref,
        legal_entity_name: form.legal_entity_name,
        brand_name: form.brand_name,
        // Step 1 of H26. Migration 279 gave the ledger its kind column, so the
        // refusal that used to sit above this is gone rather than reworded:
        // the reason it gave stopped being true.
        kind: form.kind,
      };
      const r = await api.licenceCreate(payload);
      setCreating(false);
      setForm({ licence_ref: '', legal_entity_name: '', brand_name: '', kind: 'subsidiary' });
      // Selected only once the ledger holds it, or reconciliation would move
      // the selection off a row the list has not drawn yet.
      await load();
      setParam({ licence: r.uid, kind: kindFilter === 'all' || kindFilter === payload.kind ? kindFilter : 'all' });
    } catch (e2) {
      reportError('licence_create_failed', e2);
      setErr(e2?.message || 'Could not create the licence.');
    }
  }


  // D775 (#2101): H1 drew no rail. Licences is HQ-only (`hqOnly`), so the rail is HQ's.
  const rail = <WorkerRail workspace="Licences" role="super_admin" note="Eadwyn reads the licence ledger on this page and changes nothing in it." data-testid="hq-licences-rail" />;
  // D5060 — every family but Operator / territory is the registry, which this page's own reads do not feed.
  const familyChips = <FamilyChips family={family} counts={familyCounts} onChange={setFamily} />;
  if (family !== 'operator' && !wanted) {
    return (
      <RailFrame rail={rail} data-testid="hq-licences-page">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <header>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Licences</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">HQ’s record of every licence family: operator and territory licences, and the Founder, Investor, Operating Partner and Advisor licences held by people and entities.</p>
          </header>
          {familyChips}
          <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="registry-tools">
            <input
              type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search licences or holders" aria-label="Search licences or holders" data-testid="registry-search"
              className="min-h-[32px] w-full max-w-sm rounded-md border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>
          <RegistryLedger
            family={family} query={search}
            holder={holderParam ? { param: holderParam, name: holderName } : null}
            onHolder={(param, name) => { setHolderName(name); setParam({ holder: param }); }}
            onClearHolder={() => { setHolderName(null); setParam({ holder: null }); }}
            onCounts={setFamilyCounts}
          />
        </div>
      </RailFrame>
    );
  }
  if (!data) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  // D4819 — one title. The HQ strip above already says Licences › Ledger, so
  // the old "Territory licences" heading repeated it.
  const title = <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Licences</h1>;
  const lede = <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">HQ’s authoritative record of territory licences.</p>;
  if (data === UNAVAILABLE) {
    return (
      <RailFrame rail={rail} data-testid="hq-licences-page">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {title}
        <div className="mt-4">
          <Unreadable what="The licence ledger" claim="This is not a claim that no licences exist." onRetry={load} />
        </div>
      </div>
      </RailFrame>
    );
  }
  const filteredItems = data.items || [];
  const total = Number.isFinite(data.total) ? data.total : null;
  const filtered = Boolean(search) || kindFilter !== 'all' || Boolean(statusFilter);
  const summaryOk = summary && summary !== UNAVAILABLE ? summary : null;
  const empty = ledgerIsEmpty({ total, filtered, summaryTotal: summaryOk ? Number(summaryOk.counts?.total) : null });
  const counts = summaryOk ? countsLine(summaryOk.counts) : null;
  const needItems = needsSummary(filteredItems, reads);
  const rows = filterByNeeds(filteredItems, reads, needs);
  const coverageGrid = (withRenewals) => (summaryOk
    ? (withRenewals
      ? <Coverage items={summary.coverage} renewals={summary.renewals} onOpen={setSel} />
      : <Coverage items={summary.coverage} onOpen={setSel} />)
    : null);

  const createForm = (
    <>
      {creating && (
        <form onSubmit={create} className="mt-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3" data-testid="licence-kind">
            <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-500">Kind</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {[
                ['subsidiary', 'Axal subsidiary'],
                ['white_label', 'White-label operator'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, kind: id }))}
                  aria-pressed={form.kind === id}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    form.kind === id
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200'
                      : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
              {form.kind === 'white_label'
                ? 'Same subsidiary console, their brand, no HQ brand desk. Members land on a platform host at activation; their admin binds a custom one later, in Settings → Domain. Super Admin stays on axal.vc.'
                : 'Axal-branded territory. They still bind their own host in Admin Settings → Domain. Super Admin stays on axal.vc and app.axal.vc.'}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <input className="rounded-md border border-gray-300 px-3 py-2 text-sm uppercase dark:border-gray-700"
              placeholder="Reference, e.g. AXL-005" required aria-label="Licence reference"
              value={form.licence_ref} onChange={(e) => setForm((f) => ({ ...f, licence_ref: e.target.value }))} />
            <input className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
              placeholder="Legal entity name" required aria-label="Legal entity name"
              value={form.legal_entity_name} onChange={(e) => setForm((f) => ({ ...f, legal_entity_name: e.target.value }))} />
            <input className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
              placeholder="Brand name in product" aria-label="Brand name in product"
              value={form.brand_name} onChange={(e) => setForm((f) => ({ ...f, brand_name: e.target.value }))} />
          </div>
          {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
          <button
            type="submit"
            className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create draft
          </button>
          <p className="mt-2 text-[11px] text-gray-500">
            A new licence starts as a draft holding no territory. It cannot be activated until it
            has a country, seats, terms and a renewal date.
          </p>
        </form>
      )}
    </>
  );

  // ── A licence, open on its own (the detail slice redraws it to the canvas) ──
  if (wanted) {
    return (
      <RailFrame rail={rail} data-testid="hq-licences-page">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <nav aria-label="Breadcrumb" className="text-xs font-semibold text-gray-500 dark:text-gray-400" data-testid="licence-breadcrumb">
          <a href="/admin/licences" onClick={closeLicence} className="hover:underline">Licences</a>
          {' / '}
          <span aria-current="page" className="text-gray-900 dark:text-gray-100">{open ? (open.brand_name || open.licence_ref) : 'Licence'}</span>
        </nav>
        {heldUnreadable && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Territory holdings could not be read, so overlap checks against other licences are unavailable until you retry.
          </div>
        )}
        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          {sel ? (
            <Detail
              key={sel} uid={sel} held={held} onChanged={load} onOpenLicence={(u) => setSel(u)}
              tab={tab} onTab={(t) => setParam({ tab: t === DEFAULT_TAB ? null : t })}
            />
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">{finding || !ready ? 'Finding that licence in the ledger…' : 'That licence is not in the ledger.'}</p>
          )}
        </div>
      </div>
      </RailFrame>
    );
  }

  // ── The true zero state (board L00) ──
  if (empty) {
    return (
      <RailFrame rail={rail} data-testid="hq-licences-page">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>{title}{lede}</div>
          <button type="button" onClick={() => setCreating((v) => !v)}
            className="min-h-[36px] rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700">
            {creating ? 'Cancel' : 'Issue first licence'}
          </button>
        </header>
        {createForm}
        {familyChips}
        {notFound && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status" data-testid="licence-not-found">
            That licence is not in the ledger.
          </p>
        )}
        <LedgerZero onIssue={() => setCreating(true)} />
        <CoverageLine items={summaryOk?.coverage} unavailable={summary === UNAVAILABLE} onRetry={load}>
          {coverageGrid(false)}
        </CoverageLine>
        {data.seats_used_available === false && <SeatUtilisation />}
      </div>
      </RailFrame>
    );
  }

  // ── The populated ledger (boards L01 and L02) ──
  const more = Boolean(data.next_cursor);
  return (
    <RailFrame rail={rail} data-testid="hq-licences-page">
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>{title}{lede}</div>
        <div className="flex flex-wrap items-center gap-2">
          {readAt && (
            <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400" data-testid="licence-freshness">
              HQ ledger · read {readClock(readAt)}
            </span>
          )}
          <button type="button" onClick={load} aria-label="Refresh the ledger" data-testid="licence-refresh"
            className="grid h-8 w-8 place-items-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setCreating((v) => !v)}
            className="min-h-[36px] rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700">
            {creating ? 'Cancel' : 'New licence'}
          </button>
        </div>
      </header>
      {createForm}
      {familyChips}
      {notFound && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status" data-testid="licence-not-found">
          That licence is not in the ledger, or the search, kind or status shown hides it.
        </p>
      )}

      <CountsAndNeeds
        counts={counts} countsUnavailable={summary === UNAVAILABLE} onRetry={load}
        needs={needItems} chosen={needs} onToggle={toggleNeed}
        scope={more ? `on the ${filteredItems.length} loaded of ${total ?? '?'}` : null}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="licence-tools">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by reference, brand, entity or country code"
          aria-label="Search licences"
          data-testid="licence-search"
          className="min-h-[32px] w-full max-w-sm rounded-md border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
        <div className="flex flex-wrap gap-1.5" data-testid="licence-kind-filter">
          {KIND_FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setKindFilter(id)}
              aria-pressed={kindFilter === id}
              className={`min-h-[32px] rounded-full border px-3 text-xs font-medium ${
                kindFilter === id
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-800 dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-200'
                  : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={statusFilter} onChange={(e) => setParam({ status: e.target.value })}
          aria-label="Status" data-testid="licence-status-filter"
          className="min-h-[32px] rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
        >
          <option value="">Every status</option>
          {LEDGER_STATUSES.map(([k, word]) => <option key={k} value={k}>{word.replace(/^./, (c) => c.toUpperCase())}</option>)}
        </select>
      </div>

      {heldUnreadable && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Territory holdings could not be read, so overlap checks against other licences are unavailable until you retry.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-gray-700" data-testid="licence-no-match">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {needs.length
              ? 'No loaded licence matches the Needs HQ items chosen. Clear them to see every row.'
              : 'No licences match this search, kind or status. Clear the search and switch to All to see every row in the ledger.'}
          </p>
        </div>
      ) : (
        <LedgerTable
          rows={rows} reads={reads} onOpen={openRow} onRetryRequests={retryRequests}
          footer={(
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-2.5 font-mono text-[12px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
              <span data-testid="licence-list-count">
                {needs.length
                  ? `${rows.length} of ${filteredItems.length} loaded need HQ`
                  : total !== null ? `Showing ${filteredItems.length} of ${total}` : `Showing ${filteredItems.length}`}
              </span>
              {more && (
                <button
                  type="button" onClick={loadMore} disabled={loadingMore} data-testid="licence-list-more"
                  className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {loadingMore ? 'Loading…' : 'Show more'}
                </button>
              )}
            </div>
          )}
        />
      )}

      {/* The coverage matrix and the renewal pipeline, behind the one line. A
          held cell opens its licence through `setSel`, the same selector the
          rows use, so a click on a country and on its row land in one place. */}
      <CoverageLine items={summaryOk?.coverage} unavailable={summary === UNAVAILABLE} onRetry={load}>
        {coverageGrid(true)}
      </CoverageLine>
      {data.seats_used_available === false && <SeatUtilisation />}
    </div>
    </RailFrame>
  );
}
