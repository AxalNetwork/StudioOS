// D4618 part 2 (#4618): Profile and identity's controllers (board AC-2), moved
// unchanged out of `../SettingsPage.jsx`: the editors under the identity cards
// (`ProfileEditors`: profile, background, the LinkedIn import, jurisdictions,
// the role's preferences and the extras), Roles and access, and Documents and
// agreements. `AccountProfile.jsx` keeps the identity cards; the page keeps the
// pane's order, the Email address card and Delete your account
// (`AccountDeletionCard`), which change or end the account and wait for #4614. Each card owns its reads; `patch` is the page's one
// account write.
import Card from './AccountCard.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { User, Camera, AlertTriangle, Download, Plus, X, Check, Loader2 } from 'lucide-react';
import { Unrecorded } from '../../ui';
import AuthorCard from '../../components/AuthorCard';
import { appOrigin } from '../../lib/branchHost';
import { effectiveDisplayName } from '../../lib/displayName';
import { Field, inputCls } from './SettingsFields';

// ---------- Reference data --------------------------------------------------

// ISO 3166-1 alpha-2 + a couple of common alpha-3 codes — pared down to the
// jurisdictions Axal VC LPs/founders typically operate in. The backend stores
// whatever 2/3-letter codes we send, so this is a UI-side curation.
const JURISDICTIONS = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'EE', name: 'Estonia' },
  { code: 'AE', name: 'UAE' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'IL', name: 'Israel' },
  { code: 'IN', name: 'India' },
  { code: 'SG', name: 'Singapore' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'KY', name: 'Cayman Islands' },
  { code: 'BM', name: 'Bermuda' },
  { code: 'VG', name: 'British Virgin Islands' },
];


/**
 * The profile editors under Profile and identity, with no sub-tabs (owner,
 * 2026-10-28). Corporate moved to Companies and projects, beside the account's
 * companies; Verification is Trust Center's (`/trust/me`). The identity fields
 * the old Personal tab edited twice are the cards above (AccountProfile.jsx):
 * Identity, Personal details, and Address and tax ID.
 */
export function ProfileEditors({ data, onSaved, flash, patch }) {
  return (
    <>
      <LinkedInImportSection flash={flash} />
      <ProfileSection data={data} onSaved={onSaved} flash={flash} patch={patch} />
      <ProfileBackgroundSection flash={flash} />
      <ProfileExtrasCard flash={flash} />
      <JurisdictionsSection data={data} patch={patch} />
      <RolePreferencesSection data={data} patch={patch} />
    </>
  );
}



