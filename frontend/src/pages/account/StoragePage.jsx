import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usageApi } from '../../lib/api/usage';
import { publicPricingApi } from '../../lib/api/publicPricing';
import { EmptyState, PhoneBar, Pill, Unrecorded } from '../../ui';
import { BTN, INPUT, PanelCard, useAccountRead } from './AccountCenter';
import {
  COMPANY_NOTE, COMPARE_HREF, COMPARE_PLANS, COUNTS, DOES_NOT_COUNT, KINDS, KIND_FOOT, LARGEST_FOOT, LP_FUND_NOTE, READ_FAILED,
  SEE_LARGEST, STAFF_FOOT, STORAGE_PAGE, UNIT_LINE, allowanceView, companyRows, emptyDoor, filterLargest, kindRows,
  largestRows, noticeFor, upgradeRows,
} from './storagePageModel';

/**
 * D1166, D1171 (#2449) — `/account/usage/storage`, Usage's fourth page, from
 * the canvas "Account · Usage · Storage" (STG1–STG16).
 *
 * TWO READS: D642's `GET /api/usage/storage` as D1169 grew it (the files by
 * kind, company and largest, the plan's allowance and state), and the public
 * plans read for the plan's name and the plans with more room. The words and
 * every rule are `storagePageModel.js`. Each block fails on its own; a failed
 * storage read says so and never draws a zero. Nothing here deletes, hides or
 * cuts a file: the page reads, and Open goes where a file lives.
 */
export default function StoragePage({ role }) {
  const storage = useAccountRead(() => usageApi.storage());
  const plans = useAccountRead(() => publicPricingApi.plansAndPacks());
  return <div className="flex min-w-0 flex-col gap-4" data-testid="usage-storage-page">
    <div className="-mx-[22px] lg:hidden"><PhoneBar back={{ label: 'Usage', to: '/account/usage' }} title={STORAGE_PAGE.title} sub={STORAGE_PAGE.sub} /></div>
    <Link to="/account/usage" className="hidden lg:block text-xs font-semibold text-axal-violet dark:text-violet-300">← Usage overview</Link>
    <header className="hidden lg:block"><h2 className="text-xl font-extrabold tracking-axal-heading">{STORAGE_PAGE.title}</h2><p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">{STORAGE_PAGE.sub}</p></header>
    {storage.status === 'loading' ? <Reading />
      : storage.status !== 'ready' ? <ReadFailed onRetry={storage.reload} />
        : <StorageView s={storage.data} plans={plans.status === 'ready' ? plans.data : null} role={role} reload={storage.reload} />}
  </div>;
}

/** The page once read: every block from the one storage read. Exported for the tests. */
export function StorageView({ s, plans, role, reload }) {
  const v = allowanceView(s, plans);
  const notice = noticeFor(v);
  const empty = s?.files === 0 && v?.mode !== 'unread';
  const lp = s?.plan_key === 'lp_access';
  const largest = <LargestCard s={s} />;
  if (v?.mode === 'staff') {
    return <><StaffCard v={v} />{!empty && <><Kinds s={s} reload={reload} /><Companies s={s} />{largest}</>}<WhatCounts /></>;
  }
  return <>
    {notice && <Notice notice={notice} />}
    <AllowanceCard v={v} reload={reload} />
    {lp && <InfoRow>{LP_FUND_NOTE}</InfoRow>}
    {v?.mode === 'meter' && <Upgrades rows={upgradeRows(plans, s.plan_key, s.allowance_bytes)} />}
    {empty ? <EmptyFiles role={role} /> : <>
      {v?.mode === 'meter' && v.state === 'over' && largest}
      <Kinds s={s} reload={reload} />
      <Companies s={s} />
      {!(v?.mode === 'meter' && v.state === 'over') && largest}
    </>}
    <WhatCounts />
  </>;
}

/* ------------------------------------------------------------------ *
 * States (STG12, STG13)
 * ------------------------------------------------------------------ */

