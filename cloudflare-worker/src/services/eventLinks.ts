// D1031 (#2872): where an in-app event notice opens. The public reader serves
// only approved public and unlisted events, so a slug link sent a member to
// "Event not found." for a private, cancelled or unapproved event. A member's
// notice opens the signed-in event page and a host's opens the manage page.
// Part 5 of My events (#2387) moves both to `/my/events/ticket/<id>` and
// `/my/events/hosting/<id>`, here and nowhere else.

/** A registrant's notice: the signed-in event page. */
export function memberEventLink(eventId: number | string): string {
  return `/events/${Number(eventId)}`;
}

/** The host's notice: the event's manage page. */
export function hostEventLink(eventId: number | string): string {
  return `/events/${Number(eventId)}/manage`;
}
