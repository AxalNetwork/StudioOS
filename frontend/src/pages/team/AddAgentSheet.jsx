import React, { useEffect, useState } from 'react';
import { Sheet, Unrecorded } from '../../ui';
import { AgentTile, PersonAvatar } from './AgentMark.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, FIELD, HonestBlock, MUTED, PendingOwner } from './teamUi.jsx';
import { HOLD_LINE, RULEBOOK_SECTIONS, WHO_PAYS, heldLabel, initials, money } from './teamModel.js';

/**
 * D1497 (#3727, TM3a–TM3c, TM9d2) — "Add an AI agent", a Sheet at 640 with
 * three steps: Role, Agent, Review.
 *
 * It writes through #3840's `addAgent` (wired) and is reached only when the
 * agents read is available and its `plan_ok` holds: otherwise "AI agent" in
 * Add to team is off with the reason. A refusal (403 plan_required, 409
 * role_taken, 422 model_not_offered or tool_not_approved, 400 invalid_cap or
 * invalid_name) is drawn above the footer in words.
 *
 *   Role    one agent per role per scope: a role held here is disabled.
 *   Agent   only models offered on the plan; holds per run, never "~$". The
 *           model list is read from the roles answer's `models`. #3840 sends
 *           no model list (neither `roles` nor the agents list carries one;
 *           D1497 §3b), so the step says the list could not be read and Add
 *           cannot finish until a read of the offered models lands. Tools are read-only
 *           and come from #3844's `toolChoices` (`{ servers: [{ integration_uid,
 *           name, status, tools: [{ name, description }] }] }`): a switch,
 *           then each server's approved read tools as checkboxes; the ticked
 *           set is sent as `tool_grants: [{ integration_uid, tool }]` and
 *           summarised on Review. A disconnected server cannot be ticked.
 *           Write tools never appear.
 *   Review  a first name and a surname (migration 712 stores both), the rule
 *           book it starts from (one row per section, each opening in place,
 *           and "Edit for this company"), the sponsor (you; owner Q2 B) and a
 *           monthly cap above $0.
 */

const grantKey = (uid, tool) => `${uid}::${tool}`;

/** TM3c: one rule book section, a row that opens in place. */
function RuleRow({ label, text }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((v) => !v);
  return (
    <div className="border-b border-axal-hairline last:border-b-0 dark:border-gray-800">
      <div role="button" tabIndex={0} aria-expanded={open} onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
        className="flex min-h-[46px] cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px]" data-testid={`add-agent-rule-${label}`}>
        <span aria-hidden="true" className="text-[11px] text-axal-muted dark:text-gray-400">{open ? '▾' : '▸'}</span>
        <span className="w-[150px] shrink-0 font-bold text-axal-ink dark:text-gray-100">{label}</span>
        <span className={`min-w-0 flex-1 text-axal-ink dark:text-gray-200 ${open ? '' : 'truncate'}`}>{text || <Unrecorded />}</span>
      </div>
    </div>
  );
}

const STEPS = ['Role', 'Agent', 'Review'];

