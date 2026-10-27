import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { capitalRelationshipsApi } from '../../../lib/api/capitalRelationships';
import { Unreadable } from '../../../ui';
import { AddDialog } from './CapRelPipeline';
import { DraftDialog } from './CapRelOutreach';
import { tabHref, TABS } from './capRelModel';
import { FIT_FILTERS, FIT_WORDS, MATCH_PAGE, MATCH_SORTS, fundSize, matchQuery, pageLine, verifiedLine } from './capRelTabsModel';

/**
 * D1193 (#3127, CRL7) — Match: the fund directory against this venture
 * (D1190's match read), each fund's Fit from its stated focus against the
 * venture's sector, the people in your own network who work there, and the
 * verified investors on Axal as a count, never names.
 *
 * Add to pipeline opens Add investor with the fund filled in. "Not for us"
 * is not built: hiding a fund needs a store of its own (D1193 §5).
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const FIELD = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LABEL = 'flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-axal-muted dark:text-gray-400';
const BTN_S = 'inline-flex min-h-[32px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-2.5 text-[12px] font-semibold text-axal-ink hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const FIT_TONE = {
  fits: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  outside: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  unclear: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
};

function Facet({ label, name, value, options = [], onChange, none = 'Any' }) {
  return (
    <label className={LABEL}>{label}
      <select className={FIELD} value={value || ''} onChange={(e) => onChange(name, e.target.value)} data-testid={`caprel-match-filter-${name}`}>
        <option value="">{none}</option>
        {options.filter((o) => o.value !== 'none').map((o) => <option key={o.value} value={o.value}>{o.label}{o.count != null ? ` (${o.count})` : ''}</option>)}
      </select>
    </label>
  );
}

export default function CapRelMatch({ projectId, search = '' }) {
  const [f, setF] = useState({ q: '', hq_country: '', focus: '', size_band: '', fit: '', warm: false, sort: 'name', offset: 0 });
  const [typed, setTyped] = useState('');
  const [n, setN] = useState(0);
  const [read, setRead] = useState({ status: 'loading', data: null, error: '' });
  const [adding, setAdding] = useState(null);
  const [asking, setAsking] = useState(null);
  useEffect(() => {
    let alive = true;
    setRead((r) => ({ status: 'loading', data: r.data, error: '' }));
    Promise.resolve().then(() => capitalRelationshipsApi.match(projectId, matchQuery(f)))
      .then((data) => { if (alive) setRead({ status: 'ready', data, error: '' }); })
      .catch((e) => { if (alive) setRead({ status: e?.status === 400 ? 'refused' : 'unreadable', data: null, error: e?.message || '' }); });
    return () => { alive = false; };
  }, [projectId, f, n]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v, offset: 0 }));
  const d = read.data;
  const items = d?.items || [];
  const network = items.flatMap((fund) => (fund.warm_paths || []).map((w) => ({ ...w, fund: fund.name, fundRow: fund, prospectId: fund.in_pipeline?.prospect_id ?? null, key: `${fund.uid}:${w.name}` })));
  const outreach = TABS.find((t) => t.id === 'outreach');
  return (
    <div className="flex flex-col gap-4" data-testid="caprel-match">
      <p className={`m-0 rounded-xl border border-violet-200 bg-axal-lavender px-4 py-2.5 text-[12.5px] ${INK} dark:border-violet-900 dark:bg-violet-950/30`}>
        Match reads each fund’s stated focus against your venture. It never shows another venture’s data.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className={`${CARD} flex flex-col gap-3 p-4`} data-testid="caprel-match-filters">
          <h3 className={`m-0 text-[11px] font-extrabold uppercase tracking-wide ${MUTED}`}>Filters</h3>
          <Facet label="Fit" name="fit" value={f.fit} onChange={set} options={FIT_FILTERS.filter((o) => o.value)} />
          <Facet label="Sector" name="focus" value={f.focus} onChange={set} options={d?.facets?.focus} />
          <Facet label="Geography" name="hq_country" value={f.hq_country} onChange={set} options={d?.facets?.hq_country} none="Anywhere" />
          <Facet label="Fund size" name="size_band" value={f.size_band} onChange={set} options={d?.facets?.size_band} />
          <label className={`flex items-center gap-2 text-[12.5px] font-semibold ${INK}`}>
            <input type="checkbox" checked={f.warm} onChange={(e) => set('warm', e.target.checked)} data-testid="caprel-match-warm" /> Has a warm path
          </label>
          <p className={`m-0 text-[11.5px] ${MUTED}`}>Stage they invest at: not recorded in the fund directory, so it is not a filter.</p>
          {d?.fit_basis ? <p className={`m-0 text-[11.5px] ${MUTED}`}>{d.fit_basis}</p> : null}
        </aside>
        <div className="flex min-w-0 flex-col gap-4">
          <section className={`${CARD} flex min-w-0 flex-col`} data-testid="caprel-match-funds">
            <div className="flex flex-wrap items-center gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
              <h3 className={`m-0 mr-auto text-[14px] font-extrabold ${INK}`}>From the fund directory</h3>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); set('q', typed); }}>
                <input className={`${FIELD} w-48`} placeholder="Search funds" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Search funds" data-testid="caprel-match-search" />
              </form>
              <select className={`${FIELD} w-auto`} value={f.sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort" data-testid="caprel-match-sort">
                {MATCH_SORTS.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
              </select>
            </div>
            {d?.sector_reason ? <p className="m-0 px-4 pt-3 text-[12.5px] text-amber-800 dark:text-amber-300" data-testid="caprel-match-no-sector">{d.sector_reason}</p> : null}
            {read.status === 'refused' ? <p role="alert" className="m-0 px-4 py-3 text-[12.5px] text-red-700 dark:text-red-300">{read.error || 'That filter is not one the directory takes.'}</p> : null}
            {read.status === 'unreadable' ? <div className="px-4 py-3"><Unreadable what="The fund directory" claim="This is not a claim that no fund fits." onRetry={() => setN((x) => x + 1)} /></div> : null}
            {read.status === 'loading' && !d ? <div className="m-4 h-40 animate-pulse rounded-lg bg-axal-ground dark:bg-gray-800" data-testid="caprel-match-loading" /> : null}
            {d ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]">
                  <thead><tr className={`border-b border-axal-hairline text-[10.5px] font-extrabold uppercase tracking-wide ${MUTED} dark:border-gray-800`}>
                    {['Fund · focus', 'Geography', 'Fund size', 'Fit', 'Warm path', ''].map((h) => <th key={h} className="px-3 py-2 font-extrabold">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {items.map((fund) => (
                      <tr key={fund.uid} className="border-b border-axal-hairline align-top last:border-0 dark:border-gray-800" data-testid="caprel-match-row">
                        <td className="px-3 py-2.5"><div className={`font-bold ${INK}`}>{fund.name}</div><div className={MUTED}>Focus: {fund.sector_focus || 'Not recorded'}</div></td>
                        <td className={`px-3 py-2.5 ${INK}`}>{fund.hq || 'Not recorded'}</td>
                        <td className={`px-3 py-2.5 font-mono ${fund.fund_size_cents != null ? INK : MUTED}`} data-testid="caprel-match-size">{fundSize(fund)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${FIT_TONE[fund.fit?.code] || FIT_TONE.unclear}`} data-testid="caprel-match-fit">{fund.fit?.label || FIT_WORDS[fund.fit?.code] || 'Unclear'}</span>
                          <div className={`mt-1 text-[11.5px] ${MUTED}`}>Their focus: {fund.fit?.their_focus || 'not recorded'}. Your sector: {fund.fit?.your_sector || 'not recorded'}.</div>
                        </td>
                        <td className={`px-3 py-2.5 ${fund.warm_paths?.length ? INK : MUTED}`}>{fund.warm_paths?.length ? fund.warm_paths.map((w) => w.sentence).join('; ') : '—'}</td>
                        <td className="px-3 py-2.5 text-right">
                          {fund.in_pipeline
                            ? <span className={`text-[12px] font-semibold ${MUTED}`} data-testid="caprel-match-tracked">In your pipeline</span>
                            : <button type="button" className={BTN_S} onClick={() => setAdding(fund)} data-testid="caprel-match-add">Add to pipeline</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!items.length ? <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`} data-testid="caprel-match-none">No fund in the directory matches these filters.</p> : null}
              </div>
            ) : null}
            {d ? (
              <div className="flex items-center justify-between gap-2 border-t border-axal-hairline px-4 py-2.5 text-[12px] dark:border-gray-800">
                <span className={MUTED} data-testid="caprel-match-count">{pageLine(f.offset, items.length, d.total)}</span>
                <span className="flex gap-2">
                  <button type="button" className={BTN_S} disabled={f.offset === 0} onClick={() => setF((x) => ({ ...x, offset: Math.max(0, x.offset - MATCH_PAGE) }))}>Previous</button>
                  <button type="button" className={BTN_S} disabled={f.offset + items.length >= d.total} onClick={() => setF((x) => ({ ...x, offset: x.offset + MATCH_PAGE }))} data-testid="caprel-match-next">Next</button>
                </span>
              </div>
            ) : null}
          </section>
          <section className={`${CARD} flex flex-col gap-2 border-violet-200 bg-axal-lavender p-4 dark:border-violet-900 dark:bg-violet-950/30`} data-testid="caprel-match-verified">
            <h3 className={`m-0 text-[14px] font-extrabold ${INK}`}>Investors on Axal</h3>
            <p className={`m-0 text-[12.5px] ${INK}`}>{d ? verifiedLine(d.verified_investors) : 'Read with the directory.'}</p>
            <Link to={tabHref(TABS.find((t) => t.id === 'calls'), search)} className={`${BTN_S} w-fit no-underline`}>Open Calls</Link>
          </section>
          <section className={`${CARD} flex flex-col gap-2 p-4`} data-testid="caprel-match-network">
            <h3 className={`m-0 text-[14px] font-extrabold ${INK}`}>Your network</h3>
            {network.length ? network.map((w) => (
              <div key={w.key} className="flex flex-wrap items-center gap-2 border-t border-axal-hairline py-2 first:border-0 dark:border-gray-800">
                <div className="mr-auto"><div className={`text-[13px] font-bold ${INK}`}>{w.name}</div><div className={`text-[12px] ${MUTED}`}>{w.title ? `${w.title} at ` : 'Works at '}{w.fund}</div></div>
                {w.prospectId
                  ? <button type="button" className={BTN_S} onClick={() => setAsking(w)} data-testid="caprel-match-intro">Ask for an intro</button>
                  : <button type="button" className={BTN_S} onClick={() => setAdding(w.fundRow)} data-testid="caprel-match-intro-add">Add {w.fund} first</button>}
              </div>
            )) : <p className={`m-0 text-[12.5px] ${MUTED}`}>{d?.warm_basis || 'Nobody in your network works at a fund on this page.'}</p>}
            <p className={`m-0 text-[11.5px] ${MUTED}`}>Ask for an intro has Eadwyn draft it; the draft waits in <Link to={tabHref(outreach, search)} className="underline">Outreach</Link>, and you send it from your own email. A fund is in your pipeline first, so the intro sits on its record.</p>
          </section>
        </div>
      </div>
      {adding ? <AddDialog projectId={projectId} fund={adding} onClose={() => setAdding(null)} onDone={() => setN((x) => x + 1)} /> : null}
      {asking ? <DraftDialog projectId={projectId} purpose="intro" prospect={{ id: asking.prospectId, name: asking.fund }} via={asking.name} onClose={() => setAsking(null)} /> : null}
    </div>
  );
}
