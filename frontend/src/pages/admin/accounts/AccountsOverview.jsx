/**
 * D1304 (#3401, part 5 of #2377) — Admin › Accounts' Overview as the canvas
 * draws it: ACC1 (light), ACC8 (dark), ACC9a (a new studio, measured zeros),
 * ACC10 (loading), ACC11a (one block fails, the rest stay).
 *
 * One read, D1301's `GET /api/admin/accounts/overview` (`adminAccountsApi`).
 * Its blocks answer alone, so each one here is drawn, said "Not recorded" with
 * why, or failed with Try again on its own. The read failing as a whole is a
 * failed block in the page's place, never a blank page: the header, the tabs
 * and Also in Accounts (`../HeldAccounts.jsx`) stay.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminAccountsApi } from '../../../lib/api/adminAccounts.js';
import { reportError } from '../../../lib/log';
import { Chart, ChartTable } from '../../../ui';
import { accountRecordHref } from '../accountsAddress';
import {
  READINESS_SEGMENTS, attentionRows, isEmptyStudio, kpiTiles, lpByProfileLine, mixParts, newestRows, profileWidgets,
  readinessRows, stateOf,
} from './overviewModel';

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const H3 = 'm-0 text-[15px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet underline-offset-2 hover:underline dark:text-[#a78bfa]';
const EYEBROW = 'font-mono text-[10.5px] uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const DOT = {
  violet: 'bg-axal-violet dark:bg-[#a78bfa]', sky: 'bg-[#0ea5e9]', amber: 'bg-[#f59e0b]', emerald: 'bg-[#10b981]',
  muted: 'bg-axal-muted dark:bg-gray-400', ink: 'bg-axal-ink dark:bg-gray-100',
};
const STROKE = {
  violet: 'stroke-axal-violet dark:stroke-[#a78bfa]', sky: 'stroke-[#0ea5e9]', amber: 'stroke-[#f59e0b]', emerald: 'stroke-[#10b981]',
  muted: 'stroke-axal-muted dark:stroke-gray-400', ink: 'stroke-axal-ink dark:stroke-gray-100',
};

/** A block that could not be read: what, never a zero, and Try again. */
export function BlockFailed({ reason, onRetry, testId }) {
  return (
    <div className="flex flex-col gap-1.5" role="alert" data-testid={testId}>
      <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300">{reason}</p>
      <button type="button" onClick={onRetry} className="w-fit rounded-lg border border-axal-hairline px-3 py-1 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid={`${testId}-retry`}>Try again</button>
    </div>
  );
}

/** A block nothing records: "Not recorded", and why. */
function NotRecorded({ reason, testId }) {
  return <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid={testId}><span className="font-semibold italic">Not recorded.</span> {reason}</p>;
}

function Absent({ state, onRetry, testId }) {
  return state.kind === 'not_recorded'
    ? <NotRecorded reason={state.reason} testId={testId} />
    : <BlockFailed reason={state.reason} onRetry={onRetry} testId={testId} />;
}

