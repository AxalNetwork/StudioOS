import { useEffect, useState } from 'react';
import { capitalRelationshipsApi } from '../../../lib/api/capitalRelationships';
import { railProposalsApi } from '../../../lib/api/railProposals';
import { Lightbox, Unreadable } from '../../../ui';
import { ACCEPT_ALL_MAX, PROPOSABLE, proposalGroups, proposalLine } from './capRelTabsModel';

/**
 * D1193 (#3127, CRL11) — Eadwyn's proposals: next steps and stage moves from
 * a logged note, each beside the words it came from. Eadwyn proposes; a
 * person accepts, edits or dismisses each one, and Accept writes through the
 * one prospect writer (`…/proposals/:uid/accept`). Eadwyn never proposes an
 * amount, a status, a Fit, or a move to Committed or Passed.
 *
 * "A pattern across feedback" is not read here yet: no read groups feedback
 * by theme across investors (D1193 §5).
 */

const MUTED = 'text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const FIELD = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const BTN = 'inline-flex min-h-[32px] items-center justify-center rounded-lg border px-2.5 text-[12px] font-semibold disabled:opacity-50';
const BTN_S = `${BTN} border-axal-hairline bg-white text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const BTN_P = `${BTN} border-axal-violet bg-axal-violet text-white hover:bg-violet-700 dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-500`;
const EADWYN = 'flex h-6 w-6 flex-none items-center justify-center rounded-full bg-axal-violet text-[11px] font-extrabold text-white dark:bg-violet-600';

/** One proposal: Accept, Edit (then Accept as edited) or Dismiss, each saying what it changes. */
function Proposal({ projectId, p, onDecided }) {
  const [mode, setMode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(p.payload.type === 'next_step' ? { text: p.payload.text || '', due: p.payload.due || '' } : { to: p.payload.to || 'meeting' });
  const go = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); setBusy(false); setMode(''); onDecided?.(); } catch (e) { setBusy(false); setError(e?.message || 'That could not be saved'); }
  };
  const confirmLine = mode === 'dismiss' ? 'This proposal is thrown away. Nothing changes.'
    : p.payload.type === 'next_step' ? `The next step with ${p.investor || 'this investor'} becomes “${mode === 'edit' ? edit.text : p.payload.text}”${(mode === 'edit' ? edit.due : p.payload.due) ? `, due ${mode === 'edit' ? edit.due : p.payload.due}` : ''}.`
      : `${p.investor || 'This investor'} moves to ${(mode === 'edit' ? PROPOSABLE.find((s) => s.value === edit.to) : PROPOSABLE.find((s) => s.value === p.payload.to))?.label}.`;
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-violet-200 bg-axal-lavender p-3 dark:border-violet-900 dark:bg-violet-950/30" data-testid="caprel-proposal">
      <div className="flex items-start gap-2.5">
        <span className={EADWYN} aria-hidden="true">E</span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={`text-[13px] font-bold leading-snug ${INK}`}>{proposalLine(p)}</span>
          <span className={`text-[12px] ${MUTED}`}>From: “{p.payload.quote}”</span>
        </div>
      </div>
      {mode === 'edit' ? (
        p.payload.type === 'next_step' ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_150px]">
            <input className={FIELD} aria-label="Next step" value={edit.text} maxLength={300} onChange={(e) => setEdit((x) => ({ ...x, text: e.target.value }))} data-testid="caprel-proposal-edit-text" />
            <input className={FIELD} aria-label="Due" type="date" value={edit.due} onChange={(e) => setEdit((x) => ({ ...x, due: e.target.value }))} />
          </div>
        ) : (
          <select className={FIELD} aria-label="Move to" value={edit.to} onChange={(e) => setEdit({ to: e.target.value })} data-testid="caprel-proposal-edit-to">
            {PROPOSABLE.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )
      ) : null}
      {mode ? <p className={`m-0 text-[12.5px] ${INK}`} data-testid="caprel-proposal-confirm">{confirmLine}</p> : null}
      {error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {!mode ? (
          <>
            <button type="button" className={BTN_S} onClick={() => setMode('accept')} data-testid="caprel-proposal-accept">Accept</button>
            <button type="button" className={BTN_S} onClick={() => setMode('edit')} data-testid="caprel-proposal-edit">Edit</button>
            <button type="button" className={BTN_S} onClick={() => setMode('dismiss')} data-testid="caprel-proposal-dismiss">Dismiss</button>
          </>
        ) : (
          <>
            <button type="button" className={BTN_P} disabled={busy || (mode === 'edit' && p.payload.type === 'next_step' && !edit.text.trim())} data-testid="caprel-proposal-go"
              onClick={() => go(() => (mode === 'dismiss' ? railProposalsApi.decide(p.uid, 'discard')
                : capitalRelationshipsApi.acceptProposal(projectId, p.uid, mode === 'edit' ? { ...edit, ...(p.payload.type === 'next_step' && !edit.due ? { due: null } : {}) } : null)))}>
              {busy ? 'Saving…' : mode === 'dismiss' ? 'Dismiss' : mode === 'edit' ? 'Accept as edited' : 'Accept'}
            </button>
            <button type="button" className={BTN_S} disabled={busy} onClick={() => setMode('')}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The panel: the caller's open proposals grouped by the note they came from.
 * With a `prospect`, Ask Eadwyn reads that investor's newest note first.
 */
export default function CapRelProposals({ projectId, prospect = null, onClose, onChanged }) {
  const [n, setN] = useState(0);
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [run, setRun] = useState({ busy: false, error: '' });
  const [all, setAll] = useState({ busy: false, failed: 0, open: '' });
  useEffect(() => {
    let alive = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    Promise.resolve().then(() => capitalRelationshipsApi.proposals(projectId))
      .then((data) => { if (alive) setRead({ status: 'ready', data }); })
      .catch(() => { if (alive) setRead({ status: 'unreadable', data: null }); });
    return () => { alive = false; };
  }, [projectId, n]);
  const reload = () => { setN((x) => x + 1); onChanged?.(); };
  const ask = async () => {
    setRun({ busy: true, error: '' });
    try { await capitalRelationshipsApi.proposeFromNote(projectId, { prospect_id: prospect.id }); setRun({ busy: false, error: '' }); reload(); }
    catch (e) { setRun({ busy: false, error: e?.message || 'Eadwyn could not read that note just now. Try again.' }); }
  };
  const acceptAll = async (group) => {
    setAll({ busy: true, failed: 0, open: '' });
    let failed = 0;
    for (const p of group.items.slice(0, ACCEPT_ALL_MAX)) {
      try { await capitalRelationshipsApi.acceptProposal(projectId, p.uid, null); } catch { failed += 1; }
    }
    setAll({ busy: false, failed, open: '' });
    reload();
  };
  const groups = proposalGroups(read.data?.proposals || []).filter((g) => !prospect || Number(g.prospect_id) === Number(prospect.id));
  return (
    <Lightbox label="Eadwyn’s proposals" testId="caprel-proposals" onClose={onClose} width={620} eyebrow="Eadwyn · proposals"
      title="From your notes and feedback" sub="Eadwyn proposes next steps and stage moves. You accept each one; nothing changes until you do.">
      <div className="flex flex-col gap-4">
        {prospect ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN_P} onClick={ask} disabled={run.busy} data-testid="caprel-proposals-ask">{run.busy ? 'Reading your note…' : `Ask Eadwyn about ${prospect.name}`}</button>
            <span className={`text-[12px] ${MUTED}`}>Reads your newest note on their timeline, once. It uses your AI allowance.</span>
          </div>
        ) : null}
        {run.error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="caprel-proposals-error">{run.error}</p> : null}
        {read.status === 'unreadable' ? <Unreadable what="Eadwyn’s proposals" claim="This is not a claim that there are none." onRetry={() => setN((x) => x + 1)} /> : null}
        {read.status === 'loading' && !read.data ? <div className="h-24 animate-pulse rounded-lg bg-axal-ground dark:bg-gray-800" /> : null}
        {read.data && !groups.length ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="caprel-proposals-none">No proposal is waiting{prospect ? ` for ${prospect.name}` : ''}.</p> : null}
        {groups.map((g) => (
          <section key={g.key} className="flex flex-col gap-2" data-testid="caprel-proposal-group">
            <h4 className={`m-0 text-[10.5px] font-extrabold uppercase tracking-wide ${MUTED}`}>From your note on {g.investor}{g.on ? ` · ${g.on}` : ''}</h4>
            {g.note ? <p className={`m-0 rounded-[10px] border border-axal-hairline bg-axal-ground px-3 py-2 text-[13px] leading-relaxed ${INK} dark:border-gray-800 dark:bg-gray-950`}>‘{g.note}’</p> : null}
            {g.items.map((p) => <Proposal key={p.uid} projectId={projectId} p={p} onDecided={reload} />)}
            {g.items.length > 1 ? (
              all.open === g.key ? (
                <div className="flex flex-wrap items-center gap-2" data-testid="caprel-proposals-all-confirm">
                  <span className={`text-[12.5px] ${INK}`}>Every proposal from this note is accepted, at most {ACCEPT_ALL_MAX} at a time.</span>
                  <button type="button" className={BTN_P} disabled={all.busy} onClick={() => acceptAll(g)} data-testid="caprel-proposals-all-go">{all.busy ? 'Saving…' : `Accept all ${g.items.length}`}</button>
                  <button type="button" className={BTN_S} disabled={all.busy} onClick={() => setAll((x) => ({ ...x, open: '' }))}>Cancel</button>
                </div>
              ) : <button type="button" className={`${BTN_S} w-fit`} onClick={() => setAll({ busy: false, failed: 0, open: g.key })} data-testid="caprel-proposals-all">Accept all {g.items.length}</button>
            ) : null}
          </section>
        ))}
        {all.failed ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300">{all.failed} could not be accepted. They are still listed.</p> : null}
        <section className="flex flex-col gap-1" data-testid="caprel-proposals-pattern">
          <h4 className={`m-0 text-[10.5px] font-extrabold uppercase tracking-wide ${MUTED}`}>From feedback across investors</h4>
          <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400">Not read here yet</span>
          <p className={`m-0 text-[12.5px] ${MUTED}`}>A pattern across investors’ feedback needs a read that groups it by theme. Each investor’s feedback is on their record.</p>
        </section>
        <p className={`m-0 text-[11.5px] ${MUTED}`}>Eadwyn proposes only. It never sets an amount, a status or a Fit, and never moves anyone to Committed or Passed.</p>
      </div>
    </Lightbox>
  );
}
