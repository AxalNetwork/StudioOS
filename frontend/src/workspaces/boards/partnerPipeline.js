import { budget, count, day, summary, title, top, usd, usdCents } from './format.js';

/*
 * `/pipeline` — Partner Operator Canvas P3, "Win the work".
 *
 * WHAT THE CANVAS DRAWS THAT THE STORE CANNOT ANSWER. P3's lead table heads
 * `['Lead','Source','Match','Budget','Read']` and marks some rows with a
 * provenance seam. `founder_needs` (sql/t13_t14_t15.sql:316) holds a category,
 * a title, a description, a budget range, a timeline and a status — and no
 * source column, no match score, and nowhere a written "read" could live. So
 * three of the canvas's five columns are drawn here as what they are: absent.
 * The footnote says which, rather than the table quietly having fewer columns
 * than the design and nobody knowing why.
 *
 * The same discipline settles the rest of the artboard. Proposals prints a win
 * rate only because `analysePipeline` computes one and hands back
 * `win_rate_basis` saying how; when nothing is decided it returns null and the
 * summary drops that half rather than printing a zero, which would read as
 * "you lose everything". Retainers prints an MRR only when the worker says it
 * counted one, and carries the worker's own `mrr_note` — a retainer with no
 * amount is skipped, never counted as zero.
 *
 * ORDER IS ZONE ORDER, NOT ARTBOARD ORDER. The canvas stacks leads,
 * negotiations, proposals, retainers, analytics; `shellConfig` lists leads,
 * proposals, negotiations, retainers, analytics, and that is what the pill row
 * above the board shows. The board follows the pills, because a reader scanning
 * one and then the other must not have to reconcile two orders.
 */
/**
 * `api` ARRIVES AS AN ARGUMENT rather than as an import, so this file has no
 * module-scope dependency on the API client. That is what lets
 * `bucket_board.test.mjs` load the real registry in Node and assert over the
 * real objects — `lib/api.js` cannot be imported there, because the frontend
 * resolves extensionless paths through the bundler and Node does not.
 */
export default function partnerPipelineBoard(role, api) {
  return {
    sources: {
      needs: () => api.listNeeds(),
      // One fetch feeding two sections. `/quotes/analytics` answers the
      // proposals header AND the whole analytics section, so asking for it
      // twice would be two round trips for one answer.
      quotes: () => Promise.all([api.myQuotes(), api.quotesAnalytics()])
        .then(([mine, stats]) => ({ ...stats, items: mine?.items || [] })),
      negotiations: () => api.listPartnerNegotiations(),
      retainers: () => api.listPartnerRetainers(),
    },
    sections: [
      {
        slug: 'leads',
        anchor: 'pl-leads',
        title: 'Lead sources',
        span: 'full',
        source: 'needs',
        cols: '1.6fr 1fr 1fr .9fr',
        columns: ['Lead', 'Shape', 'Budget', 'Posted'],
        empty: 'No open need is posted for this firm to answer yet.',
        summary: (d) => summary(count(Array.isArray(d?.items) ? d.items.length : null, 'open lead')),
        rows: (d) => top(d?.items).map((n) => [
          n.title, title(n.category), budget(n.budget_min, n.budget_max), day(n.created_at),
        ]),
        footnote: () =>
          'The canvas heads this table with a source, a match score and a written read. '
          + 'A posted need records its shape, its budget and its timeline and none of those three, '
          + 'so they are absent here rather than inferred from the category or from who posted it.',
      },
      {
        slug: 'proposals',
        anchor: 'pl-proposals',
        title: 'Proposal desk',
        span: 'half',
        source: 'quotes',
        cols: '1.5fr .9fr 1fr',
        columns: ['Value', 'State', 'Decided'],
        empty: 'No quote has been sent from this firm yet.',
        summary: (d) => summary(
          count(d?.pipeline?.pending, 'open', 'open'),
          d?.pipeline?.win_rate_pct === null || d?.pipeline?.win_rate_pct === undefined
            ? null
            : `${Math.round(d.pipeline.win_rate_pct)}% win rate`,
        ),
        rows: (d) => top(d?.items).map((q) => [
          usd(q.price), title(q.status), day(q.decided_at),
        ]),
        footnote: (d) => d?.pipeline?.win_rate_basis || null,
      },
      {
        slug: 'negotiations',
        anchor: 'pl-negotiations',
        title: 'Negotiations',
        span: 'half',
        source: 'negotiations',
        cols: '1.6fr 1fr 1fr',
        columns: ['Need', 'Quote', 'State'],
        empty: 'No quote has moved into terms yet.',
        summary: (d) => summary(count((d?.items || []).filter((n) => n.negotiation).length, 'open', 'open')),
        rows: (d) => top((d?.items || []).filter((n) => n.negotiation)).map((n) => [
          n.need_title, usd(n.price), title(n.negotiation?.status),
        ]),
        footnote: () =>
          'Where a proposal becomes terms. Each row opens the thread that carries '
          + 'what was asked, what was offered, and what was agreed.',
      },
      {
        slug: 'retainers',
        anchor: 'pl-retainers',
        title: 'Retainers',
        span: 'half',
        source: 'retainers',
        cols: '1.4fr 1fr 1fr .9fr',
        columns: ['Client', 'Monthly', 'Renews', 'Utilisation'],
        empty: 'No engagement is recorded as a retainer yet.',
        summary: (d) => summary(
          usdCents(d?.mrr_cents) ? `${usdCents(d.mrr_cents)} recurring` : null,
          count(d?.retainer_count, 'retainer'),
        ),
        rows: (d) => top((d?.items || []).filter((r) => r.retainer)).map((r) => [
          r.founder_name,
          usdCents(r.retainer?.amount_cents),
          day(r.retainer?.renews_at),
          r.utilisation_pct === null || r.utilisation_pct === undefined
            ? null : `${Math.round(r.utilisation_pct)}%`,
        ]),
        // The worker's own sentence, not a second one written here. It states
        // the denominator, and names what it left out.
        footnote: (d) => summary(d?.mrr_basis, d?.mrr_note),
      },
      {
        slug: 'analytics',
        anchor: 'pl-analytics',
        title: 'Pipeline analytics',
        span: 'full',
        source: 'quotes',
        cols: '1.4fr .9fr .9fr .9fr 1fr',
        columns: ['Shape', 'Quotes', 'Win rate', 'Cycle', 'Won'],
        empty: 'No quote has been decided yet, so there is nothing to break down.',
        summary: (d) => summary(
          d?.pipeline?.median_cycle_days === null || d?.pipeline?.median_cycle_days === undefined
            ? null : `${d.pipeline.median_cycle_days}d median cycle`,
          usd(d?.pipeline?.won_value) ? `${usd(d.pipeline.won_value)} won` : null,
        ),
        rows: (d) => top(d?.by_shape).map((s) => [
          title(s.shape) || 'Shape not recorded',
          s.quote_count,
          s.win_rate_pct === null || s.win_rate_pct === undefined ? null : `${Math.round(s.win_rate_pct)}%`,
          s.median_cycle_days === null || s.median_cycle_days === undefined ? null : `${s.median_cycle_days}d`,
          usd(s.won_value),
        ]),
        // `/quotes/analytics` returns `loss_reasons: null` with its reason, and
        // that reason is the honest content of the canvas's third analytic
        // block. Printed rather than dropped.
        footnote: (d) => d?.loss_reasons_note || null,
      },
    ],
  };
}
