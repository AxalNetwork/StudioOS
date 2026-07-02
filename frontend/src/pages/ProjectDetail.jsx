import React, { useEffect, useState, useCallback } from 'react';
import { safeExternalUrl } from '../lib/url';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, FileText, Target, Building, Rocket, Pencil, Trash2, X, Database, Search, ExternalLink, AlertCircle, PieChart, Users, UserPlus, Link2, Copy, Lock, Mail, Check } from 'lucide-react';
import SectorSelect from '../components/SectorSelect';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { useToast } from '../components/useToast';
import { useEscapeClose } from '../components/useEscapeClose';
import { getPitchCopyLengthStatus } from '../lib/pitchCopyLength';
import { StatusBadge } from './Dashboard';
import VentureRiskPanel from '../components/VentureRiskPanel';

const weekLabels = {
  week_1: { name: 'Week 1 — Validation Sprint', tasks: ['Define problem + ICP', 'Run user interviews', 'Validate willingness to pay', 'Draft 1-page concept'] },
  week_2: { name: 'Week 2 — Build + Structure', tasks: ['Build MVP', 'Define pricing model', 'Prepare pitch', 'Set up legal entity'] },
  week_3: { name: 'Week 3 — Distribution + Dealflow', tasks: ['Activate early users', 'Collect traction signals', 'Refine narrative', 'Partner matchmaking'] },
  week_4: { name: 'Week 4 — Capital + Launch', tasks: ['Pitch investors', 'Close commitments', 'Launch publicly', 'Portfolio onboarding'] },
  complete: { name: 'Playbook Complete', tasks: [] },
};

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { toast, showToast } = useToast();
  const [project, setProject] = useState(null);
  const [scores, setScores] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [cbOpen, setCbOpen] = useState(false);
  // Task #1 — caller's membership permissions ({ can_edit, can_manage, my_role }).
  // 403 (e.g. investors) resolves to null → no edit rights.
  const [perm, setPerm] = useState(null);

  const load = () => {
    setLoadError('');
    Promise.all([
      api.getProject(id),
      api.getScores(id).catch(() => []),
      api.listDocuments(id).catch(() => []),
      api.listProjectMembers(id).catch(() => null),
    ]).then(([p, s, d, m]) => {
      setProject(p); setScores(s); setDocs(d); setPerm(m);
    }).catch((e) => {
      setLoadError(e?.message || 'Failed to load project');
    }).finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  useEffect(() => {
    if (searchParams.get('cb') === '1' && project && !cbOpen && !cbTierLocked) {
      setCbOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('cb');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const advanceWeek = async () => {
    try {
      const updated = await api.advanceWeek(id);
      setProject(p => ({ ...p, ...updated }));
    } catch (e) { showToast({ kind: 'error', msg: e.message }); }
  };

  const incorporate = async () => {
    try {
      const res = await api.incorporateProject(id);
      showToast({ kind: 'success', msg: res.message || 'Incorporation requested' });
      load();
    } catch (e) { showToast({ kind: 'error', msg: e.message }); }
  };

  const spinout = async () => {
    try {
      const res = await api.spinoutProject(id);
      showToast({ kind: 'success', msg: res.message || 'Spin-out triggered' });
      load();
    } catch (e) { showToast({ kind: 'error', msg: e.message }); }
  };

  const handleDelete = async () => {
    if (!project) return;
    if (!window.confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteProject(project.id);
      navigate('/projects');
    } catch (e) { showToast({ kind: 'error', msg: e.message }); }
  };

  const isAdmin = user?.role === 'admin';
  const isOwner = !!user?.founder_id && project && project.founder_id === user.founder_id;
  // Task #1 — co-founders (and admin/partner managers) may edit project DATA;
  // advisors/investors may not. perm.can_edit comes from GET /:id/members.
  const canEdit = isAdmin || isOwner || !!perm?.can_edit;
  const canDelete = isAdmin || isOwner;
  const tier = (user?.tier || user?.subscription_plan || 'free').toLowerCase();
  const isElevated = ['admin','partner','investor','mentor'].includes((user?.role || '').toLowerCase());
  const cbTierLocked = !isElevated && tier !== 'growth' && tier !== 'studio';
  // Task #10 — Venture Risk panel: read gates to admin/partner/investor;
  // analyst writes (override/recompute) gate to admin/partner.
  const canSeeVentureRisk = ['admin','partner','investor'].includes((user?.role || '').toLowerCase());
  const canWriteVentureRisk = ['admin','partner'].includes((user?.role || '').toLowerCase());
  const handleCbClick = () => {
    if (cbTierLocked) {
      try {
        window.dispatchEvent(new CustomEvent('studioos:tier_required', {
          detail: { required: 'growth', message: 'Crunchbase enrichment is a growth-tier feature.' },
        }));
      } catch {}
      return;
    }
    setCbOpen(true);
  };

  if (loading) return <div className="text-gray-600 text-center py-20">Loading...</div>;
  if (loadError) {
    return (
      <div className="text-center py-20">
        <div className="text-red-600 text-sm mb-3">{loadError}</div>
        <Link to="/projects" className="text-violet-600 hover:underline text-sm">Back to Projects</Link>
      </div>
    );
  }
  if (!project) return <div className="text-red-600 text-center py-20">Project not found</div>;

  const week = weekLabels[project.playbook_week] || weekLabels.week_1;
  const latestScore = scores[0];

  return (
    <div data-testid="project-detail">
      <Link to="/projects" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4">
        <ArrowLeft size={14} /> Back to Projects
      </Link>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{project.name}</h1>
          <p className="text-sm text-gray-600">{project.description || project.sector}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={project.status} />
          <div className="flex gap-2 flex-wrap">
            {canEdit && (
              <button onClick={() => setEditing(true)} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-xs text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300">
                <Pencil size={12} /> Edit
              </button>
            )}
            <Link
              to={`/build/captable?project=${project.id}`}
              className="flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-xs text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300"
              title="Open this project's cap table in the simulator"
            >
              <PieChart size={12} /> Cap Table
            </Link>
            {canEdit && (
              <button
                onClick={handleCbClick}
                className={`flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs ${
                  cbTierLocked
                    ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
                title={cbTierLocked ? 'Upgrade to growth — Crunchbase enrichment' : 'Look up on Crunchbase'}
              >
                <Database size={12} /> Crunchbase {cbTierLocked && <span className="text-[10px] font-semibold ml-1">UPGRADE</span>}
              </button>
            )}
            {project.playbook_week !== 'complete' && (
              <button onClick={advanceWeek} className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs text-white">
                <ChevronRight size={12} /> Advance Week
              </button>
            )}
            {!project.entity_id && (
              <button onClick={incorporate} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">
                <Building size={12} /> Incorporate
              </button>
            )}
            {project.entity_id && project.status !== 'spinout' && ['tier_1', 'tier_2'].includes(project.status) && (
              <button onClick={spinout} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs text-white">
                <Rocket size={12} /> Spin Out
              </button>
            )}
            {canDelete && (
              <button data-testid="project-delete-btn" onClick={handleDelete} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-red-200 hover:bg-red-50 rounded-lg text-xs text-red-600 dark:bg-gray-900">
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {cbOpen && (
        <CrunchbaseLookupSlideOver
          project={project}
          onClose={() => setCbOpen(false)}
          onApplied={(snap) => {
            setProject((p) => ({
              ...p,
              crunchbase_uuid: snap.uuid,
              crunchbase_data_json: JSON.stringify(snap),
              crunchbase_synced_at: snap.fetched_at,
            }));
            showToast({ kind: 'success', msg: `Applied "${snap.name}" from Crunchbase` });
          }}
          onError={(msg) => showToast({ kind: 'error', msg })}
        />
      )}

      {project.crunchbase_uuid && (() => {
        let snap = null;
        try { snap = project.crunchbase_data_json ? JSON.parse(project.crunchbase_data_json) : null; } catch {}
        if (!snap) return null;
        return (
          <CrunchbaseProfileCard project={project} snap={snap} canEdit={canEdit} />
        );
      })()}

      {editing && (
        <EditProjectModal
          project={project}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setProject((p) => ({ ...p, ...updated }));
            setEditing(false);
            showToast({ kind: 'success', msg: 'Project updated' });
          }}
          onError={(msg) => showToast({ kind: 'error', msg })}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2 rounded-lg shadow-lg text-sm text-white z-50 ${
          toast.kind === 'error' ? 'bg-red-600' : 'bg-violet-600'
        }`} role="status">
          {toast.msg || (typeof toast === 'string' ? toast : '')}
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <InfoCard label="Sector" value={project.sector} />
        <InfoCard label="Stage" value={project.stage} />
        <InfoCard label="TAM" value={project.tam ? `$${(project.tam / 1e6).toFixed(0)}M` : '—'} />
        <InfoCard label="Cost to MVP" value={project.cost_to_mvp ? `$${project.cost_to_mvp.toLocaleString()}` : '—'} />
        <InfoCard label="Funding Needed" value={project.funding_needed ? `$${(project.funding_needed / 1e3).toFixed(0)}K` : '—'} />
        <InfoCard label="Revenue" value={project.revenue ? `$${project.revenue.toLocaleString()}` : '—'} />
      </div>

      {/* Task #2 — Data room section. URL + NDA toggle persist on the
          project so the Spin-Out Demo Day deck's "Review the deal" CTA
          pre-fills automatically across deck versions. */}
      <DataRoomSection
        project={project}
        onSaved={(updated) => {
          setProject((prev) => ({ ...prev, ...updated }));
          showToast({ kind: 'success', msg: 'Data room saved' });
        }}
        onError={(msg) => showToast({ kind: 'error', msg })}
      />

      {/* Task #31 — Product demo source. Feeds the Spin-Out Demo Day deck's
          "Product demo" slide (slot 6). */}
      <ProductDemoSection
        project={project}
        onSaved={(updated) => {
          setProject((prev) => ({ ...prev, ...updated }));
          showToast({ kind: 'success', msg: 'Product demo saved' });
        }}
        onError={(msg) => showToast({ kind: 'error', msg })}
      />

      {canSeeVentureRisk && project.id != null && (
        <VentureRiskPanel projectId={project.id} canWrite={canWriteVentureRisk} />
      )}

      {project.founder && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 dark:bg-gray-900 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 mb-2 dark:text-gray-100">Founder</h3>
          <div className="text-sm text-gray-900 dark:text-gray-100">{project.founder.name}</div>
          <div className="text-xs text-gray-600">{project.founder.email} | {project.founder.domain_expertise} | {project.founder.experience_years}yr exp</div>
          {project.founder.bio && <div className="text-xs text-gray-700 mt-1 dark:text-gray-300">{project.founder.bio}</div>}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">4-Week Playbook</h3>
          <div className="text-sm font-medium text-violet-600 mb-2">{week.name}</div>
          <ul className="space-y-1">
            {week.tasks.map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />{t}
              </li>
            ))}
          </ul>

          <div className="flex gap-1 mt-4">
            {['week_1', 'week_2', 'week_3', 'week_4'].map(w => (
              <div key={w} className={`flex-1 h-2 rounded-full ${
                project.playbook_week === 'complete' || ['week_2','week_3','week_4'].indexOf(project.playbook_week) >= ['week_2','week_3','week_4'].indexOf(w)
                  ? 'bg-violet-500' : 'bg-gray-300'
              }`} />
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-gray-100">
            <Target size={14} className="text-violet-600" /> Latest Score
          </h3>
          {latestScore ? (
            <div>
              <div className={`text-4xl font-bold ${
                latestScore.tier === 'TIER_1' ? 'text-emerald-600' :
                latestScore.tier === 'TIER_2' ? 'text-blue-600' : 'text-red-600'
              }`}>{latestScore.total_score}</div>
              <div className="text-xs text-gray-600 mt-1">{latestScore.tier.replace('_', ' ')}</div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                <div className="text-gray-600">Market: <span className="text-gray-900 dark:text-gray-100">{latestScore.market_total}</span>/25</div>
                <div className="text-gray-600">Team: <span className="text-gray-900 dark:text-gray-100">{latestScore.team_total}</span>/20</div>
                <div className="text-gray-600">Product: <span className="text-gray-900 dark:text-gray-100">{latestScore.product_total}</span>/15</div>
                <div className="text-gray-600">Capital: <span className="text-gray-900 dark:text-gray-100">{latestScore.capital_total}</span>/15</div>
                <div className="text-gray-600">Fit: <span className="text-gray-900 dark:text-gray-100">{latestScore.fit_total}</span>/15</div>
                <div className="text-gray-600">Distrib: <span className="text-gray-900 dark:text-gray-100">{latestScore.distribution_total}</span>/10</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-600">No score yet. <Link to="/scoring" className="text-violet-600 hover:underline">Run scoring</Link></div>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-gray-100">
          <FileText size={14} className="text-violet-600" /> Documents
        </h3>
        {docs.length === 0 ? (
          <p className="text-sm text-gray-600">No documents generated yet</p>
        ) : (
          <div className="space-y-2">
            {docs.map(d => (
              <div key={d.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
                <div>
                  <span className="text-gray-900 dark:text-gray-100">{d.title}</span>
                  <span className="text-xs text-gray-600 ml-2">{d.doc_type}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  d.status === 'signed' ? 'bg-emerald-100 text-emerald-700' :
                  d.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-700'
                }`}>{d.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CrunchbaseProfileCard({ project, snap, canEdit }) {
  const [comps, setComps] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);

  const loadCompetitors = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api.crunchbaseCompetitors(project.id, 10);
      setComps(res?.competitors || []);
      setOpen(true);
    } catch (e) {
      const code = e?.data?.error || '';
      if (code === 'crunchbase_not_connected') setErr('Crunchbase isn\'t connected. Connect it from Settings → Integrations.');
      else if (code === 'crunchbase_unauthorized') setErr('Crunchbase rejected the stored API key — reconnect from Settings → Integrations.');
      else if (e?.status === 429) setErr('Crunchbase Basic daily limit reached (200 calls/day). Try again tomorrow.');
      else setErr(e?.message || 'Failed to load competitors');
      setOpen(true);
    } finally { setLoading(false); }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
            <Database size={14} className="text-violet-600" /> Crunchbase profile
            {snap.cb_url && (
              <a href={safeExternalUrl(snap.cb_url)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-violet-600 hover:underline inline-flex items-center gap-1">
                open <ExternalLink size={10} />
              </a>
            )}
          </h3>
          <div className="text-sm text-gray-900 mt-1 font-medium dark:text-gray-100">{snap.name}</div>
          {snap.short_description && <div className="text-xs text-gray-700 mt-1 dark:text-gray-300">{snap.short_description}</div>}
        </div>
        <div className="flex flex-col items-end gap-1">
          {snap.fetched_at && (
            <div className="text-[10px] text-gray-500 whitespace-nowrap">synced {new Date(snap.fetched_at).toLocaleDateString()}</div>
          )}
          {canEdit && (
            <button
              onClick={loadCompetitors}
              disabled={loading}
              className="text-[11px] px-2 py-1 rounded border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-60"
            >
              {loading ? 'Loading…' : 'Find competitors'}
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
        <CbStat label="Headcount" value={snap.employee_range} />
        <CbStat label="Total funding" value={snap.funding_total_usd ? `$${(snap.funding_total_usd / 1e6).toFixed(2)}M` : '—'} />
        <CbStat label="Last round" value={snap.last_funding_type ? `${snap.last_funding_type}${snap.last_funding_at ? ` (${snap.last_funding_at})` : ''}` : '—'} />
        <CbStat label="Status" value={snap.operating_status || '—'} />
      </div>
      {(snap.category_groups?.length || snap.categories?.length) ? (
        <div className="flex flex-wrap gap-1 mt-3">
          {(snap.category_groups || []).slice(0, 6).map(c => (
            <span key={`g-${c}`} className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">{c}</span>
          ))}
          {(snap.categories || []).slice(0, 6).map(c => (
            <span key={`c-${c}`} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:text-gray-300">{c}</span>
          ))}
        </div>
      ) : null}
      {open && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Possible competitors (sector heuristic)</div>
            <button onClick={() => setOpen(false)} className="text-[11px] text-gray-500 hover:text-gray-700">hide</button>
          </div>
          {err && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">{err}</div>}
          {!err && comps && comps.length === 0 && (
            <div className="text-xs text-gray-500">No competitor matches found in Crunchbase Basic.</div>
          )}
          {!err && comps && comps.length > 0 && (
            <ul className="space-y-1.5">
              {comps.map(c => (
                <li key={c.uuid} className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate dark:text-gray-100">{c.name}</div>
                    {c.short_description && <div className="text-gray-600 truncate">{c.short_description}</div>}
                  </div>
                  {c.cb_url && (
                    <a href={safeExternalUrl(c.cb_url)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-violet-600 hover:underline inline-flex items-center gap-1 whitespace-nowrap">
                      open <ExternalLink size={10} />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CbStat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-xs text-gray-900 font-medium mt-0.5 truncate dark:text-gray-100">{value || '—'}</div>
    </div>
  );
}

function CrunchbaseLookupSlideOver({ project, onClose, onApplied, onError }) {
  useEscapeClose(onClose);
  const [q, setQ] = useState(project?.name || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [notConnected, setNotConnected] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState(0);
  const [applyingUuid, setApplyingUuid] = useState('');
  const isRateLimited = rateLimitedUntil > Date.now();

  useEffect(() => {
    if (isRateLimited) { setResults([]); return; }
    if (!q || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true); setErr(''); setNotConnected(false);
      try {
        const res = await api.crunchbaseSearch(q.trim(), 15);
        setResults(res?.results || []);
      } catch (e) {
        const msg = e?.message || '';
        const code = e?.data?.error || '';
        if (code === 'crunchbase_not_connected' || /not_connected/i.test(msg)) setNotConnected(true);
        else if (code === 'crunchbase_rate_limited' || e?.status === 429) {
          setRateLimitedUntil(Number(e?.data?.reset_epoch) || (Date.now() + 60 * 60 * 1000));
        } else setErr(msg || 'Search failed');
        setResults([]);
      } finally { setLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, isRateLimited]);

  const apply = async (snap) => {
    setApplyingUuid(snap.uuid); setErr('');
    try {
      const res = await api.crunchbaseApply(project.id, { uuid: snap.uuid });
      onApplied?.(res?.snapshot || snap);
      onClose();
    } catch (e) {
      const msg = e?.message || 'Apply failed';
      const code = e?.data?.error || '';
      if (code === 'crunchbase_rate_limited' || e?.status === 429) {
        setRateLimitedUntil(Number(e?.data?.reset_epoch) || (Date.now() + 60 * 60 * 1000));
      } else onError?.(msg);
    } finally { setApplyingUuid(''); }
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-label="Look up on Crunchbase">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-xl bg-white shadow-xl flex flex-col h-full dark:bg-gray-900">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
              <Database size={16} className="text-violet-600" /> Look up on Crunchbase
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Search and attach a Crunchbase company snapshot to this project.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus type="text" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Company name…"
              disabled={isRateLimited}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed dark:border-gray-700 dark:text-gray-100"
            />
          </div>
          {notConnected && (
            <div className="mt-3 text-xs px-3 py-2 rounded border border-amber-300 bg-amber-50 text-amber-800 flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>
                Crunchbase isn't connected.{' '}
                <Link to="/settings/integrations" className="underline font-medium">Connect from Settings → Integrations</Link>{' '}
                to enable enrichment.
              </span>
            </div>
          )}
          {isRateLimited && (
            <div className="mt-3 text-xs px-3 py-2 rounded border border-amber-300 bg-amber-50 text-amber-800 flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>
                Crunchbase daily limit reached — try again tomorrow.
                <span className="block mt-0.5 text-[11px] text-amber-700">
                  Resumes at {new Date(rateLimitedUntil).toLocaleString()}.
                </span>
              </span>
            </div>
          )}
          {err && !notConnected && !isRateLimited && (
            <div className="mt-3 text-xs text-red-600 flex items-center gap-1.5"><AlertCircle size={12} /> {err}</div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm text-gray-500 text-center">Searching…</div>
          ) : results.length === 0 ? (
            !notConnected && !isRateLimited && (
              <div className="p-6 text-sm text-gray-500 text-center">
                {q.trim().length < 2 ? 'Type at least 2 characters to search.' : 'No matches.'}
              </div>
            )
          ) : (
            <ul className="divide-y divide-gray-100">
              {results.map((r) => (
                <li key={r.uuid} className="px-5 py-3 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {r.image_url ? (
                        <img src={r.image_url} alt="" className="w-10 h-10 rounded object-cover bg-gray-100 shrink-0" loading="lazy" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center text-[10px] font-semibold text-violet-700 shrink-0">
                          {(r.name || '?').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{r.name}</div>
                          {r.cb_url && (
                            <a href={safeExternalUrl(r.cb_url)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-violet-600 hover:underline inline-flex items-center gap-0.5">
                              <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                        {r.website && (
                          <a href={safeExternalUrl(r.website)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-violet-600 hover:underline truncate block">
                            {r.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                          </a>
                        )}
                        {r.short_description && (
                          <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{r.short_description}</div>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-gray-500">
                          {r.hq_location && <span>{r.hq_location}</span>}
                          {r.employee_range && <span>{r.employee_range}</span>}
                          {r.funding_total_usd ? <span>${(r.funding_total_usd / 1e6).toFixed(1)}M raised</span> : null}
                          {r.operating_status && <span>{r.operating_status}</span>}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => apply(r)}
                      disabled={!!applyingUuid}
                      className="shrink-0 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg text-xs text-white font-medium"
                    >
                      {applyingUuid === r.uuid ? 'Applying…' : 'Apply'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function DataRoomSection({ project, onSaved, onError }) {
  const [url, setUrl] = useState(project.data_room_url || '');
  const [ndaRequired, setNdaRequired] = useState(!!project.data_room_nda_required);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setUrl(project.data_room_url || '');
    setNdaRequired(!!project.data_room_nda_required);
    setDirty(false);
  }, [project.id, project.data_room_url, project.data_room_nda_required]);

  const valid = (() => {
    const u = url.trim();
    if (!u) return true;
    try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; }
    catch { return false; }
  })();

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const u = url.trim();
      const updated = await api.updateProject(project.id, {
        data_room_url: u || null,
        data_room_nda_required: ndaRequired,
      });
      setDirty(false);
      onSaved && onSaved(updated);
    } catch (e) {
      onError && onError(e?.message || 'Failed to save data room');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-center gap-2 mb-1">
        <Database size={14} className="text-violet-600" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Data room</h3>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
        Link investors to your data room. This pre-fills the &quot;Review the deal&quot; button on the Spin-Out Demo Day deck.
      </p>
      <label className="block text-[11px] uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-1">
        Data-room URL
      </label>
      <input
        type="url"
        value={url}
        onChange={(e) => { setUrl(e.target.value); setDirty(true); }}
        placeholder="https://notion.so/your-data-room"
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
      />
      {!valid && (
        <div className="text-xs text-red-600 mt-1">Enter a valid http(s) URL or leave it blank.</div>
      )}
      <label className="flex items-center gap-2 mt-3 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
        <input
          type="checkbox"
          checked={ndaRequired}
          onChange={(e) => { setNdaRequired(e.target.checked); setDirty(true); }}
          className="rounded border-gray-300 dark:border-gray-700"
        />
        NDA required before access
      </label>
      <div className="flex items-center gap-2 mt-4">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving || !valid}
          className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {url.trim() && valid && (
          <a
            href={url.trim() /* codeql[js/xss-through-dom] -- url is http/https protocol-validated via the `valid` flag before this <a> renders; not raw HTML injection */}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Open <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

// Task #31 — Product demo source. Founders paste a demo video link, a live
// demo URL, a caption/description, and a screenshot image; these feed the
// Spin-Out Demo Day deck's "Product demo" slide (the project is the single
// source of truth). Mirrors DataRoomSection's save/validate pattern.
function ProductDemoSection({ project, onSaved, onError }) {
  const [videoUrl, setVideoUrl] = useState(project.product_demo_video_url || '');
  const [liveUrl, setLiveUrl] = useState(project.product_demo_live_url || '');
  const [caption, setCaption] = useState(project.product_demo_caption || '');
  const [screenshotUrl, setScreenshotUrl] = useState(project.product_demo_screenshot_url || '');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setVideoUrl(project.product_demo_video_url || '');
    setLiveUrl(project.product_demo_live_url || '');
    setCaption(project.product_demo_caption || '');
    setScreenshotUrl(project.product_demo_screenshot_url || '');
    setDirty(false);
  }, [
    project.id,
    project.product_demo_video_url,
    project.product_demo_live_url,
    project.product_demo_caption,
    project.product_demo_screenshot_url,
  ]);

  const urlOk = (u) => {
    const v = (u || '').trim();
    if (!v) return true;
    try { const x = new URL(v); return x.protocol === 'http:' || x.protocol === 'https:'; }
    catch { return false; }
  };
  const videoValid = urlOk(videoUrl);
  const liveValid = urlOk(liveUrl);
  const shotValid = urlOk(screenshotUrl);
  const valid = videoValid && liveValid && shotValid;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const updated = await api.updateProject(project.id, {
        product_demo_video_url: videoUrl.trim() || null,
        product_demo_live_url: liveUrl.trim() || null,
        product_demo_caption: caption.trim() || null,
        product_demo_screenshot_url: screenshotUrl.trim() || null,
      });
      setDirty(false);
      onSaved && onSaved(updated);
    } catch (e) {
      onError && onError(e?.message || 'Failed to save product demo');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100';
  const labelCls = 'block text-[11px] uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-1';

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-center gap-2 mb-1">
        <Rocket size={14} className="text-violet-600" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Product demo</h3>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
        Show the product, don&apos;t just describe it. This feeds the &quot;Product demo&quot; slide on the Spin-Out Demo Day deck.
      </p>

      <div className="space-y-3">
        <div>
          <label className={labelCls}>Demo video URL</label>
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => { setVideoUrl(e.target.value); setDirty(true); }}
            placeholder="https://youtube.com/… or a .mp4/.webm link"
            className={inputCls}
          />
          {!videoValid && <div className="text-xs text-red-600 mt-1">Enter a valid http(s) URL or leave it blank.</div>}
        </div>
        <div>
          <label className={labelCls}>Live demo URL</label>
          <input
            type="url"
            value={liveUrl}
            onChange={(e) => { setLiveUrl(e.target.value); setDirty(true); }}
            placeholder="https://app.yourproduct.com"
            className={inputCls}
          />
          {!liveValid && <div className="text-xs text-red-600 mt-1">Enter a valid http(s) URL or leave it blank.</div>}
        </div>
        <div>
          <label className={labelCls}>Screenshot / image URL</label>
          <input
            type="url"
            value={screenshotUrl}
            onChange={(e) => { setScreenshotUrl(e.target.value); setDirty(true); }}
            placeholder="https://…/screenshot.png"
            className={inputCls}
          />
          {!shotValid && <div className="text-xs text-red-600 mt-1">Enter a valid http(s) URL or leave it blank.</div>}
        </div>
        <div>
          <label className={labelCls}>Caption / description</label>
          <textarea
            value={caption}
            onChange={(e) => { setCaption(e.target.value); setDirty(true); }}
            rows={2}
            placeholder="One line on what the demo shows."
            className={inputCls}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving || !valid}
          className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {liveUrl.trim() && liveValid && (
          <a
            href={liveUrl.trim() /* codeql[js/xss-through-dom] -- liveUrl is http/https protocol-validated via the `liveValid` flag before this <a> renders; not raw HTML injection */}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Open live demo <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 dark:bg-gray-900 dark:border-gray-800">
      <div className="text-[10px] text-gray-600 uppercase tracking-wider">{label}</div>
      <div className="text-sm text-gray-900 font-medium mt-0.5 capitalize dark:text-gray-100">{value || '—'}</div>
    </div>
  );
}

const PITCH_FIELD_TYPE = { problem_statement: 'problem', solution: 'solution' };

// Task #2 — numeric input that allows blank (clears the field) and
// strips non-numeric chars on entry. `integer` enforces whole numbers.
function RevenueInput({ label, value, onChange, placeholder, integer }) {
  const handle = (e) => {
    const raw = e.target.value;
    const cleaned = integer
      ? raw.replace(/[^\d]/g, '')
      : raw.replace(/[^\d.]/g, '').replace(/(\..*?)\..*/g, '$1');
    onChange(cleaned);
  };
  return (
    <div>
      <label className="block text-xs text-gray-600 mb-1 dark:text-gray-400">{label}</label>
      <input
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={value}
        onChange={handle}
        placeholder={placeholder}
        className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
      />
    </div>
  );
}

function PitchCopyMeter({ status }) {
  if (!status) return null;
  const toneColors = {
    neutral: { bar: 'bg-gray-300 dark:bg-gray-600', text: 'text-gray-500 dark:text-gray-400' },
    amber:   { bar: 'bg-amber-500',                 text: 'text-amber-600 dark:text-amber-400' },
    green:   { bar: 'bg-emerald-500',               text: 'text-emerald-600 dark:text-emerald-400' },
    red:     { bar: 'bg-red-500',                   text: 'text-red-600 dark:text-red-400' },
  };
  const c = toneColors[status.tone] || toneColors.neutral;
  return (
    <div className="mt-1.5">
      <div className="h-1 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className={`h-full ${c.bar} transition-all duration-200`}
          style={{ width: `${status.progressPercent}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className={c.text}>{status.label}</span>
        <span className="text-gray-400 dark:text-gray-500 font-mono">{status.wordCount} {status.wordCount === 1 ? 'word' : 'words'}</span>
      </div>
    </div>
  );
}

const EDITABLE_FIELDS = [
  { key: 'name', label: 'Project Name', required: true },
  { key: 'description', label: 'Description' },
  { key: 'sector', label: 'Sector', sectorSelect: true },
  { key: 'problem_statement', label: 'Problem Statement', textarea: true },
  { key: 'solution', label: 'Solution', textarea: true },
];

// Task #2 — paid-pilot status enum surfaced on the Spin-Out Demo Day
// Validation slide. Mirrors the closed enum the worker validates
// against in routes/projects.ts (PUT handler).
const PAID_PILOT_STATUS_OPTIONS = [
  { value: '', label: 'Auto-detect from numbers' },
  { value: 'pre_revenue', label: 'Pre-revenue' },
  { value: 'pilot_signed', label: 'Pilot signed' },
  { value: 'pilot_paid', label: 'Pilot — paying' },
  { value: 'paid', label: 'Paid — live revenue' },
];

const MEMBER_ROLE_BADGE = {
  owner: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  cofounder: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  advisor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};
const MEMBER_ROLE_LABEL = { owner: 'Owner', cofounder: 'Co-founder', advisor: 'Advisor' };
const ADD_MODES = [
  { key: 'email', label: 'Email invite' },
  { key: 'link', label: 'Share link' },
  { key: 'user_id', label: 'User ID' },
  { key: 'match', label: 'Co-founder match' },
];

// Task #1 (Spin-Out Teams Collaboration) — the roster + invite controls that
// live inside Edit Project. Drives entirely off GET /projects/:id/members:
// `can_manage` decides whether management UI shows; `locked` + `gate_reason`
// render the stage-gate banner (new founders unlock in lab Week 2). Co-founders
// edit project data; advisors are read-only; investors are never members.
function ProjectMembersSection({ projectId, onError }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('email');
  const [role, setRole] = useState('cofounder');
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [connections, setConnections] = useState(null);
  const [selectedConn, setSelectedConn] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.listProjectMembers(projectId));
    } catch (e) {
      onError(e?.message || 'Failed to load the team roster');
    } finally {
      setLoading(false);
    }
  }, [projectId, onError]);

  useEffect(() => { load(); }, [load]);

  // Lazily fetch the owner's *active* (mutually NDA-signed) co-founder
  // connections the first time the match tab is opened.
  useEffect(() => {
    if (mode !== 'match' || connections !== null) return;
    api.cofounderListConnections()
      .then((r) => {
        const items = Array.isArray(r) ? r : (r?.items || []);
        setConnections(items.filter((c) => c.status === 'active'));
      })
      .catch(() => setConnections([]));
  }, [mode, connections]);

  const absoluteLink = (acceptPath) => `${window.location.origin}${acceptPath}`;
  const resetInputs = () => { setEmail(''); setUserId(''); setSelectedConn(''); };

  const addByUserId = async () => {
    const idNum = parseInt(userId, 10);
    if (!Number.isInteger(idNum) || idNum <= 0) { onError('Enter a valid user ID'); return; }
    setBusy(true); setNotice(''); setGeneratedLink('');
    try {
      await api.addProjectMember(projectId, { mode: 'user_id', user_id: idNum, role });
      setNotice('Member added.'); resetInputs(); await load();
    } catch (e) { onError(e?.message || 'Failed to add member'); }
    finally { setBusy(false); }
  };

  const addByMatch = async () => {
    if (!selectedConn) { onError('Choose a connection'); return; }
    setBusy(true); setNotice(''); setGeneratedLink('');
    try {
      await api.addProjectMember(projectId, { mode: 'cofounder_match', connection_uid: selectedConn, role });
      setNotice('Co-founder added from your match.'); resetInputs(); await load();
    } catch (e) { onError(e?.message || 'Failed to add co-founder'); }
    finally { setBusy(false); }
  };

  const inviteByEmail = async () => {
    const e = email.trim();
    if (!e) { onError('Enter an email address'); return; }
    setBusy(true); setNotice(''); setGeneratedLink('');
    try {
      const res = await api.createProjectInvitation(projectId, { mode: 'email', email: e, role });
      setGeneratedLink(absoluteLink(res.accept_path));
      setNotice('Invitation created — share the link below.'); setEmail(''); await load();
    } catch (err) { onError(err?.message || 'Failed to create invitation'); }
    finally { setBusy(false); }
  };

  const inviteByLink = async () => {
    setBusy(true); setNotice(''); setGeneratedLink('');
    try {
      const res = await api.createProjectInvitation(projectId, { mode: 'link', role });
      setGeneratedLink(absoluteLink(res.accept_path));
      setNotice('Share link created.'); await load();
    } catch (e) { onError(e?.message || 'Failed to create link'); }
    finally { setBusy(false); }
  };

  const revoke = async (invId) => {
    setBusy(true);
    try { await api.revokeProjectInvitation(projectId, invId); await load(); }
    catch (e) { onError(e?.message || 'Failed to revoke invitation'); }
    finally { setBusy(false); }
  };

  const removeMember = async (uid) => {
    setBusy(true);
    try { await api.removeProjectMember(projectId, uid); await load(); }
    catch (e) { onError(e?.message || 'Failed to remove member'); }
    finally { setBusy(false); }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — link is still visible to copy manually */ }
  };

  const shareMsg = 'Join my project on Axal StudioOS';
  const waHref = `https://wa.me/?text=${encodeURIComponent(`${shareMsg}: ${generatedLink}`)}`;
  const tgHref = `https://t.me/share/url?url=${encodeURIComponent(generatedLink)}&text=${encodeURIComponent(shareMsg)}`;
  const mailHref = `mailto:?subject=${encodeURIComponent(shareMsg)}&body=${encodeURIComponent(`${shareMsg}:\n\n${generatedLink}`)}`;

  const members = data?.members || [];
  const invitations = data?.invitations || [];
  const canManage = !!data?.can_manage;
  const locked = !!data?.locked;

  const inputCls = 'w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100';

  return (
    <div className="pt-4 border-t border-gray-200 dark:border-gray-800">
      <div className="mb-3 flex items-center gap-2">
        <Users size={16} className="text-gray-500 dark:text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Team</h3>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Co-founders can read &amp; edit project data; advisors have read-only access.
      </p>

      {loading ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">Loading team…</p>
      ) : (
        <>
          <div className="space-y-2">
            {members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-gray-900 dark:text-gray-100">{m.name || `User #${m.user_id}`}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${MEMBER_ROLE_BADGE[m.role] || ''}`}>
                      {MEMBER_ROLE_LABEL[m.role] || m.role}
                    </span>
                  </div>
                  {m.email && <div className="truncate text-xs text-gray-500 dark:text-gray-400">{m.email}</div>}
                </div>
                {canManage && m.role !== 'owner' && (
                  <button
                    type="button"
                    onClick={() => removeMember(m.user_id)}
                    disabled={busy}
                    className="shrink-0 text-gray-400 hover:text-red-600 disabled:opacity-50"
                    aria-label={`Remove ${m.name || 'member'}`}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
            {members.length === 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">No team members yet.</p>
            )}
          </div>

          {canManage && locked && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-300">
              <Lock size={14} className="mt-0.5 shrink-0" />
              <span>{data.gate_reason || 'Team building is locked at this stage.'}</span>
            </div>
          )}

          {canManage && !locked && (
            <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="mb-3 flex flex-wrap gap-1">
                {ADD_MODES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => { setMode(t.key); setNotice(''); setGeneratedLink(''); }}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      mode === t.key
                        ? 'bg-violet-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="mb-3">
                <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
                  <option value="cofounder">Co-founder (read &amp; edit)</option>
                  <option value="advisor">Advisor (read-only)</option>
                </select>
              </div>

              {mode === 'email' && (
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    placeholder="name@example.com"
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={inviteByEmail}
                    disabled={busy}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    <Mail size={14} /> Invite
                  </button>
                </div>
              )}

              {mode === 'link' && (
                <button
                  type="button"
                  onClick={inviteByLink}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  <Link2 size={14} /> Generate share link
                </button>
              )}

              {mode === 'user_id' && (
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={userId}
                    placeholder="Numeric user ID"
                    onChange={(e) => setUserId(e.target.value)}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={addByUserId}
                    disabled={busy}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    <UserPlus size={14} /> Add
                  </button>
                </div>
              )}

              {mode === 'match' && (
                <div className="flex gap-2">
                  <select
                    value={selectedConn}
                    onChange={(e) => setSelectedConn(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">
                      {connections === null
                        ? 'Loading matches…'
                        : connections.length === 0
                          ? 'No active co-founder matches'
                          : 'Choose a match…'}
                    </option>
                    {(connections || []).map((c) => (
                      <option key={c.uid} value={c.uid}>
                        {c.counterparty?.name || c.counterparty?.email || 'Connection'}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={addByMatch}
                    disabled={busy || !selectedConn}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    <UserPlus size={14} /> Add
                  </button>
                </div>
              )}

              {notice && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}

              {generatedLink && (
                <div className="mt-3 rounded-lg bg-gray-50 p-2.5 dark:bg-gray-800/60">
                  <div className="flex items-center gap-2">
                    <input readOnly value={generatedLink} className={`${inputCls} font-mono text-xs`} />
                    <button
                      type="button"
                      onClick={copyLink}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2 text-xs">
                    <a href={waHref} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline dark:text-violet-400">WhatsApp</a>
                    <a href={tgHref} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline dark:text-violet-400">Telegram</a>
                    <a href={mailHref} className="text-violet-600 hover:underline dark:text-violet-400">Email</a>
                  </div>
                </div>
              )}
            </div>
          )}

          {canManage && invitations.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-300">Pending invitations</h4>
              <div className="space-y-2">
                {invitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 px-3 py-2 dark:border-gray-700"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-gray-700 dark:text-gray-300">
                          {inv.invitee_email || 'Share link'}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${MEMBER_ROLE_BADGE[inv.role] || ''}`}>
                          {MEMBER_ROLE_LABEL[inv.role] || inv.role}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">Pending</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => revoke(inv.id)}
                      disabled={busy}
                      className="shrink-0 text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EditProjectModal({ project, onClose, onSaved, onError }) {
  const [form, setForm] = useState(() => ({
    name: project.name || '',
    description: project.description || '',
    sector: project.sector || '',
    problem_statement: project.problem_statement || '',
    solution: project.solution || '',
  }));
  // Task #1 — founder company / affiliation lives on the linked founder
  // row; surfaced on the Spin-Out deck's merged Team & network slide.
  const [founderCompany, setFounderCompany] = useState(() => project.founder?.company || '');
  // Task #2 — structured revenue proof. Kept in its own state slot so
  // founders can clear a numeric field back to "" without typing 0 (we
  // map "" → null on submit).
  const [revenue, setRevenue] = useState(() => ({
    revenue: project.revenue != null ? String(project.revenue) : '',
    mrr: project.mrr != null ? String(project.mrr) : '',
    paying_customers: project.paying_customers != null ? String(project.paying_customers) : '',
    first_payment_date: project.first_payment_date || '',
    paid_pilot_status: project.paid_pilot_status || '',
  }));
  const [saving, setSaving] = useState(false);

  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);
  useEscapeClose(handleClose);

  const submit = async () => {
    if (!form.name.trim()) {
      onError('Project name is required');
      return;
    }
    // Coerce blank string → null so the PUT clears the column rather
    // than writing "" (which the worker would later coerce to null
    // anyway, but doing it here keeps the wire payload honest).
    const num = (s) => {
      const t = (s || '').trim();
      if (!t) return null;
      const n = Number(t);
      return isFinite(n) && n >= 0 ? n : null;
    };
    const revenuePayload = {
      revenue: num(revenue.revenue),
      mrr: num(revenue.mrr),
      paying_customers: revenue.paying_customers.trim()
        ? Math.max(0, Math.floor(Number(revenue.paying_customers)))
        : null,
      first_payment_date: revenue.first_payment_date.trim() || null,
      paid_pilot_status: revenue.paid_pilot_status || null,
    };
    setSaving(true);
    try {
      const updated = await api.updateProject(project.id, {
        ...form,
        name: form.name.trim(),
        founder_company: founderCompany.trim(),
        ...revenuePayload,
      });
      onSaved(updated);
    } catch (e) {
      onError(e?.message || 'Failed to update project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Edit project"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Edit Project</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {EDITABLE_FIELDS.map((f) => (
            <div key={f.key}>
              {f.sectorSelect ? (
                <SectorSelect
                  label={f.label}
                  value={form[f.key]}
                  onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))}
                />
              ) : (
                <>
                  <label className="block text-xs text-gray-600 mb-1">
                    {f.label}{f.required && <span className="text-red-500"> *</span>}
                  </label>
                  {f.textarea ? (
                    <textarea
                      value={form[f.key]}
                      onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                      rows={3}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                    />
                  ) : (
                    <input
                      type="text"
                      value={form[f.key]}
                      onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                    />
                  )}
                  {PITCH_FIELD_TYPE[f.key] && (
                    <PitchCopyMeter status={getPitchCopyLengthStatus(form[f.key], PITCH_FIELD_TYPE[f.key])} />
                  )}
                </>
              )}
            </div>
          ))}

          {/* Task #1 — Founder company / affiliation. Surfaces on the
              Spin-Out Demo Day's merged Team & network slide. */}
          <div>
            <label className="block text-xs text-gray-600 mb-1 dark:text-gray-400">Company / affiliation</label>
            <input
              type="text"
              value={founderCompany}
              maxLength={200}
              placeholder="e.g. Acme Labs"
              onChange={(e) => setFounderCompany(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            />
          </div>

          {/* Task #2 — Revenue proof section. Powers the RevenueProofCard
              on the Spin-Out Demo Day Validation slide. All fields optional;
              leave blank for graceful pre-revenue state. */}
          <div className="pt-4 border-t border-gray-200 dark:border-gray-800">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Revenue</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Drives the Validation slide of your Demo Day deck. Leave blank for pre-revenue.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <RevenueInput
                label="Total revenue to date (USD)"
                placeholder="e.g. 12500"
                value={revenue.revenue}
                onChange={(v) => setRevenue((s) => ({ ...s, revenue: v }))}
              />
              <RevenueInput
                label="MRR (USD/month)"
                placeholder="e.g. 2400"
                value={revenue.mrr}
                onChange={(v) => setRevenue((s) => ({ ...s, mrr: v }))}
              />
              <RevenueInput
                label="Paying customers"
                placeholder="e.g. 3"
                value={revenue.paying_customers}
                onChange={(v) => setRevenue((s) => ({ ...s, paying_customers: v }))}
                integer
              />
              <div>
                <label className="block text-xs text-gray-600 mb-1 dark:text-gray-400">First payment date</label>
                <input
                  type="date"
                  value={revenue.first_payment_date}
                  onChange={(e) => setRevenue((s) => ({ ...s, first_payment_date: e.target.value }))}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-600 mb-1 dark:text-gray-400">Paid-pilot status</label>
                <select
                  value={revenue.paid_pilot_status}
                  onChange={(e) => setRevenue((s) => ({ ...s, paid_pilot_status: e.target.value }))}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                >
                  {PAID_PILOT_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Task #1 — Spin-Out teams: co-founders + advisors roster + invites. */}
          <ProjectMembersSection projectId={project.id} onError={onError} />
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl dark:border-gray-800">
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg text-sm text-gray-900 disabled:opacity-50 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