function ProfileSection({ data, onSaved, flash, patch }) {
  // D4616 — "Display name" is the identity contract's `display_name`, the name
  // other members see. The account's full name is a different field, edited
  // under Account · Profile; it shows here only as what an unset display name
  // falls back to.
  const [displayName, setDisplayName] = useState(data.display_name || '');
  const name = effectiveDisplayName(displayName, data.name) || '';
  const saveDisplayName = async () => {
    const next = displayName.trim();
    if (next === (data.display_name || '')) return;
    try {
      const res = await api.updateIdentitySettings({ display_name: next || null });
      const stored = res?.display_name ?? null;
      setDisplayName(stored || '');
      onSaved({ display_name: stored, public_name: effectiveDisplayName(stored, data.name) });
      flash('Display name saved');
    } catch (e) {
      flash(e?.message || 'Your display name was not saved.', 'error');
    }
  };
  const [bio, setBio] = useState(data.profile?.bio || '');
  const [headline, setHeadline] = useState(data.profile?.headline || '');
  const [socials, setSocials] = useState(data.profile?.socials || {});
  const [headshotPreview, setHeadshotPreview] = useState(data.profile?.headshot_url || null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const onFile = async (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      flash('Image must be JPEG, PNG, or WebP', 'error');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      flash('Image must be under 3MB', 'error');
      return;
    }
    const dataUri = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setBusy(true);
    try {
      const res = await api.uploadHeadshot(dataUri);
      setHeadshotPreview(`${res.headshot_url}?t=${Date.now()}`);
      onSaved({ profile: { ...data.profile, headshot_url: res.headshot_url } });
      flash('Headshot updated');
    } catch (e) {
      flash(e.message || 'Upload failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="Profile" description="Your headshot, name, and bio show up across the platform.">
        <div className="flex items-start gap-5">
          <div className="flex flex-col items-center gap-2">
            <div className="w-24 h-24 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center overflow-hidden">
              {headshotPreview ? (
                <img src={headshotPreview} alt="" className="w-full h-full object-cover" onError={() => setHeadshotPreview(null)} />
              ) : (
                <User size={36} className="text-gray-400" />
              )}
            </div>
            <button onClick={() => fileRef.current?.click()} disabled={busy}
              className="text-xs text-violet-700 hover:text-violet-800 flex items-center gap-1 disabled:opacity-50">
              <Camera size={12} /> {busy ? 'Uploading…' : 'Change'}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
              className="hidden" onChange={e => onFile(e.target.files?.[0])} />
          </div>
          <div className="flex-1 space-y-3">
            <Field label="Display name" hint={`How you appear to other members. Left blank, they see your account name${data.name ? ` (${data.name})` : ''}, which you change under Account · Profile.`}>
              <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={100}
                onBlur={saveDisplayName} placeholder={data.name || ''} className={inputCls} />
            </Field>
            <Field label="Bio" hint="Up to 2,000 characters. Markdown is not rendered.">
              <textarea value={bio} onChange={e => setBio(e.target.value)} rows={4}
                onBlur={() => bio !== (data.profile?.bio || '') && patch({ bio })} className={inputCls} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Social links" description="Optional. Shown on your public author profile.">
        <div className="grid sm:grid-cols-2 gap-3">
          {['linkedin', 'twitter', 'website', 'github', 'instagram'].map(k => (
            <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
              <input value={socials[k] || ''} onChange={e => setSocials({ ...socials, [k]: e.target.value })}
                onBlur={() => patch({ socials })} placeholder={`https://...`} className={inputCls} />
            </Field>
          ))}
        </div>
      </Card>

      <Card title="Public author profile" description="How you appear on article pages and your shareable author page.">
        <div className="mb-4">
          <Field label="Headline" hint="A short tagline shown next to your name on article pages and your author page — e.g. your title or publication.">
            <input value={headline} onChange={e => setHeadline(e.target.value)} maxLength={120}
              onBlur={() => headline !== (data.profile?.headline || '') && patch({ headline })}
              placeholder="e.g. Founder, VJs Mag" className={inputCls} />
          </Field>
        </div>
        <div className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 p-5">
          <AuthorCard
            author={{
              name,
              headline: headline || null,
              bio,
              headshot_url: headshotPreview,
              role: data.role || null,
              location: null,
              socials: {
                linkedin: socials.linkedin || null,
                twitter: socials.twitter || null,
                website: socials.website || null,
                github: socials.github || null,
                instagram: socials.instagram || null,
              },
            }}
          />
          {!name && !bio && !headshotPreview && Object.values(socials).every(v => !v) && (
            <p className="mt-3 text-sm text-gray-400 dark:text-gray-500 italic">
              Fill in your profile above to preview how you&apos;ll appear to readers.
            </p>
          )}
        </div>
        {data.id ? (
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <a
              href={`${appOrigin()}/authors/${data.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-violet-700 dark:text-violet-400 hover:underline"
            >
              View public profile ↗
            </a>
            <button
              type="button"
              onClick={() => {
                try {
                  navigator.clipboard.writeText(`${appOrigin()}/authors/${data.id}`);
                  flash('Link copied!');
                } catch { flash('Could not copy'); }
              }}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-violet-700 dark:hover:text-violet-400 transition"
            >
              Copy link
            </button>
          </div>
        ) : null}
      </Card>
    </>
  );
}


// Task #66 — structured career background editor (experience / education /
// certifications + website). Persists via /settings/profile/background; the
// same shape is surfaced (opt-in) on the public profile page.
const BG_KINDS = [
  { key: 'experience', label: 'Experience', fields: [
    { k: 'title', label: 'Title' }, { k: 'company', label: 'Company' },
    { k: 'start', label: 'Start' }, { k: 'end', label: 'End' },
    { k: 'description', label: 'Description', textarea: true },
  ] },
  { key: 'education', label: 'Education', fields: [
    { k: 'school', label: 'School' }, { k: 'degree', label: 'Degree' },
    { k: 'field', label: 'Field of study' },
    { k: 'start', label: 'Start' }, { k: 'end', label: 'End' },
  ] },
  { key: 'certifications', label: 'Certifications', fields: [
    { k: 'name', label: 'Name' }, { k: 'issuer', label: 'Issuer' },
    { k: 'year', label: 'Year' },
  ] },
];


function ProfileBackgroundSection({ flash }) {
  const [bg, setBg] = useState(null);
  const [website, setWebsite] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getProfileBackground()
      .then(r => {
        if (cancelled) return;
        setBg({
          experience: Array.isArray(r.experience) ? r.experience : [],
          education: Array.isArray(r.education) ? r.education : [],
          certifications: Array.isArray(r.certifications) ? r.certifications : [],
        });
        setWebsite(r.website || '');
      })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load background'); });
    return () => { cancelled = true; };
  }, []);

  const save = async (next, nextWebsite) => {
    setBusy(true);
    try {
      const payload = {
        experience: next.experience,
        education: next.education,
        certifications: next.certifications,
        website: (nextWebsite ?? website).trim() || null,
      };
      const r = await api.updateProfileBackground(payload);
      setBg({
        experience: Array.isArray(r.experience) ? r.experience : [],
        education: Array.isArray(r.education) ? r.education : [],
        certifications: Array.isArray(r.certifications) ? r.certifications : [],
      });
      setWebsite(r.website || '');
      flash('Saved');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
    } finally {
      setBusy(false);
    }
  };

  const addEntry = (kind) => {
    const next = { ...bg, [kind]: [...(bg[kind] || []), {}] };
    setBg(next);
  };
  const removeEntry = (kind, idx) => {
    const next = { ...bg, [kind]: bg[kind].filter((_, i) => i !== idx) };
    setBg(next);
    save(next);
  };
  const setField = (kind, idx, field, value) => {
    const rows = bg[kind].map((row, i) => i === idx ? { ...row, [field]: value } : row);
    setBg({ ...bg, [kind]: rows });
  };

  if (err) return <Card title="Background"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!bg) return <Card title="Background"><div className="text-sm text-gray-500">Loading…</div></Card>;

  return (
    <Card title="Background"
      description="Experience, education and certifications. Shown on your public profile when you enable it in Privacy.">
      <Field label="Website" hint="Must start with http:// or https://">
        <input value={website} onChange={e => setWebsite(e.target.value)}
          onBlur={() => save(bg)} placeholder="https://…" className={inputCls} disabled={busy} />
      </Field>
      {BG_KINDS.map(kind => (
        <div key={kind.key} className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">{kind.label}</h4>
            <button type="button" onClick={() => addEntry(kind.key)} disabled={busy}
              className="text-xs text-violet-700 hover:text-violet-800 disabled:opacity-50">+ Add</button>
          </div>
          <div className="space-y-3">
            {(bg[kind.key] || []).length === 0 && (
              <p className="text-xs text-gray-400">None added.</p>
            )}
            {(bg[kind.key] || []).map((row, idx) => (
              <div key={idx} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                <div className="grid sm:grid-cols-2 gap-2">
                  {kind.fields.map(f => (
                    <div key={f.k} className={f.textarea ? 'sm:col-span-2' : ''}>
                      <label className="text-[11px] text-gray-500">{f.label}</label>
                      {f.textarea ? (
                        <textarea value={row[f.k] || ''} rows={2}
                          onChange={e => setField(kind.key, idx, f.k, e.target.value)}
                          onBlur={() => save(bg)} className={inputCls} disabled={busy} />
                      ) : (
                        <input value={row[f.k] || ''}
                          onChange={e => setField(kind.key, idx, f.k, e.target.value)}
                          onBlur={() => save(bg)} className={inputCls} disabled={busy} />
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => removeEntry(kind.key, idx)} disabled={busy}
                  className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50">Remove</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}


// Task #67 — Autopopulate profile from LinkedIn. Two sources: the connected
// LinkedIn account (name + photo only) and a LinkedIn "Save to PDF" export
// (full career history). NOTHING is published automatically — the parsed
// proposal opens in a review dialog where the user edits/deselects before
// applying. Uploads are PDF-only, ≤8 MB, and validated server-side too.
const LI_MAX_PDF_BYTES = 8 * 1024 * 1024;

const LI_FIELD_DEFS = [
  { k: 'display_name', label: 'Display name' },
  { k: 'full_legal_name', label: 'Full legal name' },
  { k: 'headline', label: 'Headline' },
  { k: 'location', label: 'Location (saved as city)' },
  { k: 'website', label: 'Website' },
];


function LinkedInImportReview({ proposal, onCancel, onApplied, flash }) {
  const [fields, setFields] = useState({ ...(proposal.fields || {}) });
  const [bio, setBio] = useState(proposal.fields?.bio || '');
  const [experience, setExperience] = useState(proposal.experience || []);
  const [education, setEducation] = useState(proposal.education || []);
  const [certifications, setCertifications] = useState(proposal.certifications || []);
  const [includePhoto, setIncludePhoto] = useState(!!proposal.photo_url);
  const [busy, setBusy] = useState(false);

  const removeFrom = (setter, list, idx) => setter(list.filter((_, i) => i !== idx));

  const apply = async () => {
    setBusy(true);
    try {
      const outFields = {};
      for (const { k } of LI_FIELD_DEFS) {
        const v = (fields[k] || '').trim();
        if (v) outFields[k] = v;
      }
      if (bio.trim()) outFields.bio = bio.trim();
      const payload = {
        fields: outFields,
        experience,
        education,
        certifications,
        photo_url: includePhoto ? (proposal.photo_url || null) : null,
      };
      const res = await api.linkedinImportApply(payload);
      const n = (res.applied || []).length;
      flash(n ? `Imported ${n} field${n === 1 ? '' : 's'} from LinkedIn` : 'Nothing to import');
      onApplied();
    } catch (e) {
      flash(e.message || 'Import failed', 'error');
      setBusy(false);
    }
  };

  const renderList = (title, list, setter, cols) => (
    <div className="mt-4">
      <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">{title}</h4>
      {list.length === 0 ? (
        <p className="text-xs text-gray-400">None detected.</p>
      ) : (
        <div className="space-y-2">
          {list.map((row, idx) => (
            <div key={idx} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 flex items-start justify-between gap-3">
              <div className="text-xs text-gray-700 dark:text-gray-300 space-y-0.5 min-w-0">
                {cols.map(c => row[c.k] ? (
                  <div key={c.k} className="truncate"><span className="text-gray-400">{c.label}: </span>{row[c.k]}</div>
                ) : null)}
              </div>
              <button type="button" onClick={() => removeFrom(setter, list, idx)} disabled={busy}
                className="text-xs text-red-600 hover:text-red-700 shrink-0 disabled:opacity-50">Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Review LinkedIn import</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Nothing is saved until you apply. Edit or remove anything below.</p>
          </div>
          <button onClick={onCancel} disabled={busy} className="text-gray-400 hover:text-gray-600 disabled:opacity-50"><X size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto">
          {(proposal.warnings || []).length > 0 && (
            <div className="mb-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-1">
              {proposal.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-800 dark:text-amber-300 flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{w}</p>
              ))}
            </div>
          )}
          {includePhoto && proposal.photo_url && (
            <label className="flex items-center gap-3 mb-4">
              <img src={proposal.photo_url} alt="" className="w-14 h-14 rounded-full object-cover border border-gray-200 dark:border-gray-700" />
              <span className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={includePhoto} onChange={e => setIncludePhoto(e.target.checked)} />
                Use this LinkedIn photo as my headshot
              </span>
            </label>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {LI_FIELD_DEFS.map(({ k, label }) => (
              <Field key={k} label={label}>
                <input value={fields[k] || ''} onChange={e => setFields({ ...fields, [k]: e.target.value })}
                  className={inputCls} disabled={busy} />
              </Field>
            ))}
          </div>
          <div className="mt-3">
            <Field label="About / bio" hint="Up to 2,000 characters.">
              <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} className={inputCls} disabled={busy} />
            </Field>
          </div>
          {renderList('Experience', experience, setExperience, [
            { k: 'title', label: 'Title' }, { k: 'company', label: 'Company' },
            { k: 'start', label: 'Start' }, { k: 'end', label: 'End' },
          ])}
          {renderList('Education', education, setEducation, [
            { k: 'school', label: 'School' }, { k: 'degree', label: 'Degree' }, { k: 'field', label: 'Field' },
          ])}
          {renderList('Certifications', certifications, setCertifications, [
            { k: 'name', label: 'Name' }, { k: 'issuer', label: 'Issuer' }, { k: 'year', label: 'Year' },
          ])}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">Cancel</button>
          <button onClick={apply} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{busy ? 'Applying…' : 'Apply to profile'}
          </button>
        </div>
      </div>
    </div>
  );
}


function LinkedInImportSection({ flash }) {
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState(null);
  const fileRef = useRef(null);

  const importFromAccount = async () => {
    setBusy(true);
    try {
      const { proposal: p } = await api.linkedinImportPreview({ source: 'account' });
      setProposal(p);
    } catch (e) {
      flash(e.message || 'Could not import from LinkedIn', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      flash('Please upload a PDF (LinkedIn → More → Save to PDF).', 'error');
      return;
    }
    if (file.size > LI_MAX_PDF_BYTES) {
      flash('PDF must be under 8MB.', 'error');
      return;
    }
    const dataUri = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setBusy(true);
    try {
      const { proposal: p } = await api.linkedinImportPreview({ source: 'pdf', pdf_data_uri: dataUri });
      setProposal(p);
    } catch (e) {
      flash(e.message || 'Could not read that PDF', 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <Card title="Autopopulate from LinkedIn"
        description="Prefill your profile from your connected LinkedIn account or a LinkedIn PDF export. You review and confirm everything before it's saved.">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={importFromAccount} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Import from connected account
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Upload LinkedIn PDF
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden"
            onChange={e => onFile(e.target.files?.[0])} />
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
          To get your PDF: on LinkedIn, open your profile → More → Save to PDF. PDF only, up to 8MB.
        </p>
      </Card>
      {proposal && (
        <LinkedInImportReview
          proposal={proposal}
          flash={flash}
          onCancel={() => setProposal(null)}
          onApplied={() => { setProposal(null); setTimeout(() => window.location.reload(), 600); }}
        />
      )}
    </>
  );
}


function JurisdictionsSection({ data, patch }) {
  const selected = useMemo(() => new Set(data.jurisdictions || []), [data.jurisdictions]);
  const [picked, setPicked] = useState(selected);

  const toggle = (code) => {
    const next = new Set(picked);
    if (next.has(code)) next.delete(code); else next.add(code);
    setPicked(next);
    patch({ jurisdictions: Array.from(next) });
  };

  return (
    <Card title="Jurisdictions" description="Where you operate or invest. Used to filter deal flow and compliance prompts.">
      <div className="flex flex-wrap gap-2">
        {JURISDICTIONS.map(j => {
          const isSel = picked.has(j.code);
          return (
            <button key={j.code} onClick={() => toggle(j.code)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                isSel ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-violet-400'
              }`}>
              {j.code} · {j.name}
            </button>
          );
        })}
      </div>
    </Card>
  );
}


