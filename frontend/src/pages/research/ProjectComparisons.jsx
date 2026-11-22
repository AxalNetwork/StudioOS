/**
 * D5157 part 3 (#5157) — a Research Project's Comparisons tab
 * (`/research/projects/:uid/comparisons`), to RS-02 D · Comparisons in
 * `design/incoming/Research v2 Page.dc.html`.
 *
 * WHAT IS BUILT. The project's companies and funds (added with Add to
 * research from the directories), with Compare over a selection of one kind
 * and Remove; and each comparison as a table whose rows are the same
 * attributes for every column (row headers, so a value reads with its
 * attribute), each value with its source and date, Not recorded with the
 * reason, Unreadable when the directory could not be read. Add company / Add
 * fund from the project or by searching the directory, Remove a column,
 * Rename, and Delete (asked once, in the card). On a phone each column is a
 * card.
 *
 * WHAT IS NOT, and says so: "Research status" and "Sources" per column have no
 * store, so they are not rows; nothing is scored, ranked or summed.
 *
 * D7177 (#7177, canvas D7043 boards RS-15 C to RS-15 E) — Table and By
 * attribute: the table on a desktop; on a tablet the same table keeps its
 * attribute column and pages the companies three at a time (never a
 * half-visible column); By attribute reads one attribute across every
 * company with a stepper, the phone's default, with By company (one card
 * per column) beside it. A cell the Worker could not read is Unreadable with
 * Retry, never Not recorded; a source with no web address is printed, not
 * linked. A comparison the old one-by-one save left short (fewer than two
 * columns) or doubled is flagged "Saved part-way" (D7043 ⚑, option A): the
 * member completes it or deletes it, and nothing is merged or removed.
 *
 * D7167 part 2 (#7167, FND-P08 D and E): a comparison of funds on a phone
 * switches By fund and By attribute. By fund pages one fund at a time with
 * Previous and Next and "Fund 3 of 6"; By attribute is the list above. Its
 * line says n of 6 funds, as each source reported them, with no conversion,
 * total or score. Companies keep By attribute and By company. A removed
 * column hands focus to the column that took its place, or to Add fund when
 * none is left (FND-P10).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BTN_PRIMARY } from '../hq/security/ActionDialog.jsx';
import { researchProjectComparisonsApi } from '../../lib/api/researchProjectComparisons.js';
import { researchCompaniesApi } from '../../lib/api/researchCompanies.js';
import { researchFundsApi } from '../../lib/api/researchFunds.js';
import { KIND_WORDS, columnAfterRemoval, comparisonError, comparisonsView, fundPage, subjectHref } from './researchComparisons.js';
import { OUTCOME_COPY, columnPage, newRequestId, partWay, saveOutcome, statusView, stepAttribute } from './comparisonSave.js';
import { backToResults } from './companyDirectoryState.js';

const CARD = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-[32px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2.5 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const H2 = 'text-[14px] font-extrabold text-axal-ink dark:text-white';
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const FAINT = 'text-[11px] text-axal-faint dark:text-gray-500';
const FAILURE = 'text-[12.5px] font-semibold text-red-700 dark:text-red-300';
const LINK = 'text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-200';

/** One value: the text and what sits under it, or the reason it is not shown. */
function Value({ c, testid, onRetry }) {
  if (c.state === 'recorded') {
    return (
      <div data-testid={testid}>
        <span className="font-semibold text-axal-ink dark:text-gray-100">{c.text}</span>
        {c.detail ? <span className="block text-[11.5px] text-axal-muted dark:text-gray-400">{c.detail}</span> : null}
        <span className={`block ${FAINT}`}>{c.sourceUrl ? <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline">{c.source}<span className="sr-only"> (opens source)</span><span aria-hidden="true"> ↗</span></a> : c.source}</span>
      </div>
    );
  }
  if (c.state === 'not_recorded') return <span data-testid={testid} className="italic text-gray-500 dark:text-gray-400" title={c.reason}>{c.text}<span className="sr-only"> ({c.reason})</span></span>;
  if (c.state === 'unreadable') {
    // D7167: a failed read says Unavailable; D7177: a value held in a form that cannot be read says Unreadable, with why.
    const failedRead = /^Unavailable/.test(c.reason || '');
    const word = failedRead ? 'Unavailable' : 'Unreadable';
    const why = c.reason && c.reason !== word ? c.reason.replace(/^(Unreadable|Unavailable):\s*/, '') : null;
    return (
      <span data-testid={testid} className="flex flex-col items-start gap-0.5">
        <span className="font-semibold text-red-700 dark:text-red-300">{failedRead ? <span aria-hidden="true">! </span> : null}{word}</span>
        {why ? <span className="text-[11px] text-axal-muted dark:text-gray-400">{why}</span> : null}
        {onRetry ? <button type="button" className="text-[11.5px] font-bold text-violet-700 underline dark:text-violet-300" onClick={onRetry}>Retry</button> : null}
      </span>
    );
  }
  return <span data-testid={testid} className={FAINT}>Not shown<span className="sr-only"> ({c.reason})</span></span>;
}

/** Add a column: from the project's own companies or funds, or by searching the directory. */
function AddColumn({ projectUid, set, onChanged, onClose }) {
  const words = KIND_WORDS[set.kind];
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ status: 'idle', items: [] });
  const [busy, setBusy] = useState(null);
  const [failure, setFailure] = useState(null);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setFound({ status: 'idle', items: [] }); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      setFound((f) => ({ ...f, status: 'loading' }));
      try {
        const api = set.kind === 'fund' ? researchFundsApi : researchCompaniesApi;
        const res = await api.list({ q: text, limit: 8 });
        if (live) setFound({ status: 'ok', items: (res?.items || []).filter((x) => x && x.uid) });
      } catch {
        if (live) setFound({ status: 'failed', items: [] });
      }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, set.kind]);
  const add = async (uid, name) => {
    setBusy(uid);
    setFailure(null);
    try {
      await researchProjectComparisonsApi.addMember(projectUid, set.uid, uid);
      onChanged();
    } catch (err) {
      setFailure(`${name} could not be added. ${comparisonError(err, '')}`.trim());
    } finally { setBusy(null); }
  };
  const inSet = new Set(set.members.map((m) => m.uid));
  const row = (x) => (
    <li key={x.uid} className="flex items-center justify-between gap-2 text-[12.5px]">
      <span className="min-w-0 truncate text-axal-ink dark:text-gray-100">{x.name}</span>
      {inSet.has(x.uid)
        ? <span className={FAINT}>In this comparison</span>
        : <button type="button" className={SECONDARY} disabled={busy === x.uid || set.full} onClick={() => add(x.uid, x.name)} data-testid={`button-add-column-${set.uid}-${x.uid}`}>Add</button>}
    </li>
  );
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-950" data-testid={`add-column-${set.uid}`} aria-label={words.add}>
      <div className="flex items-center justify-between gap-2">
        <b className="text-[12.5px] text-axal-ink dark:text-white">{words.add}</b>
        <button type="button" className={SECONDARY} onClick={onClose}>Done</button>
      </div>
      {failure ? <p role="alert" className={FAILURE}>{failure}</p> : null}
      {set.full ? <p className={MUTED}>This comparison has its 6 columns. Remove one to add another.</p> : null}
      {set.candidates.length ? (
        <>
          <span className="text-[11.5px] font-bold text-axal-muted dark:text-gray-400">In this project</span>
          <ul className="flex flex-col gap-1.5">{set.candidates.map((s) => row({ uid: s.uid, name: s.name }))}</ul>
        </>
      ) : null}
      <label htmlFor={`find-${set.uid}`} className="text-[11.5px] font-bold text-axal-muted dark:text-gray-400">Search the {words.one} directory</label>
      <input id={`find-${set.uid}`} value={q} onChange={(e) => setQ(e.target.value)} className={INPUT} placeholder={`Name of a ${words.one}`} data-testid={`input-find-${set.uid}`} />
      {found.status === 'loading' ? <p className={MUTED} role="status">Searching…</p> : null}
      {found.status === 'failed' ? <p className={MUTED} role="status">Unreadable: the directory could not be searched just now.</p> : null}
      {found.status === 'ok' && !found.items.length ? <p className={MUTED}>No {words.one} matches “{q.trim()}”.</p> : null}
      {found.items.length ? <ul className="flex flex-col gap-1.5">{found.items.map(row)}</ul> : null}
    </section>
  );
}

