import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { agentEngineApi } from '../../lib/api/agentEngine.js';
import { safeReadJSON, safeWriteJSON } from '../../lib/storage.js';
import { useEngineRead, CouldNotRead, Reading } from './EngineParts.jsx';
import { BTN_PRIMARY, BTN_SECONDARY, FIELD } from './teamUi.jsx';

export default function CompanyTasks({ company, member, agents, people, canEdit }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const requestedAgent = params.get('agent');
  const agent = agents.find(a => a.uid === requestedAgent && !a.project);
  const draftKey = `company-task:${company}:${member}:${requestedAgent || 'person'}`;
  const empty = { title: '', detail: '', person: '', due: '' };
  const [draft, setDraft] = useState(() => canEdit ? safeReadJSON(draftKey, empty) : empty);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const read = useEngineRead(() => agentEngineApi.tasks('company', company), [company], 'team:company-tasks');
  const selected = read.data?.tasks?.find(t => t.uid === params.get('task'));
  const set = (name, value) => { setDraft(d => ({ ...d, [name]: value })); setNotice(''); };
  const saveLocal = () => setNotice(safeWriteJSON(draftKey, draft) ? 'Draft saved on this device.' : 'This device could not save the draft. Keep this page open.');
  const forget = () => {
    if (!safeWriteJSON(draftKey, null)) { setNotice('The saved draft could not be deleted.'); return; }
    setDraft(empty); setNotice('Draft deleted.');
  };
  const assignPerson = async () => {
    if (busy || !canEdit || requestedAgent || read.status !== 'ready') return;
    setBusy(true);
    try {
      await agentEngineApi.createTask('company', company, { title: draft.title.trim(), detail: draft.detail, due_at: draft.due || null,
        assignee: { kind: 'person', uid: draft.person } });
      safeWriteJSON(draftKey, null); setDraft(empty); setNotice('Task assigned.'); read.reload();
    } catch (error) { setNotice(error?.message || 'The task could not be assigned. Your answers are still here.'); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 rounded-xl border p-4 dark:border-gray-700" aria-label="Company tasks">
    <h2 className="font-bold">Company tasks</h2>
    {read.status === 'loading' && <Reading />}
    {read.status === 'error' && <CouldNotRead text="Company tasks could not be read." onRetry={read.reload} />}
    {read.status === 'refused' && <p role="status">Your seat cannot read company tasks.</p>}
    {read.status === 'off' && <p role="status">Axal switches the agent engine on for the platform. Team editors can prepare a draft on this device. Nothing is sent, run or charged. When tasks are available, you choose whether to assign it.</p>}
    {read.status === 'ready' && (read.data.tasks.length ? <ul>{read.data.tasks.map(t => {
      const next = new URLSearchParams(search); next.set('task', t.uid);
      return <li key={t.uid}><Link className="underline" to={'?' + next}>{t.title}</Link> · {t.status}</li>;
    })}</ul> : <p>No company tasks.</p>)}
    {selected && <section aria-label="Selected task"><h3>{selected.title}</h3><p>{selected.detail}</p><p>Owner · {selected.assignee?.person?.name || selected.assignee?.agent?.first_name || 'Unassigned'}</p>{selected.due_at && <p>Due · {selected.due_at}</p>}</section>}
    {!canEdit && <p>Read only. A company editor can assign work.</p>}
    {requestedAgent && !agent && <p role="status">The selected agent could not be read on this company’s roster.</p>}
    {canEdit && (!requestedAgent || agent) && ['off', 'ready'].includes(read.status) && <form className="grid max-w-lg gap-3" onSubmit={e => { e.preventDefault(); assignPerson(); }}>
      <h3 className="font-semibold">{agent ? 'Prepare an agent task' : 'Assign a task'}</h3>
      {agent ? <p>For {agent.persona?.name || agent.first_name || agent.role_key}. Save the brief on this device for review.</p> : <label>Team member<select className={FIELD} value={draft.person} onChange={e => set('person', e.target.value)}>
        <option value="">Choose a team member</option>{people.filter(p => p.uid).map(p => <option key={p.uid} value={p.uid}>{p.name}</option>)}
      </select></label>}
      <label>Task title<input className={FIELD} value={draft.title} maxLength={200} onChange={e => set('title', e.target.value)} /></label>
      <label>Expected deliverable<textarea className="block w-full rounded border p-2 dark:bg-gray-900" value={draft.detail} onChange={e => set('detail', e.target.value)} /></label>
      <label>Due date<input className={FIELD} type="date" value={draft.due} onChange={e => set('due', e.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        <button className={BTN_SECONDARY} type="button" onClick={saveLocal} disabled={busy || !draft.title.trim()}>Save draft on this device</button>
        <button className={BTN_SECONDARY} type="button" onClick={forget} disabled={busy}>Delete draft</button>
        {read.status === 'ready' && !agent && <button className={BTN_PRIMARY} disabled={busy || !draft.title.trim() || !draft.person}>Assign to team member</button>}
      </div>
    </form>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
