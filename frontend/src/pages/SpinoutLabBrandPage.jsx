// Spin-Out Lab — Brand & Landing Pages (Week 2 tool page).
//
// Design handoff: attached_assets/Brand_&_Landing_Page.dc_*.html (same file
// ships in the repo under spin-out-lab-pipeline/project). Mapping to REAL
// surfaces only:
//   - Brand identity rail: the project's landing brand record
//     (GET/PUT /brand/landing/by-project/:pid — name, tagline, palette,
//     font pairing, logo upload + AI generate).
//   - Your pages: the real multi-page landing backend
//     (/brand/landing/by-project/:pid/pages CRUD + publish + preview-url).
//     Edit opens the design's inline page editor (device preview, four copy
//     blocks, per-page Save draft / Publish); the full builder at
//     /build/brand stays linked from the editor for layout & media work.
//   - Template library: the existing 16-template catalog
//     (lib/brand/templates.js TEMPLATES) — same names and audiences,
//     rendered in the new library UI; Use Template creates a real page
//     seeded with the template's visual style, palette, goal and CTA.
//   - Audience inflows: real waitlist signups
//     (GET /brand/landing/by-project/:pid/waitlist) grouped by audience,
//     with routing into Customer Discovery and a real "Invite to meet"
//     product-invitation email for customer leads.
//   - Omitted (no backend): brand-voice tags, the light/dark logo variants,
//     an "Archived" page status, and the design's Log Interview capture
//     lightbox (its capture/format/duration/ICP fields belong to the
//     discovery-flow backend — leads deep-link there instead).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Palette, Upload, Sparkles, Check, AlertTriangle, X,
  ExternalLink, Copy, Plus, Pencil, Eye, CalendarPlus, ChevronDown, ChevronRight,
  Monitor, Smartphone, LayoutGrid, List,
} from 'lucide-react';
import LabPageHeader from '../components/spinout/LabPageHeader';
import { api } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
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
// Every destination is a REAL page that renders an "INBOUND LEADS · BRAND &
// PAGES" panel fed by the same contacts hub this rail reads, so the counts
// here and the lists there always agree:
//   customer → Lab Customer Discovery   advisor → Lab Advisors
//   cofounder → Lab Co-founder Match    investor → Lab Capital
//   partner → Marketplace (routeFor: partner → marketplace)
//   mentor → Advisory (routeFor: mentor → advisory)
const AUDIENCE_ROUTING = {
  customer: { label: 'Customer Discovery', to: '/spinout-lab/discovery' },
  advisor: { label: 'Advisors', to: '/spinout-lab/advisors' },
  cofounder: { label: 'Co-founder Match', to: '/spinout-lab/cofounder-match' },
  investor: { label: 'Capital', to: '/spinout-lab/capital' },
  partner: { label: 'Marketplace', to: '/build/marketplace' },
  mentor: { label: 'Advisory', to: '/advisory' },
};

// Read-only "Form fields" chips per audience — mirrors the design's
// formFieldMap exactly for the audiences it defines (customers / advisors /
// co-founders / investors / partners); mentor has no design row and follows
// the advisor pattern. Presentational only: the public signup form itself
// stays the email(+name) waitlist capture.
const AUDIENCE_FORM_FIELDS = {
  customer: ['Email'],
  advisor: ['Name', 'Email', 'LinkedIn', 'Area of expertise'],
  cofounder: ['Name', 'Email', 'Role interest', 'LinkedIn'],
  investor: ['Name', 'Email', 'Fund / firm'],
  partner: ['Name', 'Email', 'Service type'],
  mentor: ['Name', 'Email', 'Area of guidance'],
};

// B4 — the pairing metadata (FONT_PAIRING_OPTIONS) carries no font stacks, so
// this mirrors fontStack() in cloudflare-worker/src/services/landingTemplates.ts
// — the stacks the published page really renders with. Keep in lockstep.
const FONT_PAIRING_STACKS = {
  editorial: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Georgia", "Times New Roman", serif',
  modern: '-apple-system, BlinkMacSystemFont, "Segoe UI", "SF Pro Display", "Roboto", "Helvetica Neue", sans-serif',
  humanist: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Gill Sans", "Gill Sans MT", sans-serif',
  classic: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Palatino", "Book Antiqua", serif',
};

// The design derives each thumbnail's geometry from a template `kind` (video
// hero / before-after split / plain form). The real catalog has no kind field,
// so derive it from the visual template: launch/teaser visuals get the video
// hero block, narrative & before-after visuals get the split, and every kind
// ends in the email + CTA form row (as in the design's thumb()).
const KIND_MEDIA = new Set(['video-first', 'builders-launchpad', 'seed-stage-spark']);
const KIND_SPLIT = new Set(['proof-builder', 'capital-storyteller', 'co-founder-canvas']);
const templateKind = (visual) => ({ media: KIND_MEDIA.has(visual), split: KIND_SPLIT.has(visual) });

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

// Which landing-page template a lead signed up through. Contacts rows carry
// landing_template_kit / landing_page_name from the worker's attribution
// JOIN; legacy waitlist rows only have the raw source string.
const leadSource = (row) => templateById(row.landing_template_kit)?.label
  || row.landing_page_name
  || row.source
  || 'landing page';

/** Mini placeholder thumbnail — layout bars whose geometry follows the
 *  template kind, like the design's scaled-down previews (pure CSS; no live
 *  render backend for templates). When the template has a signature palette
 *  (`visual`), the thumb paints with the design's OWN background + accent so
 *  each card reads as its actual look (dark investor briefs vs warm cream
 *  letters) instead of a generic audience tint; the audience color remains
 *  the fallback. `flush` renders it as the edge-to-edge strip of a page card;
 *  `tall` is the larger library-card variant. */
