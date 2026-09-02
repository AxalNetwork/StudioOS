/**
 * Refer & Earn — `/referrals`
 *
 * Canvas-aligned surface (Refer___Earn.dc): page body only — production
 * `SidebarNav` stays in App shell. Data from `/api/refer-earn/*` and
 * `/api/email/*`; no canvas `.side` nav.
 *
 * The old page was organised around a Stripe Connect balance; that model is
 * gone — rewards are milestone labels settled off-platform.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check, Copy, Loader2, Upload, X,
} from 'lucide-react';

import { api } from '../lib/api';
import { parseLinkedInCsv, PENDING_LINKEDIN_IMPORT_KEY } from '../lib/linkedinCsv';
import { useToast } from '../components/useToast';
import './referrals/referrals.css';

function LinkedinIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-.95 1.83-1.95 3.77-1.95 4.03 0 4.78 2.5 4.78 5.76V21h-4v-5.6c0-1.34-.03-3.06-1.9-3.06-1.9 0-2.2 1.45-2.2 2.96V21H9z" />
    </svg>
  );
}

const STATUS_TONE = {
  draft: 'grey',
  submitted: 'grey',
  under_review: 'amber',
  more_info_needed: 'amber',
  qualified: 'purple',
  in_conversation: 'purple',
  converted: 'green',
  reward_eligible: 'green',
  reward_issued: 'green',
  rejected: 'red',
  closed: 'grey',
};

const CHIP = {
  green: 'inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold bg-green-50 text-green-700',
  amber: 'inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold bg-amber-50 text-amber-700',
  grey: 'inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold bg-gray-100 text-gray-600',
  purple: 'inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold bg-violet-50 text-violet-700',
  red: 'inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold bg-red-50 text-red-700',
};

const PRIORITY_CHIP = {
  'Highest priority': CHIP.green,
  Standard: CHIP.grey,
  Selective: CHIP.amber,
};

const REWARD_MATRIX = [
  { cat: 'Startup / founder', model: 'Milestone-based', modelTone: 'green', note: 'Paid on cohort acceptance and completed formation.' },
  { cat: 'Platform user', model: 'Platform credit', modelTone: 'grey', note: 'Issued once matched and onboarded with a founder.' },
  { cat: 'Strategic & capital', model: 'Invite-only / custom', modelTone: 'amber', note: 'Terms negotiated directly, not published — case by case.' },
];

const FAQS = [
  { q: 'Who is eligible to submit a referral?', a: 'Anyone already connected to Axal VC — founders in a cohort or graduated, advisors, investors, operators, and service partners.' },
  { q: 'When are rewards actually paid?', a: 'Only after a qualifying outcome — acceptance and formation for startup referrals, onboarding for advisors and partners, a paying customer for platform users. Never on submission alone.' },
  { q: 'Can I refer myself or my own company?', a: 'No. Self-referrals aren’t eligible under this program — apply directly instead.' },
  { q: 'Is every referral accepted?', a: 'No — most are not, and that’s intentional. Review is against a real quality bar, not a quota.' },
  { q: 'Is this program open to everyone, or invite-only?', a: 'Startup, advisor, platform user, and service partner referrals are open. Strategic and capital introductions run on invite-only terms.' },
  { q: 'What if my referral needs more information?', a: 'It moves to "More info needed" in your pipeline with a note on what’s missing — you can update it from the detail view.' },
];

const PIPELINE_FILTERS = ['All', 'under_review', 'in_conversation', 'reward_issued', 'rejected'];

const WARM_OPTIONS = [
  'Yes — they know I’m referring them',
  'No — cold introduction',
  'Not sure yet',
];

function StatusChip({ status, label }) {
  const tone = STATUS_TONE[status] || 'grey';
  return <span className={CHIP[tone] || CHIP.grey}>{label || status}</span>;
}

function rewardColor(status) {
  if (status === 'reward_issued') return '#15803d';
  if (status === 'rejected') return '#b91c1c';
  if (['qualified', 'in_conversation', 'converted', 'reward_eligible'].includes(status)) return '#b45309';
  return '#8b8798';
}

function formatShortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
}

function sharePlatforms(link) {
  const shareUrl = link || 'https://axal.vc/referrals';
  const enc = encodeURIComponent;
  const msgLinkedin = `Referring the right person is worth more than a hundred cold applications.\n\nAxal VC’s Refer & Earn program rewards founders, advisors, and operators who bring high-quality people into the network — real rewards for a real fit, every submission reviewed individually.\n\nIf you know a founder who should be building inside a structured 28-day formation program, an advisor with real operating depth, or a strategic introduction worth making — this is where it goes: ${shareUrl}`;
  const msgX = `Know a founder who should be building inside Axal VC’s Spin-Out Lab? Refer them. Reviewed individually, rewarded on real outcomes — not a referral-spam program. ${shareUrl}`;
  const msgWhatsapp = `Hey — Axal VC has a referral program where you get rewarded for introducing strong founders, advisors, or partners into their network. Thought of you for this: ${shareUrl}`;
  const msgTelegram = `Axal VC’s Refer & Earn: refer founders, advisors, or strategic intros into their network and earn when there’s a real fit. Reviewed individually, not a numbers game. ${shareUrl}`;

  return [
    {
      key: 'linkedin', label: 'LinkedIn', preview: msgLinkedin.slice(0, 72) + '…', iconBg: '#0A66C2',
      go: () => window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${enc(shareUrl)}`, '_blank'),
      icon: <LinkedinIcon size={16} />,
    },
    {
      key: 'x', label: 'X / Twitter', preview: msgX.slice(0, 72) + '…', iconBg: '#000000',
      go: () => window.open(`https://twitter.com/intent/tweet?text=${enc(msgX)}`, '_blank'),
      icon: <span className="text-sm font-bold">𝕏</span>,
    },
    {
      key: 'whatsapp', label: 'WhatsApp', preview: msgWhatsapp.slice(0, 72) + '…', iconBg: '#25D366',
      go: () => window.open(`https://wa.me/?text=${enc(msgWhatsapp)}`, '_blank'),
      icon: <span className="text-xs">WA</span>,
    },
    {
      key: 'telegram', label: 'Telegram', preview: msgTelegram.slice(0, 72) + '…', iconBg: '#26A5E4',
      go: () => window.open(`https://t.me/share/url?url=${enc(shareUrl)}&text=${enc(msgTelegram)}`, '_blank'),
      icon: <span className="text-xs">TG</span>,
    },
  ];
}

function inviteLink(code, email) {
  if (!code) return '—';
  const base = `https://axal.vc/register?ref=${encodeURIComponent(code)}`;
  return email ? `${base}&invitee=${encodeURIComponent(email)}` : base;
}

function inviteStatus(row) {
  if (row.signed_up_user_id || row.status === 'joined') return { label: 'Registered', tone: 'green' };
  if (row.status === 'sent' || row.status === 'opened') return { label: 'Invited', tone: 'purple' };
  if (row.status === 'failed') return { label: 'Failed', tone: 'red' };
  return { label: 'Not sent', tone: 'grey' };
}

export default function ReferralsPage({ embedded = false }) {
  const { showToast } = useToast();
  const policyRef = useRef(null);
  const csvInputRef = useRef(null);
  const qrCanvasRef = useRef(null);

  const [overview, setOverview] = useState(null);
  const [rows, setRows] = useState([]);
  const [invites, setInvites] = useState([]);
  const [pendingContacts, setPendingContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [statusFilter, setStatusFilter] = useState('All');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [partnerNote, setPartnerNote] = useState('');
  const [detail, setDetail] = useState(null);
  const [faqOpen, setFaqOpen] = useState(-1);
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareToast, setShareToast] = useState('');
  const [sendingInvite, setSendingInvite] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [ov, list, inv] = await Promise.all([
        api.referralOverview(),
        api.referralSubmissions(),
        api.emailInvites().catch(() => ({ invites: [] })),
      ]);
      setOverview(ov);
      setRows(Array.isArray(list) ? list : []);
      setInvites(Array.isArray(inv?.invites) ? inv.invites : []);
    } catch (e) {
      setLoadError(e?.message || 'Could not load your referrals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PENDING_LINKEDIN_IMPORT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed?.rows?.length) return;
      if (parsed.at && Date.now() - parsed.at > 10 * 60 * 1000) {
        localStorage.removeItem(PENDING_LINKEDIN_IMPORT_KEY);
        return;
      }
      setPendingContacts(parsed.rows);
      localStorage.removeItem(PENDING_LINKEDIN_IMPORT_KEY);
      showToast(`${parsed.rows.length} contacts imported from LinkedIn — review and send invites below.`, 'success');
    } catch { /* ignore */ }
  }, [showToast]);

  useEffect(() => {
    const link = overview?.referral_link;
    if (!link || !qrCanvasRef.current) return;
    QRCode.toCanvas(qrCanvasRef.current, link, { width: 172, margin: 1 }, () => {});
  }, [overview?.referral_link]);

  const statusLabels = overview?.status_labels || {};
  const filtered = useMemo(() => {
    if (statusFilter === 'All') return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const byStatus = overview?.counts?.by_status || {};
  const summary = useMemo(() => {
    const qualifiedKeys = ['qualified', 'in_conversation', 'converted', 'reward_eligible', 'reward_issued'];
    const qualified = qualifiedKeys.reduce((n, k) => n + (byStatus[k] || 0), 0);
    const underReview = (byStatus.under_review || 0) + (byStatus.more_info_needed || 0);
    const catCounts = {};
    for (const r of rows) catCounts[r.category] = (catCounts[r.category] || 0) + 1;
    const top = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
    const topLabel = !top ? '—' : top[0] === 'startup' ? 'Startup' : top[0] === 'customer' ? 'Platform user' : 'Strategic';
    const rewardIssued = overview?.counts?.reward_issued ?? 0;
    const dollarRow = rows.find((r) => r.status === 'reward_issued' && /\$/.test(r.reward_label || ''));
    return [
      { k: 'Referrals submitted', v: String(overview?.counts?.total ?? 0), tone: '#18181b' },
      { k: 'Qualified', v: String(qualified), tone: '#6d28d9' },
      { k: 'Under review', v: String(underReview), tone: '#b45309' },
      { k: 'Rewards earned', v: dollarRow?.reward_label?.match(/\$[\d,]+/)?.[0] || String(rewardIssued), tone: '#15803d' },
      { k: 'Avg. review time', v: '5 days', tone: '#18181b' },
      { k: 'Top category', v: topLabel, tone: '#18181b' },
    ];
  }, [byStatus, overview, rows]);

  const contactRows = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of pendingContacts) {
      const email = (p.email || '').toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({ key: `p-${email}`, name: p.name || '—', email: p.email, pending: true });
    }
    for (const inv of invites) {
      const email = (inv.recipient_email || '').toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({
        key: `i-${inv.id}`,
        id: inv.id,
        name: inv.recipient_name || '—',
        email: inv.recipient_email,
        invite: inv,
        pending: false,
      });
    }
    return out;
  }, [invites, pendingContacts]);

  const sentInviteCount = contactRows.filter((c) => {
    if (c.pending) return false;
    const st = inviteStatus(c.invite);
    return st.label !== 'Not sent';
  }).length;

  const copyLink = async () => {
    const link = overview?.referral_link;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast('Could not copy — select the link and copy manually.', 'error');
    }
  };

  const copyShareLink = async () => {
    const link = overview?.referral_link || 'https://axal.vc/referrals';
    try {
      await navigator.clipboard.writeText(link);
      setShareCopied(true);
    } catch {
      showToast('Could not copy link.', 'error');
    }
  };

  const downloadQr = async () => {
    const link = overview?.referral_link;
    if (!link) return;
    try {
      const dataUrl = await QRCode.toDataURL(link, { width: 400, margin: 2 });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `referral-${overview.referral_code || 'code'}.png`;
      a.click();
      setShareToast(`QR downloaded as referral-${overview.referral_code || 'code'}.png`);
      setTimeout(() => setShareToast(''), 2400);
    } catch {
      showToast('Could not generate QR image.', 'error');
    }
  };

  const openDetail = async (uid) => {
    try {
      setDetail({ loading: true });
      const full = await api.referralSubmission(uid);
      setDetail(full);
    } catch (e) {
      setDetail(null);
      showToast(e?.message || 'Could not open that referral.', 'error');
    }
  };

  const onCsvUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('File too large (max 2 MB).', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseLinkedInCsv(String(reader.result || ''));
      if (!parsed.length) {
        showToast('No contacts found — CSV needs an email column.', 'warning');
        return;
      }
      setPendingContacts(parsed);
      showToast(`${parsed.length} contacts ready to invite.`, 'success');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const sendContactInvite = async (contact) => {
    setSendingInvite(contact.key);
    try {
      if (contact.id && !contact.pending) {
        await api.emailRemindInvite(contact.id);
        showToast('Reminder sent.', 'success');
      } else {
        const r = await api.emailSendReferralInvites([{ email: contact.email, name: contact.name === '—' ? '' : contact.name }]);
        if (r.sent > 0) {
          showToast('Invite sent.', 'success');
          setPendingContacts((prev) => prev.filter((p) => p.email !== contact.email));
        } else {
          const reason = r.failed?.[0]?.reason || 'Could not send invite.';
          showToast(reason, 'warning');
        }
      }
      const inv = await api.emailInvites().catch(() => ({ invites: [] }));
      setInvites(Array.isArray(inv?.invites) ? inv.invites : []);
    } catch (err) {
      showToast(err?.message || 'Could not send invite.', 'error');
    } finally {
      setSendingInvite(null);
    }
  };

  const importLinkedin = async () => {
    try {
      const st = await api.linkedinStatus();
      if (!st?.connected) {
        const start = await api.linkedinOAuthStart({ return_to: '/referrals' });
        if (start?.url) window.location.href = start.url;
        else showToast('LinkedIn is not configured.', 'warning');
        return;
      }
      showToast('Upload Connections.csv using Upload CSV — or import from Settings → Integrations.', 'info');
    } catch (e) {
      showToast(e?.message || 'Could not start LinkedIn import.', 'error');
    }
  };

  const submitPartner = async () => {
    try {
      await api.referralStrategicAccess({ note: partnerNote });
      setOverview((o) => ({ ...o, strategic_access: 'requested' }));
      setPartnerOpen(false);
      setPartnerNote('');
      showToast('Partner program request submitted — we’ll follow up directly.', 'success');
    } catch (e) {
      showToast(e?.message || 'Could not submit request.', 'error');
    }
  };

  const scrollToPolicy = () => {
    policyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const stop = (e) => e.stopPropagation();

  return (
    <div className={`rf-page ${embedded ? 'space-y-6' : ''}`} data-testid="referrals-page">
      {!embedded && (
        <div className="rf-header">
          <div className="rf-header-inner">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-xl font-extrabold tracking-tight">Refer &amp; Earn</h1>
                  <span className={CHIP.green}>Selective · Open</span>
                </div>
                <p className="mt-1.5 max-w-xl text-[13px] leading-snug text-[#4a4553]">
                  Submit and track referrals into the Axal VC network — founders, advisors, service partners, and strategic introductions. Reviewed individually against a real quality bar.
                </p>
              </div>
              <div className="flex flex-none flex-wrap gap-2">
                <button type="button" className="rf-btn rounded-lg border border-[#ececf1] px-3.5 py-2 text-xs font-semibold text-zinc-500" onClick={scrollToPolicy}>
                  View policy
                </button>
                <button type="button" className="rf-btn rounded-lg border border-[#ececf1] px-3.5 py-2 text-xs font-semibold text-zinc-500" onClick={() => setShareOpen(true)}>
                  Share
                </button>
                <button type="button" className="rf-btn rounded-lg bg-violet-700 px-4 py-2 text-[13px] font-bold text-white" onClick={() => setSubmitOpen(true)}>
                  Submit referral
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={embedded ? 'space-y-6' : 'rf-body'}>
        {loadError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {loadError}
            <button type="button" onClick={load} className="ml-2 font-semibold underline">Retry</button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-zinc-500">
            <Loader2 size={16} className="animate-spin" /> Loading your referrals…
          </div>
        ) : (
          <>
            <div className="rf-stat-grid">
              {summary.map((s) => (
                <div key={s.k} className="rf-stat-cell">
                  <div className="rf-mono text-[19px] font-extrabold tracking-tight" style={{ color: s.tone }}>{s.v}</div>
                  <div className="rf-lbl mt-1 text-[9.5px]">{s.k}</div>
                </div>
              ))}
            </div>

            <div className="mt-8">
              <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
                <div className="rf-lbl">Referral categories</div>
                <div className="text-[11.5px] text-[#8b8798]">Not every category carries equal weight or the same reward model</div>
              </div>
              <div className="rf-cat-grid">
                {(overview?.categories || []).map((cat) => (
                  <div key={cat.key} className="rounded-[13px] border border-[#ececf1] bg-white p-4 dark:bg-gray-900">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[13.5px] font-extrabold tracking-tight">{cat.name}</div>
                      <span className={cat.locked ? CHIP.purple : CHIP.grey}>{cat.access}</span>
                    </div>
                    <div className="mt-2">
                      <span className={PRIORITY_CHIP[cat.priority] || CHIP.grey}>{cat.priority}</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-[#4a4553]">{cat.qualifies}</p>
                    <p className="mt-2 border-t border-[#f4f3f7] pt-2 text-[11px] text-[#8b8798]">Reward: {cat.reward}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rf-share-grid mt-8">
              <div className="rf-card p-5 sm:p-6">
                <h2 className="text-sm font-extrabold tracking-tight">Your referral link</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[11px] border border-[#ececf1] bg-[#faf9fc] p-2 pl-3.5">
                  <div className="rf-mono min-w-0 flex-1 break-all text-[12.5px] text-violet-700">
                    {overview?.referral_link || '—'}
                  </div>
                  <button
                    type="button"
                    onClick={copyLink}
                    className={`rf-btn inline-flex flex-none items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold ${copied ? 'bg-green-50 text-green-700' : 'bg-violet-700 text-white'}`}
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="rf-lbl mb-1.5 mt-4 text-[9.5px]">Referral code</div>
                <div className="rounded-[11px] border border-[#e6e0f7] bg-gradient-to-b from-[#f8f6fe] to-[#f4f2fb] px-4 py-4 text-center">
                  <div className="rf-mono text-[26px] font-bold tracking-widest text-violet-700">{overview?.referral_code || '—'}</div>
                  {overview?.legacy_referral_code && (
                    <p className="mt-1.5 text-[11.5px] text-[#8b8798]">
                      Previous code also works: <span className="rf-mono">{overview.legacy_referral_code}</span>
                    </p>
                  )}
                </div>
                <p className="mt-4 border-t border-[#f4f3f7] pt-4 text-[11.5px] leading-relaxed text-[#8b8798]">
                  Anyone who registers with your code is attributed to you. Rewards accrue when they reach a qualified milestone — acceptance, onboarding, or close — never on signup alone.
                </p>
                {shareToast && (
                  <div className="mt-2.5 rounded-lg bg-green-50 px-3 py-2 text-[11.5px] font-semibold text-green-700">{shareToast}</div>
                )}
              </div>

              <div className="rf-card p-5 text-center sm:p-6">
                <h2 className="text-sm font-extrabold tracking-tight">QR code</h2>
                <div className="mt-4 flex justify-center">
                  <canvas ref={qrCanvasRef} className="rounded-[11px] border border-[#ececf1] bg-white p-2 dark:bg-white" aria-label="Referral QR code" />
                </div>
                <p className="mt-3.5 text-[11.5px] leading-snug text-[#8b8798]">
                  Scan to open registration with <span className="rf-mono text-violet-700">{overview?.referral_code || '—'}</span> pre-filled.
                </p>
                <button type="button" className="rf-btn mt-3 w-full rounded-lg border border-[#ececf1] py-2 text-[11.5px] font-bold text-zinc-700" onClick={downloadQr}>
                  Download PNG
                </button>
              </div>
            </div>

            <div className="rf-card mt-3.5 overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:px-6">
                <div className="min-w-0">
                  <h2 className="text-sm font-extrabold tracking-tight">Import contacts</h2>
                  <p className="mt-1 text-[12.5px] leading-snug text-[#4a4553]">
                    Upload a CSV with <span className="rf-mono rounded bg-[#f4f3f7] px-1 text-[11.5px]">name,email</span> columns to generate a personalised invite link per contact.
                  </p>
                </div>
                <div className="flex flex-none flex-wrap gap-2">
                  <button type="button" className="rf-btn inline-flex items-center gap-1.5 rounded-lg bg-[#0a66c2] px-4 py-2 text-[12.5px] font-bold text-white" onClick={importLinkedin}>
                    <LinkedinIcon size={14} /> Import from LinkedIn
                  </button>
                  <button type="button" className="rf-btn inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-4 py-2 text-[12.5px] font-bold text-white" onClick={() => csvInputRef.current?.click()}>
                    <Upload size={14} /> Upload CSV
                  </button>
                  <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onCsvUpload} />
                </div>
              </div>

              {contactRows.length === 0 ? (
                <div className="border-t border-[#f4f3f7] px-6 py-8 text-center">
                  <p className="text-[12.5px] leading-relaxed text-[#8b8798]">
                    No contacts imported yet. Your CSV needs a header row with at least <span className="rf-mono rounded bg-[#f4f3f7] px-1 text-[11.5px]">email</span> — <span className="rf-mono rounded bg-[#f4f3f7] px-1 text-[11.5px]">name</span> is optional but personalises the invite.
                  </p>
                </div>
              ) : (
                <div className="border-t border-[#f4f3f7]">
                  <div className="rf-hide-sm rf-table-head rf-contacts-head">
                    {['Name', 'Email', 'Status', 'Invite link', ''].map((h) => (
                      <div key={h || 'action'} className="rf-lbl px-3 py-2 text-[9.5px] first:pl-6 last:pr-6">{h}</div>
                    ))}
                  </div>
                  {contactRows.map((ct) => {
                    const st = ct.invite ? inviteStatus(ct.invite) : { label: 'Not sent', tone: 'grey' };
                    const link = inviteLink(overview?.referral_code, ct.email);
                    const isRegistered = st.label === 'Registered';
                    const isInvited = st.label === 'Invited';
                    return (
                      <div key={ct.key} className="rf-row rf-table-row rf-contacts-row">
                        <div className="px-3 py-3 pl-6 text-[12.5px] font-bold">{ct.name}</div>
                        <div className="break-all px-3 py-3 text-xs text-[#4a4553]">{ct.email}</div>
                        <div className="px-3 py-3"><span className={CHIP[st.tone]}>{st.label}</span></div>
                        <div className="rf-mono break-all px-3 py-3 text-[11px] text-[#8b8798]">{link.replace('https://', '')}</div>
                        <div className="px-3 py-3 pr-6">
                          <button
                            type="button"
                            disabled={isRegistered || sendingInvite === ct.key}
                            onClick={() => sendContactInvite(ct)}
                            className={`rf-btn whitespace-nowrap rounded-lg px-3 py-1.5 text-[11.5px] font-semibold ${isRegistered || isInvited ? 'border border-[#ececf1] bg-white text-zinc-700' : 'bg-violet-700 text-white'}`}
                          >
                            {sendingInvite === ct.key ? '…' : isRegistered ? 'View' : isInvited ? 'Resend' : 'Send invite'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="px-6 py-3 text-[11.5px] text-[#8b8798]">
                    {sentInviteCount} of {contactRows.length} contacts invited. Each link is unique, so registrations attribute to the exact contact — not just to your code.
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8">
              <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
                <div className="rf-lbl">Your referrals</div>
                <div className="flex flex-wrap gap-1.5">
                  {PIPELINE_FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setStatusFilter(f)}
                      className={`rf-seg rounded-lg border px-3 py-1.5 text-[11.5px] font-semibold ${statusFilter === f ? 'border-violet-700 bg-violet-50 text-violet-700' : 'border-[#ececf1] bg-white text-zinc-500'}`}
                    >
                      {f === 'All' ? 'All' : (statusLabels[f] || f)}
                    </button>
                  ))}
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-[#d4d0dc] bg-white px-6 py-11 text-center dark:bg-gray-900">
                  <p className="text-sm font-bold text-[#3f3b47]">No referrals yet</p>
                  <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-[#8b8798]">
                    Submit your first referral to start tracking it here — review status, fit notes, and reward eligibility all live on this page.
                  </p>
                  <button type="button" className="rf-btn mt-4 inline-block rounded-lg bg-violet-700 px-4 py-2.5 text-[12.5px] font-bold text-white" onClick={() => setSubmitOpen(true)}>
                    Submit your first referral
                  </button>
                </div>
              ) : (
                <div className="rf-card overflow-hidden">
                  <div className="rf-hide-sm rf-pipeline-head">
                    {['Referred', 'Type', 'Submitted', 'Status', 'Reward', 'Next step'].map((h) => (
                      <div key={h} className="rf-lbl px-3 py-2.5 text-[9.5px] first:pl-4 last:pr-4">{h}</div>
                    ))}
                  </div>
                  {filtered.map((r) => (
                    <button
                      key={r.uid}
                      type="button"
                      onClick={() => openDetail(r.uid)}
                      className="rf-row rf-pipeline-row w-full text-left"
                    >
                      <div className="min-w-0 px-4 py-3">
                        <div className="text-[13px] font-bold">{r.referred_name}</div>
                        <div className="text-[11px] text-[#8b8798]">{r.referred_org || '—'}</div>
                      </div>
                      <div className="px-3 py-3 text-xs text-[#4a4553]">{r.category_name?.split('/')[0]?.trim() || r.category_name}</div>
                      <div className="rf-mono px-3 py-3 text-[11.5px] text-[#8b8798]">{formatShortDate(r.created_at)}</div>
                      <div className="px-3 py-3"><StatusChip status={r.status} label={r.status_label} /></div>
                      <div className="px-3 py-3 text-xs" style={{ color: rewardColor(r.status) }}>{r.reward_label || '—'}</div>
                      <div className="px-4 py-3 text-[11.5px] text-zinc-500">{r.next_step || '—'}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rf-card mt-8 p-5 sm:p-6">
              <div className="rf-lbl mb-2">Reward logic</div>
              <p className="max-w-xl text-[13px] leading-relaxed text-[#4a4553]">
                Rewards vary by category and are never issued on submission alone — a qualified outcome (acceptance, close, or onboarding) is required. Some categories run on invite-only terms set case by case.
              </p>
              <div className="mt-4">
                {REWARD_MATRIX.map((rw) => (
                  <div key={rw.cat} className="flex flex-wrap items-center gap-3 border-t border-[#f4f3f7] py-3 first:border-t-0">
                    <div className="min-w-[180px] flex-none text-[12.5px] font-bold">{rw.cat}</div>
                    <span className={CHIP[rw.modelTone]}>{rw.model}</span>
                    <div className="min-w-[200px] flex-1 text-[11.5px] text-[#8b8798]">{rw.note}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-6 rounded-[14px] border border-[#ececf1] bg-[#faf9fc] p-6 sm:p-7">
              <div className="min-w-0 flex-1">
                <div className="rf-lbl mb-2">Referral partner program</div>
                <p className="text-sm font-extrabold tracking-tight">Refer often, with more structure and better terms.</p>
                <p className="mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-[#4a4553]">
                  For recurring referrers — invite-only. Custom reward terms, priority review, and a direct line for strategic and capital introductions.
                </p>
              </div>
              <button
                type="button"
                className="rf-btn flex-none rounded-[10px] border border-[#d4c9f0] bg-white px-5 py-2.5 text-[13px] font-bold text-violet-700 dark:bg-gray-900 dark:text-violet-300"
                onClick={() => setPartnerOpen(true)}
              >
                Become a referral partner
              </button>
            </div>

            <div ref={policyRef} id="policy" className="mt-8">
              <div className="rf-lbl mb-3.5">Policy &amp; FAQ</div>
              <div className="rf-card overflow-hidden">
                {FAQS.map((q, i) => (
                  <div key={q.q} className="rf-faq border-b border-[#f4f3f7] px-5 py-4 last:border-b-0">
                    <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setFaqOpen(faqOpen === i ? -1 : i)}>
                      <span className="text-[13px] font-bold">{q.q}</span>
                      <span className="text-sm text-[#a8a4b4]">{faqOpen === i ? '−' : '+'}</span>
                    </button>
                    {faqOpen === i && (
                      <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-[#4a4553]">{q.a}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {submitOpen && (
        <SubmitDrawer
          categories={(overview?.categories || []).filter((c) => !c.locked)}
          onClose={() => setSubmitOpen(false)}
          onDone={() => { setSubmitOpen(false); load(); }}
        />
      )}

      {detail && (
        <DetailDrawer
          detail={detail}
          onClose={() => setDetail(null)}
          onUpdated={(next) => { setDetail(next); load(); }}
        />
      )}

      {shareOpen && (
        <div className="rf-drawer-backdrop flex items-center justify-center p-6" onClick={() => setShareOpen(false)}>
          <div className="rf-modal-panel" onClick={stop}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-extrabold tracking-tight">Share Refer &amp; Earn</h3>
                <p className="mt-1 text-xs text-[#8b8798]">Each platform gets its own message — tuned to how people actually read it there.</p>
              </div>
              <button type="button" className="rf-btn flex h-7 w-7 items-center justify-center rounded-lg border border-[#ececf1] text-zinc-500" onClick={() => setShareOpen(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {sharePlatforms(overview?.referral_link).map((sp) => (
                <button key={sp.key} type="button" className="rf-btn flex items-center gap-3 rounded-[11px] border border-[#ececf1] p-3 text-left" onClick={sp.go}>
                  <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-white" style={{ background: sp.iconBg }}>{sp.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold">{sp.label}</div>
                    <div className="truncate text-[11px] text-[#8b8798]">{sp.preview}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3.5 flex items-center gap-2 border-t border-[#f4f3f7] pt-3.5">
              <input readOnly value={overview?.referral_link || ''} className="rf-input flex-1 text-xs" />
              <button type="button" className="rf-btn flex-none rounded-lg border border-[#ececf1] px-3.5 py-2 text-xs font-bold text-zinc-700" onClick={copyShareLink}>
                {shareCopied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {partnerOpen && (
        <div className="rf-drawer-backdrop flex items-center justify-center p-6" onClick={() => setPartnerOpen(false)}>
          <div className="rf-modal-panel max-w-[460px]" onClick={stop}>
            <h3 className="text-base font-extrabold tracking-tight">Apply for the referral partner program</h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#4a4553]">
              Invite-only. We review recurring referrers individually and follow up directly with terms if there&apos;s a fit.
            </p>
            <input
              value={partnerNote}
              onChange={(e) => setPartnerNote(e.target.value)}
              placeholder="What kinds of introductions do you expect to make?"
              className="rf-input mt-4"
            />
            <button type="button" className="rf-btn mt-3.5 w-full rounded-lg bg-violet-700 py-2.5 text-[13px] font-bold text-white" onClick={submitPartner}>
              Request review
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SubmitDrawer({ categories, onClose, onDone }) {
  const { showToast } = useToast();
  const [formCat, setFormCat] = useState(categories[0]?.key || 'startup');
  const [warm, setWarm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [importRows, setImportRows] = useState([]);
  const [importCat, setImportCat] = useState('startup');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [f, setF] = useState({ yourRole: '', referName: '', referOrg: '', contact: '', context: '' });

  const setField = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));
  const canSubmit = f.referName.trim() && f.context.trim();

  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) { setImportError('No rows found.'); setImportRows([]); return; }
      const split = (l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      let rows = lines.map(split);
      const header = rows[0].map((h) => h.toLowerCase());
      if (header.includes('name')) rows = rows.slice(1);
      const parsed = rows.filter((r) => r[0]).map((r) => ({ name: r[0] || '', org: r[1] || '', context: r[2] || '' }));
      if (!parsed.length) { setImportError('Expect columns: name, organization, context.'); setImportRows([]); return; }
      setImportRows(parsed);
      setImportError('');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const submitImport = async () => {
    if (!importRows.length) return;
    setImporting(true);
    setImportError('');
    try {
      const csv = ['name,org,context', ...importRows.map((r) => `${r.name},${r.org},${r.context}`)].join('\n');
      const r = await api.referralImport({ category: importCat, csv });
      showToast(`Imported ${r.imported}${r.failed?.length ? ` · ${r.failed.length} skipped` : ''}.`, r.failed?.length ? 'warning' : 'success');
      setImportRows([]);
      onDone();
    } catch (err) {
      setImportError(err?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const submitForm = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const context = warm ? `[Intro: ${warm}]\n${f.context}` : f.context;
      await api.referralSubmit({ ...f, category: formCat, context });
      setSubmitted(true);
    } catch (err) {
      setError(err?.message || 'Could not submit that referral.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const catName = categories.find((c) => c.key === importCat)?.name || importCat;

  return (
    <div className="rf-drawer-backdrop" onClick={onClose}>
      <div className="rf-drawer" onClick={stop}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-extrabold tracking-tight">Submit a referral</h3>
            <p className="mt-1 text-xs text-[#8b8798]">Reviewed individually, typically within 5 business days.</p>
          </div>
          <button type="button" className="rf-btn flex h-7 w-7 items-center justify-center rounded-lg border border-[#ececf1] text-zinc-500" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {!submitted ? (
          <>
            <div className="mt-4 rounded-[11px] border border-dashed border-[#d4d0dc] bg-[#faf9fc] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[12.5px] font-bold">Import a contact list (CSV)</p>
                  <p className="text-[11px] text-[#8b8798]">Columns: name, organization, context</p>
                </div>
                <label className="rf-btn cursor-pointer rounded-lg border border-[#ececf1] bg-white px-3 py-1.5 text-[11.5px] font-bold text-zinc-700 dark:bg-gray-900 dark:text-zinc-200">
                  Choose file
                  <input type="file" accept=".csv,text/csv" className="hidden" onChange={onImportFile} />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10.5px] text-[#8b8798]">Importing as:</span>
                {categories.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setImportCat(c.key)}
                    className={`rf-seg rounded-full border px-2.5 py-1 text-[11px] font-semibold ${importCat === c.key ? 'border-violet-700 bg-violet-50 text-violet-700' : 'border-[#ececf1] bg-white text-[#4a4553]'}`}
                  >
                    {c.name.replace(' referrals', '').replace(' introductions', '')}
                  </button>
                ))}
              </div>
              {importError && <p className="mt-2 text-[11.5px] text-red-700">{importError}</p>}
              {importRows.length > 0 && (
                <>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {importRows.slice(0, 5).map((ir, idx) => (
                      <div key={idx} className="flex items-center gap-2 rounded-lg border border-[#ececf1] bg-white px-2 py-1.5 text-[11.5px] dark:bg-gray-900">
                        <span className="min-w-0 flex-1"><strong>{ir.name}</strong> {ir.org}</span>
                        <span className="text-[#a8a4b4]">{ir.context}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-[#8b8798]">All {importRows.length} contacts will be submitted under <strong>{catName}</strong>.</p>
                  <button type="button" disabled={importing} className="rf-btn mt-2 w-full rounded-lg bg-violet-700 py-2 text-xs font-bold text-white" onClick={submitImport}>
                    {importing ? 'Submitting…' : `Submit all as ${catName}`}
                  </button>
                </>
              )}
            </div>

            <div className="mt-4">
              <div className="rf-lbl mb-2 text-[9.5px]">Referral category</div>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setFormCat(c.key)}
                    className={`rf-seg rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${formCat === c.key ? 'border-violet-700 bg-violet-50 text-violet-700' : 'border-[#ececf1] bg-white text-[#4a4553]'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2.5">
              <input className="rf-input" value={f.yourRole} onChange={setField('yourRole')} placeholder="Your relationship to Axal VC" />
              <input className="rf-input" value={f.referredName} onChange={setField('referName')} placeholder="Who you're referring — name" />
              <input className="rf-input" value={f.referredOrg} onChange={setField('referOrg')} placeholder="Company or affiliation" />
              <input className="rf-input" value={f.contact} onChange={setField('contact')} placeholder="Contact details for follow-up" />
              <textarea className="rf-input resize-y" rows={3} value={f.context} onChange={setField('context')} placeholder="Why is this a fit? Context on the introduction." />
            </div>

            <div className="mt-3.5">
              <div className="rf-lbl mb-2 text-[9.5px]">Intro status</div>
              <div className="flex flex-wrap gap-1.5">
                {WARM_OPTIONS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWarm(w)}
                    className={`rf-seg rounded-full border px-2.5 py-1 text-[11px] font-semibold ${warm === w ? 'border-violet-700 bg-violet-50 text-violet-700' : 'border-[#ececf1] bg-white text-[#4a4553]'}`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

            <button
              type="button"
              disabled={!canSubmit || saving}
              onClick={submitForm}
              className={`rf-btn mt-4 w-full rounded-[10px] py-3 text-center text-[13px] font-extrabold ${canSubmit ? 'bg-violet-700 text-white' : 'cursor-not-allowed bg-[#f1f0f5] text-[#a8a4b4]'}`}
            >
              {saving ? 'Submitting…' : 'Submit referral'}
            </button>
            <p className="mt-3 text-[11.5px] leading-relaxed text-[#8b8798]">
              Most submissions are not accepted — this is by design, and why the ones that are get real attention.
            </p>
          </>
        ) : (
          <div className="py-8 text-center">
            <div className="mx-auto mb-3.5 flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-green-700">
              <Check size={18} />
            </div>
            <p className="text-[15.5px] font-extrabold">Referral received</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#4a4553]">
              It now appears in your pipeline as Submitted. We&apos;ll update the status here as review progresses.
            </p>
            <button type="button" className="rf-btn mt-4 inline-block rounded-lg bg-violet-700 px-4 py-2.5 text-[12.5px] font-bold text-white" onClick={onDone}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailDrawer({ detail, onClose, onUpdated }) {
  const { showToast } = useToast();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (detail.loading) {
    return (
      <div className="rf-drawer-backdrop" onClick={onClose}>
        <div className="rf-drawer rf-drawer-wide" onClick={stop}>
          <div className="flex items-center gap-2 py-8 text-sm text-zinc-500">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        </div>
      </div>
    );
  }

  const canRespond = !['reward_issued', 'rejected', 'closed'].includes(detail.status);
  const history = Array.isArray(detail.history) ? detail.history : [];

  const addContext = async () => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      const next = await api.referralAddContext(detail.uid, { note });
      setNote('');
      showToast('Added.', 'success');
      onUpdated(next);
    } catch (e) {
      showToast(e?.message || 'Could not add that.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rf-drawer-backdrop" onClick={onClose}>
      <div className="rf-drawer rf-drawer-wide" onClick={stop}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-extrabold tracking-tight">{detail.referred_name}</h3>
            <p className="mt-0.5 text-xs text-[#8b8798]">{detail.referred_org || '—'} · {detail.category_name}</p>
          </div>
          <button type="button" className="rf-btn flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-[#ececf1] text-zinc-500" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="mt-3"><StatusChip status={detail.status} label={detail.status_label} /></div>

        {detail.fit_notes && (
          <div className="mt-5 border-t border-[#f4f3f7] pt-4">
            <div className="rf-lbl mb-2 text-[9.5px]">Fit notes</div>
            <p className="text-[12.5px] leading-relaxed text-zinc-700">{detail.fit_notes}</p>
          </div>
        )}

        {history.length > 0 && (
          <div className="mt-4 border-t border-[#f4f3f7] pt-4">
            <div className="rf-lbl mb-2.5 text-[9.5px]">Status history</div>
            {history.map((h, i) => (
              <div key={`${h.created_at}-${i}`} className="flex gap-2.5">
                <div className="flex flex-col items-center">
                  <div className="mt-0.5 h-2 w-2 rounded-full bg-violet-700" />
                  {i < history.length - 1 && <div className="min-h-[18px] w-0.5 flex-1 bg-[#f0eff3]" />}
                </div>
                <div className="pb-3.5">
                  <p className="text-xs font-bold">{h.label}</p>
                  <p className="rf-mono text-[10.5px] text-[#a8a4b4]">{h.created_at}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {detail.reward_label && (
          <div className="mt-4 border-t border-[#f4f3f7] pt-4">
            <div className="rf-lbl mb-2 text-[9.5px]">Reward eligibility</div>
            <p className="text-[12.5px] font-semibold" style={{ color: rewardColor(detail.status) }}>{detail.reward_label}</p>
          </div>
        )}

        {detail.next_step && (
          <div className="mt-4 border-t border-[#f4f3f7] pt-4">
            <div className="rf-lbl mb-2 text-[9.5px]">Next step</div>
            <p className="text-[12.5px] text-zinc-700">{detail.next_step}</p>
          </div>
        )}

        {canRespond && (
          <div className="mt-4 border-t border-[#f4f3f7] pt-4">
            <label className="rf-lbl text-[9.5px]">
              {detail.status === 'more_info_needed' ? 'Add the missing detail' : 'Add more context'}
            </label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="rf-input mt-2" placeholder="Anything that helps review make a decision." />
            <div className="mt-2 flex justify-end">
              <button type="button" disabled={saving || !note.trim()} className="rf-btn rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={addContext}>
                {saving ? 'Saving…' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function stop(e) {
  e.stopPropagation();
}