/** RS-15 C/D: one attribute across every column, with a stepper that names the next and previous attribute. */
function ByAttribute({ set, attr, onStep, onPick, onRetry, scope }) {
  const row = set.rows[attr];
  if (!row) return null;
  const n = set.rows.length;
  const prev = set.rows[stepAttribute(attr, -1, n)].label;
  const next = set.rows[stepAttribute(attr, 1, n)].label;
  const STEP = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-axal-hairline bg-white text-[16px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
  return (
    <div className="flex flex-col gap-2" data-testid={`comparison-attribute-${scope}-${set.uid}`}>
      <div className="flex items-center gap-2">
        <button type="button" className={STEP} onClick={() => onStep(-1)} aria-label={`Previous attribute: ${prev}`} data-testid={`button-attr-prev-${scope}-${set.uid}`}>‹</button>
        <label htmlFor={`attr-${scope}-${set.uid}`} className="sr-only">Attribute</label>
        <select id={`attr-${scope}-${set.uid}`} value={attr} onChange={(e) => onPick(Number(e.target.value))}
          className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-axal-hairline bg-white px-3 text-[13px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" data-testid={`select-attr-${scope}-${set.uid}`}>
          {set.rows.map((r, i) => <option key={r.key} value={i}>{r.label} · {i + 1} of {n}</option>)}
        </select>
        <button type="button" className={STEP} onClick={() => onStep(1)} aria-label={`Next attribute: ${next}`} data-testid={`button-attr-next-${scope}-${set.uid}`}>›</button>
      </div>
      <ul className="flex flex-col divide-y divide-axal-hairline rounded-lg border border-axal-hairline dark:divide-gray-800 dark:border-gray-700" aria-label={`${row.label} for each column`}>
        {set.members.map((m, i) => (
          <li key={m.uid} className="flex flex-col gap-1 px-3 py-2.5 text-[12.5px]" data-testid={`attr-row-${scope}-${set.uid}-${m.uid}`}>
            <Link to={m.href} className={`font-extrabold ${LINK}`} data-col-focus={set.uid} data-col-uid={m.uid}>{m.name}</Link>
            {m.note ? <span className="text-[11.5px] text-amber-800 dark:text-amber-300">{m.note}</span> : <Value c={row.cells[i]} onRetry={onRetry} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SEG = 'min-h-[40px] flex-1 rounded-md px-3 text-[12.5px] font-bold sm:min-h-[32px] sm:flex-none';
const segOn = (on) => (on ? 'bg-white text-axal-ink shadow-sm dark:bg-gray-800 dark:text-white' : 'text-axal-muted dark:text-gray-400');
/** A two-way layout switch, as radios. */
function Segmented({ label, value, options, onChange, className = '', testId }) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex rounded-lg border border-axal-hairline bg-axal-ground p-0.5 dark:border-gray-700 dark:bg-gray-950 ${className}`} data-testid={testId}>
      {options.map(([key, text]) => (
        <button key={key} type="button" role="radio" aria-checked={value === key ? 'true' : 'false'} className={`${SEG} ${segOn(value === key)}`}
          onClick={() => onChange(key)} data-testid={`${testId}-${key}`}>{text}</button>
      ))}
    </div>
  );
}

/** One column as a card: its name, Remove, its note and every attribute with its value. */
function MemberCard({ set, m, i, archived, onRemove, onChanged, removeLabel = 'Remove' }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <Link to={m.href} className={`font-extrabold ${LINK}`} data-col-focus={set.uid} data-col-uid={m.uid}>{m.name}</Link>
        {!archived ? <button type="button" className={SECONDARY} onClick={() => onRemove(m)} data-testid={`button-card-remove-${set.uid}-${m.uid}`}>{removeLabel}</button> : null}
      </div>
      {m.note ? <span className="text-[11.5px] text-amber-800 dark:text-amber-300">{m.note}</span> : null}
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
        {set.rows.map((r) => <React.Fragment key={r.key}><dt className="font-bold text-axal-muted dark:text-gray-400">{r.label}</dt><dd><Value c={r.cells[i]} onRetry={onChanged} /></dd></React.Fragment>)}
      </dl>
    </>
  );
}

/** FND-P08 E: By fund, one fund at a time with Previous and Next; it stops at either end. */
function FundPager({ set, index, onIndex, archived, onRemove, onChanged }) {
  const p = fundPage(set.members.length, index);
  const m = set.members[p.index];
  if (!m) return null;
  const STEP = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-axal-hairline bg-white text-[16px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
  return (
    <div className="flex flex-col gap-2" data-testid={`comparison-by-fund-${set.uid}`}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={STEP} disabled={p.first} onClick={() => onIndex(p.index - 1)} aria-label="Previous fund" data-testid={`button-fund-prev-${set.uid}`}>‹</button>
        <span className={MUTED} aria-live="polite" data-testid={`fund-page-${set.uid}`}>{p.label}</span>
        <button type="button" className={STEP} disabled={p.last} onClick={() => onIndex(p.index + 1)} aria-label="Next fund" data-testid={`button-fund-next-${set.uid}`}>›</button>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid={`fund-card-${set.uid}-${m.uid}`}>
        <MemberCard set={set} m={m} i={p.index} archived={archived} onRemove={onRemove} onChanged={onChanged} removeLabel="Remove from comparison" />
      </div>
    </div>
  );
}

function ComparisonCard({ projectUid, set, archived, onChanged, flag }) {
  const words = KIND_WORDS[set.kind];
  // D7177: Table or By attribute from a tablet up; By attribute or By company on a phone.
  const [layout, setLayout] = useState('table');
  const [phoneLayout, setPhoneLayout] = useState('attribute');
  // D7167 part 2: funds switch By fund (a pager) and By attribute on a phone.
  const isFund = set.kind === 'fund';
  const [fundIndex, setFundIndex] = useState(0);
  const [attr, setAttr] = useState(0);
  const [page, setPage] = useState(0);
  const pager = columnPage(set.members.length, page);
  const step = (by) => setAttr((a) => stepAttribute(a, by, set.rows.length));
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(set.title);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState(null);
  const act = async (fn, fallback) => {
    setFailure(null);
    try { await fn(); onChanged(); return true; } catch (err) { setFailure(`${comparisonError(err, fallback)} Nothing was changed.`); return false; }
  };
  // FND-P10: once the read no longer holds the removed column, focus the one that took its place, else Add fund.
  const [refocus, setRefocus] = useState(null);
  const removeColumn = async (m) => {
    const at = set.members.findIndex((x) => x.uid === m.uid);
    if (await act(() => researchProjectComparisonsApi.removeMember(projectUid, set.uid, m.uid), 'It could not be removed.')) setRefocus({ at, gone: m.uid });
  };
  useEffect(() => {
    if (!refocus || set.members.some((x) => x.uid === refocus.gone)) return;
    setRefocus(null);
    const next = columnAfterRemoval(set.members, refocus.at);
    if (typeof document.querySelectorAll !== 'function') return;
    const el = next ? [...document.querySelectorAll(`[data-col-focus="${set.uid}"]`)].find((e) => e.getAttribute('data-col-uid') === next && e.offsetParent !== null) : null;
    (el || document.getElementById(`add-column-${set.uid}`))?.focus?.();
  }, [refocus, set.members, set.uid]);
  const rename = async (e) => {
    e?.preventDefault?.();
    if (!title.trim()) { setFailure('A comparison needs a title.'); return; }
    if (await act(() => researchProjectComparisonsApi.rename(projectUid, set.uid, title.trim()), 'It could not be renamed.')) setRenaming(false);
  };
  return (
    <section className={CARD} data-testid={`comparison-${set.uid}`} aria-labelledby={`cmp-${set.uid}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        {renaming ? (
          <form onSubmit={rename} className="flex min-w-0 flex-1 flex-wrap items-center gap-2" data-testid={`form-rename-${set.uid}`}>
            <label htmlFor={`rn-${set.uid}`} className="sr-only">Comparison title</label>
            <input id={`rn-${set.uid}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className={`${INPUT} sm:max-w-md`} data-testid={`input-rename-${set.uid}`} />
            <button type="submit" className={BTN_PRIMARY}>Save</button>
            <button type="button" className={SECONDARY} onClick={() => { setRenaming(false); setTitle(set.title); }}>Cancel</button>
          </form>
        ) : (
          <div className="min-w-0">
            <h2 id={`cmp-${set.uid}`} tabIndex={-1} className={`${H2} focus:outline-none`}>{set.title}</h2>
            <span className={FAINT} data-testid={`comparison-line-${set.uid}`}>{isFund
              ? `${set.members.length} of ${set.limit} ${set.members.length === 1 ? words.one : words.many} · as reported by each source · no conversion, total or score`
              : `${set.members.length} ${set.members.length === 1 ? 'column' : 'columns'} · ${words.title} · as of each source’s date · no composite score`}</span>
          </div>
        )}
        {!archived && !renaming ? (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" id={`add-column-${set.uid}`} className={SECONDARY} onClick={() => setAdding((a) => !a)} aria-expanded={adding ? 'true' : 'false'} data-testid={`button-add-column-${set.uid}`}>{words.add}</button>
            <button type="button" className={SECONDARY} onClick={() => setRenaming(true)} data-testid={`button-rename-${set.uid}`}>Rename</button>
            <button type="button" className={SECONDARY} onClick={() => setConfirming(true)} data-testid={`button-delete-comparison-${set.uid}`}>Delete</button>
          </div>
        ) : null}
      </div>
      {confirming && !archived ? (
        <div role="alertdialog" aria-labelledby={`del-${set.uid}`} className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50/60 p-3 dark:border-red-900 dark:bg-red-950/20" data-testid={`confirm-delete-comparison-${set.uid}`}>
          <p id={`del-${set.uid}`} className="text-[12.5px] text-axal-ink dark:text-gray-100">Delete “{set.title}”? The {words.many} stay in this project and in the directory.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={SECONDARY} onClick={() => setConfirming(false)}>Keep it</button>
            <button type="button" className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-red-700 px-3 text-[12.5px] font-bold text-white hover:bg-red-800 sm:min-h-[32px]"
              onClick={() => act(() => researchProjectComparisonsApi.remove(projectUid, set.uid), 'It could not be deleted.')} data-testid={`button-delete-comparison-confirm-${set.uid}`}>Delete comparison</button>
          </div>
        </div>
      ) : null}
      {flag ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200" data-testid={`partway-${set.uid}`}>
          <b>Saved part-way.</b> {flag.text.replace(/^Saved part-way: /, '')}
        </p>
      ) : null}
      {failure ? <p role="alert" className={FAILURE}>{failure}</p> : null}
      {adding && !archived ? <AddColumn projectUid={projectUid} set={set} onChanged={onChanged} onClose={() => setAdding(false)} /> : null}
      {!set.members.length ? <p className={MUTED} data-testid={`comparison-empty-${set.uid}`}>No {words.many} in this comparison. {archived ? '' : `${words.add} to begin.`}</p> : (
        <>
          <div className="hidden flex-wrap items-center justify-between gap-2 sm:flex">
            <Segmented label="Layout" value={layout} options={[['table', 'Table'], ['attribute', 'By attribute']]} onChange={setLayout} testId={`layout-${set.uid}`} />
            {layout === 'table' && pager.pages > 1 ? (
              <div className="flex items-center gap-2 lg:hidden" data-testid={`column-pager-${set.uid}`}>
                <span className={MUTED}>{words.title} {pager.from + 1}–{pager.to} of {set.members.length}</span>
                <button type="button" className={`${SECONDARY} w-11`} disabled={pager.page === 0} onClick={() => setPage(pager.page - 1)}
                  aria-label={`Previous ${words.many}`} data-testid={`button-columns-prev-${set.uid}`}>‹</button>
                <button type="button" className={`${SECONDARY} w-11`} disabled={pager.page >= pager.pages - 1} onClick={() => setPage(pager.page + 1)}
                  aria-label={`Next ${words.many}: ${set.members.slice(pager.to, pager.to + 3).map((m) => m.name).join(', ')}`} data-testid={`button-columns-next-${set.uid}`}>›</button>
              </div>
            ) : null}
          </div>
          {layout === 'attribute' ? <div className="hidden sm:block"><ByAttribute scope="wide" set={set} attr={attr} onStep={step} onPick={setAttr} onRetry={onChanged} /></div> : null}
          <div className={layout === 'table' ? 'hidden overflow-x-auto sm:block' : 'hidden'}>
            {/* One table: from 1024px every column; on a tablet the attribute column and the current page of three. */}
            <table className="w-full text-left text-[12.5px] lg:min-w-[560px]" data-testid={`comparison-table-${set.uid}`}>
              <caption className="sr-only">{set.title}: {set.rows.length} attributes for {set.members.length} {words.many}, each value with its source and date</caption>
              <thead>
                <tr className="border-b border-axal-hairline dark:border-gray-800">
                  <th scope="col" className="px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-axal-muted dark:text-gray-400">Attribute</th>
                  {set.members.map((m, i) => (
                    <th key={m.uid} scope="col" className={`px-3 py-2 align-top ${i < pager.from || i >= pager.to ? 'sm:hidden lg:table-cell' : ''}`}>
                      <span className="flex items-start justify-between gap-2">
                        <Link to={m.href} className={`font-extrabold ${LINK}`} data-col-focus={set.uid} data-col-uid={m.uid}>{m.name}</Link>
                        {!archived ? (
                          <button type="button" aria-label={`Remove ${m.name} from this comparison`} className="text-[12px] font-bold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-white"
                            onClick={() => removeColumn(m)} data-testid={`button-remove-column-${set.uid}-${m.uid}`}>✕</button>
                        ) : null}
                      </span>
                      {m.note ? <span className="block text-[11px] font-normal text-amber-800 dark:text-amber-300" data-testid={`column-note-${set.uid}-${m.uid}`}>{m.note}</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {set.rows.map((r) => (
                  <tr key={r.key} className="border-b border-axal-hairline align-top last:border-0 dark:border-gray-800">
                    <th scope="row" className="px-3 py-2 font-bold text-axal-muted dark:text-gray-400">{r.label}</th>
                    {r.cells.map((c, i) => (
                      <td key={set.members[i].uid} className={`px-3 py-2 ${i < pager.from || i >= pager.to ? 'sm:hidden lg:table-cell' : ''}`}>
                        <Value c={c} testid={`cell-${set.uid}-${r.key}-${set.members[i].uid}`} onRetry={onChanged} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Phone: By attribute (RS-15 D) reads one attribute across every column with no panning; By company keeps RS-10's cards. */}
          <Segmented label="Comparison view" value={phoneLayout} options={isFund ? [['fund', 'By fund'], ['attribute', 'By attribute']] : [['attribute', 'By attribute'], ['company', 'By company']]}
            onChange={setPhoneLayout} className="sm:hidden" testId={`phone-layout-${set.uid}`} />
          {phoneLayout === 'attribute' ? <div className="sm:hidden"><ByAttribute scope="phone" set={set} attr={attr} onStep={step} onPick={setAttr} onRetry={onChanged} /></div> : null}
          {phoneLayout === 'fund' ? (
            <div className="sm:hidden">
              <FundPager set={set} index={fundIndex} onIndex={setFundIndex} archived={archived} onChanged={onChanged}
                onRemove={removeColumn} />
            </div>
          ) : null}
          <ul className={phoneLayout === 'company' ? 'flex flex-col gap-2 sm:hidden' : 'hidden'} data-testid={`comparison-cards-${set.uid}`}>
            {set.members.map((m, i) => (
              <li key={m.uid} className="flex flex-col gap-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700">
                <MemberCard set={set} m={m} i={i} archived={archived} onChanged={onChanged}
                  onRemove={removeColumn} />
              </li>
            ))}
          </ul>
        </>
      )}
      <p className={FAINT}>Each value names its source and date. Missing values say Not recorded and never count as zero.</p>
    </section>
  );
}

/** The project's companies and funds, with Compare over a selection of one kind. */
function Subjects({ projectUid, view, archived, onChanged }) {
  const [picked, setPicked] = useState({ kind: null, uids: [] });
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const attempt = useRef(null);
  const creating = useRef(false);
  const route = useRef(projectUid);
  route.current = projectUid;
  const unknown = outcome?.kind === 'unknown';
  const locked = busy || checking || unknown;
  const companyResults = backToResults(typeof window === 'undefined' ? null : window.sessionStorage).href;
  useEffect(() => {
    attempt.current = null; creating.current = false;
    setPicked({ kind: null, uids: [] }); setTitle(''); setBusy(false);
    setOutcome(null); setStatus(null); setChecking(false);
  }, [projectUid]);
  const toggle = (kind, uid) => {
    if (locked) return;
    attempt.current = null; setOutcome(null); setStatus(null);
    setPicked((p) => {
    if (p.kind && p.kind !== kind) return { kind, uids: [uid] };
    const uids = p.uids.includes(uid) ? p.uids.filter((u) => u !== uid) : [...p.uids, uid];
    return { kind: uids.length ? kind : null, uids };
    });
  };
  const create = async (e) => {
    e?.preventDefault?.();
    if (!picked.uids.length || creating.current || checking || (unknown && status?.kind !== 'not_found')) return;
    const request = attempt.current ?? {
      projectUid, request_id: newRequestId(), kind: picked.kind, uids: [...picked.uids],
      ...(title.trim() ? { title: title.trim() } : {}),
    };
    attempt.current = request;
    const belongs = () => attempt.current === request && route.current === request.projectUid;
    creating.current = true;
    setBusy(true); setFailure(null); setStatus(null);
    try {
      const { projectUid: target, ...body } = request;
      const res = await researchProjectComparisonsApi.create(target, body);
      if (!belongs()) return;
      const result = saveOutcome({ res });
      setOutcome(result);
      if (result.kind === 'ok') {
        attempt.current = null; setPicked({ kind: null, uids: [] }); setTitle(''); onChanged();
      }
    } catch (err) {
      if (belongs()) setOutcome(saveOutcome({ err }));
    } finally { if (belongs() || attempt.current == null && route.current === request.projectUid) { creating.current = false; setBusy(false); } }
  };
  const checkSave = async () => {
    const request = attempt.current;
    if (!request || checking || creating.current) return;
    const belongs = () => attempt.current === request && route.current === request.projectUid;
    setChecking(true);
    try {
      const result = statusView({ res: await researchProjectComparisonsApi.saveStatus(request.request_id) });
      if (!belongs()) return;
      setStatus(result);
      if (result.kind === 'saved') { attempt.current = null; setPicked({ kind: null, uids: [] }); setTitle(''); setOutcome(null); onChanged(); }
    } catch (err) { if (belongs()) setStatus(statusView({ err })); }
    finally { if (route.current === request.projectUid) setChecking(false); }
  };
  const remove = async (s) => {
    setFailure(null);
    try {
      await researchProjectComparisonsApi.removeSubject(projectUid, s.kind, s.uid);
      setRemoving(null);
      onChanged();
    } catch (err) {
      setFailure(`${s.name} could not be removed. ${comparisonError(err, '')}`.trim());
    }
  };
  const all = [...view.subjects.company, ...view.subjects.fund];
  return (
    <section className={CARD} data-testid="project-subjects" aria-labelledby="ps-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ps-heading" className={H2}>Companies and funds in this project</h2>
        {!archived ? (
          <span className="flex flex-wrap gap-3 text-[12.5px] font-bold">
            <Link className={LINK} to={companyResults}>Add from Companies</Link>
            <Link className={LINK} to="/research/funds">Add from Funds</Link>
          </span>
        ) : null}
      </div>
      {!all.length ? (
        <p className={MUTED} data-testid="subjects-empty">None yet. Use Add to research on a company or a fund, or Compare on two or more companies, to bring them here.</p>
      ) : (
        <>
          {['company', 'fund'].filter((k) => view.subjects[k].length).map((kind) => (
            <div key={kind} className="flex flex-col gap-1.5">
              <h3 className="text-[12px] font-bold text-axal-muted dark:text-gray-400">{KIND_WORDS[kind].title}{view.directory[kind] === 'unreadable' ? ' · Unreadable: the directory could not be read just now' : ''}</h3>
              <ul className="flex flex-col gap-1.5">
                {view.subjects[kind].map((s) => (
                  <li key={s.uid} className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]" data-testid={`subject-${s.kind}-${s.uid}`}>
                    <label className="flex min-h-[44px] min-w-0 items-center gap-2 sm:min-h-[28px]">
                      {!archived ? <input type="checkbox" checked={picked.kind === kind && picked.uids.includes(s.uid)} disabled={locked} onChange={() => toggle(kind, s.uid)} aria-label={`Select ${s.name} to compare`} data-testid={`pick-${s.kind}-${s.uid}`} /> : null}
                      <Link to={subjectHref(s.kind, s.uid)} className={`truncate font-semibold ${LINK}`}>{s.name}</Link>
                      {s.state !== 'listed' ? <span className="text-[11px] text-amber-800 dark:text-amber-300">{s.state === 'unreadable' ? 'Unreadable' : s.state === 'withdrawn' ? 'List taken down' : 'No longer in the directory'}</span> : null}
                      {s.comparisons ? <span className={FAINT}>in {s.comparisons} {s.comparisons === 1 ? 'comparison' : 'comparisons'}</span> : null}
                    </label>
                    {!archived ? (removing === `${s.kind}:${s.uid}` ? (
                      <span className="flex flex-wrap items-center gap-2" data-testid={`confirm-remove-${s.kind}-${s.uid}`}>
                        <span className={MUTED}>{s.comparisons ? `It also leaves ${s.comparisons} ${s.comparisons === 1 ? 'comparison' : 'comparisons'}.` : 'Remove from this project?'}</span>
                        <button type="button" className={SECONDARY} onClick={() => setRemoving(null)}>Keep</button>
                        <button type="button" className={SECONDARY} onClick={() => remove(s)} data-testid={`button-remove-confirm-${s.kind}-${s.uid}`}>Remove</button>
                      </span>
                    ) : <button type="button" className="text-[12px] font-bold text-axal-muted underline hover:text-axal-ink dark:text-gray-400 dark:hover:text-white" onClick={() => setRemoving(`${s.kind}:${s.uid}`)} data-testid={`button-remove-${s.kind}-${s.uid}`}>Remove</button>) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!archived ? (
            <form noValidate onSubmit={create} className="flex flex-col gap-2 border-t border-axal-hairline pt-3 sm:flex-row sm:items-end dark:border-gray-800" data-testid="form-new-comparison">
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor="nc-title" className="text-[12px] font-bold text-axal-ink dark:text-white">New comparison <span className="font-normal text-axal-muted dark:text-gray-400">· tick {picked.kind ? KIND_WORDS[picked.kind].many : 'companies or funds'} of one kind; the title is optional</span></label>
                <input id="nc-title" value={title} disabled={locked} onChange={(e) => { attempt.current = null; setOutcome(null); setStatus(null); setTitle(e.target.value); }} maxLength={160} className={INPUT} data-testid="input-new-comparison-title" />
              </div>
              <button type="submit" className={BTN_PRIMARY} disabled={busy || checking || unknown && status?.kind !== 'not_found' || !picked.uids.length || picked.uids.length > view.limit} aria-busy={busy || undefined} data-testid="button-new-comparison">
                {busy ? 'Creating…' : `Compare ${picked.uids.length || ''}`.trim()}
              </button>
            </form>
          ) : null}
        </>
      )}
      {outcome ? <div role={OUTCOME_COPY[outcome.kind]?.role || 'status'} className={MUTED} data-testid="project-comparison-outcome">
        <strong>{OUTCOME_COPY[outcome.kind]?.chip}</strong>{' '}{OUTCOME_COPY[outcome.kind]?.head}
        {OUTCOME_COPY[outcome.kind]?.body ? <p>{OUTCOME_COPY[outcome.kind].body}</p> : null}
        {unknown ? <button type="button" className={SECONDARY} onClick={checkSave} disabled={checking || busy} data-testid="button-project-comparison-status">{checking ? 'Checking…' : 'Check save status'}</button> : null}
      </div> : null}
      {status ? <div role="status" className={MUTED} data-testid="project-comparison-save-status"><strong>{status.chip}</strong>{' '}{status.head}<p>{status.body}</p></div> : null}
      {failure ? <p role="alert" className={FAILURE}>{failure}</p> : null}
    </section>
  );
}

export function ProjectComparisons({ projectUid, read, retry, archived, onChanged }) {
  const view = comparisonsView(read);
  const { hash } = useLocation();
  const companyResults = backToResults(typeof window === 'undefined' ? null : window.sessionStorage).href;
  const flags = view.state === 'ok' ? partWay(view.comparisons) : new Map();
  // "Open the comparison →" lands here with #comparison-<uid>: focus moves to that comparison's heading.
  const target = view.state === 'ok' && hash.startsWith('#comparison-') ? decodeURIComponent(hash.slice('#comparison-'.length)) : null;
  useEffect(() => {
    if (!target || typeof document === 'undefined') return;
    const el = document.getElementById(`cmp-${target}`);
    el?.focus?.();
    el?.scrollIntoView?.({ block: 'start' });
  }, [target]);
  if (view.state === 'loading') return <p className={MUTED} role="status" data-testid="comparisons-loading">Reading the comparisons…</p>;
  if (view.state === 'unreadable') {
    return (
      <section className={CARD} role="status" data-testid="comparisons-unreadable">
        <strong className="text-axal-ink dark:text-white">Unavailable</strong>
        <p className={MUTED}>The comparisons could not be read just now. Nothing about them has changed.</p>
        <button type="button" className={`${SECONDARY} self-start`} onClick={retry} data-testid="button-comparisons-retry">Retry</button>
      </section>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="project-comparisons-tab">
      <Subjects projectUid={projectUid} view={view} archived={archived} onChanged={onChanged} />
      {view.comparisons.length ? view.comparisons.map((set) => (
        <ComparisonCard key={set.uid} projectUid={projectUid} set={set} archived={archived} onChanged={onChanged} flag={flags.get(set.uid) || null} />
      )) : (
        <section className={CARD} data-testid="comparisons-empty">
          <strong className="text-axal-ink dark:text-white">No comparisons yet</strong>
          <p className={MUTED}>Tick two or more companies or funds above and press Compare, or select 2 to 6 companies in Companies and press Compare there.</p>
          {!archived ? <Link className={`${SECONDARY} self-start`} to={companyResults}>Open Companies</Link> : null}
        </section>
      )}
    </div>
  );
}

export default ProjectComparisons;
