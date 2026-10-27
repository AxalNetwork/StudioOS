import { useEffect, useState } from 'react';
import { capitalRelationshipsApi } from '../../../lib/api/capitalRelationships';
import { Unreadable } from '../../../ui';
import { ACTIVITY_PAGE, activityCsv, activityQuery, pageLine, whenText } from './capRelTabsModel';

/**
 * D1193 (#3127, CRL12) — Activity: every change to the pipeline, the round
 * and its closes, who made it, when, and its source (Typed, a CSV import, or
 * Proposed by Eadwyn), newest first, 25 a page. The read is the writers' own
 * log rows (`…/capital-relationships/activity`); an answer through a call, a
 * deal-room commitment and a Mercury match are listed on Commitments.
 *
 * Export saves the rows on screen as a CSV in the person's browser; nothing
 * is sent anywhere.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const FIELD = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const BTN_S = 'inline-flex min-h-[32px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-2.5 text-[12px] font-semibold text-axal-ink hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const SOURCE_TONE = {
  eadwyn: 'border-violet-200 bg-axal-lavender text-axal-violet-deep dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300',
  document: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  typed: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

/** Save the rows on screen as a CSV file, in the browser only. */
function saveCsv(items) {
  try {
    const blob = new Blob([activityCsv(items)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'capital-relationships-activity.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch { /* nothing to save in a browser without Blob */ }
}

export default function CapRelActivity({ projectId }) {
  const [f, setF] = useState({ q: '', kind: '', investor: '', page: 1 });
  const [typed, setTyped] = useState('');
  const [n, setN] = useState(0);
  const [read, setRead] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let alive = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    Promise.resolve().then(() => capitalRelationshipsApi.activity(projectId, activityQuery(f)))
      .then((data) => { if (alive) setRead({ status: 'ready', data }); })
      .catch(() => { if (alive) setRead({ status: 'unreadable', data: null }); });
    return () => { alive = false; };
  }, [projectId, f, n]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v, page: 1 }));
  const d = read.data;
  const items = d?.items || [];
  const investors = [...new Map(items.filter((i) => i.investor).map((i) => [i.investor.prospect_id, i.investor.name])).entries()];
  return (
    <section className={`${CARD} flex min-w-0 flex-col`} data-testid="caprel-activity">
      <div className="flex flex-wrap items-center gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h3 className={`m-0 mr-auto text-[14px] font-extrabold ${INK}`}>Activity</h3>
        <form className="flex" onSubmit={(e) => { e.preventDefault(); set('q', typed); }}>
          <input className={`${FIELD} w-48`} placeholder="Search activity" aria-label="Search activity" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="caprel-activity-search" />
        </form>
        <select className={`${FIELD} w-auto`} aria-label="Kind" value={f.kind} onChange={(e) => set('kind', e.target.value)} data-testid="caprel-activity-kind">
          <option value="">Every kind</option>{(d?.kinds || []).map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <select className={`${FIELD} w-auto`} aria-label="Investor" value={f.investor} onChange={(e) => set('investor', e.target.value)} data-testid="caprel-activity-investor">
          <option value="">Every investor</option>{investors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button type="button" className={BTN_S} disabled={!items.length} onClick={() => saveCsv(items)} data-testid="caprel-activity-export">Export</button>
      </div>
      {read.status === 'unreadable' ? <div className="px-4 py-3"><Unreadable what="Activity" claim="This is not a claim that nothing changed." onRetry={() => setN((x) => x + 1)} /></div> : null}
      {read.status === 'loading' && !d ? <div className="m-4 h-40 animate-pulse rounded-lg bg-axal-ground dark:bg-gray-800" data-testid="caprel-activity-loading" /> : null}
      {d ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]">
            <thead><tr className={`border-b border-axal-hairline text-[10.5px] font-extrabold uppercase tracking-wide ${MUTED} dark:border-gray-800`}>
              {['When', 'Who', 'What', 'Source'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
            </tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-axal-hairline align-top last:border-0 dark:border-gray-800" data-testid="caprel-activity-row">
                  <td className={`whitespace-nowrap px-3 py-2 font-mono ${MUTED}`}>{whenText(i.at)}</td>
                  <td className="px-3 py-2"><div className={`font-bold ${INK}`}>{i.who}</div>{i.who_role ? <div className={`text-[11.5px] ${MUTED}`}>{i.who_role}</div> : null}</td>
                  <td className={`px-3 py-2 text-[13px] ${INK}`}>{i.what}{i.investor ? <span className={MUTED}> · {i.investor.name}</span> : null}</td>
                  <td className="px-3 py-2"><span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${SOURCE_TONE[i.source] || SOURCE_TONE.typed}`}>{i.source_label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length ? <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`} data-testid="caprel-activity-none">{f.q || f.kind || f.investor ? 'Nothing matches these filters.' : 'Nothing has changed in this pipeline yet.'}</p> : null}
        </div>
      ) : null}
      {d ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline px-4 py-2.5 text-[12px] dark:border-gray-800">
          <span className={MUTED} data-testid="caprel-activity-count">{pageLine((d.page - 1) * ACTIVITY_PAGE, items.length, d.total)}</span>
          <span className="flex gap-2">
            <button type="button" className={BTN_S} disabled={d.page <= 1} onClick={() => setF((x) => ({ ...x, page: x.page - 1 }))}>Previous</button>
            <button type="button" className={BTN_S} disabled={d.page * ACTIVITY_PAGE >= d.total} onClick={() => setF((x) => ({ ...x, page: x.page + 1 }))} data-testid="caprel-activity-next">Next</button>
          </span>
        </div>
      ) : null}
      {d?.not_here ? <p className={`m-0 px-4 pb-3 text-[11.5px] ${MUTED}`}>{d.not_here}</p> : null}
    </section>
  );
}