function Stepper({ at }) {
  return (
    <ol className="m-0 flex list-none items-center gap-3 p-0" aria-label="Steps">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">
          <span className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-full font-mono text-[11px] ${i < at ? 'bg-axal-positive text-white' : i === at ? 'bg-axal-violet text-white' : 'bg-axal-ground text-axal-muted dark:bg-gray-800 dark:text-gray-400'}`}>{i < at ? '✓' : i + 1}</span>{s}
        </li>
      ))}
    </ol>
  );
}

export default function AddAgentSheet({ scope, roles, models, held = [], me, onClose, onAdded, onEditRulebook }) {
  const [step, setStep] = useState(0);
  const [role, setRole] = useState(null);
  const [model, setModel] = useState(null);
  const [tools, setTools] = useState(null);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [cap, setCap] = useState('');
  const [useTools, setUseTools] = useState(true);
  const [granted, setGranted] = useState(() => new Set());
  const [refusal, setRefusal] = useState('');
  useEffect(() => { let alive = true; agents.toolChoices().then((b) => { if (alive) setTools(b); }); return () => { alive = false; }; }, []);
  const picked = (roles || []).find((r) => r.key === role);
  const pickedModel = (models || []).find((m) => m.id === model);
  const capOk = Number(cap) > 0;
  const nameOk = [first, last].every((s) => s.trim().length <= 40);
  const ready = step === 0 ? !!picked : step === 1 ? !!pickedModel : capOk && nameOk;
  const titles = ['Pick a role', 'Pick the agent', 'Review and add'];
  const servers = tools?.available && Array.isArray(tools.value?.servers) ? tools.value.servers : [];
  const grants = useTools ? servers.flatMap((sv) => (sv.tools || []).filter((t) => granted.has(grantKey(sv.integration_uid, t.name))).map((t) => ({ integration_uid: sv.integration_uid, tool: t.name }))) : [];
  const grantedLines = servers.map((sv) => ({ name: sv.name, tools: grants.filter((g) => g.integration_uid === sv.integration_uid).map((g) => g.tool) })).filter((x) => x.tools.length);
  const tick = (uid, tool) => setGranted((s) => { const n = new Set(s); const k = grantKey(uid, tool); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const add = async () => {
    setRefusal('');
    const kind = scope.kind === 'company' ? 'company' : 'project';
    const id = scope.kind === 'company' ? scope.company.uid : scope.project.id;
    const out = await agents.addAgent(kind, id, {
      role_key: role, first_name: first.trim() || null, last_name: last.trim() || null, model_id: model, tool_grants: grants,
      monthly_cap_microusd: Math.round(Number(cap) * 1e6),
    });
    if (!out.available) { setRefusal(out.reason); return; }
    onAdded?.(out.value);
  };
  return (
    <Sheet title="Add an AI agent" sub={`Step ${step + 1} of 3 · ${titles[step]}`} width={640} onClose={onClose} testId="add-agent-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={step ? () => setStep(step - 1) : onClose}>{step ? 'Back' : 'Cancel'}</button>
          <button type="button" className={BTN_PRIMARY} disabled={!ready} onClick={step < 2 ? () => setStep(step + 1) : add} data-testid="add-agent-next">{step < 2 ? 'Next' : 'Add agent'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-4 px-5 py-5">
        <Stepper at={step} />
        {step === 0 ? (
          <div role="radiogroup" aria-label="Role" className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {(roles || []).map((r) => {
              const taken = held.includes(r.key);
              const on = role === r.key;
              return (
                <div key={r.key} role="radio" aria-checked={on} aria-disabled={taken || undefined} tabIndex={taken ? -1 : 0}
                  onClick={() => { if (!taken) setRole(r.key); }} onKeyDown={(e) => { if (!taken && (e.key === ' ' || e.key === 'Enter')) setRole(r.key); }}
                  className={`flex cursor-pointer flex-col gap-1.5 rounded-axal-md border p-3 ${on ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline dark:border-gray-700'} ${taken ? 'cursor-not-allowed opacity-60' : ''}`}
                  data-testid={`add-agent-role-${r.key}`}>
                  <span className="flex items-center gap-2"><AgentTile size={28} /><b className="text-[13.5px] text-axal-ink dark:text-gray-100">{r.name}</b></span>
                  <span className={MUTED}>{r.mission}</span>
                  {Array.isArray(r.works_in) && r.works_in.length ? (
                    <span className="flex flex-wrap gap-1"><span className="font-mono text-[10.5px] uppercase tracking-[.11em] text-axal-muted dark:text-gray-400">Works in</span>
                      {r.works_in.map((w) => <span key={w.key || w} className="rounded-axal-pill bg-axal-ground px-2 py-0.5 text-[11px] text-axal-ink dark:bg-gray-800 dark:text-gray-200">{w.label || w}</span>)}
                    </span>
                  ) : null}
                  {taken ? <span className={MUTED}>{`${heldLabel(r)} already works here. One agent per role.`}</span> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {step === 1 ? (
          <>
            {picked ? <p className={`m-0 rounded-axal-md bg-axal-ground px-3 py-2 dark:bg-gray-900 ${MUTED}`}><b className="text-axal-ink dark:text-gray-100">{picked.name}</b> · {picked.mission}</p> : null}
            <h3 className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">Platform model</h3>
            {Array.isArray(models) && models.length ? (
              <div role="radiogroup" aria-label="Platform model" className="flex flex-col gap-1.5">
                {models.map((m) => (
                  <label key={m.id} className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-axal-md border px-3 py-2 ${model === m.id ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline dark:border-gray-700'}`}>
                    <input type="radio" name="model" checked={model === m.id} onChange={() => setModel(m.id)} className="accent-violet-600" />
                    <span className="min-w-0 flex-1">
                      <b className="block text-[13px] text-axal-ink dark:text-gray-100">{m.label}{m.kind ? ` · ${m.kind}` : ''}</b>
                      <span className={MUTED}>{m.hold_microusd != null ? `${HOLD_LINE(money(m.hold_microusd))} a run` : 'Its hold is shown before each run'}</span>
                    </span>
                    <span className="text-[11.5px] font-semibold text-axal-positive dark:text-emerald-300">✓ Offered on your plan</span>
                  </label>
                ))}
              </div>
            ) : <HonestBlock>The models offered on your plan could not be read. That is not the same as none.</HonestBlock>}
            <p className={`m-0 ${MUTED}`}>Only models offered on your plan are listed.</p>
            <div className="flex items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-axal-ink dark:text-gray-100" id="add-agent-tools-label">May use your connected tools (read-only)</span>
                <span className={MUTED}>Write tools never appear here.</span>
              </span>
              {tools?.available ? (
                <button type="button" role="switch" aria-checked={useTools} aria-labelledby="add-agent-tools-label" onClick={() => setUseTools((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full ${useTools ? 'bg-axal-violet dark:bg-violet-500' : 'bg-axal-hairline dark:bg-gray-700'}`} data-testid="add-agent-tools-switch">
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${useTools ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              ) : null}
            </div>
            {!tools ? <p className={`m-0 ${MUTED}`}>Reading…</p>
              : !tools.available ? <p className={`m-0 ${MUTED}`}>Read-only tools are not open for agents yet.</p>
                : !servers.length ? <p className={`m-0 ${MUTED}`}>You have approved no read tool on a connected server.</p>
                  : useTools ? (
                    <div className="flex flex-col gap-2" data-testid="add-agent-tools">
                      {servers.map((sv) => {
                        const off = sv.status && sv.status !== 'connected';
                        return (
                          <fieldset key={sv.integration_uid} disabled={off} className="m-0 flex flex-col gap-1 rounded-axal-md border border-axal-hairline px-3 py-2 dark:border-gray-700">
                            <legend className="px-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{sv.name} <span className={MUTED}>· {off ? 'disconnected' : 'read tools you approved'}</span></legend>
                            {(sv.tools || []).map((t) => (
                              <label key={t.name} className="flex min-h-[32px] items-center gap-2 text-[13px] text-axal-ink dark:text-gray-200" title={t.description || undefined}>
                                <input type="checkbox" checked={granted.has(grantKey(sv.integration_uid, t.name))} onChange={() => tick(sv.integration_uid, t.name)} className="accent-violet-600" data-testid={`add-agent-tool-${sv.integration_uid}-${t.name}`} />
                                <span className="font-mono text-[12px]">{t.name}</span>
                              </label>
                            ))}
                          </fieldset>
                        );
                      })}
                    </div>
                  ) : null}
            <p className={`m-0 ${MUTED}`}>Tool results are read as data, never as instructions.</p>
            <p className={`m-0 rounded-axal-md bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-ink dark:bg-violet-900/20 dark:text-gray-100`}>
              Before each run it shows the hold: {pickedModel?.hold_microusd != null ? HOLD_LINE(money(pickedModel.hold_microusd)) : <>its hold <Unrecorded /> · you pay what it uses</>}.
            </p>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1"><span className={MUTED}>First name</span><input className={FIELD} value={first} onChange={(e) => setFirst(e.target.value)} maxLength={40} data-testid="add-agent-first" /></label>
              <label className="flex flex-col gap-1"><span className={MUTED}>Surname</span><input className={FIELD} value={last} onChange={(e) => setLast(e.target.value)} maxLength={40} data-testid="add-agent-last" /></label>
            </div>
            <p className={`m-0 ${MUTED}`}>Give the agent a first name and a surname so the team can tell it apart. It keeps the AI agent mark everywhere.</p>
            <dl className="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
              <dt className={MUTED}>Name</dt><dd className="m-0 text-axal-ink dark:text-gray-100" data-testid="add-agent-review-name">{[first.trim(), last.trim()].filter(Boolean).join(' ') || picked?.name || <Unrecorded />}</dd>
              <dt className={MUTED}>Role</dt><dd className="m-0 flex items-center gap-1.5 text-axal-ink dark:text-gray-100"><AgentTile size={20} />{picked?.name}</dd>
              <dt className={MUTED}>Platform model</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{pickedModel?.label}{pickedModel?.hold_microusd != null ? ` · holds up to ${money(pickedModel.hold_microusd)} a run · you pay what it uses` : ''}</dd>
              <dt className={MUTED}>Tools granted</dt>
              <dd className="m-0 text-axal-ink dark:text-gray-100" data-testid="add-agent-review-tools">
                {grantedLines.length ? grantedLines.map((g) => <span key={g.name} className="block">{g.name} · {g.tools.join(', ')} · read-only</span>) : 'None'}
              </dd>
            </dl>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Rule book</span>
              <div className="overflow-hidden rounded-axal-md border border-axal-hairline dark:border-gray-700" data-testid="add-agent-rulebook">
                {RULEBOOK_SECTIONS.map(([k, label]) => {
                  const v = picked?.default_rules?.[k];
                  const text = Array.isArray(v) ? v.join(', ') : v;
                  return <RuleRow key={k} label={label} text={text || (k === 'may_do_automatically' ? 'Nothing in v1' : null)} />;
                })}
              </div>
              {onEditRulebook && picked ? <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={() => onEditRulebook(picked.key)} data-testid="add-agent-edit-rulebook">Edit for this company</button> : null}
            </div>
            <p className={`m-0 ${MUTED}`}>It sees only what you can see, and only inside its modules.</p>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Sponsor</span>
              <span className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100"><PersonAvatar initials={initials(me?.name)} size={30} />You{me?.name ? ` (${me.name})` : ''}</span>
              <span className={MUTED}>It runs as you. Its runs are paid from your AI tokens, up to its monthly cap. <PendingOwner /></span>
              <span className="sr-only">{WHO_PAYS}</span>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Monthly cap</span>
              <input inputMode="decimal" className={`${FIELD} w-40`} value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="$" data-testid="add-agent-cap" />
              <span className={MUTED}>Must be more than $0. The agent pauses when it reaches the cap.</span>
            </label>
            {refusal ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{refusal}</p> : null}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
