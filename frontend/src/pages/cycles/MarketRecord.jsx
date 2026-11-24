/**
 * D6120 (#6120, Grow v2 Markets GR-22, GR-26, GR-27, GR-28) — one market's record on /grow/market-expansion/:uid:
 * the four part tiles (score, source and an evidence strip from Research › Geographies), the entry plan with an
 * overdue step marked by word and glyph, the three localisation checks (Legal entity hands off to Company), the
 * attached country, size, replies to a market ask and history, and the handoffs that keep the venture.
 *
 * The record read sends the stored values in `parts.market` (`services/records/grow.ts`); the actions are the
 * read's own declarations, run through the route's handlers (`onForm`, `onWrite`), so a reader, whose read
 * carries none, sees no control. Each store fails on its own: Research failing leaves the scores in place.
 * Below 1024px (`useRecordPhone`) the parts and the side column fold into disclosure rows.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { DataState } from '../../ui/Honesty.jsx';
import { researchMarketsApi } from '../../lib/api/researchMarkets.js';
import { RecordHeaderRow } from './RecordHeader.jsx';
import { useRecordPhone } from './RecordView.jsx';
import { declaredActions, dispatchOf, recordHref, rowAction } from './recordModel.js';
import { DecisionPill, Readiness, StatePill } from './MarketsHome.jsx';
import {
  MARKET_DECISIONS, dayLabel, evidenceFor, handoffLinks, legalEntityHref, marketView, planLine, sizeLabel, stepOverdue, todayOf,
} from './marketsModel.js';

const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[14px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const SMALL_BTN = 'inline-flex min-h-[32px] items-center rounded-[8px] border border-axal-hairline px-2.5 text-[12px] font-semibold text-axal-violet-deep hover:bg-axal-lavender max-lg:min-h-[44px] dark:border-gray-700 dark:text-violet-300 dark:hover:bg-violet-900/30';
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300';

/** Run a declared action through the route's handlers; null when the read declared none (a reader). */
function runner(action, h) {
  const kind = dispatchOf(action);
  if (kind === 'form' && h.onForm) return () => h.onForm(action);
  if (kind === 'write' && h.onWrite) return () => h.onWrite(action);
  return null;
}

/** "2026-11-12 16:20:00" → "12 Nov 16:20". */
function stamp(v) {
  const s = String(v ?? '');
  const day = dayLabel(s, true);
  const time = /[T ](\d{2}:\d{2})/.exec(s)?.[1];
  return day ? `${day}${time ? ` ${time}` : ''}` : s;
}

/** A 44px-on-phone check: a step's Mark done / Reopen, or a localisation tick. */
function Check({ on, label, run }) {
  const box = <span aria-hidden="true" className={`inline-grid h-[20px] w-[20px] place-items-center rounded-[6px] border-[1.5px] text-[12px] font-bold ${on
    ? 'border-axal-violet bg-axal-violet text-white dark:border-violet-500 dark:bg-violet-600' : 'border-gray-400 bg-white dark:border-gray-500 dark:bg-gray-900'}`}>{on ? '✓' : ''}</span>;
  if (!run) return <span className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center" role="img" aria-label={label}>{box}</span>;
  return <button type="button" role="checkbox" aria-checked={on} aria-label={label} onClick={run} data-testid="market-check"
    className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-[8px] max-lg:min-h-[44px] max-lg:min-w-[44px]">{box}</button>;
}

/** The evidence strip: Research's lines with their as-of day; lines no store holds read Not recorded. */
function Evidence({ lines, label }) {
  return <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={`Evidence for ${label}`} data-testid="market-evidence">
    {lines.map((e) => <li key={e.label} className="flex flex-wrap items-baseline gap-x-1.5 text-[12px]">
      {e.state === 'value'
        ? <><span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"><span aria-hidden="true">● </span>on record</span>
          <b className="font-semibold text-axal-ink dark:text-gray-100">{e.label}</b>{e.asOf ? <small className={MUTED}>as of {e.asOf}</small> : <small className={MUTED}>as-of not recorded</small>}{e.source && <a href={e.source} target="_blank" rel="noopener noreferrer" className={LINK}>Source</a>}</>
        : e.state === 'unavailable'
          ? <><b className="font-semibold text-axal-ink dark:text-gray-100">{e.label}</b><DataState state="unavailable" what={e.label} claim={e.reason} /></>
          : <><b className="font-semibold text-axal-ink dark:text-gray-100">{e.label}</b><DataState state="not_recorded" reason={e.reason} /></>}
    </li>)}
  </ul>;
}

