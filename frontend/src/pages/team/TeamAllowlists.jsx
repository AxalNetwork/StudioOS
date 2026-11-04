/** D4422 (#4422, TM8a): the Team's saved model and approved read-tool checklists. */
import React, { useEffect, useState } from 'react';
import { readAllowlists, saveAllowlists } from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_TEXT, HonestBlock, MUTED, TeamCard } from './teamUi.jsx';

const toolKey = (g) => JSON.stringify([g.integration_uid, g.tool]);
export default function TeamAllowlists({ scope, id }) {
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null); setDraft(null); setError('');
    readAllowlists(scope, id).then((r) => {
      if (!live) return;
      if (!r.available) { setError(r.reason || 'The allowed models and tools could not be read.'); return; }
      setData(r.value); setDraft({ model_ids: r.value.model_ids, tool_grants: r.value.tool_grants });
    });
    return () => { live = false; };
  }, [scope, id, revision]);
  const retry = <button type="button" className={BTN_TEXT} onClick={() => setRevision((v) => v + 1)}>Try again</button>;
  const change = (key, value) => { setDraft((d) => ({ ...d, [key]: value })); setSaved(false); setError(''); };
  const models = data ? [...data.models, ...(draft?.model_ids || []).filter((v) => !data.models.some((m) => m.id === v)).map((v) => ({ id: v, label: v, plan_locked: true }))] : [];
  const servers = data ? [...data.servers] : [];
  for (const g of draft?.tool_grants || []) {
    let server = servers.find((s) => s.integration_uid === g.integration_uid);
    if (!server) { server = { integration_uid: g.integration_uid, name: data.can_manage ? 'Previously allowed server' : 'Allowed MCP server', tools: [] }; servers.push(server); }
    // Copy the tools before extending them: never mutate a Worker response kept in state.
    if (!server.tools.some((t) => t.name === g.tool)) {
      const at = servers.indexOf(server);
      servers[at] = { ...server, tools: [...server.tools, { name: g.tool, unavailable: data.can_manage }] };
    }
  }
  const submit = async () => {
    setBusy(true); setError(''); setSaved(false);
    const r = await saveAllowlists(scope, id, draft);
    setBusy(false);
    if (!r.available) { setError(r.reason || 'The list could not be saved. Your changes are still here.'); return; }
    setSaved(true); setRevision((v) => v + 1);
  };
  return <TeamCard title="Models and tools allowed" testId="team-settings-models">
    {!data || !draft ? <HonestBlock action={error ? retry : null}>{error ? `Unreadable: ${error}` : 'Reading the allowed models and tools…'}</HonestBlock> : <div className="flex flex-col gap-4">
      <p className={`m-0 ${MUTED}`}>{data.inherited ? `Inherited from ${data.scope.name}. Changes apply to the company and all its projects.` : 'These lists narrow the models on the sponsor’s plan and the read tools the sponsor approved.'}</p>
      {!data.can_manage ? <p className={`m-0 ${MUTED}`} data-testid="team-settings-locked">Only {data.scope.name}’s editors can change this.</p> : null}
      <fieldset disabled={!data.can_manage || busy} className="m-0 min-w-0 border-0 p-0">
        <legend className="text-sm font-semibold text-axal-ink dark:text-gray-100">Models</legend>
        <label className={`flex items-center gap-2 py-2 ${MUTED}`}><input type="checkbox" className="accent-violet-600" data-testid="allowlists-model-default" checked={draft.model_ids === null} onChange={(e) => change('model_ids', e.target.checked ? null : models.filter((m) => !m.plan_locked).map((m) => m.id))} />Plan default</label>
        {models.map((m) => <label key={m.id} className={`flex items-start gap-2 py-1 ${MUTED}`}><input type="checkbox" className="accent-violet-600" data-testid={`allowlists-model-${m.id}`} disabled={draft.model_ids === null || (m.plan_locked && !draft.model_ids.includes(m.id))} checked={draft.model_ids === null ? !m.plan_locked : draft.model_ids.includes(m.id)} onChange={(e) => change('model_ids', e.target.checked ? [...draft.model_ids, m.id] : draft.model_ids.filter((v) => v !== m.id))} /><span className="min-w-0 break-words">{m.label}{m.plan_locked ? ' · unavailable on your plan' : ''}</span></label>)}
        {draft.model_ids?.length === 0 ? <p className={MUTED}>No models allowed. Agents cannot run.</p> : null}
      </fieldset>
      <fieldset disabled={!data.can_manage || busy} className="m-0 min-w-0 border-0 p-0">
        <legend className="text-sm font-semibold text-axal-ink dark:text-gray-100">MCP servers and tools</legend>
        <label className={`flex items-center gap-2 py-2 ${MUTED}`}><input type="checkbox" className="accent-violet-600" data-testid="allowlists-tool-default" checked={draft.tool_grants === null} onChange={(e) => change('tool_grants', e.target.checked ? null : servers.flatMap((s) => s.tools.filter((t) => !t.unavailable).map((t) => ({ integration_uid: s.integration_uid, tool: t.name }))))} />Plan default · sponsor’s approved read tools</label>
        {servers.map((s) => <div key={s.integration_uid} className="mb-2"><p className={`m-0 font-semibold ${MUTED}`}>{s.name}</p>{s.tools.map((t) => {
          const g = { integration_uid: s.integration_uid, tool: t.name };
          const selected = draft.tool_grants?.some((v) => toolKey(v) === toolKey(g));
          return <label key={t.name} className={`flex items-start gap-2 py-1 ${MUTED}`}><input type="checkbox" className="accent-violet-600" data-testid={`allowlists-tool-${s.integration_uid}-${t.name}`} checked={draft.tool_grants === null ? !t.unavailable : selected} disabled={draft.tool_grants === null || (t.unavailable && !selected)} onChange={(e) => change('tool_grants', e.target.checked ? [...draft.tool_grants, g] : draft.tool_grants.filter((v) => toolKey(v) !== toolKey(g)))} /><span className="min-w-0 break-words">{t.name}{t.unavailable ? ' · no longer available' : ''}</span></label>;
        })}</div>)}
        {!servers.length && data.can_manage ? <p className={MUTED}>No connected, approved read tools are available for this team.</p> : null}
        {draft.tool_grants?.length === 0 ? <p className={MUTED}>No tools allowed.</p> : null}
      </fieldset>
      {error ? <HonestBlock role="alert">{error} Your changes are still here.</HonestBlock> : null}
      {saved ? <p role="status" className={MUTED}>Allowed models and tools saved.</p> : null}
      {data.can_manage ? <button type="button" className={`${BTN_PRIMARY} self-start`} data-testid="allowlists-save" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button> : null}
    </div>}
  </TeamCard>;
}
