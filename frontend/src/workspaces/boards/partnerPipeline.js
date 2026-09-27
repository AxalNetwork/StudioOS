import { budget, count, day, summary, title, top, usd, usdCents } from './format.js';

/*
 * `/pipeline` — Partner Operator Canvas P3, "Win the work".
 *
 * THE LEAD TABLE READS WHAT THE LEADS ZONE READS (D391). P3 heads it
 * `['Lead','Source','Match','Budget','Read']`. This section used to read
 * `api.listNeeds()` — the raw marketplace list — and its footnote said a source
 * and a match score did not exist. Both did: `GET /partner/pipeline/leads`
 * (`listPartnerLeads`, the call `LeadsZone.jsx` makes) returns every open need
 * the firm has not passed on, with `source_label`, a `score` counted from the
 * firm's own fit rules, and the receipts that score is made of. So the board
 * and the zone now show one list, and the footnote is the worker's
 * `scoring_note`, which says what the score is and when there is none.
 *
 * `Read` is the receipts, not prose: nothing writes a sentence about a lead,
 * and the column heading says what it holds. An excluded lead reads "Excluded"
 * with no number, and an unscored one reads absent — the two absences the zone
 * keeps apart.
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
      leads: () => api.listPartnerLeads(),
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
        source: 'leads',
        cols: '1.6fr .9fr .7fr 1fr 1.6fr',
        columns: ['Lead', 'Source', 'Match', 'Budget', 'Receipts'],
        empty: 'No open need is waiting for this firm to answer or pass on.',
        summary: (d) => summary(
          count(d?.open_count, 'open lead'),
          count(d?.strong_fit_count, 'strong fit'),
        ),
        rows: (d) => top(d?.items).map((l) => [
          l.title,
          l.source_label,
          l.excluded_by ? 'Excluded' : l.score,
          budget(l.budget_min, l.budget_max),
          l.excluded_by
            || (Array.isArray(l.receipts) && l.receipts.length ? l.receipts.map((r) => r.label).join(' · ') : null),
        ]),
        // The worker's own sentence: what the score is counted from, or that
        // nothing is scored because the firm has stated no rule to score with.
        footnote: (d) => d?.scoring_note || null,
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
