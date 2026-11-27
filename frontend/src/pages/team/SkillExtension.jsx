import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet, Unrecorded } from '../../ui';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, FIELD, MONO, MUTED } from './teamUi.jsx';
import {
  MARKERS, NAME_MAX, REASON_MAX, cellOf, columnsOf, compareHref, extendBody, extendRefusal, newToolsOnly, reasonProblem, rebaseBody,
  rebasePlan, rebaseRefusal, toolsOutsideNewest, unresolved, versionChoices,
} from './extensionCompareModel.js';

/**
 * #5964 (D5963, boards SK-17 to SK-25) — the parts of Compare with Axal (the comparison, the history, the markers),
 * the Extend dialog (SK-21) and SK-10's "Compare with Axal" line. The page itself is `SkillComparePage.jsx`.
 *
 * The compare page reads the extension's card (`GET /api/teams/skills/:uid`) and its lineage
 * (`GET /api/teams/skills/:uid/base`); nothing here writes except Extend (`POST /api/teams/skills/:uid/extend`) and
 * Rebase (SK-20, #4538: `POST /api/teams/skills/:uid/rebase`, D4538 part 5). Each makes a company draft and publishes
 * or attaches nothing. Who published each version is not built: it is drawn as "Not built yet", never a guessed value.
 */

const SECTION = 'rounded-axal-lg border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';

// ---------------------------------------------------------------- markers: a word and a glyph each

const GLYPHS = {
  c: <path d="M6 1l5 9.5H1z" fill="currentColor" />,
  y: <circle cx="6" cy="6" r="4" fill="currentColor" />,
  a: <path d="M6 1l5 5-5 5-5-5z" fill="currentColor" />,
  s: <path d="M2 4.3h8M2 7.7h8" stroke="currentColor" strokeWidth="1.7" />,
};
const MARK_TONE = {
  c: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
  y: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  a: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200',
  s: 'border-axal-hairline bg-white text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
};

export function Marker({ k }) {
  return (
    <span className={`inline-flex min-h-[22px] w-fit items-center gap-1 rounded-axal-pill border px-2 text-[11.5px] font-semibold ${MARK_TONE[k]}`} data-testid={`marker-${k}`}>
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 12 12">{GLYPHS[k]}</svg>{MARKERS[k]}
    </span>
  );
}

function Same({ words }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="cell-same">
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 12 12">{GLYPHS.s}</svg>{words}
    </span>
  );
}

/** One line of a part: + added, − removed, · a run kept. The sign is hidden from screen readers, which hear "Added:" / "Removed:". */
function Line({ l }) {
  if (l.op === 'eq') return <li className="flex gap-2 text-[12.5px] text-axal-muted dark:text-gray-400"><span aria-hidden="true" className="w-3">·</span><span>{l.count} unchanged</span></li>;
  const add = l.op === '+';
  const rm = l.op === '-';
  const tone = add ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200' : rm ? 'bg-red-50 text-red-900 line-through decoration-red-400 dark:bg-red-950/30 dark:text-red-200' : 'text-axal-ink dark:text-gray-200';
  return (
    <li className={`flex gap-2 rounded px-1 text-[13px] leading-[1.5] ${tone}`} data-testid={add ? 'line-added' : rm ? 'line-removed' : 'line-kept'}>
      <span aria-hidden="true" className="w-3 shrink-0 font-mono font-bold">{add ? '+' : rm ? '−' : ''}</span>
      <span>{add ? <span className="sr-only">Added: </span> : rm ? <span className="sr-only">Removed: </span> : null}{l.text}</span>
    </li>
  );
}

