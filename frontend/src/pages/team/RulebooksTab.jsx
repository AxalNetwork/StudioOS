import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Pill, Sheet, Unrecorded } from '../../ui';
import { AgentIdentity, AgentTile } from './AgentMark.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, FIELD, HonestBlock, MONO, MUTED, PendingOwner } from './teamUi.jsx';
import { day } from '../account/companies/companiesModel.js';
import { AUTO_NOTE, FLOOR, FLOOR_EDIT_NOTE, FLOOR_NOTE, FLOOR_TIP, RULEBOOK_SECTIONS, agentName, refusalWords } from './teamModel.js';

/**
 * D1497 (#3727, TM4a, TM4b, TM4b2, TM4c) — Roles and rule books.
 *
 * The role catalogue and every rule book come from #3840's routes through
 * `agentsAdapter` (`roles`, `rulebook`, `saveRulebook`), wired. While the
 * routes are switched off the tab draws the honest block; the catalogue is
 * never invented here. Version 0 is the catalogue's default (no scope edit
 * yet) and reads "Default". A save is re-read for its history and diff; a
 * `rule_floor` refusal outlines the floor item the edit dropped. What IS drawn without a read is the floor, because it is Axal VC's
 * rule and not data: the seven things an agent never does without a named
 * person, and that nothing is automatic in v1.
 *
 * A role card shows the agent tile alone (a role is not an agent); the agent
 * that holds it is named with its tile and the "AI agent" pill.
 *
 * `?tab=roles&role=<key>` opens that role's rule book (Settings' "Open rule
 * book"). The General counsel (assistant) book carries TM4b2's banner, "Not
 * legal advice. Always escalates.", whose wording is pending from counsel.
 */

/** TM4b2: the General counsel (assistant) role, by key or name. */
export const isCounsel = (role) => /counsel/i.test(`${role?.key || ''} ${role?.name || ''}`);

export function FloorList({ highlight, note = FLOOR_NOTE }) {
  return (
    <div data-testid="rulebook-floor">
      <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-2">
        {FLOOR.map(([key, label]) => (
          <li key={key} title={FLOOR_TIP}
            className={`flex items-center gap-2 rounded-axal-md border px-3 py-2 text-[13px] ${highlight === key ? 'border-2 border-axal-destructive text-axal-destructive line-through dark:border-red-400 dark:text-red-300' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100'}`}>
            <Lock size={12} aria-hidden="true" />{label}
          </li>
        ))}
      </ul>
      <p className={`m-0 mt-1.5 ${MUTED}`}>{note}</p>
    </div>
  );
}

export function AutoLock() {
  return (
    <div className="flex items-center gap-2 rounded-axal-md border border-dashed border-axal-hairline px-3 py-2 dark:border-gray-700">
      <Lock size={12} aria-hidden="true" className="text-axal-muted dark:text-gray-400" />
      <span className="text-[13px] text-axal-ink dark:text-gray-100">{AUTO_NOTE}</span>
      <PendingOwner />
    </div>
  );
}

/** TM4a: the library of roles, each with its rule book state and holder. */
export function RoleLibrary({ roles, agentsList, onOpen }) {
  const holder = (key) => (agentsList || []).find((a) => a.role_key === key && a.status !== 'removed');
  return (
    <div className="flex flex-col gap-3" data-testid="team-role-library">
      <p className={`m-0 ${MUTED}`}>Each role has a rule book. It says where an agent works, what it may propose, and what always needs a person.</p>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((r) => {
          const held = holder(r.key);
          return (
            <article key={r.key} className="flex flex-col gap-2 rounded-axal-lg border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid={`role-${r.key}`}>
              <span className="flex items-center gap-2"><AgentTile size={30} /><b className="text-[14px] text-axal-ink dark:text-gray-100">{r.name}</b></span>
              <p className={`m-0 ${MUTED}`}>{r.mission}</p>
              {r.version > 1 ? <Pill tone="info">Edited for this company · v{r.version}</Pill> : r.version === 1 || r.version === 0 ? <Pill>Default</Pill> : null}
              <span className="mt-auto flex items-center justify-between gap-2 border-t border-axal-hairline pt-2 dark:border-gray-800">
                {held ? <span className="flex items-center gap-1.5 text-[12.5px] text-axal-ink dark:text-gray-200">Held by <AgentIdentity name={agentName(held)} size={20} /></span>
                  : <span className={MUTED}>No agent holds it</span>}
                <button type="button" className={BTN_TEXT} onClick={() => onOpen(r)} data-testid={`role-open-${r.key}`}>Open rule book</button>
              </span>
            </article>
          );
        })}
        <article aria-disabled="true" className="flex flex-col gap-2 rounded-axal-lg border border-dashed border-axal-hairline p-4 opacity-70 dark:border-gray-700">
          <b className="text-[14px] text-axal-ink dark:text-gray-100">Custom roles</b>
          <p className={`m-0 ${MUTED}`}>Write a role of your own.</p>
          <Pill>Coming later</Pill>
        </article>
      </div>
    </div>
  );
}

const lines = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => (typeof x === 'string' ? x : x?.label || x?.text || x?.key)).filter(Boolean);

