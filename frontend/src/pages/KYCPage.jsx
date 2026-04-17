import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Upload, AlertTriangle, CheckCircle2, Clock, XCircle, Loader2, Search, ChevronDown, X } from 'lucide-react';
import { api } from '../lib/api';

const ID_TYPES = [
  { value: '', label: 'Select ID type' },
  { value: 'passport', label: 'Passport' },
  { value: 'driver_license', label: "Driver's License" },
  { value: 'national_id', label: 'National ID Card' },
  { value: 'residence_permit', label: 'Residence Permit' },
];

const ALL_COUNTRIES = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia',
  'Australia','Austria','Azerbaijan','Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium',
  'Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei',
  'Bulgaria','Burkina Faso','Burundi','Cabo Verde','Cambodia','Cameroon','Canada',
  'Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo (Brazzaville)',
  'Congo (Kinshasa)','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic','Denmark','Djibouti',
  'Dominica','Dominican Republic','Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea',
  'Estonia','Eswatini','Ethiopia','Fiji','Finland','France','Gabon','Gambia','Georgia','Germany',
  'Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana','Haiti','Honduras',
  'Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy','Jamaica',
  'Japan','Jordan','Kazakhstan','Kenya','Kiribati','Kosovo','Kuwait','Kyrgyzstan','Laos','Latvia',
  'Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania','Luxembourg','Madagascar',
  'Malawi','Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico',
  'Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar (Burma)',
  'Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Korea',
  'North Macedonia','Norway','Oman','Pakistan','Palau','Palestine','Panama','Papua New Guinea',
  'Paraguay','Peru','Philippines','Poland','Portugal','Qatar','Romania','Russia','Rwanda',
  'Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Samoa','San Marino',
  'São Tomé and Príncipe','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore',
  'Slovakia','Slovenia','Solomon Islands','Somalia','South Africa','South Korea','South Sudan',
  'Spain','Sri Lanka','Sudan','Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan',
  'Tanzania','Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey',
  'Turkmenistan','Tuvalu','Uganda','Ukraine','United Arab Emirates','United Kingdom',
  'United States','Uruguay','Uzbekistan','Vanuatu','Vatican City','Venezuela','Vietnam',
  'Yemen','Zambia','Zimbabwe',
];

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
    country: '', address_line1: '', address_line2: '',
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
              <CountrySelect
                label="Country"
                required
                value={form.country}
                onChange={v => setForm(f => ({ ...f, country: v }))}
              />
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
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        className="mt-1 w-full appearance-none border border-gray-300 rounded-xl px-4 py-3 pr-10 text-sm font-medium text-gray-900 bg-white shadow-sm outline-none transition focus:ring-2 focus:ring-violet-500 focus:border-violet-500 hover:border-gray-400"
        style={{
          backgroundImage:
            'linear-gradient(45deg, transparent 50%, #9ca3af 50%), linear-gradient(135deg, #9ca3af 50%, transparent 50%)',
          backgroundPosition: 'calc(100% - 20px) calc(1em + 2px), calc(100% - 15px) calc(1em + 2px)',
          backgroundSize: '5px 5px, 5px 5px',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {options.map(o => (
          <option key={o.value || o.label} value={o.value} disabled={!o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CountrySelect({ label, required, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const filtered = query.trim()
    ? ALL_COUNTRIES.filter(c => c.toLowerCase().includes(query.toLowerCase()))
    : ALL_COUNTRIES;

  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (country) => {
    onChange(country);
    setOpen(false);
    setQuery('');
  };

  const clear = (e) => {
    e.stopPropagation();
    onChange('');
    setQuery('');
  };

  return (
    <div className="block" ref={containerRef}>
      <span className="text-xs font-medium text-gray-700">
        {label}{required && <span className="text-red-500"> *</span>}
      </span>

      <div
        className={`mt-1 relative w-full border rounded-xl px-4 py-3 text-sm bg-white shadow-sm cursor-pointer flex items-center justify-between gap-2 transition
          ${open ? 'border-violet-500 ring-2 ring-violet-500' : 'border-gray-300 hover:border-gray-400'}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className={value ? 'text-gray-900 font-medium' : 'text-gray-400'}>
          {value || 'Select country'}
        </span>
        <span className="flex items-center gap-1 text-gray-400 flex-shrink-0">
          {value && (
            <button type="button" onClick={clear} className="hover:text-gray-600 p-0.5 rounded">
              <X size={13} />
            </button>
          )}
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <Search size={13} className="text-gray-400 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search countries…"
                className="flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder-gray-400"
                onClick={e => e.stopPropagation()}
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <ul ref={listRef} className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-gray-400 text-center">No results for "{query}"</li>
            ) : (
              filtered.map(country => (
                <li
                  key={country}
                  onClick={() => select(country)}
                  className={`px-4 py-2 text-sm cursor-pointer flex items-center justify-between
                    ${country === value ? 'bg-violet-50 text-violet-700 font-medium' : 'text-gray-800 hover:bg-gray-50'}`}
                >
                  {country}
                  {country === value && <CheckCircle2 size={13} className="text-violet-500 flex-shrink-0" />}
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {required && !value && (
        <input
          tabIndex={-1}
          required
          value=""
          onChange={() => {}}
          className="absolute opacity-0 w-0 h-0 pointer-events-none"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
