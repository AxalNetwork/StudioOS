import React, { useCallback, useEffect, useState } from 'react';
import { Sheet, Unrecorded } from '../../ui';
import { AgentIdentity } from './AgentMark.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, BTN_TEXT_BODY, HeadRow, HonestBlock, MONO, MUTED, PendingOwner, TeamCard } from './teamUi.jsx';
import { agentName, ago, dayTime, money } from './teamModel.js';

/**
 * D1497 (#3727, TM7a, TM7b, TM7b2) — Approvals: the scope's queue of agent
 * proposals, from #3843's `GET /api/teams/:scope/:id/queue` through
 * `agentsAdapter.queue`, and one proposal in a Sheet at 520 with Discard,
 * Edit and Accept (`decide`). A second person deciding the same proposal gets
 * 409 `not_open` with who decided it, drawn as "Already decided by …".
 *
 * The proposals waiting on a page are also cards in the Ask panel (#3706).
 * Whether this tab lists open proposals too is the owner's call, so the card
 * carries "pending owner". A cost the Worker did not answer is "Not recorded".
 *
 * The four filters are Role, Module, Status and Cost (TM7a). Accept in a row
 * decides at once, as the sheet's Accept does; Edit and Discard open the
 * proposal first.
 */

const DECIDED_WORD = { accept: 'Accepted', accepted: 'Accepted', edit: 'Edited', edited: 'Edited', discard: 'Discarded', discarded: 'Discarded' };

/** "Accepted 31 Oct 09:40 by Jordan Reyes." from what is known; never a guessed name or time. */
export function decidedLine({ decision, by, at }) {
  const word = DECIDED_WORD[String(decision || '').toLowerCase()] || 'Already decided';
  const when = dayTime(at);
  return `${word}${when ? ` ${when}` : ''}${by ? ` by ${by}` : ''}.`;
}

const COSTS = [['', 'Cost: Any'], ['lt1', 'Under $0.01'], ['lt5', 'Under $0.05'], ['ge5', '$0.05 or more']];
const costMatch = (key, cost) => {
  if (!key) return true;
  if (!cost?.available || cost.value_microusd == null) return false;
  const v = Number(cost.value_microusd);
  return key === 'lt1' ? v < 10_000 : key === 'lt5' ? v < 50_000 : v >= 50_000;
};

const GRID = 'md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1.8fr)_90px_90px_minmax(0,1fr)_170px]';

export function ProposalSheet({ item, onClose, onDecided }) {
  const [decided, setDecided] = useState(item.decided_by ? { by: item.decided_by.name, at: item.decided_at, decision: item.decision } : null);
  const [refusal, setRefusal] = useState('');
  const go = async (decision) => {
    setRefusal('');
    const out = await agents.decide(item.uid, { decision });
    if (out.available) { onDecided?.(out.value); return; }
    if (out.code === 'not_open') { setDecided(out.decided ? { by: out.decided.by?.name, at: out.decided.at, decision: out.decided.decision } : { text: out.reason }); return; }
    setRefusal(out.reason);
  };
  const a = item.agent || {};
  return (
    <Sheet width={520} onClose={onClose} testId="proposal-sheet" title={item.title}
      sub={<>Proposed {ago(item.proposed_at) || <Unrecorded />} · sponsored by {item.sponsor?.name || <Unrecorded />}</>}
      footer={decided ? <div className="flex justify-end"><button type="button" className={BTN_SECONDARY} onClick={onClose}>Close</button></div> : (
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={() => go('discard')}>Discard</button>
          <button type="button" className={BTN_SECONDARY} onClick={() => go('edit')}>Edit</button>
          <button type="button" className={BTN_PRIMARY} onClick={() => go('accept')}>Accept</button>
        </div>
      )}>
      <div className="flex flex-col gap-4 px-5 py-5">
        <span className="flex flex-wrap items-center gap-2"><AgentIdentity name={agentName(a)} role={a.role_name} size={24} /><span className={MONO}>{item.module_label}</span></span>
        {decided ? (
          <p role="status" className="m-0 rounded-axal-md bg-emerald-50 px-3 py-2 text-[13px] text-axal-positive dark:bg-emerald-900/20 dark:text-emerald-300" data-testid="proposal-decided">
            ✓ {decided.text || decidedLine(decided)}
          </p>
        ) : null}
        <div className="rounded-axal-md border border-axal-hairline bg-axal-ground/60 px-3 py-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950/40 dark:text-gray-100">{item.draft || <Unrecorded />}</div>
        {Array.isArray(item.sources) && item.sources.length ? (
          <section>
            <h3 className="m-0 mb-1.5 text-[13px] font-bold text-axal-ink dark:text-gray-100">Inputs and sources</h3>
            <dl className="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
              {item.sources.map((s) => <React.Fragment key={s.label}><dt className={MUTED}>{s.label}</dt><dd className="m-0 text-axal-ink dark:text-gray-200">{s.value}{s.from ? <span className={`block ${MUTED}`}>From {s.from}{s.read_only ? ' · read only' : ''}</span> : null}</dd></React.Fragment>)}
            </dl>
          </section>
        ) : null}
        <dl className="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
          <dt className={MUTED}>Model</dt><dd className="m-0 text-axal-ink dark:text-gray-200">{item.model_label || <Unrecorded />}</dd>
          <dt className={MUTED}>Cost</dt><dd className="m-0 font-mono text-axal-ink dark:text-gray-200">{item.cost?.available ? money(item.cost.value_microusd) : <Unrecorded />}</dd>
        </dl>
        {refusal ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{refusal}</p> : null}
      </div>
    </Sheet>
  );
}

