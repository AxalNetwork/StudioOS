import React, { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../../ui';
import { agentEngineApi } from '../../lib/api/agentEngine.js';
import * as agents from './agentsAdapter.js';
import { reportError } from '../../lib/log';
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, FIELD, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { Chip, CouldNotRead, Reading, Sentence, useEngineRead } from './EngineParts.jsx';
import { PERSONA_ROLE, onTeamKeys } from './personaModel.js';
import {
  ENGINE_OFF, SUGGEST_EMPTY, SUGGEST_FOOT, SUGGEST_READER, SUGGEST_TITLE, capMicro, monthWord, stageWord,
} from './engineModel.js';

/**
 * D1531 (#3742 E8, TM15): "An agent for this goal", a Sheet at 640, opened
 * from a goal (and from TM18c's "Suggest a company team" with no goal).
 *
 * `GET …/suggested-team?goal=` names roles, not people; each row is drawn as
 * the persona that holds the role (`PERSONA_ROLE`); a role whose persona is
 * already on the team, or has none, cannot be ticked. The person sets each model and
 * cap; Add sends one `addAgent` per ticked row and reports each result in its
 * own words. A row already on the team is off. Nothing runs until a task is
 * started.
 */
export function personaFor(roleKey, personas, taken) {
  const list = (Array.isArray(personas) ? personas : []).filter((p) => !taken.has(p.key));
  return list.find((p) => PERSONA_ROLE[p.key] === roleKey) || null;
}

export default function SuggestAgentsSheet({ scope, id, goal = null, canManage = false, models = null, roles = null, team = [], onClose, onAdded }) {
  const read = useEngineRead(() => agentEngineApi.suggestedTeam(scope, id, { goal: goal?.uid }), [scope, id, goal?.uid], 'agent-engine:suggested-team');
  const [personas, setPersonas] = useState(null);
  const [modelList, setModelList] = useState(models);
  const [rows, setRows] = useState({});
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; agents.personas().then((b) => { if (live) setPersonas(b?.available ? b.value?.personas || [] : []); }); return () => { live = false; }; }, []);
  useEffect(() => {
    if (models || !canManage) return undefined;
    let live = true;
    agents.roles().then((b) => { if (live && b?.available) setModelList(b.value?.models || []); });
    return () => { live = false; };
  }, [models, canManage]);
  const taken = useMemo(() => onTeamKeys(team), [team]);
  const list = useMemo(() => {
    const used = new Set(taken);
    return (read.data?.suggestions || []).map((s) => {
      const p = personaFor(s.role_key, personas, used);
      if (p) used.add(p.key);
      return { ...s, persona: p };
    });
  }, [read.data, personas, taken]);
  const roleKnown = (k) => !roles || roles.some((r) => r.key === k);
  const row = (s) => rows[s.role_key] || {
    on: !s.already_on_team && !!s.persona,
    model: (modelList || [])[0]?.id || '',
    cap: s.template?.suggested_cap_microusd ? String(Number(s.template.suggested_cap_microusd) / 1e6) : '',
  };
  const patch = (k, v) => setRows((r) => ({ ...r, [k]: { ...row(list.find((s) => s.role_key === k)), ...v } }));
  const ticked = list.filter((s) => !s.already_on_team && s.persona && row(s).on);
  const ready = ticked.length && ticked.every((s) => capMicro(row(s).cap) && row(s).model);
  const add = async () => {
    setBusy(true);
    const out = [];
    for (const s of ticked) {
      const r = row(s);
      try {
        const res = await agents.addAgent(scope, id, { role_key: s.role_key, persona_key: s.persona.key, model_id: r.model, monthly_cap_microusd: capMicro(r.cap), tool_grants: [] });
        out.push({ key: s.role_key, name: s.persona.name, ok: res.available, text: res.available ? `${s.persona.name} added` : `${s.persona.name}: ${res.reason}` });
      } catch (e) {
        out.push({ key: s.role_key, name: s.persona.name, ok: false, text: `${s.persona.name}: That did not go through.` });
        reportError('agent-engine:suggest-add', e);
      }
    }
    setResults(out); setBusy(false);
    if (out.some((o) => o.ok)) onAdded?.();
  };
  const stage = stageWord(read.data?.stage);
  const sub = goal ? goal.title : 'Suggest a company team';
  return (
    <Sheet title={SUGGEST_TITLE} sub={sub} width={640} onClose={onClose} testId="suggest-sheet"
      footer={canManage ? (
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>{results ? 'Close' : 'Cancel'}</button>
          {!results ? <button type="button" className={BTN_PRIMARY} disabled={!ready || busy} title={!ticked.length ? 'Nothing to add' : undefined} onClick={add} data-testid="suggest-add">{ticked.length ? `Add ${ticked.length} selected` : 'Add selected'}</button> : null}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2"><span className={MUTED}>{SUGGEST_READER}</span><button type="button" className={BTN_SECONDARY} onClick={onClose}>Close</button></div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {read.status === 'loading' || (read.status === 'ready' && !personas) ? <Reading /> : null}
        {read.status === 'off' ? <HonestBlock>{ENGINE_OFF}</HonestBlock> : null}
        {read.status === 'error' || read.status === 'refused' ? <CouldNotRead text="Suggestions could not be read." second="" onRetry={read.reload} /> : null}
        {read.status === 'ready' && personas && !list.length ? <Sentence tone="amb" testId="suggest-empty">{SUGGEST_EMPTY}</Sentence> : null}
        {read.status === 'ready' && personas && list.length ? (
          <>
            {stage ? <p className={`m-0 ${MUTED}`}>This goal sits at the <b>{stage}</b> stage.</p> : null}
            <p className={`m-0 ${EYEBROW}`}>Suggested agents</p>
            {list.map((s) => {
              const r = row(s);
              const off = s.already_on_team || !s.persona || !roleKnown(s.role_key);
              return (
                <div key={s.role_key} className="flex flex-col gap-2 rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700" data-testid="suggest-row">
                  <div className="flex items-start gap-2">
                    {canManage ? <input type="checkbox" className="mt-1" checked={!off && r.on} disabled={off} onChange={() => patch(s.role_key, { on: !r.on })} aria-label={`Add ${s.persona?.name || s.role_key}`} /> : null}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">
                        {s.persona?.name || 'No agent is offered for this role now'}
                        {s.already_on_team ? <Chip>Already on the team</Chip> : null}
                      </span>
                      {s.why ? <span className={MUTED}>{s.why}</span> : null}
                      <span className={MONO}>{monthWord(s.est_month_microusd)}</span>
                    </span>
                  </div>
                  {canManage && !off && r.on ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Model</span>
                        <select className={FIELD} value={r.model} onChange={(e) => patch(s.role_key, { model: e.target.value })}>
                          {(modelList || []).map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Monthly cap</span>
                        <input className={FIELD} inputMode="decimal" value={r.cap} onChange={(e) => patch(s.role_key, { cap: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="$" aria-label={`Monthly cap for ${s.persona.name}`} />
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <p className={`m-0 ${MUTED}`}>{SUGGEST_FOOT}</p>
          </>
        ) : null}
        {results ? (
          <div className="flex flex-col gap-1" data-testid="suggest-results">
            <p className={`m-0 ${EYEBROW}`}>Result</p>
            {results.map((o) => <p key={o.key} role={o.ok ? 'status' : 'alert'} className={`m-0 text-[13px] ${o.ok ? 'text-emerald-800 dark:text-emerald-200' : 'text-axal-destructive dark:text-red-300'}`}>{o.ok ? '✓ ' : ''}{o.text}</p>)}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
