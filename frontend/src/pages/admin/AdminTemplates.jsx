import React, { useEffect, useMemo, useState } from 'react';
import { FileText, X, Plus, Save, Trash2, History, Loader2, AlertTriangle, RefreshCw, Eye, Download, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { contractsApi } from '../../lib/api/contracts';
import { ConsoleUnreadable } from './consoles/shared';
import TemplateCatalog from './contracts/TemplateCatalog';
import { reportError } from '../../lib/log';
import { useEscapeClose } from '../../components/useEscapeClose';
import PaperPreview from '../../components/PaperPreview';
import TemplateEditor from './contracts/TemplateEditor';
import { useAuth } from '../../hooks/useAuthSync';
import { branchOfUser } from '../../lib/shellRole';
import { BELOW_MD_QUERY, usePhoneWidth } from '../../ui/phone/usePhoneWidth';
import TemplateCatalogPhone from './contracts/TemplateCatalogPhone';

// Task #8 — Markdown template editor + full template catalog.
//
// Store-backed (Worker/D1) replacement for the legacy read-only
// `TemplatesGrid`. Renders the canonical legal-template catalog grouped by
// category with full CRUD: card → dual-pane markdown editor, "N uses" chip →
// the existing TemplateUsageModal (passed in via `onOpenUsage`), plus
// create / soft-delete / read-only version history.
//
// The store endpoints are worker-only, so in the dev FastAPI environment the
// list 404s — we surface the same "unavailable in this environment" banner
// the New-envelope wizard uses rather than an error.

// Mirror of TEMPLATE_LAYERS in cloudflare-worker/src/routes/admin_contracts.ts.
const CATEGORY_META = {
  gp: { label: 'Internal Management (GP Level)', description: 'Governance, partner economics, and decision-making framework' },
  fund: { label: 'Fund Formation (LP Level)', description: 'Capital raising, investor agreements, and fund structure' },
  portfolio: { label: 'Investment Execution (Portfolio Level)', description: 'Templates used when investing into startups' },
  compliance: { label: 'Compliance & Regulatory', description: 'SEC filings, AML/KYC, and tax elections' },
};
const CATEGORY_ORDER = ['gp', 'fund', 'portfolio', 'compliance'];
const LAYERS = CATEGORY_ORDER.map(id => [id, CATEGORY_META[id].label]);

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const MERGE_TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
function detectMergeFields(body) {
  const seen = new Set();
  let m;
  MERGE_TOKEN.lastIndex = 0;
  while ((m = MERGE_TOKEN.exec(body || '')) !== null) seen.add(m[1]);
  return Array.from(seen).sort();
}

export default function AdminTemplates({ onOpenUsage, recordedPublication = false }) {
  const { user } = useAuth() || {};
  // D717 (#1854): below `md` the Templates tab is the phone's read-only list.
  const phone = usePhoneWidth(BELOW_MD_QUERY);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [editing, setEditing] = useState(null); // { slug } | { isNew:true } | null
  // D147 — the push to every branch. `undefined` means "not pushed in this
  // session", which is a different thing from a push that reached nobody, and
  // the two render differently below.
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);
  const [publishErr, setPublishErr] = useState('');

  const reload = async () => {
    setLoading(true);
    setErr('');
    setUnavailable(false);
    try {
      const r = await (recordedPublication ? contractsApi.templates() : api.adminTemplateStoreList());
      setItems(r.items || []);
    } catch (e) {
      if (e?.status === 404) setUnavailable(true);
      else { setErr(e.message || 'Failed to load templates.'); reportError('AdminTemplates:load', e); }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const grouped = useMemo(() => {
    const by = {};
    for (const t of items) {
      const cat = CATEGORY_META[t.category] ? t.category : 'gp';
      (by[cat] = by[cat] || []).push(t);
    }
    return by;
  }, [items]);

  const onSaved = () => { setEditing(null); reload(); };

  // D717 (#1852): on the Contracts desk the editor opens in place and the tab
  // draws only it. Checked first, so a background reload never unmounts it.
  if (recordedPublication && editing) {
    return (
      <TemplateEditor
        key={editing.slug || 'new'}
        slug={editing.slug}
        isNew={!!editing.isNew}
        row={items.find(t => t.slug === editing.slug)}
        focus={editing.focus}
        authoring={!branchOfUser(user)}
        layers={LAYERS}
        user={user}
        onClose={() => setEditing(null)}
        onChanged={reload}
        onDeleted={() => { setEditing(null); reload(); }}
      />
    );
  }

  // D717 (#1854) decision 2: the phone list only while no editor is open, so an
  // editor opened on a wider window keeps its draft when the window narrows.
  if (recordedPublication && phone && !editing) {
    return (
      <div>
        {err && <ConsoleUnreadable what="Templates" onRetry={reload} />}
        {unavailable && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded-lg mb-3 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              The legal template store isn't available in this environment. Templates are managed by the production worker —
              open the deployed app to view and edit them.
            </div>
          </div>
        )}
        {loading ? <p role="status" className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          : err || unavailable ? null
            : items.length === 0 ? <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">No templates yet.</p>
              : <TemplateCatalogPhone items={items} />}
      </div>
    );
  }

  // THE PUSH IS THE WHOLE LIBRARY, AND IT IS REPORTED PER BRANCH. A failure to
  // reach one branch is not a failure of the push — HQ's library is HQ's
  // either way — so nothing here throws the operator back to an error page
  // (D111's rule, the same shape an escalation answer and a licence transition
  // already use).
  const publish = async () => {
    if (publishing) return;
    setPublishing(true);
    setPublishErr('');
    try {
      setPublishResult(await api.adminTemplatesPublish());
    } catch (e) {
      // The library is untouched: this only failed to SEND. Saying which is the
      // difference between "retry" and "check what you just saved".
      setPublishErr(e.message || 'The library could not be sent. Nothing in it changed.');
      reportError('AdminTemplates:publish', e);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div>
      {/* D717 (#1851): on the Contracts desk the catalog's toolbar replaces this
          header, and #1852's Publish v[N] the library-wide Publish. */}
      {!recordedPublication && <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="text-xs text-gray-500">
          {unavailable ? 'Template store is worker-only.' : `${items.length} template${items.length === 1 ? '' : 's'} in the catalog`}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} className="text-xs text-gray-500 hover:text-violet-600 flex items-center gap-1">
            <RefreshCw size={12} /> Refresh
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={unavailable || publishing || !items.length}
            data-testid="template-publish"
            title="Send this library to every branch Worker bound to HQ"
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:border-violet-400 disabled:opacity-50 font-medium flex items-center gap-1 dark:border-gray-800 dark:text-gray-200">
            <Send size={12} /> {publishing ? 'Publishing…' : 'Publish to branches'}
          </button>
          <button
            onClick={() => setEditing({ isNew: true })}
            disabled={unavailable}
            data-testid="template-new"
            className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-medium flex items-center gap-1">
            <Plus size={12} /> New template
          </button>
        </div>
      </div>}

      {err && <ConsoleUnreadable what="Templates" onRetry={reload} />}

      {publishErr && (
        <div
          data-testid="template-publish-error"
          className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded mb-3 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300">
          {publishErr}
        </div>
      )}

      {publishResult && (
        <div
          data-testid="template-publish-result"
          className="bg-gray-50 border border-gray-200 text-xs p-3 rounded-lg mb-3 dark:bg-gray-900 dark:border-gray-800">
          <div className="font-semibold text-gray-900 dark:text-gray-100">
            {publishResult.template_count} template{publishResult.template_count === 1 ? '' : 's'} sent
            {' · '}
            {publishResult.answered} of {publishResult.total} branch{publishResult.total === 1 ? '' : 'es'} answered
          </div>
          {/* ZERO BRANCHES IS AN ANSWER, NOT AN ERROR, and the server supplies
              the sentence so the page and the fan-out cannot drift apart. */}
          {publishResult.branches_reason && (
            <p className="text-gray-600 mt-1 dark:text-gray-400">{publishResult.branches_reason}</p>
          )}
          {!!(publishResult.branches || []).length && (
            <ul className="mt-2 space-y-1">
              {publishResult.branches.map((b) => (
                <li key={b.code} className="flex items-start gap-2">
                  <span className="font-mono uppercase text-gray-900 dark:text-gray-100">{b.code}</span>
                  <span className="text-gray-600 dark:text-gray-400">
                    {b.status === 'ok'
                      ? `stored ${b.stored}${b.withdrawn ? `, withdrew ${b.withdrawn}` : ''}`
                      : (b.reason || b.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {unavailable && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded-lg mb-3 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <div>
            The legal template store isn't available in this environment. Templates are managed by the production worker —
            open the deployed app to view and edit them.
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">Loading…</div>
      ) : err ? null : !unavailable && items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">
          No templates yet. Click <span className="font-semibold">New template</span> to add one.
        </div>
      ) : recordedPublication ? (
        <TemplateCatalog
          items={items}
          authoring={!branchOfUser(user)}
          onOpen={(slug, opts) => setEditing({ slug, focus: opts?.focus })}
          onNew={() => setEditing({ isNew: true })}
          onOpenUsage={onOpenUsage} />
      ) : (
        <div className="space-y-6">
          {CATEGORY_ORDER.filter(cat => (grouped[cat] || []).length).map(cat => (
            <section key={cat}>
              <div className="mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{CATEGORY_META[cat].label}</h3>
                <p className="text-[11px] text-gray-500">{CATEGORY_META[cat].description}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {grouped[cat].map(t => (
                  <div
                    key={t.slug}
                    role="button"
                    tabIndex={0}
                    onClick={() => setEditing({ slug: t.slug })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing({ slug: t.slug }); } }}
                    data-testid={`template-card-${t.slug}`}
                    className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-violet-400 hover:shadow-sm transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-400 dark:bg-gray-900 dark:border-gray-800">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900 truncate dark:text-gray-100">{t.title}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">v{t.version}{t.is_stub ? ' · stub' : ''}</div>
                        {recordedPublication && <div className="text-[11px] text-gray-500">{t.published_version == null ? 'Unpublished' : `Published v${t.published_version}`}{t.has_unpublished_changes ? ' · pending changes' : ''}</div>}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenUsage && onOpenUsage(t.slug, t); }}
                        title="View usage across contracts & envelopes"
                        className="text-[10px] font-bold text-violet-700 bg-violet-50 px-2 py-1 rounded-full whitespace-nowrap hover:bg-violet-100">
                        {t.usage_count} uses
                      </button>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-3">Last used: {fmtDate(t.last_used_at) || 'Never'}</div>
                    <div className="text-[11px] text-gray-500">Last edited: {fmtDate(t.updated_at) || 'Not recorded'} · {t.updated_by != null ? `Admin #${t.updated_by}` : 'Not recorded: imported before editors were recorded.'}</div>
                    <div className="text-[10px] text-gray-400 mt-1 font-mono truncate">{t.slug}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <TemplateEditorModal
          slug={editing.slug}
          isNew={!!editing.isNew}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function TemplateEditorModal({ slug, isNew, onClose, onSaved }) {
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState('');

  const [slugInput, setSlugInput] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('gp');
  const [body, setBody] = useState('');
  const [version, setVersion] = useState(1);

  const [versions, setVersions] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const [viewVersion, setViewVersion] = useState(null); // a past version snapshot being previewed
  const [resolveTokens, setResolveTokens] = useState(true);
  // D711 — the paper the preview, the PDF and the Word export draw on.
  const [pageSize, setPageSize] = useState('letter');
  const [cover, setCover] = useState('dark');
  const [exporting, setExporting] = useState(false);

  useEscapeClose(onClose);

  useEffect(() => {
    if (isNew) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const r = await api.adminTemplateStoreGet(slug);
        if (!alive) return;
        const t = r.template;
        setSlugInput(t.slug);
        setTitle(t.title);
        setCategory(CATEGORY_META[t.category] ? t.category : 'gp');
        setBody(t.body_md || '');
        setVersion(t.version || 1);
        try {
          const v = await api.adminTemplateStoreVersions(slug);
          if (alive) setVersions(v.versions || []);
        } catch { /* history is best-effort */ }
      } catch (e) {
        if (alive) { setErr(e.message || 'Failed to load template.'); reportError('AdminTemplates:get', e); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [slug, isNew]);

  const mergeFields = useMemo(() => detectMergeFields(body), [body]);

  const save = async () => {
    setErr('');
    if (!title.trim()) { setErr('Title is required.'); return; }
    if (isNew && !slugInput.trim()) { setErr('Slug is required.'); return; }
    setSaving(true);
    try {
      if (isNew) {
        await api.adminTemplateStoreCreate({ slug: slugInput.trim(), title: title.trim(), category, body_md: body });
      } else {
        await api.adminTemplateStoreUpdate(slug, { title: title.trim(), category, body_md: body });
      }
      onSaved();
    } catch (e) {
      setErr(e.message || 'Failed to save template.');
      reportError('AdminTemplates:save', e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (isNew) return;
    setErr('');
    setDeleting(true);
    try {
      await api.adminTemplateStoreDelete(slug);
      onSaved();
    } catch (e) {
      setErr(e.message || 'Failed to delete template.');
      reportError('AdminTemplates:delete', e);
    } finally {
      setDeleting(false);
    }
  };

  const downloadPdf = async () => {
    if (isNew || !slug) return;
    setErr('');
    setDownloading(true);
    try {
      const { url, filename } = await api.adminTemplateStorePreviewPdfBlob(slug, {
        resolve: resolveTokens ? 'brackets' : 'raw', page: pageSize, cover,
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message || 'Failed to generate PDF.');
      reportError('AdminTemplates:downloadPdf', e);
    } finally {
      setDownloading(false);
    }
  };

  const downloadDocx = async () => {
    if (isNew || !slug) return;
    setErr('');
    setExporting(true);
    try {
      const { url, filename } = await api.adminTemplateStoreDocxBlob(slug, {
        resolve: resolveTokens ? 'brackets' : 'raw', page: pageSize,
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message || 'Failed to export Word.');
      reportError('AdminTemplates:downloadDocx', e);
    } finally {
      setExporting(false);
    }
  };

  const previewBody = viewVersion ? viewVersion.body_md : body;
  const paperSelect = 'px-1.5 py-0.5 text-[10px] normal-case font-normal border border-gray-200 rounded bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="relative bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col dark:bg-gray-900">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between gap-3 dark:border-gray-800">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={16} className="text-violet-600 flex-shrink-0" />
            <h3 className="font-semibold text-gray-900 truncate dark:text-gray-100">
              {isNew ? 'New template' : (title || slug)}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <button
                type="button"
                onClick={() => setShowVersions(s => !s)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1 ${showVersions ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-gray-200 text-gray-600 hover:border-violet-300'}`}>
                <History size={12} /> History{versions.length ? ` (${versions.length})` : ''}
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
          </div>
        </div>

        {/* Meta row */}
        <div className="px-5 py-3 border-b border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-3 dark:border-gray-800">
          <label className="block">
            <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Title</span>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Operating Agreement"
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Category</span>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
              {CATEGORY_ORDER.map(c => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Slug (doc_type)</span>
            <input value={isNew ? slugInput : slug} onChange={e => setSlugInput(e.target.value)} readOnly={!isNew}
              placeholder="operating_agreement"
              className={`mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono dark:border-gray-800 dark:text-gray-100 ${isNew ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 text-gray-500 dark:bg-gray-800'}`} />
          </label>
        </div>

        {err && <div className="mx-5 mt-3 bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">{err}</div>}

        {/* Body / preview */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm py-16"><Loader2 size={16} className="animate-spin mr-2" /> Loading…</div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col md:flex-row">
            {/* Left: editor + version panel */}
            <div className="md:w-1/2 flex flex-col border-r border-gray-200 dark:border-gray-800 min-h-0">
              {showVersions && (
                <div className="border-b border-gray-200 dark:border-gray-800 max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-800/40">
                  <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Version history (read-only)</div>
                  {versions.length === 0 ? (
                    <div className="px-4 pb-3 text-xs text-gray-400">No prior versions yet. The first edit creates v1 history.</div>
                  ) : (
                    <ul className="pb-2">
                      {versions.map(v => (
                        <li key={v.version} className="px-4 py-1.5 flex items-center justify-between gap-2 text-xs">
                          <span className="text-gray-600 dark:text-gray-300">v{v.version} · {fmtDate(v.created_at) || '—'}</span>
                          <span className="flex items-center gap-2">
                            <button type="button" onClick={() => setViewVersion(v)} className="text-violet-700 hover:text-violet-900 flex items-center gap-1"><Eye size={11} /> View</button>
                            <button type="button" onClick={() => { setBody(v.body_md); setViewVersion(null); }} className="text-gray-500 hover:text-gray-800">Restore</button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-center justify-between">
                <span>Plain text</span>
                {viewVersion && <span className="text-violet-600 normal-case font-normal">Previewing v{viewVersion.version} →</span>}
              </div>
              <textarea
                value={body}
                onChange={e => { setBody(e.target.value); setViewVersion(null); }}
                spellCheck={false}
                data-testid="template-body"
                placeholder="SECTION TITLE&#10;&#10;1.1  Clause text with {{merge_field}} tokens…&#10;&#10;Signed: ______________________"
                className="flex-1 min-h-[280px] w-full px-4 py-3 text-[13px] font-mono leading-relaxed resize-none focus:outline-none bg-white dark:bg-gray-900 dark:text-gray-100" />
              {/* Merge fields (auto-detected from body) */}
              <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                  Merge fields · auto-detected from {'{{tokens}}'}
                </div>
                {mergeFields.length === 0 ? (
                  <div className="text-[11px] text-gray-400">None — add <code className="font-mono">{'{{field_name}}'}</code> tokens to the body.</div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {mergeFields.map(f => (
                      <span key={f} className="text-[10px] font-mono bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded dark:bg-gray-800 dark:text-gray-300">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Right: live preview */}
            <div className="md:w-1/2 min-h-0 overflow-y-auto bg-gray-50 dark:bg-gray-900/40">
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 sticky top-0 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
                <span>{viewVersion ? `Preview · v${viewVersion.version} (read-only)` : 'Live preview'}</span>
                <span className="flex items-center gap-1.5">
                  <select aria-label="Page size" value={pageSize} onChange={e => setPageSize(e.target.value)} data-testid="template-page-size" className={paperSelect}>
                    <option value="letter">Letter</option>
                    <option value="a4">A4</option>
                  </select>
                  <select aria-label="Cover" value={cover} onChange={e => setCover(e.target.value)} data-testid="template-cover" className={paperSelect}>
                    <option value="dark">Dark cover</option>
                    <option value="light">Light cover</option>
                  </select>
                </span>
                <label className="flex items-center gap-1.5 normal-case font-normal text-[10px] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={resolveTokens}
                    onChange={e => setResolveTokens(e.target.checked)}
                    className="w-3 h-3 accent-violet-600"
                  />
                  Resolve merge fields
                </label>
              </div>
              <PaperPreview
                title={viewVersion ? viewVersion.title : title}
                body={previewBody}
                resolveTokens={resolveTokens}
                version={viewVersion ? viewVersion.version : version}
                docType={slugInput || slug}
                category={category}
                pageSize={pageSize}
                cover={cover}
              />
            </div>
          </div>
        )}

        {confirmDelete && <section role="alertdialog" aria-label="Delete template" className="border-t border-rose-200 p-4 dark:border-rose-900">
          <p>Delete “{title || slug}”? It will be hidden from the catalogue and New envelope. Agreements already sent keep their copy.</p>
          <button type="button" onClick={remove} disabled={deleting || saving}>Confirm delete</button>{' '}<button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
        </section>}
        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between gap-2 dark:border-gray-800">
          <div>
            {!isNew && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting || saving}
                data-testid="template-delete"
                className="text-xs px-3 py-2 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50 flex items-center gap-1">
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <button
                type="button"
                onClick={downloadPdf}
                disabled={downloading || saving || loading}
                data-testid="template-download-pdf"
                className="text-xs px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 disabled:opacity-50 flex items-center gap-1">
                {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Download PDF
              </button>
            )}
            {!isNew && (
              <button
                type="button"
                onClick={downloadDocx}
                disabled={exporting || saving || loading}
                data-testid="template-download-docx"
                className="text-xs px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 disabled:opacity-50 flex items-center gap-1">
                {exporting ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Download Word
              </button>
            )}
            <button type="button" onClick={onClose} className="text-xs px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300">Cancel</button>
            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              data-testid="template-save"
              className="text-xs px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-medium flex items-center gap-1">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {isNew ? 'Create' : 'Save new version'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
