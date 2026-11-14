/**
 * D1258 (#3281) — the founder's scorecard (SC8), what investors see, sharing,
 * the trajectory (SC12) and the read-only list a shared advisor reads (SC21),
 * over part 3's reads (D1256). Each scope opens to its inputs with their
 * source and grade; the founder asks to correct any input (SC9), and studio
 * staff add a review (SC10). A scope with no value says why, never 0.
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { METHOD } from './scorecardModel.js';
import { openCorrection, previewRow, scopeRow, sharingChange, trajectoryOf, trajectoryRows } from './founderModel.js';
import { AddReview, AskToCorrect, SharingChange } from './ScorecardDialogs';

const CARD = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-200';
const CHIP = 'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold';
const SMALL = 'rounded-lg border border-axal-hairline bg-white px-2.5 py-1 text-[12px] font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800';

function InputList({ scope, corrections, canAsk, onAsk }) {
  if (!scope.inputs.length) return <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid={`scorecard-inputs-none-${scope.key}`}>No input is stored for this scope yet.</p>;
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800" data-testid={`scorecard-inputs-${scope.key}`}>
      {scope.inputs.map((i) => {
        const open = openCorrection(corrections, scope.key, i.key);
        return (
          <li key={i.key} className="flex flex-wrap items-center gap-2 py-2 text-[12.5px]" data-testid={`scorecard-input-${scope.key}-${i.key}`}>
            <span className="min-w-[160px] flex-1 font-semibold">{i.label}{i.personal ? <span className={`ml-1 font-normal ${MUTED}`}>(personal: investors see a band)</span> : null}</span>
            <span className={i.recorded ? '' : MUTED}>{i.recorded ? i.words : i.missing}</span>
            {i.source ? <span className={`${CHIP} border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-200`}>{i.source}</span> : null}
            {i.grade ? <span className={`${CHIP} border-violet-200 text-violet-800 dark:border-violet-800 dark:text-violet-200`}>{i.grade}{i.stale ? ' · older' : ''}</span> : null}
            {canAsk ? (open
              ? <span className={`text-[12px] ${MUTED}`} data-testid={`scorecard-ask-open-${scope.key}-${i.key}`}>Correction asked · waiting for an Admin</span>
              : <button type="button" className={SMALL} onClick={() => onAsk(scope, i)} data-testid={`scorecard-ask-${scope.key}-${i.key}`}>Ask to correct</button>) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The eleven scopes as the founder, staff or a shared advisor read them. */
export function ScopeList({ read, projectId, onChanged = () => {}, readOnly = false }) {
  const rows = useMemo(() => (read?.scopes || []).map(scopeRow), [read]);
  const [open, setOpen] = useState(null);
  const [ask, setAsk] = useState(null);
  const [review, setReview] = useState(null);
  const canAsk = !readOnly && read?.viewer === 'founder';
  const canReview = !readOnly && read?.viewer === 'staff';
  return (
    <section className={CARD} data-testid="scorecard-scopes">
      <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800">
        {rows.map((s) => (
          <li key={s.key} className="flex flex-col gap-2 py-2.5" data-testid={`scorecard-row-${s.key}`}>
            <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
              <button type="button" className="min-w-[180px] flex-1 text-left font-semibold" aria-expanded={open === s.key}
                onClick={() => setOpen(open === s.key ? null : s.key)} data-testid={`scorecard-open-${s.key}`}>{s.label}</button>
              {s.scored ? (
                <span className="flex items-center gap-2" data-testid={`scorecard-value-${s.key}`}>
                  <span className="font-semibold">{s.band}</span>
                  <span className="font-mono font-bold tabular-nums">{s.value}</span>
                  <span className={`text-[12px] ${MUTED}`}>{s.confidence} confidence{s.coverage ? ` · ${s.coverage}` : ''}</span>
                </span>
              ) : <span className={`text-[12.5px] ${MUTED}`} data-testid={`scorecard-state-${s.key}`}>{s.state}{s.coverage ? ` · ${s.coverage}` : ''}</span>}
              {canReview ? <button type="button" className={SMALL} onClick={() => setReview(s)} data-testid={`scorecard-review-${s.key}`}>Add review</button> : null}
            </div>
            {s.review ? <p className={`m-0 rounded-lg bg-violet-50 px-2.5 py-1.5 text-[12.5px] text-violet-900 dark:bg-violet-950 dark:text-violet-200 ${s.review.current ? '' : 'opacity-70'}`} data-testid={`scorecard-reviewed-${s.key}`}>
              {s.review.text}{s.review.current ? '' : ' (made against an earlier score)'}
            </p> : null}
            {open === s.key ? (readOnly
              ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid={`scorecard-inputs-hidden-${s.key}`}>Inputs stay hidden. Personal and team-only inputs are counted, not shown.</p>
              : <InputList scope={s} corrections={read?.corrections} canAsk={canAsk} onAsk={(scope, input) => setAsk({ scope, input })} />) : null}
          </li>
        ))}
      </ul>
      <p className={`m-0 text-[12px] ${MUTED}`}>Model {read?.model || 'not recorded'} · <Link to={METHOD} className={LINK}>How scoring works</Link></p>
      {ask ? <AskToCorrect projectId={projectId} scope={ask.scope} input={ask.input} onClose={() => setAsk(null)} onDone={() => { setAsk(null); onChanged('Your request was sent to the studio’s Admins.'); }} /> : null}
      {review ? <AddReview projectId={projectId} scope={review} onClose={() => setReview(null)} onDone={() => { setReview(null); onChanged('Review saved. The founder is told.'); }} /> : null}
    </section>
  );
}

