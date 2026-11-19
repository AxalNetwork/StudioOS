import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet, Unrecorded } from '../../ui';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, FIELD, MONO, MUTED } from './teamUi.jsx';
import {
  MARKERS, NAME_MAX, REASON_MAX, cellOf, columnsOf, compareHref, extendBody, extendRefusal, reasonProblem, versionChoices,
} from './extensionCompareModel.js';

/**
 * #5964 (D5963, boards SK-17 to SK-25) — the parts of Compare with Axal (the comparison, the history, the markers),
 * the Extend dialog (SK-21) and SK-10's "Compare with Axal" line. The page itself is `SkillComparePage.jsx`.
 *
 * The compare page reads the extension's card (`GET /api/teams/skills/:uid`) and its lineage
 * (`GET /api/teams/skills/:uid/base`); nothing here writes except Extend (`POST /api/teams/skills/:uid/extend`),
 * which makes a company draft and attaches it to no agent. The rebase panel (#5965) and who published each
 * version are not built: they are drawn as "Not built yet", never as a working control or a guessed value.
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

/** SK-10's line on an extension's page: which Axal version it is built on, and the way to Compare with Axal. */
export function BasedOnLine({ basedOn, companyUid, skillUid }) {
  if (!basedOn || !companyUid) return null;
  return (
    <span className={MUTED} data-testid="skill-based-on">
      Based on Axal{Number.isSafeInteger(basedOn.version) ? ` v${basedOn.version}` : ''} · <Link to={compareHref(companyUid, skillUid)} className={BTN_TEXT} data-testid="skill-compare-link">Compare with Axal</Link>
    </span>
  );
}
