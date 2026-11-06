import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { agentEngineApi } from '../../lib/api/agentEngine.js';
import { reportError } from '../../lib/log';
import { BTN_DANGER, BTN_SECONDARY, BTN_TEXT, EYEBROW, FIELD, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { Chip, CouldNotRead, Reading, Sentence, useEngineRead } from './EngineParts.jsx';
import { Lightbox } from '../../ui';
import {
  DUTIES_EMPTY, ENGINE_OFF, MEMORY_EMPTY, NOTE_LIMIT, cadenceWord, dayWord, dutyMonth, dutyOutcome, forgetAllTitle, forgotLine,
  moduleWord, noteCount, noteKind, noteLine, noteProblem, refusalSentence, retentionLine,
} from './engineModel.js';

/**
 * D1531 (#3742 E8, TM5m): two sections of the AG5 agent profile.
 *
 *   AgentMemory  what the agent remembers about this team: each note's kind,
 *                text, who added it, when, and how long it is kept; a manager
 *                adds a fact (at most 1,000 characters), forgets one, or
 *                forgets everything after a confirm. The retention line is the
 *                Worker's. A reader sees the notes and no Forget, no Add.
 *   AgentDuties  its scheduled duties (template duties only): cadence, next
 *                run, status, last outcome as a sentence and its cost a month
 *                ("Not recorded", never $0). Calendar sessions are not listed;
 *                the only link out is "See and schedule on the Calendar".
 */
export function AgentMemory({ uid, canManage = false }) {
  const read = useEngineRead(() => agentEngineApi.memory(uid), [uid], 'agent-engine:memory');
  const [draft, setDraft] = useState('');
  const [said, setSaid] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const notes = Array.isArray(read.data?.notes) ? read.data.notes : [];
  const problem = draft ? noteProblem(draft) : null;
  const act = async (call, done) => {
    setBusy(true); setSaid(null);
    try { const r = await call(); done?.(r); read.reload(); } catch (e) { setSaid({ tone: 'alert', text: refusalSentence(e) }); reportError('agent-engine:memory-write', e); } finally { setBusy(false); }
  };
  return (
    <section className="flex flex-col gap-2.5" aria-label="Memory" data-testid="agent-memory">
      <h3 className="m-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">Memory</h3>
      {read.status === 'loading' ? <Reading /> : null}
      {read.status === 'off' ? <HonestBlock>{ENGINE_OFF}</HonestBlock> : null}
      {read.status === 'error' || read.status === 'refused' ? <CouldNotRead text="Memory could not be read." second="" onRetry={read.reload} testId="memory-error" /> : null}
      {read.status === 'ready' && !notes.length ? <p className={`m-0 ${MUTED}`} data-testid="memory-empty">{MEMORY_EMPTY}</p> : null}
      {notes.length ? (
        <div role="list" className="flex flex-col gap-1.5">
          {notes.map((n) => (
            <div key={n.uid} role="listitem" className="flex items-start gap-2 rounded-axal-md border border-axal-hairline px-3 py-2 dark:border-gray-700" data-testid="memory-note">
              <Chip tone={n.kind === 'decision' ? 'vio' : 'mut'}>{noteKind(n.kind)}</Chip>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13px] text-axal-ink dark:text-gray-100">{n.body}</span>
                <span className={MUTED}>{noteLine(n)}</span>
              </span>
              {canManage ? <button type="button" className={BTN_TEXT} disabled={busy} onClick={() => act(() => agentEngineApi.forgetMemory(n.uid))} data-testid="memory-forget">Forget this</button> : null}
            </div>
          ))}
        </div>
      ) : null}
      {canManage && read.status === 'ready' ? (
        <div className="flex flex-col gap-1.5">
          <p className={`m-0 ${EYEBROW}`}>Add a fact</p>
          <textarea className={`${FIELD} h-20 py-2`} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Something the agent should remember about this team" aria-label="A fact to remember" data-testid="memory-draft" />
          <span className="flex items-center justify-between gap-2">
            <span className={problem ? 'text-[12.5px] font-semibold text-axal-destructive dark:text-red-300' : MUTED} role={problem ? 'alert' : undefined}>{problem || ''}</span>
            <span className={`${MONO} ${draft.length > NOTE_LIMIT ? 'text-axal-destructive dark:text-red-300' : ''}`}>{noteCount(draft)}</span>
          </span>
          <span className="flex gap-2">
            <button type="button" className={BTN_SECONDARY} disabled={busy || !!noteProblem(draft)} title={noteProblem(draft) || undefined}
              onClick={() => act(() => agentEngineApi.addMemoryFact(uid, { body: draft.trim() }), () => setDraft(''))} data-testid="memory-add">Add note</button>
            {notes.length ? <button type="button" className={BTN_DANGER} disabled={busy} onClick={() => setConfirm(true)} data-testid="memory-forget-all">Forget everything</button> : null}
          </span>
        </div>
      ) : null}
      {said ? <Sentence tone={said.tone} testId="memory-said">{said.text}</Sentence> : null}
      {read.status === 'ready' ? <p className={`m-0 ${MUTED}`} data-testid="memory-retention">{retentionLine(read.data?.retention)}</p> : null}
      {confirm ? (
        <Lightbox label="Forget all notes?" title="Forget all notes?" width={480} onClose={() => setConfirm(false)} testId="memory-forget-all-confirm"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={() => setConfirm(false)}>Cancel</button>
              <button type="button" className={BTN_DANGER} data-testid="memory-forget-all-yes"
                onClick={() => { setConfirm(false); act(() => agentEngineApi.forgetAllMemory(uid), (r) => setSaid({ tone: 'ok', text: forgotLine(r?.forgotten ?? notes.length) })); }}>Forget everything</button>
            </div>
          )}>
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{forgetAllTitle(notes.length)}</p>
        </Lightbox>
      ) : null}
    </section>
  );
}