// D433 — ROLES & ACCESS, built up to the line the stores draw. The canvas
// draws multiple roles per account, a plan per role and delegates. This
// platform records ONE role per account (`users.role`) and has no delegate
// store; both are said here rather than drawn as an empty list a reader would
// take for "none".
const ROLE_LABEL = {
  founder: 'Founder', investor: 'Investor / LP', partner: 'Service partner',
  advisor: 'Advisor', admin: 'Admin', exploring: 'Exploring',
};

export function RolesAccessCard({ data, onJump }) {
  const role = String(data?.role || '').toLowerCase();
  return (
    <Card title="Roles & access" description="What this account is, and who can act for it.">
      <div className="space-y-3" data-testid="roles-access-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Your role</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Decides which obligations apply to you and which parts of the platform you see.</div>
          </div>
          <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300" data-testid="roles-access-role">
            {ROLE_LABEL[role] || role || 'Not recorded'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Additional roles</div>
            <div className="text-xs text-gray-500 dark:text-gray-400" data-testid="roles-additional">
              <Unrecorded reason="one role per account">Not recorded</Unrecorded> — one role per account; the platform has no store for a second role yet.
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Delegates</div>
            <div className="text-xs text-gray-500 dark:text-gray-400" data-testid="roles-delegates">
              <Unrecorded reason="no delegate store yet">Not recorded</Unrecorded> — no delegate store yet; nobody can act on this account’s behalf.
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Plan</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Licences and invoices live under Billing.</div>
          </div>
          <button type="button" onClick={onJump} className="text-xs text-violet-700 dark:text-violet-300 hover:underline">Open Billing →</button>
        </div>
      </div>
    </Card>
  );
}


// ---------- Documents & agreements (Wave 2) ----------------------------------
//
// The canvas's fourth new pane. `GET /legal/esign` is scoped server-side by
// `esignEnvelopeScope(user)`, so this lists the caller's own envelopes and adds
// no client-side filter that could be mistaken for the boundary.
export function DocumentsAgreementsSection() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.esignList()
      .then((r) => { if (!cancelled) setRows(r?.envelopes || []); })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'Could not load your agreements'); });
    return () => { cancelled = true; };
  }, []);

  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  };

  return (
    <Card
      title="Documents & agreements"
      description="Everything you have signed or sent for signature through Axal VC."
    >
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {!err && rows === null && <p className="text-sm text-gray-500">Loading…</p>}
      {!err && rows && rows.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No agreements on this account yet.
        </p>
      )}
      {!err && rows && rows.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
          {rows.slice(0, 20).map((e) => {
            const signed = Number(e.signed_count || 0);
            const total = Number(e.recipient_count || 0);
            return (
              <div key={e.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {e.document_title || e.document_type || `Envelope #${e.id}`}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {String(e.status).replace(/_/g, ' ')}
                    {total > 0 && ` · ${signed}/${total} signed`}
                    {' · '}{fmt(e.completed_at || e.created_at)}
                  </div>
                </div>
                {e.signed_r2_key && (
                  <a
                    href={api.esignDocumentUrl(e.id)}
                    className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-violet-400 whitespace-nowrap"
                  >
                    Signed PDF
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}


function RolePreferencesSection({ data, patch }) {
  if (data.role === 'founder') return <FounderPrefs data={data} patch={patch} />;
  if (data.role === 'partner') return <PartnerPrefs data={data} patch={patch} />;
  return null;
}


function FounderPrefs({ data, patch }) {
  const rp = data.role_prefs || {};
  const [draft, setDraft] = useState(rp);
  const save = (delta) => {
    const next = { ...draft, ...delta };
    setDraft(next);
    patch({ role_prefs: next });
  };

  return (
    <>
      <Card title="Founder preferences" description="How you want to be matched with deals, capital, and partners.">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Preferred raise band">
            <select value={draft.raise_band || ''} onChange={e => save({ raise_band: e.target.value })} className={inputCls}>
              <option value="">—</option>
              <option value="pre_seed">Pre-seed (under $1M)</option>
              <option value="seed">Seed ($1M – $5M)</option>
              <option value="series_a">Series A ($5M – $20M)</option>
              <option value="growth">Growth ($20M+)</option>
            </select>
          </Field>
          <Field label="Stage now">
            <select value={draft.stage || ''} onChange={e => save({ stage: e.target.value })} className={inputCls}>
              <option value="">—</option>
              <option value="idea">Idea</option>
              <option value="prototype">Prototype</option>
              <option value="mvp">MVP</option>
              <option value="revenue">Revenue</option>
              <option value="scaling">Scaling</option>
            </select>
          </Field>
          <Field label="Co-founder seats open">
            <input type="number" min={0} max={10} value={draft.cofounder_seats ?? 0}
              onChange={e => save({ cofounder_seats: Number(e.target.value) || 0 })} className={inputCls} />
          </Field>
          <Field label="Board posture">
            <select value={draft.board_posture || ''} onChange={e => save({ board_posture: e.target.value })} className={inputCls}>
              <option value="">—</option>
              <option value="independent">Founder-led, independent</option>
              <option value="balanced">Balanced founder + investor</option>
              <option value="investor_led">Investor-led</option>
            </select>
          </Field>
        </div>
        <div className="mt-4">
          <Field label="What you're looking for from Axal VC" hint="Free text. Used by partners reviewing your profile.">
            <textarea value={draft.notes || ''} onChange={e => save({ notes: e.target.value })} rows={3} className={inputCls} />
          </Field>
        </div>
      </Card>
      <CofounderInvitesCard />
    </>
  );
}


function CofounderInvitesCard() {
  const [invites, setInvites] = useState(null);
  const [cap, setCap] = useState(10);
  const [err, setErr] = useState(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('co-founder');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [pendingLink, setPendingLink] = useState(null);

  const load = async () => {
    try {
      const res = await api.listFounderInvites();
      setInvites(res?.invites || []);
      setCap(res?.cap_per_project ?? 10);
    } catch (e) {
      setErr(e.message || 'Failed to load invites');
    }
  };
  useEffect(() => { load(); }, []);

  const send = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setPendingLink(null);
    try {
      const res = await api.createFounderInvite({
        invitee_email: email.trim().toLowerCase(),
        invitee_name: name.trim() || undefined,
        role,
      });
      setEmail('');
      setName('');
      if (!res?.email_sent && res?.accept_url) setPendingLink(res.accept_url);
      await load();
    } catch (e) {
      setErr(e.message || 'Failed to send invite');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id) => {
    if (!window.confirm('Revoke this invite?')) return;
    setBusyId(id);
    try {
      await api.revokeFounderInvite(id);
      await load();
    } catch (e) {
      setErr(e.message || 'Failed to revoke invite');
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = (invites || []).filter(i => !i.accepted_at && !i.revoked_at).length;

  return (
    <Card title="Co-founder invites"
      description={`Invite a co-founder, advisor, or operating partner to join your startup on Axal VC. Up to ${cap} active invites at a time, each valid for 14 days.`}>
      {err && <div className="text-sm text-red-600 mb-3">{err}</div>}

      <div className="grid sm:grid-cols-3 gap-2 mb-3">
        <input type="email" placeholder="cofounder@example.com" value={email}
          onChange={e => setEmail(e.target.value)} className={inputCls} />
        <input type="text" placeholder="Name (optional)" value={name}
          onChange={e => setName(e.target.value)} className={inputCls} />
        <div className="flex gap-2">
          <select value={role} onChange={e => setRole(e.target.value)} className={inputCls}>
            <option value="co-founder">Co-founder</option>
            <option value="advisor">Advisor</option>
            <option value="operator">Operating partner</option>
          </select>
          <button onClick={send} disabled={busy || !email.trim() || pendingCount >= cap}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium whitespace-nowrap">
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </div>

      {pendingCount >= cap && (
        <div className="text-xs text-amber-700 mb-3">Cap reached. Revoke a pending invite to send a new one.</div>
      )}
      {pendingLink && (
        <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 break-all">
          Email delivery is unavailable in this environment — share this link manually:
          <div className="font-mono mt-1">{pendingLink}</div>
        </div>
      )}

      {invites === null ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading invites…</div>
      ) : invites.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">No invites yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="text-left px-2 py-2 font-medium">Invitee</th>
                <th className="text-left px-2 py-2 font-medium">Role</th>
                <th className="text-left px-2 py-2 font-medium">Status</th>
                <th className="text-left px-2 py-2 font-medium">Expires</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {invites.map(i => {
                let status = 'Pending';
                let cls = 'text-amber-700 bg-amber-50 border-amber-200';
                if (i.accepted_at) { status = 'Accepted'; cls = 'text-emerald-700 bg-emerald-50 border-emerald-200'; }
                else if (i.revoked_at) { status = 'Revoked'; cls = 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'; }
                return (
                  <tr key={i.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="px-2 py-2">
                      <div className="text-gray-800 dark:text-gray-200">{i.invitee_name || i.invitee_email}</div>
                      {i.invitee_name && <div className="text-xs text-gray-500 dark:text-gray-400">{i.invitee_email}</div>}
                    </td>
                    <td className="px-2 py-2 text-gray-700 dark:text-gray-300">{i.role}</td>
                    <td className="px-2 py-2">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${cls}`}>{status}</span>
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-600 dark:text-gray-400">
                      {i.expires_at ? new Date(i.expires_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {!i.accepted_at && !i.revoked_at && (
                        <button onClick={() => revoke(i.id)} disabled={busyId === i.id}
                          className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-400">
                          {busyId === i.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}


function PartnerPrefs({ data, patch }) {
  const rp = data.role_prefs || {};
  const [draft, setDraft] = useState(rp);
  const [whitelist, setWhitelist] = useState((rp.sector_whitelist || []).join(', '));
  const [blacklist, setBlacklist] = useState((rp.sector_blacklist || []).join(', '));
  const [autoPass, setAutoPass] = useState(JSON.stringify(rp.auto_pass_rules || {}, null, 2));

  const save = (delta) => {
    const next = { ...draft, ...delta };
    setDraft(next);
    patch({ role_prefs: next });
  };
  const commitLists = () => {
    save({
      sector_whitelist: whitelist.split(',').map(s => s.trim()).filter(Boolean),
      sector_blacklist: blacklist.split(',').map(s => s.trim()).filter(Boolean),
    });
  };
  const commitAutoPass = () => {
    try {
      const parsed = JSON.parse(autoPass || '{}');
      save({ auto_pass_rules: parsed });
    } catch {
      // leave draft alone; surface validation via the textarea border below
    }
  };

  let autoPassValid = true;
  try { JSON.parse(autoPass || '{}'); } catch { autoPassValid = false; }

  return (
    <Card title="Partner / LP investment mandate"
      description="Used to score and pre-filter deals shown to you in Pipeline, Deal Flow, and AI Matches.">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Cheque size (min, USD)">
          <input type="number" min={0} value={draft.min_check ?? ''}
            onChange={e => save({ min_check: Number(e.target.value) || 0 })} className={inputCls} placeholder="25000" />
        </Field>
        <Field label="Cheque size (max, USD)">
          <input type="number" min={0} value={draft.max_check ?? ''}
            onChange={e => save({ max_check: Number(e.target.value) || 0 })} className={inputCls} placeholder="500000" />
        </Field>
        <Field label="Stage focus">
          <select value={draft.stage_focus || ''} onChange={e => save({ stage_focus: e.target.value })} className={inputCls}>
            <option value="">—</option>
            <option value="pre_seed">Pre-seed</option>
            <option value="seed">Seed</option>
            <option value="series_a">Series A</option>
            <option value="growth">Growth</option>
            <option value="opportunistic">Opportunistic</option>
          </select>
        </Field>
        <Field label="Vintage" hint="Year you started actively investing.">
          <input type="number" min={1990} max={new Date().getFullYear()} value={draft.vintage ?? ''}
            onChange={e => save({ vintage: Number(e.target.value) || null })} className={inputCls} />
        </Field>
        <Field label="Fund size cap (USD)">
          <input type="number" min={0} value={draft.fund_size_cap ?? ''}
            onChange={e => save({ fund_size_cap: Number(e.target.value) || 0 })} className={inputCls} placeholder="50000000" />
        </Field>
        <Field label="Risk tolerance"
          hint="Bucket used by older deal scoring. The numeric slider below replaces it for new matching.">
          <select value={draft.risk_tolerance || ''} onChange={e => save({ risk_tolerance: e.target.value })} className={inputCls}>
            <option value="">—</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="frontier">Frontier</option>
          </select>
        </Field>
      </div>

      <div className="mt-4">
        <Field label={`Risk score: ${draft.risk_score ?? 50} / 100`}
          hint="0 = capital preservation, 100 = swing-for-the-fences. Used by AI matching to weight deals against your mandate.">
          <input type="range" min={0} max={100} step={1}
            value={draft.risk_score ?? 50}
            onChange={e => setDraft({ ...draft, risk_score: Number(e.target.value) })}
            onMouseUp={e => save({ risk_score: Number(e.target.value) })}
            onTouchEnd={e => save({ risk_score: Number(e.target.value) })}
            onKeyUp={e => save({ risk_score: Number(e.target.value) })}
            className="w-full accent-violet-600" />
          <div className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400 mt-1">
            <span>Capital preservation</span>
            <span>Balanced</span>
            <span>Frontier / venture</span>
          </div>
        </Field>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <Field label="Sector whitelist" hint="Comma-separated. Empty = no filter.">
          <input value={whitelist} onChange={e => setWhitelist(e.target.value)} onBlur={commitLists}
            placeholder="AI/ML, Fintech, Climate" className={inputCls} />
        </Field>
        <Field label="Sector blacklist" hint="Comma-separated.">
          <input value={blacklist} onChange={e => setBlacklist(e.target.value)} onBlur={commitLists}
            placeholder="Crypto, Cannabis" className={inputCls} />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Auto-pass rules (JSON)"
          hint='Example: {"min_team_size": 2, "exclude_geos": ["RU"]}. Saved on blur if valid JSON.'>
          <textarea value={autoPass} onChange={e => setAutoPass(e.target.value)} onBlur={commitAutoPass} rows={6}
            className={`${inputCls} font-mono ${!autoPassValid ? 'border-red-400 focus:ring-red-500' : ''}`} />
        </Field>
        {!autoPassValid && (
          <div className="text-xs text-red-600 mt-1">Invalid JSON — fix to save.</div>
        )}
      </div>
    </Card>
  );
}


// ---------------------------------------------------------------------------
// Task #1 — Settings expansion (tabbed). New tab components below back the
// /api/settings/{profile,privacy,notifications,appearance,integrations,developer}
// sub-routes against the user_settings table (002_user_settings.sql).
// Each tab fetches its own slice on mount and saves on blur/change.
// ---------------------------------------------------------------------------

const COMMON_TIMEZONES = [
  'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago',
  'America/New_York', 'America/Toronto', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Zurich', 'Europe/Madrid',
  'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore',
  'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney',
];


function ProfileExtrasCard({ flash }) {
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getProfileSettings()
      .then(r => { if (!cancelled) setRow(r); })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load profile settings'); });
    return () => { cancelled = true; };
  }, []);

  const save = async (delta) => {
    if (!row) return;
    const next = { ...row, ...delta };
    setRow(next);
    setBusy(true);
    try {
      const res = await api.updateProfileSettings(delta);
      setRow({ ...next, ...res });
      // D568 — the Personal details card above shows the language and the
      // username this card edits; tell it to re-read.
      try { window.dispatchEvent(new CustomEvent('axal:profile_saved')); } catch { /* no window */ }
      flash('Saved');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
      // Reload from server to undo optimistic update on failure.
      try { setRow(await api.getProfileSettings()); } catch { /* ignore */ }
    } finally {
      setBusy(false);
    }
  };

  if (err) return <Card title="Profile details"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!row) return <Card title="Profile details"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  const tz = row.timezone || 'UTC';
  const tzOptions = COMMON_TIMEZONES.includes(tz) ? COMMON_TIMEZONES : [tz, ...COMMON_TIMEZONES];

  return (
    <Card title="Profile details" description="Locale, timezone, pronouns, archetype character, and your public profile URL.">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Timezone" hint="Used for digests and quiet hours.">
          <select value={tz} onChange={e => save({ timezone: e.target.value })} disabled={busy} className={inputCls}>
            {tzOptions.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </Field>
        <Field label="Locale">
          <select value={row.locale || 'en'} onChange={e => save({ locale: e.target.value })} disabled={busy} className={inputCls}>
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="es">Español</option>
            <option value="pt">Português</option>
          </select>
        </Field>
        <Field label="Pronouns" hint="Optional. Up to 32 characters.">
          <input value={row.pronouns || ''} maxLength={32}
            onChange={e => setRow({ ...row, pronouns: e.target.value })}
            onBlur={() => save({ pronouns: row.pronouns || null })}
            placeholder="they/them" className={inputCls} />
        </Field>
        <Field label="Archetype character"
          hint="Chooses the man or woman pixel-art on your Profile & Fit card. The advisor also asks this.">
          <select value={row.archetype_sex || ''} onChange={e => save({ archetype_sex: e.target.value || null })} disabled={busy} className={inputCls}>
            <option value="">Choose…</option>
            <option value="m">Man</option>
            <option value="f">Woman</option>
            <option value="both">Show both</option>
          </select>
        </Field>
        {/* D568 — the hint said this "Becomes /u/<slug>" and allowed 2–40
            characters. `/u/:handle` reads the account id, not this, and the
            worker takes 3 to 32 (SLUG_RE in services/userSettings.ts). */}
        <Field label="Public profile slug"
          hint="3 to 32 lowercase letters, numbers or hyphens. Saved on your account; your public profile link (/u/…) does not use it yet.">
          <input value={row.profile_slug || ''} maxLength={32}
            onChange={e => setRow({ ...row, profile_slug: e.target.value.toLowerCase() })}
            onBlur={() => save({ profile_slug: row.profile_slug || null })}
            placeholder="jane-doe" className={inputCls} />
        </Field>
      </div>
    </Card>
  );
}

