import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Unrecorded, Unreadable } from '../../../ui';
import { adminWorkgraphApi } from '../../../lib/api/adminWorkgraph.js';
import {
  TABS, tabOf, ACTIONS, actionOf, RISK_CLASSES, riskClassOf, NOT_RECORDED, sourceLabel, scanTime, scanStamp, ageWords,
  pageState, workOf, summary, countWords, pairGroups, conflictWords, hunkWords, mergeWords, checksWords, queueWords, baseWords,
  claimOfPr, repoUrl,
} from './workgraphModel';

/**
 * HQ › Platform › Infrastructure › WorkGraph (D5580 part 5, #5580): boards
 * WG-01 to WG-07 of the "WorkGraph PR Conflicts and Reservations" canvas
 * (D5580-p3), at the owner's route A, `/admin/workgraph/in-flight`, with layout
 * A, three tabs at their own addresses (Work in flight, PR pairs, PR evidence).
 * One read, GET /api/admin/workgraph/in-flight (Super Admin; D5580-p4).
 *
 * Advice only: nothing here blocks, labels, merges or releases a claim. Every
 * count names its scan; a partial scan says "at least"; a stale or unreadable
 * scan is said, never drawn as zero; values no store holds read Not recorded
 * with their reason.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const HEAD = 'border-b border-axal-hairline bg-axal-ground/60 px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-axal-muted dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400';
const CELL = 'border-b border-axal-hairline px-3 py-2 align-top text-[12px] text-axal-ink dark:border-gray-800 dark:text-gray-100';
const SMALL = 'block text-[11px] text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700';
const TONE = {
  ok: 'text-emerald-800 dark:text-emerald-300',
  bad: 'text-red-800 dark:text-red-300',
  pending: 'text-amber-800 dark:text-amber-300',
  neutral: 'text-axal-ink dark:text-gray-100',
  unknown: 'text-gray-700 dark:text-gray-300',
};
const ACTION_TONE = {
  serialize: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
  wait: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  coordinate: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300',
  proceed: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
};

function useInFlight() {
  const [state, setState] = useState({ read: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ read: null, error: null });
    adminWorkgraphApi.inFlight().then(
      (read) => { if (live) setState({ read, error: null }); },
      (error) => { if (live) setState({ read: null, error: error || { status: 0 } }); },
    );
    return () => { live = false; };
  }, [attempt]);
  return { ...state, reload: useCallback(() => setAttempt((n) => n + 1), []) };
}

export default function WorkGraphPage() {
  const { pathname } = useLocation();
  const { read, error, reload } = useInFlight();
  return <WorkGraphView tab={tabOf(pathname)} state={pageState(read, error)} onRetry={reload} />;
}

const Ext = ({ href, children, className = '' }) => (href
  ? <a href={href} target="_blank" rel="noopener noreferrer" className={`font-semibold text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-300 ${FOCUS} ${className}`}>{children}<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span></a>
  : <span className="font-semibold">{children}</span>);

const Action = ({ k, n }) => {
  const a = actionOf(k);
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ACTION_TONE[a.key] || TONE.unknown}`}><span aria-hidden="true">{a.sym}</span>{a.label}{n != null && <b className="ml-0.5">{n}</b>}</span>;
};

const Risk = ({ k }) => {
  const r = riskClassOf(k);
  if (!r) return <Unrecorded reason="no risk class for this pair" />;
  return <span className="inline-flex items-center gap-1 text-[12px] font-semibold"><span aria-hidden="true">{r.sym}</span>{r.label}</span>;
};

/** Not recorded, with the reason printed beside it (the canvas's NR chip), not on hover alone. */
const NR = ({ reason }) => <span className="inline"><Unrecorded reason={reason} />{reason && <span className="ml-1 text-[11px] text-axal-muted dark:text-gray-400">{reason}</span>}</span>;