function Reading() {
  const card = (title, n) => <PanelCard key={title} title={title} aside={<span className="text-[12px] text-axal-muted dark:text-gray-400">Reading…</span>}>
    <div className="flex flex-col gap-2" aria-hidden="true">{Array.from({ length: n }, (_, i) => <span key={i} className="block h-3 animate-pulse rounded-md bg-axal-ground dark:bg-gray-800" style={{ width: `${90 - i * 12}%` }} />)}</div>
  </PanelCard>;
  return <div className="flex min-w-0 flex-col gap-4" data-testid="storage-loading" aria-busy="true">
    {card('Your storage', 3)}
    <div className="grid min-w-0 gap-3 md:grid-cols-2">{card('By kind', 5)}{card('By kind · as a table', 5)}</div>
    {card('By company', 4)}
    {card('Largest files', 6)}
  </div>;
}

function ReadFailed({ onRetry }) {
  return <PanelCard title="Your storage" data-testid="storage-read-failed">
    <Alert tone="red" actions={[{ label: 'Try again', onClick: onRetry }]}>{READ_FAILED}</Alert>
  </PanelCard>;
}

/* ------------------------------------------------------------------ *
 * Your storage (STG1–STG3, STG5–STG10, STG16)
 * ------------------------------------------------------------------ */

const TONE = {
  amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
  red: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
  info: 'border-axal-violet/25 bg-axal-lavender text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100',
};

function Alert({ tone = 'red', children, actions = [], testId }) {
  return <div role={tone === 'info' ? 'status' : 'alert'} className={`flex flex-wrap items-center gap-2 rounded-axal-sm border px-3 py-2.5 text-[13px] font-semibold ${TONE[tone]}`} data-testid={testId}>
    <span aria-hidden="true" className="flex-none font-extrabold">{tone === 'info' ? 'i' : '!'}</span>
    <span className="min-w-0 flex-1">{children}</span>
    {actions.map((a) => (a.to
      ? <Link key={a.label} to={a.to} className={a.primary ? BTN.primary : BTN.ghost}>{a.label}</Link>
      : <button key={a.label} type="button" onClick={a.onClick} className={BTN.ghost}>{a.label}</button>))}
  </div>;
}

const InfoRow = ({ children, testId }) => <Alert tone="info" testId={testId}>{children}</Alert>;

function Notice({ notice }) {
  const actions = [notice.compare && { label: COMPARE_PLANS, to: COMPARE_HREF, primary: notice.tone === 'red' }, notice.largest && { label: SEE_LARGEST, to: '#largest-files' }].filter(Boolean);
  return <div className="flex flex-col gap-2" data-testid="storage-notice">
    <Alert tone={notice.tone} actions={actions}>{notice.text}</Alert>
    {notice.recording && <InfoRow testId="storage-recording-kept">{notice.recording}</InfoRow>}
  </div>;
}

/** The six kinds' colours, light and dark, in the canvas's order; Other is hatched. */
const KIND_FILL = {
  data_room: 'bg-violet-600 dark:bg-violet-400',
  documents: 'bg-sky-500 dark:bg-sky-400',
  recordings: 'bg-emerald-500 dark:bg-emerald-400',
  decks_exports: 'bg-amber-500 dark:bg-amber-400',
  brand: 'bg-pink-500 dark:bg-pink-400',
  other: 'bg-gray-200 dark:bg-gray-700',
};
const HATCH = { backgroundImage: 'repeating-linear-gradient(45deg, rgba(107,101,119,.9) 0 1.5px, transparent 1.5px 5px)' };
const OVER_HATCH = { backgroundImage: 'repeating-linear-gradient(45deg, rgba(220,38,38,.85) 0 1.5px, transparent 1.5px 5px)' };
const pct = (f) => `${(Math.max(0, Math.min(1, f)) * 100).toFixed(2)}%`;

