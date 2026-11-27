// D7180 (#7180, D7046) — the company profile's sourced metric cards, sector
// peers and evidence collections, built to boards RS-18 A to RS-18 F of
// `design/incoming/Research Companies Profiles Peers and Evidence Page.dc.html`.
//
// A metric card shows its value, publisher, Observed and Updated; an unknown
// observation date reads Not recorded and never borrows the update date.
// Inspect opens the record drawer (the shared `Sheet`, a bottom sheet on a
// phone) with every field the record carries. Each evidence collection is a
// disclosure with its own state (Read, None, Unavailable) and its own Retry.
// Sector peers share a sector label; they are not competitors, and the rule
// that matched them is printed.
import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, DataState, Sheet, StateChip } from '../../ui';
import { companyHref, employees, lastRound, sectorLabelHref } from '../../lib/companyDirectoryView.js';
import {
  EVIDENCE_COLLECTIONS, METRICS, NOT_RECORDED, cellText, collectionState, confidenceText, countLabel,
  evidenceButtonLabel, metricEvidence, metricValue, observedText, peerRuleText, provenanceText, publisherOf,
  publisherUrlOf, recordFields, recordTitle,
} from './companyProfileRead.js';

const h2 = 'text-sm font-extrabold tracking-tight text-axal-ink dark:text-gray-100';
const lede = 'mt-1 text-[12px] leading-relaxed text-axal-muted';
const faint = 'text-[11px] text-axal-faint';
const btnSm = 'inline-flex min-h-[36px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-2.5 text-[12px] font-semibold text-axal-ink hover:border-violet-300 '
  + 'focus-visible:outline-2 focus-visible:outline-violet-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const nr = <span className="text-axal-faint">{NOT_RECORDED}</span>;
const ext = <><span aria-hidden="true"> ↗</span><span className="sr-only">(opens in a new tab)</span></>;

/** ▣ a directory company, outlined; ◎ an analysis candidate, violet. Never confused (RS-18). */
export function KindBadge({ kind }) {
  if (kind === 'candidate') {
    return <span data-kind="candidate" className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800 dark:bg-violet-950/50 dark:text-violet-200"><i aria-hidden="true" className="not-italic">◎</i>Analysis candidate</span>;
  }
  return <span data-kind="directory" className="inline-flex items-center gap-1 rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-300"><i aria-hidden="true" className="not-italic">▣</i>Directory company</span>;
}

