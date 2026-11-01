import React, { useEffect, useState } from 'react';
import { Lightbox, Pill, Sheet, Unrecorded } from '../../ui';
import { AgentPill, AgentTile } from './AgentMark.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, FIELD, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { day } from '../account/companies/companiesModel.js';
import { agentName, budgetLine, dayTime, eventWords, pauseWords } from './teamModel.js';

/**
 * D1497 (#3727, TM5a, TM5b) — an agent's profile, a Sheet at 640, from
 * `agentsAdapter.agent(uid)` (#3840's `GET /api/teams/agents/:uid`, wired).
 * Its events are drawn in words (`eventWords`), never as their kind codes.
 *
 * Name (first name and surname; it keeps the AI agent mark), the permission
 * matrix by module, this month's budget against its cap, its proposals by
 * outcome and its last 50 events. Pause, Remove and Edit cap each confirm
 * first and write through the adapter (`updateAgent`: `status`,
 * `monthly_cap_microusd`, `first_name`, `last_name`). A count the read did not
 * answer is "Not recorded"; a recorded 0 is 0.
 *
 * The visible title is the agent's name; its accessible name adds the role
 * (", CFO agent"). The name fields are read-only for anyone who cannot manage
 * the agent; for a manager they save through "Save name", never silently.
 */

const PROPOSAL_KEYS = [['proposed', 'Proposed'], ['accepted', 'Accepted'], ['edited', 'Edited'], ['discarded', 'Discarded'], ['withdrawn', 'Withdrawn']];

export function Confirm({ title, body, button, danger, onCancel, onConfirm, refusal, testId }) {
  return (
    <Lightbox label={title} title={title} onClose={onCancel} width={480} testId={testId}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onCancel}>Cancel</button>
          <button type="button" className={danger ? 'inline-flex h-10 items-center rounded-[9px] bg-axal-destructive px-4 text-[13.5px] font-semibold text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500' : BTN_PRIMARY} onClick={onConfirm} data-testid={testId ? `${testId}-yes` : undefined}>{button}</button>
        </div>
      )}>
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{body}</p>
      {refusal ? <p role="alert" className="m-0 mt-2 text-[12.5px] text-axal-destructive dark:text-red-300">{refusal}</p> : null}
    </Lightbox>
  );
}

