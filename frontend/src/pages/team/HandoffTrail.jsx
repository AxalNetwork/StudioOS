import React from 'react';
import { agentEngineApi } from '../../lib/api/agentEngine.js';
import { EYEBROW, HonestBlock, MUTED } from './teamUi.jsx';
import { AgentAvatar } from './AgentCard.jsx';
import { Chip, CouldNotRead, Reading, useEngineRead } from './EngineParts.jsx';
import { ENGINE_OFF, HANDOFFS_EMPTY, dayWord, holderName, loopWords, stepDecision, stepStatus } from './engineModel.js';

/**
 * D1531 (#3742 E8, TM13): the handoff trail, from `GET …/handoffs`. A project
 * draws it as Activity's "Handoffs" view; a company as a section of its Team
 * page. Each step: [agent] → [agent]: title · accepted by [person] · task
 * created. Depth is an indent (at most 3). A role nobody on the team holds
 * reads "No agent". A step carries no run or task uid, so there is no
 * "Open run" link. Refused loops are listed under the chains, in words.
 */
const TONE = { Accepted: 'pos', Waiting: 'amb', Refused: 'mut' };

function Who({ roleKey, team }) {
  const a = (team || []).find((x) => x?.role_key === roleKey && x?.status !== 'removed');
  const name = holderName(roleKey, team);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-axal-hairline px-1.5 py-0.5 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100">
      {a?.persona ? <AgentAvatar persona={a.persona} size={18} /> : null}
      {name || 'No agent'}
    </span>
  );
}

export default function HandoffTrail({ scope, id, team = [] }) {
  const read = useEngineRead(() => agentEngineApi.handoffs(scope, id), [scope, id], 'agent-engine:handoffs');
  const chains = Array.isArray(read.data?.chains) ? read.data.chains : [];
  const refused = chains.flatMap((c) => (Array.isArray(c.refused) ? c.refused : []));
  return (
    <section className="flex flex-col gap-3" aria-label="Handoffs" data-testid="handoff-trail">
      {read.status === 'loading' ? <Reading /> : null}
      {read.status === 'off' ? <HonestBlock>{ENGINE_OFF}</HonestBlock> : null}
      {read.status === 'error' || read.status === 'refused' ? <CouldNotRead text="Handoffs could not be read." onRetry={read.reload} testId="handoffs-error" /> : null}
      {read.status === 'ready' && !chains.length ? (
        <div className="flex flex-col gap-1 rounded-axal-lg border border-dashed border-axal-hairline px-5 py-6 dark:border-gray-700" data-testid="handoffs-empty">
          <b className="text-[14px] text-axal-ink dark:text-gray-100">{HANDOFFS_EMPTY.title}</b>
          <p className={`m-0 ${MUTED}`}>{HANDOFFS_EMPTY.body}</p>
        </div>
      ) : null}
      {chains.map((c, ci) => {
        const steps = Array.isArray(c.steps) ? c.steps : [];
        const started = dayWord(c.started_at || steps[0]?.at);
        return (
          <div key={c.uid || ci} role="list" aria-label={`Chain ${ci + 1}`} className="flex flex-col gap-1.5 rounded-axal-lg border border-axal-hairline bg-white p-3 dark:border-gray-700 dark:bg-gray-900" data-testid="handoff-chain">
            <p className={`m-0 ${EYEBROW}`}>Chain{started ? ` · started ${started}` : ''}</p>
            {steps.map((s) => {
              const st = stepStatus(s.status);
              return (
                <div key={s.uid} role="listitem" className="flex flex-wrap items-center gap-1.5 text-[13px] text-axal-ink dark:text-gray-100" style={{ paddingLeft: `${Math.min(3, Math.max(0, Number(s.depth) || 0)) * 20}px` }} data-testid="handoff-step">
                  <Who roleKey={s.from?.role_key} team={team} /><span aria-hidden="true">→</span><span className="sr-only">hands to</span><Who roleKey={s.to?.role_key} team={team} />
                  <span>: {s.title}</span>
                  <Chip tone={TONE[st]}>{st}</Chip>
                  <span className={MUTED}>{stepDecision(s)}</span>
                  {s.task_created ? <span className="text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">✓ task created</span> : null}
                </div>
              );
            })}
          </div>
        );
      })}
      {refused.length ? (
        <div className="flex flex-col gap-1" data-testid="handoffs-refused">
          <p className={`m-0 ${EYEBROW}`}>Refused loops</p>
          {refused.map((r, i) => <p key={i} className={`m-0 ${MUTED}`}>{loopWords(r)}</p>)}
        </div>
      ) : null}
    </section>
  );
}