function PartTile({ part, evidence, geo, onRetryGeo, onScore }) {
  const scored = part.score != null;
  return <div role="group" aria-label={part.part} data-testid="market-part"
    className={`flex min-w-0 flex-col gap-2 rounded-[10px] border p-3 ${scored ? 'border-axal-hairline dark:border-gray-800' : 'border-dashed border-gray-300 dark:border-gray-600'}`}>
    <div className="flex items-baseline justify-between gap-2">
      <b className="text-[13px] text-axal-ink dark:text-gray-100">{part.part}</b>
      {scored ? <span className="font-mono text-[13px] text-axal-ink dark:text-gray-100"><b className="text-[16px]">{part.score}</b> / 10</span>
        : <DataState state="not_recorded" reasonVisible={false} reason={`No ${part.part.toLowerCase()} score`} />}
    </div>
    {scored && part.score === 0 && <span className="inline-flex items-center gap-1 self-start rounded-full border border-axal-ink px-2 py-0.5 text-[11px] font-bold text-axal-ink dark:border-gray-100 dark:text-gray-100" data-testid="market-measured-zero"><span aria-hidden="true" className="font-mono">0</span>Measured 0</span>}
    <p className={`m-0 text-[12px] ${MUTED}`}>{scored ? <>Source: {part.source || 'not recorded'}</>
      : <>No source yet{onScore ? <> · <button type="button" onClick={onScore} className={LINK}>Score {part.part.toLowerCase()}</button></> : null}</>}</p>
    {geo === 'loading' && <DataState state="loading" />}
    {geo === 'unreadable' && <DataState state="unavailable" what="Research" claim="The score and source above are current." onRetry={onRetryGeo} retryLabel="Try again" />}
    {evidence && <Evidence lines={evidence} label={part.part} />}
  </div>;
}

/** A side block: a card on desktop, a disclosure row on a phone (GR-27). */
function Block({ id, title, summary, phone, children, testid }) {
  if (phone) {
    return <details className="group rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" data-testid={testid}>
      <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 px-4 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">
        <span>{title}</span><span className={`truncate text-[12px] font-normal ${MUTED}`}>{summary}</span></summary>
      <div className="border-t border-axal-hairline px-4 py-3 dark:border-gray-800">{children}</div>
    </details>;
  }
  return <section id={id} className={`${CARD} flex flex-col gap-2`} aria-labelledby={`${id}-h`} data-testid={testid}>
    <h2 id={`${id}-h`} className={H2}>{title}</h2>{children}</section>;
}

