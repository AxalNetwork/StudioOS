import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Landmark } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, Unrecorded, Unreadable } from '../../ui';
import { KINDS, STATES, STORAGE_HQ, countText, kindColumns, planRows, sizeText, stateBars, tiles } from './platformStorageModel';

/**
 * HQ › Platform › Storage (D1172, #3085): board STG20 of the owner's
 * "Account · Usage · Storage" canvas. What members store, by plan and by kind,
 * and how many members are in each storage state on each plan, from D1170's
 * `GET /api/admin/platform/storage`. Totals only: no member, email or file is
 * named, because the read carries none. A Super Admin's page (`hqOnly`); a
 * studio admin gets STG14a's card from `SuperAdminOnlyNotice`.
 *
 * A failed read says so with Try again; a part the read could not measure is
 * null with the read's reason, never a zero. No board has an Eadwyn rail.
 */

const HEAD = 'border-b border-axal-hairline bg-axal-ground/60 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-axal-muted dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400';
const NUM = 'text-right font-mono tabular-nums';
const SEG = (on) => `min-h-[32px] rounded-[7px] px-3 py-1 text-[12px] font-semibold ${on ? 'bg-white text-axal-ink shadow-sm dark:bg-gray-900 dark:text-gray-100' : 'text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`;

function useStorageRead() {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    api.hqPlatformStorage().then(
      (data) => { if (live) setState({ status: 'ready', data }); },
      () => { if (live) setState({ status: 'unreadable', data: null }); },
    );
    return () => { live = false; };
  }, [attempt]);
  return { ...state, reload: useCallback(() => setAttempt((n) => n + 1), []) };
}

/** A cell that is text, or "Not recorded" with why; "—" carries its own reason. */
function Cell({ v }) {
  if (!v) return <Unrecorded />;
  if (v.text === null) return <Unrecorded reason={v.why} />;
  return <span title={v.why || undefined}>{v.text}</span>;
}

function Toggle({ view, onView, label }) {
  return (
    <div className="flex gap-0.5 rounded-[9px] bg-axal-ground p-0.5 dark:bg-gray-800" role="group" aria-label={label}>
      {['Chart', 'Table'].map((v) => <button key={v} type="button" className={SEG(view === v)} aria-pressed={view === v} onClick={() => onView(v)}>{v}</button>)}
    </div>
  );
}

const Swatch = ({ colour }) => (colour === 'hatch'
  ? <span aria-hidden="true" className="inline-block h-2.5 w-3 shrink-0 rounded-[3px] border border-[#6b6577] bg-[repeating-linear-gradient(45deg,#6b6577_0_1.5px,transparent_1.5px_5px)] dark:border-gray-400 dark:bg-[repeating-linear-gradient(45deg,#9ca3af_0_1.5px,transparent_1.5px_5px)]" />
  : <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colour }} />);

function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
      {items.map((it) => <span key={it.key} className="flex items-center gap-1.5 text-[11.5px] text-axal-muted dark:text-gray-400"><Swatch colour={it.colour} />{it.label}</span>)}
    </div>
  );
}

function Section({ title, toggle, legend, foot, children, ...rest }) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 px-4 py-4" {...rest}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">{title}</h2>
        {toggle}
      </div>
      {legend}
      {children}
      {foot && <p className="text-[12px] leading-relaxed text-axal-muted dark:text-gray-400">{foot}</p>}
    </Card>
  );
}

