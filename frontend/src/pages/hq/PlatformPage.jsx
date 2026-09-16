/**
 * HQ · Platform — canvas H6, "Keys, flags, jobs".
 *
 * TWO OF THE THREE HAVE A STORE.
 *
 *   Keys   `integrations` carries a provider, a status and a connection per
 *          account. The KEY MATERIAL IS NEVER FETCHED BY THIS PAGE — the
 *          endpoint counts and states, and the artboard's "reveal on click,
 *          re-hide after thirty seconds" belongs to the console that owns
 *          key material, not to a read-only HQ summary. Revocation likewise:
 *          it is instant and irreversible, so it stays where it is audited.
 *   Jobs   `cron_run_history` records every scheduled run, so a trigger that
 *          failed, one that is still running and one that has gone silent
 *          are three different states and are drawn as three.
 *   Flags  No store. What the codebase calls flags is per-user settings — a
 *          person's own preference, not a switch an operator throws. A flags
 *          panel over that would claim a control room the product lacks.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

const UNAVAILABLE = Symbol('unavailable');
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());
const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);

/** The four job states, and the one colour each earns. */
const JOB_TONE = {
  failed: 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20',
  stale: 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20',
  running: 'border-axal-hairline bg-axal-ground',
  ok: 'border-axal-hairline bg-axal-ground',
};

