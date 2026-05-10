import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Handshake, Send, ArrowRight, Loader2, AlertTriangle, CheckCircle2,
  FileSignature, Sparkles, RefreshCw, Bot, User as UserIcon, Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/useToast';

/**
 * Task #9 (X-2) — Public token-gated partner onboarding wizard.
 *
 * Stages: chatbot → proposals → review/select → finalize (esign).
 * The token is the only authentication; lives in the URL path
 * (/partner-onboarding/:token) or query (?token=).
 */

const CHAT_QUESTIONS = [
  { key: 'full_name', q: "What's your full legal name?", placeholder: 'Jane Doe' },
  { key: 'organization', q: 'Which firm or organization are you with? (optional)', placeholder: 'Acme Capital, or "Independent"' },
  { key: 'role_title', q: 'What role/title best describes you? (optional)', placeholder: 'Managing Partner, Operating Partner, GC…' },
  { key: 'expertise', q: 'In one or two lines, what are you world-class at?', placeholder: 'B2B SaaS GTM, fintech regulation, deep-tech IP…', textarea: true },
  { key: 'sectors', q: 'Which sectors do you focus on?', placeholder: 'AI, Climate, Healthcare, Fintech…' },
  { key: 'geography', q: 'Geography you cover? (optional)', placeholder: 'NYC + East Coast, EU, Global…' },
  { key: 'capacity_per_month', q: 'How much time can you commit per month? (optional)', placeholder: '5–10 hours / month' },
  { key: 'capital_capacity_usd', q: 'If relevant, what capital could you commit / introduce? (USD, optional)', placeholder: '250000', numeric: true },
  { key: 'motivation', q: 'Why do you want to partner with Axal?', placeholder: 'What you hope to build/learn/contribute', textarea: true },
  { key: 'prior_deals', q: 'Notable prior deals or engagements? (optional)', placeholder: 'Brief list, links welcome', textarea: true },
  { key: 'linkedin_url', q: 'LinkedIn URL? (optional)', placeholder: 'https://linkedin.com/in/…' },
];

function classNames(...xs) { return xs.filter(Boolean).join(' '); }

