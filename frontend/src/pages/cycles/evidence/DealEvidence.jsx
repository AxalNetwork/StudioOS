/**
 * D6164 (#6164) — the deal page's Evidence tab, to the Deals v2 Evidence
 * addendum (D6163): DE19 before the NDA, DE20 after it, DE21 one item in a
 * side sheet, DE22 its states, DE30a on a phone (cards, below 1024px) and
 * DE31a in dark. `EvidenceSummary` (InvestorEvidence.jsx) places it; the round
 * call and the diligence room keep the D1268 block.
 *
 * It draws only what `GET /api/deals/:id/evidence` returned. Before the NDA
 * that is coverage, counts only. After it, each item the founder shared with
 * this reader, and the claims those items back; a claim behind a private item
 * never reaches this page, so no count includes one. A failed block says it
 * could not be read and offers Try again; it never draws as none or as zero.
 * Opening the tab is logged by the Worker (`open_evidence`); this file writes
 * nothing.
 *
 * It imports no `ui` index, so the page that places it does not read as drawing the rail.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../../ui/Sheet';
import { DataState, PartialBanner, StateChip } from '../../../ui/Honesty';
import { coverageTile, evidenceChoices, evidenceMatches, investorView, kindWord, recordDay, sourceWord } from './evidenceModel';
import {
  AREA_PAGE, SORTS, areaGroups, claimSummary, coverageTotals, dealClaim, filterCount, itemFacts, noteDraft, partialLine,
  positionIn, providerWord, sharedClaims, sharedWord, sortItems, strengthOf,
} from './dealEvidenceModel';

const CARD = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';
const EYE = `text-[11px] font-semibold uppercase tracking-[.05em] ${MUTED}`;
const BTN = 'inline-flex w-fit items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 py-1.5 text-[13px] font-semibold hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800 max-lg:min-h-[44px]';
const PRIMARY = 'inline-flex w-fit items-center justify-center rounded-lg bg-axal-violet px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400 max-lg:min-h-[44px]';
const SELECT = 'rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] font-semibold dark:border-gray-700 dark:bg-gray-900 max-lg:min-h-[44px]';
const TH = `px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[.04em] ${MUTED}`;
const TD = 'px-2 py-2 align-top text-[13px]';

const CLAIM_TONE = {
  backed: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  founders_figure: 'border-dashed border-gray-400 bg-white text-gray-900 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-100',
  mismatch: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
  not_backed: 'border-dotted border-gray-400 bg-white text-gray-600 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-400',
};
const UNCHECKED_TONE = 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';

/** A claim state as a chip: glyph and word, so no state relies on colour. */
function ClaimChip({ state }) {
  const c = dealClaim(state);
  return (
    <span className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-px text-[11px] font-bold ${CLAIM_TONE[state] || UNCHECKED_TONE}`} data-testid="evidence-claim-state" data-state={state || 'unchecked'}>
      <span aria-hidden="true">{c.glyph}</span>{c.word}
    </span>
  );
}

function Strength({ value }) {
  const s = strengthOf(value);
  if (!s) return <span className={`text-[12px] ${MUTED}`}>Not recorded</span>;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold"><span aria-hidden="true" className="text-[8px] tracking-[1px] text-axal-violet dark:text-violet-300">{s.dots}</span>{s.word}</span>;
}

function Shared({ sharing }) {
  const after = sharing !== 'summary';
  return (
    <span className={`inline-flex w-fit whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold ${after ? 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200' : 'border-dashed border-gray-300 text-axal-muted dark:border-gray-600 dark:text-gray-400'}`}>
      {sharedWord(sharing)}
    </span>
  );
}

/** An item's figure as the read gave it, or the read's own reason. Never a zero for a missing value. */
function Figure({ item, testId }) {
  return item.figure != null
    ? <b className={`${MONO} text-[13px]`} data-testid={testId}>{item.figure}</b>
    : <span className={`text-[12px] ${MUTED}`} data-testid={testId}>{item.value_reason || 'No figure is recorded for this item.'}</span>;
}

function Observed({ item }) {
  const day = recordDay(item.observed_on);
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className={`${MONO} text-[12px]`}>{day || 'Date not recorded'}</span>
      {item.stale && <StateChip kind="stale" label="Stale" data-testid={`evidence-stale-${item.uid}`} />}
    </span>
  );
}

