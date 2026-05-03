/* Task #58 — Trust Center
 *
 * Single page that shows the user every trust-layer obligation in one place:
 *   - KYB (partners): Sumsub-extended start + status
 *   - Accreditation (investors): doc upload + admin review state
 *   - NDAs (everyone): per-role generation + sign
 *
 * The same page renders for any role; the sections that don't apply to the
 * current user are simply hidden via the `summary` payload.
 */
import { useEffect, useState } from 'react';
import { ShieldCheck, Lock, Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

const STATUS_PILL = {
  verified: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  signed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  self_attested: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  unverified: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40',
  not_started: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40',
  rejected: 'bg-red-500/15 text-red-300 border-red-500/40',
};

function StatusPill({ status }) {
  const cls = STATUS_PILL[status] || STATUS_PILL.unverified;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>{status}</span>;
}

function Section({ icon: Icon, title, subtitle, children }) {
  return (
    <section className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <Icon className="w-6 h-6 text-emerald-400 mt-0.5" />
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
          {subtitle && <p className="text-sm text-zinc-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

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
      setInfo(`KYB started via ${res.provider}. ${res.hosted_url ? 'Open the hosted SDK to complete.' : 'Submit your verification details below.'}`);
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
          <span className="text-zinc-400">Status:</span>
          <StatusPill status={kyb?.status || 'unverified'} />
          {kyb?.provider && <span className="text-xs text-zinc-500">via {kyb.provider}</span>}
          {kyb?.sumsub_available === false && <span className="text-xs text-zinc-500">(Sumsub not configured — using deterministic mock)</span>}
        </div>
        {verified && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
      </div>
      {!verified && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <input className="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100" placeholder="Legal entity name" value={legalName} onChange={e => setLegalName(e.target.value)} />
          <input className="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100" placeholder="Business ID (EIN / VAT)" value={businessId} onChange={e => setBusinessId(e.target.value)} />
          <input className="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100" placeholder="Country (ISO-2)" value={country} onChange={e => setCountry(e.target.value)} maxLength={3} />
        </div>
      )}
      {!verified && (
        <div className="flex gap-2">
          <button disabled={busy || !legalName || !businessId} onClick={start} className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white text-sm px-3 py-1.5 rounded inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Start KYB
          </button>
          {kyb?.provider === 'mock' && (
            <button disabled={busy || !legalName || !businessId} onClick={submit} className="bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 text-white text-sm px-3 py-1.5 rounded">
              Submit verification
            </button>
          )}
        </div>
      )}
      {info && <p className="text-emerald-400 text-sm mt-3">{info}</p>}
      {err && <p className="text-red-400 text-sm mt-3">{err}</p>}
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
          <span className="text-zinc-400">Status:</span>
          <StatusPill status={accred?.status || 'unverified'} />
          {accred?.basis && <span className="text-xs text-zinc-500">basis: {accred.basis}</span>}
        </div>
        {accred?.verified && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs font-medium">
            <ShieldCheck className="w-3.5 h-3.5" /> Verified Investor
          </span>
        )}
      </div>
      {!accred?.verified && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <select value={basis} onChange={e => setBasis(e.target.value)} className="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100">
              <option value="income">Income</option>
              <option value="net_worth">Net worth</option>
              <option value="entity">Entity</option>
              <option value="knowledgeable_employee">Knowledgeable employee</option>
            </select>
            <input type="file" onChange={e => setFile(e.target.files?.[0] || null)} accept="application/pdf,image/*" className="md:col-span-2 text-sm text-zinc-300" />
          </div>
          <button disabled={busy || !file} onClick={upload} className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white text-sm px-3 py-1.5 rounded inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}Upload evidence
          </button>
        </>
      )}
      {info && <p className="text-emerald-400 text-sm mt-3">{info}</p>}
      {err && <p className="text-red-400 text-sm mt-3">{err}</p>}
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

  if (!items?.length) return <p className="text-sm text-zinc-400">No NDAs are required for your role.</p>;
  return (
    <div className="space-y-2">
      {items.map(it => (
        <div key={it.role} className="flex items-center justify-between bg-zinc-950/60 border border-zinc-800 rounded px-3 py-2">
          <div className="flex items-center gap-3">
            <FileText className="w-4 h-4 text-zinc-400" />
            <div>
              <div className="text-sm text-zinc-100">{it.title}</div>
              <div className="text-xs text-zinc-500">role: {it.role}{it.signed_at ? ` · signed ${new Date(it.signed_at).toLocaleDateString()}` : ''}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill status={it.status} />
            {it.status !== 'signed' && (
              <button onClick={() => open(it.role)} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded">Review & sign</button>
            )}
          </div>
        </div>
      ))}
      {openRole && preview && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-zinc-100 font-semibold">{preview.title}</h3>
              <button onClick={() => { setOpenRole(null); setPreview(null); }} className="text-zinc-400 hover:text-zinc-200 text-sm">Close</button>
            </div>
            <pre className="flex-1 overflow-auto px-5 py-4 text-xs text-zinc-300 whitespace-pre-wrap font-mono">{preview.body}</pre>
            <div className="px-5 py-3 border-t border-zinc-800 space-y-2">
              <input className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100" placeholder="Type your full legal name to sign" value={name} onChange={e => setName(e.target.value)} />
              {err && <p className="text-red-400 text-xs">{err}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => { setOpenRole(null); setPreview(null); }} className="text-sm text-zinc-300 px-3 py-1.5 rounded hover:bg-zinc-800">Cancel</button>
                <button disabled={busy || !name.trim()} onClick={sign} className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white text-sm px-3 py-1.5 rounded inline-flex items-center gap-1.5">
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

export default function TrustCenterPage() {
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setErr(null);
    try {
      // Make sure NDA rows exist before reading the summary so the user sees
      // a real document_id immediately.
      await api.getRequiredNdas().catch(() => null);
      setSummary(await api.getTrustSummary());
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-8 text-zinc-400">Loading trust center…</div>;
  if (err) return <div className="p-8 text-red-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" />{err}</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2"><ShieldCheck className="w-7 h-7 text-emerald-400" /> Trust Center</h1>
        <p className="text-sm text-zinc-400 mt-1">KYB, accreditation, and per-role NDAs in one place.</p>
      </div>

      {summary?.kyb && (
        <Section icon={ShieldCheck} title="KYB — Business verification" subtitle="Required for all service-provider partners.">
          <KybCard kyb={summary.kyb} onChanged={load} />
        </Section>
      )}

      {summary?.accreditation && (
        <Section icon={ShieldCheck} title="Accredited investor verification" subtitle="Upload evidence to earn the verified-investor badge.">
          <AccreditationCard accred={summary.accreditation} onChanged={load} />
        </Section>
      )}

      <Section icon={Lock} title="Non-Disclosure Agreements" subtitle="A short NDA tailored to your role on the platform.">
        <NdaCard items={summary?.ndas || []} onChanged={load} />
      </Section>
    </div>
  );
}
