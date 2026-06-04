import React, { useEffect, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { Link } from 'react-router-dom';
import { Sparkles, Loader2, Check, RefreshCw, ExternalLink, Copy, Globe } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';
import { FONT_PAIRING_OPTIONS } from '../decks/templates/axal_spinout_demoday_app';

// Task #24 — Brand & landing page generator.
// Single-page wizard: pick project → AI suggestions → choose name/logo →
// edit landing copy → publish → share + view waitlist signups.
export default function BrandBuilderPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [project, setProject] = useState(null);
  const [description, setDescription] = useState('');
  const [sector, setSector] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [aiUsed, setAiUsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [error, setError] = useState('');
  const [landing, setLanding] = useState(null); // server row
  const [draft, setDraft] = useState({
    name: '', tagline: '', headline: '', subheadline: '',
    cta_text: 'Join the waitlist', logo_url: null, logo_svg: null, theme_color: '#7c3aed',
    palette_bg: '#faf7ff', palette_ink: '#1b1430', font_pairing: 'editorial',
  });
  const [signups, setSignups] = useState([]);

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
          setDraft({
            name: lp.name || '',
            tagline: lp.tagline || '',
            headline: lp.headline || '',
            subheadline: lp.subheadline || '',
            cta_text: lp.cta_text || 'Join the waitlist',
            logo_url: lp.logo_url || null,
            logo_svg: lp.logo_svg || null,
            theme_color: lp.theme_color || '#7c3aed',
            palette_bg: lp.palette_bg || '#faf7ff',
            palette_ink: lp.palette_ink || '#1b1430',
            font_pairing: lp.font_pairing || 'editorial',
          });
        } else {
          setLanding(null);
        }
      } catch {}
      try {
        const w = await api.brandListWaitlist(projectId);
        setSignups(w?.signups || []);
      } catch {}
    })();
  }, [projectId, projects]);

  const generate = async () => {
    if (description.trim().length < 4) { setError('Add a short description first.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.brandSuggest({ description: description.trim(), sector: sector || null });
      setSuggestions(r?.suggestions || []);
      setAiUsed(!!r?.ai_generated);
    } catch (e) { setError(e?.message || 'Failed to generate'); }
    finally { setBusy(false); }
  };

  const pickSuggestion = async (s) => {
    setDraft((d) => ({
      ...d,
      name: s.name,
      tagline: s.tagline,
      headline: s.tagline,
      subheadline: d.subheadline || description.slice(0, 140),
    }));
    // Auto-generate a logo for this pick — falls back to local SVG if no key.
    setLogoBusy(true);
    try {
      const r = await api.brandLogo({ prompt: s.logo_prompt, name: s.name, color: draft.theme_color });
      setDraft((d) => ({ ...d, logo_url: r?.url || null, logo_svg: r?.svg || null }));
    } catch {}
    finally { setLogoBusy(false); }
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

  const togglePublish = async () => {
    if (!projectId || !landing) return;
    setBusy(true);
    try {
      const r = await api.brandPublishLanding(projectId, !landing.published);
      setLanding({ ...landing, published: r.published });
    } finally { setBusy(false); }
  };

  const landingUrl = landing ? `${window.location.origin}/landing/${landing.slug}` : '';

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
          <Sparkles className="text-violet-600" size={22} /> Brand & Landing Page
        </h1>
        <PageExplainer pageKey="brand_builder" />
        <p className="text-sm text-gray-600 mt-1">
          Go from idea to a public landing page + waitlist in one sitting.
        </p>
      </div>

      {/* Step 1 — pick project + describe */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-5 dark:bg-gray-900 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">1. Tell us about your venture</h2>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Project</span>
            <select
              value={projectId || ''}
              onChange={(e) => setProjectId(parseInt(e.target.value) || null)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800"
            >
              <option value="">Pick a project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Sector</span>
            <input
              value={sector} onChange={(e) => setSector(e.target.value)}
              placeholder="AI / Climate / Fintech…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800"
            />
          </label>
        </div>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">One-paragraph description</span>
          <textarea
            value={description} onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800"
            placeholder="What are you building, for whom, and why now?"
          />
        </label>
        <button
          onClick={generate}
          disabled={busy || !projectId}
          className="mt-3 inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Generate 5 brand options
        </button>
        {!aiUsed && suggestions.length > 0 && (
          <div className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 mt-2 inline-block dark:text-gray-300 dark:bg-gray-800 dark:border-gray-700">
            Showing starter options — try regenerating for AI-crafted ideas.
          </div>
        )}
      </section>

      {/* Step 2 — suggestions */}
      {suggestions.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 mb-5 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">2. Pick a direction</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {suggestions.map((s, i) => {
              const active = draft.name === s.name;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className={`text-left border rounded-lg p-3 hover:border-violet-300 transition ${
                    active ? 'border-violet-400 ring-2 ring-violet-100 bg-violet-50/30' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{s.name}</div>
                    {active && <Check size={14} className="text-violet-600" />}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">{s.tagline}</div>
                  <div className="text-[11px] text-gray-400 mt-2 italic">Logo: {s.logo_prompt}</div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Step 3 — edit + publish */}
      {draft.name && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 mb-5 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">3. Tune your landing page</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <div className="aspect-square bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center overflow-hidden dark:border-gray-800">
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
              <div className="mt-3 grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">Accent</span>
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
              </div>
              <label className="mt-3 flex flex-col gap-1">
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
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold dark:border-gray-800"
              />
              <input
                value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
                placeholder="Headline"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800"
              />
              <textarea
                value={draft.subheadline} onChange={(e) => setDraft({ ...draft, subheadline: e.target.value })}
                rows={2} placeholder="Subheadline"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800"
              />
              <input
                value={draft.cta_text} onChange={(e) => setDraft({ ...draft, cta_text: e.target.value })}
                placeholder="CTA button text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800"
              />
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={saveDraft} disabled={busy}
                  className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Save
                </button>
                {landing && (
                  <button
                    onClick={togglePublish} disabled={busy}
                    className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border ${
                      landing.published
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-violet-300'
                    }`}
                  >
                    <Globe size={14} /> {landing.published ? 'Published' : 'Publish'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Step 4 — share */}
      {landing && landing.published && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 mb-5 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">4. Share your page</h2>
          <div className="flex flex-wrap items-center gap-2">
            <code className="bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5 text-sm break-all dark:border-gray-800">{landingUrl}</code>
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
          <div className="text-xs text-gray-500 mt-2">
            {landing.views_count || 0} pageviews · {signups.length} signup{signups.length === 1 ? '' : 's'}
          </div>
        </section>
      )}

      {/* Waitlist preview */}
      {signups.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">Waitlist signups</h2>
          <ul className="divide-y divide-gray-100">
            {signups.slice(0, 25).map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between text-sm">
                <span className="text-gray-900 dark:text-gray-100">{s.email}</span>
                <span className="text-xs text-gray-500">{(s.created_at || '').slice(0, 19).replace('T', ' ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
      )}

      <div className="mt-6 text-xs text-gray-500">
        <Link to="/founder" className="text-violet-700 hover:underline">← Back to Founder Portal</Link>
      </div>
    </div>
  );
}
