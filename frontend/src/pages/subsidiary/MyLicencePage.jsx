import React, { useEffect, useState } from 'react';
import { Map, Users, Calendar, Percent, Building2, AlertTriangle, Loader2, History } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';

/**
 * My Licence — /admin/my-licence. The subsidiary administrator's own view.
 *
 * A subsidiary admin is not a super admin: they run one territory under a
 * licence HQ issued them, and the design gives them their own dashboard rather
 * than a filtered copy of HQ's. This is that dashboard's honest half.
 *
 * WHAT IT DOES NOT SHOW, and why the page says so in a panel rather than
 * leaving dashes for the reader to interpret. The Admin · Subsidiary canvas
 * puts seats USED against seats licensed, plus queues of LP applications,
 * referrals, cohort applications and moderation, all scoped to the territory.
 * Every one of those needs each account to name the licence it belongs to.
 * Migration 187 built the licence LEDGER and was explicit that it is not the
 * tenancy SCOPE; migration 190 added who ADMINISTERS a licence, which is an
 * identity, not a filter. So nothing is attributable to a territory yet.
 *
 * Seats LICENSED is in the ledger, and is shown. Seats used is not, and the
 * server says so in `derived_metrics_available` rather than sending a zero
 * this page would have to guess the meaning of — the same rule the fund
 * analytics follow.
 *
 * Everything on this page is read-only. HQ writes licences; a holder reading
 * their own terms is the whole feature.
 */

const fmtMoney = (cents, currency) => {
  if (cents == null) return 'Not recorded';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'EUR' })
      .format(Number(cents) / 100);
  } catch { return `${(Number(cents) / 100).toLocaleString()} ${currency || ''}`.trim(); }
};
// Basis points, not a float — see migration 187. 3500 → "35%".
const fmtBps = (bps) => (bps == null ? 'Not recorded' : `${(Number(bps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`);
const fmtDate = (v) => (v ? String(v).slice(0, 10) : 'Not recorded');

const STATUS_TONE = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  suspended: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  terminated: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  pending_activation: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const SEAT_LABEL = {
  founder: 'Founder', investor: 'Investor / LP', advisor: 'Advisor', partner: 'Service Partner',
};

function Panel({ icon: Icon, title, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {Icon && <Icon size={15} className="text-violet-600" />} {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }) {
  const missing = value === 'Not recorded';
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={missing
        ? 'italic text-gray-400 dark:text-gray-500'
        : 'font-medium text-gray-900 tabular-nums dark:text-gray-100'}>{value}</span>
    </div>
  );
}

export default function MyLicencePage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.myLicence()
      .then(setData)
      .catch((e) => {
        // 404 is "you administer none", not a failure. The distinction matters:
        // one is an empty state, the other is a broken page.
        if (e?.status === 404) setData({ none: true });
        else { reportError(e); setErr(e?.message || 'Could not load your licence'); }
      });
  }, []);

  if (err) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle size={15} className="mr-1.5 -mt-0.5 inline" />{err}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 p-16 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={15} className="animate-spin" /> Loading your licence…
      </div>
    );
  }

  if (data.none) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">My licence</h1>
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            You do not administer a territory licence.
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            HQ assigns licence administrators. If that should be you, ask them to add your
            account to the licence.
          </p>
        </div>
      </div>
    );
  }

  const l = data.licence || {};
  const seats = l.seats || {};

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{l.brand_name}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[l.status] || STATUS_TONE.draft}`}>
            {String(l.status || '').replace(/_/g, ' ')}
          </span>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {l.admin_role}
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {l.legal_entity_name} · licence {l.licence_ref}
        </p>
        {l.status_note && (
          <p className="mt-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {l.status_note}
          </p>
        )}
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <Panel icon={Map} title="Territories held">
          {(l.territories || []).length === 0 ? (
            <p className="text-sm italic text-gray-400 dark:text-gray-500">No territory is held.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {l.territories.map((cc) => (
                <span key={cc} className="rounded-md border border-gray-200 px-2 py-1 font-mono text-xs text-gray-800 dark:border-gray-700 dark:text-gray-200">
                  {cc}
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            A country belongs to one licence at a time. Suspension does not release it;
            only termination does.
          </p>
        </Panel>

        <Panel icon={Percent} title="Commercial terms">
          <Row label="Annual fee" value={fmtMoney(l.annual_fee_cents, l.currency)} />
          <Row label="Revenue share" value={fmtBps(l.revenue_share_bps)} />
          <Row label="Token split" value={fmtBps(l.token_split_bps)} />
          <Row label="Term" value={l.term_years ? `${l.term_years} years` : 'Not recorded'} />
        </Panel>

        <Panel icon={Calendar} title="Dates">
          <Row label="Starts" value={fmtDate(l.starts_on)} />
          <Row label="Renews" value={fmtDate(l.renews_on)} />
          {l.suspended_at && <Row label="Suspended" value={fmtDate(l.suspended_at)} />}
          {l.terminated_at && <Row label="Terminated" value={fmtDate(l.terminated_at)} />}
        </Panel>

        <Panel icon={Building2} title="Entity">
          <Row label="Legal entity" value={l.legal_entity_name || 'Not recorded'} />
          <Row label="Registered address" value={l.registered_address || 'Not recorded'} />
          <Row label="Signatory" value={l.signatory_name || 'Not recorded'} />
          <Row label="Title" value={l.signatory_title || 'Not recorded'} />
        </Panel>
      </div>

      <Panel icon={Users} title="Seats licensed">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {['founder', 'investor', 'advisor', 'partner'].map((k) => (
            <div key={k} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="text-xs text-gray-500 dark:text-gray-400">{SEAT_LABEL[k]}</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {seats[k] ?? 0}
              </div>
            </div>
          ))}
        </div>
        {data.derived_metrics_available === false && (
          <p className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-400">
            <strong className="font-semibold">Seats used is not shown.</strong>{' '}
            {data.derived_metrics_reason}
          </p>
        )}
      </Panel>

      <Panel icon={History} title="History">
        {(data.events || []).length === 0 ? (
          <p className="text-sm italic text-gray-400 dark:text-gray-500">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {data.events.map((e, i) => (
              <li key={`${e.created_at}-${i}`} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                <span className="text-gray-900 dark:text-gray-100">
                  {String(e.event).replace(/_/g, ' ')}
                  {e.note && <span className="ml-2 text-gray-500 dark:text-gray-400">{e.note}</span>}
                </span>
                <span className="shrink-0 tabular-nums text-xs text-gray-500 dark:text-gray-400">
                  {fmtDate(e.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Append-only. Nothing here is ever edited or removed — a contract dispute is exactly
          the case where an overwritten status is useless.
        </p>
      </Panel>
    </div>
  );
}
