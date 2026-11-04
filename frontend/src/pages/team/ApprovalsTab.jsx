import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet, Unrecorded } from '../../ui';
import { AgentIdentity } from './AgentMark.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, BTN_TEXT_BODY, FIELD, HeadRow, HonestBlock, MONO, MUTED, PendingOwner, TeamCard } from './teamUi.jsx';
import { agentName, ago, dayTime, money, agentLine, queueProposal, QUEUE_HISTORY_STATUSES } from './teamModel.js';

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

const DECIDED_WORD = { accept: 'Accepted', accepted: 'Accepted', edit: 'Edited', edited: 'Edited', discard: 'Discarded', discarded: 'Discarded', withdrawn: 'Withdrawn' };

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
  const [decided, setDecided] = useState(item.status && item.status !== 'proposed'
    ? { by: item.decided_by?.name, at: item.decided_at, decision: item.status } : null);
  const [refusal, setRefusal] = useState('');
  const [editing, setEditing] = useState(item.editing === true && item.can_decide === true && Boolean(item.edit_key));
  const [draft, setDraft] = useState(item.draft || '');
  const [busy, setBusy] = useState(false);
  const pressing = useRef(false);
  const canDecide = item.can_decide === true;
  const go = async (decision) => {
    if (pressing.current || !canDecide || decided) return;
    if (decision === 'edit' && (!item.edit_key || !draft.trim() || draft === item.draft)) return;
    pressing.current = true;
    setBusy(true);
    setRefusal('');
    try {
      const body = decision === 'edit' ? { decision, payload: { ...item.payload, [item.edit_key]: draft } } : { decision };
      const out = await agents.decide(item.uid, body);
      if (out.available) { onDecided?.(out.value); return; }
      if (out.code === 'not_open') { setDecided(out.decided ? { by: out.decided.by?.name, at: out.decided.at, decision: out.decided.decision } : { text: out.reason }); return; }
      setRefusal(out.reason);
    } finally { pressing.current = false; setBusy(false); }
  };
  const a = item.agent || {};
  return (
    <Sheet width={520} onClose={() => { if (!pressing.current) onClose(); }} testId="proposal-sheet" title={item.title}
      sub={<>Proposed {ago(item.proposed_at) || <Unrecorded />} · sponsored by {item.sponsor?.name || <Unrecorded />}</>}
      footer={decided || !canDecide ? <div className="flex justify-end"><button type="button" className={BTN_SECONDARY} onClick={onClose}>Close</button></div> : (
        <div className="flex justify-end gap-2">
          {editing ? <>
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => { setEditing(false); setDraft(item.draft || ''); }}>Cancel edit</button>
            <button type="button" className={BTN_PRIMARY} disabled={busy || !draft.trim() || draft === item.draft} onClick={() => go('edit')}>Save edited proposal</button>
          </> : <>
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => go('discard')}>Discard</button>
            <button type="button" className={BTN_SECONDARY} disabled={busy || !item.edit_key} title={!item.edit_key ? 'Open this proposal in its module to edit its values.' : undefined} onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => go('accept')}>Accept</button>
          </>}
        </div>
      )}>
      <div className="flex flex-col gap-4 px-5 py-5">
        <span className="flex flex-wrap items-center gap-2"><AgentIdentity name={agentName(a)} role={agentLine(a)} size={24} /><span className={MONO}>{item.module_label}</span></span>
        {decided ? (
          <p role="status" className="m-0 rounded-axal-md bg-emerald-50 px-3 py-2 text-[13px] text-axal-positive dark:bg-emerald-900/20 dark:text-emerald-300" data-testid="proposal-decided">
            ✓ {decided.text || decidedLine(decided)}
          </p>
        ) : null}
        <div className="rounded-axal-md border border-axal-hairline bg-axal-ground/60 px-3 py-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950/40 dark:text-gray-100">{editing ? <textarea aria-label="Edit proposal" className={`${FIELD} min-h-[160px] whitespace-pre-wrap`} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} /> : item.draft || <Unrecorded />}</div>
        {Array.isArray(item.sources) && item.sources.length ? (
          <section>
            <h3 className="m-0 mb-1.5 text-[13px] font-bold text-axal-ink dark:text-gray-100">Inputs and sources</h3>
            <dl className="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
              {item.sources.map((s, i) => <React.Fragment key={i}><dt className={MUTED}>{s.label}</dt><dd className="m-0 text-axal-ink dark:text-gray-200">{s.value}{s.from ? <span className={`block ${MUTED}`}>From {s.from}{s.read_only ? ' · read only' : ''}</span> : null}</dd></React.Fragment>)}
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

export function ApprovalsBoard({ value, onOpen, onAccept, busy = false, onMore, onMoreHistory, onRetry }) {
  const items = Array.isArray(value?.items) ? value.items : [];
  const decided = Array.isArray(value?.decided) ? value.decided : [];
  const [role, setRole] = useState('');
  const [mod, setMod] = useState('');
  const [status, setStatus] = useState('');
  const [cost, setCost] = useState('');
  // D4119: filter by agent (its persona's name), never by a job title.
  const all = [...items, ...decided];
  const roles = [...new Set(all.map((i) => (i.agent ? agentName(i.agent) : null)).filter(Boolean))];
  const mods = [...new Set(all.map((i) => i.module_label).filter(Boolean))];
  const statuses = ['proposed', ...QUEUE_HISTORY_STATUSES];
  const matches = (i) => (!role || (i.agent ? agentName(i.agent) : null) === role) && (!mod || i.module_label === mod)
    && (!status || (i.status || 'proposed') === status) && costMatch(cost, i.cost);
  const shown = items.filter(matches);
  const past = decided.filter(matches);
  const sel = 'h-9 rounded-[9px] border border-axal-hairline bg-white px-2.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
  return (
    <div className="flex flex-col gap-4" data-testid="team-approvals">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Agent" className={sel} value={role} onChange={(e) => setRole(e.target.value)}><option value="">Agent: All</option>{roles.map((r) => <option key={r}>{r}</option>)}</select>
        <select aria-label="Module" className={sel} value={mod} onChange={(e) => setMod(e.target.value)}><option value="">Module: All</option>{mods.map((m) => <option key={m}>{m}</option>)}</select>
        <select aria-label="Status" className={sel} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Status: All</option>
          {[...new Set(['proposed', ...statuses])].map((st) => <option key={st} value={st}>{`Status: ${st.charAt(0).toUpperCase()}${st.slice(1).replace(/_/g, ' ')}`}</option>)}
        </select>
        <select aria-label="Cost" className={sel} value={cost} onChange={(e) => setCost(e.target.value)}>{COSTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className={`ml-auto ${MONO}`}>{shown.length ? `${shown.length} shown` : null}</span>
      </div>
      <TeamCard title="Open proposals" count={value?.counts?.proposed?.available ? value.counts.proposed.value : undefined} aside={<PendingOwner />} testId="team-approvals-open">
        {shown.length ? (
          <div role="table" aria-label="Open proposals">
            <HeadRow grid={GRID} cols={['Agent', 'Module', 'What it proposes', 'Cost', 'Proposed', 'Sponsor']} />
            {shown.map((i) => (
              <div key={i.uid} role="row" className={`grid grid-cols-1 ${GRID} items-center gap-3 border-b border-axal-hairline py-2.5 last:border-b-0 dark:border-gray-800`}>
                <span role="cell"><AgentIdentity name={agentName(i.agent)} role={agentLine(i.agent)} size={28} /></span>
                <span role="cell" className="text-[13px] text-axal-ink dark:text-gray-200">{i.module_label}</span>
                <span role="cell" className="text-[13px] text-axal-ink dark:text-gray-200">{i.title}</span>
                <span role="cell" className="font-mono text-[12.5px] text-axal-ink dark:text-gray-200">{i.cost?.available ? money(i.cost.value_microusd) : <Unrecorded />}</span>
                <span role="cell" className={MONO}>{ago(i.proposed_at) || <Unrecorded />}</span>
                <span role="cell" className="text-[13px] text-axal-ink dark:text-gray-200">{i.sponsor?.name || <Unrecorded />}</span>
                <span role="cell" className="flex justify-end gap-1">
                  {i.can_decide ? <>
                    <button type="button" className={BTN_TEXT} disabled={busy} onClick={() => (onAccept ? onAccept(i) : onOpen(i))} data-testid={`approval-accept-${i.uid}`}>Accept</button>
                    <button type="button" className={BTN_TEXT_BODY} disabled={busy} onClick={() => onOpen(i, 'edit')}>Edit</button>
                    <button type="button" className={BTN_TEXT_BODY} disabled={busy} onClick={() => onOpen(i)}>Discard</button>
                  </> : <button type="button" className={BTN_TEXT} onClick={() => onOpen(i)}>View</button>}
                </span>
              </div>
            ))}
          </div>
        ) : <p className={`m-0 ${MUTED}`}>Nothing is waiting for a decision.</p>}
        {onMore ? <button type="button" className={BTN_TEXT} disabled={busy} onClick={onMore}>More open proposals</button> : null}
        <p className={`m-0 mt-3 ${MUTED}`}>Open proposals are also cards in the Ask panel. Whether this tab lists them too is an owner call.</p>
      </TeamCard>
      <TeamCard title="Decided recently" testId="team-approvals-decided">
        {value?.history_unreadable ? <HonestBlock>Decided proposals could not be read. That is not the same as having none. {onRetry ? <button type="button" className={BTN_TEXT} onClick={onRetry}>Try again</button> : null}</HonestBlock> : null}
        {past.length ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {past.map((d) => (
              <li key={d.uid} className="grid grid-cols-1 items-center gap-2 border-b border-axal-hairline py-2 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1.6fr)] dark:border-gray-800">
                <AgentIdentity name={agentName(d.agent)} role={agentLine(d.agent)} size={24} />
                <button type="button" className={`${BTN_TEXT_BODY} text-left`} onClick={() => onOpen(d)}>{d.title}</button>
                <span className={MUTED}>{d.decision_line || <>{DECIDED_WORD[String(d.decision || '').toLowerCase()] || d.decision || <Unrecorded />}{dayTime(d.decided_at) ? ` ${dayTime(d.decided_at)}` : ''} by {d.by?.name || <Unrecorded />}</>}</span>
              </li>
            ))}
          </ul>
        ) : !value?.history_unreadable ? <p className={`m-0 ${MUTED}`}>{decided.length ? 'No loaded decisions match these filters.' : 'Nothing decided yet.'}</p> : null}
        {onMoreHistory ? <button type="button" className={BTN_TEXT} disabled={busy} onClick={onMoreHistory}>More decisions</button> : null}
      </TeamCard>
    </div>
  );
}

export default function ApprovalsTab({ scope, canManage = false, viewerUid = null, roles = [], onChanged }) {
  const [block, setBlock] = useState(null);
  const [open, setOpen] = useState(null);
  const [refusal, setRefusal] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const deciding = useRef(false);
  const detailRequest = useRef(0);
  const epoch = useRef(0);
  const kind = scope.kind === 'company' ? 'company' : 'project';
  const id = kind === 'company' ? scope.company.uid : scope.project.id;
  const key = `${kind}:${id}`;
  const current = useRef(key);
  current.current = key;
  const statuses = ['proposed', ...QUEUE_HISTORY_STATUSES];
  const close = () => { detailRequest.current += 1; setOpen(null); };
  const load = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    epoch.current += 1;
    setBlock(null); setOpen(null); setRefusal(''); detailRequest.current += 1;
    Promise.all(['proposed', ...QUEUE_HISTORY_STATUSES].map((status) => agents.queue(kind, id, { status }))).then((pages) => {
      if (!alive) return;
      if (!pages[0].available) { setBlock({ ...pages[0], scopeKey: key }); return; }
      setBlock({ available: true, pages, scopeKey: key });
    });
    return () => { alive = false; detailRequest.current += 1; epoch.current += 1; };
  }, [kind, id, revision]);
  const mapped = (item) => queueProposal(item, { roles, canManage, viewerUid });
  const changed = () => { if (current.current !== key) return; close(); load(); onChanged?.(); };
  const openItem = async (item, intent) => {
    const request = ++detailRequest.current;
    setOpen({ loading: true, uid: item.uid });
    const out = await agents.queueItem(item.uid);
    if (request !== detailRequest.current || current.current !== key) return;
    setOpen(out.available ? { item: mapped(out.value.item), inputs: out.value.inputs, intent } : { error: out.reason, uid: item.uid, retry: item, intent });
  };
  const accept = async (item) => {
    if (deciding.current || !item.can_decide) return;
    deciding.current = true; setBusy(true); setRefusal('');
    try {
      const out = await agents.decide(item.uid, { decision: 'accept' });
      if (current.current !== key) return;
      if (out.available) { changed(); return; }
      if (out.code === 'not_open') { openItem(item); return; }
      setRefusal(out.reason);
    } finally { deciding.current = false; setBusy(false); }
  };
  const more = async (history) => {
    if (deciding.current || !block?.available) return;
    deciding.current = true; setBusy(true); setRefusal('');
    const generation = epoch.current;
    try {
      const next = await Promise.all(block.pages.map((page, index) => (index > 0) === history && page.available && page.value?.next_cursor
        ? agents.queue(kind, id, { status: statuses[index], cursor: page.value.next_cursor }) : Promise.resolve(null)));
      if (current.current !== key || epoch.current !== generation) return;
      if (next.some((page) => page && !page.available)) { setRefusal('More proposals could not be read. Try again.'); return; }
      setBlock((old) => ({ ...old, pages: old.pages.map((page, index) => next[index] ? { ...next[index], value: { ...next[index].value, items: [...page.value.items, ...next[index].value.items] } } : page) }));
    } finally { deciding.current = false; setBusy(false); }
  };
  if (!block || block.scopeKey !== key) return <p className={MUTED}>Reading…</p>;
  if (!block.available) return <HonestBlock testId="team-approvals-unavailable">{block.reason}. That is not the same as nothing waiting. <button type="button" className={BTN_TEXT} onClick={load}>Try again</button></HonestBlock>;
  const pages = block.pages;
  const value = {
    items: (pages[0].value?.items || []).map(mapped), counts: pages[0].value?.counts,
    decided: pages.slice(1).flatMap((p) => p.available ? p.value?.items || [] : []).map(mapped).sort((a, b) => String(b.decided_at || b.created_at).localeCompare(String(a.decided_at || a.created_at))),
    history_unreadable: pages.slice(1).some((p) => !p.available),
  };
  return <>
    {refusal ? <p role="alert" className="m-0 mb-2 text-[12.5px] text-axal-destructive dark:text-red-300">{refusal}</p> : null}
    <ApprovalsBoard value={value} onOpen={openItem} onAccept={accept} busy={busy}
      onMore={pages[0].value?.next_cursor ? () => more(false) : null}
      onRetry={load} onMoreHistory={pages.slice(1).some((p) => p.available && p.value?.next_cursor) ? () => more(true) : null} />
    {open?.item ? <ProposalSheet key={open.item.uid} item={{ ...open.item, editing: open.intent === 'edit', sources: (open.inputs || []).map((i) => ({ label: 'Input', value: i.summary, read_only: i.read_only })) }} onClose={close} onDecided={changed} /> : null}
    {open && !open.item ? <Sheet width={520} onClose={close} testId="proposal-reading" title="Proposal"><div className="p-5"><p className={MUTED}>{open.loading ? 'Reading…' : 'This proposal could not be read.'}</p>{open.error ? <button type="button" className={BTN_TEXT} onClick={() => openItem(open.retry, open.intent)}>Try again</button> : null}</div></Sheet> : null}
  </>;
}
