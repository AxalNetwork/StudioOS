// Spin-Out Lab — Pitch Deck Builder (Week 3 tool page).
//
// Design handoff: spin-out-lab-pipeline/project/Pitch Deck Builder.dc.html
// (also attached_assets/Pitch_Deck_Builder.dc_*.html). The design is recreated
// natively — no iframe, no ported runtime — and wired to real surfaces:
//   - The 11-slide grid renders the actual `axal_spinout_demoday` React slides
//     (decks/templates/axal_spinout_demoday_app.tsx) through the shared
//     <Thumbnail> clip window, fed by the live Lab field map
//     (useSpinoutDeckFields → POST /projects/:id/spinout-deck). This is the
//     stack's equivalent of the design's <dc-import name="AxalSlide">.
//   - Slide cards, per-slide readiness, week pills, readiness counts and the
//     export gate all come from one adapter: lib/pitchDeckViewModel.js.
//   - Edit slide: the existing SpinoutSlideEditor already implements the
//     design's per-field source model (Auto rows labelled with their source
//     page + deep link; only narrative fields editable here).
//   - Export PDF / Share Link: the real deck version + share-token backends
//     (POST /decks/generate, /decks/:id/export, /decks/:id/share), presented
//     through the design's export-progress and share modals.
//
// Deliberately not reproduced: the design's own left sidebar and top breadcrumb
// (the app renders inside its authenticated shell), its per-slide image upload
// zones and share password/PIN toggle (no backend — omitted rather than shipped
// as dead controls), and its simulated export timer (the real export drives it).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, ChevronLeft, ChevronRight,
  Download, Loader2, Maximize2, Minimize2, Presentation, Share2, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { reportError } from '../lib/log';
import { useAuth } from '../hooks/useAuthSync';
import { useSpinoutDeckFields } from '../hooks/useSpinoutDeckFields';
import SpinoutSlideEditor from '../components/SpinoutSlideEditor';
import { PitchDeckExportModal, PitchDeckShareModal } from '../components/PitchDeckModals';
import PitchDeckSlideCard from '../components/PitchDeckSlideCard';
import LabPageHeader from '../components/spinout/LabPageHeader';
import { pickLabProject } from './SpinoutLabStartupPage';
import { TEMPLATES } from '../decks/templates';
import {
  EXPORT_MIN_READY, SLIDE_META, buildPitchDeckViewModel, slideStatus,
} from '../lib/pitchDeckViewModel';

// Re-exported for existing consumers/tests that imported them from this page.
export { SLIDE_META, slideStatus };

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';

