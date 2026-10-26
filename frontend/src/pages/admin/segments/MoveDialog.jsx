import React, { useEffect, useState } from 'react';
import { personaSegmentsApi } from '../../../lib/api/personaSegments';
import { reportError } from '../../../lib/log';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import { moveView, profileWord } from './segmentPageModel';

/**
 * D1005 (#2820) — SEG4, the Move dialog, shared: a segment's Members tab opens
 * it for one member (the row's ⋯) or for those selected (the move bar), and
 * #2377's account drawer opens it from "Retag…" when that drawer is built.
 *
 * It says what changes before anything is saved, by D1002's move
 * (`POST /api/personas/admin/members/move`):
 *   - NOW: the member's segment, how it was set and, for a suggestion at
 *     sign-up, how sure it was;
 *   - NEW SEGMENT: every segment that takes members, by profile; a retired
 *     one is listed, unchosen, with why;
 *   - the same segment: "Already in [it]. Nothing to change.", with no Move;
 *   - a profile the segment is not for, said before the move;
 *   - an admin account for an Admin: "Only a super admin can move an admin
 *     account.", with Close only (the Worker refuses it too).
 * The move answers each member's outcome, which `onMoved(reply, target)`
 * puts in words; a refusal stays in the dialog. Never a browser pop-up.
 *
 * `members`: `{ user_id, name, email, profile, is_admin?, segment: { key, name } | null, howSet?, confidence? }`.
 */

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SEC = 'flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3.5 py-3 dark:border-gray-700';
const FIELD = 'h-10 w-full rounded-[8px] border border-axal-hairline bg-white px-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

function useSegments() {
  const [read, setRead] = useState({ status: 'loading', segments: [] });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading', segments: [] });
    personaSegmentsApi.segmentProfiles().then(
      (d) => { if (live) setRead(Array.isArray(d?.segments) ? { status: 'ready', segments: d.segments } : { status: 'error', segments: [] }); },
      (e) => { reportError('persona-segments:move-segments', e); if (live) setRead({ status: 'error', segments: [] }); },
    );
    return () => { live = false; };
  }, [tick]);
  return { ...read, retry: () => setTick((t) => t + 1) };
}

export default function MoveDialog({ members, superAdmin = false, onClose, onMoved, testId = 'seg-move-dialog' }) {
  const segs = useSegments();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const target = segs.segments.find((s) => s.key === key) || null;
  const v = moveView({ members, target, superAdmin });
  const close = () => { if (!busy) onClose(); };
  const move = async () => {
    setBusy(true); setRefusal(null);
    try {
      const reply = await personaSegmentsApi.moveMembers(members.map((m) => m.user_id), target.key);
      onMoved(reply, target);
    } catch (e) {
      setRefusal(e?.data?.detail || e?.message || 'The move did not go through. Nothing changed. Try again.');
    } finally { setBusy(false); }
  };
  const groups = ['founder', 'investor', 'advisor', 'partner', 'exploring', 'any']
    .map((role) => ({ role, label: profileWord(role), items: segs.segments.filter((s) => s.profile === role) }))
    .filter((g) => g.items.length);

  const footer = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={actionGhost} onClick={close} data-testid={`${testId}-cancel`}>{v.blocked ? 'Close' : 'Cancel'}</button>
        {!v.blocked && v.canMove ? (
          <button type="button" className={actionPrimary} onClick={move} disabled={busy} data-testid={`${testId}-go`}>{busy ? 'Moving…' : 'Move'}</button>
        ) : null}
      </div>
      {refusal ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid={`${testId}-refusal`}>{refusal}</p> : null}
    </div>
  );

  return (
    <Lightbox phone="sheet" label={v.title} title={v.title} onClose={close} testId={testId} footer={footer}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {v.blocked ? (
          <p role="alert" className="m-0 flex gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" data-testid={`${testId}-admin`}>
            <span aria-hidden="true">!</span>{v.blocked}
          </p>
        ) : (
          <>
            <div className={SEC}>
              <span className={EYE}>Now</span>
              <span className="font-mono text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid={`${testId}-now`}>{v.now}</span>
            </div>
            <label className={SEC}>
              <span className={EYE}>New segment</span>
              {segs.status === 'loading' ? <span className="font-mono text-[12px] text-axal-muted">Reading the segments…</span> : null}
              {segs.status === 'error' ? (
                <span role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid={`${testId}-segments-failed`}>
                  The segments could not be read. Nothing can be moved until they are.
                  <button type="button" className={actionGhost} onClick={segs.retry}>Try again</button>
                </span>
              ) : null}
              {segs.status === 'ready' ? (
                <select value={key} onChange={(e) => { setKey(e.target.value); setRefusal(null); }} className={FIELD} data-testid={`${testId}-target`}>
                  <option value="">Choose a segment</option>
                  {groups.map((g) => (
                    <optgroup key={g.role} label={g.label}>
                      {g.items.map((s) => <option key={s.key} value={s.key} disabled={s.status === 'retired'}>{s.status === 'retired' ? `${s.name} (retired)` : s.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              ) : null}
              {v.same ? <span className="text-[12.5px] font-bold text-amber-800 dark:text-amber-300" data-testid={`${testId}-same`}>{v.same}</span> : null}
              {v.refusal ? <span className="text-[12.5px] font-bold text-red-700 dark:text-red-300" data-testid={`${testId}-retired`}>{v.refusal}</span> : null}
            </label>
            {v.canMove && v.info ? (
              <p className={`m-0 rounded-[10px] border px-3.5 py-2.5 text-[12.5px] leading-normal ${v.differs ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'border-axal-hairline bg-axal-ground text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'}`} data-testid={`${testId}-info`}>{v.info}</p>
            ) : null}
            {v.canMove ? (
              <div className={SEC}>
                <span className={EYE}>What changes</span>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-normal text-axal-ink marker:text-axal-violet dark:text-gray-100" data-testid={`${testId}-changes`}>
                  {v.changes.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Lightbox>
  );
}
