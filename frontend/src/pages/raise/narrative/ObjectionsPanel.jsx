import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { narrativeApi } from '../../../lib/api/narrative';
import { reportError } from '../../../lib/log';
import { Lightbox } from '../../../ui';
import {
  ANSWER_FOOT, ANSWERS_UNREADABLE, OBJECTIONS_CAPPED, OBJECTIONS_FROM, OBJECTIONS_NONE, OBJECTIONS_UNREADABLE,
  answerItHref, clearDialog, markDialog, objectionRow, objectionsOf,
} from './narrativeModel';

/**
 * D913 (#2697) — the objections investors raised, counted from Capital
 * relationships' feedback (`GET /narrative/objections`):
 *   - `ObjectionsPanel`, NAR10, the panel beside Story's writing surface. It
 *     reads on its own; "Answer it" asks Eadwyn to draft the open section so it
 *     answers that objection (`onAnswer`), which writes nothing.
 *   - `ObjectionsCard`, NAR1's "Objections heard" on Home, from the module
 *     read's `parts.narrative.objections`; its "Answer it" opens Story on it.
 * A failed read says so, never an empty list. An admin reads, with no Answer it.
 *
 * Option A (migration 624): an objection a saved section answers shows
 * "Answered in [Section] ›", which opens Story on that version and section.
 * On Story the founder can also mark one answered by hand in the open section
 * (`picked`) or clear it, each through a dialog that says what it changes.
 * When which section answers each one could not be read, the panel says so
 * and offers neither.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const ASK = 'inline-flex w-fit shrink-0 items-center rounded-[9px] border border-axal-lavender-edge bg-axal-lavender px-3 py-1.5 text-[12px] font-bold text-axal-violet disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300';
const GHOST = 'inline-flex w-fit items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const BTN = 'inline-flex w-fit items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50';
const SMALL = 'text-[11.5px] font-semibold text-axal-muted underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400';

function Head({ count }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
      <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Objections heard</h2>
      <span className={`text-[11.5px] ${MUTED}`}>{OBJECTIONS_FROM}{count != null ? ` · ${count}` : ''}</span>
    </div>
  );
}

/** "✓ Answered in [Section] ›", with its version, how and when beneath. */
function Answered({ answered, testId }) {
  return (
    <span className="flex flex-col gap-0.5">
      <Link className={`${LINK} text-[12px]`} to={answered.href} data-testid={testId}>✓ {answered.label} ›</Link>
      <span className={`text-[11px] ${MUTED}`}>{answered.sub}</span>
    </span>
  );
}

