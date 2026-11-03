import React, { useEffect, useMemo, useState } from 'react';
import { Lightbox, Sheet, Unrecorded } from '../../ui';
import { PersonAvatar } from './AgentMark.jsx';
import AgentCard, { AgentAvatar, RiskScale } from './AgentCard.jsx';
import AxalValuesBars from '../../components/profile/AxalValuesBars.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, FIELD, HonestBlock, MUTED, PendingOwner } from './teamUi.jsx';
import { HOLD_LINE, RULEBOOK_SECTIONS, WHO_PAYS, initials, money } from './teamModel.js';
import { SkillsStep } from './SkillSheets.jsx';
import { previewRadar } from './skillsModel.js';
import { SKILL_AXES } from '../../lib/assessmentMeta.js';
import {
  COMPARE_MAX, NOT_RECORDED, agentValueBars, filterOptions, fitLine, gallery, galleryCount, onTeamKeys, pronouns, rolesFor,
  toggleCompare, workLabel,
} from './personaModel.js';

/**
 * D4119 (#4119, AG2–AG4; D1497 TM3a–TM3c before it) — "Add an AI agent", a
 * Sheet at 640 with three steps: Who, Skills, Model and cap.
 *
 *   Who      the 16 personas (R1's `GET /api/teams/personas`, D4117) as full
 *            agent cards, with search by name, the filters Top core value,
 *            Natural fit and Risk (no philosophy, outlook or trade-off), the
 *            count, and Compare (up to three, side by side: values, risk,
 *            natural fit and story). A persona already on this team shows
 *            "On your team" and cannot be chosen twice.
 *   Skills   D1612's step (SK6), with the coverage these skills give (a
 *            radar with none reads "Not recorded") and the cost line, which
 *            reads "Not recorded" until R5 (#4121) serves its figure.
 *   Model and cap
 *            the platform model and read-only tools (as before), the area of
 *            work the agent's rule book starts from, the sponsor (you) and a
 *            monthly cap above $0.
 *
 * THE AREA OF WORK. The Worker still keys a rule book by a role and requires
 * `role_key` on add (D4117 §5), so the step names each by its work
 * ("Finance", "Legal"; `workLabel`), never a job title, suggested from the
 * persona (`rolesFor`). One agent per area per team: an area held here is off.
 *
 * It writes through #3840's `addAgent` with `persona_key`; a refusal (403
 * plan_required, 409 role_taken or persona_on_team, 422 model_not_offered or
 * tool_not_approved, 400 invalid_cap) is drawn above the footer in words.
 */

const grantKey = (uid, tool) => `${uid}::${tool}`;
const STEPS = ['Who', 'Skills', 'Model and cap'];
const EYE = 'font-mono text-[10.5px] font-semibold uppercase tracking-[.11em] text-axal-muted dark:text-gray-400';

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