export function ApprovalsBoard({ value, onOpen, onAccept }) {
  const items = Array.isArray(value?.items) ? value.items : [];
  const decided = Array.isArray(value?.decided) ? value.decided : [];
  const [role, setRole] = useState('');
  const [mod, setMod] = useState('');
  const [status, setStatus] = useState('proposed');
  const [cost, setCost] = useState('');
  const roles = [...new Set(items.map((i) => i.agent?.role_name).filter(Boolean))];
  const mods = [...new Set(items.map((i) => i.module_label).filter(Boolean))];
  const statuses = [...new Set(items.map((i) => i.status || 'proposed'))];
  const shown = items.filter((i) => (!role || i.agent?.role_name === role) && (!mod || i.module_label === mod)
    && (!status || (i.status || 'proposed') === status) && costMatch(cost, i.cost));
  const sel = 'h-9 rounded-[9px] border border-axal-hairline bg-white px-2.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
  return (
    <div className="flex flex-col gap-4" data-testid="team-approvals">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Role" className={sel} value={role} onChange={(e) => setRole(e.target.value)}><option value="">Role: All</option>{roles.map((r) => <option key={r}>{r}</option>)}</select>
        <select aria-label="Module" className={sel} value={mod} onChange={(e) => setMod(e.target.value)}><option value="">Module: All</option>{mods.map((m) => <option key={m}>{m}</option>)}</select>
        <select aria-label="Status" className={sel} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Status: All</option>
          {[...new Set(['proposed', ...statuses])].map((st) => <option key={st} value={st}>{`Status: ${st.charAt(0).toUpperCase()}${st.slice(1).replace(/_/g, ' ')}`}</option>)}
        </select>
        <select aria-label="Cost" className={sel} value={cost} onChange={(e) => setCost(e.target.value)}>{COSTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className={`ml-auto ${MONO}`}>{shown.length ? `1–${shown.length} of ${shown.length}` : null}</span>
      </div>
      <TeamCard title="Open proposals" count={items.length} aside={<PendingOwner />} testId="team-approvals-open">
        {shown.length ? (
          <div role="table" aria-label="Open proposals">
            <HeadRow grid={GRID} cols={['Agent', 'Module', 'What it proposes', 'Cost', 'Proposed', 'Sponsor']} />
            {shown.map((i) => (
              <div key={i.uid} role="row" className={`grid grid-cols-1 ${GRID} items-center gap-3 border-b border-axal-hairline py-2.5 last:border-b-0 dark:border-gray-800`}>
                <span role="cell"><AgentIdentity name={agentName(i.agent)} role={i.agent?.role_name} size={28} /></span>
                <span role="cell" className="text-[13px] text-axal-ink dark:text-gray-200">{i.module_label}</span>
                <span role="cell" className="text-[13px] text-axal-ink dark:text-gray-200">{i.title}</span>
                <span role="cell" className="font-mono text-[12.5px] text-axal-ink dark:text-gray-200">{i.cost?.available ? money(i.cost.value_microusd) : <Unrecorded />}</span>
                <span role="cell" className={MONO}>{ago(i.proposed_at) || <Unrecorded />}</span>
                <span role="cell" className="text-[13px] text-axal-ink dark:text-gray-200">{i.sponsor?.name || <Unrecorded />}</span>
                <span role="cell" className="flex justify-end gap-1">
                  <button type="button" className={BTN_TEXT} onClick={() => (onAccept ? onAccept(i) : onOpen(i))} data-testid={`approval-accept-${i.uid}`}>Accept</button>
                  <button type="button" className={BTN_TEXT_BODY} onClick={() => onOpen(i)}>Edit</button>
                  <button type="button" className={BTN_TEXT_BODY} onClick={() => onOpen(i)}>Discard</button>
                </span>
              </div>
            ))}
          </div>
        ) : <p className={`m-0 ${MUTED}`}>Nothing is waiting for a decision.</p>}
        <p className={`m-0 mt-3 ${MUTED}`}>Open proposals are also cards in the Ask panel. Whether this tab lists them too is an owner call.</p>
      </TeamCard>
      <TeamCard title="Decided recently" testId="team-approvals-decided">
        {decided.length ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {decided.map((d) => (
              <li key={d.uid} className="grid grid-cols-1 items-center gap-2 border-b border-axal-hairline py-2 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1.6fr)] dark:border-gray-800">
                <AgentIdentity name={agentName(d.agent)} role={d.agent?.role_name} size={24} />
                <span className="text-[13px] text-axal-ink dark:text-gray-200">{d.title}</span>
                <span className={MUTED}>{d.decision_line || <>{DECIDED_WORD[String(d.decision || '').toLowerCase()] || d.decision || <Unrecorded />}{dayTime(d.decided_at) ? ` ${dayTime(d.decided_at)}` : ''} by {d.by?.name || <Unrecorded />}</>}</span>
              </li>
            ))}
          </ul>
        ) : <p className={`m-0 ${MUTED}`}>Nothing decided yet.</p>}
      </TeamCard>
    </div>
  );
}

