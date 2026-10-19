import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, FileText, Loader2, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { templateState } from '../../../lib/templateCatalogModel';
import { mapOffset, pairAnchors, sourceAnchors } from '../../../lib/paneSync';
import PaperPreview, { paperRequest } from '../../../components/PaperPreview';
import { Pill } from '../../../ui';
import { input } from './parts';
import PublishDialog, { PublishResult } from './PublishDialog';
import DraftPages from './DraftPages';
import VersionCompare from './VersionCompare';

// D717 (#1852) — the template editor, in place inside the Templates tab (board
// L9, frames "Editor" and "Publish confirmation and result"). Three panes: the
// Markdown source with numbered lines and highlighted merge fields, the live
// paper scrolling with it, and the merge fields with who fills each. Kind and
// Axal VC party come from the row's `format_options`; Save draft creates the
// next version; Publish v[N] publishes that one template. A branch Worker reads
// it with no authoring control (D106). The legacy console keeps
// AdminTemplates.jsx's modal.

const MERGE_TOKEN = /(\{\{\s*[a-zA-Z0-9_.]+\s*\}\})/;
// Exported so Compare versions (#1853) prints the same party names (#1853 decision 15).
export const PARTY_LABEL = { management: 'Management', gp: 'GP', fund: 'GP for the Fund', holdings: 'Holdings', none: 'None' };
export const partyLabel = p => PARTY_LABEL[p] || p;

const muted = 'text-[#615c6e] dark:text-[#a29db0]';
const paneCard = 'rounded-xl border border-[#ececf1] bg-white dark:border-[#2a2733] dark:bg-[#18161f]';
const primary = 'rounded-[9px] bg-[#881337] px-[13px] py-2 text-[12.5px] font-bold text-white disabled:opacity-50';
const secondary = 'rounded-[9px] border border-[#ececf1] bg-white px-[13px] py-2 text-[12.5px] font-bold text-[#18181b] disabled:opacity-50 dark:border-[#2a2733] dark:bg-[#18161f] dark:text-[#f4f3f7]';
const link = 'text-[#881337] dark:text-rose-300';
// The mirror and the textarea share every metric, so each wrapped line sits on its mirror.
const sourceText = 'font-mono text-[12px] leading-[1.65] whitespace-pre-wrap [overflow-wrap:anywhere]';
// No padding or border: either would move the text under the caret.
const chip = 'rounded bg-[#f4f0fe] text-[#5b21b6] shadow-[0_0_0_2px_#f4f0fe] dark:bg-violet-950 dark:text-violet-200 dark:shadow-[0_0_0_2px_#2e1065]';
const paperSelect = 'rounded border border-[#ececf1] bg-white px-1.5 py-1 text-[11px] dark:border-[#2a2733] dark:bg-[#18161f] dark:text-[#f4f3f7]';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** One source line: its text, with each merge token, braces included, as a chip. */
function MirrorLine({ text }) {
  if (!text) return '​';
  return text.split(MERGE_TOKEN).map((part, i) => (i % 2 === 1
    ? <span key={i} className={chip} data-merge-chip="">{part}</span>
    : <Fragment key={i}>{part}</Fragment>));
}

/** A segmented control: a `role="group"` of `<button aria-pressed>`. */
function Segmented({ label, options, value, onChange }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span>{label}</span>
      <span role="group" aria-label={label} className="inline-flex rounded-[9px] border border-[#ececf1] bg-white p-[3px] dark:border-[#2a2733] dark:bg-[#18161f]">
        {options.map(([key, text]) => {
          const on = key === value;
          return (
            <button key={String(key)} type="button" aria-pressed={on} onClick={() => onChange(key)}
              className={`rounded-[7px] px-[9px] py-1 text-[12px] font-semibold ${on ? 'bg-[#881337] text-white' : 'text-[#615c6e] dark:text-[#a29db0]'}`}>
              {text}
            </button>
          );
        })}
      </span>
    </span>
  );
}