function AllowanceCard({ v, reload }) {
  if (!v) return null;
  const pills = <span className="flex flex-wrap gap-1.5">
    {v.label && <Pill tone="info" data-testid="storage-plan-pill">◆ {v.label}</Pill>}
    {v.pill && <Pill tone={v.pill.tone === 'red' ? 'danger' : 'warn'} data-testid="storage-state-pill">{v.pill.label}</Pill>}
  </span>;
  if (v.mode === 'unread') {
    return <PanelCard title="Your storage" aside={pills} data-testid="storage-card-allowance">
      <p className="m-0 font-mono text-2xl font-bold text-axal-muted dark:text-gray-400">Total not shown</p>
      <div className="mt-2"><Alert tone="amber" actions={[{ label: 'Try again', onClick: reload }]}>{v.reason}</Alert></div>
    </PanelCard>;
  }
  if (v.mode === 'negotiated') {
    return <PanelCard title="Your storage" aside={pills} data-testid="storage-card-allowance" footer={v.pending}>
      <p className="m-0 font-mono text-[30px] font-bold tracking-tight" data-testid="storage-used">{v.used ? `${v.used} used` : <Unrecorded reason="The read did not return a size.">Not recorded</Unrecorded>}</p>
      <p className="m-0 mt-1 text-[13px] text-axal-muted dark:text-gray-400" data-testid="storage-no-bar">{v.reason}</p>
    </PanelCard>;
  }
  return <PanelCard title="Your storage" aside={pills} data-testid="storage-card-allowance"
    footer={<>{v.foot}{v.pending && <> {v.pending}</>}</>}>
    <div className="flex flex-wrap items-baseline gap-3">
      <p className="m-0 font-mono text-[22px] font-bold tracking-tight lg:text-[30px]" data-testid="storage-headline">{v.headline}</p>
      <span className={`font-mono text-[13px] font-bold ${v.sideTone === 'red' ? 'text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid="storage-side">{v.side}</span>
    </div>
    <Meter v={v} />
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-axal-muted dark:text-gray-400" data-testid="storage-legend">
      {v.kinds.map((k) => <li key={k.key} className="flex items-center gap-1.5"><span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-sm ${KIND_FILL[k.key] || KIND_FILL.other}`} style={k.key === 'other' ? HATCH : undefined} />{k.label} {k.size}</li>)}
      {v.unknown > 0 && <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-axal-muted dark:border-gray-500" />Size not recorded yet · {v.unknown} {v.unknown === 1 ? 'file' : 'files'}</li>}
      {v.warn && <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-300 dark:bg-amber-500" />Past 80%</li>}
      {v.over && <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={OVER_HATCH} />Over your plan</li>}
    </ul>
    {v.compare && <div className="mt-3"><Link to={COMPARE_HREF} className={BTN.ghost}>{COMPARE_PLANS}</Link></div>}
  </PanelCard>;
}

/**
 * The bar (STG1–STG5): each kind's share, the 80% and 95% ticks, amber past
 * 80%, a red edge when full, and an overrun drawn past the plan's end,
 * hatched and never clipped. Only ever drawn with an allowance.
 */
export function Meter({ v }) {
  let at = 0;
  return <div role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.pct}
    aria-valuetext={`${v.used} of ${v.allowance} used`} className="relative mt-6 pb-5" data-testid="storage-meter">
    <div className={`relative h-4 w-full overflow-hidden rounded bg-axal-ground ring-1 ${v.full ? 'ring-2 ring-red-600 dark:ring-red-400' : 'ring-axal-hairline dark:ring-gray-700'} dark:bg-gray-800`}>
      {v.kinds.map((k) => { const left = at; at += k.share; return <span key={k.key} title={`${k.label} · ${k.size}`} className={`absolute inset-y-0 ${KIND_FILL[k.key] || KIND_FILL.other}`} style={{ left: pct(left), width: pct(k.share), ...(k.key === 'other' ? HATCH : {}) }} data-testid={`storage-meter-${k.key}`} />; })}
      {v.warn && <span title="Past 80% of your plan" className="absolute inset-y-0 bg-amber-300/80 dark:bg-amber-500/70" style={{ left: pct(v.ticks[0]), width: pct(Math.max(0, Math.min(at, v.end) - v.ticks[0])) }} data-testid="storage-meter-warn" />}
      {v.over && <span title={`Over your plan · ${v.over}`} className="absolute inset-y-0 border-l-2 border-red-600 dark:border-red-400" style={{ left: pct(v.end), width: pct(1 - v.end), ...OVER_HATCH }} data-testid="storage-meter-over" />}
    </div>
    {v.ticks.map((t, i) => <span key={i} aria-hidden="true" className="absolute -top-4 flex -translate-x-1/2 flex-col items-center font-mono text-[10.5px] text-axal-muted dark:text-gray-400" style={{ left: pct(t) }}>
      {i === 0 ? '80%' : '95%'}<span className="mt-0.5 block h-6 w-px bg-axal-ink dark:bg-gray-200" />
    </span>)}
    {v.over && <p className="absolute bottom-0 right-0 m-0 font-mono text-[10.5px] font-bold text-red-700 dark:text-red-300" data-testid="storage-meter-over-label">End of your plan · {v.allowance} · {v.over} over</p>}
  </div>;
}