export default function ApprovalsTab({ scope }) {
  const [block, setBlock] = useState(null);
  const [open, setOpen] = useState(null);
  const [refusal, setRefusal] = useState('');
  const kind = scope.kind === 'company' ? 'company' : 'project';
  const id = scope.kind === 'company' ? scope.company.uid : scope.project.id;
  // Keyed on values, not the scope object, so a re-render never re-reads the queue.
  const load = useCallback(() => agents.queue(kind, id, {}).then(setBlock), [kind, id]);
  const accept = async (item) => {
    setRefusal('');
    const out = await agents.decide(item.uid, { decision: 'accept' });
    if (out.available) { load(); return; }
    if (out.code === 'not_open') { setOpen({ ...item, decided_by: out.decided?.by || { name: null }, decided_at: out.decided?.at, decision: out.decided?.decision }); return; }
    setRefusal(out.reason);
  };
  useEffect(() => { load(); }, [load]);
  if (!block) return <p className={MUTED}>Reading…</p>;
  if (!block.available) return <HonestBlock testId="team-approvals-unavailable">{block.reason} Approvals arrive with them. That is not the same as nothing waiting.</HonestBlock>;
  return (
    <>
      {refusal ? <p role="alert" className="m-0 mb-2 text-[12.5px] text-axal-destructive dark:text-red-300">{refusal}</p> : null}
      <ApprovalsBoard value={block.value} onOpen={setOpen} onAccept={accept} />
      {open ? <ProposalSheet item={open} onClose={() => setOpen(null)} onDecided={() => { setOpen(null); load(); }} /> : null}
    </>
  );
}
