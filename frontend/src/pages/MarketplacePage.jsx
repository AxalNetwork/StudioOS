import React, { useEffect, useMemo, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { useSearchParams } from 'react-router-dom';
import {
  Search, ShieldCheck, Star, Clock, MessageCircle, Send, X, Plus,
  Briefcase, Filter, AlertCircle, Save, ExternalLink, Check, Inbox, Edit3,
} from 'lucide-react';
import { api } from '../lib/api';

const CATEGORY_LABELS = {
  legal: 'Legal',
  accounting: 'Accounting',
  design: 'Design',
  recruiting: 'Recruiting',
  fractional_cfo: 'Fractional CFO',
  gtm: 'GTM',
  engineering: 'Engineering',
  marketing: 'Marketing',
};
const CAPACITY_TONE = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  limited: 'bg-amber-50 text-amber-700 border-amber-200',
  unavailable: 'bg-gray-100 text-gray-500 border-gray-200',
};

export default function MarketplacePage({ user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') || 'browse');
  const [meta, setMeta] = useState({ categories: [], pricing_tiers: ['$', '$$', '$$$'], capacity_statuses: ['available', 'limited', 'unavailable'] });

  useEffect(() => { api.marketplaceCategories().then(setMeta).catch(() => {}); }, []);
  useEffect(() => { setSearchParams({ tab }, { replace: true }); }, [tab]);

  const isPartner = user?.role === 'partner';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Service Provider Marketplace</h1>
        <PageExplainer pageKey="marketplace" />
        <p className="text-sm text-gray-500 mt-1">Vetted partners across legal, accounting, design, recruiting, fractional CFO, and GTM.</p>
      </div>

      <div className="border-b border-gray-200 flex gap-6">
        {[
          { key: 'browse', label: 'Browse', icon: Search },
          { key: 'inbox', label: 'My inquiries', icon: Inbox },
          ...(isPartner ? [{ key: 'profile', label: 'My listing', icon: Edit3 }] : []),
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-1 py-3 text-sm border-b-2 -mb-px ${tab === t.key ? 'border-violet-600 text-violet-700 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'browse' && <BrowseTab meta={meta} user={user} />}
      {tab === 'inbox' && <InboxTab user={user} />}
      {tab === 'profile' && isPartner && <ProfileTab meta={meta} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse tab
// ---------------------------------------------------------------------------
function BrowseTab({ meta, user }) {
  const [filters, setFilters] = useState({ category: '', sector: '', capacity: '', pricing: '', verified_only: false, q: '' });
  const [providers, setProviders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [inquiring, setInquiring] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const params = {};
      Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v !== false) params[k] = v; });
      const r = await api.listProviders(params);
      setProviders(r.providers || []);
    } catch (e) {
      // A 404 here means the worker doesn't have the providers route on
      // this deployment (stale worker). The empty-state card below already
      // covers "no providers match" — don't double up with a raw red banner.
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') {
        setProviders([]);
      } else {
        setError(e.message);
      }
    }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-900">Filters</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
          <div className="md:col-span-2 relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search name, headline, bio…" className="pl-8 w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
          </div>
          <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white">
            <option value="">All categories</option>
            {meta.categories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
          </select>
          <select value={filters.capacity} onChange={(e) => setFilters({ ...filters, capacity: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white">
            <option value="">Any availability</option>
            {(meta.capacity_statuses || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filters.pricing} onChange={(e) => setFilters({ ...filters, pricing: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white">
            <option value="">Any price</option>
            {(meta.pricing_tiers || []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700 px-2">
            <input type="checkbox" checked={filters.verified_only} onChange={(e) => setFilters({ ...filters, verified_only: e.target.checked })} />
            Verified only
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <button onClick={load} className="bg-violet-600 hover:bg-violet-700 text-white rounded-md px-4 py-1.5 text-sm font-medium">Apply</button>
        </div>
      </div>

      {error && <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm"><AlertCircle size={16} className="mt-0.5" />{error}</div>}
      {loading && <div className="text-sm text-gray-500">Loading providers…</div>}

      {!loading && providers.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-500 text-sm">
          <Briefcase size={28} className="mx-auto text-gray-300 mb-2" />
          No providers match your filters yet.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {providers.map((p) => (
          <button key={p.id} onClick={() => setSelected(p)} className="text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-violet-300 hover:shadow-sm transition">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-gray-900">{p.name}</span>
                  {p.kyb_verified && <span title="KYB verified" className="inline-flex"><ShieldCheck size={14} className="text-violet-600" /></span>}
                </div>
                {p.company && <div className="text-xs text-gray-500 mt-0.5">{p.company}</div>}
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${CAPACITY_TONE[p.capacity_status] || CAPACITY_TONE.unavailable}`}>{p.capacity_status}</span>
            </div>
            {p.headline && <p className="text-sm text-gray-700 mt-2 line-clamp-2">{p.headline}</p>}
            <div className="mt-3 flex flex-wrap gap-1">
              {(p.categories || []).slice(0, 4).map((c) => <span key={c} className="text-[10px] bg-violet-50 text-violet-700 rounded-full px-2 py-0.5">{CATEGORY_LABELS[c] || c}</span>)}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
              <div className="flex items-center gap-3">
                {p.reviews?.avg_rating !== null && p.reviews?.count > 0 && (
                  <span className="flex items-center gap-1"><Star size={12} className="text-amber-500 fill-amber-500" /> {p.reviews.avg_rating} ({p.reviews.count})</span>
                )}
                {p.response_time_hours !== null && p.response_time_hours !== undefined && (
                  <span className="flex items-center gap-1"><Clock size={12} /> ~{p.response_time_hours}h</span>
                )}
              </div>
              <span className="text-violet-600 font-medium">{p.pricing_tier || '—'}</span>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <ProviderDetailModal
          provider={selected}
          user={user}
          onClose={() => setSelected(null)}
          onInquire={() => { setInquiring(selected); setSelected(null); }}
        />
      )}
      {inquiring && <InquiryModal provider={inquiring} onClose={() => setInquiring(null)} />}
    </div>
  );
}

function ProviderDetailModal({ provider, user, onClose, onInquire }) {
  const [detail, setDetail] = useState(provider);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getProvider(provider.id).then(setDetail).catch((e) => setError(e.message));
  }, [provider.id]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-gray-200 sticky top-0 bg-white flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{detail.name}</h2>
              {detail.kyb_verified && (
                <span className="flex items-center gap-1 text-[11px] bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5">
                  <ShieldCheck size={11} /> KYB Verified
                </span>
              )}
            </div>
            {detail.company && <div className="text-sm text-gray-500 mt-0.5">{detail.company}</div>}
            {detail.headline && <p className="text-sm text-gray-800 mt-2 italic">{detail.headline}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-5">
          {error && <div className="text-sm text-rose-600">{error}</div>}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Field label="Pricing" value={detail.pricing_tier || '—'} />
            <Field label="Hourly rate" value={detail.hourly_rate_min || detail.hourly_rate_max ? `$${detail.hourly_rate_min || '?'}–${detail.hourly_rate_max || '?'}` : '—'} />
            <Field label="Capacity" value={detail.capacity_status} />
            <Field label="Response" value={detail.response_time_hours ? `~${detail.response_time_hours}h` : '—'} />
          </div>

          {(detail.categories || []).length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Specialties</div>
              <div className="flex flex-wrap gap-1.5">
                {detail.categories.map((c) => <span key={c} className="text-xs bg-violet-50 text-violet-700 rounded-full px-2.5 py-0.5">{CATEGORY_LABELS[c] || c}</span>)}
              </div>
            </div>
          )}
          {(detail.sectors || []).length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Sector focus</div>
              <div className="flex flex-wrap gap-1.5">
                {detail.sectors.map((s) => <span key={s} className="text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-0.5">{s}</span>)}
              </div>
            </div>
          )}

          {detail.bio && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">About</div>
              <p className="text-sm text-gray-700 whitespace-pre-line">{detail.bio}</p>
            </div>
          )}

          {detail.website && (
            <a href={detail.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-violet-600 hover:underline">
              <ExternalLink size={13} /> {detail.website}
            </a>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wide text-gray-500">Reviews</div>
              {user?.role === 'founder' && <button onClick={() => setReviewing(true)} className="text-xs text-violet-600 hover:underline">Leave a review</button>}
            </div>
            {detail.reviews?.count ? (
              <div className="flex items-center gap-2 text-sm">
                <Star size={14} className="text-amber-500 fill-amber-500" />
                <span className="font-semibold">{detail.reviews.avg_rating}</span>
                <span className="text-gray-500">({detail.reviews.count})</span>
              </div>
            ) : <div className="text-xs text-gray-400 italic">No reviews yet</div>}
            <div className="mt-3 space-y-2">
              {(detail.recent_reviews || []).map((r) => (
                <div key={r.id} className="border border-gray-100 rounded-lg p-2 text-xs">
                  <div className="flex items-center gap-1 text-amber-500">
                    {Array.from({ length: r.rating }).map((_, i) => <Star key={i} size={11} className="fill-amber-500" />)}
                  </div>
                  {r.comment && <p className="text-gray-700 mt-1">{r.comment}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 sticky bottom-0 bg-white flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Close</button>
          {user?.role !== 'partner' && (
            <button onClick={onInquire} disabled={detail.capacity_status === 'unavailable'} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-2">
              <MessageCircle size={14} /> Send inquiry
            </button>
          )}
        </div>

        {reviewing && <ReviewModal partnerId={detail.id} onClose={() => setReviewing(false)} onDone={() => { setReviewing(false); api.getProvider(detail.id).then(setDetail); }} />}
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-medium text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

function ReviewModal({ partnerId, onClose, onDone }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  async function save() {
    try {
      await api.createProviderReview(partnerId, { rating, comment: comment.trim() || null });
      onDone();
    } catch (e) { setError(e.message); }
  }
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold">Leave a review</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Rating</div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setRating(n)}>
                  <Star size={20} className={n <= rating ? 'text-amber-500 fill-amber-500' : 'text-gray-300'} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Comment (optional)</div>
            <textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </div>
          {error && <div className="text-xs text-rose-600">{error}</div>}
        </div>
        <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg flex items-center gap-2"><Save size={14} /> Submit</button>
        </div>
      </div>
    </div>
  );
}

function InquiryModal({ provider, onClose }) {
  const [subject, setSubject] = useState(`Inquiry: ${provider.headline ? provider.headline.slice(0, 60) : provider.name}`);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);
  async function send() {
    try {
      const r = await api.createInquiry(provider.id, { subject, message });
      setSent(r);
    } catch (e) { setError(e.message); }
  }
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold">Inquire — {provider.name}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        {sent ? (
          <div className="p-6 text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 flex items-center justify-center"><Check size={20} className="text-emerald-600" /></div>
            <div className="text-sm font-semibold text-gray-900">Inquiry sent</div>
            <div className="text-xs text-gray-500">Track replies under "My inquiries".</div>
            <button onClick={onClose} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg">Done</button>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Subject</div>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Message</div>
                <textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Briefly describe your need, timeline, and budget…" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
              </div>
              {error && <div className="text-xs text-rose-600">{error}</div>}
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={send} disabled={!subject.trim() || !message.trim()} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-2"><Send size={14} /> Send</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inbox tab
// ---------------------------------------------------------------------------
function InboxTab({ user }) {
  const [inquiries, setInquiries] = useState([]);
  const [active, setActive] = useState(null);
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState(null);

  async function load() {
    try { const r = await api.listInquiries(); setInquiries(r.inquiries || []); }
    catch (e) {
      // 404 = inquiries route not on this deployment; the empty-state below
      // already covers it. Stay quiet, don't show a raw red banner.
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') setInquiries([]);
      else setError(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function open(id) {
    setActive(id);
    try { setThread(await api.getInquiry(id)); }
    catch (e) { setError(e.message); }
  }

  async function send() {
    if (!reply.trim()) return;
    try {
      await api.postInquiryMessage(active, reply.trim());
      setReply('');
      const r = await api.getInquiry(active);
      setThread(r);
      load();
    } catch (e) { setError(e.message); }
  }

  async function close() {
    if (!confirm('Close this inquiry?')) return;
    try { await api.closeInquiry(active); await open(active); load(); }
    catch (e) { setError(e.message); }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden md:col-span-1">
        <div className="px-4 py-3 border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">Threads ({inquiries.length})</div>
        <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
          {inquiries.length === 0 && <div className="p-6 text-center text-sm text-gray-400 italic">No inquiries yet</div>}
          {inquiries.map((i) => (
            <button key={i.id} onClick={() => open(i.id)} className={`w-full text-left p-3 hover:bg-gray-50 ${active === i.id ? 'bg-violet-50' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900 truncate">{i.subject}</span>
                {i.status === 'closed' && <span className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">closed</span>}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {user?.role === 'partner' ? `from ${i.requester_name || '—'}` : `to ${i.partner_name || '—'}`}
              </div>
              {i.last_message_preview && <div className="text-xs text-gray-400 mt-1 line-clamp-1">{i.last_message_preview}</div>}
            </button>
          ))}
        </div>
      </div>

      <div className="md:col-span-2 bg-white border border-gray-200 rounded-xl flex flex-col min-h-[60vh]">
        {error && <div className="m-4 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-xs"><AlertCircle size={14} className="mt-0.5" />{error}</div>}
        {!thread && <div className="flex-1 flex items-center justify-center text-sm text-gray-400 italic">Select a thread</div>}
        {thread && (
          <>
            <div className="px-5 py-3 border-b border-gray-200 flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">{thread.subject}</div>
                <div className="text-xs text-gray-500 mt-0.5">{thread.partner_name} ↔ {thread.requester_name}</div>
              </div>
              {thread.status === 'open' && <button onClick={close} className="text-xs text-gray-500 hover:text-rose-600">Close inquiry</button>}
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {(thread.messages || []).map((m) => {
                const mine = m.sender_user_id === user?.id;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${mine ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                      {!mine && <div className="text-[10px] opacity-70 mb-0.5">{m.sender_name || (m.is_partner ? 'Partner' : 'User')}</div>}
                      <div className="whitespace-pre-line">{m.body}</div>
                      <div className={`text-[10px] mt-1 ${mine ? 'text-violet-200' : 'text-gray-500'}`}>{new Date(m.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {thread.status === 'open' ? (
              <div className="border-t border-gray-200 p-3 flex gap-2">
                <textarea rows={1} value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} placeholder="Reply… (⌘/Ctrl+Enter to send)" className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm resize-none" />
                <button onClick={send} disabled={!reply.trim()} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-md text-sm flex items-center gap-1.5"><Send size={13} /> Send</button>
              </div>
            ) : (
              <div className="border-t border-gray-200 p-4 text-xs text-gray-400 text-center italic">This inquiry is closed.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My listing tab (partner only)
// ---------------------------------------------------------------------------
function ProfileTab({ meta }) {
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getMyProvider().then((p) => { setProfile(p); setDraft(toDraft(p)); }).catch((e) => setError(e.message));
  }, []);

  function toDraft(p) {
    return {
      headline: p.headline || '',
      bio: p.bio || '',
      categories: p.categories || [],
      sectors: (p.sectors || []).join(', '),
      pricing_tier: p.pricing_tier || '',
      hourly_rate_min: p.hourly_rate_min ?? '',
      hourly_rate_max: p.hourly_rate_max ?? '',
      capacity_status: p.capacity_status || 'available',
      response_time_hours: p.response_time_hours ?? '',
      website: p.website || '',
      listed: !!p.listed,
    };
  }

  async function save() {
    setError(null); setSaved(false);
    try {
      const payload = {
        ...draft,
        sectors: draft.sectors.split(',').map((s) => s.trim()).filter(Boolean),
        hourly_rate_min: draft.hourly_rate_min === '' ? null : Number(draft.hourly_rate_min),
        hourly_rate_max: draft.hourly_rate_max === '' ? null : Number(draft.hourly_rate_max),
        response_time_hours: draft.response_time_hours === '' ? null : Number(draft.response_time_hours),
        pricing_tier: draft.pricing_tier || null,
      };
      const r = await api.updateMyProvider(payload);
      setProfile(r); setDraft(toDraft(r)); setSaved(true);
    } catch (e) { setError(e.message); }
  }

  if (!draft) return <div className="text-sm text-gray-500">{error || 'Loading…'}</div>;

  function toggleCat(c) {
    setDraft({ ...draft, categories: draft.categories.includes(c) ? draft.categories.filter((x) => x !== c) : [...draft.categories, c] });
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-3xl space-y-5">
      {error && <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-sm"><AlertCircle size={14} className="mt-0.5" />{error}</div>}
      {saved && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2 text-sm">Saved.</div>}

      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">KYB status</div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-2.5 py-1 rounded-full border ${profile?.kyb_status === 'verified' ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
              {profile?.kyb_status === 'verified' ? <span className="inline-flex items-center gap-1"><ShieldCheck size={11} /> Verified</span> : profile?.kyb_status || 'unverified'}
            </span>
            {profile?.kyb_status !== 'verified' && <span className="text-[11px] text-gray-500">Admins set this after KYB.</span>}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.listed} onChange={(e) => setDraft({ ...draft, listed: e.target.checked })} />
          List in marketplace
        </label>
      </div>

      <DraftField label="Headline" value={draft.headline} onChange={(v) => setDraft({ ...draft, headline: v })} placeholder="Fractional CFO for late-seed SaaS" />
      <DraftField label="Bio" textarea value={draft.bio} onChange={(v) => setDraft({ ...draft, bio: v })} placeholder="Background, notable engagements, sweet spot…" />
      <DraftField label="Website" value={draft.website} onChange={(v) => setDraft({ ...draft, website: v })} placeholder="https://…" />

      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">Categories</div>
        <div className="flex flex-wrap gap-2">
          {(meta.categories || []).map((c) => (
            <button key={c} onClick={() => toggleCat(c)} className={`text-xs px-2.5 py-1 rounded-full border ${draft.categories.includes(c) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-700 border-gray-300 hover:border-violet-300'}`}>
              {CATEGORY_LABELS[c] || c}
            </button>
          ))}
        </div>
      </div>

      <DraftField label="Sectors (comma-separated)" value={draft.sectors} onChange={(v) => setDraft({ ...draft, sectors: v })} placeholder="b2b_saas, fintech, climate" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Pricing tier</div>
          <select value={draft.pricing_tier} onChange={(e) => setDraft({ ...draft, pricing_tier: e.target.value })} className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white">
            <option value="">—</option>
            {(meta.pricing_tiers || []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Capacity</div>
          <select value={draft.capacity_status} onChange={(e) => setDraft({ ...draft, capacity_status: e.target.value })} className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white">
            {(meta.capacity_statuses || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Rate min ($/hr)</div>
          <input type="number" min="0" value={draft.hourly_rate_min} onChange={(e) => setDraft({ ...draft, hourly_rate_min: e.target.value })} className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Rate max ($/hr)</div>
          <input type="number" min="0" value={draft.hourly_rate_max} onChange={(e) => setDraft({ ...draft, hourly_rate_max: e.target.value })} className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
      </div>

      <DraftField label="Typical first-response (hours)" type="number" value={draft.response_time_hours} onChange={(v) => setDraft({ ...draft, response_time_hours: v })} />

      <div className="flex justify-end">
        <button onClick={save} className="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"><Save size={14} /> Save listing</button>
      </div>
    </div>
  );
}

function DraftField({ label, value, onChange, placeholder, textarea, type = 'text' }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      {textarea ? (
        <textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
      )}
    </div>
  );
}
