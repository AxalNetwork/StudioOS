import React, { useEffect, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { api } from '../lib/api';
import { Users, Plus, Search, Copy, ChevronRight } from 'lucide-react';
import { UserDetailModal } from './AdminPage';
import VirtualList from '../components/VirtualList';
import UserTrustBadge from '../components/UserTrustBadge';
import { useAuth } from '../hooks/useAuthSync';

// T24 — measured from the existing <tr> with name + email-below + py-3.
// The virtualized branch (>=300 rows) renders div rows whose grid columns
// approximately match the table's natural column widths.
const PARTNER_ROW_HEIGHT = 64;
const PARTNER_GRID = 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 90px';

const RADAR_INTENTS = [
  { slug: 'product',          label: 'Product' },
  { slug: 'engineering',      label: 'Engineering' },
  { slug: 'design',           label: 'Design' },
  { slug: 'gtm_sales',        label: 'GTM / Sales' },
  { slug: 'marketing_brand',  label: 'Marketing / Brand' },
  { slug: 'finance_ops',      label: 'Finance / Ops' },
  { slug: 'legal_compliance', label: 'Legal / Compliance' },
  { slug: 'capital_network',  label: 'Capital / Network' },
];

export default function PartnersPage() {
  const { user } = useAuth();
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', company: '', specialization: '' });
  const [matchSector, setMatchSector] = useState('');
  const [matchIntent, setMatchIntent] = useState('');
  const [matches, setMatches] = useState(null);
  // openPartner: row from /partners (now augmented with user_id via LEFT JOIN).
  // We open the shared UserDetailModal when a linked user account exists.
  const [openPartner, setOpenPartner] = useState(null);

  const load = () => {
    setLoading(true);
    api.listPartners().then(setPartners).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const submit = async () => {
    try {
      await api.createPartner(form);
      setShowForm(false);
      setForm({ name: '', email: '', company: '', specialization: '' });
      load();
    } catch (e) { alert(e.message); }
  };

  const runMatch = async () => {
    try {
      const res = matchIntent
        ? await api.matchPartners(matchIntent)
        : await api.recommendPartners(matchSector);
      setMatches(res);
    } catch (e) { alert(e.message); }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1 dark:text-gray-100">Partner Ecosystem</h1>
        <PageExplainer pageKey="partners" />
          <p className="text-sm text-gray-600">Matchmaking, deal flow, and referral dashboard</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white">
          <Plus size={14} /> Add Partner
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 dark:bg-gray-900 dark:border-gray-800">
          <div className="grid md:grid-cols-2 gap-4">
            {['name', 'email', 'company', 'specialization'].map(field => (
              <div key={field}>
                <label className="block text-xs text-gray-600 mb-1 capitalize">{field}</label>
                <input type="text" value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100" />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={submit} className="px-4 py-2 bg-violet-600 rounded-lg text-sm text-white">Add</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-200 rounded-lg text-sm text-gray-900 dark:text-gray-100">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 dark:bg-gray-900 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-gray-100">
          <Search size={14} className="text-violet-600" /> Partner Matchmaking
        </h3>
        {/* T21 — Enter inside the input now submits the form. */}
        <form onSubmit={(e) => { e.preventDefault(); runMatch(); }} className="flex flex-col gap-3">
          <div className="flex gap-3">
            <select value={matchIntent} onChange={e => { setMatchIntent(e.target.value); setMatchSector(''); }}
              className="flex-none bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100 dark:bg-gray-800">
              <option value="">Select intent...</option>
              {RADAR_INTENTS.map(i => <option key={i.slug} value={i.slug}>{i.label}</option>)}
            </select>
            <input type="text" placeholder="Sector (e.g. AI, Blockchain)..." value={matchSector}
              onChange={e => { setMatchSector(e.target.value); setMatchIntent(''); }}
              className="flex-1 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100" />
            <button type="submit" className="px-4 py-2 bg-violet-600 rounded-lg text-sm text-white">Find Matches</button>
          </div>
        </form>
        {matches && (
          <div className="mt-3 text-sm text-gray-600">
            {matches.intent ? (
              <>
                <div className="mb-2 text-gray-900 font-medium dark:text-gray-100">Intent: {matches.intent}</div>
                <div className="text-gray-500 mb-1">Found <span className="text-gray-900 font-medium dark:text-gray-100">{matches.total_matched}</span> matching partner(s)</div>
              </>
            ) : (
              <div className="text-gray-500 mb-1">Found <span className="text-gray-900 font-medium dark:text-gray-100">{matches.count}</span> matching partner(s)</div>
            )}
            {matches.matches && matches.matches.map(m => (
              <div key={m.partner_id || m.id} className="mt-2 px-3 py-2 bg-gray-100 rounded-lg dark:bg-gray-800">
                <div className="flex items-center justify-between">
                  <span className="text-gray-900 font-medium dark:text-gray-100">{m.name}</span>
                  {m.match_score !== undefined && (
                    <span className="text-xs text-violet-600 font-semibold bg-violet-50 rounded px-2 py-0.5 dark:bg-violet-900/20">{m.match_score}</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{m.company} — {m.specialization}</div>
                {m.breakdown && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {Object.entries(m.breakdown).map(([k, v]) => (
                      <span key={k} className="text-[10px] text-gray-600 bg-gray-200 rounded px-1.5 py-0.5 dark:bg-gray-700 dark:text-gray-300">
                        {k.replace(/_/g, ' ')}: {v}
                      </span>
                    ))}
                  </div>
                )}
                {m.reasons && m.reasons.length > 0 && (
                  <div className="text-[11px] text-gray-500 mt-1">
                    {m.reasons.join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold text-gray-900 text-sm dark:text-gray-100">All Partners & Referral Dashboard</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-600 text-sm">Loading...</div>
        ) : (
          <VirtualList
            items={partners}
            itemHeight={PARTNER_ROW_HEIGHT}
            height={600}
            ariaLabel={`Partners list, ${partners.length} partners`}
            virtualRow={(p, _i, style, ariaAttributes) => (
              <div style={style} {...ariaAttributes}
                   onClick={() => setOpenPartner(p)}
                   className="hover:bg-violet-50/40 cursor-pointer group border-b border-gray-200 text-sm dark:border-gray-800"
                   >
                <div style={{ display: 'grid', gridTemplateColumns: PARTNER_GRID, alignItems: 'center', height: '100%' }}>
                  <div className="px-5 py-3 text-gray-900 min-w-0 dark:text-gray-100">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium truncate">{p.name}</span>
                      {/* Task #51 — trust badge inline on partner row for
                          admin/investor/partner viewers; UserTrustBadge
                          silently no-ops for other roles or unlinked rows. */}
                      <UserTrustBadge userId={p.user_id} viewerRole={user?.role} />
                      <ChevronRight size={12} className="text-gray-300 group-hover:text-violet-600 transition-colors shrink-0" />
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5 truncate">{p.email || p.user_email || '—'}</div>
                  </div>
                  <div className="px-5 py-3 hidden md:block text-gray-600 truncate">{p.company || '—'}</div>
                  <div className="px-5 py-3 hidden md:block text-gray-600 truncate">{p.specialization || '—'}</div>
                  <div className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => copyCode(p.referral_code)} className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-mono">
                      {p.referral_code} <Copy size={10} />
                    </button>
                  </div>
                  <div className="px-5 py-3 text-gray-900 font-medium dark:text-gray-100">{p.referrals_count}</div>
                </div>
              </div>
            )}
          >
            {(items) => (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-600 text-xs uppercase dark:border-gray-800">
                    <th className="text-left px-5 py-3">Partner</th>
                    <th className="text-left px-5 py-3 hidden md:table-cell">Company</th>
                    <th className="text-left px-5 py-3 hidden md:table-cell">Specialization</th>
                    <th className="text-left px-5 py-3">Referral Code</th>
                    <th className="text-left px-5 py-3">Referrals</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {items.map(p => (
                    <tr key={p.id} onClick={() => setOpenPartner(p)}
                        className="hover:bg-violet-50/40 cursor-pointer group">
                      <td className="px-5 py-3 text-gray-900 dark:text-gray-100">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{p.name}</span>
                          {/* Task #51 — trust badge inline on partner row for
                              admin/investor/partner viewers. */}
                          <UserTrustBadge userId={p.user_id} viewerRole={user?.role} />
                          <ChevronRight size={12} className="text-gray-300 group-hover:text-violet-600 transition-colors" />
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5">{p.email || p.user_email || '—'}</div>
                      </td>
                      <td className="px-5 py-3 hidden md:table-cell text-gray-600">{p.company || '—'}</td>
                      <td className="px-5 py-3 hidden md:table-cell text-gray-600">{p.specialization || '—'}</td>
                      <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => copyCode(p.referral_code)} className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-mono">
                          {p.referral_code} <Copy size={10} />
                        </button>
                      </td>
                      <td className="px-5 py-3 text-gray-900 font-medium dark:text-gray-100">{p.referrals_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </VirtualList>
        )}
      </div>
      {openPartner && openPartner.user_id && (
        <UserDetailModal
          userRow={{
            id: openPartner.user_id,
            name: openPartner.name,
            email: openPartner.user_email || openPartner.email,
            role: 'partner',
            is_active: openPartner.user_is_active,
            email_verified: openPartner.user_email_verified,
          }}
          onClose={() => setOpenPartner(null)}
          onImpersonate={() => setOpenPartner(null)}
          onToggleActive={() => setOpenPartner(null)}
        />
      )}
      {openPartner && !openPartner.user_id && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpenPartner(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 dark:bg-gray-900" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{openPartner.name}</h3>
            <p className="text-xs text-gray-500 mt-1">{openPartner.email || '—'}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Company</div><div className="text-gray-900 dark:text-gray-100">{openPartner.company || '—'}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Specialization</div><div className="text-gray-900 dark:text-gray-100">{openPartner.specialization || '—'}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Referral code</div><div className="text-gray-900 font-mono text-xs dark:text-gray-100">{openPartner.referral_code || '—'}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Referrals</div><div className="text-gray-900 dark:text-gray-100">{openPartner.referrals_count ?? 0}</div></div>
            </div>
            <div className="mt-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
              No user account is linked to this partner record yet. Once they register and an admin links the accounts, the full registration timeline, KYC, agreements, and activity history will appear here.
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setOpenPartner(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
