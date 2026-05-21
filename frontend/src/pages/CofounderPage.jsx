/**
 * Task #38 — Co-founder matching with mutual-interest reveal + auto-NDA.
 *
 * Three tabs:
 *   - Browse — anonymized candidate cards. Click "I'm interested" to send a
 *     directed signal. If the other side has already pinged us, the card
 *     flips to "mutual" and a connection appears in the Connections tab.
 *   - Connections — mutual matches. For pending_nda, the user signs the
 *     auto-generated NDA inline; once both sides sign, the connection
 *     becomes "active" and identity is fully revealed.
 *   - My profile — opt in / edit / un-list.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Users, Heart, FileText, Search, MapPin, Briefcase, Globe2, Sparkles,
  CheckCircle2, Clock, X, Plus, RefreshCw, AlertCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';
import UserTrustBadge from '../components/UserTrustBadge';
import PageExplainer from '../components/PageExplainer';

const COMMITMENT_LABEL = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  exploring: 'Exploring',
};

function asArray(x) { return Array.isArray(x) ? x : []; }

export default function CofounderPage() {
  const [tab, setTab] = useState('browse');
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadProfile() {
    setProfileLoading(true); setError(null);
    try {
      const p = await api.cofounderMe();
      setProfile(p);
    } catch (e) {
      if (e.status === 404) setProfile(null);
      else setError(e.message);
    }
    setProfileLoading(false);
  }

  useEffect(() => { loadProfile(); }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
          <Users className="w-7 h-7 text-blue-600" /> Co-founder matching
        </h1>
        <PageExplainer pageKey="cofounder_match" />
        <p className="text-sm text-slate-600 mt-1">
          Find a co-founder using mutual-interest reveal. Identities stay hidden until
          both sides express interest — at which point an NDA is auto-generated for
          each of you to countersign.
        </p>
      </header>

      <nav className="flex gap-2 border-b border-slate-200">
        {[
          ['browse', 'Browse', Search],
          ['connections', 'Connections', Heart],
          ['profile', profile ? 'My profile' : 'Create profile', FileText],
        ].map(([k, l, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
                  className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 -mb-px border-b-2 ${
                    tab === k
                      ? 'border-blue-600 text-blue-700'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}>
            <Icon className="w-4 h-4" /> {l}
          </button>
        ))}
      </nav>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">{error}</div>
      )}

      {tab === 'browse' && (
        <BrowseTab profile={profile} profileLoading={profileLoading}
                   onCreateProfile={() => setTab('profile')} />
      )}
      {tab === 'connections' && <ConnectionsTab />}
      {/* Task #51 — both BrowseCard and ConnectionCard render UserTrustBadge.
          The badge gates internally to admin/investor/partner viewers, so
          founder users (the primary audience here) silently see nothing
          while admin viewers exploring the directory get the score. */}
      {tab === 'profile' && (
        <ProfileTab profile={profile} loading={profileLoading} onSaved={loadProfile} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse
// ---------------------------------------------------------------------------
function BrowseTab({ profile, profileLoading, onCreateProfile }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [vocab, setVocab] = useState({ skills: [], sectors: [], commitments: [] });
  const [filters, setFilters] = useState({
    q: '', skill: '', sector: '', commitment: '', remote_only: false,
  });
  const [interestModal, setInterestModal] = useState(null);

  async function load() {
    if (!profile) return;
    setLoading(true); setErr(null);
    try {
      const r = await api.cofounderBrowse(filters);
      setItems(r.items || []);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  useEffect(() => { api.cofounderVocab().then(setVocab).catch(() => {}); }, []);
  useEffect(() => { if (profile) load(); /* eslint-disable-next-line */ }, [profile]);

  if (profileLoading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!profile) {
    return (
      <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
        <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="font-semibold text-slate-900 mb-2">Create a profile to browse</h3>
        <p className="text-sm text-slate-600 mb-4 max-w-md mx-auto">
          You need a co-founder profile before browsing candidates — fairness goes both
          ways. It only takes a minute.
        </p>
        <button onClick={onCreateProfile}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Create my profile
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" />
          <input value={filters.q}
                 onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                 onKeyDown={(e) => e.key === 'Enter' && load()}
                 placeholder="Search bios, skills, location…"
                 className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded text-sm" />
        </div>
        <select value={filters.skill} onChange={(e) => setFilters({ ...filters, skill: e.target.value })}
                className="border border-slate-300 rounded text-sm py-1.5 px-2">
          <option value="">Any skill</option>
          {vocab.skills.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.sector} onChange={(e) => setFilters({ ...filters, sector: e.target.value })}
                className="border border-slate-300 rounded text-sm py-1.5 px-2">
          <option value="">Any sector</option>
          {vocab.sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.commitment}
                onChange={(e) => setFilters({ ...filters, commitment: e.target.value })}
                className="border border-slate-300 rounded text-sm py-1.5 px-2">
          <option value="">Any commitment</option>
          {vocab.commitments.map((c) => <option key={c} value={c}>{COMMITMENT_LABEL[c] || c}</option>)}
        </select>
        <label className="text-sm flex items-center gap-1.5">
          <input type="checkbox" checked={filters.remote_only}
                 onChange={(e) => setFilters({ ...filters, remote_only: e.target.checked })} />
          Remote OK
        </label>
        <button onClick={load}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-slate-900 text-white rounded hover:bg-slate-700">
          <RefreshCw className="w-4 h-4" /> Apply
        </button>
      </div>

      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">{err}</div>}
      {loading && <div className="text-sm text-slate-500">Loading…</div>}
      {!loading && items.length === 0 && (
        <div className="text-center py-12 border border-dashed border-slate-300 rounded">
          <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500">No candidates match your filters yet.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((c) => (
          <BrowseCard key={c.uid} card={c}
                      onInterest={() => setInterestModal(c)} />
        ))}
      </div>

      {interestModal && (
        <InterestModal card={interestModal}
                       onClose={() => setInterestModal(null)}
                       onSent={() => { setInterestModal(null); load(); }} />
      )}
    </div>
  );
}

function BrowseCard({ card, onInterest }) {
  const { user } = useAuth();
  const skills = asArray(card.skills);
  const sectors = asArray(card.sectors);
  const reasons = asArray(card.match_reasons);
  return (
    <div className="border border-slate-200 rounded-lg bg-white p-4 hover:shadow-sm transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-slate-900">{card.handle}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
              {COMMITMENT_LABEL[card.commitment] || card.commitment}
            </span>
            {card.mutual_interest && (
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 flex items-center gap-1">
                <Heart className="w-3 h-3 fill-current" /> Mutual
              </span>
            )}
            {!card.mutual_interest && card.interest_received && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                They're interested
              </span>
            )}
            {card.interest_sent && !card.mutual_interest && (
              <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                Interest sent
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
            {(card.location_city || card.location_country) && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {[card.location_city, card.location_country].filter(Boolean).join(', ')}
              </span>
            )}
            {card.remote_ok && <span className="flex items-center gap-1"><Globe2 className="w-3 h-3" />Remote OK</span>}
            {(card.equity_expectation_min !== null || card.equity_expectation_max !== null) && (
              <span>Equity {card.equity_expectation_min ?? '?'}–{card.equity_expectation_max ?? '?'}%</span>
            )}
          </div>
        </div>
        <div className="text-right flex flex-col items-end gap-1">
          <span className="inline-flex items-center gap-1 text-xs text-blue-700 font-semibold">
            <Sparkles className="w-3 h-3" /> {card.match_score}
          </span>
          {/* Task #51 — admin/investor/partner viewers see the trust score
              (badge no-ops for founder viewers, who are the normal audience). */}
          <UserTrustBadge userId={card.user_id} viewerRole={user?.role} />
        </div>
      </div>

      {card.looking_for && (
        <p className="text-sm text-slate-700 mt-2 italic">"{card.looking_for}"</p>
      )}
      {card.bio && <p className="text-sm text-slate-600 mt-1 line-clamp-3">{card.bio}</p>}

      {(skills.length > 0 || sectors.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {skills.map((s) => (
            <span key={`sk-${s}`} className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
              <Briefcase className="w-3 h-3 inline mr-1" />{s}
            </span>
          ))}
          {sectors.map((s) => (
            <span key={`se-${s}`} className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100">
              {s}
            </span>
          ))}
        </div>
      )}

      {reasons.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-slate-500 cursor-pointer">Why we matched you ({reasons.length})</summary>
          <ul className="mt-1 ml-4 text-xs text-slate-600 list-disc">
            {reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </details>
      )}

      <div className="mt-3 flex justify-end">
        {card.interest_sent && !card.mutual_interest ? (
          <span className="text-xs text-slate-500 italic">Waiting for them to reciprocate</span>
        ) : card.mutual_interest ? (
          <span className="text-xs text-emerald-700">Connection created — see Connections tab</span>
        ) : (
          <button onClick={onInterest}
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700">
            <Heart className="w-4 h-4" /> I'm interested
          </button>
        )}
      </div>
    </div>
  );
}

function InterestModal({ card, onClose, onSent }) {
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      // NB: `card.user_uid` is the User.uid (the API target identifier);
      // `card.uid` is the CofounderProfile.uid (display only). Mixing
      // the two would 404 every interest click.
      const r = await api.cofounderExpressInterest({
        user_uid: card.user_uid, message: message || null,
      });
      if (r.mutual) {
        alert('Mutual interest! Head to the Connections tab to sign your NDA.');
      } else {
        alert('Interest sent. You\'ll see them in Connections once they reciprocate.');
      }
      // Spin-Out Lab — Week 3 milestone for first cofounder request sent.
      await markMilestone(user, 'cofounder_request_sent');
      onSent();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell title={`Express interest in ${card.handle}`} onClose={onClose}>
      <div className="space-y-3">
        {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{err}</div>}
        <p className="text-sm text-slate-600">
          Their identity stays hidden until they reciprocate. If they've already
          expressed interest in you, this will create a connection immediately and
          generate a mutual NDA for both of you to sign.
        </p>
        <Field label="Optional message (visible only after mutual interest)">
          <textarea rows={3} maxLength={500} value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Hi! I'd love to learn more about your idea — I'm a [role] with experience in [domain]…"
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 border border-slate-300 rounded">Cancel</button>
          <button onClick={submit} disabled={busy}
                  className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Sending…' : 'Send interest'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Connections + NDA
// ---------------------------------------------------------------------------
function ConnectionsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [ndaModal, setNdaModal] = useState(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await api.cofounderListConnections();
      setItems(r.items || []);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (err) return <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">{err}</div>;
  if (items.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-slate-300 rounded">
        <Heart className="w-10 h-10 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500">No mutual matches yet. Express interest in someone in the Browse tab.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((c) => (
        <ConnectionCard key={c.uid} conn={c}
                        onSign={() => setNdaModal(c)}
                        onClosed={load} />
      ))}
      {ndaModal && (
        <NdaSignModal conn={ndaModal}
                      onClose={() => setNdaModal(null)}
                      onSigned={() => { setNdaModal(null); load(); }} />
      )}
    </div>
  );
}

function ConnectionCard({ conn, onSign, onClosed }) {
  const { user } = useAuth();
  const isActive = conn.status === 'active';
  const isClosed = conn.status === 'closed';
  const cp = conn.counterparty || {};

  async function close() {
    const reason = window.prompt('Reason for closing this connection? (optional)');
    if (reason === null) return;
    try {
      await api.cofounderCloseConnection(conn.uid, reason);
      onClosed();
    } catch (e) { alert(e.message); }
  }

  return (
    <div className={`border rounded-lg p-4 bg-white ${isClosed ? 'opacity-60' : ''} ${isActive ? 'border-emerald-200' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900">
              {cp.name || cp.email || 'Counterparty'}
            </span>
            {cp.email && cp.name && <span className="text-xs text-slate-500">({cp.email})</span>}
            {isActive && (
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Active
              </span>
            )}
            {conn.status === 'pending_nda' && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 flex items-center gap-1">
                <Clock className="w-3 h-3" /> NDA pending
              </span>
            )}
            {isClosed && <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">Closed</span>}
            {/* Task #51 — counterparty trust score (admin/investor/partner only). */}
            <UserTrustBadge userId={cp.user_id} viewerRole={user?.role} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
            <span className="flex items-center gap-1">
              {conn.i_signed_at
                ? <><CheckCircle2 className="w-3 h-3 text-emerald-600" /> You signed</>
                : <><Clock className="w-3 h-3 text-amber-600" /> You haven't signed</>}
            </span>
            <span className="flex items-center gap-1">
              {conn.they_signed_at
                ? <><CheckCircle2 className="w-3 h-3 text-emerald-600" /> They signed</>
                : <><Clock className="w-3 h-3 text-amber-600" /> They haven't signed</>}
            </span>
          </div>
          {cp.profile && (
            <div className="mt-2 text-xs text-slate-500">
              {asArray(cp.profile.skills).slice(0, 5).map((s) => (
                <span key={s} className="inline-block mr-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{s}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {!isClosed && !conn.i_signed_at && (
            <button onClick={onSign}
                    className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 whitespace-nowrap">
              Sign NDA
            </button>
          )}
          {!isClosed && (
            <button onClick={close}
                    className="text-xs px-2 py-1 border border-rose-300 text-rose-700 rounded hover:bg-rose-50 whitespace-nowrap">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NdaSignModal({ conn, onClose, onSigned }) {
  const [doc, setDoc] = useState(null);
  const [signerName, setSignerName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.cofounderGetMyNda(conn.uid)
      .then((d) => { setDoc(d); setLoading(false); })
      .catch((e) => { setErr(e.message); setLoading(false); });
  }, [conn.uid]);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await api.cofounderSignNda(conn.uid, { signer_name: signerName, accepted });
      onSigned();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell title={doc?.title || 'Sign NDA'} onClose={onClose}>
      {loading && <div className="text-sm text-slate-500">Loading NDA…</div>}
      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{err}</div>}
      {doc && (
        <div className="space-y-3">
          <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 max-h-72 overflow-y-auto whitespace-pre-wrap font-sans">
            {doc.body}
          </pre>
          <Field label="Type your full legal name to sign">
            <input value={signerName} onChange={(e) => setSignerName(e.target.value)}
                   className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
          </Field>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={accepted}
                   onChange={(e) => setAccepted(e.target.checked)}
                   className="mt-0.5" />
            <span>I have read and agree to the terms of this Non-Disclosure Agreement.</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="text-sm px-3 py-1.5 border border-slate-300 rounded">Cancel</button>
            <button onClick={submit} disabled={busy || !accepted || !signerName}
                    className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Signing…' : 'Sign & submit'}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Profile editor
// ---------------------------------------------------------------------------
function ProfileTab({ profile, loading, onSaved }) {
  const empty = useMemo(() => ({
    skills: [], sectors: [], commitment: 'full_time',
    location_city: '', location_country: '', remote_ok: true,
    equity_expectation_min: '', equity_expectation_max: '',
    bio: '', looking_for: '', listed: true,
  }), []);
  const [form, setForm] = useState(empty);
  const [vocab, setVocab] = useState({ skills: [], sectors: [], commitments: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);

  useEffect(() => { api.cofounderVocab().then(setVocab).catch(() => {}); }, []);
  useEffect(() => {
    if (profile) {
      setForm({
        skills: asArray(profile.skills),
        sectors: asArray(profile.sectors),
        commitment: profile.commitment || 'full_time',
        location_city: profile.location_city || '',
        location_country: profile.location_country || '',
        remote_ok: !!profile.remote_ok,
        equity_expectation_min: profile.equity_expectation_min ?? '',
        equity_expectation_max: profile.equity_expectation_max ?? '',
        bio: profile.bio || '',
        looking_for: profile.looking_for || '',
        listed: !!profile.listed,
      });
    }
  }, [profile]);

  function toggle(arr, v) {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  async function submit() {
    setBusy(true); setErr(null); setOk(null);
    try {
      const payload = {
        ...form,
        equity_expectation_min: form.equity_expectation_min === '' ? null : Number(form.equity_expectation_min),
        equity_expectation_max: form.equity_expectation_max === '' ? null : Number(form.equity_expectation_max),
      };
      await api.cofounderUpsertMe(payload);
      setOk('Profile saved.');
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />{err}
      </div>}
      {ok && <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2">{ok}</div>}

      <Field label="Skills (what you bring)">
        <div className="flex flex-wrap gap-1">
          {vocab.skills.map((s) => (
            <button key={s} type="button"
                    onClick={() => setForm({ ...form, skills: toggle(form.skills, s) })}
                    className={`text-xs px-2 py-1 rounded border ${form.skills.includes(s)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
              {s}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Sectors of interest">
        <div className="flex flex-wrap gap-1">
          {vocab.sectors.map((s) => (
            <button key={s} type="button"
                    onClick={() => setForm({ ...form, sectors: toggle(form.sectors, s) })}
                    className={`text-xs px-2 py-1 rounded border ${form.sectors.includes(s)
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
              {s}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Commitment">
          <select value={form.commitment}
                  onChange={(e) => setForm({ ...form, commitment: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
            {(vocab.commitments.length > 0 ? vocab.commitments : ['full_time', 'part_time', 'exploring']).map((c) => (
              <option key={c} value={c}>{COMMITMENT_LABEL[c] || c}</option>
            ))}
          </select>
        </Field>
        <Field label="City">
          <input value={form.location_city}
                 onChange={(e) => setForm({ ...form, location_city: e.target.value })}
                 className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Country">
          <input value={form.location_country}
                 onChange={(e) => setForm({ ...form, location_country: e.target.value })}
                 className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={form.remote_ok}
               onChange={(e) => setForm({ ...form, remote_ok: e.target.checked })} />
        Open to remote co-founders
      </label>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Equity expectation min (%)">
          <input type="number" min={0} max={100} step={0.5}
                 value={form.equity_expectation_min}
                 onChange={(e) => setForm({ ...form, equity_expectation_min: e.target.value })}
                 className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Equity expectation max (%)">
          <input type="number" min={0} max={100} step={0.5}
                 value={form.equity_expectation_max}
                 onChange={(e) => setForm({ ...form, equity_expectation_max: e.target.value })}
                 className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </Field>
      </div>

      <Field label="One-line: what are you looking for?">
        <input value={form.looking_for} maxLength={400}
               onChange={(e) => setForm({ ...form, looking_for: e.target.value })}
               placeholder="Technical co-founder for B2B SaaS, ideally with fintech background"
               className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
      </Field>

      <Field label="Bio (visible to candidates)">
        <textarea rows={4} maxLength={2000} value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
      </Field>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={form.listed}
               onChange={(e) => setForm({ ...form, listed: e.target.checked })} />
        Listed in the directory (uncheck to pause without losing your profile)
      </label>

      <div className="flex justify-end pt-2">
        <button onClick={submit} disabled={busy}
                className="text-sm px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Saving…' : (profile ? 'Update profile' : 'Create profile')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
function ModalShell({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3 sticky top-0 bg-white">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
