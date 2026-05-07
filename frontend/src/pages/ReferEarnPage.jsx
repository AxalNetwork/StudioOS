import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Copy, Check, Users, DollarSign, Share2, ExternalLink, Network as NetworkIcon,
  MessageCircle, Mail, Upload, Edit3, X, AlertCircle, Save,
  Send, Loader2, ShieldCheck, Info, FileDown,
} from 'lucide-react';

// lucide-react v1 dropped brand icons; reuse the inline LinkedinSvg below.
const LinkedinIcon = (props) => <LinkedinSvg {...props} />;

import QRCode from 'qrcode';
import { api } from '../lib/api';

const Twitter = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);
const LinkedinSvg = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);

const TEMPLATE_STORAGE_KEY = 'axal:invite_templates_v1';

// Public Axal channels referenced in default share copy. Editing the templates
// in the UI overrides these — the constants are only used to build defaults.
const AXAL_TELEGRAM_URL = 'https://t.me/axalvc';
const AXAL_LINKEDIN_URL = 'https://www.linkedin.com/company/axalvc';

// House style: always use the @axalvc handle and the #axalvc hashtag across
// every channel. Keep these strings consistent — they double as brand cues
// for recipients who copy/paste the message into other tools.
const DEFAULT_TEMPLATES = {
  twitter:
    "I've been using @axalvc StudioOS to spin up startups in 30 days — AI-scored deals, automated incorporation, real partner network. Worth a look: #axalvc #VentureStudio #Startups",
  linkedin:
    "I'm part of the @axalvc StudioOS network (" + AXAL_LINKEDIN_URL + ") — a venture studio that ships funded startups in 30 days. They're opening up partner spots. Use my link: {{link}}\n\n#axalvc #VentureStudio #Startups #Founders",
  whatsapp:
    "Hey — thought you'd find this interesting. @axalvc StudioOS turns ideas into funded companies in 30 days. My referral link: {{link}}\n\n#axalvc",
  telegram:
    "Join me on @axalvc StudioOS — a venture studio that ships funded startups in 30 days. Sign up with my referral link: {{link}}\n\nAlso join the Axal community on Telegram: " + AXAL_TELEGRAM_URL + "\n\n#axalvc",
  email_subject:
    "Quick intro to Axal StudioOS (@axalvc)",
  email_body:
    "Hi,\n\nI wanted to share something I think you'd find useful — @axalvc StudioOS. It's a venture studio that uses AI scoring + automated incorporation to ship funded startups in 30 days, and they pay commissions when partners I refer hit milestones.\n\nIf you'd like to take a look, here's my referral link:\n{{link}}\n\nReferral code: {{code}}\n\nJoin the Axal community on Telegram: " + AXAL_TELEGRAM_URL + "\nFollow @axalvc on LinkedIn: " + AXAL_LINKEDIN_URL + "\n\n#axalvc\n\nLet me know what you think.\n\nThanks,",
};

function loadTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return DEFAULT_TEMPLATES;
    return { ...DEFAULT_TEMPLATES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

function fillTemplate(tpl, link, code) {
  return (tpl || '').replaceAll('{{link}}', link).replaceAll('{{code}}', code);
}

export default function ReferEarnPage() {
  const [data, setData] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [commissions, setCommissions] = useState({ balance_cents: 0, lifetime_cents: 0, commissions: [] });
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState(loadTemplates);
  const [editingTemplates, setEditingTemplates] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [imported, setImported] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [importError, setImportError] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null); // { sent, failed:[] } | { error }
  // LinkedIn import wizard. The modal has two tabs: OAuth sign-in (verifies
  // the user's LinkedIn identity but does NOT pull connections — LinkedIn
  // killed that API in 2015) and an in-browser parse of the user's own
  // Connections.csv export. The CSV never leaves the browser.
  const [linkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [linkedinTab, setLinkedinTab] = useState('signin'); // 'signin' | 'csv'
  const [linkedinStatus, setLinkedinStatus] = useState({ configured: false, connected: false });
  const [linkedinBusy, setLinkedinBusy] = useState(false);
  const [linkedinFlash, setLinkedinFlash] = useState(''); // success/error banner inside the modal
  const qrRef = useRef(null);
  const fileRef = useRef(null);
  const linkedinFileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [code, refs, comms] = await Promise.all([
          api.referralCode(),
          api.referralList().catch(() => []),
          api.commissionsMe().catch(() => ({ balance_cents: 0, lifetime_cents: 0, commissions: [] })),
        ]);
        setData(code);
        setReferrals(refs);
        setCommissions(comms);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (data?.register_link && qrRef.current) {
      QRCode.toCanvas(qrRef.current, data.register_link, { width: 180, margin: 2 });
    }
  }, [data]);

  // Load LinkedIn status on mount. 404 means the deployment hasn't shipped
  // /api/linkedin yet — treat as "not configured" rather than an error.
  useEffect(() => {
    (async () => {
      try {
        const s = await api.linkedinStatus();
        setLinkedinStatus(s || { configured: false, connected: false });
      } catch (e) {
        if (e?.status === 404 || (e?.message || '').toLowerCase() === 'not found') {
          setLinkedinStatus({ configured: false, connected: false });
        }
        // Other errors (e.g. 401) are silent — user just doesn't see status.
      }
    })();
  }, []);

  // Handle the OAuth round-trip flash. The worker callback redirects back
  // to /refer?linkedin=connected (or =error&linkedin_error=...). Show the
  // result, refresh status, and strip the params so a refresh doesn't replay.
  useEffect(() => {
    const u = new URL(window.location.href);
    const flag = u.searchParams.get('linkedin');
    if (!flag) return;
    if (flag === 'connected') {
      setLinkedinModalOpen(true);
      setLinkedinTab('csv');
      setLinkedinFlash('LinkedIn connected. Now export your Connections.csv to import contacts.');
      api.linkedinStatus().then(s => setLinkedinStatus(s || { configured: false, connected: true })).catch(() => {});
    } else if (flag === 'error') {
      setLinkedinModalOpen(true);
      setLinkedinTab('signin');
      // Map worker-emitted coarse codes to fixed friendly strings. Never
      // interpolate the raw query value — it could carry arbitrary backend
      // text ("Internal server error", "token exchange 502", etc) and
      // breaks the no-raw-leak idiom even though React escapes the markup.
      const code = String(u.searchParams.get('linkedin_error') || '').toLowerCase();
      const FLASHES = {
        oauth_denied: 'LinkedIn sign-in was cancelled. You can try again, or use the CSV import tab.',
        not_configured: "LinkedIn sign-in isn't available on this deployment right now. You can still use the CSV import tab.",
        state_invalid: 'Your LinkedIn sign-in session expired before completing. Please try again.',
        token_unavailable: "Couldn't verify with LinkedIn right now. Please try again in a few minutes, or use the CSV import tab.",
        identity_unavailable: "Couldn't read your LinkedIn identity. Please try again, or use the CSV import tab.",
        save_failed: "Signed in with LinkedIn, but couldn't save the connection. Please try again in a moment.",
      };
      setLinkedinFlash(FLASHES[code] || 'LinkedIn sign-in did not complete. Please try again, or use the CSV import tab.');
    }
    u.searchParams.delete('linkedin');
    u.searchParams.delete('linkedin_error');
    window.history.replaceState({}, '', u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : '') + u.hash);
  }, []);

  const copy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fmt = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;
  const convertedCount = referrals.filter(r => r.status === 'converted').length;

  const link = data?.register_link || '';
  const code = data?.code || '';

  const shareLinks = useMemo(() => {
    const url = encodeURIComponent(link);
    const tw = encodeURIComponent(fillTemplate(templates.twitter, link, code));
    // LinkedIn's share dialog ignores any `text`/`summary` param it used to
    // accept — only `url` is honored. The template is still useful: many
    // users copy/paste it into the LinkedIn composer or via a bookmarklet.
    const wa = encodeURIComponent(fillTemplate(templates.whatsapp, link, code) + ' ' + link);
    // Telegram's share endpoint takes the URL plus an optional text body.
    // We pre-fill with the user's referral link AND a nudge to join the
    // public Axal channel, so the recipient gets both calls-to-action.
    const tg = encodeURIComponent(fillTemplate(templates.telegram, link, code));
    const em_subject = encodeURIComponent(fillTemplate(templates.email_subject, link, code));
    const em_body = encodeURIComponent(fillTemplate(templates.email_body, link, code));
    return {
      twitter: `https://twitter.com/intent/tweet?text=${tw}&url=${url}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      whatsapp: `https://wa.me/?text=${wa}`,
      telegram: `https://t.me/share/url?url=${url}&text=${tg}`,
      email: `mailto:?subject=${em_subject}&body=${em_body}`,
    };
  }, [link, code, templates]);

  const saveTemplates = () => {
    try {
      localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
      setEditingTemplates(false);
    } catch (e) {
      setImportError('Could not save templates: ' + e.message);
    }
  };

  const resetTemplates = () => {
    setTemplates(DEFAULT_TEMPLATES);
    localStorage.removeItem(TEMPLATE_STORAGE_KEY);
  };

  const handleCsvUpload = async (e) => {
    setImportError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      setImportError('File too large (max 1 MB).');
      return;
    }
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setImportError('No valid rows found. CSV needs at least an "email" column.');
        return;
      }
      if (rows.length > 100) {
        setImportError(`CSV had ${rows.length} rows — only the first 100 will be imported (per-send limit).`);
      }
      // Backend caps a single send-invites request at 100 contacts; keep the
      // import preview aligned so users don't queue invites we'd reject.
      const personalized = rows.slice(0, 100).map(r => {
        const params = new URLSearchParams({ ref: code });
        if (r.email) params.set('invitee', r.email);
        const personalizedLink = `${link.split('?')[0]}?${params.toString()}`;
        return {
          name: r.name || '',
          email: r.email || '',
          link: personalizedLink,
          mailto: `mailto:${encodeURIComponent(r.email || '')}?subject=${encodeURIComponent(fillTemplate(templates.email_subject, personalizedLink, code))}&body=${encodeURIComponent(fillTemplate(templates.email_body, personalizedLink, code))}`,
        };
      });
      setImported(personalized);
      setSelected(new Set(personalized.map((_, i) => i))); // pre-select all
      setSendResult(null);
    } catch (err) {
      setImportError('Could not parse CSV: ' + err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const toggleRow = (i) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(prev =>
      prev.size === imported.length ? new Set() : new Set(imported.map((_, i) => i))
    );
  };
  // -------- LinkedIn handlers --------
  const connectLinkedIn = async () => {
    setLinkedinBusy(true);
    setLinkedinFlash('');
    try {
      const { authorize_url } = await api.linkedinOAuthStart();
      // Top-level navigation — popup-blockers eat window.open in some browsers,
      // and LinkedIn's auth page is full-screen anyway.
      window.location.href = authorize_url;
    } catch (e) {
      // Defensive classification — never paste raw e.message ("Internal server
      // error", "Not found", etc) into the modal banner.
      const status = e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 401 || status === 403 || msg.includes('unauthorized')) {
        setLinkedinFlash('Your session expired. Please sign in again, then retry.');
      } else if (status === 503 || status === 404 || msg.includes('not configured') || msg.includes('not available')) {
        setLinkedinFlash("LinkedIn sign-in isn't available on this deployment right now. You can still use the CSV import tab below.");
      } else {
        setLinkedinFlash("Couldn't start LinkedIn sign-in right now. Please retry in a moment, or use the CSV import tab below.");
      }
      setLinkedinBusy(false);
    }
  };
  const disconnectLinkedIn = async () => {
    setLinkedinBusy(true);
    setLinkedinFlash('');
    try {
      await api.linkedinDisconnect();
      setLinkedinStatus(s => ({ ...s, connected: false, linkedin_email: null, linkedin_name: null }));
      setLinkedinFlash('LinkedIn disconnected.');
    } catch (e) {
      const status = e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 401 || status === 403 || msg.includes('unauthorized')) {
        setLinkedinFlash('Your session expired. Please sign in again to disconnect LinkedIn.');
      } else if (status === 404 || msg.includes('not found')) {
        // Already disconnected on the server — reflect locally.
        setLinkedinStatus(s => ({ ...s, connected: false, linkedin_email: null, linkedin_name: null }));
        setLinkedinFlash('LinkedIn disconnected.');
      } else {
        setLinkedinFlash("Couldn't disconnect LinkedIn right now. Please retry in a moment.");
      }
    } finally {
      setLinkedinBusy(false);
    }
  };
  const handleLinkedInCsvUpload = async (e) => {
    setLinkedinFlash('');
    setImportError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      setLinkedinFlash('File too large (max 2 MB). LinkedIn exports above this size are unusual — please trim before re-uploading.');
      return;
    }
    try {
      const text = await file.text();
      const rows = parseLinkedInCsv(text);
      if (rows.length === 0) {
        setLinkedinFlash('No emailed contacts found. LinkedIn only includes email for connections who chose to share theirs — you may need to invite them manually.');
        return;
      }
      const skipped = rows.length > 100 ? rows.length - 100 : 0;
      const personalized = rows.slice(0, 100).map(r => {
        const params = new URLSearchParams({ ref: code });
        if (r.email) params.set('invitee', r.email);
        const personalizedLink = `${link.split('?')[0]}?${params.toString()}`;
        return {
          name: r.name || '',
          email: r.email || '',
          link: personalizedLink,
          mailto: `mailto:${encodeURIComponent(r.email || '')}?subject=${encodeURIComponent(fillTemplate(templates.email_subject, personalizedLink, code))}&body=${encodeURIComponent(fillTemplate(templates.email_body, personalizedLink, code))}`,
        };
      });
      setImported(personalized);
      setSelected(new Set(personalized.map((_, i) => i)));
      setSendResult(null);
      setLinkedinModalOpen(false);
      setLinkedinFlash('');
      setImportError(skipped > 0 ? `Imported the first 100 contacts; ${skipped} more were skipped (per-send limit).` : '');
    } catch (err) {
      setLinkedinFlash('Could not parse LinkedIn CSV: ' + (err?.message || 'unknown'));
    } finally {
      if (linkedinFileRef.current) linkedinFileRef.current.value = '';
    }
  };

  const sendInvites = async () => {
    if (sending || selected.size === 0) return;
    setSending(true);
    setSendResult(null);
    try {
      const contacts = imported
        .map((c, i) => ({ idx: i, ...c }))
        .filter(c => selected.has(c.idx))
        .map(c => ({ email: c.email, name: c.name }));
      const res = await api.emailSendReferralInvites(contacts, inviteMessage || undefined);
      setSendResult(res);
      // Drop successfully-sent rows from the selection so a second click
      // doesn't re-send to the same people.
      const failedSet = new Set((res.failed || []).map(f => f.email));
      setSelected(prev => {
        const next = new Set();
        imported.forEach((c, i) => {
          if (prev.has(i) && failedSet.has(c.email)) next.add(i);
        });
        return next;
      });
    } catch (e) {
      setSendResult({ error: e.message || 'Send failed' });
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Share2 className="text-violet-600" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Refer & Earn</h1>
          <p className="text-sm text-gray-600">Invite founders, partners, and LPs. Earn commissions when they reach milestones.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard icon={Users} label="Total Referred" value={referrals.length} />
        <StatCard icon={Check} label="Converted" value={convertedCount} />
        <StatCard icon={DollarSign} label="Lifetime Earned" value={fmt(commissions.lifetime_cents)} highlight />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Your Referral Link</h2>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 flex items-center gap-3">
            <code className="text-xs text-violet-700 font-mono flex-1 truncate">{link}</code>
            <button onClick={() => copy(link)}
              className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
            </button>
          </div>

          <div className="text-xs text-gray-600 mb-2">Referral code</div>
          <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-lg p-4 text-center mb-4">
            <div className="text-2xl font-mono font-bold text-violet-700 tracking-wider">{code}</div>
          </div>

          {/* Quick share */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-semibold text-gray-700">Quick Share</div>
              <button
                onClick={() => setEditingTemplates(v => !v)}
                className="text-[11px] text-violet-600 hover:text-violet-700 flex items-center gap-1"
              >
                <Edit3 size={11} /> {editingTemplates ? 'Close' : 'Edit messages'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <ShareButton href={shareLinks.twitter} icon={Twitter} label="X / Twitter" color="bg-black hover:bg-gray-800" />
              <ShareButton href={shareLinks.linkedin} icon={LinkedinSvg} label="LinkedIn" color="bg-[#0A66C2] hover:bg-[#0856a8]" />
              <ShareButton href={shareLinks.telegram} icon={Send} label="Telegram" color="bg-[#229ED9] hover:bg-[#1d8abf]" />
              <ShareButton href={shareLinks.whatsapp} icon={MessageCircle} label="WhatsApp" color="bg-[#25D366] hover:bg-[#20bd5a]" />
              <ShareButton href={shareLinks.email} icon={Mail} label="Email" color="bg-violet-600 hover:bg-violet-700" />
            </div>
          </div>

          {editingTemplates && (
            <TemplateEditor
              templates={templates}
              setTemplates={setTemplates}
              onSave={saveTemplates}
              onReset={resetTemplates}
            />
          )}

          <div className="mt-4 text-xs text-gray-500">
            Anyone who registers with your code becomes attributed to you. Commissions accrue automatically when they hit milestones (KYC approval, deal funding, LP onboarding, etc.).
            <br />
            <Link to="/network" className="inline-flex items-center gap-1 text-violet-600 hover:underline mt-2">
              <NetworkIcon size={12} /> View your referral network
            </Link>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col items-center">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">QR Code</h2>
          <canvas ref={qrRef} className="rounded" />
          <p className="text-xs text-gray-500 text-center mt-3">Scan to register with your code pre-filled.</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Wallet</h2>
          <Link to="/payouts" className="text-xs text-violet-600 hover:underline flex items-center gap-1">
            Manage payouts <ExternalLink size={11} />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <div className="text-xs text-emerald-700 mb-1">Available Balance</div>
            <div className="text-2xl font-bold text-emerald-900">{fmt(commissions.balance_cents)}</div>
            <div className="text-[11px] text-emerald-600 mt-1">Accrued commissions ready for payout</div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="text-xs text-gray-600 mb-1">Lifetime Earned</div>
            <div className="text-2xl font-bold text-gray-900">{fmt(commissions.lifetime_cents)}</div>
            <div className="text-[11px] text-gray-500 mt-1">Including paid-out amounts</div>
          </div>
        </div>
      </div>

      {/* Import contacts */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Import Contacts</h2>
            <p className="text-xs text-gray-500 mt-0.5">Upload a CSV with <code className="bg-gray-100 px-1 rounded">name,email</code> columns to generate personalized invite links.</p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvUpload} />
            <button
              onClick={() => { setLinkedinModalOpen(true); setLinkedinTab(linkedinStatus.connected ? 'csv' : 'signin'); setLinkedinFlash(''); }}
              className="bg-[#0A66C2] hover:bg-[#0856a8] text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5"
              title="Sign in with LinkedIn and import your Connections export"
            >
              <LinkedinIcon size={12} /> Import from LinkedIn
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              <Upload size={12} /> Upload CSV
            </button>
            {imported.length > 0 && (
              <button
                onClick={() => { setImported([]); setShowImport(false); }}
                className="text-xs text-gray-500 hover:text-gray-700 px-2"
                title="Clear imported list"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {importError && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle size={12} /> {importError}
          </div>
        )}

        {imported.length > 0 ? (
          <>
            <div className="px-6 py-3 bg-violet-50 border-b border-violet-100">
              <label className="block text-[11px] font-semibold text-violet-900 mb-1">
                Personal note (optional) — sent at the top of every invite
              </label>
              <textarea
                rows={2}
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
                placeholder="Hey — thought you'd find this interesting. Let me know what you think."
                className="w-full text-xs border border-violet-200 rounded-md px-3 py-2 focus:ring-2 focus:ring-violet-100 focus:border-violet-300 outline-none bg-white"
                maxLength={2000}
              />
            </div>
            {sendResult && (
              <div className={`px-6 py-3 border-b text-xs flex items-center gap-2 ${
                sendResult.error ? 'bg-red-50 border-red-200 text-red-700' :
                (sendResult.failed?.length ? 'bg-amber-50 border-amber-200 text-amber-800'
                                           : 'bg-emerald-50 border-emerald-200 text-emerald-800')
              }`}>
                {sendResult.error ? <AlertCircle size={12} /> : <Check size={12} />}
                {sendResult.error
                  ? sendResult.error
                  : `Sent ${sendResult.sent} invite${sendResult.sent === 1 ? '' : 's'}` +
                    (sendResult.failed?.length ? ` — ${sendResult.failed.length} failed (kept selected to retry)` : '')}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs text-gray-600">
                    <th className="px-6 py-3 font-medium w-10">
                      <input
                        type="checkbox"
                        checked={selected.size === imported.length && imported.length > 0}
                        onChange={toggleAll}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium">Email</th>
                    <th className="px-6 py-3 font-medium">Personalized link</th>
                    <th className="px-6 py-3 font-medium text-right">Mailto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {imported.map((c, i) => (
                    <tr key={`${c.email}-${i}`} className={selected.has(i) ? 'bg-violet-50/40' : ''}>
                      <td className="px-6 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggleRow(i)}
                          aria-label={`Select ${c.email}`}
                        />
                      </td>
                      <td className="px-6 py-3 text-gray-900">{c.name || '—'}</td>
                      <td className="px-6 py-3 text-gray-600">{c.email}</td>
                      <td className="px-6 py-3">
                        <code className="text-[11px] text-violet-700 font-mono truncate inline-block max-w-[260px] align-middle">{c.link}</code>
                        <button onClick={() => copy(c.link)} className="ml-2 text-[11px] text-violet-600 hover:underline">copy</button>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <a href={c.mailto} className="text-[11px] text-violet-600 hover:underline">Open in mail app →</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between flex-wrap gap-3">
              <div className="text-xs text-gray-600">
                {selected.size} of {imported.length} selected
                <span className="text-gray-400"> · sent from your account, branded as Axal Network</span>
              </div>
              <button
                onClick={sendInvites}
                disabled={sending || selected.size === 0}
                className="bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xs font-medium px-4 py-2 rounded-lg flex items-center gap-1.5"
              >
                {sending ? <><Loader2 size={12} className="animate-spin" /> Sending…</>
                         : <><Send size={12} /> Send {selected.size || ''} invite{selected.size === 1 ? '' : 's'}</>}
              </button>
            </div>
          </>
        ) : (
          <div className="p-6 text-center text-xs text-gray-500">
            No contacts imported yet. Your CSV should have a header row including at least <code className="bg-gray-100 px-1 rounded">email</code> (and optionally <code className="bg-gray-100 px-1 rounded">name</code>).
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Your Referrals</h2>
        </div>
        {referrals.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No referrals yet. Share your link to start earning.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs text-gray-600">
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Email</th>
                  <th className="px-6 py-3 font-medium">KYC</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {referrals.map(r => (
                  <tr key={r.id}>
                    <td className="px-6 py-3 text-gray-900">{r.referred_name}</td>
                    <td className="px-6 py-3 text-gray-600">{r.referred_email}</td>
                    <td className="px-6 py-3"><Pill status={r.kyc_status || 'not_started'} /></td>
                    <td className="px-6 py-3"><Pill status={r.status} /></td>
                    <td className="px-6 py-3 text-gray-500 text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {linkedinModalOpen && (
        <LinkedInImportModal
          status={linkedinStatus}
          tab={linkedinTab}
          setTab={setLinkedinTab}
          busy={linkedinBusy}
          flash={linkedinFlash}
          onClose={() => { setLinkedinModalOpen(false); setLinkedinFlash(''); }}
          onConnect={connectLinkedIn}
          onDisconnect={disconnectLinkedIn}
          fileRef={linkedinFileRef}
          onCsvUpload={handleLinkedInCsvUpload}
        />
      )}
    </div>
  );
}

function LinkedInImportModal({ status, tab, setTab, busy, flash, onClose, onConnect, onDisconnect, fileRef, onCsvUpload }) {
  const tabBtn = (id, label) => (
    <button
      onClick={() => setTab(id)}
      className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
        tab === id
          ? 'border-[#0A66C2] text-[#0A66C2]'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200 w-full max-w-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="linkedin-modal-title"
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-br from-[#eef5fb] to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#0A66C2] text-white flex items-center justify-center">
              <LinkedinIcon size={20} />
            </div>
            <div>
              <h2 id="linkedin-modal-title" className="text-base font-semibold text-gray-900">Import from LinkedIn</h2>
              <p className="text-xs text-gray-600">Verify your identity and import your connections export.</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pt-3 border-b border-gray-200 flex gap-1">
          {tabBtn('signin', '1. Sign in with LinkedIn')}
          {tabBtn('csv', '2. Upload Connections.csv')}
        </div>

        {flash && (
          <div className={`mx-6 mt-4 px-3 py-2 text-xs rounded-md flex items-start gap-2 ${
            /fail|error|could not/i.test(flash)
              ? 'bg-red-50 border border-red-200 text-red-700'
              : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
          }`}>
            {/fail|error|could not/i.test(flash) ? <AlertCircle size={12} className="mt-0.5 shrink-0" /> : <Check size={12} className="mt-0.5 shrink-0" />}
            <span>{flash}</span>
          </div>
        )}

        {tab === 'signin' && (
          <div className="p-6 space-y-4">
            {!status.configured && (
              <div className="px-3 py-2 text-xs rounded-md bg-amber-50 border border-amber-200 text-amber-800 flex items-start gap-2">
                <Info size={12} className="mt-0.5 shrink-0" />
                <span>LinkedIn sign-in is not configured on this deployment. You can still use the CSV import tab.</span>
              </div>
            )}
            {status.connected ? (
              <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-900 mb-1">
                  <ShieldCheck size={16} /> LinkedIn connected
                </div>
                <div className="text-xs text-emerald-800">
                  {status.linkedin_name || '—'}{status.linkedin_email ? ` · ${status.linkedin_email}` : ''}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <button
                    onClick={() => setTab('csv')}
                    className="bg-[#0A66C2] hover:bg-[#0856a8] text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                  >
                    Continue → Upload Connections.csv
                  </button>
                  <button
                    onClick={onDisconnect}
                    disabled={busy}
                    className="text-xs text-gray-500 hover:text-gray-700 px-2 disabled:opacity-50"
                  >
                    {busy ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-700">
                  Sign in with LinkedIn so we can verify your identity. We only read your <strong>name</strong> and <strong>email</strong> from LinkedIn — and we never store an access token.
                </p>
                <ul className="text-xs text-gray-600 space-y-1.5 list-disc pl-4">
                  <li>Your LinkedIn password is never shared with us.</li>
                  <li>LinkedIn does not expose your connections via API. Use the CSV tab to import them — the file is parsed in your browser and never uploaded.</li>
                </ul>
                <button
                  onClick={onConnect}
                  disabled={busy || !status.configured}
                  className="w-full bg-[#0A66C2] hover:bg-[#0856a8] disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 rounded-lg flex items-center justify-center gap-2"
                >
                  {busy ? <><Loader2 size={14} className="animate-spin" /> Redirecting to LinkedIn…</> : <><LinkedinIcon size={14} /> Sign in with LinkedIn</>}
                </button>
              </>
            )}
          </div>
        )}

        {tab === 'csv' && (
          <div className="p-6 space-y-4">
            <div className="px-3 py-2 text-xs rounded-md bg-violet-50 border border-violet-200 text-violet-900 flex items-start gap-2">
              <ShieldCheck size={12} className="mt-0.5 shrink-0" />
              <span>Your Connections.csv is parsed entirely in your browser and never uploaded. Only the rows you select on the next screen are sent — and only the email/name fields, not the full export.</span>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                <FileDown size={12} /> How to export your LinkedIn connections
              </div>
              <ol className="text-xs text-gray-600 space-y-1.5 list-decimal pl-4">
                <li>Open <a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noopener noreferrer" className="text-[#0A66C2] hover:underline">linkedin.com → Settings → Get a copy of your data</a>.</li>
                <li>Pick <em>Want something in particular?</em> → check <strong>Connections</strong> → request archive.</li>
                <li>LinkedIn emails you a ZIP within ~10 minutes. Open it and find <code className="bg-gray-100 px-1 rounded">Connections.csv</code>.</li>
                <li>Upload that file below.</li>
              </ol>
              <p className="text-[11px] text-gray-500 mt-2">
                Note: LinkedIn only includes a connection's email if they opted in to share it. Connections without an email are skipped.
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onCsvUpload} />
              <span className="text-[11px] text-gray-500">Max file size: 2 MB · First 100 rows imported.</span>
              <button
                onClick={() => fileRef.current?.click()}
                className="bg-[#0A66C2] hover:bg-[#0856a8] text-white text-xs font-medium px-4 py-2 rounded-lg flex items-center gap-1.5"
              >
                <Upload size={12} /> Choose Connections.csv
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ShareButton({ href, icon: Icon, label, color }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${color} text-white text-xs font-medium px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors`}
    >
      <Icon size={12} /> {label}
    </a>
  );
}

function TemplateEditor({ templates, setTemplates, onSave, onReset }) {
  const set = (k, v) => setTemplates(t => ({ ...t, [k]: v }));
  const inputCls = "w-full text-xs border border-gray-200 rounded-md px-3 py-2 focus:ring-2 focus:ring-violet-100 focus:border-violet-300 outline-none font-mono";
  return (
    <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
      <div className="text-xs font-semibold text-gray-700 mb-3">Edit invite messages</div>
      <p className="text-[11px] text-gray-500 mb-3">
        Use <code className="bg-white px-1 rounded">{'{{link}}'}</code> and <code className="bg-white px-1 rounded">{'{{code}}'}</code> as placeholders.
      </p>
      <div className="grid gap-3">
        <Field label="X / Twitter">
          <textarea rows={2} className={inputCls} value={templates.twitter} onChange={e => set('twitter', e.target.value)} />
        </Field>
        <Field label="LinkedIn">
          <textarea rows={2} className={inputCls} value={templates.linkedin} onChange={e => set('linkedin', e.target.value)} />
        </Field>
        <Field label="WhatsApp">
          <textarea rows={2} className={inputCls} value={templates.whatsapp} onChange={e => set('whatsapp', e.target.value)} />
        </Field>
        <Field label="Telegram">
          <textarea rows={3} className={inputCls} value={templates.telegram || ''} onChange={e => set('telegram', e.target.value)} />
        </Field>
        <Field label="Email subject">
          <input className={inputCls} value={templates.email_subject} onChange={e => set('email_subject', e.target.value)} />
        </Field>
        <Field label="Email body">
          <textarea rows={6} className={inputCls} value={templates.email_body} onChange={e => set('email_body', e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 mt-3">
        <button onClick={onReset} className="text-[11px] text-gray-500 hover:text-gray-700 px-3 py-1.5">Reset to defaults</button>
        <button onClick={onSave} className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5">
          <Save size={12} /> Save
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] font-medium text-gray-600 mb-1">{label}</div>
      {children}
    </label>
  );
}

function StatCard({ icon: Icon, label, value, highlight }) {
  return (
    <div className={`border rounded-xl p-4 ${highlight ? 'bg-gradient-to-br from-violet-50 to-indigo-50 border-violet-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
        <Icon size={14} /> {label}
      </div>
      <div className={`text-2xl font-bold ${highlight ? 'text-violet-700' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function Pill({ status }) {
  const colors = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-emerald-100 text-emerald-700',
    converted: 'bg-violet-100 text-violet-700',
    rejected: 'bg-red-100 text-red-700',
    not_started: 'bg-gray-100 text-gray-600',
  };
  return <span className={`text-[11px] px-2 py-1 rounded ${colors[status] || 'bg-gray-100 text-gray-600'}`}>{status.replace('_', ' ')}</span>;
}

// ---------------------------------------------------------------------------
// Lightweight CSV parser — handles quoted fields, commas-in-quotes, CRLF.
// Returns an array of {name?, email} objects keyed by header row.
// ---------------------------------------------------------------------------
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (cur.length > 0) lines.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) lines.push(cur);
  if (lines.length === 0) return [];

  const splitRow = (line) => {
    const out = [];
    let f = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { f += '"'; i++; continue; }
      if (ch === '"') { q = !q; continue; }
      if (ch === ',' && !q) { out.push(f); f = ''; continue; }
      f += ch;
    }
    out.push(f);
    return out.map(s => s.trim());
  };

  const header = splitRow(lines[0]).map(h => h.toLowerCase());
  const emailIdx = header.findIndex(h => h === 'email' || h === 'e-mail' || h === 'mail');
  const nameIdx = header.findIndex(h => h === 'name' || h === 'full name' || h === 'fullname');
  if (emailIdx === -1) return [];

  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitRow(lines[li]);
    const email = (cols[emailIdx] || '').trim();
    if (!email || !email.includes('@')) continue;
    rows.push({
      email,
      name: nameIdx >= 0 ? (cols[nameIdx] || '').trim() : '',
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// LinkedIn-aware CSV parser. The "Connections.csv" file LinkedIn ships in
// the data export starts with a "Notes:" preamble (3-5 lines of human-
// readable text) BEFORE the actual header row. We scan for the first line
// containing both "First Name" and "Email Address" and treat it as the
// header, then parse the remainder with the same quoted-field logic.
// ---------------------------------------------------------------------------
function parseLinkedInCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Reuse the row splitter via parseCsv on the trimmed substring once we
  // find the header line. Quote handling for the header search is naive
  // (LinkedIn never quotes the header), so a substring-includes check
  // is sufficient.
  const allLines = text.split(/\r\n|\n|\r/);
  let headerIdx = -1;
  for (let i = 0; i < Math.min(allLines.length, 10); i++) {
    const lc = allLines[i].toLowerCase();
    if (lc.includes('first name') && lc.includes('email address')) {
      headerIdx = i;
      break;
    }
  }
  // No LinkedIn-style header — fall back to the generic parser. This handles
  // the case where the user uploaded a plain name,email CSV via this picker.
  if (headerIdx === -1) return parseCsv(text);

  const trimmed = allLines.slice(headerIdx).join('\n');
  // Reuse the generic splitter, but we need First Name + Last Name + Email Address
  // semantics, not name+email. Inline the parse here.
  const lines = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '"' && trimmed[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && trimmed[i + 1] === '\n') i++;
      if (cur.length > 0) lines.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) lines.push(cur);
  if (lines.length === 0) return [];

  const splitRow = (line) => {
    const out = [];
    let f = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { f += '"'; i++; continue; }
      if (ch === '"') { q = !q; continue; }
      if (ch === ',' && !q) { out.push(f); f = ''; continue; }
      f += ch;
    }
    out.push(f);
    return out.map(s => s.trim());
  };

  const header = splitRow(lines[0]).map(h => h.toLowerCase());
  const firstIdx = header.findIndex(h => h === 'first name');
  const lastIdx = header.findIndex(h => h === 'last name');
  const emailIdx = header.findIndex(h => h === 'email address' || h === 'email');
  if (emailIdx === -1) return [];

  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitRow(lines[li]);
    const email = (cols[emailIdx] || '').trim();
    if (!email || !email.includes('@')) continue;
    const first = firstIdx >= 0 ? (cols[firstIdx] || '').trim() : '';
    const last = lastIdx >= 0 ? (cols[lastIdx] || '').trim() : '';
    const name = [first, last].filter(Boolean).join(' ').trim();
    rows.push({ email, name });
  }
  return rows;
}
