import React, { useState } from 'react';
import { agentEngineApi } from '../../lib/api/agentEngine.js';
import { BTN_SECONDARY, BTN_TEXT, MUTED } from './teamUi.jsx';
import { useEngineRead } from './EngineParts.jsx';
import { MOVES_ERROR, moveKey, moveNotice } from './engineModel.js';

/**
 * D1531 (#3742 E8, TM18): the notice a team sees after a project moved, from
 * `GET …/moves?limit=5`. The project's side: moved between companies, joined
 * one (incorporation) or left for standalone, "Its agents stayed with the
 * project." The old company's side says how many tasks were blocked; the new
 * company's side offers "Suggest a company team" (TM15). Dismiss is kept in
 * this browser only; the move itself stays in TM1g2 / TM1h's confirms. With
 * no moves, or while they cannot be read, no notice is drawn (an unreadable
 * read says so once, quietly).
 */
const seen = (k) => { try { return window.localStorage.getItem(k) === '1'; } catch { return false; } };
const keep = (k) => { try { window.localStorage.setItem(k, '1'); } catch { /* this browser keeps nothing */ } };

export default function MoveNotices({ scope, id, onSuggest = null }) {
  const read = useEngineRead(() => agentEngineApi.moves(scope, id, { limit: 5 }), [scope, id], 'agent-engine:moves');
  const [gone, setGone] = useState(() => new Set());
  if (read.status === 'error') return <p className={`m-0 ${MUTED}`} data-testid="moves-error">{MOVES_ERROR.title} {MOVES_ERROR.body}</p>;
  if (read.status !== 'ready') return null;
  const side = scope === 'company' ? 'company' : 'project';
  const moves = (Array.isArray(read.data?.moves) ? read.data.moves : []).filter((m) => !gone.has(moveKey(m)) && !seen(moveKey(m)));
  if (!moves.length) return null;
  const m = moves[0];
  const n = moveNotice(m, { side });
  const dismiss = () => { keep(moveKey(m)); setGone((s) => new Set(s).add(moveKey(m))); };
  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-axal-md border px-3 py-2 text-[13px] ${n.tone === 'amb' ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100' : 'border-axal-hairline bg-axal-lavender text-axal-ink dark:border-gray-700 dark:bg-violet-900/20 dark:text-gray-100'}`} data-testid="move-notice">
      <span className="font-semibold">{n.text}</span>
      <span className={MUTED}>{n.by}</span>
      <span className="ml-auto flex gap-2">
        {n.suggest && onSuggest ? <button type="button" className={BTN_SECONDARY} onClick={onSuggest} data-testid="move-suggest">Suggest a company team</button> : null}
        <button type="button" className={BTN_TEXT} onClick={dismiss} data-testid="move-dismiss">Dismiss</button>
      </span>
    </div>
  );
}