function StaffCard({ v }) {
  return <PanelCard title="Your storage" aside={<Pill tone="neutral" data-testid="storage-plan-pill">◇ Staff account</Pill>} data-testid="storage-card-allowance" footer={<>{STAFF_FOOT}{v.pending && <> {v.pending}</>}</>}>
    <p className="m-0 font-mono text-[30px] font-bold tracking-tight" data-testid="storage-used">{v.used ? `${v.used} used` : <Unrecorded reason="A place where files are kept could not be read.">Not recorded</Unrecorded>}</p>
  </PanelCard>;
}

function Upgrades({ rows }) {
  if (!rows.length) return null;
  return <PanelCard title="More room as you grow" data-testid="storage-upgrades">
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((r) => <li key={r.key} className="border-b border-axal-ground pb-2 last:border-0 dark:border-gray-800">
        <p className="m-0 font-mono text-[13px] font-bold">{r.price ? `${r.price} · ` : ''}{r.label} · {r.size}</p>
        {r.best && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">{r.best}</p>}
      </li>)}
    </ul>
    <div className="mt-3"><Link to={COMPARE_HREF} className={BTN.primary}>{COMPARE_PLANS}</Link></div>
  </PanelCard>;
}

function EmptyFiles({ role }) {
  const door = emptyDoor(role);
  return <PanelCard data-testid="storage-empty">
    <EmptyState size="sm" title="No files yet." body="Files you upload anywhere in StudioOS appear here." cta={door || undefined} data-testid="storage-empty-state" />
  </PanelCard>;
}

/* ------------------------------------------------------------------ *
 * By kind, by company, largest files
 * ------------------------------------------------------------------ */

