/**
 * D4860 (#4860) — HQ · Platform v2's overview, built to the canvas
 * (`design/incoming/Platform v2 Page.dc.html`, boards PL-01 to PL-09 and
 * PL-11): version context, ONE Platform health state, the Needs attention
 * queue, active controls and capability coverage beside it, four core-system
 * blocks, operational activity and the consoles grouped by domain, with
 * Event syndication under Preview / Planned.
 *
 * Every word and figure comes from `platformOverviewModel.js`, over the reads
 * PlatformPage.jsx already makes. Like that page, this draws no handler: every
 * action is a link to the console that does it, and every caveat sits behind
 * a native disclosure ("How this is measured", "Why this may be unknown").
 * Status is always a symbol plus words, never colour alone.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Unrecorded } from '../../ui';
import { builtRelease, releaseBadge } from '../../lib/release';
import {
  STATUS, SEVERITY_SYM, signals, platformHealth, healthLine, attention, unknownSignals,
  coverage, activity, switchRows, webhookHealth, keyLevels, channelState, utcStamp,
  CONSOLE_GROUPS, PREVIEW_CONSOLES, WEBHOOK_SILENCE_HOURS, WEBHOOK_CRITICAL_RUN, DLQ_CRITICAL, CATALOG_STALE_DAYS, stampDate,
} from './platformOverviewModel';

const TONE = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
  unknown: 'border-dashed border-gray-400 bg-gray-50 text-gray-700 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-200',
  neutral: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
};
const HEALTH_RULE = {
  Healthy: 'border-l-emerald-600 dark:border-l-emerald-400',
  Degraded: 'border-l-amber-500 dark:border-l-amber-400',
  Unknown: 'border-l-gray-400 dark:border-l-gray-500',
  Critical: 'border-l-red-600 dark:border-l-red-400',
  Reading: 'border-l-gray-300 dark:border-l-gray-600',
};
const SEV_TONE = {
  Critical: 'bg-red-700 text-white dark:bg-red-400 dark:text-gray-950',
  High: 'border border-red-300 text-red-800 dark:border-red-700 dark:text-red-300',
  Medium: 'border border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-300',
  Low: 'border border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300',
  Info: 'border border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400',
};
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:focus-visible:outline-emerald-400';
const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const DISC = `cursor-pointer select-none text-[11.5px] font-bold text-emerald-800 dark:text-emerald-300 ${FOCUS}`;

/** A status, drawn as its symbol and its words — never colour alone. */
export function Status({ s, label, testid }) {
  const x = STATUS[s] || STATUS.Unknown;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${TONE[x.tone]}`} data-status={s} data-testid={testid}>
      <span aria-hidden="true">{x.sym}</span>
      <span>{label || s}</span>
    </span>
  );
}

function Severity({ s }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[.06em] ${SEV_TONE[s]}`} data-severity={s}>
      <span aria-hidden="true">{SEVERITY_SYM[s]}</span>
      <span>{s}</span>
    </span>
  );
}

function Scope({ children }) {
  return <span className="text-[10.5px] font-semibold text-axal-faint"><span aria-hidden="true">◎ </span>Scope: {children}</span>;
}

function How({ title = 'How this is measured', children, testid }) {
  return (
    <details className="mt-1.5" data-testid={testid}>
      <summary className={DISC}>{title}</summary>
      <div className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">{children}</div>
    </details>
  );
}

