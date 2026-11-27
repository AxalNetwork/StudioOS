// D1585 (#3832, deck v2 F6) — "Prep" on an investor meeting in the Calendar
// item drawer: the prospect's brief, read when the founder presses Prep. It is
// read from what the venture recorded (`GET /api/cycles/raise/prospects/:id/brief`);
// no model runs, so nothing is quoted or charged. The words are in
// calendarPrepModel.js.
import { useState } from 'react';
import { prospectBriefApi } from '../lib/api/prospectBrief';
import { Unreadable, actionGhost } from '../ui';
import { PREP_WORDS, linkLine, meetingLine, nextStepLine, objectionLine, whoLine } from './calendarPrepModel';

const INK = 'text-axal-ink dark:text-gray-200';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SECTION = 'flex flex-col gap-1.5 border-t border-axal-hairline px-5 py-3.5 dark:border-gray-700';

function Part({ title, part, testId, children }) {
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <h4 className={`m-0 ${EYEBROW}`}>{title}</h4>
      {part && part.state === 'unreadable'
        ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid={`${testId}-unreadable`}>{PREP_WORDS.unreadablePart}</p>
        : children}
    </div>
  );
}

const List = ({ items, testId }) => (
  <ul className="m-0 flex list-none flex-col gap-1 p-0">
    {items.map((t, i) => <li key={i} className={`text-[12.5px] ${INK}`} data-testid={testId}>{t}</li>)}
  </ul>
);

export default function CalendarPrep({ projectId, prospectId, eventId }) {
  const [read, setRead] = useState({ status: 'idle', brief: null });
  const load = async () => {
    setRead({ status: 'loading', brief: null });
    try { setRead({ status: 'ok', brief: await prospectBriefApi.get(projectId, prospectId, eventId) }); }
    catch { setRead({ status: 'error', brief: null }); }
  };
  const b = read.brief;
  return (
    <section className={SECTION} data-testid="cal-item-prep">
      <div className="flex items-center justify-between gap-2">
        <h3 className={`m-0 ${EYEBROW}`}>Prep</h3>
        {read.status === 'idle' ? <button type="button" className={actionGhost} onClick={load} data-testid="cal-item-prep-open">{PREP_WORDS.button}</button> : null}
      </div>
      {read.status === 'loading' ? <p className={`m-0 text-[12.5px] ${MUTED}`}>{PREP_WORDS.reading}</p> : null}
      {read.status === 'error' ? <Unreadable what="The brief" claim="That is not the same as there being nothing to know." onRetry={load} /> : null}
      {b ? (
        <div className="flex flex-col gap-3" data-testid="cal-item-prep-brief">
          <p className={`m-0 text-[13px] font-semibold ${INK}`} data-testid="cal-prep-who">{whoLine(b.prospect)}</p>
          {b.prospect?.warm_path ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="cal-prep-warm">Warm path · {b.prospect.warm_path}</p> : null}
          {nextStepLine(b.prospect) ? <p className={`m-0 text-[12.5px] ${INK}`} data-testid="cal-prep-next">Next step · {nextStepLine(b.prospect)}</p> : null}
          <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="cal-prep-last">{meetingLine(b.last_met, 'Last met') || PREP_WORDS.noLastMet}</p>
          <Part title="What they raised" part={b.objections} testId="cal-prep-theirs">
            {b.objections?.theirs?.length
              ? <List items={b.objections.theirs.map((o) => objectionLine(o, true))} testId="cal-prep-objection" />
              : <p className={`m-0 text-[12.5px] ${MUTED}`}>{PREP_WORDS.noTheirs}</p>}
          </Part>
          {b.objections?.state === 'ok' && b.objections.elsewhere?.length ? (
            <Part title="Heard from other investors" part={b.objections} testId="cal-prep-elsewhere">
              <List items={b.objections.elsewhere.map((o) => objectionLine(o, false))} testId="cal-prep-elsewhere-item" />
            </Part>
          ) : null}
          <Part title="Your deck" part={b.deck} testId="cal-prep-deck">
            {b.deck?.links?.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {b.deck.links.map((l) => (
                  <li key={l.link_id} className={`text-[12.5px] ${INK}`} data-testid="cal-prep-link">
                    {linkLine(l)}
                    {l.signals?.length ? <span className={MUTED} data-testid="cal-prep-signals"> · {l.signals.map((s) => s.words).join(' · ')}</span> : null}
                  </li>
                ))}
              </ul>
            ) : <p className={`m-0 text-[12.5px] ${MUTED}`}>{PREP_WORDS.noLinks}</p>}
          </Part>
          <Part title="Latest steps" part={b.timeline} testId="cal-prep-timeline">
            {b.timeline?.items?.length
              ? <List items={b.timeline.items.map((t) => `${String(t.at).slice(0, 10)} · ${t.kind}${t.note ? ` · ${t.note}` : ''}`)} testId="cal-prep-step" />
              : <p className={`m-0 text-[12.5px] ${MUTED}`}>{PREP_WORDS.noTimeline}</p>}
          </Part>
          <p className={`m-0 text-[11px] ${MUTED}`} data-testid="cal-prep-basis">{b.basis}</p>
        </div>
      ) : null}
    </section>
  );
}
