import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Upload, AlertTriangle, CheckCircle2, Clock, XCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

const ID_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'driver_license', label: "Driver's License" },
  { value: 'national_id', label: 'National ID Card' },
  { value: 'residence_permit', label: 'Residence Permit' },
];

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Singapore', 'France', 'Germany', 'Australia', 'United Arab Emirates', 'Switzerland', 'Other'];

const STATUS_META = {
  not_started: { color: 'bg-gray-100 text-gray-700', icon: ShieldCheck, label: 'Not Started' },
  pending: { color: 'bg-amber-100 text-amber-700', icon: Clock, label: 'Pending Review' },
  approved: { color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2, label: 'Approved' },
  rejected: { color: 'bg-red-100 text-red-700', icon: XCircle, label: 'Rejected' },
};

export default function KYCPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    legal_first_name: '', legal_last_name: '', date_of_birth: '', nationality: '',
    country: 'United States', address_line1: '', address_line2: '',
    city: '', state_region: '', postal_code: '',
    id_type: 'passport', id_number: '', id_document_base64: '',
    phone: '', pep_self_disclosed: false, sanctions_acknowledged: false,
  });
  const [docName, setDocName] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.kycStatus();
      setStatus(s);
      // refresh /me so that the App-level status updates
      try {
        const me = await api.getMe();
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify({ ...stored, ...me }));
      } catch {}
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { setError('Document exceeds 6MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setForm(f => ({ ...f, id_document_base64: reader.result }));
      setDocName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.sanctions_acknowledged) { setError('You must acknowledge the sanctions/AML notice.'); return; }
    setSubmitting(true);
    try {
      await api.kycSubmit(form);
      await load();
    } catch (e) {
      setError(e.message);
    } finally { setSubmitting(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="animate-spin mr-2" size={18} /> Loading verification status…</div>;
  }

  const s = status?.kyc_status || 'not_started';
  const meta = STATUS_META[s] || STATUS_META.not_started;
  const Icon = meta.icon;
  const canSubmit = s === 'not_started' || s === 'rejected';

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6 flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0">
          <ShieldCheck size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Identity Verification (KYC / AML)</h1>
          <p className="text-sm text-gray-600 mt-1">Axal VC is required to verify the identity of every member before activating their account for capital, deal flow, or legal documents.</p>
        </div>
      </div>

      <div className={`rounded-xl border p-4 mb-6 flex items-center gap-3 ${meta.color}`}>
        <Icon size={20} />
        <div className="flex-1">
          <div className="text-sm font-semibold">Status: {meta.label}</div>
          {status?.submitted_at && <div className="text-xs opacity-80">Submitted {new Date(status.submitted_at).toLocaleString()}</div>}
          {status?.reviewed_at && <div className="text-xs opacity-80">Reviewed {new Date(status.reviewed_at).toLocaleString()}</div>}
          {status?.rejection_reason && <div className="text-xs mt-1"><strong>Reason:</strong> {status.rejection_reason}</div>}
        </div>
        {s === 'approved' && (
          <button onClick={() => navigate('/dashboard')} className="px-3 py-1.5 text-xs bg-white/70 rounded-md font-medium hover:bg-white">Continue →</button>
        )}
      </div>

      {s === 'pending' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-700">
          Your submission is in queue. An Axal compliance reviewer typically approves within 1 business day. You will receive an email update at <strong>{JSON.parse(localStorage.getItem('user') || '{}').email}</strong>.
        </div>
      )}

      {s === 'approved' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-700">
          You are fully verified. Submitted information is encrypted and only accessible to Axal compliance staff.
        </div>
      )}

      {canSubmit && (
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /> <span>{error}</span>
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Legal Identity</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label="Legal First Name" required value={form.legal_first_name} onChange={v => setForm(f => ({ ...f, legal_first_name: v }))} />
              <Input label="Legal Last Name" required value={form.legal_last_name} onChange={v => setForm(f => ({ ...f, legal_last_name: v }))} />
              <Input type="date" label="Date of Birth" required value={form.date_of_birth} onChange={v => setForm(f => ({ ...f, date_of_birth: v }))} />
              <Input label="Nationality" value={form.nationality} onChange={v => setForm(f => ({ ...f, nationality: v }))} placeholder="e.g. American" />
              <Input label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="+1 555…" />
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Residential Address</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select label="Country" required value={form.country} onChange={v => setForm(f => ({ ...f, country: v }))} options={COUNTRIES.map(c => ({ value: c, label: c }))} />
              <Input label="Address Line 1" required value={form.address_line1} onChange={v => setForm(f => ({ ...f, address_line1: v }))} />
              <Input label="Address Line 2" value={form.address_line2} onChange={v => setForm(f => ({ ...f, address_line2: v }))} />
              <Input label="City" required value={form.city} onChange={v => setForm(f => ({ ...f, city: v }))} />
              <Input label="State / Region" value={form.state_region} onChange={v => setForm(f => ({ ...f, state_region: v }))} />
              <Input label="Postal Code" required value={form.postal_code} onChange={v => setForm(f => ({ ...f, postal_code: v }))} />
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Government ID</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select label="ID Type" required value={form.id_type} onChange={v => setForm(f => ({ ...f, id_type: v }))} options={ID_TYPES} />
              <Input label="ID Number" required value={form.id_number} onChange={v => setForm(f => ({ ...f, id_number: v }))} />
            </div>
            <label className="mt-3 flex items-center gap-3 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm text-gray-700">
              <Upload size={16} className="text-gray-500" />
              <span>{docName || 'Upload ID document (JPG, PNG, WEBP, or PDF — max 6MB)'}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={handleFile} />
            </label>
          </div>

          <div className="space-y-2 pt-2 border-t border-gray-100">
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="mt-1" checked={form.pep_self_disclosed} onChange={e => setForm(f => ({ ...f, pep_self_disclosed: e.target.checked }))} />
              <span>I am, or am closely related to, a Politically Exposed Person (PEP).</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="mt-1" checked={form.sanctions_acknowledged} onChange={e => setForm(f => ({ ...f, sanctions_acknowledged: e.target.checked }))} />
              <span>I confirm I am not on any sanctions list (OFAC, UN, EU, UK) and the information above is accurate. I authorize Axal to verify my identity with third-party providers (Persona / Sumsub).</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
            {submitting ? 'Submitting…' : (s === 'rejected' ? 'Resubmit for Review' : 'Submit for Verification')}
          </button>
        </form>
      )}
    </div>
  );
}

function Input({ label, required, type = 'text', value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700">{label}{required && <span className="text-red-500"> *</span>}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required} placeholder={placeholder}
        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none" />
    </label>
  );
}

function Select({ label, required, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700">{label}{required && <span className="text-red-500"> *</span>}</span>
      <select value={value} onChange={e => onChange(e.target.value)} required={required}
        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none bg-white">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
