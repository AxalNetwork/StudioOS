// D1225 (#3224) — CLS11, one recipient of the founder's call, opened from its
// row. A chosen investor, or a matching one who has responded, shows who they
// are, whether Axal told them, their furthest step, the amount they indicated
// (indicative, never a commitment), their timeline and their questions. A
// matching investor who has not responded stays nameless: why they match, and
// that their name appears once they respond. Nothing the read lacks is drawn.
import React from 'react';
import { Link } from 'react-router-dom';
import Lightbox from '../../ui/Lightbox';
import {
  HIDDEN, INDICATIVE, NAME_HIDDEN, NOT_RECORDED, furthestOf, isNamed, money, notTold, questionsOf, shortDay, timelineOf, told,
} from './raiseCallModel';

const MUTED = 'text-xs text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
const ROW = 'flex items-center justify-between gap-3 border-t border-axal-hairline py-2 text-sm dark:border-gray-700';

function Kv({ k, children, testId }) {
  return <div className={ROW} data-testid={testId}><span className="text-axal-muted dark:text-gray-400">{k}</span><span className="text-right text-axal-ink dark:text-gray-100">{children}</span></div>;
}

export function toldLine(r) {
  if (told(r)) return 'Told on Axal';
  if (notTold(r)) return 'Not told';
  return NOT_RECORDED;
}

export default function CallRecipientDrawer({ recipient: r, questions, projectId, onClose }) {
  const named = isNamed(r);
  const eyebrow = `Recipient · ${r.origin === 'chosen' ? 'chosen' : 'matching'}`;
  const title = named ? r.name : 'Matching investor';
  return (
    <Lightbox label={title} eyebrow={eyebrow} title={title} onClose={onClose} width={560} testId="call-recipient-drawer">
      {named ? (
        <div className="flex flex-col gap-4">
          <div>
            <Kv k="Email" testId="call-recipient-email">{r.email || NOT_RECORDED}</Kv>
            <Kv k="Told on Axal" testId="call-recipient-told">{toldLine(r)}</Kv>
            <Kv k="Furthest response" testId="call-recipient-furthest">{furthestOf(r).label}</Kv>
          </div>
          {r.commitment_cents != null ? (
            <section className="flex flex-col gap-1.5 rounded-xl border border-axal-hairline p-3 dark:border-gray-700" data-testid="call-recipient-amount">
              <span className={EYEBROW}>Amount indicated</span>
              <span className="font-mono text-[22px] font-bold text-axal-ink dark:text-gray-100">{money(r.commitment_cents)} <span className="text-xs font-semibold text-axal-muted dark:text-gray-400">Recorded</span></span>
              <span className={MUTED}>{INDICATIVE}</span>
            </section>
          ) : null}
          <section data-testid="call-recipient-timeline">
            <span className={EYEBROW}>Responses</span>
            {timelineOf(r).length ? timelineOf(r).map((t) => (
              <div key={t.label} className={ROW}>
                <span className="flex flex-col"><span className="font-semibold">{t.label}</span>{t.sub ? <span className={MUTED}>{t.sub}</span> : null}</span>
                <span className="font-mono text-xs text-axal-muted dark:text-gray-400">{shortDay(t.at) || NOT_RECORDED}</span>
              </div>
            )) : <p className={`m-0 mt-1 ${MUTED}`}>Nothing yet. They have not opened the call.</p>}
          </section>
          <section data-testid="call-recipient-questions">
            <span className={EYEBROW}>Their questions</span>
            {questionsOf(r, questions).length ? questionsOf(r, questions).map((q) => (
              <div key={q.uid} className="flex flex-col gap-1 border-t border-axal-hairline py-2 dark:border-gray-700">
                <span className="text-sm font-semibold">“{q.question}”</span>
                <span className={MUTED}>{q.answer ? `Answered${shortDay(q.answered_at) ? ` ${shortDay(q.answered_at)}` : ''}: ${q.answer}` : 'Not answered yet'}</span>
              </div>
            )) : <p className={`m-0 mt-1 ${MUTED}`}>No questions from them.</p>}
          </section>
          <Link to={`/raise/capital-relationships?project_id=${encodeURIComponent(projectId)}`} className="inline-flex min-h-[36px] items-center self-start rounded-lg bg-axal-violet px-3.5 text-sm font-semibold text-white dark:bg-violet-600" data-testid="call-recipient-caprel">Open in Capital relationships</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-sm text-axal-muted dark:text-gray-400">{NAME_HIDDEN}</p>
          <section className="flex flex-col gap-2" data-testid="call-recipient-reasons">
            <span className={EYEBROW}>Why they match</span>
            {r.reasons?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {r.reasons.map((x) => <span key={x} className="rounded-full border border-axal-hairline px-2 py-0.5 text-xs font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100">{x}</span>)}
              </div>
            ) : <span className={MUTED}>{NOT_RECORDED}</span>}
          </section>
          <div>
            <Kv k="Opened" testId="call-recipient-opened">{HIDDEN}</Kv>
            <Kv k="Told on Axal" testId="call-recipient-told">{toldLine(r)}</Kv>
          </div>
          <p className="m-0 rounded-lg border border-axal-hairline bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800">Their name, firm and email appear here once they ask for the data room, ask a question or indicate an amount.</p>
          <button type="button" className="inline-flex min-h-[36px] items-center self-start rounded-lg border border-axal-hairline bg-white px-3.5 text-sm font-semibold dark:border-gray-700 dark:bg-gray-900" onClick={onClose} data-testid="call-recipient-close">Close</button>
        </div>
      )}
    </Lightbox>
  );
}
