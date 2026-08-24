/**
 * Referrals — submit people into the programme and watch them move through
 * review.
 *
 * This replaced the former two-tab surface ("Refer & Earn" + "Payouts"). The
 * old page was organised around a Stripe Connect balance: connect an account,
 * watch cents accrue, request a transfer. That model is gone — rewards are
 * milestone labels settled off-platform — so the page is now organised around
 * the thing that actually has state worth checking: the referral pipeline.
 *
 * Everything on screen comes from the worker (`/api/refer-earn/*`). The three
 * programme categories, their gating, and the status vocabulary are all served
 * by `/overview` rather than duplicated here, so the client can't drift from
 * the server's idea of what a referral can be.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Share2, Plus, Upload, X, ChevronRight, Check, Copy, Lock,
  Send, MessageCircle, Mail, AlertCircle, Loader2,
} from 'lucide-react';

import { api } from '../lib/api';
import PageExplainer from '../components/PageExplainer';
import { useToast } from '../components/useToast';

/**
 * LinkedIn glyph. This lucide build dropped its brand icons, so brand marks
 * are inline SVG here (the same approach IntegrationsPage uses). `currentColor`
 * keeps it matching whatever the button sets.
 */
function LinkedinIcon({ size = 14 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="currentColor" aria-hidden="true" focusable="false"
    >
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-.95 1.83-1.95 3.77-1.95 4.03 0 4.78 2.5 4.78 5.76V21h-4v-5.6c0-1.34-.03-3.06-1.9-3.06-1.9 0-2.2 1.45-2.2 2.96V21H9z" />
    </svg>
  );
}

/** Status → chip classes. Mirrors the server's status vocabulary; anything
 *  unrecognised falls back to neutral rather than rendering unstyled. */
const STATUS_TONE = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  submitted: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  under_review: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  more_info_needed: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  qualified: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  in_conversation: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  converted: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  reward_eligible: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  reward_issued: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  closed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

const PRIORITY_TONE = {
  'Highest priority': 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  Standard: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  Selective: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

const QUALITY_BAR = {
  strong: [
    'A warm introduction where both sides already know context',
    'Specific evidence — traction, expertise, or relevance — not a cold contact',
    'Complete context: why now, why this person, why Axal VC',
  ],
  needsInfo: [
    'Referral submitted without contact details or context',
    'Relationship to Axal VC or to the referred party unclear',
    'Category selected doesn’t match what’s actually being referred',
  ],
  notAccepted: [
    'Self-referrals or referrals made without the person’s knowledge',
    'Mass contact lists with no individual context',
    'An idea with no founder attached yet',
  ],
};

const FAQS = [
  { q: 'Who is eligible to submit a referral?', a: 'Anyone already connected to Axal VC — founders in a cohort or graduated, advisors, investors, operators, and service partners.' },
  { q: 'When are rewards actually paid?', a: 'Only after a qualifying outcome — acceptance and formation for startup referrals, onboarding for advisors and partners, a paying customer for platform users. Never on submission alone.' },
  { q: 'Can I refer myself or my own company?', a: 'No. Self-referrals aren’t eligible under this program — apply directly instead.' },
  { q: 'Is every referral accepted?', a: 'No — most are not, and that’s intentional. Review is against a real quality bar, not a quota.' },
  { q: 'Is this program open to everyone, or invite-only?', a: 'Startup, advisor, platform user, and service partner referrals are open. Strategic and capital introductions run on invite-only terms.' },
  { q: 'What if my referral needs more information?', a: 'It moves to "More info needed" in your pipeline with a note on what’s missing — you can update it from the detail view.' },
];

function Chip({ className = '', children }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold ${className}`}>
      {children}
    </span>
  );
}

function StatusChip({ status, label }) {
  return <Chip className={STATUS_TONE[status] || STATUS_TONE.submitted}>{label || status}</Chip>;
}

/** Share copy written per-platform: LinkedIn earns trust from a professional
 *  feed, X has to survive a quote-tweet, WhatsApp/Telegram are conversational. */
function shareTargets(link) {
  const enc = encodeURIComponent;
  return [
    {
      key: 'linkedin', label: 'LinkedIn', Icon: LinkedinIcon,
      className: 'bg-[#0a66c2] hover:bg-[#004182] text-white',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(link)}`,
    },
    {
      key: 'x', label: 'X / Twitter', Icon: X,
      className: 'bg-black hover:bg-gray-800 text-white',
      href: `https://twitter.com/intent/tweet?url=${enc(link)}&text=${enc('If you’re building something worth funding, Axal VC’s Spin-Out Lab takes companies from idea to incorporated in 28 days.')}`,
    },
    {
      key: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle,
      className: 'bg-[#25d366] hover:bg-[#1da851] text-white',
      href: `https://wa.me/?text=${enc(`Thought of you — Axal VC's Spin-Out Lab: ${link}`)}`,
    },
    {
      key: 'telegram', label: 'Telegram', Icon: Send,
      className: 'bg-[#2aabee] hover:bg-[#1e96d4] text-white',
      href: `https://t.me/share/url?url=${enc(link)}&text=${enc('Axal VC Spin-Out Lab — idea to incorporated in 28 days.')}`,
    },
    {
      key: 'email', label: 'Email', Icon: Mail,
      className: 'bg-violet-600 hover:bg-violet-700 text-white',
      href: `mailto:?subject=${enc('Axal VC Spin-Out Lab')}&body=${enc(`I thought this might be relevant to you: ${link}`)}`,
    },
  ];
}

