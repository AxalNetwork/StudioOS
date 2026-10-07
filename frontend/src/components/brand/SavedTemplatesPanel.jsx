import React, { useCallback, useEffect, useState } from 'react';
import { Bookmark, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { TEMPLATE_LIMIT, dayOf, refusalLine, templateCount, templateFrom } from '../../lib/brandAddress';

/**
 * D636 (#1394) — the Ops canvas's sp-brand screen, its template half: the
 * founder's saved templates ("[n] of 50, across all your projects"), each with
 * the project it came from, applied to a new page or deleted; and "Save as
 * template" on any page of this project.
 *
 * Reads `GET /api/brand/custom-templates`; writes through `POST` and `DELETE`
 * on the same path (both record their actor) and creates a page with
 * `from_custom_template_id`. The 51st template is refused by the Worker, and
 * the form says so before sending. A list that could not be read says
 * Unreadable with Try again, never an empty list.
 */

const CARD = 'rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const FIELD = 'h-8 rounded-lg border border-gray-200 bg-white px-2.5 text-[12.5px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400/40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
const BTN = 'inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BTN} bg-violet-600 text-white hover:bg-violet-700`;
const QUIET = `${BTN} border border-gray-200 bg-white text-gray-700 hover:border-violet-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200`;
const DANGER = `${BTN} border border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/40`;

/** The limit sentence, the one the Worker gives for the 51st. */
export const LIMIT_LINE = `You have ${TEMPLATE_LIMIT} saved templates, the most allowed across all your projects. Delete one before saving another.`;

/** "Save as template": a page of this project and a name. Refused before sending at the limit. */
export function SaveTemplateForm({ pages, full, busy, error, onSave }) {
  const [pageId, setPageId] = useState(pages?.[0]?.id ?? '');
  const [name, setName] = useState('');
  if (!pages || pages.length === 0) return null;
  const ready = !full && !busy && String(name).trim() !== '' && pageId !== '';
  return (
    <div className="mt-3 rounded-xl border border-dashed border-gray-200 p-3 dark:border-gray-700" data-testid="brand-save-template">
      <div className="text-[11.5px] font-semibold text-gray-600 dark:text-gray-300">Save as template</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <select aria-label="Page to save" value={pageId} onChange={(e) => setPageId(Number(e.target.value))} className={FIELD} disabled={full}>
          {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input aria-label="Template name" placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} className={`${FIELD} min-w-[12rem] flex-1`} disabled={full} maxLength={80} />
        <button type="button" className={PRIMARY} disabled={!ready} onClick={() => onSave(Number(pageId), String(name).trim())}>
          {busy ? 'Saving…' : 'Save as template'}
        </button>
      </div>
      {full && <p role="alert" data-testid="brand-template-limit" className="mt-1.5 text-[12px] text-red-700 dark:text-red-300">{LIMIT_LINE}</p>}
      {error && <p role="alert" data-testid="brand-template-refusal" className="mt-1.5 text-[12px] text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}

/** The saved templates in every state the canvas draws. `read` is loading, unreadable or ready. */
export function TemplatesList({ read, busy, confirming, onUse, onAskDelete, onDelete, onCancel, onRetry }) {
  if (!read || read.status === 'loading') return <p className="text-[12.5px] text-gray-500 dark:text-gray-400">Reading your templates…</p>;
  if (read.status !== 'ready') {
    return (
      <div role="alert" data-testid="brand-templates-unreadable" className="flex flex-wrap items-center gap-2 text-[12.5px] text-red-700 dark:text-red-300">
        <span className="font-semibold">Unreadable</span>
        <span>Your saved templates could not be read just now. This is not an empty list.</span>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline">
          <RefreshCw size={12} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }
  const templates = read.data?.templates || [];
  if (!templates.length) {
    return <p data-testid="brand-templates-empty" className="text-[12.5px] text-gray-500 dark:text-gray-400">No saved templates yet. Save any page as one.</p>;
  }
  return (
    <ul className="space-y-1.5" data-testid="brand-templates">
      {templates.map((t) => (
        <li key={t.id} data-testid="brand-template" className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-gray-900 dark:text-white">{t.name}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">{templateFrom(t)} · {dayOf(t.created_at)}</div>
            </div>
            {confirming === t.id ? (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-gray-700 dark:text-gray-200">Delete this template? Pages made from it stay as they are.</span>
                <button type="button" className={DANGER} onClick={() => onDelete(t)} disabled={busy}>Delete</button>
                <button type="button" className={QUIET} onClick={onCancel} disabled={busy}>Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button type="button" className={QUIET} onClick={() => onUse(t)} disabled={busy}>Use for a new page</button>
                <button type="button" className={DANGER} onClick={() => onAskDelete(t.id)} disabled={busy}>Delete</button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

const LOADING = { status: 'loading' };

export default function SavedTemplatesPanel({ projectId, pages, onPagesChanged }) {
  const [read, setRead] = useState(LOADING);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    setRead(LOADING);
    api.brandListCustomTemplates().then(
      (data) => setRead({ status: 'ready', data }),
      (e) => { reportError('SavedTemplatesPanel:list', e); setRead({ status: 'unreadable' }); },
    );
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, okLine, fallback) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await fn();
      setConfirming(null);
      setNotice(okLine);
      load();
    } catch (e) {
      setError(refusalLine(e, fallback));
    } finally { setBusy(false); }
  };

  const limit = read.status === 'ready' ? Number(read.data?.limit) || TEMPLATE_LIMIT : TEMPLATE_LIMIT;
  const count = read.status === 'ready' ? templateCount(read.data?.templates, limit) : null;
  return (
    <section className={`${CARD} mb-6`} data-testid="brand-templates-panel">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          <Bookmark size={13} aria-hidden="true" /> Saved templates
        </span>
        <span className="ml-auto font-mono text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="brand-templates-count">
          {count ? `${count.line} · across all your projects` : ''}
        </span>
      </div>
      {notice && <p role="status" className="mb-2 text-[12px] text-emerald-700 dark:text-emerald-300">{notice}</p>}
      <TemplatesList
        read={read} busy={busy} confirming={confirming} onRetry={load}
        onAskDelete={(id) => { setConfirming(id); setError(null); }} onCancel={() => setConfirming(null)}
        onDelete={(t) => act(() => api.brandDeleteCustomTemplate(t.id), `"${t.name}" deleted.`, 'The template could not be deleted. Try again.')}
        onUse={(t) => act(async () => {
          await api.brandCreatePage(projectId, { name: t.name, from_custom_template_id: t.id });
          await onPagesChanged?.();
        }, `A new draft page was made from "${t.name}".`, 'The page could not be made from that template. Try again.')}
      />
      {read.status === 'ready' && (
        <SaveTemplateForm
          pages={pages} full={!!count?.full} busy={busy} error={error}
          onSave={(pageId, name) => act(() => api.brandSaveCustomTemplate(name, pageId), `"${name}" saved as a template.`, 'The template could not be saved. Try again.')}
        />
      )}
      {read.status !== 'ready' && error && <p role="alert" className="mt-1.5 text-[12px] text-red-700 dark:text-red-300">{error}</p>}
    </section>
  );
}
