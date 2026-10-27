/**
 * D1253 (#2428) — the scope strip and the scorecard panel (SC1, SC6), shared by
 * the deal page's Scorecard tab, the Deal flow table and the founder's
 * `/raise/scorecard`.
 *
 * D1257 (#3280, part 4): the reads land. The panel reads `GET
 * /api/venture-scores/deal/:dealId` (SC1) and opens a drawer per scope with its
 * inputs, grades and dates (SC2–SC5, SC22); it draws loading, one scope
 * unreadable, no permission and masked before the NDA (SC15–SC18), a phone at
 * 390 wide (SC19) and dark (SC20). The strip reads `POST /batch` for Deal
 * flow's table and the deal's Overview (SC6, DL24a). The founder's page keeps
 * its waits: it is part 5's (#3281).
 *
 * Nothing here computes a score. A scope with no value is "Not enough
 * recorded", "Not expected yet", "Not scored yet" or "Could not be read",
 * never a bar or a number of zero.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Unreadable } from '../../../ui';
import { ventureScoresApi } from '../../../lib/api/ventureScores';
import { reportError } from '../../../lib/log';
import {
  COUNTED, FOUNDER_PAGE, GRADES, METHOD, MIX, NOT_ENOUGH, NOT_EXPECTED, NOT_REVIEWED, NOT_SCORED, NOT_YET, PMF_GROUPS, SCOPES, STATE_WORDS, UNREADABLE, WAITS,
  barText, bandWord, batches, coverageText, gradeMix, panelOf, reviewText, stampText, stripBar, stripOf, unreadScopes,
} from './scorecardModel';

const CARD = 'flex min-w-0 flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const SUB = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const EYE = 'font-mono text-[10.5px] font-semibold uppercase tracking-[0.07em] text-axal-muted dark:text-gray-400';
const LINK = 'text-[13px] font-semibold text-violet-700 underline dark:text-violet-300';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[13px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 sm:min-h-[32px]';
const BTN_P = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-violet-700 px-3 text-[13px] font-semibold text-white dark:bg-violet-500 sm:min-h-[32px]';
const OPACITY = { high: 1, medium: 0.6, low: 0.3 };
const GRADE_OPACITY = { measured: 1, reviewed: 0.75, sourced: 0.5, stated: 0.25 };
const BAND_TONE = {
  Strong: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  Fair: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300',
  Weak: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
};

export function ScorecardWait({ id }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`scorecard-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </div>
  );
}

/**
 * The scope strip: eleven 4px bars, 2px apart, 20px tall at 100, no numbers.
 * `locked` is the whole strip outlined with no bar at all; `lockedLabel` says why.
 */
