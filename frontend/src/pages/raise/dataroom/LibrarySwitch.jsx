/**
 * D6913 part 2 (#6913, canvas RS-17 B) — Data room › Access: the founder's per-room switch, "Investors' own Ask".
 *
 * Scope is the card itself: what the switch allows and that it is off by default. Turning it off opens Review, which
 * lists what changes, with the Worker's own count of live copies (`live_references`); Turn off sends it, and Result
 * says how many copies lost their reach (the PUT's `lapsed`). Turning it on is one confirm. Only the room's owner
 * changes it (`can_change`); a co-founder reads it. Nothing here opens a file behind the NDA.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { roomLibraryApi } from '../../../lib/api/roomLibrary';
import { Unreadable } from '../../../ui';
import DataRoomDialog from './DataRoomDialog.jsx';
import {
  ON_RESULT, OWNER_ONLY, SWITCH_EXPLAINS, SWITCH_LINE, SWITCH_TITLE, offResult, offReview, switchError, switchState,
} from './librarySwitchModel';

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-[34px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

/** The switch's read: { state: loading | ready | unreadable, allow, live, canChange }. */
export function useLibrarySwitch(projectUid) {
  const [read, setRead] = useState({ state: 'loading' });
  const load = useCallback(async () => {
    if (!projectUid) return;
    try {
      const r = await roomLibraryApi.settings(projectUid);
      setRead({ state: 'ready', allow: r?.allow_library === true, live: Number.isInteger(r?.live_references) ? r.live_references : null, canChange: r?.can_change === true });
    } catch { setRead({ state: 'unreadable' }); }
  }, [projectUid]);
  useEffect(() => { load(); }, [load]);
  return { read, reload: load };
}

/** The card, pure in its props so the test draws every state. */
export function LibrarySwitchCard({ read, onTurn, said, onRetry }) {
  return (
    <section className={`${CARD} flex flex-col gap-1.5 px-4 py-3`} data-testid="access-library-switch">
      <h3 className={`m-0 text-[14px] font-extrabold ${INK}`}>{SWITCH_TITLE}</h3>
      {read?.state === 'unreadable' ? <Unreadable what="This switch" claim="This is not a claim that it is off." onRetry={onRetry} /> : null}
      {read?.state === 'loading' ? <p className={`m-0 text-[12.5px] ${MUTED}`}>Reading the switch…</p> : null}
      {read?.state === 'ready' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-[12.5px] font-semibold ${INK}`}>{SWITCH_LINE}</span>
            <span className={`text-[12.5px] font-bold ${read.allow ? 'text-emerald-700 dark:text-emerald-300' : MUTED}`} data-testid="library-switch-state">{switchState(read)}</span>
          </div>
          <p className={`m-0 text-[12.5px] ${MUTED}`}>{SWITCH_EXPLAINS}</p>
          {read.canChange ? (
            <div className="flex">
              <button type="button" className={BTN} onClick={() => onTurn(!read.allow)} data-testid="library-switch-turn">{read.allow ? 'Turn off' : 'Turn on'}</button>
            </div>
          ) : <p className={`m-0 text-[12px] ${MUTED}`} data-testid="library-switch-owner-only">{OWNER_ONLY}</p>}
        </>
      ) : null}
      {said ? <p role="status" className={`m-0 text-[12.5px] font-semibold ${INK}`} data-testid="library-switch-said">{said}</p> : null}
    </section>
  );
}

/** Review: what turning off (or on) changes, before anything is sent. */
export function LibrarySwitchReview({ to, live, projectUid, onClose, onDone }) {
  const copy = to
    ? { title: 'Turn on investors’ own Ask?', body: 'An investor you granted can add a file they can open to their Library, and their Ask can cite it while their grant is live.', action: 'Turn on' }
    : { title: 'Turn off investors’ own Ask?', body: 'Review what changes before you turn it off.', action: 'Turn off' };
  return (
    <DataRoomDialog testId="library-switch-review" copy={copy} danger={!to} refusalOf={switchError} onClose={onClose}
      onConfirm={async () => { const r = await roomLibraryApi.setAllowed(projectUid, to); onDone(to ? ON_RESULT : offResult(r)); }}>
      {to ? null : (
        <ul className="m-0 flex flex-col gap-1 pl-5 text-[12.5px]" data-testid="library-switch-review-lines">
          {offReview(live).map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
    </DataRoomDialog>
  );
}

export default function LibrarySwitch({ projectUid }) {
  const { read, reload } = useLibrarySwitch(projectUid);
  const [turning, setTurning] = useState(null);
  const [said, setSaid] = useState('');
  if (!projectUid) return null;
  return (
    <>
      <LibrarySwitchCard read={read} said={said} onRetry={reload} onTurn={(to) => { setSaid(''); setTurning({ to }); }} />
      {turning ? (
        <LibrarySwitchReview to={turning.to} live={read.live} projectUid={projectUid} onClose={() => setTurning(null)}
          onDone={(line) => { setTurning(null); setSaid(line); reload(); }} />
      ) : null}
    </>
  );
}
