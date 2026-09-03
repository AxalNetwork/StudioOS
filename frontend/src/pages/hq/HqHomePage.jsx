import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe, CircleAlert, RefreshCw, Landmark } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail } from '../../ui';
import { Unrecorded } from '../advisor/expertise/kit';

/**
 * HQ · Home — the whole business on one screen (Admin · Super canvas, H1).
 *
 * One request, `GET /api/admin/hq/overview`, and everything on this page is
 * either read from it or said to be not recorded. The canvas draws five
 * totals, a health card per subsidiary, an escalation queue and a licensing
 * feed; the store can answer some of each and the page says which.
 *
 * THE TENANT SWITCHER NARROWS THIS PAGE ONLY. "All subsidiaries ▾" filters
 * the cards and the feed over the payload already loaded and sends nothing
 * back. The read-only overlay that would scope the rest of the product to
 * one tenant is a separate feature (tenancyScope.ts); a switcher that changed
 * this page but nothing else while looking global would be the half-applied
 * scope UNRESOLVED_ITEMS U1 warns about, so it says so beside the control.
 *
 * ABSENT IS NOT ZERO. Accounts, revenue and queue depth PER SUBSIDIARY, seat
 * utilisation and escalations all render `<Unrecorded />` with the reason
 * the payload gives. A figure the payload lacks renders the same way — `num`
 * returns null for a missing value rather than defaulting it, which is the
 * difference between "0 accounts" and "not recorded". A failed request
 * renders as unreadable, never as an empty platform — `InvestorFundLanding`
 * is the in-repo precedent.
 */
const UNAVAILABLE = Symbol('unavailable');

const STATUS_TONE = {
  active: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900',
  suspended: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  pending_activation: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900',
  draft: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  terminated: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
};

const EVENT_LABEL = {
  created: 'Licence created',
  territory_changed: 'Territory changed',
  seats_changed: 'Seats changed',
  terms_changed: 'Terms changed',
  activated: 'Activated',
  suspended: 'Suspended',
  reinstated: 'Reinstated',
  renewed: 'Renewed',
  terminated: 'Terminated',
};

const titleCase = (s) => String(s || '').replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
const day = (v) => (v ? String(v).slice(0, 10) : null);
// A number, formatted — or null when there is no number. Never a default:
// a missing figure is Not recorded, not zero.
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());
const plural = (count, one, many) => (count === 1 ? one : many);

