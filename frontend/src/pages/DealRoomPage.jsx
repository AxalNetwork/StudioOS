import DealFreePlan from '../components/deals/DealFreePlan';
import { dealMoney, dealBackLink } from '../components/deals/dealMoney';
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { reportError } from '../lib/log';
import { safeReadJSON } from '../lib/storage';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';
import { adminCapitalAttestationsApi } from '../lib/api/adminCapitalAttestations';
import { branchOfUser } from '../lib/shellRole';
import { ProofStatement } from '../components/ProofOfFunds';
import { mercuryAttestationsApi } from '../lib/api/mercuryAttestations';
import { ProofDoor, ProofOfFundsSheet, useProofTargets } from './investor/ProofOfFunds';
import { COMMIT_RECORDED, SHARE_BUTTON, newestDealTarget, ownDealTarget, showsProof } from './investor/proofOfFundsModel';
import { Unreadable } from '../ui';
import { useDealroomQuota, QuotaLine, JoinNote, JoinLeaveButton } from '../components/deals/DealRoomJoin';
import DealInvitationsTab from '../components/deals/DealInvitationsTab';
import DealTransfersTab from '../components/deals/DealTransfersTab';
import DealSyndicates from '../components/deals/DealSyndicates';
import MercuryMatch from '../components/MercuryMatch';
import { TAB_DEFS, dealTabsFor, tabHref, tabOf } from './dealPageModel';
import ClosingRoom from './closing/ClosingRoom';
import VentureScorecard from '../components/scoring/scorecard/Scorecard';
import { EvidenceSummary } from './cycles/evidence/RaiseEvidence';
import { dealContextApi } from '../lib/api/dealContext';
import { blockedRole, keyStrip, readFailure, trackOf } from './deal/dealFrameModel';
import { BTN_P, BTN_S, DealLoading, DealNotFound, DealUnreadable, KeyStrip, NoPermission, RespondDialog, StageTrack } from './deal/DealFrame';
import DealOverview from './deal/DealOverview';
import DealNotes, { DealActivity } from './deal/DealNotes';
import { DealCommitment, DealDiligence, DealDocuments, DealTerms } from './deal/DealWorkTabs';
import { DealMarket, DealTeam, DealTraction } from './deal/DealInsightTabs';
import {
  ArrowLeft, FileText, Loader2, X, DollarSign, Send, Check, Users,
} from 'lucide-react';

function useCurrentRole() {
  const { role } = useAuth();
  if (role) return role;
  try { return safeReadJSON('user', {}).role || null; }
  catch { return null; }
}

const PILL_N = 'inline-flex items-center rounded-axal-pill border border-axal-hairline bg-axal-ground px-2.5 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';

function fmtMoney(n, currency = 'USD') {
  return dealMoney(n, currency) ?? 'Not recorded';
}