/** TM4b: one rule book, with its history and, on request, the changes from the default. */
export function RulebookView({ book, role, onBack, onEdit, onRestore, canManage, refusal }) {
  const [diff, setDiff] = useState(true);
  const rules = book.effective || {};
  const changes = new Map((book.diff || []).map((d) => [d.section, d]));
  const versions = Array.isArray(book.versions) ? book.versions : [];
  const extra = lines(rules.always_asks_human).filter((k) => !FLOOR.some(([f]) => f === k));
  const Section = ({ id, label, children }) => (
    <section className="grid grid-cols-1 gap-2 border-b border-axal-hairline py-3 last:border-b-0 md:grid-cols-[150px_minmax(0,1fr)] dark:border-gray-800" data-testid={`rulebook-${id}`}>
      <h3 className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{label}</h3>
      <div className="min-w-0">{children}</div>
    </section>
  );
  const List = ({ id }) => {
    const now = lines(rules[id]);
    const d = diff ? changes.get(id) : null;
    const added = new Set(lines(d?.added));
    const removed = lines(d?.removed);
    if (!now.length && !removed.length) return <Unrecorded />;
    return (
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {now.map((x) => <li key={x} className={`flex gap-2 text-[13px] ${added.has(x) ? 'rounded bg-emerald-50 px-1.5 text-axal-positive dark:bg-emerald-900/20 dark:text-emerald-300' : 'text-axal-ink dark:text-gray-200'}`}><span aria-hidden="true">{added.has(x) ? '+' : '·'}</span>{x}</li>)}
        {removed.map((x) => <li key={`-${x}`} className="flex gap-2 text-[13px] text-axal-muted line-through dark:text-gray-500"><span aria-hidden="true">−</span>{x}</li>)}
      </ul>
    );
  };
  return (
    <div className="flex flex-col gap-3" data-testid="team-rulebook">
      <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={onBack}>‹ Roles and rule books</button>
      <header className="flex flex-wrap items-start gap-3">
        <AgentTile size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[18px] font-extrabold text-axal-ink dark:text-gray-100">{role?.name || book.role_key} · Rule book · {book.version === 0 ? 'Default' : `v${book.version ?? 1}`}</h2>
          {versions.length ? (
            <p className={`m-0 ${MONO}`} data-testid="rulebook-history">
              {versions.map((v, i) => (
                <React.Fragment key={`${v.version}-${i}`}>
                  {i ? ' · ' : ''}v{v.version} by {v.by?.name || <Unrecorded />} · {day(v.at, { year: false }) || <Unrecorded />}
                </React.Fragment>
              ))}
            </p>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-axal-ink dark:text-gray-200">
          <input type="checkbox" role="switch" checked={diff} onChange={(e) => setDiff(e.target.checked)} />Show changes from the default
        </label>
        {canManage ? <button type="button" className={BTN_SECONDARY} onClick={onRestore}>Restore default</button> : null}
        {canManage ? <button type="button" className={BTN_PRIMARY} onClick={onEdit} data-testid="rulebook-edit">Edit rule book</button> : null}
      </header>
      {isCounsel(role) || isCounsel({ key: book.role_key }) ? (
        <p role="note" className="m-0 flex flex-wrap items-center gap-2 rounded-axal-md bg-axal-lavender px-3 py-2.5 text-[13px] text-axal-ink dark:bg-violet-900/20 dark:text-gray-100" data-testid="rulebook-counsel">
          <b>Not legal advice. Always escalates.</b><PendingOwner label="pending owner: wording from counsel" />
        </p>
      ) : null}
      {refusal ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{refusal}</p> : null}
      <div className="rounded-axal-lg border border-axal-hairline bg-white px-[18px] py-1 dark:border-gray-700 dark:bg-gray-900">
        {RULEBOOK_SECTIONS.map(([id, label]) => (
          <Section key={id} id={id} label={label}>
            {id === 'mission' || id === 'tone' ? (rules[id] ? <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200">{rules[id]}</p> : <Unrecorded />)
              : id === 'may_do_automatically' ? <AutoLock />
                : id === 'always_asks_human' ? (<><FloorList />{extra.length ? <ul className="m-0 mt-2 list-none p-0">{extra.map((x) => <li key={x} className="text-[13px] text-axal-ink dark:text-gray-200">+ {x}</li>)}</ul> : null}</>)
                  : <List id={id} />}
          </Section>
        ))}
      </div>
    </div>
  );
}

/** TM4c: Edit rule book. The floor stays locked; a refusal says which item and disables Save. */
export function EditRulebookSheet({ book, role, onClose, onSave }) {
  const r = book.effective || {};
  const [draft, setDraft] = useState({
    may_propose: lines(r.may_propose).join('\n'), escalates_when: lines(r.escalates_when).join('\n'),
    kpis: lines(r.kpis).join('\n'), tone: r.tone || '',
  });
  const [refusal, setRefusal] = useState(null);
  const [busy, setBusy] = useState(false);
  const split = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    setBusy(true); setRefusal(null);
    const out = await onSave({ ...r, may_propose: split(draft.may_propose), escalates_when: split(draft.escalates_when), kpis: split(draft.kpis), tone: draft.tone.trim() || null });
    setBusy(false);
    if (out && out.available === false) setRefusal(out);
  };
  const set = (k) => (e) => { setDraft({ ...draft, [k]: e.target.value }); setRefusal(null); };
  return (
    <Sheet title="Edit rule book" sub={`${role?.name || book.role_key} · draft of v${(book.version ?? 1) + 1}`} width={520} onClose={onClose} testId="rulebook-edit-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} onClick={save} disabled={busy || !!refusal?.highlight} title={refusal?.highlight ? 'Fix the highlighted item to save' : undefined} data-testid="rulebook-save">Save</button>
        </div>
      )}>
      <div className="flex flex-col gap-4 px-5 py-5">
        {refusal ? <p role="alert" className="m-0 flex gap-2 rounded-axal-md border border-axal-destructive-edge bg-axal-destructive-tint px-3 py-2.5 text-[12.5px] text-axal-destructive dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"><span className="font-mono">!</span>{refusal.reason}</p> : null}
        <div><h3 className="m-0 mb-1.5 text-[13px] font-bold text-axal-ink dark:text-gray-100">Always asks a human</h3><FloorList highlight={refusal?.highlight} note={FLOOR_EDIT_NOTE} /></div>
        <div><h3 className="m-0 mb-1.5 text-[13px] font-bold text-axal-ink dark:text-gray-100">May do automatically</h3><AutoLock /></div>
        {[['may_propose', 'May propose'], ['escalates_when', 'Escalates when'], ['kpis', 'KPIs']].map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1.5">
            <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{label}</span>
            <textarea rows={4} value={draft[k]} onChange={set(k)} className={`${FIELD} h-auto py-2`} />
            <span className={MUTED}>One per line.</span>
          </label>
        ))}
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Tone</span>
          <input value={draft.tone} onChange={set('tone')} className={FIELD} />
        </label>
      </div>
    </Sheet>
  );
}

