/** #6136 — the onboarding answers an investor can correct in "My thesis", one field per save. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { COUNTRIES } from '../../lib/countries';

// Same values and labels as the onboarding wizard (OnboardingInvestorPage.jsx),
// which are the only values the Worker stores.
export const ACCREDITATION_OPTIONS = [
  { value: 'accredited', label: 'Accredited (US)' },
  { value: 'qp', label: 'Qualified Purchaser' },
  { value: 'non_us', label: 'Non-US investor' },
  { value: 'not_sure', label: 'Not sure yet' },
];
export const LP_INTENT_OPTIONS = [
  { value: 'yes_now', label: 'Yes, ready to commit this cycle' },
  { value: 'maybe', label: 'Open, want more info' },
  { value: 'deal_only', label: 'Deal-by-deal only for now' },
  { value: 'no', label: 'Not at this time' },
];
export const VERIFICATIONS_HREF = '/trust/me?tab=verifications';

const optionLabel = (options, value) => options.find(o => o.value === value)?.label ?? String(value);
const usd = (n) => `$${Number(n).toLocaleString('en-US')}`;

// Each field: how it reads, how it edits, and what the PUT carries. A save
// sends only that field; the Worker keeps every onboarding field it is not sent.
export const DETAIL_FIELDS = [
  { key: 'firm_name', label: 'Firm or family office', kind: 'text', show: v => v },
  { key: 'accreditation_status', label: 'Accreditation status (self-declared)', kind: 'select', options: ACCREDITATION_OPTIONS, show: v => optionLabel(ACCREDITATION_OPTIONS, v) },
  { key: 'country', label: 'Country of residence', kind: 'select', options: COUNTRIES.map(c => ({ value: c, label: c })), show: v => v },
  { key: 'lp_intent', label: 'LP commitment intent', kind: 'select', options: LP_INTENT_OPTIONS, show: v => optionLabel(LP_INTENT_OPTIONS, v) },
  { key: 'lp_target_usd', label: 'Target LP commitment (USD)', kind: 'number', show: v => usd(v) },
];

const isRecorded = (v) => v !== null && v !== undefined && v !== '';

/** The value a field's input sends: blank clears it, a target must be a whole, non-negative number. */
export function detailPayload(field, raw) {
  const text = String(raw ?? '').trim();
  if (field.kind !== 'number') return { ok: true, value: text || null };
  if (!text) return { ok: true, value: null };
  if (!/^\d+$/.test(text)) return { ok: false, error: 'Enter a whole number of US dollars, or leave it blank.' };
  return { ok: true, value: Number(text) };
}

const INPUT = 'w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100';

function DetailRow({ field, value, busy, saving, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const id = `investor-detail-${field.key}`;

  const start = () => { setDraft(isRecorded(value) ? String(value) : ''); setError(null); setEditing(true); };
  const submit = async () => {
    const out = detailPayload(field, draft);
    if (!out.ok) { setError(out.error); return; }
    if (await onSave(field, out.value)) setEditing(false);
  };

  return (
    <div className="py-2.5" data-testid={id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-xs font-medium text-gray-700 block dark:text-gray-300">{field.label}</label>
          {!editing && (
            <p className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">
              {isRecorded(value) ? field.show(value) : <span className="text-gray-500 dark:text-gray-400">Not recorded</span>}
            </p>
          )}
          {editing && (
            <div className="mt-1">
              {field.kind === 'select' ? (
                <select id={id} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} className={INPUT}>
                  <option value="">Not recorded</option>
                  {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input id={id} type={field.kind === 'number' ? 'number' : 'text'} min={field.kind === 'number' ? 0 : undefined}
                  value={draft} disabled={busy} onChange={e => { setDraft(e.target.value); setError(null); }}
                  aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-error` : undefined} className={INPUT} />
              )}
              {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">{error}</p>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-4">
          {!editing && (
            <button type="button" disabled={busy} onClick={start}
              className="text-xs font-medium text-violet-700 hover:underline disabled:opacity-50 dark:text-violet-300 dark:hover:underline">
              Edit
            </button>
          )}
          {editing && (
            <>
              <button type="button" disabled={busy} onClick={() => setEditing(false)}
                className="text-xs font-medium text-gray-600 hover:underline disabled:opacity-50 dark:text-gray-400 dark:hover:underline">
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={submit}
                className="flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:hover:bg-violet-500">
                {saving && <Loader2 className="animate-spin" size={12} />}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>
      {field.key === 'accreditation_status' && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          What you told us, not a verification. Verified status is in{' '}
          <Link to={VERIFICATIONS_HREF} className="text-violet-700 hover:underline dark:text-violet-300 dark:hover:underline">Trust Center › Verifications</Link>.
        </p>
      )}
    </div>
  );
}

export default function InvestorProfileDetails({ profile, busy, saving, save, flash }) {
  const onSave = async (field, value) => {
    try {
      if (await save(`detail:${field.key}`, { [field.key]: value })) {
        flash(`${field.label.replace(/ \(.*\)$/, '')} saved`);
        return true;
      }
    } catch (err) {
      flash(err.message || 'Failed to save', 'error');
    }
    return false;
  };
  return (
    <div className="border-t border-gray-100 pt-4 dark:border-gray-800" data-testid="investor-profile-details">
      <h3 className="text-xs font-semibold text-gray-800 dark:text-gray-200">Your onboarding answers</h3>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Correct any of these here. Each saves on its own and leaves the rest as they are.</p>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {DETAIL_FIELDS.map(field => (
          <DetailRow key={field.key} field={field} value={profile[field.key]} busy={busy}
            saving={saving === `detail:${field.key}`} onSave={onSave} />
        ))}
      </div>
    </div>
  );
}
