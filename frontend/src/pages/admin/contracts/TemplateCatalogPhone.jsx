import React, { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { contractsApi } from '../../../lib/api/contracts';
import { activeFilterCount, filterCatalog, layerSections, templateState } from '../../../lib/templateCatalogModel';
import { Thumbnail, useThumbnails } from './TemplateThumbnail';
import FilterSheet from './FilterSheet';
import TemplatePreviewPhone from './TemplatePreviewPhone';

// D717 (#1854) — the Templates tab below `md` (board L12, frames `p-list`,
// `p-sheet` and `p-preview`): the templates by layer, each row with its page-1
// thumbnail, its kind and its state; Filters in a bottom sheet; a row opens
// its saved pages read-only. Nothing here authors: every read is `requireAdmin`.

const ALL = { layer: 'all', state: 'all', kind: 'all' };

/** The row's state label (decision 5; the canvas's `STL`, `LEGAL:256`). */
export function phoneStateLabel(row) {
  const s = templateState(row);
  if (s.state === 'stub') return row?.counsel_draft ? 'Stub — counsel to draft' : 'Stub · no body in the store';
  if (s.state === 'has_body') return 'Has a body';
  return s.changesNotPublished ? `Published v${s.publishedVersion} · Changes not published` : `Published v${s.publishedVersion}`;
}

function Row({ row, thumbs, onOpen }) {
  const s = templateState(row);
  return (
    <button type="button" data-testid={`template-phone-row-${row.slug}`} onClick={onOpen}
      className="flex min-h-[52px] w-full items-center gap-[10px] border-b border-[#f0eff3] py-2 text-left dark:border-[#2a2733]">
      <Thumbnail compact width={32} height={42} thumbs={thumbs} version={row.version} stub={s.stub} title={row.title}
        load={() => contractsApi.thumbnailBlob(row.slug, row.version)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-bold text-[#18181b] dark:text-[#f4f3f7]">{row.title}</span>
        <span className="block truncate text-[12px] text-[#615c6e] dark:text-[#a29db0]">{`${row.kind} · ${phoneStateLabel(row)}`}</span>
      </span>
      <span aria-hidden="true" className="text-[#c9c6d2] dark:text-[#5d5869]">›</span>
    </button>
  );
}

export default function TemplateCatalogPhone({ items }) {
  const thumbs = useThumbnails();
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(ALL);
  const [sheet, setSheet] = useState(false);
  const filtersButton = useRef(null);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const sections = useMemo(() => layerSections(filterCatalog(items, { q, ...filters })), [items, q, filters]);
  const active = activeFilterCount(filters);
  const preview = params.get('preview');
  const previewRow = preview ? (items || []).find(r => r.slug === preview) : null;

  // Decision 9: a row is its own history entry, so the phone's Back closes it.
  const open = (slug) => {
    const next = new URLSearchParams(params);
    next.set('preview', slug);
    navigate({ search: `?${next}` }, { state: { templatesPreview: true } });
  };
  const close = () => {
    if (location.state?.templatesPreview) { navigate(-1); return; }
    const next = new URLSearchParams(params);
    next.delete('preview');
    setParams(next, { replace: true });
  };

  return (
    <div className="text-[#18181b] dark:text-[#f4f3f7]" data-testid="template-catalog-phone">
      <div className="sticky top-0 z-10 -mx-[18px] flex h-11 items-center justify-between border-b border-[#ececf1] bg-[#f8f8fa] px-[18px] text-[14px] font-bold dark:border-[#2a2733] dark:bg-[#0f0d17]">
        <span>Templates</span>
        <button ref={filtersButton} type="button" data-testid="template-filters" onClick={() => setSheet(true)}
          className="min-h-[44px] text-[#881337] dark:text-rose-300">{active ? `Filters · ${active}` : 'Filters'}</button>
      </div>
      <label className="mb-3 mt-3 block">
        <span className="sr-only">Search templates</span>
        <input type="search" enterKeyHint="search" autoComplete="off" placeholder="Search templates" value={q}
          onChange={e => setQ(e.target.value)}
          className="w-full rounded-xl border border-[#ececf1] bg-white px-[14px] py-3 text-[16px] dark:border-[#2a2733] dark:bg-[#18161f] dark:text-[#f4f3f7]" />
      </label>
      {sections.length === 0 && <p className="text-[13px] text-[#615c6e] dark:text-[#a29db0]">No template matches these filters.</p>}
      {sections.map(section => (
        <section key={section.layer} aria-label={section.label}>
          <div className="mb-1 mt-3 text-[10.5px] font-extrabold uppercase tracking-[.09em] text-[#7d7889] dark:text-[#a29db0]">{section.label}</div>
          {section.rows.map(row => <Row key={row.slug} row={row} thumbs={thumbs} onOpen={() => open(row.slug)} />)}
        </section>
      ))}
      {sheet && (
        <FilterSheet items={items} q={q} value={filters} opener={filtersButton}
          onApply={draft => { setFilters(draft); setSheet(false); }} onClose={() => setSheet(false)} />
      )}
      {preview && <TemplatePreviewPhone slug={preview} title={previewRow?.title || preview} onClose={close} />}
    </div>
  );
}
