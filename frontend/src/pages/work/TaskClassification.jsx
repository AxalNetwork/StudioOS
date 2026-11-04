// D1614 WK9 (#4419): task labels and milestone, from this project's catalogues.
import React, { useEffect, useState } from 'react';
import { workAdapter } from './workAdapter.js';
import { BTN_PRIMARY } from '../team/teamUi.jsx';
import { reviewError } from './TaskTimeline.jsx';
export default function TaskClassification({ projectId, task, canManage, onChanged, adapter = workAdapter }) {
  const [catalogue,setCatalogue] = useState(null), [labels,setLabels] = useState([]), [milestone,setMilestone] = useState('');
  const [error,setError] = useState(''), [busy,setBusy] = useState(false);
  useEffect(() => { let live = true; setCatalogue(null);
    Promise.all([adapter.labels(projectId),adapter.milestones(projectId)]).then(([a,b]) => {
      if (!live) return;
      if (!a.available || !b.available) { setError(a.reason || b.reason); return; }
      const ls = a.data?.labels || [];
      setCatalogue({ labels:ls, milestones:b.data?.milestones || [] });
      setLabels(ls.filter((l) => (task.labels || []).some((t) => (typeof t === 'string' ? t === l.uid || t === l.name : t.uid === l.uid))).map((l) => l.uid));
      setMilestone(task.milestone?.uid || ''); setError('');
    }, () => { if (live) setError('Labels and milestones could not be read.'); });
    return () => { live = false; };
  }, [adapter,projectId,task]);
  const save = async (kind) => { setBusy(true);setError('');
    try { const r = kind === 'labels' ? await adapter.setLabels(projectId,task.task_number,{labels}) : await adapter.setMilestone(projectId,task.task_number,{milestone:milestone || null});
      if (!r.available) {setError(r.reason);return;} onChanged?.(r.data?.task ?? r.data);
    } catch(e) {setError(reviewError(e));}finally{setBusy(false);}
  };
  return <section aria-label="Labels and milestone" className="my-3 space-y-2">
    {!catalogue && !error && <p>Reading labels and milestones…</p>}
    {catalogue && <><fieldset disabled={!canManage || busy}><legend>Labels</legend>{catalogue.labels.map((l) => <label className="mr-3 inline-flex gap-1" key={l.uid}>
      <input type="checkbox" checked={labels.includes(l.uid)} onChange={(e) => setLabels((old) => e.target.checked ? [...old,l.uid] : old.filter((v) => v !== l.uid))} />{l.name}</label>)}</fieldset>
      {canManage && <button type="button" disabled={busy} className={BTN_PRIMARY} onClick={() => save('labels')}>Save labels</button>}
      <label className="block">Milestone <select aria-label="Milestone" disabled={!canManage || busy} value={milestone} onChange={(e) => setMilestone(e.target.value)} className="rounded border p-2 dark:bg-gray-900 dark:border-gray-700">
        <option value="">No milestone</option>{catalogue.milestones.map((m) => <option key={m.uid} value={m.uid}>{m.title}{m.state === 'closed' ? ' · Closed' : ''}</option>)}
      </select></label>{canManage && <button type="button" disabled={busy} className={BTN_PRIMARY} onClick={() => save('milestone')}>Save milestone</button>}</>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
