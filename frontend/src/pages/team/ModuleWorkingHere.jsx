import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { agentEngineApi } from '../../lib/api/agentEngine.js';
import { teamAgentsApi } from '../../lib/api/teamAgents.js';
import { teamsApi } from '../../lib/api/teams.js';
import AssignPicker from '../work/AssignPicker.jsx';
import { WorkingHereSheet } from './WorkingHere.jsx';
import { BTN_SECONDARY, HonestBlock } from './teamUi.jsx';

export default function ModuleWorkingHere({ projectId, module, moduleLabel, readOnly }) {
  const navigate = useNavigate();
  const [roster, setRoster] = useState(null);
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [task, setTask] = useState(null);
  useEffect(() => {
    let live = true;
    teamsApi.listProjectMembers(projectId).then((r) => { if (live) setRoster(r); }).catch(() => {});
    return () => { live = false; };
  }, [projectId]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setRead(null);
    Promise.allSettled([
      agentEngineApi.tasks('project', projectId, { module }),
      teamAgentsApi.listAgents('project', projectId, { module }),
    ]).then(([tasks, agents]) => { if (live) setRead({ tasks, agents }); });
    return () => { live = false; };
  }, [open, projectId, module, attempt]);

  if (!roster?.members?.length) return null;
  const tasks = read?.tasks.value?.tasks;
  const agents = read?.agents.value?.agents;
  const code = (result) => result?.reason?.code ?? result?.reason?.data?.error;
  const agentsOff = code(read?.agents) === 'team_agents_off';
  const engineOff = code(read?.tasks) === 'agent_engine_off';
  const failed = read && ((!tasks && !engineOff) || (!agents && !agentsOff));
  const workingOn = (kind, uid) => {
    if (!tasks) return undefined;
    const t = tasks.find((row) => row.assignee?.[kind]?.uid === uid && !['done', 'cancelled'].includes(row.status));
    return t ? { title: t.title, due: t.due_at } : null;
  };
  const people = roster.members.filter((p) => p.name && tasks?.some((t) => t.assignee?.person?.uid === p.uid))
    .map((p) => ({ ...p, key: p.uid, initials: p.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join(''), working_on: workingOn('person', p.uid) }));
  const teamUrl = `/projects/${encodeURIComponent(projectId)}/settings/team`;
  return <>
    <button type="button" className={BTN_SECONDARY} onClick={() => setOpen(true)}>Working here</button>
    {open && <WorkingHereSheet moduleLabel={moduleLabel} people={tasks ? people : undefined}
      agentsBlock={agents ? { available: true, value: { agents: agents.map((a) => ({ ...a, working_on: workingOn('agent', a.uid) })) } } : null}
      onClose={() => { setOpen(false); setTask(null); }} onOpenTeam={() => navigate(teamUrl)}
      extra={<>
        {!read && <p>Reading this module…</p>}
        {agentsOff && <HonestBlock>AI agents are not switched on.</HonestBlock>}
        {engineOff && <HonestBlock>The task store is not switched on.</HonestBlock>}
        {failed && <HonestBlock role="alert" action={<button type="button" className={BTN_SECONDARY} onClick={() => setAttempt((n) => n + 1)}>Try again</button>}>Couldn’t be read.</HonestBlock>}
        {!readOnly && roster.can_manage && tasks?.map((t) => task === t.uid
          ? <AssignPicker key={t.uid} projectId={projectId} taskUid={t.uid} module={module}
              current={{ kind: t.assignee.kind, uid: (t.assignee.person ?? t.assignee.agent)?.uid }}
              onAssigned={() => { setTask(null); setAttempt((n) => n + 1); }} onCancel={() => setTask(null)} />
          : <button key={t.uid} type="button" className={BTN_SECONDARY} onClick={() => setTask(t.uid)}>Assign this task to… · {t.title}</button>)}
      </>} />}
  </>;
}