const Words = ({ w }) => (
  <span className="block">
    <span className={`font-semibold ${TONE[w.tone] || ''}`}>{w.text}</span>
    {w.why && <span className={SMALL}>{w.why}</span>}
  </span>
);

function Header({ state, scan }) {
  const fresh = state.kind === 'read'
    ? (state.stale ? `stale · scanned ${ageWords(state.ageMinutes) || 'at an unknown time'}` : `fresh · scanned ${ageWords(state.ageMinutes) || 'recently'}`)
    : 'freshness unknown';
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[11px] font-semibold uppercase tracking-[0.06em] text-axal-muted dark:text-gray-400">
        <Link to="/admin/platform" className={`hover:underline ${FOCUS}`}>Platform</Link> › <span>Infrastructure</span> › <span className="text-axal-ink dark:text-gray-100">WorkGraph</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-extrabold text-axal-ink dark:text-white">WorkGraph</h1>
          <p className="max-w-2xl text-[13px] text-axal-muted dark:text-gray-400">Claimed work and overlapping pull requests from the hourly advisory scan. Advice only: nothing here blocks, labels, merges or releases a claim.</p>
        </div>
        <div className="flex flex-col items-start gap-1 text-[12px] text-axal-muted sm:items-end dark:text-gray-400" data-testid="wg-freshness">
          <span>Scan <b className="text-axal-ink dark:text-gray-100">{scan ? scanStamp(state.generatedAt) : 'not read'}</b></span>
          <span className={state.kind === 'read' && !state.stale ? 'text-emerald-800 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-300'}>{fresh}</span>
          <span>Runs hourly · Super Admin</span>
        </div>
      </header>
    </>
  );
}

function Tabs({ tab, counts }) {
  const cls = (key) => `min-h-[44px] px-3 py-2 text-[13px] font-semibold md:min-h-0 ${FOCUS} ${tab === key ? 'border-b-2 border-emerald-700 text-axal-ink dark:border-emerald-400 dark:text-white' : 'text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-white'}`;
  const n = (key) => counts?.[key] != null && <span className="ml-1.5 text-[11px] font-normal text-axal-muted dark:text-gray-400">{counts[key]}</span>;
  const cur = (key) => (tab === key ? 'page' : undefined);
  // Literal addresses (TABS in the model names the same three), so the route census reaches each tab.
  return (
    <nav aria-label="WorkGraph views" className="flex flex-wrap gap-1 border-b border-axal-hairline dark:border-gray-800">
      <Link to="/admin/workgraph/in-flight" aria-current={cur('in-flight')} className={cls('in-flight')}>{TABS[0].label}{n('in-flight')}</Link>
      <Link to="/admin/workgraph/pairs" aria-current={cur('pairs')} className={cls('pairs')}>{TABS[1].label}{n('pairs')}</Link>
      <Link to="/admin/workgraph/evidence" aria-current={cur('evidence')} className={cls('evidence')}>{TABS[2].label}{n('evidence')}</Link>
    </nav>
  );
}

function Banner({ tone, title, children, onRetry }) {
  const T = { stale: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200', partial: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200', info: 'border-gray-300 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200' };
  return (
    <div role="status" className={`rounded-xl border p-3 text-[12px] ${T[tone] || T.info}`}>
      <p className="font-semibold">{title}</p>
      {children}
      {onRetry && <button type="button" onClick={onRetry} className={`mt-2 min-h-[44px] rounded-lg border border-current px-3 text-[12px] font-semibold md:min-h-[32px] ${FOCUS}`}>Try again</button>}
    </div>
  );
}

