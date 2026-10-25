import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Search, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, Pill, RailFrame, Skeleton, Unrecorded, Unreadable, WorkerRail } from '../../ui';
import {
  EMPTY_RESOURCE, LIBRARY_SORTS, RESOURCE_CATEGORIES, countLabel, filterResources, formatDate,
  libraryCoverage, pageOf, resourceBody, resourceFacts, resourceKind,
  RESOURCE_FORMATS, RESOURCE_TOPIC_MAX, draftOf, resourceFormat,
  RESOURCE_FILE_TYPES, RESOURCE_FILE_MAX_MB, fileLabel, fileProblem, resourceHref,
} from './wellbeingModel';
import { BTN, FIELD, PageHeader, CardHead, Outcome } from './WellbeingParts';

/**
 * /admin/wellbeing/resources — the resource library (canvas `wba-library`, D570).
 *
 * The list members read under Wellbeing, with publish, edit and delete. It
 * reads `GET /api/wellbeing/resources` (published rows for members; drafts too
 * for an admin) and writes `POST /resources`, `PATCH /resources/:id` and
 * `DELETE /resources/:id`, all behind `requireAdmin` (and, for anything that
 * puts content in front of members, the branch-suspension gate, D142/D303).
 *
 * WHAT A RESOURCE STORES (D574, migration 395). A category (one of five), a
 * title, a description, a link, a region, two flags and a sort order, plus:
 *   - Kind: the canvas's format, article / audio / video / link. A row added
 *     before D574 has none, which reads "Not recorded".
 *   - Topic: free text, at most 60 characters.
 *   - State: a draft is listed to admins only; Publish lists it to members.
 *   - The date: when it was last edited, or added if it never was.
 *   - A source is a link, a file in the library's own storage (D574 part 4:
 *     a PDF, audio or video of at most 95 MB, read by members through a
 *     gated route), or both. A file is attached to a saved resource.
 */

const KIND_GAP = 'Added before the library recorded a format.';
const TOPIC_GAP = 'No topic was set for this resource.';
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

function dateLine(r) {
  const edited = formatDate(r.edited_at);
  if (edited) return { label: 'Edited', date: edited };
  return { label: 'Added', date: formatDate(r.created_at) || <Unrecorded reason="The row carries no date.">Not recorded</Unrecorded> };
}