function Kinds({ s, reload }) {
  const k = kindRows(s);
  return <div className="grid min-w-0 gap-3 md:grid-cols-2">
    <PanelCard title="By kind" data-testid="storage-card-kinds" footer={KIND_FOOT}>
      <p className="sr-only">{k.summary}</p>
      <div className="flex flex-col gap-2" aria-hidden="true">
        {k.rows.map((r) => <div key={r.key} className="grid grid-cols-[96px_minmax(0,1fr)_62px] items-center gap-2.5 text-[12.5px] lg:grid-cols-[136px_minmax(0,1fr)_72px]" data-testid={`storage-kind-bar-${r.key}`}>
          <span className="font-semibold">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800">{r.width > 0 && <span className={`block h-full rounded-full ${KIND_FILL[r.key]}`} style={{ width: `${r.width.toFixed(1)}%`, ...(r.key === 'other' ? HATCH : {}) }} />}</span>
          <span className="text-right font-mono text-[12px] text-axal-muted dark:text-gray-400">{r.unread ? 'Not read' : r.size ?? 'Not recorded'}</span>
        </div>)}
      </div>
    </PanelCard>
    <PanelCard title="By kind · as a table" data-testid="storage-kind-table" footer={k.complete ? null : 'Shares are not shown while one kind cannot be read.'}>
      <table className="w-full text-[12.5px]">
        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-axal-muted dark:text-gray-400"><th className="py-1 font-semibold">Kind</th><th className="py-1 text-right font-semibold">Files</th><th className="py-1 text-right font-semibold">Size</th><th className="py-1 text-right font-semibold">Share of used</th></tr></thead>
        <tbody>
          {k.rows.map((r) => <tr key={r.key} className="border-t border-axal-ground dark:border-gray-800" data-testid={`storage-kind-${r.key}`}>
            <td className="py-1.5 font-semibold">{r.label}</td>
            {r.unread ? <>
              <td className="py-1.5 text-right font-semibold text-red-700 dark:text-red-300">Could not be read</td>
              <td className="py-1.5 text-right"><button type="button" onClick={reload} className={BTN.link}>Try again</button></td>
              <td className="py-1.5 text-right text-axal-muted dark:text-gray-400">—</td>
            </> : <>
              <td className="py-1.5 text-right font-mono">{r.files ?? <Unrecorded reason="The read did not return a count.">Not recorded</Unrecorded>}</td>
              <td className="py-1.5 text-right font-mono">{r.size ?? <Unrecorded reason="Some files were stored before sizes were recorded.">Not recorded</Unrecorded>}</td>
              <td className="py-1.5 text-right font-mono text-axal-muted dark:text-gray-400">{r.share ?? '—'}</td>
            </>}
          </tr>)}
          <tr className="border-t border-axal-hairline font-bold dark:border-gray-700" data-testid="storage-kind-total">
            <td className="py-1.5">In total</td>
            <td className="py-1.5 text-right font-mono">{k.totalFiles ?? '—'}</td>
            <td className={`py-1.5 text-right font-mono ${k.totalSize ? '' : 'text-amber-800 dark:text-amber-300'}`}>{k.totalSize ?? 'Total not shown'}</td>
            <td className="py-1.5 text-right font-mono">{k.totalSize && k.totalSize !== '0 B' ? '100%' : '—'}</td>
          </tr>
        </tbody>
      </table>
    </PanelCard>
  </div>;
}

