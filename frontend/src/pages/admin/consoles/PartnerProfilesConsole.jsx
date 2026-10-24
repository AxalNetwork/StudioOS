import React, { useCallback, useEffect, useRef, useState } from 'react';
import { reportError } from '../../../lib/log';
import { api } from '../../../lib/api';
import { ChevronDown, Briefcase, MessageSquare, X, Check } from 'lucide-react';
import { useEscapeClose } from '../../../components/useEscapeClose';
import { useWebSocket } from '../../../hooks/useWebSocket';
import SensitiveField, { SensitiveLine } from '../../../components/hqReview/SensitiveField';
import { SENSITIVE } from '../../../components/hqReview/hqReviewCopy';
import { CONSOLE_LOADING, ConsoleUnreadable } from './shared';

/**
 * D648 (#1448) — the Partner Profiles console: every captured entity profile
 * and its review drawer. It reads the profiles list only when this console is
 * open (the read writes an audit row), and a failed read says so rather than
 * drawing "No profiles captured yet".
 *
 * `onPendingCount` tells the Admin Console's section dropdown how many
 * profiles wait for review, once this console has read them.
 */

const STATUS_BADGES = {
  pending: 'bg-amber-100 text-amber-700',
  verified: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

const AGREEMENT_OPTIONS = [
  { value: '', label: '— Select agreement —' },
  { group: 'Investors', options: [
    { value: 'Subscription Booklet & LPA', label: 'Subscription Booklet & LPA (LP)' },
    { value: 'SPV Joinder Agreement', label: 'SPV Joinder Agreement (Syndicate)' },
    { value: 'Co-Investment Side Letter', label: 'Co-Investment Side Letter' },
    { value: 'Strategic Side Letter / Focused SPV', label: 'Strategic Side Letter / Focused SPV (Sector LP)' },
  ]},
  { group: 'Founders — New Venture (Spin-Out)', options: [
    { value: 'Founder Collaboration Agreement', label: 'Founder Collaboration Agreement' },
    { value: 'Spin-Out Subsidiary SPA + IP Transfer', label: 'Spin-Out Subsidiary SPA (Founder)' },
  ]},
  { group: 'Founders — Strategic Scale (Existing Company)', options: [
    { value: 'Strategic Scale Partnership Agreement', label: 'Strategic Scale Partnership Agreement' },
    { value: 'Technology Integration / JV Agreement', label: 'Technology Integration / JV (StudioOS AI)' },
    { value: 'Referral / Agency Agreement', label: 'Referral / Agency Agreement (Distribution / GTM)' },
    { value: 'M&A Advisory Mandate', label: 'M&A Advisory Mandate' },
  ]},
  { group: 'Operators & Service Partners', options: [
    { value: 'Venture Share Agreement (FAST)', label: 'Venture Share Agreement / FAST (Advisor)' },
    { value: 'MSA + Equity-for-Services', label: 'MSA + Equity-for-Services (Operating Partner)' },
    { value: 'Engagement Letter (Spin-Out Package)', label: 'Engagement Letter (Legal Counsel)' },
    { value: 'White-Label Service Agreement', label: 'White-Label Service Agreement (Technical Partner)' },
  ]},
  { group: 'Liquidity', options: [
    { value: 'Secondary Purchase Agreement', label: 'Secondary Purchase Agreement (Liquidity)' },
  ]},
];

const TRACK_BADGES = {
  'Spin-Out (New)': 'bg-blue-100 text-blue-700',
  'Strategic Scale (Existing)': 'bg-indigo-100 text-indigo-700',
};

export default function PartnerProfilesConsole({ onPendingCount }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openProfile, setOpenProfile] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.adminListProfiles();
      const rows = Array.isArray(p) ? p : [];
      setProfiles(rows);
      setFailed(false);
      onPendingCount?.(rows.filter(r => r.admin_status === 'pending').length);
    } catch (e) {
      reportError('AdminPage:loadProfiles', e);
      setFailed(true);
    } finally { setLoading(false); }
  }, [onPendingCount]);
  useEffect(() => { load(); }, [load]);

  const openPartnerProfile = async (p) => {
    try {
      setOpenProfile(await api.adminGetProfile(p.email));
    } catch (e) {
      reportError('AdminPage:partnerProfile', e);
      alert(e.message || 'The partner profile could not be read.');
    }
  };


  if (loading) return <div className="text-gray-600 text-center py-20">{CONSOLE_LOADING}</div>;

  return (
    <>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 dark:border-gray-800">
            <Briefcase size={16} className="text-gray-600" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Partner Profiles</h3>
            <span className="text-xs text-gray-500 ml-auto">{profiles.length} profiles</span>
          </div>

          {failed ? (
            <ConsoleUnreadable what="Partner profiles" onRetry={() => load()} />
          ) : profiles.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No profiles captured yet. New users will appear here after completing the onboarding chatbot.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800">
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">User</th>
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Persona</th>
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Legal Entity</th>
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Agreement</th>
                    <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Status</th>
                    <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map(p => (
                    <tr key={p.email} className="border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer" onClick={() => openPartnerProfile(p)}>
                      <td className="px-4 py-3">
                        <div className="text-gray-900 font-medium dark:text-gray-100">{p.user_name || '—'}</div>
                        <div className="text-xs text-gray-500">{p.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-700 dark:text-gray-300">{p.persona || <span className="text-gray-400">—</span>}</div>
                        {p.persona === 'Founder' && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {p.founder_track && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TRACK_BADGES[p.founder_track] || 'bg-gray-100 text-gray-600'}`}>
                                {p.founder_track}
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              p.company_established === 1 ? 'bg-emerald-100 text-emerald-700'
                              : p.company_established === 0 ? 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-500'
                            }`}>
                              {p.company_established === 1 ? 'Incorporated' : p.company_established === 0 ? 'Not incorporated' : 'Formation unknown'}
                            </span>
                            {p.partnership_goal && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700">
                                {p.partnership_goal}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{p.legal_entity_name || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs dark:text-gray-300">{p.agreement_type || <span className="text-gray-400">— not assigned —</span>}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGES[p.admin_status] || 'bg-gray-100 text-gray-700'}`}>
                          {p.admin_status || 'pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={(e) => { e.stopPropagation(); openPartnerProfile(p); }}
                          className="px-2.5 py-1.5 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 rounded-lg font-medium transition-colors">
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      {openProfile && (
        <ProfileReviewModal
          profile={openProfile}
          onClose={() => setOpenProfile(null)}
          onSaved={() => { setOpenProfile(null); load(); }}
        />
      )}
    </>
  );
}

/** D989 — Partner profiles (`../profiles/PartnerProfiles.jsx`) opens the same review until its part 6 redraws it. */
export function ProfileReviewModal({ profile, onClose, onSaved }) {
  useEscapeClose(onClose);
  const [agreement, setAgreement] = useState(profile.agreement_type || '');
  const [notes, setNotes] = useState(profile.admin_notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Persisted transcript from D1 — used as the initial render. New messages
  // streamed in via the OnboardingChat Durable Object are appended below.
  const initialChat = (() => {
    try { return JSON.parse(profile.chat_history || '[]'); } catch { return []; }
  })();
  const [liveChat, setLiveChat] = useState(initialChat);
  // Unified dedupe key — must match between persisted seed and live DO frames
  // (architect review caught the prior `seed:` vs `do:` schema split that
  // caused duplicates when the DO replayed `recent` on hello).
  // Use full content (not first 64 chars) to avoid collapsing distinct
  // messages with the same prefix; bucket by ts when present so retried
  // sends with identical text don't collapse either.
  const msgKey = (m) => `${m.ts || ''}:${m.role}:${m.content || ''}`;
  const seenKeysRef = useRef(new Set(initialChat.map(msgKey)));
  // Subscribe to the founder's onboarding chat room. profile.user_id is
  // the foreign key to users.id; admins are authorized server-side to
  // view any user's room.
  const wsPath = profile.user_id ? `/api/onboarding/ws/${profile.user_id}` : null;
  const { status: wsStatus } = useWebSocket(wsPath, {
    enabled: !!profile.user_id,
    onMessage: (msg) => {
      if (!msg) return;
      // The DO sends { type:'hello', recent:[...] } on connect, then
      // { type:'chat_message', message:{role,content,ts} } per new turn.
      if (msg.type === 'hello' && Array.isArray(msg.recent)) {
        const fresh = msg.recent.filter(m => {
          const key = msgKey(m);
          if (seenKeysRef.current.has(key)) return false;
          seenKeysRef.current.add(key);
          return true;
        });
        if (fresh.length) setLiveChat(curr => [...curr, ...fresh]);
      } else if (msg.type === 'chat_message' && msg.message) {
        const m = msg.message;
        const key = msgKey(m);
        if (seenKeysRef.current.has(key)) return;
        seenKeysRef.current.add(key);
        setLiveChat(curr => [...curr, m]);
      }
    },
  });
  const chatMessages = liveChat;
  let extracted = {};
  try { extracted = JSON.parse(profile.extracted_data || '{}'); } catch {}

  const [esignFlash, setEsignFlash] = useState(null);
  // D758 — the send was refused (no body in the library, or an unreadable
  // store). The profile's new status stands; the modal stays open on the reason.
  const [esignRefusal, setEsignRefusal] = useState(null);
  const [viaDocusign, setViaDocusign] = useState(false);
  // Real availability check — DocuSign is a Studio-tier provider AND
  // requires an active connected integration on the calling admin's
  // account. We hit `/api/integrations` once on mount and look for a
  // `provider_key === 'docusign'` row with `status === 'active'`. The
  // backend `/esign/send` is the source of truth (Studio 402 + 412
  // when not connected) — this UI gate just prevents the admin from
  // selecting a doomed option.
  const [docusignAvailable, setDocusignAvailable] = useState(false);
  const [docusignReason, setDocusignReason] = useState('checking');
  useEffect(() => {
    let alive = true;
    api.integrationsList()
      .then((rows) => {
        if (!alive) return;
        const list = Array.isArray(rows) ? rows : (rows?.integrations || rows?.items || []);
        const ds = list.find((r) => (r.provider_key || r.provider) === 'docusign' && r.status === 'active');
        setDocusignAvailable(!!ds);
        setDocusignReason(ds ? 'ok' : 'not_connected');
      })
      .catch(() => { if (alive) { setDocusignAvailable(false); setDocusignReason('error'); } });
    return () => { alive = false; };
  }, []);
  // If DocuSign is unavailable, force the toggle off so we never POST
  // provider='docusign' against a backend that will 412.
  useEffect(() => {
    if (!docusignAvailable && viaDocusign) setViaDocusign(false);
  }, [docusignAvailable, viaDocusign]);
  const submit = async (status) => {
    setSaving(true);
    setError('');
    setEsignRefusal(null);
    try {
      const res = await api.adminVerifyProfile(profile.email, {
        agreement_type: agreement,
        admin_notes: notes,
        status,
        provider: viaDocusign && docusignAvailable ? 'docusign' : 'native',
      });
      if (res?.esign_refusal) {
        setEsignRefusal(res.esign_refusal);
      } else if (res?.esign?.envelope_id) {
        setEsignFlash({
          envelopeId: res.esign.envelope_id,
          emailSent: !!res.esign.email_sent,
          signingUrl: res.esign.signing_url,
          provider: res.esign.provider || 'native',
        });
        setTimeout(() => onSaved(), 2200);
      } else {
        onSaved();
      }
    } catch (e) { setError(e.message); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between dark:border-gray-800">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{profile.user_name || profile.email}</h3>
            <p className="text-xs text-gray-500">{profile.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Persona (AI extracted)</div>
              <div className="text-gray-900 font-medium dark:text-gray-100">{profile.persona || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Entity Type</div>
              <div className="text-gray-900 font-medium dark:text-gray-100">{profile.entity_type || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Legal Entity Name</div>
              <div className="text-gray-900 font-medium dark:text-gray-100">{profile.legal_entity_name || '—'}</div>
            </div>
            {/* D634 — the tax ID leaves the server masked; Show is logged. */}
            <div className="-my-1.5">
              <SensitiveField
                label="EIN / Tax ID"
                masked={profile.masked?.ein ?? null}
                nrReason={SENSITIVE.nrEin}
                onShow={() => api.adminShowProfileField(profile.email, 'ein')}
              />
              <SensitiveLine />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Signatory</div>
              <div className="text-gray-900 font-medium dark:text-gray-100">{profile.signatory_name || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Title</div>
              <div className="text-gray-900 font-medium dark:text-gray-100">{profile.signatory_title || '—'}</div>
            </div>
          </div>

          {profile.persona === 'Founder' && (
            <div className={`rounded-lg p-3 border ${
              profile.founder_track === 'Strategic Scale (Existing)' ? 'bg-indigo-50 border-indigo-300'
              : profile.founder_track === 'Spin-Out (New)' ? 'bg-blue-50 border-blue-300'
              : 'bg-gray-50 border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Founder Track</div>
                {profile.founder_track && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${TRACK_BADGES[profile.founder_track] || 'bg-gray-100 text-gray-600'}`}>
                    {profile.founder_track}
                  </span>
                )}
              </div>

              {profile.founder_track === 'Strategic Scale (Existing)' ? (
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-gray-500">Current Stage</div>
                    <div className="text-gray-900 font-medium dark:text-gray-100">{profile.current_stage || '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Partnership Goal</div>
                    <div className="text-gray-900 font-medium dark:text-gray-100">{profile.partnership_goal || '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Existing Jurisdiction</div>
                    <div className="text-gray-900 font-medium dark:text-gray-100">{profile.existing_jurisdiction || '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Product Strategy</div>
                    <div className="text-gray-900 font-medium dark:text-gray-100">{profile.product_strategy || '—'}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-gray-500">Existing Investors / Cap Table</div>
                    <div className="text-gray-900 font-medium dark:text-gray-100">{profile.existing_investors || '—'}</div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className={`text-sm font-medium ${
                    profile.company_established === 0 ? 'text-amber-800'
                    : profile.company_established === 1 ? 'text-emerald-800'
                    : 'text-gray-600'
                  }`}>
                    {profile.company_established === 1
                      ? 'Company already incorporated'
                      : profile.company_established === 0
                      ? 'Not yet incorporated — Axal VC will handle formation'
                      : 'Formation status not answered'}
                  </div>
                  {profile.existing_jurisdiction && (
                    <div className="text-xs text-gray-600 mt-1">Preferred jurisdiction: <span className="font-medium text-gray-900 dark:text-gray-100">{profile.existing_jurisdiction}</span></div>
                  )}
                  {profile.company_established === 0 && (
                    <p className="text-xs text-amber-700 mt-2">This founder has not yet incorporated. The Axal VC 28-Day Spin-Out Engine will handle formation as part of their Closing Binder.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {extracted.summary && (
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
              <div className="text-xs text-violet-700 font-semibold mb-1">AI Summary</div>
              <div className="text-sm text-violet-900">{extracted.summary}</div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare size={14} className="text-gray-600" />
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Onboarding Conversation</h4>
              {profile.user_id && (
                <span className={`ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  wsStatus === 'open' ? 'bg-emerald-100 text-emerald-700'
                  : wsStatus === 'connecting' ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'open' ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
                  {wsStatus === 'open' ? 'live' : wsStatus === 'connecting' ? 'connecting' : 'offline'}
                </span>
              )}
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-64 overflow-y-auto space-y-2 dark:border-gray-800">
              {chatMessages.length === 0 ? (
                <div className="text-xs text-gray-500">No transcript available.</div>
              ) : chatMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] text-xs px-3 py-2 rounded-lg whitespace-pre-wrap ${
                    m.role === 'user' ? 'bg-violet-600 text-white' : 'bg-white border border-gray-200 text-gray-800'
                  }`}>{m.content}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4 space-y-3 dark:border-gray-800">
            <div>
              <label className="text-xs text-gray-700 font-medium block mb-1 dark:text-gray-300">Propose Closing Binder / Agreement</label>
              <div className="relative">
                <select value={agreement} onChange={(e) => setAgreement(e.target.value)}
                  className="w-full appearance-none bg-white border border-gray-300 rounded-lg px-3 pr-9 py-2 text-sm text-gray-900 shadow-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition cursor-pointer dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100">
                  {AGREEMENT_OPTIONS.map((opt, i) => (
                    opt.group ? (
                      <optgroup key={opt.group} label={opt.group}>
                        {opt.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </optgroup>
                    ) : (
                      <option key={opt.value || `placeholder-${i}`} value={opt.value}>{opt.label}</option>
                    )
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-700 font-medium block mb-1 dark:text-gray-300">Admin Notes (internal)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="Any context for the legal engine or follow-up..."
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none resize-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100" />
            </div>
            {/* Task #2 — DocuSign provider picker. Renders for Studio-tier
                admins (or impersonating super-admins) when an active
                DocuSign integration is connected; on non-Studio plans we
                show an upsell row instead. */}
            {docusignAvailable ? (
              <label className="flex items-start gap-2 text-xs text-gray-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 cursor-pointer dark:text-gray-300">
                <input type="checkbox" checked={viaDocusign} onChange={(e) => setViaDocusign(e.target.checked)}
                  className="mt-0.5 accent-amber-600" />
                <span>
                  <span className="font-semibold text-amber-900">Send via DocuSign</span>
                  <span className="block text-amber-800 mt-0.5">
                    Routes the envelope through the connected DocuSign account. The signer receives the agreement directly from DocuSign; signed PDFs are pulled back into Axal VC automatically.
                  </span>
                </span>
              </label>
            ) : (
              <div className="flex items-start gap-2 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-600 dark:border-gray-800">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Send via DocuSign</span>
                <span className="ml-auto text-gray-500">
                  {docusignReason === 'checking' ? 'Checking…'
                    : docusignReason === 'not_connected' ? <>Not connected — <a href="/account/connectors/docusign" className="underline">connect DocuSign</a></>
                    : 'Unavailable'}
                </span>
              </div>
            )}
            {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            {esignRefusal && (
              <div role="alert" className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2.5 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
                <div className="font-semibold">The profile was saved; the agreement was not sent.</div>
                <div className="mt-1">{esignRefusal.message}</div>
              </div>
            )}
            {esignFlash && (
              <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 space-y-1">
                <div className="font-semibold text-emerald-800 flex items-center gap-1.5">
                  <Check size={12} />
                  {esignFlash.provider === 'docusign'
                    ? <>DocuSign envelope sent (#{esignFlash.envelopeId})</>
                    : <>eSignature envelope #{esignFlash.envelopeId} created</>}
                </div>
                <div className="text-emerald-700">
                  {esignFlash.provider === 'docusign'
                    ? <>DocuSign emailed the agreement directly to <span className="font-mono">{profile.email}</span>. Status updates flow back into Axal VC automatically.</>
                    : esignFlash.emailSent
                      ? <>Email sent from <span className="font-mono">deal@axal.vc</span> to <span className="font-mono">{profile.email}</span>.</>
                      : <>Envelope created — email delivery did not confirm. Share this link manually:</>}
                </div>
                {esignFlash.provider !== 'docusign' && !esignFlash.emailSent && esignFlash.signingUrl && (
                  <a href={esignFlash.signingUrl} target="_blank" rel="noreferrer" className="text-violet-700 underline break-all">
                    {esignFlash.signingUrl}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-2 dark:border-gray-800">
          <button onClick={() => submit('rejected')} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-50 transition-colors">
            Reject
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors dark:text-gray-300">Cancel</button>
            <button onClick={() => submit('verified')} disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1.5">
              <Check size={14} /> {saving ? 'Saving...' : 'Verify & Assign Agreement'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
