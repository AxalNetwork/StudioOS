import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search, X } from 'lucide-react';
import { adminAiUsageApi } from '../../lib/api/adminAiUsage';
import { Card, RailFrame, Unrecorded, Unreadable, WorkerRail } from '../../ui';
import { microUsd, whenLabel } from '../account/usageModel';
import { modelColour } from '../../lib/modelColours';
import {
  FLAG_LABELS, RANGES, REASON_MAX, REASON_MIN, SORTABLE, dailyByModel, flagRows, headline, historyLine, memberRows, modelName,
  money, panelState, parseCap, readOr, reasonOk, risingRows, roleAndPlan, sortRows, splits,
} from './aiUsageModel';

/**
 * HQ › Platform › AI usage (D791 part 2, #2216): every member's AI runs, what
 * they cost on Cloudflare, what they were charged, and the margin; the five
 * abuse flags; and Pause AI and a member's own cap. Board B5 of the "Usage &
 * Billing console" canvas (`design/incoming/Usage Page.dc.html`, `screen: 'hq'`),
 * at desktop. A Super Admin's page: every read and write needs a recent step-up,
 * which `request()` asks for when the Worker answers `step_up_required`.
 *
 * Members are named by user ID and account email (the owner's ruling,
 * 2026-10-20, on #2227). No prompt or output is read or shown: the run log holds
 * neither. A read that fails says so; nothing unreadable is drawn as $0.
 *
 * Every write is the Worker's and is audited there with its reason
 * (`routes/admin_ai_usage.ts`): Pause AI and Resume AI need a reason of 10 to
 * 500 characters, and so does a cap.
 */

const ROSE = 'inline-flex items-center justify-center whitespace-nowrap rounded-axal-sm bg-rose-900 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-rose-950 disabled:cursor-not-allowed disabled:opacity-50';
const RED = 'inline-flex items-center justify-center whitespace-nowrap rounded-axal-sm bg-red-700 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50';
const GHOST = 'inline-flex items-center justify-center whitespace-nowrap rounded-axal-sm border border-axal-hairline bg-white px-2.5 py-1 text-[12px] font-semibold text-axal-ink hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const FIELD = 'w-full rounded-axal-sm border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink focus:outline-none focus:ring-2 focus:ring-rose-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const HEAD = 'border-b border-axal-hairline bg-axal-ground/60 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-axal-muted dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400';
const NUM = 'text-right font-mono tabular-nums';
const SEG = (on) => `rounded-[7px] px-3 py-1 text-[12px] font-semibold ${on ? 'bg-white text-axal-ink shadow-sm dark:bg-gray-900 dark:text-gray-100' : 'text-axal-muted hover:text-axal-ink dark:text-gray-400'}`;