export default function ReferralsPage({ embedded = false }) {
  const { showToast } = useToast();

  const [overview, setOverview] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [statusFilter, setStatusFilter] = useState('All');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [faqOpen, setFaqOpen] = useState(0);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [ov, list] = await Promise.all([
        api.referralOverview(),
        api.referralSubmissions(),
      ]);
      setOverview(ov);
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setLoadError(e?.message || 'Could not load your referrals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const statusLabels = overview?.status_labels || {};
  const filtered = useMemo(() => {
    if (statusFilter === 'All') return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  // Only offer filters the user actually has rows for — an empty pipeline
  // shouldn't render eleven dead buttons.
  const availableStatuses = useMemo(() => {
    const seen = [];
    for (const r of rows) if (!seen.includes(r.status)) seen.push(r.status);
    return seen;
  }, [rows]);

  const copyLink = async () => {
    const link = overview?.referral_link;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast('Could not copy — select the link and copy manually.', 'error');
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

  return (
    <div
      className={embedded ? 'space-y-6' : 'p-6 max-w-6xl mx-auto space-y-6'}
      data-testid="referrals-page"
    >
      {!embedded && (
        <div className="flex items-center gap-3">
          <Share2 className="text-violet-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Referrals</h1>
            <PageExplainer pageKey="refer_earn" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Refer founders, partners, and LPs — then track them through review.
            </p>
          </div>
        </div>
      )}

      {loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            {loadError}
            <button type="button" onClick={load} className="ml-2 font-semibold underline">Retry</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Loading your referrals…
        </div>
      ) : (
        <>
          {/* ---- Summary ------------------------------------------------ */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { label: 'Submitted', value: overview?.counts?.total ?? 0 },
              { label: 'Converted', value: overview?.counts?.converted ?? 0 },
              { label: 'Rewards issued', value: overview?.counts?.reward_issued ?? 0, accent: true },
            ].map((tile) => (
              <div
                key={tile.label}
                className={`rounded-xl border p-4 ${
                  tile.accent
                    ? 'border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-900/20'
                    : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'
                }`}
              >
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{tile.label}</div>
                <div className={`mt-1 text-2xl font-bold ${tile.accent ? 'text-violet-700 dark:text-violet-300' : 'text-gray-900 dark:text-gray-100'}`}>
                  {tile.value}
                </div>
              </div>
            ))}
          </div>

          {/* ---- Referral link + share ---------------------------------- */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">Your referral link</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-[240px] break-all rounded-lg bg-gray-50 px-3 py-2 font-mono text-sm text-violet-700 dark:bg-gray-800 dark:text-violet-300">
                {overview?.referral_link || '—'}
              </code>
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {overview?.legacy_referral_code && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Previous code also works: <span className="font-mono">{overview.legacy_referral_code}</span>
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {shareTargets(overview?.referral_link || '').map(({ key, label, Icon, className, href }) => (
                <a
                  key={key}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ${className}`}
                >
                  <Icon size={14} /> {label}
                </a>
              ))}
            </div>
          </div>

          {/* ---- Programmes -------------------------------------------- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {(overview?.categories || []).map((cat) => (
              <div key={cat.key} className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip className={PRIORITY_TONE[cat.priority] || PRIORITY_TONE.Standard}>{cat.priority}</Chip>
                  <Chip className={cat.locked
                    ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}
                  >
                    {cat.access}
                  </Chip>
                </div>
                <h3 className="mt-2 text-sm font-bold text-gray-900 dark:text-gray-100">{cat.name}</h3>
                <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400">{cat.qualifies}</p>
                <p className="mt-2 text-xs font-medium text-gray-700 dark:text-gray-300">{cat.reward}</p>
                {cat.locked && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const r = await api.referralStrategicAccess({ note: '' });
                        setOverview((o) => ({ ...o, strategic_access: r.strategic_access }));
                        showToast('Access requested — we’ll be in touch.', 'success');
                      } catch (e) {
                        showToast(e?.message || 'Could not request access.', 'error');
                      }
                    }}
                    disabled={overview?.strategic_access === 'requested'}
                    className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-semibold text-violet-700 disabled:opacity-60 dark:border-violet-900 dark:text-violet-300"
                  >
                    <Lock size={12} />
                    {overview?.strategic_access === 'requested' ? 'Access requested' : 'Request access'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* ---- Pipeline ----------------------------------------------- */}
          <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-800">
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">Your referrals</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  <Upload size={14} /> Import CSV
                </button>
                <button
                  type="button"
                  onClick={() => setSubmitOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700"
                >
                  <Plus size={14} /> Submit a referral
                </button>
              </div>
            </div>

            {availableStatuses.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-gray-200 p-3 dark:border-gray-800">
                {['All', ...availableStatuses].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      statusFilter === s
                        ? 'bg-violet-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    {s === 'All' ? 'All' : (statusLabels[s] || s)}
                  </button>
                ))}
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {rows.length === 0 ? 'No referrals yet' : 'Nothing in this status'}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {rows.length === 0
                    ? 'Refer someone you already know is a fit — a warm, specific introduction beats a list of contacts.'
                    : 'Try a different filter.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {filtered.map((r) => (
                  <li key={r.uid}>
                    <button
                      type="button"
                      onClick={() => openDetail(r.uid)}
                      className="flex w-full items-center gap-3 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{r.referred_name}</span>
                          <StatusChip status={r.status} label={r.status_label} />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                          {[r.referred_org, r.category_name].filter(Boolean).join(' · ')}
                        </p>
                        {r.next_step && (
                          <p className="mt-1 truncate text-xs text-violet-700 dark:text-violet-300">{r.next_step}</p>
                        )}
                      </div>
                      {r.reward_label && (
                        <span className="hidden shrink-0 text-xs font-semibold text-gray-600 sm:block dark:text-gray-300">
                          {r.reward_label}
                        </span>
                      )}
                      <ChevronRight size={16} className="shrink-0 text-gray-400" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- Quality bar -------------------------------------------- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {[
              { title: 'What makes a strong referral', items: QUALITY_BAR.strong, tone: 'text-green-700 dark:text-green-300' },
              { title: 'What gets sent back for more info', items: QUALITY_BAR.needsInfo, tone: 'text-amber-700 dark:text-amber-300' },
              { title: 'What isn’t accepted', items: QUALITY_BAR.notAccepted, tone: 'text-red-700 dark:text-red-300' },
            ].map((col) => (
              <div key={col.title} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h3 className={`text-xs font-bold ${col.tone}`}>{col.title}</h3>
                <ul className="mt-2 space-y-1.5">
                  {col.items.map((i) => (
                    <li key={i} className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">• {i}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* ---- FAQ ---------------------------------------------------- */}
          <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <h2 className="border-b border-gray-200 p-4 text-sm font-bold text-gray-900 dark:border-gray-800 dark:text-gray-100">
              Common questions
            </h2>
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {FAQS.map((f, i) => (
                <li key={f.q}>
                  <button
                    type="button"
                    onClick={() => setFaqOpen(faqOpen === i ? -1 : i)}
                    aria-expanded={faqOpen === i}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left"
                  >
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{f.q}</span>
                    <span className="shrink-0 text-lg text-gray-400">{faqOpen === i ? '−' : '+'}</span>
                  </button>
                  {faqOpen === i && (
                    <p className="px-4 pb-4 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{f.a}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {submitOpen && (
        <SubmitModal
          categories={overview?.categories || []}
          onClose={() => setSubmitOpen(false)}
          onDone={() => { setSubmitOpen(false); load(); }}
        />
      )}
      {importOpen && (
        <ImportModal
          categories={(overview?.categories || []).filter((c) => !c.locked)}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); load(); }}
        />
      )}
      {detail && (
        <DetailDrawer
          detail={detail}
          onClose={() => setDetail(null)}
          onUpdated={(next) => { setDetail(next); load(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SubmitModal({ categories, onClose, onDone }) {
  const { showToast } = useToast();
  const open = categories.filter((c) => !c.locked);
  const [form, setForm] = useState({
    category: open[0]?.key || 'startup',
    referredName: '', referredOrg: '', referredContact: '', yourRole: '', context: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.referredName.trim()) { setError('A referral needs a name.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.referralSubmit(form);
      showToast('Referral submitted.', 'success');
      onDone();
    } catch (err) {
      setError(err?.message || 'Could not submit that referral.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Submit a referral" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Category">
          <select value={form.category} onChange={set('category')} className={inputCls}>
            {open.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Who are you referring?" required>
          <input value={form.referredName} onChange={set('referredName')} className={inputCls} placeholder="Full name" />
        </Field>
        <Field label="Company or organisation">
          <input value={form.referredOrg} onChange={set('referredOrg')} className={inputCls} placeholder="Where they work / what they're building" />
        </Field>
        <Field label="How do we reach them?">
          <input value={form.referredContact} onChange={set('referredContact')} className={inputCls} placeholder="Email or LinkedIn" />
        </Field>
        <Field label="Your relationship to them">
          <input value={form.yourRole} onChange={set('yourRole')} className={inputCls} placeholder="Former colleague, investor in their last round…" />
        </Field>
        <Field label="Context">
          <textarea
            value={form.context}
            onChange={set('context')}
            rows={4}
            className={inputCls}
            placeholder="Why now, why this person, why Axal VC. Specific evidence beats a general endorsement."
          />
        </Field>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? 'Submitting…' : 'Submit referral'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ImportModal({ categories, onClose, onDone }) {
  const { showToast } = useToast();
  const [category, setCategory] = useState(categories[0]?.key || 'startup');
  const [csv, setCsv] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const r = await api.referralImport({ category, csv });
      const failed = r.failed?.length || 0;
      showToast(
        `Imported ${r.imported}${failed ? ` · ${failed} skipped` : ''}.`,
        failed ? 'warning' : 'success',
      );
      onDone();
    } catch (err) {
      setError(err?.message || 'Could not import those rows.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Import referrals" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Paste CSV">
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={8}
            className={`${inputCls} font-mono text-xs`}
            placeholder={'name,org,context\nElena Voss,Fractional CPO,Strong GTM complement for the cohort'}
          />
        </Field>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Columns: name, org, context. A header row is optional. Bulk rows arrive
          thinner than a form submission, so they’re held to the same quality bar
          at review — context is what gets them through.
        </p>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={saving || !csv.trim()} className={btnPrimary}>
            {saving ? 'Importing…' : 'Import'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DetailDrawer({ detail, onClose, onUpdated }) {
  const { showToast } = useToast();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  if (detail.loading) {
    return (
      <Modal title="Referral" onClose={onClose}>
        <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      </Modal>
    );
  }

  const canRespond = !['reward_issued', 'rejected', 'closed'].includes(detail.status);

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
    <Modal title={detail.referred_name} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={detail.status} label={detail.status_label} />
          <span className="text-xs text-gray-500 dark:text-gray-400">{detail.category_name}</span>
        </div>

        {detail.referred_org && (
          <p className="text-sm text-gray-700 dark:text-gray-300">{detail.referred_org}</p>
        )}
        {detail.next_step && (
          <div className="rounded-lg bg-violet-50 p-3 text-sm text-violet-800 dark:bg-violet-900/20 dark:text-violet-200">
            <span className="font-semibold">Next step:</span> {detail.next_step}
          </div>
        )}
        {detail.fit_notes && (
          <div>
            <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">Review notes</h4>
            <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{detail.fit_notes}</p>
          </div>
        )}
        {detail.reward_label && (
          <p className="text-sm font-semibold text-green-700 dark:text-green-300">{detail.reward_label}</p>
        )}

        {detail.context && (
          <div>
            <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">Context you provided</h4>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-gray-400">{detail.context}</p>
          </div>
        )}

        {Array.isArray(detail.history) && detail.history.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">History</h4>
            <ol className="mt-2 space-y-2">
              {detail.history.map((h, i) => (
                <li key={`${h.created_at}-${i}`} className="flex gap-3">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{h.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{h.created_at}</p>
                    {h.note && <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{h.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {canRespond && (
          <div className="border-t border-gray-200 pt-3 dark:border-gray-800">
            <label className="text-xs font-bold text-gray-900 dark:text-gray-100">
              {detail.status === 'more_info_needed' ? 'Add the missing detail' : 'Add more context'}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className={`${inputCls} mt-1`}
              placeholder="Anything that helps review make a decision."
            />
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={addContext} disabled={saving || !note.trim()} className={btnPrimary}>
                {saving ? 'Saving…' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
const btnPrimary =
  'rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60';
const btnGhost =
  'rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800';

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-700 dark:text-gray-300">
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

function Modal({ title, onClose, children }) {
  // Escape-to-close: a drawer this tall is easy to open by accident from the
  // list, and reaching for the X is a long way on mobile.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-gray-900"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
