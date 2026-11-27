// #5871 (D3724 gap 13, D5871, NE1): the editor's join link with "Create the
// meeting for me · Google Meet". The typed link works as before; the press
// asks the next Save for a Meet link made on the host's own Google account.
// A refusal is the Worker's sentence, with Connect Google when that is the
// fix, and leaves the typed link to use. Zoom is words, not a button.
import React from 'react';
import { Link } from 'react-router-dom';
import { CONNECT_HREF, MEET_WORDS, meetOffered } from './eventMeetModel';

const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-200';
const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60';
const pressCls = 'inline-flex min-h-[36px] items-center rounded-lg border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700';
const noteCls = 'text-xs text-gray-500 dark:text-gray-400';

/**
 * `meet` is `{ state: 'idle' | 'asked' | 'made' | 'refused', refusal? }`;
 * `onMeet(next)` sets it. Nothing here calls the Worker: the Save does.
 */
export default function EventMeetField({ locationKind, value, onChange, meet, onMeet, busy }) {
  const offered = meetOffered(locationKind);
  const asked = offered && meet.state === 'asked';
  return (
    <div data-testid="event-meet-field">
      <label className={labelCls} htmlFor="event-join-link">Join link</label>
      <input id="event-join-link" className={inputCls} value={asked ? '' : value} disabled={asked}
        onChange={(e) => onChange(e.target.value)} placeholder={asked ? 'Made when you save' : 'Paste a meeting link'}
        data-testid="event-join-link" />
      {offered && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {asked
            ? <>
              <span role="status" className={noteCls} data-testid="event-meet-asked">{MEET_WORDS.asked}</span>
              <button type="button" className={pressCls} disabled={busy} onClick={() => onMeet({ state: 'idle' })} data-testid="event-meet-undo">{MEET_WORDS.undo}</button>
            </>
            : <button type="button" className={pressCls} disabled={busy} onClick={() => onMeet({ state: 'asked' })} data-testid="event-meet-press">{MEET_WORDS.press}</button>}
          <span className={noteCls} data-testid="event-meet-zoom">{MEET_WORDS.zoom}</span>
        </div>
      )}
      {offered && meet.state === 'made' && <p role="status" className={`mt-1.5 ${noteCls}`} data-testid="event-meet-made">{MEET_WORDS.made}</p>}
      {offered && meet.state === 'refused' && meet.refusal && (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-red-700 dark:text-red-300" data-testid="event-meet-refused">
          {meet.refusal.text}
          {meet.refusal.connect && <> <Link to={CONNECT_HREF} className="underline text-violet-700 dark:text-violet-300" data-testid="event-meet-connect">{MEET_WORDS.connect}</Link></>}
        </p>
      )}
    </div>
  );
}