const FLAG_TONE = {
  paused: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  spike: 'bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200',
  refusals: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  held: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  refund_after_spend: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
  new_heavy: 'bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200',
};
function FlagPill({ kind, label }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${FLAG_TONE[kind] || FLAG_TONE.paused}`} data-flag={kind}>{label}</span>;
}

/** A money cell: the amount, or "Not recorded" when it is not a number. */
function Money({ micro }) {
  const text = money(micro);
  return text == null ? <Unrecorded /> : <span>{text}</span>;
}

/** One read the page re-makes when its inputs change; `reload` makes it again. */
function useRead(reader, deps) {
  const [state, setState] = useState({ status: 'loading', data: null, message: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    reader().then(
      (data) => { if (live) setState({ status: 'ready', data, message: '' }); },
      (e) => { if (live) setState({ status: 'unreadable', data: null, message: e?.message || '' }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return { ...state, reload: useCallback(() => setAttempt((n) => n + 1), []) };
}

/** The daily chart, stacked by model, on the toggle's metric. Each column names its day and amounts. */
function DailyChart({ read, metric }) {
  const chart = useMemo(() => dailyByModel(read, metric), [read, metric]);
  if (!chart.columns.length) return <p className="text-[12px] text-axal-muted">No days in this range.</p>;
  const W = 1000, H = 180, gap = 2;
  const colW = W / chart.columns.length;
  return (
    <div data-testid="ai-usage-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={`Daily ${metric === 'cost' ? 'Cloudflare cost' : 'charge'} by model`}>
        {chart.columns.map((c, i) => {
          let y = H;
          return (
            <g key={c.day}>
              <title>{`${c.day}: ${money(c.total)}${c.parts.length ? ` · ${c.parts.map((p) => `${modelName(p.model)} ${money(p.value)}`).join(' · ')}` : ''}`}</title>
              {c.parts.map((p) => {
                const h = chart.max > 0 ? (p.value / chart.max) * (H - 4) : 0;
                y -= h;
                return <rect key={p.model} x={i * colW + gap / 2} y={y} width={Math.max(colW - gap, 1)} height={h} fill={modelColour(p.model)} />;
              })}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1.5">
        {chart.models.map((m) => (
          <span key={m.model} className="flex items-center gap-1.5 text-[11.5px] text-axal-muted dark:text-gray-400">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: m.colour }} />{m.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function SplitTable({ split }) {
  return (
    <Card className="overflow-hidden p-0" data-testid={`ai-usage-split-${split.head.toLowerCase()}`}>
      <div className="border-b border-axal-hairline px-4 py-3 text-[13.5px] font-bold dark:border-gray-800">{split.title}</div>
      <table className="w-full text-[12px]">
        <thead className={HEAD}>
          <tr><th className="px-4 py-2 text-left">{split.head}</th><th className="px-2 py-2 text-right">Runs</th><th className="px-2 py-2 text-right">CF cost</th><th className="px-2 py-2 text-right">Charged</th><th className="px-4 py-2 text-right">Margin</th></tr>
        </thead>
        <tbody>
          {split.rows.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-axal-muted">No runs in this range.</td></tr>}
          {split.rows.map((r) => (
            <tr key={r.key} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
              <td className="px-4 py-2">
                <span className="flex items-center gap-1.5">{r.colour && <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: r.colour }} />}<span className="truncate">{r.label}</span></span>
              </td>
              <td className={`px-2 py-2 ${NUM}`}>{r.runs.toLocaleString('en-US')}</td>
              <td className={`px-2 py-2 ${NUM}`}><Money micro={r.cost} /></td>
              <td className={`px-2 py-2 ${NUM}`}><Money micro={r.charged} />{r.not_recorded > 0 && <span className="block text-[10.5px] text-axal-muted">{r.not_recorded} not recorded</span>}</td>
              <td className={`px-4 py-2 ${NUM}`}><Money micro={r.margin} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const COLUMNS = [
  { key: 'id', label: 'User ID' }, { key: 'email', label: 'Email' }, { key: 'name', label: 'Member' },
  { key: 'runs', label: 'Runs', num: true }, { key: 'cost', label: 'CF cost', num: true }, { key: 'charged', label: 'Charged', num: true },
  { key: 'margin', label: 'Margin', num: true }, { key: 'topups', label: 'Tokens bought', num: true }, { key: 'flags', label: 'Flags' }, { key: 'acts', label: '' },
];

function MemberActions({ row, onAct }) {
  return (
    <span className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={GHOST} onClick={() => onAct('cap', row)}>Set cap</button>
      {row.paused
        ? <button type="button" className={GHOST} onClick={() => onAct('resume', row)}>Resume AI</button>
        : <button type="button" className={RED} onClick={() => onAct('pause', row)}>Pause AI</button>}
    </span>
  );
}

function MembersCard({ read, range, selected, onSelect, onAct }) {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState(null); // { q, status, members, message }
  const [sort, setSort] = useState({ key: 'charged', dir: 'desc' });

  useEffect(() => { setSearch(null); }, [range]);
  const runSearch = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) { setSearch(null); return; }
    setSearch({ q, status: 'loading', members: [] });
    try {
      const r = await adminAiUsageApi.search(q, range);
      setSearch({ q, status: 'ready', members: r?.members || [] });
    } catch (err) {
      setSearch({ q, status: 'unreadable', members: [], message: err?.message || '' });
    }
  };
  const rows = sortRows(memberRows(read, search?.status === 'ready' ? search.members : read.top_charged), sort.key, sort.dir);
  const rising = risingRows(read);
  const toggleSort = (key) => {
    if (!SORTABLE.includes(key)) return;
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  };
  const grid = 'grid grid-cols-[64px_minmax(0,1.4fr)_minmax(0,1.2fr)_56px_80px_80px_80px_90px_minmax(0,1fr)_170px] items-center gap-2';

  return (
    <Card className="overflow-hidden p-0" data-testid="ai-usage-members">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <div className="flex gap-0.5 rounded-[9px] bg-axal-ground p-0.5 dark:bg-gray-800">
          <button type="button" className={SEG(tab === 'all')} onClick={() => setTab('all')}>All members</button>
          <button type="button" className={SEG(tab === 'rising')} onClick={() => setTab('rising')}>Fastest rising</button>
        </div>
        {tab === 'all' && (
          <form onSubmit={runSearch} className="flex min-w-[300px] items-center gap-2 rounded-[9px] border border-axal-hairline px-2.5 py-1.5 dark:border-gray-700" role="search">
            <Search size={13} className="text-axal-muted" />
            <input aria-label="Search by email or user ID" placeholder="Search by email or user ID" value={query} onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-axal-ink outline-none dark:text-gray-100" maxLength={254} />
            {search && <button type="button" aria-label="Clear the search" onClick={() => { setQuery(''); setSearch(null); }}><X size={13} className="text-axal-muted" /></button>}
          </form>
        )}
        <span className="font-mono text-[11.5px] text-axal-muted">
          {tab === 'all'
            ? (search ? `${search.status === 'ready' ? search.members.length : '…'} found for “${search.q}”` : `Top ${rows.length} by charge`)
            : `${rising.length} rising today`}
        </span>
      </div>

      {tab === 'all' && search?.status === 'unreadable' && <div className="px-4 py-3"><Unreadable what="The search" claim="No member is shown instead." /></div>}
      {tab === 'all' && (
        <div className="overflow-x-auto">
          <div className="min-w-[1080px]">
            <div className={`${grid} px-4 py-2 ${HEAD}`}>
              {COLUMNS.map((c) => (
                <span key={c.key} className={c.num ? 'text-right' : ''}>
                  {SORTABLE.includes(c.key)
                    ? <button type="button" onClick={() => toggleSort(c.key)} className="uppercase" aria-label={`Sort by ${c.label}`}>{c.label}{sort.key === c.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ' ↕'}</button>
                    : c.label}
                </span>
              ))}
            </div>
            {rows.length === 0 && <p className="px-4 py-3 text-[12px] text-axal-muted">{search ? 'No member matches that email or user ID.' : 'No member ran AI in this range.'}</p>}
            {rows.map((r) => (
              <div key={r.id} role="button" tabIndex={0} onClick={() => onSelect(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(r.id); }}
                data-testid="ai-usage-member-row" data-member={r.id}
                className={`${grid} cursor-pointer border-b border-axal-hairline/60 px-4 py-2.5 text-[12px] dark:border-gray-800 ${selected === r.id ? 'bg-rose-50 shadow-[inset_3px_0_0_#881337] dark:bg-rose-950/30' : r.paused ? 'bg-axal-ground/60 dark:bg-gray-800/40' : 'hover:bg-axal-ground/40 dark:hover:bg-gray-800/30'}`}>
                <span className="font-mono text-[11.5px]">#{r.id}</span>
                <span className="truncate font-mono text-[11.5px] text-axal-muted">{r.email || <Unrecorded />}</span>
                <span className="flex min-w-0 flex-col"><span className="truncate font-semibold">{r.name || 'No name'}</span><span className="truncate text-[11px] text-axal-muted">{roleAndPlan(r.role, r.plan) || 'Role not recorded'}</span></span>
                <span className={NUM}>{r.runs.toLocaleString('en-US')}</span>
                <span className={NUM}><Money micro={r.cost} /></span>
                <span className={`${NUM} font-semibold`}><Money micro={r.charged} /></span>
                <span className={NUM}><Money micro={r.margin} /></span>
                <span className={NUM}><Money micro={r.topups} /></span>
                <span className="flex flex-wrap gap-1">{r.flags.map((f) => <FlagPill key={f.kind} kind={f.kind} label={f.label} />)}{r.cap != null && <FlagPill kind="paused" label={`Cap ${microUsd(r.cap)}`} />}</span>
                <MemberActions row={r} onAct={onAct} />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'rising' && (
        <div data-testid="ai-usage-rising">
          <div className={`grid grid-cols-[70px_minmax(0,1.3fr)_90px_110px_60px_minmax(0,1fr)] gap-2.5 px-4 py-2 ${HEAD}`}>
            <span>User ID</span><span>Email</span><span className="text-right">Today</span><span className="text-right">7-day average</span><span className="text-right">×</span><span>Flags</span>
          </div>
          {rising.length === 0 && <p className="px-4 py-3 text-[12px] text-axal-muted">No member has been charged today.</p>}
          {rising.map((r) => (
            <div key={r.id} role="button" tabIndex={0} onClick={() => onSelect(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(r.id); }}
              className="grid cursor-pointer grid-cols-[70px_minmax(0,1.3fr)_90px_110px_60px_minmax(0,1fr)] items-center gap-2.5 border-b border-axal-hairline/60 px-4 py-2.5 text-[12px] hover:bg-axal-ground/40 dark:border-gray-800 dark:hover:bg-gray-800/30">
              <span className="font-mono text-[11.5px]">#{r.id}</span>
              <span className="truncate font-mono text-[11.5px] text-axal-muted">{r.email || <Unrecorded />}</span>
              <span className={NUM}><Money micro={r.today} /></span>
              <span className={NUM}><Money micro={r.average} /></span>
              <span className={`${NUM} font-semibold`}>×{r.ratio}</span>
              <span className="flex flex-wrap gap-1">{r.flags.map((f) => <FlagPill key={f.kind} kind={f.kind} label={f.label} />)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="px-4 py-2.5 text-[11.5px] text-axal-muted">A row opens the member panel. Money columns sort; Charged is sorted high to low.</p>
    </Card>
  );
}

function MemberPanel({ id, range, onClose, onAct, version }) {
  const detail = useRead(() => adminAiUsageApi.member(id, range), [id, range, version]);
  const d = detail.data;
  return (
    <Card className="overflow-hidden border-l-[3px] border-l-rose-900 p-0" data-testid="ai-usage-panel">
      <div className="flex items-start justify-between gap-2.5 border-b border-axal-hairline px-4 py-3.5 dark:border-gray-800">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[.08em] text-rose-900 dark:text-rose-300">Member</span>
          {d ? (
            <>
              <span className="text-[15px] font-extrabold">{d.member.name || 'No name'}</span>
              <span className="truncate font-mono text-[11.5px] text-axal-muted">#{d.member.id} · {d.member.email || 'email not recorded'}</span>
              <span className="text-[12px] text-axal-muted">{roleAndPlan(d.role, d.plan) || 'Role not recorded'}{d.joined ? ` · joined ${whenLabel(d.joined) || d.joined}` : ''}</span>
            </>
          ) : <span className="font-mono text-[12px]">#{id}</span>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close the member panel"><X size={15} className="text-axal-muted" /></button>
      </div>
      <div className="flex flex-col gap-3.5 px-4 py-3.5">
        {detail.status === 'loading' && !d && <p className="text-[12px] text-axal-muted">Reading…</p>}
        {detail.status === 'unreadable' && <Unreadable what="This member" claim="Nothing about them is shown instead." onRetry={detail.reload} />}
        {d && (
          <>
            <section className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[.06em] text-axal-muted">Cloudflare cost against charged · by model</span>
              <div className="overflow-hidden rounded-[9px] border border-axal-hairline dark:border-gray-800">
                {d.by_model.length === 0 && <p className="px-2.5 py-2 text-[11.5px] text-axal-muted">No runs in this range.</p>}
                {d.by_model.map((m) => (
                  <div key={m.model} className="grid grid-cols-[minmax(0,1.6fr)_1fr_1fr] items-center gap-2 border-b border-axal-hairline/60 px-2.5 py-1.5 text-[11.5px] last:border-0 dark:border-gray-800">
                    <span className="flex min-w-0 items-center gap-1.5"><span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: modelColour(m.model) }} /><span className="truncate">{modelName(m.model)}</span></span>
                    <span className={NUM}>{money(m.cost_microusd)} cost</span>
                    <span className={NUM}>{money(m.charged_microusd)} charged</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[.06em] text-axal-muted">By day</span>
              <div className="max-h-40 overflow-y-auto rounded-[9px] border border-axal-hairline text-[11.5px] dark:border-gray-800">
                {d.by_day.length === 0 && <p className="px-2.5 py-2 text-axal-muted">No runs in this range.</p>}
                {d.by_day.map((x) => (
                  <div key={x.day} className="grid grid-cols-[90px_1fr_1fr_50px] gap-2 border-b border-axal-hairline/60 px-2.5 py-1 last:border-0 dark:border-gray-800">
                    <span className="font-mono">{x.day}</span><span className={NUM}>{money(x.cost_microusd)} cost</span><span className={NUM}>{money(x.charged_microusd)} charged</span><span className={NUM}>{x.runs}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="grid grid-cols-2 gap-2">
              {[
                ['Token balance', readOr(d.balance, (b) => microUsd(b.balance_microusd)), 'AI tokens'],
                ['Purchases in range', { text: money(d.totals.topups_microusd), unreadable: false }, 'packs and auto-reloads'],
                ['Plan allowance', readOr(d.allowance, (a) => `${microUsd(a.monthly_microusd)} a month`), d.allowance?.member_cap_microusd != null ? `member cap ${microUsd(d.allowance.member_cap_microusd)}` : 'the plan’s'],
                ['Spend limit', readOr(d.spend_limit, (l) => (l.limit_microusd == null ? 'No limit set' : `${microUsd(l.charged_microusd)} of ${microUsd(l.limit_microusd)}`)), 'this month'],
              ].map(([k, v, n]) => (
                <div key={k} className="rounded-[9px] border border-axal-hairline px-2.5 py-2 dark:border-gray-800">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-axal-muted">{k}</div>
                  <div className="mt-0.5 font-mono text-[13.5px]">{v.unreadable ? <span className="text-red-700 dark:text-red-300">Unreadable</span> : (v.text ?? <Unrecorded />)}</div>
                  <div className="text-[11px] text-axal-muted">{n}</div>
                </div>
              ))}
            </section>
            <section className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between"><span className="font-mono text-[10px] font-semibold uppercase tracking-[.06em] text-axal-muted">Pause and cap</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" data-testid="ai-usage-panel-state">{panelState(d)}</span></span>
              {d.history.length === 0 && <p className="text-[11.5px] text-axal-muted">Never paused or capped.</p>}
              {d.history.map((h, i) => {
                const line = historyLine(h);
                return (
                  <div key={`${h.at}-${i}`} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 border-b border-axal-hairline/60 py-1.5 text-[11.5px] last:border-0 dark:border-gray-800">
                    <span className="font-mono text-axal-muted">{line.when}</span>
                    <span><b className="font-semibold">{line.what}</b> · {line.who}{line.why && <> · <span className="text-axal-muted">{line.why}</span></>}</span>
                  </div>
                );
              })}
            </section>
            <div className="flex gap-1.5">
              <Link to={`/admin/accounts/credits/${d.member.id}`} className={GHOST}>Open account</Link>
              <button type="button" className={GHOST} onClick={() => onAct('cap', { id: d.member.id, email: d.member.email, cap: d.cap?.monthly_microusd ?? null })}>Set cap</button>
              {d.pause
                ? <button type="button" className={GHOST} onClick={() => onAct('resume', { id: d.member.id, email: d.member.email })}>Resume AI</button>
                : <button type="button" className={RED} onClick={() => onAct('pause', { id: d.member.id, email: d.member.email })}>Pause AI</button>}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

const DIALOG = {
  pause: { title: (m) => `Pause AI for #${m.id}?`, verb: 'Pause AI', tone: RED,
    note: 'Nothing is charged while AI is paused. Every run is refused with “AI is paused on this account. Contact support.”, and the member is told once, in the app.' },
  resume: { title: (m) => `Resume AI for #${m.id}?`, verb: 'Resume AI', tone: ROSE, note: 'Their runs are allowed again at once, within their plan, cap and spend limit.' },
  cap: { title: (m) => `Set a monthly cap for #${m.id}`, verb: 'Save cap', tone: ROSE,
    note: 'The lower of this cap and the plan’s allowance applies. Leave the amount empty and save to clear the cap.' },
};