export function ScopeStrip({ scopes = unreadScopes(), locked = false, lockedLabel = 'Scorecard locked' }) {
  const unread = scopes.every((s) => stripBar(s).kind === 'unread');
  const fromPage = scopes.every((s) => !s || s.state === 'not_read');
  const label = locked ? lockedLabel : fromPage ? `Scorecard: ${NOT_YET}` : scopes.map(barText).join('; ');
  return (
    <span role="img" tabIndex={0} aria-label={label} title={label} className={`inline-flex h-5 items-end gap-[2px] ${locked || unread ? 'rounded border border-dashed border-gray-300 px-0.5 dark:border-gray-600' : ''}`} data-testid={locked ? 'scope-strip-locked' : unread ? 'scope-strip-unread' : 'scope-strip'}>
      {scopes.map((s, i) => {
        const key = s?.key || SCOPES[i]?.key || i;
        const b = locked ? { kind: 'unread' } : stripBar(s);
        const tip = locked ? undefined : barText(s);
        if (b.kind === 'bar') return <span key={key} title={tip} className="w-1 rounded-sm bg-violet-600 dark:bg-violet-400" style={{ height: `${b.height}px`, opacity: b.opacity }} />;
        if (b.kind === 'dashed') return <span key={key} title={tip} className="w-1 border-b border-dashed border-gray-400" />;
        if (b.kind === 'dot') return <span key={key} title={tip} className="mb-0.5 h-1 w-1 rounded-full bg-gray-300 dark:bg-gray-600" />;
        if (b.kind === 'unreadable') return <span key={key} title={tip} className="mb-0.5 h-1.5 w-1 rounded-sm border border-red-400 dark:border-red-500" />;
        return <span key={key} title={tip} className="h-px w-1 bg-gray-200 dark:bg-gray-700" />;
      })}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * The strip's reads: Deal flow's table and the deal's Overview
 * ------------------------------------------------------------------ */

/** `POST /batch` for a list of deals, 200 ids a call: `{ status, items: Map(dealId → row), retry }`. */
export function useScopeStrips(dealIds) {
  const key = (dealIds || []).join(',');
  const [read, setRead] = useState({ status: dealIds?.length ? 'loading' : 'ready', items: new Map(), error: null });
  const load = useCallback(async () => {
    const groups = batches(dealIds);
    if (!groups.length) { setRead({ status: 'ready', items: new Map(), error: null }); return; }
    setRead({ status: 'loading', items: new Map(), error: null });
    try {
      const items = new Map();
      for (const ids of groups) {
        const out = await ventureScoresApi.batch(ids);
        for (const it of out?.items || []) items.set(Number(it.deal_id), it);
      }
      setRead({ status: 'ready', items, error: null });
    } catch (e) {
      if (e?.status !== 403) reportError('Scorecard:batch', e);
      setRead({ status: 'error', items: new Map(), error: { status: e?.status ?? null, code: e?.code ?? null } });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { load(); }, [load]);
  return { ...read, retry: load };
}

/** One deal's strip from the batch's read: never a bar for a locked or closed scorecard. */
export function DealStrip({ read, dealId }) {
  if (!read || read.status === 'loading') return <ScopeStrip />;
  if (read.status === 'error') return <span className={SUB} data-testid={`deal-strip-unread-${dealId}`}>{UNREADABLE}</span>;
  const s = stripOf(read.items.get(Number(dealId)));
  if (s.state === 'closed') return <ScopeStrip locked lockedLabel="Scorecard locked: not open to you" />;
  if (s.state === 'locked') return <ScopeStrip locked lockedLabel={`Scorecard locked: ${s.reason || 'the founder has not shared it with investors.'}`} />;
  if (s.state === 'unreadable') return <span className={SUB} data-testid={`deal-strip-unreadable-${dealId}`}>{UNREADABLE}</span>;
  return <ScopeStrip scopes={s.scopes} />;
}

/** SC6's key under the table. */
export function StripKey() {
  return (
    <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="scope-strip-key">
      Eleven bars in scope order, with no numbers: a bar’s height is its band and its shade its confidence. A dashed line is {NOT_ENOUGH.toLowerCase()}, a dot is {NOT_EXPECTED.toLowerCase()}, and an outline with no bar is a scorecard not open to you. Hover or focus a strip to read it.
    </p>
  );
}

/** DL24a: the deal's Overview slot, the strip read through the batch for this one deal. */
export function DealScoreStrip({ dealId }) {
  const read = useScopeStrips([Number(dealId)]);
  let body;
  if (read.status === 'loading') body = <p className={`m-0 ${SUB}`} aria-live="polite">{STATE_WORDS.reading}</p>;
  else if (read.status === 'error' && read.error?.status === 403) {
    body = <p className={`m-0 ${SUB}`} data-testid="deal-score-strip-refused">The scope strip is for investors and studio staff. A founder’s own scorecard is on <Link to={FOUNDER_PAGE} className={LINK}>Raise › Scorecard</Link>.</p>;
  } else if (read.status === 'error') body = <Unreadable what="The scorecard" claim="That is not a score of zero." onRetry={read.retry} />;
  else {
    const s = stripOf(read.items.get(Number(dealId)));
    body = (
      <>
        <DealStrip read={read} dealId={dealId} />
        {s.state === 'closed' && <p className={`m-0 ${SUB}`}>The scorecard opens once you are invited to this deal or committed on it.</p>}
        {s.state === 'locked' && <p className={`m-0 ${SUB}`}>{s.reason || STATE_WORDS.locked.line}</p>}
        {s.state === 'open' && <Link to={`/deals/${dealId}/scorecard`} className={LINK} data-testid="deal-score-open">Open the scorecard</Link>}
      </>
    );
  }
  return (
    <section className={CARD} data-testid="deal-score-slot">
      <span className={EYE}>Venture scorecard</span>
      <h3 className="m-0 text-[15px] font-bold text-axal-ink dark:text-gray-100">Scorecard</h3>
      {body}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The panel's pieces
 * ------------------------------------------------------------------ */

function BandPill({ band, scope }) {
  if (!band) return null;
  return <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11.5px] font-bold ${BAND_TONE[band] || BAND_TONE.Fair}`}>{bandWord(band, scope)}</span>;
}

function Confidence({ level }) {
  if (!level) return <span className={SUB}>—</span>;
  const n = { high: 3, medium: 2, low: 1 }[level] || 0;
  const word = level[0].toUpperCase() + level.slice(1);
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`${word} confidence`}>
      <span aria-hidden="true" className="inline-flex gap-[3px]">
        {[0, 1, 2].map((i) => <span key={i} className={`h-[7px] w-[7px] rounded-full ${i < n ? 'bg-violet-600 dark:bg-violet-400' : 'border border-gray-300 dark:border-gray-600'}`} />)}
      </span>
      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{word}</span>
    </span>
  );
}

function Mix({ mix, wide = false }) {
  const total = MIX.reduce((n, g) => n + (mix?.[g.key] || 0), 0);
  if (!total) return <span className={SUB}>—</span>;
  const label = `Grades: ${MIX.filter((g) => mix[g.key]).map((g) => `${mix[g.key]} ${g.label.toLowerCase()}`).join(', ')}`;
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex h-2 gap-px align-middle ${wide ? 'w-full' : 'w-14'}`}>
      {MIX.map((g) => (mix[g.key] ? (
        <span key={g.key} style={{ flex: `${mix[g.key]} 1 0`, opacity: GRADE_OPACITY[g.key] ?? 1 }}
          className={g.key === 'not_recorded' ? 'min-w-0 rounded-sm border border-dashed border-gray-400 dark:border-gray-500' : 'min-w-0 rounded-sm bg-violet-600 dark:bg-violet-400'} />
      ) : null))}
    </span>
  );
}

function ValueBar({ s }) {
  if (s.state === 'unreadable') return <span className="text-[11.5px] text-red-700 dark:text-red-300">{UNREADABLE}</span>;
  if (s.state === 'scored' && s.value != null) {
    return (
      <span className="block h-1.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
        <span className="block h-full rounded bg-violet-600 dark:bg-violet-400" style={{ width: `${Math.min(100, Math.max(0, s.value))}%`, opacity: OPACITY[s.confidence] ?? 0.3 }} />
      </span>
    );
  }
  if (s.state === 'not_enough') return <span className="block border-t border-dashed border-gray-400 dark:border-gray-500" />;
  return <span className={SUB}>—</span>;
}

const stateWord = (s) => ({ not_enough: NOT_ENOUGH, not_expected: NOT_EXPECTED, not_scored: NOT_SCORED, unreadable: UNREADABLE }[s.state] || null);

/** SC1's chart: each scope's value on 0–100, opacity its confidence. Open reads only. */
function GlanceChart({ scopes }) {
  return (
    <section className={CARD} data-testid="scorecard-glance">
      <h3 className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100">Eleven scopes at a glance</h3>
      <div role="img" aria-label={`Bar chart of scope values from 0 to 100. Bar opacity shows confidence. ${scopes.map(barText).join('; ')}`} className="flex flex-col gap-1.5">
        {scopes.map((s) => (
          <div key={s.key} className="grid grid-cols-[110px_minmax(0,1fr)_64px] items-center gap-2.5 sm:grid-cols-[150px_minmax(0,1fr)_72px]">
            <span className="truncate text-[12.5px] text-axal-ink dark:text-gray-200">{s.label}</span>
            <span className="relative block h-3.5">
              {s.state === 'scored' && s.value != null
                ? <span className="absolute left-0 top-px h-3 rounded-r bg-violet-600 dark:bg-violet-400" style={{ width: `${Math.min(100, Math.max(0, s.value))}%`, opacity: OPACITY[s.confidence] ?? 0.3 }} />
                : s.state === 'not_enough' ? <span className="absolute inset-x-0 top-1.5 border-t border-dashed border-gray-400 dark:border-gray-500" />
                  : <span className={`absolute left-1.5 top-0 text-[11.5px] ${s.state === 'unreadable' ? 'text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`}>{stateWord(s)}</span>}
            </span>
            <span className="font-mono text-[11.5px] text-axal-ink dark:text-gray-300">{s.state === 'scored' && s.value != null ? Math.round(s.value) : s.state === 'not_enough' ? 'Not enough' : '—'}</span>
          </div>
        ))}
      </div>
      <p className={`m-0 ${SUB}`}>Opacity is confidence: high, medium, low. A dashed line is {NOT_ENOUGH.toLowerCase()}; it is never a zero.</p>
    </section>
  );
}

const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_auto_36px_14px] items-center gap-2 sm:grid-cols-[minmax(0,1.25fr)_116px_36px_minmax(56px,1fr)_88px_84px_58px_14px]';

/** One scope row (SC1, SC19a). Open reads open the drawer; a masked read shows the band and locks the value. */
function ScopeRow({ s, masked, onOpen, onRetry }) {
  if (s.state === 'unreadable') {
    return (
      <div role="row" className="my-1.5 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-900 dark:bg-red-950/40" data-testid={`scorecard-scope-${s.key}`}>
        <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{s.label}</span>
        <span className="text-[12.5px] text-red-700 dark:text-red-300" role="alert">{STATE_WORDS.scope_unreadable(s.label)}</span>
        <button type="button" onClick={onRetry} className={`${BTN} ml-auto`} data-testid={`scorecard-retry-${s.key}`}>Try again</button>
      </div>
    );
  }
  const word = stateWord(s);
  const review = reviewText(s.review);
  const opens = !masked && Array.isArray(s.inputs);
  const cells = (
    <>
      <span className="flex min-w-0 flex-col text-left">
        <span className="text-[13px] font-semibold leading-tight text-axal-ink dark:text-gray-100">{s.label}</span>
        {review && <span className="truncate text-[11.5px] text-violet-700 dark:text-violet-300">{review}</span>}
      </span>
      <span>{word ? <span className="block text-[11.5px] leading-tight text-axal-muted dark:text-gray-400">{word}</span> : <BandPill band={s.band} scope={s.key} />}</span>
      <span className="font-mono text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">
        {s.state !== 'scored' ? <span className="text-axal-muted dark:text-gray-400">—</span> : masked ? <span aria-label="Value locked until the NDA" className="text-axal-muted dark:text-gray-400">⊘</span> : s.value == null ? '—' : Math.round(s.value)}
      </span>
      <span className="hidden sm:block">{masked && s.state === 'scored' ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">After the NDA</span> : <ValueBar s={s} />}</span>
      <span className="hidden sm:block"><Confidence level={s.state === 'scored' ? s.confidence : null} /></span>
      <span className="hidden font-mono text-[11.5px] text-axal-ink dark:text-gray-300 sm:block">{coverageText(s.coverage) || '—'}</span>
      <span className="hidden sm:block">{masked ? null : <Mix mix={gradeMix(s.inputs)} />}</span>
      <span aria-hidden="true" className="text-axal-muted dark:text-gray-500">{opens ? '›' : ''}</span>
    </>
  );
  const label = masked && s.state === 'scored' ? `${s.label}: ${bandWord(s.band, s.key)}, ${s.confidence} confidence, value locked` : barText(s);
  if (!opens) return <div role="row" aria-label={label} className={`${ROW_GRID} min-h-[44px] border-b border-gray-100 px-2 py-2 dark:border-gray-800`} data-testid={`scorecard-scope-${s.key}`}>{cells}</div>;
  return (
    <button type="button" aria-label={`${label}. Open its inputs`} onClick={() => onOpen(s.key)} className={`${ROW_GRID} min-h-[44px] w-full border-b border-gray-100 px-2 py-2 text-left hover:bg-violet-50 dark:border-gray-800 dark:hover:bg-violet-950/40`} data-testid={`scorecard-scope-${s.key}`}>
      {cells}
    </button>
  );
}

/** "What this rests on": the grades of every input the read carries, counted. */
function RestsOn({ mix }) {
  const total = MIX.reduce((n, g) => n + (mix[g.key] || 0), 0);
  const what = Object.fromEntries(GRADES.map((g) => [g.key, g.what]));
  return (
    <section className={CARD} data-testid="scorecard-rests">
      <span className={EYE}>What this rests on</span>
      <span className="text-[15px] font-bold text-axal-ink dark:text-gray-100"><span className="font-mono">{total}</span> inputs across eleven scopes</span>
      <Mix mix={mix} wide />
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {MIX.map((g) => (
          <li key={g.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-[12.5px]">
            <span><span className="font-semibold text-axal-ink dark:text-gray-100">{g.label}</span><span className="text-axal-muted dark:text-gray-400"> · {what[g.key] || 'Lowers confidence, never the value.'}</span></span>
            <span className="font-mono font-semibold text-axal-ink dark:text-gray-100">{mix[g.key] || 0}</span>
          </li>
        ))}
      </ul>
      <p className={`m-0 border-t border-gray-100 pt-2 dark:border-gray-800 ${SUB}`}>A grade changes confidence, never the value. A stale input counts one grade lower.</p>
    </section>
  );
}

function GradeChip({ grade, stale }) {
  const g = MIX.find((x) => x.key === grade);
  if (!g) return null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-axal-hairline px-2 py-px text-[11.5px] text-axal-ink dark:border-gray-700 dark:text-gray-200">
      <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-violet-600 dark:bg-violet-400" style={{ opacity: GRADE_OPACITY[grade] ?? 1 }} />
      {g.label}
      {stale && <span className="rounded-full bg-amber-50 px-1.5 text-[10.5px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">Stale</span>}
    </span>
  );
}

/** One input in the drawer (SC2, SC3, SC22): its figure and points, its words, grade, date and weight. */
function InputRow({ i }) {
  const meta = 'font-mono text-[11px] text-axal-muted dark:text-gray-400';
  return (
    <li className={`border-b border-gray-100 py-3 dark:border-gray-800 ${i.kind === 'out' ? 'text-axal-muted dark:text-gray-400' : ''}`} data-testid={`scorecard-input-${i.key}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{i.label}</span>
        <span className="flex flex-none items-baseline gap-2.5">
          {i.kind === 'value' && i.value != null && <span className="font-mono text-[13px] font-semibold text-axal-ink dark:text-gray-100">{Math.round(i.value)}</span>}
          {i.kind === 'value' && i.contribution != null && <span className={meta}>{i.contribution.toFixed(1)} pts</span>}
          {i.kind === 'missing' && <span className="font-mono text-[13px] text-axal-muted dark:text-gray-400">—</span>}
          {i.kind === 'counted' && i.band && <BandPill band={i.band} scope="team" />}
        </span>
      </div>
      {i.kind === 'counted' && <p className="m-0 mt-1 text-[12.5px] text-axal-ink dark:text-gray-300">{COUNTED}{i.state === 'recorded' ? '' : ` · ${NOT_ENOUGH.toLowerCase()}`}</p>}
      {i.kind === 'missing' && <p className="m-0 mt-1 text-[12.5px] text-axal-ink dark:text-gray-300">{STATE_WORDS.missing_input}{i.reason ? `. ${i.reason}` : ''}</p>}
      {i.kind === 'out' && <p className="m-0 mt-1 text-[12.5px]">{i.state === 'not_expected' ? NOT_EXPECTED : STATE_WORDS.out_input}{i.reason ? `. ${i.reason}` : ''}</p>}
      {i.kind === 'unreadable' && <p className="m-0 mt-1 text-[12.5px] text-red-700 dark:text-red-300">{STATE_WORDS.unreadable_input}</p>}
      {i.kind === 'value' && i.words && <p className="m-0 mt-1 text-[12.5px] leading-snug text-axal-ink dark:text-gray-300">{i.words}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {i.kind === 'value' && <GradeChip grade={i.grade} stale={i.stale} />}
        {i.kind === 'missing' && <span className="rounded-full border border-dashed border-gray-400 px-2 py-px text-[11.5px] text-axal-muted dark:border-gray-500 dark:text-gray-400">Not recorded</span>}
        {i.as_of && <span className={meta}>as of {i.as_of}</span>}
        {i.records != null && <span className={meta}>from {i.records} {i.records === 1 ? 'record' : 'records'}</span>}
        {i.weight != null && i.kind !== 'out' && <span className={meta}>weight {i.weight}%</span>}
      </div>
    </li>
  );
}

/** SC2–SC5, SC22: one scope's drawer. A bottom sheet on a phone (SC19b). It reads nothing and changes nothing. */
export function ScopeDrawer({ s, model, computedAt, onClose }) {
  const inputs = s.inputs || [];
  const groups = s.key === 'pmf' && inputs.some((i) => i.group) ? Object.entries(PMF_GROUPS).map(([g, title]) => [title, inputs.filter((i) => i.group === g)]).filter(([, l]) => l.length) : [['Inputs · value and points', inputs]];
  const review = reviewText(s.review);
  const word = stateWord(s);
  const footer = (
    <div className="flex w-full flex-wrap items-center justify-between gap-2 text-[12px] text-axal-muted dark:text-gray-400">
      <span className="font-mono">Model v{model || '1.0'}{stampText(s.computed_at || computedAt) ? ` · computed ${stampText(s.computed_at || computedAt)} UTC` : ''}</span>
      <Link to={METHOD} className={LINK}>How scoring works</Link>
    </div>
  );
  return (
    <Lightbox label={`${s.label} scope`} eyebrow="Scorecard · scope" title={s.label} onClose={onClose} width={560} phone="sheet" footer={footer} testId={`scorecard-drawer-${s.key}`}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {word ? <span className="rounded-full border border-dashed border-gray-400 px-2 py-0.5 text-[11.5px] font-bold text-axal-muted dark:border-gray-500 dark:text-gray-400">{word}</span>
            : <><BandPill band={s.band} scope={s.key} /><span className="font-mono text-[24px] font-bold leading-none text-axal-ink dark:text-gray-100">{s.value == null ? '—' : Math.round(s.value)}</span><Confidence level={s.confidence} /></>}
          {coverageText(s.coverage) && <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{coverageText(s.coverage)}</span>}
        </div>
        {s.key === 'risk' && <p className={`m-0 ${SUB}`}>A higher value means lower risk.</p>}
        {s.reason && s.state !== 'scored' && <p className={`m-0 ${SUB}`}>{s.reason}</p>}
        {review && <p className="m-0 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="scorecard-review">{review} The computed value stays as it is.</p>}
        {inputs.length === 0 && <p className={`m-0 ${SUB}`}>No input is stored for this scope yet.</p>}
        {groups.map(([title, list]) => (
          <div key={title}>
            <h4 className={`${EYE} mb-0.5 mt-4`}>{title}</h4>
            <ul className="m-0 list-none p-0">{list.map((i) => <InputRow key={i.key} i={i} />)}</ul>
          </div>
        ))}
        {s.layers && (
          <div data-testid="scorecard-risk-layers">
            <h4 className={`${EYE} mb-0.5 mt-4`}>The ten venture-risk layers · analyst reviews</h4>
            <ul className="m-0 list-none p-0">
              {s.layers.map((l) => (
                <li key={l.key} className="flex flex-col gap-0.5 border-b border-axal-hairline py-1.5 text-[13px] last:border-0 dark:border-gray-800" data-testid={`risk-layer-${l.key}`}>
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-axal-ink dark:text-gray-100">{l.label}</span>
                    <span className={`font-mono text-[12px] ${l.reviewed ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>{l.text}{l.reviewed_on ? ` · ${l.reviewed_on}` : ''}</span>
                  </span>
                  {l.note && <span className={SUB}>{l.note}</span>}
                </li>
              ))}
            </ul>
            <p className={`m-0 mt-1 ${SUB}`}>Each layer is an analyst&rsquo;s review; one no analyst scored is {NOT_REVIEWED.toLowerCase()}, never 0. They feed &ldquo;Analyst layer reviews&rdquo; above as their mean.</p>
          </div>
        )}
        {inputs.some((i) => i.kind === 'counted') && (
          <p className="m-0 mt-3 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-600 dark:text-gray-300">Individual skills and values are never shown. {COUNTED}.</p>
        )}
      </div>
    </Lightbox>
  );
}

