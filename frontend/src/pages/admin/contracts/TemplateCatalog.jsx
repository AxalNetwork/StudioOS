import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pill } from '../../../ui';
import { contractsApi } from '../../../lib/api/contracts';
import { AXAL_ENTITIES } from '../../../lib/legalDocFormat';
import { LAYER_ORDER, STATE_FILTERS, templateState, filterCatalog, layerSections, stateCounts } from '../../../lib/templateCatalogModel';
import { createThumbnailQueue } from '../../../lib/thumbnailQueue';
import { reportError } from '../../../lib/log';
import { card, button, input } from './parts';
import FundIDocumentsPanel from './FundIDocumentsPanel';
import PushResults from './PushResults';

// D717 (#1851) — the Templates tab's catalog (board L9, "Catalog · light" and
// "Catalog · dark (the paper stays white)"; board L8's thumbnail and "Not in
// the catalog" rules). The rows are the Worker's (`templates/store?recorded=
// true`); the layout and copy are the canvas's (D717 decision 1).
//
// `authoring` is false on a branch Worker (decision 11): the cards still open,
// and every control that writes is left out. The Worker refuses them anyway.

// Mirror of TEMPLATE_LAYERS in cloudflare-worker/src/routes/admin_contracts.ts
// (AdminTemplates.jsx's CATEGORY_META).
const LAYER_LABEL = {
  gp: 'Internal Management (GP Level)',
  fund: 'Fund Formation (LP Level)',
  portfolio: 'Investment Execution (Portfolio Level)',
  compliance: 'Compliance & Regulatory',
};
const FILTER_LABEL = { all: 'All', has_body: 'Has a body', stub: 'Stub', unpublished: 'Unpublished', published: 'Published' };
// The canvas's party lines (`LEGAL:255`). The entity names are never retyped.
const PARTY_LINE = {
  management: AXAL_ENTITIES.management.name,
  gp: AXAL_ENTITIES.gp.name,
  holdings: AXAL_ENTITIES.holdings.name,
  fund: `${AXAL_ENTITIES.gp.name} (for the Fund)`,
  none: { policy: 'publisher only, no signatures', corporate: 'none (the company signs)', other: 'none (the filer signs)' },
};
const THUMB_NOT_DRAWN = 'Thumbnail not drawn: the page renderer did not answer.';
const SECTION_PREVIEW = 4;
const rose = 'bg-[#881337] text-white border-[#881337] dark:bg-[#881337] dark:text-white';
const link = 'text-xs font-bold text-[#881337] dark:text-rose-300';

export function partyLine(row) {
  if (row?.party && row.party !== 'none') return PARTY_LINE[row.party] || row.party;
  return PARTY_LINE.none[row?.kind] || PARTY_LINE.none.other;
}

function editedTitle(row) {
  if (row.updated_by == null) return 'Not recorded: imported before editors were recorded.';
  const d = row.updated_at ? new Date(row.updated_at) : null;
  const when = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not recorded';
  return `Last edited ${when} · Admin #${row.updated_by}`;
}

// One IntersectionObserver and one queue of four for the whole tab (decision
// 5). Without IntersectionObserver (the test DOM), each thumbnail starts on
// mount, still four at a time.
function useThumbnails() {
  return useMemo(() => {
    const queue = createThumbnailQueue(4);
    const watchers = new Map();
    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => {
        for (const e of entries) if (e.isIntersecting && watchers.has(e.target)) { const go = watchers.get(e.target); watchers.delete(e.target); io.unobserve(e.target); go(); }
      }, { rootMargin: '200px' })
      : null;
    return {
      queue,
      watch(el, go) {
        if (!io || !el) { go(); return () => {}; }
        watchers.set(el, go); io.observe(el);
        return () => { watchers.delete(el); io.unobserve(el); };
      },
    };
  }, []);
}

