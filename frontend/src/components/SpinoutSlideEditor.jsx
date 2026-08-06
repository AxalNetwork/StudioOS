import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Check, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

/**
 * Task #2 — template-specific slide editor for the `axal_spinout_demoday` deck.
 *
 * Unlike the generic SlideEditor (which hand-edits the stored slide fields),
 * the Spin-Out deck renders ENTIRELY from the live, project-derived dotted-key
 * map returned by `api.spinoutDeck(projectId)`. Editing the stored underscore
 * slide fields has no visible effect there, so this editor instead:
 *
 *   - shows AUTO fields read-only, pulled from the live `fields` map, each
 *     labelled with the source page it comes from (with a deep link), and
 *   - exposes only the few narrative fields that are genuinely editable as
 *     inputs that WRITE BACK to the underlying project (api.updateProject).
 *     On save it bumps the parent's deck-data reload (onSaved) so the live
 *     preview + PPTX export refresh — the same pattern as UseOfFundsEditor.
 *
 * Other deck templates keep the generic SlideEditor; this component is only
 * mounted when the active deck is `axal_spinout_demoday`.
 */

/* ----------------------------------------------------------------- sources -- */
const sources = (projectId) => ({
  project: { label: 'Startup', href: `/projects/${projectId}` },
  account: { label: 'Account', href: '/settings' },
  discovery: { label: 'Customer Discovery', href: '/customer-discovery' },
  roadmap: { label: 'Roadmap', href: '/build/roadmap' },
  captable: { label: 'Cap Table', href: '/build/captable' },
  incorporation: { label: 'Incorporation', href: '/incorporate' },
  team: { label: 'Team', href: '/about' },
});

/* ----------------------------------------------------------------- helpers -- */
const j = (v) => {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
};

const orDash = (v) => (v != null && String(v).trim() !== '' ? String(v) : '—');

const listJoin = (arr, mapFn, sep = ' · ', max = 6) => {
  if (!Array.isArray(arr)) return '';
  const out = arr.map(mapFn).filter((v) => v != null && String(v).trim() !== '');
  const shown = out.slice(0, max);
  return shown.join(sep) + (out.length > max ? ` +${out.length - max} more` : '');
};

const metaVal = (f, key) => {
  const meta = j(f['cover.meta_json']) || [];
  const pair = meta.find((p) => Array.isArray(p) && String(p[0]).toUpperCase() === key);
  return pair ? pair[1] : '';
};

/* ------------------------------------------------------- deck-only overrides -- */
// The DECK OVERRIDE rows. These are the third kind of row, and the distinction
// matters: an AUTO row is read-only live data, an EDITABLE row writes back into
// the project (a real module edit, visible everywhere), and a DECK row writes
// only to `spinout_deck_overrides` — deck wording that leaves the founder's
// Solution/Problem modules alone.
//
// Keys are dotted paths into SpinoutDeckData and MUST be in the worker's
// SPINOUT_OVERRIDABLE_KEYS allowlist; the PUT rejects anything else with a 400
// naming the key, and `overridableKeys` from the GET is used below to hide a row
// the server would refuse rather than showing a save that silently fails.
const DECK_ROWS = {
  cover: [{ label: 'Thesis line', key: 'cover.thesis', kind: 'paragraph' }],
  problem: [
    { label: 'Slide headline', key: 'problem.title' },
    { label: 'Framing sentence', key: 'problem.framing', kind: 'paragraph' },
    { label: 'Pull quote', key: 'problem.quote', kind: 'paragraph' },
    { label: 'Quote attribution', key: 'problem.quoteAttr' },
  ],
  market: [
    { label: 'Slide headline', key: 'market.title' },
    { label: 'Sizing assumptions', key: 'market.assumptions', kind: 'paragraph' },
  ],
  competitive: [
    { label: 'Slide headline', key: 'competitive.title' },
    { label: 'Whitespace claim', key: 'competitive.whitespace', kind: 'paragraph' },
  ],
  traction: [
    { label: 'Slide headline', key: 'traction.title' },
    { label: 'Takeaway line', key: 'traction.takeaway', kind: 'paragraph' },
  ],
  solution: [{ label: 'Slide headline', key: 'solution.title' }],
  product_demo: [
    { label: 'Slide headline', key: 'productDemo.title' },
    { label: 'Walkthrough copy', key: 'productDemo.body', kind: 'paragraph' },
    { label: 'Caption', key: 'productDemo.caption' },
  ],
  roadmap: [{ label: 'Slide headline', key: 'roadmap.title' }],
  team_network: [{ label: 'Slide headline', key: 'team.title' }],
  ask: [{ label: 'Slide headline', key: 'ask.title' }],
  review_the_deal: [
    { label: 'Slide headline', key: 'deal.title' },
    { label: 'Closing line', key: 'deal.closingLine', kind: 'paragraph' },
  ],
};

