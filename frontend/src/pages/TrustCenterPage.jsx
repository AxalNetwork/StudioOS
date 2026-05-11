/* Task #4 (Y-2) — Trust Center frontend.
 *
 * Single page with role-gated tabs (Overview / Identity (KYC) / Entity (KYB) /
 * Accreditation / Agreements / Sanctions). Drives a Trust score 0-100 from
 * /api/trust/me and shows per-pair NDA flow on the Agreements tab.
 *
 * Backwards compat: legacy KYB / Accreditation / NDA cards consume the older
 * /trust/summary endpoint shape so investor and partner flows that already
 * shipped continue to work; new tabs add the matrix + agreements view on top.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, Lock, Upload, FileText, CheckCircle2, AlertCircle, Loader2,
  Globe, IdCard, Building2, BadgeCheck, FileSignature, Search,
} from 'lucide-react';
import { api } from '../lib/api';
import { safeReadJSON } from '../lib/storage';
import TrustScoreBadge, { computeTrustScore } from '../components/TrustScoreBadge';

// ---------------------------------------------------------------------------
// Obligation key → human label + which tab the obligation lives under.
// Keep in sync with `obligationsForRole()` on the worker side.
// ---------------------------------------------------------------------------
const OBLIGATION_META = {
  tos_v1:               { label: 'Terms of Service',           tab: 'overview' },
  privacy_v1:           { label: 'Privacy Policy',             tab: 'overview' },
  founder_nda_v1:       { label: 'Founder NDA',                tab: 'agreements' },
  investor_nda_v1:      { label: 'Investor NDA',               tab: 'agreements' },
  mentor_nda_v1:        { label: 'Mentor NDA',                 tab: 'agreements' },
  mentor_disclaimer_v1: { label: 'Mentor disclaimer',          tab: 'agreements' },
  partner_msa_v1:       { label: 'Partner MSA',                tab: 'agreements' },
  kyc_v1:               { label: 'Identity verification (KYC)', tab: 'identity' },
  kyb_v1:               { label: 'Entity verification (KYB)',   tab: 'entity' },
  accreditation_v1:     { label: 'Accreditation evidence',      tab: 'accreditation' },
};

const STATUS_PILL = {
  satisfied:    'bg-emerald-100 text-emerald-700 border-emerald-300',
  signed:       'bg-emerald-100 text-emerald-700 border-emerald-300',
  verified:     'bg-emerald-100 text-emerald-700 border-emerald-300',
  in_review:    'bg-blue-100 text-blue-700 border-blue-300',
  self_attested:'bg-amber-100 text-amber-700 border-amber-300',
  pending:      'bg-amber-100 text-amber-700 border-amber-300',
  not_started:  'bg-slate-100 text-slate-700 border-slate-300',
  unverified:   'bg-slate-100 text-slate-700 border-slate-300',
  waived:       'bg-slate-100 text-slate-600 border-slate-300',
  expired:      'bg-red-100 text-red-700 border-red-300',
  rejected:     'bg-red-100 text-red-700 border-red-300',
};

function StatusPill({ status }) {
  const cls = STATUS_PILL[status] || STATUS_PILL.unverified;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>{status || 'pending'}</span>;
}

function Section({ icon: Icon, title, subtitle, children }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 mb-6 shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <Icon className="w-6 h-6 text-emerald-600 mt-0.5" />
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          {subtitle && <p className="text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// KYB / Accreditation / NDA cards — copied verbatim from the previous Trust
// Center implementation; they consume /trust/summary which still ships with
// the worker. Trust v2 (this task) layers obligations + agreements on top.
// ---------------------------------------------------------------------------
function KybCard({ kyb, onChanged }) {
  const [legalName, setLegalName] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [country, setCountry] = useState('US');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);

  async function start() {
    setErr(null); setInfo(null); setBusy(true);
    try {
      const res = await api.startKyb({ legal_name: legalName, business_id: businessId, country });
      setInfo(`KYB started via ${res.provider}.${res.hosted_url ? ' Open the hosted SDK to complete.' : ' Submit your verification details below.'}`);
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function submit() {
    setErr(null); setInfo(null); setBusy(true);
    try {
      const res = await api.submitKyb({ legal_name: legalName, business_id: businessId, country });
      setInfo(`Decision: ${res.decision?.result || res.status}`);
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const verified = kyb?.status === 'verified';
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">Status:</span>
          <StatusPill status={kyb?.status || 'unverified'} />
          {kyb?.provider && <span className="text-xs text-slate-500">via {kyb.provider}</span>}
        </div>
        {verified && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
      </div>
      {!verified && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <input className="bg-white border border-slate-300 rounded px-3 py-2 text-sm" placeholder="Legal entity name" value={legalName} onChange={e => setLegalName(e.target.value)} />
          <input className="bg-white border border-slate-300 rounded px-3 py-2 text-sm" placeholder="Business ID (EIN / VAT)" value={businessId} onChange={e => setBusinessId(e.target.value)} />
          <input className="bg-white border border-slate-300 rounded px-3 py-2 text-sm" placeholder="Country (ISO-2)" value={country} onChange={e => setCountry(e.target.value)} maxLength={3} />
        </div>
      )}
      {!verified && (
        <div className="flex gap-2">
          <button disabled={busy || !legalName || !businessId} onClick={start} className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white text-sm px-3 py-1.5 rounded inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Start KYB
          </button>
          {kyb?.provider === 'mock' && (
            <button disabled={busy || !legalName || !businessId} onClick={submit} className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-300 text-white text-sm px-3 py-1.5 rounded">
              Submit verification
            </button>
          )}
        </div>
      )}
      {info && <p className="text-emerald-700 text-sm mt-3">{info}</p>}
      {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
    </div>
  );
}

function AccreditationCard({ accred, onChanged }) {
  const [basis, setBasis] = useState('income');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);

  async function upload() {
    setErr(null); setInfo(null); setBusy(true);
    try {
      const res = await api.uploadAccreditation(basis, file);
      setInfo(`Uploaded. Investor status: ${res.investor_status}. Awaiting admin review.`);
      setFile(null);
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">Status:</span>
          <StatusPill status={accred?.status || 'unverified'} />
          {accred?.basis && <span className="text-xs text-slate-500">basis: {accred.basis}</span>}
        </div>
        {accred?.verified && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-300 bg-emerald-100 text-emerald-700 text-xs font-medium">
            <ShieldCheck className="w-3.5 h-3.5" /> Verified Investor
          </span>
        )}
      </div>
      {!accred?.verified && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <select value={basis} onChange={e => setBasis(e.target.value)} className="bg-white border border-slate-300 rounded px-3 py-2 text-sm text-slate-900">
              <option value="income">Income</option>
              <option value="net_worth">Net worth</option>
              <option value="entity">Entity</option>
              <option value="knowledgeable_employee">Knowledgeable employee</option>
            </select>
            <input type="file" onChange={e => setFile(e.target.files?.[0] || null)} accept="application/pdf,image/*" className="md:col-span-2 text-sm text-slate-700" />
          </div>
          <button disabled={busy || !file} onClick={upload} className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white text-sm px-3 py-1.5 rounded inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}Upload evidence
          </button>
        </>
      )}
      {info && <p className="text-emerald-700 text-sm mt-3">{info}</p>}
      {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
    </div>
  );
}

function NdaCard({ items, onChanged }) {
  const [openRole, setOpenRole] = useState(null);
  const [preview, setPreview] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function open(role) {
    setOpenRole(role); setPreview(null); setErr(null);
    try { setPreview(await api.getNdaPreview(role)); } catch (e) { setErr(e.message); }
  }
  async function sign() {
    setBusy(true); setErr(null);
    try { await api.signNda(openRole, name); setOpenRole(null); setName(''); onChanged?.(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!items?.length) return <p className="text-sm text-slate-600">No template NDAs are required for your role.</p>;
  return (
    <div className="space-y-2">
      {items.map(it => (
        <div key={it.role} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-3 py-2">
          <div className="flex items-center gap-3">
            <FileText className="w-4 h-4 text-slate-500" />
            <div>
              <div className="text-sm text-slate-900">{it.title}</div>
              <div className="text-xs text-slate-500">role: {it.role}{it.signed_at ? ` · signed ${new Date(it.signed_at).toLocaleDateString()}` : ''}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill status={it.status} />
            {it.status !== 'signed' && (
              <button onClick={() => open(it.role)} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded">Review &amp; sign</button>
            )}
          </div>
        </div>
      ))}
      {openRole && preview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col shadow-xl">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-slate-900 font-semibold">{preview.title}</h3>
              <button onClick={() => { setOpenRole(null); setPreview(null); }} className="text-slate-500 hover:text-slate-800 text-sm">Close</button>
            </div>
            <pre className="flex-1 overflow-auto px-5 py-4 text-xs text-slate-700 whitespace-pre-wrap font-mono">{preview.body}</pre>
            <div className="px-5 py-3 border-t border-slate-200 space-y-2">
              <input className="w-full bg-white border border-slate-300 rounded px-3 py-2 text-sm" placeholder="Type your full legal name to sign" value={name} onChange={e => setName(e.target.value)} />
              {err && <p className="text-red-600 text-xs">{err}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => { setOpenRole(null); setPreview(null); }} className="text-sm text-slate-700 px-3 py-1.5 rounded hover:bg-slate-100">Cancel</button>
                <button disabled={busy || !name.trim()} onClick={sign} className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white text-sm px-3 py-1.5 rounded inline-flex items-center gap-1.5">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}I accept and sign
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Obligation list — generic renderer used on every tab.
// ---------------------------------------------------------------------------
function ObligationList({ obligations, emptyText, onStart }) {
  if (!obligations.length) {
    return <p className="text-sm text-slate-600">{emptyText || 'Nothing required for this section.'}</p>;
  }
  return (
    <ul className="space-y-2">
      {obligations.map(o => {
        const meta = OBLIGATION_META[o.obligation_key] || { label: o.obligation_key };
        const open = o.required && o.status !== 'satisfied' && o.status !== 'waived';
        return (
          <li key={o.obligation_key} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded px-3 py-2">
            <div className="flex items-center gap-3 min-w-0">
              <FileText size={16} className="text-slate-500 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm text-slate-900 dark:text-slate-100 truncate">{meta.label}</div>
                <div className="text-xs text-slate-500">
                  {o.required ? 'Required' : 'Optional'}
                  {o.expires_at ? ` · expires ${new Date(o.expires_at).toLocaleDateString()}` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusPill status={o.status} />
              {open && o.status === 'pending' && onStart && (
                <button
                  onClick={() => onStart(o.obligation_key)}
                  className="text-xs bg-violet-600 hover:bg-violet-500 text-white px-2 py-1 rounded"
                >
                  Start
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Agreements tab — pairwise NDAs touching the caller (both directions).
// ---------------------------------------------------------------------------
function PairwiseSignButton({ envelopeUuid }) {
  const [state, setState] = useState('idle'); // idle | loading | unavailable
  const [err, setErr] = useState(null);
  async function go() {
    setErr(null); setState('loading');
    try {
      const r = await api.trustMySigningUrl(envelopeUuid);
      if (r?.signing_url) {
        // Use a hard nav so the eSign page receives a clean route +
        // can capture its own auth state.
        window.location.assign(r.signing_url);
        return;
      }
      setState('unavailable');
    } catch (e) {
      setErr(e?.message || 'Failed');
      setState('idle');
    }
  }
  if (state === 'unavailable') {
    return <span className="text-[11px] text-slate-500">Already signed or expired</span>;
  }
  return (
    <button
      onClick={go}
      disabled={state === 'loading'}
      className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white px-2 py-1 rounded inline-flex items-center gap-1"
      title="Open the signing page for this NDA"
    >
      {state === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
      Sign
      {err && <span className="text-red-200 ml-1">·{err}</span>}
    </button>
  );
}

function AgreementsTab({ obligations, onStart, currentUserId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.trustAgreements();
        if (!cancelled) setItems(res?.agreements || []);
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Failed to load agreements');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const ndaObligations = obligations.filter(o => OBLIGATION_META[o.obligation_key]?.tab === 'agreements');

  return (
    <>
      <Section icon={FileSignature} title="Role agreements" subtitle="Standing NDAs and disclosures required for your role.">
        <ObligationList obligations={ndaObligations} emptyText="No role-level agreements required." onStart={onStart} />
      </Section>
      <Section icon={Lock} title="Pairwise NDAs" subtitle="Active and pending mutual NDAs between you and other parties.">
        {loading && <p className="text-sm text-slate-600">Loading…</p>}
        {err && <p className="text-sm text-red-600">{err}</p>}
        {!loading && !err && items.length === 0 && (
          <p className="text-sm text-slate-600">No pairwise NDAs yet. Investors initiate one by requesting an intro to a founder.</p>
        )}
        {!loading && items.length > 0 && (
          <ul className="space-y-2">
            {items.map(a => {
              const validUntil = a.valid_until ? new Date(a.valid_until) : null;
              const expired = validUntil && validUntil.getTime() < Date.now();
              const display = expired ? 'expired' : a.status;
              // Surface a Sign CTA whenever the envelope isn't fully
              // active yet (status `issued` or `pending`) and isn't
              // expired. The backend endpoint is the authority — it
              // 404s for non-recipients and reports signed/expired,
              // so this client check is just to avoid useless calls.
              const canSign = !expired && a.status !== 'active' && !!a.nda_envelope_uuid;
              return (
                <li key={a.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded px-3 py-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <Lock size={16} className="text-slate-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm text-slate-900 dark:text-slate-100 truncate">
                        Mutual NDA · parties #{a.party_a_user_id} ↔ #{a.party_b_user_id}
                      </div>
                      <div className="text-xs text-slate-500">
                        envelope {a.nda_envelope_uuid?.slice(0, 8)}…
                        {validUntil ? ` · valid until ${validUntil.toLocaleDateString()}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={display} />
                    {canSign && <PairwiseSignButton envelopeUuid={a.nda_envelope_uuid} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sanctions tab — admin-only.
// ---------------------------------------------------------------------------
function SanctionsTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.trustSanctions().then(setData).catch(e => setErr(e?.message || 'failed'));
  }, []);
  return (
    <Section icon={Search} title="Sanctions screening" subtitle="OFAC / UK HMT / EU CFSP — wired by X-1.">
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!err && !data && <p className="text-sm text-slate-600">Loading…</p>}
      {data && (
        <div className="text-sm text-slate-700 dark:text-slate-300">
          <p>Provider: <span className="font-mono">{data.provider}</span></p>
          <p>Hits: {Array.isArray(data.hits) ? data.hits.length : 0}</p>
          {data.note && <p className="text-xs text-slate-500 mt-2">{data.note}</p>}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Tab definitions — role-gated.
// ---------------------------------------------------------------------------
function tabsForRole(role, obligations) {
  // Authoritative source: the obligation matrix returned by /api/trust/me.
  // We surface a tab only if the canonical role matrix actually has
  // an obligation that lives under it. This keeps tabs in sync with
  // backend `obligationsForRole()` instead of duplicating the matrix
  // client-side. Sanctions remains role-gated (admin only) since it
  // isn't represented as an obligation.
  const tabs = [{ key: 'overview', label: 'Overview', icon: Globe }];
  const has = (tabKey) => obligations.some(o => OBLIGATION_META[o.obligation_key]?.tab === tabKey);
  if (has('identity'))      tabs.push({ key: 'identity',      label: 'Identity',         icon: IdCard });
  if (has('entity'))        tabs.push({ key: 'entity',        label: 'Entity (KYB)',     icon: Building2 });
  if (has('accreditation')) tabs.push({ key: 'accreditation', label: 'Accreditation',    icon: BadgeCheck });
  tabs.push({ key: 'agreements', label: 'Agreements', icon: FileSignature });
  if (role === 'admin') tabs.push({ key: 'sanctions', label: 'Sanctions', icon: Search });
  return tabs;
}

// ---------------------------------------------------------------------------
// Main page.
// ---------------------------------------------------------------------------
export default function TrustCenterPage() {
  const [matrix, setMatrix] = useState(null);   // /api/trust/me
  const [legacy, setLegacy] = useState(null);   // /api/trust/summary (old)
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');

  // Task #18 — read role from /api/trust/me once it resolves so a stale
  // localStorage user (impersonation, server-side role change, signup
  // session that hasn't been refreshed) can't hide tabs the caller
  // actually qualifies for. localStorage is only consulted as a
  // first-paint fallback while the matrix is still loading; once
  // /trust/me has answered, the server is the sole source of truth.
  const cachedRole = safeReadJSON('user', {})?.role;
  const role = matrix?.role || cachedRole || 'member';

  async function load() {
    setErr(null);
    try {
      // /api/trust/me is the canonical obligation matrix; /trust/summary
      // continues to feed the legacy KYB/Accred/NDA cards. Both calls are
      // resilient — we render whatever loaded successfully.
      const [m, s] = await Promise.allSettled([
        api.trustMe(),
        (async () => { try { await api.getRequiredNdas(); } catch {} return api.getTrustSummary(); })(),
      ]);
      if (m.status === 'fulfilled') setMatrix(m.value); else setMatrix({ obligations: [], role });
      if (s.status === 'fulfilled') setLegacy(s.value); else setLegacy({ kyb: null, accreditation: null, ndas: [] });
    } catch (e) {
      setErr(e?.message || 'Failed to load Trust Center');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  async function startObligation(key) {
    try { await api.trustObligationStart(key); await load(); }
    catch (e) { setErr(e?.message || 'Failed to start'); }
  }

  const obligations = matrix?.obligations || [];
  const tabs = useMemo(() => tabsForRole(role, obligations), [role, obligations]);
  const score = computeTrustScore(obligations);
  const missing = obligations
    .filter(o => o.required && o.status !== 'satisfied' && o.status !== 'waived')
    .map(o => OBLIGATION_META[o.obligation_key]?.label || o.obligation_key);

  if (loading) return <div className="p-8 text-slate-600">Loading trust center…</div>;
  if (err) return <div className="p-8 text-red-600 flex items-center gap-2"><AlertCircle className="w-5 h-5" />{err}</div>;

  const overview = (
    <Section icon={Globe} title="Overview" subtitle="Everything required for your role at a glance.">
      <div className="flex items-start gap-6 mb-4">
        <TrustScoreBadge size="lg" score={score} missing={missing} label="Trust score" />
        <div className="text-sm text-slate-600 dark:text-slate-400">
          {missing.length === 0
            ? <span className="text-emerald-700 dark:text-emerald-400 font-medium">Fully compliant — every required obligation is satisfied.</span>
            : <span>You have <strong>{missing.length}</strong> open requirement{missing.length === 1 ? '' : 's'}. Hover the score for details.</span>}
        </div>
      </div>
      <ObligationList obligations={obligations} emptyText="No obligations required for your role." onStart={startObligation} />
    </Section>
  );

  const identity = (
    <Section icon={IdCard} title="Identity (KYC)" subtitle="Government-issued ID + selfie via your KYC provider.">
      <ObligationList
        obligations={obligations.filter(o => OBLIGATION_META[o.obligation_key]?.tab === 'identity')}
        emptyText="KYC not required for your role."
        onStart={startObligation}
      />
      <p className="text-xs text-slate-500 mt-3">Use the Identity Verification page in Settings to submit ID. Status syncs nightly into your Trust score.</p>
    </Section>
  );

  const entity = (legacy?.kyb || obligations.some(o => o.obligation_key === 'kyb_v1')) && (
    <Section icon={Building2} title="Entity verification (KYB)" subtitle="Required for service-provider partners and entity investors.">
      {legacy?.kyb
        ? <KybCard kyb={legacy.kyb} onChanged={load} />
        : <ObligationList
            obligations={obligations.filter(o => OBLIGATION_META[o.obligation_key]?.tab === 'entity')}
            emptyText="KYB not required."
            onStart={startObligation}
          />}
    </Section>
  );

  const accreditation = (legacy?.accreditation || role === 'investor') && (
    <Section icon={BadgeCheck} title="Accredited investor verification" subtitle="Upload evidence to earn the verified-investor badge.">
      {legacy?.accreditation
        ? <AccreditationCard accred={legacy.accreditation} onChanged={load} />
        : <ObligationList
            obligations={obligations.filter(o => OBLIGATION_META[o.obligation_key]?.tab === 'accreditation')}
            emptyText="Accreditation not required."
            onStart={startObligation}
          />}
    </Section>
  );

  const agreementsLegacy = legacy?.ndas?.length ? (
    <Section icon={FileSignature} title="Template NDAs" subtitle="Standing NDAs based on your role.">
      <NdaCard items={legacy.ndas} onChanged={load} />
    </Section>
  ) : null;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-emerald-600" /> Trust Center
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Your obligations, agreements, and verification status — tailored to your role.</p>
        </div>
        <TrustScoreBadge size="md" score={score} missing={missing} label="Trust score" />
      </div>

      <div className="border-b border-slate-200 dark:border-slate-700 mb-6 flex gap-1 overflow-x-auto">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px ${active
                ? 'border-violet-600 text-violet-700 dark:text-violet-300 font-medium'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
            >
              <Icon size={14} />{t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview'      && overview}
      {tab === 'identity'      && identity}
      {tab === 'entity'        && (entity || <Section icon={Building2} title="Entity (KYB)"><p className="text-sm text-slate-600">No entity verification required.</p></Section>)}
      {tab === 'accreditation' && (accreditation || <Section icon={BadgeCheck} title="Accreditation"><p className="text-sm text-slate-600">No accreditation required.</p></Section>)}
      {tab === 'agreements'    && (
        <>
          <AgreementsTab obligations={obligations} onStart={startObligation} />
          {agreementsLegacy}
        </>
      )}
      {tab === 'sanctions'     && <SanctionsTab />}
    </div>
  );
}
