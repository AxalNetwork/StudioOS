import React, { useState, useEffect, useMemo, useRef } from 'react';
import PageExplainer from '../components/PageExplainer';
import WaitlistLeadsPanel from '../components/WaitlistLeadsPanel';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, MessageSquare, CheckCircle2, XCircle, HelpCircle, AlertCircle, Save, X, FolderPlus, Star, Layers, Pencil, Inbox } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';

const STATUSES = [
  { value: 'validated', label: 'Validated', icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { value: 'invalidated', label: 'Invalidated', icon: XCircle, tone: 'text-rose-600 bg-rose-50 border-rose-200' },
  { value: 'inconclusive', label: 'Inconclusive', icon: HelpCircle, tone: 'text-gray-600 bg-gray-50 border-gray-200' },
];

// Discovery is one workspace with three tabs following the funnel: Leads
// (inbound waitlist customers) → Interviews (Mom-Test log) → Insights (pain
// themes). The active tab lives in the ?tab= query param so tabs are
// deep-linkable and the retired /customer-discovery route can redirect in.
const TABS = [
  { id: 'leads', label: 'Leads', icon: Inbox },
  { id: 'interviews', label: 'Interviews', icon: MessageSquare },
  { id: 'insights', label: 'Insights', icon: Layers },
];

function emptyInterview() {
  return {
    interviewee_name: '',
    interviewee_role: '',
    interview_date: new Date().toISOString().slice(0, 10),
    notes: '',
    hypotheses: [{ hypothesis: '', status: 'inconclusive', evidence: '' }],
    pains: [],
    featured: false,
    // Task #15 — null (not 0) means "unrated"; the Demo Day Validation
    // histogram only counts integer 0–5 ratings, so a missing pulse
    // must stay null end-to-end.
    validation_rating: null,
    validation_comment: '',
    // Migration 161 / 211. All three start as NOT RECORDED. `icp_fit` has been
    // a column since 161 with nothing on this form writing it; `quote_consent`
    // is three-state on purpose — null is "never asked", not "no".
    icp_fit: null,
    quote_consent: null,
    interviewee_company: '',
  };
}

export default function DiscoveryPage({
  initialProjects = null,
  initialProjectId = null,
  initialInterviews = null,
  initialSignals = null,
  initialPainView = null,
  initialTab = null,
  workspaceMode = false,
}) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState(() => initialProjects || []);
  const [projectId, setProjectId] = useState(() => initialProjectId || null);
  const [interviews, setInterviews] = useState(() => initialInterviews || []);
  const [signals, setSignals] = useState(() => initialSignals || null);
  const [painView, setPainView] = useState(() => initialPainView || null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const hasSeededWorkspace = useRef(Boolean(initialProjects?.length && initialProjectId));

  // Active tab from the URL (?tab=), defaulting to Leads — the top of the
  // discovery funnel and where the legacy /customer-discovery route lands.
  // project_id is preserved alongside tab in every URL write below.
  const requestedTab = searchParams.get('tab');
  const activeTab = TABS.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : (TABS.some((tab) => tab.id === initialTab) ? initialTab : 'leads');
  const setTab = (id) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set('tab', id);
    if (workspaceMode) next.set('mode', 'workspace');
    return next;
  }, { replace: true });

  useEffect(() => {
    if (initialProjects?.length) {
      const fromQuery = parseInt(searchParams.get('project_id'), 10);
      const selected = initialProjects.find((project) => project.id === fromQuery)
        || initialProjects.find((project) => project.id === initialProjectId)
        || initialProjects[0];
      setProjects(initialProjects);
      setProjectId(selected?.id || null);
      return undefined;
    }
    (async () => {
      try {
        const list = await api.listProjects();
        const safeList = list || [];
        setProjects(safeList);
        const fromQuery = parseInt(searchParams.get('project_id'), 10);
        if (fromQuery && safeList.find((p) => p.id === fromQuery)) {
          setProjectId(fromQuery);
        } else if (safeList.length > 0) {
          if (fromQuery) setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('project_id'); return n; }, { replace: true });
          setProjectId(safeList[0].id);
        }
      } catch (e) {
        const fromQuery = parseInt(searchParams.get('project_id'), 10);
        if (fromQuery) {
          setProjects([{ id: fromQuery, name: `Startup #${fromQuery}` }]);
          setProjectId(fromQuery);
          setError(e.message || 'The startup list could not be refreshed.');
          return;
        }
        // Defensive 404 — backend may return "Not found" when the user has
        // no project scope yet. Treat as the same "no projects" empty state
        // rendered below; don't surface a raw red banner.
        const msg = (e?.message || '').toLowerCase();
        if (e?.status === 404 || msg.includes('not found')) {
          setProjects([]);
        } else {
          setError(e.message || 'Failed to load startups.');
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectId) return;
    if (hasSeededWorkspace.current) {
      hasSeededWorkspace.current = false;
      return;
    }
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set('project_id', String(projectId)); return n; }, { replace: true });
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function refresh() {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [r1, r2, r3] = await Promise.all([
        api.listInterviews(projectId),
        api.getProgressSignals(projectId),
        // Pain-group view is non-fatal: a failure here must not blank the
        // interview log, so swallow it and fall back to no curation data.
        api.painGroups(projectId).catch(() => null),
      ]);
      setInterviews(r1.interviews || []);
      setSignals(r2);
      setPainView(r3);
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) {
        setInterviews([]);
        setSignals(null);
        setPainView(null);
        setError(`Startup #${projectId} is no longer available. Pick another startup from the dropdown.`);
      } else {
        setError(e.message || 'Failed to load discovery data.');
      }
    }
    finally { setLoading(false); }
  }

  async function handleSave() {
    try {
      const payload = {
        ...editing,
        hypotheses: editing.hypotheses.filter((h) => (h.hypothesis || '').trim()),
        pains: editing.pains.filter((p) => (p || '').trim()),
        // Task #15 — explicit null when unrated; coerce to integer 0–5
        // otherwise. Worker also clamps, but normalising here keeps the
        // wire payload tight and reproducible.
        validation_rating: (editing.validation_rating == null || editing.validation_rating === '')
          ? null
          : Math.max(0, Math.min(5, Math.round(Number(editing.validation_rating)))),
        // Empty comment → null so we don't store empty strings.
        validation_comment: (editing.validation_comment || '').trim() || null,
      };
      const isCreate = !editing.id;
      const priorCount = interviews.length;
      if (editing.id) await api.updateInterview(editing.id, payload);
      else await api.createInterview(projectId, payload);
      setEditing(null);
      await refresh();
      // Spin-Out Lab W1 — fire `customer_interview_logged_{1..5}` for the
      // first five interviews on this project (1-3 gate the week, 4-5 are
      // deliverable-only milestones). priorCount was captured
      // pre-refresh; +1 is the ordinal of the just-created row. Worker
      // dedups milestone keys, so re-firing is harmless. The hook is
      // wrapped in its own try/catch so a milestone-write failure never
      // surfaces as "Failed to save interview" after a successful save.
      if (isCreate) {
        const n = priorCount + 1;
        if (n >= 1 && n <= 5) {
          try {
            await markMilestone(user, `customer_interview_logged_${n}`);
          } catch {
            // markMilestone is already best-effort, but defend against
            // any future change to its contract.
          }
        }
      }
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) {
        setError(`Can't save: project #${projectId} or this interview is no longer available. Refresh and try again.`);
      } else {
        setError(e.message || 'Failed to save interview.');
      }
    }
  }

  // Task #18 — toggle the "star for Demo Day deck" flag straight from
  // the card. We send the full interview payload because the PUT
  // endpoint expects the standard create/update shape; the worker
  // preserves any field we omit. Optimistic update so the star feels
  // instant even if the round-trip is slow.
  async function handleToggleFeatured(interview) {
    const next = !interview.featured;
    setInterviews((prev) => prev.map((it) => (it.id === interview.id ? { ...it, featured: next } : it)));
    try {
      await api.updateInterview(interview.id, {
        interviewee_name: interview.interviewee_name,
        interviewee_role: interview.interviewee_role || '',
        interview_date: interview.interview_date,
        notes: interview.notes || '',
        hypotheses: interview.hypotheses || [],
        pains: interview.pains || [],
        featured: next,
      });
    } catch (e) {
      // Revert optimistic update on failure.
      setInterviews((prev) => prev.map((it) => (it.id === interview.id ? { ...it, featured: !next } : it)));
      setError(e.message || 'Failed to update interview.');
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this interview?')) return;
    try {
      await api.deleteInterview(id);
      await refresh();
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) {
        // Already gone — refresh to drop it from the list, no banner needed.
        await refresh();
      } else {
        setError(e.message || 'Failed to delete interview.');
      }
    }
  }

  // Task #29 — pain-group curation. assign/rename/delete all return the
  // freshly recomputed view, so we set it straight from the response (no
  // extra round-trip). Failures surface in the shared error banner.
  async function handleAssignPain(phrase, opts) {
    try {
      const view = await api.assignPain(projectId, { phrase, ...opts });
      setPainView(view);
    } catch (e) {
      setError(e.message || 'Failed to update pain grouping.');
    }
  }

  async function handleRenameGroup(id) {
    const current = (painView?.groups || []).find((g) => g.id === id);
    const title = prompt('Rename pain theme', current?.title || '');
    if (title == null) return;
    if (!title.trim()) return;
    try {
      const view = await api.renamePainGroup(id, title.trim());
      setPainView(view);
    } catch (e) {
      setError(e.message || 'Failed to rename pain theme.');
    }
  }

  async function handleDeleteGroup(id) {
    if (!confirm('Delete this theme? Its pains revert to individual entries — no interviews are changed.')) return;
    try {
      const view = await api.deletePainGroup(id);
      setPainView(view);
    } catch (e) {
      setError(e.message || 'Failed to delete pain theme.');
    }
  }

  // Distinct, deduped suggestions for the "log interview" pains input:
  // existing theme titles first (so paraphrases consolidate), then the
  // phrases already seen across interviews.
  const painSuggestions = useMemo(() => {
    if (!painView) return [];
    const out = [];
    const seen = new Set();
    const add = (s) => {
      const t = (s || '').trim();
      if (!t) return;
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(t);
    };
    for (const g of painView.groups || []) add(g.title);
    for (const g of painView.groups || []) for (const p of (g.phrases || [])) add(p.display_phrase);
    for (const u of painView.ungrouped || []) add(u.display_phrase);
    return out;
  }, [painView]);

  const stats = useMemo(() => {
    let v = 0, inv = 0, h = 0;
    for (const i of interviews) {
      for (const x of (i.hypotheses || [])) {
        h += 1;
        if (x.status === 'validated') v += 1;
        if (x.status === 'invalidated') inv += 1;
      }
    }
    return { interviews: interviews.length, hypotheses: h, validated: v, invalidated: inv };
  }, [interviews]);

  const hasProjects = projects.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Discovery</h1>
        <PageExplainer pageKey="customer_discovery" />
          <p className="text-sm text-gray-500 mt-1">Leads, Mom-Test interviews, and the insights they surface — each validated hypothesis lifts the traction signals score.</p>
        </div>
        <div className="flex gap-2">
          <select
            value={projectId || ''}
            onChange={(e) => setProjectId(parseInt(e.target.value, 10))}
            disabled={!hasProjects}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900"
          >
            {!hasProjects && <option value="">No startups available</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            onClick={() => setEditing(emptyInterview())}
            disabled={!projectId}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:hover:bg-violet-600"
          >
            <Plus size={14} /> Log interview
          </button>
        </div>
      </div>

      {hasProjects && (
        <div role="tablist" aria-label="Discovery sections" className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = t.id === activeTab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(t.id)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-violet-600 text-violet-700 dark:text-violet-300'
                    : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                }`}
              >
                <Icon size={16} /> {t.label}
              </button>
            );
          })}
        </div>
      )}

      {error && <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm"><AlertCircle size={16} className="mt-0.5" />{error}</div>}

      {hasProjects && activeTab === 'leads' && <WaitlistLeadsPanel projects={projects} />}

      {!hasProjects && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center dark:bg-gray-900 dark:border-gray-700">
          <FolderPlus size={32} className="mx-auto text-gray-400 mb-3" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">No startups yet</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Customer discovery is scoped to a startup. Create or join one first, then log Mom-Test interviews to start validating hypotheses.
          </p>
          <Link
            to="/projects"
            className="inline-flex items-center gap-2 mt-4 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Plus size={14} /> Go to Startups
          </Link>
        </div>
      )}

      {hasProjects && activeTab === 'interviews' && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Interviews" value={stats.interviews} />
        <Stat label="Hypotheses tested" value={stats.hypotheses} />
        <Stat label="Validated" value={stats.validated} tone="emerald" />
        <Stat label="Signals score" value={signals ? `${signals.factors.signals.points} / ${signals.factors.signals.max}` : '—'} sub="Feeds traction" tone="violet" />
      </div>
      )}

      {hasProjects && activeTab === 'interviews' && loading && <div className="text-sm text-gray-500">Loading…</div>}

      {hasProjects && activeTab === 'interviews' && (
      <div className="space-y-3">
        {interviews.length === 0 && !loading && (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-700">
            <MessageSquare size={28} className="mx-auto text-gray-300 mb-2" />
            No interviews yet. Log your first one to start building validated hypotheses.
          </div>
        )}
        {interviews.map((i) => (
          <div key={i.id} className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{i.interviewee_name}</span>
                  {i.interviewee_role && <span className="text-gray-500">· {i.interviewee_role}</span>}
                  <span className="text-xs text-gray-400">· {i.interview_date}</span>
                </div>
                {i.notes && <p className="text-sm text-gray-600 mt-1 whitespace-pre-line line-clamp-3">{i.notes}</p>}
                {Number.isInteger(i.validation_rating) && (
                  <RatingBadge rating={i.validation_rating} comment={i.validation_comment} />
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleToggleFeatured(i)}
                  title={i.featured ? 'Starred for Demo Day deck — click to unstar' : 'Star this quote for the Demo Day deck'}
                  aria-label={i.featured ? 'Unstar interview for Demo Day deck' : 'Star interview for Demo Day deck'}
                  aria-pressed={!!i.featured}
                  className={`p-1 rounded ${i.featured ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-amber-500'}`}
                >
                  <Star size={16} fill={i.featured ? 'currentColor' : 'none'} />
                </button>
                <button onClick={() => setEditing(i)} className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 dark:border-gray-800">Edit</button>
                <button onClick={() => handleDelete(i.id)} className="text-rose-500 hover:text-rose-700 p-1"><Trash2 size={14} /></button>
              </div>
            </div>
            {(i.hypotheses || []).length > 0 && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {i.hypotheses.map((h, idx) => {
                  const meta = STATUSES.find((s) => s.value === h.status) || STATUSES[2];
                  const Icon = meta.icon;
                  return (
                    <div key={idx} className={`border rounded-lg p-2 text-xs ${meta.tone}`}>
                      <div className="flex items-center gap-1.5 font-medium"><Icon size={12} /> {meta.label}</div>
                      <div className="text-gray-700 mt-1 dark:text-gray-300">{h.hypothesis}</div>
                      {h.evidence && <div className="text-gray-500 mt-1 italic">“{h.evidence}”</div>}
                    </div>
                  );
                })}
              </div>
            )}
            {(i.pains || []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {i.pains.map((p, idx) => <span key={idx} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">Pain: {p}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
      )}

      {hasProjects && activeTab === 'insights' && !loading && (
        <PainThemesPanel
          view={painView}
          onAssign={handleAssignPain}
          onRename={handleRenameGroup}
          onDelete={handleDeleteGroup}
        />
      )}

      {editing && <InterviewModal value={editing} onChange={setEditing} onSave={handleSave} onClose={() => setEditing(null)} suggestions={painSuggestions} />}
    </div>
  );
}

// Task #29 — pain-theme curation. Groups the founder's logged discovery pains
// into the few themes that drive the Spin-Out deck Slide 2 ("PAIN FREQUENCY
// ACROSS INTERVIEWS"). Grouping is deterministic + founder-curated (no AI):
// rename a theme, move a paraphrase into a theme, ungroup it, or spin a new
// theme — none of which edits the underlying interviews. Empty until the
// founder logs pains, mirroring the slide's honest no-data state.
function PainThemesPanel({ view, onAssign, onRename, onDelete }) {
  const groups = view?.groups || [];
  const ungrouped = view?.ungrouped || [];
  const total = view?.interview_total || 0;
  const hasAny = groups.length > 0 || ungrouped.length > 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-center gap-2 mb-1">
        <Layers size={16} className="text-violet-600" />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Pain themes</h2>
        {total > 0 && <span className="text-xs text-gray-400">· {total} interview{total === 1 ? '' : 's'}</span>}
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Groups the pains you log into the themes shown on the Spin-Out deck Slide 2. Merge paraphrases so the
        same pain counts once per theme. Editing themes never changes your interviews.
      </p>

      {!hasAny && (
        <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4 text-center dark:border-gray-700">
          No pains logged yet. Add pain points when logging interviews — they’ll appear here to group into themes.
        </div>
      )}

      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.id} className="border border-gray-200 rounded-lg p-3 dark:border-gray-800">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-sm text-gray-900 truncate dark:text-gray-100">{g.title}</span>
                  <span className="text-xs text-gray-400 shrink-0">{(g.phrases || []).length} phrase{(g.phrases || []).length === 1 ? '' : 's'}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => onRename(g.id)} title="Rename theme" aria-label="Rename theme" className="p-1 text-gray-400 hover:text-violet-600"><Pencil size={14} /></button>
                  <button onClick={() => onDelete(g.id)} title="Delete theme" aria-label="Delete theme" className="p-1 text-gray-400 hover:text-rose-600"><Trash2 size={14} /></button>
                </div>
              </div>
              {(g.phrases || []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {g.phrases.map((p) => (
                    <PhraseChip key={p.phrase_norm} phrase={p.display_phrase} currentGroupId={g.id} groups={groups} onAssign={onAssign} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {ungrouped.length > 0 && (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Ungrouped pains</div>
          <div className="flex flex-wrap gap-1.5">
            {ungrouped.map((u) => (
              <PhraseChip
                key={u.phrase_norm}
                phrase={u.display_phrase}
                count={u.count}
                currentGroupId={null}
                groups={groups}
                onAssign={onAssign}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// A single pain phrase with a "move to…" control. The native <select> stays
// uncontrolled (value pinned to '') so it always reads as the placeholder
// action after each pick. Options: every other theme, "ungroup" (only when
// currently grouped), and "new theme…" (prompts for a title).
function PhraseChip({ phrase, count, currentGroupId, groups, onAssign }) {
  function onMove(e) {
    const v = e.target.value;
    e.target.value = '';
    if (!v) return;
    if (v === '__ungroup') { onAssign(phrase, {}); return; }
    if (v === '__new') {
      const title = prompt('New theme name', phrase);
      if (title && title.trim()) onAssign(phrase, { new_title: title.trim() });
      return;
    }
    const gid = Number(v);
    if (Number.isFinite(gid)) onAssign(phrase, { group_id: gid });
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full pl-2 pr-1 py-0.5 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900">
      <span className="max-w-[14rem] truncate">{phrase}</span>
      {typeof count === 'number' && <span className="text-amber-500/80">×{count}</span>}
      <select
        value=""
        onChange={onMove}
        aria-label={`Move "${phrase}" to a theme`}
        title="Move to a theme"
        className="bg-transparent text-amber-700 text-xs rounded border border-amber-200 px-1 py-0.5 cursor-pointer focus:outline-none dark:text-amber-300 dark:border-amber-900"
      >
        <option value="">Move…</option>
        {groups.filter((g) => g.id !== currentGroupId).map((g) => (
          <option key={g.id} value={g.id}>→ {g.title}</option>
        ))}
        {currentGroupId != null && <option value="__ungroup">Ungroup</option>}
        <option value="__new">+ New theme…</option>
      </select>
    </span>
  );
}

function Stat({ label, value, sub, tone = 'gray' }) {
  const tones = { gray: 'text-gray-900', emerald: 'text-emerald-600', violet: 'text-violet-600' };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function InterviewModal({ value, onChange, onSave, onClose, suggestions = [] }) {
  function setH(idx, patch) {
    const next = [...value.hypotheses];
    next[idx] = { ...next[idx], ...patch };
    onChange({ ...value, hypotheses: next });
  }
  function addH() {
    onChange({ ...value, hypotheses: [...value.hypotheses, { hypothesis: '', status: 'inconclusive', evidence: '' }] });
  }
  function removeH(idx) {
    onChange({ ...value, hypotheses: value.hypotheses.filter((_, i) => i !== idx) });
  }
  // Task #29 — one-tap pain suggestions (existing themes + already-seen
  // phrases). Tapping a chip appends it to this interview's pains; chips for
  // pains already added are hidden so the list shrinks as you pick.
  function addPain(p) {
    const cur = value.pains || [];
    if (cur.some((x) => (x || '').trim().toLowerCase() === p.trim().toLowerCase())) return;
    onChange({ ...value, pains: [...cur, p] });
  }
  const painSet = new Set((value.pains || []).map((p) => (p || '').trim().toLowerCase()));
  const shownSuggestions = suggestions.filter((s) => !painSet.has(s.trim().toLowerCase())).slice(0, 12);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{value.id ? 'Edit interview' : 'Log new interview'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Interviewee name">
              <input value={value.interviewee_name} onChange={(e) => onChange({ ...value, interviewee_name: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
            </Field>
            <Field label="Role / context">
              <input value={value.interviewee_role || ''} onChange={(e) => onChange({ ...value, interviewee_role: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
            </Field>
            <Field label="Date">
              <input type="date" value={value.interview_date} onChange={(e) => onChange({ ...value, interview_date: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
            </Field>
            <Field label="Company">
              <input value={value.interviewee_company || ''} onChange={(e) => onChange({ ...value, interviewee_company: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
            </Field>
            {/* THE TWO FIELDS THE VALIDATE BOARD COUNTS ON. Each has a
                "not recorded" option that is the default and is NOT the same
                as the negative answer: an interview with no fit recorded
                cannot count for or against a claim, and the board says so
                rather than counting it as "not our customer". */}
            <Field label="ICP fit">
              <select
                value={value.icp_fit ?? ''}
                onChange={(e) => onChange({ ...value, icp_fit: e.target.value || null })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700"
              >
                <option value="">Not recorded</option>
                <option value="strong">Strong — this is who we build for</option>
                <option value="partial">Partial — adjacent to our customer</option>
                <option value="none">Not ICP</option>
              </select>
            </Field>
            <Field label="Consent to be quoted">
              <select
                value={value.quote_consent == null ? '' : (value.quote_consent ? 'yes' : 'no')}
                onChange={(e) => onChange({ ...value, quote_consent: e.target.value === '' ? null : e.target.value === 'yes' })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700"
              >
                <option value="">Not asked</option>
                <option value="yes">Yes — may be quoted</option>
                <option value="no">No — keep private</option>
              </select>
            </Field>
            <Field label="Pain points (comma-separated)">
              <input value={(value.pains || []).join(', ')} onChange={(e) => onChange({ ...value, pains: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
              {shownSuggestions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-gray-400">Suggested:</span>
                  {shownSuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => addPain(s)}
                      className="text-[11px] bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900"
                    >+ {s}</button>
                  ))}
                </div>
              )}
            </Field>
          </div>
          <Field label="Notes (Mom-Test style — what they did, not what they say they'd do)">
            <textarea rows={4} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm dark:border-gray-700" />
          </Field>

          {/* Task #15 — 0–5 "how well does this solve their problem?" rating.
              null = unrated (empty outline pips, distinct from 0 which is a
              real "doesn't help at all" answer). When rated, an optional
              one-line comment field appears below it. */}
          <div>
            <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">
              How well does this solution address the problem the interviewee experiences?
            </label>
            <RatingPicker
              value={value.validation_rating}
              onChange={(r) => onChange({
                ...value,
                validation_rating: r,
                // Clearing the rating also drops any stale comment so an
                // unrated interview never carries a hidden quote into the
                // wire payload on save.
                validation_comment: r == null ? '' : value.validation_comment,
              })}
            />
            {Number.isInteger(value.validation_rating) && (
              <input
                type="text"
                value={value.validation_comment || ''}
                onChange={(e) => onChange({ ...value, validation_comment: e.target.value })}
                placeholder="What did they say about it? (optional)"
                maxLength={240}
                className="mt-2 w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700"
              />
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase tracking-wide text-gray-500">Hypotheses</label>
              <button onClick={addH} className="text-xs text-violet-600 hover:text-violet-700 font-medium flex items-center gap-1"><Plus size={12} /> Add</button>
            </div>
            <div className="space-y-2">
              {value.hypotheses.map((h, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-2 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <input placeholder="We believe that…" value={h.hypothesis} onChange={(e) => setH(idx, { hypothesis: e.target.value })} className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm dark:border-gray-700" />
                    <select value={h.status} onChange={(e) => setH(idx, { status: e.target.value })} className="border border-gray-300 rounded-md px-2 py-1 text-sm dark:border-gray-700">
                      {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <button onClick={() => removeH(idx)} className="text-rose-500 hover:text-rose-700 p-1"><Trash2 size={14} /></button>
                  </div>
                  <input placeholder="Evidence / direct quote" value={h.evidence || ''} onChange={(e) => setH(idx, { evidence: e.target.value })} className="w-full border border-gray-200 rounded-md px-2 py-1 text-xs italic dark:border-gray-800" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 sticky bottom-0 bg-white dark:border-gray-800 dark:bg-gray-900">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 dark:border-gray-700">Cancel</button>
          <button onClick={onSave} disabled={!value.interviewee_name.trim()} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-2"><Save size={14} /> Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

// Task #15 — 6 clickable pips for 0..5. Click the active pip to clear back
// to "unrated" (null) so a mis-click can't trap a founder at "0". Rendered
// pips use a filled dot up to the current value; unrated state shows six
// dashed outlines so it never visually reads as "0".
function RatingPicker({ value, onChange }) {
  const isRated = Number.isInteger(value);
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Solution-fit rating, 0 to 5">
        {[0, 1, 2, 3, 4, 5].map((n) => {
          const filled = isRated && n <= value;
          const isCurrent = isRated && n === value;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={isCurrent}
              aria-label={`${n} out of 5`}
              onClick={() => onChange(isCurrent ? null : n)}
              className={[
                'h-7 w-7 rounded-full text-xs font-semibold flex items-center justify-center transition',
                filled
                  ? 'bg-violet-600 text-white border border-violet-600 hover:bg-violet-700'
                  : isRated
                    ? 'bg-white text-gray-500 border border-gray-300 hover:border-violet-400 dark:bg-gray-900 dark:border-gray-700'
                    : 'bg-white text-gray-400 border border-dashed border-gray-300 hover:border-violet-400 dark:bg-gray-900 dark:border-gray-700',
              ].join(' ')}
            >
              {n}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-gray-500">
        {isRated ? `${value} / 5` : 'Unrated — click a pip to record their pulse'}
      </span>
      {isRated && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs text-gray-400 hover:text-rose-600 underline"
        >
          clear
        </button>
      )}
    </div>
  );
}

// Card-view summary — slim row of 6 filled/empty dots + optional one-line
// quote. Hidden entirely when validation_rating is null.
function RatingBadge({ rating, comment }) {
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span className="uppercase tracking-wide text-gray-400">Fit</span>
      <span className="flex items-center gap-0.5" aria-label={`Rated ${rating} of 5`}>
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={`h-2 w-2 rounded-full ${n <= rating ? 'bg-violet-600' : 'bg-gray-200 dark:bg-gray-700'}`}
          />
        ))}
      </span>
      <span className="text-gray-600 font-medium">{rating} / 5</span>
      {comment && <span className="text-gray-500 italic truncate">· "{comment}"</span>}
    </div>
  );
}