function Cell({ row, side, nv }) {
  const c = cellOf(row, side, nv);
  if (c.kind === 'same') return <Same words={c.words} />;
  if (c.kind === 'unrecorded') return <Unrecorded />;
  if (c.kind === 'text') return <span className={`block text-[13px] leading-[1.55] text-axal-ink dark:text-gray-200 ${c.changed ? 'font-semibold' : ''}`}>{c.changed ? <span className="sr-only">Changed: </span> : null}{c.text}</span>;
  if (c.kind === 'list') {
    const Tag = c.numbered ? 'ol' : 'ul';
    return <Tag className={`m-0 flex flex-col gap-1 pl-5 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-200 ${c.numbered ? 'list-decimal' : 'list-disc'}`}>{c.items.map((t, i) => <li key={i}>{t}</li>)}</Tag>;
  }
  if (c.kind === 'lines') return <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{c.lines.map((l, i) => <Line key={i} l={l} />)}</ul>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {c.tools.map((t) => (
        <span key={t.tool} className={`inline-flex flex-col rounded-md border px-1.5 py-0.5 ${t.op === '+' ? 'border-emerald-300 dark:border-emerald-800' : t.op === '-' ? 'border-red-300 dark:border-red-800' : 'border-axal-hairline dark:border-gray-700'}`} data-testid={`tool-${t.op === '+' ? 'added' : t.op === '-' ? 'removed' : 'kept'}`}>
          <span className="font-mono text-[12px] text-axal-ink dark:text-gray-200">{t.op === '+' ? <b aria-hidden="true">+ </b> : t.op === '-' ? <b aria-hidden="true">− </b> : null}{t.tool}</span>
          {t.note ? <small className="text-[11px] text-axal-muted dark:text-gray-400">{t.note}</small> : null}
        </span>
      ))}
    </span>
  );
}

