/**
 * D5757 (#5757, finding 16 of #4860) — HQ · Platform's scope switcher, and
 * the overview it draws under a subsidiary scope.
 *
 * THE SWITCHER IS LINKS. Platform draws no handler (D203, D4860): each scope
 * is an address, `/admin/platform` for HQ-wide and `?scope=<code>` for one
 * subsidiary, so a scope can be linked, reloaded and shared, and the page
 * still has no onClick. The list comes from `GET /admin/platform/scopes`; a
 * list that did not answer still offers HQ-wide and says it is unread.
 *
 * UNDER A SUBSIDIARY SCOPE the page draws only what D5786 reads for that
 * branch: its live health, its last stored check and its traffic, each with
 * when it was observed and where from. Scheduled jobs and dead letters are
 * named as unavailable for a subsidiary, with the read's reason. The
 * HQ-only signals and the consoles over them are not drawn, and the page says
 * which they are. Every state is a symbol and words; a missing figure is Not
 * recorded, never 0, and a scope with no reading is Unknown, never Healthy.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Unrecorded, Unreadable } from '../../ui';
import { Status, NeedsAttention } from './PlatformOverview';
import { STATUS } from './platformOverviewModel';
import { scopeHref, scopeHealth, signalRows, scopeAttention } from './platformScopeModel';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:focus-visible:outline-emerald-400';
const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const RULE = {
  Healthy: 'border-l-emerald-600 dark:border-l-emerald-400',
  Degraded: 'border-l-amber-500 dark:border-l-amber-400',
  Unknown: 'border-l-gray-400 dark:border-l-gray-500',
  Critical: 'border-l-red-600 dark:border-l-red-400',
  Reading: 'border-l-gray-300 dark:border-l-gray-600',
};
const OPTION = `flex min-h-[44px] items-center justify-between gap-3 rounded-lg px-3 py-2 text-[12.5px] hover:bg-gray-50 dark:hover:bg-gray-800 ${FOCUS}`;
const CURRENT = 'bg-emerald-50 font-bold text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200';

/**
 * The switcher. `scope` is the code in the address, or null for HQ-wide;
 * `options` is `scopeOptions(...)`. Keyed on the scope by its caller so it
 * closes once a link moves the page.
 */
