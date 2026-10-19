import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import DealReferencesTab from '../components/deals/DealReferencesTab';
import DealSyndicates from '../components/deals/DealSyndicates';
import MercuryMatch from '../components/MercuryMatch';
import {
  ArrowLeft, Download, FileText, Loader2, X, DollarSign, Send, Check,
  Users, Clock, ThumbsUp, ThumbsDown,
} from 'lucide-react';

function useCurrentRole() {
  const { role } = useAuth();
  if (role) return role;
  try { return safeReadJSON('user', {}).role || null; }
  catch { return null; }
}

const statusColors = {
  applied: 'bg-blue-100 text-blue-700 border-blue-500/30',
  scored: 'bg-yellow-100 text-yellow-700 border-yellow-500/30',
  active: 'bg-green-100 text-green-700 border-green-500/30',
  funded: 'bg-violet-100 text-violet-700 border-violet-500/30',
  rejected: 'bg-red-100 text-red-700 border-red-500/30',
};

function fmtMoney(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString()}`;
}

/**
 * The deal room's tabs for a role (D630, #1388). The Ops canvas adds three:
 *   - Invitations — admin (`GET /deals/:id/invitations` is `requireAdmin`);
 *   - Transfers — admin and partner, who record them;
 *   - References — admin and investor (D609; founders and partners are refused).
 */
export function dealRoomTabs(role) {
  const tabs = ['Overview', 'Documents', 'Commitments', 'Activity'];
  if (role === 'admin') tabs.push('Invitations');
  if (role === 'admin' || role === 'partner') tabs.push('Transfers');
  if (role === 'admin' || role === 'investor') tabs.push('References');
  return tabs;
}

export default function DealRoomPage() {
  const { dealId } = useParams();
  const navigate = useNavigate();
  const role = useCurrentRole();
  const { user } = useAuth() || {};
  const isInvestor = role === 'investor';
  const isAdmin = role === 'admin';
  const tabs = dealRoomTabs(role);

  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Overview');
  const [error, setError] = useState('');
  const [commitOpen, setCommitOpen] = useState(false);
  // D752 (#1891): the investor's share sheet, opened from their own row or after a commitment.
  const [proofSheet, setProofSheet] = useState(null); // { target, consent, minimumCents }
  const [proofKey, setProofKey] = useState(0);
  const openProof = (target, read) => setProofSheet({ target, consent: read?.consent, minimumCents: read?.minimum_cents });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [myInvite, setMyInvite] = useState(null);

  const loadDeal = () => {
    api.getDeal(dealId)
      .then(d => { setDeal(d); document.title = `${d.project_name || 'Deal Room'} — axal`; })
      .catch(e => { setError(e.message || 'Deal not found'); reportError('DealRoom:getDeal', e); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadDeal(); /* eslint-disable-next-line */ }, [dealId]);

  useEffect(() => {
    if (isInvestor) {
      api.myDealInvitations()
        .then(list => setMyInvite((list || []).find(i => Number(i.deal_id) === Number(dealId)) || null))
        .catch(() => {});
    }
  }, [isInvestor, dealId, commitOpen]);

  const respond = async (response) => {
    try {
      await api.respondDealInvitation(dealId, response);
      setMyInvite(m => (m ? { ...m, status: response } : m));
    } catch (e) { reportError('DealRoom:respond', e); }
  };

  if (loading) return <div className="text-center text-gray-500 py-16"><Loader2 className="animate-spin inline mr-2" size={18} /> Loading deal room…</div>;
  if (error || !deal) return (
    <div className="text-center py-16">
      <p className="text-gray-500 mb-4">{error || 'Deal not found'}</p>
      <button onClick={() => navigate('/deals')} className="text-violet-600 hover:underline">← Back to Deal Flow</button>
    </div>
  );

  const canInvite = isAdmin && (deal.status === 'active' || deal.status === 'scored');
  const pct = deal.progress_pct || 0;

  return (
    <div>
      <button onClick={() => navigate('/deals')} className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1 mb-4 dark:text-gray-400">
        <ArrowLeft size={15} /> Back to Deal Flow
      </button>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{deal.project_name || `Deal #${deal.id}`}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${statusColors[deal.status]}`}>{deal.status}</span>
          </div>
          <p className="text-gray-600 dark:text-gray-400">{deal.project_sector || 'Deal Room'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isInvestor && myInvite && myInvite.status === 'invited' && (
            <>
              <button onClick={() => respond('interested')} className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"><ThumbsUp size={14} /> Interested</button>
              <button onClick={() => respond('passed')} className="px-3 py-2 border border-gray-300 hover:bg-gray-50 text-gray-600 rounded-lg text-sm font-medium flex items-center gap-1 dark:border-gray-700 dark:text-gray-400"><ThumbsDown size={14} /> Pass</button>
            </>
          )}
          {isInvestor && myInvite && myInvite.status !== 'invited' && (
            <span className="text-xs text-gray-500 flex items-center gap-1"><Check size={13} /> You responded: {myInvite.status}</span>
          )}
          {canInvite && (
            <button onClick={() => setInviteOpen(true)} className="px-3 py-2 border border-violet-300 text-violet-700 hover:bg-violet-50 rounded-lg text-sm font-medium flex items-center gap-1 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-900/20"><Users size={14} /> Invite Investors</button>
          )}
          {isInvestor && (
            <button onClick={() => setCommitOpen(true)} className="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"><DollarSign size={14} /> Commit Capital</button>
          )}
        </div>
      </div>

      {isInvestor && <DealRoomMembership dealId={deal.id} />}

      {/* Progress banner */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 dark:bg-gray-900 dark:border-gray-800">
        <div className="flex justify-between text-sm text-gray-500 mb-1">
          <span>Capital committed</span>
          <span>{fmtMoney(deal.capital_committed)} / {fmtMoney(deal.target_raise)} ({pct}%)</span>
        </div>
        <div className="w-full h-2.5 bg-gray-100 rounded-full dark:bg-gray-800">
          <div className="h-2.5 bg-violet-500 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800 mb-5">
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-violet-600 text-violet-700 dark:text-violet-400' : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <>
          <OverviewTab deal={deal} />
          <DealSyndicates projectId={deal.project_id} user={user} />
        </>
      )}
      {tab === 'Documents' && <DocumentsTab dealId={deal.id} />}
      {tab === 'Commitments' && <CommitmentsTab key={proofKey} dealId={deal.id} proof={isAdmin && !branchOfUser(user)} user={user} onShare={openProof} founderMatch={isDealFounder(role, user, deal)} />}
      {tab === 'Activity' && <ActivityTab dealId={deal.id} />}
      {tab === 'Invitations' && tabs.includes('Invitations') && (
        <DealInvitationsTab dealId={deal.id} onInvite={canInvite ? () => setInviteOpen(true) : undefined} />
      )}
      {tab === 'Transfers' && tabs.includes('Transfers') && <DealTransfersTab dealId={deal.id} canRecord={isAdmin || role === 'partner'} />}
      {tab === 'References' && tabs.includes('References') && <DealReferencesTab dealId={deal.id} />}

      {commitOpen && <CommitModal deal={deal} user={user} onClose={() => setCommitOpen(false)} onDone={async (opts) => {
        setCommitOpen(false); loadDeal(); setTab('Commitments');
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

function Field({ label, value }) {
  return (
    <div className="py-2 border-b border-gray-50 dark:border-gray-800/60">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{value ?? '—'}</div>
    </div>
  );
}

function OverviewTab({ deal }) {
  return (
    <div className="grid md:grid-cols-2 gap-x-8 gap-y-1">
      {deal.description && (
        <div className="md:col-span-2 mb-2 text-sm text-gray-600 dark:text-gray-400">{deal.description}</div>
      )}
      <Field label="Target Raise" value={fmtMoney(deal.target_raise)} />
      <Field label="Capital Committed" value={fmtMoney(deal.capital_committed)} />
      <Field label="Minimum Check" value={fmtMoney(deal.minimum_check)} />
      <Field label="Valuation Cap" value={fmtMoney(deal.valuation_cap)} />
      <Field label="Instrument" value={deal.instrument} />
      <Field label="SPV Jurisdiction" value={deal.spv_jurisdiction} />
      <Field label="Carry" value={deal.carry_pct != null ? `${deal.carry_pct}%` : null} />
      <Field label="Management Fee" value={deal.management_fee_pct != null ? `${deal.management_fee_pct}%` : null} />
      <Field label="Closing Deadline" value={deal.closing_deadline} />
      <Field label="Lead Partner" value={deal.lead_partner_name} />
      <Field label="Days in Stage" value={`${deal.days_in_stage ?? 0} days`} />
      <Field label="Website" value={deal.website ? <a href={deal.website} target="_blank" rel="noreferrer" className="text-violet-600 hover:underline">{deal.website}</a> : null} />
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
      <div className="flex justify-end mb-3">
        <button type="button" onClick={() => api.downloadDataRoom(dealId).catch(() => alert('Failed to download data room'))}
          className="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2">
          <Download size={15} /> Download Data Room
        </button>
      </div>
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
export function CommitmentsTab({ dealId, proof = false, user = null, onShare, founderMatch = false }) {
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
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(c.amount)}</div>
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

function ActivityTab({ dealId }) {
  const [events, setEvents] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    api.dealActivity(dealId).then(setEvents).catch(() => setFailed(true));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealId]);
  if (failed) return <Unreadable what="The activity" claim="That is not a claim that nothing happened." onRetry={load} />;
  if (events == null) return <div className="text-center text-gray-500 py-8"><Loader2 className="animate-spin inline" size={16} /></div>;
  if (events.length === 0) return <div className="text-center text-gray-500 py-8">No activity yet</div>;
  return (
    <div className="space-y-3">
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="mt-0.5 w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center dark:bg-gray-800"><Clock size={13} className="text-gray-500" /></div>
          <div>
            <div className="text-sm text-gray-900 dark:text-gray-100">{e.label}</div>
            <div className="text-xs text-gray-400">{e.at ? new Date(e.at).toLocaleString() : ''}</div>
          </div>
        </div>
      ))}
    </div>
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
    if (deal.minimum_check && amt < deal.minimum_check) { setErr(`Minimum check is ${fmtMoney(deal.minimum_check)}.`); return; }
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
              <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-gray-400">Amount (USD)</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className={input} placeholder="50000" />
              {deal.minimum_check ? <div className="text-xs text-gray-400 mt-1">Minimum check: {fmtMoney(deal.minimum_check)}</div> : null}
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
