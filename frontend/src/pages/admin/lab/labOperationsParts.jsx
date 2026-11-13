import React from 'react';
import { ReadState as SharedReadState, SUB } from './labParts';

/** D971's explicit failed-block word and retry; the shared component handles loading/stale. */
export function ReadState(props) {
  const { read, claim, onRetry, testId } = props;
  if (read.status === 'error' && read.data === null) return <div role="alert" className={SUB} data-testid={`${testId}-unreadable`}>
    <strong>Unreadable.</strong> {claim} <button type="button" className="font-bold underline" onClick={onRetry}>Try again</button>
  </div>;
  return <SharedReadState {...props} />;
}