export function ScopeSwitcher({ scope, options }) {
  const listed = options?.available ? options.options : [];
  const unlisted = scope && !listed.some((o) => o.code === scope);
  return (
    <nav aria-label="Platform scope" className="relative" data-testid="hq-platform-scope">
      <details className="group">
        <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 rounded-lg border border-axal-hairline bg-white px-3 text-[12px] font-bold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800 ${FOCUS}`} data-testid="hq-platform-scope-current">
          <span aria-hidden="true">◎</span>
          <span>Scope: {scope ? <>Subsidiary <span className="font-mono">{scope}</span></> : 'HQ-wide'}</span>
          <span aria-hidden="true" className="text-axal-faint group-open:rotate-180">▾</span>
        </summary>
        <div className="absolute right-0 z-20 mt-1 w-[min(320px,calc(100vw-32px))] rounded-xl border border-axal-hairline bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <ul data-testid="hq-platform-scope-options">
            <li>
              <Link to={scopeHref(null)} aria-current={scope ? undefined : 'page'} className={`${OPTION} ${scope ? 'text-axal-ink dark:text-white' : CURRENT}`} data-testid="hq-scope-option-hq">
                <span>HQ-wide</span>
                <span className="text-[10.5px] font-normal text-axal-faint">HQ deployment and every branch</span>
              </Link>
            </li>
            {listed.map((o) => (
              <li key={o.code}>
                <Link to={scopeHref(o.code)} aria-current={scope === o.code ? 'page' : undefined} className={`${OPTION} ${scope === o.code ? CURRENT : 'text-axal-ink dark:text-white'}`} data-testid={`hq-scope-option-${o.code}`}>
                  <span className="font-mono">{o.label}</span>
                  <span className="text-[10.5px] font-normal text-axal-faint">{o.note}</span>
                </Link>
              </li>
            ))}
            {unlisted && (
              <li className="px-3 py-2 text-[11px] text-axal-muted" data-testid="hq-scope-option-unlisted">
                <span className="font-mono">{scope}</span> is in the address but not in the list.
              </li>
            )}
          </ul>
          {options === null && <p className="px-3 py-2 text-[11px] text-axal-muted">Reading the subsidiaries…</p>}
          {options && !options.available && (
            <p className="px-3 py-2 text-[11px] text-axal-muted" data-testid="hq-scope-list-unread">
              {options.reason} This is not a claim that there are none.
            </p>
          )}
          {options?.available && options.reason && (
            <p className="px-3 py-2 text-[11px] text-axal-muted" data-testid="hq-scope-list-partial">{options.reason}</p>
          )}
          {options?.available && listed.length === 0 && !options.reason && (
            <p className="px-3 py-2 text-[11px] text-axal-muted" data-testid="hq-scope-list-empty">No subsidiary is deployed or bound yet.</p>
          )}
        </div>
      </details>
    </nav>
  );
}

function Fact({ k, v }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-axal-hairline py-1.5 text-[11.5px] dark:border-gray-800">
      <dt className="shrink-0 text-axal-muted">{k}</dt>
      <dd className="min-w-0 text-right font-semibold text-axal-ink dark:text-white">{v === null ? <Unrecorded /> : typeof v === 'number' ? v.toLocaleString() : v}</dd>
    </div>
  );
}

function SignalCard({ row }) {
  return (
    <section className={CARD} data-testid={`hq-scope-signal-${row.key}`} data-status={row.status}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-extrabold text-axal-ink dark:text-white">{row.name}</h3>
        <Status s={row.status} />
      </div>
      {row.reason && <p className="mt-1 text-[11.5px] leading-snug text-axal-muted" data-testid="hq-scope-signal-reason">{row.reason}</p>}
      <dl className="mt-1.5">
        {row.facts.map(([k, v]) => <Fact key={k} k={k} v={v} />)}
      </dl>
      <p className="mt-1.5 text-[10.5px] text-axal-faint">
        Observed {row.observed ? `${row.observed} UTC` : <Unrecorded />}{row.source ? ` · ${row.source}` : ''}
      </p>
    </section>
  );
}

/**
 * The overview under a subsidiary scope. `reading` is null while the read is
 * out, `failed` the sentence for a read that did not answer (refusals
 * included), and `onRetry` reads it again.
 */
export function ScopedOverview({ code, reading, failed, onRetry }) {
  const health = scopeHealth(reading, { code, failed });
  const x = STATUS[health.state] || STATUS.Unknown;
  const rows = signalRows(reading);
  const items = scopeAttention(reading).map((it) => ({ ...it, signal: 'branches' }));
  const unknown = (reading?.unknown || []).map((u) => ({ name: u.signal }));
  return (
    <div className="space-y-4" data-testid="hq-platform-scoped" data-scope={code}>
      <section aria-labelledby="sh-h" className={`${CARD} border-l-4 ${RULE[health.state] || RULE.Unknown}`} data-testid="hq-scope-health" data-health={health.state}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="sh-h" className="text-[17px] font-extrabold tracking-tight text-axal-ink dark:text-white">
            <span className="font-mono">{code}</span> health · <span aria-hidden="true">{x.sym}</span> {health.state}
          </h2>
          <span className="text-[10.5px] font-semibold text-axal-faint"><span aria-hidden="true">◎ </span>Scope: subsidiary {code}{reading?.scope?.licence_uid ? `, licence ${reading.scope.licence_uid}` : ''}</span>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-axal-ink dark:text-gray-200" data-testid="hq-scope-confidence">{health.confidence}</p>
        {reading && (
          <p className="mt-1 text-[11px] text-axal-faint">
            Registry {reading.scope?.registry_status || <Unrecorded reason="HQ holds no deployment row for this branch." />} · {reading.scope?.bound ? 'bound to this Worker' : 'not bound to this Worker'}
          </p>
        )}
        <details className="mt-1.5">
          <summary className={`cursor-pointer select-none text-[11.5px] font-bold text-emerald-800 dark:text-emerald-300 ${FOCUS}`}>How this is measured</summary>
          <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">
            Only what is read for this branch alone judges it: its live health over its own binding, the last check Deployments stored for it,
            and its own row of traffic. The state is the Worker&apos;s, by the rule the HQ-wide summary uses. A signal that did not answer
            lowers it to Unknown with its reason, and a branch nobody checked recently is a Low item that does not lower it. Traffic is read
            for whether it answered: no threshold judges it. Nothing HQ-wide stands in for this branch.
          </p>
        </details>
      </section>

      {failed && (
        <Unreadable what={`The reading for ${code}`} claim={`${failed} This is not a claim that ${code} is healthy.`} onRetry={onRetry} />
      )}

      {!failed && (
        <>
          <div className="grid gap-4 md:grid-cols-3" data-testid="hq-scope-signals">
            {reading === null
              ? <p className="text-[12.5px] text-axal-muted">Reading {code}…</p>
              : rows.map((r) => <SignalCard key={r.key} row={r} />)}
          </div>
          <NeedsAttention items={items} unknown={unknown} loading={reading === null} />
        </>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="su-h" className={CARD} data-testid="hq-scope-unavailable">
          <h2 id="su-h" className="text-[14.5px] font-extrabold tracking-tight text-axal-ink dark:text-white">Not readable for a subsidiary</h2>
          <p className="mt-0.5 text-[11.5px] text-axal-muted">The branch keeps these in its own database, and no read brings them to HQ yet. They are not judged, and HQ&apos;s own figures are not shown in their place.</p>
          {reading ? (
            <ul className="mt-1.5">
              {(reading.unavailable || []).map((u) => (
                <li key={u.signal} className="flex flex-col gap-0.5 border-t border-axal-hairline py-1.5 text-[12px] dark:border-gray-800" data-testid="hq-scope-unavailable-item">
                  <span className="flex items-center justify-between gap-2"><b className="text-axal-ink dark:text-white">{u.signal}</b><Status s="Unknown" label="Unreadable" /></span>
                  <span className="text-[11px] leading-snug text-axal-muted">{u.reason}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1.5 text-[11.5px] text-axal-faint">{failed ? 'Named by the reading, which did not answer.' : 'Reading…'}</p>}
        </section>
        <section aria-labelledby="sq-h" className={CARD} data-testid="hq-scope-hq-only">
          <h2 id="sq-h" className="text-[14.5px] font-extrabold tracking-tight text-axal-ink dark:text-white">HQ-only, not shown here</h2>
          <p className="mt-0.5 text-[11.5px] text-axal-muted">
            These read HQ&apos;s own deployment and stores, so they say nothing about {code}. They and their consoles are on the{' '}
            <Link to={scopeHref(null)} className={`font-bold text-emerald-800 underline dark:text-emerald-300 ${FOCUS}`} data-testid="hq-scope-back">HQ-wide view</Link>.
          </p>
          {reading && (
            <details className="mt-1.5" data-testid="hq-scope-hq-only-list">
              <summary className={`min-h-[32px] cursor-pointer select-none text-[11.5px] font-bold text-emerald-800 dark:text-emerald-300 ${FOCUS}`}>{(reading.hq_only || []).length} signals</summary>
              <ul className="mt-1">
                {(reading.hq_only || []).map((h) => (
                  <li key={h.signal} className="border-t border-axal-hairline py-1 text-[11.5px] dark:border-gray-800">
                    <b className="text-axal-ink dark:text-white">{h.signal}</b> <span className="text-axal-muted">{h.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
