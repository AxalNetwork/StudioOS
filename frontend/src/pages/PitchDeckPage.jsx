import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { reportError } from '../lib/log';
import {
  Sparkles, Loader2, Plus, Trash2, Share2, Download,
  History, RotateCcw, ChevronLeft, ChevronRight, Lock, Wand2,
  LayoutGrid, FileImage, FileText, FileCode2, Settings, X, Check,
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
  const [error, setError] = useState('');

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
      const ext = format === 'pptx' ? 'pptx' : format === 'png' ? 'png' : 'pdf';
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
              12 templates, auto-filled from your project, financials, and cap table.
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
        </div>

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
          <div className="grid grid-cols-12 gap-4">
            {/* LEFT — slides + history */}
            <div className="col-span-3 space-y-3">
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
            <div className="col-span-6">
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
            <div className="col-span-3 space-y-3">
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
                    <button onClick={() => onExport('png')} className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-2">
                      <FileImage className="w-4 h-4 text-violet-500" /> PNG (cover)
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
      .then((m) => ({ list: m.TEMPLATE_LIST || [], record: m.TEMPLATES || {} }))
      .catch((err) => {
        // Reset so a transient failure (e.g. network blip) can retry next open.
        _templatesPromise = null;
        reportError(err);
        return { list: [], record: {}, error: err };
      });
  }
  return _templatesPromise;
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

function MethodPicker({ methods, premiumIds, recommendation, onClose, onPick, busy }) {
  useEscapeClose(onClose);
  const [filter, setFilter] = useState('all');
  const [templates, setTemplates] = useState(null); // { list, record, error? } | null
  const [Thumbnail, setThumbnail] = useState(null);
  useEffect(() => {
    let alive = true;
    loadTemplates().then((t) => { if (alive) setTemplates(t); });
    loadThumbnailModule().then((m) => { if (alive && m) setThumbnail(() => m.Thumbnail); });
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
        category: m.category || 'general',
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
            <p className="text-xs text-gray-500 dark:text-slate-400">12 methods — your data auto-fills, AI fills the gaps.</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-800 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-2 border-b dark:border-slate-800 flex gap-2 text-xs">
          {['all', 'fundraising', 'commercial', 'event', 'narrative'].map((c) => (
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
              Check <code>frontend/src/decks/templates/index.ts</code> — the registry returned 0 entries.
              {registryError ? ' (load error — see console)' : ''}
            </div>
          </div>
        )}

        {registryLoaded && !registryEmpty && (
          <div className="overflow-y-auto p-5 grid grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((c) => (
              <button
                key={c.key}
                disabled={busy}
                onClick={() => !c.locked && onPick(c.key)}
                className={`relative text-left border rounded-lg p-4 transition ${
                  c.locked
                    ? 'border-gray-200 dark:border-slate-800 opacity-80'
                    : 'border-gray-200 dark:border-slate-800 hover:border-violet-400 hover:shadow'
                }`}
              >
                {c.isRec && (
                  <span className="absolute -top-2 -right-2 bg-violet-600 text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Wand2 className="w-3 h-3" /> Suggested
                  </span>
                )}
                {c.premium && (
                  <span className="absolute top-2 right-2 z-10 text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 px-1.5 py-0.5 rounded flex items-center gap-1">
                    {c.locked && <Lock className="w-3 h-3" />} Premium
                  </span>
                )}
                <div className="mb-3">
                  {Thumbnail
                    ? <Thumbnail template={c.template} />
                    : <div style={{ width: 320, height: 180, background: '#F1F5F9', borderRadius: 6 }} />}
                </div>
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
            ))}
          </div>
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
              <div key={v.id} className="flex items-center justify-between text-[11px] text-gray-500 dark:text-slate-400">
                <span className="font-mono">{(v.ip_hash || '······').slice(0, 8)}</span>
                <span>{fmtReadTime(v.read_seconds)}</span>
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