export default function DealRoomPage() {
  // D1148 (#2421): each tab is its own address under /deals/:dealId.
  const { dealId, tab: tabParam } = useParams();
  const navigate = useNavigate();
  const role = useCurrentRole();
  const { user } = useAuth() || {};
  const back = dealBackLink(role);
  const isInvestor = role === 'investor';
  const isAdmin = role === 'admin';
  const tabs = dealTabsFor(role);
  const tab = tabOf(tabParam, role);
  // D1152 (DL22): an Advisor and an Explorer get their words, and nothing is read.
  const blocked = blockedRole(role);

  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(!blocked);
  const [error, setError] = useState(null);
  const [commitOpen, setCommitOpen] = useState(false);
  // D752 (#1891): the investor's share sheet, opened from their own row or after a commitment.
  const [proofSheet, setProofSheet] = useState(null); // { target, consent, minimumCents }
  const [proofKey, setProofKey] = useState(0);
  const openProof = (target, read) => setProofSheet({ target, consent: read?.consent, minimumCents: read?.minimum_cents });
  const [inviteOpen, setInviteOpen] = useState(false);
  // D1152: part 2's stage (investors only) and the commitments behind the key strip.
  const [stage, setStage] = useState({ status: 'loading' });
  const [mine, setMine] = useState({ status: 'loading' });
  const [respondTo, setRespondTo] = useState(null);

  const loadDeal = () => {
    setLoading(true); setError(null);
    api.getDeal(dealId)
      .then(d => { setDeal(d); document.title = `${d.project_name || 'Deal Room'} — axal`; })
      .catch(e => { setError(e || { status: 0 }); reportError('DealRoom:getDeal', e); })
      .finally(() => setLoading(false));
  };
  const loadStage = () => {
    setStage({ status: 'loading' });
    dealContextApi.stage(dealId).then((data) => setStage({ status: 'ready', data }))
      .catch((e) => { reportError('DealRoom:stage', e); setStage({ status: 'unreadable' }); });
  };
  const loadMine = () => {
    setMine({ status: 'loading' });
    api.dealCommitments(dealId).then((d) => setMine({ status: 'ready', items: Array.isArray(d) ? d : null }))
      .catch((e) => { reportError('DealRoom:keyCommitments', e); setMine({ status: 'unreadable' }); });
  };

  useEffect(() => { if (!blocked) loadDeal(); /* eslint-disable-next-line */ }, [dealId, blocked]);
  // A Free-plan deal reads nothing more (D1149): its card is drawn from the deal read alone.
  const full = Boolean(deal && !deal.plan_limited);
  useEffect(() => {
    if (!full) return;
    loadMine();
    if (isInvestor) loadStage();
    /* eslint-disable-next-line */
  }, [full, dealId, isInvestor]);

  const respond = async (response) => {
    await api.respondDealInvitation(dealId, response);
    loadStage();
  };

  const tabRow = (id) => (
    <nav aria-label="Deal" className="flex gap-1 overflow-x-auto border-b border-axal-hairline dark:border-gray-700" data-testid="deal-tabs">
      {tabs.map(t => (
        <Link key={t} to={tabHref(id, t)} aria-current={tab === t ? 'page' : undefined} data-testid={`deal-tab-${t}`}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-[13px] font-bold ${tab === t ? 'border-axal-violet text-axal-violet-deep dark:border-violet-400 dark:text-violet-300' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-200'}`}>
          {TAB_DEFS[t].label}
        </Link>
      ))}
    </nav>
  );

  if (blocked) return <NoPermission kind={blocked} />;
  if (loading) return <DealLoading tabs={tabRow(dealId)} />;
  if (error || !deal) {
    const kind = readFailure(error);
    if (kind === 'not_on_deal') return <NoPermission kind="not_on_deal" />;
    if (kind === 'not_found') return <DealNotFound back={back} />;
    return <DealUnreadable onRetry={loadDeal} />;
  }

  const canInvite = isAdmin && (deal.status === 'active' || deal.status === 'scored');
  if (deal.plan_limited) return <DealFreePlan deal={deal} onRetry={loadDeal} />;
  const track = isInvestor ? trackOf(stage) : null;

  return (
    <div className="flex flex-col gap-4 pb-20 md:pb-0">
      {/* DL1: the header, one h1. */}
      <header className="flex flex-col gap-2">
        <button type="button" onClick={() => navigate(back.path)} className="inline-flex w-fit items-center gap-1 text-[12.5px] font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-200" data-testid="deal-crumb">
          <ArrowLeft size={14} /> {back.label}
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3.5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="m-0 text-[24px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">{deal.project_name || `Deal #${deal.id}`}</h1>
            <div className="flex flex-wrap items-center gap-1.5">
              {deal.project_sector && <span className={PILL_N}>{deal.project_sector}</span>}
              <span className={`${PILL_N} capitalize`} data-testid="deal-status">{deal.status || 'Status not recorded'}</span>
              {deal.lead_partner_name && <span className="text-[12.5px] font-semibold text-axal-muted dark:text-gray-400">Lead: {deal.lead_partner_name}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {track?.state === 'ready' && track.stage === 'Invited' && (
              <button type="button" onClick={() => setRespondTo('passed')} className={BTN_S} data-testid="deal-pass">Pass</button>
            )}
            {canInvite && (
              <button type="button" onClick={() => setInviteOpen(true)} className={BTN_S}><Users size={14} /> Invite Investors</button>
            )}
            {isInvestor && (
              <button type="button" onClick={() => setCommitOpen(true)} className={BTN_P}><DollarSign size={14} /> Commit Capital</button>
            )}
          </div>
        </div>
      </header>

      <KeyStrip tiles={keyStrip(deal, mine, role)} />
      {track && <StageTrack track={track} onRetry={loadStage} onRespond={setRespondTo} />}
      {isInvestor && <DealRoomMembership dealId={deal.id} />}

      {tabRow(deal.id)}

      {tab === 'overview' && (
        <>
          <DealOverview deal={deal} track={track} investor={isInvestor} />
          <DealSyndicates projectId={deal.project_id} user={user} />
        </>
      )}
      {/* D1253 (#2428): SC1's panel; each scope waits for the per-deal read. */}
      {tab === 'scorecard' && <VentureScorecard />}
      {/* D1261 (#2430): VR8, VR9's investor block; its read is PIPE-RAISE part 4. */}
      {tab === 'evidence' && <EvidenceSummary />}
      {tab === 'team' && <DealTeam deal={deal} />}
      {tab === 'market' && <DealMarket deal={deal} />}
      {tab === 'traction' && <DealTraction deal={deal} />}
      {/* D1153 (#3058): the working tabs, DL7–DL13. An investor's Documents and Commitment are theirs; a founder and staff keep today's. */}
      {tab === 'diligence' && <DealDiligence deal={deal} userId={user?.id} />}
      {tab === 'documents' && (isInvestor ? <DealDocuments deal={deal} /> : <DocumentsTab dealId={deal.id} />)}
      {tab === 'terms' && <DealTerms deal={deal} investor={isInvestor} />}
      {/* D1213 (#2424): the round's closing room, its own address under the deal. */}
      {tab === 'commitment' && isInvestor && <DealCommitment key={proofKey} deal={deal} user={user} onChangeAmount={() => setCommitOpen(true)} />}
      {tab === 'commitment' && !isInvestor && <p className="m-0 text-sm"><Link to={tabHref(deal.id, 'closing')} className="font-semibold underline" data-testid="deal-closing-door">Open the closing room</Link> for the round's lines, checklist and what is received.</p>}
      {tab === 'commitment' && !isInvestor && <CommitmentsTab key={proofKey} dealId={deal.id} currency={deal.currency} proof={isAdmin && !branchOfUser(user)} user={user} onShare={openProof} founderMatch={isDealFounder(role, user, deal)} />}
      {tab === 'closing' && <ClosingRoom dealId={deal.id} role={role} deal={deal} />}
      {/* DL14: an investor's Notes tab: their firm's notes, Eadwyn's draft slot and the activity. */}
      {tab === 'notes' && <DealNotes dealId={deal.id} userId={user?.id} />}
      {tab === 'activity' && <DealActivity dealId={deal.id} />}
      {tab === 'invitations' && (
        <DealInvitationsTab dealId={deal.id} onInvite={canInvite ? () => setInviteOpen(true) : undefined} />
      )}
      {tab === 'transfers' && <DealTransfersTab dealId={deal.id} currency={deal.currency} canRecord={isAdmin || role === 'partner'} />}

      {respondTo && <RespondDialog answer={respondTo} onConfirm={respond} onClose={() => setRespondTo(null)} />}
      {commitOpen && <CommitModal deal={deal} user={user} onClose={() => setCommitOpen(false)} onDone={async (opts) => {
        setCommitOpen(false); loadDeal(); loadMine(); setProofKey((k) => k + 1); navigate(tabHref(deal.id, 'commitment'));
        if (!opts?.share || !showsProof(user)) return;
        try {
          const read = await mercuryAttestationsApi.targets();
          const target = newestDealTarget(read, deal.id);
          if (target) openProof(target, read);
        } catch (e) { reportError('proof-of-funds:after-commit', e); }
      }} />}
      {proofSheet && <ProofOfFundsSheet target={proofSheet.target} consent={proofSheet.consent} minimumCents={proofSheet.minimumCents}
        onClose={() => setProofSheet(null)} onShared={() => setProofKey((k) => k + 1)}
        onTargetsChanged={async () => { setProofKey((k) => k + 1); try { return await mercuryAttestationsApi.targets(); } catch { return null; } }} />}
      {inviteOpen && <InviteModal dealId={deal.id} onClose={() => setInviteOpen(false)} />}
    </div>
  );
}

/**
 * D630 (#1388) — canvas `dr-header`: Join or Leave in the deal header, with
 * the quota and what joining does. Membership is the quota read's
 * `member_deal_ids`, narrowed by the active firm the way the deal list's
 * `is_member` is.
 */
function DealRoomMembership({ dealId }) {
  const [quotaState, reloadQuota] = useDealroomQuota();
  const member = Boolean(quotaState.quota?.member_deal_ids?.includes(Number(dealId)));
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 md:flex-row md:items-start md:justify-between dark:border-gray-800 dark:bg-gray-900" data-testid="dr-header">
      <div className="min-w-0 space-y-1">
        <QuotaLine state={quotaState} onRetry={reloadQuota} />
        <JoinNote />
      </div>
      {quotaState.quota && <JoinLeaveButton dealId={dealId} member={member} quotaState={quotaState} onChanged={reloadQuota} compact />}
    </div>
  );
}

function DocumentsTab({ dealId }) {
  const [docs, setDocs] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    api.dealDocuments(dealId).then(setDocs).catch(() => setFailed(true));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealId]);
  // A failed read is unreadable, never an empty list: "No documents yet" was
  // the catch branch, and it asserted something the page cannot know.
  if (failed) return <Unreadable what="The documents" claim="That is not a claim that no documents exist." onRetry={load} />;
  return (
    <div>
      {/* D1152: the zip export is retired (410 since #2647), so its button and its browser pop-up are gone. */}
      {docs == null ? (
        <div className="text-center text-gray-500 py-8"><Loader2 className="animate-spin inline" size={16} /></div>
      ) : docs.length === 0 ? (
        <div className="text-center text-gray-500 py-8">No documents yet</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50 dark:bg-gray-900 dark:border-gray-800 dark:divide-gray-800">
          {docs.map(d => (
            <div key={d.id} className="flex items-center gap-3 p-3">
              <FileText size={16} className="text-gray-400" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{d.title}</div>
                <div className="text-xs text-gray-500 capitalize">{(d.doc_type || '').replace(/_/g, ' ')} · {d.status}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * D752 (#1989): the deal's own founder, the only viewer offered "Match to my
 * Mercury" on its commitments. An investor, an admin or a partner sees each
 * commitment's status only, never the bank line behind it.
 */
export function isDealFounder(role, user, deal) {
  return role === 'founder' && user?.founder_id != null && deal?.project_founder_id != null
    && Number(user.founder_id) === Number(deal.project_founder_id);
}

/** D752: a pending commitment can be matched; a confirmed one keeps its door so the founder can withdraw. */
export const COMMITMENT_MATCH_STATUSES = Object.freeze(['pending', 'confirmed']);

// D752 (#1890): an admin on HQ (`proof`) also reads each commitment's shared
// proof of funds, once, after the commitments load: an audited request that
// counts a view. It comes from its own route, never from `dealCommitments`,
// which other invited investors read. Every other viewer makes no proof read.
export function CommitmentTotal({ total, currency = 'USD' }) {
  return <div className="text-sm text-gray-700 dark:text-gray-300" data-testid="commitments-total">Total committed: {fmtMoney(total, currency)}</div>;
}

export function CommitmentsTab({ dealId, currency = 'USD', proof = false, user = null, onShare, founderMatch = false }) {
  // D752 (#1891): an investor on HQ sees a door on their own row only.
  const own = useProofTargets({ enabled: showsProof(user) });
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const [proofs, setProofs] = useState(null); // { byTarget } | { error }
  const load = () => {
    setFailed(false);
    api.dealCommitments(dealId).then(setItems).catch(() => setFailed(true));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealId]);
  const loaded = items != null;
  useEffect(() => {
    if (!proof || !loaded) return undefined;
    let alive = true;
    adminCapitalAttestationsApi.forDeal(dealId)
      .then((r) => { if (alive) setProofs({ byTarget: Object.fromEntries((r?.items || []).map((i) => [i.target_id, i])) }); })
      .catch((e) => { reportError('proof-of-funds:deal', e); if (alive) setProofs({ error: e }); });
    return () => { alive = false; };
  }, [proof, loaded, dealId]);
  if (failed) return <Unreadable what="The commitments" claim="That is not a claim that none is recorded." onRetry={load} />;
  if (items == null) return <div className="text-center text-gray-500 py-8"><Loader2 className="animate-spin inline" size={16} /></div>;
  if (!Array.isArray(items)) return <CommitmentTotal currency={currency} total={items.total} />;
  if (items.length === 0) return <div className="text-center text-gray-500 py-8">No commitments recorded yet</div>;
  return (
    <>
    {proof && proofs?.error && (
      <div className="mb-2" data-testid="deal-proofs-failed">
        {proofs.error?.status
          ? <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{proofs.error.message || 'The proofs of funds could not be read.'}</p>
          : <Unreadable what="The proofs of funds" claim="This is not a claim that none was shared." />}
      </div>
    )}
    <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50 dark:bg-gray-900 dark:border-gray-800 dark:divide-gray-800">
      {items.map(c => (
        <div key={c.id} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.investor_name || `Investor #${c.investor_user_id}`}</div>
            {c.notes && <div className="text-xs text-gray-500">{c.notes}</div>}
            {proof && proofs?.byTarget && (
              <div className="mt-1.5" data-testid={`deal-proof-${c.id}`}>
                {proofs.byTarget[c.id]
                  ? <ProofStatement item={proofs.byTarget[c.id]} figureDollars={c.amount} />
                  : <span className="text-xs text-gray-500 dark:text-gray-400">No proof of funds shared</span>}
              </div>
            )}
          </div>
          <div className="flex-none text-right">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(c.amount, currency)}</div>
            <div className="text-xs text-gray-500 capitalize">{c.status}</div>
            {founderMatch && COMMITMENT_MATCH_STATUSES.includes(c.status) && (
              <div className="mt-1"><MercuryMatch target="commitment" targetId={c.id} matched={c.status === 'confirmed' ? {} : null} onChanged={load} /></div>
            )}
            {own.status === 'ready' && <ProofDoor target={ownDealTarget(own.read, c, user)} onShare={(t) => onShare?.(t, own.read)} />}
          </div>
        </div>
      ))}
    </div>
    </>
  );
}

export function CommitModal({ deal, onClose, onDone, user = null }) {
  const [amount, setAmount] = useState(deal.minimum_check || '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // D752 (#1891): an optional last step for an investor on HQ, once the commitment is recorded.
  const [recorded, setRecorded] = useState(false);
  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr('Enter a positive amount.'); return; }
    if (deal.minimum_check && amt < deal.minimum_check) { setErr(`Minimum check is ${fmtMoney(deal.minimum_check, deal.currency)}.`); return; }
    setSaving(true); setErr('');
    try {
      await api.createCommitment(deal.id, { amount: amt, notes: notes || null });
      if (showsProof(user)) setRecorded(true);
      else onDone();
    } catch (e) { setErr(e.message || 'Could not record commitment'); reportError('CommitModal', e); }
    finally { setSaving(false); }
  };
  const input = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100';
  if (recorded) {
    // Every close is today's success: Done, ×, the backdrop. Only Show Axal asks for the sheet.
    return (
      <>
        <div className="fixed inset-0 bg-black/40 z-40" onClick={() => onDone()} />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md dark:bg-gray-900" data-testid="commit-recorded">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{COMMIT_RECORDED}</h2>
              <button onClick={() => onDone()} className="text-gray-400 hover:text-gray-700 p-1" aria-label="Close"><X size={18} /></button>
            </div>
            <div className="p-5 flex flex-wrap justify-end gap-2">
              <button onClick={() => onDone()} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400" data-testid="commit-done">Done</button>
              <button onClick={() => onDone({ share: true })} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium" data-testid="commit-share">{SHARE_BUTTON}</button>
            </div>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md dark:bg-gray-900">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Commit Capital</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-500">Committing to <span className="font-medium text-gray-800 dark:text-gray-200">{deal.project_name}</span>. This records your intent — no funds move.</p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-gray-400">Amount ({deal.currency || 'USD'})</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className={input} placeholder="50000" />
              {deal.minimum_check ? <div className="text-xs text-gray-400 mt-1">Minimum check: {fmtMoney(deal.minimum_check, deal.currency)}</div> : null}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-gray-400">Notes (optional)</label>
              <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={input} />
            </div>
            {err && <div className="text-sm text-red-600">{err}</div>}
          </div>
          <div className="p-5 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400">Cancel</button>
            <button onClick={submit} disabled={saving} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium flex items-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />} Confirm Commitment
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function InviteModal({ dealId, onClose }) {
  const [investors, setInvestors] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('We think this deal is a strong fit for your thesis. Take a look and let us know if you\'re interested.');
  const [sendEmail, setSendEmail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => { api.dealInvestorOptions().then(l => setInvestors(Array.isArray(l) ? l : [])).catch(() => {}); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? investors.filter(i => (i.name || '').toLowerCase().includes(q) || (i.email || '').toLowerCase().includes(q)) : investors;
  }, [investors, search]);

  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async () => {
    if (selected.size === 0) { setErr('Select at least one investor.'); return; }
    setSaving(true); setErr('');
    try {
      const r = await api.createDealInvitations(dealId, { investor_user_ids: [...selected], message, send_email: sendEmail });
      setDone(r.invited || selected.size);
    } catch (e) { setErr(e.message || 'Could not send invitations'); reportError('InviteModal', e); }
    finally { setSaving(false); }
  };

  const input = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100';

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8 dark:bg-gray-900">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Invite Investors</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
          </div>
          {done > 0 ? (
            <div className="p-8 text-center">
              <Check size={40} className="text-green-500 mx-auto mb-3" />
              <p className="text-gray-800 dark:text-gray-200 font-medium">Sent {done} invitation{done === 1 ? '' : 's'}.</p>
              <button onClick={onClose} className="mt-4 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium">Done</button>
            </div>
          ) : (
            <>
              <div className="p-5 space-y-3">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search investors…" className={input} />
                <div className="max-h-56 overflow-y-auto border border-gray-100 rounded-lg dark:border-gray-800">
                  {filtered.length === 0 ? (
                    <div className="text-center text-sm text-gray-400 py-6">No investors found</div>
                  ) : filtered.map(i => (
                    <label key={i.id} className="flex items-center gap-3 p-2.5 hover:bg-gray-50 cursor-pointer dark:hover:bg-gray-800">
                      <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} className="accent-violet-600" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{i.name}</div>
                        <div className="text-xs text-gray-500 truncate">{i.email}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-gray-400">Message</label>
                  <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)} className={input} />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} className="accent-violet-600" />
                  Also send an email notification
                </label>
                {err && <div className="text-sm text-red-600">{err}</div>}
              </div>
              <div className="p-5 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center">
                <span className="text-xs text-gray-500">{selected.size} selected</span>
                <div className="flex gap-2">
                  <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400">Cancel</button>
                  <button onClick={submit} disabled={saving} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send Invitations
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
