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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useRecordCrumb from './useRecordCrumb';
import { Globe, Users, FileText } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { licenceLedgerApi } from '../../lib/api/licenceLedger';
import { reportError } from '../../lib/log';
import { RailFrame, Unreadable, WorkerRail } from '../../ui';
import { DEFAULT_TAB, kindFromParam, ledgerSelection, tabFromParam } from './licenceNavModel';
import { UNAVAILABLE, STATUS_TONE, n0, Chip } from './licences/licenceShared';
import { Coverage } from './licences/Coverage';
import { Detail } from './licences/LicenceDetail';

// #4707 — re-exported for the tests and pages that import it from here.
export { TerritoryEditor } from './licences/TerritoryEditor';

const KIND_FILTERS = [
  ['all', 'All'],
  ['subsidiary', 'Axal'],
  ['white_label', 'White-label'],
];

/** How long the search box waits after a keystroke before it asks the server. */
const SEARCH_DEBOUNCE_MS = 300;

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
  const filters = useMemo(() => ({ q: search, kind: kindFilter === 'all' ? '' : kindFilter, limit: 50 }), [search, kindFilter]);
  // Never the hidden row (D4707, over #4700's paged ledger): see
  // `ledgerSelection`. `ready` means the loaded page is the one for the
  // current search and kind, so the rows on screen are the filter's own.
  const ready = Boolean(data) && data !== UNAVAILABLE && dataFor === filters && query.trim() === search;
  const { sel, finding, settle } = ledgerSelection({ wanted, visible, ready, hasMore: Boolean(data?.next_cursor) });
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
  const loadPage = useCallback(() => {
    const mine = ++seq.current;
    return licenceLedgerApi.page(filters)
      .then((d) => {
        if (mine !== seq.current) return;
        setData(d);
        setDataFor(filters);
      })
      .catch((e) => { if (mine === seq.current) { reportError('licences_failed', e); setData(UNAVAILABLE); } });
  }, [filters]);
  const load = useCallback(() => {
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

  if (!data) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  // D775 (#2101): H1 drew no rail. Licences is HQ-only (`hqOnly`), so the rail is HQ's.
  const rail = <WorkerRail workspace="Licences" role="super_admin" note="Eadwyn reads the licence ledger on this page and changes nothing in it." data-testid="hq-licences-rail" />;
  if (data === UNAVAILABLE) {
    return (
      <RailFrame rail={rail} data-testid="hq-licences-page">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Territory licences</h1>
        <div className="mt-4">
          <Unreadable what="The licence ledger" claim="This is not a claim that no licences exist." onRetry={load} />
        </div>
      </div>
      </RailFrame>
    );
  }
  const filteredItems = data.items || [];
  const total = Number.isFinite(data.total) ? data.total : null;
  const filtered = Boolean(search) || kindFilter !== 'all';

  return (
    <RailFrame rail={rail} data-testid="hq-licences-page">
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Territory licences</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Who holds a licence, over which countries, on what terms, until when. Two licences
            cannot hold the same country — the territory step refuses an overlap rather than
            recording one.
          </p>
        </div>
        <button type="button" onClick={() => setCreating((v) => !v)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {creating ? 'Cancel' : 'New licence'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" data-testid="licence-kind-filter">
        {KIND_FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setKindFilter(id)}
            aria-pressed={kindFilter === id}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              kindFilter === id
                ? 'border-indigo-600 bg-indigo-50 text-indigo-800 dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-200'
                : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by reference, brand, entity or country code"
          aria-label="Search licences"
          data-testid="licence-search"
          className="w-full max-w-md rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
      </div>

      {/* `setSel` is the same selector the licence rows below use, so a click on
          a held country and a click on its row land in exactly one place. */}
      {summary === UNAVAILABLE ? (
        <div className="mt-5">
          <Unreadable what="The coverage grid and renewal pipeline" claim="This is not a claim that no territory is held." onRetry={load} />
        </div>
      ) : summary ? (
        <Coverage items={summary.coverage} renewals={summary.renewals} onOpen={setSel} />
      ) : (
        <p className="mt-5 text-sm text-gray-500">Loading the coverage…</p>
      )}

      {heldUnreadable && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Territory holdings could not be read, so overlap checks against other licences are unavailable until you retry.
        </div>
      )}

      {data.seats_used_available === false && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
          <div className="flex items-start gap-1.5">
            <Globe size={14} className="mt-0.5 shrink-0 text-gray-500" />
            <span>{data.seats_used_reason}</span>
          </div>
        </div>
      )}

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

      {filteredItems.length === 0 ? (
        !filtered && total === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <FileText size={22} className="mx-auto text-gray-400" />
          <p className="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">No licences have been issued.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">
            This ledger starts empty. No subsidiary is seeded, because a licence is a signed
            contract with a real entity and inventing one would misrepresent the business.
          </p>
        </div>
        ) : (
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No licences match this search or kind. Clear the search and switch to All to see every row in the ledger.
          </p>
        </div>
        )
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
          <div className="space-y-1.5">
            {filteredItems.map((l) => (
              <button
                key={l.uid} type="button" onClick={() => setSel(l.uid)}
                aria-current={sel === l.uid ? 'true' : undefined}
                aria-label={`${l.brand_name}, ${l.licence_ref}, ${String(l.status).replace('_', ' ')}`}
                className={`w-full rounded-lg border p-3 text-left ${
                  sel === l.uid ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    {/* D198 / H28 — "a white-label row shows its public name and
                        its own mark, never the Axal wordmark". The mark on a ROW
                        is the operator's own colour, not their logo: a row is a
                        line of text and an image in it would either be too small
                        to identify or too big to be a row. A subsidiary gets no
                        swatch at all, because its brand is Axal's and drawing a
                        chip of it here would say the opposite. */}
                    {l.kind === 'white_label' && l.brand_kit?.primary_hex && (
                      <span
                        data-testid="licence-row-swatch"
                        aria-hidden="true"
                        className="inline-block h-3 w-3 shrink-0 rounded-sm border border-black/10"
                        style={{ backgroundColor: l.brand_kit.primary_hex }}
                      />
                    )}
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{l.brand_name}</span>
                  </span>
                  <Chip tone={STATUS_TONE[l.status]}>{l.status.replace('_', ' ')}</Chip>
                </div>
                <div className="mt-1 text-[11px] text-gray-500">
                  {l.licence_ref} · {l.territories.length ? l.territories.join(' ') : 'no territory'}
                </div>
                <div className="mt-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400">
                  {l.kind === 'white_label' ? 'White-label' : 'Axal subsidiary'}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500">
                  <Users size={11} /> {n0(l.seats_licensed)} seats
                </div>
              </button>
            ))}
            <div className="pt-1 text-[11px] text-gray-500" data-testid="licence-list-count">
              {total !== null ? `Showing ${filteredItems.length} of ${total}` : `Showing ${filteredItems.length}`}
            </div>
            {data.next_cursor && (
              <button
                type="button" onClick={loadMore} disabled={loadingMore} data-testid="licence-list-more"
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
              >
                {loadingMore ? 'Loading…' : 'Show more'}
              </button>
            )}
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            {sel ? (
              <Detail
                key={sel} uid={sel} held={held} onChanged={load} onOpenLicence={(u) => setSel(u)}
                tab={tab} onTab={(t) => setParam({ tab: t === DEFAULT_TAB ? null : t })}
              />
            ) : (
              <p className="text-sm text-gray-500">{finding ? 'Finding that licence in the ledger…' : 'Pick a licence.'}</p>
            )}
          </div>
        </div>
      )}
    </div>
    </RailFrame>
  );
}
