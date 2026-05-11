import React, { useEffect, useState } from 'react';
import { reportError } from '../lib/log';
import { safeReadJSON } from '../lib/storage';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';
import { ArrowRight, ChevronDown, ChevronRight, Filter } from 'lucide-react';
import ReferenceChecksPanel from '../components/ReferenceChecksPanel';
import FounderRiskBadge from '../components/FounderRiskBadge';
import LockedFounderCard from '../components/LockedFounderCard';
import TrustScoreBadge from '../components/TrustScoreBadge';

// Task #16 — fetch + render the founder's trust score (size=sm) inline on
// each deal row for admin/investor/partner viewers. Silently no-ops when
// the backend 403s (e.g. founder-role viewer) or the deal has no resolved
// founder_user_id (legacy unlinked rows).
function DealTrustBadge({ founderUserId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!founderUserId) return;
    api.trustScore(founderUserId)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [founderUserId]);
  if (!data) return null;
  return <TrustScoreBadge size="sm" score={data.score} missing={data.missing} label="Trust" />;
}

// Task #18 — read role from the live AuthProvider (re-fetched from
// /api/auth/me on every navigation) so a stale localStorage user can't
// keep showing risk badges to a viewer who was just demoted out of
// admin/investor/partner. localStorage is only consulted as a
// first-paint fallback while the auth context is hydrating.
function useCurrentRole() {
  const { role } = useAuth();
  if (role) return role;
  try { return safeReadJSON('user', {}).role || null; }
  catch { return null; }
}

// Task #4 (Y-2) — investor-side founder unlock card. Lazy-loads the project
// to surface the founder_user_id (only present on the GET /projects/:id
// shape, not the listing), then defers entirely to LockedFounderCard which
// itself short-circuits when an active pairwise NDA already exists.
function InvestorFounderUnlock({ projectId }) {
  const [proj, setProj] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.getProject(projectId)
      .then(p => { if (!cancelled) setProj(p); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);
  if (!proj?.founder_user_id) return null;
  return (
    <LockedFounderCard
      founderUserId={proj.founder_user_id}
      founderHandle={proj.name}
      sector={proj.sector}
      stage={proj.stage}
      headline={proj.description}
    />
  );
}

const STATUSES = ['all', 'applied', 'scored', 'active', 'funded', 'rejected'];
const statusColors = {
  applied: 'bg-blue-100 text-blue-700 border-blue-500/30',
  scored: 'bg-yellow-100 text-yellow-700 border-yellow-500/30',
  active: 'bg-green-100 text-green-700 border-green-500/30',
  funded: 'bg-violet-100 text-violet-700 border-violet-500/30',
  rejected: 'bg-red-100 text-red-700 border-red-500/30',
};

const PIPELINE = ['applied', 'scored', 'active', 'funded'];

export default function DealsPage() {
  const [deals, setDeals] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const role = useCurrentRole();
  const canSeeReferences = role === 'admin' || role === 'investor';
  const canSeeRisk = role === 'admin' || role === 'partner' || role === 'investor';

  useEffect(() => {
    loadDeals();
  }, []);

  const loadDeals = async () => {
    try {
      const d = await api.listDeals();
      setDeals(d);
    } catch (e) {
      reportError('DealsPage:loadDeals', e);
    }
    setLoading(false);
  };

  const updateDeal = async (dealId, status) => {
    try {
      await api.updateDeal(dealId, { status });
      loadDeals();
    } catch (e) {
      reportError('DealsPage:updateDeal', e);
    }
  };

  const filtered = filter === 'all' ? deals : deals.filter(d => d.status === filter);

  const pipelineCounts = {};
  PIPELINE.forEach(s => { pipelineCounts[s] = deals.filter(d => d.status === s).length; });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Deal Flow Pipeline</h1>
      <p className="text-gray-600 mb-6">Track deals from application to funding</p>

      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
        {PIPELINE.map((stage, i) => (
          <React.Fragment key={stage}>
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border ${statusColors[stage]} min-w-[120px]`}>
              <div>
                <div className="text-2xl font-bold">{pipelineCounts[stage]}</div>
                <div className="text-xs capitalize">{stage}</div>
              </div>
            </div>
            {i < PIPELINE.length - 1 && <ArrowRight size={16} className="text-gray-600 shrink-0" />}
          </React.Fragment>
        ))}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${filter === s ? 'bg-violet-600 text-white' : 'bg-gray-200 text-gray-700 hover:text-gray-900'}`}>
            {s} {s !== 'all' && `(${deals.filter(d => d.status === s).length})`}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="text-center text-gray-600 py-8">Loading deals...</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-600">
            No deals found
          </div>
        ) : (
          filtered.map(deal => {
            const currentIdx = PIPELINE.indexOf(deal.status);
            const nextStatus = currentIdx >= 0 && currentIdx < PIPELINE.length - 1 ? PIPELINE[currentIdx + 1] : null;

            const isOpen = expanded === deal.id;
            return (
              <div key={deal.id} className="bg-white border border-gray-200 rounded-xl">
                <div className="p-4 flex items-center gap-4">
                  {canSeeReferences && (
                    <button
                      onClick={() => setExpanded(isOpen ? null : deal.id)}
                      className="text-gray-400 hover:text-gray-700"
                      aria-label={isOpen ? 'Collapse' : 'Expand'}
                    >
                      {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </button>
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-gray-900 font-medium">{deal.project_name || `Project #${deal.project_id}`}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors[deal.status] || 'bg-gray-200 text-gray-700'}`}>
                        {deal.status?.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {deal.project_sector && <span className="mr-4">{deal.project_sector}</span>}
                      {deal.partner_name && <span className="mr-4">Partner: {deal.partner_name}</span>}
                      {deal.amount && <span>${deal.amount.toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canSeeRisk && deal.founder_user_id && (
                      <DealTrustBadge founderUserId={deal.founder_user_id} />
                    )}
                    {canSeeRisk && <FounderRiskBadge dealId={deal.id} />}
                    {nextStatus && deal.status !== 'rejected' && (
                      <button onClick={() => updateDeal(deal.id, nextStatus)} className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium flex items-center gap-1">
                        <ArrowRight size={12} /> {nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}
                      </button>
                    )}
                    <span className="text-xs text-gray-600">{new Date(deal.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                {isOpen && canSeeReferences && (
                  <div className="border-t border-gray-100 p-4 bg-gray-50/50 space-y-3">
                    {role === 'investor' && deal.project_id && (
                      <InvestorFounderUnlock projectId={deal.project_id} />
                    )}
                    <ReferenceChecksPanel dealId={deal.id} currentUserRole={role} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