/* -------------------------------------------------------- per-slide config -- */
// Each slide (keyed by spec_id) declares its AUTO rows (read-only, sourced from
// the live `fields` map and/or the loaded project) and its EDITABLE rows (mapped
// to a project column). `get(fields, project)` returns the display string for an
// auto row.
const CONFIG = {
  cover: {
    title: 'Cover',
    auto: [
      { label: 'Startup', src: 'project', get: (f, p) => orDash(p?.name || f['cover.company']) },
      { label: 'Founder(s)', src: 'account', get: (f) => orDash(metaVal(f, 'FOUNDER')) },
      { label: 'Description', src: 'project', get: (f, p) => orDash(p?.description) },
      { label: 'Sector', src: 'project', get: (f, p) => orDash(p?.sector || metaVal(f, 'SECTOR')) },
      {
        label: 'Validation signal · 28-day sprint',
        src: 'discovery',
        get: (f) => orDash([f['cover.signalLabel'], f['cover.signalCaption']].filter(Boolean).join(' — ')),
      },
    ],
    edit: [],
  },
  problem: {
    title: 'Problem & validation',
    auto: [
      {
        // The standalone Validation slide is merged into Problem — its
        // scorecard renders here so the evidence stays reviewable.
        label: 'Discovery scorecard',
        src: 'discovery',
        multi: (f) => {
          const cards = j(f['validation.cards_json']) || [];
          return cards
            .map((c) => (Array.isArray(c) ? { label: c[1] || 'Metric', value: orDash(c[0]) } : null))
            .filter(Boolean);
        },
      },
      {
        label: 'Discovery quote',
        src: 'discovery',
        get: (f) => (f['problem.quote']
          ? `“${f['problem.quote']}”${f['problem.quoteAttr'] ? ` — ${f['problem.quoteAttr']}` : ''}`
          : '—'),
      },
      {
        label: 'Pain frequency across interviews',
        src: 'discovery',
        get: (f) => orDash(listJoin(j(f['problem.pains_json']),
          (pn) => (Array.isArray(pn) ? `${pn[0]}${pn[1] != null ? ` ${pn[1]}%` : ''}` : ''))),
      },
    ],
    edit: [
      {
        label: 'Problem Statement',
        src: 'project',
        field: 'problem_statement',
        kind: 'paragraph',
        help: 'The core, evidenced problem your venture solves.',
      },
    ],
  },
  market: {
    title: 'Market',
    auto: [
      {
        label: 'TAM / SAM / SOM',
        src: 'project',
        get: (f) => orDash(listJoin(j(f['market.rings_json']),
          (r) => (Array.isArray(r) ? `${r[0]} ${r[1] || ''}`.trim() : ''))),
      },
      {
        label: 'Why now',
        src: 'project',
        get: (f) => orDash(listJoin(j(f['market.why_json']),
          (w) => (Array.isArray(w) ? w[0] : String(w)))),
      },
    ],
    edit: [],
  },
  solution: {
    title: 'Solution',
    auto: [
      {
        label: 'Capabilities (derived from your solution)',
        src: 'project',
        get: (f) => orDash(listJoin(j(f['solution.steps_json']),
          (s) => (Array.isArray(s) ? (s.find((x) => x && Number.isNaN(Number(x))) || s[0]) : String(s)))),
      },
    ],
    edit: [
      {
        label: 'Solution',
        src: 'project',
        field: 'solution',
        kind: 'paragraph',
        help: 'Axal backs the solution side — frame how your venture turns raw inputs into a live, actionable output (data → decision), not just a restatement of the problem.',
      },
    ],
  },
  product_demo: {
    title: 'Product demo',
    auto: [],
    edit: [
      { label: 'Demo video URL', src: 'project', field: 'product_demo_video_url', kind: 'url' },
      { label: 'Live demo URL', src: 'project', field: 'product_demo_live_url', kind: 'url' },
      { label: 'Screenshot URL', src: 'project', field: 'product_demo_screenshot_url', kind: 'url' },
      { label: 'Caption', src: 'project', field: 'product_demo_caption', kind: 'text' },
    ],
  },
  roadmap: {
    title: 'Roadmap',
    auto: [
      {
        label: 'Now / Next / Later',
        src: 'roadmap',
        get: (f) => {
          const phases = j(f['roadmap.phases_json']) || [];
          const out = phases
            .map((p) => (Array.isArray(p)
              ? `${p[0]}: ${listJoin(p[2], (it) => (Array.isArray(it) ? it[1] : String(it)), ', ', 4)}`
              : ''))
            .filter((s) => s && !s.endsWith(': '));
          return out.length ? out.join('\n') : '—';
        },
      },
    ],
    edit: [],
  },
  team_network: {
    title: 'Team & network',
    auto: [
      {
        label: 'Founders',
        src: 'team',
        get: (f) => {
          const names = listJoin(j(f['team.founders_json']),
            (x) => (x && typeof x === 'object' ? x.name : (Array.isArray(x) ? x[1] : String(x))));
          return orDash(names || f['team.founder.name']);
        },
      },
      {
        label: 'Advisors',
        src: 'team',
        get: (f) => orDash(listJoin(j(f['team.advisors_json']),
          (a) => (Array.isArray(a) ? a[1] : (a && a.name)))),
      },
      {
        label: 'Network',
        src: 'team',
        get: (f) => orDash(listJoin(j(f['team.nodes_json']),
          (n) => (Array.isArray(n) ? n[2] : String(n)))),
      },
    ],
    edit: [],
  },
  competitive: {
    title: 'Competitive landscape',
    auto: [
      {
        label: 'Competitors',
        src: 'project',
        get: (f) => orDash(listJoin(j(f['competitive.competitors_json']),
          (c) => (Array.isArray(c) ? `${c[0]}${c[1] ? ` (${c[1]})` : ''}` : String(c)))),
      },
      {
        label: 'Our edge',
        src: 'project',
        get: (f) => orDash(listJoin(j(f['competitive.edges_json']), (e) => String(e))),
      },
    ],
    edit: [],
  },
  traction: {
    title: 'Traction',
    auto: [
      {
        label: 'Monthly revenue trend',
        src: 'project',
        get: (f) => {
          const labels = j(f['traction.trendLabels_json']) || [];
          const months = j(f['traction.trendX_json']) || [];
          const out = months.map((m, i) => `${m} ${labels[i] ?? ''}`.trim()).filter(Boolean);
          return out.length ? out.join(' · ') : '—';
        },
      },
      {
        label: 'MRR & growth',
        src: 'project',
        get: (f) => orDash([f['traction.mrr'], f['traction.growth']].filter(Boolean).join ('  ·  ')),
      },
      {
        label: 'Revenue mix',
        src: 'project',
        get: (f) => orDash(listJoin(j(f['traction.mix_json']),
          (m) => (Array.isArray(m) ? `${m[0]} ${m[2]}%` : String(m)))),
      },
    ],
    edit: [],
  },
  ask: {
    title: 'The ask & cap table',
    note: 'Edit the use-of-funds allocation in the “THE ASK — Use of Funds” panel on the right. The raise and milestone are pulled from your startup.',
    auto: [
      {
        label: 'Raise & runway',
        src: 'project',
        get: (f) => orDash(listJoin(j(f['ask.kpis_json']),
          (k) => (Array.isArray(k) ? k.filter(Boolean).join(' ') : String(k)))),
      },
      {
        label: 'Use of funds',
        src: 'project',
        get: (f) => orDash(listJoin(j(f['ask.funds_json']),
          (x) => (Array.isArray(x) ? `${x[0]} ${x[1]}%` : ''))),
      },
      {
        label: 'Milestone',
        src: 'project',
        get: (f) => {
          const m = j(f['ask.milestone_json']);
          return Array.isArray(m) ? orDash(m.filter(Boolean).join(' — ')) : '—';
        },
      },
      {
        // The standalone Cap Table slide is merged into Ask — surface its
        // splits + entity checklist here so they stay reviewable.
        label: 'Cap table',
        src: 'captable',
        get: (f) => orDash(listJoin(j(f['captable.segments_json']),
          (s) => (Array.isArray(s) ? `${s[0]} ${s[1]}%` : ''))),
      },
      {
        label: 'Incorporation',
        src: 'incorporation',
        get: (f) => orDash(listJoin(j(f['captable.items_json']),
          (i) => (Array.isArray(i) ? `${i[0]} (${i[1]})` : String(i)))),
      },
    ],
    edit: [],
  },
  review_the_deal: {
    title: 'Deal readiness',
    auto: [
      {
        label: 'Diligence readiness',
        src: 'project',
        get: (f) => orDash(listJoin(j(f['deal.ready_json']),
          (r) => (Array.isArray(r) ? `${r[0]} (${r[1]})` : String(r)))),
      },
      {
        label: 'Next steps',
        src: 'project',
        get: (f) => orDash(listJoin(j(f['deal.steps_json']),
          (s) => (Array.isArray(s) ? s.filter(Boolean).join(' ') : String(s)))),
      },
      { label: 'Contact', src: 'project', get: (f) => orDash(f['deal.contact']) },
    ],
    edit: [],
  },
};