export default function PartnerOnboardPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const token = params.token || search.get('token') || '';
  const { toast, showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState(null);
  const [invitation, setInvitation] = useState(null);
  const [adminName, setAdminName] = useState('Axal VC');
  const [existingProfile, setExistingProfile] = useState(null);
  const [existingDeal, setExistingDeal] = useState(null);

  // chat state
  const [chatTurns, setChatTurns] = useState([]); // [{role:'bot'|'user', text}]
  const [stepIdx, setStepIdx] = useState(0);
  const [draft, setDraft] = useState('');
  const [profileDone, setProfileDone] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // proposals
  const [proposals, setProposals] = useState([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState(null);

  // finalize
  const [finalizing, setFinalizing] = useState(false);
  const [signingUrl, setSigningUrl] = useState(null);

  // status polling (after finalize) — interval id lives in a ref so the
  // start/stop helpers and the interval callback never close over stale
  // state from an earlier render (which would prevent stopPolling() from
  // ever clearing the interval).
  const pollingRef = useRef(null);
  const chatEndRef = useRef(null);

  // -------- Initial load --------
  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setErrorState({ status: 400, message: 'No invitation token in URL.' });
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const r = await api.partnerOnboard.get(token);
        if (cancelled) return;
        setInvitation(r.invitation);
        setAdminName(r.admin_name || 'Axal VC');
        setExistingProfile(r.profile || null);
        setExistingDeal(r.deal || null);
        // Hydrate progress: if a profile already exists, mark profile step done.
        if (r.profile) {
          setProfileDone(true);
          setStepIdx(CHAT_QUESTIONS.length);
        }
        if (r.deal && r.deal.proposal) {
          setSelectedDeal(r.deal);
        }
        if (r.invitation.status === 'finalized' || r.invitation.status === 'signed') {
          // Jump straight to finalize panel + kick off the periodic poll
          // so the UI updates without a page refresh once the partner
          // returns from the e-sign provider. startPolling() is called in
          // a microtask so the `invitation` state has flushed first.
          await pullStatus(r.invitation, true);
          if (r.invitation.status !== 'signed') {
            queueMicrotask(() => startPolling());
          }
        }
      } catch (e) {
        if (!cancelled) setErrorState({ status: e.status || 500, message: e.message || 'Failed to load invitation' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // -------- Boot the chatbot once invitation is loaded --------
  useEffect(() => {
    if (!invitation || profileDone) return;
    if (chatTurns.length > 0) return;
    const greeting = invitation.personal_message
      ? `${invitation.personal_message}\n\n— ${adminName}`
      : `Hi${invitation.recipient_name ? ' ' + invitation.recipient_name : ''}, welcome! I'll ask a few quick questions so we can draft the right partnership for you.`;
    setChatTurns([
      { role: 'bot', text: greeting },
      { role: 'bot', text: CHAT_QUESTIONS[0].q },
    ]);
  }, [invitation, profileDone, chatTurns.length, adminName]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatTurns.length]);

  // -------- Chat send handler --------
  const profileFromTurns = useCallback(() => {
    const out = {};
    let qIdx = 0;
    for (const t of chatTurns) {
      if (t.role !== 'user') continue;
      if (qIdx >= CHAT_QUESTIONS.length) break;
      const def = CHAT_QUESTIONS[qIdx];
      if (t.text && t.text.toLowerCase() !== 'skip') {
        if (def.numeric) {
          const n = Number(String(t.text).replace(/[^\d.]/g, ''));
          if (Number.isFinite(n) && n > 0) out[def.key] = Math.floor(n);
        } else {
          out[def.key] = t.text.trim();
        }
      }
      qIdx += 1;
    }
    return out;
  }, [chatTurns]);

  const sendMessage = async (override) => {
    // Accept an explicit override so callers like skipQuestion can pass
    // 'skip' synchronously instead of relying on setState+setTimeout
    // (which races the next render and reads stale `draft`).
    const value = (typeof override === 'string' ? override : draft).trim();
    if (!value) return;
    if (stepIdx >= CHAT_QUESTIONS.length) return;
    const newTurns = [...chatTurns, { role: 'user', text: value }];
    const nextIdx = stepIdx + 1;
    if (nextIdx < CHAT_QUESTIONS.length) {
      newTurns.push({ role: 'bot', text: CHAT_QUESTIONS[nextIdx].q });
    } else {
      newTurns.push({ role: 'bot', text: 'Thanks! Saving your profile…' });
    }
    setChatTurns(newTurns);
    setDraft('');
    setStepIdx(nextIdx);

    if (nextIdx >= CHAT_QUESTIONS.length) {
      // Build profile and POST
      setSavingProfile(true);
      try {
        // recompute from the newTurns (state hasn't flushed yet)
        const profile = {};
        let qIdx = 0;
        for (const t of newTurns) {
          if (t.role !== 'user') continue;
          if (qIdx >= CHAT_QUESTIONS.length) break;
          const def = CHAT_QUESTIONS[qIdx];
          if (t.text && t.text.toLowerCase() !== 'skip') {
            if (def.numeric) {
              const n = Number(String(t.text).replace(/[^\d.]/g, ''));
              if (Number.isFinite(n) && n > 0) profile[def.key] = Math.floor(n);
            } else {
              profile[def.key] = t.text.trim();
            }
          }
          qIdx += 1;
        }
        profile.raw_chat_json = { turns: newTurns };
        await api.partnerOnboard.saveProfile(token, profile);
        setProfileDone(true);
        showToast({ kind: 'success', msg: 'Profile saved' });
      } catch (e) {
        showToast({ kind: 'error', msg: e.message || 'Failed to save profile' });
      } finally {
        setSavingProfile(false);
      }
    }
  };

  const skipQuestion = () => {
    if (stepIdx >= CHAT_QUESTIONS.length) return;
    sendMessage('skip');
  };

  // -------- Generate proposals --------
  const generateProposals = async () => {
    setLoadingProposals(true);
    try {
      const r = await api.partnerOnboard.propose(token);
      setProposals(r.proposals || []);
      if (!r.proposals || r.proposals.length === 0) {
        showToast({ kind: 'error', msg: 'No proposals generated — contact your admin' });
      }
    } catch (e) {
      showToast({ kind: 'error', msg: e.message || 'Failed to generate proposals' });
    } finally {
      setLoadingProposals(false);
    }
  };

  useEffect(() => {
    // auto-fetch proposals once profile is done and none are loaded
    if (profileDone && proposals.length === 0 && !selectedDeal && !loadingProposals) {
      generateProposals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileDone]);

  // -------- Select proposal --------
  const selectProposal = async (idx) => {
    setSelecting(true);
    setSelectedIdx(idx);
    try {
      const r = await api.partnerOnboard.select(token, { proposal_id: idx + 1 });
      setSelectedDeal({ id: r.deal_id, proposal: r.proposal, deal_type: r.proposal.deal_type });
      showToast({ kind: 'success', msg: 'Proposal selected' });
    } catch (e) {
      showToast({ kind: 'error', msg: e.message || 'Failed to select proposal' });
      setSelectedIdx(null);
    } finally {
      setSelecting(false);
    }
  };

  // -------- Finalize (e-sign) --------
  const finalize = async () => {
    setFinalizing(true);
    try {
      const r = await api.partnerOnboard.finalize(token);
      setSigningUrl(r.signing_url || null);
      showToast({ kind: 'success', msg: r.email_sent ? 'Sent for signature' : 'Envelope ready' });
      // start polling status every 5s
      startPolling();
    } catch (e) {
      showToast({ kind: 'error', msg: e.message || 'Could not start signature' });
    } finally {
      setFinalizing(false);
    }
  };

  const pullStatus = async (inv, silent = false) => {
    try {
      const r = await api.partnerOnboard.status(token);
      if (r.deal) setSelectedDeal((prev) => ({ ...(prev || {}), ...r.deal }));
      if (r.envelope_status === 'completed' || r.invitation_status === 'signed') {
        stopPolling();
        if (!silent) showToast({ kind: 'success', msg: 'Signature complete!' });
      }
      return r;
    } catch (e) {
      // soft fail; polling will retry
      return null;
    }
  };

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(() => { pullStatus(invitation, true); }, 5000);
  }, [invitation]);
  // Always tear down on unmount.
  useEffect(() => () => stopPolling(), [stopPolling]);

  // -------- Render --------
  if (loading) {
    return <FullPage><Loader2 size={32} className="animate-spin text-violet-600" /></FullPage>;
  }

  if (errorState) {
    const isExpired = errorState.status === 410;
    return (
      <FullPage>
        <div className="max-w-md text-center space-y-3">
          <div className={classNames(
            'inline-flex h-12 w-12 items-center justify-center rounded-full',
            isExpired ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600',
          )}>
            <AlertTriangle size={24} />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">{isExpired ? 'Invitation no longer valid' : 'Could not open invitation'}</h1>
          <p className="text-sm text-gray-600">{errorState.message}</p>
          <p className="text-xs text-gray-500">If you think this is a mistake, please reply to the email that brought you here so we can issue a new link.</p>
        </div>
      </FullPage>
    );
  }

  const completed = invitation?.status === 'signed' || (selectedDeal && selectedDeal.status === 'active');

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <header className="mb-6 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-violet-600 text-white flex items-center justify-center">
            <Handshake size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Partner Onboarding</h1>
            <p className="text-xs text-gray-500">From {adminName} · for <strong>{invitation.recipient_email}</strong></p>
          </div>
          <div className="ml-auto text-xs text-gray-500 flex items-center gap-1">
            <Clock size={12} /> Expires {new Date(invitation.expires_at).toLocaleDateString()}
          </div>
        </header>

        <Stepper
          stage={
            completed ? 4 :
            signingUrl || invitation.status === 'finalized' ? 3 :
            selectedDeal ? 3 :
            proposals.length > 0 ? 2 :
            profileDone ? 2 : 1
          }
        />

        {/* Stage 1 — chatbot */}
        {!profileDone && (
          <Card title="Tell us about yourself" icon={<Bot size={16} className="text-violet-600" />}>
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1" aria-live="polite">
              {chatTurns.map((t, i) => (
                <ChatBubble key={i} role={t.role} text={t.text} />
              ))}
              {savingProfile && <ChatBubble role="bot" text={<span className="inline-flex items-center gap-2 text-gray-500"><Loader2 size={12} className="animate-spin" /> Saving profile…</span>} />}
              <div ref={chatEndRef} />
            </div>
            {stepIdx < CHAT_QUESTIONS.length && (
              <div className="mt-4">
                <ChatComposer
                  step={CHAT_QUESTIONS[stepIdx]}
                  draft={draft}
                  setDraft={setDraft}
                  onSend={sendMessage}
                  onSkip={skipQuestion}
                  disabled={savingProfile}
                />
              </div>
            )}
          </Card>
        )}

        {/* Stage 2 — proposals */}
        {profileDone && !selectedDeal && (
          <Card title="Choose your deal structure" icon={<Sparkles size={16} className="text-violet-600" />}>
            {loadingProposals ? (
              <div className="py-12 text-center text-gray-500">
                <Loader2 size={28} className="animate-spin mx-auto mb-2 text-violet-600" />
                Drafting proposals from your profile…
              </div>
            ) : proposals.length === 0 ? (
              <div className="py-8 text-center text-gray-500">
                <p className="mb-3">No proposals yet.</p>
                <button onClick={generateProposals} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-violet-600 text-white text-sm font-medium hover:bg-violet-700">
                  <RefreshCw size={14} /> Generate proposals
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {proposals.map((p, idx) => (
                  <ProposalCard
                    key={idx}
                    proposal={p}
                    selected={selectedIdx === idx}
                    busy={selecting && selectedIdx === idx}
                    onSelect={() => selectProposal(idx)}
                    disabled={selecting}
                  />
                ))}
                <div className="text-xs text-gray-500 text-right">
                  <button onClick={generateProposals} disabled={selecting || loadingProposals}
                    className="inline-flex items-center gap-1 hover:text-violet-600">
                    <RefreshCw size={11} /> Regenerate
                  </button>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Stage 3 — review + finalize */}
        {selectedDeal && !completed && (
          <Card title="Review & sign" icon={<FileSignature size={16} className="text-violet-600" />}>
            <ProposalSummary proposal={selectedDeal.proposal || {}} />

            {!signingUrl && invitation.status !== 'finalized' && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setSelectedDeal(null); setSelectedIdx(null); }}
                  className="px-4 py-2 text-sm rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
                  disabled={finalizing}
                >
                  Back to proposals
                </button>
                <button
                  type="button"
                  onClick={finalize}
                  disabled={finalizing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50"
                >
                  {finalizing ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
                  Send for e-signature
                </button>
              </div>
            )}

            {(signingUrl || invitation.status === 'finalized') && (
              <div className="mt-5 space-y-3">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 size={16} className="mt-0.5" />
                    <div>
                      <strong>Envelope sent.</strong> Sign now (or check your inbox).
                      We'll activate your partner tier the moment you sign.
                    </div>
                  </div>
                </div>
                {signingUrl && (
                  <a
                    href={signingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-violet-600 text-white text-sm font-medium hover:bg-violet-700"
                  >
                    Open signing page <ArrowRight size={14} />
                  </a>
                )}
                <p className="text-xs text-gray-500">
                  This page polls every 5 seconds and will refresh when your signature is recorded.
                </p>
              </div>
            )}
          </Card>
        )}

        {/* Stage 4 — done */}
        {completed && (
          <Card title="Welcome to Axal" icon={<CheckCircle2 size={16} className="text-emerald-600" />}>
            <div className="text-center space-y-3 py-6">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 size={28} />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">You're all set</h2>
              <p className="text-sm text-gray-600 max-w-md mx-auto">
                Your partnership is active. Sign in to access your Partner Portal — your referral code,
                granted tiers, and deal terms are waiting there.
              </p>
              {selectedDeal?.referral_code && (
                <div className="inline-block rounded-lg bg-violet-50 px-4 py-2 font-mono text-violet-700 text-sm">
                  {selectedDeal.referral_code}
                </div>
              )}
              <div>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md bg-violet-600 text-white text-sm font-medium hover:bg-violet-700"
                >
                  Sign in to Partner Portal <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </Card>
        )}

        {toast && (
          <div className={classNames(
            'fixed bottom-6 right-6 z-[80] px-4 py-2 rounded-lg shadow-lg text-sm font-medium',
            toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white',
          )}>
            {typeof toast === 'string' ? toast : toast.msg}
          </div>
        )}
      </div>
    </div>
  );
}

function FullPage({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-6">
      {children}
    </div>
  );
}

function Card({ title, icon, children }) {
  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
      <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

function Stepper({ stage }) {
  const steps = ['Profile', 'Proposals', 'Sign', 'Done'];
  return (
    <ol className="flex items-center gap-2 mb-6 text-xs">
      {steps.map((label, i) => {
        const idx = i + 1;
        const done = stage > idx;
        const active = stage === idx;
        return (
          <li key={label} className="flex items-center gap-2">
            <span className={classNames(
              'inline-flex h-6 w-6 items-center justify-center rounded-full font-medium',
              done ? 'bg-violet-600 text-white' : active ? 'bg-violet-100 text-violet-700 ring-2 ring-violet-300' : 'bg-gray-100 text-gray-500',
            )}>
              {done ? <CheckCircle2 size={12} /> : idx}
            </span>
            <span className={classNames(active ? 'text-violet-700 font-medium' : 'text-gray-500')}>{label}</span>
            {idx < steps.length && <span className="w-6 h-px bg-gray-200" />}
          </li>
        );
      })}
    </ol>
  );
}

function ChatBubble({ role, text }) {
  const isBot = role === 'bot';
  return (
    <div className={classNames('flex gap-2', isBot ? 'justify-start' : 'justify-end')}>
      {isBot && (
        <div className="h-7 w-7 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center flex-shrink-0">
          <Bot size={14} />
        </div>
      )}
      <div className={classNames(
        'max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
        isBot ? 'bg-gray-100 text-gray-800' : 'bg-violet-600 text-white',
      )}>{text}</div>
      {!isBot && (
        <div className="h-7 w-7 rounded-full bg-violet-600 text-white flex items-center justify-center flex-shrink-0">
          <UserIcon size={14} />
        </div>
      )}
    </div>
  );
}

function ChatComposer({ step, draft, setDraft, onSend, onSkip, disabled }) {
  const InputTag = step.textarea ? 'textarea' : 'input';
  return (
    <div className="flex items-end gap-2">
      <InputTag
        type={step.numeric ? 'number' : 'text'}
        rows={step.textarea ? 2 : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !step.textarea) { e.preventDefault(); onSend(); }
        }}
        placeholder={step.placeholder}
        disabled={disabled}
        className="flex-1 px-3 py-2 text-sm rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:opacity-50"
      />
      <button type="button" onClick={onSkip} disabled={disabled}
        className="px-3 py-2 text-xs rounded-md text-gray-500 hover:text-gray-700 disabled:opacity-50">
        Skip
      </button>
      <button type="button" onClick={onSend} disabled={disabled || !draft.trim()}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50">
        <Send size={14} /> Send
      </button>
    </div>
  );
}

function ProposalCard({ proposal, selected, busy, onSelect, disabled }) {
  return (
    <div className={classNames(
      'rounded-xl border p-4 transition-all',
      selected ? 'border-violet-500 ring-2 ring-violet-200 bg-violet-50/50' : 'border-gray-200 hover:border-violet-300',
    )}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="font-semibold text-gray-900">{proposal.label}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{proposal.summary}</p>
        </div>
        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-gray-100 text-gray-600 whitespace-nowrap">
          {String(proposal.deal_type).replace(/_/g, ' ')}
        </span>
      </div>
      <ProposalSummary proposal={proposal} compact />
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled}
          className={classNames(
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium',
            selected ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-violet-100 hover:text-violet-700',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : selected ? <CheckCircle2 size={13} /> : null}
          {selected ? 'Selected' : 'Choose this'}
        </button>
      </div>
    </div>
  );
}

function ProposalSummary({ proposal, compact }) {
  const terms = proposal.terms || {};
  return (
    <div className={classNames(compact ? 'text-xs' : 'text-sm', 'space-y-1')}>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {Object.entries(terms).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-gray-500 capitalize">{k.replace(/_/g, ' ')}</dt>
            <dd className="text-gray-800 font-medium text-right">{String(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2 pt-2 text-[11px]">
        {proposal.granted_tier_founder && (
          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Founder: {proposal.granted_tier_founder}</span>
        )}
        {proposal.granted_tier_investor && (
          <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Investor: {proposal.granted_tier_investor}</span>
        )}
        {proposal.term_months && (
          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{proposal.term_months} mo term</span>
        )}
      </div>
    </div>
  );
}