export default function SpinoutLabPitchDeckPage() {
  const { user } = useAuth();

  const [projectId, setProjectId] = useState(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const { fields, loading: fieldsLoading } = useSpinoutDeckFields({ projectId, enabled: !!projectId, reloadKey });

  const [view, setView] = useState('grid'); // grid | editor
  const [slideIdx, setSlideIdx] = useState(0);
  const [fullDeck, setFullDeck] = useState(false);
  const [Thumbnail, setThumbnail] = useState(null);
  const [error, setError] = useState('');

  // Export modal state — progress is driven by the real request (see onExport).
  const [exportPhase, setExportPhase] = useState(null); // null | 'running' | 'done'
  const [exportProgress, setExportProgress] = useState(0);
  const [exportFilename, setExportFilename] = useState('');
  const [exportNote, setExportNote] = useState('');
  const progressTimer = useRef(null);

  // Share modal state.
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [expiryHours, setExpiryHours] = useState(24);

  useEffect(() => () => clearInterval(progressTimer.current), []);

  // Resolve the founder's Lab project (same picker as the other tool pages).
  useEffect(() => {
    let alive = true;
    setProjectLoading(true);
    api.listProjects()
      .then((projects) => {
        if (!alive) return;
        setProjectId(pickLabProject(projects, user)?.id ?? null);
      })
      .catch((e) => { if (alive) reportError('SpinoutLabPitchDeckPage:projects', e); })
      .finally(() => { if (alive) setProjectLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Lazy-load the heavy Thumbnail renderer (same pattern as PitchDeckPage).
  useEffect(() => {
    let alive = true;
    import('../decks/Thumbnail')
      .then((m) => { if (alive && m?.Thumbnail) setThumbnail(() => m.Thumbnail); })
      .catch((e) => reportError('SpinoutLabPitchDeckPage:thumbnail', e));
    return () => { alive = false; };
  }, []);

  const template = TEMPLATES.axal_spinout_demoday;
  const vm = useMemo(() => buildPitchDeckViewModel({ fields, canExport: !!projectId }), [fields, projectId]);

  // W2 deliverable — deck v1 counts as drafted once enough slides carry real
  // data to export (the page's own export threshold).
  useEffect(() => {
    if (!fieldsLoading && projectId && vm.readyCount >= EXPORT_MIN_READY) {
      markMilestone(user, 'pitch_deck_drafted');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsLoading, projectId, vm.readyCount]);

  // ---- deck resolution (unchanged real backend contract) -------------------
  const isAxalDeck = (deck) => {
    if (!deck) return false;
    if (deck.method_id === 'axal_spinout_demoday') return true;
    let slides = deck.slides;
    if (typeof slides === 'string') { try { slides = JSON.parse(slides); } catch { slides = []; } }
    return Array.isArray(slides) && slides.some((s) => s?.method_id === 'axal_spinout_demoday');
  };

  const ensureDeck = async () => {
    const versions = await api.deckListVersions(projectId);
    const list = Array.isArray(versions?.versions) ? versions.versions : Array.isArray(versions) ? versions : [];
    const current = list.find((v) => v.is_current) || list[0];
    if (current) {
      const deck = await api.deckGet(current.id);
      if (isAxalDeck(deck)) return deck;
    }
    // No current Axal deck — apply the Axal Spin-Out method. apply-method is
    // Worker-only; the dev FastAPI 405s it, so fall back to the stored current
    // deck (or a generic generate) to keep dev share/export working.
    try {
      const r = await api.deckApplyMethod(projectId, 'axal_spinout_demoday');
      return r?.deck || r;
    } catch (e) {
      if (e?.status === 405 || e?.status === 404) {
        if (current) return api.deckGet(current.id);
        const gen = await api.deckGenerate(projectId);
        return gen?.deck || gen;
      }
      throw e;
    }
  };

  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  // The backend reports no percentage, so the bar eases toward 90% while the
  // request is in flight and only completes when the file actually lands —
  // progress that never claims more than it knows.
  const startProgress = () => {
    setExportProgress(4);
    clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      setExportProgress((p) => (p >= 90 ? 90 : p + Math.max(1, Math.round((90 - p) / 8))));
    }, 220);
  };
  const stopProgress = () => { clearInterval(progressTimer.current); setExportProgress(100); };

  const onExport = async () => {
    if (exportPhase || vm.exportDisabled || !projectId) return;
    setError(''); setExportNote(''); setExportFilename('');
    setExportPhase('running');
    startProgress();
    try {
      const deck = await ensureDeck();
      const base = (deck.title || 'pitch-deck').replace(/[^A-Za-z0-9_-]+/g, '-');
      const r = await api.deckExport(deck.id, 'pdf');
      if (r.ok) {
        const filename = `${base}.pdf`;
        download(await r.blob(), filename);
        setExportFilename(filename);
      } else if ([502, 503, 405, 404].includes(r.status)) {
        // Server PDF render unavailable (dev) — export the client-built
        // Spin-Out PowerPoint instead (same 11 Axal slides).
        const bundle = await api.spinoutDeck(projectId);
        const buildDeck = (await import('../decks/spinout/buildDeck.js')).default;
        const blob = await buildDeck(bundle.data, { notes: bundle.notes, draft: bundle.draft });
        const filename = `${base}${bundle.draft ? '-DRAFT' : ''}.pptx`;
        download(blob, filename);
        setExportFilename(filename);
        setExportNote('Server PDF rendering is unavailable here — exported PowerPoint instead.');
      } else {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || err.message || `Export failed (${r.status})`);
      }
      stopProgress();
      setExportPhase('done');
    } catch (e) {
      clearInterval(progressTimer.current);
      setExportPhase(null);
      setError(e?.message || 'Export failed');
      reportError('SpinoutLabPitchDeckPage:export', e);
    }
  };

  const onShare = async (hours = expiryHours) => {
    if (!projectId) return;
    setShareOpen(true); setSharing(true); setError('');
    try {
      const deck = await ensureDeck();
      const r = await api.deckShare(deck.id, { expires_in_hours: hours });
      const path = r?.share_path || (r?.token && `/share/deck/${r.token}`);
      setShareUrl(r?.url || (path ? `${window.location.origin}${path}` : ''));
    } catch (e) {
      setShareOpen(false);
      setError(e?.message || 'Share failed');
      reportError('SpinoutLabPitchDeckPage:share', e);
    } finally {
      setSharing(false);
    }
  };

  const changeExpiry = (hours) => { setExpiryHours(hours); onShare(hours); };

  // ---- states --------------------------------------------------------------
  if (projectLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 flex items-center justify-center text-gray-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <Presentation size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Pitch Deck Builder</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Create your startup record in the Spin-Out Lab first — the deck auto-assembles from your Lab work.
        </p>
        <Link to="/spinout-lab" className="inline-flex items-center gap-1.5 mt-5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700">
          <ArrowLeft size={15} /> Back to Workspace
        </Link>
      </div>
    );
  }

  const cur = vm.slides[slideIdx];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6" data-testid="spinout-pitch-deck-page">
      {/* ---- page header (app shell chrome, not the design's own sidebar) ---- */}
      <LabPageHeader
        icon={Presentation}
        title="Pitch Deck Builder"
        subtitle="Auto-assemble your venture pitch deck"
        status="Active"
        className="mb-5"
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-[12.5px] text-red-700 dark:text-red-300" data-testid="deck-error">
          <AlertTriangle size={14} className="flex-none" /> {error}
          <button type="button" onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600"><X size={14} /></button>
        </div>
      )}

      {view === 'grid' ? (
        <>
          {/* ---- banner (design L84-105) ---- */}
          <div className={`${CARD} p-6 mb-7 shadow-sm`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-[280px] flex-1">
                {/* Demoted from <h1> when the header migrated to LabPageHeader:
                    the header's title is now this page's only <h1>. */}
                <h2 className="text-[20px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Your Pitch Deck</h2>
                <p className="mt-1.5 mb-4 text-[14px] text-gray-500 dark:text-gray-400">
                  Auto-assembled from your Spin-Out Lab work. Edit any slide, then export or share.
                </p>
                <div className="flex flex-wrap gap-2">
                  {vm.weekPills.map((w) => (
                    <span
                      key={w.num}
                      data-testid={`week-pill-${w.num}`}
                      className={`inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-full px-3 py-1.5 border ${
                        w.state === 'done'
                          ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                          : w.state === 'warn'
                            ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {w.state === 'done' ? <Check size={13} /> : w.state === 'warn' ? <AlertTriangle size={13} /> : null}
                      {w.label} — Week {w.num}{w.note ? `, ${w.note}` : ''}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onExport}
                  disabled={vm.exportDisabled || !!exportPhase}
                  title={vm.exportTip}
                  className={`h-10 px-4 rounded-xl text-[13.5px] font-semibold inline-flex items-center gap-1.5 ${
                    vm.exportDisabled || exportPhase
                      ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                      : 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm'
                  }`}
                  data-testid="button-export-pdf"
                >
                  {exportPhase === 'running' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Export PDF
                </button>
                <button
                  type="button"
                  onClick={() => onShare()}
                  className="h-10 px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[13.5px] font-semibold text-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 inline-flex items-center gap-1.5"
                  data-testid="button-share-link"
                >
                  <Share2 size={15} /> Share Link
                </button>
              </div>
            </div>
          </div>

          {/* ---- slide grid (design L108-125) ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[18px]" data-testid="slide-grid">
            {vm.slides.map((s) => (
              <PitchDeckSlideCard
                key={s.spec}
                slide={s}
                template={template}
                fields={fields}
                Thumbnail={Thumbnail}
                onOpen={() => { setSlideIdx(s.index); setView('editor'); }}
              />
            ))}
          </div>

          {/* ---- progress (design L128-131) ---- */}
          <div className="flex items-center gap-3.5 mt-6" data-testid="deck-progress">
            <div className="flex-1 max-w-[360px] h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-violet-600 transition-[width] duration-500 ease-out"
                style={{ width: `${vm.readyPct}%` }}
              />
            </div>
            <span className="text-[13px] font-semibold text-gray-600 dark:text-gray-300 tabular-nums">{vm.readyLabel}</span>
          </div>
          {fieldsLoading && (
            <div className="mt-3 text-[11.5px] text-gray-400 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Refreshing from your Lab data…
            </div>
          )}
        </>
      ) : (
        /* ---- editor view (design L136-221) ---- */
        <div data-testid="slide-editor-view">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setView('grid')}
              className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[13px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              data-testid="button-back-to-deck"
            >
              <ArrowLeft size={14} /> Back to deck
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={slideIdx === 0}
                onClick={() => setSlideIdx((i) => Math.max(0, i - 1))}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
                data-testid="button-prev-slide"
              >
                <ChevronLeft size={13} /> Prev
              </button>
              <span className="text-[13px] font-semibold text-gray-600 dark:text-gray-300 tabular-nums">
                Slide {cur.n} of {vm.total}
              </span>
              <button
                type="button"
                disabled={slideIdx === vm.total - 1}
                onClick={() => setSlideIdx((i) => Math.min(vm.total - 1, i + 1))}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
                data-testid="button-next-slide"
              >
                Next <ChevronRight size={13} />
              </button>
              <button
                type="button"
                onClick={() => setFullDeck((v) => !v)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                data-testid="button-toggle-full-deck"
              >
                {fullDeck ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                {fullDeck ? 'Exit full size' : 'Full size deck'}
              </button>
            </div>
          </div>

          <div className={fullDeck ? 'grid grid-cols-1 gap-6' : 'grid grid-cols-1 lg:grid-cols-[1fr_440px] gap-6'}>
            <div>
              <div className={`${CARD} overflow-hidden shadow-sm`}>
                <div className="aspect-video bg-[#F1F0F5] dark:bg-gray-800">
                  {Thumbnail
                    ? <Thumbnail template={template} data={fields || undefined} slideIndex={slideIdx} />
                    : <div className="w-full h-full flex items-center justify-center text-gray-300"><Loader2 size={16} className="animate-spin" /></div>}
                </div>
                <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                  <div className="text-[14px] font-extrabold text-gray-900 dark:text-gray-100">{cur.title}</div>
                  <span className="text-[11.5px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 rounded-full px-2.5 py-1">
                    Slide {cur.n} / {vm.total}
                  </span>
                  <span className={`ml-auto w-2.5 h-2.5 rounded-full ${cur.dotClass}`} title={cur.statusText} />
                  <span className="text-[11.5px] text-gray-400 dark:text-gray-500">{cur.statusText}</span>
                </div>
              </div>
              <p className="mt-2.5 text-[11px] text-gray-400 dark:text-gray-500">
                Auto fields refresh from their source tool — edits here update your startup's source data and the slide re-renders from it.
              </p>
            </div>

            <div className={`${CARD} p-5 ${fullDeck ? 'max-w-[560px]' : ''}`}>
              <div className={`${LBL} mb-2`}>Edit slide</div>
              <SpinoutSlideEditor
                slide={{ spec_id: cur.spec, title: cur.title }}
                fields={fields}
                projectId={projectId}
                onSaved={() => setReloadKey((k) => k + 1)}
              />
            </div>
          </div>
        </div>
      )}

      <PitchDeckExportModal
        phase={exportPhase}
        progress={exportProgress}
        filename={exportFilename}
        error={exportNote}
        onClose={() => { setExportPhase(null); setExportProgress(0); }}
      />
      <PitchDeckShareModal
        open={shareOpen}
        url={shareUrl}
        busy={sharing}
        expiryHours={expiryHours}
        onExpiryChange={changeExpiry}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}