export function AgentDuties({ uid }) {
  const read = useEngineRead(() => agentEngineApi.duties(uid), [uid], 'agent-engine:duties');
  const duties = Array.isArray(read.data?.duties) ? read.data.duties : [];
  return (
    <section className="flex flex-col gap-2.5" aria-label="Scheduled duties" data-testid="agent-duties">
      <h3 className="m-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">Scheduled duties</h3>
      {read.status === 'loading' ? <Reading /> : null}
      {read.status === 'off' ? <HonestBlock>{ENGINE_OFF}</HonestBlock> : null}
      {read.status === 'error' || read.status === 'refused' ? <CouldNotRead text="Scheduled duties could not be read." second="" onRetry={read.reload} testId="duties-error" /> : null}
      {read.status === 'ready' && !duties.length ? <p className={`m-0 ${MUTED}`} data-testid="duties-empty">{DUTIES_EMPTY}</p> : null}
      {duties.map((d) => (
        <div key={d.uid} className="grid grid-cols-1 gap-1 rounded-axal-md border border-axal-hairline px-3 py-2 sm:grid-cols-[1fr_auto] dark:border-gray-700" data-testid="duty-row">
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{d.title || 'Duty'}</span>
            <span className={MUTED}>{[d.module ? moduleWord(d.module) : null, cadenceWord(d.cadence), d.next_due_at ? `next ${dayWord(d.next_due_at) || '—'}` : null].filter(Boolean).join(' · ')}</span>
            <span className={MUTED}>{dutyOutcome(d.last_outcome)}</span>
          </span>
          <span className="flex items-center gap-2 sm:flex-col sm:items-end">
            <Chip tone={d.status === 'paused' ? 'amb' : 'pos'}>{d.status === 'paused' ? 'Paused' : 'Active'}</Chip>
            <span className={MONO}>{dutyMonth(d.est_month)}</span>
          </span>
        </div>
      ))}
      {read.status === 'ready' ? <p className={`m-0 ${MUTED}`}>Calendar sessions are not listed here. <Link to="/calendar" className={BTN_TEXT}>See and schedule on the Calendar</Link></p> : null}
    </section>
  );
}
