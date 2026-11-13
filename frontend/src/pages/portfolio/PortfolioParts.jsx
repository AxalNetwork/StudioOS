/**
 * D4817 part 1 (#5311): the Portfolio patterns built once (canvas PF-11) —
 * the financial metric, the basis strip, health status, the reporting
 * obligation, the attention queue and its item, and a source that could not
 * be read. PF-02 to PF-08 draw these; #4818 hardens them, it does not make a
 * second set.
 *
 * Every state is a word and a shape, never colour alone, and none of them
 * renders a zero or a bare dash for a value the platform does not have.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, CircleDashed, Clock, Diamond, RefreshCw, SquareSlash, TriangleAlert } from 'lucide-react';

const HEALTH_LOOK = {
  Healthy: ['is-healthy', CircleCheck],
  Watch: ['is-watch', Diamond],
  Attention: ['is-attention', TriangleAlert],
  'Not enough evidence': ['is-none', CircleDashed],
  'Not recorded': ['is-none', CircleDashed],
  Unreadable: ['is-unreadable', SquareSlash],
};

/** Health: Healthy, Watch, Attention, Not enough evidence, Not recorded or Unreadable. */
export function HealthStatus({ health }) {
  if (!health || health.state === 'loading') return <span className="pf-muted">Reading…</span>;
  const [cls, Icon] = HEALTH_LOOK[health.state] || HEALTH_LOOK['Not recorded'];
  return (
    <span className={`pf-health ${cls}`} title={health.reason || undefined} data-state={health.state}>
      <Icon size={12} aria-hidden="true" />{health.state}
      {health.stale ? <span className="pf-stale">stale</span> : null}
    </span>
  );
}

const OBLIGATION_LOOK = {
  Received: ['is-ok', CircleCheck],
  Due: ['is-pending', Clock],
  'Not received': ['is-late', TriangleAlert],
  'Not recorded': ['is-none', CircleDashed],
  Unreadable: ['is-unreadable', SquareSlash],
};

/** A reporting obligation for one period: Received, Due, Not received, Not recorded or Unreadable. */
export function ObligationStatus({ reporting }) {
  if (!reporting || reporting.state === 'loading') return <span className="pf-muted">Reading…</span>;
  const [cls, Icon] = OBLIGATION_LOOK[reporting.state] || OBLIGATION_LOOK['Not recorded'];
  const label = reporting.period && ['Received', 'Due', 'Not received'].includes(reporting.state)
    ? `${reporting.period} ${reporting.state.toLowerCase()}` : reporting.state;
  return (
    <span className={`pf-chip ${cls}`} title={reporting.reason || undefined} data-state={reporting.state}>
      <Icon size={11} aria-hidden="true" />{label}
    </span>
  );
}

/** A read that failed. `claim` says what the failure is not evidence of. */
export function SourceFailure({ what, claim, onRetry, testid, retryTestid }) {
  return (
    <div className="pf-failure" role="alert" data-testid={testid}>
      <CircleAlert size={14} aria-hidden="true" />
      <span><b>{what} could not be read.</b>{claim ? ` ${claim}` : ''}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} data-testid={retryTestid}>
          <RefreshCw size={11} aria-hidden="true" /> Retry
        </button>
      ) : null}
    </div>
  );
}

/** The value of one figure in its state's own words and look. */
export function MetricValue({ metric, onRetry }) {
  if (!metric || metric.state === 'loading') return <span className="pf-muted">Reading…</span>;
  if (metric.state === 'unreadable') {
    return (
      <span className="pf-unreadable">
        Unreadable{onRetry ? <> · <button type="button" onClick={onRetry} className="pf-link-button">Retry</button></> : null}
      </span>
    );
  }
  if (metric.state === 'unavailable') return <span className="pf-unavailable">{metric.value}</span>;
  if (metric.state === 'not_recorded') return <span className="pf-not-recorded" title={metric.reason || undefined}>{metric.value}</span>;
  return <>{metric.value}</>;
}

/** One financial metric: its label, value, and the definition or reason under it. */
export function FinancialMetric({ metric, onRetry }) {
  const why = metric.reason || metric.note;
  return (
    <div className="pf-metric" data-testid={`metric-${metric.key}`} data-state={metric.state}>
      <small>{metric.label}</small>
      <b><MetricValue metric={metric} onRetry={onRetry} /></b>
      {why ? <em>{why}</em> : null}
    </div>
  );
}

/** The basis strip: gross, as-of, the mark rule, the at-cost rule, and a door to the methodology. */
export function BasisStrip({ items, methodologyTo }) {
  return (
    <div className="pf-basis" data-testid="portfolio-basis">
      {items.map((t) => <span key={t}>{t}</span>)}
      {methodologyTo ? <Link to={methodologyTo} data-testid="link-portfolio-methodology">Methodology</Link> : null}
    </div>
  );
}

/** A summary tile in a card's figure row: label over value, with an optional note. */
export function SummaryTile({ label, value, note, tone }) {
  return (
    <div className={`pf-tile${tone ? ` is-${tone}` : ''}`}>
      <small>{label}</small>
      <b>{value}</b>
      {note ? <em>{note}</em> : null}
    </div>
  );
}

/** One company in the attention queue: its health, its evidence, and one action. */
export function AttentionItem({ item }) {
  return (
    <li className="pf-attn-item" data-testid={`attention-${item.key}`}>
      <div className="pf-attn-who">
        <div className="pf-attn-name">{item.name}</div>
        <HealthStatus health={item.health} />
      </div>
      <ul className="pf-attn-evidence" aria-label={`Evidence for ${item.name}`}>
        {item.lines.map((l, i) => <li key={`${l.label}-${i}`}><i>{l.label}</i><span>{l.text}</span></li>)}
      </ul>
      {item.uid ? (
        <Link className={`pf-btn${item.weight >= 3 ? ' is-primary' : ''}`} to={`/portfolio/companies/${encodeURIComponent(item.uid)}`} data-testid={`link-attention-${item.key}`}>
          Open {item.name}
        </Link>
      ) : <span className="pf-muted">No company page</span>}
    </li>
  );
}