let thumbSeq = 0;
function Thumbnail({ thumbs, load, version, stub, title }) {
  const frame = useRef(null);
  const [state, setState] = useState({ url: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const shown = useRef(null);
  useEffect(() => {
    let active = true;
    const key = `thumb-${thumbSeq += 1}`;
    const stop = thumbs.watch(frame.current, () => {
      thumbs.queue.enqueue(key, load).then(({ url }) => {
        if (!active) { try { URL.revokeObjectURL(url); } catch { /* not a blob URL */ } return; }
        if (shown.current) try { URL.revokeObjectURL(shown.current); } catch { /* not a blob URL */ }
        shown.current = url;
        setState({ url, error: null });
      }, e => {
        if (!active) return;
        reportError('TemplateCatalog:thumbnail', e);
        setState(s => ({ ...s, error: e?.code ? e.message : THUMB_NOT_DRAWN }));
      });
    });
    return () => { active = false; stop(); thumbs.queue.cancel(key); };
  // `load` is rebuilt each render; the thumbnail it draws is named by `version`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbs, version, attempt]);
  useEffect(() => () => { if (shown.current) try { URL.revokeObjectURL(shown.current); } catch { /* not a blob URL */ } }, []);
  return <div ref={frame} className={`h-[90px] w-[70px] flex-none overflow-hidden rounded-[3px] border bg-white ${stub ? 'border-dashed border-[#c9c6d2]' : 'border-solid border-[#e3e1ea]'}`}>{/* dark-mode-exempt: the paper stays white (frame "Catalog · dark") */}
    {state.error
      ? <div role="alert" className="flex h-full flex-col justify-between p-1 text-[8.5px] leading-[10px] text-[#615c6e]">
        <span>{state.error}</span>
        <button type="button" className="self-start rounded border border-[#e3e1ea] px-1 text-[9px] font-bold text-[#881337]" onClick={() => { setState(s => ({ ...s, error: null })); setAttempt(n => n + 1); }}>Retry</button>
      </div>
      : state.url && <img src={state.url} alt={`Page 1 of ${title}`} className="h-full w-full object-cover object-top" />}
  </div>;
}

function TemplateCard({ row, authoring, thumbs, onOpen, onOpenUsage }) {
  const s = templateState(row);
  const uses = <Pill tone="info">{row.usage_count ?? 0} uses</Pill>;
  return <div data-testid={`template-tile-${row.slug}`} className={`${card} flex gap-2.5 p-2.5 dark:border-[#2a2733] dark:bg-[#18161f]`}>
    <Thumbnail thumbs={thumbs} version={row.version} stub={s.stub} title={row.title} load={() => contractsApi.thumbnailBlob(row.slug, row.version)} />
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <button type="button" data-testid={`template-card-${row.slug}`} className="line-clamp-2 text-left text-[12.5px] font-bold leading-[1.3]" onClick={() => onOpen(row.slug)}>{row.title}</button>
      <p className="text-[11px] leading-[1.3] text-axal-muted dark:text-[#a29db0]">{row.kind} · {partyLine(row)}{row.format_source === 'slug' ? ' · from the slug' : ''}</p>
      {s.stub ? <>
        <p className="text-[11px] text-axal-muted dark:text-[#a29db0]" title={editedTitle(row)}>No body in the store yet.</p>
        {row.counsel_draft && <p className="text-[11px] font-semibold text-axal-amber-deep dark:text-amber-300">Stub — counsel to draft.</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          {authoring && <button type="button" className={`${button} bg-white dark:bg-gray-900`} onClick={() => onOpen(row.slug, { focus: 'body' })}>Add body</button>}
          {uses}
          {s.publishedVersion != null && <Pill tone="ok">Published v{s.publishedVersion}</Pill>}
        </div>
      </> : <div className="flex flex-wrap gap-1.5">
        <span title={editedTitle(row)}><Pill tone="neutral">v{row.version}</Pill></span>
        <button type="button" onClick={() => onOpenUsage?.(row.slug, row)}>{uses}</button>
        {s.publishedVersion != null ? <Pill tone="ok">Published v{s.publishedVersion}</Pill> : <Pill tone="ok">Has a body</Pill>}
        {s.changesNotPublished && <Pill tone="warn">Changes not published</Pill>}
      </div>}
    </div>
  </div>;
}

// Board L8 (D717 decision 6): the bundled documents a send still uses that the
// catalog does not list. A cross-reference, never the list: while pending,
// unreadable or empty it draws nothing.
function OutsideGroup({ thumbs }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let active = true;
    contractsApi.outside().then(r => { if (active) setItems(Array.isArray(r?.items) ? r.items : []); },
      e => reportError('TemplateCatalog:outside', e));
    return () => { active = false; };
  }, []);
  if (!items?.length) return null;
  return <section data-testid="outside-group">
    <h3 className="mb-2 text-sm font-extrabold">Not in the catalog <span className="font-medium text-axal-muted dark:text-[#a29db0]">· {items.length}</span></h3>
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
      {items.map(o => <div key={o.key} className={`${card} flex gap-2.5 p-2.5 dark:border-[#2a2733] dark:bg-[#18161f]`}>
        <Thumbnail thumbs={thumbs} version={o.key} stub={false} title={o.title} load={() => contractsApi.outsideThumbnailBlob(o.key)} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="line-clamp-2 text-[12.5px] font-bold leading-[1.3]">{o.title}</p>
          <span><Pill tone="info">Not in the catalog</Pill></span>
          <p className="text-[11px] text-axal-muted dark:text-[#a29db0]">Counted under {o.counted_under?.title || o.counted_under?.slug}</p>
        </div>
      </div>)}
    </div>
  </section>;
}

export default function TemplateCatalog({ items, authoring, onOpen, onNew, onOpenUsage, toolbarExtra }) {
  const thumbs = useThumbnails();
  const [q, setQ] = useState('');
  const [layer, setLayer] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [push, setPush] = useState({ running: false, result: null, error: '' });

  // Decision 2: each segment counts what passes search and layer; each header
  // counts what passes all three.
  const counts = useMemo(() => stateCounts(filterCatalog(items, { q, layer })), [items, q, layer]);
  const sections = useMemo(() => layerSections(filterCatalog(items, { q, layer, state: stateFilter })), [items, q, layer, stateFilter]);

  const runPush = async () => {
    if (push.running) return;
    setPush(p => ({ ...p, running: true, error: '' }));
    try { setPush({ running: false, result: await contractsApi.push(), error: '' }); }
    catch (e) {
      reportError('TemplateCatalog:push', e);
      setPush({ running: false, result: null, error: e?.message || 'The push could not be sent. Nothing in the library changed.' });
    }
  };

  return <div className="space-y-3.5">
    <div className="flex flex-wrap items-center gap-2">
      <label className="min-w-[240px] flex-1">
        <span className="sr-only">Search templates</span>
        <input className={`${input} dark:border-[#2a2733]`} placeholder="Search templates" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <label>
        <span className="sr-only">Layer</span>
        <select className={`${input} w-auto font-semibold dark:border-[#2a2733]`} value={layer} onChange={e => setLayer(e.target.value)}>
          <option value="all">Layer · All</option>
          {LAYER_ORDER.map(id => <option key={id} value={id}>Layer · {LAYER_LABEL[id]}</option>)}
        </select>
      </label>
      <div role="group" aria-label="State" className={`${card} flex p-[3px] dark:border-[#2a2733] dark:bg-[#18161f]`}>
        {STATE_FILTERS.map(f => <button key={f} type="button" aria-pressed={stateFilter === f} onClick={() => setStateFilter(f)}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${stateFilter === f ? rose : 'text-axal-muted dark:text-[#a29db0]'}`}>
          {`${FILTER_LABEL[f]} · ${f === 'published' && counts.published === 0 ? 'none yet' : counts[f]}`}
        </button>)}
      </div>
      {authoring && toolbarExtra}
      {authoring && <button type="button" className={`${button} bg-white dark:bg-gray-900`} disabled={push.running} onClick={runPush}>{push.running ? 'Pushing…' : 'Push to branches'}</button>}
      {authoring && <button type="button" data-testid="template-new" className={`${button} ${rose}`} onClick={onNew}>New template</button>}
    </div>

    <PushResults result={push.result} error={push.error} running={push.running} onRetry={runPush} />

    <FundIDocumentsPanel items={items} authoring={authoring} onOpen={onOpen} />

    {sections.length ? sections.map(section => {
      const open = layer === section.layer;
      return <section key={section.layer} data-testid={`layer-${section.layer}`}>
        <div className="mb-2 flex justify-between">
          <h3 className="text-sm font-extrabold">{section.label} <span className="font-medium text-axal-muted dark:text-[#a29db0]">· {section.count}</span></h3>
          {!open && section.count > SECTION_PREVIEW && <button type="button" className={link} onClick={() => setLayer(section.layer)}>Show all {section.count} →</button>}
        </div>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          {(open ? section.rows : section.rows.slice(0, SECTION_PREVIEW)).map(row =>
            <TemplateCard key={row.slug} row={row} authoring={authoring} thumbs={thumbs} onOpen={onOpen} onOpenUsage={onOpenUsage} />)}
        </div>
      </section>;
    }) : <p className="p-4 text-sm">No template matches these filters.</p>}

    <OutsideGroup thumbs={thumbs} />
  </div>;
}
