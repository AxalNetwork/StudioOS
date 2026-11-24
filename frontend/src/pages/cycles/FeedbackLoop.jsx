import { useEffect, useState } from 'react';
import { TOLD_VIA, countsStrip, loopRow, peopleLine, rankThemes, revenueLines, toldResult } from './feedbackLoopModel.js';

/**
 * D6865 (#6865) — Grow › Feedback (the #6099 canvas): the counts strip
 * (GR-21), the themes ranked by item count with one theme's weight (GR-23),
 * and Close the loop for several people (GR-26).
 *
 * The counts come with the module read (`parts.counts`, everyone's). The
 * themes (`parts.themes`) and the weight name people, so they reach writers
 * only: an advisor sees the counts and nothing else here (GR-28B). The weight
 * is `GET /api/cycles/grow/feedback/weight`; a failed read is Unreadable in its
 * own card and the counts still show. Mark told is
 * `POST /api/cycles/grow/feedback/told`; Axal never messages a customer, and
 * Write email opens a draft in the founder's own mail.
 */
const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const EYEBROW = 'm-0 text-[11px] font-semibold uppercase tracking-wide text-axal-muted dark:text-gray-400';
const MUTED = 'text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-11 items-center rounded-md border border-axal-hairline px-3 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-8 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'inline-flex min-h-11 items-center rounded-md bg-axal-violet px-3 text-[12px] font-semibold text-white hover:bg-axal-violet-deep disabled:opacity-50 sm:min-h-8 dark:bg-violet-500 dark:hover:bg-violet-400';

export function CountsStrip({ counts }) {
  const c = countsStrip(counts);
  if (c.state !== 'ok') return <p role="status" className={`m-0 text-[12.5px] ${MUTED}`} data-testid="feedback-counts-unreadable">{c.line}</p>;
  return (
    <section aria-label="Feedback counts" data-testid="feedback-counts">
      <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
        {c.tiles.map((t) => (
          <li key={t.key} className={CARD}>
            <b className="block font-mono text-[20px] text-axal-ink dark:text-gray-100">{t.value}</b>
            <span className={`text-[12px] ${MUTED}`}>{t.label}</span>
          </li>
        ))}
      </ul>
      <p className={`m-0 mt-1 text-[11.5px] ${MUTED}`}>{c.period}</p>
    </section>
  );
}

export function WeightCard({ w }) {
  const rev = revenueLines(w.revenue);
  return (
    <div className="flex flex-col gap-3" data-testid="feedback-weight">
      <p className={EYEBROW}>Who asked · {w.theme}</p>
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">
        {peopleLine(w)} · {w.by_status?.open ?? 0} open · {w.by_status?.planned ?? 0} planned · {w.by_status?.shipped ?? 0} shipped
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
        {(w.people || []).map((p, i) => (
          <li key={i} className="flex flex-wrap gap-x-2">
            <b className="text-axal-ink dark:text-gray-100">{p.name || p.email || 'Unnamed'}</b>
            <span className={MUTED}>{p.company || 'No company named'}</span>
            <span className={MUTED}>{p.record ? `Linked · ${p.record.audience}` : 'Not linked'}</span>
          </li>
        ))}
      </ul>
      <div>
        <p className={EYEBROW}>Recurring revenue · last {w.revenue?.window_days ?? 60} days</p>
        {rev.amounts.length
          ? <p className="m-0 font-mono text-[15px] text-axal-ink dark:text-gray-100">{rev.amounts.join(' + ')}</p>
          : null}
        <p className={`m-0 text-[12px] ${MUTED}`}>{rev.line}</p>
        {(w.revenue?.not_recorded || []).length ? (
          <ul className={`m-0 mt-1 list-none p-0 text-[12px] ${MUTED}`} data-testid="feedback-weight-not-recorded">
            {w.revenue.not_recorded.map((n, i) => <li key={i}><span aria-hidden="true">○ </span>Not recorded · {n.name || 'Unnamed'}: {n.reason}</li>)}
          </ul>
        ) : null}
      </div>
      <div>
        <p className={EYEBROW}>Roadmap items</p>
        <p className={`m-0 text-[12.5px] ${MUTED}`}>{(w.roadmap_items || []).length ? w.roadmap_items.map((r) => r.label).join(' · ') : 'Not linked to a roadmap item'}</p>
      </div>
    </div>
  );
}