function TemplateThumb({ audience, kind = {}, flush = false, tall = false, visual = null }) {
  const sig = visual ? VISUAL_TEMPLATE_PALETTES[visual] : null;
  const bar = sig?.theme_color || AUDIENCE_COLORS[audience]?.bar || '#7c3aed';
  const bg = sig?.palette_bg || null;
  const ink = sig?.palette_ink || null;
  const dark = !!sig && isDarkHex(sig.palette_bg);
  const lineA = sig ? (dark ? `${ink}66` : `${ink}55`) : null;
  const lineB = sig ? (dark ? `${ink}3d` : `${ink}33`) : null;
  const height = flush ? 'h-24 border-b' : tall ? 'h-32 rounded-lg border' : 'h-20 rounded-lg border';
  return (
    <div
      className={`${height} ${sig ? '' : 'bg-gray-50 dark:bg-gray-800'} border-gray-100 dark:border-gray-700 p-2.5 overflow-hidden flex flex-col gap-1`}
      style={sig ? { background: bg } : undefined}
    >
      <div className="h-1.5 w-2/5 rounded-full flex-none" style={{ background: bar, opacity: 0.85 }} />
      <div className={`h-1 w-4/5 rounded-full flex-none ${sig ? '' : 'bg-gray-300 dark:bg-gray-600'}`} style={sig ? { background: lineA } : undefined} />
      <div className={`h-1 w-3/5 rounded-full flex-none ${sig ? '' : 'bg-gray-200 dark:bg-gray-600'}`} style={sig ? { background: lineB } : undefined} />
      {kind.media && (
        <div className="h-6 rounded flex-none flex items-center justify-center" style={{ background: `${bar}22` }}>
          <span className="w-0 h-0 border-y-[5px] border-y-transparent border-l-[8px]" style={{ borderLeftColor: bar }} />
        </div>
      )}
      {kind.split && (
        <div className="flex gap-1 flex-none">
          <div className="h-5 flex-1 rounded bg-red-100 dark:bg-red-950/50" />
          <div className="h-5 flex-1 rounded bg-emerald-100 dark:bg-emerald-950/50" />
        </div>
      )}
      <div className="flex gap-1 mt-auto">
        <div className={`h-3.5 flex-1 rounded border ${sig ? 'border-transparent' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600'}`} style={sig ? { background: dark ? '#ffffff22' : '#ffffffcc' } : undefined} />
        <div className="h-3.5 w-9 rounded" style={{ background: bar }} />
      </div>
    </div>
  );
}

// Relative-luminance check so signature-palette thumbs pick legible line
// tints on both dark (Capital Ready Kit) and light (Advisor Connect) designs.
function isDarkHex(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128;
}

// The four editable content blocks of the inline editor (design's editBlocks).
const EDITOR_BLOCKS = [
  { key: 'headline', label: 'Headline', multiline: false },
  { key: 'subheadline', label: 'Subheadline', multiline: false },
  { key: 'body', label: 'Body copy', multiline: true },
  { key: 'cta', label: 'CTA label', multiline: false },
];