function KpiTile({ t, onRetry }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1 p-4`} data-testid={`accounts-kpi-${t.key}`}>
      <span className={EYEBROW}>{t.label}</span>
      {t.state.kind === 'ok' ? (
        <>
          <span className="text-[26px] font-extrabold leading-tight tabular-nums text-axal-ink dark:text-gray-100" data-testid={`accounts-kpi-${t.key}-value`}>{t.value}</span>
          {t.delta && <span className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">{t.delta}</span>}
          {t.sub && <span className={`text-[12px] ${MUTED}`} data-testid={`accounts-kpi-${t.key}-sub`}>{t.sub}</span>}
          {t.note && <span className={`text-[11.5px] ${MUTED}`}>{t.note}</span>}
          {t.link && <Link to={t.link.to} className={`text-[12px] ${LINK}`}>{t.link.label} →</Link>}
        </>
      ) : <Absent state={t.state} onRetry={onRetry} testId={`accounts-kpi-${t.key}-absent`} />}
    </div>
  );
}

function Spark({ spark, tone }) {
  if (!spark) return null;
  return (
    <svg viewBox="0 0 160 36" preserveAspectRatio="none" className="block h-9 w-full" aria-hidden="true">
      <polyline points={spark.solid} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" className={STROKE[tone]} />
      {spark.dash && <polyline points={spark.dash} fill="none" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" className={STROKE[tone]} />}
      <circle cx={spark.last[0]} cy={spark.last[1]} r="3" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className={`fill-white dark:fill-gray-900 ${STROKE[tone]}`} />
    </svg>
  );
}

function Widget({ w, onRetry }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-2 p-4`} data-testid={`accounts-widget-${w.key}`}
      aria-label={w.state.kind === 'ok' && w.value !== undefined ? `${w.label}: ${w.value}${w.delta ? `, ${w.delta}` : ''}.` : w.label}>
      <div className="flex items-center gap-2">
        {w.sub
          ? <span className="rounded-full border border-axal-hairline px-1.5 font-mono text-[10px] font-bold uppercase text-axal-ink dark:border-gray-700 dark:text-gray-100">{w.badge}</span>
          : <span className={`h-[7px] w-[7px] flex-none rounded-full ${DOT[w.tone]}`} aria-hidden="true" />}
        <span className="text-[13px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{w.label}</span>
      </div>
      {w.state.kind !== 'ok' && <Absent state={w.state} onRetry={onRetry} testId={`accounts-widget-${w.key}-absent`} />}
      {w.state.kind === 'ok' && (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-[24px] font-extrabold tabular-nums text-axal-ink dark:text-gray-100" data-testid={`accounts-widget-${w.key}-count`}>{w.value}</span>
            {w.delta && <span className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">{w.delta}</span>}
            {w.none && <span className={`text-[12px] ${MUTED}`} data-testid={`accounts-widget-${w.key}-none`}>{w.none}</span>}
          </div>
          {w.spark ? (
            <div role="img" aria-label={`New ${w.label.toLowerCase()} per week over eight weeks, the last week to date.`} data-testid={`accounts-widget-${w.key}-spark`}>
              <Spark spark={w.spark} tone={w.tone} />
              <span className={`text-[10.5px] ${MUTED}`}>{w.spark.toDate ? 'Last point: to date' : 'Eight weeks of sign-ups'}</span>
            </div>
          ) : w.weeksReason && <span className={`text-[11.5px] ${MUTED}`}>{w.weeksReason}</span>}
          {w.facts?.length > 0 && (
            <dl className="m-0 flex flex-col gap-1 text-[12px]" data-testid={`accounts-widget-${w.key}-facts`}>
              {w.facts.map((f) => (
                <div key={f.key} className="flex items-baseline justify-between gap-2" data-testid={`accounts-fact-${w.key}-${f.key}`}>
                  <dt className={MUTED}>{f.label}</dt>
                  <dd className="m-0 text-right">
                    {f.value !== undefined && <span className="font-mono font-semibold tabular-nums text-axal-ink dark:text-gray-100">{f.value}</span>}
                    {f.link && <> <Link to={f.link.to} className={LINK}>{f.link.label}</Link></>}
                    {f.reason && (f.failed
                      ? <BlockFailed reason={f.reason} onRetry={onRetry} testId={`accounts-fact-${w.key}-${f.key}-failed`} />
                      : <span className={`italic ${MUTED}`}>{f.reason}</span>)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {w.link && !w.none && <Link to={w.link.to} className={`mt-auto text-[12px] ${LINK}`}>{w.link.label}</Link>}
        </>
      )}
    </div>
  );
}

/** A section whose chart can be read as a table. */
function ChartBlock({ id, title, chart, alt, children, extra }) {
  const [table, setTable] = useState(false);
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label={title} data-testid={`accounts-${id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={H3}>{title}</h3>
        {chart && <button type="button" className={`text-[12px] ${LINK}`} onClick={() => setTable(!table)} data-testid={`accounts-${id}-toggle`}>{table ? 'View as chart' : 'View as table'}</button>}
      </div>
      {extra}
      {chart && (table
        ? <div className="overflow-x-auto" data-testid={`accounts-${id}-table`}><ChartTable chart={chart} caption={title} /></div>
        : <div role="img" aria-label={alt} data-testid={`accounts-${id}-chart`}><Chart chart={chart} /></div>)}
      {children}
    </section>
  );
}

function Readiness({ ov, onRetry }) {
  const [seg, setSeg] = useState('all');
  const st = stateOf(ov.readiness);
  const r = st.kind === 'ok' ? readinessRows(ov, seg) : null;
  return (
    <ChartBlock id="readiness" title="Account readiness" chart={r?.chart} alt={r?.alt}
      extra={st.kind === 'ok' && (
        <div role="radiogroup" aria-label="Profile" className="flex flex-wrap gap-1" data-testid="accounts-readiness-segments">
          {READINESS_SEGMENTS.map((s) => (
            <button key={s.key} type="button" role="radio" aria-checked={seg === s.key} onClick={() => setSeg(s.key)} data-testid={`accounts-readiness-seg-${s.key}`}
              className={`min-h-[30px] rounded-lg px-2.5 text-[12px] font-semibold ${seg === s.key ? 'bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200' : 'text-axal-ink dark:text-gray-300'}`}>{s.label}</button>
          ))}
        </div>
      )}>
      {st.kind !== 'ok' && <Absent state={st} onRetry={onRetry} testId="accounts-readiness-absent" />}
      {r?.rows.filter((x) => x.value === null).map((x) => (
        <p key={x.key} className={`m-0 text-[12px] ${MUTED}`} data-testid={`accounts-readiness-${x.key}-unread`}>{x.label}: not read. {x.reason}</p>
      ))}
      {st.kind === 'ok' && <p className={`m-0 text-[12px] ${MUTED}`}>Each bar counts accounts that have done this step, in any order{r ? `, of ${r.total.toLocaleString('en-US')} accounts` : ''}.</p>}
    </ChartBlock>
  );
}

function Testers({ ov, onRetry }) {
  const st = stateOf(ov.product_testers);
  const lps = stateOf(ov.lps);
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Product testers by profile" data-testid="accounts-testers">
      <h3 className={H3}>Product testers by profile</h3>
      {st.kind === 'ok' ? <p className={`m-0 text-[12.5px] ${MUTED}`}>Counted by D1302.</p> : <Absent state={st} onRetry={onRetry} testId="accounts-testers-absent" />}
      <p className={`m-0 text-[12px] ${MUTED}`}>Any profile can apply to test products.</p>
      {lps.kind === 'ok'
        ? <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="accounts-lps-by-profile">{lpByProfileLine(ov.lps.by_profile)}</p>
        : <Absent state={lps} onRetry={onRetry} testId="accounts-lps-absent" />}
    </section>
  );
}

function People({ id, title, rows, state, onRetry, empty, children, viewAll }) {
  return (
    <section className={`${CARD} flex min-w-0 flex-col px-[18px] py-3.5`} aria-label={title} data-testid={`accounts-${id}`}>
      <div className="flex items-baseline justify-between pb-1.5">
        <h3 className={H3}>{title}</h3>
        {viewAll && <Link to="/admin/accounts/all" className={`text-[12px] ${LINK}`}>View all</Link>}
      </div>
      {state.kind !== 'ok' && <Absent state={state} onRetry={onRetry} testId={`accounts-${id}-absent`} />}
      {state.kind === 'ok' && rows.length === 0 && <p className={`m-0 py-2 text-[12.5px] ${MUTED}`} data-testid={`accounts-${id}-empty`}>{empty}</p>}
      {state.kind === 'ok' && rows.map((r) => (
        <div key={`${r.kind || 'n'}-${r.id}`} className="flex min-h-[44px] items-center gap-3 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800" data-testid={`accounts-${id}-row`}>
          <span aria-hidden="true" className="grid h-8 w-8 flex-none place-items-center rounded-full bg-violet-50 text-[11px] font-bold text-violet-800 dark:bg-violet-950 dark:text-violet-200">{r.initials}</span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.name}</span>
            <span className={`truncate text-[12px] ${MUTED}`}>{r.why || r.country}</span>
          </div>
          {r.why
            ? <Link to={accountRecordHref(r.id)} className="inline-flex min-h-[34px] items-center rounded-lg border border-axal-hairline px-3 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid={`accounts-${id}-open-${r.id}`}>Open</Link>
            : (
              <>
                <span className="hidden items-center gap-1.5 text-[12px] text-axal-ink sm:inline-flex dark:text-gray-200"><span className={`h-[7px] w-[7px] rounded-full ${DOT[r.tone]}`} aria-hidden="true" />{r.profile}</span>
                <Link to={accountRecordHref(r.id)} className={`whitespace-nowrap text-[12px] ${LINK}`} data-testid={`accounts-${id}-open-${r.id}`}>{r.joined}</Link>
              </>
            )}
        </div>
      ))}
      {children}
    </section>
  );
}

/** ACC10: what the page draws while the read is out. */
function Loading() {
  const bar = 'animate-pulse rounded bg-gray-100 dark:bg-gray-800';
  return (
    <div className="flex flex-col gap-4" aria-busy="true" data-testid="accounts-overview-loading">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {['Accounts', 'Active in the last 30 days', 'Email not verified', 'Waiting on you'].map((l) => (
          <div key={l} className={`${CARD} flex flex-col gap-1 p-4`}><span className={EYEBROW}>{l}</span><span className={`text-[14px] font-semibold ${MUTED}`}>Reading…</span></div>
        ))}
      </div>
      <div className={`h-8 ${bar}`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className={`h-40 ${bar}`} />)}</div>
      <div className="grid gap-3 lg:grid-cols-2"><div className={`h-48 ${bar}`} /><div className={`h-48 ${bar}`} /></div>
    </div>
  );
}

/** Admin › Accounts › Overview. `now` is for tests. */
export default function AccountsOverview({ now }) {
  const [st, setSt] = useState({ kind: 'loading', data: null });
  const load = useCallback(async () => {
    setSt((s) => ({ kind: s.data ? 'ok' : 'loading', data: s.data }));
    try { setSt({ kind: 'ok', data: await adminAccountsApi.accountsOverview() }); } catch (e) {
      reportError('AccountsOverview:read', e);
      setSt({ kind: 'failed', data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (st.kind === 'loading') return <Loading />;
  if (st.kind === 'failed') {
    return (
      <section className={`${CARD} mt-4 p-4`} data-testid="accounts-overview-failed">
        <BlockFailed reason="The accounts overview could not be read. That is not the same as no accounts; the doors below still open." onRetry={load} testId="accounts-overview-failed-block" />
      </section>
    );
  }
  const ov = st.data;
  const at = now ?? Date.now();
  const empty = isEmptyStudio(ov);
  const mix = empty ? null : mixParts(ov);
  const newest = newestRows(ov, at);
  const attn = attentionRows(ov, at);
  const prof = ov.profiles?.available ? ov.profiles : null;
  return (
    <div className="mt-4 flex flex-col gap-4" data-testid="accounts-overview">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="accounts-kpis">
        {kpiTiles(ov).map((t) => <KpiTile key={t.key} t={t} onRetry={load} />)}
      </div>
      {mix && (
        <ChartBlock id="mix" title="Profile mix" chart={mix.chart} alt={mix.alt}>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {mix.parts.map((p) => <span key={p.key} className={`inline-flex items-center gap-1.5 text-[12px] ${MUTED}`}><span className={`h-2.5 w-2.5 rounded-[3px] ${DOT[p.tone]}`} aria-hidden="true" />{p.label} {p.value.toLocaleString('en-US')}</span>)}
          </div>
        </ChartBlock>
      )}
      <section aria-label="Profiles" className="flex flex-col gap-2" data-testid="accounts-profiles">
        <h3 className={H3}>Profiles</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="accounts-profile-widgets">
          {profileWidgets(ov).map((w) => <Widget key={w.key} w={w} onRetry={load} />)}
        </div>
        {prof && <p className={`m-0 text-[12px] ${MUTED}`} data-testid="accounts-admins-line">Admins: {Number(prof.admins).toLocaleString('en-US')}. HQ opens administrator accounts on a licence.</p>}
      </section>
      {empty && (
        <div className={`${CARD} flex flex-col items-start gap-2 p-5`} data-testid="accounts-empty">
          <h2 className="m-0 text-[17px] font-extrabold text-axal-ink dark:text-gray-100">No accounts yet.</h2>
          <p className={`m-0 text-[13px] ${MUTED}`}>People appear here when they sign up or accept an invitation.</p>
          <Link to="/admin/partner-invitations" className="inline-flex min-h-[40px] items-center rounded-lg border border-axal-hairline px-3.5 text-[13px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100">Open Partner invitations</Link>
        </div>
      )}
      {!empty && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Readiness ov={ov} onRetry={load} />
            <Testers ov={ov} onRetry={load} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <People id="newest" title="Newest accounts" rows={newest || []} state={stateOf(ov.newest)} onRetry={load} empty="No account yet." viewAll />
            <People id="attention" title="Needs attention" rows={attn?.rows || []} state={stateOf(ov.attention)} onRetry={load} empty="Nothing needs you.">
              {attn?.partial && <p className="m-0 mt-2 text-[12px] text-amber-800 dark:text-amber-200" role="status" data-testid="accounts-attention-partial">{attn.partial}</p>}
              {attn?.notCounted.length > 0 && (
                <ul className={`m-0 mt-2 list-none p-0 text-[11.5px] ${MUTED}`} data-testid="accounts-attention-not-counted">
                  {attn.notCounted.map((t) => <li key={t}>Not counted here yet: {t}</li>)}
                </ul>
              )}
            </People>
          </div>
        </>
      )}
      {ov.definitions && (
        <details className={`${CARD} px-[18px] py-3 text-[12px]`} data-testid="accounts-definitions">
          <summary className="cursor-pointer font-semibold text-axal-ink dark:text-gray-100">How is this counted?</summary>
          <dl className="m-0 mt-2 flex flex-col gap-1.5">
            {Object.entries(ov.definitions).map(([k, v]) => <div key={k}><dt className="inline font-semibold text-axal-ink dark:text-gray-100">{k.replace(/_/g, ' ')}: </dt><dd className={`m-0 inline ${MUTED}`}>{v}</dd></div>)}
          </dl>
        </details>
      )}
    </div>
  );
}
