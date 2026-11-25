import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Lightbox from '../../ui/Lightbox.jsx';
import { Unreadable } from '../../ui/Honesty.jsx';
import { CountsStrip, ThemeWeightPanel } from './FeedbackLoop.jsx';
import FeedbackSheet from './FeedbackSheet.jsx';
import {
  NO_THEME, SORTS, SOURCES, STATUSES, blankValues, feedbackRows, itemsFor, originWord, placementReview, placementsFrom,
  recordChip, splitLine, splitOf, tabState, themesOf,
} from './feedbackTabModel.js';

/**
 * D6865 part 2 (#6891) — Grow › Customers › Feedback, the tab body on
 * `/grow/product-improvement` (the #6099 canvas): the module's own page
 * (`defs/grow.jsx` `homes`, D6049), under the Customers tab row Pipeline ·
 * Accounts · Feedback (`growOverviewModel.js`).
 *
 *   - GR-21: the three counts; Source, Status and Sort; themes ranked by item
 *     count with their status split; the selected theme's items, each with who
 *     gave it, the linked-customer chip (or Not linked), its origin, status and
 *     roadmap item, opening the record view at its unchanged address. Then the
 *     theme's weight and Close the loop (D6865).
 *   - GR-21B: Add feedback, the page's one primary action, opens the sheet
 *     (`?add=feedback`, so the header's action and the empty state's open the
 *     same one).
 *   - GR-21C: Eadwyn's placements of unthemed items into themes already named,
 *     each opening the review, Use this theme or Discard. Writers only, and
 *     only while Eadwyn is on for this page.
 *   - GR-27: nothing recorded draws one primary action and the two quieter
 *     sources; items with no theme draw Themes as a measured 0.
 *   - GR-28: loading in the layout's shape; a failed read is Unreadable with
 *     Try again, never 0; an advisor (no `parts.themes`) sees the counts, the
 *     themes counted from the rows and the feedback, with names hidden.
 *   - GR-29A: below 768px the themes are a scrolling chip row and the items
 *     cards. GR-30: dark tokens throughout.
 */
