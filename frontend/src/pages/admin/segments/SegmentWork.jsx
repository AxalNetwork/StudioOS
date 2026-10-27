import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { personaSegmentsApi } from '../../../lib/api/personaSegments';
import { reportError } from '../../../lib/log';
import { Lightbox, actionGhost } from '../../../ui';
import MoveDialog from './MoveDialog';
import { PROFILES } from './segModel';
import { ACTIVE, movedLine, rangeText } from './segmentPageModel';
import {
  STATUSES, SUGGEST_KINDS, WHY, askView, askedLine, declineProblem, editChanges, editDraftOf, editProblem,
  suggestBody, suggestProblem, suggestionRow, unclassifiedParams, unclassifiedRow, whyBars, whySummary,
} from './segmentWorkModel';

/**
 * D1006 (#2821, part 9 of #2378) — Unclassified (SEG5), Edit segment and
 * Suggest a change (SEG6), Suggestions (SEG7) and the page-wide Activity
 * (SEG8)'s suggestions. The rules are `segmentWorkModel.js`.
 *
 * Every change opens an in-page dialog that says what it changes; nothing
 * here opens a browser pop-up. A block whose read failed says so with its
 * own Try again, never as zeros. Names appear only in Unclassified's list;
 * what a member answered is never shown.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';
const CONTROL = 'h-9 rounded-[7px] border border-axal-hairline bg-white px-2.5 text-[12.5px] text-axal-ink max-sm:h-11 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const INPUT = 'min-h-[44px] w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[36px]';
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const SECONDARY = `${BTN} border border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100`;
const AMBER = 'text-[12.5px] font-semibold text-amber-800 dark:text-amber-300';

/** One read, alone: `{ status, data }`, read again by `retry`. */
function useRead(load, deps) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading', data: null }));
    Promise.resolve().then(load).then(
      (data) => { if (live) setState({ status: 'ready', data }); },
      (e) => { reportError('persona-segments:work', e); if (live) setState({ status: 'error', data: null, error: e }); },
    );
    return () => { live = false; };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, retry: () => setTick((t) => t + 1) };
}

function Failed({ what, onRetry, id }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2" data-testid={`seg-${id}-failed`}>
      <span className={AMBER}>{what} could not be read. That is not the same as none.</span>
      <button type="button" className={actionGhost} onClick={onRetry}>Try again</button>
    </div>
  );
}

function Dialog({ title, sub, onClose, children, footer, testId }) {
  return <Lightbox label={title} title={title} sub={sub} onClose={onClose} width={620} phone="sheet" testId={testId} footer={footer}>{children}</Lightbox>;
}

/* ------------------------------------------------------------------ *
 * SEG5: Unclassified
 * ------------------------------------------------------------------ */

function AskDialog({ rows, onClose, onAsked }) {
  const v = askView(rows);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true); setErr('');
    try { onAsked(askedLine(await personaSegmentsApi.askToFinish(rows.map((r) => r.user_id)))); onClose(); } catch (e) { setErr(e?.message || 'The notices could not be sent. Nothing was sent.'); setBusy(false); }
  };
  return (
    <Dialog title={v.title} onClose={onClose} testId="seg-ask-dialog"
      footer={<div className="flex flex-wrap justify-end gap-2"><button type="button" className={SECONDARY} onClick={onClose}>Cancel</button><button type="button" className={PRIMARY} disabled={busy || !v.canSend} onClick={send} data-testid="seg-ask-send">{busy ? 'Sending…' : v.send}</button></div>}>
      <p className="m-0 text-[13px] leading-[1.55] text-axal-ink dark:text-gray-100" data-testid="seg-ask-notice">{v.notice}</p>
      <p className="m-0 mt-2 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="seg-ask-rule">{v.rule}</p>
      {err ? <p role="alert" className={`mt-2 ${AMBER}`}>{err}</p> : null}
    </Dialog>
  );
}