function Body({ view, onRetry, row, search = '' }) {
  if (view.status === 'loading') return <div className="m-4 h-16 animate-pulse rounded-lg bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="objections-loading" />;
  if (view.status !== 'ok') {
    return (
      <div role="alert" className="flex flex-col gap-2 px-4 py-3" data-testid="objections-unreadable">
        <span className="text-[12.5px] text-red-700 dark:text-red-300">{OBJECTIONS_UNREADABLE}</span>
        {onRetry ? <button type="button" className={GHOST} onClick={onRetry} data-testid="objections-retry">Try again</button> : null}
      </div>
    );
  }
  if (!view.items.length) return <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`} data-testid="objections-none">{OBJECTIONS_NONE}</p>;
  return (
    <>
      {view.answers !== 'ok' ? <p role="status" className={`m-0 border-b border-axal-hairline px-4 py-2 text-[11.5px] dark:border-gray-800 ${MUTED}`} data-testid="objections-answers-unreadable">{ANSWERS_UNREADABLE}</p> : null}
      <ul className="m-0 list-none p-0">{view.items.map((o) => row(objectionRow(o, search)))}</ul>
      {view.capped ? <p className={`m-0 px-4 pb-3 text-[11.5px] ${MUTED}`} data-testid="objections-capped">{OBJECTIONS_CAPPED}</p> : null}
    </>
  );
}

const ROW = 'flex flex-wrap items-start justify-between gap-2 border-b border-axal-ground px-4 py-2.5 last:border-b-0 dark:border-gray-800';

/** The dialog that says what marking or clearing an answer changes; the write runs on confirm. */
function AnswerDialog({ d, busy, error, onConfirm, onClose, testId }) {
  return (
    <Lightbox label={d.title} title={d.title} onClose={busy ? () => {} : onClose} width={480} testId={testId}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={BTN} onClick={onConfirm} disabled={busy} data-testid={`${testId}-confirm`}>{busy ? 'Saving…' : d.confirm}</button>
        </div>
      )}>
      <div className="flex flex-col gap-2.5">
        <ul className={`m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] ${INK}`}>{d.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        {error ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid={`${testId}-failed`}>{error}</p> : null}
      </div>
    </Lightbox>
  );
}

/**
 * NAR10. `canAnswer` is false for an admin, a live-deck version, a phone or no
 * open section; `aiOn` false greys Answer it with the page's own reason.
 * `canMark` (a saved version, a founder, an open section) offers Mark answered
 * here and Clear.
 */
export function ObjectionsPanel({
  projectId, canAnswer, aiOn, busy, focusKey = null, sectionLabel = null, onAnswer, offLine,
  canMark = false, version = null, section = null, unsaved = false, search = '',
}) {
  const [state, setState] = useState({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState(null);
  const retry = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    narrativeApi.objections(projectId).then(
      (r) => { if (alive) setState(objectionsOf(r)); },
      (e) => { if (alive) setState({ status: 'unreadable' }); reportError('narrative:objections', e); },
    );
    return () => { alive = false; };
  }, [projectId, tick]);
  const marking = canMark && state.status === 'ok' && state.answers === 'ok' && version != null && section;
  const confirm = async () => {
    const { kind, row } = dialog;
    setDialog((d) => ({ ...d, busy: true, error: null }));
    try {
      if (kind === 'mark') await narrativeApi.recordAnswer(projectId, row.key, { version, section, how: 'picked' });
      else await narrativeApi.clearAnswer(projectId, row.key);
      setDialog(null);
      retry();
    } catch (e) {
      setDialog((d) => ({ ...d, busy: false, error: `Nothing was changed: ${e?.message || 'the write was refused'}.` }));
    }
  };
  return (
    <aside className={`${CARD} flex flex-col`} aria-label="Objections heard" data-testid="story-objections">
      <Head count={state.status === 'ok' ? state.items.length : null} />
      <Body view={state} onRetry={retry} search={search} row={(r) => (
        <li key={r.key} className={`${ROW} ${r.key === focusKey ? 'bg-axal-lavender dark:bg-violet-950/30' : ''}`} aria-current={r.key === focusKey ? 'true' : undefined} data-testid={`story-objection-${r.key}`}>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={`text-[13px] font-semibold ${INK}`}>{r.text}</span>
            <span className={`text-[12px] ${MUTED}`}>{r.sub}</span>
            {r.answered ? <Answered answered={r.answered} testId={`story-objection-answered-${r.key}`} /> : null}
            {marking ? (
              <span className="flex flex-wrap gap-3">
                {r.answered && r.answered.section === section && String(r.answered.version) === String(version) ? null : (
                  <button type="button" className={SMALL} onClick={() => setDialog({ kind: 'mark', row: r, busy: false, error: null })} data-testid={`story-objection-mark-${r.key}`}>
                    Mark answered in {sectionLabel}
                  </button>
                )}
                {r.answered ? <button type="button" className={SMALL} onClick={() => setDialog({ kind: 'clear', row: r, busy: false, error: null })} data-testid={`story-objection-clear-${r.key}`}>Clear answer</button> : null}
              </span>
            ) : null}
          </span>
          {canAnswer ? (
            <button type="button" className={ASK} disabled={!aiOn || busy} title={!aiOn ? offLine : undefined}
              aria-label={sectionLabel ? `Answer it in ${sectionLabel}` : 'Answer it'} onClick={() => onAnswer(r.key, r.text)} data-testid={`story-objection-answer-${r.key}`}>
              Answer it
            </button>
          ) : null}
        </li>
      )} />
      {canAnswer && state.status === 'ok' && state.items.length ? <p className={`m-0 border-t border-axal-hairline px-4 py-2.5 text-[11.5px] dark:border-gray-800 ${MUTED}`} data-testid="story-objections-foot">{ANSWER_FOOT}</p> : null}
      {dialog ? (
        <AnswerDialog d={dialog.kind === 'mark' ? markDialog(dialog.row, section, version, unsaved) : clearDialog(dialog.row)} busy={dialog.busy} error={dialog.error}
          onConfirm={confirm} onClose={() => setDialog(null)} testId={dialog.kind === 'mark' ? 'story-objection-mark-dialog' : 'story-objection-clear-dialog'} />
      ) : null}
    </aside>
  );
}

/** NAR1's "Objections heard", from the module read's part. */
export function ObjectionsCard({ part, search = '', admin = false }) {
  const view = objectionsOf(part?.objections);
  const newest = Array.isArray(part?.versions) && part.versions[0] ? part.versions[0].version : null;
  return (
    <section className={CARD} data-testid="narrative-objections">
      <Head count={view.status === 'ok' ? view.items.length : null} />
      <Body view={view} search={search} row={(r) => (
        <li key={r.key} className={ROW} data-testid="narrative-objection-row">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={`text-[13px] font-semibold ${INK}`}>{r.text}</span>
            <span className={`text-[12px] ${MUTED}`}>{r.sub}</span>
          </span>
          {r.answered ? <Answered answered={r.answered} testId="narrative-objection-answered" />
            : !admin && newest != null ? <Link className={`${LINK} text-[12px]`} to={answerItHref(r.key, search, newest)} data-testid="narrative-objection-answer">Answer it ›</Link> : null}
        </li>
      )} />
    </section>
  );
}
