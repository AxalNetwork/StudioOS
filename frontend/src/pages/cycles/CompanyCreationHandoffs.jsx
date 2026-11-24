/**
 * D8260 (#8260, Build v2 BD25) — Company creation's two hand-offs, drawn on its page:
 *
 *   · Export filings and proofs, beside the filings table: the table as CSV with each proof's link
 *     (a link into the app, never a download token).
 *   · Add to Data room, under the Documents list: the four papers, the stored ones not yet in the
 *     room ticked, a missing one shown and not tickable. Add copies the ticked ones into the
 *     venture's data room under NDA, shared with nobody until the founder shares them.
 *
 * Both are the company's members only; the Worker refuses anyone else, and its sentence is shown.
 * Each control says what happened in words: nothing here is carried by colour alone.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { companyCreationHandoffsApi as handoffs } from '../../lib/api/companyCreationHandoffs.js';
import { ventureQuery } from './companyCreationModel.js';

const BUTTON = 'inline-flex min-h-[44px] items-center rounded-[10px] border border-axal-hairline px-3 py-2 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const MUTED = 'text-[12px] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300';

const words = (e, plain) => (e && typeof e.message === 'string' && e.message) || plain;

/** BD25: Export filings and proofs. `api` is injectable for tests. */
export function FilingsExport({ projectId, api = handoffs }) {
  const [state, setState] = useState({ busy: false, note: null });
  const run = async () => {
    setState({ busy: true, note: null });
    try {
      const out = await api.exportFilings(projectId);
      setState({ busy: false, note: `Exported ${out?.rows ?? 0} filing${out?.rows === 1 ? '' : 's'} with their proof links.` });
    } catch (e) {
      setState({ busy: false, note: words(e, 'The export did not run. Try again.') });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 px-1" data-testid="company-filings-export">
      <button type="button" className={BUTTON} onClick={run} disabled={state.busy} aria-busy={state.busy || undefined}>
        {state.busy ? 'Exporting…' : 'Export filings and proofs'}
      </button>
      {state.note && <span role="status" className={MUTED}>{state.note}</span>}
    </div>
  );
}

/** One paper's line: its tick, label and state in words. */
function PaperLine({ paper, checked, onToggle }) {
  const tickable = paper.state === 'Stored' && !paper.in_room;
  const note = paper.in_room ? 'Already in the data room' : paper.state === 'Stored' ? 'Stored' : paper.state === 'Missing' ? 'Missing: upload it on the company first' : 'Unreadable';
  return (
    <li className="flex items-center gap-2 py-1 text-[12.5px]">
      <input type="checkbox" id={`paper-${paper.kind}`} checked={tickable && checked} disabled={!tickable} onChange={onToggle} className="h-4 w-4" />
      <label htmlFor={`paper-${paper.kind}`} className="text-axal-ink dark:text-gray-100">{paper.label}</label>
      <span className={MUTED}>· {note}</span>
    </li>
  );
}

/**
 * BD25: Add to Data room, with the stored papers preselected. `initial` (the read) and `api` are
 * injectable for tests; without `initial` the read happens when the panel opens.
 */
export function PapersToDataRoom({ projectId, api = handoffs, initial = null }) {
  const [open, setOpen] = useState(!!initial);
  const [read, setRead] = useState(initial ? { state: 'ok', ...initial } : { state: 'idle' });
  const [picked, setPicked] = useState(() => new Set((initial?.papers || []).filter((p) => p.preselected).map((p) => p.kind)));
  const [result, setResult] = useState(null);
  const load = async () => {
    setOpen(true); setResult(null); setRead({ state: 'loading' });
    try {
      const out = await api.dataRoomPapers(projectId);
      setRead({ state: 'ok', ...out });
      setPicked(new Set((out?.papers || []).filter((p) => p.preselected).map((p) => p.kind)));
    } catch (e) {
      setRead({ state: 'refused', reason: words(e, 'The company’s papers could not be read. Try again.') });
    }
  };
  const add = async () => {
    setResult({ state: 'saving' });
    try {
      const out = await api.addToDataRoom(projectId, [...picked]);
      const n = (out?.added || []).length;
      setResult({ state: 'done', text: n ? `Added ${n} paper${n === 1 ? '' : 's'}. ${out.where}` : 'Nothing was added.', skipped: out?.skipped || [] });
      setRead((r) => ({ ...r, papers: (r.papers || []).map((p) => ((out?.added || []).some((a) => a.kind === p.kind) ? { ...p, in_room: true, preselected: false } : p)) }));
      setPicked(new Set());
    } catch (e) {
      setResult({ state: 'failed', text: words(e, 'The papers could not be added. Nothing was added.') });
    }
  };
  if (!open) {
    return <button type="button" className={BUTTON} onClick={load} data-testid="company-papers-to-room">Add to Data room</button>;
  }
  return (
    <section aria-label="Add papers to the data room" className="flex flex-col gap-2" data-testid="company-papers-room" data-state={read.state}>
      {read.state === 'loading' && <p className={MUTED} role="status">Reading the company’s papers…</p>}
      {read.state === 'refused' && <p className={MUTED} role="alert">{read.reason}</p>}
      {read.state === 'ok' && (
        <>
          <ul className="m-0 list-none p-0">
            {(read.papers || []).map((p) => (
              <PaperLine key={p.kind} paper={p} checked={picked.has(p.kind)}
                onToggle={() => setPicked((s) => { const n = new Set(s); if (n.has(p.kind)) n.delete(p.kind); else n.add(p.kind); return n; })} />
            ))}
          </ul>
          {read.can_add
            ? <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={BUTTON} onClick={add} disabled={!picked.size || result?.state === 'saving'} data-testid="company-papers-room-add">
                  {result?.state === 'saving' ? 'Adding…' : `Add ${picked.size} to Data room`}
                </button>
                <span className={MUTED}>Filed under NDA and shared with nobody until you share them.</span>
              </div>
            : <p className={MUTED}>{read.reason}</p>}
          {result?.text && <p role="status" className={MUTED}>{result.text} {result.state === 'done' && <Link to={`/raise/data-room${ventureQuery(projectId)}`} className={LINK}>Open Data room →</Link>}</p>}
          {(result?.skipped || []).map((s) => <p key={s.kind} className={MUTED}>{(read.papers || []).find((p) => p.kind === s.kind)?.label || s.kind}: {s.reason}</p>)}
        </>
      )}
    </section>
  );
}
