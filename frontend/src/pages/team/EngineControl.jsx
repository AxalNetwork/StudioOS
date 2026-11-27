import React, { useState } from 'react';
import { Lightbox } from '../../ui';
import { agentEngineApi } from '../../lib/api/agentEngine.js';
import { reportError } from '../../lib/log';
import { BTN_PRIMARY, BTN_SECONDARY, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { CouldNotRead, Reading, Sentence, useEngineRead } from './EngineParts.jsx';
import {
  ENGINE_LINE, ENGINE_OFF, ENGINE_READER, ENGINE_TITLE, PAUSE_CONFIRM, PAUSE_TEAM, PAUSE_TEAM_HINT, TEAM_PAUSED,
  autonomyWord, engineBanner, parallelLine, refusalSentence, startLine,
} from './engineModel.js';

/**
 * D1531 (#3742 E8, TM19): the engine's states.
 *
 *   EngineControl  TM19a, Team › Settings: pause this team's agents (a confirm
 *                  first), how many run at once (1 to 5) and who starts a task
 *                  ("Set by Axal VC"). A reader sees the settings and no
 *                  controls.
 *   EngineBanner   TM19b: the kill switch, the engine pause or canary, and a
 *                  team pause, on Work and anywhere else that lacked it.
 *   StartTask      TM19f, the Work item sheet: the quote first ("Start ·
 *                  ~$0.04", "Holds up to $0.04 · you pay what it uses"), then
 *                  running, and every refusal as its own sentence.
 */
export default function EngineControl({ scope, id, canManage = false }) {
  const read = useEngineRead(() => agentEngineApi.engine(scope, id), [scope, id], 'agent-engine:engine');
  const [confirm, setConfirm] = useState(false);
  const [said, setSaid] = useState(null);
  const [busy, setBusy] = useState(false);
  const e = read.data;
  const write = async (body) => {
    setBusy(true); setSaid(null);
    try {
      await agentEngineApi.setEngine(scope, id, body);
      setConfirm(false); read.reload();
    } catch (err) {
      setSaid(refusalSentence(err, 'The setting was not saved. Try again.'));
      reportError('agent-engine:set-engine', err);
    } finally { setBusy(false); }
  };
  const n = Math.min(5, Math.max(1, Number(e?.max_parallel_runs) || 1));
  return (
    <section className="flex flex-col gap-3 rounded-axal-lg border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900" aria-label={ENGINE_TITLE} data-testid="engine-control">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{ENGINE_TITLE}</h2>
        <p className={`m-0 ${MUTED}`}>{ENGINE_LINE}</p>
      </div>
      {read.status === 'loading' ? <Reading /> : null}
      {read.status === 'off' ? <HonestBlock>{ENGINE_OFF}</HonestBlock> : null}
      {read.status === 'error' || read.status === 'refused' ? <CouldNotRead text="These settings could not be read." onRetry={read.reload} second="" /> : null}
      {read.status === 'ready' && e ? (
        <>
          {e.scope_paused ? <Sentence tone="amb" testId="engine-team-paused">{TEAM_PAUSED}</Sentence> : null}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800">
            <span className="flex flex-col"><b className="text-[13.5px] text-axal-ink dark:text-gray-100">{PAUSE_TEAM}</b><span className={MUTED}>{PAUSE_TEAM_HINT}</span></span>
            <button type="button" role="switch" aria-checked={!!e.scope_paused} aria-label={PAUSE_TEAM} disabled={!canManage || busy}
              onClick={() => (e.scope_paused ? write({ paused: false }) : setConfirm(true))} data-testid="engine-pause"
              className={`relative h-6 w-11 rounded-full transition disabled:opacity-50 ${e.scope_paused ? 'bg-axal-violet dark:bg-violet-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition dark:bg-gray-100 ${e.scope_paused ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800">
            <span className="flex flex-col"><b className="text-[13.5px] text-axal-ink dark:text-gray-100">{parallelLine(n)}</b><span className={MUTED}>A whole number from 1 to 5.</span></span>
            <span className="flex items-center gap-1" role="group" aria-label="Agents at once">
              <button type="button" className={BTN_SECONDARY} disabled={!canManage || busy || n <= 1} onClick={() => write({ max_parallel_runs: n - 1 })} aria-label="One fewer" data-testid="engine-fewer">−</button>
              <span className={`w-8 text-center ${MONO}`} data-testid="engine-parallel">{n}</span>
              <button type="button" className={BTN_SECONDARY} disabled={!canManage || busy || n >= 5} onClick={() => write({ max_parallel_runs: n + 1 })} aria-label="One more" data-testid="engine-more">+</button>
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800">
            <span className="flex flex-col"><b className="text-[13.5px] text-axal-ink dark:text-gray-100">Who starts a task</b><span className={MUTED}>{autonomyWord(e.autonomy)}</span></span>
            <span className={MUTED}>Set by Axal VC</span>
          </div>
          {!canManage ? <p className={`m-0 ${MUTED}`} data-testid="engine-reader">{ENGINE_READER}</p> : null}
          {said ? <Sentence testId="engine-refused">{said}</Sentence> : null}
        </>
      ) : null}
      {confirm ? (
        <Lightbox label={PAUSE_CONFIRM.title} title={PAUSE_CONFIRM.title} width={520} onClose={() => setConfirm(false)} testId="engine-pause-confirm"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={() => setConfirm(false)}>Cancel</button>
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => write({ paused: true })} data-testid="engine-pause-yes">Pause agents</button>
            </div>
          )}>
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{PAUSE_CONFIRM.body}</p>
        </Lightbox>
      ) : null}
    </section>
  );
}

/** TM19b: the engine's banner for a scope; nothing when nothing is paused or it cannot be read. */
export function EngineBanner({ scope, id }) {
  const read = useEngineRead(() => agentEngineApi.engine(scope, id), [scope, id], 'agent-engine:engine-banner');
  const b = read.status === 'ready' ? engineBanner(read.data) : null;
  if (!b) return null;
  return <Sentence tone="amb" testId={`engine-banner-${b.tone}`}>{b.text}</Sentence>;
}

/** TM19f: Start this task, the quote first. */
export function StartTask({ task, agentName = 'This agent', onStarted }) {
  const quote = useEngineRead(() => agentEngineApi.taskQuote(task.uid), [task.uid], 'agent-engine:task-quote');
  const [state, setState] = useState({ status: 'idle' });
  const line = startLine(quote.data?.quote);
  // A 4xx quote is a refusal with its own sentence; anything else leaves Start on with "Cost can’t be estimated right now".
  const qs = Number(quote.error?.status ?? quote.error?.response?.status ?? 0);
  const quoteRefused = (quote.status === 'error' || quote.status === 'refused') && qs >= 400 && qs < 500 ? refusalSentence(quote.error) : null;
  const start = async () => {
    setState({ status: 'running' });
    try {
      const r = await agentEngineApi.startTask(task.uid);
      setState({ status: 'started', run: r?.run || null });
      onStarted?.(r?.run || null);
    } catch (e) {
      const code = String(e?.data?.code || e?.code || '');
      setState({ status: 'refused', text: refusalSentence(e), tone: ['engine_paused', 'scope_paused', 'platform_paused', 'halted', 'gateway_limit'].includes(code) ? 'amb' : 'alert' });
      reportError('agent-engine:task-start', e);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700" data-testid="start-task">
      <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Start this task · {agentName}</span>
      <span className={MUTED} data-testid="start-hint">{quote.status === 'loading' ? 'Reading…' : quoteRefused || line.hint}</span>
      {state.status === 'running' ? <span role="status" className={MUTED}>Running…</span> : null}
      {state.status === 'started' ? <Sentence tone="ok" testId="start-started">Started. Its proposal waits in Approvals.</Sentence> : (
        <button type="button" className={`${BTN_PRIMARY} self-start`} onClick={start} disabled={state.status === 'running' || quote.status === 'loading' || !!quoteRefused}
          title={quoteRefused || undefined} data-testid="start-button">{line.button}</button>
      )}
      {state.status === 'refused' ? <Sentence tone={state.tone} testId="start-refused">{state.text}</Sentence> : null}
    </div>
  );
}
