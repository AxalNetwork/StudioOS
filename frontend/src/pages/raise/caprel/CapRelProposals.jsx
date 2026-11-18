import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { capitalRelationshipsApi } from '../../../lib/api/capitalRelationships';
import { railProposalsApi } from '../../../lib/api/railProposals';
import { Unreadable } from '../../../ui';
import { ACCEPT_ALL_MAX, PROPOSABLE, patternView, proposalGroups, proposalLine } from './capRelTabsModel';
import { answerItHref } from '../narrative/narrativeModel';
import { runRefusal } from '../narrative/storyModel';
import { ADD_TOKENS_PATH } from '../../../lib/aiTokens';
import Sheet from '../../../ui/Sheet.jsx';
import { userFacingRaiseError } from '../../../lib/raiseErrors.js';

/**
 * D1193 (#3127, CRL11) — Eadwyn's proposals: next steps and stage moves from
 * a logged note, each beside the words it came from. Eadwyn proposes; a
 * person accepts, edits or dismisses each one, and Accept writes through the
 * one prospect writer (`…/proposals/:uid/accept`). Eadwyn never proposes an
 * amount, a status, a Fit, or a move to Committed or Passed.
 *
 * CRL11 (#6080): "From feedback across investors" is one Eadwyn run over the
 * feedback recorded on each investor. It names up to three things several
 * investors said, each with the investors and the words it came from, and
 * links to the Investor narrative objection those words already are. It
 * writes nothing.
 */

const MUTED = 'text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const FIELD = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const BTN = 'inline-flex min-h-[32px] items-center justify-center rounded-lg border px-2.5 text-[12px] font-semibold disabled:opacity-50';
const BTN_S = `${BTN} border-axal-hairline bg-white text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const BTN_P = `${BTN} border-axal-violet bg-axal-violet text-white hover:bg-violet-700 dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-500`;
const EADWYN = 'flex h-6 w-6 flex-none items-center justify-center rounded-full bg-axal-violet text-[11px] font-extrabold text-white dark:bg-violet-600';

/** CRL11 (#6080): what several investors said in common, read by one Eadwyn run that writes nothing. */
function FeedbackPattern({ projectId }) {
  const [run, setRun] = useState({ busy: false, view: null, refusal: null });
  const go = async () => {
    setRun({ busy: true, view: null, refusal: null });
    try {
      const answer = await capitalRelationshipsApi.feedbackPattern(projectId);
      setRun({ busy: false, view: patternView(answer, (key) => answerItHref(key, `?project_id=${projectId}`)), refusal: null });
    } catch (e) { setRun({ busy: false, view: null, refusal: runRefusal(e) }); }
  };
  const v = run.view;
  return (
    <section className="flex flex-col gap-2" data-testid="caprel-proposals-pattern">
      <h4 className={`m-0 text-[10.5px] font-extrabold uppercase tracking-wide ${MUTED}`}>From feedback across investors</h4>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>Eadwyn reads the feedback recorded on each investor and names what several of them said. Nothing is saved.</p>
      <button type="button" className={`${BTN_S} w-fit`} disabled={run.busy} onClick={go} data-testid="caprel-pattern-run">{run.busy ? 'Reading the feedback…' : v ? 'Read it again' : 'Find a pattern'}</button>
      {run.refusal ? (
        <div role="alert" className={`flex flex-col gap-1 rounded-[10px] border p-3 ${run.refusal.kind === 'tokens' ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30' : 'border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-800'}`} data-testid={`caprel-pattern-refused-${run.refusal.kind}`}>
          <span className={`text-[13px] font-semibold ${INK}`}>{run.refusal.text}</span>
          {run.refusal.sub ? <span className={`text-[12px] ${MUTED}`}>{run.refusal.sub}</span> : null}
          {run.refusal.kind === 'tokens' ? <Link to={ADD_TOKENS_PATH} className={`${BTN_S} mt-1 w-fit`} data-testid="caprel-pattern-topup">Top up AI tokens</Link> : null}
        </div>
      ) : null}
      {v && v.state !== 'ok' ? <p className={`m-0 text-[12.5px] ${INK}`} data-testid={`caprel-pattern-${v.state}`}>{v.line}</p> : null}
      {v && v.state === 'ok' ? (
        <div className="flex flex-col gap-2" data-testid="caprel-pattern-themes">
          {v.themes.map((t) => (
            <div key={t.key} className="flex flex-col gap-1.5 rounded-[10px] border border-violet-200 bg-axal-lavender p-3 dark:border-violet-900 dark:bg-violet-950/30" data-testid="caprel-pattern-theme">
              <div className="flex items-start gap-2.5">
                <span className={EADWYN} aria-hidden="true">E</span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className={`text-[13px] font-bold leading-snug ${INK}`}>{t.title}</span>
                  {t.summary ? <span className={`text-[12.5px] ${INK}`}>{t.summary}</span> : null}
                </div>
              </div>
              <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={`Where “${t.title}” comes from`}>
                {t.sources.map((src) => <li key={src.key} className={`text-[12px] ${MUTED}`} data-testid="caprel-pattern-source">{src.investor}: “{src.words}”</li>)}
              </ul>
              {t.objection ? <Link to={t.objection.href} className="w-fit text-[12px] font-semibold text-axal-violet underline-offset-2 hover:underline dark:text-violet-300" data-testid="caprel-pattern-objection">Open it in Investor narrative’s objections ›</Link> : null}
            </div>
          ))}
          <p className={`m-0 text-[11.5px] ${MUTED}`}>{v.line}</p>
        </div>
      ) : null}
    </section>
  );
}

