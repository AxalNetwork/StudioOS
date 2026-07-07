import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { reportError } from '../lib/log';
import { safeReadJSON } from '../lib/storage';
import { useAuth } from '../hooks/useAuthSync';
import { api, dd } from '../lib/api';
import { ArrowRight, ChevronDown, ChevronRight, DoorOpen, X, Loader2, Check, FileSearch } from 'lucide-react';
import { openPaywall } from '../components/PaywallModal';
import ReferenceChecksPanel from '../components/ReferenceChecksPanel';
import FounderRiskBadge from '../components/FounderRiskBadge';
import LockedFounderCard from '../components/LockedFounderCard';
import TrustScoreBadge from '../components/TrustScoreBadge';

// Task #16 — fetch + render the founder's trust score (size=sm) inline on
// each deal row for admin/investor/partner viewers. Silently no-ops when
// the backend 403s (e.g. founder-role viewer) or the deal has no resolved
// founder_user_id (legacy unlinked rows).
// Task #40 — accepts a pre-fetched `data` prop populated by the parent's
// single POST /api/trust/score/batch call across all visible deals; falls
// back to the per-founder GET only when the parent didn't provide one.
function DealTrustBadge({ founderUserId, data }) {
  const [fallback, setFallback] = useState(null);
  useEffect(() => {
    if (data || !founderUserId) return;
    let cancelled = false;
    api.trustScore(founderUserId)
      .then(d => { if (!cancelled) setFallback(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [founderUserId, data]);
  const eff = data || fallback;
  if (!eff) return null;
  return <TrustScoreBadge size="sm" score={eff.score} missing={eff.missing} label="Trust" />;
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
  // Task #40 — single batched trust-score lookup keyed by founder_user_id.
  const [trustScores, setTrustScores] = useState({});
  const role = useCurrentRole();
  const canSeeReferences = role === 'admin' || role === 'investor';
  const canSeeRisk = role === 'admin' || role === 'partner' || role === 'investor';
  // Task #82 — investors work their own funnel. `scope` narrows the list to
  // deals they have a real relationship with (dealroom member / introduced /
  // converted watchlist item); operators & founders ignore it entirely.
  const isInvestor = role === 'investor';
  const [scope, setScope] = useState('mine');

  useEffect(() => {
    loadDeals();
    // Role hydrates asynchronously (localStorage first-paint → /auth/me), so
    // isInvestor/canSeeRisk can flip after the first render — refetch then, and
    // whenever the investor toggles scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeRisk, isInvestor, scope]);

  const loadDeals = async () => {
    try {
      const d = await api.listDeals(undefined, isInvestor ? scope : undefined);
      setDeals(d);
      // Task #40 — fan-in founder trust scores in one batched call.
      // Only roles that render the badge (admin/partner/investor) get
      // a 200; founders 403 here, so we gate the call on `canSeeRisk`.
      if (canSeeRisk) {
        const ids = Array.from(new Set(
          (d || []).map(deal => deal.founder_user_id).filter(Boolean),
        ));
        if (ids.length > 0) {
          try {
            const res = await api.trustScoreBatch(ids);
            const map = {};
            for (const s of (res?.scores || [])) map[s.user_id] = s;
            setTrustScores(map);
          } catch (e) {
            reportError('DealsPage:trustScoreBatch', e);
          }
        } else {
          setTrustScores({});
        }
      }
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
      <h1 className="text-2xl font-bold text-gray-900 mb-1 dark:text-gray-100">Deal Flow Pipeline</h1>
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

      {isInvestor && (
        <div className="flex gap-2 mb-4">
          {[['mine', 'My deals'], ['all', 'All deals']].map(([val, label]) => (
            <button key={val} onClick={() => setScope(val)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${scope === val ? 'bg-violet-600 text-white' : 'bg-gray-200 text-gray-700 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

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
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-600 dark:bg-gray-900 dark:border-gray-800">
            No deals found
          </div>
        ) : (
          filtered.map(deal => {
            const currentIdx = PIPELINE.indexOf(deal.status);
            const nextStatus = currentIdx >= 0 && currentIdx < PIPELINE.length - 1 ? PIPELINE[currentIdx + 1] : null;

            const isOpen = expanded === deal.id;
            return (
              <div key={deal.id} className="bg-white border border-gray-200 rounded-xl dark:bg-gray-900 dark:border-gray-800">
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
                      <span className="text-gray-900 font-medium dark:text-gray-100">{deal.project_name || `Startup #${deal.project_id}`}</span>
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
                      <DealTrustBadge founderUserId={deal.founder_user_id} data={trustScores[deal.founder_user_id]} />
                    )}
                    {canSeeRisk && <FounderRiskBadge dealId={deal.id} />}
                    {isInvestor ? (
                      <InvestorDealActions
                        deal={deal}
                        isMember={!!deal.is_member}
                        onJoined={loadDeals}
                        onView={() => setExpanded(isOpen ? null : deal.id)}
                      />
                    ) : (
                      nextStatus && deal.status !== 'rejected' && (
                        <button onClick={() => updateDeal(deal.id, nextStatus)} className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium flex items-center gap-1">
                          <ArrowRight size={12} /> {nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}
                        </button>
                      )
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

// Task #82 — per-relationship investor actions on a deal row, replacing the
// operator-only "advance stage" button:
//   • Join room  → api.dealroomJoin(deal.id) (idempotent; 402 quota_dealrooms
//                  has no `required` field so we surface the limit inline)
//   • View room  → expand the row's dealroom panel (already a member)
//   • Pass       → records a decision-journal `pass` with a reason (≥10 chars);
//                  hidden when the deal has no project_id (journal needs one).
function InvestorDealActions({ deal, isMember, onJoined, onView }) {
  const navigate = useNavigate();
  const [joining, setJoining] = useState(false);
  const [roomQuota, setRoomQuota] = useState('');
  const [roomTier, setRoomTier] = useState('');
  const [passOpen, setPassOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [passState, setPassState] = useState('idle'); // idle | busy | done
  const [ddBusy, setDdBusy] = useState(false);
  const [err, setErr] = useState('');

  // Task #83 — open (or continue) a Due-Diligence case straight from the deal.
  // Find-or-create so repeat clicks reuse the existing case on this startup
  // instead of piling up duplicates. Gated on membership (the worker only lets
  // an investor open DD on a startup they're in a deal room for).
  const openDd = async () => {
    if (ddBusy || deal.project_id == null) return;
    setDdBusy(true); setErr('');
    try {
      let target = null;
      try {
        const res = await dd.listCases({ subject_type: 'project' });
        target = (res.items || []).find(c => Number(c.subject_id) === Number(deal.project_id)) || null;
      } catch { /* listing 404s in dev FastAPI — fall through to create */ }
      if (!target) {
        target = await dd.openCase({
          subject_type: 'project',
          subject_id: deal.project_id,
          subject_label: deal.project_name || `Startup #${deal.project_id}`,
        });
      }
      if (target?.uid) navigate(`/due-diligence/${target.uid}`);
    } catch (e) {
      setErr(e.message || 'Could not open a diligence case');
      reportError('DealsPage:openDd', e);
    } finally { setDdBusy(false); }
  };

  const join = async () => {
    if (joining) return;
    setJoining(true); setErr(''); setRoomQuota('');
    try {
      await api.dealroomJoin(deal.id); // idempotent
      onJoined();
    } catch (e) {
      if (e.status === 402) {
        setRoomQuota((e.data && e.data.message) || 'You have reached your deal-room limit.');
        setRoomTier((e.data && e.data.upgrade_to) || 'professional');
      } else {
        setErr(e.message || 'Could not join the deal room');
        reportError('DealsPage:dealroomJoin', e);
      }
    } finally {
      setJoining(false);
    }
  };

  const submitPass = async () => {
    const thesis = reason.trim();
    if (thesis.length < 10) { setErr('Add a reason of at least 10 characters.'); return; }
    setPassState('busy'); setErr('');
    try {
      await api.journalCreate({
        project_id: deal.project_id,
        deal_id: deal.id,
        decision: 'pass',
        conviction: 1,
        thesis,
      });
      setPassState('done'); setPassOpen(false);
    } catch (e) {
      setPassState('idle');
      setErr(e.message || 'Could not record your pass');
      reportError('DealsPage:passJournal', e);
    }
  };

  const canPass = deal.project_id != null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {isMember ? (
          <button onClick={onView}
            className="px-3 py-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-medium flex items-center gap-1 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            <DoorOpen size={12} /> View room
          </button>
        ) : (
          <button onClick={join} disabled={joining}
            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg text-xs font-medium flex items-center gap-1">
            {joining ? <Loader2 size={12} className="animate-spin" /> : <DoorOpen size={12} />} Join room
          </button>
        )}
        {canPass && passState !== 'done' && (
          <button onClick={() => setPassOpen(o => !o)}
            className="px-3 py-1.5 border border-gray-300 hover:bg-gray-50 text-gray-600 rounded-lg text-xs font-medium flex items-center gap-1 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
            <X size={12} /> Pass
          </button>
        )}
        {passState === 'done' && (
          <span className="text-xs text-gray-500 flex items-center gap-1 dark:text-gray-400"><Check size={12} /> Passed</span>
        )}
        {isMember && deal.project_id != null && (
          <button onClick={openDd} disabled={ddBusy}
            className="px-3 py-1.5 border border-violet-300 hover:bg-violet-50 disabled:opacity-60 text-violet-700 rounded-lg text-xs font-medium flex items-center gap-1 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-900/20">
            {ddBusy ? <Loader2 size={12} className="animate-spin" /> : <FileSearch size={12} />} Open DD case
          </button>
        )}
      </div>

      {passOpen && (
        <div className="mt-1 w-64 bg-white border border-gray-200 rounded-lg p-2 shadow-sm dark:bg-gray-900 dark:border-gray-700">
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="Why are you passing? (min 10 chars — logged to your decision journal)"
            className="w-full text-xs border border-gray-300 rounded p-2 focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setPassOpen(false); setErr(''); }}
              className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-400">Cancel</button>
            <button onClick={submitPass} disabled={passState === 'busy' || reason.trim().length < 10}
              className="px-2.5 py-1 text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded flex items-center gap-1">
              {passState === 'busy' ? <Loader2 size={12} className="animate-spin" /> : null} Record pass
            </button>
          </div>
        </div>
      )}

      {roomQuota && (
        <div className="mt-1 w-64 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
          {roomQuota}{' '}
          <button onClick={() => openPaywall(roomTier || 'professional', roomQuota)} className="underline font-medium">Upgrade</button>
        </div>
      )}
      {err && <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">{err}</div>}
    </div>
  );
}
