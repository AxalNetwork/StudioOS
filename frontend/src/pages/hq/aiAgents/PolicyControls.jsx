import React, { useEffect, useState } from 'react';
import { adminAiAgentsApi as api } from '../../../lib/api/adminAiAgents';
import { agentEngineApi } from '../../../lib/api/agentEngine';
import { teamAgentsApi } from '../../../lib/api/teamAgents';
import { AREAS } from './aiAgentsModel';
import { REASON_MAX, REASON_MIN, policyRefusal } from './refusals.js';
import {
  CAP_KEYS, READ_TOOLS_MAX, SUGGESTED_MAX, areaForm, areasPayload, capsChanged, capsForm, capsPayload, haltLine, haltReasonFits, HALT_REASON_MAX,
  modelOptions, reasonFits, withTool, withoutTool,
} from './policyModel.js';

/**
 * #4739 (D4162, H4 of #4137; D3851) — the Policies tab's controls, SA6 and SA6b.
 *
 *   Models by area   a picker of up to three suggestions and one default, per area   PUT    …/policy/models
 *   Locked models    lock a model off platform-wide, or unlock it                    POST   …/policy/locks, DELETE …/locks/:model
 *   Caps             the four dollar limits                                          PUT    …/policy/caps
 *   Read tools       the connector tools skills may ask for (reads only)             PUT    …/policy/tools
 *   Engine halt      the agent engine's own halt, next to the pause                  GET|POST /api/admin/agents/halt
 *
 * Every write takes a reason (10 to 500 characters; the halt's is at most 64) and is audited
 * with it. A refusal shows the sentence `refusals.js` keeps for its code, never the error's own
 * text. `Policies()` in `Operations.jsx` draws this above the guardrails and the pause.
 */

const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const H2 = 'text-[14px] font-extrabold text-axal-ink dark:text-gray-100';
const H3 = 'text-[13px] font-bold text-axal-ink dark:text-gray-100';
const BOX = 'space-y-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const FIELD = 'mt-1 block w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL = 'block text-[12.5px] font-semibold text-axal-ink dark:text-gray-200';
const BTN = 'min-h-11 rounded-lg border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200';
const PRIMARY = 'min-h-11 rounded-lg bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';
const ALERT = 'text-[12.5px] text-red-700 dark:text-red-300';

/** A reason field and the write's busy flag and refusal, shared by every control here. */
function useChange(reload) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const submit = async (fn, saved) => {
    setBusy(true); setError(''); setDone('');
    try { await fn(); setReason(''); setDone(saved); reload?.(); } catch (e) { setError(policyRefusal(e)); } finally { setBusy(false); }
  };
  return { reason, setReason, busy, error, setError, done, submit };
}

function Why({ change, id }) {
  return (
    <label className={LABEL}>Reason · required
      <textarea value={change.reason} onChange={(e) => change.setReason(e.target.value)} rows={2} maxLength={REASON_MAX} className={FIELD} data-testid={`${id}-reason`} />
      <span className={MUTED}>{REASON_MIN} to {REASON_MAX} characters. It is recorded with the change.</span>
    </label>
  );
}

function Outcome({ change, id }) {
  return (
    <>
      {change.error ? <p role="alert" className={ALERT} data-testid={`${id}-error`}>{change.error}</p> : null}
      {change.done ? <p role="status" className="text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid={`${id}-done`}>{change.done}</p> : null}
    </>
  );
}

// ─── Models by area ─────────────────────────────────────────────────────────

function AreaModels({ policy, models, reload }) {
  const [slug, setSlug] = useState(AREAS[0].slug);
  const [form, setForm] = useState(() => areaForm(policy.area_models, AREAS[0].slug));
  const change = useChange(reload);
  useEffect(() => { setForm(areaForm(policy.area_models, slug)); }, [slug, policy.area_models]);
  const options = modelOptions(models, policy.locks, [...form.suggested, form.default]);
  const setAt = (i, id) => setForm((f) => {
    const suggested = [...f.suggested]; suggested[i] = id;
    const kept = suggested.filter(Boolean);
    return { suggested, default: kept.includes(f.default) ? f.default : (kept[0] ?? '') };
  });
  const payload = areasPayload(policy.area_models, slug, { ...form, suggested: form.suggested.filter(Boolean) });
  const save = () => {
    if (!payload.ok) { change.setError(payload.problem); return; }
    if (!reasonFits(change.reason)) { change.setError(`Say why, in ${REASON_MIN} to ${REASON_MAX} characters.`); return; }
    return change.submit(() => api.setModels(payload.areas, change.reason.trim()), 'Saved. Teams see these models from now on.');
  };
  return (
    <section className={BOX} aria-label="Models by area" data-testid="policy-models">
      <h3 className={H3}>Models by area</h3>
      <p className={MUTED}>Each area suggests up to {SUGGESTED_MAX} models, in order, and one is the default. {models == null ? 'The model catalogue could not be read, so only the models already chosen are listed.' : ''}</p>
      <label className={LABEL}>Area
        <select value={slug} onChange={(e) => setSlug(e.target.value)} className={FIELD} data-testid="policy-area">{AREAS.map((a) => <option key={a.slug} value={a.slug}>{a.label}</option>)}</select>
      </label>
      {Array.from({ length: SUGGESTED_MAX }, (_, i) => (
        <label key={i} className={LABEL}>Suggestion {i + 1}{i === 0 ? ' · required' : ''}
          <select value={form.suggested[i] ?? ''} onChange={(e) => setAt(i, e.target.value)} className={FIELD} data-testid={`policy-suggested-${i}`}>
            <option value="">{i === 0 ? 'Choose a model' : 'None'}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}{o.locked ? ' (locked off)' : ''}</option>)}
          </select>
        </label>
      ))}
      <label className={LABEL}>Default
        <select value={form.default} onChange={(e) => setForm((f) => ({ ...f, default: e.target.value }))} className={FIELD} data-testid="policy-default">
          {form.suggested.filter(Boolean).map((id) => <option key={id} value={id}>{options.find((o) => o.id === id)?.label ?? id}</option>)}
        </select>
      </label>
      <Why change={change} id="policy-models" />
      <button type="button" className={PRIMARY} disabled={change.busy} onClick={save} data-testid="policy-models-save">{change.busy ? 'Saving…' : 'Save models for this area'}</button>
      <Outcome change={change} id="policy-models" />
    </section>
  );
}