export default function SpinoutLabBrandPage() {
  const { user } = useAuth();
  const { toast, showToast } = useToast(3500);
  const fileRef = useRef(null);
  const libraryRef = useRef(null);

  const [projectId, setProjectId] = useState(null);
  // Full Lab project record — the auto-population source for template copy
  // (name / description / problem_statement / solution / sector), same data
  // SpinoutLabStartupPage renders as the company identity.
  const [project, setProject] = useState(null);
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
  // Waitlist rows (legacy capture log) — kept for per-page sub counts and the
  // customer "Invite to meet" action, whose endpoint is keyed by waitlist
  // signup id.
  const [signups, setSignups] = useState([]);
  // Contacts-hub rows — the 6-audience inflow source. The legacy
  // waitlist_signups.audience column is CHECK-limited to customer/partner/
  // investor (advisor/mentor/cofounder signups store NULL there), so counting
  // from it silently zeroed three audiences and inflated Customers. The
  // contacts table carries the full taxonomy plus the landing-page/template
  // attribution the rail now shows.
  const [contacts, setContacts] = useState([]);
  const [busyPage, setBusyPage] = useState(null); // page id being duplicated etc.
  const [creatingFrom, setCreatingFrom] = useState(null); // template id being used
  const [libFilter, setLibFilter] = useState('all');
  // Template library view — grid (thumbnail cards) or list (compact rows).
  // Persisted per browser; there is no server-side UI-prefs store for this.
  const [libView, setLibView] = useState(() => {
    try { return localStorage.getItem('spinoutBrandLibView') === 'list' ? 'list' : 'grid'; }
    catch { return 'grid'; }
  });
  const [previewTpl, setPreviewTpl] = useState(null);
  const [openAudiences, setOpenAudiences] = useState({ customer: true });
  const [inflowExpanded, setInflowExpanded] = useState({}); // audience → show all leads
  const [invitingLead, setInvitingLead] = useState(null); // signup id being invited

  // ---- inline page editor (the design's second view; internal state, not a
  // route — "← Pages" simply drops back to the manager grid) ----
  const [editorRec, setEditorRec] = useState(null); // full page record while editing
  const [openingPage, setOpeningPage] = useState(null); // page id whose record is loading
  const [editorBlocks, setEditorBlocks] = useState({ headline: '', subheadline: '', body: '', cta: '' });
  const [editorDevice, setEditorDevice] = useState('desktop');
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedFlash, setPublishedFlash] = useState(null); // { url } only after a real publish
  const [linkCopied, setLinkCopied] = useState(false);
  const [applyBrandColors, setApplyBrandColors] = useState(true);
  const [suggest, setSuggest] = useState(null); // { block, loading, variants }
  const autofillRef = useRef(null); // one cached autofill promise per editor session

  // Resolve the founder's Lab project (same picker as the other tool pages).
  // The full record is kept — not just the id — so template auto-population
  // can draw on description / problem_statement / solution / sector.
  useEffect(() => {
    let alive = true;
    setProjectLoading(true);
    api.listProjects()
      .then((projects) => {
        if (!alive) return;
        const proj = pickLabProject(projects, user);
        setProject(proj || null);
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
      api.contactsList(),
    ]).then(([lp, pg, wl, ct]) => {
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
      // Contacts scope to the founder's own projects server-side; keep only
      // this Lab project's leads so the rail matches the pages shown here.
      if (ct.status === 'fulfilled') {
        setContacts((ct.value?.items || []).filter((c) => Number(c.project_id) === Number(projectId)));
      }
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
      const created = await api.brandCreatePage(projectId, {
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
      // W2 deliverable — a real landing page now exists for this project.
      markMilestone(user, 'landing_page_created');
      // Using a template opens the draft straight in the inline editor —
      // content is reviewed/edited before publishing, not published blind.
      if (created?.id) {
        showToast({ msg: `"${tpl.label}" draft created — edit the content, then publish.`, kind: 'ok' });
        await openEditor(created);
      } else {
        showToast({ msg: `Created "${tpl.label}" draft — open Edit to finish it.`, kind: 'ok' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (e) {
      setError(e?.message || 'Could not create the page');
      reportError('SpinoutLabBrandPage:useTemplate', e);
    } finally { setCreatingFrom(null); }
  };

  const scrollToLibrary = (audience) => {
    setLibFilter(audience);
    libraryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---- inflow actions ----
  // B20 — real product-invitation email. The endpoint
  // (/progress/discovery/:pid/waitlist/:sid/invite) is customer-scoped
  // server-side (404 for other audiences), so only customer leads get the
  // invite action.
  const onInviteLead = async (s) => {
    if (invitingLead || !projectId) return;
    setInvitingLead(s.id); setError('');
    try {
      await api.inviteWaitlistCustomer(projectId, s.id);
      showToast({ msg: `Invitation sent to ${s.email}.`, kind: 'ok' });
    } catch (e) {
      setError(e?.message || `Couldn't invite ${s.email}`);
      reportError('SpinoutLabBrandPage:invite', e);
    } finally { setInvitingLead(null); }
  };

  // ---- inline page editor ----
  const editorAud = editorRec && AUDIENCES.includes(editorRec.audience) ? editorRec.audience : 'customer';
  const editorRouting = AUDIENCE_ROUTING[editorAud];
  const editorTpl = templateById(editorRec?.template_kit);

  const openEditor = async (page) => {
    if (openingPage) return;
    setOpeningPage(page.id); setError('');
    try {
      const rec = await api.brandGetPage(page.id);
      const aud = AUDIENCES.includes(rec.audience) ? rec.audience : 'customer';
      // Auto-population: blocks the founder hasn't written yet pre-fill from
      // data already captured elsewhere in the workspace — the brand record
      // (tagline) and the Lab PROJECT record (description / problem_statement
      // / solution), the same single source of truth the Startup page and the
      // deck autofill read. Nothing is persisted until Save draft / Publish.
      const seededHeadline = rec.headline || draft.tagline || rec.tagline || project?.name || '';
      const seededSub = rec.subheadline || project?.description || '';
      const seededBody = rec[`audience_${aud}_body`]
        || [project?.problem_statement, project?.solution].filter(Boolean).join('\n\n')
        || '';
      setEditorBlocks({
        headline: seededHeadline,
        subheadline: seededSub,
        // Body copy lives in the page audience's copy column — the column the
        // public renderer reads for this audience (falling back to subheadline).
        body: seededBody,
        cta: rec.cta_text || '',
      });
      setEditorDevice('desktop');
      setApplyBrandColors(true);
      setSuggest(null);
      setPublishedFlash(null);
      setLinkCopied(false);
      autofillRef.current = null;
      setEditorRec(rec);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e?.message || 'Could not open the page editor');
      reportError('SpinoutLabBrandPage:openEditor', e);
    } finally { setOpeningPage(null); }
  };

  const closeEditor = () => {
    setEditorRec(null);
    setSuggest(null);
    setPublishedFlash(null);
  };

  // Build the PUT body for the editor. brandUpdatePage is a FULL-ROW update
  // on the worker (fields missing from the body are reset to defaults), so
  // the loaded record is carried over through the same explicit DUP_FIELDS
  // allowlist as onDuplicate — never a spread of the server row — and the
  // four edited blocks are layered on top.
  const editorPayload = () => {
    const rec = editorRec;
    const payload = { name: rec.name };
    for (const k of DUP_FIELDS) {
      if (rec[k] !== undefined && rec[k] !== null) payload[k] = rec[k];
    }
    let cj = rec.content_json;
    if (typeof cj === 'string') { try { cj = JSON.parse(cj); } catch { cj = null; } }
    if (cj && typeof cj === 'object' && !Array.isArray(cj)) payload.content_json = cj;
    payload.headline = editorBlocks.headline.trim() || null;
    payload.subheadline = editorBlocks.subheadline.trim() || null;
    payload.cta_text = editorBlocks.cta.trim() || 'Join the waitlist';
    payload[`audience_${editorAud}_body`] = editorBlocks.body.trim() || null;
    return payload;
  };

  const saveDraft = async () => {
    if (!editorRec || savingDraft || publishing) return false;
    setSavingDraft(true); setError('');
    try {
      const updated = await api.brandUpdatePage(editorRec.id, editorPayload());
      if (updated && updated.id) setEditorRec(updated);
      await refreshPages();
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
      return true;
    } catch (e) {
      setError(e?.message || 'Could not save the draft');
      reportError('SpinoutLabBrandPage:saveDraft', e);
      return false;
    } finally { setSavingDraft(false); }
  };

  const publishPage = async () => {
    if (!editorRec || publishing || savingDraft) return;
    setPublishing(true); setError('');
    try {
      // Save first so the live page shows exactly what's in the editor,
      // then flip the real per-page publish bit.
      const updated = await api.brandUpdatePage(editorRec.id, editorPayload());
      const r = await api.brandPublishPage(editorRec.id, true);
      if (!r?.published) throw new Error('Publish failed');
      let url = null;
      try {
        const pu = await api.brandPagePreviewUrl(editorRec.id);
        const raw = pu?.url || pu?.preview_url || null;
        if (raw) url = raw.startsWith('http') ? raw : `${window.location.origin}${raw}`;
      } catch { /* success strip renders without the link */ }
      setEditorRec({ ...(updated && updated.id ? updated : editorRec), published: true });
      setPublishedFlash({ url });
      setLinkCopied(false);
      await refreshPages();
    } catch (e) {
      setError(e?.message || 'Publish failed');
      reportError('SpinoutLabBrandPage:publish', e);
    } finally { setPublishing(false); }
  };

  const copyLiveLink = async () => {
    if (!publishedFlash?.url) return;
    try {
      await navigator.clipboard.writeText(publishedFlash.url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch { setError('Could not copy the link'); }
  };

  // Founder-authored product description for the autofill prompt (the endpoint
  // 400s under 4 chars) — best available real text, newest edit first, then
  // the Lab project record (same source BrandBuilderPage feeds the endpoint).
  const suggestDescription = () => {
    const rec = editorRec || {};
    const cands = [
      editorBlocks.body, rec[`audience_${editorAud}_body`], editorBlocks.subheadline,
      rec.subheadline, rec.tagline, draft.tagline,
      project?.description, project?.problem_statement,
    ];
    for (const c of cands) {
      const s = (c || '').trim();
      if (s.length >= 4) return s;
    }
    return null;
  };

  // Adapt the single-shot autofill response into pickable per-block variants:
  // api.brandAutofillLanding returns ONE { headline, subheadline, tagline,
  // cta_text, content } object per call (not a variant list), so one response
  // is cached per editor session and each block's popover lists the distinct
  // candidates the response implies for that block.
  const variantsForBlock = (blockKey, r) => {
    const rec = editorRec || {};
    const current = (editorBlocks[blockKey] || '').trim().toLowerCase();
    const out = [];
    const push = (v) => {
      if (typeof v !== 'string') return;
      const s = v.trim();
      if (s.length < 3 || s.toLowerCase() === current) return;
      if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
    };
    if (blockKey === 'headline') { push(r.headline); push(r.tagline); push(rec.tagline); }
    else if (blockKey === 'subheadline') { push(r.subheadline); push(r.tagline); }
    else if (blockKey === 'body') {
      // The content payload's string fields (thesis/vision/mission-style
      // textareas) read as body copy on the published page — mine those first.
      for (const v of Object.values(r.content || {})) push(v);
      push(r.subheadline);
    } else if (blockKey === 'cta') { push(r.cta_text); push(templateById(rec.template_kit)?.defaultCtaLabel); }
    return out.slice(0, 3);
  };

  const openSuggest = async (blockKey) => {
    if (suggest?.block === blockKey && !suggest.loading) { setSuggest(null); return; }
    setSuggest({ block: blockKey, loading: true, variants: [] });
    if (!autofillRef.current) {
      const description = suggestDescription();
      if (!description) { setSuggest({ block: blockKey, loading: false, variants: [] }); return; }
      // Cache the PROMISE so concurrent popovers share one request; a failed
      // call clears it so the next click retries.
      autofillRef.current = api.brandAutofillLanding({
        name: (draft.name || project?.name || editorRec?.name || '').trim(),
        // Same project-record source BrandBuilderPage feeds this endpoint.
        sector: project?.sector || null,
        description,
        template: editorRec?.template || 'minimal',
      });
    }
    let r = null;
    try { r = await autofillRef.current; }
    catch (e) {
      autofillRef.current = null;
      reportError('SpinoutLabBrandPage:suggest', e);
      setSuggest({ block: blockKey, loading: false, variants: [] });
      return;
    }
    setSuggest({ block: blockKey, loading: false, variants: variantsForBlock(blockKey, r || {}) });
  };

  const pickSuggestion = (blockKey, text) => {
    setEditorBlocks((b) => ({ ...b, [blockKey]: text }));
    setSuggest(null);
  };

  // ---- derived ----
  const filteredTemplates = useMemo(
    () => (libFilter === 'all' ? TEMPLATES : TEMPLATES.filter((t) => t.audience === libFilter)),
    [libFilter],
  );
  // Inflows read from the CONTACTS hub, which carries the full 6-audience
  // taxonomy — the legacy waitlist column CHECK-limits audience to customer/
  // partner/investor, storing NULL for the other three, so bucketing waitlist
  // rows mis-filed every advisor/mentor/co-founder lead under Customers.
  // Falls back to the waitlist rows only when contacts returned nothing at
  // all (e.g. a dev backend predating the contacts mirror).
  const signupsByAudience = useMemo(() => {
    const m = {};
    for (const a of AUDIENCES) m[a] = [];
    if (contacts.length > 0) {
      for (const c of contacts) {
        const a = AUDIENCES.includes(c.audience) ? c.audience : 'customer';
        m[a].push(c);
      }
    } else {
      for (const s of signups) {
        const a = AUDIENCES.includes(s.audience) ? s.audience : 'customer';
        m[a].push(s);
      }
    }
    return m;
  }, [contacts, signups]);

  // The customer "Invite to meet" endpoint is keyed by WAITLIST signup id.
  // Contact rows carry the same email (both writes happen on the same public
  // capture), so map a rail row back to its waitlist record by email.
  const waitlistByEmail = useMemo(() => {
    const m = new Map();
    for (const s of signups) {
      const key = (s.email || '').toLowerCase();
      if (key && !m.has(key)) m.set(key, s);
    }
    return m;
  }, [signups]);

  // B4 — brand preview card + editor preview render with the pairing's real
  // published stacks (see FONT_PAIRING_STACKS).
  const pairingStack = FONT_PAIRING_STACKS[draft.font_pairing] || FONT_PAIRING_STACKS.editorial;
  const previewStack = FONT_PAIRING_STACKS[editorRec?.font_pairing || draft.font_pairing] || FONT_PAIRING_STACKS.editorial;
  // "Apply brand colors" previews the PROJECT palette on the pane (design's
  // toggle copy); off shows the page's own stored palette. Client-side only —
  // nothing is written until Save draft / Publish.
  const previewAccent = applyBrandColors
    ? (draft.theme_color || '#7c3aed')
    : (editorRec?.theme_color || '#7c3aed');

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
      {/* Canonical Lab header. The page root has no space-y-*, so the header
          carries its own mb-5 (the old mb-1.5 row + mb-5 description are gone).
          The title promotes from <span> to the component's <h1>; the only other
          <h1> in this file lives in the mutually-exclusive `!projectId` early
          return, so the page still renders exactly one. */}
      <LabPageHeader
        className="mb-5"
        icon={Palette}
        title="Brand & Landing Pages"
        subtitle="Create landing pages for your audience"
        status="Active"
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-[12.5px] text-red-700 dark:text-red-300">
          <AlertTriangle size={14} className="flex-none" /> {error}
          <button type="button" onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600"><X size={14} /></button>
        </div>
      )}

      {editorRec ? (
        /* ================= Inline page editor (design's second view) ================= */
        <div data-testid="page-editor">
          {/* ---- editor top bar ---- */}
          <div className={`${CARD} px-4 py-3 flex flex-wrap items-center gap-3 mb-4`}>
            <button
              type="button"
              onClick={closeEditor}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              data-testid="button-editor-back"
            >
              <ArrowLeft size={13} /> Pages
            </button>
            <div className="min-w-0">
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100 truncate">{editorRec.name}</div>
              <div className="text-[11px] text-gray-400 truncate">{editorTpl?.label || editorRec.template}</div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="flex gap-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
                {['desktop', 'mobile'].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setEditorDevice(d)}
                    className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11.5px] font-semibold ${editorDevice === d ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
                    data-testid={`device-${d}`}
                  >
                    {d === 'desktop' ? <Monitor size={12} /> : <Smartphone size={12} />}
                    {d === 'desktop' ? 'Desktop' : 'Mobile'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={saveDraft}
                disabled={savingDraft || publishing}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
                data-testid="button-save-draft"
              >
                {savingDraft ? <Loader2 size={12} className="animate-spin" /> : draftSaved ? <Check size={12} /> : null}
                {draftSaved ? 'Draft saved' : 'Save draft'}
              </button>
              <button
                type="button"
                onClick={publishPage}
                disabled={publishing || savingDraft}
                title={editorRec.published ? 'Republish with the latest content' : undefined}
                className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[12px] font-bold text-white disabled:opacity-60 ${editorRec.published ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-violet-600 hover:bg-violet-700'}`}
                data-testid="button-publish-page"
              >
                {publishing ? <Loader2 size={12} className="animate-spin" /> : editorRec.published ? <Check size={12} /> : null}
                {editorRec.published ? 'Published' : 'Publish'}
              </button>
            </div>
          </div>

          {/* ---- publish success strip (real URL + routing destination) ---- */}
          {publishedFlash && (
            <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 px-3.5 py-2.5 text-[12px] text-emerald-700 dark:text-emerald-300" data-testid="publish-flash">
              <Check size={13} className="flex-none" />
              <span className="font-semibold">Published</span>
              {publishedFlash.url && (
                <code className="font-mono text-[11px] bg-white/70 dark:bg-black/20 rounded px-1.5 py-0.5 break-all">{publishedFlash.url}</code>
              )}
              <span>
                · submissions now routing to{' '}
                {editorRouting.to
                  ? <Link to={editorRouting.to} className="font-semibold hover:underline">{editorRouting.label}</Link>
                  : <span className="font-semibold">{editorRouting.label}</span>}
              </span>
              {publishedFlash.url && (
                <button type="button" onClick={copyLiveLink} className="ml-auto inline-flex items-center gap-1 font-semibold hover:underline" data-testid="button-copy-live-link">
                  <Copy size={11} /> {linkCopied ? 'Copied' : 'Copy link'}
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 items-start">
            {/* ---- left: page content blocks ---- */}
            <div className={`${CARD} p-4`} data-testid="page-editor-content">
              <div className="flex items-center gap-2 mb-3">
                <div className={LBL}>Page content</div>
                <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  <span className={`w-1.5 h-1.5 rounded-full ${AUDIENCE_COLORS[editorAud].dot}`} /> {AUDIENCE_LABELS[editorAud]}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {EDITOR_BLOCKS.map((b) => (
                  <div key={b.key} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3" data-testid={`editor-block-${b.key}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={LBL}>{b.label}</span>
                      <button
                        type="button"
                        onClick={() => openSuggest(b.key)}
                        className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10.5px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-900/50 hover:bg-violet-100 dark:hover:bg-violet-950/60"
                        data-testid={`button-suggest-${b.key}`}
                      >
                        <Sparkles size={10} /> Suggest copy
                      </button>
                    </div>
                    {b.multiline ? (
                      <textarea
                        rows={3}
                        className={`${INPUT} h-auto py-1.5 resize-y`}
                        value={editorBlocks[b.key]}
                        onChange={(e) => setEditorBlocks((v) => ({ ...v, [b.key]: e.target.value }))}
                        data-testid={`input-block-${b.key}`}
                      />
                    ) : (
                      <input
                        className={INPUT}
                        value={editorBlocks[b.key]}
                        onChange={(e) => setEditorBlocks((v) => ({ ...v, [b.key]: e.target.value }))}
                        data-testid={`input-block-${b.key}`}
                      />
                    )}
                    {suggest?.block === b.key && (
                      /* Popover header drops the design's brand-voice tag
                         summary — voice tags need a backend column (see file
                         header) — and shows the page audience instead. */
                      <div className="mt-2 rounded-lg border border-violet-100 dark:border-violet-900/50 overflow-hidden" data-testid={`suggest-pop-${b.key}`}>
                        <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40">
                          AI suggestions · {AUDIENCE_LABELS[editorAud]}
                        </div>
                        {suggest.loading ? (
                          <div className="px-2.5 py-2.5 flex items-center gap-2 text-[11.5px] text-gray-400">
                            <Loader2 size={12} className="animate-spin" /> Generating…
                          </div>
                        ) : suggest.variants.length === 0 ? (
                          <div className="px-2.5 py-2.5 text-[11.5px] text-gray-400">Suggestions unavailable</div>
                        ) : (
                          suggest.variants.map((v, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => pickSuggestion(b.key, v)}
                              className="block w-full text-left px-2.5 py-2 text-[12px] leading-snug text-gray-700 dark:text-gray-200 border-t border-gray-100 dark:border-gray-800 hover:bg-violet-50/60 dark:hover:bg-violet-950/30"
                            >
                              {v}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* read-only form-field chips for the page's audience */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3" data-testid="editor-form-fields">
                  <span className={LBL}>Form fields</span>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(AUDIENCE_FORM_FIELDS[editorAud] || ['Email']).map((f) => (
                      <span key={f} className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-[11px] font-semibold text-gray-600 dark:text-gray-300">{f}</span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <div>
                    <div className="text-[12px] font-semibold text-gray-800 dark:text-gray-200">Apply brand colors</div>
                    <div className="text-[10.5px] text-gray-400">Use the project palette on this preview</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={applyBrandColors}
                    onClick={() => setApplyBrandColors((v) => !v)}
                    className={`relative w-9 h-5 flex-none rounded-full transition-colors ${applyBrandColors ? 'bg-violet-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                    data-testid="toggle-brand-colors"
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${applyBrandColors ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>

                <Link to="/build/brand" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-violet-600 dark:text-violet-400 hover:underline" data-testid="link-full-builder">
                  Open the full builder for layout &amp; media <ExternalLink size={11} />
                </Link>
              </div>
            </div>

            {/* ---- right: live preview pane ---- */}
            <div className="rounded-2xl bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 p-5 flex items-start justify-center overflow-x-auto" data-testid="editor-preview">
              {/* Deliberately a standalone light artboard (no dark: pairs
                  inside): it previews the public landing page document, not
                  the app UI. */}
              {/* dark-mode-exempt: the artboard IS the light public page. */}
              <div
                className="bg-white rounded-xl shadow-xl overflow-hidden transition-all flex-none"
                style={{ width: editorDevice === 'mobile' ? 390 : '100%', maxWidth: '100%' }}
              >
                <div className={editorDevice === 'mobile' ? 'px-5 py-6' : 'px-10 py-9'} style={{ fontFamily: previewStack }}>
                  <div className="h-2 w-16 rounded-full mb-5" style={{ background: previewAccent }} />
                  <div className={`font-extrabold text-gray-900 leading-tight mb-3 ${editorDevice === 'mobile' ? 'text-[22px]' : 'text-[30px]'}`}>
                    {editorBlocks.headline || editorRec.name}
                  </div>
                  {editorBlocks.subheadline && (
                    <div className={`text-gray-500 mb-4 ${editorDevice === 'mobile' ? 'text-[13.5px]' : 'text-[15px]'}`}>{editorBlocks.subheadline}</div>
                  )}
                  {editorBlocks.body && (
                    <div className="text-[13px] text-gray-600 leading-relaxed mb-6 whitespace-pre-line">{editorBlocks.body}</div>
                  )}
                  <div className={`border-t border-gray-100 pt-5 gap-2 ${editorDevice === 'mobile' ? 'flex flex-col' : 'flex flex-wrap items-center'}`}>
                    {/* dark-mode-exempt: form mock inside the light artboard above. */}
                    {(AUDIENCE_FORM_FIELDS[editorAud] || ['Email']).map((f) => (
                      <div key={f} className="h-10 flex-1 min-w-[110px] rounded-lg border border-gray-200 bg-gray-50 px-3 flex items-center text-[12px] text-gray-400">{f}</div>
                    ))}
                    <div className="h-10 px-4 rounded-lg flex-none flex items-center justify-center text-[12.5px] font-bold text-white whitespace-nowrap" style={{ background: previewAccent }}>
                      {editorBlocks.cta || 'Join the waitlist'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Two-column shell: the template library + pages own the main column;
           Brand identity and Audience inflows share the right rail (identity
           row 1, inflows row 2 — grid-rows-[auto_1fr] keeps them stacked
           tight while the main column spans both rows). On mobile everything
           stacks in source order, same as before the restructure. */
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr] gap-5 items-start">
          {/* ================= Brand identity (right rail, top) ================= */}
          <div className={`${CARD} p-4 lg:col-start-2 lg:row-start-1`} data-testid="brand-identity-panel">
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

            {/* B3 — deliberate substitution: the design specs two selects
                (Heading / Body) across six retail fonts (Satoshi, General
                Sans, Instrument Serif, Cabinet Grotesk, Inter, DM Sans);
                landing_pages persists a single font_pairing preset id
                (editorial | modern | humanist | classic), so one pairing
                select is the real control here. */}
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
              <div className="mt-4 rounded-xl border border-gray-100 dark:border-gray-800 p-3" style={{ background: draft.palette_bg || undefined, fontFamily: pairingStack }}>
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

          {/* ================= Main: pages + template library ================= */}
          <div className="min-w-0 lg:col-start-1 lg:row-start-1 lg:row-span-2">
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
                      <TemplateThumb audience={aud} kind={templateKind(p.template)} flush />
                      <div className="px-4 pt-2.5 pb-3.5">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.chip}`}>{AUDIENCE_LABELS[aud]}</span>
                          {/* B6 "Archived" status skipped — landing_pages has
                              only the published boolean, no archived state. */}
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
                          <button type="button" disabled={openingPage === p.id} onClick={() => openEditor(p)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-violet-600 text-white text-[11.5px] font-semibold hover:bg-violet-700 disabled:opacity-60" data-testid={`button-edit-page-${p.id}`}>
                            {openingPage === p.id ? <Loader2 size={11} className="animate-spin" /> : <Pencil size={11} />} Edit
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
              {/* Grid / list view toggle — persisted per browser. */}
              <div
                className="ml-auto flex gap-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5"
                role="group"
                aria-label="Template library view"
                data-testid="library-view-toggle"
              >
                {[['grid', LayoutGrid, 'Thumbnail grid view'], ['list', List, 'List view']].map(([v, Icon, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-label={label}
                    aria-pressed={libView === v}
                    onClick={() => {
                      setLibView(v);
                      try { localStorage.setItem('spinoutBrandLibView', v); } catch { /* private mode */ }
                    }}
                    className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11.5px] font-semibold ${libView === v ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
                    data-testid={`library-view-${v}`}
                  >
                    <Icon size={12} /> {v === 'grid' ? 'Grid' : 'List'}
                  </button>
                ))}
              </div>
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

            {libView === 'grid' ? (
              /* Two-up cards in the (now full-width) main column — roughly
                 double the old three-in-a-narrow-center size, with the full
                 title and description visible and a taller, signature-palette
                 thumbnail per template. */
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="template-grid">
                {filteredTemplates.map((t) => {
                  const c = AUDIENCE_COLORS[t.audience];
                  return (
                    <div key={t.id} className={`${CARD} p-4`} data-testid={`template-card-${t.id}`}>
                      <TemplateThumb audience={t.audience} kind={templateKind(t.visualTemplate)} visual={t.visualTemplate} tall />
                      <div className="flex items-start gap-2 mt-3">
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100">{t.label}</div>
                          <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{t.notes || ''}</div>
                        </div>
                        <span className={`ml-auto flex-none px-2 py-0.5 rounded text-[10.5px] font-bold ${c.chip}`}>{AUDIENCE_LABELS[t.audience]}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          type="button"
                          disabled={!!creatingFrom}
                          onClick={() => useTemplate(t)}
                          className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-violet-600 text-white text-[12px] font-semibold hover:bg-violet-700 disabled:opacity-60"
                          data-testid={`button-use-template-${t.id}`}
                        >
                          {creatingFrom === t.id ? <Loader2 size={12} className="animate-spin" /> : null} Use &amp; edit <ChevronRight size={12} />
                        </button>
                        <button type="button" onClick={() => setPreviewTpl(t)} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-[12px] font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30" data-testid={`button-preview-template-${t.id}`}>
                          <Eye size={12} /> Preview
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* List view — one row per template: small signature thumb, full
                 title + description, audience chip, actions. */
              <div className="flex flex-col gap-2.5" data-testid="template-list">
                {filteredTemplates.map((t) => {
                  const c = AUDIENCE_COLORS[t.audience];
                  return (
                    <div key={t.id} className={`${CARD} p-3 flex items-center gap-3.5`} data-testid={`template-card-${t.id}`}>
                      <div className="w-28 flex-none">
                        <TemplateThumb audience={t.audience} kind={templateKind(t.visualTemplate)} visual={t.visualTemplate} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{t.label}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.chip}`}>{AUDIENCE_LABELS[t.audience]}</span>
                        </div>
                        <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{t.notes || ''}</div>
                      </div>
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 flex-none">
                        <button
                          type="button"
                          disabled={!!creatingFrom}
                          onClick={() => useTemplate(t)}
                          className="inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-lg bg-violet-600 text-white text-[11.5px] font-semibold hover:bg-violet-700 disabled:opacity-60"
                          data-testid={`button-use-template-${t.id}`}
                        >
                          {creatingFrom === t.id ? <Loader2 size={11} className="animate-spin" /> : null} Use &amp; edit
                        </button>
                        <button type="button" onClick={() => setPreviewTpl(t)} className="inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-lg text-[11.5px] font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30" data-testid={`button-preview-template-${t.id}`}>
                          <Eye size={11} /> Preview
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ================= Audience inflows (right rail, under identity) ================= */}
          {/* The design's Log Interview capture lightbox (Otter/AI/manual
              paste, format + duration pills, pain chips, ICP signal) is
              deliberately not built here — those fields live in the
              discovery-flow backend, so leads deep-link there instead. */}
          <div className={`${CARD} p-4 lg:col-start-2 lg:row-start-2`} data-testid="audience-inflows">
            <div className={`${LBL} mb-3`}>Audience inflows</div>
            {AUDIENCES.map((a) => {
              const list = signupsByAudience[a] || [];
              const open = !!openAudiences[a];
              const routing = AUDIENCE_ROUTING[a];
              const c = AUDIENCE_COLORS[a];
              const shown = inflowExpanded[a] ? list : list.slice(0, 4);
              return (
                <div key={a} className="mb-2.5 last:mb-0 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenAudiences((o) => ({ ...o, [a]: !o[a] }))}
                    className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/60 text-left"
                    data-testid={`inflow-toggle-${a}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                    <span className="text-[12px] font-bold text-gray-800 dark:text-gray-200">{AUDIENCE_LABELS[a]}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums ${c.chip}`}>{list.length}</span>
                    <ChevronDown size={13} className={`ml-auto text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div className="px-3 pb-3 pt-1.5">
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
                          {shown.map((s) => {
                            // Rail rows are contact records (waitlist rows only
                            // in the legacy fallback); the customer invite
                            // endpoint is waitlist-id-keyed, so resolve the
                            // matching waitlist signup by email.
                            const wlRow = a === 'customer'
                              ? (s.crm_status !== undefined ? s : waitlistByEmail.get((s.email || '').toLowerCase()))
                              : null;
                            return (
                              <div key={s.uid || s.id} className="flex items-center gap-2 py-1" data-testid={`inflow-lead-${s.id}`}>
                                <span className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center flex-none ${c.chip}`}>
                                  {((s.name || s.email || '?').trim()[0] || '?').toUpperCase()}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11.5px] font-semibold text-gray-800 dark:text-gray-200 truncate">{s.name || s.email}</div>
                                  <div className="text-[10px] text-gray-400 truncate">{leadSource(s)} · {timeAgo(s.created_at)}</div>
                                </div>
                                {a === 'customer' && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={!wlRow || invitingLead === wlRow?.id}
                                      onClick={() => wlRow && onInviteLead(wlRow)}
                                      title={wlRow ? 'Invite to meet' : 'Invite unavailable for this lead'}
                                      className="w-6 h-6 flex-none rounded-md border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-400 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-300 dark:hover:border-violet-700 disabled:opacity-40"
                                      data-testid={`inflow-invite-${s.id}`}
                                    >
                                      {wlRow && invitingLead === wlRow.id ? <Loader2 size={11} className="animate-spin" /> : <CalendarPlus size={12} />}
                                    </button>
                                    <Link
                                      to="/spinout-lab/discovery"
                                      title="Log interview"
                                      className="w-6 h-6 flex-none rounded-md border border-gray-200 dark:border-gray-700 flex items-center justify-center text-violet-600 dark:text-violet-400 hover:border-violet-300 dark:hover:border-violet-700"
                                    >
                                      <Plus size={12} />
                                    </Link>
                                  </>
                                )}
                              </div>
                            );
                          })}
                          {list.length > 4 && (
                            <button
                              type="button"
                              onClick={() => setInflowExpanded((m) => ({ ...m, [a]: !m[a] }))}
                              className="mt-1 text-[10.5px] font-semibold text-gray-400 hover:text-violet-600 dark:hover:text-violet-400"
                              data-testid={`inflow-show-more-${a}`}
                            >
                              {inflowExpanded[a] ? 'Show less' : `Show ${list.length - 4} more`}
                            </button>
                          )}
                        </>
                      )}
                      {routing.to && (
                        <Link to={routing.to} className="block mt-1.5 text-[10.5px] font-semibold text-violet-600 dark:text-violet-400 hover:underline" data-testid={`inflow-view-all-${a}`}>
                          View all in {routing.label} →
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- template preview modal (scaled hero render, per design) ---- */}
      {previewTpl && (() => {
        const c = AUDIENCE_COLORS[previewTpl.audience];
        const kind = templateKind(previewTpl.visualTemplate);
        // "Use Template" seeds the page with the template's signature palette,
        // so the hero mock uses it too (audience accent as the fallback).
        const accent = VISUAL_TEMPLATE_PALETTES[previewTpl.visualTemplate]?.theme_color || c.bar;
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPreviewTpl(null)}>
            <div className={`${CARD} w-full max-w-lg overflow-hidden`} onClick={(e) => e.stopPropagation()} data-testid="template-preview-modal">
              <div className="flex items-start gap-2 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                <div className="min-w-0">
                  <div className="text-[15px] font-extrabold text-gray-900 dark:text-gray-100 truncate">{previewTpl.label}</div>
                  <div className="text-[11.5px] text-gray-400 line-clamp-2">{previewTpl.notes}</div>
                </div>
                <span className={`ml-auto flex-none px-1.5 py-0.5 rounded text-[10px] font-bold ${c.chip}`}>{AUDIENCE_LABELS[previewTpl.audience]}</span>
                <button type="button" onClick={() => setPreviewTpl(null)} className="flex-none text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                {/* Standalone light artboard on purpose — it mocks the public
                    page, not the app UI. Copy seeds from the identity draft.
                    dark-mode-exempt (whole artboard, through its form mock). */}
                <div className="bg-white p-6">
                  <div className="h-2 w-14 rounded-full mb-4" style={{ background: accent }} />
                  <div className="text-[26px] font-extrabold text-gray-900 leading-tight mb-2">{draft.name || 'Your brand'}</div>
                  {draft.tagline && <div className="text-[14px] text-gray-500 mb-5">{draft.tagline}</div>}
                  {kind.media && (
                    <div className="h-36 rounded-xl mb-5 flex items-center justify-center" style={{ background: `${accent}18` }}>
                      <span className="w-0 h-0 border-y-[12px] border-y-transparent border-l-[19px]" style={{ borderLeftColor: accent }} />
                    </div>
                  )}
                  {kind.split && (
                    <div className="flex gap-3 mb-5">
                      <div className="flex-1 rounded-xl bg-red-50 p-3.5 text-[12px] text-red-900"><b>Before</b><br />Scattered, slow, manual</div>
                      <div className="flex-1 rounded-xl bg-emerald-50 p-3.5 text-[12px] text-emerald-900"><b>After</b><br />Unified &amp; instant</div>
                    </div>
                  )}
                  <div className="flex gap-2 border-t border-gray-100 pt-4">
                    {/* dark-mode-exempt: still inside the light artboard. */}
                    <div className="flex-1 h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 flex items-center text-[12px] text-gray-400">Email address</div>
                    <div className="h-10 px-4 rounded-lg flex-none flex items-center text-[12.5px] font-bold text-white whitespace-nowrap" style={{ background: accent }}>{previewTpl.defaultCtaLabel}</div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setPreviewTpl(null)}
                  className="h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                  data-testid="button-preview-close"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => { const t = previewTpl; setPreviewTpl(null); useTemplate(t); }}
                  className="h-8 px-3.5 rounded-lg bg-violet-600 text-white text-[12px] font-semibold hover:bg-violet-700"
                  data-testid="button-preview-use-template"
                >
                  Use Template →
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