/** The profile body, from one `GET /api/teams/agents/:uid` answer. */
export function AgentProfile({ data, canManage, onAsk, onSaveName }) {
  const a = data.agent || {};
  const used = data.month_spend?.available ? data.month_spend.value_microusd : null;
  const cap = a.monthly_cap_microusd ?? data.cap_microusd ?? null;
  const pct = used != null && cap ? Math.min(100, (used / cap) * 100) : null;
  const counts = data.proposals && typeof data.proposals === 'object' ? data.proposals : null;
  const [first, setFirst] = useState(a.first_name || '');
  const [last, setLast] = useState(a.last_name || '');
  const [nameNote, setNameNote] = useState('');
  const editable = !!(canManage && onSaveName);
  const changed = first.trim() !== (a.first_name || '') || last.trim() !== (a.last_name || '');
  const saveName = async () => {
    setNameNote('');
    const out = await onSaveName({ first_name: first.trim() || null, last_name: last.trim() || null });
    setNameNote(out?.available ? 'Saved.' : (out?.reason || 'It could not be saved. Try again.'));
  };
  const resets = day(data.resets_at, { year: false });
  return (
    <div className="flex flex-col gap-5 px-5 py-5" data-testid="agent-profile">
      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">Name</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1"><span className={MUTED}>First name</span><input className={FIELD} value={first} onChange={(e) => setFirst(e.target.value)} readOnly={!editable} maxLength={40} data-testid="agent-first" /></label>
          <label className="flex flex-col gap-1"><span className={MUTED}>Surname</span><input className={FIELD} value={last} onChange={(e) => setLast(e.target.value)} readOnly={!editable} maxLength={40} data-testid="agent-last" /></label>
        </div>
        <span className={MUTED}>Shown on the team and in every proposal. It keeps the AI agent mark.</span>
        {editable ? (
          <span className="flex items-center gap-2">
            <button type="button" className={BTN_SECONDARY} disabled={!changed} onClick={saveName} data-testid="agent-save-name">Save name</button>
            {nameNote ? <span role="status" className={MUTED}>{nameNote}</span> : null}
          </span>
        ) : null}
      </section>
      <section>
        <h3 className="m-0 mb-1.5 text-[13px] font-bold text-axal-ink dark:text-gray-100">Permissions</h3>
        <div role="table" aria-label="Permissions" className="rounded-axal-md border border-axal-hairline dark:border-gray-700">
          <div role="row" className="grid grid-cols-[minmax(0,1fr)_70px_110px_60px] gap-2 border-b border-axal-hairline px-3 py-2 dark:border-gray-800">
            {['Module', 'Read', 'Propose', 'Auto'].map((c) => <span key={c} role="columnheader" className="font-mono text-[11px] uppercase tracking-[.11em] text-axal-muted dark:text-gray-400">{c}</span>)}
          </div>
          {(data.matrix || []).map((m) => (
            <div key={m.module} role="row" className="grid grid-cols-[minmax(0,1fr)_70px_110px_60px] gap-2 border-b border-axal-hairline px-3 py-2 text-[13px] text-axal-ink last:border-b-0 dark:border-gray-800 dark:text-gray-200">
              <span role="cell">{m.label || m.module}</span>
              <span role="cell" aria-label={m.read ? 'Yes' : 'No'}>{m.read ? '✓' : '—'}</span>
              <span role="cell">{m.propose === 'proposals_only' ? 'Proposals only' : m.propose ? '✓' : '—'}</span>
              <span role="cell" aria-label="No">—</span>
            </div>
          ))}
        </div>
        <p className={`m-0 mt-1 ${MUTED}`}>Auto is off for every module in v1.</p>
      </section>
      <section>
        <h3 className="m-0 mb-1.5 text-[13px] font-bold text-axal-ink dark:text-gray-100">Budget</h3>
        {used == null ? <Unrecorded /> : (
          <>
            <p className="m-0 font-mono text-[13px] text-axal-ink dark:text-gray-100">{budgetLine(used, cap)}{cap == null ? <> · cap <Unrecorded /></> : null}</p>
            {pct != null ? (
              <div role="img" aria-label={budgetLine(used, cap, ' used')} className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800">
                <div className="h-full bg-axal-violet" style={{ width: `${pct}%` }} />
              </div>
            ) : null}
          </>
        )}
        {resets ? <p className={`m-0 mt-1 ${MONO}`}>Resets {resets}</p> : null}
      </section>
      <section>
        <h3 className="m-0 mb-1.5 text-[13px] font-bold text-axal-ink dark:text-gray-100">Proposals</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {PROPOSAL_KEYS.map(([k, label]) => (
            <div key={k} className="rounded-axal-md border border-axal-hairline px-3 py-2 dark:border-gray-700" data-testid={`agent-proposals-${k}`}>
              <span className={`block ${MUTED}`}>{label}</span>
              <b className="font-mono text-[17px] text-axal-ink dark:text-gray-100">{counts && Number.isFinite(Number(counts[k])) && counts[k] !== null ? Number(counts[k]) : <Unrecorded />}</b>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="m-0 mb-1.5 text-[13px] font-bold text-axal-ink dark:text-gray-100">Activity <span className={MONO}>· last 50</span></h3>
        {Array.isArray(data.events) && data.events.length ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {data.events.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex justify-between gap-3 border-b border-axal-hairline py-1.5 text-[13px] text-axal-ink last:border-b-0 dark:border-gray-800 dark:text-gray-200">
                <span>{eventWords(e)}</span><span className={MONO}>{dayTime(e.at) || <Unrecorded />}</span>
              </li>
            ))}
          </ul>
        ) : <Unrecorded>Nothing recorded yet</Unrecorded>}
      </section>
      {onAsk || null}
    </div>
  );
}

/** Edit cap: a new monthly cap above $0, through `updateAgent(uid, { monthly_cap_microusd })`. */
function CapEditor({ name, role, current, refusal, onCancel, onSave }) {
  const [value, setValue] = useState(current != null ? String(Number(current) / 1e6) : '');
  const ok = Number(value) > 0;
  return (
    <Lightbox label={`Edit the cap of ${name}`} title={`Edit the cap of ${name}, the ${role} agent`} onClose={onCancel} width={480} testId="agent-cap-editor"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onCancel}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} disabled={!ok} onClick={() => onSave(Math.round(Number(value) * 1e6))} data-testid="agent-cap-save">Save cap</button>
        </div>
      )}>
      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Monthly cap</span>
        <input inputMode="decimal" className={`${FIELD} w-40`} value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="$" data-testid="agent-cap-input" />
        <span className={MUTED}>Must be more than $0. The agent pauses when it reaches the cap.</span>
      </label>
      {refusal ? <p role="alert" className="m-0 mt-2 text-[12.5px] text-axal-destructive dark:text-red-300">{refusal}</p> : null}
    </Lightbox>
  );
}

