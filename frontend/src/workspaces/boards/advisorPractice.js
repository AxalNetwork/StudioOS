import { count, day, summary, title, top, usdCents, total } from './format.js';
import { bookingView } from '../../pages/advisor/advisory/kit.jsx';
import { classifyBooking } from '../../pages/advisor/practice/opportunityLog.js';
import { LANE_LABEL } from '../../pages/advisor/practice/engagementBoard.js';
import { STATE_LABEL } from '../../pages/advisor/practice/deliveryTrail.js';

/*
 * `/practice` — Advisor Canvas V3, "Run my advisory business".
 *
 * THE EARNINGS SECTION IS WHERE THIS CANVAS AND THIS PRODUCT USED TO DISAGREE
 * OUTRIGHT, AND NO LONGER DO. V3 subtitles it "platform cut shown on every
 * line" and draws a Platform cut column beside a payout panel; when this board
 * was written there was no rate, no payout table and nothing to put in either.
 * Migration 241 added all three — a configurable `advisor_take_rate_bps`,
 * `advisor_payout_accounts`, `advisor_payouts`, and a `platform_cut_cents`
 * stamped on every line as it is priced — so the disagreement is closed and
 * the cut column belongs to the detail page (D4/PR5c), not here.
 *
 * WHAT DID NOT CHANGE is that nothing is CHARGED: `settlementMode()` answers
 * `'none'` until the advisory charging flag ships, and every money response
 * carries it. A board is static and cannot read it, so this one states the
 * rate and refers the settlement question to the page that reads it live —
 * rather than denying a cut that now exists or promising one that has not been
 * taken. `advisor_bucket_overview.test.mjs` bans both directions. D75.
 *
 * "6 SLOTS OPEN" OVER SESSIONS IS LEFT OUT. Slots are real (`listAdvisorSlots`
 * reads them), but this zone is about booked sessions and what was billed
 * against them. A header counting availability over a body about billing is
 * exactly the overview/zone mismatch a board exists to prevent, so Sessions
 * counts sessions.
 *
 * "Renewal due" over Engagements and "sent and opened" over Delivery ARE
 * drawn, and only from their stores (#4714, D4714): `renewal_due` is
 * `advisor_engagements`' own lane and total, and sent/opened are
 * `advisor_deliverables`' recorded states. A booking still carries neither,
 * so neither is ever inferred from one.
 *
 * #4702 (D4702): EACH SECTION SUMMARISES THE SAME ENTITIES AS THE PAGE IT LINKS
 * TO. Engagements used to count confirmed BOOKINGS and Delivery completed
 * BOOKINGS, so an advisor with three contracts and one session saw one active
 * engagement here and three on Engagements. Now:
 *
 *   · Opportunities: the bookings, classified by `classifyBooking`, the function
 *     the Opportunities page uses, so a request whose slot has passed unanswered
 *     is "expired" here exactly where the page says expired;
 *   · Active engagements: `advisor_engagements` (`listMyAdvisorEngagements`),
 *     the page's own `totals.active`;
 *   · Delivery desk: `advisor_deliverables` (`listMyAdvisorDeliverables`), the
 *     page's own work products and `totals`;
 *   · Sessions: the bookings, as before.
 *
 * Opportunities and Sessions share one bookings fetch; the other sections read
 * the store their page reads.
 */
/**
 * The pending requests of a bookings read, split the way the Opportunities page
 * splits them (`classifyBooking`, one instant for every row): still awaiting an
 * answer, or expired because the slot passed unanswered.
 */
function unanswered(d) {
  const now = Date.now();
  const out = { awaiting: [], expired: [] };
  for (const b of Array.isArray(d?.items) ? d.items : []) {
    const view = bookingView(b);
    const bucket = classifyBooking(view, now);
    if (bucket === 'awaiting' || bucket === 'expired') out[bucket].push({ ...view, bucket });
  }
  return out;
}

