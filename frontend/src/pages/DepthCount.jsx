import React from 'react';
import { Unreadable } from '../ui';

/**
 * A backlog figure. A number, including zero, is what the read returned.
 * Null is a read that failed, and it is drawn as Unreadable with the
 * server's reason — never as zero.
 */
export function DepthCount({ label, value, reason }) {
  const unread = value === null || value === undefined;
  return (
    <div data-testid={`depth-${label}`}>
      <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">{label}</div>
      {unread
        ? <Unreadable what={label} claim={reason || 'This is not a claim that the count is zero.'} />
        : <div className="text-2xl font-bold text-gray-900 mt-1 dark:text-gray-100" data-testid={`depth-value-${label}`}>{value}</div>}
    </div>
  );
}

/** Queue depth and the dead-letter backlog, side by side on the Technical tab. */
export function TechnicalDepthRow({ data }) {
  return (
    <>
      <DepthCount label="Queue depth" value={data?.queue_depth} reason={data?.queue_depth_reason} />
      <DepthCount label="DLQ" value={data?.dlq_count} reason={data?.dlq_reason} />
    </>
  );
}

/**
 * The infrastructure card's caption. Before the queue payload arrives there
 * is no figure to show. Once it has, a null count is the failed read.
 */
export function DlqLine({ queue }) {
  if (!queue) return <span>DLQ</span>;
  return <DepthCount label="DLQ" value={queue.dlq_count} reason={queue.dlq_reason} />;
}
