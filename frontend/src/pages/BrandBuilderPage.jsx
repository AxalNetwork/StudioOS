import React, { useEffect, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import SectorSelect from '../components/SectorSelect';
import { Link } from 'react-router-dom';
import { Sparkles, Loader2, Check, RefreshCw, ExternalLink, Copy, Globe, Upload, Palette, PenLine, Eye, Users, LayoutTemplate, Share2, X, Monitor, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';
import { FONT_PAIRING_OPTIONS } from '../decks/templates/axal_spinout_demoday_app';
import { AUDIENCES, AUDIENCE_LABELS as PAGE_AUDIENCE_LABELS, VISUAL_TEMPLATE_PALETTES } from '../lib/brand/templates.js';
import { defaultsForTemplate, contentForTemplate, contentFieldsFor } from '../lib/brand/templateContent.js';
import TemplateContentEditor from '../components/brand/TemplateContentEditor.jsx';
import TemplateEditorPreview from '../components/brand/TemplateEditorPreview.jsx';
import { suggestAudienceAndGoal, getRecommendedTemplatesForAudience, generateInitialBrandKit } from '../lib/brand/flow.js';

// Task #24 — Brand & landing page generator.
// Task #2 — Reworked into the audience-first flow:
//   1. Pick project & audience  2. Pick a recommended template
//   3. Tune brand kit & copy     4. Share
// Template recommendations + seed copy come from the catalog in
// frontend/src/lib/brand/. Audience/goal/template_kit persist via the
// brand-landing API (Task #1). Published output keeps the existing visual
// templates — we don't recreate designs here.

// Human labels for the persisted primary goal (the 6-value taxonomy).
const GOAL_LABELS = {
  join_waitlist: 'Join the waitlist',
  request_intro: 'Request an intro',
  start_pilot: 'Start a pilot',
  book_call: 'Book a call',
  apply: 'Apply to join',
  offer_guidance: 'Offer guidance',
};

// Task #3 — schema defaults for a template's editable content block. Used to
// seed the dynamic step-3 form and to layer under AI auto-fill so every field
// lands populated with on-brand starting copy. Delegates to the shared content
// model so this page, the inline editor on /spinout-lab/brand, and the preview
// components all read one definition of a template's sections.
const defaultsForKey = (key) => defaultsForTemplate(key);

export default function BrandBuilderPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [project, setProject] = useState(null);
  const [description, setDescription] = useState('');
  const [sector, setSector] = useState('');
  const [autofillBusy, setAutofillBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [error, setError] = useState('');
  const [landing, setLanding] = useState(null); // server row
  const [draft, setDraft] = useState({
    name: '', tagline: '', headline: '', subheadline: '',
    cta_text: 'Join the waitlist', logo_url: null, logo_svg: null, logo_asset_id: null, theme_color: '#7c3aed',
    palette_bg: '#faf7ff', palette_ink: '#1b1430', palette_secondary: '#c4b5fd', palette_accent: '#f59e0b',
    font_pairing: 'editorial',
    audience_customer_headline: '', audience_customer_body: '', audience_customer_cta: '',
    audience_partner_headline: '', audience_partner_body: '', audience_partner_cta: '',
    audience_investor_headline: '', audience_investor_body: '', audience_investor_cta: '',
    audience_advisor_headline: '', audience_advisor_body: '', audience_advisor_cta: '',
    audience_mentor_headline: '', audience_mentor_body: '', audience_mentor_cta: '',
    audience_cofounder_headline: '', audience_cofounder_body: '', audience_cofounder_cta: '',
    template: 'minimal', hero_media_url: '', product_screenshot_url: '',
    // Task #2 — audience-first selections (persisted via Task #1 API)
    audience: '', goal: '', template_kit: '',
    // Task #3 — per-template editable content { [templateKey]: { field: string | item[] } }
    content_json: {},
  });
  const [signups, setSignups] = useState([]);
  const [waitlistAudienceFilter, setWaitlistAudienceFilter] = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);
  // Task #3 — Brand Kit Expansion UI state
  const [showPaletteSuggest, setShowPaletteSuggest] = useState(false);
  const [paletteBusy, setPaletteBusy] = useState(false);
  const [paletteWarnings, setPaletteWarnings] = useState([]);
  const [showTaglineIterator, setShowTaglineIterator] = useState(false);
  const [taglineBusy, setTaglineBusy] = useState(false);
  const [taglineCandidates, setTaglineCandidates] = useState([]);
  const [taglineInputs, setTaglineInputs] = useState({ audience: '', tone: 'bold', marketAngle: 'innovation' });
  const [uploadBusy, setUploadBusy] = useState(false);
  // Audience labels/colors for the waitlist-signup badges.
  const AUDIENCE_LABELS = { customer: 'Customer discovery', partner: 'Partner', investor: 'Investor', advisor: 'Advisor', mentor: 'Mentor', cofounder: 'Co-founder' };
  const AUDIENCE_COLORS = { customer: 'bg-violet-100 text-violet-700', partner: 'bg-indigo-100 text-indigo-700', investor: 'bg-emerald-100 text-emerald-700', advisor: 'bg-amber-100 text-amber-700', mentor: 'bg-sky-100 text-sky-700', cofounder: 'bg-rose-100 text-rose-700' };
  // Task #5 — visual template registry (maps a catalog template's visualTemplate → label / media needs)
  const [templates, setTemplates] = useState([]);
  // Task #20 — visual-style key currently shown in the full-screen preview modal (null = closed)
  const [previewTemplate, setPreviewTemplate] = useState(null);
  // Device toggle for the step-3 live preview (same template on both).
  const [builderDevice, setBuilderDevice] = useState('desktop');

  useEffect(() => {
    api.listProjects().then((r) => {
      const list = Array.isArray(r) ? r : (r?.projects || []);
      setProjects(list);
      if (list.length && !projectId) setProjectId(list[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const p = projects.find((x) => x.id === projectId);
    setProject(p || null);
    if (p) {
      setDescription((d) => d || p.description || p.problem_statement || '');
      setSector((s) => s || p.sector || '');
    }
    (async () => {
      try {
        const lp = await api.brandGetLanding(projectId);
        if (lp) {
          setLanding(lp);
          // Task #3 — seed the active template's content block on load so the
          // dynamic step-3 fields are populated even when switching between two
          // projects that share the same template (where the [draft.template]
          // effect would not re-fire).
          const tk = lp.template || 'minimal';
          const loadedContent = lp.content_json || {};
          const needsSeed = !(loadedContent[tk] && Object.keys(loadedContent[tk]).length)
            && contentFieldsFor(tk).length > 0;
          const seededContent = needsSeed
            ? { ...loadedContent, [tk]: defaultsForKey(tk) }
            : loadedContent;
          setDraft({
            name: lp.name || '',
            tagline: lp.tagline || '',
            headline: lp.headline || '',
            subheadline: lp.subheadline || '',
            cta_text: lp.cta_text || 'Join the waitlist',
            logo_url: lp.logo_url || null,
            logo_svg: lp.logo_svg || null,
            logo_asset_id: lp.logo_asset_id || null,
            theme_color: lp.theme_color || '#7c3aed',
            palette_bg: lp.palette_bg || '#faf7ff',
            palette_ink: lp.palette_ink || '#1b1430',
            palette_secondary: lp.palette_secondary || '#c4b5fd',
            palette_accent: lp.palette_accent || '#f59e0b',
            font_pairing: lp.font_pairing || 'editorial',
            audience_customer_headline: lp.audience_customer_headline || '',
            audience_customer_body: lp.audience_customer_body || '',
            audience_customer_cta: lp.audience_customer_cta || '',
            audience_partner_headline: lp.audience_partner_headline || '',
            audience_partner_body: lp.audience_partner_body || '',
            audience_partner_cta: lp.audience_partner_cta || '',
            audience_investor_headline: lp.audience_investor_headline || '',
            audience_investor_body: lp.audience_investor_body || '',
            audience_investor_cta: lp.audience_investor_cta || '',
            audience_advisor_headline: lp.audience_advisor_headline || '',
            audience_advisor_body: lp.audience_advisor_body || '',
            audience_advisor_cta: lp.audience_advisor_cta || '',
            audience_mentor_headline: lp.audience_mentor_headline || '',
            audience_mentor_body: lp.audience_mentor_body || '',
            audience_mentor_cta: lp.audience_mentor_cta || '',
            audience_cofounder_headline: lp.audience_cofounder_headline || '',
            audience_cofounder_body: lp.audience_cofounder_body || '',
            audience_cofounder_cta: lp.audience_cofounder_cta || '',
            template: lp.template || 'minimal',
            hero_media_url: lp.hero_media_url || '',
            product_screenshot_url: lp.product_screenshot_url || '',
            // Task #2 — restore audience-first selections
            audience: lp.audience || '',
            goal: lp.goal || '',
            template_kit: lp.template_kit || '',
            // Task #3 — restore per-template editable content (seeded above)
            content_json: seededContent,
          });
        } else {
          setLanding(null);
        }
      } catch {}
      try {
        const w = await api.brandListWaitlist(projectId, { audience: waitlistAudienceFilter || undefined });
        setSignups(w?.signups || []);
      } catch {}
      try {
        const pu = await api.brandGetPreviewUrl(projectId);
        setPreviewUrl(pu?.url || null);
      } catch { setPreviewUrl(null); }
    })();
    // Task #5 — load visual template registry (for media-field needs + style labels)
    (async () => {
      try {
        const r = await api.brandListTemplates();
        setTemplates(r?.templates || []);
      } catch {}
    })();
  }, [projectId, projects, waitlistAudienceFilter]);

  // Task #20 — close the template-preview modal on Escape.
  useEffect(() => {
    if (!previewTemplate) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setPreviewTemplate(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewTemplate]);

  // Task #3 — seed the selected template's content block with its schema
  // defaults so the dynamic step-3 fields render real starting copy that
  // matches what the page shows (and round-trips through save). Existing saved
  // content is never overwritten.
  useEffect(() => {
    const tk = draft.template;
    if (!tk) return;
    if (!contentFieldsFor(tk).length) return;
    setDraft((d) => {
      const existing = (d.content_json || {})[tk];
      if (existing && Object.keys(existing).length) return d;
      return { ...d, content_json: { ...(d.content_json || {}), [tk]: defaultsForKey(tk) } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.template]);

  // Step 1 — pick an audience; prefill the goal default for that audience.
  const selectAudience = (audience) => {
    const { goal } = suggestAudienceAndGoal(project || {}, audience);
    setDraft((d) => ({ ...d, audience, goal }));
  };

  // Step 2 — choose a recommended template. Maps the catalog entry to the
  // existing visual style and seeds editable copy/CTA. Re-clicking the active
  // template is a no-op so saved edits aren't clobbered.
  const chooseTemplate = (t) => {
    setDraft((d) => {
      if (t.id === d.template_kit) return d;
      const kit = generateInitialBrandKit(
        { ...(project || {}), name: project?.name, description: description || project?.description, oneLiner: description || project?.description },
        t,
        t.primaryGoal,
      );
      // Task #24 — recreated designs ship a signature palette. Seed it when one
      // of those templates is picked so the design renders on-brand out of the
      // box; when leaving a signature template for a generic one, restore the
      // default palette so a dark/warm theme doesn't linger. Generic→generic
      // switches leave the palette untouched (existing behaviour).
      const sig = VISUAL_TEMPLATE_PALETTES[t.visualTemplate];
      const leavingSig = !!VISUAL_TEMPLATE_PALETTES[d.template] && !sig;
      const palettePatch = sig
        ? { theme_color: sig.theme_color, palette_bg: sig.palette_bg, palette_ink: sig.palette_ink, palette_secondary: sig.palette_secondary, palette_accent: sig.palette_accent }
        : leavingSig
          ? { theme_color: '#7c3aed', palette_bg: '#faf7ff', palette_ink: '#1b1430', palette_secondary: '#c4b5fd', palette_accent: '#f59e0b' }
          : {};
      return {
        ...d,
        ...palettePatch,
        template_kit: t.id,
        template: t.visualTemplate || d.template,
        goal: t.primaryGoal || d.goal,
        cta_text: kit.ctaLabel || d.cta_text,
        name: d.name || kit.brandName,
        headline: kit.headline,
        subheadline: kit.subheadline,
      };
    });
  };

  // Task #3 — per-template content editing helpers. Edits write into
  // draft.content_json[draft.template] so save round-trips the right block.
  const contentFor = (d) => (d.content_json && d.content_json[d.template]) || {};

  const setContentField = (fieldKey, value) => setDraft((d) => {
    const tk = d.template;
    const tc = { ...((d.content_json || {})[tk] || {}), [fieldKey]: value };
    return { ...d, content_json: { ...(d.content_json || {}), [tk]: tc } };
  });

  // Task #3 — one-click AI auto-fill. Reads the project name + sector +
  // description (the step-1 inputs) and fills the page's hero copy + the chosen
  // template's content fields. Does NOT mutate the project, sector, or
  // description inputs themselves.
  const autofill = async () => {
    if (!projectId) return;
    if (description.trim().length < 4) { setError('Add a short description in step 1 first.'); return; }
    setAutofillBusy(true); setError('');
    try {
      const key = draft.template;
      const r = await api.brandAutofillLanding({
        name: (project?.name || draft.name || '').trim(),
        sector: sector || null,
        description: description.trim(),
        template: key,
      });
      const merged = { ...defaultsForKey(key), ...((r && r.content) || {}) };
      setDraft((d) => ({
        ...d,
        name: r?.name || d.name,
        headline: r?.headline || d.headline,
        subheadline: r?.subheadline || d.subheadline,
        tagline: r?.tagline || d.tagline,
        cta_text: r?.cta_text || d.cta_text,
        content_json: { ...(d.content_json || {}), [key]: merged },
      }));
    } catch (e) { setError(e?.message || 'Auto-fill failed'); }
    finally { setAutofillBusy(false); }
  };

  const regenerateLogo = async () => {
    if (!draft.name) return;
    setLogoBusy(true);
    try {
      const prompt = `minimalist geometric logo, ${draft.name.toLowerCase()} mark, ${draft.theme_color} and white, vector, flat`;
      const r = await api.brandLogo({ prompt, name: draft.name, color: draft.theme_color });
      setDraft((d) => ({ ...d, logo_url: r?.url || null, logo_svg: r?.svg || null }));
    } finally { setLogoBusy(false); }
  };

  const saveDraft = async () => {
    if (!projectId) return;
    if (!draft.name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError('');
    try {
      const lp = await api.brandSaveLanding(projectId, draft);
      setLanding(lp);
      // Spin-Out Lab — Week 2 brand basics: name + tagline + primary colour.
      if (draft.name.trim() && (draft.tagline || '').trim() && draft.theme_color) {
        await markMilestone(user, 'brand_basics_filled');
      }
    } catch (e) { setError(e?.message || 'Save failed'); }
    finally { setBusy(false); }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    const mime = file.type;
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(mime)) {
      setError('Only PNG, JPG, or SVG logos allowed.'); return;
    }
    if (file.size > 512 * 1024) { setError('Logo must be ≤ 512 KB.'); return; }
    setUploadBusy(true); setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const r = await api.brandUploadLogo(formData);
      const assetId = r?.asset_id || null;
      const url = r?.url || null;
      setDraft((d) => ({
        ...d,
        logo_asset_id: assetId,
        logo_url: url,
        logo_svg: null,
      }));
    } catch (e) { setError(e?.message || 'Upload failed'); }
    finally { setUploadBusy(false); }
  };

  const suggestPalette = async () => {
    if (!projectId) return;
    setPaletteBusy(true); setError(''); setPaletteWarnings([]);
    try {
      const r = await api.brandSuggestPalette({
        description: description.trim(),
        sector: sector || null,
        seed_color: draft.theme_color,
      });
      const p = r?.palette;
      if (p) {
        setDraft((d) => ({
          ...d,
          theme_color: p.primary || d.theme_color,
          palette_bg: p.background || d.palette_bg,
          palette_ink: p.ink || d.palette_ink,
          palette_secondary: p.secondary || d.palette_secondary,
          palette_accent: p.accent || d.palette_accent,
        }));
      }
      setPaletteWarnings(r?.warnings || []);
    } catch (e) { setError(e?.message || 'Palette failed'); }
    finally { setPaletteBusy(false); }
  };

  const suggestTaglines = async () => {
    if (!draft.name.trim()) { setError('Set a name first.'); return; }
    setTaglineBusy(true); setError('');
    try {
      const r = await api.brandSuggestTaglines({
        name: draft.name.trim(),
        description: description.trim(),
        audience: taglineInputs.audience,
        tone: taglineInputs.tone,
        market_angle: taglineInputs.marketAngle,
      });
      setTaglineCandidates(r?.taglines || []);
    } catch (e) { setError(e?.message || 'Taglines failed'); }
    finally { setTaglineBusy(false); }
  };

  const togglePublish = async () => {
    if (!projectId || !landing) return;
    setBusy(true);
    try {
      const r = await api.brandPublishLanding(projectId, !landing.published);
      setLanding({ ...landing, published: r.published });
    } finally { setBusy(false); }
  };

  const landingUrl = landing ? `${window.location.origin}/landing/${landing.slug}` : '';

  // Step 2 — templates recommended for the chosen audience (recommended-first).
  const recommendedTemplates = draft.audience ? getRecommendedTemplatesForAudience(draft.audience) : [];
  const visualMeta = templates.find((t) => t.key === draft.template);
  const visualLabel = (key) => templates.find((t) => t.key === key)?.label || key;

  // Brand + content payload for the REAL template preview. For a template the
  // founder hasn't selected yet (the step-2 peek), its signature palette stands
  // in for the draft's — that's what selecting it would seed anyway.
  const previewDataForTemplate = (key) => {
    const sig = key !== draft.template ? VISUAL_TEMPLATE_PALETTES[key] : null;
    const aud = draft.audience || 'customer';
    return {
      name: draft.name || undefined,
      brandName: draft.name || project?.name || undefined,
      headline: draft.headline || undefined,
      subheadline: draft.subheadline || undefined,
      body: draft[`audience_${aud}_body`] || undefined,
      tagline: draft.tagline || undefined,
      ctaText: draft.cta_text || undefined,
      themeColor: sig?.theme_color || draft.theme_color,
      paletteBg: sig?.palette_bg || draft.palette_bg,
      paletteInk: sig?.palette_ink || draft.palette_ink,
      paletteSecondary: sig?.palette_secondary || draft.palette_secondary,
      paletteAccent: sig?.palette_accent || draft.palette_accent,
      fontPairing: draft.font_pairing,
      logoUrl: draft.logo_url || undefined,
      logoSvg: draft.logo_svg || undefined,
      heroMediaUrl: draft.hero_media_url || undefined,
      productScreenshotUrl: draft.product_screenshot_url || undefined,
      content: contentForTemplate(draft.content_json, key),
      audience: draft.audience || undefined,
      goal: draft.goal || undefined,
    };
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
          <Sparkles className="text-violet-600" size={22} /> Brand & Landing Page
        </h1>
        <PageExplainer pageKey="brand_builder" />
        <p className="text-sm text-gray-600 mt-1 dark:text-gray-400">
          Start with who the page is for, pick a matching template, then tune and share.
        </p>
      </div>

      {/* Step 1 — pick project & audience */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-5 dark:bg-gray-900 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-gray-100">
          <Users size={15} className="text-violet-600" /> 1. Startup & audience
        </h2>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Startup</span>
            <select
              value={projectId || ''}
              onChange={(e) => setProjectId(parseInt(e.target.value) || null)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 dark:border-gray-800 dark:text-gray-100"
            >
              <option value="">Pick a startup…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <SectorSelect
            label="Sector"
            value={sector}
            onChange={setSector}
          />
        </div>
        <label className="block mb-4">
          <span className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">One-paragraph description</span>
          <textarea
            value={description} onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
            placeholder="What are you building, for whom, and why now?"
          />
        </label>

        <div className="mb-3">
          <span className="block text-xs font-medium text-gray-700 mb-2 dark:text-gray-300">Who is this page for?</span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {AUDIENCES.map((a) => {
              const active = draft.audience === a;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => selectAudience(a)}
                  className={`text-left border rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? 'border-violet-400 ring-2 ring-violet-100 bg-violet-50/40 text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-900'
                      : 'border-gray-200 text-gray-700 hover:border-violet-300 dark:border-gray-800 dark:text-gray-300'
                  }`}
                >
                  <span className="flex items-center justify-between">
                    {PAGE_AUDIENCE_LABELS[a]}
                    {active && <Check size={14} className="text-violet-600" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

      </section>

      {/* Step 2 — pick a recommended template */}
      {projectId && draft.audience && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 mb-5 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2 dark:text-gray-100">
            <LayoutTemplate size={15} className="text-violet-600" /> 2. Pick a template
          </h2>
          <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">
            Recommended for {PAGE_AUDIENCE_LABELS[draft.audience]} — choose one to seed your copy & CTA.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recommendedTemplates.map((t) => {
              const active = draft.template_kit === t.id;
              return (
                <div key={t.id} className="relative group">
                  <button
                    type="button"
                    onClick={() => chooseTemplate(t)}
                    className={`w-full text-left border rounded-lg p-4 transition ${
                      active
                        ? 'border-violet-400 ring-2 ring-violet-100 bg-violet-50/30 dark:border-violet-700 dark:bg-violet-950/30 dark:ring-violet-900'
                        : 'border-gray-200 hover:border-violet-300 dark:border-gray-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 pr-8">
                      <div className="font-semibold text-gray-900 text-sm dark:text-gray-100">{t.label}</div>
                      {t.recommended && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                          Recommended
                        </span>
                      )}
                    </div>
                    {t.notes && <div className="text-xs text-gray-500 mt-1 dark:text-gray-400">{t.notes}</div>}
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
                      <span>Goal: <span className="text-gray-700 dark:text-gray-300">{GOAL_LABELS[t.primaryGoal] || t.primaryGoal}</span></span>
                      <span>CTA: <span className="text-gray-700 dark:text-gray-300">{t.defaultCtaLabel}</span></span>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">Style: {visualLabel(t.visualTemplate)}</div>
                    {active && (
                      <div className="mt-2 text-xs font-medium text-violet-600 flex items-center gap-1">
                        <Check size={12} /> Selected
                      </div>
                    )}
                  </button>
                  {/* Task #20 — preview the visual style without selecting the template. */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setPreviewTemplate(t.visualTemplate); }}
                    title={`Preview ${visualLabel(t.visualTemplate)} style`}
                    aria-label={`Preview ${t.label} template`}
                    className="absolute top-2 right-2 p-1.5 rounded-md border border-gray-200 bg-white/90 text-gray-500 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-violet-600 hover:border-violet-300 transition dark:bg-gray-900/90 dark:border-gray-700 dark:text-gray-400"
                  >
                    <Eye size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          {(visualMeta?.usesHero || draft.hero_media_url) && (
            <label className="mt-3 block">
              <span className="text-[11px] text-gray-600 dark:text-gray-400">Hero media URL</span>
              <input
                value={draft.hero_media_url || ''}
                onChange={(e) => setDraft({ ...draft, hero_media_url: e.target.value })}
                placeholder="https://..."
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              />
            </label>
          )}
          {(visualMeta?.usesProduct || draft.product_screenshot_url) && (
            <label className="mt-2 block">
              <span className="text-[11px] text-gray-600 dark:text-gray-400">Product screenshot URL</span>
              <input
                value={draft.product_screenshot_url || ''}
                onChange={(e) => setDraft({ ...draft, product_screenshot_url: e.target.value })}
                placeholder="https://..."
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              />
            </label>
          )}
        </section>
      )}

      {/* Task #20 — full-screen template preview modal */}
      {previewTemplate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Template preview"
          onClick={() => setPreviewTemplate(null)}
        >
          <div
            className="relative flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Eye size={14} /> Preview — {visualLabel(previewTemplate)} style
              </span>
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                aria-label="Close preview"
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <X size={18} />
              </button>
            </div>
            {/* The REAL template component — the same renderer the library
                cards, the inline editor and the published page use — fed the
                current draft so this previews YOUR page, not a stock sample. */}
            <div className="w-full flex-1 overflow-auto bg-gray-100 p-4 dark:bg-gray-950">
              <TemplateEditorPreview
                templateKey={previewTemplate}
                data={previewDataForTemplate(previewTemplate)}
                device="desktop"
                maxHeight={9999}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — tune brand kit & copy */}
      {(draft.template_kit || landing) && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 mb-5 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-gray-100">
            <PenLine size={15} className="text-violet-600" /> 3. Brand & page content
          </h2>

          {/* Task #3 — one-click AI auto-fill: writes hero copy + the selected
              template's content fields from the project name, sector & step-1
              description. Leaves those three inputs untouched. */}
          <div className="border border-gray-200 rounded-lg p-3 mb-4 dark:border-gray-800">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400">Auto-fill page copy from your startup name, sector & description.</span>
              <button
                onClick={autofill}
                disabled={autofillBusy || !projectId}
                className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {autofillBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Auto-fill with AI
              </button>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <div className="aspect-square bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center overflow-hidden dark:border-gray-800 dark:bg-gray-800">
                {logoBusy ? (
                  <Loader2 className="animate-spin text-violet-500" />
                ) : draft.logo_url ? (
                  <img src={draft.logo_url} alt="logo" className="w-full h-full object-cover" />
                ) : draft.logo_svg ? (
                  // T2 — Render the user-supplied SVG as an <img> data: URL
                  // instead of dangerouslySetInnerHTML. The server already
                  // sanitises (cloudflare-worker/src/routes/brand.ts:75
                  // sanitizeSvg); rendering via <img> is defense-in-depth —
                  // <img> blocks script execution inside the SVG document.
                  //
                  // We use `data:...;utf8,` + encodeURIComponent rather than
                  // base64 to avoid the deprecated `unescape()` call. utf8
                  // data URLs are well-supported across modern browsers and
                  // sidestep the surrogate-pair edge cases of btoa().
                  <img
                    src={`data:image/svg+xml;utf8,${encodeURIComponent(draft.logo_svg)}`}
                    alt="logo preview"
                    className="w-full h-full object-contain"
                  />
                ) : null}
              </div>
              <button
                onClick={regenerateLogo} disabled={logoBusy}
                className="mt-2 w-full inline-flex items-center justify-center gap-1 text-xs text-violet-700 hover:text-violet-800 disabled:opacity-50"
              >
                <RefreshCw size={12} /> Regenerate logo
              </button>
              {/* Upload logo toggle */}
              <label className="mt-2 block">
                <input
                  type="file" accept="image/png,image/jpeg,image/svg+xml"
                  onChange={(e) => { uploadLogo(e.target.files?.[0]); e.target.value = ''; }}
                  className="hidden"
                />
                <span className="w-full inline-flex items-center justify-center gap-1 text-xs text-violet-700 hover:text-violet-800 cursor-pointer border border-gray-200 rounded-lg px-3 py-1.5 dark:border-gray-800">
                  {uploadBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  Upload logo
                </span>
              </label>
              <div className="mt-3 grid grid-cols-5 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">Primary</span>
                  <input
                    type="color" value={draft.theme_color}
                    onChange={(e) => setDraft({ ...draft, theme_color: e.target.value })}
                    className="h-8 w-full border border-gray-200 rounded cursor-pointer dark:border-gray-800"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">Background</span>
                  <input
                    type="color" value={draft.palette_bg}
                    onChange={(e) => setDraft({ ...draft, palette_bg: e.target.value })}
                    className="h-8 w-full border border-gray-200 rounded cursor-pointer dark:border-gray-800"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">Text</span>
                  <input
                    type="color" value={draft.palette_ink}
                    onChange={(e) => setDraft({ ...draft, palette_ink: e.target.value })}
                    className="h-8 w-full border border-gray-200 rounded cursor-pointer dark:border-gray-800"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">Secondary</span>
                  <input
                    type="color" value={draft.palette_secondary}
                    onChange={(e) => setDraft({ ...draft, palette_secondary: e.target.value })}
                    className="h-8 w-full border border-gray-200 rounded cursor-pointer dark:border-gray-800"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">Accent</span>
                  <input
                    type="color" value={draft.palette_accent}
                    onChange={(e) => setDraft({ ...draft, palette_accent: e.target.value })}
                    className="h-8 w-full border border-gray-200 rounded cursor-pointer dark:border-gray-800"
                  />
                </label>
              </div>
              <button
                onClick={() => { setShowPaletteSuggest((v) => !v); if (!showPaletteSuggest) suggestPalette(); }}
                disabled={paletteBusy}
                className="mt-1 w-full inline-flex items-center justify-center gap-1 text-xs text-violet-700 hover:text-violet-800 disabled:opacity-50"
              >
                {paletteBusy ? <Loader2 size={12} className="animate-spin" /> : <Palette size={12} />}
                {showPaletteSuggest ? 'Palette suggested' : 'Suggest AI palette'}
              </button>
              {paletteWarnings.length > 0 && (
                <div className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800">
                  {paletteWarnings.join(' ')}
                </div>
              )}
              <label className="mt-2 flex flex-col gap-1">
                <span className="text-[11px] text-gray-600 dark:text-gray-400">Typography</span>
                <select
                  value={draft.font_pairing}
                  onChange={(e) => setDraft({ ...draft, font_pairing: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-900 dark:border-gray-800 dark:text-gray-100"
                >
                  {FONT_PAIRING_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                Your Spin-Out deck auto-themes from this brand kit.
              </p>
            </div>
            <div className="sm:col-span-2 space-y-3">
              <input
                value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Brand name"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              />
              <input
                value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
                placeholder="Headline"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              />
              <textarea
                value={draft.subheadline} onChange={(e) => setDraft({ ...draft, subheadline: e.target.value })}
                rows={2} placeholder="Subheadline"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              />
              {/* Tagline iterator */}
              <div className="border border-gray-200 rounded-lg p-3 dark:border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400">Tagline iterator</span>
                  <button
                    onClick={() => { setShowTaglineIterator((v) => !v); if (!showTaglineIterator) suggestTaglines(); }}
                    disabled={taglineBusy}
                    className="inline-flex items-center gap-1 text-xs text-violet-700 hover:text-violet-800 disabled:opacity-50"
                  >
                    {taglineBusy ? <Loader2 size={12} className="animate-spin" /> : <PenLine size={12} />}
                    {showTaglineIterator ? 'Hide' : 'Iterate'}
                  </button>
                </div>
                {showTaglineIterator && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        value={taglineInputs.audience}
                        onChange={(e) => setTaglineInputs({ ...taglineInputs, audience: e.target.value })}
                        placeholder="Audience (e.g. founders)"
                        className="border border-gray-200 rounded px-2 py-1 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                      />
                      <select
                        value={taglineInputs.tone}
                        onChange={(e) => setTaglineInputs({ ...taglineInputs, tone: e.target.value })}
                        className="border border-gray-200 rounded px-2 py-1 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                      >
                        <option value="bold">Bold</option>
                        <option value="warm">Warm</option>
                        <option value="technical">Technical</option>
                        <option value="playful">Playful</option>
                        <option value="authoritative">Authoritative</option>
                      </select>
                      <input
                        value={taglineInputs.marketAngle}
                        onChange={(e) => setTaglineInputs({ ...taglineInputs, marketAngle: e.target.value })}
                        placeholder="Angle (e.g. AI)"
                        className="border border-gray-200 rounded px-2 py-1 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                      />
                    </div>
                    <div className="grid gap-2">
                      {taglineCandidates.map((t, i) => (
                        <button
                          key={i} type="button"
                          onClick={() => setDraft({ ...draft, tagline: t, headline: t })}
                          className={`text-left text-sm px-3 py-2 rounded border transition ${
                            draft.tagline === t ? 'border-violet-400 bg-violet-50/30 dark:border-violet-700 dark:bg-violet-950/30' : 'border-gray-200 hover:border-violet-300 dark:border-gray-800'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={suggestTaglines}
                      disabled={taglineBusy}
                      className="text-xs text-violet-700 hover:text-violet-800 disabled:opacity-50"
                    >
                      {taglineBusy ? <Loader2 size={12} className="animate-spin inline" /> : 'Regenerate'}
                    </button>
                  </div>
                )}
              </div>
              <input
                value={draft.cta_text} onChange={(e) => setDraft({ ...draft, cta_text: e.target.value })}
                placeholder="CTA button text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              />

              {/* Task #3 — template-aware page content. Fields adapt to the
                  visual template chosen in step 2; edits persist per template
                  in draft.content_json[draft.template]. The field list itself
                  comes from the shared TemplateContentEditor, which reads
                  TEMPLATE_CONTENT_SCHEMA — the same source the inline editor on
                  /spinout-lab/brand and the renderers use. */}
              {contentFieldsFor(draft.template).length > 0 && (
                <div className="border border-gray-200 rounded-lg p-3 space-y-3 dark:border-gray-800">
                  <span className="block text-[11px] font-medium text-gray-600 dark:text-gray-400">
                    Page content — these fields fill the sections of your chosen template.
                  </span>
                  <TemplateContentEditor
                    templateKey={draft.template}
                    content={contentFor(draft)}
                    onChange={setContentField}
                    testIdPrefix="builder-content"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={saveDraft} disabled={busy}
                  className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Save
                </button>
              </div>
            </div>
          </div>

          {/* Live preview — the SAME renderer as the library card, the inline
              editor and the published page, driven by the unsaved draft. */}
          <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-800">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                Live preview — {visualLabel(draft.template)}
              </span>
              <div className="ml-auto flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
                {['desktop', 'mobile'].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setBuilderDevice(d)}
                    className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11.5px] font-semibold ${builderDevice === d ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
                    data-testid={`builder-device-${d}`}
                  >
                    {d === 'desktop' ? <Monitor size={12} /> : <Smartphone size={12} />}
                    {d === 'desktop' ? 'Desktop' : 'Mobile'}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl bg-gray-100 p-4 dark:bg-gray-950">
              <TemplateEditorPreview
                templateKey={draft.template}
                data={previewDataForTemplate(draft.template)}
                device={builderDevice}
                maxHeight={640}
              />
            </div>
          </div>
        </section>
      )}

      {/* Step 4 — share */}
      {landing && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 mb-5 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-gray-100">
            <Share2 size={15} className="text-violet-600" /> 4. Share your page
          </h2>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button
              onClick={togglePublish} disabled={busy}
              className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border ${
                landing.published
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-violet-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'
              }`}
            >
              <Globe size={14} /> {landing.published ? 'Published' : 'Publish'}
            </button>
          </div>
          {landing.published && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <code className="bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5 text-sm break-all dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">{landingUrl}</code>
              <button
                onClick={() => navigator.clipboard.writeText(landingUrl)}
                className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-violet-700 dark:text-gray-300"
              >
                <Copy size={14} /> Copy
              </button>
              <a
                href={landingUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-violet-700 hover:text-violet-800"
              >
                <ExternalLink size={14} /> Open
              </a>
            </div>
          )}
          {previewUrl && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5 text-sm break-all dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">{window.location.origin}{previewUrl}</code>
              <button
                onClick={() => navigator.clipboard.writeText(window.location.origin + previewUrl)}
                className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-violet-700 dark:text-gray-300"
              >
                <Copy size={14} /> Copy
              </button>
              <a
                href={previewUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-violet-700 hover:text-violet-800"
              >
                <Eye size={14} /> Preview
              </a>
              <span className="text-[11px] text-amber-600 dark:text-amber-400">Private — share for feedback only</span>
            </div>
          )}
          <div className="text-xs text-gray-500 mt-2 dark:text-gray-400">
            {landing.views_count || 0} pageviews · {signups.length} signup{signups.length === 1 ? '' : 's'}
          </div>
        </section>
      )}

      {/* Waitlist preview */}
      {signups.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Waitlist signups</h2>
            <select
              value={waitlistAudienceFilter}
              onChange={(e) => setWaitlistAudienceFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">All</option>
              <option value="customer">Customer</option>
              <option value="partner">Partner</option>
              <option value="investor">Investor</option>
            </select>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {signups.slice(0, 25).map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between text-sm">
                <span className="text-gray-900 dark:text-gray-100">{s.email}</span>
                <div className="flex items-center gap-2">
                  {s.audience && (
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${AUDIENCE_COLORS[s.audience] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                      {AUDIENCE_LABELS[s.audience]}
                    </span>
                  )}
                  <span className="text-xs text-gray-500 dark:text-gray-400">{(s.created_at || '').slice(0, 19).replace('T', ' ')}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:bg-red-900/20 dark:border-red-900 dark:text-red-300">{error}</div>
      )}

      <div className="mt-6 text-xs text-gray-500 dark:text-gray-400">
        <Link to="/founder" className="text-violet-700 hover:underline">← Back to Founder Portal</Link>
      </div>
    </div>
  );
}