/** Pause AI, Resume AI or Set cap: each needs a reason, recorded with the change. */
function ActionDialog({ kind, member, onCancel, onDone }) {
  const spec = DIALOG[kind];
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(member.cap != null ? String(member.cap / 1_000_000) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cap = kind === 'cap' ? (amount.trim() === '' ? null : parseCap(amount)) : undefined;
  const capOk = kind !== 'cap' || amount.trim() === '' || cap != null;
  const submit = async (e) => {
    e.preventDefault();
    if (!reasonOk(reason) || !capOk) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'pause') await adminAiUsageApi.pause(member.id, reason.trim());
      else if (kind === 'resume') await adminAiUsageApi.resume(member.id, reason.trim());
      else await adminAiUsageApi.setCap(member.id, cap, reason.trim());
      onDone(kind === 'pause' ? `AI paused for #${member.id}.` : kind === 'resume' ? `AI resumed for #${member.id}.`
        : cap == null ? `Cap cleared for #${member.id}.` : `Cap set to ${money(Math.round(cap * 1_000_000))} a month for #${member.id}.`);
    } catch (err) {
      setError(err?.message || 'That did not go through. Nothing changed.');
      setBusy(false);
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="ai-usage-dialog-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" data-testid={`ai-usage-dialog-${kind}`}>
      <form onSubmit={submit} className="w-full max-w-[460px] overflow-hidden rounded-xl border border-red-200 bg-white shadow-2xl dark:border-red-900 dark:bg-gray-900">
        <div id="ai-usage-dialog-title" className="border-b border-red-200 bg-red-50 px-4 py-3 text-[13.5px] font-bold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{spec.title(member)}</div>
        <div className="flex flex-col gap-2.5 px-4 py-3.5">
          {member.email && <span className="font-mono text-[11.5px] text-axal-muted">{member.email}</span>}
          {kind === 'cap' && (
            <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted">Monthly cap, US dollars
              <input className={FIELD} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 300" aria-invalid={!capOk} />
              {!capOk && <span className="font-normal text-red-700 dark:text-red-300">An amount from 0 to 100,000, up to two decimals.</span>}
            </label>
          )}
          <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted">Reason · required
            <textarea className={`${FIELD} min-h-[56px]`} value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'pause' ? 'Why this member’s AI is paused' : 'Why'} />
            <span className="font-normal">{REASON_MIN} to {REASON_MAX} characters, recorded with the change.</span>
          </label>
          <p className="text-[12.5px] text-axal-ink dark:text-gray-200">{spec.note}</p>
          {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{error}</p>}
          <div className="flex justify-end gap-1.5">
            <button type="button" className={GHOST} onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className={spec.tone} disabled={busy || !reasonOk(reason) || !capOk}>{busy ? 'Saving…' : spec.verb}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function AiUsagePage() {
  const [range, setRange] = useState('30d');
  const [metric, setMetric] = useState('charged');
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind, member }
  const [done, setDone] = useState(null);
  const [version, setVersion] = useState(0);
  const read = useRead(() => adminAiUsageApi.read(range), [range, version]);
  const data = read.status === 'ready' ? read.data : null;
  const totals = headline(data);
  const flags = flagRows(data);
  const empty = data && data.totals.runs === 0 && data.totals.refused === 0;

  return (
    <RailFrame
      data-testid="hq-ai-usage-page"
      rail={(
        <WorkerRail
          workspace="AI allowances"
          role="super_admin"
          stance="Reads every member’s AI use"
          note="This rail reads back the platform’s AI runs, cost and charge. It changes nothing; Pause AI, Resume AI and Set cap on the page do, and the Worker records who and why."
          coverage={data ? [`${data.totals.runs.toLocaleString('en-US')} runs`, `${flags.length} flags`] : []}
          coverageNote={data ? undefined : 'AI usage could not be read, so there is nothing to read back.'}
          data-testid="hq-ai-usage-rail"
        />
      )}
    >
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link to="/admin/platform/allowances" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-muted hover:text-axal-ink dark:hover:text-gray-100">
              <ArrowLeft size={13} /> AI allowances
            </Link>
            <h1 className="mt-1 text-2xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">AI usage</h1>
            <p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">Every member’s AI runs: what they cost on Cloudflare, what they were charged, and the margin.</p>
          </div>
          <div className="flex gap-0.5 rounded-[9px] bg-axal-ground p-0.5 dark:bg-gray-800" role="group" aria-label="Range">
            {RANGES.map((r) => <button key={r.key} type="button" className={SEG(range === r.key)} onClick={() => setRange(r.key)} aria-pressed={range === r.key}>{r.label}</button>)}
          </div>
        </div>
        {done && <p role="status" className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12px] dark:border-gray-800 dark:bg-gray-800/40" data-testid="ai-usage-done">{done}</p>}

        {read.status === 'loading' && !data && <Card><p className="text-[12.5px] text-axal-muted">Reading the run log…</p></Card>}
        {read.status === 'unreadable' && (
          <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
            <Unreadable what="The run log" claim="No figure is shown instead." onRetry={read.reload} />
          </Card>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5" data-testid="ai-usage-totals">
              {totals.map((t) => (
                <Card key={t.key} className="px-4 py-3.5" data-total={t.key}>
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[.06em] text-axal-muted">{t.label}</div>
                  <div className="mt-1.5 font-mono text-[22px] font-medium">{t.value ?? <Unrecorded />}</div>
                  <div className="mt-0.5 text-[11.5px] text-axal-muted">{t.note}</div>
                </Card>
              ))}
            </div>
            {empty && <Card><p className="text-[12.5px] text-axal-muted">No AI runs in this range. <button type="button" className="font-semibold text-axal-violet underline" onClick={() => setRange('30d')}>Change the range</button></p></Card>}

            <Card className="flex flex-col gap-2.5 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <span className="text-[14px] font-bold">Daily, by model</span>
                <span className="flex items-center gap-2.5">
                  <span className="flex gap-0.5 rounded-[9px] bg-axal-ground p-0.5 dark:bg-gray-800" role="group" aria-label="Chart metric">
                    <button type="button" className={SEG(metric === 'cost')} onClick={() => setMetric('cost')} aria-pressed={metric === 'cost'}>Cloudflare cost</button>
                    <button type="button" className={SEG(metric === 'charged')} onClick={() => setMetric('charged')} aria-pressed={metric === 'charged'}>Charged</button>
                  </span>
                  <span className="font-mono text-[11.5px] text-axal-muted">{data.from?.slice(0, 10)} – {data.to?.slice(0, 10)} · UTC</span>
                </span>
              </div>
              <DailyChart read={data} metric={metric} />
            </Card>

            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[.08em] text-axal-muted">Splits</h2>
            <div className="grid items-start gap-3 lg:grid-cols-3">{splits(data).map((s) => <SplitTable key={s.title} split={s} />)}</div>

            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[.08em] text-axal-muted">Members</h2>
            <MembersCard read={data} range={range} selected={selected} onSelect={setSelected} onAct={(kind, member) => setDialog({ kind, member })} />

            <div className={`grid items-start gap-3 ${selected ? 'lg:grid-cols-[440px_minmax(0,1fr)]' : ''}`}>
              {selected && <MemberPanel key={selected} id={selected} range={range} version={version} onClose={() => setSelected(null)} onAct={(kind, member) => setDialog({ kind, member })} />}
              <Card className="overflow-hidden p-0" data-testid="ai-usage-flags">
                <div className="flex items-center justify-between border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
                  <span className="text-[13.5px] font-bold">Flags</span>
                  <span className="font-mono text-[11.5px] text-axal-muted">{flags.length} raised</span>
                </div>
                {flags.length === 0 && <p className="px-4 py-3 text-[12px] text-axal-muted">No flag is raised. The thresholds: {Object.keys(FLAG_LABELS).map((k) => FLAG_LABELS[k]).join(', ')}.</p>}
                {flags.map((f, i) => (
                  <div key={`${f.flag}-${f.member.id}-${i}`} className="flex flex-wrap items-center justify-between gap-2.5 border-b border-axal-hairline/60 px-4 py-2.5 last:border-0 dark:border-gray-800">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2"><FlagPill kind={f.flag} label={f.label} /><button type="button" className="font-mono text-[11.5px] underline" onClick={() => setSelected(f.member.id)}>#{f.member.id}</button><span className="truncate font-mono text-[11.5px] text-axal-muted">{f.member.email}</span></span>
                      <span className="text-[12px]">{f.why}</span>
                    </div>
                    <span className="font-mono text-[11px] text-axal-muted">since {f.sinceText}</span>
                  </div>
                ))}
              </Card>
            </div>
          </>
        )}
      </div>
      {dialog && (
        <ActionDialog kind={dialog.kind} member={dialog.member} onCancel={() => setDialog(null)}
          onDone={(msg) => { setDialog(null); setDone(msg); setVersion((v) => v + 1); }} />
      )}
    </RailFrame>
  );
}