function Summary({ work, scan, atLeast }) {
  const s = summary(work);
  const inScan = `in the ${scan} scan`;
  const al = atLeast ? 'at least ' : '';
  const cells = [
    ['Claims held', <span key="h">Claims held</span>, s.held, `${al}${s.held} claims held ${inScan}`],
    ...ACTIONS.map((a) => [a.key, <Action key={a.key} k={a.key} />, s.actions[a.key], `${al}${s.actions[a.key]} to ${a.label.toLowerCase()} ${inScan}`]),
    ['Expired', <span key="e">Expired, still held</span>, s.expired, `${al}${s.expired} past expiry ${inScan}`],
    ['Refused', <span key="r">Refused</span>, s.refused, `${al}${s.refused} registrations refused ${inScan}`],
  ];
  return (
    <section aria-label={`Summary of the ${scan} scan`} className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" data-testid="wg-summary">
      {cells.map(([key, label, n, sub]) => (
        <div key={key} className={CARD + ' !p-3'}>
          <span className="block text-[11px] font-semibold text-axal-muted dark:text-gray-400">{label}</span>
          <b className={`block text-[20px] text-axal-ink dark:text-white ${MONO}`}>{countWords(n, atLeast)}</b>
          <small className={SMALL}>{sub}</small>
        </div>
      ))}
    </section>
  );
}

function WorkGone({ work, scan, onRetry }) {
  if (work.status === 'unreadable') {
    return <Unreadable what={`Unreadable: work in flight (${work.reason || 'claims not read'})`} claim="This is not “no work”. PR pairs and evidence from the same scan still show." onRetry={onRetry} />;
  }
  return (
    <Banner tone="info" title={`Work in flight: not read in the ${scan} scan.`}>
      <p>{work.reason ? `Reason: ${work.reason}. ` : ''}This is not “no work”. PR pairs and evidence from the same scan still show.</p>
    </Banner>
  );
}

function Registration({ r }) {
  const src = sourceLabel(r?.source);
  if (r?.source === 'label') return <><span className={SMALL}>{src}</span><NR reason="a label claim records no times" /></>;
  if (r?.source === 'status') return <><span className={SMALL}>{src}</span><span className={SMALL}>registered {r.registeredAt ? scanStamp(r.registeredAt) : '—'}</span><NR reason="renewal, TTL and expiry: a STATUS claim has none" /></>;
  return (
    <>
      <span className={SMALL}>{src || <NR reason="source not recorded" />}</span>
      <span className={SMALL}>expires {r?.expiresAt ? scanStamp(r.expiresAt) : '—'}{r?.ttlHours != null ? ` · TTL ${r.ttlHours} h` : ''}</span>
      {r?.expired ? <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300"><span aria-hidden="true">◷ </span>Expired, still held</span>
        : r?.renewedAt ? <span className={SMALL}>renewed {scanStamp(r.renewedAt)}</span> : null}
    </>
  );
}

function Base({ b }) {
  if (!b?.sha) return <NR reason={b?.reason || 'no base recorded for this claim'} />;
  return (
    <>
      <code className={`text-[11px] ${MONO}`}>{String(b.sha).slice(0, 7)}</code>
      {b.ageHours != null && <span className={SMALL}>{b.ageHours} h old</span>}
      {b.onMain === null ? <span className={SMALL}>on main: Not checked</span>
        : b.stale ? <span className="block text-[11px] font-semibold text-amber-800 dark:text-amber-300">Stale · {b.staleReason || 'base is stale'}</span>
          : <span className={SMALL}>on main</span>}
    </>
  );
}

