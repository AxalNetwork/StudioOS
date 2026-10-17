/**
 * D702 (#1664) — Your venture, `/profile/venture` (board S7m, SMP:140-144),
 * from `GET /api/profile/venture` (decision 8). The venture is the one
 * `useProject` picks, read-only, so the page keeps `?project_id=`.
 *
 * Edit is one form, "Edit your venture", opened from the three editable
 * sections' Edit and saved through `PATCH /api/profile/venture`. It is a
 * `Lightbox` that becomes a page below 1024px (`pageBelow="lg"`, D695); while
 * it is open on a phone the frame draws it alone, so its back bar is the only
 * bar. "Read from your modules" has no Edit: each row is its module's own
 * figure, edited where it is recorded.
 */
import React, { useState } from 'react';
import { profileApi } from '../../lib/api/profile';
import { PhoneRows, Unreadable, usePhoneWidth } from '../../ui';
import Lightbox from '../../ui/Lightbox.jsx';
import { useProject } from '../cycles/CycleRoute';
import ProfileFrame, { EditAction, ProfileCard, ProfileSection, ProfileText, useProfileRead } from './ProfileFrame';
import { PROFILE_PAGES, VENTURE_FIELDS, ventureChanges, ventureDraft } from './profileModel';

export const NO_VENTURE = 'No venture yet.';
export const NOT_FOUNDER = 'Only the venture’s founder can see this page.';
export const MODULES_NOTE = 'These update from your modules. Edit them where they are recorded.';

const nr = (title, reason, extra = {}) => ({ title, notRecorded: true, notRecordedReason: reason, ...extra });

/** The venture's state as a sentence, or null when the read answered. */
export function ventureBlocker(project, read) {
  if (project.status === 'none') return NO_VENTURE;
  if (project.status === 'unreadable') return 'Your ventures could not be read.';
  if (read.status === 'unreadable' && read.error?.status === 403) return NOT_FOUNDER;
  return null;
}

/** The page's sections from the venture read; `onEdit` opens the form. */
export function VentureView({ read, onEdit }) {
  if (read.status === 'loading' || read.status === 'idle') {
    return <p className="px-[22px] text-[13px] text-gray-600 dark:text-gray-400">Loading your venture…</p>;
  }
  if (read.status !== 'ready') {
    return <div className="px-[22px]"><Unreadable what="Your venture" claim="Nothing on it has changed." onRetry={read.reload} /></div>;
  }
  const v = read.data;
  const edit = (testid) => <EditAction onClick={onEdit} testid={testid} />;
  const f = v.facts || {};
  const fact = (title, value) => (value == null || value === '' ? nr(title, 'Not set yet') : { title, value: String(value) });
  return (
    <>
      <ProfileSection title="Venture" action={edit('venture-edit-card')} testid="venture-card">
        <ProfileCard
          heading={v.card?.name || 'Untitled venture'}
          line={v.card?.description || null}
          chips={[v.card?.sector, v.card?.stage?.label].filter(Boolean)}
        />
      </ProfileSection>
      <ProfileSection title="The problem it solves" action={edit('venture-edit-problem')} testid="venture-problem">
        <ProfileText text={v.problem_statement} empty="Not written yet" />
      </ProfileSection>
      <PhoneRows groups={[{
        label: 'Facts', action: edit('venture-edit-facts'), testid: 'venture-facts',
        rows: [fact('Founded', f.founded_year), fact('Location', f.hq), fact('Team', f.employee_count), fact('Website', f.website)],
      }]} />
      <PhoneRows groups={[{
        label: 'Read from your modules', testid: 'venture-modules', note: MODULES_NOTE,
        rows: (v.modules || []).map((m) => (m.value == null
          ? nr(m.label, m.reason || 'Not recorded', { key: m.key, description: m.state === 'unreadable' ? `${m.sub} · could not be read` : m.sub })
          : { key: m.key, title: m.label, description: m.sub, value: m.value })),
      }]} />
    </>
  );
}

/** The form: the seven fields, Save, and the Worker's refusal in its own words. */
export function VentureForm({ venture, onClose, onSaved, save }) {
  const [before] = useState(() => ventureDraft(venture));
  const [draft, setDraft] = useState(before);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e?.preventDefault?.();
    const changes = ventureChanges(before, draft);
    if (!Object.keys(changes).length) { onClose(); return; }
    setBusy(true); setError(null);
    try { onSaved(await save(changes)); } catch (err) {
      setError({ field: err?.field || err?.data?.field || null, text: err?.message || 'Your changes were not saved. Try again.' });
    } finally { setBusy(false); }
  };
  const input = 'w-full rounded-[11px] border border-gray-300 bg-white px-3 py-2.5 text-[14px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
  return (
    <Lightbox
      label="Edit your venture"
      eyebrow="Your venture"
      title="Edit your venture"
      onClose={onClose}
      pageBelow="lg"
      testId="venture-form"
      footer={(
        <button type="submit" form="venture-form-fields" disabled={busy} className="min-h-[44px] w-full rounded-[13px] bg-violet-700 text-[14.5px] font-bold text-white disabled:opacity-60 dark:bg-violet-600">
          {busy ? 'Saving…' : 'Save'}
        </button>
      )}
    >
      <form id="venture-form-fields" onSubmit={submit} className="grid gap-3.5 px-5 py-4">
        {VENTURE_FIELDS.map((f) => (
          <label key={f.key} className="grid gap-1 text-[12px] font-bold text-gray-700 dark:text-gray-300">
            {f.label}
            {f.multiline
              ? <textarea rows={4} maxLength={f.max} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} className={input} />
              : <input type={f.number ? 'number' : f.key === 'website' ? 'url' : 'text'} maxLength={f.max} value={draft[f.key]}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} className={input} />}
            {error?.field === f.key && <span role="alert" className="font-semibold text-red-700 dark:text-red-300">{error.text}</span>}
          </label>
        ))}
        {error && !VENTURE_FIELDS.some((f) => f.key === error.field) && (
          <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">{error.text}</p>
        )}
        <p className="text-[12px] text-gray-600 dark:text-gray-400">The venture’s name is not changed here.</p>
      </form>
    </Lightbox>
  );
}

export default function VenturePage() {
  const project = useProject();
  const phone = usePhoneWidth();
  const pid = project.status === 'ready' ? project.projectId : null;
  const read = useProfileRead(() => profileApi.venture(pid), [pid], { enabled: !!pid });
  const [editing, setEditing] = useState(false);
  const blocker = ventureBlocker(project, read);
  const form = editing && read.status === 'ready' && (
    <VentureForm
      venture={read.data}
      onClose={() => setEditing(false)}
      save={(changes) => profileApi.saveVenture(pid, changes)}
      onSaved={(next) => { read.set(next); setEditing(false); }}
    />
  );
  if (form && phone) return <ProfileFrame page={PROFILE_PAGES.venture} bare>{form}</ProfileFrame>;
  return (
    <ProfileFrame page={PROFILE_PAGES.venture}>
      {blocker
        ? <p className="px-[22px] text-[13.5px] text-gray-700 dark:text-gray-300" role="status" data-testid="venture-blocked">{blocker}</p>
        : <VentureView read={project.status === 'loading' ? { status: 'loading' } : read} onEdit={() => setEditing(true)} />}
      {form}
    </ProfileFrame>
  );
}