function Companies({ s }) {
  const rows = companyRows(s);
  const [open, setOpen] = useState(() => new Set(rows?.[0]?.ventures?.length ? [rows[0].key] : []));
  if (!rows) {
    return <PanelCard title="By company" data-testid="storage-card-companies"><Unrecorded reason="Your companies and ventures could not be read.">Not recorded</Unrecorded></PanelCard>;
  }
  const toggle = (key) => setOpen((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const share = (r) => (r.share == null ? <span className="text-axal-muted dark:text-gray-400">—</span>
    : <span className="flex items-center justify-end gap-2"><span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-axal-ground sm:block dark:bg-gray-800"><span className="block h-full bg-violet-600 dark:bg-violet-400" style={{ width: `${r.share}%` }} /></span>{r.share}%</span>);
  const fig = (x) => x ?? <Unrecorded reason="A place where files are kept could not be read.">Not recorded</Unrecorded>;
  return <div className="flex flex-col gap-2">
    <InfoRow testId="storage-company-note">{COMPANY_NOTE}</InfoRow>
    <PanelCard title="By company" data-testid="storage-card-companies" footer={rows.some((r) => r.ventures.length) ? 'A row with ventures opens to show them.' : null}>
      <table className="w-full text-[12.5px]">
        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-axal-muted dark:text-gray-400"><th className="py-1 font-semibold">Company</th><th className="py-1 text-right font-semibold">Files</th><th className="py-1 text-right font-semibold">Size</th><th className="py-1 text-right font-semibold">Share of used</th></tr></thead>
        <tbody>
          {rows.flatMap((r) => [
            <tr key={r.key} className="border-t border-axal-ground dark:border-gray-800" data-testid={`storage-company-${r.key}`}>
              <td className="py-1.5 font-semibold">{r.ventures.length
                ? <button type="button" aria-expanded={open.has(r.key)} onClick={() => toggle(r.key)} className="text-left font-semibold">{open.has(r.key) ? '▾' : '▸'} {r.name}</button>
                : r.name}</td>
              <td className="py-1.5 text-right font-mono">{fig(r.files)}</td>
              <td className="py-1.5 text-right font-mono">{fig(r.size)}</td>
              <td className="py-1.5 text-right font-mono">{share(r)}</td>
            </tr>,
            ...(open.has(r.key) ? r.ventures.map((x) => <tr key={`${r.key}:${x.key}`} className="text-axal-muted dark:text-gray-400" data-testid="storage-venture">
              <td className="py-1 pl-5">└ {x.name}</td><td className="py-1 text-right font-mono">{fig(x.files)}</td><td className="py-1 text-right font-mono">{fig(x.size)}</td><td className="py-1 text-right font-mono">{share(x)}</td>
            </tr>) : []),
          ])}
        </tbody>
      </table>
    </PanelCard>
  </div>;
}

function LargestCard({ s }) {
  const rows = largestRows(s);
  const [kind, setKind] = useState('');
  const [company, setCompany] = useState('');
  const [sort, setSort] = useState('size');
  const shown = useMemo(() => filterLargest(rows, { kind, company, sort }), [rows, kind, company, sort]);
  const companies = useMemo(() => [...new Set((rows || []).map((r) => r.company))], [rows]);
  const incomplete = s?.largest_complete === false;
  return <div id="largest-files" className="scroll-mt-24">
    <PanelCard title="Largest files" data-testid="storage-card-largest" footer={<>{LARGEST_FOOT}{incomplete && ' Some places could not be read, so a larger file may be missing from this list.'}</>}
      aside={rows?.length ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{shown.length === rows.length ? `1–${rows.length}` : `${shown.length} of ${rows.length}`}</span> : null}>
      {!rows ? <Unrecorded reason="The largest files could not be read.">Not recorded</Unrecorded>
        : !rows.length ? <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400">No file with a recorded size yet.</p>
          : <>
            <div className="mb-2 flex flex-wrap gap-2">
              <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className={`${INPUT} w-auto`}><option value="">Kind: all</option>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)} className={`${INPUT} w-auto`}><option value="">Company: all</option>{companies.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className={`${INPUT} w-auto`}><option value="size">Sort: Size</option><option value="added">Sort: Added</option></select>
            </div>
            <ul className="m-0 flex list-none flex-col p-0">
              {shown.map((r) => <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-axal-ground py-2 text-[12.5px] first:border-0 lg:grid-cols-[minmax(0,2.1fr)_1.1fr_1.1fr_.7fr_.7fr_.55fr] lg:items-center dark:border-gray-800" data-testid="storage-largest-row">
                <span className="min-w-0"><span className="block truncate font-bold">{r.name}</span><span className="block text-[11.5px] text-axal-muted dark:text-gray-400">Opens {r.place}</span></span>
                <span className="font-mono lg:order-4 lg:text-right">{r.size}</span>
                <span className="text-axal-muted lg:order-2 dark:text-gray-400">{r.kindLabel}</span>
                <span className="truncate text-axal-muted lg:order-3 dark:text-gray-400">{r.company}</span>
                <span className="font-mono text-axal-muted lg:order-5 lg:text-right dark:text-gray-400">{r.added ?? 'Not recorded'}</span>
                <span className="lg:order-6 lg:text-right">{r.to ? <Link to={r.to} className={BTN.link}>Open ›</Link> : <span className="text-[11.5px] text-axal-muted dark:text-gray-400">No page opens it</span>}</span>
              </li>)}
            </ul>
          </>}
    </PanelCard>
  </div>;
}

function WhatCounts() {
  const list = (items, testId) => <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[13px]" data-testid={testId}>{items.map((r) => <li key={r} className="flex gap-2"><span aria-hidden="true" className="text-axal-violet dark:text-violet-300">•</span>{r}</li>)}</ul>;
  return <div className="grid min-w-0 gap-3 md:grid-cols-2" data-testid="storage-what-counts">
    <PanelCard title="Counts"><p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-axal-muted dark:text-gray-400">What counts</p>{list(COUNTS, 'storage-counts')}</PanelCard>
    <PanelCard title="Does not count" footer={UNIT_LINE}><p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-axal-muted dark:text-gray-400">What counts</p>{list(DOES_NOT_COUNT, 'storage-does-not-count')}</PanelCard>
  </div>;
}
