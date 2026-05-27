import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageExplainer from '../components/PageExplainer';
import { reportError } from '../lib/log';
import {
  Sparkles, Loader2, Plus, Trash2, Share2, Download,
  History, RotateCcw, ChevronLeft, ChevronRight, Lock, Wand2,
  LayoutGrid, FileText, FileCode2, Settings, X, Check,
  GripVertical, Eye, Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { downloadDeckPdf } from '../lib/deckPdf.jsx';
import { useAuth } from '../hooks/useAuthSync';
import { useToast } from '../components/useToast';
import { useEscapeClose } from '../components/useEscapeClose';

/**
 * Task #16 (DE) — Pitch Deck Builder rewrite.
 *
 * Three-rail editor:
 *  - Left: version history + slide thumbnails (drag-reorderable later).
 *  - Center: inline-editable slide (per-field editor driven by spec_id).
 *  - Right: template card + apply-method picker + export menu + brand panel.
 *
 * Premium templates show a lock badge in the picker; clicking them opens
 * the paywall instead of applying. Free-tier exports always render the
 * Axal footer; Growth+ removes it; Studio may add a custom watermark.
 */
export default function PitchDeckPage() {
  useAuth();
  const { toast, showToast } = useToast(3500);
  const addToast = (msg, kind = 'ok') => showToast({ msg, kind: kind === 'success' ? 'ok' : kind === 'error' ? 'err' : kind === 'info' ? 'info' : 'ok' });

  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [versions, setVersions] = useState([]);
  const [deck, setDeck] = useState(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [savingState, setSavingState] = useState('idle'); // idle | saving | saved

  // Method-picker + recommendation state.
  const [methods, setMethods] = useState([]);
  const [premiumIds, setPremiumIds] = useState([]);
  const [userTier, setUserTier] = useState('free');
  const [canRemoveFooter, setCanRemoveFooter] = useState(false);
  const [canUploadWatermark, setCanUploadWatermark] = useState(false);
  const [watermarkUrl, setWatermarkUrl] = useState('');
  const [recommendation, setRecommendation] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [engagement, setEngagement] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  // Task #14 — per-slide coverage_pct[] from POST /decks/:id/autofill,
  // rendered as a colored dot on each slide row in the left rail.
  const [slideConfidence, setSlideConfidence] = useState([]);
  // Task #8 — 14-cell per-slide coverage map returned by the worker's
  // axal_spinout_demoday apply-method / autofill branches. Drives the
  // green/red grid below "Fill from project"; null hides the grid.
  const [templateCoverage, setTemplateCoverage] = useState(null);
  // Real template count (sourced from the registry) for the header label.
  // Stays null until the registry resolves so we don't ship a stale number.
  const [templateCount, setTemplateCount] = useState(null);
  const [error, setError] = useState('');

  // Kick off the templates dynamic import eagerly so the header label can
  // show the true registry size and so the picker opens instantly when
  // clicked. Failure leaves templateCount null (header falls back to the
  // generic copy); the picker itself still renders the detailed error.
  useEffect(() => {
    let alive = true;
    loadTemplates().then((t) => {
      if (alive) setTemplateCount(t?.list?.length ?? null);
    });
    return () => { alive = false; };
  }, []);

  // Task #17 — Spin-Out Lab CTA deep-link. A `?method_id=<id>` query
  // param fires applyMethod(id) once after the picker's method catalog
  // loads + the active project resolves. Guarded by a ref so the auto-
  // apply only happens on the first matching render (otherwise the
  // user would be force-reapplied every time they click a slide).
  const [searchParams, setSearchParams] = useSearchParams();
  const autoAppliedRef = useRef(false);

  const saveTimer = useRef(null);

  // ---------------- bootstrap ----------------
  useEffect(() => {
    api.listProjects().then((r) => {
      const list = Array.isArray(r) ? r : (r?.projects || []);
      setProjects(list);
      if (list.length && !projectId) setProjectId(list[0].id);
    }).catch(reportError);
    api.deckMethods().then((r) => {
      setMethods(r.methods || []);
      setPremiumIds(r.premium_method_ids || []);
      setUserTier(r.user_tier || 'free');
      setCanRemoveFooter(!!r.can_remove_footer);
      setCanUploadWatermark(!!r.can_upload_watermark);
      setWatermarkUrl(r.watermark_url || '');
    }).catch(reportError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setShareUrl(''); setError(''); setExportMenuOpen(false);
    (async () => {
      try {
        const r = await api.deckListVersions(projectId);
        const list = Array.isArray(r) ? r : (r?.versions || []);
        setVersions(list);
        if (list.length) {
          const head = await api.deckGet(list[0].id);
          setDeck(head?.deck || head);
          setActiveIdx(0);
        } else {
          setDeck(null); setActiveIdx(0);
        }
        // Recommendation (per project).
        try {
          const rec = await api.deckRecommend(projectId);
          setRecommendation(rec);
        } catch { setRecommendation(null); }
      } catch (e) { setError(e.message || 'Failed to load decks'); reportError(e); }
    })();
  }, [projectId]);

  // Task #17 — Auto-apply a template from the URL once everything is
  // ready. Fires when (a) we know which methods exist, (b) the
  // requested id is a valid one the user can apply, (c) a project is
  // selected. We then strip the query param so a back/forward doesn't
  // re-trigger. If the method is gated, applyMethod() surfaces the 402
  // toast — same path as a manual click in the picker.
  useEffect(() => {
    if (autoAppliedRef.current) return;
    if (!methods.length || !projectId) return;
    const wanted = searchParams.get('method_id');
    if (!wanted) return;
    const found = methods.find((m) => m.id === wanted);
    if (!found) return;
    autoAppliedRef.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete('method_id');
    setSearchParams(next, { replace: true });
    applyMethod(wanted);
    // applyMethod is defined later in the component; we intentionally
    // depend only on the trigger inputs to avoid re-firing on every
    // render. eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methods, projectId, searchParams]);

  const slides = useMemo(() => {
    try {
      const raw = deck?.slides;
      if (!raw) return [];
      if (typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      }
      return Array.isArray(raw) ? raw : [];
    } catch (err) {
      // Don't silently swallow — log so a corrupted slides blob is visible
      // in the console rather than appearing as an empty deck.
      console.error('PitchDeckPage: failed to parse deck.slides', err);
      return [];
    }
  }, [deck]);

  const activeSlide = slides[activeIdx] || null;
  const activeMethodId = activeSlide?.method_id || null;
  const activeMethod = useMemo(
    () => methods.find((m) => m.id === activeMethodId) || null,
    [methods, activeMethodId],
  );

  // ---------------- save (debounced) ----------------
  const scheduleSave = (nextSlides, nextTitle) => {
    if (!deck?.id) return;
    setSavingState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const r = await api.deckUpdate(deck.id, {
          slides: nextSlides, title: nextTitle ?? deck.title,
        });
        setDeck(r?.deck || r);
        setSavingState('saved');
        const refreshed = await api.deckListVersions(projectId);
        setVersions(Array.isArray(refreshed) ? refreshed : (refreshed?.versions || []));
        setTimeout(() => setSavingState('idle'), 1200);
      } catch (e) {
        setError(e.message || 'Save failed'); setSavingState('idle');
      }
    }, 700);
  };

  const updateField = (fieldKey, value) => {
    const next = slides.map((s, i) => {
      if (i !== activeIdx) return s;
      if (Array.isArray(s.fields)) {
        return {
          ...s,
          fields: s.fields.map((f) =>
            f.key === fieldKey ? { ...f, value, source: 'data', edited: true } : f,
          ),
        };
      }
      // Legacy slide shape.
      return { ...s, [fieldKey]: value };
    });
    setDeck({ ...deck, slides: next });
    scheduleSave(next);
  };

  const updateTitle = (value) => {
    const next = slides.map((s, i) => i === activeIdx ? { ...s, title: value } : s);
    setDeck({ ...deck, slides: next });
    scheduleSave(next);
  };

  const addSlide = () => {
    const next = [...slides, {
      title: 'New slide', subtitle: '', spec_id: 'custom',
      fields: [
        { key: 'title', label: 'Headline', kind: 'title', value: 'New slide', source: 'data' },
        { key: 'body', label: 'Body', kind: 'paragraph', value: '', source: 'placeholder' },
      ],
    }];
    setDeck({ ...deck, slides: next });
    setActiveIdx(next.length - 1);
    scheduleSave(next);
  };

  const removeSlide = (idx) => {
    if (slides.length <= 1) return;
    const next = slides.filter((_, i) => i !== idx);
    setDeck({ ...deck, slides: next });
    setActiveIdx(Math.max(0, idx - 1));
    scheduleSave(next);
  };

  // Task #16 — drag-to-reorder slide thumbnails. Persisted via the same
  // debounced autosave path so versions/restore see the new order.
  const moveSlide = (from, to) => {
    if (from === to || from < 0 || to < 0 || from >= slides.length || to >= slides.length) return;
    const next = slides.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDeck({ ...deck, slides: next });
    setActiveIdx(to);
    scheduleSave(next);
  };

  // ---------------- method picker actions ----------------
  const applyMethod = async (methodId) => {
    if (!projectId) { addToast('Pick a project first', 'error'); return; }
    setPickerOpen(false); setBusy(true);
    try {
      const r = await api.deckApplyMethod(projectId, methodId);
      setDeck(r?.deck || r);
      setActiveIdx(0);
      setSlideConfidence([]);
      setTemplateCoverage(Array.isArray(r?.coverage) ? r.coverage : null);
      const refreshed = await api.deckListVersions(projectId);
      setVersions(Array.isArray(refreshed) ? refreshed : (refreshed?.versions || []));
      addToast(`Applied ${methods.find((m) => m.id === methodId)?.label || 'template'} (${r.coverage_pct || 0}% auto-filled)`, 'success');
    } catch (e) {
      if (e.status === 402) {
        addToast('That template is on the Growth plan — upgrade to unlock.', 'info');
      } else {
        setError(e.message || 'Failed to apply method'); reportError(e);
      }
    } finally { setBusy(false); }
  };

  // ---------------- Task #14 — Fill from project ----------------
  // POST /api/decks/:id/autofill returns the deck + a per-slide
  // coverage_pct[] used by the confidence rail in the slide list.
  // Cleared by applyMethod / version restore so stale values don't
  // bleed across deck swaps.
  const fillFromProject = async () => {
    if (!deck?.id) { addToast('No deck loaded', 'error'); return; }
    setBusy(true);
    try {
      const r = await api.deckAutofill(deck.id);
      setDeck(r?.deck || deck);
      setSlideConfidence(Array.isArray(r?.slide_confidence) ? r.slide_confidence : []);
      setTemplateCoverage(Array.isArray(r?.coverage) ? r.coverage : null);
      addToast(`Refilled from project (${r?.coverage_pct ?? 0}% covered)`, 'success');
    } catch (e) {
      if (e.status === 409 || /no_method_id/i.test(e.message || '')) {
        addToast('Pick a template first — then refill.', 'info');
        setPickerOpen(true);
      } else if (e.status === 402) {
        addToast('That template is on the Growth plan — upgrade to unlock.', 'info');
      } else {
        setError(e.message || 'Refill failed'); reportError(e);
      }
    } finally { setBusy(false); }
  };

  // ---------------- export ----------------
  const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const onExport = async (format) => {
    if (!deck?.id) return;
    setExporting(format); setExportMenuOpen(false);
    try {
      const r = await api.deckExport(deck.id, format);
      if (!r.ok) {
        // Server may signal client-fallback for missing browser binding (dev).
        if (r.status === 503 && format === 'pdf') {
          addToast('Server PDF unavailable — using client renderer.', 'info');
          await downloadDeckPdf({ title: deck.title, slides });
          return;
        }
        if (r.status === 503) {
          addToast(`Server ${format.toUpperCase()} export unavailable in this environment.`, 'error');
          return;
        }
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Export failed (${r.status})`);
      }
      const blob = await r.blob();
      // Task #2 — PNG cover was removed; only pdf + pptx remain.
      const ext = format === 'pptx' ? 'pptx' : 'pdf';
      const fname = (deck.title || 'pitch-deck').replace(/[^A-Za-z0-9_-]+/g, '-') + '.' + ext;
      downloadBlob(blob, fname);
      addToast(`Exported ${format.toUpperCase()}`, 'success');
    } catch (e) {
      setError(e.message || 'Export failed'); reportError(e);
    } finally { setExporting(''); }
  };

  // ---------------- share + restore ----------------
  const onShare = async () => {
    if (!deck?.id) return;
    try {
      // Task #53 — canonical share URL shape is /share/deck/<token>.
      // Server returns share_path in the new shape; older clients fall
      // back to legacy /deck/share/<token>.
      const r = await api.deckShare(deck.id, { expires_in_hours: 24, view_limit: 1 });
      const path = r?.share_path || (r?.token && `/share/deck/${r.token}`);
      const url = r?.url || (path && `${window.location.origin}${path}`);
      setShareUrl(url || '');
      if (url && navigator.clipboard) {
        await navigator.clipboard.writeText(url).catch(() => {});
        addToast('Share link copied to clipboard.', 'success');
      }
      // Refresh engagement so the new share row shows up in the panel.
      api.deckEngagement(deck.id).then(setEngagement).catch(() => {});
    } catch (e) { setError(e.message || 'Share failed'); }
  };

  // Task #53 — load engagement stats whenever the active deck changes.
  useEffect(() => {
    if (!deck?.id) { setEngagement(null); return; }
    let alive = true;
    api.deckEngagement(deck.id)
      .then((r) => { if (alive) setEngagement(r); })
      .catch(() => { if (alive) setEngagement(null); });
    return () => { alive = false; };
  }, [deck?.id]);

  const onRestore = async (id) => {
    try {
      const r = await api.deckRestore(id);
      setDeck(r?.deck || r);
      const refreshed = await api.deckListVersions(projectId);
      setVersions(Array.isArray(refreshed) ? refreshed : (refreshed?.versions || []));
      setActiveIdx(0);
      // Stale coverage from a different version would lie about what
      // populates — clear and let the next "Fill from project" repopulate.
      setTemplateCoverage(null);
    } catch (e) { setError(e.message || 'Restore failed'); }
  };

  // ----------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 dark:text-slate-100">
      <div className="max-w-[1500px] mx-auto px-4 py-6">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-violet-600" /> Pitch Deck Builder
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {templateCount != null
                ? `${templateCount} templates, auto-filled from your project, financials, and cap table.`
                : 'Templates auto-fill from your project, financials, and cap table.'}
            </p>
          </div>
          <PageExplainer page="pitch_deck" />
        </header>

        {/* Project picker + recommendation banner */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select
            className="border rounded px-3 py-2 bg-white dark:bg-slate-900 dark:border-slate-700"
            value={projectId || ''}
            onChange={(e) => setProjectId(parseInt(e.target.value) || null)}
          >
            <option value="">Pick a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {recommendation && (
            <div className="text-sm text-gray-600 dark:text-slate-400 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900 rounded px-3 py-2 flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-violet-600" />
              Suggested: <span className="font-medium">{methods.find((m) => m.id === recommendation.method_id)?.label || recommendation.method_id}</span>
              <button
                onClick={() => applyMethod(recommendation.method_id)}
                className="ml-2 px-2 py-0.5 text-xs bg-violet-600 text-white rounded hover:bg-violet-700"
              >Use</button>
            </div>
          )}
          <button
            onClick={() => setPickerOpen(true)}
            disabled={!projectId}
            className="ml-auto px-3 py-2 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2"
          >
            <LayoutGrid className="w-4 h-4" /> Pick template
          </button>
          {/* Task #14 — refill the current deck from project data without
              creating a new version. 409 (no_method_id) re-opens the
              picker so the user can choose a template first. */}
          <button
            onClick={fillFromProject}
            disabled={!deck?.id || busy}
            className="px-3 py-2 border border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-300 rounded hover:bg-violet-50 dark:hover:bg-violet-950/40 disabled:opacity-50 flex items-center gap-2"
            title="Re-run autofill against this project's current data"
          >
            <Wand2 className="w-4 h-4" /> Fill from project
          </button>
        </div>

        {/* Task #8 — 14-cell coverage grid, axal_spinout_demoday only.
            One card per slide: green/red dot · source table · count badge.
            Other templates keep their existing single-line UX (none). */}
        {activeMethodId === 'axal_spinout_demoday' && Array.isArray(templateCoverage) && templateCoverage.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400 font-medium">
                Fill-from-project coverage · {templateCoverage.filter((c) => c.has).length}/{templateCoverage.length} slides will populate
              </div>
              <div className="text-[11px] text-gray-400 dark:text-slate-500">
                Red dot = open the matching Lab tool before pitching.
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
              {templateCoverage.map((cell) => (
                <div
                  key={cell.spec_id}
                  className={`rounded-lg border p-2.5 text-left transition ${
                    cell.has
                      ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20'
                      : 'border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20'
                  }`}
                  title={`${cell.title} · ${cell.source}`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      aria-hidden="true"
                      className={`inline-block w-2 h-2 rounded-full ${
                        cell.has ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                    <span className="text-[12px] font-semibold text-gray-900 dark:text-slate-100 truncate">
                      {cell.title}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-gray-500 dark:text-slate-400 truncate">
                    {cell.source}
                  </div>
                  <div className={`text-[11px] mt-1 truncate ${
                    cell.has ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
                  }`}>
                    {cell.count_label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 rounded text-sm">
            {error}
          </div>
        )}

        {!deck && (
          <div className="bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-800 p-10 text-center" data-card>
            <LayoutGrid className="w-10 h-10 text-violet-400 mx-auto mb-3" />
            <h3 className="font-medium mb-1">Start your deck</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              {projectId
                ? 'No deck yet — pick a template to auto-fill from your project data.'
                : 'Pick a project above, then choose a template.'}
            </p>
            {projectId && (
              <button
                onClick={() => setPickerOpen(true)}
                className="px-4 py-2 bg-violet-600 text-white rounded hover:bg-violet-700"
              >Pick template</button>
            )}
          </div>
        )}

        {deck && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* LEFT — slides + history */}
            <div className="col-span-1 lg:col-span-3 space-y-3">
              <div className="bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-800 p-3" data-card>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Slides</span>
                  <button
                    onClick={addSlide}
                    className="p-1 text-gray-500 hover:text-violet-600"
                    title="Add slide"
                  ><Plus className="w-4 h-4" /></button>
                </div>
                <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                  {slides.map((s, i) => (
                    <div
                      key={i}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(i));
                        setDragIdx(i);
                      }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIdx(i); }}
                      onDragLeave={() => setDragOverIdx((v) => (v === i ? null : v))}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = Number(e.dataTransfer.getData('text/plain'));
                        moveSlide(from, i);
                        setDragIdx(null); setDragOverIdx(null);
                      }}
                      onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                      onClick={() => setActiveIdx(i)}
                      className={`group cursor-grab active:cursor-grabbing w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 select-none ${
                        i === activeIdx
                          ? 'bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
                          : 'hover:bg-gray-100 dark:hover:bg-slate-800'
                      } ${dragIdx === i ? 'opacity-40' : ''} ${dragOverIdx === i && dragIdx !== i ? 'ring-2 ring-violet-400' : ''}`}
                      title="Drag to reorder"
                    >
                      <GripVertical className="w-3 h-3 text-gray-300 group-hover:text-gray-500 shrink-0" />
                      <span className="w-5 text-gray-400">{i + 1}</span>
                      <span className="flex-1 truncate">{s.title || 'Untitled'}</span>
                      {/* Task #14 — coverage dot. Green ≥70%, amber 30-69%,
                          red <30%. Tooltip surfaces the exact %. */}
                      {slideConfidence[i] && typeof slideConfidence[i].coverage_pct === 'number' && (
                        <span
                          title={`Auto-filled ${slideConfidence[i].coverage_pct}%`}
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            slideConfidence[i].coverage_pct >= 70 ? 'bg-emerald-500'
                            : slideConfidence[i].coverage_pct >= 30 ? 'bg-amber-500'
                            : 'bg-red-500'
                          }`}
                        />
                      )}
                      {s.appendix && <span className="text-[10px] text-gray-400">apx</span>}
                      <Trash2
                        className="w-3 h-3 text-gray-300 hover:text-red-500"
                        onClick={(e) => { e.stopPropagation(); removeSlide(i); }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-800 p-3" data-card>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2 flex items-center gap-1">
                  <History className="w-3 h-3" /> Versions
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {versions.map((v) => (
                    <div key={v.id} className="flex items-center justify-between text-xs">
                      <button
                        onClick={async () => {
                          const r = await api.deckGet(v.id);
                          setDeck(r?.deck || r); setActiveIdx(0);
                        }}
                        className="text-violet-600 hover:underline truncate"
                      >v{v.version || v.id}</button>
                      <button onClick={() => onRestore(v.id)} className="p-1 text-gray-400 hover:text-violet-600">
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* CENTER — slide editor */}
            <div className="col-span-1 lg:col-span-6">
              <div className="bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-800 p-6 min-h-[60vh]" data-card>
                <div className="flex items-center justify-between mb-3 text-xs text-gray-500 dark:text-slate-400">
                  <span>Slide {activeIdx + 1} / {slides.length}</span>
                  <span>{savingState === 'saving' ? 'Saving…' : savingState === 'saved' ? 'Saved' : ''}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setActiveIdx(Math.max(0, activeIdx - 1))}
                      disabled={activeIdx === 0}
                      className="p-1 disabled:opacity-30"
                    ><ChevronLeft className="w-4 h-4" /></button>
                    <button
                      onClick={() => setActiveIdx(Math.min(slides.length - 1, activeIdx + 1))}
                      disabled={activeIdx >= slides.length - 1}
                      className="p-1 disabled:opacity-30"
                    ><ChevronRight className="w-4 h-4" /></button>
                  </div>
                </div>
                {activeSlide && (
                  <SlideEditor
                    slide={activeSlide}
                    onTitle={updateTitle}
                    onField={updateField}
                  />
                )}
              </div>
            </div>

            {/* RIGHT — template card + export + brand */}
            <div className="col-span-1 lg:col-span-3 space-y-3">
              <div className="bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-800 p-3" data-card>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Template</div>
                <div className="font-medium text-sm mb-1">
                  {activeMethod?.label || (activeMethodId ? activeMethodId : 'Custom')}
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
                  {activeMethod?.best_for || 'A custom deck — pick a template to autofill.'}
                </p>
                <button
                  onClick={() => setPickerOpen(true)}
                  className="w-full px-2 py-1.5 text-xs border border-violet-200 dark:border-violet-900 text-violet-600 rounded hover:bg-violet-50 dark:hover:bg-violet-950/30"
                >Change template</button>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-800 p-3 relative" data-card>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Export</div>
                <button
                  onClick={() => setExportMenuOpen((v) => !v)}
                  disabled={!!exporting || !deck?.id}
                  className="w-full px-2 py-1.5 text-sm bg-slate-900 text-white dark:bg-violet-600 rounded hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {exporting
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Exporting…</>
                    : <><Download className="w-4 h-4" /> Download</>}
                </button>
                {exportMenuOpen && (
                  <div className="absolute right-3 top-16 z-10 bg-white dark:bg-slate-900 border dark:border-slate-700 rounded shadow-lg w-40">
                    <button onClick={() => onExport('pdf')} className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-red-500" /> PDF
                    </button>
                    <button onClick={() => onExport('pptx')} className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-2">
                      <FileCode2 className="w-4 h-4 text-orange-500" /> PowerPoint
                    </button>
                  </div>
                )}
                <button
                  onClick={onShare}
                  className="w-full mt-2 px-2 py-1.5 text-sm border dark:border-slate-700 rounded flex items-center justify-center gap-2 hover:bg-gray-50 dark:hover:bg-slate-800"
                >
                  <Share2 className="w-4 h-4" /> One-time share link
                </button>
                {shareUrl && (
                  <div className="mt-2 text-[11px] break-all text-gray-500 dark:text-slate-400">
                    {shareUrl}
                  </div>
                )}
              </div>

              {/* Task #53 — Engagement panel: shows aggregate views,
                  read-time, and a recent-impressions list (hashed). */}
              <EngagementPanel data={engagement} />

              <div className="bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-800 p-3" data-card>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2 flex items-center gap-1">
                  <Settings className="w-3 h-3" /> Branding
                </div>
                <div className="text-xs text-gray-600 dark:text-slate-400 mb-2">
                  Plan: <span className="font-medium capitalize">{userTier}</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-slate-500 mb-2">
                  {canRemoveFooter
                    ? 'Axal footer hidden on exports.'
                    : 'Axal footer shown on free plan exports.'}
                </div>
                {canUploadWatermark ? (
                  <WatermarkEditor
                    initial={watermarkUrl}
                    onSave={async (url) => {
                      try {
                        const r = await api.deckSetWatermark(url);
                        setWatermarkUrl(r?.brand?.watermark_url || '');
                        addToast(url ? 'Watermark saved' : 'Watermark cleared', 'success');
                      } catch (e) { setError(e.message || 'Failed'); }
                    }}
                  />
                ) : (
                  <p className="text-[11px] text-gray-400 dark:text-slate-500">Studio plan adds a custom watermark.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {pickerOpen && (
        <MethodPicker
          methods={methods}
          premiumIds={premiumIds}
          recommendation={recommendation}
          onClose={() => setPickerOpen(false)}
          onPick={applyMethod}
          busy={busy}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg shadow-lg text-sm ${
          toast.kind === 'ok' ? 'bg-emerald-600 text-white'
          : toast.kind === 'err' ? 'bg-red-600 text-white'
          : 'bg-slate-800 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Slide editor — renders one editable field per slide.fields entry.
// Falls back to legacy {title, body, bullets} shape if no fields[].
// =====================================================================
function SlideEditor({ slide, onTitle, onField }) {
  const fields = Array.isArray(slide.fields) && slide.fields.length
    ? slide.fields
    : legacyToFields(slide);

  return (
    <div className="space-y-4">
      <input
        className="w-full text-2xl font-semibold bg-transparent border-b border-gray-200 dark:border-slate-700 focus:border-violet-400 outline-none py-1"
        value={slide.title || ''}
        onChange={(e) => onTitle(e.target.value)}
        placeholder="Slide title"
      />
      {slide.subtitle != null && (
        <div className="text-sm text-violet-600">{slide.subtitle}</div>
      )}
      {fields.map((f) => (
        <FieldEditor key={f.key} field={f} onChange={(v) => onField(f.key, v)} />
      ))}
    </div>
  );
}

function legacyToFields(s) {
  const out = [];
  if (s.body !== undefined) out.push({ key: 'body', label: 'Body', kind: 'paragraph', value: s.body, source: 'data' });
  if (Array.isArray(s.bullets)) out.push({ key: 'bullets', label: 'Bullets', kind: 'bullets', value: s.bullets, source: 'data' });
  if (s.image_url !== undefined) out.push({ key: 'image_url', label: 'Image URL', kind: 'image', value: s.image_url, source: 'data' });
  return out;
}

function FieldEditor({ field, onChange }) {
  const sourceBadge = field.source === 'ai'
    ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">AI</span>
    : field.source === 'placeholder'
      ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Fill in</span>
      : null;

  const label = (
    <div className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1 flex items-center">
      {field.label}
      {sourceBadge}
    </div>
  );

  if (field.kind === 'bullets') {
    const arr = Array.isArray(field.value) ? field.value : (field.value ? [field.value] : []);
    return (
      <div>
        {label}
        <textarea
          className="w-full border rounded px-3 py-2 bg-white dark:bg-slate-950 dark:border-slate-700 text-sm"
          rows={Math.max(3, arr.length)}
          value={arr.join('\n')}
          onChange={(e) => onChange(e.target.value.split('\n').filter(Boolean))}
          placeholder="One bullet per line"
        />
      </div>
    );
  }

  if (field.kind === 'metric_grid') {
    const cells = Array.isArray(field.value) ? field.value : [];
    return (
      <div>
        {label}
        {cells.length === 0 && (
          <div className="text-xs text-gray-400 italic">No metrics resolved — open Financials to fill in.</div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {cells.map((c, i) => (
            <div key={i} className="border rounded p-2 dark:border-slate-700">
              <input
                className="w-full text-xs font-medium bg-transparent outline-none mb-1"
                value={c.label}
                onChange={(e) => {
                  const next = cells.slice();
                  next[i] = { ...c, label: e.target.value };
                  onChange(next);
                }}
              />
              <input
                className="w-full text-base font-bold bg-transparent outline-none"
                value={c.value}
                onChange={(e) => {
                  const next = cells.slice();
                  next[i] = { ...c, value: e.target.value };
                  onChange(next);
                }}
              />
            </div>
          ))}
          <button
            onClick={() => onChange([...cells, { label: 'New metric', value: '' }])}
            className="border-2 border-dashed dark:border-slate-700 rounded p-2 text-xs text-gray-400 hover:text-violet-600"
          >+ Add metric</button>
        </div>
      </div>
    );
  }

  if (field.kind === 'image') {
    return (
      <div>
        {label}
        <input
          className="w-full border rounded px-3 py-2 bg-white dark:bg-slate-950 dark:border-slate-700 text-sm"
          value={field.value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://… (image URL)"
        />
        {field.value && (
          <img src={field.value} alt="" className="mt-2 max-h-40 object-contain rounded" />
        )}
      </div>
    );
  }

  if (field.kind === 'title' || field.kind === 'subtitle') {
    return (
      <div>
        {label}
        <input
          className={`w-full border rounded px-3 py-2 bg-white dark:bg-slate-950 dark:border-slate-700 ${field.kind === 'title' ? 'text-lg font-semibold' : 'text-sm'}`}
          value={field.value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div>
      {label}
      <textarea
        className="w-full border rounded px-3 py-2 bg-white dark:bg-slate-950 dark:border-slate-700 text-sm"
        rows={field.kind === 'paragraph' ? 4 : 2}
        value={field.value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// =====================================================================
// Method picker modal — 12-template grid with locked badges.
//
// Iterates the static TEMPLATE_LIST from the deck registry (single source
// of truth), not the `/api/decks/methods` payload. Merges per-method
// metadata (category, premium/locked, best_for, prompt_hint, recommendation)
// by joining on `template.key === method.id`. This means the grid always
// renders 12 thumbnails even if the methods API is slow, partial, or its
// id-namespace ever drifts from the registry keys.
//
// Each card renders the actual template Component via <Thumbnail>, which
// owns the bounded 320x180 box, the scaled 1920x1080 inner viewport, and
// a per-card React error boundary so one broken template can't blank the
// whole grid.
//
// The templates module is code-split via a one-shot dynamic import so it
// only loads when the picker opens (keeps it out of the main bundle).
// =====================================================================
let _templatesPromise = null;
function loadTemplates() {
  if (!_templatesPromise) {
    _templatesPromise = import('../decks/templates')
      .then((m) => {
        // Some bundler/interop combos wrap the namespace object so the
        // named exports show up on `m.default` instead of `m`. Accept
        // either shape rather than silently rendering "0 templates".
        const ns = m && typeof m === 'object' ? (m.TEMPLATE_LIST || m.TEMPLATES ? m : (m.default || m)) : m;
        const list = Array.isArray(ns?.TEMPLATE_LIST)
          ? ns.TEMPLATE_LIST
          : (ns?.TEMPLATES ? Object.values(ns.TEMPLATES) : []);
        const record = ns?.TEMPLATES || (list.length
          ? Object.fromEntries(list.map((t) => [t.key, t]))
          : {});
        if (!list.length) {
          // Bubble up a real diagnostic so the empty state can show
          // *why* instead of just "registry returned 0 entries".
           
          console.warn('[decks/templates] dynamic import resolved with no templates', {
            namespaceKeys: m ? Object.keys(m) : [],
            innerKeys: ns && ns !== m ? Object.keys(ns) : [],
          });
          return { list: [], record: {}, error: new Error('templates_module_empty') };
        }
        return { list, record };
      })
      .catch((err) => {
        // Reset so a transient failure (e.g. network blip) can retry next open.
        _templatesPromise = null;
        reportError(err);
        return { list: [], record: {}, error: err };
      });
  }
  return _templatesPromise;
}

function retryLoadTemplates() {
  _templatesPromise = null;
  return loadTemplates();
}

let _thumbnailModulePromise = null;
function loadThumbnailModule() {
  if (!_thumbnailModulePromise) {
    _thumbnailModulePromise = import('../decks/Thumbnail').catch((err) => {
      _thumbnailModulePromise = null;
      reportError(err);
      return null;
    });
  }
  return _thumbnailModulePromise;
}

// =====================================================================
// Template preview modal — opens a large readable rendering of a single
// template without picking it. Page through slides with prev/next or the
// keyboard; "Use this template" delegates to the picker's onPick (and is
// disabled for locked templates, mirroring the picker grid rule).
// =====================================================================
function TemplatePreviewModal({ card, PreviewStage, onClose, onPick, busy }) {
  useEscapeClose(onClose);
  const [idx, setIdx] = useState(0);
  const slideCount = Math.max(1, card.slide_count || 1);
  const scrollerRef = useRef(null);

  const registerScroller = React.useCallback((el) => {
    scrollerRef.current = el;
  }, []);

  // Programmatic prev/next — scroll by exactly one slide height.
  const goTo = (next) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const clamped = Math.max(0, Math.min(slideCount - 1, next));
    const slideH = scroller.scrollHeight / slideCount;
    scroller.scrollTo({ top: slideH * clamped, behavior: 'smooth' });
    setIdx(clamped);
  };

  // Keyboard navigation while the modal owns focus.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goTo(idx + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goTo(idx - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        goTo(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        goTo(slideCount - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
     
  }, [idx, slideCount]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview: ${card.label}`}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="font-semibold truncate">{card.label}</h2>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              <span className="uppercase">{card.category}</span> · {slideCount} slide{slideCount === 1 ? '' : 's'}
              {card.premium && <span className="ml-2 text-amber-700 dark:text-amber-300">· Premium</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-500 hover:text-gray-800 dark:hover:text-slate-200"
            aria-label="Close preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-gray-100 dark:bg-slate-950 p-3 sm:p-4 flex items-center justify-center">
          {PreviewStage ? (
            <div style={{ width: '100%', height: '100%', maxHeight: '70vh' }}>
              <div style={{ width: '100%', aspectRatio: '16 / 9', maxHeight: '100%', margin: '0 auto' }}>
                <PreviewStage
                  template={card.template}
                  slideCount={slideCount}
                  currentIndex={idx}
                  onIndexChange={setIdx}
                  registerScroller={registerScroller}
                />
              </div>
            </div>
          ) : (
            <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
          )}
        </div>

        <div className="border-t dark:border-slate-800 px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              onClick={() => goTo(idx - 1)}
              disabled={idx <= 0}
              className="p-1.5 border dark:border-slate-700 rounded disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800"
              aria-label="Previous slide"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-600 dark:text-slate-400 tabular-nums">
              {idx + 1} / {slideCount}
            </span>
            <button
              onClick={() => goTo(idx + 1)}
              disabled={idx >= slideCount - 1}
              className="p-1.5 border dark:border-slate-700 rounded disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800"
              aria-label="Next slide"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            {card.locked && (
              <span className="text-[11px] text-amber-700 dark:text-amber-300">
                Upgrade to Growth to unlock this template.
              </span>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm border dark:border-slate-700 rounded hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              Close
            </button>
            <button
              onClick={() => onPick(card.key)}
              disabled={card.locked || busy}
              className={`px-4 py-1.5 text-sm rounded text-white flex items-center gap-1 ${
                card.locked || busy
                  ? 'bg-gray-300 dark:bg-slate-700 cursor-not-allowed'
                  : 'bg-violet-600 hover:bg-violet-700'
              }`}
            >
              {card.locked && <Lock className="w-3 h-3" />}
              Use this template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MethodPicker({ methods, premiumIds, recommendation, onClose, onPick, busy }) {
  const [filter, setFilter] = useState('all');
  const [templates, setTemplates] = useState(null); // { list, record, error? } | null
  const [Thumbnail, setThumbnail] = useState(null);
  const [PreviewStage, setPreviewStage] = useState(null);
  const [previewCard, setPreviewCard] = useState(null);
  // Suspend the picker's Esc handler while the preview modal is open so
  // a single Esc only closes the topmost modal. The preview owns Esc
  // until it closes, then control returns to the picker.
  useEscapeClose(previewCard ? null : onClose);
  useEffect(() => {
    let alive = true;
    loadTemplates().then((t) => { if (alive) setTemplates(t); });
    loadThumbnailModule().then((m) => {
      if (alive && m) {
        setThumbnail(() => m.Thumbnail);
        setPreviewStage(() => m.PreviewStage);
      }
    });
    return () => { alive = false; };
  }, []);

  // Merge: registry is source of truth for the 12 cards; methods API
  // contributes per-method UX metadata when the ids match.
  const methodById = useMemo(() => {
    const map = new Map();
    for (const m of methods || []) map.set(m.id, m);
    return map;
  }, [methods]);

  const cards = useMemo(() => {
    const list = templates?.list || [];
    return list.map((tpl) => {
      const m = methodById.get(tpl.key) || {};
      // Backend is the single source of truth for paywall — registry
      // `required_tier` is display metadata only, never feeds locked/premium.
      const premium = !!m.premium;
      const locked = !!m.locked;
      return {
        key: tpl.key,
        template: tpl,
        label: m.label || tpl.label,
        description: m.prompt_hint || tpl.description,
        best_for: m.best_for || '',
        category: m.category || tpl.category || 'general',
        slide_count: m.slide_count ?? tpl.slide_count,
        premium,
        locked,
        isRec: recommendation?.method_id === tpl.key,
      };
    });
  }, [templates, methodById, premiumIds, recommendation]);

  const filtered = useMemo(
    () => cards.filter((c) => filter === 'all' || c.category === filter),
    [cards, filter],
  );

  const registryLoaded = templates !== null;
  const registryEmpty = registryLoaded && cards.length === 0;
  const registryError = templates?.error;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div
        className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b dark:border-slate-800">
          <div>
            <h2 className="font-semibold">Pick a deck template</h2>
            <p className="text-xs text-gray-500 dark:text-slate-400">{(templates?.list?.length ?? 0)} methods — your data auto-fills, AI fills the gaps.</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-800 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-2 border-b dark:border-slate-800 flex gap-2 text-xs">
          {['all', 'fundraising', 'commercial', 'event'].map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`px-2 py-1 rounded capitalize ${filter === c ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-slate-800'}`}
            >{c}</button>
          ))}
        </div>

        {!registryLoaded && (
          <div className="p-10 flex items-center justify-center text-sm text-gray-500 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading templates…
          </div>
        )}

        {registryEmpty && (
          <div className="p-10 text-center text-sm">
            <div className="font-medium text-red-600 mb-1">No templates registered</div>
            <div className="text-gray-500 dark:text-slate-400 text-xs">
              {registryError
                ? `Couldn't load the deck template registry: ${registryError?.message || 'unknown error'}. Open DevTools console for the full stack.`
                : 'Check frontend/src/decks/templates/index.ts — the registry returned 0 entries.'}
            </div>
            <button
              onClick={() => {
                setTemplates(null);
                retryLoadTemplates().then((t) => setTemplates(t));
              }}
              className="mt-3 px-3 py-1.5 text-xs rounded bg-violet-600 text-white hover:bg-violet-700"
            >Retry</button>
          </div>
        )}

        {registryLoaded && !registryEmpty && (
          <div className="overflow-y-auto p-3 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((c) => (
              <div
                key={c.key}
                className={`group relative text-left border rounded-lg p-4 transition flex flex-col ${
                  c.locked
                    ? 'border-gray-200 dark:border-slate-800 opacity-80'
                    : 'border-gray-200 dark:border-slate-800 hover:border-violet-400 hover:shadow'
                }`}
              >
                {c.isRec && (
                  <span className="absolute -top-2 -right-2 z-20 bg-violet-600 text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Wand2 className="w-3 h-3" /> Suggested
                  </span>
                )}
                {c.premium && (
                  <span className="absolute top-2 right-2 z-20 text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 px-1.5 py-0.5 rounded flex items-center gap-1">
                    {c.locked && <Lock className="w-3 h-3" />} Premium
                  </span>
                )}
                {/* Thumbnail + Preview overlay. The thumbnail itself is
                    purely decorative; the card body below it is the pick
                    target. Preview button sits over the thumbnail and
                    stops propagation so it never picks the card. */}
                <div className="relative mb-3 rounded overflow-hidden">
                  {Thumbnail
                    ? <Thumbnail template={c.template} />
                    : <div style={{ width: '100%', aspectRatio: '16 / 9', background: '#F1F5F9', borderRadius: 6 }} />}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setPreviewCard(c); }}
                    aria-label={`Preview ${c.label}`}
                    className="absolute inset-0 flex items-center justify-center text-white text-xs font-medium bg-black/0 opacity-0 group-hover:bg-black/45 group-hover:opacity-100 focus-visible:bg-black/45 focus-visible:opacity-100 transition rounded"
                  >
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/15 backdrop-blur-sm rounded ring-1 ring-white/40">
                      <Eye className="w-3.5 h-3.5" /> Preview
                    </span>
                  </button>
                  {/* Always-visible Preview chip for touch devices (no
                      hover state) — sits in the bottom-right corner. */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setPreviewCard(c); }}
                    aria-label={`Preview ${c.label}`}
                    className="md:hidden absolute bottom-2 right-2 inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-black/60 text-white rounded"
                  >
                    <Eye className="w-3 h-3" /> Preview
                  </button>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => !c.locked && onPick(c.key)}
                  className="text-left flex-1 disabled:cursor-not-allowed"
                >
                  <div className="text-xs uppercase text-gray-400 mb-1">{c.category} · {c.slide_count} slides</div>
                  <div className="font-medium mb-1">{c.label}</div>
                  <p className="text-xs text-gray-600 dark:text-slate-400 mb-2">{c.description}</p>
                  {c.best_for && (
                    <p className="text-[11px] text-gray-500 dark:text-slate-500 italic">{c.best_for}</p>
                  )}
                  {c.locked && (
                    <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                      Upgrade to Growth to unlock this template.
                    </div>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}

        {previewCard && (
          <TemplatePreviewModal
            card={previewCard}
            PreviewStage={PreviewStage}
            onClose={() => setPreviewCard(null)}
            onPick={(key) => { setPreviewCard(null); onPick(key); }}
            busy={busy}
          />
        )}

        {busy && (
          <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Task #53 — Engagement panel. Shows founder-facing stats for share
// links: aggregate views, total read-time, recent impressions (hashed
// identifiers only — never raw IP/UA).
// =====================================================================
function fmtReadTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function EngagementPanel({ data }) {
  if (!data) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-800 p-3" data-card>
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2 flex items-center gap-1">
          <Eye className="w-3 h-3" /> Engagement
        </div>
        <p className="text-[11px] text-gray-400">No share activity yet.</p>
      </div>
    );
  }
  const shares = Array.isArray(data.shares) ? data.shares : [];
  const views = Array.isArray(data.views) ? data.views : [];
  const conv = data.conversions || {};
  const convBadge = (kind) => {
    if (!kind) return null;
    const palette = {
      signup:           'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      nda_signed:       'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
      feedback:         'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
      deal_pack_opened: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
      deal_signed:      'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    };
    const label = {
      signup: 'signup', nda_signed: 'NDA', feedback: 'fb',
      deal_pack_opened: 'deal', deal_signed: 'signed',
    }[kind] || kind;
    return <span className={`px-1.5 py-0.5 rounded text-[10px] ${palette[kind] || 'bg-gray-100 text-gray-600'}`}>{label}</span>;
  };
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-800 p-3" data-card>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2 flex items-center gap-1">
        <Eye className="w-3 h-3" /> Engagement
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="border dark:border-slate-700 rounded p-2">
          <div className="text-[10px] uppercase text-gray-400">Views</div>
          <div className="text-base font-semibold">{data.total_views || 0}</div>
        </div>
        <div className="border dark:border-slate-700 rounded p-2">
          <div className="text-[10px] uppercase text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" /> Read time</div>
          <div className="text-base font-semibold">{fmtReadTime(data.total_read_seconds)}</div>
        </div>
      </div>
      {(conv.signups || conv.feedbacks || conv.deals_signed || conv.nda_signed || conv.deal_pack_opened) ? (
        <div className="mb-3 border dark:border-slate-700 rounded p-2">
          <div className="text-[10px] uppercase text-gray-400 mb-1">Conversions</div>
          <div className="grid grid-cols-3 gap-1 text-[11px]">
            <div><span className="font-semibold">{conv.signups || 0}</span> <span className="text-gray-400">signup</span></div>
            <div><span className="font-semibold">{conv.nda_signed || 0}</span> <span className="text-gray-400">NDA</span></div>
            <div><span className="font-semibold">{conv.feedbacks || 0}</span> <span className="text-gray-400">fb</span></div>
            <div><span className="font-semibold">{conv.deal_pack_opened || 0}</span> <span className="text-gray-400">deal</span></div>
            <div><span className="font-semibold">{conv.deals_signed || 0}</span> <span className="text-gray-400">signed</span></div>
          </div>
        </div>
      ) : null}
      {shares.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase text-gray-400 mb-1">Share links</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {shares.slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-[11px] text-gray-500 dark:text-slate-400">
                <span>{s.view_count}/{s.view_limit} used</span>
                <span className={s.exhausted ? 'text-amber-600' : 'text-emerald-600'}>
                  {s.exhausted ? 'gone' : 'active'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {views.length > 0 && (
        <div>
          <div className="text-[10px] uppercase text-gray-400 mb-1">Recent views</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {views.slice(0, 6).map((v) => (
              <div key={v.id} className="flex items-center justify-between text-[11px] text-gray-500 dark:text-slate-400 gap-2">
                <span className="font-mono">{(v.ip_hash || '······').slice(0, 8)}</span>
                <span className="flex items-center gap-1">
                  {convBadge(v.conversion)}
                  <span>{fmtReadTime(v.read_seconds)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Studio-tier watermark editor.
// =====================================================================
function WatermarkEditor({ initial, onSave }) {
  const [val, setVal] = useState(initial || '');
  return (
    <div className="space-y-2">
      <input
        className="w-full border rounded px-2 py-1 bg-white dark:bg-slate-950 dark:border-slate-700 text-xs"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="https://… (watermark image)"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onSave(val)}
          className="flex-1 px-2 py-1 bg-violet-600 text-white text-xs rounded hover:bg-violet-700 flex items-center justify-center gap-1"
        ><Check className="w-3 h-3" /> Save</button>
        {val && (
          <button
            onClick={() => { setVal(''); onSave(null); }}
            className="px-2 py-1 border dark:border-slate-700 text-xs rounded hover:bg-gray-50 dark:hover:bg-slate-800"
          >Clear</button>
        )}
      </div>
    </div>
  );
}