export function ResourceTable({ rows = [], confirmingId = null, busyId = null, onAskDelete, onConfirmDelete, onCancelDelete, onEdit }) {
  return (
    <div className="@container" data-testid="table-library">
      <div className={`hidden gap-3 border-b border-axal-hairline pb-2 text-[10px] font-extrabold uppercase tracking-axal-label text-axal-muted @2xl:grid ${TABLE_COLS} dark:border-gray-700 dark:text-gray-400`}>
        <span>Kind</span><span>Title</span><span>Topic</span><span>State</span><span>Date</span><span />
      </div>
      <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
        {rows.map((r) => {
          const href = resourceHref(r);
          const facts = [resourceKind(r.category), ...resourceFacts(r), fileLabel(r.file)].filter(Boolean);
          const when = dateLine(r);
          const format = resourceFormat(r.kind);
          const topic = String(r.topic ?? '').trim();
          const draft = r.status === 'draft';
          const state = <Pill tone={draft ? 'warn' : 'ok'}>{draft ? 'Draft' : 'Published'}</Pill>;
          return (
            <li key={r.id} className="py-2.5" data-testid={`resource-${r.id}`}>
              <div className={`grid grid-cols-[6rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 ${TABLE_COLS} @2xl:items-center`}>
                <span>{format ? <Pill tone="neutral">{format}</Pill> : <Unrecorded reason={KIND_GAP}>Not recorded</Unrecorded>}</span>
                <span className="min-w-0">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100">{r.name}</a>
                  ) : (
                    <span className="block truncate text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.name}</span>
                  )}
                  {facts.length > 0 && <span className="block text-xs text-axal-muted dark:text-gray-400">{facts.join(' · ')}</span>}
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-axal-muted @2xl:hidden dark:text-gray-400">
                    <span>Topic: {topic || <Unrecorded reason={TOPIC_GAP}>none</Unrecorded>}</span>
                    {state}
                    <span className="tabular-nums">{when.label} {when.date}</span>
                  </span>
                </span>
                <span className="hidden text-xs @2xl:block">{topic || <Unrecorded reason={TOPIC_GAP}>None</Unrecorded>}</span>
                <span className="hidden @2xl:block">{state}</span>
                <span className="hidden text-xs tabular-nums text-axal-muted @2xl:block dark:text-gray-400">{when.label} {when.date}</span>
                <span className="flex flex-col items-end gap-1">
                  <button type="button" className={BTN.link} onClick={() => onEdit?.(r)} aria-label={`Edit ${r.name}`} data-testid={`button-edit-resource-${r.id}`}>
                    <Pencil size={13} aria-hidden="true" /> Edit
                  </button>
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
        Members see published resources only. A draft is listed here, to admins, until it is published.
      </p>
    </div>
  );
}

/**
 * D574 part 4 — the file on a saved resource: what is attached, a chooser, and
 * remove. A new resource is saved first, so the file has a row to belong to.
 */
export function ResourceFileField({ draft, upload = {}, onPick, onUpload, onRemove }) {
  if (draft?.id == null) {
    return <p className={`${FIELD.note} mt-1`} data-testid="text-file-after-save">Save the resource first, then attach a file to it.</p>;
  }
  const current = fileLabel(draft.file);
  return (
    <div className="mt-1 space-y-1.5" data-testid="field-resource-file">
      {current ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-axal-ink dark:text-gray-100">
          <span>Attached: {current}</span>
          <button type="button" className={BTN.dangerLink} disabled={upload.busy} onClick={() => onRemove?.()} data-testid="button-remove-file">Remove</button>
        </p>
      ) : <p className={FIELD.note}>No file attached.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept={Object.keys(RESOURCE_FILE_TYPES).join(',')}
          aria-label="Choose a file"
          onChange={(e) => onPick?.(e.target.files?.[0] || null)}
          className="text-xs"
          data-testid="input-resource-file"
        />
        <button type="button" className={BTN.ghost} disabled={upload.busy || !upload.file} onClick={() => onUpload?.()} data-testid="button-upload-file">
          {upload.busy ? 'Uploading…' : current ? 'Replace file' : 'Upload file'}
        </button>
      </div>
      <p className={FIELD.note}>A PDF, MP3, M4A, MP4 or WebM, at most {RESOURCE_FILE_MAX_MB} MB. Members open it from the library.</p>
      <Outcome ok={upload.ok} error={upload.error} testId="file" />
    </div>
  );
}

export function ResourceEditor({ draft, fields = {}, busy = false, error, ok, onChange, onPublish, onSaveDraft, onCancelEdit, titleRef, upload, onPickFile, onUploadFile, onRemoveFile }) {
  const set = (key, value) => onChange?.({ ...draft, [key]: value });
  const editing = draft?.id != null;
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
        <label className={FIELD.label} htmlFor="res-category">Category</label>
        <select id="res-category" className={FIELD.input} value={draft.category} onChange={(e) => set('category', e.target.value)}>
          <option value="">Choose a category</option>
          {RESOURCE_CATEGORIES.map((c) => <option key={c} value={c}>{resourceKind(c)}</option>)}
        </select>
        {fields.category && <p role="alert" className={FIELD.error}>{fields.category}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={FIELD.label} htmlFor="res-kind">Kind</label>
          <select id="res-kind" className={FIELD.input} value={draft.kind || ''} onChange={(e) => set('kind', e.target.value)}>
            <option value="">Not set</option>
            {RESOURCE_FORMATS.map((k) => <option key={k} value={k}>{resourceFormat(k)}</option>)}
          </select>
          {fields.kind && <p role="alert" className={FIELD.error}>{fields.kind}</p>}
        </div>
        <div>
          <label className={FIELD.label} htmlFor="res-topic">Topic (optional)</label>
          <input id="res-topic" className={FIELD.input} maxLength={RESOURCE_TOPIC_MAX} value={draft.topic || ''} onChange={(e) => set('topic', e.target.value)} />
          {fields.topic && <p role="alert" className={FIELD.error}>{fields.topic}</p>}
        </div>
      </div>
      <div>
        <label className={FIELD.label} htmlFor="res-url">Source link</label>
        <input id="res-url" className={FIELD.input} inputMode="url" placeholder="https://…" value={draft.url} onChange={(e) => set('url', e.target.value)} />
        {fields.url && <p role="alert" className={FIELD.error}>{fields.url}</p>}
      </div>
      <div>
        <span className={FIELD.label}>File (optional)</span>
        <ResourceFileField draft={draft} upload={upload} onPick={onPickFile} onUpload={onUploadFile} onRemove={onRemoveFile} />
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
      <p className={FIELD.note}>Publishing lists it to every member at once. A draft is kept for admins until it is published.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={BTN.primary} disabled={busy} data-testid="button-publish-resource">{busy ? 'Saving…' : 'Publish'}</button>
        <button type="button" className={BTN.ghost} disabled={busy} onClick={() => onSaveDraft?.()} data-testid="button-draft-resource">Save draft</button>
        {editing && <button type="button" className={BTN.ghost} disabled={busy} onClick={() => onCancelEdit?.()} data-testid="button-cancel-edit">Stop editing</button>}
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

  // D574 — one save for both buttons: a new row is created, a row being
  // edited is changed in place; `status` is the button pressed.
  const save = async (status) => {
    const parsed = resourceBody(draft, status);
    if (!parsed.ok) { setPublish({ busy: false, error: null, ok: null, fields: parsed.fields }); return; }
    setPublish({ busy: true, error: null, ok: null, fields: {} });
    try {
      const row = draft.id != null
        ? await api.wellbeingResourceUpdate(draft.id, parsed.body)
        : await api.wellbeingResourceCreate(parsed.body);
      const name = row?.name || parsed.body.name;
      setPublish({ busy: false, error: null, ok: status === 'draft' ? `Saved “${name}” as a draft.` : `Published “${name}”.`, fields: {} });
      setDraft(EMPTY_RESOURCE);
      await load();
    } catch (e) {
      setPublish({ busy: false, error: e?.message || 'The resource could not be saved.', ok: null, fields: {} });
    }
  };
  // D574 part 4 — the file on the resource being edited.
  const [upload, setUpload] = useState({ file: null, busy: false, ok: null, error: null });
  const pickFile = (file) => setUpload({ file, busy: false, ok: null, error: file ? fileProblem(file) : null });
  const uploadFile = async () => {
    const problem = fileProblem(upload.file);
    if (problem || draft.id == null) { setUpload((u) => ({ ...u, error: problem })); return; }
    setUpload((u) => ({ ...u, busy: true, ok: null, error: null }));
    try {
      const row = await api.wellbeingResourceFileUpload(draft.id, upload.file);
      setDraft((d) => ({ ...d, file: row?.file ?? null }));
      setUpload({ file: null, busy: false, ok: `Attached ${fileLabel(row?.file) || 'the file'}.`, error: null });
      await load();
    } catch (e) {
      setUpload((u) => ({ ...u, busy: false, error: e?.message || 'The file could not be uploaded.' }));
    }
  };
  const removeFile = async () => {
    if (draft.id == null) return;
    setUpload((u) => ({ ...u, busy: true, ok: null, error: null }));
    try {
      await api.wellbeingResourceFileRemove(draft.id);
      setDraft((d) => ({ ...d, file: null }));
      setUpload({ file: null, busy: false, ok: 'Removed the file.', error: null });
      await load();
    } catch (e) {
      setUpload((u) => ({ ...u, busy: false, error: e?.message || 'The file could not be removed.' }));
    }
  };

  const editRow = (row) => {
    setUpload({ file: null, busy: false, ok: null, error: null });
    setDraft(draftOf(row));
    setPublish({ busy: false, error: null, ok: null, fields: {} });
    titleRef.current?.focus();
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
          note="Eadwyn reads back the counts on this page and changes nothing. It does not open a resource's link or file, so it cannot draft a summary."
          coverage={libraryCoverage(library.status === 'ready' ? library.rows : null)}
          coverageNote="Counts of published resources by kind."
          unavailable={[
            ['A one-line summary', 'Eadwyn does not read a resource\'s link or file, so there is nothing to summarise from.'],
          ]}
        />
      )}
      data-testid="wellbeing-library"
    >
      <section className="min-w-0 space-y-4" aria-label="Resource library">
        <PageHeader
          back={{ to: '/admin/wellbeing', label: 'Wellbeing' }}
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
            <CardHead title="Resources" meta={library.status === 'ready' ? `${library.rows.filter((r) => r.status !== 'draft').length} published` : null} />
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
                  onEdit={editRow}
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
            <CardHead title={draft.id != null ? 'Edit resource' : 'New resource'} />
            <ResourceEditor
              draft={draft}
              fields={publish.fields}
              busy={publish.busy}
              error={publish.error}
              ok={publish.ok}
              onChange={(next) => { setDraft(next); setPublish((p) => ({ ...p, ok: null })); }}
              onPublish={() => save('published')}
              onSaveDraft={() => save('draft')}
              onCancelEdit={() => { setDraft(EMPTY_RESOURCE); setPublish({ busy: false, error: null, ok: null, fields: {} }); setUpload({ file: null, busy: false, ok: null, error: null }); }}
              titleRef={titleRef}
              upload={upload}
              onPickFile={pickFile}
              onUploadFile={uploadFile}
              onRemoveFile={removeFile}
            />
          </Card>
        </div>
      </section>
    </RailFrame>
  );
}
