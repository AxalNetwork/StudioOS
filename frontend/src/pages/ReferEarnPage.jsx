import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Copy, Check, Users, DollarSign, Share2, ExternalLink, Network as NetworkIcon,
  Twitter, Linkedin, MessageCircle, Mail, Upload, Edit3, X, AlertCircle, Save,
  Send, Loader2,
} from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../lib/api';

const TEMPLATE_STORAGE_KEY = 'axal:invite_templates_v1';

const DEFAULT_TEMPLATES = {
  twitter:
    "I've been using @AxalVC StudioOS to spin up startups in 30 days — AI-scored deals, automated incorporation, real partner network. Worth a look:",
  linkedin:
    "I'm part of the Axal StudioOS network — a venture studio that ships funded startups in 30 days. They're opening up partner spots. Use my link:",
  whatsapp:
    "Hey — thought you'd find this interesting. Axal StudioOS turns ideas into funded companies in 30 days. My referral link:",
  email_subject:
    "Quick intro to Axal StudioOS",
  email_body:
    "Hi,\n\nI wanted to share something I think you'd find useful — Axal StudioOS. It's a venture studio that uses AI scoring + automated incorporation to ship funded startups in 30 days, and they pay commissions when partners I refer hit milestones.\n\nIf you'd like to take a look, here's my referral link:\n{{link}}\n\nReferral code: {{code}}\n\nLet me know what you think.\n\nThanks,",
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
  const qrRef = useRef(null);
  const fileRef = useRef(null);

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
    const li = encodeURIComponent(fillTemplate(templates.linkedin, link, code));
    const wa = encodeURIComponent(fillTemplate(templates.whatsapp, link, code) + ' ' + link);
    const em_subject = encodeURIComponent(fillTemplate(templates.email_subject, link, code));
    const em_body = encodeURIComponent(fillTemplate(templates.email_body, link, code));
    return {
      twitter: `https://twitter.com/intent/tweet?text=${tw}&url=${url}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      whatsapp: `https://wa.me/?text=${wa}`,
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <ShareButton href={shareLinks.twitter} icon={Twitter} label="X / Twitter" color="bg-black hover:bg-gray-800" />
              <ShareButton href={shareLinks.linkedin} icon={Linkedin} label="LinkedIn" color="bg-[#0A66C2] hover:bg-[#0856a8]" />
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