export default function advisorPracticeBoard(role, api) {
  return {
    sources: {
      bookings: () => api.listMyAdvisorBookings(),
      engagements: () => api.listMyAdvisorEngagements(),
      deliverables: () => api.listMyAdvisorDeliverables(),
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
        // The page's own classification: still waiting, or expired because the
        // slot passed unanswered. A pending row is not "awaiting you" once its
        // time has gone.
        summary: (d) => {
          const buckets = unanswered(d);
          return summary(
            count(buckets.awaiting.length, 'awaiting you', 'awaiting you'),
            buckets.expired.length ? count(buckets.expired.length, 'expired unanswered', 'expired unanswered') : null,
          );
        },
        rows: (d) => {
          const buckets = unanswered(d);
          return top([...buckets.awaiting, ...buckets.expired]).map((v) => [
            v.client_name, v.topic, v.bucket === 'expired' ? 'Expired unanswered' : 'Awaiting a decision', day(v.slot_starts_at),
          ]);
        },
        footnote: () =>
          'The topic and the questions are the client’s own words, written when they asked for '
          + 'the session. That is the half of a client brief this practice already holds.',
      },
      {
        slug: 'engagements',
        anchor: 'pr-engage',
        title: 'Active engagements',
        span: 'half',
        source: 'engagements',
        cols: '1.4fr 1fr 1fr',
        columns: ['Client', 'State', 'Term ends'],
        empty: 'No engagement is under contract yet.',
        // The engagement store, not bookings: a client with a signed contract and
        // no session yet is an active engagement, and three sessions with one
        // client are not three. `totals.active` is the number the page shows.
        summary: (d) => summary(
          count(d?.totals?.active, 'active engagement'),
          d?.totals?.renewal_due ? count(d.totals.renewal_due, 'renewal due', 'renewals due') : null,
        ),
        total: (d) => total(d?.items),
        rows: (d) => top((d?.items || []).filter((e) => e.lane === 'signed' || e.lane === 'renewal_due')).map((e) => [
          e.client_name, LANE_LABEL[e.lane] || title(e.lane), day(e.term_ends_at),
        ]),
        footnote: () =>
          'Contracts you have recorded, by state. A contract that is up for a decision stays under '
          + 'Signed and is marked on the page itself.',
      },
      {
        slug: 'delivery',
        anchor: 'pr-delivery',
        title: 'Delivery desk',
        span: 'half',
        source: 'deliverables',
        cols: '1.4fr 1.6fr 1fr',
        columns: ['Client', 'Work product', 'State'],
        empty: 'No work product is on file yet.',
        // The work-product store, not completed sessions: delivery here is what
        // you have recorded sending a client, as the page counts it.
        summary: (d) => summary(
          count(d?.totals?.work_products, 'work product'),
          d?.totals?.sent ? count(d.totals.sent, 'sent', 'sent') : null,
          d?.totals?.opened ? count(d.totals.opened, 'opened', 'opened') : null,
        ),
        total: (d) => total(d?.items),
        rows: (d) => top(d?.items).map((i) => [
          i.client_name, i.title, STATE_LABEL[i.state] || title(i.state),
        ]),
        footnote: () =>
          'Work products and their latest version, from what you recorded sending. Whether a client '
          + 'opened one is theirs to say and is shown only once they have.',
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
        // advisors.ts reads bookings with LIMIT 200 (D403).
        total: (d) => total(d?.items, 200),
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
        // A STATIC BOARD MUST NOT ASSERT A DYNAMIC FACT. This footnote used to
        // read "Axal settles nothing and takes no cut, so there is no platform
        // line to show and no payout rail behind these figures" — three claims
        // that migration 241 made false in different degrees: a rate is
        // recorded, `advisor_payouts` exists, and whether anything settles is
        // `settlement` on the response, which this board does not read. So it
        // says what is durably true and points at the page that knows. D75.
        footnote: (d) => summary(
          'Totalled from the amounts you typed against each session, with the platform rate '
          + 'recorded against each priced one. Whether any of it has been charged is stated on '
          + 'Earnings itself, which reads that live.',
          d?.unpriced_count
            ? 'Sessions with no amount recorded are counted but not totalled — a missing price is not a zero one.'
            : null,
        ),
      },
    ],
  };
}
