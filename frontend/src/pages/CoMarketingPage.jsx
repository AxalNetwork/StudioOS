/* Task #54 — Co-marketing pitch + admin approval + attribution.
 *
 * Three views in one page (driven by user role):
 *   - Partner: submit + manage your pitches, see attribution counts.
 *   - Admin: review queue → approve / reject / publish.
 *   - Anyone: published catalog of approved+live campaigns.
 */
import { useEffect, useState } from 'react';
import {
  Megaphone, Send, CheckCircle, XCircle, Loader2, Globe, Copy, Plus, BarChart3,
} from 'lucide-react';
import { api } from '../lib/api';
import PageExplainer from '../components/PageExplainer';

const ASSET_TYPES = ['webinar', 'blog', 'podcast', 'event', 'newsletter', 'other'];

function StatusPill({ status }) {
  const styles = {
    proposed: 'bg-amber-100 text-amber-800',
    approved: 'bg-blue-100 text-blue-800',
    published: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-red-100 text-red-800',
    withdrawn: 'bg-gray-100 text-gray-700',
  };
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${styles[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

function PitchForm({ onSubmitted }) {
  const initial = {
    title: '', summary: '', asset_type: 'webinar',
    proposed_date: '', target_audience: '', distribution_channels: '',
    co_branding_notes: '', asset_url: '',
  };
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function submit() {
    setErr(null); setBusy(true);
    try {
      await api.submitCoMarketingPitch({
        ...draft,
        proposed_date: draft.proposed_date ? new Date(draft.proposed_date).toISOString() : null,
        target_audience: draft.target_audience || null,
        distribution_channels: draft.distribution_channels || null,
        co_branding_notes: draft.co_branding_notes || null,
        asset_url: draft.asset_url || null,
      });
      setDraft(initial);
      onSubmitted();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
      <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <Plus size={16} /> Propose a co-marketing piece
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
          <input value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="e.g. Webinar: Pricing for late-seed SaaS"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Asset type</label>
          <select value={draft.asset_type}
            onChange={(e) => setDraft({ ...draft, asset_type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm">
            {ASSET_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Summary</label>
          <textarea value={draft.summary} rows={3}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            placeholder="Pitch the audience, format, and what value you'll bring."
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Proposed date</label>
          <input type="datetime-local" value={draft.proposed_date}
            onChange={(e) => setDraft({ ...draft, proposed_date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Target audience</label>
          <input value={draft.target_audience}
            onChange={(e) => setDraft({ ...draft, target_audience: e.target.value })}
            placeholder="seed-stage B2B founders"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Distribution channels</label>
          <input value={draft.distribution_channels}
            onChange={(e) => setDraft({ ...draft, distribution_channels: e.target.value })}
            placeholder="LinkedIn, partner newsletter, X"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Co-branding notes</label>
          <textarea value={draft.co_branding_notes} rows={2}
            onChange={(e) => setDraft({ ...draft, co_branding_notes: e.target.value })}
            placeholder="Logo treatment, lock-up, attribution requirements…"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Asset URL (deck, draft, outline)</label>
          <input value={draft.asset_url}
            onChange={(e) => setDraft({ ...draft, asset_url: e.target.value })}
            placeholder="https://docs.google.com/…"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <button disabled={busy || !draft.title || draft.summary.length < 10} onClick={submit}
        className="bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white px-4 py-2 rounded text-sm font-medium flex items-center gap-2">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        Submit for review
      </button>
    </div>
  );
}

function AttributionBadge({ counts }) {
  if (!counts) return null;
  return (
    <div className="flex items-center gap-3 text-xs text-gray-600">
      <span className="flex items-center gap-1"><BarChart3 size={12} /> {counts.total} events</span>
      <span>· {counts.visit} visits</span>
      <span>· {counts.signup} signups</span>
      <span>· {counts.lead} leads</span>
      <span>· {counts.conversion} conv</span>
    </div>
  );
}

function CopyableCode({ code }) {
  const [copied, setCopied] = useState(false);
  if (!code) return <span className="text-xs text-gray-400">—</span>;
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-xs font-mono bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded inline-flex items-center gap-1">
      <Copy size={10} /> {copied ? 'copied' : code}
    </button>
  );
}

function PartnerView() {
  const [pitches, setPitches] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  async function load() {
    setErr(null); setLoading(true);
    try {
      const d = await api.listMyCoMarketingPitches();
      setPitches(d.items || []);
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') setPitches([]);
      else setErr(e.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <PitchForm onSubmitted={load} />
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">My pitches</h2>
        {err && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900 mb-3">
            {err}
          </div>
        )}
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : pitches.length === 0 ? (
          <div className="text-sm text-gray-500">No pitches yet — propose one above.</div>
        ) : (
          <div className="space-y-2">
            {pitches.map((p) => (
              <div key={p.id} className="bg-white border border-gray-200 rounded p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="font-semibold text-gray-900">{p.title}</div>
                      <StatusPill status={p.status} />
                      <span className="text-[11px] text-gray-500">{p.asset_type}</span>
                    </div>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap">{p.summary}</div>
                    {p.review_notes && (
                      <div className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded p-2">
                        <span className="font-medium">Reviewer notes:</span> {p.review_notes}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-gray-500">UTM code:</span>
                      <CopyableCode code={p.attribution_code} />
                      {p.published_url && (
                        <a href={p.published_url} target="_blank" rel="noreferrer"
                          className="text-xs text-violet-600 hover:underline flex items-center gap-1">
                          <Globe size={12} /> Published
                        </a>
                      )}
                    </div>
                    <div className="mt-2"><AttributionBadge counts={p.attribution} /></div>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    {(p.status === 'proposed' || p.status === 'approved') && (
                      <button onClick={async () => {
                        if (!confirm('Withdraw this pitch?')) return;
                        try { await api.withdrawCoMarketingPitch(p.uid); load(); }
                        catch (e) { alert(e.message); }
                      }} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1 rounded">
                        Withdraw
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminQueueRow({ pitch, onChange }) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [publishUrl, setPublishUrl] = useState('');
  async function act(kind) {
    setBusy(true);
    try {
      if (kind === 'approve') await api.approveCoMarketingPitch(pitch.uid, notes || null);
      else if (kind === 'reject') await api.rejectCoMarketingPitch(pitch.uid, notes || null);
      else if (kind === 'publish') await api.publishCoMarketingPitch(pitch.uid, { published_url: publishUrl || null, notes: notes || null });
      onChange();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="bg-white border border-gray-200 rounded p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="font-semibold text-gray-900">{pitch.title}</div>
        <StatusPill status={pitch.status} />
        <span className="text-[11px] text-gray-500">{pitch.asset_type}</span>
        <span className="text-[11px] text-gray-500 ml-auto">
          {pitch.partner_name ? `${pitch.partner_name}${pitch.partner_company ? ` · ${pitch.partner_company}` : ''}` : `partner #${pitch.partner_id}`}
        </span>
      </div>
      <div className="text-sm text-gray-700 whitespace-pre-wrap">{pitch.summary}</div>
      <div className="text-xs text-gray-500 space-x-2">
        {pitch.proposed_date && <span>Proposed: {new Date(pitch.proposed_date).toLocaleString()}</span>}
        {pitch.target_audience && <span>· Audience: {pitch.target_audience}</span>}
        {pitch.distribution_channels && <span>· Channels: {pitch.distribution_channels}</span>}
      </div>
      {pitch.asset_url && (
        <a className="text-xs text-violet-600 hover:underline" href={pitch.asset_url} target="_blank" rel="noreferrer">View asset</a>
      )}
      <textarea rows={2} value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Reviewer notes (optional, visible to partner)"
        className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
      {pitch.status === 'approved' && (
        <input value={publishUrl}
          onChange={(e) => setPublishUrl(e.target.value)}
          placeholder="Published URL (when going live)"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
      )}
      <div className="flex flex-wrap gap-2">
        {pitch.status === 'proposed' && (
          <>
            <button disabled={busy} onClick={() => act('approve')}
              className="text-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-medium flex items-center gap-1">
              <CheckCircle size={12} /> Approve
            </button>
            <button disabled={busy} onClick={() => act('reject')}
              className="text-xs bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-medium flex items-center gap-1">
              <XCircle size={12} /> Reject
            </button>
          </>
        )}
        {pitch.status === 'approved' && (
          <button disabled={busy} onClick={() => act('publish')}
            className="text-xs bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-medium flex items-center gap-1">
            <Globe size={12} /> Mark published
          </button>
        )}
      </div>
      {pitch.attribution_code && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          UTM code: <CopyableCode code={pitch.attribution_code} />
          <AttributionBadge counts={pitch.attribution} />
        </div>
      )}
    </div>
  );
}

function AdminView() {
  const [filter, setFilter] = useState('proposed');
  const [items, setItems] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  async function load() {
    setErr(null); setLoading(true);
    try {
      const d = await api.adminCoMarketingQueue(filter);
      setItems(d.items || []);
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') setItems([]);
      else setErr(e.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-700">Filter:</span>
        {['proposed', 'approved', 'published', 'rejected', 'withdrawn'].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`text-xs px-3 py-1 rounded-full ${filter === s ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {s}
          </button>
        ))}
      </div>
      {err && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{err}</div>
      )}
      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500">Nothing to show in “{filter}”.</div>
      ) : (
        <div className="space-y-3">
          {items.map((p) => <AdminQueueRow key={p.id} pitch={p} onChange={load} />)}
        </div>
      )}
    </div>
  );
}

function PublishedFeed() {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.listPublishedCoMarketing()
      .then((d) => setItems(d.items || []))
      .catch((e) => {
        const msg = (e?.message || '').toLowerCase();
        if (e?.status === 404 || msg === 'not found') setItems([]);
        else setErr(e.message);
      });
  }, []);
  if (err) return <div className="text-sm text-red-600">{err}</div>;
  if (items.length === 0) return <div className="text-sm text-gray-500">No published pieces yet.</div>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map((p) => (
        <div key={p.id} className="bg-white border border-gray-200 rounded p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="font-semibold text-gray-900">{p.title}</div>
            <span className="text-[11px] text-gray-500">{p.asset_type}</span>
          </div>
          <div className="text-xs text-gray-500 mb-2">
            By {p.partner_name || 'partner'}{p.partner_company ? ` · ${p.partner_company}` : ''}
            {p.published_at && ` · ${new Date(p.published_at).toLocaleDateString()}`}
          </div>
          <div className="text-sm text-gray-700 line-clamp-3 whitespace-pre-wrap">{p.summary}</div>
          {p.published_url && (
            <a href={p.published_url} target="_blank" rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-violet-600 hover:underline">
              <Globe size={12} /> View
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

export default function CoMarketingPage({ user }) {
  const role = (user?.role || '').toLowerCase();
  const isAdmin = role === 'admin';
  const isPartner = role === 'partner';
  const [tab, setTab] = useState(isAdmin ? 'admin' : (isPartner ? 'mine' : 'published'));

  const tabs = [];
  if (isPartner || isAdmin) tabs.push({ id: 'mine', label: 'My pitches' });
  if (isAdmin) tabs.push({ id: 'admin', label: 'Review queue' });
  tabs.push({ id: 'published', label: 'Published' });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Megaphone size={22} /> Co-marketing
        </h1>
        <PageExplainer pageKey="co_marketing" />
        <p className="text-sm text-gray-600 mt-1">
          Pitch a webinar, blog post, or podcast. Once approved by Axal, the platform helps
          run + distribute it, and inbound demand is attributed back to your partner profile.
        </p>
      </div>

      <div className="flex border-b border-gray-200 gap-1">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'mine' && <PartnerView />}
      {tab === 'admin' && <AdminView />}
      {tab === 'published' && <PublishedFeed />}
    </div>
  );
}