export default function TemplateEditor({ slug: openedSlug, isNew: openedNew, row, focus, authoring, layers, user, onClose, onChanged, onDeleted }) {
  const [slug, setSlug] = useState(openedSlug || '');
  const [isNew, setIsNew] = useState(!!openedNew);
  const [loading, setLoading] = useState(!openedNew);
  const [saved, setSaved] = useState(null);
  const [versions, setVersions] = useState([]);
  const [err, setErr] = useState('');

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(layers?.[0]?.[0] || 'gp');
  const [body, setBody] = useState('');
  const [slugInput, setSlugInput] = useState('');
  const [kind, setKind] = useState(null);
  const [party, setParty] = useState(null);

  const [showVersions, setShowVersions] = useState(false);
  const [viewVersion, setViewVersion] = useState(null);
  const [resolveTokens, setResolveTokens] = useState(true);
  const [pageSize, setPageSize] = useState('letter');
  const [cover, setCover] = useState('dark');
  const [fields, setFields] = useState(null);
  // D717 (#1853): the middle pane shows the live paper or the draft's PDF pages,
  // and Compare versions takes the place of the three panes.
  const [paperView, setPaperView] = useState('live'); // 'live' | 'pages'
  const [comparing, setComparing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dialog, setDialog] = useState(null); // 'publish' | 'withdraw' | null
  const [result, setResult] = useState(null); // { mode, publication }
  const [publishedOverride, setPublishedOverride] = useState(undefined);

  const take = useCallback((t) => {
    setSaved(t);
    setTitle(t.title || '');
    setCategory(t.category || layers?.[0]?.[0] || 'gp');
    setBody(t.body_md || '');
    setKind(t.doc_kind ?? null);
    setParty(t.axal_party ?? null);
  }, [layers]);

  const load = useCallback(async (target, alive = () => true) => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.adminTemplateStoreGet(target);
      if (!alive()) return;
      take(r.template);
      try {
        const v = await api.adminTemplateStoreVersions(target);
        if (alive()) setVersions(v.versions || []);
      } catch { /* history is best-effort */ }
    } catch (e) {
      if (alive()) { setErr(e.message || 'Failed to load template.'); reportError('TemplateEditor:get', e); }
    } finally {
      if (alive()) setLoading(false);
    }
  }, [take]);

  useEffect(() => {
    if (openedNew) return undefined;
    let live = true;
    load(openedSlug, () => live);
    return () => { live = false; };
  }, [openedSlug, openedNew, load]);

  // Decision 4: the options come from the row; the editor keeps no list of its own.
  const options = saved?.format_options || null;
  const fixed = !!saved?.format_fixed;
  const partyless = k => !!options?.partyless_kinds?.includes(k);
  const effectiveKind = kind ?? options?.derived?.kind ?? saved?.kind ?? null;
  const slugParty = options ? (partyless(effectiveKind) ? 'none' : options.entity ?? options.derived?.party) : null;

  const formatChanged = !fixed && !!options && ((kind ?? null) !== (saved?.doc_kind ?? null) || (party ?? null) !== (saved?.axal_party ?? null));
  const unsaved = isNew
    ? !!(title || body || slugInput)
    : !!saved && (title !== (saved.title || '') || category !== (saved.category || '') || body !== (saved.body_md || '') || formatChanged);
  const V = saved?.version ?? 1;

  const pickKind = (next) => {
    setKind(next);
    const k = next ?? options?.derived?.kind;
    // A kind change that no longer fits the party returns it to the slug's.
    if (party != null && (partyless(k) ? party !== 'none' : party === 'none')) setParty(null);
  };

  const edited = () => { setResult(null); setViewVersion(null); };

  // ---- Save, create, delete ----------------------------------------------
  const save = async () => {
    setErr('');
    if (!title.trim()) { setErr('Title is required.'); return; }
    if (isNew && !slugInput.trim()) { setErr('Slug is required.'); return; }
    setSaving(true);
    try {
      if (isNew) {
        const made = slugInput.trim();
        await api.adminTemplateStoreCreate({ slug: made, title: title.trim(), category, body_md: body });
        setSlug(made);
        setIsNew(false);
        await load(made);
      } else {
        const r = await api.adminTemplateStoreUpdate(slug, {
          title: title.trim(), category, body_md: body,
          ...(fixed || !options ? {} : { doc_kind: kind ?? null, axal_party: party ?? null }),
        });
        // The PUT answers no `format_options`; the row's stay what the read gave.
        const t = { ...saved, ...(r?.template || {}) };
        if (!r?.template?.format_options) t.format_options = saved?.format_options;
        take(t);
        try { const v = await api.adminTemplateStoreVersions(slug); setVersions(v.versions || []); } catch { /* best-effort */ }
      }
      setResult(null);
      onChanged?.();
    } catch (e) {
      setErr(e.message || 'Failed to save template.');
      reportError('TemplateEditor:save', e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setErr('');
    setDeleting(true);
    try {
      await api.adminTemplateStoreDelete(slug);
      onDeleted?.();
    } catch (e) {
      setErr(e.message || 'Failed to delete template.');
      reportError('TemplateEditor:delete', e);
    } finally {
      setDeleting(false);
    }
  };

  const download = async (kindOf) => {
    if (isNew || !slug) return;
    setErr('');
    const set = kindOf === 'pdf' ? setDownloading : setExporting;
    set(true);
    try {
      const { url, filename } = kindOf === 'pdf'
        ? await api.adminTemplateStorePreviewPdfBlob(slug, { resolve: resolveTokens ? 'brackets' : 'raw', page: pageSize, cover, })
        : await api.adminTemplateStoreDocxBlob(slug, { resolve: resolveTokens ? 'brackets' : 'raw', page: pageSize });
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message || (kindOf === 'pdf' ? 'Failed to generate PDF.' : 'Failed to export Word.'));
      reportError(`TemplateEditor:download:${kindOf}`, e);
    } finally {
      set(false);
    }
  };

  const back = () => { if (unsaved) setConfirmLeave(true); else onClose(); };

  // ---- Publish state (decisions 3 and 10) ---------------------------------
  const publishedVersion = publishedOverride !== undefined ? publishedOverride
    : Number.isInteger(row?.published_version) ? row.published_version : saved?.published_version ?? null;
  const stub = saved ? templateState({ ...(row || {}), ...saved, published_version: publishedVersion }).stub : false;
  const published = (done) => {
    setDialog(null);
    if (done.mode === 'withdraw') {
      setPublishedOverride(null);
      setResult({ mode: 'withdraw' });
    } else {
      setPublishedOverride(done.publication?.version ?? V);
      setResult({ mode: 'publish', publication: done.publication });
    }
    onChanged?.();
  };

  let publishSlot = null;
  if (authoring && !isNew && saved) {
    if (stub) {
      publishSlot = result?.mode === 'withdraw' ? <span className={`text-[12.5px] ${muted}`}>Publication withdrawn.</span>
        : publishedVersion != null
          ? <button type="button" className={secondary} onClick={() => setDialog('withdraw')} data-testid="template-withdraw">Withdraw published v{publishedVersion}</button>
          : <span className={`text-[12.5px] ${muted}`}>No body in the store yet.</span>;
    } else if (unsaved) {
      publishSlot = <button type="button" className={primary} disabled data-testid="template-publish-one">Publish v{V + 1}</button>;
    } else if (publishedVersion === V) {
      publishSlot = <Pill tone="ok" data-testid="template-published-pill">Published v{V}</Pill>;
    } else {
      publishSlot = <button type="button" className={primary} onClick={() => setDialog('publish')} data-testid="template-publish-one">Publish v{V}</button>;
    }
  }

  // ---- The mirror and the panes' sync (decisions 6 and 7) -----------------
  const lines = useMemo(() => body.split('\n'), [body]);
  const sourcePane = useRef(null);
  const paperPane = useRef(null);
  const rows = useRef([]);
  const frame = useRef(null);
  const pairs = useRef(null);
  const echo = useRef(null);
  const textarea = useRef(null);

  const recompute = useCallback(() => {
    pairs.current = null;
    const src = sourcePane.current, pap = paperPane.current, iframe = frame.current;
    const wide = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)')?.matches;
    const doc = iframe?.contentDocument;
    // No sync while the Pages view or the compare shows: a PDF has no headings to align with.
    if (!src || !pap || !doc || viewVersion || paperView !== 'live' || comparing || !wide || typeof doc.querySelectorAll !== 'function') return;
    const source = sourceAnchors(lines, lines.map((_, i) => rows.current[i]?.offsetTop));
    const top = (iframe.offsetTop || 0) - (doc.documentElement?.scrollTop || 0);
    const paper = [...doc.querySelectorAll('h2.article, h2.schedule, h3.section')]
      .map(el => ({ text: el.textContent || '', y: top + el.getBoundingClientRect().top }));
    pairs.current = pairAnchors(source, paper, {
      sourceEnd: src.scrollHeight - src.clientHeight, paperEnd: pap.scrollHeight - pap.clientHeight,
    });
  }, [lines, viewVersion, paperView, comparing]);

  useEffect(() => { recompute(); }, [recompute]);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return undefined;
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [recompute]);

  const follow = (from) => () => {
    const map = pairs.current;
    if (!map || echo.current === (from === 's' ? 'p' : 's')) return;
    const [here, there] = from === 's' ? [sourcePane.current, paperPane.current] : [paperPane.current, sourcePane.current];
    if (!here || !there) return;
    echo.current = from;
    there.scrollTop = mapOffset(here.scrollTop, map, from, from === 's' ? 'p' : 's');
    const clear = () => { echo.current = null; };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(clear); else setTimeout(clear, 16);
  };

  const onFrameLoad = useCallback((iframe) => { frame.current = iframe; recompute(); }, [recompute]);
  const onDrawn = useCallback((answer) => {
    if (Array.isArray(answer?.fields)) setFields(answer.fields);
    recompute();
  }, [recompute]);

  useEffect(() => {
    if (focus === 'body' && !loading) textarea.current?.scrollIntoView?.();
  }, [focus, loading]);

  // ---- The format row (decision 4) ----------------------------------------
  let format;
  if (isNew) format = <span>Kind and Axal VC party come from the slug until the first save.</span>;
  else if (fixed) format = <span>Kind · {saved?.kind} · Axal VC party · {partyLabel(saved?.party)} · Set by the notice type</span>;
  else if (!options || !authoring) {
    const k = options ? effectiveKind : saved?.kind;
    const p = options ? (party ?? slugParty) : saved?.party;
    format = k && p ? <span>Kind · {k} · Axal VC party · {partyLabel(p)}</span> : null;
  } else {
    const kindOptions = [[null, `From the slug (${options.derived?.kind})`], ...(options.kinds || []).map(k => [k, k])];
    const partyKeys = partyless(effectiveKind) ? ['none'] : (options.parties || []).filter(p => p !== 'none');
    const partyOptions = [[null, `From the slug (${partyLabel(slugParty)})`], ...partyKeys.map(p => [p, partyLabel(p)])];
    format = <>
      <Segmented label="Kind" options={kindOptions} value={kind ?? null} onChange={k => { pickKind(k); edited(); }} />
      <Segmented label="Axal VC party" options={partyOptions} value={party ?? null} onChange={p => { setParty(p); edited(); }} />
    </>;
  }

  const crumbTitle = title || slug;
  const previewTitle = viewVersion ? viewVersion.title : title;
  // One set of paper inputs for the live paper and the Pages view (#1853 decision 8).
  const paperInputs = {
    title: previewTitle,
    body: viewVersion ? viewVersion.body_md : body,
    resolveTokens,
    version: viewVersion ? viewVersion.version : V,
    docType: isNew ? slugInput : slug,
    category: viewVersion?.category || category,
    pageSize,
    cover,
    docKind: viewVersion ? viewVersion.doc_kind ?? null : (fixed || !options ? null : kind ?? null),
    axalParty: viewVersion ? viewVersion.axal_party ?? null : (fixed || !options ? null : party ?? null),
  };
  const restoreBody = (text) => { setBody(text || ''); setComparing(false); edited(); };

  return (
    <div className="text-[#18181b] dark:text-[#f4f3f7]" data-testid="template-editor">
      {/* A. Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`text-[13px] font-semibold ${muted}`}>
          <button type="button" className={link} onClick={back} data-testid="template-editor-back">Templates</button>
          {' › '}
          {isNew ? <b className="text-[#18181b] dark:text-[#f4f3f7]">New template</b>
            : <><b className="text-[#18181b] dark:text-[#f4f3f7]">{crumbTitle}</b>{unsaved ? ` · v${V + 1} draft` : ` · v${V}`}</>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!isNew && (
            <button type="button" className={secondary} onClick={() => setShowVersions(s => !s)}>History{versions.length ? ` (${versions.length})` : ''}</button>
          )}
          {!isNew && (
            <button type="button" className={secondary} aria-pressed={comparing} onClick={() => setComparing(c => !c)} data-testid="template-compare">Compare versions</button>
          )}
          {authoring && (
            <button type="button" className={secondary} onClick={save} disabled={saving || loading} data-testid="template-save">{saving ? 'Saving…' : 'Save draft'}</button>
          )}
          {publishSlot}
        </div>
      </div>
      {authoring && !isNew && !stub && unsaved && saved && (
        <p className={`mt-1 text-right text-[12px] ${muted}`}>Save first: Publish records the saved version.</p>
      )}
      {confirmLeave && (
        <div role="alertdialog" aria-label="Leave the editor" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[12.5px] dark:border-rose-900 dark:bg-rose-950/30">
          <p>Leave without saving? The changes are not saved.</p>
          <div className="mt-2 flex gap-1.5">
            <button type="button" className={secondary} onClick={onClose}>Leave</button>
            <button type="button" className={secondary} onClick={() => setConfirmLeave(false)}>Stay</button>
          </div>
        </div>
      )}
      {result?.mode === 'publish' && (
        <div className="mt-3">
          <PublishResult publication={result.publication} version={V} usageCount={row?.usage_count} user={user} />
        </div>
      )}
      {err && <div role="alert" className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{err}</div>}

      {/* B. Details row */}
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="block text-[11px] font-semibold">Title
          <input className={`mt-1 ${input}`} value={title} readOnly={!authoring}
            onChange={e => { setTitle(e.target.value); edited(); }} placeholder="Operating Agreement" />
        </label>
        <label className="block text-[11px] font-semibold">Layer
          <select className={`mt-1 ${input}`} value={category} disabled={!authoring}
            onChange={e => { setCategory(e.target.value); edited(); }}>
            {(layers || []).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="block text-[11px] font-semibold">Slug
          <input className={`mt-1 font-mono ${input}`} value={isNew ? slugInput : slug} readOnly={!isNew}
            onChange={e => setSlugInput(e.target.value)} placeholder="operating_agreement" />
        </label>
      </div>

      {/* C. Format row */}
      <div className={`mt-3 flex flex-wrap items-center gap-[14px] text-[12px] font-semibold ${muted}`} data-testid="template-format-row">
        {format}
        <span className="hidden lg:inline">Panes scroll together</span>
      </div>

      {showVersions && !isNew && (
        <div className={`mt-3 max-h-48 overflow-y-auto ${paneCard}`}>
          <div className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wide ${muted}`}>Version history (read-only)</div>
          {versions.length === 0 ? (
            <div className={`px-4 pb-3 text-xs ${muted}`}>No prior versions yet. The first edit creates v1 history.</div>
          ) : (
            <ul className="pb-2">
              {versions.map(v => (
                <li key={v.version} className="flex items-center justify-between gap-2 px-4 py-1.5 text-xs">
                  <span>v{v.version} · {fmtDate(v.created_at) || '—'}</span>
                  <span className="flex items-center gap-2">
                    <button type="button" onClick={() => setViewVersion(v)} className={`flex items-center gap-1 ${link}`}><Eye size={11} /> View</button>
                    {authoring && <button type="button" onClick={() => { setBody(v.body_md); setViewVersion(null); setResult(null); }} className={muted}>Restore</button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* D. Three panes, or the compare in their place (#1853 decision 13) */}
      {comparing && !loading && !isNew ? (
        <div className="mt-3">
          <VersionCompare
            slug={slug}
            draft={{ title, body_md: body, doc_kind: fixed || !options ? saved?.doc_kind ?? null : kind ?? null, axal_party: fixed || !options ? saved?.axal_party ?? null : party ?? null }}
            draftChanged={unsaved}
            derived={options?.derived || null}
            partyLabel={partyLabel}
            authoring={authoring}
            onRestore={restoreBody}
          />
        </div>
      ) : loading ? (
        <div className={`mt-3 flex items-center justify-center py-16 text-sm ${muted}`}><Loader2 size={16} className="mr-2 animate-spin" /> Loading…</div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 lg:h-[calc(100vh-300px)] lg:min-h-[480px] lg:grid-cols-[minmax(0,1fr)_420px_230px]">
          {/* 1. The Markdown source */}
          <div ref={sourcePane} onScroll={follow('s')} className={`min-h-[320px] overflow-y-auto px-[14px] py-3 lg:min-h-0 ${paneCard}`}>
            {viewVersion && <p className={`mb-1 text-[11px] ${link}`}>Previewing v{viewVersion.version} →</p>}
            <div className="relative">
              <div aria-hidden="true" className={sourceText} data-testid="template-mirror">
                {lines.map((line, i) => (
                  <div key={i} ref={el => { rows.current[i] = el; }} className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-[10px]">
                    <span className={`select-none text-right ${muted}`} data-line-number="">{i + 1}</span>
                    <span><MirrorLine text={line} /></span>
                  </div>
                ))}
              </div>
              <textarea
                ref={textarea}
                value={body}
                readOnly={!authoring}
                autoFocus={focus === 'body'}
                spellCheck={false}
                aria-label="Markdown source"
                data-testid="template-body"
                onChange={e => { setBody(e.target.value); edited(); }}
                className={`absolute inset-0 h-full w-full resize-none overflow-hidden border-0 bg-transparent py-0 pl-[30px] pr-0 text-transparent caret-[#18181b] outline-none dark:caret-[#f4f3f7] ${sourceText}`} />
            </div>
          </div>

          {/* 2. The live paper — white in both themes, as the paper prints. dark-mode-exempt */}
          <div ref={paperPane} onScroll={follow('p')} className="relative min-h-[320px] overflow-y-auto rounded-xl border border-[#ececf1] bg-white lg:min-h-0 dark:border-[#2a2733]">
            <div role="group" aria-label="Middle pane" className="sticky top-0 z-10 flex gap-1 border-b border-[#ececf1] bg-white p-1.5 dark:border-[#2a2733] dark:bg-[#18161f]">
              {[['live', 'Live paper'], ['pages', 'Pages']].map(([key, text]) => (
                <button key={key} type="button" aria-pressed={paperView === key} onClick={() => setPaperView(key)} data-testid={`template-view-${key}`}
                  className={`rounded-[7px] px-[9px] py-1 text-[12px] font-semibold ${paperView === key ? 'bg-[#881337] text-white' : 'text-[#615c6e] dark:text-[#a29db0]'}`}>
                  {text}
                </button>
              ))}
            </div>
            {paperView === 'pages'
              ? <DraftPages request={paperRequest(paperInputs)} />
              : <PaperPreview {...paperInputs} onDrawn={onDrawn} onFrameLoad={onFrameLoad} />}
          </div>

          {/* 3. The merge fields (decision 5): the render answer's, in its order */}
          <div className={`overflow-y-auto p-3 ${paneCard}`} data-testid="template-merge-fields">
            <div className="text-[12px] font-extrabold">{fields ? `Merge fields · ${fields.length}` : 'Merge fields'}</div>
            {fields && fields.length === 0 && (
              <div className={`mt-2 text-[11px] ${muted}`}>None — add <code className="font-mono">{'{{field_name}}'}</code> tokens to the body.</div>
            )}
            {fields && fields.length > 0 && (
              <ul className="mt-2 text-[11.5px]">
                {fields.map(f => (
                  <li key={f.key} className="border-t border-[#ececf1] py-1.5 dark:border-[#2a2733]">
                    <div className="font-mono text-[#5b21b6] [overflow-wrap:anywhere] dark:text-violet-300">{`{{${f.key}}}`}</div>
                    <div className={muted}>{f.filled_by === 'send' ? 'Filled from the envelope' : 'Unfilled'}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* E. Footer row */}
      {confirmDelete && (
        <section role="alertdialog" aria-label="Delete template" className="mt-3 rounded-lg border border-rose-200 p-3 text-[12.5px] dark:border-rose-900">
          <p>Delete “{title || slug}”? It will be hidden from the catalogue and New envelope. Agreements already sent keep their copy.</p>
          <div className="mt-2 flex gap-1.5">
            <button type="button" className={secondary} onClick={remove} disabled={deleting || saving}>Confirm delete</button>
            <button type="button" className={secondary} onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
          </div>
        </section>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          {authoring && !isNew && (
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={deleting || saving} data-testid="template-delete"
              className="flex items-center gap-1 rounded-[9px] border border-rose-200 px-[13px] py-2 text-[12.5px] font-bold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300">
              {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select aria-label="Page size" value={pageSize} onChange={e => setPageSize(e.target.value)} data-testid="template-page-size" className={paperSelect}>
            <option value="letter">Letter</option>
            <option value="a4">A4</option>
          </select>
          <select aria-label="Cover" value={cover} onChange={e => setCover(e.target.value)} data-testid="template-cover" className={paperSelect}>
            <option value="dark">Dark cover</option>
            <option value="light">Light cover</option>
          </select>
          <label className={`flex cursor-pointer select-none items-center gap-1.5 text-[11px] ${muted}`}>
            <input type="checkbox" checked={resolveTokens} onChange={e => setResolveTokens(e.target.checked)} className="h-3 w-3 accent-[#881337]" />
            Resolve merge fields
          </label>
          {!isNew && (
            <button type="button" onClick={() => download('pdf')} disabled={downloading || saving || loading} data-testid="template-download-pdf" className={`flex items-center gap-1 ${secondary}`}>
              {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Download PDF
            </button>
          )}
          {!isNew && (
            <button type="button" onClick={() => download('docx')} disabled={exporting || saving || loading} data-testid="template-download-docx" className={`flex items-center gap-1 ${secondary}`}>
              {exporting ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Download Word
            </button>
          )}
        </div>
      </div>

      {dialog && (
        <PublishDialog mode={dialog} slug={slug} title={saved?.title || slug}
          version={dialog === 'withdraw' ? publishedVersion : V}
          onDone={published} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