/** "What investors see": the investor's masking before and after an NDA, from the Worker's own preview. */
export function InvestorPreview({ preview }) {
  const [nda, setNda] = useState(false);
  const rows = (nda ? preview?.after_nda : preview?.before_nda) || [];
  return (
    <section className={CARD} data-testid="scorecard-preview">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">What investors see</span>
        <div role="radiogroup" aria-label="NDA" className="ml-auto flex gap-1.5">
          {[[false, 'Before an NDA'], [true, 'After an NDA']].map(([v, l]) => (
            <button key={l} type="button" role="radio" aria-checked={nda === v} onClick={() => setNda(v)} data-testid={`scorecard-preview-${v ? 'after' : 'before'}`}
              className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${nda === v ? 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950 dark:text-violet-200' : 'border-axal-hairline dark:border-gray-700'}`}>{l}</button>
          ))}
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800">
        {rows.map(previewRow).map((s) => (
          <li key={s.key} className="flex flex-col gap-1 py-2 text-[13px]" data-testid={`scorecard-preview-row-${s.key}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 font-semibold">{s.label}</span>
              {s.band ? <span>{s.band}{s.value != null ? <span className="ml-2 font-mono font-bold">{s.value}</span> : null}{s.confidence ? <span className={`ml-2 text-[12px] ${MUTED}`}>{s.confidence} confidence</span> : null}</span>
                : <span className={MUTED}>{s.state}</span>}
            </div>
            {nda && s.inputs.length ? (
              <ul className={`m-0 list-none p-0 text-[12px] ${MUTED}`}>
                {s.inputs.map((i) => <li key={i.key}>{i.label}: {i.hidden || (i.recorded ? i.words : i.missing)}</li>)}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      <p className={`m-0 text-[12px] ${MUTED}`}>{nda ? 'After an NDA: values and inputs. Personal and team-only inputs are counted, not shown.' : 'Before an NDA: each scope’s band and confidence. Nothing else.'}</p>
    </section>
  );
}

/** Sharing: the investors' switch and the venture's own advisors, each change confirmed in a dialog. */
export function SharingCard({ projectId, sharing, onChanged }) {
  const [next, setNext] = useState(null);
  if (!sharing) return null;
  const current = { investors: sharing.investors, advisors: sharing.advisors || [] };
  const shared = new Set(current.advisors.map((a) => a.user_id));
  const cands = sharing.candidates || { readable: false, items: [] };
  const allIds = [...new Set([...cands.items.map((c) => c.user_id), ...current.advisors.map((a) => a.user_id)])];
  const nameOf = (id) => (cands.items.find((c) => c.user_id === id) || current.advisors.find((a) => a.user_id === id) || {}).name || 'Name not recorded';
  return (
    <section className={CARD} data-testid="scorecard-sharing-card">
      <span className="font-semibold">Sharing</span>
      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" className="mt-0.5" checked={!!current.investors?.on} onChange={(e) => setNext({ investors: e.target.checked })} data-testid="scorecard-share-investors" />
        <span>Share with investors in my deal flow
          <span className={`block text-[12px] ${MUTED}`}>{current.investors?.set ? 'You set this.' : current.investors?.default_rule}</span>
        </span>
      </label>
      <div className="flex flex-col gap-1 text-[13px]" data-testid="scorecard-share-advisors">
        <span className="text-[12px] font-semibold">Share with my advisors <span className={`font-normal ${MUTED}`}>· read only, inputs hidden</span></span>
        {!cands.readable ? <span className={`text-[12px] ${MUTED}`} data-testid="scorecard-share-advisors-unreadable">Your advisors could not be read. Try again.</span>
          : !allIds.length ? <span className={`text-[12px] ${MUTED}`} data-testid="scorecard-share-advisors-none">No advisor is on your venture’s team yet. Invite one from Founding team.</span>
            : allIds.map((id) => (
              <label key={id} className="flex items-center gap-2">
                <input type="checkbox" checked={shared.has(id)} data-testid={`scorecard-share-advisor-${id}`}
                  onChange={(e) => setNext({ advisors: e.target.checked ? [...shared, id] : [...shared].filter((x) => x !== id) })} />
                <span>{nameOf(id)}</span>
              </label>
            ))}
      </div>
      <p className={`m-0 text-[12px] ${MUTED}`}>Investors outside your deal flow see nothing. A change opens a dialog that says who gains or loses access.</p>
      {next && sharingChange(current, next, cands.items).length ? (
        <SharingChange projectId={projectId} current={current} next={next} candidates={cands.items}
          onClose={() => setNext(null)} onDone={() => { setNext(null); onChanged('Sharing saved.'); }} />
      ) : null}
    </section>
  );
}

const W = 900; const H = 280; const PL = 36; const PR = 16; const PT = 14; const PB = 26;
const LINE = ['stroke-violet-600 dark:stroke-violet-400', 'stroke-sky-600 dark:stroke-sky-400', 'stroke-amber-600 dark:stroke-amber-400', 'stroke-emerald-600 dark:stroke-emerald-400',
  'stroke-rose-600 dark:stroke-rose-400', 'stroke-gray-600 dark:stroke-gray-300', 'stroke-indigo-600 dark:stroke-indigo-400', 'stroke-teal-600 dark:stroke-teal-400',
  'stroke-orange-600 dark:stroke-orange-400', 'stroke-lime-700 dark:stroke-lime-400', 'stroke-fuchsia-600 dark:stroke-fuchsia-400'];

/** SC12 · each scope over time; a gap is a stretch with too little recorded; a dotted line marks a model change. */
export function Trajectory({ read }) {
  const t = useMemo(() => trajectoryOf(read), [read]);
  const [table, setTable] = useState(false);
  if (!t) return null;
  if (t.empty) return <section className={CARD} data-testid="scorecard-trajectory-empty"><p className="m-0 text-[13px]">No scope has a scored value yet, so there is no line to draw. The trajectory starts with the first score.</p></section>;
  const n = Math.max(1, t.days.length - 1);
  const X = (i) => PL + (t.days.length === 1 ? (W - PL - PR) / 2 : i * (W - PL - PR) / n);
  const Y = (v) => PT + (H - PT - PB) * (1 - v / 100);
  const segs = (values) => {
    const out = []; let cur = [];
    values.forEach((v, i) => { if (v == null) { if (cur.length) out.push(cur); cur = []; } else cur.push(`${X(i)},${Y(v)}`); });
    if (cur.length) out.push(cur);
    return out;
  };
  return (
    <section className={CARD} data-testid="scorecard-trajectory">
      <div className="flex items-center gap-2">
        <span className="font-semibold">Scopes over time</span>
        <button type="button" className={`ml-auto text-[12.5px] ${LINK}`} onClick={() => setTable((x) => !x)} data-testid="scorecard-trajectory-table-toggle">{table ? 'View as chart' : 'View as table'}</button>
      </div>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>A point is a change: a score is stored only when its inputs change. A gap is a stretch with too little recorded. Earlier values stay as they were computed.</p>
      {table ? (
        <table className="w-full border-collapse text-[12.5px]" data-testid="scorecard-trajectory-table">
          <thead><tr className={`text-left ${MUTED}`}><th className="py-1">Scope</th><th>Date</th><th>Model</th><th>Value</th><th>Band</th><th>Confidence</th></tr></thead>
          <tbody>{trajectoryRows(read).map((r, i) => <tr key={i} className="border-t border-gray-100 dark:border-gray-800"><td className="py-1">{r.scope}</td><td>{r.day}</td><td className="font-mono">{r.model}</td><td className="font-mono">{r.value}</td><td>{r.band}</td><td>{r.confidence}</td></tr>)}</tbody>
        </table>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${t.lines.length} scopes over ${t.days.length} recorded ${t.days.length === 1 ? 'day' : 'days'}.`} data-testid="scorecard-trajectory-chart">
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={v}><line x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} className="stroke-gray-200 dark:stroke-gray-800" /><text x={PL - 8} y={Y(v) + 3.5} textAnchor="end" fontSize="11" className="fill-gray-500">{v}</text></g>
            ))}
            {t.markers.map((m) => (
              <g key={m.version} data-testid={`scorecard-trajectory-marker-${m.version}`}>
                <line x1={X(m.index)} x2={X(m.index)} y1={PT} y2={H - PB} strokeDasharray="1.5 4" strokeWidth="1.5" className="stroke-gray-700 dark:stroke-gray-300" />
                <text x={X(m.index) - 6} y={PT + 10} textAnchor="end" fontSize="11" className="fill-gray-700 dark:fill-gray-300">Model {m.version}</text>
              </g>
            ))}
            {t.lines.map((l, li) => segs(l.values).map((pts, si) => (
              pts.length === 1
                ? <circle key={`${l.key}-${si}`} cx={pts[0].split(',')[0]} cy={pts[0].split(',')[1]} r="3" className={`${LINE[li % LINE.length].replace(/stroke-/g, 'fill-')}`} />
                : <polyline key={`${l.key}-${si}`} points={pts.join(' ')} fill="none" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className={LINE[li % LINE.length]} />
            )))}
          </svg>
          <div className="flex flex-wrap gap-3 text-[12px]" data-testid="scorecard-trajectory-legend">
            {t.lines.map((l) => <span key={l.key}>{l.label} <span className="font-mono font-semibold">{l.latest ?? '—'}</span></span>)}
          </div>
        </>
      )}
    </section>
  );
}
