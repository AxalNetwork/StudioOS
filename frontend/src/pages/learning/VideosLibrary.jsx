/** D4477 LR7: the recorded video library, filters and first transcript match, drawn from catalog props. */
import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Play, Search } from 'lucide-react';
import { Card, Pill, Unrecorded } from '../../ui';
import { clockLabel } from './learningModel';
import { itemHrefAt, transcriptHit, VIDEO_LENGTH_OPTIONS, videoCountLabel } from './videoLibraryModel';
import { LearningEmpty, LearningLoading, LearningUnreadable, RouteUnreadable } from './LearningStates';

const CONTROL = 'min-h-11 max-w-full rounded-full border px-3 text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet';
const BUTTON = 'inline-flex min-h-11 items-center justify-center gap-1 rounded-axal-sm border border-axal-hairline px-3 text-[13px] font-semibold text-axal-ink disabled:opacity-40 dark:border-gray-700 dark:text-gray-100';

function Filter({ label, value, options, onChange }) {
  return <label className="min-w-0">
    <span className="sr-only">{label}</span>
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={`${CONTROL} ${value ? 'border-axal-violet bg-violet-50 text-axal-violet-deep dark:border-violet-400 dark:bg-violet-950 dark:text-violet-300' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>
      {options.map((option) => <option key={option.value} value={option.value}>{label}: {option.label}</option>)}
    </select>
  </label>;
}

export default function VideosLibrary({ state, filters = {}, optionRows = [], total = null, onFilter = () => {}, onPage, onRetry, Preview, search = null }) {
  const rows = state.status === 'ready' ? state.rows || [] : [];
  const values = (key) => [...new Set([...optionRows, ...rows].map(r => r[key]).filter(Boolean).concat(filters[key] || []))].sort();
  const topics = [{ value: '', label: 'any' }, ...values('topic').map(v => ({ value: v, label: v }))];
  const levels = [{ value: '', label: 'any' }, ...values('level').map(v => ({ value: v.toLowerCase(), label: v }))].filter((v, i, all) => all.findIndex(x => x.value === v.value) === i);
  const lengths = VIDEO_LENGTH_OPTIONS.map(v => ({ value: v.minutes == null ? '' : String(v.minutes), label: v.label }));
  if (filters.max && !lengths.some(v => v.value === filters.max)) lengths.push({ value: filters.max, label: `up to ${filters.max} min` });
  const hitRow = rows.find(r => r.match?.in === 'transcript');
  const hit = transcriptHit(hitRow);
  const hitHref = hit?.seconds == null ? null : itemHrefAt(hitRow, hit.seconds);
  const own = state.sources?.video;
  return <section className="min-w-0 space-y-4" aria-label="Videos library" data-testid="list-catalog-video" data-view="videos-library">
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="video-filters">
      {search ? <div className="w-full lg:w-72">{search}</div> : null}
      <Filter label="Topic" value={filters.topic || ''} options={topics} onChange={v => onFilter('topic', v)} />
      <Filter label="Level" value={filters.level || ''} options={levels} onChange={v => onFilter('level', v)} />
      <Filter label="Length" value={filters.max || ''} options={lengths} onChange={v => onFilter('max', v)} />
      {state.status === 'ready' && !state.refusal && own?.status !== 'unreadable' ? <span className="tabular-nums text-xs text-axal-muted lg:ml-auto dark:text-gray-400" data-testid="video-count">{videoCountLabel(rows.length, total)}</span> : null}
    </div>
    {state.refusal ? <RouteUnreadable reason={state.refusal} onRetry={onRetry} /> : state.status === 'loading' || state.status === 'idle' ? <LearningLoading rows={3} what="the videos" /> : state.status !== 'ready' ? <LearningUnreadable what="The video library" onRetry={onRetry} /> : <>
      {own?.status === 'unreadable' ? <RouteUnreadable reason={own.reason} onRetry={onRetry} /> : null}
      {hit ? <aside className="flex min-w-0 flex-col gap-3 rounded-axal-md border border-violet-200 bg-violet-50 p-3 lg:flex-row lg:items-start dark:border-violet-800 dark:bg-violet-950" data-testid="video-transcript-hit">
        <Search size={18} aria-hidden="true" className="shrink-0 text-axal-violet dark:text-violet-300" />
        <div className="min-w-0 flex-1 break-words text-[13px] text-axal-ink dark:text-gray-100">
          <p className="font-semibold text-axal-violet-deep dark:text-violet-300">Found in a transcript · {hit.title}{hitHref ? <> · in transcript at <Link className="tabular-nums underline" to={hitHref}>{hit.at}</Link></> : ' · Time not recorded'}</p>
          <p className="mt-1">“{hit.before}{hit.match ? <mark className="rounded bg-amber-100 text-axal-ink dark:bg-amber-900 dark:text-gray-100">{hit.match}</mark> : null}{hit.after}”</p>
        </div>
        {hitHref ? <Link to={hitHref} className={`${BUTTON} shrink-0 self-start bg-white dark:bg-gray-900`}>Open at {hit.at}</Link> : null}
      </aside> : null}
      {!rows.length && own?.status !== 'unreadable' ? <LearningEmpty title="No videos match these filters" body="Try another word or change the filters." /> : null}
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3" data-testid="video-grid">
        {rows.map(row => <Card as="article" tabIndex={0} key={row.key} padding="sm" className="relative flex min-w-0 flex-col gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-axal-violet" data-testid="catalog-row-video">
          <div className="relative aspect-video overflow-hidden rounded-axal-sm bg-gray-100 dark:bg-gray-800">
            {row.poster ? <img src={row.poster} alt="" className="h-full w-full object-cover" /> : <Play aria-hidden="true" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-axal-violet dark:text-violet-300" size={36} />}
            <span className="absolute bottom-2 right-2 rounded bg-gray-900 px-2 py-1 tabular-nums text-[11px] text-gray-100">{clockLabel(row.seconds) || 'Length not recorded'}</span>
          </div>
          {Preview && row.uid ? <Preview uid={row.uid} library /> : null}
          {row.href ? <Link to={row.href} className="min-h-11 break-words text-[14px] font-semibold text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300">{row.title}</Link> : <span>{row.title}</span>}
          <div className="flex flex-wrap items-center gap-2 text-xs text-axal-muted dark:text-gray-400"><span>{row.topic || <Unrecorded>Topic not recorded</Unrecorded>}</span><Pill tone="neutral">{row.level || 'Level not recorded'}</Pill>{row.draft ? <Pill tone="warn">{row.draft}</Pill> : null}</div>
        </Card>)}
      </div>
      {onPage && rows.length ? <div className="flex flex-wrap justify-end gap-2"><button type="button" className={BUTTON} disabled={!state.offset} onClick={() => onPage(-1)}><ChevronLeft size={16} />Previous</button><button type="button" className={BUTTON} disabled={typeof own?.total !== 'number' || (state.offset || 0) + rows.length >= own.total} onClick={() => onPage(1)}>Next<ChevronRight size={16} /></button></div> : null}
    </>}
  </section>;
}
