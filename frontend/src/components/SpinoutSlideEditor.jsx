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
  project: { label: 'Project', href: `/projects/${projectId}` },
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

/* -------------------------------------------------------- per-slide config -- */
// Each slide (keyed by spec_id) declares its AUTO rows (read-only, sourced from
// the live `fields` map and/or the loaded project) and its EDITABLE rows (mapped
// to a project column). `get(fields, project)` returns the display string for an
// auto row.
const CONFIG = {
  cover: {
    title: 'Cover',
    auto: [
      { label: 'Project', src: 'project', get: (f, p) => orDash(p?.name || f['cover.company']) },
      { label: 'Founder(s)', src: 'account', get: (f) => orDash(metaVal(f, 'FOUNDER')) },
      { label: 'Description', src: 'project', get: (f, p) => orDash(p?.description) },
      { label: 'Sector', src: 'project', get: (f, p) => orDash(p?.sector || metaVal(f, 'SECTOR')) },
      {
        label: 'Validation signal · 30-day sprint',
        src: 'discovery',
        get: (f) => orDash([f['cover.signalLabel'], f['cover.signalCaption']].filter(Boolean).join(' — ')),
      },
    ],
    edit: [],
  },
  problem: {
    title: 'Problem',
    auto: [
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
  validation: {
    title: 'Validation',
    // Data-driven: render the live discovery scorecard exactly as assembled
    // (each card carries its own label), so labels never drift from the data.
    auto: [
      {
        label: 'Discovery scorecard',
        src: 'discovery',
        multi: (f) => {
          const cards = j(f['validation.cards_json']) || [];
          return cards
            .map((c) => (Array.isArray(c) ? { label: c[1] || 'Metric', value: orDash(c[0]) } : null))
            .filter(Boolean);
        },
      },
    ],
    edit: [],
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
  cap_table: {
    title: 'Cap table & incorporation',
    auto: [
      {
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
  ask: {
    title: 'The ask',
    note: 'Edit the use-of-funds allocation in the “THE ASK — Use of Funds” panel on the right. The raise and milestone are pulled from your project.',
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

  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setLoading(true); setError('');
    api.getProject(projectId)
      .then((p) => { if (alive) setProject(p); })
      .catch((e) => {
        if (!alive) return;
        setError(e?.message || 'Failed to load project');
        reportError('SpinoutSlideEditor:load', e);
      })
      .finally(() => { if (alive) setLoading(false); });
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

      {!cfg && (
        <div className="text-xs text-gray-400 italic">No editable fields for this slide.</div>
      )}
    </div>
  );
}
