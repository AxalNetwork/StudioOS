import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, Pill, RailFrame, Skeleton, Unrecorded, Unreadable, WorkerRail } from '../../ui';
import {
  EMPTY_RESOURCE, LIBRARY_SORTS, RESOURCE_CATEGORIES, countLabel, filterResources, formatDate,
  libraryCoverage, pageOf, resourceBody, resourceFacts, resourceKind, safeHref,
} from './wellbeingModel';
import { BTN, FIELD, PageHeader, CardHead, NotRecorded, Outcome } from './WellbeingParts';

/**
 * /admin/wellbeing/resources — the resource library (canvas `wba-library`, D570).
 *
 * The list members read under Wellbeing, with publish and delete. It reads
 * `GET /api/wellbeing/resources` (every row, any signed-in user) and writes
 * `POST /resources` and `DELETE /resources/:id`, both behind `requireAdmin`
 * (and, for a publish, the branch-suspension gate, D142/D303).
 *
 * WHAT THE CANVAS DREW THAT THE LIBRARY DOES NOT STORE. A resource is a
 * category (one of five), a title, a description, a link, a region, two flags
 * and a sort order, plus the date it was added. So:
 *   - "Kind" is the route's category; the canvas's article / audio / video /
 *     link set does not exist.
 *   - Topic is not stored: its column reads "Not recorded", with the reason.
 *   - There is no draft state. Every saved resource is listed to members at
 *     once, so every row is Published and the editor has no "Save draft".
 *   - Nothing is ever edited, so the date is the one it was added.
 *   - A source is a link; nothing can be uploaded.
 */

const TOPIC_GAP = 'The library stores no topic.';
const PAGE_SIZE = 25;

export function LibraryToolbar({ q, category, sort, onChange, count }) {
  return (
    <Card className="space-y-2.5" data-testid="toolbar-library">
      <label className="relative block">
        <span className="sr-only">Search resources</span>
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-axal-faint" aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => onChange?.({ q: e.target.value })} placeholder="Search resources…" className={`${FIELD.input} pl-9`} data-testid="input-library-search" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Kind" value={category} onChange={(e) => onChange?.({ category: e.target.value })} className={`${FIELD.input} sm:w-auto`}>
          <option value="">Any kind</option>
          {RESOURCE_CATEGORIES.map((c) => <option key={c} value={c}>{resourceKind(c)}</option>)}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => onChange?.({ sort: e.target.value })} className={`${FIELD.input} sm:w-auto`}>
          {Object.entries(LIBRARY_SORTS).map(([key, label]) => <option key={key} value={key}>Sort: {label}</option>)}
        </select>
        <span className="ml-auto text-xs tabular-nums text-axal-muted dark:text-gray-400" data-testid="text-library-count">{count}</span>
      </div>
    </Card>
  );
}

/**
 * The canvas's table — kind, title, topic, state, date, delete — when its card
 * is wide enough to hold six columns (42rem), and one stacked row per resource
 * when it is not. Keyed to the CARD's width (a container query), not the
 * viewport's: beside the editor on a laptop, under the app's sidebar and the
 * rail, the card is far narrower than the screen.
 */
const TABLE_COLS = '@2xl:grid-cols-[6rem_minmax(0,2fr)_minmax(0,1fr)_5.5rem_6.5rem_4.5rem]';

