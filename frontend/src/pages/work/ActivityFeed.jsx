// D1614 W6 (#3974) — WK6, a project's activity feed on its Team page: what its
// people and AI agents did, newest first (W3's `GET /api/teams/project/:id/activity`).
// People · AI agents · Both, one person or agent, 50 a page by "Show older".
// Choosing a person or agent shows their "Worked on" and "Completed" lists and
// how many they completed in the last 7 days. An agent's run opens its run
// sheet. A company's Team page has no feed (the owner, 2026-11-01).
import React, { useCallback, useEffect, useState } from 'react';
import { BTN_SECONDARY, BTN_TEXT, MUTED, HonestBlock } from '../team/teamUi.jsx';
import { workAdapter } from './workAdapter.js';
import { FEED_WHO, feedRow } from './workModel.js';
import { RunSheet } from './WorkPage.jsx';

export default function ActivityFeed({ projectId }) {
  const [who, setWho] = useState('both');
  const [pick, setPick] = useState('');
  const [state, setState] = useState({ status: 'loading', items: [], next: null, lists: null });
  const [runUid, setRunUid] = useState(null);
  // The filter lists whoever the feed has named, by uid (a person is `{ uid, name }`, never an email).
  const [seen, setSeen] = useState({});
  const opts = useCallback((before) => {
    const [kind, uid] = pick.split(':');
    return { who, ...(kind === 'person' ? { person: uid } : kind === 'agent' ? { agent: uid } : {}), ...(before ? { before } : {}) };
  }, [who, pick]);
  const load = useCallback(async (before = null) => {
    if (!before) setState({ status: 'loading', items: [], next: null, lists: null });
    try {
      const r = await workAdapter.feed(projectId, opts(before));
      if (!r.available) { setState({ status: 'off', reason: r.reason, items: [], next: null, lists: null }); return; }
      setSeen((m) => {
        const next = { ...m };
        for (const i of r.data?.items || []) if (i?.by?.uid) next[`${i.by.kind}:${i.by.uid}`] = { kind: i.by.kind, name: i.by.name || 'Not recorded' };
        return next;
      });
      setState((s) => ({ status: 'ready', items: before ? [...s.items, ...(r.data?.items || [])] : (r.data?.items || []), next: r.data?.next_cursor || null, lists: r.data?.lists || null }));
    } catch { setState({ status: 'error', items: [], next: null, lists: null }); }
  }, [projectId, opts]);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="wk-feed" data-testid="team-activity">
      <div className="flex flex-wrap items-center gap-2">
        <span role="radiogroup" aria-label="Show" className="flex gap-1">
          {FEED_WHO.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={who === k} className={BTN_SECONDARY} onClick={() => setWho(k)} data-testid={`team-activity-who-${k}`}>{label}</button>
          ))}
        </span>
        <select aria-label="Person or agent" value={pick} onChange={(e) => setPick(e.target.value)} data-testid="team-activity-pick">
          <option value="">Everyone</option>
          {Object.entries(seen).map(([k, v]) => <option key={k} value={k}>{v.name}{v.kind === 'agent' ? ' · AI agent' : ''}</option>)}
        </select>
      </div>
      {state.lists ? (
        <div className="wk-feed-lists" data-testid="team-activity-lists">
          <p><b>Worked on</b> · {state.lists.worked_on.length ? state.lists.worked_on.map((t) => t.title).join(' · ') : 'None'}</p>
          <p><b>Completed</b> · {state.lists.completed.length ? state.lists.completed.map((t) => t.title).join(' · ') : 'None'}</p>
          <p className={MUTED}>{state.lists.completed_last_7_days} completed in the last 7 days</p>
        </div>
      ) : null}
      {state.status === 'loading' ? <p className={MUTED}>Reading…</p> : null}
      {state.status === 'off' ? <HonestBlock>{state.reason}</HonestBlock> : null}
      {state.status === 'error' ? <HonestBlock>The activity could not be read. That is not the same as nothing having happened.</HonestBlock> : null}
      {state.status === 'ready' && !state.items.length ? <p className={MUTED} data-testid="team-activity-empty">Nothing happened here yet.</p> : null}
      <ul className="wk-feed-rows">
        {state.items.map((i) => {
          const row = feedRow(i);
          return (
            <li key={i.id} data-testid="team-activity-row">
              <span>{row.text}</span>
              {row.cost ? <span className={MUTED}> · {row.cost}</span> : null}
              {row.run ? <button type="button" className={BTN_TEXT} onClick={() => setRunUid(row.run)} data-testid="team-activity-run">Open run</button> : null}
              <span className={MUTED}> · {row.at}</span>
            </li>
          );
        })}
      </ul>
      {state.next ? <button type="button" className={BTN_SECONDARY} onClick={() => load(state.next)} data-testid="team-activity-older">Show older</button> : null}
      {runUid ? <RunSheet uid={runUid} onClose={() => setRunUid(null)} /> : null}
    </section>
  );
}