function Pill({ status }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.draft;
  return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${tone}`}>{titleCase(status)}</span>;
}

function Tile({ label, value, note, tone = 'text-axal-ink' }) {
  return (
    <Card>
      <div className="text-[9.5px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{label}</div>
      <div className={`mt-1.5 text-xl font-extrabold tracking-tight tabular-nums ${tone}`}>{value ?? <Unrecorded />}</div>
      {note && <div className="mt-1 text-[10.5px] text-axal-ink-3">{note}</div>}
    </Card>
  );
}

function Unreadable({ what, onRetry }) {
  return (
    <p className="flex items-center gap-2 text-[12px] text-red-700 dark:text-red-300" role="alert">
      <CircleAlert size={13} /> {what} could not be read. This is not a claim that none exist.
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-1 inline-flex items-center gap-1 underline">
          <RefreshCw size={11} /> Retry
        </button>
      )}
    </p>
  );
}

export default function HqHomePage() {
  const [data, setData] = useState(null);       // null = loading, UNAVAILABLE = failed
  const [tenant, setTenant] = useState('');     // '' = all subsidiaries; else a licence uid

  const load = useCallback(() => {
    setData(null);
    api.hqOverview().then(setData, (e) => { reportError('hq-home', e); setData(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const ready = data && data !== UNAVAILABLE;
  const licences = ready ? data.licences || [] : [];
  const selected = tenant ? licences.find((l) => l.uid === tenant) || null : null;
  const shown = selected ? [selected] : licences;
  const events = useMemo(() => {
    if (!ready) return [];
    const all = data.events || [];
    return selected ? all.filter((e) => e.licence_uid === selected.uid) : all;
  }, [ready, data, selected]);
  const renewals = useMemo(() => {
    if (!ready) return [];
    const all = data.renewals_soon || [];
    return selected ? all.filter((r) => r.uid === selected.uid) : all;
  }, [ready, data, selected]);

  const countries = ready ? data.countries_held || [] : [];
  const suspendedCount = ready ? (data.suspended || []).length : 0;
  const queue = ready ? data.queue : null;
  const accountsTotal = ready ? num(data.accounts?.total) : null;

  const rail = (
    <WorkerRail
      workspace="HQ"
      role="super_admin"
      stance="Read-only overview"
      note="This rail summarises the licence ledger and platform-wide account totals. It takes no action."
      coverage={ready ? [
        `${licences.length} ${plural(licences.length, 'licence', 'licences')} on the ledger`,
        `${countries.length} of 27 EU countries held`,
        accountsTotal === null ? 'Active accounts: not recorded' : `${accountsTotal} active accounts platform-wide`,
      ] : []}
      coverageNote={ready ? undefined : (data === UNAVAILABLE ? 'The overview could not be read.' : 'Loading the overview…')}
      unavailable={[
        // [title, detail] pairs: WorkerRail destructures each entry, so a bare
        // string would render as its first two characters.
        ['Per-subsidiary accounts, revenue and queue depth', 'No account names its licence yet (U1).'],
        ['Seat utilisation', 'Needs the same tenancy scope.'],
        ['Token P&L per subsidiary', 'Needs the same tenancy scope.'],
        ['Escalations', 'No subsidiary-to-HQ escalation exists on the platform.'],
      ]}
      data-testid="hq-home-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-home-page">
      <div className="min-w-0">
        {/* The HQ bar: the tenant switcher sits where a subsidiary's territory
            badge sits, because both answer "whose data am I looking at?". Here
            the honest answer is "everyone's", stated rather than left as the
            absence of a filter. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#881337] px-4 py-2.5 text-white">
          <label className="flex items-center gap-2 text-[12.5px] font-bold">
            <Globe size={15} aria-hidden="true" />
            <span className="sr-only">Narrow this page to one subsidiary</span>
            <select
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              disabled={!ready || licences.length === 0}
              className="rounded-md bg-white/15 px-2 py-1 text-[12.5px] font-bold text-white disabled:opacity-70"
              data-testid="hq-tenant-switcher"
            >
              <option value="" className="text-gray-900 dark:text-gray-100">All subsidiaries</option>
              {licences.map((l) => (
                <option key={l.uid} value={l.uid} className="text-gray-900 dark:text-gray-100">{l.brand_name} · {l.licence_ref}</option>
              ))}
            </select>
            {ready && (
              <span className="text-[11px] font-medium opacity-80 tabular-nums">
                {licences.length} {plural(licences.length, 'tenant', 'tenants')} · {countries.length} {plural(countries.length, 'country', 'countries')}
              </span>
            )}
          </label>
          <span className="rounded bg-white/15 px-2 py-0.5 text-[10px] font-bold tracking-[.05em]">AXAL VC HQ</span>
        </div>
        {selected && (
          <p className="mt-2 text-[11.5px] text-axal-ink-3">
            Narrowed to {selected.brand_name} on this page only. The rest of the product has no tenant scope yet,
            so nothing else changes.
          </p>
        )}

        <header className="mt-4">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
            <Landmark size={13} /> HQ · Home
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink">Platform</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-ink-2">
            {ready
              ? `${accountsTotal === null ? 'An unrecorded number of' : accountsTotal} active accounts across ${licences.length} ${plural(licences.length, 'licence', 'licences')} and ${countries.length} ${plural(countries.length, 'country', 'countries')}. `
              : 'The franchisor’s overview: every licence, every account, the licence trail. '}
            Per-subsidiary figures are not recorded until accounts carry a licence.
          </p>
        </header>

        {data === UNAVAILABLE && <div className="mt-4"><Unreadable what="The HQ overview" onRetry={load} /></div>}

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="Accounts" value={ready ? accountsTotal : null} note="active, platform-wide" />
          <Tile label="Seats licensed" value={ready ? num(data.seats_licensed) : null} note={<>utilised: <Unrecorded /></>} />
          <Tile label="MTD revenue" value={null} note="no subsidiary attribution" />
          <Tile
            label="Queue backlog"
            value={ready && queue?.available ? num(queue.open) : null}
            note={ready && queue?.available ? 'open + in progress, platform-wide' : 'tickets unreadable'}
            tone={ready && queue?.available && queue.open > 20 ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink'}
          />
          <Tile
            label="Suspended"
            value={ready ? num(suspendedCount) : null}
            // 'none' is a fact about the ledger; an unreadable overview is not
            // the same fact, and must not wear the green either.
            note={!ready ? 'unreadable' : suspendedCount ? data.suspended[0].brand_name : 'none'}
            tone={!ready ? 'text-axal-ink' : suspendedCount ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}
          />
        </div>

        <Card className="mt-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[14.5px] font-extrabold tracking-tight">Subsidiary health</h2>
            <span className="text-[11.5px] text-axal-ink-3">One card per licence</span>
          </div>
          {ready && licences.length === 0 && (
            <p className="text-[12.5px] text-axal-ink-2">
              No licences have been issued yet. The ledger is empty, which is a different fact from every
              subsidiary being healthy. <Link to="/admin/licences" className="underline">Issue the first licence →</Link>
            </p>
          )}
          {ready && shown.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="hq-subsidiary-cards">
              {shown.map((l) => (
                <div key={l.uid} className={`rounded-xl border p-3 ${l.status === 'suspended' ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20' : 'border-axal-line bg-axal-surface-2'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-extrabold tracking-tight">{l.brand_name}</span>
                    <Pill status={l.status} />
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-axal-ink-3">{l.licence_ref} · {l.territories.length ? l.territories.join(' · ') : 'no territory'}</div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-axal-line pt-2 text-[11px]">
                    <div><dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Seats licensed</dt><dd className="mt-0.5 font-bold tabular-nums">{num(l.seats_licensed) ?? <Unrecorded />}</dd></div>
                    <div><dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Renews</dt><dd className="mt-0.5 font-bold tabular-nums">{day(l.renews_on) || <Unrecorded />}</dd></div>
                    <div><dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Accounts</dt><dd className="mt-0.5"><Unrecorded /></dd></div>
                    <div><dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">MTD · backlog</dt><dd className="mt-0.5"><Unrecorded /></dd></div>
                  </dl>
                </div>
              ))}
            </div>
          )}
          {!ready && data !== UNAVAILABLE && <p className="text-[12px] text-axal-ink-3">Loading the ledger…</p>}
          <p className="mt-3 text-[11.5px] leading-relaxed text-axal-ink-3">
            Status, territory, seats licensed and renewal date are the ledger&apos;s own. Accounts, revenue and backlog per
            subsidiary need every account to name its licence; none does yet, so they are not recorded here rather than
            shown as zero.
          </p>
        </Card>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-[14.5px] font-extrabold tracking-tight">Escalations awaiting HQ</h2>
              <span className="text-[11.5px] text-axal-ink-3">Pushed up by subsidiaries</span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
              <Unrecorded /> — {ready ? data.escalations_reason : 'no escalation concept exists on the platform.'}{' '}
              The <Link to="/tickets" className="underline">ticket queue</Link> is platform-wide and is not one.
            </p>
          </Card>

          <Card className="border-amber-200 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/20">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-[14.5px] font-extrabold tracking-tight">Licensing events</h2>
              <span className="text-[11.5px] text-axal-ink-3">Renewals ≤ {ready ? data.renewals_within_days : 60}d and the trail</span>
            </div>
            {ready && renewals.length > 0 && (
              <ul className="mb-2 space-y-1.5" data-testid="hq-renewals">
                {renewals.map((rw) => (
                  <li key={rw.uid} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-[12px] dark:border-amber-900 dark:bg-gray-900">
                    <span className="font-bold">{rw.brand_name} renews</span>
                    <span className="font-mono text-[10.5px] text-amber-800 dark:text-amber-300">{day(rw.renews_on)}</span>
                  </li>
                ))}
              </ul>
            )}
            {ready && events.length === 0 && (
              <p className="text-[12px] text-axal-ink-3">No licence events {selected ? 'for this subsidiary' : 'recorded'} yet.</p>
            )}
            {ready && events.length > 0 && (
              <ul className="space-y-1" data-testid="hq-events">
                {events.map((e) => (
                  <li key={e.id} className="grid grid-cols-[92px_1fr] gap-2 text-[11.5px]">
                    <span className="font-mono text-[10px] text-axal-ink-3">{day(e.created_at)}</span>
                    <span><b>{EVENT_LABEL[e.event] || titleCase(e.event)}</b> · {e.brand_name}{e.note ? ` — ${e.note}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            {!ready && data !== UNAVAILABLE && <p className="text-[12px] text-axal-ink-3">Loading…</p>}
            <p className="mt-2"><Link to="/admin/licences" className="text-[11.5px] font-bold text-rose-800 underline dark:text-rose-300">View more · Licences →</Link></p>
          </Card>
        </div>
      </div>

      <div className="mt-6 lg:mt-0">{rail}</div>
    </div>
  );
}