const sourceCell = (item) => `${sourceWord(item.source_label)}${item.provider ? ` · ${providerWord(item.provider)}` : ''}`;

/** DE22 B and the per-block failures: says what could not be read, that it is not none, and offers Try again. */
function Failed({ what, claim, onRetry, testId }) {
  return <DataState state="unavailable" size="block" what={what} claim={claim} onRetry={onRetry || undefined} retryLabel="Try again" announce="always" data-testid={testId} />;
}

// ---------------------------------------------------------------- DE19 · before the NDA

function CoverageTable({ groups }) {
  const totals = coverageTotals(groups);
  return (
    <>
      <table className="hidden w-full border-collapse lg:table" data-testid="evidence-coverage">
        <thead><tr className="border-b border-axal-hairline dark:border-gray-800">
          <th className={TH}>Area</th><th className={TH}>Kind</th><th className={TH}>Source</th><th className={`${TH} text-right`}>Items</th><th className={TH}>Newest</th>
        </tr></thead>
        <tbody>
          {groups.map((g) => {
            const t = coverageTile(g);
            return (
              <tr key={`${g.area}|${g.kind}|${g.source_label}`} className="border-b border-gray-100 dark:border-gray-800" data-testid="evidence-tile">
                <td className={TD}>{t.area}</td><td className={`${TD} font-semibold`}>{t.kind}</td><td className={TD}>{t.source}</td>
                <td className={`${TD} text-right ${MONO}`}>{t.count != null ? t.count : <DataState state="not_recorded" reason="No count was read" reasonVisible={false} />}</td>
                <td className={`${TD} ${MONO}`}>{recordDay(g.newest) || 'Date not recorded'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr>
          <td className={`${TD} font-bold`} colSpan={3}>{totals.groups} {totals.groups === 1 ? 'group' : 'groups'}</td>
          <td className={`${TD} text-right font-bold ${MONO}`} data-testid="evidence-coverage-total">{totals.items != null ? totals.items : <DataState state="not_recorded" reason="A group's count was not read" reasonVisible={false} />}</td>
          <td className={`${TD} ${MUTED}`}>counts only</td>
        </tr></tfoot>
      </table>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:hidden" data-testid="evidence-coverage-cards">
        {groups.map((g) => {
          const t = coverageTile(g);
          return (
            <li key={`${g.area}|${g.kind}|${g.source_label}`} className="flex flex-col gap-0.5 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800">
              <span className={EYE}>{t.area}</span>
              <span className="text-[13px] font-semibold">{t.count != null ? <span className={MONO}>{t.count}</span> : 'Not recorded'} · {t.kind}</span>
              <span className={`text-[12px] ${MUTED}`}>{t.source} · {t.newest}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function BeforeNda({ v, ndaHref, onRetry }) {
  const shown = v.coverage.ok ? coverageTotals(v.coverage.rows).items : null;
  return (
    <>
      {v.partial && <Partial shown={shown} onRetry={onRetry} />}
      <section className={CARD} data-testid="evidence-before">
        <div className="flex flex-col gap-0.5">
          <span className={EYE} data-testid="evidence-before-nda">Before the NDA · counts only</span>
          <h2 className="m-0 text-[17px] font-bold">Evidence the founder has shared</h2>
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg border border-axal-hairline bg-gray-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-800/60" data-testid="evidence-lock-line">
          <b className="text-[13px]">{v.line}</b>
          <span className={`text-[12px] ${MUTED}`}>Until then you see how much is shared in each area, and how recent it is.</span>
        </div>
        {!v.coverage.ok ? <Failed what="The coverage counts" claim="That is not the same as none being shared." onRetry={onRetry} testId="evidence-coverage-unreadable" />
          : v.coverage.rows.length === 0 ? <p className={`m-0 text-[13px] ${MUTED}`} data-testid="evidence-coverage-empty">The founder has not shared any evidence yet.</p>
            : <CoverageTable groups={v.coverage.rows} />}
        <p className={`m-0 text-[12px] ${MUTED}`}>Files the data room opens only after the NDA are not counted here yet.</p>
        {ndaHref && <Link to={ndaHref} className={PRIMARY} data-testid="evidence-sign-nda">Sign the NDA</Link>}
      </section>
      <section className={`${CARD} gap-1.5`}>
        <span className={EYE}>After the NDA</span>
        <p className="m-0 text-[12.5px]">Each item with its source, strength and date; figures where the founder shared them; and which claims they back.</p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- DE20 · after the NDA

function Partial({ shown, onRetry }) {
  return <PartialBanner lead="Some items could not be read. The rest are shown." rest={partialLine(shown)} missing={1} sources={[{ state: 'unavailable' }]} onRetry={onRetry || undefined} data-testid="evidence-partial" />;
}

function ClaimsCard({ rows }) {
  const [open, setOpen] = useState(false);
  if (!rows) return null;
  const s = claimSummary(rows);
  return (
    <div className="flex flex-col gap-2.5" role="group" aria-label="Claims summary" data-testid="evidence-claims">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className={EYE}>Claims the founder shared</span>
          <b className="text-[18px] max-lg:text-[16px]" data-testid="evidence-claim-tally">{s.line}</b>
        </div>
        {s.total > 0 && (
          <button type="button" className={BTN} aria-expanded={open} onClick={() => setOpen((x) => !x)} data-testid="evidence-claims-toggle">
            {open ? 'Hide the claims' : `See the ${s.total} ${s.total === 1 ? 'claim' : 'claims'} ›`}
          </button>
        )}
      </div>
      {s.total > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {s.counts.map(([state, n]) => (
            <span key={state} className="inline-flex items-center gap-1.5" data-testid={`evidence-claim-count-${state}`}><ClaimChip state={state === 'unchecked' ? null : state} /><b className={MONO}>{n}</b></span>
          ))}
        </div>
      )}
      {open && (
        <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800" data-testid="evidence-claims-list">
          {rows.map((c) => (
            <li key={c.uid} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-col"><b className="text-[13px]">{c.title}</b><span className={`text-[12px] ${MUTED}`}>{[c.where, c.checked ? `checked ${c.checked}` : 'Not checked yet'].filter(Boolean).join(' · ')}</span></span>
              <ClaimChip state={c.state} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Filters({ choices, selected, setSelected, sort, setSort }) {
  const [shown, setShown] = useState(false);
  const set = (name, value) => setSelected((prev) => ({ ...prev, [name]: value }));
  const n = filterCount(selected);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 lg:hidden">
        <button type="button" className={BTN} aria-expanded={shown} onClick={() => setShown((x) => !x)} data-testid="evidence-filters-toggle">Filters · {n}</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={`${shown ? 'flex' : 'hidden'} flex-wrap items-center gap-2 lg:flex`} data-testid="evidence-filters">
          <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
            <span className={MUTED}>Area</span>
            <select className={SELECT} value={selected.area || ''} onChange={(e) => set('area', e.target.value)} data-testid="evidence-filter-area">
              <option value="">All {choices.area.length}</option>
              {choices.area.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
            <span className={MUTED}>Source</span>
            <select className={SELECT} value={selected.source || ''} onChange={(e) => set('source', e.target.value)} data-testid="evidence-filter-source">
              <option value="">All</option>
              {choices.source.map((s) => <option key={s} value={s}>{sourceWord(s)}</option>)}
            </select>
          </label>
          {choices.claim.length > 0 && (
            <div role="group" aria-label="Claim state" className="flex flex-wrap gap-1.5">
              {choices.claim.map((state) => {
                const on = selected.claim === state;
                return (
                  <button key={state} type="button" aria-pressed={on}
                    className={`${BTN} gap-1 ${on ? 'border-axal-violet text-axal-violet dark:border-violet-400 dark:text-violet-300' : ''}`}
                    onClick={() => set('claim', on ? '' : state)} data-testid={`evidence-filter-claim-${state}`}>
                    <span aria-hidden="true">{dealClaim(state).glyph}</span>{dealClaim(state).word}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
          <span className={MUTED}>Sort</span>
          <select className={SELECT} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="evidence-sort">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

function ItemTable({ rows, onOpen }) {
  return (
    <table className="hidden w-full border-collapse lg:table">
      <thead><tr className="border-b border-axal-hairline dark:border-gray-800">
        <th className={TH}>Kind</th><th className={TH}>Source</th><th className={TH}>Strength</th><th className={TH}>Observed</th>
        <th className={TH}>Summary</th><th className={TH}>Figure</th><th className={TH}>Shared</th><th className={TH}><span className="sr-only">Open</span></th>
      </tr></thead>
      <tbody>
        {rows.map((i) => (
          <tr key={i.uid} className="border-b border-gray-100 dark:border-gray-800" data-testid={`evidence-row-${i.uid}`}>
            <td className={TD}>
              <button type="button" className="text-left font-semibold text-axal-violet hover:underline dark:text-violet-300" onClick={() => onOpen(i.uid)} data-testid={`evidence-open-${i.uid}`}>{kindWord(i.kind)}</button>
              {i.claims.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{i.claims.map((c) => <ClaimChip key={c.uid} state={c.state} />)}</span>}
            </td>
            <td className={TD}>{sourceWord(i.source_label)}{i.provider && <span className={`block text-[12px] ${MUTED}`}>{providerWord(i.provider)}</span>}</td>
            <td className={TD}><Strength value={i.strength} /></td>
            <td className={TD}><Observed item={i} /></td>
            <td className={`${TD} ${MUTED}`}>{i.summary || 'No summary recorded'}</td>
            <td className={TD}><Figure item={i} testId={`evidence-value-${i.uid}`} /></td>
            <td className={TD}><Shared sharing={i.sharing} /></td>
            <td className={TD}><button type="button" aria-label={`Open ${kindWord(i.kind)}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => onOpen(i.uid)}>›</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ItemCards({ rows, onOpen }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:hidden">
      {rows.map((i) => (
        <li key={i.uid} data-testid={`evidence-card-${i.uid}`}>
          <button type="button" className="flex min-h-[44px] w-full flex-col gap-1.5 rounded-lg border border-axal-hairline bg-white px-3 py-2.5 text-left hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800" onClick={() => onOpen(i.uid)} data-testid={`evidence-card-open-${i.uid}`}>
            <span className="flex w-full items-center justify-between gap-2"><b className="text-[13px]">{kindWord(i.kind)}</b><Shared sharing={i.sharing} /></span>
            <Figure item={i} />
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1"><Strength value={i.strength} /><span className={`text-[12px] ${MUTED}`}>{sourceCell(i)} · {recordDay(i.observed_on) || 'date not recorded'}</span>{i.stale && <StateChip kind="stale" label="Stale" />}</span>
            {i.claims.length > 0 && <span className="flex flex-wrap gap-1">{i.claims.map((c) => <ClaimChip key={c.uid} state={c.state} />)}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Area({ area, rows, open, onToggle, onOpen }) {
  const [more, setMore] = useState(false);
  const shown = more ? rows : rows.slice(0, AREA_PAGE);
  return (
    <section className={CARD} aria-label={area} data-testid="evidence-area" data-area={area}>
      <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left" aria-expanded={open} onClick={onToggle} data-testid={`evidence-area-toggle-${area}`}>
        <h3 className="m-0 text-[14px] font-bold">{area} <span className={`text-[12px] font-normal ${MUTED}`}>{rows.length} {rows.length === 1 ? 'item' : 'items'}</span></h3>
        <span aria-hidden="true" className={MUTED}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <ItemTable rows={shown} onOpen={onOpen} />
          <ItemCards rows={shown} onOpen={onOpen} />
          {rows.length > shown.length && (
            <button type="button" className={BTN} onClick={() => setMore(true)} data-testid={`evidence-area-more-${area}`}>Show {rows.length - shown.length} more in this area</button>
          )}
        </>
      )}
    </section>
  );
}

function Empty({ actions }) {
  return (
    <section className={CARD} data-testid="evidence-items-empty">
      <StateChip kind="not_applicable" label="∅ No shared evidence" />
      <p className="m-0 text-[13px] font-bold">The founder has not shared any evidence yet.</p>
      <p className={`m-0 text-[12px] ${MUTED}`}>Nothing you do here fills it.{actions?.diligenceHref ? ' You can ask the founder from Diligence.' : ''}</p>
      {actions?.diligenceHref && <Link to={actions.diligenceHref} className={BTN} data-testid="evidence-empty-request">Send a request to the founder</Link>}
    </section>
  );
}

function AfterNda({ v, onRetry, actions }) {
  const [selected, setSelected] = useState({});
  const [sort, setSort] = useState('checked');
  const [toggled, setToggled] = useState({});
  const [open, setOpen] = useState(null);
  const claims = sharedClaims(v.items, v.claims);
  const rows = v.items.ok ? v.items.rows : [];
  const choices = evidenceChoices(rows);
  const picked = Object.fromEntries(Object.entries(selected).filter(([name, value]) => value && choices[name].includes(value)));
  const groups = areaGroups(sortItems(rows.filter((i) => evidenceMatches(i, picked)), sort));
  return (
    <>
      {v.partial && <Partial shown={v.items.ok ? rows.length : null} onRetry={onRetry} />}
      {v.items.ok && (
        <section className={CARD} data-testid="evidence-after-nda">
          {claims ? <ClaimsCard rows={claims} />
            : <Failed what="The claims these items back" claim="That is not the same as no claims." onRetry={onRetry} testId="evidence-claims-unreadable" />}
          {rows.length > 0 && <Filters choices={choices} selected={picked} setSelected={setSelected} sort={sort} setSort={setSort} />}
        </section>
      )}
      {!v.items.ok ? <Failed what="The shared items" claim="That is not the same as none being shared." onRetry={onRetry} testId="evidence-items-unreadable" />
        : rows.length === 0 ? <Empty actions={actions} />
          : groups.length === 0 ? (
            <section className={CARD} data-testid="evidence-no-match">
              <p className="m-0 text-[13px]">No shared evidence matches these filters.</p>
              <button type="button" className={BTN} onClick={() => setSelected({})} data-testid="evidence-clear-filters">Clear filters</button>
            </section>
          ) : groups.map(([area, items], index) => (
            <Area key={area} area={area} rows={items} open={toggled[area] ?? index === 0}
              onToggle={() => setToggled((t) => ({ ...t, [area]: !(t[area] ?? index === 0) }))} onOpen={setOpen} />
          ))}
      {v.items.ok && rows.length > 0 && <p className={`m-0 text-[12px] ${MUTED}`}>Figures appear only for items shared after the NDA. Each item opens with its full facts and the claims it backs.</p>}
      <OpenItem uid={open} rows={rows} groups={groups} actions={actions} onClose={() => setOpen(null)} />
    </>
  );
}

// ---------------------------------------------------------------- DE21 · one item

function OpenItem({ uid, rows, groups, actions, onClose }) {
  const item = uid && rows.find((r) => r.uid === uid);
  if (!item) return null;
  const at = positionIn(groups, uid);
  const title = kindWord(item.kind);
  return (
    <Sheet width={520} label={title} title={title} eyebrow={at ? `${at.area} · item ${at.index} of ${at.of}` : item.area} onClose={onClose} testId="evidence-item" phone="full">
      <div className="flex flex-col gap-4 px-5 py-4 text-[13px]">
        <div className="flex flex-wrap items-baseline gap-2">
          {item.figure != null
            ? <b className={`${MONO} text-[22px]`} data-testid="evidence-item-figure">{item.figure}</b>
            : <span className={MUTED} data-testid="evidence-item-reason">{item.value_reason || 'No figure is recorded for this item.'}</span>}
        </div>
        <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5" data-testid="evidence-item-facts">
          {itemFacts(item).map(([label, value, why]) => (
            <React.Fragment key={label}>
              <dt className={MUTED}>{label}</dt>
              <dd className="m-0">{value ?? <DataState state="not_recorded" reason={why} />}</dd>
            </React.Fragment>
          ))}
          <dt className={MUTED}>File</dt>
          <dd className="m-0" data-testid="evidence-item-file"><DataState state="not_recorded" reason="No link from an item to its data-room file is recorded" /></dd>
        </dl>
        <div className="flex flex-col gap-1.5">
          <span className={EYE}>Claims it backs</span>
          {item.claims.length === 0
            ? <p className={`m-0 ${MUTED}`} data-testid="evidence-item-no-claims">This item backs no shared claim.</p>
            : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="evidence-item-claims">
                {sharedClaims({ ok: true, rows: [item] }, { ok: true }).map((c) => (
                  <li key={c.uid} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800">
                    <span className="flex flex-col"><b>{c.title}</b><span className={`text-[12px] ${MUTED}`}>{[c.where, c.checked ? `checked ${c.checked}` : 'Not checked yet'].filter(Boolean).join(' · ')}</span></span>
                    <ClaimChip state={c.state} />
                  </li>
                ))}
              </ul>
            )}
        </div>
        {actions && (
          <div className="flex flex-col gap-1.5">
            <span className={EYE}>Next from this item</span>
            <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 rounded-lg border border-axal-hairline p-0 dark:divide-gray-800 dark:border-gray-800">
              {[
                ['dataroom', 'Open the data room', 'The Data room tab. It cannot yet open this item’s own file.', 'Data room', actions.dataRoomHref],
                ['diligence', 'Send a request to the founder', 'Opens Diligence on this deal.', 'Diligence', actions.diligenceHref],
                ['notes', 'Add a firm note', `Prefilled with “${noteDraft(item).trim()}”. Only your firm sees it.`, 'Add a note', actions.notesHref],
                ['scorecard', 'Go to the scorecard', 'The Scorecard tab, where each scope shows its evidence.', 'Scorecard', actions.scorecardHref],
              ].filter((x) => x[4]).map(([key, head, line, label, href]) => (
                <li key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex flex-col"><b>{head}</b><small className={MUTED}>{line}</small></span>
                  <Link to={href} state={key === 'notes' ? { evidenceNote: noteDraft(item) } : undefined} className={BTN} data-testid={`evidence-item-${key}`}>{label}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- the tab

/** DE22 E: the tab's shape while the read is in flight; the header and other tabs already work. */
export function DealEvidenceLoading() {
  const bar = 'block rounded-[5px] bg-gray-200 dark:bg-gray-700';
  return (
    <section className={CARD} aria-busy="true" data-testid="evidence-loading">
      <span className={`${bar} h-3.5 w-[55%]`} />
      <span className={`${bar} h-[34px] w-full`} />
      <span className={`${bar} h-3 w-full`} />
      <span className={`${bar} h-3 w-[92%]`} />
      <span className={`${bar} h-3 w-[80%]`} />
      <span className={`text-[12px] ${MUTED}`}>Reading the shared evidence…</span>
    </section>
  );
}

/** DE22 B: the whole read failed. */
export function DealEvidenceUnreadable({ onRetry }) {
  return (
    <section className={CARD} data-testid="evidence-summary" data-stage="unreadable">
      <Failed what="The shared evidence" claim="That is not the same as none being shared." onRetry={onRetry} testId="evidence-unreadable" />
    </section>
  );
}

/**
 * The deal's Evidence tab from one read. `actions` (an investor's own) holds
 * the item sheet's hand-offs; staff get none. `ndaHref` draws Sign the NDA.
 */
export function DealEvidence({ read, onRetry = null, ndaHref = null, actions = null }) {
  const v = investorView(read);
  if (v.stage === 'none') return null;
  if (v.stage === 'unreadable') return <DealEvidenceUnreadable onRetry={onRetry} />;
  return (
    <div className="flex flex-col gap-4" data-testid="evidence-summary" data-stage={v.stage}>
      {v.stage === 'before' ? <BeforeNda v={v} ndaHref={ndaHref} onRetry={onRetry} /> : <AfterNda v={v} onRetry={onRetry} actions={actions} />}
    </div>
  );
}
