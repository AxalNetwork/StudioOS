import { Link } from 'react-router-dom';
import React, { useEffect, useRef, useState } from 'react';
import { reportError } from '../../../lib/log';
import { api } from '../../../lib/api';
import { X, FileText, Send, Download, Ban, Search, RefreshCw, Loader2, ShieldAlert } from 'lucide-react';
import { useToast } from '../../../components/useToast';
import ToastMessage from '../../../components/ToastMessage';
import { useEscapeClose } from '../../../components/useEscapeClose';
import { Unreadable } from '../../../ui';
import AdminTemplates from '../AdminTemplates';
import AdminForms from '../AdminForms';
import { Field, fmtDate, ConsoleUnreadable } from './shared';

/**
 * D648 (#1448) — the Legal console, as it was in `pages/AdminPage.jsx`.
 * Since D647 (#1441), Contracts (`pages/hq/ContractsPage.jsx`) renders its own
 * desk, `pages/admin/contracts/ContractsDesk.jsx`, and does not mount
 * `LegalPanel`; `/admin?tab=legal` redirects to `/admin/contracts?moved=legal`.
 */

// ===== Admin Contracts Management ======================================
const STATUS_PILL = {
  draft:     { label: 'DRAFT',     cls: 'bg-gray-100 text-gray-700' },
  generated: { label: 'GENERATED', cls: 'bg-sky-100 text-sky-700' },
  sent:      { label: 'PENDING',   cls: 'bg-amber-100 text-amber-700' },
  signed:    { label: 'SIGNED',    cls: 'bg-emerald-100 text-emerald-700' },
  void:      { label: 'VOID',      cls: 'bg-slate-200 text-slate-600' },
};

function StatusPill({ status }) {
  const s = STATUS_PILL[status] || STATUS_PILL.draft;
  return (
    <span className={`text-[10px] font-bold tracking-wide px-2.5 py-1 rounded-full ${s.cls}`}>{s.label}</span>
  );
}

// Task #5 (Z) — Friendly labels for the 15 new doc_types W/X/Y emit.
// Used as a fallback if the backend omits `doc_type_label`. Must stay
// in sync with `TEMPLATES` in cloudflare-worker/src/routes/admin_contracts.ts.
const NEW_DOC_TYPE_LABELS = {
  investor_nda_axal: 'Investor NDA (Axal VC)',
  mentor_nda_axal: 'Advisor NDA (Axal VC)',
  mentor_engagement_disclaimer: 'Advisor Engagement Disclaimer',
  partner_nda_nonsolicit: 'Partner NDA + Non-Solicit',
  partner_equity: 'Partner Equity Deal',
  partner_services: 'Partner Services Agreement',
  partner_revshare: 'Partner Revenue-Share Deal',
  partner_capital: 'Partner Capital Deal',
  partner_custom: 'Partner Custom Deal',
  finders_fee_intro_agreement: "Finder's Fee / Intro Agreement",
  nda_3way_founder_investor_axal: '3-Way NDA (Founder ↔ Investor ↔ Axal VC)',
  ip_background_schedule: 'IP Background Schedule',
  data_access_acknowledgment_admin: 'Data Access Acknowledgment (Admin)',
  investor_subscription_pro: 'Investor Subscription — Pro',
  investor_subscription_inst: 'Investor Subscription — Institutional',
};

const PARTY_ROLE_OPTIONS = [
  ['', 'All parties'],
  ['founder', 'Founder'],
  ['investor', 'Investor'],
  ['advisor', 'Advisor'],
  ['partner', 'Partner'],
  ['axal', 'Axal VC'],
];

