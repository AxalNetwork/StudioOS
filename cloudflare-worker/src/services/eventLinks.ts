// D1031 (#2872): where an in-app event notice opens. The public reader serves
// only approved public and unlisted events, so a slug link sent a member to
// "Event not found." for a private, cancelled or unapproved event.
// D1035 (#2876, part 5 of My events): a member's notice opens their ticket
// drawer and a host's opens the hosted-event drawer, here and nowhere else.
// The ticket drawer reads a place in Upcoming or Past, so a notice about a
// cancelled event or a declined place still lands on it.

/** A registrant's notice: their ticket on My events. */
export function memberEventLink(eventId: number | string): string {
  return `/my/events/ticket/${Number(eventId)}`;
}

/** The host's notice: the hosted event on My events. */
export function hostEventLink(eventId: number | string): string {
  return `/my/events/hosting/${Number(eventId)}`;
}
