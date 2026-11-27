import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { cohortGuidanceApi } from '../../../lib/api/advisorCohortGuidance.js';
import { NothingYet, Unrecorded, ZoneBody } from '../expertise/kit';
import { NoBatch } from './kit';
import { createRequestGate, dayTime } from './cohortModel';
import { CohortLoading, StatusBadge, useCohortRead, useCohortWorkspace } from './CohortWorkspace';
import GuidanceComposer from './GuidanceComposer';
import {
  FILTER_PARAM, GUIDANCE_FILTERS, filterCounts, filterGuidance, guardedWrite, guidancePreview,
  guidanceStatusOf, guidanceTitle, hasText, needsResponse, parseGuidanceFilter, readLocalDraft, weekMax,
} from './guidanceModel';

/**
 * Cohorts · Guidance — what was said to the cohort, and who acted on it.
 *
 * D4813 (#4813, package 2) MADE IT A FEED WITH A COMPOSER (boards C5, C6, C14).
 *
 *   · "NEW GUIDANCE" IS ALWAYS THERE. It sits in the header, outside the
 *     feed's own states, so an empty cohort, a failed read, or a cohort whose
 *     last note was just retired still offers it. The empty state covers only
 *     the feed region, and offers the same action.
 *   · Filters: All, Published, Draft, Retired and Needs response (a founder's
 *     question with no answer). Each item shows its title (or the first line
 *     of a note written before titles), a preview, the cohort, the week or
 *     General, its status in words, and its date; actions are Edit, Publish,
 *     Retire, Restore and Answer, each against the version on screen.
 *   · Drafts are the author's alone: the Worker returns only this advisor's
 *     rows, so another advisor and every founder never see one.
 *   · Unsaved text is kept per cohort on this device (the composer), and a
 *     write that answers after the cohort changed is not painted here.
 *
 * TWO NUMBERS ARE DELIBERATELY ABSENT, as before:
 *
 *   · `median_response_hours` is null until something has been answered. A
 *     median over an empty set is undefined and "0h" would read as an instant
 *     reply to every question.
 *   · There is no "overdue". The canvas draws one against "your
 *     24h commitment"; nothing stores a commitment and no advisor has been
 *     asked for one. `oldest_open_hours` is the fact underneath it.
 *
 * ACKNOWLEDGEMENTS ARE NOT RECORDED. Migration 212 has the table, but nothing a
 * founder uses writes to it, so an item reads "Acknowledgements not recorded"
 * rather than "0 acknowledged". Who acted is listed by name when a row exists.
 */
export default function GuidanceZone() {
  const data = useCohortRead((id) => api.listMyAdvisorCohortGuidance(id),
    { fallbackError: 'This cohort’s guidance could not be read.' });
  return <GuidanceView data={data} />;
}