/** The tab: the library, one rule book, or the honest block while #3840's reads are not there. */
export default function RulebooksTab({ scope, canManage, agentsBlock }) {
  const { search } = useLocation();
  const asked = new URLSearchParams(search).get('role');
  const [rolesBlock, setRolesBlock] = useState(null);
  const [open, setOpen] = useState(null);
  const kind = scope.kind === 'company' ? 'company' : 'project';
  const id = scope.kind === 'company' ? scope.company.uid : scope.project.id;
  const openKey = open?.key || null;
  const [book, setBook] = useState(null);
  const [editing, setEditing] = useState(false);
  const [refusal, setRefusal] = useState('');
  useEffect(() => { let alive = true; agents.roles().then((b) => { if (alive) setRolesBlock(b); }); return () => { alive = false; }; }, []);
  // The role a link asked for (`?role=`) opens once the catalogue is read.
  useEffect(() => {
    if (!asked || rolesBlock?.available !== true) return;
    const r = (rolesBlock.value?.roles || []).find((x) => x.key === asked);
    if (r) setOpen(r);
  }, [asked, rolesBlock]);
  // Keyed on values, not the scope object: a re-render never re-reads the book or drops an open draft.
  useEffect(() => {
    if (!openKey) return undefined;
    let alive = true;
    setBook(null);
    agents.rulebook(kind, id, openKey).then((b) => { if (alive) setBook(b); });
    return () => { alive = false; };
  }, [kind, id, openKey]);
  if (!rolesBlock) return <p className={MUTED}>Reading…</p>;
  if (rolesBlock.available !== true) {
    return <HonestBlock testId="team-roles-unavailable">{rolesBlock.reason} The roles and their rule books arrive with them. That is not the same as having none.</HonestBlock>;
  }
  const roles = Array.isArray(rolesBlock.value?.roles) ? rolesBlock.value.roles : [];
  const agentsList = agentsBlock?.available ? agentsBlock.value?.agents : [];
  if (!open) return <RoleLibrary roles={roles} agentsList={agentsList} onOpen={setOpen} />;
  if (!book) return <p className={MUTED}>Reading…</p>;
  if (book.available !== true) return <HonestBlock>{book.reason || 'This rule book could not be read.'}</HonestBlock>;
  const save = async (rules) => {
    const out = await agents.saveRulebook(kind, id, open.key, rules);
    if (out.available) {
      setEditing(false); setRefusal('');
      setBook({ available: true, value: { ...book.value, ...out.value } });
      // The save answers `{ effective, version }`; the history and the diff from the default are read again.
      agents.rulebook(kind, id, open.key).then((b) => { if (b.available) setBook(b); });
    }
    return out;
  };
  return (
    <>
      <RulebookView book={book.value} role={open} canManage={canManage} refusal={refusal}
        onBack={() => setOpen(null)} onEdit={() => setEditing(true)}
        onRestore={async () => { const out = await save(book.value.default); if (!out.available) setRefusal(out.reason || refusalWords('')); }} />
      {editing ? <EditRulebookSheet book={book.value} role={open} onClose={() => setEditing(false)} onSave={save} /> : null}
    </>
  );
}
