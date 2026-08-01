// Spin-Out Lab — Brand & Landing Pages (Week 2 tool page).
//
// Design handoff: attached_assets/Brand_&_Landing_Page.dc_*.html (same file
// ships in the repo under spin-out-lab-pipeline/project). Mapping to REAL
// surfaces only:
//   - Brand identity rail: the project's landing brand record
//     (GET/PUT /brand/landing/by-project/:pid — name, tagline, palette,
//     font pairing, logo upload + AI generate).
//   - Your pages: the real multi-page landing backend
//     (/brand/landing/by-project/:pid/pages CRUD + publish + preview-url),
//     with Edit deep-linking into the full builder at /build/brand.
//   - Template library: the existing 16-template catalog
//     (lib/brand/templates.js TEMPLATES) — same names and audiences,
//     rendered in the new library UI; Use Template creates a real page
//     seeded with the template's visual style, palette, goal and CTA.
//   - Audience inflows: real waitlist signups
//     (GET /brand/landing/by-project/:pid/waitlist) grouped by audience,
//     with routing into Customer Discovery.
//   - Omitted (no backend): brand-voice tags and the light/dark logo
//     variants — the rest of the identity panel persists for real.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Palette, Upload, Sparkles, Check, AlertTriangle, X,
  ExternalLink, Copy, Plus, Pencil, Eye, CalendarPlus, ChevronDown, ChevronRight,
} from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import { useAuth } from '../hooks/useAuthSync';
import { useToast } from '../components/useToast';
import { pickLabProject } from './SpinoutLabStartupPage';
import {
  TEMPLATES, AUDIENCES, AUDIENCE_LABELS, VISUAL_TEMPLATE_PALETTES,
} from '../lib/brand/templates';
import { FONT_PAIRING_OPTIONS } from '../decks/templates/axal_spinout_demoday_app';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700';
const LBL = 'text-[10.5px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const INPUT = 'w-full h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12.5px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40';

