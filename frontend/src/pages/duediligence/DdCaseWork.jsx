/**
 * D1251 (#3266) — the case tabs a section reviewer sees too (RT): Overview
 * (DDL3), Checklist (DDL4), Flags (DDL5) and Activity (DDL11). Each draws a
 * control only when the case read's `allowed` says the viewer may use it;
 * otherwise one sentence says who does it (`ddCaseModel.WHO`). The rules are
 * `ddCaseModel.js`; the dialogs are `DdCaseDialogs.jsx`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { dd } from '../../lib/api';
import {
  ACTIVITY_CAP, FLAG_STATES, FLAG_STATE_WORD, ITEM_FILTERS, ITEM_STATUS_WORD, NOT_RECORDED, SOURCE_WORD, WHO, activityFilters,
  activityRows, bandWord, caseTiles, decisionStrip, evidenceByItem, filterItems, flagRows, flagSourceWord, flagsHeadline,
  fmtDay, itemCounts, may, maySection, peopleOf, personName, sectionRow,
} from './ddCaseModel.js';
import { SEVERITY_WORD } from './ddListModel.js';
import { Note, btnCls, cardCls, eyebrowCls, inputCls, muted, primaryCls } from './DdUi.jsx';

export function Who({ text, testId }) {
  return <p className={`m-0 text-[12.5px] ${muted}`} data-testid={testId}>{text}</p>;
}

export function CaseUnreadable({ what, onRetry, testId }) {
  return (
    <p className="m-0 text-[13px]" role="status" data-testid={testId}>
      <span className="font-semibold">Unreadable.</span> {what}{' '}
      <button type="button" className="font-semibold text-violet-700 underline dark:text-violet-300" onClick={onRetry}>Try again</button>
    </p>
  );
}

export function Tile({ tile }) {
  return (
    <div className={`${cardCls} p-4`} data-testid={`dd-tile-${tile.key}`}>
      <div className={eyebrowCls}>{tile.label}</div>
      <div className={`mt-1 text-[22px] font-bold ${tile.alert ? 'text-rose-700 dark:text-rose-300' : tile.warn ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'}`}>{tile.value}</div>
      <div className={`text-[12px] ${muted}`}>{tile.sub}</div>
    </div>
  );
}

export function Block({ title, testId, action, children }) {
  return (
    <section className={`${cardCls} p-4`} data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[14px] font-bold text-gray-900 dark:text-gray-100">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const thCls = 'px-3 py-2 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
const tdCls = 'px-3 py-2 align-top text-[13px] text-gray-800 dark:text-gray-200';
export const Table = ({ head, children, testId }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[560px] border-collapse" data-testid={testId}>
      <thead><tr className="border-b border-axal-hairline dark:border-gray-800">{head.map((h) => <th key={h} className={thCls}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
export const Td = ({ children, className = '' }) => <td className={`${tdCls} ${className}`}>{children}</td>;

const SEV_CLS = {
  critical: 'bg-red-600 text-white', high: 'bg-orange-500 text-white', medium: 'bg-amber-300 text-amber-950',
  low: 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100', info: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100',
};
export const Severity = ({ s }) => <span className={`inline-block rounded px-1.5 py-0.5 text-[10.5px] font-bold ${SEV_CLS[s] || SEV_CLS.info}`}>{SEVERITY_WORD[s] || NOT_RECORDED}</span>;

/** The decision strip (DDL3, DDL10). */
export function DecisionStrip({ data, onDecide }) {
  const strip = decisionStrip(data.case, data.sections, data.flags);
  return (
    <div className={`${cardCls} flex flex-wrap items-center justify-between gap-3 p-4`} data-testid="dd-decision-strip">
      <div className="flex flex-col gap-0.5">
        {strip.recorded ? (
          <>
            <span className="text-[14px] font-bold">Decision: {strip.word}</span>
            <span className={`text-[12.5px] ${muted}`}>Recorded by {strip.by} · {strip.at}</span>
            {strip.reason ? <span className="text-[12.5px]">{strip.reason}</span> : null}
          </>
        ) : (
          <>
            <span className="text-[14px] font-bold">{strip.word}</span>
            {strip.line ? <span className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-200" data-testid="dd-blocked-line">{strip.line}</span> : null}
          </>
        )}
      </div>
      {!strip.recorded && (may(data, 'decide') ? <button type="button" className={primaryCls} onClick={onDecide} data-testid="dd-decide-open">Record decision</button> : <Who text={data.case.status === 'archived' ? WHO.archived : WHO.decide} testId="dd-who-decide" />)}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overview (DDL3)
 * ------------------------------------------------------------------ */

export function OverviewTab({ data, focusSection, open, sectionRefs }) {
  const cs = data.case;
  const score = cs.risk_score != null ? Math.round(Number(cs.risk_score) * 100) : null;
  const assign = may(data, 'assign') && !cs.scoped;
  return (
    <div className="flex flex-col gap-4" data-testid="dd-case-overview">
      <DecisionStrip data={data} onDecide={() => open('decide')} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{caseTiles(data).map((t) => <Tile key={t.key} tile={t} />)}</div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <h2 className="m-0 text-[14px] font-bold">Sections</h2>
          {!assign && !cs.scoped ? <Who text={WHO.assign} testId="dd-who-assign" /> : null}
          {(data.sections || []).map((s) => {
            const row = sectionRow(s, data);
            const verdict = maySection(data, 'verdict', s.id) && cs.status !== 'archived';
            return (
              <div key={s.id} id={`dd-section-${s.id}`} ref={(el) => { if (el) sectionRefs.current[String(s.id)] = el; }}
                className={`${cardCls} p-4 transition-shadow ${String(focusSection) === String(s.id) ? 'ring-2 ring-violet-400' : ''}`} data-testid={`dd-section-${s.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{row.title}{row.blocking ? <span className={`ml-2 text-[11px] font-bold ${muted}`}>Blocking</span> : null}</div>
                    <div className={`text-[12px] ${muted}`}>Checklist {row.worked} · {row.flagged ? `${row.flagged} flagged` : 'none flagged'} · {row.noReviewer ? 'No reviewer' : row.reviewers.join(', ')}</div>
                    {/* D466 — the Sign-off column: who returned the verdict, recorded at write; a section completed before it existed reads unrecorded. */}
                    {s.status === 'completed' && (
                      <div className={`mt-0.5 text-[12px] ${muted}`} data-testid={`signoff-${s.id}`}>
                        {s.signed_off_by_name
                          ? `Signed off by ${s.signed_off_by_name}${s.completed_at ? ` · ${String(s.completed_at).slice(0, 10)}` : ''}`
                          : 'Sign-off not recorded'}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11.5px] font-semibold dark:border-gray-700" data-testid={`dd-section-verdict-${s.id}`}>{row.verdict}</span>
                    {assign ? <button type="button" className={btnCls} onClick={() => open('assign', { sectionId: s.id })} data-testid={`dd-assign-open-${s.id}`}>Assign</button> : null}
                    {verdict ? <button type="button" className={primaryCls} onClick={() => open('verdict', { section: s })} data-testid={`dd-verdict-open-${s.id}`}>{row.hasVerdict ? 'Change verdict' : 'Record verdict'}</button> : null}
                  </div>
                </div>
                {s.reviewer_notes ? <p className="m-0 mt-2 rounded bg-gray-50 p-2 text-[12.5px] dark:bg-gray-800/60">Reviewer: {s.reviewer_notes}</p> : null}
                {!verdict && (cs.status === 'archived' ? null : <Who text={WHO.verdict} testId={`dd-who-verdict-${s.id}`} />)}
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-3">
          <Block title="Risk" testId="dd-risk">
            <div className="text-[20px] font-bold" data-testid="dd-risk-band">{bandWord(cs.risk_band || null)}</div>
            <div className={`text-[12.5px] ${muted}`}>{score == null ? 'No score yet' : `Score ${score} of 100`}</div>
          </Block>
          {!cs.scoped && (
            <Block title="Deal context" testId="dd-deal">
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className={muted}>Round</dt><dd className="m-0">{cs.round_label || NOT_RECORDED}</dd>
                <dt className={muted}>Cheque</dt><dd className="m-0">{cs.cheque_cents != null ? `${(Number(cs.cheque_cents) / 100).toLocaleString('en-US')} ${cs.cheque_currency || ''}`.trim() : NOT_RECORDED}</dd>
                <dt className={muted}>Deal</dt><dd className="m-0">{cs.deal_id != null ? `Deal #${cs.deal_id}` : NOT_RECORDED}</dd>
              </dl>
            </Block>
          )}
          {!cs.scoped && (cs.subject_legal_name || cs.subject_email) ? (
            <Block title="Subject" testId="dd-subject">
              <p className={`m-0 text-[12px] ${muted}`}>Kept encrypted; the deal team reads it.</p>
              {cs.subject_legal_name ? <p className="m-0 text-[13px]">Legal name: {cs.subject_legal_name}</p> : null}
              {cs.subject_email ? <p className="m-0 text-[13px]">Email: {cs.subject_email}</p> : null}
            </Block>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Checklist (DDL4)
 * ------------------------------------------------------------------ */

const SEGMENTS = ['pending', 'pass', 'flag', 'fail', 'n_a'];

function ItemRow({ item, people, evidence, works, picked, onPick, open }) {
  const set = (status) => { if (status !== item.status) open('item', { item, status }); };
  return (
    <li className="flex flex-col gap-1 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800" data-testid={`dd-item-${item.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        {works ? <input type="checkbox" checked={picked} onChange={() => onPick(item.id)} aria-label={`Choose ${item.title}`} data-testid={`dd-item-pick-${item.id}`} /> : null}
        <span className="min-w-0 flex-1 text-[13px]">{item.title}</span>
        {works ? (
          <div className="flex overflow-hidden rounded-lg border border-axal-hairline dark:border-gray-700" role="group" aria-label={`Status of ${item.title}`}>
            {SEGMENTS.map((s) => (
              <button key={s} type="button" aria-pressed={item.status === s} onClick={() => set(s)} data-testid={`dd-item-${item.id}-${s}`}
                className={`px-2 py-1 text-[11.5px] font-semibold ${item.status === s ? 'bg-violet-600 text-white dark:bg-violet-500' : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'}`}>
                {ITEM_STATUS_WORD[s]}
              </button>
            ))}
          </div>
        ) : <span className="text-[12px] font-semibold" data-testid={`dd-item-status-${item.id}`}>{ITEM_STATUS_WORD[item.status] || NOT_RECORDED}</span>}
      </div>
      <div className={`flex flex-wrap gap-3 text-[12px] ${muted}`}>
        <span>Owner: {personName(people, item.owner_user_id) || 'No owner'}</span>
        <span>{item.due_date ? `Due ${fmtDay(item.due_date)}` : 'No due date'}</span>
        <span>{evidence == null ? 'Evidence: Not recorded' : `Evidence: ${evidence.length || 'none'}`}</span>
        {item.note ? <span>Note: {item.note}</span> : null}
      </div>
    </li>
  );
}

export function ChecklistTab({ data, open }) {
  const [chip, setChip] = useState('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const people = useMemo(() => peopleOf(data), [data]);
  const evidence = evidenceByItem(data);
  const counts = itemCounts(data.checklist);
  const shown = filterItems(data.checklist, chip, q);
  const pick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const anyWork = (data.sections || []).some((s) => maySection(data, 'work', s.id));
  return (
    <div className="flex flex-col gap-4" data-testid="dd-case-checklist">
      <div className="flex flex-wrap items-center gap-2">
        {ITEM_FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={chip === f.key} onClick={() => setChip(f.key)} data-testid={`dd-chip-${f.key}`}
            className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${chip === f.key ? 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200' : 'border-axal-hairline dark:border-gray-700'}`}>
            {f.label} {counts[f.key]}
          </button>
        ))}
        <input className={`${inputCls} max-w-xs`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" aria-label="Search items" data-testid="dd-item-search" />
      </div>
      {anyWork ? (
        picked.length ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="dd-bulk-bar">
            <span className="text-[13px] font-semibold">{picked.length === 1 ? 'One item chosen' : `${picked.length} items chosen`}</span>
            <button type="button" className={btnCls} onClick={() => open('bulk', { kind: 'owner', itemIds: picked, after: () => setPicked([]) })}>Set owner</button>
            <button type="button" className={btnCls} onClick={() => open('bulk', { kind: 'due', itemIds: picked, after: () => setPicked([]) })}>Set due date</button>
            <button type="button" className={btnCls} onClick={() => open('bulk', { kind: 'n_a', itemIds: picked, after: () => setPicked([]) })}>Mark N/A</button>
            <button type="button" className={btnCls} onClick={() => setPicked([])}>Clear</button>
          </div>
        ) : <p className={`m-0 text-[12.5px] ${muted}`}>Choose items to set an owner or a due date, or mark them N/A, together.</p>
      ) : <Who text={WHO.work} testId="dd-who-work" />}
      {(data.sections || []).map((s) => {
        const items = shown.filter((i) => Number(i.section_id) === Number(s.id));
        const all = (data.checklist || []).filter((i) => Number(i.section_id) === Number(s.id));
        if (!items.length && (chip !== 'all' || q)) return null;
        const works = maySection(data, 'work', s.id);
        return (
          <Block key={s.id} title={s.title} testId={`dd-checklist-${s.id}`}>
            {!all.length ? <p className={`m-0 text-[12.5px] ${muted}`}>This section has no checklist items.</p> : (
              <ul className="m-0 list-none p-0">
                {items.map((i) => (
                  <ItemRow key={i.id} item={i} people={people} evidence={evidence ? evidence.get(Number(i.id)) || [] : null}
                    works={works} picked={picked.includes(i.id)} onPick={pick} open={open} />
                ))}
              </ul>
            )}
          </Block>
        );
      })}
      {!shown.length && (chip !== 'all' || q) ? <p className={`m-0 text-[13px] ${muted}`} data-testid="dd-checklist-none">No item matches.</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Flags (DDL5)
 * ------------------------------------------------------------------ */

export function FlagsTab({ data, open }) {
  const [f, setF] = useState({ severity: '', state: 'not_closed', section: '', source: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const rows = flagRows(data.flags, f);
  const people = peopleOf(data);
  const raise = (data.sections || []).some((s) => maySection(data, 'work', s.id));
  const sectionTitle = (id) => (data.sections || []).find((s) => Number(s.id) === Number(id))?.title || 'Case-wide';
  const Row = ({ flag }) => (
    <tr className="cursor-pointer border-t border-axal-hairline hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50" onClick={() => open('flag', { flag })} data-testid={`dd-flag-row-${flag.kind}-${flag.id ?? flag.checklist_item_id}`}>
      <Td><Severity s={flag.severity} /></Td>
      <Td><button type="button" className="text-left font-semibold hover:underline" onClick={(e) => { e.stopPropagation(); open('flag', { flag }); }}>{flag.title}</button></Td>
      <Td>{sectionTitle(flag.section_id)}</Td>
      <Td>{flagSourceWord(flag)}</Td>
      <Td>{personName(people, flag.owner_user_id) || 'No owner'}</Td>
      <Td>{FLAG_STATE_WORD[flag.state] || NOT_RECORDED}</Td>
      <Td>{fmtDay(flag.created_at) || NOT_RECORDED}</Td>
    </tr>
  );
  const head = ['Severity', 'Flag', 'Section', 'Source', 'Owner', 'State', 'Raised'];
  return (
    <div className="flex flex-col gap-4" data-testid="dd-case-flags">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[14px] font-semibold" data-testid="dd-flags-headline">{flagsHeadline(data.flags, data.sections)}</p>
        {raise ? <button type="button" className={primaryCls} onClick={() => open('raise')} data-testid="dd-raise-open">Raise a flag</button> : <Who text={WHO.work} testId="dd-who-raise" />}
      </div>
      <div className="flex flex-wrap gap-2">
        <select className={`${inputCls} w-auto`} value={f.severity} onChange={set('severity')} aria-label="Severity" data-testid="dd-flags-severity">
          <option value="">Any severity</option>
          {['critical', 'high', 'medium', 'low', 'info'].map((s) => <option key={s} value={s}>{SEVERITY_WORD[s]}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={f.state} onChange={set('state')} aria-label="State" data-testid="dd-flags-state">
          <option value="not_closed">Not closed</option>
          <option value="any">Any state</option>
          {FLAG_STATES.map((s) => <option key={s} value={s}>{FLAG_STATE_WORD[s]}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={f.section} onChange={set('section')} aria-label="Section">
          <option value="">Every section</option>
          {(data.sections || []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={f.source} onChange={set('source')} aria-label="Source">
          <option value="">Any source</option>
          {Object.entries(SOURCE_WORD).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
        </select>
      </div>
      <Block title="Open" testId="dd-flags-open">
        {rows.open.length ? <Table head={head}>{rows.open.map((fl) => <Row key={`${fl.kind}-${fl.id ?? fl.checklist_item_id}`} flag={fl} />)}</Table>
          : <p className={`m-0 text-[13px] ${muted}`}>No flag matches.</p>}
      </Block>
      {rows.closed.length ? (
        <Block title="Closed" testId="dd-flags-closed">
          <Table head={head}>{rows.closed.map((fl) => <Row key={`${fl.kind}-${fl.id}`} flag={fl} />)}</Table>
        </Block>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Activity (DDL11)
 * ------------------------------------------------------------------ */

export function ActivityTab({ uid, data, read = dd.audit }) {
  const [state, setState] = useState({ items: null, failed: false });
  const [f, setF] = useState({ action: '', person: '' });
  const load = () => {
    setState({ items: null, failed: false });
    read(uid).then((r) => setState({ items: r?.items || [], failed: false })).catch(() => setState({ items: null, failed: true }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [uid]);
  if (!may(data, 'audit')) return <Who text="The deal team and the case’s reviewers read its activity." testId="dd-who-audit" />;
  if (state.failed) return <CaseUnreadable what="The case’s activity could not be read." onRetry={load} testId="dd-activity-unreadable" />;
  if (state.items == null) return <p className={`m-0 text-[13px] ${muted}`}>Reading the activity…</p>;
  const filters = activityFilters(state.items);
  const rows = activityRows(state.items, f);
  return (
    <div className="flex flex-col gap-3" data-testid="dd-case-activity">
      <div className="flex flex-wrap gap-2">
        <select className={`${inputCls} w-auto`} value={f.action} onChange={(e) => setF((x) => ({ ...x, action: e.target.value }))} aria-label="Action" data-testid="dd-activity-action">
          <option value="">Every action</option>
          {filters.actions.map((a) => <option key={a} value={a}>{String(a).replace(/_/g, ' ')}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={f.person} onChange={(e) => setF((x) => ({ ...x, person: e.target.value }))} aria-label="Person" data-testid="dd-activity-person">
          <option value="">Everyone</option>
          {filters.people.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
        </select>
      </div>
      {state.items.length >= ACTIVITY_CAP ? <Note>Showing the latest {ACTIVITY_CAP} entries.</Note> : null}
      {!rows.length ? <p className={`m-0 text-[13px] ${muted}`}>{state.items.length ? 'No entry matches.' : 'Nothing is recorded on this case yet.'}</p> : (
        <ul className={`${cardCls} m-0 list-none p-0`}>
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-3 border-t border-axal-hairline px-4 py-2 text-[13px] first:border-t-0 dark:border-gray-800" data-testid="dd-activity-row">
              <span className="font-mono text-[12px]">{r.at}</span><span className="font-semibold">{r.who}</span><span>{r.what}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
