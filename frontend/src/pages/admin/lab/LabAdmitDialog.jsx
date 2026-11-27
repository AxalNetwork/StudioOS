import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { adminLabApi } from '../../../lib/api/adminLab';
import { Dialog, Field, INPUT, ReadState, useRead, useWrite } from './labParts';
import { refusalText } from './labDesksModel';
/** D1123: Users uses D945's structured, reasoned admission, never a label. */
export default function LabAdmitDialog({ user, onClose, onChanged }) {
  const [cycle, setCycle] = useState(''), [reason, setReason] = useState(''), [confirm, setConfirm] = useState(false), [tick, setTick] = useState(0);
  const read = useRead('admit-cohorts', tick, () => api.adminCohortApplications().then(r => {
    if (!Array.isArray(r?.cycles)) throw new Error('invalid_cohorts');
    return r;
  }));
  const w = useWrite(onChanged, {}, refusalText);
  const choices = (read.data?.cycles || []).filter(c => c.app_status === 'open');
  return <Dialog title={`Admit to the Spin-Out Lab · ${user.name || 'Member'}`} sub="This admits the member without an application into the chosen cohort. They start on its scheduled start date. Your reason is recorded and the founder is notified. Nothing is preselected."
    pageBelow={null} w={w} onClose={onClose} action="Admit" disabled={!cycle || !reason.trim() || read.status !== 'ready'} testId="lab-users-admit"
    onAction={() => w.run(() => adminLabApi.admit({ user_id: user.id, cycle_id: Number(cycle), reason: reason.trim(), confirm_over_places: confirm }))}
    done={w.reply ? `Admitted to ${w.reply.cohort}. ${w.reply.emailed ? 'Notification email sent.' : 'Email delivery was not confirmed.'}` : ''}>
    <ReadState read={read} what="Open cohorts" claim="A cohort must be read before admitting this member." onRetry={() => setTick(n => n + 1)} testId="lab-admit-cohorts" />
    <Field label="Open cohort"><select data-testid="lab-admit-cycle" className={INPUT} value={cycle} disabled={w.busy || Boolean(w.reply)} onChange={e => { setCycle(e.target.value); setConfirm(false); }}><option value="">Choose an open cohort</option>{choices.map(c => <option key={c.id} value={c.id}>{c.year}-{String(c.month).padStart(2, '0')}</option>)}</select></Field>
    {read.status === 'ready' && !choices.length && <p>No cohort is open for admission.</p>}
    <Field label="Reason · required"><textarea data-testid="lab-admit-reason" className={INPUT} value={reason} maxLength={2000} disabled={w.busy || Boolean(w.reply)} onChange={e => setReason(e.target.value)} /></Field>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" data-testid="lab-admit-over-places" checked={confirm} disabled={w.busy || Boolean(w.reply)} onChange={e => setConfirm(e.target.checked)} />I explicitly confirm admission beyond the cohort’s places if it is full.</label>
  </Dialog>;
}