/** SK-17's comparison: a real table on desktop (row headers are the parts); one card per part on a phone (SK-24). */
export function Comparison({ view, card }) {
  const cols = columnsOf(view, card);
  const nv = { base: view.baseVersion, newest: view.newestVersion };
  const present = new Set(view.rows.map((r) => r.marker));
  return (
    <section className={`${SECTION} flex flex-col overflow-hidden`} data-testid="compare-section">
      <div className="flex flex-wrap items-center gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h2 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Comparison · {view.rows.length} parts{view.update && view.conflicts ? ', conflicts first' : ''}</h2>
        <span className="ml-auto flex flex-wrap items-center gap-1.5" aria-label="Markers">
          {['c', 'y', 'a', 's'].filter((k) => present.has(k)).map((k) => <Marker key={k} k={k} />)}
          <span className={MUTED}>+ added line · − removed line</span>
        </span>
      </div>
      <div className="hidden md:block">
        <table className="w-full border-collapse text-left" data-testid="compare-table">
          <caption className="sr-only">Comparison by part, conflicts first</caption>
          <thead>
            <tr className="border-b border-axal-hairline dark:border-gray-800">
              <th scope="col" className={`${EYEBROW} w-40 px-4 py-2`}>Part</th>
              {cols.map((c) => <th key={c.side} scope="col" className="px-4 py-2 text-[13px] font-bold text-axal-ink dark:text-gray-100">{c.title} <small className="block font-normal text-axal-muted dark:text-gray-400">{c.sub}</small></th>)}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.field} className={`border-b border-axal-hairline align-top last:border-b-0 dark:border-gray-800 ${r.marker === 'c' ? 'bg-red-50/40 dark:bg-red-950/20' : ''}`} data-testid={`compare-row-${r.field}`} data-marker={r.marker}>
                <th scope="row" className="px-4 py-3 align-top">
                  <span className="flex flex-col gap-1">
                    <b className="text-[13px] text-axal-ink dark:text-gray-100">{r.label}</b>
                    <Marker k={r.marker} />
                    {r.field === 'tools' ? <small className="text-[11.5px] font-normal text-axal-muted dark:text-gray-400">An extension can use its base’s tools or fewer</small> : null}
                  </span>
                </th>
                {cols.map((c) => <td key={c.side} className="px-4 py-3"><Cell row={r} side={c.side} nv={nv} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2.5 p-3 md:hidden" data-testid="compare-cards">
        {view.rows.map((r) => (
          <article key={r.field} className={`flex flex-col gap-2 rounded-axal-md border p-3 ${r.marker === 'c' ? 'border-red-300 dark:border-red-800' : 'border-axal-hairline dark:border-gray-700'}`}>
            <div className="flex flex-wrap items-center gap-2"><b className="text-[14px] text-axal-ink dark:text-gray-100">{r.label}</b><Marker k={r.marker} /></div>
            {cols.map((c) => (
              <div key={c.side} className="flex flex-col gap-1">
                <span className={EYEBROW}>{c.title} · {c.sub}</span>
                <Cell row={r} side={c.side} nv={nv} />
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}

/** History: each published version of yours and the Axal version it was built on. Who published it, and when, is not recorded yet. */
export function History({ rows }) {
  return (
    <section className={`${SECTION} flex flex-col gap-2 p-4`} data-testid="compare-history">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">History</h2>
        <span className={MUTED}>Your published versions and the Axal version each was built from</span>
      </div>
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li key={r.version} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-axal-hairline py-2 text-[13px] first:border-t-0 dark:border-gray-800" data-testid={`history-v${r.version}`}>
              <b className="font-mono text-axal-ink dark:text-gray-100">Your v{r.version}</b>
              <span className="text-axal-ink dark:text-gray-200">built on {r.builtOn ? <b className="font-mono">Axal v{r.builtOn}</b> : <>Axal: <Unrecorded /></>}</span>
              <span className={MUTED}>Published by, when: <Unrecorded reason="Not built yet: the Worker does not return who published a company version, or when." /></span>
            </li>
          ))}
        </ul>
      ) : <p className={`m-0 ${MUTED}`}>No published versions yet</p>}
    </section>
  );
}

export function ReasonQuote({ companyName, reason }) {
  return (
    <blockquote className="m-0 flex flex-col gap-1 rounded-axal-md border-l-4 border-axal-lavender-edge bg-axal-lavender/40 px-4 py-3 dark:border-violet-800 dark:bg-violet-900/20" data-testid="compare-reason">
      <span className={EYEBROW}>Why {companyName || 'your company'} extended it</span>
      <span className="text-[13.5px] leading-[1.55] text-axal-ink dark:text-gray-200">{reason || <>Reason: <Unrecorded /></>}</span>
    </blockquote>
  );
}

/** SK-21: Extend an Axal skill for a company. A draft copy of one published version; Axal's skill is not changed. */
export function ExtendSkillSheet({ base, company, again = false, existingName = null, onClose, onCreated }) {
  const choices = versionChoices(base.current_version);
  const [reason, setReason] = useState('');
  const [name, setName] = useState(base.name || '');
  const [version, setVersion] = useState(base.version ?? choices[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const count = reason.replace(/\r\n?/g, '\n').trim().length;
  const create = async () => {
    const before = reasonProblem(reason);
    if (before) { setProblem({ field: 'reason', text: before }); return; }
    setProblem(null); setBusy(true);
    try {
      const out = await agents.extendSkill(base.uid, extendBody({ company: company.uid, reason, name, baseName: base.name, version }));
      if (out.available) { onCreated?.(out.value?.skill || null, out.value?.base || null); return; }
      setProblem(out.unreadable
        ? { field: 'dialog', text: 'The extension wasn’t created. Your reason, name and version are still here. Nothing was made.' }
        : out.refused ? extendRefusal(out.code, out.reason) : { field: 'dialog', text: out.reason });
    } finally { setBusy(false); }
  };
  const err = (f) => (problem?.field === f ? problem.text : null);
  return (
    <Sheet title={`Extend ${base.name || 'this Axal skill'} for ${company.name || 'your company'}`} sub="Makes a company draft from one published Axal version" width={560} onClose={busy ? undefined : onClose} testId="extend-skill-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} onClick={create} disabled={busy} aria-busy={busy || undefined} data-testid="extend-create">{busy ? 'Creating extension…' : 'Create extension'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3.5 px-5 py-5">
        {err('dialog') ? <p role="alert" className="m-0 rounded-axal-md border border-red-300 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200" data-testid="extend-error-dialog">{err('dialog')}</p> : null}
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Why are you extending it? <span className="font-normal text-axal-muted dark:text-gray-400">· required</span></span>
          <textarea className={`${FIELD} h-24 py-2 ${err('reason') ? 'border-red-400 dark:border-red-700' : ''}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: our buyers differ from Axal’s…"
            aria-invalid={err('reason') ? true : undefined} aria-describedby={err('reason') ? 'extend-reason-error' : undefined} data-testid="extend-reason" />
          <span className="flex justify-between gap-2">
            {err('reason') ? <span id="extend-reason-error" role="alert" className="text-[12.5px] text-red-700 dark:text-red-300" data-testid="extend-error-reason">✕ {err('reason')}</span> : <span />}
            <span className={MONO} data-testid="extend-count">{count} / {REASON_MAX}</span>
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Name <span className="font-normal text-axal-muted dark:text-gray-400">· optional, up to {NAME_MAX} characters</span></span>
          <input className={`${FIELD} ${err('name') ? 'border-red-400 dark:border-red-700' : ''}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX}
            aria-invalid={err('name') ? true : undefined} aria-describedby={err('name') ? 'extend-name-error' : undefined} data-testid="extend-name" />
          {err('name')
            ? <span id="extend-name-error" role="alert" className="text-[12.5px] text-red-700 dark:text-red-300" data-testid="extend-error-name">✕ {err('name')}</span>
            : <span className={MUTED}>Starts as Axal’s name. It must not match the short name of a skill {company.name || 'your company'} already has.</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Version <span className="font-normal text-axal-muted dark:text-gray-400">· {base.name || 'this skill'} has {choices.length} published {choices.length === 1 ? 'version' : 'versions'}</span></span>
          <select className={`${FIELD} ${err('version') ? 'border-red-400 dark:border-red-700' : ''}`} value={version ?? ''} onChange={(e) => setVersion(Number(e.target.value))}
            aria-invalid={err('version') ? true : undefined} aria-describedby={err('version') ? 'extend-version-error' : undefined} data-testid="extend-version">
            {choices.map((v, i) => <option key={v} value={v}>Axal v{v}{i === 0 ? ' · newest' : ''}</option>)}
          </select>
          {err('version') ? <span id="extend-version-error" role="alert" className="text-[12.5px] text-red-700 dark:text-red-300" data-testid="extend-error-version">✕ {err('version')}</span> : null}
        </label>
        <p className="m-0 rounded-axal-md border border-axal-hairline bg-axal-ground/60 px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200" data-testid="extend-note">
          You get a draft copy of Axal v{version ?? '?'}. Axal’s skill is not changed.
          {again ? <> <b>This is a new extension.</b> Your current extension{existingName ? `, ${existingName},` : ''} and its changes stay as they are.</> : null}
        </p>
        {busy ? <span role="status" className={MUTED}>Creating extension…</span> : null}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- SK-20: Rebase onto Axal vN

const CHOICE_WORDS = (v) => [['mine', 'Keep mine'], ['axal', `Take Axal v${v}`], ['edit', 'Edit by hand']];

/** The hand-written value a part starts from: yours, as the comparison shows it. */
function handStart(field, row) {
  const mine = row?.mine;
  if (field === 'steps') return (Array.isArray(mine) ? mine : []).join('\n');
  if (field === 'tools') return Array.isArray(mine) ? mine.filter((t) => (row?.newest || []).includes(t)) : [];
  return typeof mine === 'string' ? mine : '';
}

/** One hand editor: text for Name, a box for Purpose, one step per line, and Axal vN's tools to tick. */
function HandEditor({ field, row, value, onChange, version, describedBy }) {
  const id = `rebase-hand-${field}`;
  if (field === 'tools') {
    const newest = Array.isArray(row?.newest) ? row.newest : [];
    const on = Array.isArray(value) ? value : [];
    return (
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" aria-describedby={describedBy} data-testid={id}>
        <legend className="mb-1 text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Tools of Axal v{version} · the draft can use these or fewer</legend>
        {newest.map((t) => (
          <label key={t} className="flex min-h-[44px] items-center gap-2 text-[13px] md:min-h-0">
            <input type="checkbox" checked={on.includes(t)} onChange={(e) => onChange(e.target.checked ? newest.filter((x) => x === t || on.includes(x)) : on.filter((x) => x !== t))} />
            <span className="font-mono">{t}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  const label = field === 'steps' ? 'Steps · one per line' : field === 'purpose' ? 'Purpose' : 'Name';
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">{label}</span>
      {field === 'name'
        ? <input id={id} className={FIELD} value={value ?? ''} onChange={(e) => onChange(e.target.value)} maxLength={NAME_MAX} aria-describedby={describedBy} data-testid={id} />
        : <textarea id={id} className={`${FIELD} ${field === 'steps' ? 'h-40' : 'h-24'} py-2`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} data-testid={id} />}
    </label>
  );
}

/** D8827: an accepted proposal's choice per conflicting part, with the hand editor's start value for the others' Edit. */
function seedChoices(plan, initial, start) {
  const out = {};
  for (const c of plan?.conflicts || []) {
    const pick = initial?.[c.field];
    if (!pick || !['mine', 'axal', 'edit'].includes(pick.choice) || (pick.choice === 'edit' && !c.editable)) continue;
    out[c.field] = { choice: pick.choice, value: pick.choice === 'edit' ? pick.value : start(c.field) };
  }
  return out;
}

/**
 * SK-20: Rebase onto Axal vN. One choice per conflicting part (Keep mine / Take Axal vN / Edit by hand), the other
 * parts' result lines, and Create draft. It sends the exact Axal version shown and the draft version read; it makes a
 * new draft (replacing unpublished draft edits) and never publishes it or touches a pinned agent. A refusal keeps
 * every choice; one the page must re-read offers Reload.
 */
export function RebaseSheet({ skillUid, view, card, onClose, onReload, onRebased, initial = null }) {
  const plan = rebasePlan(view);
  const v = plan?.version;
  const rowOf = (f) => view.rows.find((r) => r.field === f);
  // D8827: the choices the editor accepted from Eadwyn's proposals start chosen; every other conflict starts unchosen.
  const [choices, setChoices] = useState(() => seedChoices(plan, initial, (f) => handStart(f, rowOf(f))));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [missing, setMissing] = useState([]);
  const pick = (field, choice) => {
    setChoices((c) => ({ ...c, [field]: { choice, value: c[field]?.value ?? handStart(field, rowOf(field)) } }));
    setMissing((m) => m.filter((f) => f !== field));
    if (problem?.part === field) setProblem(null);
  };
  const edit = (field, value) => setChoices((c) => ({ ...c, [field]: { ...c[field], value } }));
  const keptTools = (() => {
    const t = choices.tools;
    if (!t) return [];
    const row = rowOf('tools');
    const list = t.choice === 'mine' ? row?.mine : t.choice === 'edit' ? t.value : row?.newest;
    return toolsOutsideNewest(view, list);
  })();
  const newOnly = newToolsOnly(view);
  const create = async () => {
    const left = unresolved(plan, choices);
    if (left.length) { setMissing(left); setProblem({ part: left[0], text: 'Choose what the new draft keeps for this part.', reload: false }); return; }
    setProblem(null); setBusy(true);
    try {
      const out = await agents.rebaseSkill(skillUid, rebaseBody({ version: v, draftHash: card.draft_hash, choices, plan }));
      if (out.available) { onRebased?.(out.value?.skill || null, out.value?.base || null); return; }
      setProblem(out.unreadable
        ? { part: null, text: 'The draft wasn’t created. Your choices are still here. Nothing was saved.', reload: false }
        : out.refused ? rebaseRefusal(out.code, out.reason, out.part) : { part: null, text: out.reason || 'Team agents are not available right now. Nothing was saved.', reload: false });
    } finally { setBusy(false); }
  };
  const dialogProblem = problem && !problem.part ? problem : null;
  const mineWord = view.companySide === 'draft' ? 'your draft' : `your published v${view.companyVersion ?? card.version ?? '?'}`;
  return (
    <Sheet title={`Rebase onto Axal v${v}`} sub={`Makes a new draft from ${mineWord} and Axal v${v}`} width={640} onClose={busy ? undefined : onClose} testId="rebase-sheet"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          {problem?.reload ? <button type="button" className={`${BTN_SECONDARY} min-h-[44px] md:min-h-0`} onClick={onReload} disabled={busy} data-testid="rebase-reload">Reload the comparison</button> : null}
          <button type="button" className={`${BTN_SECONDARY} min-h-[44px] md:min-h-0`} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={`${BTN_PRIMARY} min-h-[44px] md:min-h-0`} onClick={create} disabled={busy} aria-busy={busy || undefined} data-testid="rebase-create">{busy ? 'Creating draft…' : 'Create draft'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3.5 px-5 py-5">
        <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200" data-testid="rebase-intro">
          For each conflicting part, choose what the new draft keeps. Your agents keep their pinned version. Nothing here changes {mineWord}.
        </p>
        {dialogProblem ? <p role="alert" className="m-0 rounded-axal-md border border-red-300 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200" data-testid="rebase-error-dialog">{dialogProblem.text}</p> : null}
        {plan.conflicts.length ? plan.conflicts.map((c) => {
          const chosen = choices[c.field]?.choice || null;
          const err = problem?.part === c.field ? problem.text : missing.includes(c.field) ? 'Choose what the new draft keeps for this part.' : null;
          const errId = `rebase-error-${c.field}`;
          const noteId = `rebase-note-${c.field}`;
          return (
            <fieldset key={c.field} className={`m-0 flex flex-col gap-2 rounded-axal-md border p-3 ${err ? 'border-red-400 dark:border-red-700' : 'border-axal-hairline dark:border-gray-700'}`}
              aria-describedby={[err ? errId : null, c.field === 'tools' ? noteId : null].filter(Boolean).join(' ') || undefined} data-testid={`rebase-part-${c.field}`}>
              <legend className="flex items-center gap-2 px-1 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{c.label} <Marker k="c" /></legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={c.label}>
                {CHOICE_WORDS(v).map(([key, words]) => {
                  const off = key === 'edit' && !c.editable;
                  return (
                    <label key={key} className={`inline-flex min-h-[44px] items-center gap-2 rounded-axal-pill border px-3 text-[13px] md:min-h-[34px] ${chosen === key ? 'border-axal-violet bg-axal-lavender font-semibold text-axal-violet-deep dark:border-violet-500 dark:bg-violet-900/30 dark:text-violet-200' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-200'} ${off ? 'opacity-60' : ''}`}>
                      <input type="radio" name={`rebase-${c.field}`} value={key} checked={chosen === key} disabled={off || busy} onChange={() => pick(c.field, key)} data-testid={`rebase-${c.field}-${key}`} />
                      {words}
                    </label>
                  );
                })}
              </div>
              {!c.editable ? <small className={MUTED} data-testid={`rebase-${c.field}-no-hand`}>Keep yours or take Axal’s here; then change {c.label.toLowerCase()} in the new draft.</small> : null}
              {c.field === 'tools' ? (
                <small id={noteId} className={MUTED} data-testid="rebase-tools-note">
                  The draft can use Axal v{v}’s tools or fewer.{newOnly.length ? <> Only Take Axal v{v} or Edit by hand can carry <span className="font-mono">{newOnly.join(', ')}</span>, new in v{v}.</> : null}
                </small>
              ) : null}
              {c.field === 'tools' && keptTools.length ? (
                <p className="m-0 text-[12.5px] text-amber-900 dark:text-amber-200" data-testid="rebase-tools-outside">
                  <span className="font-mono">{keptTools.join(', ')}</span> {keptTools.length === 1 ? 'is' : 'are'} not a tool of Axal v{v}, so the draft can’t keep {keptTools.length === 1 ? 'it' : 'them'}. Take Axal’s, or edit by hand.
                </p>
              ) : null}
              {chosen === 'edit' ? <HandEditor field={c.field} row={rowOf(c.field)} value={choices[c.field]?.value} onChange={(val) => edit(c.field, val)} version={v} describedBy={err ? errId : undefined} /> : null}
              {err ? <span id={errId} role="alert" className="text-[12.5px] text-red-700 dark:text-red-300" data-testid={`rebase-error-${c.field}-text`}>✕ {err}</span> : null}
            </fieldset>
          );
        }) : <p className={`m-0 ${MUTED}`} data-testid="rebase-no-conflicts">No parts conflict. Nothing needs a choice.</p>}
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]" data-testid="rebase-results">
          {plan.taken.length ? <li className="flex flex-wrap items-center gap-2" data-testid="rebase-taken"><b className="text-axal-ink dark:text-gray-100">{plan.taken.join(', ')}</b><Marker k="a" /><span className={MUTED}>Taken from Axal v{v}</span></li> : null}
          {plan.kept.length ? <li className="flex flex-wrap items-center gap-2" data-testid="rebase-kept"><b className="text-axal-ink dark:text-gray-100">{plan.kept.join(', ')}</b><Marker k="y" /><span className={MUTED}>Kept from yours</span></li> : null}
          {plan.unchanged.length ? <li className="flex flex-wrap items-center gap-2" data-testid="rebase-unchanged"><b className="text-axal-ink dark:text-gray-100">{plan.unchanged.join(', ')}</b><Marker k="s" /><span className={MUTED}>Unchanged</span></li> : null}
        </ul>
        <p className="m-0 flex gap-2 rounded-axal-md border border-axal-hairline bg-axal-ground/60 px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200" data-testid="rebase-note">
          <span aria-hidden="true" className="font-bold">i</span>
          <span>Creates a new draft on Axal v{v}. Your published version and pinned agents stay as they are; nothing is published.
            {card.draft_differs ? <b> It replaces your unpublished draft edits.</b> : null}</span>
        </p>
        {busy ? <span role="status" className={MUTED}>Creating draft…</span> : null}
      </div>
    </Sheet>
  );
}

/** SK-10's line on an extension's page: which Axal version it is built on, and the way to Compare with Axal. */
export function BasedOnLine({ basedOn, companyUid, skillUid }) {
  if (!basedOn || !companyUid) return null;
  return (
    <span className={MUTED} data-testid="skill-based-on">
      Based on Axal{Number.isSafeInteger(basedOn.version) ? ` v${basedOn.version}` : ''} · <Link to={compareHref(companyUid, skillUid)} className={BTN_TEXT} data-testid="skill-compare-link">Compare with Axal</Link>
    </span>
  );
}
