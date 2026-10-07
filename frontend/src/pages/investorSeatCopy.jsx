import { createElement } from 'react';

/** What the colleague-seat card says after an invite, from what the route did. */
export function seatInviteOutcome(res, fallbackEmail) {
  if (res?.email_sent) return { flash: `Invite emailed to ${res.email || fallbackEmail}.`, link: '' };
  return { flash: 'No email went out. Copy the link and send it.', link: res?.invite_link || '' };
}

/** The copyable link, only while the seat is still pending. */
export function ColleagueSeatLink({ seat }) {
  const pending = !seat.revoked_at && !seat.accepted_at && seat.invite_link;
  if (!pending) return null;
  return createElement('p', {
    className: 'text-xs text-gray-600 dark:text-gray-300 break-all',
    'data-testid': `seat-link-${seat.id}`,
  }, seat.invite_link);
}
