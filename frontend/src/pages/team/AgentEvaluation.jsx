import React, { useState } from 'react';
import { agentEngineApi } from '../../lib/api/agentEngine.js';
import { EYEBROW, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { CouldNotRead, Reading, Sentence, useEngineRead } from './EngineParts.jsx';
import {
  ENGINE_OFF, EVAL_EMPTY, EVAL_LINE, EVAL_TITLE, NO_LIVE_AGENT, evalRow, holderName, skillCheck,
} from './engineModel.js';

/**
 * D1531 (#3742 E8, TM14): "How agents are doing", in Team › AI agents. One row
 * per role, drawn as the persona that holds it; a role with no live agent
 * reads "An agent no longer on this team". Under 10 decisions a row says
 * "Too few decisions to rate (n)". 30 / 90 days is `?days=`. TM14b: the Axal
 * skills' golden cases — `skills: null` is "could not be read", `[]` is "No
 * Axal skills to check". On a phone the rows stack as cards.
 */
const HEAD = ['Agent', 'Accepted', 'Edited', 'Discarded', 'Median to decide', 'Open > 3 d', 'Expired', 'Cost per accepted', 'Refusals'];

export default function AgentEvaluation({ scope, id, team = [] }) {
  const [days, setDays] = useState(30);
  const read = useEngineRead(() => agentEngineApi.evaluation(scope, id, { days }), [scope, id, days], 'agent-engine:evaluation');
  const rows = (Array.isArray(read.data?.roles) ? read.data.roles : []).map(evalRow);
  const skills = read.data ? read.data.skills : undefined;
  return (
    <section className="flex flex-col gap-3 rounded-axal-lg border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900" aria-label={EVAL_TITLE} data-testid="agent-evaluation">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{EVAL_TITLE}</h2>
          <p className={`m-0 ${MUTED}`}>{EVAL_LINE}</p>
        </div>
        <div role="radiogroup" aria-label="Days" className="flex gap-1 rounded-[9px] border border-axal-hairline p-0.5 dark:border-gray-700">
          {[30, 90].map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} data-testid={`eval-days-${d}`}
              className={`h-8 rounded-[7px] px-3 text-[12.5px] font-semibold ${days === d ? 'bg-axal-ink text-white dark:bg-gray-100 dark:text-gray-900' : 'text-axal-muted dark:text-gray-400'}`}>{d} days</button>
          ))}
        </div>
      </div>
      {read.status === 'loading' ? <Reading /> : null}
      {read.status === 'off' ? <HonestBlock>{ENGINE_OFF}</HonestBlock> : null}
      {read.status === 'error' || read.status === 'refused' ? <CouldNotRead text="How agents are doing could not be read." second="" onRetry={read.reload} testId="eval-error" /> : null}
      {read.status === 'ready' && !rows.length ? (
        <div className="flex flex-col gap-1" data-testid="eval-empty"><b className="text-[14px] text-axal-ink dark:text-gray-100">{EVAL_EMPTY.title}</b><p className={`m-0 ${MUTED}`}>{EVAL_EMPTY.body}</p></div>
      ) : null}
      {read.status === 'ready' && rows.length ? (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[880px] border-collapse text-left text-[13px]" data-testid="eval-table">
              <thead><tr className={EYEBROW}>{HEAD.map((h) => <th key={h} scope="col" className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.role_key} className="border-t border-axal-hairline align-top dark:border-gray-800" data-testid="eval-row">
                    <td className="px-2 py-2 font-bold text-axal-ink dark:text-gray-100">{holderName(r.role_key, team) || NO_LIVE_AGENT}</td>
                    {r.rated
                      ? <><td className={`px-2 py-2 ${MONO}`}>{r.accepted}</td><td className={`px-2 py-2 ${MONO}`}>{r.edited}</td><td className={`px-2 py-2 ${MONO}`}>{r.discarded}</td></>
                      : <td colSpan={3} className={`px-2 py-2 ${MUTED}`} data-testid="eval-too-few">{r.note}</td>}
                    <td className={`px-2 py-2 ${MONO}`}>{r.median}</td>
                    <td className={`px-2 py-2 ${MONO}`}>{r.open}</td>
                    <td className={`px-2 py-2 ${MONO}`}>{r.expired}</td>
                    <td className={`px-2 py-2 ${MONO}`}>{r.cost}</td>
                    <td className="px-2 py-2">{r.refused.length ? r.refused.map((x, i) => <span key={i} className={`block ${MUTED}`}>{x.text} ×{x.n}</span>) : <span className={MUTED}>None</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 md:hidden" data-testid="eval-cards">
            {rows.map((r) => (
              <div key={r.role_key} className="flex flex-col gap-1 rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700">
                <b className="text-[13.5px] text-axal-ink dark:text-gray-100">{holderName(r.role_key, team) || NO_LIVE_AGENT}</b>
                {r.rated ? <span className={MONO}>Accepted {r.accepted} · Edited {r.edited} · Discarded {r.discarded}</span> : <span className={MUTED}>{r.note}</span>}
                <span className={MONO}>Median {r.median} · Open &gt; 3 d {r.open} · Expired {r.expired} · Per accepted {r.cost}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {read.status === 'ready' ? (
        <div className="flex flex-col gap-1.5" data-testid="eval-skills">
          <p className={`m-0 ${EYEBROW}`}>Skill checks · golden cases</p>
          {skills === null ? <Sentence>Skill checks could not be read.</Sentence> : null}
          {Array.isArray(skills) && !skills.length ? <p className={`m-0 ${MUTED}`}>No Axal skills to check</p> : null}
          {(Array.isArray(skills) ? skills : []).map((s) => {
            const k = skillCheck(s);
            return (
              <div key={s.skill_uid || k.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-axal-md border border-axal-hairline px-3 py-2 text-[13px] dark:border-gray-700">
                <b className="text-axal-ink dark:text-gray-100">{k.name}</b>
                <span className={MONO}>{k.cases}</span>
                {k.notRun ? <span className={MUTED}>{k.notRun} not run</span> : null}
                <span className={MUTED}>{k.last}</span>
                <span className={k.regressions === 'No regressions' ? MUTED : 'font-semibold text-axal-destructive dark:text-red-300'}>{k.regressions}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