/* ------------------------------------------------------------------ *
 * SC1: the panel
 * ------------------------------------------------------------------ */

/** `GET /deal/:dealId` with its own state: loading, ready or error (with the refusal's status and code only). */
export function useDealScorecard(dealId) {
  const [read, setRead] = useState({ status: dealId == null ? 'idle' : 'loading' });
  const load = useCallback(async () => {
    if (dealId == null) return;
    setRead({ status: 'loading' });
    try {
      setRead({ status: 'ready', data: await ventureScoresApi.deal(dealId) });
    } catch (e) {
      if (e?.status !== 403 && e?.status !== 404) reportError('Scorecard:deal', e);
      setRead({ status: 'error', error: { status: e?.status ?? null, code: e?.code ?? null } });
    }
  }, [dealId]);
  useEffect(() => { load(); }, [load]);
  return [read, load];
}

function Header({ panel }) {
  const stamp = stampText(panel?.computed_at);
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-3">
        <h2 className="m-0 text-[15px] font-bold text-axal-ink dark:text-gray-100">Venture scorecard</h2>
        {panel?.scopes && <ScopeStrip scopes={panel.scopes} />}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-axal-muted dark:text-gray-400">
        {panel?.model && <span className="rounded-full border border-axal-hairline px-2 py-0.5 font-mono text-[11px] dark:border-gray-700" data-testid="scorecard-model">Model v{panel.model}</span>}
        {stamp && <span data-testid="scorecard-computed">Computed {stamp} UTC</span>}
        <Link to={METHOD} className={LINK} data-testid="scorecard-method-link">How scoring works</Link>
      </div>
    </header>
  );
}