/** Unknown optional fields in one Not recorded line, opened for the reasons. */
export function NotRecordedGroup({ fields, noun = 'fields', defaultOpen = false, testId }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!fields.length) return null;
  return (
    <div data-testid={testId} className="rounded-xl border border-dashed border-axal-hairline px-3 py-2 dark:border-gray-700">
      <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)} className="flex min-h-[36px] w-full flex-wrap items-center gap-2 text-left">
        <StateChip kind="not_recorded" label={`Not recorded · ${countLabel(fields.length, noun.replace(/s$/, ''), noun)}`} />
        <span className="text-[12px] text-axal-muted">{fields.map((f) => f[0]).join(' · ')}</span>
        <i aria-hidden="true" className="ml-auto not-italic text-axal-faint">{open ? '▴' : '▾'}</i>
      </button>
      {open ? (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
          {fields.map(([name, why]) => <React.Fragment key={name}><dt className="text-axal-muted">{name}</dt><dd className="text-axal-faint">{NOT_RECORDED} · {why}</dd></React.Fragment>)}
        </dl>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- metrics */

/** One metric card: value, unit, publisher, Observed and Updated, and Inspect. */
export function MetricCard({ spec, m, detail, ev, onInspect }) {
  const observed = observedText(m);
  const url = publisherUrlOf(m);
  const pub = publisherOf(m);
  const opener = useRef(null);
  return (
    <Card data-testid={`metric-${spec.title}`} className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-axal-muted">
        <span>{spec.title}</span>
        {observed ? null : <StateChip kind="partial" label="Date partial" />}
      </div>
      <div className="text-lg font-extrabold text-axal-ink dark:text-gray-100">{metricValue(spec.key, m)}</div>
      {detail ? <p className="text-[12px] text-axal-muted">{detail}</p> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
        <dt className="text-axal-muted">Publisher</dt>
        <dd className="min-w-0 break-words text-axal-ink dark:text-gray-100">{pub ? (url ? <a href={url} target="_blank" rel="noreferrer" className="text-axal-violet underline dark:text-violet-300">{pub}{ext}</a> : pub) : nr}</dd>
        <dt className="text-axal-muted">Observed</dt>
        <dd className="font-mono text-axal-ink dark:text-gray-100">{observed || nr}</dd>
        <dt className="text-axal-muted">Updated</dt>
        <dd className="font-mono text-axal-ink dark:text-gray-100">{m.updated_on || nr}</dd>
      </dl>
      <button ref={opener} type="button" aria-haspopup="dialog" className={`${btnSm} mt-auto`} onClick={() => onInspect(spec.key, opener)}>{evidenceButtonLabel(spec, ev)}</button>
    </Card>
  );
}

const detailOf = (key, m) => {
  if (key === 'funding_total') return m.currency ? 'All rounds the publisher lists' : null;
  if (key === 'last_funding') return [m.type, m.date ? `announced ${m.date}` : null].filter(Boolean).join(' · ') || null;
  if (key === 'headcount') return m.growth_pct != null ? `Growth ${m.growth_pct > 0 ? '+' : ''}${m.growth_pct}% · its period is not recorded` : null;
  return null;
};

/** Key metrics: recorded figures as cards, the rest grouped into one Not recorded line. */
export function KeyMetrics({ d, onInspect }) {
  const metrics = d?.metrics || {};
  const recorded = METRICS.filter((s) => metrics[s.key]?.status === 'recorded');
  const missing = METRICS.filter((s) => metrics[s.key]?.status !== 'recorded');
  // A headcount with no growth figure: growth is Not recorded, never 0%.
  if (metrics.headcount?.status === 'recorded' && metrics.headcount.growth_pct == null) missing.push({ title: 'Employee growth', none: 'no source lists headcount growth' });
  if (metrics.headcount?.status !== 'recorded') missing.push({ title: 'Employee growth', none: 'no source lists headcount growth' });
  return (
    <section id="metrics" className="scroll-mt-4 space-y-3" tabIndex={-1}>
      <div><h2 className={h2}>Key metrics</h2><p className={lede}>Each figure shows its publisher, when it was observed and when the record was last updated. A missing observation date is not the update date.</p></div>
      {recorded.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {recorded.map((spec) => (
            <MetricCard key={spec.key} spec={spec} m={metrics[spec.key]} detail={detailOf(spec.key, metrics[spec.key])} ev={metricEvidence(spec, d)} onInspect={onInspect} />
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-axal-muted">No source lists funding, last round, valuation, revenue, employees, employee growth or market share for this company. Nothing here is estimated.</p>
      )}
      <NotRecordedGroup testId="metrics-not-recorded" noun="metrics" fields={missing.map((s) => [s.title, s.none])} />
    </section>
  );
}

/** The record drawer's body for one metric: value, publisher, Observed apart from Updated, confidence, supporting records. */
export function MetricEvidenceBody({ spec, m, ev }) {
  const observed = observedText(m);
  const pub = publisherOf(m);
  const url = publisherUrlOf(m);
  const prov = provenanceText(m);
  const conf = confidenceText(m);
  return (
    <div className="space-y-4 text-[12.5px]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-axal-muted">Value</dt><dd className="font-mono text-axal-ink dark:text-gray-100">{m.value != null ? String(m.value) : nr}</dd>
        <dt className="text-axal-muted">Unit / currency</dt><dd className="text-axal-ink dark:text-gray-100">{m.currency || (spec.key === 'headcount' ? 'people' : spec.key === 'market_share_pct' ? 'percent' : NOT_RECORDED)}</dd>
        <dt className="text-axal-muted">Publisher</dt>
        <dd className="min-w-0 break-words text-axal-ink dark:text-gray-100">{pub ? (url ? <a href={url} target="_blank" rel="noreferrer" className="text-axal-violet underline dark:text-violet-300">{pub}{ext}</a> : pub) : nr}{prov ? <div className={faint}>{prov}</div> : null}</dd>
        <dt className="text-axal-muted">Observed</dt>
        <dd className="text-axal-ink dark:text-gray-100"><span className="font-mono">{observed || NOT_RECORDED}</span>{observed ? null : <div className={faint}>The publisher gives no observation date for this figure.</div>}</dd>
        <dt className="text-axal-muted">Updated</dt>
        <dd className="text-axal-ink dark:text-gray-100"><span className="font-mono">{m.updated_on || NOT_RECORDED}</span><div className={faint}>When the directory record was last updated. Not the date the figure was true.</div></dd>
        <dt className="text-axal-muted">Confidence</dt><dd className="text-axal-ink dark:text-gray-100">{conf || NOT_RECORDED}</dd>
      </dl>
      {ev.collection ? (
        <div>
          <h3 className="text-[12px] font-extrabold text-axal-ink dark:text-gray-100">Supporting records · {ev.collection.title}</h3>
          {ev.collectionState === 'unreadable' ? <DataState state="unavailable" size="block" what={ev.collection.title} claim="This is not zero." />
            : ev.rows.length ? (
              <ul className="mt-1 divide-y divide-axal-hairline dark:divide-gray-800">
                {ev.rows.map((r, i) => <li key={i} className="py-1.5 text-axal-muted">{ev.collection.columns.map((c) => `${c[1]}: ${cellText(r, c)}`).join(' · ')}</li>)}
              </ul>
            ) : <p className="mt-1 text-axal-muted">None · the collection holds no record for this company.</p>}
        </div>
      ) : null}
      <div>
        <h3 className="text-[12px] font-extrabold text-axal-ink dark:text-gray-100">Field citations</h3>
        {ev.citationsState === 'unreadable' ? <DataState state="unavailable" size="block" what="Field citations" claim="This is not zero." />
          : ev.citations.length ? (
            <ul className="mt-1 divide-y divide-axal-hairline dark:divide-gray-800">
              {ev.citations.map((c, i) => <li key={i} className="py-1.5 text-axal-muted">{[c.field_name, c.source_name, c.source_type, c.publication_date ? `published ${c.publication_date}` : 'published: Not recorded', c.retrieved_at ? `retrieved ${c.retrieved_at}` : null].filter(Boolean).join(' · ')}</li>)}
            </ul>
          ) : <p className="mt-1 text-axal-muted">None · no citation names this field.</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- peers */

/** One sector peer as a card with no minimum width. */
export function PeerCard({ p }) {
  const round = lastRound(p);
  const staff = employees(p);
  return (
    <article className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Link to={companyHref(p.uid)} className="flex min-h-[44px] items-center font-semibold text-axal-violet underline dark:text-violet-300 sm:min-h-0">{p.name}</Link>
      <span className="truncate text-[11px] text-axal-faint">{p.website || 'Website: not recorded'}</span>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-axal-muted">
        <span>{p.country || 'Country not recorded'}</span>
        {p.same_country ? <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">Same country</span> : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
        <dt className="text-axal-muted">Founded</dt><dd className="font-mono text-axal-ink dark:text-gray-100">{p.founded_year ?? nr}</dd>
        <dt className="text-axal-muted">Last round</dt><dd className="min-w-0 text-axal-ink dark:text-gray-100">{round ? <>{round.amount}{round.detail ? <span className={`ml-1 ${faint}`}>{round.detail}</span> : null}</> : nr}</dd>
        <dt className="text-axal-muted">Employees</dt><dd className="font-mono text-axal-ink dark:text-gray-100">{staff ? staff.count : nr}</dd>
      </dl>
    </article>
  );
}

/** Same-label directory companies, with the rule the Worker ran. They are not competitors. */
export function SectorPeers({ item, peers }) {
  const head = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div><h2 className={h2}>Sector peers{peers?.status === 'ok' ? <span className="ml-2 rounded-full bg-axal-ground px-1.5 py-0.5 text-[11px] font-bold text-axal-muted dark:bg-gray-800">{peers.total}</span> : null}</h2><p className={lede}>Other directory companies with the same sector label.</p></div>
      {peers?.status === 'ok' && peers.total > peers.rows.length ? <Link to={sectorLabelHref(item.sector)} className="text-[12px] font-semibold text-axal-violet underline">See all {peers.total} with this label in Companies →</Link> : null}
    </div>
  );
  const note = (
    <p className="rounded-xl bg-axal-ground px-3 py-2 text-[12px] text-axal-muted dark:bg-gray-950"><strong className="text-axal-ink dark:text-gray-100">Sector peers are not competitors.</strong> They share a sector label. Direct competitor and Adjacent competitor appear only inside an analysis that names its subject, with a rationale and supporting sources.</p>
  );
  if (!peers || peers.status === 'unreadable') return <section id="peers" className="scroll-mt-4 space-y-3" tabIndex={-1}>{head}<DataState state="unavailable" size="block" what="The sector peers read" claim="This is not zero." /></section>;
  if (peers.status === 'not_recorded') return <section id="peers" className="scroll-mt-4 space-y-3" tabIndex={-1}>{head}<p className="text-[12px] text-axal-muted"><StateChip kind="not_recorded" /> This company has no sector label, so it has no sector peers to match.</p></section>;
  return (
    <section id="peers" className="scroll-mt-4 space-y-3" tabIndex={-1}>
      {head}
      <div data-testid="peer-rule" className="flex flex-wrap gap-x-2 rounded-xl border border-axal-hairline px-3 py-2 text-[12px] dark:border-gray-800">
        <b className="text-axal-ink dark:text-gray-100">Matching rule</b>
        <span className="text-axal-muted">{peerRuleText(peers.rule, item, peers.rows.length, peers.total)}</span>
      </div>
      {peers.rows.length
        ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{peers.rows.map((p) => <PeerCard key={p.uid} p={p} />)}</div>
        : <p className="text-[12px] text-axal-muted">None · no other directory company has this sector label.</p>}
      {note}
    </section>
  );
}

/* ---------------------------------------------------------------- evidence */

function Publisher({ row, col }) {
  const text = cellText(row, col);
  const url = row?.[col[3]];
  if (text === NOT_RECORDED) return nr;
  return url ? <a href={url} target="_blank" rel="noreferrer" className="text-axal-violet underline dark:text-violet-300">{text}{ext}</a> : text;
}

function Cell({ row, col }) {
  if (col[2] === 'link') return <Publisher row={row} col={col} />;
  const text = cellText(row, col);
  return text === NOT_RECORDED ? nr : <span className={col[2] === 'money' || col[2] === 'count' ? 'font-mono' : ''}>{text}</span>;
}

/** One collection as a disclosure: its state, its records as a table (cards under 640px) and Retry when it failed. */
export function EvidenceCollection({ collection, data, name, open, onToggle, onInspect, onRetry, retrying = false }) {
  const state = retrying ? 'loading' : collectionState(data);
  const rows = data?.rows || [];
  const chip = state === 'ok' ? <StateChip kind="not_applicable" label="Read" />
    : state === 'none' ? <StateChip kind="not_applicable" label="None" />
    : state === 'loading' ? <StateChip kind="not_applicable" label="Loading" />
    : <StateChip kind="unavailable" label="Unavailable · read failed" />;
  const panelId = `evidence-${collection.key}`;
  return (
    <div data-testid={`evidence-${collection.key}`} data-state={state} className="rounded-xl border border-axal-hairline dark:border-gray-800">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle} className="flex min-h-[44px] w-full flex-wrap items-center gap-2 px-3 py-2 text-left">
        <b className="text-[13px] text-axal-ink dark:text-gray-100">{collection.title}</b>
        {chip}
        <span className="ml-auto text-[12px] text-axal-muted">{state === 'ok' || state === 'none' ? countLabel(rows.length) : ''}</span>
        <i aria-hidden="true" className="not-italic text-axal-faint">{open ? '▴' : '▾'}</i>
      </button>
      {open ? (
        <div id={panelId} className="border-t border-axal-hairline px-3 py-3 dark:border-gray-800">
          {state === 'loading' ? <DataState state="loading" size="block" />
            : state === 'unreadable' ? <DataState state="unavailable" size="block" what={`The ${collection.title.toLowerCase()}`} claim="This is not zero. The other collections and sections are unaffected." onRetry={onRetry} retryLabel={`Retry ${collection.title.toLowerCase()}`} />
            : state === 'none' ? <p className="text-[12px] text-axal-muted">None · the read succeeded and holds no {collection.one} for this company.</p>
            : (
              <>
                <div className="hidden sm:block">
                  <table className="w-full table-auto text-left text-[12px]">
                    <caption className="sr-only">{collection.title} for {name}</caption>
                    <thead className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
                      <tr>{collection.columns.map((c) => <th key={c[0]} scope="col" className={`px-2 py-1.5 ${c[2] === 'money' || c[2] === 'count' ? 'text-right' : ''}`}>{c[1]}</th>)}<th scope="col" className="px-2 py-1.5"><span className="sr-only">Record</span></th></tr>
                    </thead>
                    <tbody className="divide-y divide-axal-hairline dark:divide-gray-800">
                      {rows.map((r, i) => (
                        <tr key={i}>
                          {collection.columns.map((c, j) => j === 0
                            ? <th key={c[0]} scope="row" className="px-2 py-2 font-semibold text-axal-ink dark:text-gray-100"><Cell row={r} col={c} /></th>
                            : <td key={c[0]} className={`px-2 py-2 text-axal-muted ${c[2] === 'money' || c[2] === 'count' ? 'text-right' : ''}`}><Cell row={r} col={c} /></td>)}
                          <td className="px-2 py-2 text-right"><InspectRecord collection={collection} row={r} onInspect={onInspect} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="space-y-2 sm:hidden">
                  {rows.map((r, i) => (
                    <li key={i} className="rounded-lg border border-axal-hairline p-2.5 dark:border-gray-800">
                      <div className="font-semibold text-axal-ink dark:text-gray-100"><Cell row={r} col={collection.columns[0]} /></div>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                        {collection.columns.slice(1).map((c) => <React.Fragment key={c[0]}><dt className="text-axal-muted">{c[1]}</dt><dd className="min-w-0 break-words text-axal-ink dark:text-gray-100"><Cell row={r} col={c} /></dd></React.Fragment>)}
                      </dl>
                      <div className="mt-2"><InspectRecord collection={collection} row={r} onInspect={onInspect} full /></div>
                    </li>
                  ))}
                </ul>
              </>
            )}
        </div>
      ) : null}
    </div>
  );
}

function InspectRecord({ collection, row, onInspect, full = false }) {
  const opener = useRef(null);
  const label = `Inspect ${recordTitle(collection, row)}`;
  return <button ref={opener} type="button" aria-haspopup="dialog" aria-label={label} className={`${btnSm} ${full ? 'min-h-[44px] w-full' : ''}`} onClick={() => onInspect({ collection, row }, opener)}>Inspect</button>;
}

/** The four collections, each opened, read and retried on its own. */
export function EvidenceSection({ d, name, onInspect, onRetry, retrying = {} }) {
  const [open, setOpen] = useState(() => Object.fromEntries(EVIDENCE_COLLECTIONS.map((c) => [c.key, true])));
  const total = EVIDENCE_COLLECTIONS.reduce((n, c) => n + (collectionState(d?.[c.key]) === 'unreadable' ? 0 : (d?.[c.key]?.rows || []).length), 0);
  const failed = EVIDENCE_COLLECTIONS.filter((c) => collectionState(d?.[c.key]) === 'unreadable').length;
  return (
    <section id="evidence" className="scroll-mt-4 space-y-3" tabIndex={-1}>
      <div>
        <h2 className={h2}>Evidence <span className="ml-1 text-[11px] font-bold text-axal-muted">{countLabel(total)}{failed ? ` · ${failed} ${failed === 1 ? 'collection' : 'collections'} unavailable` : ''}</span></h2>
        <p className={lede}>Four collections, each read on its own. Open a record to see every field it carries; a blank field reads Not recorded and a recorded zero reads 0.</p>
      </div>
      {EVIDENCE_COLLECTIONS.map((c) => (
        <EvidenceCollection key={c.key} collection={c} data={d?.[c.key]} name={name} open={!!open[c.key]}
          onToggle={() => setOpen((o) => ({ ...o, [c.key]: !o[c.key] }))} onInspect={onInspect}
          onRetry={() => onRetry(c.key)} retrying={!!retrying[c.key]} />
      ))}
      <p className={faint}>{d?.evidence_key || 'company_id = research_company_directory.id'}</p>
    </section>
  );
}

/** Every field of one evidence record. */
export function RecordBody({ row }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
      {recordFields(row).map((f) => (
        <React.Fragment key={f.key}>
          <dt className="text-axal-muted">{f.label}</dt>
          <dd className="min-w-0 break-words text-axal-ink dark:text-gray-100">{f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="text-axal-violet underline dark:text-violet-300">{f.value}{ext}</a> : f.recorded ? f.value : nr}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** The record drawer on desktop, a bottom sheet on a phone (the shared `Sheet`, D1317). */
export function EvidenceDrawer({ open, d, onClose }) {
  if (!open) return null;
  if (open.metric) {
    const spec = METRICS.find((s) => s.key === open.metric);
    const m = d?.metrics?.[open.metric];
    if (!spec || !m) return null;
    return (
      <Sheet label={`Evidence for ${spec.title}`} eyebrow="Evidence · Key metric" title={spec.title} width={480} phone="sheet" testId="evidence-drawer"
        onClose={onClose} returnFocusTo={open.opener}
        footer={<button type="button" className={btnSm} onClick={onClose}>Close</button>}>
        <MetricEvidenceBody spec={spec} m={m} ev={metricEvidence(spec, d)} />
      </Sheet>
    );
  }
  return (
    <Sheet label={`${open.collection.title} record`} eyebrow={`Evidence · ${open.collection.title}`} title={recordTitle(open.collection, open.row)} width={480} phone="sheet"
      testId="evidence-drawer" onClose={onClose} returnFocusTo={open.opener}
      footer={<button type="button" className={btnSm} onClick={onClose}>Close</button>}>
      <RecordBody row={open.row} />
    </Sheet>
  );
}