/* ------------------------------------------------------------- sub-renders -- */
function SourceLink({ src }) {
  if (!src) return null;
  return (
    <Link
      to={src.href}
      className="text-[11px] text-violet-600 hover:underline inline-flex items-center gap-0.5 shrink-0"
    >
      <ExternalLink className="w-3 h-3" /> {src.label}
    </Link>
  );
}

function RowLabel({ label, badge, src }) {
  return (
    <div className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1 flex items-center justify-between gap-2">
      <span className="flex items-center">
        {label}
        {badge}
      </span>
      <SourceLink src={src} />
    </div>
  );
}

const AUTO_BADGE = (
  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
    Auto
  </span>
);
const EDIT_BADGE = (
  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
    Editable
  </span>
);
const DECK_BADGE = (
  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
    Deck only
  </span>
);

function AutoRow({ row, value, src }) {
  const empty = !value || value === '—';
  return (
    <div>
      <RowLabel label={row.label} badge={AUTO_BADGE} src={src} />
      <div className="w-full border border-dashed rounded px-3 py-2 bg-gray-50 dark:bg-slate-900/40 dark:border-slate-700 text-sm text-gray-600 dark:text-slate-300 whitespace-pre-wrap">
        {empty
          ? <span className="italic text-gray-400 dark:text-slate-500">Not set yet — add it on {src?.label || 'the source page'}.</span>
          : value}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- component -- */
export default function SpinoutSlideEditor({ slide, fields, projectId, onSaved }) {
  const specId = slide?.spec_id || '';
  const cfg = CONFIG[specId] || null;
  const editRows = cfg?.edit || [];
  const SRC = useMemo(() => sources(projectId), [projectId]);
  const live = fields || {};

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Deck-level manual overrides — stored server-side per (project, field key),
  // never written into the project's own columns. `overridableKeys` is the
  // server's allowlist; a row whose key is absent from it is hidden rather than
  // rendered as a control the PUT would reject.
  const [overrides, setOverrides] = useState({});
  const [overridableKeys, setOverridableKeys] = useState(null);
  const [deckDraft, setDeckDraft] = useState({});
  const [deckSaving, setDeckSaving] = useState(false);
  const [deckSaved, setDeckSaved] = useState(false);
  const [deckError, setDeckError] = useState('');

  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setLoading(true); setError('');
    api.getProject(projectId)
      .then((p) => { if (alive) setProject(p); })
      .catch((e) => {
        if (!alive) return;
        setError(e?.message || 'Failed to load startup');
        reportError('SpinoutSlideEditor:load', e);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    api.spinoutDeckOverrides(projectId)
      .then((r) => {
        if (!alive) return;
        setOverrides(r?.overrides || {});
        setOverridableKeys(Array.isArray(r?.overridable_keys) ? r.overridable_keys : null);
      })
      .catch((e) => {
        // A deck that can't read its overrides still edits its module fields —
        // degrade to "no overrides" rather than blocking the whole editor.
        if (alive) reportError('SpinoutSlideEditor:overrides', e);
      });
    return () => { alive = false; };
  }, [projectId]);

  // (Re)initialise the editable draft whenever the project loads or the active
  // slide changes. Switching slides discards unsaved typing by design.
  useEffect(() => {
    const d = {};
    for (const r of editRows) d[r.field] = project?.[r.field] ?? '';
    setDraft(d);
    setSaved(false);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, specId]);

  const dirty = editRows.some((r) => (draft[r.field] ?? '') !== (project?.[r.field] ?? ''));

  // Deck-override rows for this slide, filtered by the server's allowlist.
  const deckRows = useMemo(() => {
    const rows = DECK_ROWS[specId] || [];
    if (!overridableKeys) return rows;
    const allow = new Set(overridableKeys);
    return rows.filter((r) => allow.has(r.key));
  }, [specId, overridableKeys]);

  // (Re)seed the override draft when the stored overrides or the slide change.
  useEffect(() => {
    const d = {};
    for (const r of deckRows) d[r.key] = overrides[r.key] ?? '';
    setDeckDraft(d);
    setDeckSaved(false);
    setDeckError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, specId, deckRows.length]);

  const deckDirty = deckRows.some((r) => (deckDraft[r.key] ?? '') !== (overrides[r.key] ?? ''));

  const onSaveDeck = async () => {
    if (!projectId || deckSaving || !deckDirty) return;
    setDeckSaving(true); setDeckError('');
    try {
      // Cleared fields go in `remove` — an empty value is a REVERT back to the
      // module data, which is why there is no separate delete call.
      const payload = {};
      const remove = [];
      for (const r of deckRows) {
        const v = (deckDraft[r.key] ?? '').trim();
        if (v === '') { if (overrides[r.key]) remove.push(r.key); }
        else if (v !== (overrides[r.key] ?? '')) payload[r.key] = v;
      }
      const res = await api.saveSpinoutDeckOverrides(projectId, payload, remove);
      setOverrides(res?.overrides || {});
      setDeckSaved(true);
      if (onSaved) onSaved();
    } catch (e) {
      setDeckError(e?.message || 'Save failed');
      reportError('SpinoutSlideEditor:saveOverrides', e);
    } finally {
      setDeckSaving(false);
    }
  };

  const onSave = async () => {
    if (!projectId || saving || !dirty) return;
    setSaving(true); setError('');
    try {
      const payload = {};
      for (const r of editRows) {
        const v = draft[r.field] ?? '';
        if (v !== (project?.[r.field] ?? '')) payload[r.field] = r.kind === 'url' ? v.trim() : v;
      }
      await api.updateProject(projectId, payload);
      const fresh = await api.getProject(projectId);
      setProject(fresh);
      setSaved(true);
      if (onSaved) onSaved();
    } catch (e) {
      setError(e?.message || 'Save failed');
      reportError('SpinoutSlideEditor:save', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-2xl font-semibold py-1">{slide?.title || cfg?.title || 'Slide'}</div>
        <p className="text-[11px] text-gray-400 dark:text-slate-500">
          This deck builds automatically from your venture data. Auto fields refresh from their
          source pages — open a source to change them. Only the narrative fields below are editable here.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading project data…
        </div>
      )}

      {(cfg?.auto || []).flatMap((row, ri) => {
        if (row.multi) {
          const sub = row.multi(live, project) || [];
          if (!sub.length) {
            return [<AutoRow key={`${ri}-empty`} row={{ label: row.label || 'Details' }} src={SRC[row.src]} value="—" />];
          }
          return sub.map((s, si) => (
            <AutoRow key={`${ri}-${si}`} row={{ label: s.label }} src={SRC[row.src]} value={s.value} />
          ));
        }
        return [<AutoRow key={row.label || ri} row={row} src={SRC[row.src]} value={row.get(live, project)} />];
      })}

      {cfg?.note && (
        <p className="text-[11px] text-gray-400 dark:text-slate-500 border-l-2 border-violet-200 dark:border-violet-900 pl-2">
          {cfg.note}
        </p>
      )}

      {editRows.length > 0 && (
        <div className="space-y-3 pt-1 border-t dark:border-slate-800">
          {editRows.map((r) => (
            <div key={r.field}>
              <RowLabel label={r.label} badge={EDIT_BADGE} src={SRC[r.src]} />
              {r.kind === 'paragraph' ? (
                <textarea
                  className="w-full border rounded px-3 py-2 bg-white dark:bg-slate-950 dark:border-slate-700 text-sm"
                  rows={4}
                  value={draft[r.field] || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.field]: e.target.value }))}
                />
              ) : (
                <input
                  className="w-full border rounded px-3 py-2 bg-white dark:bg-slate-950 dark:border-slate-700 text-sm"
                  value={draft[r.field] || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.field]: e.target.value }))}
                  placeholder={r.kind === 'url' ? 'https://…' : ''}
                />
              )}
              {r.help && (
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">{r.help}</p>
              )}
            </div>
          ))}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={onSave}
            disabled={!dirty || saving}
            className="w-full px-2 py-1.5 text-sm bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : (saved && !dirty)
                ? <><Check className="w-4 h-4" /> Saved</>
                : 'Save changes'}
          </button>
          <p className="text-[11px] text-gray-400 dark:text-slate-500">
            Saving updates this slide in your deck preview and exports.
          </p>
        </div>
      )}

      {deckRows.length > 0 && (
        <div className="space-y-3 pt-3 border-t dark:border-slate-800">
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            <span className="font-medium">Deck-only wording.</span> These replace the text on this
            slide without touching your venture data — your Solution, Problem and Discovery modules
            stay exactly as you wrote them. Clear a field to go back to the live text.
          </p>
          {deckRows.map((r) => {
            const isOn = !!overrides[r.key];
            return (
              <div key={r.key}>
                <RowLabel
                  label={r.label}
                  badge={isOn ? DECK_BADGE : null}
                  src={null}
                />
                {r.kind === 'paragraph' ? (
                  <textarea
                    className="w-full border rounded px-3 py-2 bg-white dark:bg-slate-950 dark:border-slate-700 text-sm"
                    rows={3}
                    value={deckDraft[r.key] || ''}
                    placeholder={live[r.key] ? `Live: ${String(live[r.key]).slice(0, 90)}` : 'Leave empty to use the live text'}
                    onChange={(e) => setDeckDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                  />
                ) : (
                  <input
                    className="w-full border rounded px-3 py-2 bg-white dark:bg-slate-950 dark:border-slate-700 text-sm"
                    value={deckDraft[r.key] || ''}
                    placeholder={live[r.key] ? `Live: ${String(live[r.key]).slice(0, 60)}` : 'Leave empty to use the live text'}
                    onChange={(e) => setDeckDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                  />
                )}
              </div>
            );
          })}
          {deckError && <p className="text-xs text-red-500">{deckError}</p>}
          <button
            onClick={onSaveDeck}
            disabled={!deckDirty || deckSaving}
            className="w-full px-2 py-1.5 text-sm border border-amber-300 text-amber-700 dark:text-amber-300 dark:border-amber-800 rounded hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {deckSaving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : (deckSaved && !deckDirty)
                ? <><Check className="w-4 h-4" /> Saved</>
                : 'Save deck wording'}
          </button>
        </div>
      )}

      {!cfg && deckRows.length === 0 && (
        <div className="text-xs text-gray-400 italic">No editable fields for this slide.</div>
      )}
    </div>
  );
}