function Stepper({ at }) {
  return (
    <ol className="m-0 flex list-none items-center gap-3 p-0" aria-label="Add an AI agent">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">
          <span className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-full font-mono text-[11px] ${i < at ? 'bg-axal-positive text-white' : i === at ? 'bg-axal-violet text-white' : 'bg-axal-ground text-axal-muted dark:bg-gray-800 dark:text-gray-400'}`}>{i < at ? '✓' : i + 1}</span>{s}
        </li>
      ))}
    </ol>
  );
}

/** AG2c: up to three personas side by side. Values and risk are fixed; skills come after. */
export function CompareDialog({ personas, legend, chosen, onTeam, onChoose, onClose }) {
  return (
    <Lightbox label={`Compare ${personas.length} agents`} title={`Compare ${personas.length} agents`} sub="Values and risk are fixed. Skills are added after you choose."
      onClose={onClose} width={960} testId="agent-compare">
      <div className={`grid grid-cols-1 gap-3 ${personas.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {personas.map((p) => {
          const on = chosen === p.key;
          const taken = onTeam.has(p.key);
          return (
            <section key={p.key} aria-label={p.name} data-testid={`agent-compare-${p.key}`}
              className={`flex flex-col gap-3 rounded-axal-md border p-3.5 ${on ? 'border-2 border-axal-violet bg-axal-lavender/50 dark:border-violet-500 dark:bg-violet-900/20' : 'border-axal-hairline dark:border-gray-700'}`}>
              <div className="flex items-start gap-3">
                <AgentAvatar persona={p} size={64} />
                <div className="min-w-0">
                  <b className="block text-[17px] font-extrabold text-axal-ink dark:text-gray-100">{p.name}</b>
                  {pronouns(p) ? <span className={MUTED}>{pronouns(p)}</span> : null}
                  <span className="block text-[12.5px] italic text-axal-ink dark:text-gray-200">{p.tagline ? `“${p.tagline}”` : NOT_RECORDED}</span>
                </div>
              </div>
              <AxalValuesBars testId={`agent-compare-values-${p.key}`} title="Values" highlight bars={agentValueBars(p, legend)} />
              <div className="flex flex-col gap-1"><span className={EYE}>Risk</span><RiskScale risk={p.risk} /></div>
              <div className="flex flex-col gap-1"><span className={EYE}>Natural fit</span><span className="text-[12.5px] text-axal-ink dark:text-gray-200">{fitLine(p)}</span></div>
              <div className="flex flex-col gap-1"><span className={EYE}>Story</span><p className="m-0 text-[12.5px] leading-[1.5] text-axal-ink dark:text-gray-200">{p.story || NOT_RECORDED}</p></div>
              <div className="mt-auto">
                {on ? <span className="rounded-axal-pill bg-axal-violet px-2 py-0.5 text-[11px] font-semibold text-white">Chosen</span>
                  : taken ? <span className={MUTED}>{`${p.name} is already on your team.`}</span>
                    : <button type="button" className={BTN_SECONDARY} onClick={() => onChoose(p.key)} data-testid={`agent-compare-choose-${p.key}`}>{`Choose ${p.name}`}</button>}
              </div>
            </section>
          );
        })}
      </div>
    </Lightbox>
  );
}

/** AG2: who joins. */
export function WhoStep({ block, scopeName, onTeam, chosen, setChosen }) {
  const [f, setF] = useState({ q: '', value: '', fit: '', risk: '' });
  const [compare, setCompare] = useState([]);
  const [comparing, setComparing] = useState(false);
  if (!block) return <p className={`m-0 ${MUTED}`}>Reading…</p>;
  if (!block.available) return <HonestBlock>{block.unreadable ? 'The agents could not be read. That is not the same as having none.' : block.reason}</HonestBlock>;
  const all = Array.isArray(block.value?.personas) ? block.value.personas : [];
  const legend = block.value?.values || [];
  const opts = filterOptions(all, legend);
  const shown = gallery(all, f, onTeam);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pick = (p) => { if (!p.on_team) setChosen(p.key); };
  const comparedPersonas = compare.map((k) => all.find((p) => p.key === k)).filter(Boolean);
  return (
    <div className="flex flex-col gap-3" data-testid="add-agent-who">
      <p className={`m-0 ${MUTED}`}>{`Choose who joins ${scopeName}. Each agent is a named character with fixed values. You choose skills next. A named person accepts everything an agent proposes.`}</p>
      <div className="flex flex-wrap items-center gap-2" role="search">
        <input className={`${FIELD} min-w-[160px] flex-1`} type="search" placeholder="Search by name" aria-label="Search by name" value={f.q} onChange={set('q')} data-testid="agent-search" />
        <select className={FIELD} aria-label="Top core value" value={f.value} onChange={set('value')} data-testid="agent-filter-value">{opts.value.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className={FIELD} aria-label="Natural fit" value={f.fit} onChange={set('fit')} data-testid="agent-filter-fit">{opts.fit.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className={FIELD} aria-label="Risk" value={f.risk} onChange={set('risk')} data-testid="agent-filter-risk">{opts.risk.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <span className={`ml-auto font-mono text-[11.5px] ${MUTED}`} data-testid="agent-count">{galleryCount(shown, all)}</span>
      </div>
      {!shown.length ? <p className={`m-0 ${MUTED}`} data-testid="agent-gallery-none">No agent matches these filters.</p> : (
        <div role="radiogroup" aria-label="Who joins" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {shown.map((p) => {
            const on = chosen === p.key;
            const inCompare = compare.includes(p.key);
            return (
              <div key={p.key} role="radio" aria-checked={on} aria-disabled={p.on_team || undefined} tabIndex={p.on_team ? -1 : 0}
                onClick={() => pick(p)} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(p); } }}
                className={p.on_team ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} data-testid={`agent-pick-${p.key}`}>
                <AgentCard persona={p} legend={legend} onTeam={p.on_team} selected={on}
                  footer={(
                    <>
                      <span className={`font-mono text-[11px] ${MUTED}`}>0 skills · cost per run <Unrecorded /></span>
                      <button type="button" aria-pressed={inCompare} className={`ml-auto rounded-axal-pill border px-2.5 py-0.5 text-[11.5px] font-semibold ${inCompare ? 'border-axal-violet bg-axal-lavender text-axal-violet-deep dark:border-violet-500 dark:bg-violet-900/30 dark:text-violet-300' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-200'}`}
                        onClick={(e) => { e.stopPropagation(); setCompare((c) => toggleCompare(c, p.key)); }} onKeyDown={(e) => e.stopPropagation()}
                        disabled={!inCompare && compare.length >= COMPARE_MAX} data-testid={`agent-compare-toggle-${p.key}`}>{inCompare ? '✓ Compare' : 'Compare'}</button>
                    </>
                  )} />
              </div>
            );
          })}
        </div>
      )}
      {compare.length ? (
        <div role="region" aria-label="Compare" className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-axal-md border border-axal-hairline bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900" data-testid="agent-compare-tray">
          <span className={EYE}>{`Compare · ${compare.length} of ${COMPARE_MAX}`}</span>
          {comparedPersonas.map((p) => <AgentCard key={p.key} persona={p} size="chip" />)}
          <span className="ml-auto flex gap-2">
            <button type="button" className={BTN_TEXT} onClick={() => setCompare([])}>Clear</button>
            <button type="button" className={BTN_SECONDARY} disabled={compare.length < 2} onClick={() => setComparing(true)} data-testid="agent-compare-open">{`Compare ${compare.length} ›`}</button>
          </span>
        </div>
      ) : null}
      {comparing && comparedPersonas.length >= 2 ? (
        <CompareDialog personas={comparedPersonas} legend={legend} chosen={chosen} onTeam={onTeam}
          onChoose={(k) => { setChosen(k); setComparing(false); }} onClose={() => setComparing(false)} />
      ) : null}
    </div>
  );
}

/** AG3: the coverage these skills give, by area; none reads "Not recorded". */
export function CoverageLines({ skills }) {
  const vector = previewRadar(null, skills);
  const lines = Object.entries(vector).filter(([, lv]) => lv > 0).map(([slug, lv]) => ({ slug, label: SKILL_AXES[slug] || slug, lv }));
  const LV = ['', 'Aware', 'Working', 'Proficient', 'Advanced', 'Expert'];
  return (
    <div className="flex flex-col gap-1 rounded-axal-md border border-axal-hairline px-3 py-2 dark:border-gray-700" data-testid="add-agent-coverage">
      <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Coverage with these skills</span>
      {lines.length ? lines.map((l) => <span key={l.slug} className="text-[12.5px] text-axal-ink dark:text-gray-200">{l.label} · {LV[l.lv]}</span>)
        : <span className="text-[12.5px] italic text-axal-muted dark:text-gray-400">{NOT_RECORDED}</span>}
      <span className={`font-mono text-[11.5px] ${MUTED}`} data-testid="add-agent-cost">{`With ${skills.length} skill${skills.length === 1 ? '' : 's'} · cost per run `}<Unrecorded /></span>
    </div>
  );
}

export default function AddAgentSheet({ scope, roles, models, held = [], team = [], me, onClose, onAdded, onEditRulebook }) {
  const [step, setStep] = useState(0);
  const [personasBlock, setPersonasBlock] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [role, setRole] = useState(null);
  const [model, setModel] = useState(null);
  const [tools, setTools] = useState(null);
  const [cap, setCap] = useState('');
  const [useTools, setUseTools] = useState(true);
  const [granted, setGranted] = useState(() => new Set());
  const [refusal, setRefusal] = useState('');
  const [skillPicks, setSkillPicks] = useState(null);
  const [skillList, setSkillList] = useState([]);
  useEffect(() => { let alive = true; agents.toolChoices().then((b) => { if (alive) setTools(b); }); return () => { alive = false; }; }, []);
  useEffect(() => { let alive = true; agents.personas().then((b) => { if (alive) setPersonasBlock(b); }); return () => { alive = false; }; }, []);
  const onTeam = useMemo(() => onTeamKeys(team), [team]);
  const persona = personasBlock?.available ? (personasBlock.value?.personas || []).find((p) => p.key === chosen) || null : null;
  const name = persona?.name || 'the agent';
  const scopeName = scope?.kind === 'company' ? (scope.company?.name || 'this company') : (scope?.project?.name || 'this project');
  const roleKeys = (roles || []).map((r) => r.key);
  const areas = persona ? rolesFor(persona, roleKeys).filter((k) => !held.includes(k)) : [];
  const roleKey = role && areas.includes(role) ? role : areas[0] || null;
  const picked = (roles || []).find((r) => r.key === roleKey);
  const pickedModel = (models || []).find((m) => m.id === model);
  const capOk = Number(cap) > 0;
  const ready = step === 0 ? !!persona : step === 1 ? true : !!pickedModel && !!picked && capOk;
  const chosenSkills = skillList.filter((sk) => skillPicks?.has(sk.uid));
  const servers = tools?.available && Array.isArray(tools.value?.servers) ? tools.value.servers : [];
  const grants = useTools ? servers.flatMap((sv) => (sv.tools || []).filter((t) => granted.has(grantKey(sv.integration_uid, t.name))).map((t) => ({ integration_uid: sv.integration_uid, tool: t.name }))) : [];
  const tick = (uid, tool) => setGranted((s) => { const n = new Set(s); const k = grantKey(uid, tool); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const titles = [`Choose who joins ${scopeName}`, `Choose skills for ${name}`, `Model and cap for ${name}`];
  const add = async () => {
    setRefusal('');
    const kind = scope.kind === 'company' ? 'company' : 'project';
    const id = scope.kind === 'company' ? scope.company.uid : scope.project.id;
    const out = await agents.addAgent(kind, id, {
      role_key: roleKey, persona_key: persona.key, model_id: model, tool_grants: grants,
      monthly_cap_microusd: Math.round(Number(cap) * 1e6),
      // D1612 (SK6, A2 #3956): the skills step's picks, sent only when there are any.
      ...(chosenSkills.length ? { skills: chosenSkills.map((sk) => ({ uid: sk.uid, version: sk.version })) } : {}),
    });
    if (!out.available) { setRefusal(out.reason); return; }
    onAdded?.(out.value);
  };
  const next = ['Next: skills', 'Next: model and cap', `Add ${name} to ${scopeName}`];
  return (
    <Sheet title="Add an AI agent" sub={`Step ${step + 1} of ${STEPS.length} · ${titles[step]}`} width={640} onClose={onClose} testId="add-agent-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={step ? () => setStep(step - 1) : onClose}>{step ? 'Back' : 'Cancel'}</button>
          <button type="button" className={BTN_PRIMARY} disabled={!ready} onClick={step < 2 ? () => setStep(step + 1) : add} data-testid="add-agent-next">{next[step]}</button>
        </div>
      )}>
      <div className="flex flex-col gap-4 px-5 py-5">
        <Stepper at={step} />
        {step === 0 ? <WhoStep block={personasBlock} scopeName={scopeName} onTeam={onTeam} chosen={chosen} setChosen={setChosen} /> : null}
        {step === 1 ? (
          <>
            {persona ? <AgentCard persona={persona} legend={personasBlock?.value?.values} size="compact" /> : null}
            <p className={`m-0 ${MUTED}`}>{`Skills are added separately from who ${name} is. Every skill is read on every run, so add only what this team needs.`}</p>
            <SkillsStep scope={scope} role={roleKey} picked={skillPicks} setPicked={setSkillPicks} onList={setSkillList} />
            <CoverageLines skills={chosenSkills} />
          </>
        ) : null}
        {step === 2 ? (
          <>
            {persona ? <AgentCard persona={persona} legend={personasBlock?.value?.values} size="compact" sub={`${chosenSkills.length} skill${chosenSkills.length === 1 ? '' : 's'}`} /> : null}
            <p className={`m-0 ${MUTED}`}>{`Pick the model ${name} runs on and the most ${pronouns(persona) === 'She/her' ? 'her' : pronouns(persona) === 'He/him' ? 'his' : 'its'} runs may spend each month.`}</p>
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
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Area of work</span>
              {areas.length ? (
                <select className={FIELD} value={roleKey || ''} onChange={(e) => setRole(e.target.value)} data-testid="add-agent-area">
                  {areas.map((k) => <option key={k} value={k}>{workLabel(k)}</option>)}
                </select>
              ) : <HonestBlock>Every area of work already has an agent on this team. One agent per area.</HonestBlock>}
              <span className={MUTED}>{`The rule book ${name} starts from. One agent per area on a team; any skill can still go to any agent.`}</span>
            </label>
            {picked ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Rule book</span>
                <div className="overflow-hidden rounded-axal-md border border-axal-hairline dark:border-gray-700" data-testid="add-agent-rulebook">
                  {RULEBOOK_SECTIONS.map(([k, label]) => {
                    const v = picked?.default_rules?.[k];
                    const text = Array.isArray(v) ? v.join(', ') : v;
                    return <RuleRow key={k} label={label} text={text || (k === 'may_do_automatically' ? 'Nothing in v1' : null)} />;
                  })}
                </div>
                {onEditRulebook ? <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={() => onEditRulebook(picked.key)} data-testid="add-agent-edit-rulebook">Edit for this company</button> : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Sponsor</span>
              <span className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100"><PersonAvatar initials={initials(me?.name)} size={30} />You{me?.name ? ` (${me.name})` : ''}</span>
              <span className={MUTED}>{`${name} runs as you and is paid from your AI tokens, up to the monthly cap.`} <PendingOwner /></span>
              <span className="sr-only">{WHO_PAYS}</span>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Monthly cap</span>
              <input inputMode="decimal" className={`${FIELD} w-40`} value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="$" data-testid="add-agent-cap" />
              <span className={MUTED}>Must be more than $0. Runs pause when the cap is reached. You can raise it later.</span>
            </label>
            <p className="m-0 rounded-axal-md bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-ink dark:bg-violet-900/20 dark:text-gray-100">{`Everything ${name} makes is a proposal. A named person accepts it in Approvals.`}</p>
            {refusal ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{refusal}</p> : null}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