export default function MarketRecord({ record, activity, onForm, onWrite, onShowAll, now = Date.now() }) {
  const phone = useRecordPhone();
  const { search } = useLocation();
  const m = record?.parts?.market || {};
  const view = marketView({ ...m, name: record?.title, size_cents: m.size?.cents, size_currency: m.size?.currency, size_source: m.size?.source });
  const today = todayOf(now);
  const decl = declaredActions(record);
  const h = { onForm, onWrite };
  const act = (key) => { const a = rowAction(key, decl); return a ? runner(a, h) : null; };
  const edit = act('edit');

  // Research › Geographies, read on its own: its failure says so on the strip, never on the scores.
  const code = m.country?.code || m.geography_ref || null;
  const [geo, setGeo] = useState({ code: null, state: 'idle', data: null });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!code) return undefined;
    let live = true;
    setGeo({ code, state: 'loading', data: null });
    researchMarketsApi.geography(code).then((data) => { if (live) setGeo({ code, state: 'ready', data }); })
      .catch(() => { if (live) setGeo({ code, state: 'unreadable', data: null }); });
    return () => { live = false; };
  }, [code, tries]);
  const ev = geo.code === code && geo.state === 'ready' ? evidenceFor(geo.data, m.partners, m.indices) : null;
  const geoState = !code ? null : geo.code === code ? geo.state : 'loading';

  // The entry plan's rows carry the declared actions; the steps themselves come from `parts.market.steps`.
  const planRows = (record?.main || []).find((s) => s.key === 'entry-plan')?.rows || [];
  const rowOf = (uid) => planRows.find((r) => r?.action?.body?.step === uid) || null;
  const locRows = (record?.main || []).find((s) => s.key === 'localisation')?.rows || [];
  const steps = Array.isArray(m.steps) ? m.steps : null;
  const addStep = act('add-entry-step');
  const decision = MARKET_DECISIONS[m.decision];

  const pills = <div className="flex flex-wrap items-center gap-2" data-testid="market-record-pills">
    <StatePill state={view.state} /><DecisionPill decision={view.decision} on={view.decidedOn} />
    <span className="inline-flex items-center gap-1.5 text-[12px] text-axal-ink dark:text-gray-100">Readiness <Readiness view={view} big /><small className={MUTED}>out of 40, current</small></span>
  </div>;

  const partsSection = <section className="flex flex-col gap-2" aria-labelledby="market-parts-h" data-testid="market-parts">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="market-parts-h" className={H2}>Four parts</h2>
      <span className={`text-[12px] ${MUTED}`}>Each 0–10 with its source{m.country ? ` · evidence from Research › Geographies for ${m.country.name}` : ''}</span></div>
    {!code && <DataState state="not_recorded" reason="No Research › Geographies country attached, so no evidence is drawn." />}
    {phone ? view.parts.map((p) => <details key={p.key} className="rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" data-testid="market-part-row">
      <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 px-4 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">
        <span>{p.part}</span>{p.score != null ? <span className="font-mono font-normal">{p.score} / 10</span> : <DataState state="not_recorded" reasonVisible={false} />}</summary>
      <div className="px-3 pb-3"><PartTile part={p} evidence={ev?.[p.key]} geo={geoState === 'ready' ? null : geoState} onRetryGeo={() => setTries((n) => n + 1)} onScore={edit} /></div>
    </details>) : <div className="grid grid-cols-1 gap-2.5 @[760px]/cycle:grid-cols-2">
      {view.parts.map((p) => <PartTile key={p.key} part={p} evidence={ev?.[p.key]} geo={geoState === 'ready' ? null : geoState} onRetryGeo={() => setTries((n) => n + 1)} onScore={edit} />)}
    </div>}
  </section>;

  const planSection = <section id="entry-plan" className={`${CARD} flex flex-col gap-2`} aria-labelledby="market-plan-h" data-testid="market-plan">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="market-plan-h" className={H2}>Entry plan</h2>
      {steps && <span className={`text-[12px] ${MUTED}`}>{planLine(steps, m.steps_total, today)}</span>}</div>
    {!steps ? <DataState state="unavailable" what="The entry plan" claim="This is not a claim that it has no steps." />
      : steps.length === 0 ? <DataState state="none">No entry step recorded.</DataState>
      : <ol className="m-0 flex list-none flex-col p-0">{steps.map((s) => {
        const row = rowOf(s.uid);
        const over = stepOverdue(s, today);
        const toggle = row?.action ? runner(rowAction(row.action, decl), h) : null;
        const more = (row?.actions || []).map((ref) => ({ ref, action: rowAction(ref, decl) })).filter((x) => x.action);
        return <li key={s.uid} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-axal-ground py-2 first:border-t-0 dark:border-gray-800" data-testid="market-step" data-overdue={over != null ? 'true' : undefined}>
          <Check on={!!s.done_at} label={`${s.done_at ? 'Done' : 'Mark done'}: ${s.text}`} run={toggle} />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className={`text-[13px] ${s.done_at ? 'text-axal-muted line-through dark:text-gray-400' : 'text-axal-ink dark:text-gray-100'}`}>{s.text}</b>
            <small className={`text-[11.5px] ${MUTED}`}>
              {s.owner_name || <span><span aria-hidden="true">○ </span>Owner not recorded</span>}{' · '}
              {s.due_on ? <>due <span className="font-mono">{dayLabel(s.due_on, true) || s.due_on}</span></> : <span><span aria-hidden="true">○ </span>Due date not recorded</span>}
              {s.done_at ? ` · Done ${dayLabel(s.done_at, true) || ''}` : ''}
            </small>
          </span>
          {s.done_at ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:border-emerald-900 dark:text-emerald-300"><span aria-hidden="true">✓</span>Done</span>
            : over != null ? <span className="inline-flex items-center gap-1 rounded-full border-2 border-amber-500 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:border-amber-500 dark:text-amber-300" data-testid="market-step-overdue"><span aria-hidden="true">▲</span>Overdue · {over} {over === 1 ? 'day' : 'days'}</span>
            : <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400"><span aria-hidden="true">○</span>Open</span>}
          {more.length > 0 && <span className="flex gap-1.5">{more.map(({ action }) => {
            const run = runner(action, h);
            return run ? <button key={action.key} type="button" onClick={run} className={action.tone === 'danger' ? `${SMALL_BTN} text-red-700 dark:text-red-300` : SMALL_BTN}
              aria-label={`${action.label}: ${s.text}`}>{action.label}</button> : null;
          })}</span>}
        </li>;
      })}</ol>}
    {addStep && <button type="button" onClick={addStep} className={`${SMALL_BTN} self-start`} data-testid="market-add-step">Add entry step</button>}
  </section>;

  const loc = Array.isArray(m.localisation) ? m.localisation : null;
  const locDone = loc ? loc.filter((l) => l.done_at).length : null;
  const locSection = <section id="localisation" className={`${CARD} flex flex-col gap-2`} aria-labelledby="market-loc-h" data-testid="market-localisation">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="market-loc-h" className={H2}>Localisation</h2>
      {loc && <span className={`text-[12px] ${MUTED}`}>{locDone} of {loc.length} done</span>}</div>
    {!loc ? <DataState state="unavailable" what="The localisation checks" claim="This is not a claim that none is done." />
      : <ul className="m-0 flex list-none flex-col p-0">{loc.map((l) => {
        const row = locRows.find((r) => r?.action?.body?.key === l.key);
        const run = row?.action ? runner(rowAction(row.action, decl), h) : null;
        return <li key={l.key} className="flex flex-wrap items-center gap-2.5 border-t border-axal-ground py-2 first:border-t-0 dark:border-gray-800" data-testid="market-check-row">
          <Check on={!!l.done_at} label={`${l.done_at ? 'Done' : 'Tick'}: ${l.label}`} run={run} />
          <span className="flex min-w-0 flex-1 flex-col"><b className="text-[13px] text-axal-ink dark:text-gray-100">{l.label}</b>
            <small className={`text-[11.5px] ${MUTED}`}>{l.done_at ? `Ticked ${dayLabel(l.done_at, true) || ''}` : 'Open'}</small></span>
          {l.key === 'legal_entity' && <Link to={legalEntityHref(search)} className={LINK} data-testid="market-legal-entity">Add the obligation in Company →</Link>}
        </li>;
      })}</ul>}
  </section>;

  const handoffs = <nav aria-label="Continue in other areas" className="flex flex-wrap gap-x-4 gap-y-2" data-testid="market-handoffs">
    {handoffLinks(search).map((l) => <Link key={l.href} to={l.href} className={LINK}>{l.text} →</Link>)}
  </nav>;

  const replies = Array.isArray(m.replies) ? m.replies : null;
  const partners = Array.isArray(m.partners) ? m.partners : null;
  const acts = Array.isArray(activity) ? activity : [];
  const side = <>
    <Block id="market-country" title="Attached country" phone={phone} testid="market-country"
      summary={m.country ? [m.country.name, m.country.region].filter(Boolean).join(' · ') : 'Not recorded'}>
      {m.country ? <><dl className="m-0 grid grid-cols-[70px_minmax(0,1fr)] gap-1 text-[12.5px]"><dt className={MUTED}>Country</dt><dd className="m-0">{m.country.name}</dd>
        <dt className={MUTED}>Region</dt><dd className="m-0">{m.country.region || <DataState state="not_recorded" reasonVisible={false} />}</dd></dl>
        <Link to={`/research/geographies/${encodeURIComponent(m.country.code)}`} className={LINK}>Open in Research › Geographies →</Link></>
        : m.country_state === 'unreadable' ? <DataState state="unavailable" what="The attached country" claim={`It is still attached (${m.geography_ref}).`} />
        : m.country_state === 'unlisted' ? <DataState state="not_recorded" reason={`Research › Geographies no longer lists ${m.geography_ref}.`} />
        : <><DataState state="not_recorded" reason="No Research › Geographies country attached" />{edit && <button type="button" onClick={edit} className={`${LINK} self-start`}>Attach with Edit →</button>}</>}
    </Block>
    <Block id="market-size" title="Size" phone={phone} testid="market-size" summary={view.size ? sizeLabel(view.size) : 'Not recorded'}>
      {view.size ? <><b className="font-mono text-[16px] text-axal-ink dark:text-gray-100">{sizeLabel(view.size)}</b>
        <p className={`m-0 text-[12px] ${MUTED}`}>Source: {view.size.source || 'not recorded'}</p></>
        : <><DataState state="not_recorded" reason="No size recorded" /><p className={`m-0 text-[12px] ${MUTED}`}>Add it with Edit, with its source.</p></>}
    </Block>
    <Block id="market-partners" title="Partners" phone={phone} testid="market-partners"
      summary={!partners ? 'Unavailable' : partners.length ? `${partners.length} linked` : 'None linked'}>
      {!partners ? <DataState state="unavailable" what="Linked partners" claim="This is not a claim that none is linked." />
        : partners.length === 0 ? <><DataState state="none">No partner is linked to this market yet.</DataState>
          <Link to={`/grow/partnerships${search}`} className={LINK}>Link one in Partnerships →</Link></>
        : <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{partners.map((p) => <li key={p.uid} className="text-[12.5px]">
          <Link to={recordHref('grow', 'partner-network', p.uid, search) || `/grow/partnerships${search}`} className={LINK}>{p.name}</Link>
          <span className={`ml-2 text-[11px] ${MUTED}`}>{[p.type, p.stage].filter(Boolean).map((x) => String(x).replace(/_/g, ' ')).join(' · ')}</span></li>)}</ul>}
    </Block>
    <Block id="market-replies" title="Replies to a market ask" phone={phone} testid="market-replies"
      summary={!replies ? 'Unavailable' : replies.length ? `${replies.length} · latest ${replies[0].name || 'unnamed'}` : 'None yet'}>
      {!replies ? <DataState state="unavailable" what="Replies" claim="This is not a claim that nobody replied." />
        : replies.length === 0 ? <DataState state="none">No replies to a market ask yet.</DataState>
        : <ul className="m-0 flex list-none flex-col gap-2 p-0">{replies.map((r) => <li key={r.uid} className="text-[12.5px]">
          <b className="text-axal-ink dark:text-gray-100">{r.name || 'Name not recorded'}</b> <span className={`font-mono text-[11px] ${MUTED}`}>{dayLabel(r.created_at, true) || ''}</span>
          {r.message && <p className="m-0 text-axal-ink/80 dark:text-gray-300">{r.message}</p>}</li>)}</ul>}
    </Block>
    <Block id="market-history" title="History" phone={phone} testid="market-history" summary={acts.length ? `Latest ${stamp(acts[0].b)}` : 'Nothing yet'}>
      {acts.length ? <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{acts.map((a, i) => <li key={i} className="flex gap-2 text-[12.5px]">
        <span className={`shrink-0 font-mono text-[11px] ${MUTED}`}>{stamp(a.b)}</span><span className="text-axal-ink dark:text-gray-200">{String(a.a ?? '')}</span></li>)}</ul>
        : <DataState state="none">Nothing recorded here yet.</DataState>}
      {acts.length < (record?.activity_total ?? 0) && onShowAll && <button type="button" onClick={onShowAll} className={`${SMALL_BTN} self-start`}>Load earlier</button>}
      <p className={`m-0 text-[11.5px] ${MUTED}`}>Who and when, from the activity log.{decision ? ` Current decision: ${decision.label}${m.decided_on ? `, decided ${dayLabel(m.decided_on)}` : ''}.` : ' No decision recorded.'} What changed on each line is not recorded yet.</p>
    </Block>
  </>;

  return <div className="flex min-w-0 flex-col gap-3" data-testid="market-record" data-phone={phone ? 'true' : undefined}>
    <RecordHeaderRow pills={pills} actions={record?.actions || []} handlers={h}
      inline={(p, row) => <div className="flex flex-wrap items-center justify-between gap-3.5">{p}{row}</div>} />
    {phone ? <>{partsSection}{planSection}{locSection}{side}{handoffs}</> : (
      <div className="grid grid-cols-1 items-start gap-3 @[760px]/cycle:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">{partsSection}{planSection}{locSection}{handoffs}</div>
        <div className="flex min-w-0 flex-col gap-3">{side}</div>
      </div>)}
  </div>;
}