export function UnclassifiedTab({ superAdmin }) {
  const [f, setF] = useState({ why: '', q: '', profile: '', active: '', sort: 'joined', page: 1 });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }));
  const read = useRead(() => personaSegmentsApi.members(unclassifiedParams(f)), [f.why, f.q, f.profile, f.active, f.sort, f.page]);
  const [picked, setPicked] = useState({});
  const [dialog, setDialog] = useState(null);
  const [done, setDone] = useState('');
  const rows = read.status === 'ready' && Array.isArray(read.data?.rows) ? read.data.rows : null;
  const bars = read.status === 'ready' ? whyBars(read.data) : null;
  const chosen = (rows || []).filter((r) => picked[r.user_id]);
  const pages = read.data ? Math.max(1, Math.ceil((Number(read.data.total) || 0) / (Number(read.data.page_size) || 25))) : 1;
  const finish = (line) => { setDone(line); setPicked({}); read.retry(); };

  return (
    <div className="flex flex-col gap-4" data-testid="seg-unclassified">
      <section className={`${CARD} flex flex-col gap-2 px-[18px] py-4`} data-testid="seg-why">
        <h2 className={H2}>Why they have no segment</h2>
        {read.status === 'loading' && !bars ? <span className={`${MONO} text-[12px] text-axal-muted`}>Reading…</span> : null}
        {read.status === 'error' ? <Failed what="Members with no segment" onRetry={read.retry} id="why" /> : null}
        {bars ? (
          <>
            {bars.map((b) => (
              <button key={b.key} type="button" onClick={() => set('why')(f.why === b.key ? '' : b.key)} aria-pressed={f.why === b.key ? 'true' : 'false'}
                className="grid min-h-[44px] grid-cols-[minmax(0,230px)_minmax(0,1fr)_56px] items-center gap-2.5 text-left text-[12.5px] text-axal-ink dark:text-gray-100 sm:min-h-[32px]" data-testid={`seg-why-${b.key}`}>
                <span className={f.why === b.key ? 'font-bold' : ''}>{b.label}</span>
                <span className="h-2.5 rounded-full bg-axal-hairline dark:bg-gray-800">{b.n === null ? <span className="block h-full w-full rounded-full border border-dashed border-axal-muted" /> : <span className="block h-full rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${Math.max(2, b.pct)}%` }} />}</span>
                <span className={`${MONO} text-right ${b.n === null ? 'text-axal-muted' : ''}`}>{b.text}</span>
              </button>
            ))}
            <span className={SUB} data-testid="seg-why-summary">{whySummary(read.data)}</span>
          </>
        ) : null}
      </section>

      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="seg-h-unc-list">
        <h2 id="seg-h-unc-list" className={H2}>Members with no segment</h2>
        <span className={SUB}>Ask them to finish their profile, or place them yourself.</span>
        {done ? <p role="status" className="m-0 text-[12.5px] font-semibold text-emerald-800 dark:text-emerald-300" data-testid="seg-unc-done">{done}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <label><span className="sr-only">Search name or email</span>
            <input type="search" value={f.q} onChange={(e) => set('q')(e.target.value)} placeholder="Search name or email" className={`${CONTROL} w-[240px]`} data-testid="seg-unc-search" /></label>
          <label><span className="sr-only">Profile</span>
            <select className={CONTROL} value={f.profile} onChange={(e) => set('profile')(e.target.value)} data-testid="seg-unc-profile">
              <option value="">Profile: all</option>{PROFILES.map((p) => <option key={p.role} value={p.role}>{p.label}</option>)}
            </select></label>
          <label><span className="sr-only">Sign-up chat</span>
            <select className={CONTROL} value={f.why} onChange={(e) => set('why')(e.target.value)} data-testid="seg-unc-chat">
              <option value="">Sign-up chat: all</option>{WHY.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
            </select></label>
          <label><span className="sr-only">Last active</span>
            <select className={CONTROL} value={f.active} onChange={(e) => set('active')(e.target.value)}>
              <option value="">Last active: any</option>{ACTIVE.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select></label>
          <label><span className="sr-only">Sort</span>
            <select className={CONTROL} value={f.sort} onChange={(e) => set('sort')(e.target.value)}>
              <option value="joined">Sort: Joined, newest first</option><option value="last_active">Sort: Last active</option><option value="name">Sort: Name, A to Z</option>
            </select></label>
        </div>
        {chosen.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-violet-200 bg-violet-50 px-3.5 py-2.5 dark:border-violet-800 dark:bg-violet-950/30" data-testid="seg-unc-bar">
            <span className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">{chosen.length} selected</span>
            <button type="button" className={PRIMARY} onClick={() => setDialog('ask')} data-testid="seg-unc-ask">Ask to finish their profile</button>
            <button type="button" className={SECONDARY} onClick={() => setDialog('place')} data-testid="seg-unc-place">Place in a segment…</button>
            <button type="button" className={actionGhost} onClick={() => setPicked({})}>Clear</button>
          </div>
        ) : null}
        {read.status === 'error' ? <Failed what="The list" onRetry={read.retry} id="unc-list" /> : null}
        {rows ? (rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-[12.5px]">
              <thead><tr className={EYE}>
                <th scope="col" className="w-8 py-1.5"><span className="sr-only">Select</span></th>
                <th scope="col" className="py-1.5 pr-3">Member</th><th scope="col" className="py-1.5 pr-3">Profile</th>
                <th scope="col" className="py-1.5 pr-3">Joined</th><th scope="col" className="py-1.5 pr-3">Last active</th><th scope="col" className="py-1.5 pr-3">Sign-up chat</th>
              </tr></thead>
              <tbody>
                {rows.map((m) => {
                  const r = unclassifiedRow(m);
                  return (
                    <tr key={r.id} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid={`seg-unc-row-${r.id}`}>
                      <td className="py-2"><input type="checkbox" className="h-5 w-5" checked={!!picked[r.id]} onChange={() => setPicked((p) => ({ ...p, [r.id]: !p[r.id] }))} aria-label={`Select ${r.name}`} data-testid={`seg-unc-pick-${r.id}`} /></td>
                      <td className="py-2 pr-3"><span className="block font-bold text-axal-ink dark:text-gray-100">{r.name}</span>{r.email ? <span className={`block ${SUB}`}>{r.email}</span> : null}</td>
                      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{r.profile}</td>
                      <td className={`py-2 pr-3 ${MONO}`}>{r.joined}</td>
                      <td className={`py-2 pr-3 ${MONO}`}>{r.lastActive}</td>
                      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{r.chat}{r.asked ? <span className={`block ${SUB}`}>{r.asked}</span> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className={`m-0 ${SUB}`} data-testid="seg-unc-none">{f.q || f.profile || f.why || f.active ? 'No member matches. Clear the filters.' : 'Every member has a segment.'}</p>) : null}
        {rows ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`}>{rangeText(read.data)}</span>
            <button type="button" className={actionGhost} disabled={f.page <= 1} onClick={() => set('page')(f.page - 1)}>Previous</button>
            <button type="button" className={actionGhost} disabled={f.page >= pages} onClick={() => set('page')(f.page + 1)}>Next</button>
          </div>
        ) : null}
        {Array.isArray(read.data?.unreadable) && read.data.unreadable.length ? <span className={AMBER} data-testid="seg-unc-partial">Some columns could not be read and say Not recorded.</span> : null}
      </section>
      {dialog === 'ask' ? <AskDialog rows={chosen} onClose={() => setDialog(null)} onAsked={finish} /> : null}
      {dialog === 'place' ? <MoveDialog members={chosen.map((m) => unclassifiedRow(m).member)} superAdmin={superAdmin} onClose={() => setDialog(null)} onMoved={(reply, target) => { setDialog(null); finish(movedLine(reply, target?.name).text); }} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * SEG6: Edit segment (Super Admin) and Suggest a change (Admin)
 * ------------------------------------------------------------------ */

export function EditSegmentDialog({ segment, seed = null, onClose, onSaved }) {
  const [d, setD] = useState(() => {
    const base = editDraftOf(segment);
    if (seed?.field === 'who' && seed.text) base.who = seed.text;
    if (seed?.field === 'needs' && seed.text) base.needs = [base.needs, seed.text].filter(Boolean).join('\n');
    return base;
  });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const change = useMemo(() => editChanges(segment, d), [segment, d]);
  const problem = editProblem(d);
  const field = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setErr('');
    try { onSaved(await personaSegmentsApi.saveSegmentProfile(segment.key, change.body)); onClose(); } catch (e) { setErr(e?.message || 'The segment could not be saved. Nothing was changed.'); setBusy(false); }
  };
  if (confirm) {
    return (
      <Dialog title={`Save changes to ${segment.name}?`} sub="These changes apply to every studio." onClose={() => setConfirm(false)} testId="seg-edit-confirm"
        footer={<div className="flex flex-wrap justify-end gap-2"><button type="button" className={SECONDARY} onClick={() => setConfirm(false)}>Back</button><button type="button" className={PRIMARY} disabled={busy} onClick={save} data-testid="seg-edit-save">{busy ? 'Saving…' : 'Save'}</button></div>}>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] text-axal-ink dark:text-gray-100" data-testid="seg-edit-changes">{change.say.map((s) => <li key={s}>{s}</li>)}</ul>
        {err ? <p role="alert" className={`mt-2 ${AMBER}`} data-testid="seg-edit-error">{err}</p> : null}
      </Dialog>
    );
  }
  return (
    <Dialog title={`Edit ${segment.name}`} sub="HQ writes the segment profiles. Questions and sidebar links are set in code." onClose={onClose} testId="seg-edit"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={SUB}>Changes apply to every studio.</span>
          <button type="button" className={SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY} disabled={!!problem || !change.body} onClick={() => setConfirm(true)} data-testid="seg-edit-next">Save changes</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <label className={EYE}>Name<input className={INPUT} value={d.name} onChange={field('name')} data-testid="seg-edit-name" /></label>
        <fieldset className="m-0 border-0 p-0"><legend className={EYE}>Status</legend>
          <div className="flex flex-wrap gap-2">{STATUSES.map((s) => (
            <label key={s.key} className="flex min-h-[44px] items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100"><input type="radio" name="seg-edit-status" checked={d.status === s.key} onChange={() => setD((x) => ({ ...x, status: s.key }))} data-testid={`seg-edit-status-${s.key}`} />{s.label}<span className={SUB}>{s.line}</span></label>
          ))}</div>
        </fieldset>
        <label className={EYE}>Who they are<textarea className={INPUT} rows={3} value={d.who} onChange={field('who')} data-testid="seg-edit-who" /><span className={`${MONO} text-[11px]`}>{d.who.length} / 280</span></label>
        <label className={EYE}>The typical member, one line each<textarea className={INPUT} rows={3} value={d.typical} onChange={field('typical')} /></label>
        <label className={EYE}>Needs, one line each, in order<textarea className={INPUT} rows={4} value={d.needs} onChange={field('needs')} data-testid="seg-edit-needs" /><span className={SUB}>A kept need keeps what answers it. A new one starts with nothing answering it.</span></label>
        <label className={EYE}>Why, for the activity (optional)<input className={INPUT} value={d.reason} onChange={field('reason')} /></label>
        {problem ? <p className={AMBER} data-testid="seg-edit-problem">{problem}</p> : !change.body ? <p className={SUB}>Nothing has changed yet.</p> : null}
      </div>
    </Dialog>
  );
}

export function SuggestChangeDialog({ segments = [], segmentKey = '', onClose, onSent }) {
  const [s, setS] = useState({ segment_key: segmentKey, kind: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const problem = suggestProblem(s);
  const send = async () => {
    setBusy(true); setErr('');
    try { await personaSegmentsApi.suggestSegmentChange(suggestBody(s)); onSent('Sent to HQ. HQ answers on the Activity tab.'); onClose(); } catch (e) { setErr(e?.message || 'The suggestion could not be sent. Nothing was sent.'); setBusy(false); }
  };
  return (
    <Dialog title="Suggest a change" sub="HQ answers on the Activity tab." onClose={onClose} testId="seg-suggest"
      footer={<div className="flex flex-wrap justify-end gap-2"><button type="button" className={SECONDARY} onClick={onClose}>Cancel</button><button type="button" className={PRIMARY} disabled={busy || !!problem} onClick={send} data-testid="seg-suggest-send">{busy ? 'Sending…' : 'Send to HQ'}</button></div>}>
      <div className="flex flex-col gap-3">
        {s.kind !== 'new_segment' ? (
          <label className={EYE}>Segment
            <select className={INPUT} value={s.segment_key} onChange={(e) => setS((x) => ({ ...x, segment_key: e.target.value }))} data-testid="seg-suggest-segment">
              <option value="">Pick a segment</option>{segments.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select></label>
        ) : null}
        <fieldset className="m-0 border-0 p-0"><legend className={EYE}>What should change?</legend>
          <div className="flex flex-wrap gap-2">{SUGGEST_KINDS.map((k) => (
            <button key={k.key} type="button" aria-pressed={s.kind === k.key ? 'true' : 'false'} onClick={() => setS((x) => ({ ...x, kind: k.key }))} data-testid={`seg-suggest-kind-${k.key}`}
              className={`min-h-[44px] rounded-full border px-3 text-[12.5px] font-semibold sm:min-h-[32px] ${s.kind === k.key ? 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-100' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100'}`}>{k.label}</button>
          ))}</div>
        </fieldset>
        <label className={EYE}>Describe the change<textarea className={INPUT} rows={4} maxLength={500} value={s.text} onChange={(e) => setS((x) => ({ ...x, text: e.target.value }))} data-testid="seg-suggest-text" /><span className={`${MONO} text-[11px]`}>{s.text.length} / 500</span></label>
        {s.text && problem ? <p className={AMBER}>{problem}</p> : null}
        {err ? <p role="alert" className={AMBER} data-testid="seg-suggest-error">{err}</p> : null}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * SEG7: Suggestions (Super Admin), and an Admin's own on Activity
 * ------------------------------------------------------------------ */

function DeclineDialog({ row, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const problem = declineProblem(reason);
  const go = async () => {
    setBusy(true); setErr('');
    try { await personaSegmentsApi.decideSegmentSuggestion(row.uid, { decision: 'decline', reason: reason.replace(/\s+/g, ' ').trim() }); onDone('Declined. The admin is told, with your line.'); onClose(); } catch (e) { setErr(e?.message || 'It could not be declined. Nothing was changed.'); setBusy(false); }
  };
  return (
    <Dialog title="Decline this suggestion?" sub={`${row.title}. The admin reads your line.`} onClose={onClose} testId="seg-decline"
      footer={<div className="flex flex-wrap justify-end gap-2"><button type="button" className={SECONDARY} onClick={onClose}>Cancel</button><button type="button" className={PRIMARY} disabled={busy || !!problem} onClick={go} data-testid="seg-decline-send">{busy ? 'Declining…' : 'Decline'}</button></div>}>
      <label className={EYE}>Why is it declined?<input className={INPUT} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="seg-decline-reason" /></label>
      {reason && problem ? <p className={AMBER}>{problem}</p> : null}
      {err ? <p role="alert" className={AMBER}>{err}</p> : null}
    </Dialog>
  );
}

/**
 * The suggestions list. HQ's Super Admin reads every one and decides; an
 * Admin reads their own, with HQ's answer. Accept opens Edit segment,
 * filled in from D1003's edit target; nothing changes until it is saved.
 */
export function SuggestionsList({ superAdmin, segments = [], onAcceptEdit, testId = 'seg-suggestions' }) {
  const [status, setStatus] = useState(superAdmin ? 'open' : '');
  const read = useRead(() => personaSegmentsApi.segmentSuggestions(status || undefined), [status]);
  const [declining, setDeclining] = useState(null);
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');
  const nameOf = (k) => segments.find((g) => g.key === k)?.name || k;
  const list = read.status === 'ready' && Array.isArray(read.data?.suggestions) ? read.data.suggestions : null;
  const accept = async (row) => {
    setErr('');
    try {
      const r = await personaSegmentsApi.decideSegmentSuggestion(row.uid, { decision: 'accept' });
      read.retry();
      if (r?.edit?.segment_key) onAcceptEdit(r.edit); else setDone(r?.edit?.new_segment ? 'Accepted. Create the segment with New segment.' : 'Accepted. The admin is told.');
    } catch (e) { setErr(e?.message || 'It could not be accepted. Nothing was changed.'); }
  };
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={H2}>{superAdmin ? 'Suggestions' : 'Your suggestions'}</h2>
        <label><span className="sr-only">Status</span>
          <select className={CONTROL} value={status} onChange={(e) => setStatus(e.target.value)} data-testid={`${testId}-status`}>
            <option value="">All</option><option value="open">Waiting for HQ</option><option value="accepted">Accepted</option><option value="declined">Declined</option>
          </select></label>
      </div>
      {superAdmin ? <span className={SUB}>Accept opens Edit segment, filled in. Decline asks for one line the admin will read.</span> : <span className={SUB}>HQ answers each one here.</span>}
      {done ? <p role="status" className="m-0 text-[12.5px] font-semibold text-emerald-800 dark:text-emerald-300" data-testid={`${testId}-done`}>{done}</p> : null}
      {err ? <p role="alert" className={AMBER}>{err}</p> : null}
      {read.status === 'loading' && !list ? <span className={`${MONO} text-[12px] text-axal-muted`}>Reading…</span> : null}
      {read.status === 'error' ? <Failed what="The suggestions" onRetry={read.retry} id={`${testId}-read`} /> : null}
      {list ? (list.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {list.map((s) => {
            const r = suggestionRow(s, nameOf);
            return (
              <li key={r.uid} className="flex flex-col gap-1 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-700" data-testid={`seg-suggestion-${r.uid}`}>
                <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.title}</span>
                <span className="text-[12.5px] text-axal-ink dark:text-gray-200">{r.text}</span>
                <span className={SUB}>{r.from} · {r.when} · {r.status}</span>
                {r.decline ? <span className={SUB}>{r.decline}</span> : null}
                {r.delivery ? <span className={AMBER}>{r.delivery}</span> : null}
                {superAdmin && r.open ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={SECONDARY} onClick={() => accept(s)} data-testid={`seg-accept-${r.uid}`}>Accept…</button>
                    <button type="button" className={SECONDARY} onClick={() => setDeclining(r)} data-testid={`seg-decline-${r.uid}`}>Decline…</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : <p className={`m-0 ${SUB}`} data-testid={`${testId}-none`}>{superAdmin ? 'No suggestion is waiting.' : 'You have not suggested a change yet.'}</p>) : null}
      {declining ? <DeclineDialog row={declining} onClose={() => setDeclining(null)} onDone={(line) => { setDone(line); read.retry(); }} /> : null}
    </section>
  );
}

/** The segment profiles, for the dialogs' segment pick and names. */
export function useSegmentProfiles() {
  const read = useRead(() => personaSegmentsApi.segmentProfiles(), []);
  return read.status === 'ready' && Array.isArray(read.data?.segments) ? read.data.segments : [];
}

/** Accept's edit target, opened as Edit segment on the segment's profile. */
export function AcceptedEdit({ edit, onClose, onSaved }) {
  const read = useRead(() => personaSegmentsApi.segmentProfile(edit.segment_key), [edit.segment_key]);
  if (read.status === 'error') {
    return (
      <Dialog title="Edit segment" onClose={onClose} testId="seg-accept-edit-failed">
        <Failed what="The segment" onRetry={read.retry} id="accept-edit" />
      </Dialog>
    );
  }
  if (read.status !== 'ready' || !read.data?.segment) return null;
  const seg = read.data.segment;
  if (edit.expected_version != null && seg.version !== edit.expected_version) {
    return (
      <Dialog title={`Edit ${seg.name}`} onClose={onClose} testId="seg-accept-edit-stale">
        <p className={AMBER}>The segment changed after this suggestion was read. Open it again from its page to edit the newest version.</p>
        <Link to={`/admin/persona-segments/${encodeURIComponent(seg.key)}`} className={actionGhost}>Open {seg.name}</Link>
      </Dialog>
    );
  }
  return <EditSegmentDialog segment={seg} seed={edit} onClose={onClose} onSaved={onSaved} />;
}