export default function AgentProfileSheet({ uid, canManage, editCap = false, onClose, onChanged }) {
  const [block, setBlock] = useState(null);
  const [confirm, setConfirm] = useState(editCap ? 'cap' : null);
  const [refusal, setRefusal] = useState('');
  useEffect(() => { let alive = true; agents.agent(uid).then((b) => { if (alive) setBlock(b); }); return () => { alive = false; }; }, [uid]);
  const a = block?.available ? block.value.agent : null;
  const name = a ? agentName(a) : 'AI agent';
  const act = async (kind, patch) => {
    setRefusal('');
    const out = kind === 'remove' ? await agents.removeAgent(uid)
      : await agents.updateAgent(uid, patch || { status: a?.status === 'paused' ? 'active' : 'paused' });
    if (!out.available) { setRefusal(out.reason); return; }
    setConfirm(null); onChanged?.();
  };
  const saveName = async (patch) => {
    const out = await agents.updateAgent(uid, patch);
    if (out.available) setBlock((b) => (b?.available ? { ...b, value: { ...b.value, agent: { ...b.value.agent, ...patch } } } : b));
    return out;
  };
  const manage = !!(a && (canManage || block?.value?.can_manage));
  const pause = a ? pauseWords(a) : null;
  const role = a?.role_name || null;
  return (
    <>
      <Sheet width={640} onClose={onClose} testId="agent-profile-sheet"
        title={a ? <>{name}<span className="sr-only">{`, ${role || 'AI'} agent`}</span></> : 'AI agent'}
        sub={a ? <>{role || <Unrecorded />} · Platform model · {a.model_label || a.model_id || <Unrecorded />} · sponsored by {a.sponsor?.name || <Unrecorded />}</> : undefined}
        headerActions={a ? <span className="flex items-center gap-1.5"><AgentTile size={28} /><AgentPill />{pause ? <span className="rounded-axal-pill bg-axal-amber px-2 py-0.5 text-[11px] font-semibold text-axal-amber-deep">Paused</span> : <Pill tone="ok">Active</Pill>}</span> : null}
        footer={manage ? (
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => setConfirm('pause')} data-testid="agent-pause">{a.status === 'paused' ? 'Resume' : 'Pause'}</button>
            <button type="button" className={BTN_DANGER} onClick={() => setConfirm('remove')} data-testid="agent-remove">Remove</button>
            <button type="button" className={BTN_PRIMARY} onClick={() => { setRefusal(''); setConfirm('cap'); }} data-testid="agent-edit-cap">Edit cap</button>
          </div>
        ) : null}>
        {!block ? <p className={`m-0 px-5 py-5 ${MUTED}`}>Reading…</p>
          : !block.available ? <div className="px-5 py-5"><HonestBlock>{block.unreadable ? 'This agent could not be read.' : block.reason}{block.refused ? '' : ' That is not the same as having none.'}</HonestBlock></div>
            : <AgentProfile data={block.value} canManage={manage} onSaveName={saveName} />}
      </Sheet>
      {confirm === 'pause' ? (
        <Confirm testId="agent-pause-confirm" title={a?.status === 'paused' ? `Resume ${name}, the ${a?.role_name} agent?` : `Pause ${name}, the ${a?.role_name} agent?`}
          body={a?.status === 'paused' ? 'It can run again in its modules, up to its monthly cap.' : 'It stops running until you resume it. Open proposals stay in Approvals for people to decide.'}
          button={a?.status === 'paused' ? 'Resume' : 'Pause'} refusal={refusal} onCancel={() => setConfirm(null)} onConfirm={() => act('pause')} />
      ) : null}
      {confirm === 'cap' && a && manage ? (
        <CapEditor name={name} role={role || 'AI'} current={a.monthly_cap_microusd} refusal={refusal}
          onCancel={() => setConfirm(null)} onSave={(micro) => act('cap', { monthly_cap_microusd: micro })} />
      ) : null}
      {confirm === 'remove' ? (
        <Confirm testId="agent-remove-confirm" danger title={`Remove ${name}, the ${a?.role_name} agent?`} body="Its open proposals are withdrawn. Its history is kept."
          button="Remove" refusal={refusal} onCancel={() => setConfirm(null)} onConfirm={() => act('remove')} />
      ) : null}
    </>
  );
}
