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
import KycVerification from '../components/KycVerification';

// Task #25 — every persona that can reach the Trust Center (route-guarded to
// these roles in App.jsx) is KYC-eligible, so the Identity tab is always shown
// for them rather than only when the obligation matrix happens to surface a
// kyc_v1 row. Founders/partners see the "not required" state inside the tab.
const KYC_ELIGIBLE_ROLES = new Set(['founder', 'partner', 'investor', 'admin']);

// ---------------------------------------------------------------------------
// Obligation key → human label + which tab the obligation lives under.
// Keep in sync with `obligationsForRole()` on the worker side.
// ---------------------------------------------------------------------------
const OBLIGATION_META = {
  tos_v1:               { label: 'Terms of Service',           tab: 'overview' },
  privacy_v1:           { label: 'Privacy Policy',             tab: 'overview' },
  founder_nda_v1:       { label: 'Founder NDA',                tab: 'agreements' },
  investor_nda_v1:      { label: 'Investor NDA',               tab: 'agreements' },
  mentor_nda_v1:        { label: 'Advisor NDA',                 tab: 'agreements' },
  mentor_disclaimer_v1: { label: 'Advisor disclaimer',          tab: 'agreements' },
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
          <input className="bg-white border border-slate-300 rounded px-3 py-2 text-sm dark:bg-gray-900" placeholder="Legal entity name" value={legalName} onChange={e => setLegalName(e.target.value)} />
          <input className="bg-white border border-slate-300 rounded px-3 py-2 text-sm dark:bg-gray-900" placeholder="Business ID (EIN / VAT)" value={businessId} onChange={e => setBusinessId(e.target.value)} />
          <input className="bg-white border border-slate-300 rounded px-3 py-2 text-sm dark:bg-gray-900" placeholder="Country (ISO-2)" value={country} onChange={e => setCountry(e.target.value)} maxLength={3} />
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
            <select value={basis} onChange={e => setBasis(e.target.value)} className="bg-white border border-slate-300 rounded px-3 py-2 text-sm text-slate-900 dark:bg-gray-900">
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
          <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col shadow-xl dark:bg-gray-900">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-slate-900 font-semibold">{preview.title}</h3>
              <button onClick={() => { setOpenRole(null); setPreview(null); }} className="text-slate-500 hover:text-slate-800 text-sm">Close</button>
            </div>
            <pre className="flex-1 overflow-auto px-5 py-4 text-xs text-slate-700 whitespace-pre-wrap font-mono">{preview.body}</pre>
            <div className="px-5 py-3 border-t border-slate-200 space-y-2">
              <input className="w-full bg-white border border-slate-300 rounded px-3 py-2 text-sm dark:bg-gray-900" placeholder="Type your full legal name to sign" value={name} onChange={e => setName(e.target.value)} />
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

function AgreementsTab({ obligations, onStart, role }) {
  const [items, setItems] = useState([]);
  const [pending, setPending] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState({});  // { [pairId]: 'resend'|'void' }
  const [info, setInfo] = useState(null);
  const isAdmin = role === 'admin';

  async function reload() {
    setErr(null);
    try {
      // Pairwise NDAs come from /trust/pairwise-ndas (admin-aware: admins
      // see every pair so Resend / Void actually has rows to act on; users
      // see only the pairs they're a party to). The /trust/agreements
      // endpoint still feeds the "Other contracts" section with pending
      // envelopes + signed documents touching the caller.
      const [pairs, agree] = await Promise.allSettled([
        api.trustListPairwiseNdas(),
        api.trustAgreements(),
      ]);
      if (pairs.status === 'fulfilled') {
        setItems(pairs.value?.items || []);
      } else {
        setItems([]);
        setErr(pairs.reason?.message || 'Failed to load pairwise NDAs');
      }
      if (agree.status === 'fulfilled') {
        setPending(agree.value?.pending_envelopes || []);
        setDocuments(agree.value?.documents || []);
      } else {
        setPending([]); setDocuments([]);
      }
    } catch (e) {
      setErr(e?.message || 'Failed to load agreements');
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  async function resend(id) {
    setBusy(b => ({ ...b, [id]: 'resend' })); setInfo(null);
    try {
      const r = await api.trustResendPairwiseNda(id);
      setInfo(`Sent ${r?.sent || 0} signing email${r?.sent === 1 ? '' : 's'}.`);
      await reload();
    } catch (e) { setErr(e?.message || 'Resend failed'); }
    finally { setBusy(b => { const n = { ...b }; delete n[id]; return n; }); }
  }
  async function voidPair(id) {
    const reason = window.prompt('Reason for voiding this NDA (visible in audit log):', '');
    if (reason === null) return;
    setBusy(b => ({ ...b, [id]: 'void' })); setInfo(null);
    try {
      await api.trustVoidPairwiseNda(id, reason || 'admin_void');
      setInfo('NDA voided.');
      await reload();
    } catch (e) { setErr(e?.message || 'Void failed'); }
    finally { setBusy(b => { const n = { ...b }; delete n[id]; return n; }); }
  }

  const ndaObligations = obligations.filter(o => OBLIGATION_META[o.obligation_key]?.tab === 'agreements');

  return (
    <>
      <Section icon={FileSignature} title="Role agreements" subtitle="Standing NDAs and disclosures required for your role.">
        <ObligationList obligations={ndaObligations} emptyText="No role-level agreements required." onStart={onStart} />
      </Section>
      <Section icon={Lock} title="Pairwise NDAs" subtitle={isAdmin
        ? "Every founder ↔ investor mutual NDA. Resend re-emails any unsigned recipients; Void cancels the envelope and revokes access."
        : "Active and pending mutual NDAs between you and other parties."}>
        {loading && <p className="text-sm text-slate-600">Loading…</p>}
        {err && <p className="text-sm text-red-600">{err}</p>}
        {info && <p className="text-sm text-emerald-700 mb-2">{info}</p>}
        {!loading && !err && items.length === 0 && (
          <p className="text-sm text-slate-600">No pairwise NDAs on file.</p>
        )}
        {!loading && items.length > 0 && (
          <ul className="space-y-2">
            {items.map(a => {
              const validUntil = a.valid_until ? new Date(a.valid_until) : null;
              const expired = validUntil && validUntil.getTime() < Date.now();
              const voided = a.status === 'voided' || a.status === 'revoked' || !!a.voided_at;
              const display = voided ? 'revoked' : (expired ? 'expired' : a.status);
              const canSign = !voided && !expired && a.status !== 'active' && !!a.nda_envelope_uuid;
              const canAdminAct = isAdmin && !voided && a.status !== 'active' && !expired;
              // Backend computes the signer list on read (joining
              // esign_recipients) and ships it as `signers`. Fall back
              // to the legacy `signers_json` blob if the enrichment
              // step was unavailable.
              const signers = (() => {
                if (Array.isArray(a.signers)) return a.signers;
                try { return Array.isArray(a.signers_json) ? a.signers_json : JSON.parse(a.signers_json || '[]'); }
                catch { return []; }
              })();
              return (
                <li key={a.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 gap-2 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <Lock size={16} className="text-slate-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm text-slate-900 dark:text-slate-100 truncate">
                        Mutual NDA · parties #{a.party_a_user_id} ↔ #{a.party_b_user_id}
                      </div>
                      <div className="text-xs text-slate-500">
                        envelope {a.nda_envelope_uuid?.slice(0, 8)}…
                        {validUntil ? ` · valid until ${validUntil.toLocaleDateString()}` : ''}
                        {signers.length > 0 ? ` · signed: ${signers.map(s => s.name || s.email).join(', ')}` : ''}
                        {voided && a.voided_reason ? ` · voided: ${a.voided_reason}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={display} />
                    {canSign && <PairwiseSignButton envelopeUuid={a.nda_envelope_uuid} />}
                    {canAdminAct && (
                      <>
                        <button
                          onClick={() => resend(a.id)}
                          disabled={!!busy[a.id]}
                          className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50">
                          {busy[a.id] === 'resend' ? 'Sending…' : 'Resend'}
                        </button>
                        <button
                          onClick={() => voidPair(a.id)}
                          disabled={!!busy[a.id]}
                          className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50">
                          {busy[a.id] === 'void' ? 'Voiding…' : 'Void'}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {(pending.length > 0 || documents.length > 0) && (
        <Section icon={FileText} title="Other contracts" subtitle="Pending envelopes awaiting your signature and signed documents on file.">
          {pending.length > 0 && (
            <>
              <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Awaiting your signature</h3>
              <ul className="space-y-1 mb-4">
                {pending.map(p => (
                  <li key={p.envelope_uuid} className="text-sm text-slate-700 dark:text-slate-300 flex items-center justify-between">
                    <span>{p.agreement_type || 'Agreement'} · envelope {p.envelope_uuid?.slice(0, 8)}…</span>
                    <StatusPill status={p.status} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {documents.length > 0 && (
            <>
              <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Signed documents</h3>
              <ul className="space-y-1">
                {documents.map(d => (
                  <li key={d.id} className="text-sm text-slate-700 dark:text-slate-300 flex items-center justify-between">
                    <span>{d.title} <span className="text-xs text-slate-500">({d.doc_type})</span></span>
                    <span className="text-xs text-slate-500">{d.signed_at ? new Date(d.signed_at).toLocaleDateString() : ''}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sanctions tab — admin-only.
// ---------------------------------------------------------------------------
function SanctionsTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);
  const [onlyHits, setOnlyHits] = useState(false);
  // Inline rescreen form
  const [userId, setUserId] = useState('');
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [nationality, setNationality] = useState('');
  const [busy, setBusy] = useState(false);

  async function reload() {
    setErr(null);
    try {
      const res = await api.trustListSanctions({ only_hits: onlyHits ? 1 : 0, limit: 100 });
      // Backend returns both `screenings` and `items` (alias for back-compat).
      setRows(res?.screenings || res?.items || []);
    } catch (e) { setErr(e?.message || 'Failed to load'); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, [onlyHits]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function runScreen(e) {
    e.preventDefault(); setErr(null); setInfo(null);
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) { setErr('Enter a numeric user ID.'); return; }
    setBusy(true);
    try {
      const r = await api.trustScreenSanctions(id, {
        full_legal_name: fullName || undefined,
        date_of_birth:    dob || undefined,
        nationality:      nationality || undefined,
      });
      const hitCount = r?.matches?.length ?? r?.match_count ?? r?.hits?.length ?? 0;
      setInfo(`Screening complete · severity: ${r?.severity || 'unknown'} · ${hitCount} hit(s).`);
      setUserId(''); setFullName(''); setDob(''); setNationality('');
      await reload();
    } catch (e2) { setErr(e2?.message || 'Screening failed'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Section icon={Search} title="Run a sanctions screening" subtitle="OFAC SDN + EU CFSP + UK HMT consolidated lists. Hits are stored for review.">
        <form onSubmit={runScreen} className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
          <label className="text-sm text-slate-700 dark:text-slate-300">User ID
            <input value={userId} onChange={e => setUserId(e.target.value)} className="mt-1 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" required />
          </label>
          <label className="text-sm text-slate-700 dark:text-slate-300">Full legal name (override)
            <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Defaults to corporate or user name" className="mt-1 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" />
          </label>
          <label className="text-sm text-slate-700 dark:text-slate-300">Date of birth (optional)
            <input type="date" value={dob} onChange={e => setDob(e.target.value)} className="mt-1 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" />
          </label>
          <label className="text-sm text-slate-700 dark:text-slate-300">Nationality (ISO-2, optional)
            <input value={nationality} onChange={e => setNationality(e.target.value.toUpperCase())} maxLength={2} placeholder="US" className="mt-1 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" />
          </label>
          <div className="md:col-span-2 flex items-center gap-3">
            <button type="submit" disabled={busy} className="px-3 py-1.5 rounded bg-violet-600 text-white text-sm hover:bg-violet-700 disabled:opacity-50">
              {busy ? 'Screening…' : 'Run screening'}
            </button>
            {info && <span className="text-sm text-emerald-700">{info}</span>}
            {err && <span className="text-sm text-red-600">{err}</span>}
          </div>
        </form>
      </Section>
      <Section icon={Search} title="Recent screenings" subtitle="Most recent runs across all users. Severity = none (clear), review (possible match), or block (high-confidence hit).">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 mb-3">
          <input type="checkbox" checked={onlyHits} onChange={e => setOnlyHits(e.target.checked)} />
          Only show review/block
        </label>
        {loading && <p className="text-sm text-slate-600">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-slate-600">No screenings yet.</p>
        )}
        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <tr><th className="py-2 pr-2">When</th><th className="pr-2">User</th><th className="pr-2">Provider</th><th className="pr-2">Severity</th><th className="pr-2">Hits</th></tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  // Backend persists `{ matches, triggeredBy }` in payload_json.
                  const hits = (() => {
                    try {
                      const p = typeof r.payload_json === 'string' ? JSON.parse(r.payload_json || '{}') : (r.payload_json || {});
                      return Array.isArray(p?.matches) ? p.matches : [];
                    } catch { return []; }
                  })();
                  return (
                    <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-2 text-slate-600">{r.run_at ? new Date(r.run_at).toLocaleString() : ''}</td>
                      <td className="pr-2">#{r.user_id}</td>
                      <td className="pr-2 font-mono text-xs">{r.provider}</td>
                      <td className="pr-2"><StatusPill status={r.severity === 'none' ? 'satisfied' : (r.severity === 'block' ? 'rejected' : 'in_review')} /></td>
                      <td className="pr-2 text-xs text-slate-600">{hits.length ? hits.map(h => h.matched_name || h.name || h.entity).filter(Boolean).slice(0, 2).join(', ') + (hits.length > 2 ? ` +${hits.length - 2}` : '') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
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
  // Task #25 — surface Identity for every KYC-eligible persona (not only when the
  // obligation matrix carries a kyc_v1 row) so it's the single entry point to the
  // Identity Verification form now that the standalone "/kyc" nav item is gone.
  if (has('identity') || KYC_ELIGIBLE_ROLES.has(role)) tabs.push({ key: 'identity', label: 'Identity', icon: IdCard });
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

  // Task #25 — the Identity tab is now a real entry point to the Identity
  // Verification (KYC / AML) form, rendered inline via <KycVerification embedded />
  // (was a dead-end pointer to Settings). The component supplies its own status
  // card and investor-only gate; status syncs nightly into the Trust score.
  const identity = (
    <Section icon={IdCard} title="Identity (KYC)" subtitle="Government-issued ID for AML compliance — submit it right here. Status syncs into your Trust score.">
      <KycVerification embedded />
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

      <div className="border-b border-slate-200 dark:border-slate-700 mb-6 flex gap-1 overflow-x-auto" data-testid="trust-center-page">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              data-testid={`trust-tab-${t.key}`}
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
        <div data-testid="trust-agreements-panel">
          <AgreementsTab obligations={obligations} onStart={startObligation} role={role} />
          {agreementsLegacy}
        </div>
      )}
      {tab === 'sanctions'     && <div data-testid="trust-sanctions-panel"><SanctionsTab /></div>}
    </div>
  );
}
