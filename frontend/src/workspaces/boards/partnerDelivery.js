import { count, day, summary, title, top } from './format.js';

/*
 * `/delivery` — Partner Operator Canvas P4, "Ship the work".
 *
 * TWO OF THE FIVE SECTION SUBTITLES THE CANVAS WRITES ARE ANSWERED ONLY IN
 * PART, and each section prints the worker's own sentence about the part it
 * cannot answer rather than the canvas's line.
 *
 *   · "{{ overCount }} over" — migration 230 lets the FIRM state a cap, firm-
 *     wide or per person, and `GET /delivery/capacity` counts people over the
 *     cap that was stated (`over_committed_count`). Until one is stated that
 *     count is null and `cap_note` says why: hours are real, a threshold nobody
 *     set is not. The canvas's hardcoded 40 is still never used.
 *   · "Shipped and acknowledged" — `GET /delivery/deliverables` returns
 *     `median_days_to_open: null` because `opened_at` is the client's to set
 *     and nothing in this product sets it. Every sent deliverable therefore
 *     reads unopened, which makes the COUNT true and the median meaningless.
 *     The worker's own `unopened_note` says to read it as "we do not know"
 *     rather than "the client ignored it".
 *
 * THE HEALTH SECTION HAS THE ARTBOARD'S COLUMNS (D391). P4 heads it
 * `Client · Scope vs SOW · Flag · Satisfaction · Read`, and this board used to
 * draw three of them under a footnote saying "no satisfaction input exists
 * anywhere in this product". It does: migration 232 holds the firm's stated
 * scope assessment and a satisfaction score that cannot be saved without its
 * source, and `GET /delivery/health` has returned both (`scope_state`,
 * `satisfaction`, `satisfaction_source`) since. An unassessed scope reads
 * absent, never "within"; a score always prints with where it was heard; and
 * the worker's `satisfaction_note` says why the firm-wide average is withheld
 * while any live engagement is unscored.
 *
 * Health also carries `unrated_note` — "Silence is not good news" — so a
 * mostly-green board cannot be read as a mostly-healthy book when it is really
 * a mostly-empty one. It is printed on the board for the same reason it is
 * printed on the zone.
 */
export default function partnerDeliveryBoard(role, api) {
  return {
    sources: {
      // One fetch behind two sections: health answers the board's own summary
      // AND the engagement-health section beneath it.
      health: () => api.getPartnerDeliveryHealth(),
      deliverables: () => api.listPartnerDeliverables(),
      capacity: () => api.getPartnerCapacity(),
      reports: () => api.listPartnerStatusReports(),
    },
    sections: [
      {
        slug: 'board',
        anchor: 'dl-board',
        title: 'Engagement board',
        span: 'full',
        source: 'health',
        cols: '1.4fr 1.2fr 1fr .9fr 1.6fr',
        columns: ['Client', 'Work', 'State', 'Overdue', 'Read'],
        empty: 'No engagement is open for this firm yet.',
        summary: (d) => summary(
          count(Array.isArray(d?.items) ? d.items.length : null, 'engagement'),
          count(d?.rated_count, 'rated', 'rated'),
        ),
        rows: (d) => top(d?.items).map((e) => [
          e.founder_name, e.need_title, title(e.health), e.overdue_count, e.health_note,
        ]),
        footnote: (d) => d?.unrated_note || null,
      },
      {
        slug: 'deliverables',
        anchor: 'dl-deliverables',
        title: 'Deliverables desk',
        span: 'half',
        source: 'deliverables',
        cols: '1.6fr 1.1fr 1fr',
        columns: ['Deliverable', 'Client', 'Sent'],
        empty: 'Nothing has been sent to a client yet.',
        summary: (d) => summary(count(d?.sent_count, 'sent', 'sent')),
        rows: (d) => top(d?.items).map((x) => [x.title, x.founder_name, day(x.sent_at)]),
        // The worker's sentence, which says what the count does and does not
        // mean. The canvas's "shipped and acknowledged" is not available.
        footnote: (d) => d?.unopened_note || d?.median_days_to_open_note || null,
      },
      {
        slug: 'capacity',
        anchor: 'dl-capacity',
        title: 'Capacity & allocation',
        span: 'half',
        source: 'capacity',
        cols: '1.4fr 1fr 1fr',
        columns: ['Person', 'Hours', 'Seats'],
        empty: 'No hours and no embedded seats are recorded for this period.',
        // `over_committed_count` is null until the firm states a cap, so the
        // second half of this line is absent rather than "0 over" until then.
        summary: (d) => summary(
          count(Array.isArray(d?.people) ? d.people.length : null, 'person', 'people'),
          count(d?.over_committed_count, 'over cap', 'over cap'),
        ),
        rows: (d) => top(d?.people).map((p) => [
          p.name,
          p.hours === null || p.hours === undefined ? null : p.hours,
          p.live_seats,
        ]),
        // `cap_note`, verbatim: hours are real, a threshold to be over is not.
        footnote: (d) => d?.cap_note || null,
      },
      {
        slug: 'status-reports',
        anchor: 'dl-status',
        title: 'Client status reporting',
        span: 'half',
        source: 'reports',
        cols: '1.3fr 1.2fr .9fr 1fr',
        columns: ['Client', 'Period', 'State', 'Sent'],
        empty: 'No status report has been composed yet.',
        summary: (d) => summary(
          count(d?.draft_count, 'draft'),
          count(d?.sent_count, 'sent', 'sent'),
        ),
        rows: (d) => top(d?.items).map((r) => [
          r.founder_name, r.period, title(r.state), day(r.sent_at),
        ]),
        footnote: (d) => d?.delivery_note || null,
      },
      {
        slug: 'health',
        anchor: 'dl-health',
        title: 'Engagement health',
        span: 'full',
        source: 'health',
        cols: '1.2fr .9fr .8fr 1.1fr 1.8fr',
        columns: ['Client', 'Scope vs SOW', 'Flag', 'Satisfaction', 'Read'],
        empty: 'No engagement has anything recorded to rate it by yet.',
        summary: (d) => summary(
          count(d?.unrated_count, 'unrated', 'unrated'),
          count(d?.drift_count, 'drifting', 'drifting'),
          count(d?.scope_unassessed_count, 'scope unassessed', 'scope unassessed'),
        ),
        rows: (d) => top((d?.items || []).filter(
          (e) => e.health || e.scope_state || (e.satisfaction !== null && e.satisfaction !== undefined),
        )).map((e) => [
          e.founder_name,
          // Never defaulted: an engagement nobody assessed is not "within".
          title(e.scope_state),
          title(e.health),
          // A score never prints without the place it was heard (232's CHECK
          // makes one impossible without the other).
          e.satisfaction === null || e.satisfaction === undefined
            ? null
            : `${e.satisfaction} of five · ${e.satisfaction_source}`,
          Array.isArray(e.health_reasons) && e.health_reasons.length ? e.health_reasons.join('; ') : null,
        ]),
        footnote: (d) => summary(
          'Health is computed from milestones, blockers, deliverables and retainer use. Scope and '
          + 'satisfaction are what somebody at this firm stated, each with its source; nothing here asks a client anything.',
          d?.satisfaction_note,
        ),
      },
    ],
  };
}
