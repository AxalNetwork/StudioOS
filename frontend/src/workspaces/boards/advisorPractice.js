import { count, day, summary, title, top, usdCents } from './format.js';

/*
 * `/practice` — Advisor Canvas V3, "Run my advisory business".
 *
 * THE EARNINGS SECTION IS WHERE THIS CANVAS AND THIS PRODUCT DISAGREE OUTRIGHT.
 * V3 subtitles it "platform cut shown on every line" and draws a Platform cut
 * column beside a payout panel. `GET /advisors/me/earnings` returns
 * `settlement: 'none'`, and the zone's own blurb says it plainly: "Axal settles
 * nothing and takes no cut." There is no cut to show, no payout rail behind
 * these figures, and `advisor_bucket_overview.test.mjs` already bans the phrase
 * on the strength of that. The board totals what the advisor typed and says
 * where those totals come from.
 *
 * TWO MORE V3 SUBTITLES THAT NAME NOTHING STORED.
 *
 *   · "6 slots open" over Sessions. Slots are real — `listAdvisorSlots` reads
 *     them — but this zone is about booked sessions and what was billed against
 *     them. A header counting availability over a body about billing is exactly
 *     the overview/zone mismatch a board exists to prevent, so Sessions counts
 *     sessions.
 *   · "1 renewal due" over Engagements, and "sent and opened" over Delivery.
 *     A booking has a status and a topic; it has no renewal date, and nothing
 *     records that a client opened anything. Neither is inferred.
 *
 * All three Practice sections that read bookings share one fetch. The zone
 * pages read the same endpoint, so the board's counts and theirs cannot drift.
 */
export default function advisorPracticeBoard(role, api) {
  return {
    sources: {
      bookings: () => api.listMyAdvisorBookings(),
      earnings: () => api.getMyAdvisorEarnings(),
    },
    sections: [
      {
        slug: 'opportunities',
        anchor: 'pr-opps',
        title: 'Opportunities',
        span: 'full',
        source: 'bookings',
        cols: '1.3fr 1.9fr 1fr 1fr',
        columns: ['Client', 'They asked about', 'State', 'When'],
        empty: 'Nobody has requested a session yet.',
        summary: (d) => summary(
          count((d?.items || []).filter((b) => b.status === 'pending').length, 'awaiting you', 'awaiting you'),
        ),
        rows: (d) => top((d?.items || []).filter((b) => b.status === 'pending')).map((b) => [
          b.client_name, b.topic, title(b.status), day(b.slot_starts_at),
        ]),
        footnote: () =>
          'The topic and the questions are the client’s own words, written when they asked for '
          + 'the session. That is the half of a client brief this practice already holds.',
      },
      {
        slug: 'engagements',
        anchor: 'pr-engage',
        title: 'Active engagements',
        span: 'half',
        source: 'bookings',
        cols: '1.4fr 1fr 1fr',
        columns: ['Client', 'State', 'When'],
        empty: 'No session is confirmed yet.',
        summary: (d) => summary(
          count(new Set((d?.items || []).filter((b) => b.status === 'confirmed').map((b) => b.client_user_id)).size, 'client'),
        ),
        rows: (d) => top((d?.items || []).filter((b) => b.status === 'confirmed')).map((b) => [
          b.client_name, title(b.status), day(b.slot_starts_at),
        ]),
        footnote: () =>
          'The canvas also flags a renewal falling due. A booking records a status and a time; '
          + 'nothing records a term or a renewal date, so no renewal is claimed here.',
      },
      {
        slug: 'delivery',
        anchor: 'pr-delivery',
        title: 'Delivery desk',
        span: 'half',
        source: 'bookings',
        cols: '1.4fr 1.6fr 1fr',
        columns: ['Client', 'Topic', 'When'],
        empty: 'No session has been completed yet.',
        summary: (d) => summary(
          count((d?.items || []).filter((b) => b.status === 'completed').length, 'delivered', 'delivered'),
        ),
        rows: (d) => top((d?.items || []).filter((b) => b.status === 'completed')).map((b) => [
          b.client_name, b.topic, day(b.slot_starts_at),
        ]),
        footnote: () =>
          'Completed sessions, from the state you set. The canvas reads work product as sent and '
          + 'opened; nothing in this product records that a client opened anything, so only what '
          + 'you marked is shown.',
      },
      {
        slug: 'sessions',
        anchor: 'pr-sessions',
        title: 'Sessions',
        span: 'half',
        source: 'bookings',
        cols: '1.3fr 1.1fr 1fr .9fr',
        columns: ['Client', 'Topic', 'When', 'State'],
        empty: 'No session is booked.',
        summary: (d) => summary(count(Array.isArray(d?.items) ? d.items.length : null, 'session')),
        rows: (d) => top(d?.items).map((b) => [
          b.client_name, b.topic, day(b.slot_starts_at), title(b.status),
        ]),
        footnote: () =>
          'Every booked session and what you recorded against it. The canvas heads this with the '
          + 'count of open slots on your calendar; that is a different question, and it is answered '
          + 'on the zone itself.',
      },
      {
        slug: 'earnings',
        anchor: 'pr-earnings',
        title: 'Earnings',
        span: 'half',
        source: 'earnings',
        cols: '1.4fr 1fr 1fr',
        columns: ['State', 'Sessions', 'Total'],
        empty: 'No amount has been recorded against a session yet.',
        summary: (d) => summary(
          usdCents(d?.billed_cents) ? `${usdCents(d.billed_cents)} billed` : null,
          usdCents(d?.collected_cents) ? `${usdCents(d.collected_cents)} collected` : null,
        ),
        rows: (d) => top(d?.by_state).map((s) => [
          title(s.state), s.bookings, usdCents(s.total_cents),
        ]),
        // `settlement: 'none'` is the response's own word for it.
        footnote: (d) => summary(
          'Totalled from the amounts you typed against each session. Axal settles nothing and takes '
          + 'no cut, so there is no platform line to show and no payout rail behind these figures.',
          d?.unpriced_count
            ? 'Sessions with no amount recorded are counted but not totalled — a missing price is not a zero one.'
            : null,
        ),
      },
    ],
  };
}