/** Stored by plan: a column per tier, stacked by kind; the table view gives each figure. */
function KindChart({ read }) {
  const [view, setView] = useState('Chart');
  const cols = kindColumns(read);
  const body = !cols ? <Unreadable what="The bytes by plan" claim={read.by_tier_reason || 'No figure is shown instead.'} /> : view === 'Table' ? (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-[12px]" data-testid="hq-storage-kind-table">
        <thead className={HEAD}><tr><th className="px-2 py-2 text-left">Plan</th>{KINDS.map((k) => <th key={k.key} className="px-2 py-2 text-right">{k.label}</th>)}<th className="px-2 py-2 text-right">Total</th></tr></thead>
        <tbody>
          {cols.map((c) => (
            <tr key={c.key} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
              <td className="px-2 py-2 font-semibold">{c.label}</td>
              {c.parts.map((p) => <td key={p.key} className={`px-2 py-2 ${NUM}`}>{sizeText(p.bytes)}</td>)}
              <td className={`px-2 py-2 ${NUM}`}>{sizeText(c.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (() => {
    const W = 560, H = 260, L = 8, T = 22, B = 30, iw = W - L * 2, ih = H - T - B, step = iw / cols.length, bw = step * 0.56;
    const max = Math.max(1, ...cols.map((c) => c.total));
    const y = (v) => T + ih - (v / max) * ih;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" data-testid="hq-storage-kind-chart"
        aria-label={`Stored by plan: ${cols.map((c) => `${c.label} ${sizeText(c.total)}`).join(', ')}.`}>
        <defs>
          <pattern id="hq-storage-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="stroke-[#6b6577] dark:stroke-gray-400" strokeWidth="2" />
          </pattern>
        </defs>
        <line x1={L} x2={L + iw} y1={T + ih} y2={T + ih} className="stroke-axal-hairline dark:stroke-gray-700" />
        {cols.map((c, i) => {
          const x = L + i * step + (step - bw) / 2;
          let acc = 0;
          return (
            <g key={c.key}>
              {c.parts.map((p) => {
                if (!p.bytes) return null;
                const top = y(acc + p.bytes); const h = Math.max(0.8, y(acc) - top);
                acc += p.bytes;
                return (
                  <rect key={p.key} x={x} y={top} width={bw} height={h} fill={p.colour === 'hatch' ? 'url(#hq-storage-hatch)' : p.colour}
                    className={p.colour === 'hatch' ? 'stroke-[#6b6577] dark:stroke-gray-400' : undefined} strokeWidth={p.colour === 'hatch' ? 0.8 : 0}>
                    <title>{`${c.label} · ${p.label} ${sizeText(p.bytes)}`}</title>
                  </rect>
                );
              })}
              <text x={x + bw / 2} y={y(c.total) - 6} textAnchor="middle" fontSize="11" className="fill-axal-ink font-mono dark:fill-gray-100">{sizeText(c.total)}</text>
              <text x={x + bw / 2} y={H - 10} textAnchor="middle" fontSize="11" className="fill-axal-muted dark:fill-gray-400">{c.label}</text>
            </g>
          );
        })}
      </svg>
    );
  })();
  return (
    <Section title={STORAGE_HQ.byPlan} toggle={<Toggle view={view} onView={setView} label="Stored by plan view" />} legend={cols && view === 'Chart' ? <Legend items={KINDS} /> : null} data-testid="hq-storage-by-plan">
      {body}
    </Section>
  );
}

/** Members by state, per plan: a bar per tier; the table view gives each count. */
function StateChart({ read }) {
  const [view, setView] = useState('Chart');
  const bars = stateBars(read);
  const body = !bars ? <Unreadable what="The members by state" claim={read.by_tier_reason || 'No figure is shown instead.'} /> : view === 'Table' ? (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-[12px]" data-testid="hq-storage-state-table">
        <thead className={HEAD}><tr><th className="px-2 py-2 text-left">Plan</th>{STATES.map((s) => <th key={s.key} className="px-2 py-2 text-right">{s.label}</th>)}<th className="px-2 py-2 text-right">Members</th></tr></thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.key} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
              <td className="px-2 py-2 font-semibold">{b.label}</td>
              {b.parts.map((p) => <td key={p.key} className={`px-2 py-2 ${NUM}`}>{countText(p.members)}</td>)}
              <td className={`px-2 py-2 ${NUM}`}>{countText(b.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="flex flex-col gap-2.5" data-testid="hq-storage-state-chart">
      {bars.map((b) => {
        const measured = b.parts.reduce((n, p) => n + p.members, 0);
        return (
          <div key={b.key} className="grid grid-cols-[84px_minmax(0,1fr)_52px] items-center gap-2 text-[12px]" data-tier={b.key}>
            <span className="truncate text-axal-ink dark:text-gray-100">{b.label}</span>
            {b.note || measured === 0
              ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{b.note || STORAGE_HQ.noMembers}</span>
              : (
                <span className="flex h-4 min-w-0 overflow-hidden rounded-[4px] bg-axal-ground dark:bg-gray-800" role="img"
                  aria-label={`${b.label}: ${b.parts.filter((p) => p.members).map((p) => `${p.label} ${countText(p.members)}`).join(', ')}`}>
                  {b.parts.map((p) => (p.members ? <span key={p.key} title={`${b.label} · ${p.label} · ${countText(p.members)} members`} style={{ width: `${(p.members / measured) * 100}%`, background: p.colour }} /> : null))}
                </span>
              )}
            <span className="text-right font-mono tabular-nums text-axal-ink dark:text-gray-100">{countText(b.total)}</span>
          </div>
        );
      })}
    </div>
  );
  return (
    <Section title={STORAGE_HQ.byState} toggle={<Toggle view={view} onView={setView} label="Members by state view" />} legend={bars && view === 'Chart' ? <Legend items={STATES} /> : null}
      foot={STORAGE_HQ.byStateFoot} data-testid="hq-storage-by-state">
      {body}
    </Section>
  );
}

const COLS = ['Plan', 'Allowance', 'Members', 'Used in total', 'Median used', 'Near the limit', 'Full', 'Over their plan'];

function PlanTable({ read }) {
  const [sort, setSort] = useState('used');
  const rows = planRows(read, sort);
  return (
    <Card className="overflow-hidden p-0" data-testid="hq-storage-plans">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h2 className="text-[15px] font-extrabold tracking-[-.01em]">{STORAGE_HQ.table}</h2>
        <label className="flex items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-[32px] rounded-[7px] border border-axal-hairline bg-white px-2 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
            <option value="used">Used in total</option>
            <option value="plan">Plan order</option>
          </select>
        </label>
      </div>
      {!rows ? <div className="px-4 py-3"><Unreadable what="The plans" claim={read.by_tier_reason || 'No plan is shown instead.'} /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[12.5px]">
            <thead className={HEAD}><tr>{COLS.map((c, i) => <th key={c} className={`px-3 py-2 ${i ? 'text-right' : 'text-left'}`}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800" data-tier={r.key}>
                  <td className="px-3 py-2.5"><span className="block font-bold">{r.label}</span><span className="block text-[11.5px] text-axal-muted dark:text-gray-400">{r.plans}</span></td>
                  <td className={`px-3 py-2.5 ${NUM}`}>{r.allowance ?? <Unrecorded />}</td>
                  <td className={`px-3 py-2.5 ${NUM}`}>{r.members}</td>
                  <td className={`px-3 py-2.5 ${NUM}`}><Cell v={r.used} /></td>
                  <td className={`px-3 py-2.5 ${NUM}`}><Cell v={r.median} /></td>
                  <td className={`px-3 py-2.5 ${NUM}`}><Cell v={r.near} /></td>
                  <td className={`px-3 py-2.5 ${NUM}`}><Cell v={r.full} /></td>
                  <td className={`px-3 py-2.5 ${NUM}`}><Cell v={r.over} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-axal-hairline px-4 py-2.5 text-[12px] text-axal-muted dark:border-gray-800 dark:text-gray-400">{STORAGE_HQ.tableFoot}</p>
    </Card>
  );
}

export default function PlatformStoragePage() {
  const read = useStorageRead();
  const data = read.status === 'ready' ? read.data : null;
  return (
    <div className="min-w-0 space-y-4" data-testid="hq-platform-storage-page">
      <div>
        <Link to="/admin/platform" className="inline-flex min-h-[32px] items-center gap-1 text-[12px] font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100">
          <ArrowLeft size={13} /> {STORAGE_HQ.crumb}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">{STORAGE_HQ.title}</h1>
          <span className="inline-flex items-center gap-1 rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <Landmark size={11} aria-hidden="true" /> {STORAGE_HQ.pill}
          </span>
        </div>
        <p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">{STORAGE_HQ.line}</p>
      </div>

      {read.status === 'loading' && !data && <Card aria-busy="true"><p className="text-[12.5px] text-axal-muted dark:text-gray-400">{STORAGE_HQ.reading}</p></Card>}
      {read.status === 'unreadable' && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
          <Unreadable what="Platform storage" claim="No figure is shown instead." onRetry={read.reload} />
        </Card>
      )}

      {data && (
        <>
          {data.complete === false && (
            <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200" data-testid="hq-storage-incomplete">
              {data.reason}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3" data-testid="hq-storage-tiles">
            {tiles(data).map((t) => (
              <Card key={t.key} className="px-4 py-3.5" data-tile={t.key}>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">{t.label}</div>
                <div className={`mt-1.5 font-mono text-[22px] font-medium ${t.muted ? 'text-axal-muted dark:text-gray-400' : 'text-axal-ink dark:text-gray-100'}`}>{t.value ?? <Unrecorded reason={t.reason || undefined} />}</div>
                <div className="mt-0.5 text-[11.5px] text-axal-muted dark:text-gray-400">{t.note}</div>
              </Card>
            ))}
          </div>
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            <KindChart read={data} />
            <StateChart read={data} />
          </div>
          <PlanTable read={data} />
        </>
      )}
    </div>
  );
}