function Zone({ title, sub, children }) {
  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">{title}</h2>
        {sub && <span className="text-[11.5px] text-axal-faint">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

function Absent({ reason }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-axal-muted">
      <Unrecorded /> — {reason}
    </p>
  );
}

function Stat({ label, value, note, tone = 'text-axal-ink dark:text-white' }) {
  return (
    <div className="rounded-xl border border-axal-hairline bg-axal-ground p-3">
      <div className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      <div className={`mt-1 text-lg font-extrabold tracking-tight tabular-nums ${tone}`}>{value ?? <Unrecorded />}</div>
      {note && <div className="mt-0.5 text-[10px] text-axal-faint">{note}</div>}
    </div>
  );
}

export default function PlatformPage() {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    setData(null);
    api.hqPlatform().then(setData, (e) => { reportError('hq-platform', e); setData(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // D110 — Deployments is its own request: it fans out to every branch Worker
  // for a live health read, which is slower and fails differently from the
  // platform summary. Folding it into `hqPlatform` would make an unreachable
  // branch able to delay or empty the keys-and-jobs half of this page.
  const [deps, setDeps] = useState(null);
  const loadDeps = useCallback(() => {
    setDeps(null);
    api.deployments().then(setDeps, (e) => { reportError('hq-deployments', e); setDeps(UNAVAILABLE); });
  }, []);
  useEffect(() => { loadDeps(); }, [loadDeps]);

  const ready = data && data !== UNAVAILABLE;
  const integrations = ready ? data.integrations : null;
  const jobs = ready ? data.jobs : null;

  // One line per read that answered (D126). `canRun = coverage.length > 0` in
  // WorkerRail, so a mount passing none disables its own button and prints
  // "Not recorded" over a page whose two reads both answer. A source that
  // failed contributes no line and `coverageNote` says which — an empty rail
  // must not be readable as "nothing is connected".
  const depsReady = deps && deps !== UNAVAILABLE && deps.registry_available !== false;
  const coverage = [
    integrations?.available && num(integrations.total) !== null
      ? `${num(integrations.total)} connections across ${integrations.providers.length} providers` : null,
    jobs?.available && num(jobs.failing) !== null
      ? `${num(jobs.failing)} failing jobs · ${num(jobs.stale)} silent over ${jobs.stale_after_hours}h` : null,
    depsReady
      ? `${(deps.deployments || []).length} branch ${(deps.deployments || []).length === 1 ? 'deployment' : 'deployments'} in the registry` : null,
  ].filter(Boolean);

  const rail = (
    <WorkerRail
      workspace="Platform"
      role="super_admin"
      stance="Read-only summary"
      note="This rail summarises connection counts, scheduled-job health and the branch deployment registry. It reads no key material and rolls nothing back."
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (data === UNAVAILABLE || deps === UNAVAILABLE
          ? 'Neither read answered, so there is nothing to read back — this is not a claim that nothing is connected.'
          : 'Loading the platform summary…')}
      unavailable={[
        ['Feature flags', 'No flag store exists; what is called flags is per-user settings.'],
        ['Key material', 'Never read by this page. Reveal and revoke live where they are audited.'],
        ['Per-subsidiary integrations', 'No account names its licence yet (U1).'],
      ]}
      data-testid="hq-platform-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-platform-page">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#3730a3] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All subsidiaries</span>
          <span className="text-[11px] opacity-80 tabular-nums">
            {jobs?.available
              ? `${num(jobs.failing)} failing · ${num(jobs.stale)} silent over ${jobs.stale_after_hours}h`
              : '…'}
          </span>
        </div>

        <header className="mt-4">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <SlidersHorizontal size={13} /> HQ · Platform
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Platform</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Keys, flags and jobs. Two of the three have a store and are read from it; flags do not exist as a
            platform control and say so. No key material is fetched by this page.
          </p>
        </header>

        {data === UNAVAILABLE && (
          <div className="mt-4">
            <Unreadable
              what="The platform summary"
              claim="This is not a claim that nothing is connected."
              onRetry={load}
            />
          </div>
        )}

        <div className="mt-4 space-y-4">
          <Zone title="Keys and connections" sub="counted and stated, never revealed">
            {integrations?.available ? (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  <Stat label="Connections" value={num(integrations.total)} note="across every provider" />
                  <Stat
                    label="In error or disconnected"
                    value={num(integrations.unhealthy)}
                    note={integrations.unhealthy ? 'needs attention' : 'all healthy'}
                    tone={integrations.unhealthy ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-white'}
                  />
                  <Stat label="Providers" value={num(integrations.providers.length)} note="distinct integrations" />
                </div>
                {integrations.providers.length > 0 && (
                  <ul className="mt-3 space-y-1.5" data-testid="hq-platform-providers">
                    {integrations.providers.map((p) => (
                      <li key={p.provider} className="flex items-baseline justify-between gap-3 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[11.5px]">
                        <span className="font-medium">{p.provider}</span>
                        <span className="font-mono text-[10px] text-axal-faint">
                          {Object.entries(p.by_status).map(([s, n]) => `${n} ${s}`).join(' · ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-platform-secrets">
                  {integrations.secrets_note} Revealing and revoking a key stay in the console that owns key
                  material, where revocation is recorded — it is instant and irreversible, which is not something
                  a read-only summary should be able to do.
                </p>
              </>
            ) : (
              <Absent reason={integrations?.reason || 'The platform summary could not be read.'} />
            )}
          </Zone>

          <div className="grid gap-4 md:grid-cols-2">
            <Zone title="Scheduled jobs" sub="failed, silent and running are three things">
              {jobs?.available ? (
                jobs.triggers.length === 0 ? (
                  <p className="text-[12.5px] text-axal-muted">
                    No scheduled run has been recorded yet. The history is readable and empty, which is not the
                    same as a job that never ran.
                  </p>
                ) : (
                  <ul className="space-y-1.5" data-testid="hq-platform-jobs">
                    {jobs.triggers.map((j) => (
                      <li key={j.trigger_name} className={`rounded-lg border px-3 py-2 text-[11.5px] ${JOB_TONE[j.state] || JOB_TONE.ok}`}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate font-medium">{j.trigger_name}</span>
                          <span className="shrink-0 font-mono text-[10px] uppercase text-axal-faint">{j.state}</span>
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-axal-faint">
                          {day(j.last_started_at) || 'never started'}
                          {j.last_finished_at ? ` → ${day(j.last_finished_at)}` : ' · not finished'}
                        </div>
                        {j.error && <div className="mt-1 text-[11px] text-red-700 dark:text-red-300">{j.error}</div>}
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <Absent reason={jobs?.reason || 'The platform summary could not be read.'} />
              )}
            </Zone>

            <Zone title="Deployments" sub="one row per branch: what HQ provisioned, and what answers now">
              {deps === UNAVAILABLE ? (
                <Unreadable
                  what="The deployments list"
                  claim="This is not a claim that no branch is deployed."
                  onRetry={loadDeps}
                />
              ) : deps === null ? (
                <p className="text-[12.5px] text-axal-muted">Reading every branch…</p>
              ) : deps.registry_available === false ? (
                <Absent reason={deps.registry_reason} />
              ) : (deps.deployments || []).length === 0 ? (
                <p className="text-[12.5px] leading-relaxed text-axal-muted">
                  No branch has been provisioned. A licence gains a deployment from the Deploy step of
                  the issue flow, which runs <code>branch-provision.yml</code>. This is an empty
                  registry, not an unreadable one.
                </p>
              ) : (
                <ul className="divide-y divide-axal-hairline" data-testid="hq-deployments">
                  {deps.deployments.map((d) => (
                    <li key={d.code} className="py-2">
                      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                        <span className="min-w-0 truncate">
                          <span className="font-semibold">{d.code}</span>
                          <span className="text-axal-muted"> · {d.hostname}</span>
                        </span>
                        {/* THE TWO STATES ARE SHOWN SEPARATELY AND NEVER
                            MERGED. `status` is how far provisioning got;
                            `live_state` is whether it answered a moment ago. A
                            branch that reached worker_live last week and is
                            unreachable now has not regressed to requested, and
                            one number could not say both. */}
                        <span className="shrink-0 space-x-1.5">
                          <span className="rounded-full bg-axal-ground px-2 py-0.5 text-[11px] text-axal-muted">
                            {String(d.status || '').replace(/_/g, ' ')}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            d.live_state === 'ok'
                              ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                              : d.live_state === 'not_deployed'
                                ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}>
                            {d.live_state === 'ok' ? 'answering'
                              : d.live_state === 'not_deployed' ? 'no binding yet' : 'unreadable'}
                          </span>
                        </span>
                      </div>
                      {d.live_state !== 'ok' && d.live_reason && (
                        <p className="mt-0.5 text-[11.5px] leading-snug text-axal-faint">{d.live_reason}</p>
                      )}
                      <div className="mt-0.5 text-[11px] text-axal-faint">
                        {d.d1_name}
                        {d.d1_jurisdiction ? ` · ${d.d1_jurisdiction.toUpperCase()} resident` : ''}
                        {!d.d1_jurisdiction && d.location_hint ? ` · hinted ${d.location_hint.toUpperCase()} (not guaranteed)` : ''}
                        {d.status_note ? ` · ${d.status_note}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {deps && deps !== UNAVAILABLE && deps.dispatch_available === false && (
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-axal-muted">
                  {deps.dispatch_reason}
                </p>
              )}
              {deps && deps !== UNAVAILABLE && deps.coverage && !deps.coverage.complete && (
                <p className="mt-1.5 text-[11.5px] text-axal-faint">
                  {deps.coverage.answered} of {deps.coverage.total} branches answered.
                </p>
              )}
            </Zone>

            <Zone title="Feature flags" sub="the third of the three">
              <Absent reason={ready ? data.flags_reason : 'The platform summary could not be read.'} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat label="Flags" value={null} note="no flag store exists" />
                <Stat label="Overrides" value={null} note="no operator switch exists" />
              </div>
            </Zone>
          </div>
        </div>
      </div>

      <div className="mt-4 lg:mt-0">{rail}</div>
    </div>
  );
}
