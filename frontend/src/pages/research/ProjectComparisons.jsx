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
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BTN_PRIMARY } from '../hq/security/ActionDialog.jsx';
import { researchProjectComparisonsApi } from '../../lib/api/researchProjectComparisons.js';
import { researchCompaniesApi } from '../../lib/api/researchCompanies.js';
import { researchFundsApi } from '../../lib/api/researchFunds.js';
import { KIND_WORDS, comparisonError, comparisonsView, subjectHref } from './researchComparisons.js';

const CARD = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-[32px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2.5 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const H2 = 'text-[14px] font-extrabold text-axal-ink dark:text-white';
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const FAINT = 'text-[11px] text-axal-faint dark:text-gray-500';
const FAILURE = 'text-[12.5px] font-semibold text-red-700 dark:text-red-300';
const LINK = 'text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-200';

/** One value: the text and what sits under it, or the reason it is not shown. */
function Value({ c, testid }) {
  if (c.state === 'recorded') {
    return (
      <div data-testid={testid}>
        <span className="font-semibold text-axal-ink dark:text-gray-100">{c.text}</span>
        {c.detail ? <span className="block text-[11.5px] text-axal-muted dark:text-gray-400">{c.detail}</span> : null}
        <span className={`block ${FAINT}`}>{c.sourceUrl ? <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline">{c.source}</a> : c.source}</span>
      </div>
    );
  }
  if (c.state === 'not_recorded') return <span data-testid={testid} className="italic text-gray-500 dark:text-gray-400" title={c.reason}>{c.text}<span className="sr-only"> ({c.reason})</span></span>;
  if (c.state === 'unreadable') return <span data-testid={testid} className="font-semibold text-red-700 dark:text-red-300">Unreadable</span>;
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

function ComparisonCard({ projectUid, set, archived, onChanged }) {
  const words = KIND_WORDS[set.kind];
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(set.title);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState(null);
  const act = async (fn, fallback) => {
    setFailure(null);
    try { await fn(); onChanged(); return true; } catch (err) { setFailure(`${comparisonError(err, fallback)} Nothing was changed.`); return false; }
  };
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
            <h2 id={`cmp-${set.uid}`} className={H2}>{set.title}</h2>
            <span className={FAINT}>{words.title} · as of each source’s date · no composite score</span>
          </div>
        )}
        {!archived && !renaming ? (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={SECONDARY} onClick={() => setAdding((a) => !a)} aria-expanded={adding ? 'true' : 'false'} data-testid={`button-add-column-${set.uid}`}>{words.add}</button>
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
      {failure ? <p role="alert" className={FAILURE}>{failure}</p> : null}
      {adding && !archived ? <AddColumn projectUid={projectUid} set={set} onChanged={onChanged} onClose={() => setAdding(false)} /> : null}
      {!set.members.length ? <p className={MUTED} data-testid={`comparison-empty-${set.uid}`}>No {words.many} in this comparison. {archived ? '' : `${words.add} to begin.`}</p> : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[560px] text-left text-[12.5px]" data-testid={`comparison-table-${set.uid}`}>
              <caption className="sr-only">{set.title}: each value with its source and date</caption>
              <thead>
                <tr className="border-b border-axal-hairline dark:border-gray-800">
                  <th scope="col" className="px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-axal-muted dark:text-gray-400">Attribute</th>
                  {set.members.map((m) => (
                    <th key={m.uid} scope="col" className="px-3 py-2 align-top">
                      <span className="flex items-start justify-between gap-2">
                        <Link to={m.href} className={`font-extrabold ${LINK}`}>{m.name}</Link>
                        {!archived ? (
                          <button type="button" aria-label={`Remove ${m.name} from this comparison`} className="text-[12px] font-bold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-white"
                            onClick={() => act(() => researchProjectComparisonsApi.removeMember(projectUid, set.uid, m.uid), 'It could not be removed.')} data-testid={`button-remove-column-${set.uid}-${m.uid}`}>✕</button>
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
                    {r.cells.map((c, i) => <td key={set.members[i].uid} className="px-3 py-2"><Value c={c} testid={`cell-${set.uid}-${r.key}-${set.members[i].uid}`} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Phone (RS-10's rule): a table becomes cards, one per column, each value with its attribute. */}
          <ul className="flex flex-col gap-2 sm:hidden" data-testid={`comparison-cards-${set.uid}`}>
            {set.members.map((m, i) => (
              <li key={m.uid} className="flex flex-col gap-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700">
                <div className="flex items-start justify-between gap-2">
                  <Link to={m.href} className={`font-extrabold ${LINK}`}>{m.name}</Link>
                  {!archived ? <button type="button" className={SECONDARY} onClick={() => act(() => researchProjectComparisonsApi.removeMember(projectUid, set.uid, m.uid), 'It could not be removed.')}>Remove</button> : null}
                </div>
                {m.note ? <span className="text-[11.5px] text-amber-800 dark:text-amber-300">{m.note}</span> : null}
                <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
                  {set.rows.map((r) => <React.Fragment key={r.key}><dt className="font-bold text-axal-muted dark:text-gray-400">{r.label}</dt><dd><Value c={r.cells[i]} /></dd></React.Fragment>)}
                </dl>
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
  const toggle = (kind, uid) => setPicked((p) => {
    if (p.kind && p.kind !== kind) return { kind, uids: [uid] };
    const uids = p.uids.includes(uid) ? p.uids.filter((u) => u !== uid) : [...p.uids, uid];
    return { kind: uids.length ? kind : null, uids };
  });
  const create = async (e) => {
    e?.preventDefault?.();
    if (!picked.uids.length) return;
    setBusy(true);
    setFailure(null);
    try {
      await researchProjectComparisonsApi.create(projectUid, { kind: picked.kind, uids: picked.uids, ...(title.trim() ? { title: title.trim() } : {}) });
      setPicked({ kind: null, uids: [] });
      setTitle('');
      onChanged();
    } catch (err) {
      setFailure(`${comparisonError(err, 'The comparison could not be created.')} Nothing was created.`);
    } finally { setBusy(false); }
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
            <Link className={LINK} to="/research/companies">Add from Companies</Link>
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
                      {!archived ? <input type="checkbox" checked={picked.kind === kind && picked.uids.includes(s.uid)} onChange={() => toggle(kind, s.uid)} aria-label={`Select ${s.name} to compare`} data-testid={`pick-${s.kind}-${s.uid}`} /> : null}
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
            <form onSubmit={create} className="flex flex-col gap-2 border-t border-axal-hairline pt-3 sm:flex-row sm:items-end dark:border-gray-800" data-testid="form-new-comparison">
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor="nc-title" className="text-[12px] font-bold text-axal-ink dark:text-white">New comparison <span className="font-normal text-axal-muted dark:text-gray-400">· tick {picked.kind ? KIND_WORDS[picked.kind].many : 'companies or funds'} of one kind; the title is optional</span></label>
                <input id="nc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className={INPUT} data-testid="input-new-comparison-title" />
              </div>
              <button type="submit" className={BTN_PRIMARY} disabled={busy || !picked.uids.length || picked.uids.length > view.limit} data-testid="button-new-comparison">
                {busy ? 'Creating…' : `Compare ${picked.uids.length || ''}`.trim()}
              </button>
            </form>
          ) : null}
        </>
      )}
      {failure ? <p role="alert" className={FAILURE}>{failure}</p> : null}
    </section>
  );
}

export function ProjectComparisons({ projectUid, read, retry, archived, onChanged }) {
  const view = comparisonsView(read);
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
        <ComparisonCard key={set.uid} projectUid={projectUid} set={set} archived={archived} onChanged={onChanged} />
      )) : (
        <section className={CARD} data-testid="comparisons-empty">
          <strong className="text-axal-ink dark:text-white">No comparisons yet</strong>
          <p className={MUTED}>Tick two or more companies or funds above and press Compare, or select them in Companies and press Compare there.</p>
        </section>
      )}
    </div>
  );
}

export default ProjectComparisons;