// Audience accent colors — mirrors the design's color-coded chips/dots.
export const AUDIENCE_COLORS = {
  customer: { dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300', bar: '#7c3aed' },
  advisor: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300', bar: '#0284c7' },
  cofounder: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', bar: '#059669' },
  investor: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', bar: '#d97706' },
  partner: { dot: 'bg-teal-500', chip: 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300', bar: '#0d9488' },
  mentor: { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300', bar: '#e11d48' },
};

// Where each audience's inflow routes to in the Lab (design's "Routing to →").
const AUDIENCE_ROUTING = {
  customer: { label: 'Customer Discovery', to: '/spinout-lab/discovery' },
  advisor: { label: 'Advisors', to: '/spinout-lab/advisors' },
  cofounder: { label: 'Co-founder Agreement', to: '/spinout-lab/cofounder-agreement' },
  investor: { label: 'Capital', to: '/spinout-lab/capital' },
  partner: { label: 'Studio Ops', to: null },
  mentor: { label: 'Office Hours', to: null },
};

const timeAgo = (iso) => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null;

/** Mini placeholder thumbnail — audience-tinted layout bars, like the design's
 *  scaled-down previews (pure CSS; no live render backend for templates). */
function TemplateThumb({ audience }) {
  const bar = AUDIENCE_COLORS[audience]?.bar || '#7c3aed';
  return (
    <div className="h-20 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-2.5 overflow-hidden">
      <div className="h-1.5 w-2/5 rounded-full mb-1.5" style={{ background: bar, opacity: 0.85 }} />
      <div className="h-1 w-4/5 rounded-full bg-gray-200 dark:bg-gray-600 mb-1" />
      <div className="h-1 w-3/5 rounded-full bg-gray-200 dark:bg-gray-600 mb-2" />
      <div className="flex gap-1.5">
        <div className="h-4 w-14 rounded" style={{ background: bar, opacity: 0.25 }} />
        <div className="h-4 flex-1 rounded bg-gray-100 dark:bg-gray-700" />
      </div>
    </div>
  );
}

export default function SpinoutLabBrandPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast, showToast } = useToast(3500);
  const fileRef = useRef(null);
  const libraryRef = useRef(null);

  const [projectId, setProjectId] = useState(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [error, setError] = useState('');

  // Brand identity draft (persists via PUT /brand/landing/by-project/:pid).
  const [draft, setDraft] = useState({
    name: '', tagline: '', theme_color: '#7c3aed', palette_secondary: '#1e1b3a',
    palette_bg: '#f8f8fa', font_pairing: 'editorial', logo_url: null, logo_svg: null, logo_asset_id: null,
  });
  const [brandLoaded, setBrandLoaded] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const [brandSaved, setBrandSaved] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);

  const [pages, setPages] = useState([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [signups, setSignups] = useState([]);
  const [busyPage, setBusyPage] = useState(null); // page id being duplicated etc.
  const [creatingFrom, setCreatingFrom] = useState(null); // template id being used
  const [libFilter, setLibFilter] = useState('all');
  const [previewTpl, setPreviewTpl] = useState(null);
  const [openAudiences, setOpenAudiences] = useState({ customer: true });

  // Resolve the founder's Lab project (same picker as the other tool pages).
  useEffect(() => {
    let alive = true;
    setProjectLoading(true);
    api.listProjects()
      .then((projects) => {
        if (!alive) return;
        const proj = pickLabProject(projects, user);
        setProjectId(proj?.id ?? null);
      })
      .catch((e) => { if (alive) reportError('SpinoutLabBrandPage:projects', e); })
      .finally(() => { if (alive) setProjectLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const refreshPages = async (pid = projectId) => {
    if (!pid) return;
    try {
      const r = await api.brandListPages(pid);
      setPages(Array.isArray(r?.pages) ? r.pages : []);
    } catch (e) { reportError('SpinoutLabBrandPage:pages', e); }
  };

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setPagesLoading(true);
    Promise.allSettled([
      api.brandGetLanding(projectId),
      api.brandListPages(projectId),
      api.brandListWaitlist(projectId),
    ]).then(([lp, pg, wl]) => {
      if (!alive) return;
      if (lp.status === 'fulfilled' && lp.value) {
        const v = lp.value;
        setDraft((d) => ({
          ...d,
          name: v.name || '',
          tagline: v.tagline || '',
          theme_color: v.theme_color || d.theme_color,
          palette_secondary: v.palette_secondary || d.palette_secondary,
          palette_bg: v.palette_bg || d.palette_bg,
          font_pairing: v.font_pairing || 'editorial',
          logo_url: v.logo_url || null,
          logo_svg: v.logo_svg || null,
          logo_asset_id: v.logo_asset_id || null,
        }));
      }
      if (pg.status === 'fulfilled') setPages(Array.isArray(pg.value?.pages) ? pg.value.pages : []);
      if (wl.status === 'fulfilled') setSignups(Array.isArray(wl.value?.signups) ? wl.value.signups : []);
      setBrandLoaded(true);
    }).finally(() => { if (alive) setPagesLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  // ---- brand identity actions ----
  const saveBrand = async () => {
    if (!projectId || savingBrand) return;
    if (!draft.name.trim()) { setError('Brand name is required.'); return; }
    setSavingBrand(true); setError('');
    try {
      await api.brandSaveLanding(projectId, { ...draft, name: draft.name.trim() });
      setBrandSaved(true);
      setTimeout(() => setBrandSaved(false), 2500);
      showToast({ msg: 'Brand saved — settings apply to all pages in this project.', kind: 'ok' });
    } catch (e) {
      setError(e?.message || 'Failed to save brand');
      reportError('SpinoutLabBrandPage:saveBrand', e);
    } finally { setSavingBrand(false); }
  };

  const onUploadLogo = async (file) => {
    if (!file || !projectId) return;
    setLogoBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.brandUploadLogo(fd);
      setDraft((d) => ({ ...d, logo_asset_id: r?.asset_id || null, logo_url: r?.url || null, logo_svg: null }));
    } catch (e) { setError(e?.message || 'Logo upload failed'); }
    finally { setLogoBusy(false); }
  };

  const onGenerateLogo = async () => {
    if (logoBusy) return;
    if (!draft.name.trim()) { setError('Add a brand name first — the generator uses it.'); return; }
    setLogoBusy(true); setError('');
    try {
      const r = await api.brandLogo({ prompt: draft.tagline || draft.name, name: draft.name, color: draft.theme_color });
      setDraft((d) => ({ ...d, logo_url: r?.url || null, logo_svg: r?.svg || null }));
    } catch (e) { setError(e?.message || 'Logo generation failed'); }
    finally { setLogoBusy(false); }
  };

  // ---- page actions ----
  // Only signups whose recorded source matches this page — no audience-wide
  // fallback (that would double-count the same signups across pages).
  const subsForPage = (page) => signups.filter(
    (s) => s.source && (s.source === page.page_slug || s.source === page.slug),
  ).length;

  const onViewLive = async (page) => {
    try {
      const r = await api.brandPagePreviewUrl(page.id);
      const url = r?.url || r?.preview_url;
      if (url) window.open(url, '_blank', 'noopener');
      else throw new Error('No preview URL returned');
    } catch (e) { setError(e?.message || 'Could not open the live page'); }
  };

  // Explicit LandingUpsert allowlist — never spread the server row into the
  // create call (server-only fields like id/slug/preview_token must not leak,
  // and the payload shape must not couple to either backend's row format).
  const DUP_FIELDS = [
    'tagline', 'headline', 'subheadline', 'cta_text', 'logo_url', 'logo_svg', 'logo_asset_id',
    'theme_color', 'palette_bg', 'palette_ink', 'palette_secondary', 'palette_accent', 'font_pairing',
    'template', 'template_kit', 'audience', 'goal', 'hero_media_url', 'product_screenshot_url',
    'audience_customer_headline', 'audience_customer_body', 'audience_customer_cta',
    'audience_partner_headline', 'audience_partner_body', 'audience_partner_cta',
    'audience_investor_headline', 'audience_investor_body', 'audience_investor_cta',
    'audience_advisor_headline', 'audience_advisor_body', 'audience_advisor_cta',
    'audience_mentor_headline', 'audience_mentor_body', 'audience_mentor_cta',
    'audience_cofounder_headline', 'audience_cofounder_body', 'audience_cofounder_cta',
  ];

  const onDuplicate = async (page) => {
    if (busyPage) return;
    setBusyPage(page.id); setError('');
    try {
      const full = await api.brandGetPage(page.id);
      const payload = { name: `${full.name || page.name} (copy)` };
      for (const k of DUP_FIELDS) {
        if (full[k] !== undefined && full[k] !== null) payload[k] = full[k];
      }
      // content_json may arrive parsed (dev) or as a JSON string (worker row).
      let cj = full.content_json;
      if (typeof cj === 'string') { try { cj = JSON.parse(cj); } catch { cj = null; } }
      if (cj && typeof cj === 'object' && !Array.isArray(cj)) payload.content_json = cj;
      await api.brandCreatePage(projectId, payload);
      await refreshPages();
      showToast({ msg: 'Page duplicated as a draft.', kind: 'ok' });
    } catch (e) {
      setError(e?.message || 'Duplicate failed');
      reportError('SpinoutLabBrandPage:duplicate', e);
    } finally { setBusyPage(null); }
  };

  const useTemplate = async (tpl) => {
    if (creatingFrom || !projectId) return;
    setCreatingFrom(tpl.id); setError('');
    try {
      const palette = VISUAL_TEMPLATE_PALETTES[tpl.visualTemplate] || {};
      const existing = pages.filter((p) => p.template_kit === tpl.id).length;
      await api.brandCreatePage(projectId, {
        name: `${tpl.label} v${existing + 1}`,
        template: tpl.visualTemplate,
        template_kit: tpl.id,
        audience: tpl.audience,
        goal: tpl.primaryGoal,
        cta_text: tpl.defaultCtaLabel,
        tagline: draft.tagline || undefined,
        ...palette,
      });
      await refreshPages();
      showToast({ msg: `Created "${tpl.label}" draft — open Edit to finish it.`, kind: 'ok' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e?.message || 'Could not create the page');
      reportError('SpinoutLabBrandPage:useTemplate', e);
    } finally { setCreatingFrom(null); }
  };

  const scrollToLibrary = (audience) => {
    setLibFilter(audience);
    libraryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---- derived ----
  const filteredTemplates = useMemo(
    () => (libFilter === 'all' ? TEMPLATES : TEMPLATES.filter((t) => t.audience === libFilter)),
    [libFilter],
  );
  const signupsByAudience = useMemo(() => {
    const m = {};
    for (const a of AUDIENCES) m[a] = [];
    for (const s of signups) {
      const a = AUDIENCES.includes(s.audience) ? s.audience : 'customer';
      m[a].push(s);
    }
    return m;
  }, [signups]);

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
        <Palette size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Brand & Landing Pages</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Create your startup record in the Spin-Out Lab first — landing pages belong to your Lab project.
        </p>
        <Link to="/spinout-lab" className="inline-flex items-center gap-1.5 mt-5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700">
          <ArrowLeft size={15} /> Back to Workspace
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6" data-testid="spinout-brand-page">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg shadow-lg text-sm ${
          toast.kind === 'ok' ? 'bg-emerald-600 text-white'
            : toast.kind === 'err' ? 'bg-red-600 text-white'
              : 'bg-slate-800 text-white'
        }`}
        >
          {toast.msg}
        </div>
      )}

      {/* ---- page header ---- */}
      <div className="flex items-center gap-3 mb-1.5">
        <Link to="/spinout-lab" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200" data-testid="link-back-workspace">
          <ArrowLeft size={14} /> Back to Workspace
        </Link>
        <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
        <div className="flex items-center gap-2 min-w-0">
          <Palette size={16} className="text-violet-600 dark:text-violet-400 flex-none" />
          <span className="text-[15px] font-extrabold text-gray-900 dark:text-gray-100 truncate">Brand & Landing Pages</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Active</span>
        </div>
      </div>
      <p className="mb-5 text-[13px] text-gray-500 dark:text-gray-400">Create landing pages for your audience</p>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-[12.5px] text-red-700 dark:text-red-300">
          <AlertTriangle size={14} className="flex-none" /> {error}
          <button type="button" onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600"><X size={14} /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_300px] gap-5 items-start">
        {/* ================= Brand identity rail ================= */}
        <div className={`${CARD} p-4`} data-testid="brand-identity-panel">
          <div className={`${LBL} mb-3`}>Brand identity</div>

          <div className={`${LBL} mb-1.5`}>Logo</div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full h-20 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-400 hover:border-violet-300 dark:hover:border-violet-700 overflow-hidden"
            data-testid="button-logo-drop"
          >
            {logoBusy ? <Loader2 size={16} className="animate-spin" />
              : draft.logo_url ? <img src={draft.logo_url} alt="logo" className="h-full object-contain" />
                : draft.logo_svg ? <img src={`data:image/svg+xml;utf8,${encodeURIComponent(draft.logo_svg)}`} alt="logo" className="h-full object-contain" />
                  : <span className="inline-flex items-center gap-1.5 text-[11.5px]"><Upload size={13} /> Drop logo or click</span>}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onUploadLogo(f); }} />
          <button
            type="button"
            onClick={onGenerateLogo}
            disabled={logoBusy}
            className="mt-2 w-full h-8 rounded-lg bg-violet-600 text-white text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-violet-700 disabled:opacity-60"
            data-testid="button-generate-logo"
          >
            {logoBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Generate
          </button>

          <div className={`${LBL} mt-4 mb-1.5`}>Brand name</div>
          <input className={INPUT} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Your startup" data-testid="input-brand-name" />

          <div className={`${LBL} mt-4 mb-1.5`}>Tagline</div>
          <textarea
            className={`${INPUT} h-auto py-1.5 resize-none`}
            rows={2}
            maxLength={80}
            value={draft.tagline}
            onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
            data-testid="input-tagline"
          />
          <div className="text-right text-[10.5px] text-gray-400 mt-0.5">{(draft.tagline || '').length} / 80</div>

          <div className={`${LBL} mt-3 mb-1.5`}>Colors</div>
          {[
            ['theme_color', 'Primary'],
            ['palette_secondary', 'Secondary'],
            ['palette_bg', 'Background'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2.5 mb-2 cursor-pointer">
              <input
                type="color"
                value={draft[key] || '#ffffff'}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                className="w-7 h-7 rounded-md border border-gray-200 dark:border-gray-700 p-0 bg-transparent cursor-pointer"
                data-testid={`color-${key}`}
              />
              <span className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">{label}</span>
              <span className="ml-auto text-[10.5px] font-mono text-gray-400">{draft[key]}</span>
            </label>
          ))}
          <div className="text-[10.5px] text-gray-400">Used across all your landing pages</div>

          <div className={`${LBL} mt-4 mb-1.5`}>Typography</div>
          <select
            className={INPUT}
            value={draft.font_pairing}
            onChange={(e) => setDraft({ ...draft, font_pairing: e.target.value })}
            data-testid="select-font-pairing"
          >
            {FONT_PAIRING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {(draft.name || draft.tagline) && (
            <div className="mt-4 rounded-xl border border-gray-100 dark:border-gray-800 p-3" style={{ background: draft.palette_bg || undefined }}>
              <div className="text-[13px] font-extrabold" style={{ color: draft.theme_color }}>{draft.name || 'Your brand'}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{draft.tagline}</div>
            </div>
          )}

          <button
            type="button"
            onClick={saveBrand}
            disabled={savingBrand}
            className={`mt-4 w-full h-9 rounded-lg text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 ${brandSaved ? 'bg-emerald-600 text-white' : 'bg-violet-600 text-white hover:bg-violet-700'} disabled:opacity-60`}
            data-testid="button-save-brand"
          >
            {savingBrand ? <Loader2 size={13} className="animate-spin" /> : brandSaved ? <Check size={13} /> : null}
            {brandSaved ? 'Brand saved' : 'Save brand'}
          </button>
          <div className="mt-2 text-[10.5px] text-gray-400 text-center">Brand settings apply to all pages in this project</div>
        </div>

        {/* ================= Center: pages + template library ================= */}
        <div className="min-w-0">
          {/* ---- Your pages ---- */}
          <div className="flex items-center gap-2 mb-3">
            <div className={LBL}>Your pages</div>
            <div className="ml-auto text-[11px] text-gray-400">{pages.length} page{pages.length === 1 ? '' : 's'} · this project</div>
          </div>

          {pagesLoading && !brandLoaded ? (
            <div className={`${CARD} p-8 flex items-center justify-center text-gray-400 mb-6`}>
              <Loader2 size={16} className="animate-spin mr-2" /> Loading pages…
            </div>
          ) : pages.length === 0 ? (
            <div className={`${CARD} p-6 text-center text-[12.5px] text-gray-500 dark:text-gray-400 mb-6`} data-testid="pages-empty">
              No pages yet — pick a template below to create your first landing page.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4" data-testid="pages-grid">
              {pages.map((p) => {
                const aud = AUDIENCES.includes(p.audience) ? p.audience : 'customer';
                const c = AUDIENCE_COLORS[aud];
                const tpl = templateById(p.template_kit);
                const subs = subsForPage(p);
                return (
                  <div key={p.id} className={`${CARD} overflow-hidden`} data-testid={`page-card-${p.id}`}>
                    <div className="h-16 relative" style={{ background: `linear-gradient(180deg, ${c.bar}14, transparent)` }}>
                      <div className="absolute inset-x-4 top-3 h-1.5 rounded-full" style={{ background: c.bar, opacity: 0.6, width: '40%' }} />
                      <div className="absolute inset-x-4 top-7 h-1 rounded-full bg-gray-200 dark:bg-gray-700 w-3/5" />
                      <div className="absolute inset-x-4 top-10 h-1 rounded-full bg-gray-100 dark:bg-gray-800 w-2/5" />
                    </div>
                    <div className="px-4 pt-2 pb-3.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.chip}`}>{AUDIENCE_LABELS[aud]}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${p.published ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                          {p.published ? 'Published' : 'Draft'}
                        </span>
                      </div>
                      <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100 truncate">{p.name}</div>
                      <div className="text-[11px] text-gray-400 truncate">{tpl?.label || p.template}</div>
                      <div className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                        <b className="text-gray-800 dark:text-gray-200">{p.views_count}</b> views · <b className="text-gray-800 dark:text-gray-200">{subs}</b> subs{p.updated_at ? ` · ${timeAgo(p.updated_at)}` : ''}
                      </div>
                      <div className="flex items-center gap-1.5 mt-2.5">
                        <button type="button" onClick={() => navigate('/build/brand')} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-violet-600 text-white text-[11.5px] font-semibold hover:bg-violet-700" data-testid={`button-edit-page-${p.id}`}>
                          <Pencil size={11} /> Edit
                        </button>
                        <button type="button" onClick={() => onViewLive(p)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800" data-testid={`button-view-live-${p.id}`}>
                          View Live <ExternalLink size={10} />
                        </button>
                        <button type="button" disabled={busyPage === p.id} onClick={() => onDuplicate(p)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60" data-testid={`button-duplicate-page-${p.id}`}>
                          {busyPage === p.id ? <Loader2 size={11} className="animate-spin" /> : <Copy size={11} />} Duplicate
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ---- create new page (audience shortcuts) ---- */}
          <div className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 px-4 py-3.5 mb-7 flex flex-wrap items-center gap-2" data-testid="create-page-row">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 dark:text-gray-400"><Plus size={13} /> Create a new page for this project</span>
            {AUDIENCES.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => scrollToLibrary(a)}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300 hover:border-violet-300 dark:hover:border-violet-700"
                data-testid={`button-new-page-${a}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${AUDIENCE_COLORS[a].dot}`} /> {AUDIENCE_LABELS[a]}
              </button>
            ))}
          </div>

          {/* ---- template library ---- */}
          <div ref={libraryRef} className="flex items-center gap-2 mb-3 scroll-mt-20">
            <div className={LBL}>Template library</div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mb-4" data-testid="library-filters">
            {['all', ...AUDIENCES].map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setLibFilter(a)}
                className={`h-7 px-3 rounded-full text-[11.5px] font-semibold border ${libFilter === a ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                data-testid={`library-filter-${a}`}
              >
                {a === 'all' ? 'All' : AUDIENCE_LABELS[a]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="template-grid">
            {filteredTemplates.map((t) => {
              const c = AUDIENCE_COLORS[t.audience];
              return (
                <div key={t.id} className={`${CARD} p-3.5`} data-testid={`template-card-${t.id}`}>
                  <TemplateThumb audience={t.audience} />
                  <div className="flex items-start gap-2 mt-2.5">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-100 truncate">{t.label}</div>
                      <div className="text-[11px] text-gray-400 line-clamp-2">{t.notes || ''}</div>
                    </div>
                    <span className={`ml-auto flex-none px-1.5 py-0.5 rounded text-[10px] font-bold ${c.chip}`}>{AUDIENCE_LABELS[t.audience]}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2.5">
                    <button
                      type="button"
                      disabled={!!creatingFrom}
                      onClick={() => useTemplate(t)}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-violet-600 text-white text-[11.5px] font-semibold hover:bg-violet-700 disabled:opacity-60"
                      data-testid={`button-use-template-${t.id}`}
                    >
                      {creatingFrom === t.id ? <Loader2 size={11} className="animate-spin" /> : null} Use Template <ChevronRight size={11} />
                    </button>
                    <button type="button" onClick={() => setPreviewTpl(t)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11.5px] font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30" data-testid={`button-preview-template-${t.id}`}>
                      <Eye size={11} /> Preview
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ================= Audience inflows rail ================= */}
        <div className={`${CARD} p-4`} data-testid="audience-inflows">
          <div className={`${LBL} mb-3`}>Audience inflows</div>
          {AUDIENCES.map((a) => {
            const list = signupsByAudience[a] || [];
            const open = !!openAudiences[a];
            const routing = AUDIENCE_ROUTING[a];
            return (
              <div key={a} className="border-b border-gray-100 dark:border-gray-800 last:border-0 py-2">
                <button
                  type="button"
                  onClick={() => setOpenAudiences((o) => ({ ...o, [a]: !o[a] }))}
                  className="w-full flex items-center gap-2 text-left"
                  data-testid={`inflow-toggle-${a}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${AUDIENCE_COLORS[a].dot}`} />
                  <span className="text-[12px] font-bold text-gray-800 dark:text-gray-200">{AUDIENCE_LABELS[a]}</span>
                  <span className="text-[11.5px] font-semibold text-violet-600 dark:text-violet-400">{list.length}</span>
                  <ChevronDown size={13} className={`ml-auto text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`} />
                </button>
                {open && (
                  <div className="mt-2">
                    <div className="text-[10.5px] text-gray-400 mb-1.5">
                      Routing to →{' '}
                      {routing.to
                        ? <Link to={routing.to} className="text-violet-600 dark:text-violet-400 font-semibold hover:underline">{routing.label}</Link>
                        : <span className="font-semibold">{routing.label}</span>}
                    </div>
                    {list.length === 0 ? (
                      <div className="text-[11px] text-gray-400 italic">No signups yet</div>
                    ) : (
                      <>
                        {list.slice(0, 4).map((s) => (
                          <div key={s.id} className="flex items-center gap-2 py-1" data-testid={`inflow-lead-${s.id}`}>
                            <span className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-[10px] font-bold text-gray-500 dark:text-gray-300 flex items-center justify-center flex-none">
                              {((s.name || s.email || '?').trim()[0] || '?').toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <div className="text-[11.5px] font-semibold text-gray-800 dark:text-gray-200 truncate">{s.name || s.email}</div>
                              <div className="text-[10px] text-gray-400 truncate">{s.source || 'landing page'} · {timeAgo(s.created_at)}</div>
                            </div>
                            {a === 'customer' && (
                              <Link to="/spinout-lab/discovery" title="Log interview" className="ml-auto text-gray-300 hover:text-violet-600 dark:hover:text-violet-400 flex-none">
                                <CalendarPlus size={13} />
                              </Link>
                            )}
                          </div>
                        ))}
                        {a === 'customer' && list.length > 0 && (
                          <Link to="/spinout-lab/discovery" className="inline-block mt-1 text-[10.5px] font-semibold text-violet-600 dark:text-violet-400 hover:underline">
                            View all in Customer Discovery →
                          </Link>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- template preview modal ---- */}
      {previewTpl && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPreviewTpl(null)}>
          <div className={`${CARD} w-full max-w-md p-5`} onClick={(e) => e.stopPropagation()} data-testid="template-preview-modal">
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${AUDIENCE_COLORS[previewTpl.audience].chip}`}>{AUDIENCE_LABELS[previewTpl.audience]}</span>
              <button type="button" onClick={() => setPreviewTpl(null)} className="ml-auto text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="text-[16px] font-extrabold text-gray-900 dark:text-gray-100 mt-2">{previewTpl.label}</div>
            <p className="text-[12.5px] text-gray-500 dark:text-gray-400 mt-1">{previewTpl.notes}</p>
            <div className="mt-3"><TemplateThumb audience={previewTpl.audience} /></div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]">
              <div><dt className={LBL}>Goal</dt><dd className="text-gray-700 dark:text-gray-200 font-semibold">{(previewTpl.primaryGoal || '').replace(/_/g, ' ')}</dd></div>
              <div><dt className={LBL}>CTA</dt><dd className="text-gray-700 dark:text-gray-200 font-semibold">{previewTpl.defaultCtaLabel}</dd></div>
            </dl>
            <button
              type="button"
              onClick={() => { const t = previewTpl; setPreviewTpl(null); useTemplate(t); }}
              className="mt-4 w-full h-9 rounded-lg bg-violet-600 text-white text-[12.5px] font-semibold hover:bg-violet-700"
              data-testid="button-preview-use-template"
            >
              Use Template →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
