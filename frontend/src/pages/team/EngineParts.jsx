import React, { useCallback, useEffect, useState } from 'react';
import { reportError } from '../../lib/log';
import { HonestBlock, MUTED } from './teamUi.jsx';
import { NOT_SAME, readFailure } from './engineModel.js';

/**
 * D1531 (#3742 E8): the pieces every agent engine screen shares. `useEngineRead`
 * runs one `agentEngineApi` read and answers `{ status: 'loading' | 'ready' |
 * 'off' | 'refused' | 'error', data, reload }`; `ReadStates` draws the three
 * that are not ready the canvas's way (Reading…, the error with "That is not
 * the same as having none.", and nothing for an engine that is off unless the
 * screen says so).
 */
export function useEngineRead(read, deps, where) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const run = useCallback(async () => {
    setState((s) => ({ status: 'loading', data: s.data }));
    try {
      setState({ status: 'ready', data: await read() });
    } catch (e) {
      const status = readFailure(e);
      if (status === 'error') reportError(`${where || 'agent-engine:read'}`, e);
      setState({ status, data: null, error: e });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function Reading({ testId }) {
  return <p role="status" className={`m-0 ${MUTED}`} data-testid={testId}>Reading…</p>;
}

/** "X could not be read." and its second line, with Try again. */
export function CouldNotRead({ text, second = NOT_SAME, onRetry, testId }) {
  return (
    <HonestBlock role="alert" testId={testId}
      action={onRetry ? <button type="button" className="text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" onClick={onRetry}>Try again</button> : null}>
      <b>{text}</b>{second ? ` ${second}` : ''}
    </HonestBlock>
  );
}

const TONES = {
  pos: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
  vio: 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-200',
  amb: 'bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100',
  mut: 'bg-axal-ground text-axal-muted dark:bg-gray-800 dark:text-gray-300',
};
export function Chip({ tone = 'mut', children, testId }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${TONES[tone] || TONES.mut}`} data-testid={testId}>{children}</span>;
}

/** A sentence the page says: amber for a pause, red for a refusal. */
export function Sentence({ tone = 'alert', children, testId }) {
  const cls = tone === 'amb' || tone === 'kill'
    ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100'
    : tone === 'ok'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-100'
      : 'border-red-200 bg-red-50 text-axal-destructive dark:border-red-800 dark:bg-red-900/20 dark:text-red-200';
  return (
    <p role={tone === 'alert' ? 'alert' : 'status'} className={`m-0 rounded-axal-md border px-3 py-2 text-[13px] font-semibold ${cls}`} data-testid={testId}>
      {children}
    </p>
  );
}

/** A progress bar with its words, never a bare bar. */
export function Progress({ done, total, words }) {
  const w = total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0;
  return (
    <span className="flex min-w-[110px] flex-col gap-1">
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" aria-hidden="true">
        <span className="block h-full rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${w}%` }} />
      </span>
      <span className={MUTED}>{words || 'No tasks yet'}</span>
    </span>
  );
}