/** SC17 and the other refusals: one centred card, never a page of zeros. */
function Closed({ words, testId, children }) {
  return (
    <div className={`${CARD} mx-auto my-6 max-w-[420px] items-center text-center`} data-testid={testId}>
      <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-full bg-violet-50 text-[18px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">⊘</span>
      <h3 className="m-0 text-[17px] font-extrabold text-axal-ink dark:text-gray-100">{words.title}</h3>
      <p className={`m-0 ${SUB}`}>{words.line}</p>
      {children}
    </div>
  );
}

/** SC15: the panel's shape while it reads. */
function Loading() {
  const bar = (w, h = 10) => <span className="block animate-pulse rounded bg-gray-100 dark:bg-gray-800" style={{ width: w, height: `${h}px` }} />;
  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="scorecard-loading" aria-busy="true">
      <div className={`${CARD} lg:col-span-2`}>
        {bar('22%', 14)}
        {SCOPES.map((s, i) => <div key={s.key} className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-2.5">{bar('80%')}{bar(`${30 + ((i * 37) % 60)}%`, 12)}</div>)}
        <p className={`m-0 ${SUB}`} aria-live="polite">{STATE_WORDS.reading}</p>
      </div>
      <div className={CARD}>{bar('50%')}{bar('100%', 14)}{bar('85%')}<p className={`m-0 ${SUB}`}>{STATE_WORDS.reading}</p></div>
    </div>
  );
}

/**
 * SC1's panel. With a `dealId` it reads the deal's scorecard by the
 * visibility rule (D1256 §2) and draws one of SC1 and SC15–SC18. The
 * founder's audience keeps D1253's waits: their page is part 5's.
 */
export default function VentureScorecard({ audience = 'investor', dealId = null, ndaHref = null }) {
  const [read, retry] = useDealScorecard(audience === 'founder' ? null : dealId);
  const [open, setOpen] = useState(null);

  if (audience === 'founder' || dealId == null) {
    return (
      <section className={CARD} data-testid="venture-scorecard">
        <Header />
        <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800">
          {SCOPES.map((s) => (
            <li key={s.key} className="flex items-center justify-between py-2 text-[13.5px]" data-testid={`scorecard-scope-${s.key}`}>
              <span className="font-semibold">{s.label}</span>
              <span className="text-[12px] text-axal-muted">{NOT_YET}</span>
            </li>
          ))}
        </ul>
        {audience === 'founder' ? <><ScorecardWait id="founder" /><ScorecardWait id="sharing" /><ScorecardWait id="trajectory" /></> : <ScorecardWait id="weighting" />}
      </section>
    );
  }

  const panel = panelOf(read);
  let body;
  if (panel.state === 'loading') body = <Loading />;
  else if (panel.state === 'not_on_deal') body = <Closed words={STATE_WORDS.not_on_deal} testId="scorecard-not-on-deal" />;
  else if (panel.state === 'no_access') body = <Closed words={STATE_WORDS.no_access} testId="scorecard-no-access"><Link to="/" className={BTN}>Go to your home</Link></Closed>;
  else if (panel.state === 'not_found') body = <Closed words={STATE_WORDS.not_found} testId="scorecard-not-found" />;
  else if (panel.state === 'unreadable') body = <div className={CARD} data-testid="scorecard-unreadable"><Unreadable what="The scorecard" claim="That is not a score of zero." onRetry={retry} /></div>;
  else if (panel.state === 'locked') body = <Closed words={{ title: STATE_WORDS.locked.title, line: panel.reason }} testId="scorecard-locked" />;
  else {
    const masked = panel.state === 'masked';
    const shown = panel.scopes.find((s) => s.key === open);
    body = (
      <>
        {masked && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-800 dark:bg-violet-950/40" data-testid="scorecard-masked">
            <span aria-hidden="true" className="text-[18px] text-violet-700 dark:text-violet-300">⊘</span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{STATE_WORDS.masked.title}</p>
              <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-300">{STATE_WORDS.masked.line}</p>
            </div>
            {ndaHref && <Link to={ndaHref} className={BTN_P} data-testid="scorecard-nda">{STATE_WORDS.masked.act}</Link>}
          </div>
        )}
        {panel.read_only && <p className={`m-0 ${SUB}`} data-testid="scorecard-read-only">Shared with you by the founders, read only.</p>}
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
            {!masked && <GlanceChart scopes={panel.scopes} />}
            <section className={CARD} data-testid="scorecard-scopes">
              <h3 className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100">Scopes <span className="font-normal text-axal-muted dark:text-gray-400">· {panel.empty ? STATE_WORDS.empty : masked ? 'No overall total.' : 'No overall total. Open a scope to see its inputs.'}</span></h3>
              <div role="table" aria-label="Scorecard scopes">
                <div role="row" className={`${ROW_GRID} border-b border-gray-100 px-2 py-2 dark:border-gray-800`}>
                  {['Scope', 'Band', 'Value', '0–100', 'Confidence', 'Coverage', 'Grades', ''].map((x, i) => (
                    <span key={x || i} role="columnheader" className={`${EYE} ${i >= 3 && i <= 6 ? 'hidden sm:block' : ''}`}>{x}</span>
                  ))}
                </div>
                {panel.scopes.map((s) => <ScopeRow key={s.key} s={s} masked={masked} onOpen={setOpen} onRetry={retry} />)}
              </div>
            </section>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {masked ? (
              <section className={CARD} data-testid="scorecard-after-nda">
                <h3 className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100">What opens after the NDA</h3>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-axal-ink dark:text-gray-300">{STATE_WORDS.after_nda.map((x) => <li key={x}>{x}</li>)}</ul>
              </section>
            ) : <RestsOn mix={panel.rests} />}
            {panel.viewer === 'investor' && <ScorecardWait id="weighting" />}
          </div>
        </div>
        {shown && <ScopeDrawer s={shown} model={panel.model} computedAt={panel.computed_at} onClose={() => setOpen(null)} />}
      </>
    );
  }
  return (
    <section className="flex min-w-0 flex-col gap-4" data-testid="venture-scorecard">
      <div className={CARD}><Header panel={panel.scopes ? panel : null} /></div>
      {body}
    </section>
  );
}
