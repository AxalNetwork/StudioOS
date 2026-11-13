import React from 'react';
import { NOT_RECORDED } from '../../../lib/absence.js';
import { day } from './dataRoomModel';

/**
 * #1524 (D663), moved here from `DataRoomPage.jsx` by D1109 (#2989) — the
 * accounts the venture's scoring report was shared with (D588), beside the
 * room's own grants so one screen answers "who can read about my company".
 * Read-only: a report share opens one frozen report, not the room, and is made
 * and revoked from the report's own Share button. Every share is listed with its
 * state, so a revoked, expired or used-up link is never read as a live one.
 * Access draws these rows; the block around them says an unread list is not a
 * list of nobody.
 */

export const REPORT_SHARE_STATUS = Object.freeze({ active: 'active', expired: 'expired', used_up: 'every open used', revoked: 'revoked' });

/** One share in words. A state the read does not know is printed as given, never looked up on the prototype. */
export function reportShareLine(s) {
  const state = Object.hasOwn(REPORT_SHARE_STATUS, String(s.status)) ? REPORT_SHARE_STATUS[s.status] : String(s.status);
  const until = day(s.expires_at);
  return {
    who: s.grantee_name || s.grantee_email,
    email: s.grantee_name ? s.grantee_email : null,
    detail: `Scoring report · ${state} · ${s.opens} of ${s.open_limit} opens · until ${until === NOT_RECORDED ? 'a date not recorded' : until}`,
  };
}

export function ReportShareRows({ shares }) {
  return (
    <div className="flex flex-col divide-y divide-axal-hairline dark:divide-gray-800" data-testid="report-share-rows">
      {shares.map((s) => {
        const line = reportShareLine(s);
        return (
          <div key={s.id} className="py-1.5" data-testid={`report-share-${s.id}`}>
            <div className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{line.who}</div>
            <div className="text-[11.5px] text-axal-muted dark:text-gray-400">{line.email ? `${line.email} · ` : ''}{line.detail}</div>
          </div>
        );
      })}
    </div>
  );
}
