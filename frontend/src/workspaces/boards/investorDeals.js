import { count, summary, title, top, usd } from './format.js';

/*
 * `/deals` — Investor canvas ID1–ID4, "Find and close investments".
 *
 * WHY THIS FILE EXISTS, AND IT IS NOT A NEW FEATURE. `/deals` rendered
 * `InvestorDealsWorkspace`, which stacked four decision panels — Pipeline,
 * Screening desk, Commit room, Closing — as the bucket overview. ID1–ID4
 * replaced each of those panels with a full zone page on its own route, one at
 * a time, and the last one took the last panel with it. That file's own
 * comment records the end state: "All four decision panels are gone. This file
 * now draws only what no artboard does: the deal-invitation queue above."
 *
 * Which is correct for the zones and left the ROOT with nothing. An investor
 * with no pending invitation opened `/deals` and got a heading, a zone row, and
 * an empty column — reported as "where did the overview UI go". It went into
 * the four zone pages; nothing took its place, because `InvestorDealsRoutes`
 * was written while the panels still existed and says so: "all four sections
 * derive from it, so `/deals` still stacks them as the bucket overview". That
 * sentence stopped being true when ID4 landed, and nothing failed.
 *
 * THE FOUR SECTIONS READ THE ZONES' OWN ENDPOINTS, so the board cannot disagree
 * with the page a reader clicks through to. Same discipline as the partner
 * boards: a section shows the first few rows and a count, and the zone shows
 * the rest.
 *
 * WHAT THE CANVAS ASKS FOR THAT THE STORE WILL NOT ANSWER, said here rather
 * than left as a thinner table than the design:
 *
 *   · Screening's rubric is a SHAPE, not a row set — `desk.rubric` describes
 *     how a score is composed and has no per-deal record to list, so the
 *     section shows the scored deals and the footnote names the rubric as the
 *     thing the zone holds.
 *   · Closing reads envelopes, not money. The platform records the movement of
 *     paper and does not move capital, which is ID4's own sentence and is
 *     repeated in the footnote rather than implied by a missing column.
 *   · Every section's read can fail independently — the zone pages already
 *     treat a failed `dealScreening` and a failed `dealPassAnalytics` as two
 *     separate absences — so `BucketBoard`'s per-source error state carries
 *     that, and no section infers its neighbour's rows.
 */
export default function investorDealsBoard(role, api) {
  return {
    sources: {
      // `'mine'` is the scope the pipeline zone itself passes: this fund's
      // deals, not every deal on the platform. A board over a wider set than
      // the page it links to would report a number the zone cannot reproduce.
      deals: () => api.listDeals(undefined, 'mine'),
      screening: () => api.dealScreening(),
      commit: () => api.icCommitRoom(),
      closing: () => api.esignList(),
    },
    sections: [
      {
        slug: 'pipeline',
        anchor: 'id-pipeline',
        title: 'Pipeline',
        span: 'full',
        source: 'deals',
        cols: '1.6fr 1fr .9fr 1fr .8fr',
        columns: ['Company', 'Sector', 'Stage', 'Ask', 'In stage'],
        empty: 'No deal is open to this fund yet.',
        summary: (d) => summary(count(Array.isArray(d) ? d.length : null, 'live deal')),
        rows: (d) => top(Array.isArray(d) ? d : []).map((row) => [
          row.project_name || `Deal #${row.id}`,
          title(row.project_sector),
          title(row.stage),
          usd(row.target_raise || row.amount),
          typeof row.days_in_stage === 'number' ? `${row.days_in_stage} d` : null,
        ]),
        footnote: () =>
          'Days in stage is the figure the zone is about: a stage count says how many deals sit '
          + 'somewhere, and not which of them stopped moving.',
      },
      {
        slug: 'screening',
        anchor: 'id-screening',
        title: 'Screening desk',
        span: 'half',
        source: 'screening',
        cols: '1.5fr .8fr .8fr',
        columns: ['Company', 'Tier', 'Score'],
        empty: 'Nothing has been scored against the rubric yet.',
        summary: (d) => summary(
          count(d?.scored?.available ? d.scored.rows.filter((r) => r.total_score !== null).length : null, 'scored deal'),
          count(d?.flags?.available ? d.flags.rows.length : null, 'flag'),
        ),
        rows: (d) => top(d?.scored?.available ? d.scored.rows.filter((r) => r.total_score !== null) : [])
          .map((r) => [r.company || `Deal #${r.deal_id}`, title(r.tier), r.total_score === null ? null : String(r.total_score)]),
        footnote: () =>
          'The rubric itself is a shape rather than a list — how a score is composed, with no '
          + 'per-deal row to show here. The zone holds it, beside every pass this fund has recorded.',
      },
      {
        slug: 'commit',
        anchor: 'id-commit',
        title: 'Commit room',
        span: 'half',
        source: 'commit',
        cols: '1.6fr .9fr 1fr',
        columns: ['Decision', 'Stage', 'Votes'],
        empty: 'No decision has been put to a vote yet.',
        summary: (d) => summary(count(d?.decisions?.available ? d.decisions.rows.length : null, 'decision')),
        rows: (d) => top(d?.decisions?.available ? d.decisions.rows : []).map((r) => [
          r.title || r.uid,
          title(r.status),
          `${r.tally?.yes || 0}/${r.tally?.no || 0}/${r.tally?.abstain || 0}`,
        ]),
        footnote: () =>
          'Votes read yes / no / abstain. An abstention is counted as cast and not removed from the '
          + 'denominator, because the store cannot tell one from a recusal — the zone says so beside '
          + 'every tally, with the reason each voter wrote.',
      },
      {
        slug: 'closing',
        anchor: 'id-closing',
        title: 'Closing',
        span: 'full',
        source: 'closing',
        cols: '1.6fr 1.2fr .9fr .9fr',
        columns: ['Document', 'Deal', 'State', 'Signatures'],
        empty: 'No document has been raised against a deal at closing yet.',
        summary: (d) => summary(count(Array.isArray(d?.items) ? d.items.length : null, 'envelope')),
        rows: (d) => top(d?.items).map((e) => [
          e.document_title || e.document_type,
          e.deal?.project_name || (e.deal_id ? `Deal #${e.deal_id}` : null),
          title(e.status),
          e.recipient_count == null ? null : `${e.signed_count ?? 0}/${e.recipient_count}`,
        ]),
        footnote: () =>
          'Paper, not capital. This product records how far through signature each document is; '
          + 'it does not move money and records no wire, so a fully signed envelope is not a closed round.',
      },
    ],
  };
}