function Work({ i, gh }) {
  const prs = Array.isArray(i.prs) ? i.prs : [];
  const deps = Array.isArray(i.dependsOn) ? i.dependsOn : [];
  const paths = Array.isArray(i.paths) ? i.paths : null;
  return (
    <>
      {prs.length ? <span className="flex flex-wrap gap-1">{prs.map((p) => <Ext key={p} href={gh && `${gh}/pull/${p}`}>PR #{p}</Ext>)}</span> : <span className={SMALL}>no linked PR</span>}
      {paths && paths.length ? <span className={SMALL}>{paths.length} paths · {i.pathsSource === 'status' ? 'from STATUS files' : 'from the PR'}</span> : <NR reason="no linked PR and no STATUS files" />}
      {deps.length > 0 && <span className={SMALL}>depends on {deps.map((d) => `#${d.issue} ${d.state}`).join(', ')}</span>}
    </>
  );
}

function Reasons({ i, gh }) {
  const reasons = i?.recommendation?.reasons || [];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-axal-muted dark:text-gray-400">Reasons · highest rule wins</span>
        <ol className="mt-1 space-y-1">
          {reasons.map((r, n) => (
            <li key={n} className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <Action k={r.action} /><span>with {r.with}</span><span className="text-axal-muted dark:text-gray-400">{r.rule}</span>
              {r.path ? <code className={`text-[11px] ${MONO}`}>{r.path}</code> : <span className={SMALL}>no path</span>}
            </li>
          ))}
        </ol>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-axal-muted dark:text-gray-400">Lease</dt><dd><NR reason={i?.lease?.reason || 'the lease is not readable by the scan yet'} /></dd>
        <dt className="text-axal-muted dark:text-gray-400">Owner override</dt><dd><NR reason={NOT_RECORDED.override} /></dd>
        <dt className="text-axal-muted dark:text-gray-400">Estimated lifespan</dt><dd><NR reason={NOT_RECORDED.lifespan} /></dd>
        <dt className="text-axal-muted dark:text-gray-400">Open</dt><dd><Ext href={gh && `${gh}/issues/${i.issue}`}>Issue #{i.issue} on GitHub</Ext></dd>
      </dl>
    </div>
  );
}

function ActionCell({ i, open, onToggle }) {
  const reasons = i?.recommendation?.reasons || [];
  return (
    <>
      {reasons.length
        ? <button type="button" aria-expanded={open} onClick={onToggle} className={`inline-flex min-h-[44px] items-center gap-1.5 text-left md:min-h-0 ${FOCUS}`}>
            <Action k={i.recommendation.action} /><span className={SMALL}>{reasons.length} reason{reasons.length > 1 ? 's' : ''} {open ? '▴' : '▾'}</span>
          </button>
        : <><Action k={i?.recommendation?.action || 'proceed'} /><span className={SMALL}>no rule matched</span></>}
      <span className={SMALL}>risk {i?.workItem?.risk || 'Not recorded'}</span>
    </>
  );
}

function Holder({ h }) {
  return (
    <span className={SMALL}>
      {h?.slot || 'slot Not recorded'} · {h?.agent || 'agent Not recorded'} · {h?.session ? `session ${String(h.session).slice(0, 8)}` : 'session Not recorded'}
    </span>
  );
}

function InFlight({ work, scan, gh, atLeast }) {
  const [open, setOpen] = useState(null);
  const toggle = (n) => setOpen((o) => (o === n ? null : n));
  if (!work.intents.length) {
    return (
      <section className={CARD} aria-labelledby="wif-h" data-testid="wg-empty">
        <h2 id="wif-h" className="text-[15px] font-bold text-axal-ink dark:text-white">Work in flight</h2>
        <p className="mt-2 text-[13px] font-semibold text-axal-ink dark:text-gray-100">No claimed work found in the {scan} scan.</p>
        <p className="text-[12px] text-axal-muted dark:text-gray-400">{atLeast ? 'The scan was partial, so claims it did not reach are not counted.' : 'The scan read every claim ref, STATUS comment and slot label and found none held. That is a measured zero, not a failed read.'}</p>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" aria-labelledby="wif-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <h2 id="wif-h" className="text-[15px] font-bold text-axal-ink dark:text-white">Work in flight</h2>
        <span className={SMALL}>{countWords(work.intents.length, atLeast)} claims in the {scan} scan · sorted by expiry (none last), then issue</span>
      </div>
      <table className="hidden w-full border-collapse md:table" data-testid="wg-wif-table">
        <thead><tr>{['Issue · holder', 'Registration', 'Base', 'PRs · paths · depends', 'Action · risk'].map((h) => <th key={h} scope="col" className={HEAD}>{h}</th>)}</tr></thead>
        <tbody>
          {work.intents.map((i) => [
            <tr key={i.issue}>
              <td className={CELL}>
                <Ext href={gh && `${gh}/issues/${i.issue}`}>#{i.issue}</Ext>
                <Holder h={i.holder} />
                {(i.notes || []).map((n) => <span key={n} className="block text-[11px] font-semibold text-amber-800 dark:text-amber-300"><span aria-hidden="true">! </span>{n}</span>)}
              </td>
              <td className={CELL}><Registration r={i.registration} /></td>
              <td className={CELL}><Base b={i.base} /></td>
              <td className={CELL}><Work i={i} gh={gh} /></td>
              <td className={CELL}><ActionCell i={i} open={open === i.issue} onToggle={() => toggle(i.issue)} /></td>
            </tr>,
            open === i.issue && <tr key={`${i.issue}-x`}><td colSpan={5} className={`${CELL} bg-axal-ground/40 dark:bg-gray-800/40`}><Reasons i={i} gh={gh} /></td></tr>,
          ])}
        </tbody>
      </table>
      <ul className="space-y-2 px-3 pb-3 md:hidden" data-testid="wg-wif-cards">
        {work.intents.map((i) => (
          <li key={i.issue} className="rounded-lg border border-axal-hairline p-3 dark:border-gray-800">
            <div className="flex items-start justify-between gap-2"><Ext href={gh && `${gh}/issues/${i.issue}`}>#{i.issue}</Ext><ActionCell i={i} open={open === i.issue} onToggle={() => toggle(i.issue)} /></div>
            <Holder h={i.holder} />
            <Registration r={i.registration} />
            <Work i={i} gh={gh} />
            {open === i.issue && <div className="mt-2 border-t border-axal-hairline pt-2 dark:border-gray-800"><Reasons i={i} gh={gh} /></div>}
          </li>
        ))}
      </ul>
      <p className="border-t border-axal-hairline px-4 py-2 text-[11px] text-axal-muted dark:border-gray-800 dark:text-gray-400">
        Lease, owner override and estimated lifespan read Not recorded on every row; open a row to see why.
      </p>
    </section>
  );
}

function ListCard({ id, title, items, empty, scan }) {
  return (
    <section className={CARD} aria-labelledby={id}>
      <div className="flex items-baseline justify-between gap-2"><h2 id={id} className="text-[14px] font-bold text-axal-ink dark:text-white">{title}</h2><span className={SMALL}>{items.length} in the {scan} scan</span></div>
      {items.length ? <ul className="mt-2 space-y-1 text-[12px] text-axal-ink dark:text-gray-200">{items.map((t, n) => <li key={n}>{t}</li>)}</ul> : <p className="mt-2 text-[12px] text-axal-muted dark:text-gray-400">{empty}</p>}
    </section>
  );
}

function Pairs({ snapshot, scan, gh, atLeast }) {
  const [open, setOpen] = useState(null);
  const groups = pairGroups(snapshot.pairs);
  const prCount = Array.isArray(snapshot.prs) ? snapshot.prs.length : 0;
  return (
    <>
      <section className={CARD} aria-labelledby="lg-h">
        <h2 id="lg-h" className="text-[14px] font-bold text-axal-ink dark:text-white">Risk classes <span className="text-[11px] font-normal text-axal-muted dark:text-gray-400">lowest to highest</span></h2>
        <ol className="mt-2 grid gap-1 text-[12px] md:grid-cols-5">
          {RISK_CLASSES.map((r, n) => <li key={r.key}><span className={MONO}>{n + 1}</span> <Risk k={r.key} /><span className={SMALL}>{r.why}</span></li>)}
        </ol>
        <p className="mt-2 text-[12px] text-axal-ink dark:text-gray-200"><b>A class is a risk signal, not a merge verdict.</b> Only “Conflict: Yes” means git found a textual conflict when it merged the two heads.</p>
      </section>
      {!groups.length ? (
        <section className={CARD} data-testid="wg-pairs-empty">
          <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">No overlapping PRs in this scan.</p>
          <p className="text-[12px] text-axal-muted dark:text-gray-400">None of the {countWords(prCount, atLeast)} open PRs shares a path or a migration stamp with another{atLeast ? ' among those the partial scan reached' : ''}.</p>
        </section>
      ) : (
        <section className="rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" aria-labelledby="pp-h">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
            <h2 id="pp-h" className="text-[15px] font-bold text-axal-ink dark:text-white">PR pairs</h2>
            <span className={SMALL}>{countWords((snapshot.pairs || []).length, atLeast)} overlapping pairs among {countWords(prCount, atLeast)} open PRs in the {scan} scan · grouped by top folder</span>
          </div>
          {groups.map((g) => (
            <div key={g.module} className="border-t border-axal-hairline dark:border-gray-800" data-testid="wg-pair-group">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-axal-ground/60 px-4 py-2 text-[12px] dark:bg-gray-800/40">
                <code className={MONO}>{g.module}/ · {g.rows.length} pair{g.rows.length > 1 ? 's' : ''}</code>
                <span>Integration owner <NR reason={NOT_RECORDED.integrationOwner} /></span>
              </div>
              <ul>
                {g.rows.map((p) => {
                  const isOpen = open === p.index;
                  return (
                    <li key={p.index} className="border-t border-axal-hairline px-4 py-2 text-[12px] dark:border-gray-800">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className={`${MONO} text-axal-muted dark:text-gray-400`}>{p.index + 1}</span>
                        <span><Ext href={gh && `${gh}/pull/${p.a}`}>PR #{p.a}</Ext> <span aria-hidden="true">↔</span><span className="sr-only">and</span> <Ext href={gh && `${gh}/pull/${p.b}`}>PR #{p.b}</Ext></span>
                        <Risk k={p.risk} />
                        <span className={p.textualConflict === 'yes' ? 'font-semibold text-red-800 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}>{conflictWords(p.textualConflict)}</span>
                        {(p.migrationStamps || []).length ? <span className={MONO}>⌗ {p.migrationStamps.join(', ')} in both</span> : <span className={SMALL}>no shared migration stamp</span>}
                        <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.index)} className={`min-h-[44px] text-[11px] text-axal-muted md:min-h-0 dark:text-gray-400 ${FOCUS}`}>{(p.paths || []).length} shared path{(p.paths || []).length === 1 ? '' : 's'} {isOpen ? '▴' : '▾'}</button>
                      </div>
                      {isOpen && (
                        <ul className="mt-2 space-y-2" data-testid="wg-hunks">
                          {(p.paths || []).map((x) => {
                            const h = hunkWords(x.hunks);
                            return (
                              <li key={x.path} className="rounded-lg border border-axal-hairline p-2 dark:border-gray-800">
                                <code className={`break-all ${MONO}`}>{x.path}</code> <span className={SMALL}>{x.pathClass || 'path'} · {riskClassOf(x.risk)?.label || 'no risk class'}{x.why ? ` · ${x.why}` : ''}</span>
                                {h.kind === 'disjoint'
                                  ? <span className={SMALL}>PR #{p.a}: {h.a} · PR #{p.b}: {h.b}. {h.text}</span>
                                  : <span className={SMALL}>{h.text}</span>}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Evidence({ snapshot, work, scan, gh, atLeast }) {
  const prs = Array.isArray(snapshot.prs) ? snapshot.prs : [];
  const rows = prs.map((pr) => ({ pr, claim: claimOfPr(work, pr.number), cells: [mergeWords(pr.evidence?.merge), checksWords(pr.evidence?.checks), queueWords(pr.evidence?.queue), baseWords(pr.evidence?.baseAge)] }));
  const heads = ['Merge status', 'Required checks', 'CI queue delay', 'Base'];
  return (
    <section className="rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" aria-labelledby="ev-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <h2 id="ev-h" className="text-[15px] font-bold text-axal-ink dark:text-white">PR evidence</h2>
        <span className={SMALL}>{countWords(prs.length, atLeast)} open PRs in the {scan} scan · four separate readings, never one score</span>
      </div>
      {!prs.length ? <p className="px-4 pb-4 text-[12px] text-axal-muted dark:text-gray-400">No open PR in the {scan} scan.</p> : (
        <>
          <table className="hidden w-full border-collapse md:table" data-testid="wg-ev-table">
            <thead><tr><th scope="col" className={HEAD}>PR</th>{heads.map((h) => <th key={h} scope="col" className={HEAD}>{h}</th>)}<th scope="col" className={HEAD}>Review delay</th></tr></thead>
            <tbody>
              {rows.map(({ pr, claim, cells }) => (
                <tr key={pr.number}>
                  <td className={CELL}>
                    <Ext href={gh && `${gh}/pull/${pr.number}/checks`}>PR #{pr.number}</Ext>{pr.draft && <span className="ml-1 text-[11px] text-axal-muted dark:text-gray-400">Draft</span>}{pr.stale && <span className="ml-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300">Stale</span>}
                    <span className={SMALL}>{(pr.paths || []).length} changed paths · {claim ? `claim #${claim}` : 'no claim'}</span>
                  </td>
                  {cells.map((w, n) => <td key={n} className={CELL}><Words w={w} /></td>)}
                  <td className={CELL}><NR reason={NOT_RECORDED.reviewDelay} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-2 px-3 pb-3 md:hidden" data-testid="wg-ev-cards">
            {rows.map(({ pr, claim, cells }) => (
              <li key={pr.number} className="rounded-lg border border-axal-hairline p-3 dark:border-gray-800">
                <Ext href={gh && `${gh}/pull/${pr.number}/checks`}>PR #{pr.number}</Ext><span className={SMALL}>{claim ? `claim #${claim}` : 'no claim'}</span>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">{cells.map((w, n) => [<dt key={`t${n}`} className="text-[11px] text-axal-muted dark:text-gray-400">{heads[n]}</dt>, <dd key={`d${n}`}><Words w={w} /></dd>])}</dl>
              </li>
            ))}
          </ul>
          <p className="border-t border-axal-hairline px-4 py-2 text-[11px] text-axal-muted dark:border-gray-800 dark:text-gray-400">Review delay reads Not recorded on every row: {NOT_RECORDED.reviewDelay}. Pending includes required checks that have not reported. Not measured and Unknown each carry the reason the read gave nothing.</p>
        </>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <section className={CARD} aria-busy="true" aria-labelledby="ld-h" data-testid="wg-loading">
      <h2 id="ld-h" className="text-[15px] font-bold text-axal-ink dark:text-white">Work in flight</h2>
      <span className={SMALL} aria-live="polite">Reading the latest scan…</span>
      <div className="mt-3 space-y-2">{[0, 1, 2, 3].map((n) => <div key={n} className="h-8 animate-pulse rounded bg-axal-ground dark:bg-gray-800" />)}</div>
    </section>
  );
}

/** The page for one state and one tab; exported for tests. */
export function WorkGraphView({ tab, state, onRetry }) {
  const shell = (body, scan) => <div className="mx-auto flex max-w-[1240px] flex-col gap-4 p-4 md:p-6"><Header state={state} scan={scan} />{body}</div>;
  if (state.kind === 'refused') {
    return shell(
      <section role="alert" className={CARD} data-testid="wg-refused">
        <h2 className="text-[17px] font-bold text-axal-ink dark:text-white">Only Super Admins see work in flight</h2>
        <p className="text-[13px] text-axal-muted dark:text-gray-400">This page shows every slot’s claimed work, so it is limited to Super Admins. Nothing about the scan is shown. Ask an existing Super Admin if you need access.</p>
        <Link to="/admin/platform" className={`mt-2 inline-block font-semibold text-emerald-800 hover:underline dark:text-emerald-300 ${FOCUS}`}>Back to Platform</Link>
      </section>, false);
  }
  if (state.kind === 'loading') return shell(<><Tabs tab={tab} /><Skeleton /></>, false);
  if (state.kind === 'unreadable' || state.kind === 'snapshot-unreadable') {
    return shell(<><Tabs tab={tab} /><div data-testid="wg-unreadable"><Unreadable what={`Unreadable: the latest scan (${state.reason})`} claim="Nothing is shown, because the scan itself could not be read. That is not “no work” and not “no conflicts”." onRetry={onRetry} /></div></>, false);
  }
  if (state.kind === 'none') {
    return shell(<><Tabs tab={tab} /><Banner tone="info" title="No scan has been posted yet."><p>{state.reason}. Nothing is counted until one arrives: this is not “no work”.</p></Banner></>, false);
  }

  const { snapshot } = state;
  const scan = scanTime(state.generatedAt) || 'latest';
  const work = workOf(snapshot);
  const atLeast = state.partial;
  const gh = repoUrl(snapshot.repo);
  const counts = {
    'in-flight': work.status === 'read' ? `${countWords(work.intents.length, atLeast || work.partial)} claims` : work.status === 'unreadable' ? 'Unreadable' : 'not read',
    pairs: `${countWords((snapshot.pairs || []).length, atLeast)} pairs`,
    evidence: `${countWords((snapshot.prs || []).length, atLeast)} PRs`,
  };
  const notes = Array.isArray(snapshot.notes) ? snapshot.notes : [];
  return shell(
    <>
      <Tabs tab={tab} counts={counts} />
      <p className="-mt-2 text-[11px] text-axal-muted dark:text-gray-400">Counts are from the {scan} scan.</p>
      {state.stale && <Banner tone="stale" title={`This scan is Stale: taken ${scanStamp(state.generatedAt)}, ${ageWords(state.ageMinutes) || 'at an unknown time'}.`} onRetry={onRetry}><p>Scans run hourly; this one is past the {state.staleAfter ?? 150}-minute line, so every figure below may be out of date.</p></Banner>}
      {atLeast && (
        <Banner tone="partial" title={`Partial scan in the ${scan} scan.`}>
          {notes.length ? <ul className="ml-4 list-disc">{notes.map((n, k) => <li key={k}>{n}</li>)}</ul> : <p>Partial: cause not recorded.</p>}
          <p>Every count below is a lower bound and reads “at least”.</p>
        </Banner>
      )}
      {tab === 'in-flight' && (work.status !== 'read'
        ? <WorkGone work={work} scan={scan} onRetry={onRetry} />
        : <>
            <Summary work={work} scan={scan} atLeast={atLeast || work.partial} />
            <InFlight work={work} scan={scan} gh={gh} atLeast={atLeast || work.partial} />
            <div className="grid gap-3 md:grid-cols-2">
              <ListCard id="rf-h" title="Refused" items={work.refused} scan={scan} empty={`No registration was refused in the ${scan} scan.`} />
              <ListCard id="nt-h" title="Notes" items={work.notes} scan={scan} empty={`No duplicates, history, dropped links or unread issues in the ${scan} scan.`} />
            </div>
            {!atLeast && notes.length > 0 && <ListCard id="sn-h" title="Scan notes" items={notes} scan={scan} empty="" />}
          </>)}
      {tab === 'pairs' && <Pairs snapshot={snapshot} scan={scan} gh={gh} atLeast={atLeast} />}
      {tab === 'evidence' && <Evidence snapshot={snapshot} work={work} scan={scan} gh={gh} atLeast={atLeast} />}
    </>, true);
}