export function CloseTheLoop({ rows, onMark, initialPicked = [] }) {
  const [picked, setPicked] = useState(new Set(initialPicked));
  const [via, setVia] = useState('email');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const toggle = (uid) => setPicked((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const mark = async () => {
    setBusy(true); setError(''); setResult(null);
    try { const out = await onMark([...picked], via); setResult(out); setPicked(new Set()); }
    catch (e) { setError(e?.message || 'Mark told could not be saved. Nothing was changed. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2" data-testid="feedback-close-loop">
      <p className={EYEBROW}>Close the loop</p>
      <p className={`m-0 text-[12px] ${MUTED}`}>Axal never messages your customer. Mark told records that you told them; Write email opens a draft in your own mail.</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {list.map((r) => {
          const s = loopRow(r);
          return (
            <li key={r.uid} className="flex min-h-11 items-center gap-2 text-[12.5px] sm:min-h-8">
              {s.selectable
                ? <input type="checkbox" className="h-5 w-5" checked={picked.has(r.uid)} onChange={() => toggle(r.uid)} aria-label={`Choose ${r.name || 'this person'}`} />
                : <span className="inline-block h-5 w-5" aria-hidden="true" />}
              <b className="text-axal-ink dark:text-gray-100">{r.name || 'Unnamed'}</b>
              <span className={MUTED}>{s.word}{s.detail ? ` · ${s.detail}` : ''}</span>
            </li>
          );
        })}
      </ul>
      {onMark ? (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 bg-white py-2 dark:bg-gray-900">
          <label className="text-[12px] text-axal-ink dark:text-gray-100">How you told them{' '}
            <select value={via} onChange={(e) => setVia(e.target.value)} className="min-h-11 rounded-md border border-axal-hairline px-2 text-[12px] sm:min-h-8 dark:border-gray-700 dark:bg-gray-900">
              {TOLD_VIA.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </label>
          <button type="button" className={PRIMARY} disabled={busy || !picked.size} onClick={mark} data-testid="feedback-mark-told">
            {busy ? 'Saving…' : `Mark ${picked.size || ''} told`.replace('  ', ' ')}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300">{error}</p> : null}
      {result ? (
        <div role="status" className="text-[12px] text-axal-ink dark:text-gray-100" data-testid="feedback-told-result">
          {toldResult(result).map((l, i) => <p key={i} className="m-0">{l}</p>)}
          <ul className="m-0 mt-1 list-none p-0">
            {(result.told || []).filter((t) => t.mailto).map((t) => (
              <li key={t.uid}><a className="font-semibold text-axal-violet underline dark:text-violet-300" href={t.mailto}>Write email to {t.name || 'them'}</a></li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * D6865 part 2 (#6891): one theme's weight and Close the loop, read for the theme
 * chosen. The Feedback tab (`FeedbackTab.jsx`) draws it under the selected
 * theme's items; `FeedbackLoop` below draws it beside its own theme list.
 */
export function ThemeWeightPanel({ theme, projectId, api, reload }) {
  const [weight, setWeight] = useState({ state: 'idle' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!theme || !api?.feedbackWeight || !projectId) return undefined;
    let alive = true;
    setWeight({ state: 'loading' });
    api.feedbackWeight(projectId, theme)
      .then((w) => { if (alive) setWeight({ state: 'ok', w }); })
      .catch(() => { if (alive) setWeight({ state: 'unreadable' }); });
    return () => { alive = false; };
  }, [theme, projectId, api, tick]);
  return (
    <div className={CARD} data-testid="feedback-weight-panel">
      {weight.state === 'loading' || weight.state === 'idle' ? <p role="status" className={`m-0 text-[12.5px] ${MUTED}`}>Reading this theme…</p> : null}
      {weight.state === 'unreadable' ? (
        <div role="alert" data-testid="feedback-weight-unreadable">
          <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-100">Unreadable: this theme’s weight could not be read. This is not a claim that nobody asked.</p>
          <button type="button" className={`${BTN} mt-2`} onClick={() => setTick((n) => n + 1)}>Try again</button>
        </div>
      ) : null}
      {weight.state === 'ok' ? (
        <div className="flex flex-col gap-4">
          <WeightCard w={weight.w} />
          <CloseTheLoop key={`${theme}-${tick}`} rows={weight.w.loop}
            onMark={api?.feedbackTold ? (uids, via) => api.feedbackTold(projectId, uids, via).then((out) => { setTick((n) => n + 1); reload?.(); return out; }) : undefined} />
        </div>
      ) : null}
    </div>
  );
}

export default function FeedbackLoop({ counts, themes, projectId, api, reload }) {
  const ranked = rankThemes(themes);
  const [theme, setTheme] = useState(null);
  const current = theme ?? ranked[0]?.theme ?? null;

  return (
    <section className="flex flex-col gap-3" aria-label="Feedback" data-testid="feedback-loop">
      <CountsStrip counts={counts} />
      {ranked.length ? (
        <div className="grid gap-3 md:grid-cols-[240px_1fr]">
          <nav aria-label="Themes" className={CARD}>
            <p className={EYEBROW}>Themes · by items</p>
            <ul className="m-0 mt-2 flex list-none gap-1 overflow-x-auto p-0 md:flex-col">
              {ranked.map((t) => (
                <li key={t.theme}>
                  <button type="button" aria-current={t.theme === current ? 'true' : undefined}
                    className={`min-h-11 w-full whitespace-nowrap rounded-md px-2 text-left text-[12.5px] sm:min-h-8 ${t.theme === current ? 'bg-violet-50 font-semibold text-axal-violet dark:bg-violet-950 dark:text-violet-200' : 'text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800'}`}
                    onClick={() => setTheme(t.theme)}>
                    {t.theme} <span className={`font-mono text-[11px] ${MUTED}`}>{t.feedback}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <ThemeWeightPanel theme={current} projectId={projectId} api={api} reload={reload} />
        </div>
      ) : null}
    </section>
  );
}