const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const EYEBROW = 'm-0 text-[11px] font-semibold uppercase tracking-wide text-axal-muted dark:text-gray-400';
const MUTED = 'text-axal-muted dark:text-gray-400';
const SELECT = 'min-h-11 rounded-lg border border-axal-hairline bg-white px-2 text-[12.5px] text-axal-ink sm:min-h-9 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-9 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-axal-violet px-4 text-[13px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50 sm:min-h-10 dark:bg-violet-500 dark:hover:bg-violet-400';
const STATUS_TONE = {
  open: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  planned: 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
  shipped: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
};
const word = (list, v) => list.find(([k]) => k === v)?.[1] ?? null;
const day = (iso) => { const d = new Date(String(iso || '').replace(' ', 'T')); return Number.isNaN(d.getTime()) ? 'Date not recorded' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const withAdd = (search) => { const p = new URLSearchParams(search || ''); p.set('add', 'feedback'); return `/grow/product-improvement?${p}`; };

/** The header's one primary action: Add feedback, or none while nothing is recorded (the empty state carries it). */
export function addFeedbackAction(data, search) {
  if (data?.parts?.can_write === false || !Array.isArray(data?.parts?.themes)) return null;
  if (Number(data?.parts?.counts?.items) === 0) return null;
  return { label: 'Add feedback', href: withAdd(search) };
}

export function FeedbackRow({ f }) {
  const chip = recordChip(f.contact);
  const hidden = !Object.hasOwn(f, 'from_name');
  const who = hidden ? null : [f.from_name || 'No name recorded', f.from_company].filter(Boolean).join(' · ');
  return (
    <li className="flex flex-col gap-2 border-b border-axal-hairline px-4 py-3 last:border-b-0 md:flex-row md:items-start md:justify-between dark:border-gray-800" data-testid="feedback-row">
      <div className="flex min-w-0 flex-col gap-1.5">
        {f.href ? <Link to={f.href} className="text-[13.5px] font-semibold text-axal-ink hover:underline dark:text-gray-100">“{f.body}”</Link>
          : <p className="m-0 text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">“{f.body}”</p>}
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <b className="text-axal-ink dark:text-gray-200">{hidden ? <><span aria-hidden="true">🔒 </span>Name hidden</> : who}</b>
          {chip ? <span className={`rounded-full border px-2 py-0.5 ${chip.linked ? 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200' : 'border-dashed border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}
            title={chip.linked ? 'Linked customer record' : undefined} data-testid="feedback-row-record">{chip.text}</span> : null}
          <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-axal-ink dark:border-gray-700 dark:text-gray-300" title="Origin" data-testid="feedback-row-origin">{originWord(f.origin)}</span>
          <span className={`font-mono text-[11px] ${MUTED}`}>{word(SOURCES, f.source) || 'Source not recorded'} · {day(f.created_at)}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 md:flex-col md:items-end">
        <span className={`rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${STATUS_TONE[f.status] || 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}>{word(STATUSES, f.status) || 'Status not recorded'}</span>
        <span className={`text-[12px] ${MUTED}`}>{f.roadmap_item_label ? `↗ ${f.roadmap_item_label}` : 'No roadmap item'}</span>
      </div>
    </li>
  );
}

function Skeleton() {
  const bar = 'block h-3 animate-pulse rounded bg-axal-ground motion-reduce:animate-none dark:bg-gray-800';
  return (
    <div aria-busy="true" className="grid gap-3 md:grid-cols-[260px_minmax(0,1fr)]" data-testid="feedback-tab-loading">
      <span className="sr-only" role="status">Loading feedback</span>
      <div className={`${CARD} flex flex-col gap-2 p-4`}><i className={bar} /><i className={bar} /><i className={`${bar} w-2/3`} /></div>
      <div className={`${CARD} flex flex-col gap-3 p-4`}>{[0, 1, 2].map((k) => <div key={k} className="flex flex-col gap-1.5"><i className={`${bar} w-11/12`} /><i className={`${bar} w-1/2`} /></div>)}</div>
    </div>
  );
}

/** GR-27: nothing recorded yet. One primary action; the Inbox and interviews as two quieter ways in. */
export function EmptyFeedback({ search, canWrite }) {
  const q = (() => { const p = new URLSearchParams(search || ''); const id = p.get('project_id') || p.get('project'); return id ? `?project_id=${encodeURIComponent(id)}` : ''; })();
  return (
    <section className={`${CARD} flex flex-col items-start gap-3 p-5`} aria-labelledby="feedback-empty-h" data-testid="feedback-empty">
      <h2 id="feedback-empty-h" className="m-0 text-[16px] font-extrabold text-axal-ink dark:text-gray-100">No feedback recorded yet</h2>
      <p className={`m-0 max-w-[640px] text-[13px] leading-relaxed ${MUTED}`}>Feedback is what customers, investors and your team ask for. Group it into themes to see what keeps coming up, and tell people when it ships.</p>
      {canWrite ? <Link className={PRIMARY} to={withAdd(search)} data-testid="feedback-empty-add">Add feedback</Link> : null}
      {canWrite ? (
        <div className="grid w-full gap-2 sm:grid-cols-2">
          <Link to={`/grow/distribution/inbox${q}`} className="flex min-h-11 flex-col gap-0.5 rounded-lg border border-axal-hairline px-3 py-2 hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800">
            <b className="text-[13px] text-axal-ink dark:text-gray-100">Save replies from the Inbox</b><small className={MUTED}>Turn a customer’s reply into feedback in one step</small>
          </Link>
          <Link to={`/validate/customer-research${q}`} className="flex min-h-11 flex-col gap-0.5 rounded-lg border border-axal-hairline px-3 py-2 hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800">
            <b className="text-[13px] text-axal-ink dark:text-gray-100">Save notes from interviews</b><small className={MUTED}>From a Validate interview passage</small>
          </Link>
        </div>
      ) : null}
    </section>
  );
}

/** GR-21C: one placement's review, the GR-11 dialog. Use this theme writes the item's theme only. */
export function PlacementReview({ p, index, total, themes, onUse, onDiscard, onClose }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const r = placementReview(p, themes);
  const run = async (how, fn) => {
    setBusy(how); setError('');
    try { await fn(p.id); onClose(); } catch (e) { setError(e?.message || 'That could not be saved. Nothing was changed.'); } finally { setBusy(''); }
  };
  return (
    <Lightbox label="Review proposal: a theme for one feedback item" title="Review proposal: a theme for one feedback item"
      sub={`Eadwyn proposed · you decide · proposal ${index + 1} of ${total}`} onClose={onClose} width={620} phone="sheet" testId="feedback-placement-review"
      footer={<div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={BTN} disabled={!!busy} onClick={() => run('discard', onDiscard)}>{busy === 'discard' ? 'Discarding…' : 'Discard'}</button>
        <button type="button" className={PRIMARY} disabled={!!busy} onClick={() => run('use', onUse)} data-testid="feedback-placement-use">{busy === 'use' ? 'Saving…' : 'Use this theme'}</button>
      </div>}>
      <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
        <dt className={MUTED}>Feedback</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{r.feedback}</dd>
        <dt className={MUTED}>Placed in</dt><dd className="m-0 font-semibold text-axal-ink dark:text-gray-100">{r.placed}</dd>
        <dt className={MUTED}>Using it writes</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{r.writes}</dd>
      </dl>
      <p className={`mt-3 rounded-lg border border-axal-hairline bg-axal-ground p-3 text-[12.5px] dark:border-gray-700 dark:bg-gray-950 ${MUTED}`}>
        The placed theme can’t be edited here. To choose another, discard this and use <b>Change theme</b> on the item. Eadwyn never names a new theme.
      </p>
      {error ? <p role="alert" className="m-0 mt-2 text-[12.5px] text-red-700 dark:text-red-300">{error}</p> : null}
    </Lightbox>
  );
}

/** GR-21C: Eadwyn's pending placements into themes already named; another theme is held back, never offered. */
export function Placements({ projectId, themes, proposals, onApplied }) {
  const [read, setRead] = useState({ state: 'loading', list: [], held: 0 });
  const [open, setOpen] = useState(null);
  const load = useCallback(() => {
    let alive = true;
    proposals.list(projectId).then((r) => { if (alive) setRead({ state: 'ok', ...(() => { const x = placementsFrom(r?.proposals, themes); return { list: x.shown, held: x.held }; })() }); })
      .catch(() => { if (alive) setRead({ state: 'unreadable', list: [], held: 0 }); });
    return () => { alive = false; };
  }, [projectId, themes, proposals]);
  useEffect(() => load(), [load]);
  if (read.state === 'loading' || (read.state === 'ok' && !read.list.length && !read.held)) return null;
  const done = () => { setOpen(null); load(); onApplied?.(); };
  return (
    <section className={`${CARD} flex flex-col gap-2 p-4`} aria-labelledby="feedback-placements-h" data-testid="feedback-placements">
      <h2 id="feedback-placements-h" className="m-0 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">Eadwyn’s placements{read.list.length ? ` · ${read.list.length}` : ''}</h2>
      {read.state === 'unreadable' ? <p role="status" className={`m-0 text-[12.5px] ${MUTED}`}>Eadwyn’s placements could not be read. This is not a claim that there are none.</p> : (
        <>
          <p className={`m-0 text-[12.5px] ${MUTED}`}>Each places one item with no theme into a theme you already named. Nothing is written until you use one.</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {read.list.map((p, i) => (
              <li key={p.id} className="flex min-h-11 flex-wrap items-center gap-2 text-[12.5px]">
                <span className="min-w-0 flex-1 text-axal-ink dark:text-gray-100">“{p.payload.body}” <span className={MUTED}>→ {p.payload.theme}</span></span>
                <button type="button" className={BTN} onClick={() => setOpen(i)} data-testid="feedback-placement-open">Review</button>
              </li>
            ))}
          </ul>
          {read.held ? <p className={`m-0 text-[12px] ${MUTED}`}>{read.held === 1 ? '1 placement names' : `${read.held} placements name`} a theme you have not named, so it is not offered.</p> : null}
        </>
      )}
      {open != null && read.list[open] ? (
        <PlacementReview p={read.list[open]} index={open} total={read.list.length} themes={themes}
          onUse={(id) => proposals.accept(id).then(done)} onDiscard={(id) => proposals.discard(id).then(done)} onClose={() => setOpen(null)} />
      ) : null}
    </section>
  );
}

export default function FeedbackTab({
  data, records, status = 'ready', recordsStatus, rowHref, onRetry, projectId, reload, search = '', api, proposals = null, fillsOn = false, onExport,
}) {
  const [exporting, setExporting] = useState({ busy: false, error: '' });
  const [params, setParams] = useSearchParams();
  const rows = useMemo(() => feedbackRows(records, rowHref), [records, rowHref]);
  const writer = Array.isArray(data?.parts?.themes) && data?.parts?.can_write !== false;
  const themes = useMemo(() => themesOf(data?.parts?.themes, rows), [data, rows]);
  const state = tabState({ status, recordsStatus, counts: data?.parts?.counts, rows });
  const unthemed = rows.filter((r) => !String(r.theme || '').trim()).length;
  const [picked, setPicked] = useState(null);
  const [source, setSource] = useState('');
  const [statusF, setStatusF] = useState('');
  const [sort, setSort] = useState('newest');
  const [justSaved, setJustSaved] = useState(false);
  const [options, setOptions] = useState(null);
  const theme = picked && (picked === NO_THEME || themes.some((t) => t.theme === picked)) ? picked : themes[0]?.theme ?? (unthemed ? NO_THEME : null);
  const items = itemsFor(rows, { theme, source, status: statusF, sort });
  const themeRows = itemsFor(rows, { theme });
  const adding = params.get('add') === 'feedback' && !!projectId;

  useEffect(() => {
    if (!adding || !api?.formOptions) return undefined;
    let alive = true;
    setOptions(null);
    api.formOptions('grow', projectId, 'product-improvement').then((o) => { if (alive) setOptions(o || {}); }).catch(() => { if (alive) setOptions('unreadable'); });
    return () => { alive = false; };
  }, [adding, api, projectId]);
  const closeAdd = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('add'); return n; }, { replace: true });
  const itemHref = (uid) => `/grow/product-improvement/${encodeURIComponent(uid)}${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`;

  let body;
  if (state === 'loading') body = <Skeleton />;
  else if (state === 'unreadable') {
    body = (
      <div className={`${CARD} p-4`} data-testid="feedback-tab-unreadable">
        <Unreadable what="Feedback" claim="Pipeline and Accounts still work. Nothing is shown as 0." onRetry={onRetry} size="block" />
      </div>
    );
  } else if (state === 'empty') body = <EmptyFeedback search={search} canWrite={writer} />;
  else {
    body = (
      <>
        {justSaved ? (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12.5px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" data-testid="feedback-first-saved">
            <b>Added to Feedback · Open.</b>{state === 'unthemed' ? ' Give it a theme so similar feedback groups together.' : ''}
          </div>
        ) : null}
        <CountsStrip counts={data?.parts?.counts} />
        {state === 'unthemed' && data?.parts?.counts ? <p className={`m-0 text-[12px] ${MUTED}`} data-testid="feedback-themes-zero">Themes: 0, measured · {unthemed} {unthemed === 1 ? 'item has' : 'items have'} no theme</p> : null}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter and sort feedback">
          <label className="flex items-center gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Source
            <select className={SELECT} value={source} onChange={(e) => setSource(e.target.value)}><option value="">All</option>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className="flex items-center gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Status
            <select className={SELECT} value={statusF} onChange={(e) => setStatusF(e.target.value)}><option value="">All</option>{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <span className="hidden flex-1 sm:block" />
          {/* D6124: Export beside the list, where the Worker says this viewer may export it. */}
          {typeof onExport === 'function' ? (
            <button type="button" className={BTN} disabled={exporting.busy} onClick={async () => {
              setExporting({ busy: true, error: '' });
              try { await onExport(); setExporting({ busy: false, error: '' }); } catch (e) { setExporting({ busy: false, error: e?.message || 'The export could not be made.' }); }
            }}>{exporting.busy ? 'Exporting…' : 'Export'}</button>
          ) : null}
          <label className="flex items-center gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Sort
            <select className={SELECT} value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
        </div>
        {exporting.error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300">{exporting.error}</p> : null}
        <div className="grid min-w-0 gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Themes" className={`${CARD} min-w-0 p-3`} data-testid="feedback-themes">
            <p className={`${EYEBROW} px-1`}>Themes · by item count</p>
            {themes.length ? null : (
              <div className="px-1 pt-2" data-testid="feedback-themes-none">
                <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100"><span aria-hidden="true">0 </span>No themes yet</p>
                <p className={`m-0 mt-1 text-[12px] ${MUTED}`}>Name a theme on an item with Change theme. Eadwyn places later items only into themes you name.</p>
              </div>
            )}
            <ul className="m-0 mt-2 flex list-none gap-1.5 overflow-x-auto p-0 pb-1 md:flex-col md:overflow-visible md:pb-0">
              {themes.map((t) => {
                const on = t.theme === theme;
                const s = splitOf(rows.filter((r) => r.theme === t.theme));
                return (
                  <li key={t.theme} className="shrink-0 md:shrink">
                    <button type="button" aria-current={on ? 'true' : undefined} onClick={() => setPicked(t.theme)}
                      className={`flex min-h-11 w-full flex-col items-start rounded-lg border px-2.5 py-1.5 text-left md:border-transparent ${on ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/50' : 'border-axal-hairline hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800'}`}>
                      <span className={`whitespace-nowrap text-[12.5px] ${on ? 'font-bold text-axal-violet-deep dark:text-violet-200' : 'font-semibold text-axal-ink dark:text-gray-100'}`}>{t.theme} <span className={`font-mono text-[11px] ${MUTED}`}>{t.feedback}</span></span>
                      <span className={`hidden text-[11px] md:block ${MUTED}`}>{s.shipped && s.shipped === Number(t.feedback) ? `Shipped · all ${t.feedback}` : splitLine(s)}</span>
                    </button>
                  </li>
                );
              })}
              {unthemed ? (
                <li className="shrink-0 md:shrink">
                  <button type="button" aria-current={theme === NO_THEME ? 'true' : undefined} onClick={() => setPicked(NO_THEME)}
                    className={`flex min-h-11 w-full items-center rounded-lg border border-dashed px-2.5 text-left text-[12.5px] ${theme === NO_THEME ? 'border-violet-300 bg-violet-50 font-bold text-axal-violet-deep dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-200' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-200'}`}>
                    <span className="whitespace-nowrap">No theme yet · {unthemed}</span>
                  </button>
                </li>
              ) : null}
            </ul>
          </nav>
          <section className={`${CARD} min-w-0`} aria-labelledby="feedback-items-h" data-testid="feedback-items">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
              <h2 id="feedback-items-h" className="m-0 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">
                {theme === NO_THEME ? 'No theme yet' : theme || 'Feedback'} · {themeRows.length} {themeRows.length === 1 ? 'item' : 'items'}
              </h2>
              <span className={`text-[12px] ${MUTED}`}>{splitLine(splitOf(themeRows))}</span>
            </div>
            {items.length ? <ul className="m-0 list-none p-0">{items.map((f) => <FeedbackRow key={f.id} f={f} />)}</ul>
              : <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`}>None of this theme’s items match these filters.</p>}
          </section>
        </div>
        {writer && theme && theme !== NO_THEME ? <ThemeWeightPanel theme={theme} projectId={projectId} api={api?.grow} reload={reload} /> : null}
        {writer && fillsOn && proposals && projectId && themes.length ? <Placements projectId={projectId} themes={themes} proposals={proposals} onApplied={reload} /> : null}
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="feedback-tab" data-state={state}>
      {!writer && state !== 'loading' && state !== 'unreadable' ? (
        <p role="note" className="m-0 rounded-xl border border-axal-hairline bg-axal-ground px-4 py-3 text-[12.5px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200" data-testid="feedback-read-only">
          <b>You can read this venture’s feedback.</b> Who gave it, the Customer panel and Closing the loop are for the venture’s writers.
        </p>
      ) : null}
      {body}
      {adding ? (
        <FeedbackSheet key="add" title="Add feedback" from="Writes one item to Feedback" initial={blankValues()} origin="typed" options={options}
          onSave={(b) => api.grow.feedback(projectId, b)} onClose={closeAdd} itemHref={itemHref}
          onSaved={() => { setJustSaved(true); reload?.(); }} testId="feedback-add" />
      ) : null}
    </div>
  );
}