export function ResourceTable({ rows = [], confirmingId = null, busyId = null, onAskDelete, onConfirmDelete, onCancelDelete }) {
  return (
    <div className="@container" data-testid="table-library">
      <div className={`hidden gap-3 border-b border-axal-hairline pb-2 text-[10px] font-extrabold uppercase tracking-axal-label text-axal-muted @2xl:grid ${TABLE_COLS} dark:border-gray-700 dark:text-gray-400`}>
        <span>Kind</span><span>Title</span><span>Topic</span><span>State</span><span>Added</span><span />
      </div>
      <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
        {rows.map((r) => {
          const href = safeHref(r.url);
          const facts = resourceFacts(r);
          const added = formatDate(r.created_at) || <Unrecorded reason="The row carries no date.">Not recorded</Unrecorded>;
          return (
            <li key={r.id} className="py-2.5" data-testid={`resource-${r.id}`}>
              <div className={`grid grid-cols-[6rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 ${TABLE_COLS} @2xl:items-center`}>
                <span><Pill tone={r.category === 'hotline' ? 'warn' : 'neutral'}>{resourceKind(r.category)}</Pill></span>
                <span className="min-w-0">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100">{r.name}</a>
                  ) : (
                    <span className="block truncate text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.name}</span>
                  )}
                  {facts.length > 0 && <span className="block text-xs text-axal-muted dark:text-gray-400">{facts.join(' · ')}</span>}
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-axal-muted @2xl:hidden dark:text-gray-400">
                    <span>Topic: <Unrecorded reason={TOPIC_GAP}>not recorded</Unrecorded></span>
                    <Pill tone="ok">Published</Pill>
                    <span className="tabular-nums">Added {added}</span>
                  </span>
                </span>
                <span className="hidden text-xs @2xl:block"><Unrecorded reason={TOPIC_GAP}>Not recorded</Unrecorded></span>
                <span className="hidden @2xl:block"><Pill tone="ok">Published</Pill></span>
                <span className="hidden text-xs tabular-nums text-axal-muted @2xl:block dark:text-gray-400">{added}</span>
                <span className="text-right">
                  <button type="button" className={BTN.dangerLink} onClick={() => onAskDelete?.(r)} disabled={busyId === r.id} aria-label={`Delete ${r.name}`}>
                    <Trash2 size={13} aria-hidden="true" /> Delete
                  </button>
                </span>
              </div>
              {confirmingId === r.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-axal-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alertdialog" aria-label="Confirm delete" data-testid={`confirm-delete-resource-${r.id}`}>
                  <span>Delete “{r.name}”? Members stop seeing it at once. This cannot be undone.</span>
                  <button type="button" className={BTN.danger} onClick={() => onConfirmDelete?.(r)} disabled={busyId === r.id}>
                    {busyId === r.id ? 'Deleting…' : 'Delete resource'}
                  </button>
                  <button type="button" className={BTN.ghost} onClick={onCancelDelete} disabled={busyId === r.id}>Keep</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-axal-muted dark:text-gray-400">
        {TOPIC_GAP} Every saved resource is listed to members, so each one is published; there are no drafts, and a resource is never edited, so its date is the day it was added.
      </p>
    </div>
  );
}

export function ResourceEditor({ draft, fields = {}, busy = false, error, ok, onChange, onPublish, titleRef }) {
  const set = (key, value) => onChange?.({ ...draft, [key]: value });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => { e.preventDefault(); onPublish?.(); }}
      data-testid="form-new-resource"
    >
      <div>
        <label className={FIELD.label} htmlFor="res-title">Title</label>
        <input id="res-title" ref={titleRef} className={FIELD.input} value={draft.name} onChange={(e) => set('name', e.target.value)} />
        {fields.name && <p role="alert" className={FIELD.error}>{fields.name}</p>}
      </div>
      <div>
        <label className={FIELD.label} htmlFor="res-kind">Kind</label>
        <select id="res-kind" className={FIELD.input} value={draft.category} onChange={(e) => set('category', e.target.value)}>
          <option value="">Choose a kind</option>
          {RESOURCE_CATEGORIES.map((c) => <option key={c} value={c}>{resourceKind(c)}</option>)}
        </select>
        {fields.category && <p role="alert" className={FIELD.error}>{fields.category}</p>}
      </div>
      <div>
        <span className={FIELD.label}>Topic</span>
        <NotRecorded reason={TOPIC_GAP} />
      </div>
      <div>
        <label className={FIELD.label} htmlFor="res-url">Source link</label>
        <input id="res-url" className={FIELD.input} inputMode="url" placeholder="https://…" value={draft.url} onChange={(e) => set('url', e.target.value)} />
        {fields.url ? <p role="alert" className={FIELD.error}>{fields.url}</p> : <p className={`${FIELD.note} mt-1`}>A link only: nothing can be uploaded.</p>}
      </div>
      <div>
        <label className={FIELD.label} htmlFor="res-description">Description (optional)</label>
        <textarea id="res-description" rows={3} className={FIELD.input} value={draft.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={FIELD.label} htmlFor="res-region">Region (optional)</label>
          <input id="res-region" className={FIELD.input} placeholder="us, uk, global…" value={draft.region} onChange={(e) => set('region', e.target.value)} />
        </div>
        <div>
          <label className={FIELD.label} htmlFor="res-order">Order</label>
          <input id="res-order" className={FIELD.input} inputMode="numeric" value={draft.sort_order} onChange={(e) => set('sort_order', e.target.value)} />
          {fields.sort_order && <p role="alert" className={FIELD.error}>{fields.sort_order}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-[13px] text-axal-ink dark:text-gray-100">
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={draft.is_24_7} onChange={(e) => set('is_24_7', e.target.checked)} /> Open 24/7</label>
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={draft.is_free} onChange={(e) => set('is_free', e.target.checked)} /> Free</label>
      </div>
      <p className={FIELD.note}>Publishing lists it to every member at once. There is no draft to save first.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={BTN.primary} disabled={busy} data-testid="button-publish-resource">{busy ? 'Publishing…' : 'Publish'}</button>
        <Outcome ok={ok} error={error} testId="publish" />
      </div>
    </form>
  );
}

export default function WellbeingResourceLibrary() {
  const [library, setLibrary] = useState({ status: 'loading', rows: [] });
  const [view, setView] = useState({ q: '', category: '', sort: 'order', page: 1 });
  const [draft, setDraft] = useState(EMPTY_RESOURCE);
  const [publish, setPublish] = useState({ busy: false, error: null, ok: null, fields: {} });
  const [removal, setRemoval] = useState({ confirmingId: null, busyId: null, error: null, ok: null });
  const titleRef = useRef(null);

  const load = useCallback(async () => {
    setLibrary((l) => ({ ...l, status: 'loading' }));
    try {
      const r = await api.wellbeingResources();
      setLibrary({ status: 'ready', rows: Array.isArray(r?.resources) ? r.resources : [] });
    } catch {
      setLibrary({ status: 'unreadable', rows: [] });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => filterResources(library.rows, view), [library.rows, view]);
  const page = pageOf(filtered, view.page, PAGE_SIZE);

  const changeView = (patch) => setView((v) => ({ ...v, ...patch, page: patch.page ?? 1 }));

  const publishNow = async () => {
    const parsed = resourceBody(draft);
    if (!parsed.ok) { setPublish({ busy: false, error: null, ok: null, fields: parsed.fields }); return; }
    setPublish({ busy: true, error: null, ok: null, fields: {} });
    try {
      const row = await api.wellbeingResourceCreate(parsed.body);
      setPublish({ busy: false, error: null, ok: `Published “${row?.name || parsed.body.name}”.`, fields: {} });
      setDraft(EMPTY_RESOURCE);
      await load();
    } catch (e) {
      setPublish({ busy: false, error: e?.message || 'The resource could not be published.', ok: null, fields: {} });
    }
  };

  const confirmDelete = async (row) => {
    setRemoval({ confirmingId: row.id, busyId: row.id, error: null, ok: null });
    try {
      await api.wellbeingResourceDelete(row.id);
      setRemoval({ confirmingId: null, busyId: null, error: null, ok: `Deleted “${row.name}”.` });
      await load();
    } catch (e) {
      setRemoval({ confirmingId: row.id, busyId: null, error: e?.message || 'The resource could not be deleted.', ok: null });
    }
  };

  return (
    <RailFrame
      rail={(
        <WorkerRail
          workspace="Wellbeing library"
          role="admin"
          stance="The library, as stored"
          note="Eadwyn reads back the counts on this page and changes nothing. It cannot draft a summary: the library keeps a link and a description, not the resource itself."
          coverage={libraryCoverage(library.status === 'ready' ? library.rows : null)}
          coverageNote="Counts of published resources by kind."
          unavailable={[
            ['A one-line summary', 'The library stores no content to summarise.'],
          ]}
        />
      )}
      data-testid="wellbeing-library"
    >
      <section className="min-w-0 space-y-4" aria-label="Resource library">
        <PageHeader
          back={{ to: '/admin?tab=wellbeing', label: 'Wellbeing' }}
          title="Resource library"
          sub="What members see under Wellbeing, in the order they see it. Publish and delete."
          action={(
            <button type="button" className={BTN.primary} onClick={() => titleRef.current?.focus()} data-testid="button-new-resource">
              New resource
            </button>
          )}
        />
        <LibraryToolbar
          q={view.q}
          category={view.category}
          sort={view.sort}
          onChange={changeView}
          count={library.status === 'ready' ? countLabel(page) : 'Reading the library'}
        />
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card data-testid="card-library">
            <CardHead title="Resources" meta={library.status === 'ready' ? `${library.rows.length} published` : null} />
            {library.status === 'loading' ? <Skeleton.Table rows={4} cols={5} /> : library.status === 'unreadable' ? (
              <Unreadable what="The library" claim="This is not a sign that it is empty." onRetry={load} />
            ) : !library.rows.length ? (
              <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="text-library-empty">
                No resources yet. Members see an empty Wellbeing library.
              </p>
            ) : !filtered.length ? (
              <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="text-library-no-match">No resource matches this search.</p>
            ) : (
              <>
                <ResourceTable
                  rows={page.rows}
                  confirmingId={removal.confirmingId}
                  busyId={removal.busyId}
                  onAskDelete={(row) => setRemoval({ confirmingId: row.id, busyId: null, error: null, ok: null })}
                  onConfirmDelete={confirmDelete}
                  onCancelDelete={() => setRemoval({ confirmingId: null, busyId: null, error: null, ok: null })}
                />
                {page.pages > 1 && (
                  <div className="mt-3 flex items-center justify-end gap-2 text-xs" data-testid="library-pages">
                    <button type="button" className={BTN.ghost} disabled={page.page <= 1} onClick={() => changeView({ page: page.page - 1 })}>Previous</button>
                    <span className="tabular-nums text-axal-muted dark:text-gray-400">Page {page.page} of {page.pages}</span>
                    <button type="button" className={BTN.ghost} disabled={page.page >= page.pages} onClick={() => changeView({ page: page.page + 1 })}>Next</button>
                  </div>
                )}
              </>
            )}
            <div className="mt-2"><Outcome ok={removal.ok} error={removal.error} testId="delete" /></div>
          </Card>
          <Card data-testid="card-new-resource">
            <CardHead title="New resource" />
            <ResourceEditor
              draft={draft}
              fields={publish.fields}
              busy={publish.busy}
              error={publish.error}
              ok={publish.ok}
              onChange={(next) => { setDraft(next); setPublish((p) => ({ ...p, ok: null })); }}
              onPublish={publishNow}
              titleRef={titleRef}
            />
          </Card>
        </div>
      </section>
    </RailFrame>
  );
}
