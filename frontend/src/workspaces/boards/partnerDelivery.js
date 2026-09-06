import { count, day, summary, title, top } from './format.js';

/*
 * `/delivery` — Partner Operator Canvas P4, "Ship the work".
 *
 * THREE OF THE FIVE SECTION SUBTITLES THE CANVAS WRITES ARE CLAIMS THIS
 * PRODUCT REFUSES, and each is refused in the worker with its reason attached,
 * which is what this board prints instead of the canvas's line.
 *
 *   · "{{ overCount }} over" — `GET /delivery/capacity` returns
 *     `cap_hours: null` beside "No capacity cap is recorded anywhere in this
 *     product. Hours are real; a threshold to be over is not". The canvas
 *     hardcodes 40; adopting it would invent the firm's cap and then present
 *     it back as a finding.
 *   · "Shipped and acknowledged" — `GET /delivery/deliverables` returns
 *     `median_days_to_open: null` because `opened_at` is the client's to set
 *     and nothing in this product sets it. Every sent deliverable therefore
 *     reads unopened, which makes the COUNT true and the median meaningless.
 *     The worker's own `unopened_note` says to read it as "we do not know"
 *     rather than "the client ignored it".
 *   · "satisfaction where it exists" — health is computed from milestones,
 *     blockers, deliverables and utilisation. No satisfaction input exists
 *     anywhere, so the word does not appear.
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
        summary: (d) => summary(count(Array.isArray(d?.people) ? d.people.length : null, 'person', 'people')),
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
        cols: '1.3fr 1fr .9fr 2fr',
        columns: ['Client', 'State', 'Blockers', 'Why'],
        empty: 'No engagement has a milestone, a blocker or a deliverable recorded yet.',
        summary: (d) => summary(count(d?.unrated_count, 'unrated', 'unrated')),
        rows: (d) => top((d?.items || []).filter((e) => e.health)).map((e) => [
          e.founder_name,
          title(e.health),
          Array.isArray(e.open_blockers) ? e.open_blockers.length : null,
          Array.isArray(e.health_reasons) && e.health_reasons.length ? e.health_reasons.join('; ') : null,
        ]),
        footnote: () =>
          'Health is read from milestones, blockers, deliverables and retainer use, and is '
          + 'computed rather than stored. The canvas also asks for client satisfaction; no '
          + 'satisfaction input exists anywhere in this product, so it is not part of the rating.',
      },
    ],
  };
}