/** One proposal: Accept, Edit (then Accept as edited) or Dismiss, each saying what it changes. */
function Proposal({ projectId, p, onDecided }) {
  const [mode, setMode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(p.payload.type === 'next_step' ? { text: p.payload.text || '', due: p.payload.due || '' } : { to: p.payload.to || 'meeting' });
  const go = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); setBusy(false); setMode(''); onDecided?.(); } catch (e) { setBusy(false); setError(userFacingRaiseError(e, { fallback: 'That could not be saved' })); }
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
    catch (e) { setRun({ busy: false, error: userFacingRaiseError(e, { fallback: 'Eadwyn could not read that note just now. Try again.' }) }); }
  };
  const acceptAll = async (group) => {
    setAll({ busy: true, failed: 0, open: '' });
    // D5073: one request for the whole note, one result per proposal. A refusal on one (no longer open) is counted
    // and the rest are written; a request that fails as a whole counts every proposal as not accepted.
    const uids = group.items.slice(0, ACCEPT_ALL_MAX).map((p) => p.uid);
    let failed = uids.length;
    try {
      const out = await capitalRelationshipsApi.acceptProposals(projectId, uids);
      failed = Array.isArray(out?.results) ? out.results.filter((r) => r.ok !== true).length : uids.length;
    } catch { /* the whole request failed: every proposal stays counted as not accepted */ }
    setAll({ busy: false, failed, open: '' });
    reload();
  };
  const groups = proposalGroups(read.data?.proposals || []).filter((g) => !prospect || Number(g.prospect_id) === Number(prospect.id));
  return (
    <Sheet label="Eadwyn’s proposals" testId="caprel-proposals" onClose={onClose} width={620} eyebrow="Eadwyn · proposals"
      title="From your notes and feedback" sub="Eadwyn proposes next steps and stage moves. You accept each one; nothing changes until you do.">
      <div className="flex flex-col gap-4">
        {prospect ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN_P} onClick={ask} disabled={run.busy} data-testid="caprel-proposals-ask">{run.busy ? 'Reading your note…' : `Propose next steps for ${prospect.name}`}</button>
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
        <FeedbackPattern projectId={projectId} />
        <p className={`m-0 text-[11.5px] ${MUTED}`}>Eadwyn proposes only. It never sets an amount, a status or a Fit, and never moves anyone to Committed or Passed.</p>
      </div>
    </Sheet>
  );
}