export function LegalPanel() {
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [listUnreadable, setListUnreadable] = useState(false);
  const [pairwise, setPairwise] = useState([]);
  const [pairwiseUnreadable, setPairwiseUnreadable] = useState(false);
  const [partnerDeals, setPartnerDeals] = useState([]);
  const [partnerDealsUnreadable, setPartnerDealsUnreadable] = useState(false);
  const [partnerDealsNote, setPartnerDealsNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState('all'); // all | pending | signed | voided | pairwise | partner | templates | forms
  const [q, setQ] = useState('');
  const [docType, setDocType] = useState('');
  const [providerFilter, setProviderFilter] = useState(''); // '' | 'native' | 'docusign'
  const [partyRole, setPartyRole] = useState(''); // '' | founder | investor | advisor | partner | axal
  const [pwStatus, setPwStatus] = useState(''); // pairwise NDA status filter
  const [pwIntermediary, setPwIntermediary] = useState(''); // pairwise NDA relation/intermediary filter
  const [pdDealType, setPdDealType] = useState(''); // partner deal_type filter
  const [openContract, setOpenContract] = useState(null);
  const [showNewEnvelope, setShowNewEnvelope] = useState(false);
  const [openTplUsage, setOpenTplUsage] = useState(null); // { docType, fallback } — Task #8 usage chip

  const statusFilter = sub === 'pending' ? 'sent' : sub === 'signed' ? 'signed' : sub === 'voided' ? 'void' : '';
  const isListSub = sub === 'all' || sub === 'pending' || sub === 'signed' || sub === 'voided';

  const reload = async () => {
    setLoading(true);
    try {
      // Task #8 — the Templates sub-tab now self-loads from the store via
      // <AdminTemplates>, so it is no longer fetched here.
      const [s, list, , pw, pd] = await Promise.all([
        api.adminContractStats().catch(() => null),
        isListSub ? api.adminListContracts({ status: statusFilter, doc_type: docType, provider: providerFilter, party_role: partyRole, q, limit: 200 }) : Promise.resolve({ items: [] }),
        Promise.resolve(null),
        sub === 'pairwise' ? api.adminListPairwiseNdas({ status: pwStatus, intermediary: pwIntermediary }) : Promise.resolve(null),
        sub === 'partner' ? api.adminListPartnerDeals({ deal_type: pdDealType }) : Promise.resolve(null),
      ]);
      setStats(s);
      setItems(list?.items || []);
      setListUnreadable(false);
      setPairwiseUnreadable(false);
      setPartnerDealsUnreadable(false);
      if (sub === 'pairwise') {
        setPairwise(pw?.items || []);
      }
      if (sub === 'partner') {
        setPartnerDeals(pd?.items || []);
        setPartnerDealsNote(pd?.note || '');
      }
    } catch (e) {
      reportError('AdminPage:loadContracts', e);
      if (isListSub) setListUnreadable(true);
      if (sub === 'pairwise') {
        setPairwise([]);
        setPairwiseUnreadable(true);
      }
      if (sub === 'partner') {
        setPartnerDeals([]);
        setPartnerDealsUnreadable(true);
        setPartnerDealsNote('');
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [sub, statusFilter, docType, providerFilter, partyRole, pwStatus, pwIntermediary, pdDealType]);

  const onSearch = (e) => { e.preventDefault(); reload(); };

  const docTypeOptions = Array.from(new Set([
    ...(stats?.by_type || []).map(t => t.type),
  ])).sort();

  return (
    <div>
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <KpiTile label="Total"               value={stats?.total ?? '—'} />
        <KpiTile label="Pending Signature"   value={stats?.pending_signature ?? '—'} accent="amber" />
        <KpiTile label="Signed"              value={stats?.by_status?.signed ?? '—'} accent="emerald" />
        <KpiTile label="Avg Days to Sign"    value={stats?.avg_days_to_sign ?? '—'} />
        <KpiTile label="Signed Last 30d"     value={stats?.signed_last_30d ?? '—'} />
      </div>

      {/* Task #2 — Admin "All Contracts" reads from BOTH the legacy
          `documents` table AND the modern `esign_envelopes` table. The
          banner below explains the union view; rows are tagged with their
          source in `ContractRow` so admins can see which backing store
          a row came from while the migration is in flight. */}
      <div className="bg-violet-50 border border-violet-200 text-violet-900 text-xs rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
        <FileText size={14} className="mt-0.5 flex-shrink-0 text-violet-600" />
        <div>
          <span className="font-semibold">Unified contracts view.</span> This list shows agreements from both the legacy
          documents store and the e-sign envelope store (the system used for new sends). Resend, void, and download
          actions are dispatched to the correct backing store automatically.
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {[
          ['all',           'All Contracts'],
          ['pending',       'Sent / Pending'],
          ['signed',        'Signed'],
          ['voided',        'Voided'],
          ['pairwise',      'Pairwise NDAs'],
          ['partner',       'Partner Deals'],
          ['templates',     'Templates'],
          ['forms',         'Forms'],
        ].map(([k, label]) => (
          <button key={k} data-testid={`legal-sub-${k}`} onClick={() => setSub(k)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${sub === k ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-gray-200 text-gray-700 hover:border-violet-300'}`}>
            {label}
          </button>
        ))}
        <button onClick={() => setShowNewEnvelope(true)} className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center gap-1">
          <Send size={12} /> New envelope
        </button>
        <button onClick={reload} className="text-xs text-gray-500 hover:text-violet-600 flex items-center gap-1">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        Formation orders are in <Link to="/admin/spinout-lab" className="text-violet-600 underline dark:text-violet-400">Programs › Spin-Out Lab</Link>. Open its Formation orders tab.
      </p>

      {/* Filters (only on the contract-list sub-tabs) */}
      {isListSub && (
        <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search title, recipient, startup, template…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 dark:border-gray-800" />
          </div>
          <select value={docType} onChange={e => setDocType(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white dark:border-gray-800 dark:bg-gray-900">
            <option value="">All types</option>
            {docTypeOptions.map(t => <option key={t} value={t}>{NEW_DOC_TYPE_LABELS[t] || t}</option>)}
          </select>
          {/* Task #5 (Z) — party-role filter chip set. */}
          <select value={partyRole} onChange={e => setPartyRole(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white dark:border-gray-800 dark:bg-gray-900"
            title="Filter by which party the contract touches">
            {PARTY_ROLE_OPTIONS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
          </select>
          {/* Task #2 — provider filter chip. Lets admins separate
              DocuSign-routed envelopes from in-house ones at a glance. */}
          <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white overflow-hidden text-xs dark:border-gray-800 dark:bg-gray-900">
            {[['', 'All'], ['native', 'Native'], ['docusign', 'DocuSign']].map(([k, lbl]) => (
              <button
                key={k || 'all'}
                type="button"
                onClick={() => setProviderFilter(k)}
                className={`px-3 py-2 font-medium border-l first:border-l-0 border-gray-200 ${providerFilter === k ? 'bg-violet-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <button type="submit" className="px-3 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium">Search</button>
        </form>
      )}

      {loading ? (
        <div className="text-center text-gray-500 py-12 text-sm">Loading…</div>
      ) : isListSub && listUnreadable ? (
        <ConsoleUnreadable what="The agreements" onRetry={reload} />
      ) : sub === 'templates' ? (
        <AdminTemplates onOpenUsage={(docType, fallback) => setOpenTplUsage({ docType, fallback })} />
      ) : sub === 'pairwise' ? (
        pairwiseUnreadable ? (
          <Unreadable what="Pairwise NDAs" claim="This is not a claim that no pairwise NDAs exist." onRetry={reload} />
        ) : (
          <PairwiseNdasTable rows={pairwise} statusFilter={pwStatus} onStatusFilter={setPwStatus}
            intermediaryFilter={pwIntermediary} onIntermediaryFilter={setPwIntermediary}
            onOpen={(uid) => uid && setOpenContract({ uid })} />
        )
      ) : sub === 'partner' ? (
        partnerDealsUnreadable ? (
          <Unreadable what="Partner deals" claim="This is not a claim that no partner deals exist." onRetry={reload} />
        ) : (
          <PartnerDealsTable rows={partnerDeals} note={partnerDealsNote} dealTypeFilter={pdDealType} onDealTypeFilter={setPdDealType} />
        )
      ) : sub === 'forms' ? (
        <AdminForms />
      ) : items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">
          {sub === 'pending' && 'No contracts are currently awaiting signature. New sends will appear here within a few seconds.'}
          {sub === 'signed' && 'No signed contracts yet. Once a recipient completes signing, the contract will appear here with its signed-at timestamp.'}
          {sub === 'voided' && 'No voided contracts. When you void a sent contract its row appears here with the recorded reason.'}
          {sub === 'all' && 'No contracts found. Use New envelope to send an agreement.'}
          {sub !== 'pending' && sub !== 'signed' && sub !== 'voided' && sub !== 'all' && 'No contracts found for this filter.'}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(c => <ContractRow key={c.uid} c={c} onOpen={() => setOpenContract(c)} />)}
        </div>
      )}

      {openContract && (
        sub === 'signed' && openContract.source === 'esign' ? (
          <SignedDocLightbox
            uid={openContract.uid}
            onClose={() => setOpenContract(null)}
            onChanged={(opts) => {
              if (!opts || !opts.keepOpen) setOpenContract(null);
              reload();
            }}
          />
        ) : (
          <ContractDetailModal
            uid={openContract.uid}
            onClose={() => setOpenContract(null)}
            onChanged={(opts) => {
              if (!opts || !opts.keepOpen) setOpenContract(null);
              reload();
            }}
          />
        )
      )}

      {showNewEnvelope && (
        <NewEnvelopeWizard onClose={() => setShowNewEnvelope(false)} onSent={() => { setShowNewEnvelope(false); reload(); }} />
      )}

      {openTplUsage && (
        <TemplateUsageModal
          docType={openTplUsage.docType}
          fallback={openTplUsage.fallback}
          onClose={() => setOpenTplUsage(null)}
        />
      )}
    </div>
  );
}

// Task #5 (Z) — Pairwise NDAs tab. Lists every founder ↔ investor NDA
// pair from `pairwise_ndas`, joined to user emails on both sides.
// Clicking the envelope link opens the existing ContractDetailModal.
function PairwiseNdasTable({ rows, statusFilter, onStatusFilter, intermediaryFilter, onIntermediaryFilter, onOpen }) {
  const STATUS_OPTIONS = [
    ['', 'All statuses'],
    ['pending', 'Pending'],
    ['partially_signed', 'Partially signed'],
    ['active', 'Active'],
    ['expired', 'Expired'],
    ['revoked', 'Revoked'],
  ];
  const RELATION_OPTIONS = [
    ['', 'All relations'],
    ['axal', 'Via Axal VC'],
    ['direct', 'Direct'],
    ['partner', 'Via Partner'],
  ];
  const filterBar = (
    <div className="flex items-center gap-2 mb-2">
      <select value={statusFilter} onChange={e => onStatusFilter(e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white dark:border-gray-800 dark:bg-gray-900">
        {STATUS_OPTIONS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
      </select>
      <select value={intermediaryFilter} onChange={e => onIntermediaryFilter(e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white dark:border-gray-800 dark:bg-gray-900"
        title="Filter by intermediary / relation type">
        {RELATION_OPTIONS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
      </select>
    </div>
  );
  if (!rows || rows.length === 0) {
    return (
      <div>
        {filterBar}
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">
          No pairwise NDAs on record yet. Investor intro requests create a pair here once the founder accepts.
        </div>
      </div>
    );
  }
  const STATUS_PILLS = {
    pending: 'bg-amber-100 text-amber-700',
    partially_signed: 'bg-amber-100 text-amber-700',
    active: 'bg-emerald-100 text-emerald-700',
    expired: 'bg-gray-100 text-gray-600',
    revoked: 'bg-red-100 text-red-700',
  };
  return (
    <div>
      {filterBar}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-600">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium">Founder</th>
            <th className="text-left px-4 py-2.5 font-medium">Investor</th>
            <th className="text-center px-4 py-2.5 font-medium">Status</th>
            <th className="text-left px-4 py-2.5 font-medium">Valid Until</th>
            <th className="text-left px-4 py-2.5 font-medium">Last Activity</th>
            <th className="text-right px-4 py-2.5 font-medium">Envelope</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-4 py-3"><div className="text-gray-900 dark:text-gray-100">{r.party_a_name || '—'}</div><div className="text-xs text-gray-500">{r.party_a_email || `user #${r.party_a_user_id}`}</div></td>
              <td className="px-4 py-3"><div className="text-gray-900 dark:text-gray-100">{r.party_b_name || '—'}</div><div className="text-xs text-gray-500">{r.party_b_email || `user #${r.party_b_user_id}`}</div></td>
              <td className="px-4 py-3 text-center">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILLS[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">{fmtDate(r.valid_until) || '—'}</td>
              <td className="px-4 py-3 text-xs text-gray-600">{fmtDate(r.updated_at)}</td>
              <td className="px-4 py-3 text-right">
                {r.envelope_uuid ? (
                  <button onClick={() => onOpen(r.envelope_uuid)} className="text-xs text-violet-700 hover:text-violet-900 font-medium">Open contract</button>
                ) : <span className="text-xs text-gray-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// Task #5 (Z) — Partner Deals tab. The X-1 backend creates `partner_deals`
// rows; this surface lists them. Until X-1 lands the backend returns
// {items:[], note:"..."} which we render as a friendly empty state.
function PartnerDealsTable({ rows, note, dealTypeFilter, onDealTypeFilter }) {
  const DEAL_TYPE_OPTIONS = [
    ['', 'All deal types'],
    ['equity', 'Equity'],
    ['services', 'Services'],
    ['revshare', 'Rev-share'],
    ['capital', 'Capital'],
    ['custom', 'Custom'],
  ];
  const filterBar = (
    <div className="flex items-center gap-2 mb-2">
      <select value={dealTypeFilter} onChange={e => onDealTypeFilter(e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white dark:border-gray-800 dark:bg-gray-900">
        {DEAL_TYPE_OPTIONS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
      </select>
    </div>
  );
  if (!rows || rows.length === 0) {
    return (
      <div>
        {filterBar}
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">
          No partner deals on record yet.
          {note && <div className="mt-2 text-[11px] text-gray-400">{note}</div>}
        </div>
      </div>
    );
  }
  return (
    <div>
      {filterBar}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-600">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium">Partner</th>
            <th className="text-left px-4 py-2.5 font-medium">Deal Type</th>
            <th className="text-center px-4 py-2.5 font-medium">Term</th>
            <th className="text-left px-4 py-2.5 font-medium">Granted Tiers</th>
            <th className="text-center px-4 py-2.5 font-medium">Redemptions</th>
            <th className="text-center px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-4 py-3"><div className="text-gray-900 dark:text-gray-100">{r.partner_name || '—'}</div><div className="text-xs text-gray-500">{r.partner_email}</div></td>
              <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{r.deal_type}</td>
              <td className="px-4 py-3 text-center text-gray-600">{r.term_months ? `${r.term_months}mo` : '—'}</td>
              <td className="px-4 py-3 text-xs text-gray-600">{r.granted_tiers || '—'}</td>
              <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{r.redemption_count ?? 0}</td>
              <td className="px-4 py-3 text-center"><span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:text-gray-300">{r.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// Task #5 (Z) — Admin "Create envelope" wizard.
// Picks one of the legal templates from /admin/contracts/templates/legal,
// collects recipient + (optional) deal_id, and POSTs to the existing
// /api/legal/esign/send route which mints + emails the envelope.
function NewEnvelopeWizard({ onClose, onSent }) {
  useEscapeClose(onClose);
  const [templates, setTemplates] = useState([]);
  const [docType, setDocType] = useState('');
  // Task #5 (Z) — full create flow per spec: support N recipients
  // (one row per pair of email + optional name) + a merge-field
  // editor. Each row is sent as its own envelope to /api/legal/esign/send
  // since the route is single-recipient today.
  const [recipients, setRecipients] = useState([{ email: '', name: '' }]);
  const [mergeFieldsRaw, setMergeFieldsRaw] = useState('');
  const [dealId, setDealId] = useState('');
  const [provider, setProvider] = useState('native');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState(null);
  // Templates endpoint is worker-only (`/admin/contracts/templates/legal`).
  // The dev FastAPI backend doesn't host it, so the catalog fetch 404s
  // there. We track that case separately so the modal shows a calm
  // "unavailable in this environment" message rather than a scary
  // "Not found" red banner above an empty dropdown.
  const [templatesUnavailable, setTemplatesUnavailable] = useState(false);

  useEffect(() => {
    api.adminListLegalTemplates()
      .then(r => { setTemplates(r.items || []); if (r.items?.[0]) setDocType(r.items[0].doc_type); })
      .catch(e => {
        if (e?.status === 404) {
          setTemplatesUnavailable(true);
        } else {
          setErr(e.message);
        }
      });
  }, []);

  const updateRecipient = (idx, patch) => {
    setRecipients(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };
  const addRecipient = () => setRecipients(rs => [...rs, { email: '', name: '' }]);
  const removeRecipient = (idx) => setRecipients(rs => rs.length === 1 ? rs : rs.filter((_, i) => i !== idx));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!docType) { setErr('Template is required.'); return; }
    const cleaned = recipients
      .map(r => ({ email: r.email.trim().toLowerCase(), name: r.name.trim() }))
      .filter(r => r.email);
    if (cleaned.length === 0) { setErr('At least one recipient email is required.'); return; }
    let mergeFields;
    if (mergeFieldsRaw.trim()) {
      try { mergeFields = JSON.parse(mergeFieldsRaw); }
      catch { setErr('Merge fields must be valid JSON (e.g. {"company_name":"Axal VC"}).'); return; }
    }
    setBusy(true);
    setProgress({ done: 0, total: cleaned.length });
    try {
      for (let i = 0; i < cleaned.length; i++) {
        const r = cleaned[i];
        await api.adminSendEnvelope({
          document_type: docType,
          recipient_email: r.email,
          recipient_name: r.name || undefined,
          deal_id: dealId ? Number(dealId) : undefined,
          merge_fields: mergeFields,
          provider,
        });
        setProgress({ done: i + 1, total: cleaned.length });
      }
      onSent();
    } catch (ex) {
      setErr(`After ${progress?.done ?? 0}/${cleaned.length} envelopes: ${ex.message}`);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col dark:bg-gray-900">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between dark:border-gray-800">
          <div className="flex items-center gap-2"><Send size={16} className="text-emerald-600" /><h3 className="font-semibold text-gray-900 dark:text-gray-100">New envelope (admin)</h3></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-5 py-4 space-y-3 overflow-y-auto">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">{err}</div>}
          {templatesUnavailable && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-2 rounded">
              The legal template catalog isn't available in this environment. Envelope creation runs against the production worker — try again from the deployed app.
            </div>
          )}
          {progress && busy && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs p-2 rounded">Sending… {progress.done} / {progress.total}</div>}
          <label className="block">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Template</span>
            <select value={docType} onChange={e => setDocType(e.target.value)} required
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white dark:border-gray-800 dark:bg-gray-900">
              {templates.length === 0 && (
                <option value="">{templatesUnavailable ? 'Unavailable in this environment' : 'Loading…'}</option>
              )}
              {templates.map(t => <option key={t.key} value={t.doc_type}>{t.title}</option>)}
            </select>
          </label>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Recipients ({recipients.length})</span>
              <button type="button" onClick={addRecipient} className="text-xs text-emerald-700 hover:text-emerald-900 font-medium">+ Add recipient</button>
            </div>
            <div className="space-y-2">
              {recipients.map((r, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input type="email" required={idx === 0} value={r.email} onChange={e => updateRecipient(idx, { email: e.target.value })}
                    placeholder="recipient@example.com"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg dark:border-gray-800" />
                  <input value={r.name} onChange={e => updateRecipient(idx, { name: e.target.value })}
                    placeholder="Name (optional)"
                    className="w-40 px-3 py-2 text-sm border border-gray-200 rounded-lg dark:border-gray-800" />
                  {recipients.length > 1 && (
                    <button type="button" onClick={() => removeRecipient(idx)} className="text-gray-400 hover:text-red-600" title="Remove"><X size={14} /></button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-1">Each recipient receives their own envelope with the same template.</p>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Merge fields (optional, JSON)</span>
            <textarea value={mergeFieldsRaw} onChange={e => setMergeFieldsRaw(e.target.value)} rows={3}
              placeholder='{"company_name":"Acme Inc","effective_date":"2026-05-10"}'
              className="mt-1 w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg dark:border-gray-800" />
            <span className="text-[10px] text-gray-500">Forwarded to the e-sign send route as <code>merge_fields</code> for template substitution.</span>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Linked deal_id (optional)</span>
            <input type="number" value={dealId} onChange={e => setDealId(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg dark:border-gray-800" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Provider</span>
            <select value={provider} onChange={e => setProvider(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white dark:border-gray-800 dark:bg-gray-900">
              <option value="native">Native (in-app signing)</option>
              <option value="docusign">DocuSign (Raise + Grow plan)</option>
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg dark:bg-gray-900 dark:border-gray-800">Cancel</button>
            <button type="submit" disabled={busy} className="px-3 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-lg flex items-center gap-1.5">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send {recipients.filter(r => r.email).length || 0} envelope(s)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function KpiTile({ label, value, accent }) {
  const accentCls = accent === 'amber' ? 'text-amber-700'
                  : accent === 'emerald' ? 'text-emerald-700'
                  : 'text-gray-900';
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 dark:bg-gray-900 dark:border-gray-800">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-0.5 ${accentCls}`}>{value}</div>
    </div>
  );
}

function ContractRow({ c, onOpen }) {
  return (
    <button onClick={onOpen}
      className="w-full text-left bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-violet-300 hover:shadow-sm transition-all dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900 truncate dark:text-gray-100">{c.title}</div>
          <div className="text-xs text-gray-600 mt-0.5">
            Recipient · <span className="text-gray-800 dark:text-gray-200">{c.recipient_email || '—'}</span>
            {c.project_name && <> · Startup · <span className="text-gray-800 dark:text-gray-200">{c.project_name}</span></>}
          </div>
          <div className="flex items-center gap-4 text-[11px] text-gray-500 mt-1.5">
            <span>Created: {fmtDate(c.created_at) || '—'}</span>
            <span>Signed: {fmtDate(c.signed_at) || '—'}</span>
            {c.days_to_sign != null && <span>Days to sign: <span className="text-gray-700 font-medium dark:text-gray-300">{c.days_to_sign}</span></span>}
          </div>
          {/* Task #45 — surface the recorded void reason directly on the row
              so admins scanning the Voided sub-tab don't have to open the
              detail modal for each row. Truncated to 60 chars with the full
              text in a hover tooltip; full text also still appears in the
              detail modal (Task #19). */}
          {c.status === 'void' && c.void_reason && (
            <div className="mt-1.5 flex items-start gap-1.5 text-[11px]" title={c.void_reason}>
              <Ban size={11} className="text-red-600 mt-0.5 flex-shrink-0" />
              <span className="text-red-700 font-medium">Reason:</span>
              <span className="text-red-900 truncate">
                {c.void_reason.length > 60 ? `${c.void_reason.slice(0, 60)}…` : c.void_reason}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {c.source === 'esign' && c.provider !== 'docusign' && (
            <span title="Stored in esign_envelopes (modern e-sign flow)"
              className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded uppercase tracking-wider">
              eSign
            </span>
          )}
          {c.provider === 'docusign' && (
            <span title="Routed through DocuSign — recipient signs in DocuSign's UI."
              className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded uppercase tracking-wider">
              DocuSign
            </span>
          )}
          <StatusPill status={c.status} />
        </div>
      </div>
    </button>
  );
}

// Detail modal for a single template card. Lists every contract/envelope
// that has used this template across the 4-source union, with a small
// stats header (total/sent/signed/voided/avg-days-to-sign). Each row is
// clickable and opens the existing ContractDetailModal so admins can
// drill all the way through (resend / void / download / share-link)
// without leaving the modal stack.
export function TemplateUsageModal({ docType, fallback, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [openContract, setOpenContract] = useState(null);
  // Modal-stack guard: when the inner ContractDetailModal is mounted,
  // backdrop clicks and Escape must close ONLY the inner modal, not
  // collapse the entire stack. Both events bubble to window/document
  // (Escape) and to the outer overlay div (click), so we no-op the
  // outer close handler whenever a child modal is open.
  useEscapeClose(openContract ? () => {} : onClose);

  const reload = async () => {
    setLoading(true); setErr('');
    try {
      const r = await api.adminContractTemplateUsage(docType, { limit: 200 });
      setData(r);
    } catch (e) {
      setErr(e.message || 'Failed to load template usage.');
      reportError('TemplateUsageModal:load', e);
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [docType]);

  const tpl = data?.template || { title: fallback?.title, layer_label: fallback?.layer_label, doc_type: docType, key: docType };
  const stats = data?.stats;
  const items = data?.items || [];

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={() => { if (!openContract) onClose(); }}>
      <div onClick={e => e.stopPropagation()} className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[88vh] overflow-hidden flex flex-col dark:bg-gray-900">
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3 dark:border-gray-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <FileText size={16} className="text-violet-600" />
              <h3 className="font-semibold text-gray-900 truncate dark:text-gray-100">{tpl.title}</h3>
              <span className="text-[10px] font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">
                {stats ? `${stats.total} use${stats.total === 1 ? '' : 's'}` : '…'}
              </span>
            </div>
            <div className="text-xs text-gray-500">
              {tpl.layer_label}
              <span className="font-mono text-gray-400 ml-2">{tpl.doc_type}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">{err}</div>}

          {/* Stats header */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <StatBox label="Pending" value={stats.pending_signature} accent="amber" />
              <StatBox label="Signed" value={stats.by_status.signed} accent="emerald" />
              <StatBox label="Voided" value={stats.by_status.void} accent="rose" />
              <StatBox label="Signed (30d)" value={stats.signed_last_30d} accent="violet" />
              <StatBox label="Avg days to sign" value={stats.avg_days_to_sign ?? '—'} accent="slate" />
            </div>
          )}

          {/* Usage list */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Envelopes using this template
              {stats?.last_used_at && (
                <span className="ml-2 normal-case font-normal text-gray-400">
                  · last used {fmtDate(stats.last_used_at)}
                </span>
              )}
            </div>
            {loading ? (
              <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">Loading…</div>
            ) : items.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">
                This template hasn't been used yet. Use New envelope in Contracts to send an agreement.
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-xl dark:border-gray-800">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Recipient</th>
                      <th className="text-left px-3 py-2 font-medium">Startup</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                      <th className="text-left px-3 py-2 font-medium">Sent</th>
                      <th className="text-left px-3 py-2 font-medium">Signed</th>
                      <th className="text-left px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {items.map(c => (
                      <tr key={c.uid} className="hover:bg-violet-50/40 cursor-pointer" onClick={() => setOpenContract(c)}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900 truncate max-w-[200px] dark:text-gray-100" title={c.recipient_email || '—'}>
                            {c.recipient_email || c.signed_by || '—'}
                          </div>
                          {c.title && c.title !== c.recipient_email && (
                            <div className="text-[10px] text-gray-500 truncate max-w-[200px]" title={c.title}>{c.title}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600 truncate max-w-[160px]">{c.project_name || '—'}</td>
                        <td className="px-3 py-2"><StatusPill status={c.status} /></td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtDate(c.created_at) || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {c.signed_at ? (
                            <span title={c.signed_by || ''}>
                              {fmtDate(c.signed_at)}
                              {c.signed_by && <div className="text-[10px] text-gray-500 truncate max-w-[140px]">by {c.signed_by}</div>}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-[10px] uppercase tracking-wide text-gray-500 font-mono">{c.source}</span>
                          {c.provider === 'docusign' && (
                            <span className="ml-1 text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">DocuSign</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" className="text-violet-700 hover:text-violet-900 font-medium">Open →</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {openContract && (
        <ContractDetailModal
          uid={openContract.uid}
          onClose={() => setOpenContract(null)}
          onChanged={(opts) => {
            reload();
            if (!opts || !opts.keepOpen) setOpenContract(null);
          }}
        />
      )}
    </div>
  );
}

function StatBox({ label, value, accent = 'slate' }) {
  const colors = {
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    rose: 'bg-rose-50 border-rose-200 text-rose-800',
    violet: 'bg-violet-50 border-violet-200 text-violet-800',
    slate: 'bg-gray-50 border-gray-200 text-gray-800',
  }[accent] || 'bg-gray-50 border-gray-200 text-gray-800';
  return (
    <div className={`border rounded-lg px-3 py-2 ${colors}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-75">{label}</div>
      <div className="text-lg font-bold leading-tight">{value}</div>
    </div>
  );
}

function ContractDetailModal({ uid, onClose, onChanged }) {
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Task #5 (Z) — void now requires a recorded reason; the modal opens
  // a small confirmation sheet to capture it before the API call.
  const [showVoidReason, setShowVoidReason] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.adminGetContract(uid);
        if (!cancelled) setDoc(d);
      } catch (e) { if (!cancelled) setErr(e.message); }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  const doResend = async () => {
    if (!confirm('Resend this contract to the recipient?')) return;
    setBusy(true); setErr('');
    try { await api.adminResendContract(uid); onChanged(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  const submitVoid = async () => {
    if (voidReason.trim().length < 5) { setErr('Reason must be at least 5 characters.'); return; }
    setBusy(true); setErr('');
    try {
      // Task #19 — keep the modal open after voiding so the recorded
      // reason is surfaced inline. The list behind it still refreshes
      // so the row's status pill flips to VOID immediately.
      await api.adminVoidContractWithReason(uid, voidReason.trim());
      const refreshed = await api.adminGetContract(uid).catch(() => null);
      if (refreshed) setDoc(refreshed);
      setShowVoidReason(false);
      setVoidReason('');
      setBusy(false);
      if (typeof onChanged === 'function') onChanged({ keepOpen: true });
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const doDownload = () => {
    const url = api.adminDownloadContractUrl(uid);
    const token = localStorage.getItem('token');
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob().then(b => ({ b, ct: r.headers.get('Content-Disposition') })))
      .then(({ b, ct }) => {
        const m = (ct || '').match(/filename="([^"]+)"/);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = m ? m[1] : `contract_${uid.slice(0, 8)}.txt`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      })
      .catch(e => setErr(e.message));
  };
  const doShareLink = async () => {
    setErr('');
    try {
      const { url, expires_in } = await api.adminIssueContractShareLink(uid, 600);
      const fullUrl = window.location.origin + url;
      try { await navigator.clipboard.writeText(fullUrl); } catch {}
      alert(`Share link copied to clipboard.\nValid for ${Math.round(expires_in / 60)} minutes:\n\n${fullUrl}`);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col dark:bg-gray-900">
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3 dark:border-gray-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <FileText size={16} className="text-violet-600" />
              <h3 className="font-semibold text-gray-900 truncate dark:text-gray-100">{doc?.title || 'Contract'}</h3>
              {doc && <StatusPill status={doc.status} />}
            </div>
            <div className="text-xs text-gray-500">
              {doc?.doc_type_label || NEW_DOC_TYPE_LABELS[doc?.doc_type] || doc?.doc_type}
              {doc?.template_name ? ` · ${doc.template_name}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">{err}</div>}
          {!doc ? (
            <div className="text-center text-gray-500 text-sm py-8">Loading…</div>
          ) : (
            <>
              {/* Task #19 — surface the recorded void reason whenever the
                  contract is in a void state. Server reads the latest
                  `contract_voided` entry from activity_logs, so this also
                  shows for contracts voided in earlier sessions. */}
              {doc.status === 'void' && doc.void_reason && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-red-700 uppercase tracking-wide mb-1">
                    <Ban size={11} /> Voided{doc.voided_at ? ` · ${fmtDate(doc.voided_at)}` : ''}
                  </div>
                  <div className="text-xs text-red-900 whitespace-pre-wrap break-words">{doc.void_reason}</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Recipient"   value={doc.recipient_email} />
                <Field label="Startup"     value={doc.project_name} />
                <Field label="Signed by"   value={doc.signed_by} />
                <Field label="Signed at"   value={fmtDate(doc.signed_at)} />
                <Field label="Created"     value={fmtDate(doc.created_at)} />
                <Field label="Days to sign" value={doc.days_to_sign != null ? String(doc.days_to_sign) : '—'} />
              </div>
              <div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Content</div>
                {/* Security #8: body is no longer inlined. Use the
                    Download button in the footer (which streams via the
                    short-lived signed URL) to view the file. */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-[11px] text-gray-500 dark:border-gray-800">
                  Body lives in object storage. Use <span className="font-semibold text-gray-700 dark:text-gray-300">Download</span> below to retrieve it via a short-lived link.
                  {doc.file_size != null && <span className="block mt-1 text-gray-400">{(doc.file_size / 1024).toFixed(1)} KB · sha256 admin-only</span>}
                </div>
              </div>
            </>
          )}
        </div>

        {doc && (
          <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex flex-wrap gap-2 justify-end dark:border-gray-800">
            {/* Task #3 — pairwise NDAs and partner deals are union rows
                with no signed-PDF artefact and no single recipient/
                signing token. The backend returns deterministic 4xx for
                download/resend/void on those sources, so we hide those
                buttons here to avoid a confusing toast-on-click. */}
            {(!doc.source || doc.source === 'documents' || doc.source === 'esign') && (
              <>
                <button onClick={doDownload} className="px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:border-violet-300 flex items-center gap-1.5 dark:bg-gray-900 dark:border-gray-800">
                  <Download size={13} /> Download
                </button>
                <button onClick={doShareLink} className="px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:border-violet-300 flex items-center gap-1.5 dark:bg-gray-900 dark:border-gray-800" title="Generates a 10-minute signed link">
                  <Send size={13} /> Share link
                </button>
              </>
            )}
            {(doc.source === 'pairwise_nda' || doc.source === 'partner_deal') && (
              <div className="text-[11px] text-gray-500 italic mr-auto">
                {doc.source === 'pairwise_nda'
                  ? 'Pairwise NDA pair — manage from the Pairwise NDAs tab.'
                  : 'Partner deal — manage from the Partner Deals tab.'}
              </div>
            )}
            {/* Task #5 (Z) — Open in DD deep-link. Surfaces only when the
                worker has linked the envelope to dd_findings (column on
                migration 026). */}
            {doc.dd_case_uid && (
              <a href={`/admin/due-diligence/${doc.dd_case_uid}`}
                 className="px-3 py-2 text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded-lg hover:bg-amber-100 flex items-center gap-1.5"
                 title={`${doc.dd_findings_count || 0} related finding(s)`}>
                <ShieldAlert size={13} /> Open in DD ({doc.dd_findings_count || 0})
              </a>
            )}
            {/* Task #5 (Z) v2 — gate resend on the backend-supplied
                `can_resend` flag (which uses the raw envelope status,
                so partially-signed envelopes correctly do NOT show
                the button even though they collapse to `sent` in the
                unified status field). */}
            {doc.can_resend && (
              <button onClick={doResend} disabled={busy} className="px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:border-violet-300 flex items-center gap-1.5 dark:bg-gray-900 dark:border-gray-800">
                <Send size={13} /> Resend
              </button>
            )}
            {doc.status !== 'signed' && doc.status !== 'void' && doc.status !== 'completed'
              && doc.source !== 'pairwise_nda' && doc.source !== 'partner_deal' && (
              <button onClick={() => setShowVoidReason(true)} disabled={busy} className="px-3 py-2 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 flex items-center gap-1.5">
                <Ban size={13} /> Void
              </button>
            )}
          </div>
        )}
        {showVoidReason && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 dark:bg-gray-900">
              <div className="flex items-center gap-2 mb-3">
                <Ban size={16} className="text-red-600" />
                <h4 className="font-semibold text-gray-900 dark:text-gray-100">Void contract</h4>
              </div>
              <p className="text-xs text-gray-600 mb-3">
                Voiding is irreversible — the recipient's signing link will stop working.
                Please record the reason for audit (≥ 5 characters). It will be written
                to <code className="text-[10px] bg-gray-100 px-1 rounded">activity_logs</code>
                and mirrored into <code className="text-[10px] bg-gray-100 px-1 rounded">dd_audit_log</code>
                if this contract is linked to a due-diligence finding.
              </p>
              <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)}
                rows={3} placeholder="e.g. Recipient never returned signature; new envelope sent under amended terms."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg dark:border-gray-800" />
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => { setShowVoidReason(false); setVoidReason(''); setErr(''); }}
                  className="px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg dark:bg-gray-900 dark:border-gray-800">Cancel</button>
                <button onClick={submitVoid} disabled={busy || voidReason.trim().length < 5}
                  className="px-3 py-2 text-xs font-medium bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg flex items-center gap-1.5">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Void contract
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Task #14 — Full-screen lightbox for signed eSign documents. PDF preview
// in an iframe + metadata/audit sidebar + "Forward to legal partner" action.
// Only opens from the Signed sub-tab when the source is 'esign'.
export function SignedDocLightbox({ uid, onClose, onChanged }) {
  const [doc, setDoc] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [forwards, setForwards] = useState([]);
  const [showForward, setShowForward] = useState(false);
  const [fwEmails, setFwEmails] = useState('');
  const [fwMessage, setFwMessage] = useState('');
  const [fwIncludeAudit, setFwIncludeAudit] = useState(true);
  const [fwBusy, setFwBusy] = useState(false);
  const [fwErr, setFwErr] = useState('');
  const { toast, showToast } = useToast(3000);
  const pdfUrlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.adminGetContract(uid);
        if (cancelled) return;
        setDoc(d);
        if (d?.id && d?.source === 'esign') {
          const blob = await api.adminDownloadEsignDocumentBlob(d.id);
          if (!cancelled) {
            const url = URL.createObjectURL(blob);
            pdfUrlRef.current = url;
            setPdfUrl(url);
          }
        }
      } catch (e) { if (!cancelled) setErr(e.message); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => {
      cancelled = true;
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, [uid]);

  useEffect(() => {
    if (!doc || !doc.id || doc.source !== 'esign') return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.adminGetForwardLog(doc.id);
        if (!cancelled) setForwards(r.forwards || []);
      } catch (e) { if (!cancelled) reportError('AdminPage:forward-log', e); }
    })();
    return () => { cancelled = true; };
  }, [doc]);

  const submitForward = async () => {
    const recipients = fwEmails.split(/[,\s]+/).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e));
    if (!recipients.length) { setFwErr('Enter at least one valid email address.'); return; }
    setFwBusy(true); setFwErr('');
    try {
      const r = await api.adminForwardContract(doc.id, {
        recipients,
        message: fwMessage.trim() || undefined,
        include_audit_page: fwIncludeAudit,
      });
      const failed = (r.results || []).filter(x => !x.ok);
      if (failed.length) {
        setFwErr(`${failed.length} of ${r.results.length} emails failed: ${failed.map(x => `${x.email} (${x.error})`).join(', ')}`);
      } else {
        showToast({ kind: 'ok', msg: `Forwarded to ${r.results.length} recipient(s).` });
        setShowForward(false);
        setFwEmails('');
        setFwMessage('');
        setFwIncludeAudit(true);
        const log = await api.adminGetForwardLog(doc.id);
        setForwards(log.forwards || []);
      }
    } catch (e) { setFwErr(e.message || 'Forward failed'); }
    finally { setFwBusy(false); }
  };

  useEscapeClose(onClose);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2" onClick={onClose}>
      <ToastMessage toast={toast} />
      <div onClick={e => e.stopPropagation()} className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[96vw] h-[96vh] overflow-hidden flex flex-col dark:bg-gray-900">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-200 flex items-start justify-between gap-3 dark:border-gray-800 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <FileText size={16} className="text-violet-600" />
              <h3 className="font-semibold text-gray-900 truncate dark:text-gray-100">{doc?.title || 'Signed Document'}</h3>
              {doc && <StatusPill status={doc.status} />}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {doc?.doc_type_label || NEW_DOC_TYPE_LABELS[doc?.doc_type] || doc?.doc_type}
              {doc?.template_name ? ` · ${doc.template_name}` : ''}
              {doc?.provider === 'docusign' && <span className="ml-1 text-amber-600 font-medium">(DocuSign)</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowForward(true)}
              className="px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white rounded-lg flex items-center gap-1.5">
              <Send size={12} /> Forward
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
          </div>
        </div>

        {/* Body: PDF + sidebar */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* PDF preview */}
          <div className="flex-1 min-h-0 bg-gray-100 dark:bg-gray-950">
            {loading ? (
              <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm">Loading PDF…</div>
            ) : err ? (
              <div className="h-full flex items-center justify-center text-red-500 text-sm px-6">{err}</div>
            ) : pdfUrl ? (
              <iframe src={pdfUrl} className="w-full h-full border-0" title="Signed PDF preview" />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm">No PDF available.</div>
            )}
          </div>

          {/* Sidebar */}
          <div className="w-full lg:w-80 border-l border-gray-200 overflow-y-auto dark:border-gray-800 flex-shrink-0 bg-white dark:bg-gray-900">
            <div className="p-4 space-y-4">
              {doc && (
                <>
                  <div className="space-y-3">
                    <Field label="Recipient" value={doc.recipient_email} />
                    <Field label="Signed by" value={doc.signed_by} />
                    <Field label="Signed at" value={fmtDate(doc.signed_at)} />
                    <Field label="Days to sign" value={doc.days_to_sign != null ? String(doc.days_to_sign) : '—'} />
                    <Field label="Startup" value={doc.project_name} />
                    <Field label="Created" value={fmtDate(doc.created_at)} />
                  </div>

                  {/* Forward log */}
                  {forwards.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Forward log</div>
                      <div className="space-y-2">
                        {forwards.map(f => (
                          <div key={f.id} className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-[11px] dark:bg-gray-800 dark:border-gray-700">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-gray-700 font-medium dark:text-gray-300">{f.forwarded_to}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${f.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                {f.status}
                              </span>
                            </div>
                            <div className="text-gray-400 dark:text-gray-500 mt-0.5">{fmtDate(f.forwarded_at)}</div>
                            {f.include_audit_page === 0 && <div className="text-gray-500 dark:text-gray-400 mt-0.5">Audit page omitted</div>}
                            {f.message && <div className="text-gray-500 dark:text-gray-400 mt-0.5 italic truncate">&ldquo;{f.message}&rdquo;</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Forward sub-modal */}
        {showForward && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4 z-10">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 dark:bg-gray-900">
              <div className="flex items-center gap-2 mb-3">
                <Send size={16} className="text-violet-600" />
                <h4 className="font-semibold text-gray-900 dark:text-gray-100">Forward to legal partner</h4>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                The signed PDF will be emailed as an attachment. You can include a short note and choose whether to include the audit page.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Recipient emails (comma or space separated)</label>
                  <textarea
                    value={fwEmails}
                    onChange={e => setFwEmails(e.target.value)}
                    rows={2}
                    placeholder="partner@firm.com, counsel@firm.com"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg dark:border-gray-800"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Optional note</label>
                  <textarea
                    value={fwMessage}
                    onChange={e => setFwMessage(e.target.value)}
                    rows={2}
                    placeholder="Please review and advise on the governing-law clause."
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg dark:border-gray-800"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="fw-audit"
                    type="checkbox"
                    checked={fwIncludeAudit}
                    onChange={e => setFwIncludeAudit(e.target.checked)}
                    className="rounded border-gray-300 dark:border-gray-700"
                  />
                  <label htmlFor="fw-audit" className="text-xs text-gray-700 dark:text-gray-300">Include audit/signature page</label>
                </div>
                {fwErr && <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{fwErr}</div>}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => { setShowForward(false); setFwErr(''); }}
                  className="px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg dark:bg-gray-900 dark:border-gray-800">Cancel</button>
                <button onClick={submitForward} disabled={fwBusy}
                  className="px-3 py-2 text-xs font-medium bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-1.5">
                  {fwBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LegalPanel;