function KV({ k, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-axal-hairline py-1.5 text-[11.5px] dark:border-gray-800">
      <dt className="shrink-0 text-axal-muted">{k}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

const orNot = (v, reason) => (v == null ? <Unrecorded reason={reason} /> : v);

/* ── header: version context ─────────────────────────────────────────── */

export function VersionContext({ build, observedAt }) {
  const badge = releaseBadge(builtRelease());
  const ready = build && build !== 'unavailable';
  return (
    <div className="flex flex-col items-start gap-1 text-[11px] text-axal-muted md:items-end" data-testid="hq-platform-version">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span>Version <b className="text-axal-ink dark:text-white">{badge ? badge.label : <Unrecorded reason="This build carries no release tag." />}</b></span>
        <span>Commit <b className="font-mono text-axal-ink dark:text-white">{build === null ? '…' : ready && build.commit ? build.commit.slice(0, 7) : <Unrecorded reason={ready ? build.commit_basis : 'The build read did not answer.'} />}</b></span>
        <span>Environment <b className="text-axal-ink dark:text-white">{build === null ? '…' : ready && build.environment ? build.environment : <Unrecorded reason="No ENVIRONMENT var is set on this Worker." />}</b></span>
        <span>Deployed <b className="text-axal-ink dark:text-white"><Unrecorded reason={ready ? build.deployed_at_reason : 'The build read did not answer.'} /></b></span>
      </div>
      <div className="flex flex-wrap gap-x-3">
        <span aria-live="polite">Observed <b className="text-axal-ink dark:text-white">{observedAt ? `${utcStamp(observedAt).slice(11)} UTC` : '…'}</b></span>
        <Scope>HQ deployment</Scope>
      </div>
    </div>
  );
}

/* ── 1 · Platform health ─────────────────────────────────────────────── */

export function HealthHeader({ health, line }) {
  const x = STATUS[health.state] || STATUS.Unknown;
  return (
    <section aria-labelledby="ph-h" className={`${CARD} border-l-4 ${HEALTH_RULE[health.state] || HEALTH_RULE.Unknown}`} data-testid="hq-platform-health" data-health={health.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="ph-h" className="text-[17px] font-extrabold tracking-tight text-axal-ink dark:text-white">
          Platform health · <span aria-hidden="true">{x.sym}</span> {health.state}
        </h2>
        <Scope>HQ deployment, and the branches its registry lists</Scope>
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-axal-muted" data-testid="hq-platform-health-line">
        {line.map(([k, v]) => (
          <li key={k}>{k} <b className="text-axal-ink dark:text-white">{v}</b></li>
        ))}
      </ul>
      <p className="mt-1.5 text-[12px] leading-relaxed text-axal-ink dark:text-gray-200" data-testid="hq-platform-confidence">{health.confidence}</p>
      <How>
        Critical when a known capability is failing: a branch whose database fails, a webhook refused {WEBHOOK_CRITICAL_RUN} times in a row with no
        success since, a dead-letter backlog of {DLQ_CRITICAL} or more, or the AI budget tripped. Unknown when the summary, or both the scheduled
        jobs and the dead-letter queue, cannot be read. Degraded when anything else is wrong, or when a core signal (telemetry, jobs,
        dead letters, integrations, the Stripe webhook) cannot be read: an unread signal lowers confidence and never counts as zero.
        Healthy only when every core signal was read on this visit and is healthy. An unset optional key or an unbound channel is a
        configuration item in Needs attention and does not lower health. Scheduled jobs are one signal among these, not the verdict.
      </How>
    </section>
  );
}

/* ── 2 · Needs attention ─────────────────────────────────────────────── */

function AttentionRow({ it, first, mobileFold }) {
  return (
    <li className={`grid gap-2 border-t border-axal-hairline py-2.5 dark:border-gray-800 md:grid-cols-[88px_minmax(0,1fr)_150px_auto] md:items-start ${mobileFold ? 'hidden md:grid' : ''}`} data-testid="hq-attention-item" data-severity={it.severity}>
      <span><Severity s={it.severity} /></span>
      <div className="min-w-0">
        <span className="block text-[13px] font-bold text-axal-ink dark:text-white">{it.title}</span>
        <span className="block text-[11.5px] leading-snug text-axal-muted">{it.detail}</span>
      </div>
      <div className="flex flex-col items-start gap-1 text-[10.5px] text-axal-faint">
        <Status s={it.state} />
        <span>{it.since ? `since ${it.since} · ` : ''}observed {it.observed ? utcStamp(it.observed).slice(11) : '—'}</span>
      </div>
      <Link
        to={it.link.to}
        className={`inline-flex min-h-[36px] items-center justify-center rounded-lg px-3 text-[12px] font-bold ${first ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'border border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-white'} ${FOCUS}`}
        data-testid="hq-attention-action"
      >
        {it.link.label} →
      </Link>
    </li>
  );
}

export function NeedsAttention({ items, unknown, loading }) {
  const folded = items.filter((i) => i.severity === 'Low' || i.severity === 'Info');
  return (
    <section aria-labelledby="na-h" className={CARD} data-testid="hq-needs-attention">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="na-h" className="text-[14.5px] font-extrabold tracking-tight text-axal-ink dark:text-white">Needs attention</h2>
        <span className="text-[11.5px] text-axal-faint">{loading ? 'reading' : `${items.length} ${items.length === 1 ? 'item' : 'items'} · most severe first`}</span>
      </div>
      {loading ? (
        <p className="mt-2 text-[12.5px] text-axal-muted">Reading every signal…</p>
      ) : items.length === 0 ? (
        unknown.length ? (
          <div className="mt-2 flex gap-2 rounded-lg border border-dashed border-gray-400 p-3 text-[12.5px] dark:border-gray-500" data-testid="hq-attention-not-all-clear">
            <span aria-hidden="true">?</span>
            <div>
              <b>Nothing needs attention among the signals that could be read.</b>
              <div className="text-axal-muted">
                This is not an all-clear: {unknown.length} {unknown.length === 1 ? 'signal is' : 'signals are'} Unknown ({unknown.map((s) => s.name).join(', ')}).
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] text-axal-muted" data-testid="hq-attention-clear">Nothing needs attention: every signal was read and none is wrong.</p>
        )
      ) : (
        <ol className="mt-1" data-testid="hq-attention-list">
          {items.map((it, i) => (
            <AttentionRow key={`${it.signal}:${it.title}`} it={it} first={i === 0} mobileFold={it.severity === 'Low' || it.severity === 'Info'} />
          ))}
        </ol>
      )}
      {folded.length > 0 && (
        <details className="mt-1 border-t border-axal-hairline pt-2 md:hidden dark:border-gray-800" data-testid="hq-attention-folded">
          <summary className={`${DISC} min-h-[44px]`}>{folded.length} more · Low and Info</summary>
          <ol>{folded.map((it) => <AttentionRow key={`m:${it.signal}:${it.title}`} it={it} first={false} mobileFold={false} />)}</ol>
        </details>
      )}
    </section>
  );
}

/* ── controls and coverage ───────────────────────────────────────────── */

export function ActiveControls({ rows, unreadableReason }) {
  const overrides = rows ? rows.filter((r) => r.group === 'override') : null;
  const safety = rows ? rows.filter((r) => r.group === 'safety') : null;
  return (
    <section aria-labelledby="ct-h" className={CARD} data-testid="hq-active-controls">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ct-h" className="text-[14.5px] font-extrabold tracking-tight text-axal-ink dark:text-white">Active controls</h2>
        <Scope>HQ deployment</Scope>
      </div>
      {!rows ? (
        <p className="mt-2 text-[12px] text-axal-muted"><Unrecorded reason={unreadableReason}>Unreadable</Unrecorded> — {unreadableReason}</p>
      ) : (
        <>
          <dl className="mt-1">
            <KV k="HQ operator overrides">{overrides.length ? <Status s="Active" label={`${overrides.length} active`} /> : <Status s="Not active" label="None active" />}</KV>
            {safety.map((r) => <KV key={r.key} k={r.name}><Status s={r.state} /></KV>)}
          </dl>
          <SwitchGroups rows={rows} />
        </>
      )}
      <Link to="/admin/platform/switches" className={`mt-2 inline-block text-[12px] font-bold text-emerald-800 dark:text-emerald-300 ${FOCUS}`}>Flags &amp; switches →</Link>
    </section>
  );
}

const GROUP_TITLE = { override: 'Active overrides', deployment: 'Deployment configuration', safety: 'Runtime safety systems' };
const GROUP_NOTE = {
  override: 'Thrown by HQ now. Releasing one returns it to the deployment configuration.',
  deployment: 'Set by the deployment. Changing one needs a deploy.',
  safety: 'Act immediately: HQ throws Eadwyn\'s on Switches; the platform trips the AI budget itself.',
};

/** Every switch by business meaning, in the canvas's three groups (PL-06). */
export function SwitchGroups({ rows }) {
  return (
    <details className="mt-1.5" data-testid="hq-switch-groups">
      <summary className={DISC}>Details · every switch by what it means</summary>
      {['override', 'deployment', 'safety'].map((g) => {
        const these = rows.filter((r) => r.group === g);
        return (
          <div key={g} className="mt-2" data-testid={`hq-switch-group-${g}`}>
            <h3 className="text-[11.5px] font-extrabold text-axal-ink dark:text-white">{GROUP_TITLE[g]}</h3>
            <p className="text-[10.5px] text-axal-faint">{GROUP_NOTE[g]}</p>
            {these.length === 0 ? (
              <p className="mt-0.5 text-[11.5px] text-axal-muted">{g === 'override' ? 'No HQ operator override is active. Every member gets the deployment configuration.' : 'None.'}</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {these.map((r) => (
                  <li key={r.key} className="rounded-lg border border-axal-hairline px-2.5 py-1.5 text-[11.5px] dark:border-gray-800" data-testid={`hq-switch-row-${r.key}`}>
                    <div className="flex items-baseline justify-between gap-2"><b>{r.name}</b><Status s={r.state} /></div>
                    <div className="text-axal-muted">{r.reason || r.impact}</div>
                    <div className="text-[10.5px] text-axal-faint">{r.changeable}{r.last_changed ? ` · last changed ${r.last_changed} UTC` : ''}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </details>
  );
}

export function CapabilityCoverage({ rows }) {
  return (
    <section aria-labelledby="cv-h" className={CARD} data-testid="hq-capability-coverage">
      <h2 id="cv-h" className="text-[14.5px] font-extrabold tracking-tight text-axal-ink dark:text-white">Capability coverage</h2>
      <dl className="mt-1">
        {rows.map((c) => (
          <div key={c.key} className="border-t border-axal-hairline py-1.5 text-[11.5px] dark:border-gray-800" data-testid={`hq-coverage-${c.key}`}>
            <div className="flex items-baseline justify-between gap-3">
              <dt><b className="text-axal-ink dark:text-white">{c.name}</b> <span className="text-axal-faint">{c.note}</span></dt>
              <dd className="font-extrabold tabular-nums text-axal-ink dark:text-white">{orNot(c.value, `${c.name}: ${c.note}.`)}</dd>
            </div>
            {c.pct != null && (
              <div className="mt-1 h-1 rounded bg-gray-200 dark:bg-gray-800" aria-hidden="true">
                <div className="h-1 rounded bg-emerald-600 dark:bg-emerald-400" style={{ width: `${c.pct}%` }} />
              </div>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ── 3 · Core systems ────────────────────────────────────────────────── */

function Freshness({ at, now, staleAfterHours, label = 'observed' }) {
  const d = at instanceof Date ? at : stampDate(at);
  if (!d) return <span className="text-[10.5px] text-axal-faint">{label} <Unrecorded /></span>;
  const hours = now ? (now.getTime() - d.getTime()) / 3_600_000 : null;
  const stale = staleAfterHours != null && hours != null && hours >= staleAfterHours;
  return (
    <span className="text-[10.5px] text-axal-faint" data-freshness={stale ? 'stale' : 'fresh'}>
      <span aria-hidden="true">{stale ? '◷ ' : '● '}</span>{label} {utcStamp(d)} UTC · {stale ? 'stale' : 'fresh'}
    </span>
  );
}

function SystemBlock({ id, title, status, metric, metricNote, children, footer, link, testid }) {
  return (
    <section aria-labelledby={id} className={CARD} data-testid={testid} data-status={status}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={id} className="text-[13.5px] font-extrabold text-axal-ink dark:text-white">{title}</h3>
        <Status s={status} />
      </div>
      <div className="mt-1"><b className="text-xl font-extrabold tabular-nums text-axal-ink dark:text-white">{metric ?? <Unrecorded />}</b> <span className="text-[11px] text-axal-muted">{metricNote}</span></div>
      <dl className="mt-1">{children}</dl>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {footer}
        {link}
      </div>
    </section>
  );
}

const sig = (sigs, k) => sigs.find((s) => s.key === k) || { status: 'Unknown', line: '' };

/** The summary's core-system status: the worst of the signals it covers. */
const worst = (...xs) => {
  const rank = ['Critical', 'Degraded', 'Stale', 'Unknown', 'Partial', 'Not configured', 'Reading', 'Healthy'];
  return xs.sort((a, b) => rank.indexOf(a) - rank.indexOf(b))[0] || 'Unknown';
};

export function CoreSystems({ data, sigs, rows, now, observedAt, UNAVAILABLE }) {
  const d = data && data !== UNAVAILABLE ? data : null;
  const loading = data === null;
  const jobs = d?.jobs?.available ? d.jobs : null;
  const okJobs = jobs ? jobs.triggers.filter((j) => j.state === 'ok').length : null;
  const lastRun = jobs ? jobs.triggers.map((j) => stampDate(j.last_started_at)).filter(Boolean).sort((a, b) => b - a)[0] : null;
  const incidents = d?.monitoring?.incidents;
  const pay = d?.payments_catalog;
  const cat = pay?.catalog?.available ? pay.catalog : null;
  const wh = loading ? null : webhookHealth(pay, now);
  const row = (k) => rows?.find((r) => r.key === k);
  const ints = d?.integrations?.available ? d.integrations : null;
  const lv = keyLevels(d?.integration_keys);
  const tg = d?.broadcast?.telegram?.available ? d.broadcast.telegram : null;
  const chStates = tg ? tg.channels.map((ch) => channelState(ch, now)) : [];
  const read = (s) => (loading ? 'Reading' : s);

  const blocks = [
    {
      id: 's-inf', title: 'Infrastructure', testid: 'hq-system-infrastructure',
      status: read(worst(sig(sigs, 'telemetry').status, sig(sigs, 'jobs').status, sig(sigs, 'dlq').status, sig(sigs, 'branches').status)),
      metric: jobs ? `${okJobs}/${jobs.triggers.length}` : null, metricNote: 'scheduled jobs on schedule',
      body: (
        <>
          <KV k="Telemetry"><Status s={sig(sigs, 'telemetry').status} label={sig(sigs, 'telemetry').status === 'Unknown' ? 'Unavailable' : undefined} /></KV>
          <KV k="DLQ depth">{d?.monitoring?.dlq?.available ? d.monitoring.dlq.total : <Unrecorded reason={d?.monitoring?.dlq?.reason}>Unreadable</Unrecorded>}</KV>
          <KV k="Cloudflare Queue">{row('cf_queue') ? <Status s={row('cf_queue').state} /> : <Unrecorded />}</KV>
          <KV k="Detected incidents" ><Status s="Not recorded" label="Not recorded" /></KV>
          <KV k="Published status incidents">{incidents?.available ? `${incidents.count} · last ${incidents.window_days} d` : <Unrecorded reason={incidents?.reason}>Unreadable</Unrecorded>}</KV>
        </>
      ),
      footer: (
        <span className="flex flex-col">
          <Freshness at={observedAt} label="observed" />
          <span className="text-[10.5px] text-axal-faint">last run {lastRun ? `${utcStamp(lastRun)} UTC` : <Unrecorded />}</span>
        </span>
      ),
      how: (
        <How title={sig(sigs, 'telemetry').status === 'Unknown' ? 'Why this may be unknown' : 'How this is measured'} testid="hq-system-infrastructure-how">
          {sig(sigs, 'telemetry').status === 'Unknown' && <><b>{sig(sigs, 'telemetry').why}</b> Worker error rates and traffic depend on it, so they show Unknown rather than 0. Cron and dead letters are read separately and stay known. </>}
          Detected operational incidents are not recorded: nothing detects incidents from health signals yet (#4854). Published status
          incidents count only incidents an operator entered for the status page in the last {incidents?.window_days ?? 7} days, so 0 says
          nothing about whether anything went wrong.
        </How>
      ),
      link: <Link to="/monitoring" className={`text-[12px] font-bold text-emerald-800 dark:text-emerald-300 ${FOCUS}`}>Monitoring →</Link>,
    },
    {
      id: 's-pay', title: 'Payments', testid: 'hq-system-payments',
      status: read(worst(wh?.state || 'Unknown', cat ? (cat.products.active < cat.products.all ? 'Partial' : 'Healthy') : 'Unknown')),
      metric: cat ? `${cat.products.active} / ${cat.products.all}` : null, metricNote: cat ? `products active · ${cat.prices.active} / ${cat.prices.all} prices` : 'products active',
      body: (
        <>
          <KV k="Publishable key">{pay?.publishable ? (pay.publishable.configured ? <Status s="Configured" label={`${pay.publishable.mode} mode`} /> : <Status s="Not configured" />) : <Unrecorded />}</KV>
          <KV k="Webhooks">{wh ? <Status s={wh.state} testid="hq-webhook-health" /> : <Unrecorded />}</KV>
          <KV k="Catalog mirror written">{cat?.last_written_at ? <Freshness at={cat.last_written_at} now={now} staleAfterHours={CATALOG_STALE_DAYS * 24} label="" /> : <Unrecorded reason={pay?.catalog?.reason} />}</KV>
          <KV k="Stripe Tax">{row('stripe_tax') ? <Status s={row('stripe_tax').state} /> : <Unrecorded />}</KV>
          <KV k="Session charging">{row('session_charging') ? <Status s={row('session_charging').state} /> : <Unrecorded />}</KV>
        </>
      ),
      footer: <Freshness at={observedAt} label="observed" />,
      how: wh && (
        <How title="Webhook details" testid="hq-webhook-details">
          <p className="mb-1">{wh.why}</p>
          {wh.fields && (
            <dl data-testid="hq-webhook-fields">
              <KV k="Last delivery">{orNot(wh.fields.last_delivery, 'No delivery is recorded.')}</KV>
              <KV k="Last success">{wh.fields.last_success === undefined ? <Unrecorded reason="This Worker does not report it yet." /> : orNot(wh.fields.last_success, 'No 2xx delivery is recorded.')}</KV>
              <KV k="Last failure">{wh.fields.last_failure === undefined ? <Unrecorded reason="This Worker does not report it yet." /> : (wh.fields.last_failure ?? 'none recorded')}</KV>
              <KV k="Consecutive failures">{orNot(wh.fields.consecutive_failures, 'This Worker does not report it yet.')}</KV>
              <KV k={`Last ${pay.webhook.window_hours} h`}>{wh.fields.window}</KV>
              <KV k="Silence threshold">{wh.fields.silence_threshold}</KV>
              <KV k="Expected activity"><Unrecorded reason="No baseline of expected deliveries is recorded; D4860 asks for its source." /></KV>
              <KV k="Handling latency">{orNot(wh.fields.latency, 'Not recorded for the newest delivery.')}</KV>
            </dl>
          )}
          <p className="mt-1">Silence past {WEBHOOK_SILENCE_HOURS} h reads as Stale: no failures is not proof of health when nothing arrived. {pay?.webhook?.basis}</p>
        </How>
      ),
      link: <Link to="/admin/platform/payments" className={`text-[12px] font-bold text-emerald-800 dark:text-emerald-300 ${FOCUS}`}>Payments →</Link>,
    },
    {
      id: 's-ai', title: 'AI', testid: 'hq-system-ai',
      status: read(row('ai_budget_trip') ? (row('ai_budget_trip').state === 'Tripped' ? 'Critical' : row('ai_budget_trip').state === 'Normal' && row('eadwyn_off')?.state === 'Available' ? 'Healthy' : row('eadwyn_off')?.state === 'Unavailable' ? 'Degraded' : 'Unknown') : 'Unknown'),
      metric: row('eadwyn_off') ? row('eadwyn_off').state : null, metricNote: 'Eadwyn, for members and admins',
      body: (
        <>
          <KV k="AI budget protection">{row('ai_budget_trip') ? <Status s={row('ai_budget_trip').state} /> : <Unrecorded />}</KV>
          <KV k="Question ranking">{row('eadwyn_rerank_off') ? <Status s={row('eadwyn_rerank_off').state} /> : <Unrecorded />}</KV>
          <KV k="Monthly budget used"><Unrecorded reason="Not read on this page; AI usage has it." /></KV>
        </>
      ),
      footer: <Freshness at={observedAt} label="observed" />,
      link: <Link to="/admin/platform/ai-usage" className={`text-[12px] font-bold text-emerald-800 dark:text-emerald-300 ${FOCUS}`}>AI usage →</Link>,
    },
    {
      id: 's-int', title: 'Integrations', testid: 'hq-system-integrations',
      status: read(worst(sig(sigs, 'integrations').status, chStates.includes('Error') ? 'Degraded' : 'Healthy')),
      metric: ints ? `${ints.providers.length}` : null, metricNote: ints ? `providers · ${ints.unhealthy} ${ints.unhealthy === 1 ? 'connection' : 'connections'} in error` : 'providers',
      body: (
        <>
          <KV k="Required keys">{lv ? (lv.Required.total ? `${lv.Required.set} / ${lv.Required.total} set` : 'none declared') : <Unrecorded reason={d?.integration_keys?.reason} />}</KV>
          <KV k="Recommended keys">{lv ? `${lv.Recommended.set} / ${lv.Recommended.total} set` : <Unrecorded />}</KV>
          <KV k="Optional keys">{lv ? `${lv.Optional.set} / ${lv.Optional.total} set · the rest not configured` : <Unrecorded />}</KV>
          <KV k="Broadcast">{tg ? `${chStates.filter((s) => s === 'Verified recently').length} verified · ${chStates.filter((s) => s === 'Unbound').length} unbound · ${tg.channels.length} Telegram` : <Unrecorded reason={d?.broadcast?.telegram?.reason} />}</KV>
        </>
      ),
      footer: <Freshness at={observedAt} label="observed" />,
      how: lv && (
        <How title="How keys are levelled" testid="hq-keys-levels-how">
          Required, Recommended and Optional are D4860&apos;s levels for the fourteen managed keys, for the owner to confirm. None is
          Required: each enables one integration or channel. An Optional key that is not set is not configured, which is a choice, not a
          problem. A key&apos;s value is never read here, and nothing records when a key expires, rotates or was last used, so none is drawn.
        </How>
      ),
      link: <Link to="/admin/integration-keys" className={`text-[12px] font-bold text-emerald-800 dark:text-emerald-300 ${FOCUS}`}>Integration keys →</Link>,
    },
  ];

  return (
    <section aria-labelledby="cs-h" data-testid="hq-core-systems">
      <div className="mb-2 flex items-baseline gap-3">
        <h2 id="cs-h" className="text-[14.5px] font-extrabold tracking-tight text-axal-ink dark:text-white">Core systems</h2>
        <span className="text-[11px] text-axal-faint">status · key metric · freshness · console</span>
      </div>
      {/* Desktop: four blocks side by side. Phone (PL-08 B): disclosure rows
          showing status and key metric, so no desktop column is squeezed. */}
      <div className="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-4">
        {blocks.map((b) => (
          <SystemBlock key={b.id} {...b} footer={<>{b.footer}</>}>
            {b.body}
            {b.how}
          </SystemBlock>
        ))}
      </div>
      <div className={`${CARD} md:hidden`} data-testid="hq-core-systems-phone">
        {blocks.map((b) => (
          <details key={b.id} className="border-t border-axal-hairline py-1 first:border-t-0 dark:border-gray-800">
            <summary className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-2 text-[13px] ${FOCUS}`}>
              <b>{b.title}</b>
              <span className="flex items-center gap-1.5"><Status s={b.status} /> <span className="tabular-nums text-axal-muted">{b.metric ?? '—'}</span></span>
            </summary>
            <dl>{b.body}</dl>
            {b.how}
            <div className="mt-1">{b.link}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ── 4 · Operational activity ────────────────────────────────────────── */

export function OperationalActivity({ events, loading }) {
  return (
    <section aria-labelledby="oa-h" className={CARD} data-testid="hq-operational-activity">
      <h2 id="oa-h" className="text-[14.5px] font-extrabold tracking-tight text-axal-ink dark:text-white">Operational activity</h2>
      {loading ? (
        <p className="mt-2 text-[12.5px] text-axal-muted">Reading…</p>
      ) : events.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-axal-muted">No significant event is recorded in what this page reads.</p>
      ) : (
        <ol className="mt-1">
          {events.map((e) => (
            <li key={`${e.kind}:${e.at.toISOString()}:${e.text}`} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 border-t border-axal-hairline py-1.5 text-[11.5px] dark:border-gray-800 md:grid-cols-[120px_100px_minmax(0,1fr)_auto]">
              <span className="font-mono text-[10.5px] text-axal-faint">{utcStamp(e.at)}</span>
              <span className="hidden font-bold text-axal-muted md:inline">{e.kind}</span>
              <span className="min-w-0">{e.text}</span>
              <Link to={e.to} className={`hidden text-[11px] font-bold text-emerald-800 dark:text-emerald-300 md:inline ${FOCUS}`}>Details</Link>
            </li>
          ))}
        </ol>
      )}
      <How title="What this feed covers">
        Events with a stored time in the reads above: webhook deliveries, the catalog mirror&apos;s last write, failed scheduled jobs, HQ
        switch throws and releases, key saves, failed ticket mirrors and branches not answering. Deployments of HQ itself and detected
        incidents are not recorded here.
      </How>
    </section>
  );
}

/* ── 6 · Detailed consoles ───────────────────────────────────────────── */

export function ConsoleGroups({ sigs }) {
  return (
    <section aria-labelledby="dc-h" data-testid="hq-console-groups">
      <div className="mb-2 flex items-baseline gap-3">
        <h2 id="dc-h" className="text-[14.5px] font-extrabold tracking-tight text-axal-ink dark:text-white">Detailed consoles</h2>
        <span className="text-[11px] text-axal-faint">grouped by domain</span>
      </div>
      <nav aria-labelledby="dc-h" className="grid gap-3 sm:grid-cols-2">
        {CONSOLE_GROUPS.map(([group, links]) => (
          <section key={group} className={CARD} data-testid={`hq-console-group-${group.toLowerCase()}`}>
            <h3 className="text-[12px] font-extrabold uppercase tracking-[.06em] text-axal-faint">{group}</h3>
            <ul className="mt-1">
              {links.map(([label, to, k]) => {
                const s = k ? sigs.find((x) => x.key === k) : null;
                const showState = s && !['Healthy', 'Reading'].includes(s.status);
                return (
                  <li key={to + label}>
                    <Link to={to} className={`flex min-h-[32px] items-center justify-between gap-2 border-t border-axal-hairline py-1 text-[12px] font-semibold text-axal-ink first:border-t-0 dark:border-gray-800 dark:text-white ${FOCUS}`}>
                      <span>{label}</span>
                      {showState ? <Status s={s.status} /> : <span aria-hidden="true" className="text-axal-faint">›</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
      <div role="note" className="mt-3 rounded-xl border border-dashed border-gray-400 p-3 dark:border-gray-500" data-testid="hq-console-preview">
        <div className="flex items-center justify-between gap-2"><b className="text-[13px]">Preview / Planned</b><Status s="Planned" /></div>
        {PREVIEW_CONSOLES.map(([label, to, note]) => (
          <div key={to} className="mt-1 flex items-baseline justify-between gap-2 text-[12px]">
            <span><b>{label}</b><span className="block text-[11px] text-axal-muted">{note}</span></span>
            <Link to={to} className={`shrink-0 text-[11.5px] font-bold text-emerald-800 dark:text-emerald-300 ${FOCUS}`}>View plan</Link>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── the overview ────────────────────────────────────────────────────── */

/**
 * The whole overview, in the canvas's order: version context, health, then
 * Needs attention beside controls and coverage, core systems, activity and
 * consoles. `now` is the moment the page last finished reading.
 */
export default function PlatformOverview({ data, deps, traffic, build, observed, now, UNAVAILABLE }) {
  const sigs = signals({ data, deps, traffic, now, observed, UNAVAILABLE });
  const loading = data === null;
  const health = platformHealth(sigs, { summaryDown: data === UNAVAILABLE, loading });
  const items = loading ? [] : attention(sigs);
  const ready = data && data !== UNAVAILABLE;
  const rows = ready ? switchRows(data.switches) : null;
  return (
    <div className="space-y-4" data-testid="hq-platform-overview">
      <HealthHeader health={health} line={healthLine(sigs)} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <NeedsAttention items={items} unknown={unknownSignals(sigs)} loading={loading} />
        <div className="space-y-4">
          <ActiveControls rows={rows} unreadableReason={ready ? (data.switches?.reason || 'The platform switches could not be read.') : loading ? 'Reading the switches.' : 'The platform summary could not be read.'} />
          <CapabilityCoverage rows={coverage({ data, deps, now, UNAVAILABLE })} />
        </div>
      </div>
      <CoreSystems data={data} sigs={sigs} rows={rows} now={now} observedAt={observed?.summary} UNAVAILABLE={UNAVAILABLE} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <OperationalActivity events={activity({ data, deps, UNAVAILABLE })} loading={loading} />
        <ConsoleGroups sigs={sigs} />
      </div>
      <p className="text-[11px] text-axal-faint">The detail every block summarises follows below, one zone per store.</p>
    </div>
  );
}