// ─── Locks ──────────────────────────────────────────────────────────────────

function Locks({ policy, models, reload }) {
  const [model, setModel] = useState('');
  const change = useChange(reload);
  const locked = new Set(policy.locks.map((l) => l.model));
  const choices = (models ?? []).filter((m) => !locked.has(m.id));
  const need = (fn, saved) => (reasonFits(change.reason) ? change.submit(fn, saved) : change.setError(`Say why, in ${REASON_MIN} to ${REASON_MAX} characters.`));
  return (
    <section className={BOX} aria-label="Locked models" data-testid="policy-locks">
      <h3 className={H3}>Locked models</h3>
      {policy.locks.length === 0 ? <p className={MUTED}>No model is locked off.</p> : (
        <ul className="space-y-2">
          {policy.locks.map((l) => (
            <li key={l.model} className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
              <span><strong>{models?.find((m) => m.id === l.model)?.label ?? l.model}</strong>: {l.reason}{l.locked_by?.name ? ` · ${l.locked_by.name}` : ''}</span>
              <button type="button" className={BTN} disabled={change.busy} onClick={() => need(() => api.unlockModel(l.model, change.reason.trim()), 'Unlocked.')} data-testid="policy-unlock">Unlock</button>
            </li>
          ))}
        </ul>
      )}
      <label className={LABEL}>Lock a model off
        {models == null ? <span className={`${ALERT} block`}>The model catalogue could not be read.</span> : (
          <select value={model} onChange={(e) => setModel(e.target.value)} className={FIELD} data-testid="policy-lock-model">
            <option value="">Choose a model</option>
            {choices.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
      </label>
      <Why change={change} id="policy-locks" />
      <button type="button" className={PRIMARY} disabled={!model || change.busy} onClick={() => need(() => api.lockModel(model, change.reason.trim()).then(() => setModel('')), 'Locked off.')} data-testid="policy-lock">Lock off</button>
      <Outcome change={change} id="policy-locks" />
    </section>
  );
}

// ─── Caps ───────────────────────────────────────────────────────────────────

function Caps({ policy, reload }) {
  const [form, setForm] = useState(() => capsForm(policy));
  const change = useChange(reload);
  useEffect(() => { setForm(capsForm(policy)); }, [policy]);
  const save = () => {
    const p = capsPayload(form, change.reason);
    if (!p.ok) { change.setError(p.problem); return; }
    return change.submit(() => api.setCaps(p.caps, p.reason), 'Saved. The new caps apply from now on.');
  };
  return (
    <section className={BOX} aria-label="Caps" data-testid="policy-caps">
      <h3 className={H3}>Caps</h3>
      <p className={MUTED}>Dollar amounts. A blank cap is not set; it is not zero.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {CAP_KEYS.map(({ key, label }) => (
          <label key={key} className={LABEL}>{label} (USD)
            <input inputMode="decimal" value={form[key]} placeholder="Not set" onChange={(e) => { setForm((f) => ({ ...f, [key]: e.target.value })); change.setError(''); }} className={FIELD} data-testid={`policy-cap-${key}`} />
          </label>
        ))}
      </div>
      <Why change={change} id="policy-caps" />
      <button type="button" className={PRIMARY} disabled={change.busy || !capsChanged(form, policy)} onClick={save} data-testid="policy-caps-save">{change.busy ? 'Saving…' : 'Save caps'}</button>
      <Outcome change={change} id="policy-caps" />
    </section>
  );
}

// ─── Read tools ─────────────────────────────────────────────────────────────

function ReadTools({ policy, reload }) {
  const [tools, setTools] = useState(policy.read_tools);
  const [draft, setDraft] = useState('');
  const change = useChange(reload);
  useEffect(() => { setTools(policy.read_tools); }, [policy.read_tools]);
  const add = () => {
    const r = withTool(tools, draft);
    if (!r.ok) { change.setError(r.problem); return; }
    setTools(r.tools); setDraft(''); change.setError('');
  };
  const save = () => {
    if (!reasonFits(change.reason)) { change.setError(`Say why, in ${REASON_MIN} to ${REASON_MAX} characters.`); return; }
    return change.submit(() => api.setReadTools(tools, change.reason.trim()), 'Saved. Skills may request these tools.');
  };
  const same = JSON.stringify(tools) === JSON.stringify(policy.read_tools);
  return (
    <section className={BOX} aria-label="Allowed read tools" data-testid="policy-tools">
      <h3 className={H3}>Allowed read tools</h3>
      <p className={MUTED}>Skills may only request these connector tools, and only reads. Up to {READ_TOOLS_MAX}.</p>
      {tools.length === 0 ? <p className={MUTED}>No read tool is allowed.</p> : (
        <ul className="space-y-1">
          {tools.map((t) => (
            <li key={t}><label className="flex min-h-11 items-center gap-2 text-[12.5px]"><input type="checkbox" checked onChange={() => { setTools((x) => withoutTool(x, t)); change.setError(''); }} data-testid="policy-tool" />{t}</label></li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className={LABEL}>Add a read tool<input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="hubspot.read_contacts" className={FIELD} data-testid="policy-tool-new" /></label>
        <button type="button" className={BTN} onClick={add} data-testid="policy-tool-add">Add</button>
      </div>
      <Why change={change} id="policy-tools" />
      <button type="button" className={PRIMARY} disabled={change.busy || same} onClick={save} data-testid="policy-tools-save">{change.busy ? 'Saving…' : 'Save read tools'}</button>
      <Outcome change={change} id="policy-tools" />
    </section>
  );
}

// ─── The engine halt ────────────────────────────────────────────────────────

/** The agent engine's halt (`/api/admin/agents/halt`): read here, set and cleared with a reason, next to the pause. */
export function EngineHalt() {
  const [state, setState] = useState({ status: 'loading', halt: null });
  const [revision, setRevision] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', halt: null });
    agentEngineApi.haltState()
      .then((halt) => { if (!alive) return; if (typeof halt?.halted !== 'boolean') throw new Error('unreadable'); setState({ status: 'ready', halt }); })
      .catch(() => { if (alive) setState({ status: 'unreadable', halt: null }); });
    return () => { alive = false; };
  }, [revision]);
  const halted = state.halt?.halted === true;
  const change = async () => {
    setBusy(true); setError('');
    try { await agentEngineApi.setHalt({ halted: !halted, reason: reason.trim() }); setReason(''); setRevision((n) => n + 1); } catch (e) { setError(policyRefusal(e)); } finally { setBusy(false); }
  };
  return (
    <section className={BOX} aria-label="Agent engine halt" data-testid="policy-halt">
      <h3 className={H2}>Agent engine halt</h3>
      <p className={MUTED}>The engine’s own switch: set, every run ends at its next step and nothing new starts. It is separate from the pause above, which stops the agents teams have.</p>
      {state.status === 'loading' ? <p role="status" className={MUTED}>Reading the halt…</p> : null}
      {state.status === 'unreadable' ? (
        <p role="alert" className={ALERT} data-testid="policy-halt-unreadable">The halt could not be read. That is not the same as agents being able to run. <button type="button" className={BTN} onClick={() => setRevision((n) => n + 1)}>Try again</button></p>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="policy-halt-state">{haltLine(state.halt)}</p>
          <label className={LABEL}>Reason · required
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={HALT_REASON_MAX} className={FIELD} data-testid="policy-halt-reason" />
            <span className={MUTED}>{REASON_MIN} to {HALT_REASON_MAX} characters.</span>
          </label>
          <button type="button" className={halted ? PRIMARY : BTN} disabled={busy || !haltReasonFits(reason)} onClick={change} data-testid="policy-halt-go">
            {busy ? 'Saving…' : halted ? 'Clear the halt' : 'Halt every agent'}
          </button>
          {error ? <p role="alert" className={ALERT} data-testid="policy-halt-error">{error}</p> : null}
        </>
      ) : null}
    </section>
  );
}

/** SA6: every control. `policy` is `GET …/policy`'s `policy`; `reload` re-reads it after a write. */
export default function PolicyControls({ policy, reload }) {
  const [models, setModels] = useState(undefined);
  useEffect(() => {
    let alive = true;
    teamAgentsApi.roles()
      .then((r) => { if (alive) setModels(Array.isArray(r?.models) ? r.models : null); })
      .catch(() => { if (alive) setModels(null); });
    return () => { alive = false; };
  }, []);
  const catalogue = models === undefined ? [] : models;
  return (
    <div className="space-y-4" data-testid="policy-controls">
      <h2 className={H2}>Platform AI policy</h2>
      <AreaModels policy={policy} models={catalogue} reload={reload} />
      <Locks policy={policy} models={catalogue} reload={reload} />
      <Caps policy={policy} reload={reload} />
      <ReadTools policy={policy} reload={reload} />
      <EngineHalt />
    </div>
  );
}