/** The section for one read state (`{ loading, error, data, reload }`); exported for tests. */
export function GuidanceView({ data, initialComposer }) {
  const ws = useCohortWorkspace();
  const cycleId = ws.cycleId;
  const [params, setParams] = useSearchParams();
  const filter = parseGuidanceFilter(params.get(FILTER_PARAM));
  const load = data.reload;

  // The cohort on screen, for writes that answer late (`guardedWrite`).
  const cycleRef = useRef(cycleId);
  cycleRef.current = cycleId;
  const currentCycle = () => cycleRef.current;
  const actGate = useRef(createRequestGate()).current;

  // The composer: null (closed), { mode: 'new' } or { mode: 'edit', item }.
  // Opened for a cohort whose unsaved new note is on this device.
  const openFor = (id) => (id != null && hasText(readLocalDraft(id, null)) ? { mode: 'new' } : null);
  const [composer, setComposer] = useState(() => initialComposer ?? openFor(cycleId));
  const shownFor = useRef(cycleId);
  useEffect(() => {
    if (shownFor.current === cycleId) return;
    shownFor.current = cycleId;
    setComposer(openFor(cycleId));
  }, [cycleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [busy, setBusy] = useState('');
  const [note, setNote] = useState({ text: '', alert: false });
  const [answering, setAnswering] = useState(null);
  const [answer, setAnswer] = useState('');
  const [history, setHistory] = useState({ uid: null, loading: false, error: '', items: [] });
  useEffect(() => { setNote({ text: '', alert: false }); setAnswering(null); setHistory({ uid: null, loading: false, error: '', items: [] }); }, [cycleId]);

  const payload = data.data;
  const items = useMemo(() => payload?.items || [], [payload]);
  const counts = payload?.counts || null;
  const shown = filterGuidance(items, filter);
  const tally = filterCounts(items);
  const limit = weekMax(payload);
  const cohortName = ws.label;

  const setFilter = (key) => {
    const next = new URLSearchParams(params);
    if (key === 'all') next.delete(FILTER_PARAM); else next.set(FILTER_PARAM, key);
    setParams(next, { replace: true });
  };

  /** One action on one item, against the version on screen. */
  const act = async (label, write, done) => {
    setBusy(label); setNote({ text: '', alert: false });
    const forCycle = cycleId;
    const r = await guardedWrite({ gate: actGate, forCycle, currentCycle, write });
    setBusy('');
    if (!r.landed) return false;
    if (!r.ok) {
      const conflict = r.error?.status === 409;
      setNote({
        text: conflict
          ? 'That guidance changed somewhere else, so nothing was changed. The list below is the current version.'
          : (r.error?.message || 'That did not save. Nothing was changed.'),
        alert: true,
      });
      if (conflict) load();
      return false;
    }
    setNote({ text: done, alert: false });
    load();
    return true;
  };

  const openHistory = async (uid) => {
    if (history.uid === uid) { setHistory({ uid: null, loading: false, error: '', items: [] }); return; }
    setHistory({ uid, loading: true, error: '', items: [] });
    const r = await guardedWrite({ gate: actGate, forCycle: cycleId, currentCycle, write: () => cohortGuidanceApi.history(uid) });
    if (!r.landed) return;
    setHistory(r.ok ? { uid, loading: false, error: '', items: r.result?.items || [] }
      : { uid, loading: false, error: r.error?.message || 'The history could not be read.', items: [] });
  };

  const newButton = (testid) => (
    <button
      type="button"
      data-testid={testid}
      disabled={cycleId == null}
      onClick={() => setComposer({ mode: 'new' })}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-emerald-700 px-4 text-[13px] font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[36px]"
    >
      <Plus size={14} aria-hidden="true" /> New guidance
    </button>
  );

  const anyAssigned = ws.assignments.items.length > 0;

  return (
    <div className="space-y-4" data-testid="guidance-zone">
      {/* The header and its action stand outside every state below. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-sm font-extrabold tracking-tight">Guidance</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">
            What you have said to {cohortName || 'this cohort'}, your drafts, and founders’ questions waiting for you.
          </p>
        </div>
        {!ws.preview && anyAssigned && newButton('guidance-new')}
      </div>

      <ZoneBody
        loading={ws.assignments.loading}
        error={ws.assignments.error}
        onRetry={ws.reloadAssignments}
        isEmpty={!anyAssigned}
        empty={<NoBatch />}
      >
        {composer && cycleId != null && (
          <GuidanceComposer
            // One composer per cohort: switching remounts it on that cohort's own text.
            key={`${cycleId}:${composer.item?.uid || 'new'}`}
            cycleId={cycleId}
            cohortName={cohortName}
            weekLimit={limit}
            editing={composer.mode === 'edit' ? composer.item : null}
            currentCycle={currentCycle}
            onSaved={() => load()}
            onClose={() => setComposer(null)}
          />
        )}

        {note.text && (
          <p role={note.alert ? 'alert' : 'status'} className={`text-[12px] ${note.alert ? 'font-semibold text-red-700 dark:text-red-300' : 'text-axal-muted'}`}>
            {note.text}
          </p>
        )}

        <div role="radiogroup" aria-label="Guidance filter" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" data-testid="guidance-filters">
          {GUIDANCE_FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={on}
                data-filter={f.key}
                onClick={() => setFilter(f.key)}
                className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] md:min-h-[32px] ${on
                  ? 'border-emerald-300 bg-emerald-50 font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-axal-hairline bg-white font-semibold text-axal-muted hover:border-emerald-400 dark:border-gray-700 dark:bg-transparent dark:text-gray-300'}`}
              >
                {f.label}
                <span className="tabular-nums text-axal-faint">{data.data ? tally[f.key] : '–'}</span>
              </button>
            );
          })}
        </div>

        {/* THE FEED REGION. Its loading, failure and empty states are its own;
            the header, the filters and the composer above stay whatever happens here. */}
        <section aria-label="Guidance feed" data-testid="guidance-feed">
          {data.loading && <CohortLoading what="guidance" />}
          <ZoneBody
            loading={data.loading}
            error={data.error}
            onRetry={load}
            isEmpty={!data.loading && !data.error && shown.length === 0}
            empty={items.length === 0 ? (
              <NothingYet
                title="No guidance yet"
                body={`Your first note reaches every founder in ${cohortName || 'this cohort'} who shares their progress with you. Nothing is inferred: an empty list means you have not posted, not that nobody read.`}
                action={newButton('guidance-new-empty')}
              />
            ) : (
              <NothingYet
                title={`Nothing under ${GUIDANCE_FILTERS.find((f) => f.key === filter)?.label || 'this filter'}`}
                body="Other filters still have guidance in them."
                action={filter === 'retired' || filter === 'needs_response' ? null : newButton('guidance-new-filtered')}
              />
            )}
          >
            <div className="grid gap-4 lg:grid-cols-12">
              <ul className="space-y-2.5 lg:col-span-8" data-testid="guidance-items">
                {shown.map((g) => {
                  const status = guidanceStatusOf(g);
                  const local = readLocalDraft(cycleId, g.uid);
                  const unsavedHere = local && local.baseVersion === Number(g.version) && hasText(local);
                  const preview = guidancePreview(g);
                  return (
                    <li key={g.uid}>
                      <article className="rounded-[12px] border border-axal-hairline bg-white p-3.5 dark:border-gray-800 dark:bg-gray-900" data-status={status}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <h3 className="min-w-0 break-words text-[13.5px] font-extrabold tracking-tight">{guidanceTitle(g)}</h3>
                          {needsResponse(g) ? <StatusBadge state="needs_response" />
                            : g.kind === 'question' ? <StatusBadge state="answered">Answered</StatusBadge>
                              : <StatusBadge state={status} />}
                        </div>
                        {preview && <p className="mt-1 break-words text-[12.5px] leading-relaxed text-axal-muted">{preview}</p>}
                        {g.answer && (
                          <p className="mt-1.5 break-words border-l-2 border-axal-hairline pl-2.5 text-[12.5px] leading-relaxed text-axal-muted dark:border-gray-700">
                            {g.answer}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-axal-faint">
                          <span>{cohortName || 'This cohort'} · {g.week_number != null ? `Week ${g.week_number}` : 'General'}</span>
                          <span>
                            {status === 'draft' ? `Saved ${dayTime(g.updated_at || g.posted_at)}`
                              : status === 'retired' ? `Retired ${dayTime(g.retired_at)}`
                                : g.kind === 'question' ? `Asked ${dayTime(g.posted_at)}`
                                  : `Published ${dayTime(g.posted_at)}`}
                          </span>
                          {g.kind !== 'question' && status !== 'draft' && (
                            g.acted_by?.length
                              ? <span>{`Acted on by ${g.acted_by.map((a) => a.name || `user ${a.user_id}`).join(', ')}`}</span>
                              : <span>Acknowledgements <Unrecorded /></span>
                          )}
                          {unsavedHere && <span className="font-semibold text-amber-800 dark:text-amber-300">● Unsaved changes on this device</span>}
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {g.kind !== 'question' && status !== 'retired' && (
                            <ItemButton onClick={() => setComposer({ mode: 'edit', item: g })} disabled={Boolean(busy)}>Edit</ItemButton>
                          )}
                          {status === 'draft' && (
                            <ItemButton primary disabled={Boolean(busy) || !String(g.body || '').trim()}
                              onClick={() => act(`publish:${g.uid}`, () => cohortGuidanceApi.publish(g.uid, g.version), `Published “${guidanceTitle(g)}”.`)}>
                              Publish
                            </ItemButton>
                          )}
                          {needsResponse(g) && (
                            <ItemButton primary disabled={Boolean(busy)} onClick={() => { setAnswering(answering === g.uid ? null : g.uid); setAnswer(''); }}>
                              Answer
                            </ItemButton>
                          )}
                          {status !== 'retired' ? (
                            <ItemButton disabled={Boolean(busy)}
                              onClick={() => act(`retire:${g.uid}`, () => cohortGuidanceApi.update(g.uid, { retired: true, version: g.version }), `Retired “${guidanceTitle(g)}”. Restore it from Retired.`)}>
                              Retire
                            </ItemButton>
                          ) : (
                            <ItemButton disabled={Boolean(busy)}
                              onClick={() => act(`restore:${g.uid}`, () => cohortGuidanceApi.update(g.uid, { retired: false, version: g.version }), `Restored “${guidanceTitle(g)}”.`)}>
                              Restore
                            </ItemButton>
                          )}
                          <ItemButton onClick={() => openHistory(g.uid)} disabled={false} expanded={history.uid === g.uid}>History</ItemButton>
                        </div>
                        {answering === g.uid && (
                          <div className="mt-2.5 space-y-2">
                            <label className="block">
                              <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Your answer</span>
                              <textarea rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)}
                                className="mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-2 text-[13px] dark:border-gray-700 dark:bg-gray-900" />
                            </label>
                            <ItemButton primary disabled={Boolean(busy) || !answer.trim()}
                              onClick={() => act(`answer:${g.uid}`, () => cohortGuidanceApi.update(g.uid, { answer: answer.trim(), version: g.version }), 'Answer sent.')
                                .then((ok) => { if (ok) setAnswering(null); })}>
                              Send answer
                            </ItemButton>
                          </div>
                        )}
                        {history.uid === g.uid && (
                          <div className="mt-2.5 rounded-lg border border-dashed border-axal-hairline p-2.5 text-[12px] dark:border-gray-700" data-testid="guidance-history">
                            {history.loading ? <p role="status" className="text-axal-muted">Loading the history…</p>
                              : history.error ? <p role="alert" className="text-red-700 dark:text-red-300">{history.error}</p>
                                : (
                                  <ol className="space-y-1">
                                    {history.items.map((v) => (
                                      <li key={v.version}>
                                        <span className="font-bold tabular-nums">v{v.version}</span>
                                        {` · ${v.action} · ${dayTime(v.created_at)} · `}
                                        <span className="text-axal-muted">{guidanceTitle(v)}</span>
                                      </li>
                                    ))}
                                  </ol>
                                )}
                          </div>
                        )}
                      </article>
                    </li>
                  );
                })}
              </ul>

              <aside className="space-y-2.5 lg:col-span-4" aria-label="Guidance figures">
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { label: 'Published', value: counts ? counts.broadcast : null },
                    { label: 'Drafts', value: counts && counts.drafts != null ? counts.drafts : null },
                    { label: 'Open questions', value: counts ? counts.open : null },
                    {
                      label: 'Median response',
                      // Null, not zero. See the docblock.
                      value: counts && counts.medianResponseHours != null ? `${counts.medianResponseHours}h` : null,
                    },
                  ].map((t) => (
                    <Card key={t.label} className="px-3 py-2.5">
                      <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{t.label}</div>
                      {t.value === null || t.value === undefined
                        ? <div className="mt-1.5"><Unrecorded /></div>
                        : <div className="mt-1 text-base font-extrabold tabular-nums tracking-tight">{t.value}</div>}
                    </Card>
                  ))}
                </div>
                {payload?.oldest_open_hours != null && (
                  <Card className="p-3">
                    <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Longest open question</div>
                    <div className="mt-1 text-sm font-bold">{payload.oldest_open_hours} hours</div>
                  </Card>
                )}
                {payload?.truncated && (
                  <p className="text-[11.5px] text-axal-faint">The newest 200 are shown; the figures count those only.</p>
                )}
              </aside>
            </div>
          </ZoneBody>
        </section>
      </ZoneBody>
    </div>
  );
}

function ItemButton({ children, onClick, disabled, primary = false, expanded }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      className={`inline-flex min-h-[44px] items-center rounded-lg px-3 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[30px] ${primary
        ? 'bg-emerald-700 text-white hover:bg-emerald-800'
        : 'border border-axal-hairline text-axal-muted hover:bg-axal-ground dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'}`}
    >
      {children}
    </button>
  );
}
