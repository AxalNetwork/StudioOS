import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { personaSegmentsApi } from '../../../lib/api/personaSegments';
import { AdminPageHeader, Lightbox } from '../../../ui';

const INPUT = 'min-h-[44px] w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-sm text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-axal-hairline px-4 text-sm font-bold dark:border-gray-700';
const profiles = [['founder', 'Founders'], ['investor', 'Investors'], ['advisor', 'Advisors'], ['partner', 'Operating Partners'], ['exploring', 'Explorers'], ['any', 'Any profile']];

/** D1128: creation reuses SEG6's name/profile/status/who fields; the existing
 * store owns needs/offers, and questions remain read-only, defined in code. */
export default function NewSegment() {
  const hq = isSuperAdminUser(useAuth()?.user ?? null);
  const loc = useLocation();
  const initialProfile = new URLSearchParams(loc.search).get('profile');
  const [draft, setDraft] = useState({ key: '', name: '', profile: profiles.some(([key]) => key === initialProfile) ? initialProfile : 'any', status: 'draft', who: '' });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const change = key => event => setDraft(d => ({ ...d, [key]: event.target.value }));
  async function save() {
    setBusy(true); setError('');
    try {
      const result = await personaSegmentsApi.createSegment(draft);
      if (!result?.segment?.key) throw new Error('The creation result could not be read. Refresh before trying again.');
      setCreated(result.segment); setConfirm(false);
    } catch (e) { setError(e?.message || 'The segment could not be created. Try again.'); }
    finally { setBusy(false); }
  }
  if (!hq) return <section className="rounded-xl border border-dashed border-axal-hairline p-5 text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid="new-segment-refused"><p>HQ only</p><h1 className="text-xl font-bold">Only HQ creates segments</h1><p>You can suggest one. HQ answers on the Activity tab.</p><Link className={BTN} to="/admin/persona-segments">Back to Persona segments</Link></section>;
  return <div className="mx-auto flex max-w-3xl flex-col gap-5 text-axal-ink dark:text-gray-100" data-testid="new-segment">
    <AdminPageHeader title="New segment" crumb={{ label: 'Persona segments', to: '/admin/persona-segments' }} line="Define who the studio serves. Changes apply to every studio." pills={[{ label: 'HQ only', tone: 'hq' }]} />
    {created ? <section role="status" className="rounded-xl border border-axal-hairline bg-white p-5 dark:border-gray-700 dark:bg-gray-900" data-testid="segment-created"><h2 className="text-lg font-bold">Created {created.name}</h2><p>{created.status === 'active' ? 'Members can choose this segment at sign-up.' : created.status === 'draft' ? 'Only admins can place members in this draft segment.' : 'Retired segments take no new members.'}</p><p>Questions: Not recorded. No questions are set in code for this segment.</p><Link className={BTN} to="/admin/persona-segments">Back to Persona segments</Link></section> : <form className="flex flex-col gap-4 rounded-xl border border-axal-hairline bg-white p-5 dark:border-gray-700 dark:bg-gray-900" onSubmit={e => { e.preventDefault(); setError(''); setConfirm(true); }}>
      <label>Segment key<input required maxLength={64} pattern="[a-z0-9_]+" className={INPUT} value={draft.key} onChange={change('key')} /><span className="text-sm text-axal-muted dark:text-gray-400">A permanent key: lower-case letters, numbers and underscores.</span></label>
      <label>Name<input required maxLength={80} className={INPUT} value={draft.name} onChange={change('name')} /></label>
      <label>Profile<select className={INPUT} value={draft.profile} onChange={change('profile')}>{profiles.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Status<select className={INPUT} value={draft.status} onChange={change('status')}><option value="draft">Draft</option><option value="active">Active</option><option value="retired">Retired</option></select></label>
      <p className="text-sm text-axal-muted dark:text-gray-400">Draft: only admins place members in it. Active: offered at sign-up. Retired: no new members.</p>
      <label>Who they are<textarea maxLength={280} className={INPUT} value={draft.who} onChange={change('who')} /><span className="font-mono text-xs">{draft.who.length} / 280</span></label>
      <p className="text-sm text-axal-muted dark:text-gray-400">Questions and sidebar links are set in code. None are recorded for a new segment. Needs, typical members and offers start empty.</p>
      <div className="flex flex-wrap gap-3"><Link className={BTN} to="/admin/persona-segments">Cancel</Link><button className={`${BTN} bg-axal-violet text-white disabled:opacity-50`} type="submit" disabled={busy}>Create segment</button></div>
    </form>}
    {error && !confirm && <p role="alert">{error}</p>}
    {confirm && <Lightbox label="Create segment" onClose={() => { if (!busy) setConfirm(false); }} phone="sheet"><div className="space-y-4 p-5"><h2 className="text-lg font-bold">Create segment</h2>{error && <p role="alert">{error}</p>}<p>Create {draft.name} as {draft.status} for {profiles.find(([key]) => key === draft.profile)?.[1]}. It applies to every studio. Its questions are not recorded yet.</p><div className="flex gap-3"><button type="button" className={BTN} disabled={busy} onClick={() => setConfirm(false)}>Back</button><button type="button" className={`${BTN} bg-axal-violet text-white disabled:opacity-50`} disabled={busy} onClick={save}>{busy ? 'Creating…' : 'Confirm creation'}</button></div></div></Lightbox>}
  </div>;
}
