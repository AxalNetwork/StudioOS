import React from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge.jsx';
import SourceAvailability from './SourceAvailability.jsx';
import { tabHref } from './securityTabs.js';

/**
 * D4800 (#4800, canvas SE01 desktop and SE11a phone) — the Overview
 * workspace, drawn from `buildOverview` (`overviewModel.js`).
 *
 * ORDER IS THE POINT: Action required, then "Checked and clear", then status
 * by area, then the sources. Nothing passive sits above a finding. There is
 * no score (D4803).
 *
 * THE ONE SENTENCE THIS PAGE MUST NEVER SAY BY ACCIDENT is "nothing needs
 * action". It is drawn only when every read answered and no finding is open.
 * While a read is in flight the list says it is still reading; when a check
 * could not run, that check is itself a finding with Retry, and the heading
 * line says the list may be incomplete.
 */

const ACTION = 'inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border px-3 text-[12px] font-bold sm:min-h-0 sm:w-auto sm:py-1.5';
const ACTION_PRIMARY = `${ACTION} border-violet-700 bg-violet-700 text-white hover:bg-violet-800 dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-700`;
const ACTION_PLAIN = `${ACTION} border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;

function FindingAction({ finding, onRetry }) {
  const a = finding.action;
  const cls = finding.state === 'failed' ? ACTION_PRIMARY : ACTION_PLAIN;
  if (a.retry) {
    return <button type="button" onClick={onRetry[a.retry]} className={cls}>{a.label}</button>;
  }
  if (a.href) return <Link to={a.href} className={cls}>{a.label}</Link>;
  return <Link to={tabHref(a.tab)} className={cls}>{a.label}</Link>;
}

export function ActionRequiredList({ model, onRetry }) {
  const { findings, loading, incomplete } = model;
  const open = findings.filter((f) => f.state !== 'unavailable').length;
  const sub = incomplete
    ? 'A check could not run, so this list may be incomplete'
    : loading
      ? 'Still reading — nothing is claimed yet'
      : findings.length ? `${findings.length} item${findings.length === 1 ? '' : 's'} · most severe first` : 'Every check ran';
  return (
    <section
      aria-labelledby="security-ar-h"
      className="rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
      data-testid="security-action-required"
      data-open={open}
      data-incomplete={incomplete ? 'true' : 'false'}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="security-ar-h" className="text-[15px] font-extrabold tracking-tight">Action required</h2>
        <span className="text-[11.5px] text-axal-faint" data-testid="security-action-required-sub">{sub}</span>
      </div>
      {findings.length > 0 ? (
        <ol className="divide-y divide-axal-hairline dark:divide-gray-800">
          {findings.map((f) => (
            <li key={f.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4" data-testid={`security-finding-${f.id}`} data-state={f.state}>
              <span className="shrink-0 sm:w-36"><StatusBadge state={f.state} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-bold text-axal-ink dark:text-white">{f.title}</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-axal-muted">{f.detail}</p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-axal-faint sm:w-40 sm:text-right">
                {f.when}<br />{f.where}
              </span>
              <span className="shrink-0"><FindingAction finding={f} onRetry={onRetry} /></span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[12.5px] text-axal-muted" data-testid="security-action-required-empty">
          {loading ? 'Reading the overview and the security ledger…' : 'Nothing needs action. Every check ran; what each one read is below.'}
        </p>
      )}
    </section>
  );
}

export function CheckedAndClear({ items }) {
  return (
    <section aria-labelledby="security-clear-h" className="space-y-2" data-testid="security-checked-clear">
      <h2 id="security-clear-h" className="text-[13px] font-extrabold tracking-tight">Checked and clear</h2>
      {items.length === 0 ? (
        <p className="text-[12px] text-axal-faint">No check has come back clear yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((c) => (
            <li key={c.id} className="rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 dark:border-gray-800 dark:bg-gray-900" data-testid={`security-clear-${c.id}`}>
              <StatusBadge state={c.state} label={c.label} />
              <div className="mt-1 text-[10.5px] text-axal-faint">{c.evidence}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function StatusByArea({ areas }) {
  return (
    <section aria-labelledby="security-areas-h" className="space-y-2" data-testid="security-areas">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="security-areas-h" className="text-[15px] font-extrabold tracking-tight">Status by area</h2>
        <span className="text-[11.5px] text-axal-faint">No overall score: each area reports its own evidence.</span>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {areas.map((a) => (
          <li key={a.id}>
            <Link
              to={tabHref(a.tab)}
              className="flex h-full min-h-[44px] flex-col gap-1 rounded-xl border border-axal-hairline bg-white p-3 hover:border-violet-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-violet-800"
              data-testid={`security-area-${a.id}`}
              data-state={a.state || 'loading'}
            >
              <span className="flex flex-wrap items-center justify-between gap-1.5">
                <b className="text-[12.5px] text-axal-ink dark:text-white">{a.title}</b>
                {a.state ? <StatusBadge state={a.state} /> : <span className="text-[11px] text-axal-faint">Reading…</span>}
              </span>
              <span className="text-[12px] text-axal-muted">{a.fact}</span>
              {a.freshness && <span className="text-[10.5px] text-axal-faint">{a.freshness}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function OverviewWorkspace({ model, onRetry, filterLabel, sourceNotes }) {
  return (
    <div className="space-y-5" data-testid="security-overview">
      <ActionRequiredList model={model} onRetry={onRetry} />
      <CheckedAndClear items={model.clear} />
      <StatusByArea areas={model.areas} />
      <section aria-labelledby="security-sources-h" className="rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 id="security-sources-h" className="mb-2 text-[14px] font-extrabold tracking-tight">Evidence sources</h2>
        <SourceAvailability sources={model.sources} onRetry={onRetry.feed} filterLabel={filterLabel} data-testid="security-overview-sources">
          {sourceNotes}
        </SourceAvailability>
      </section>
    </div>
  );
}
