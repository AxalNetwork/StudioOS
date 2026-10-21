import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import LogInterviewModal from '../../components/discovery/LogInterviewModal';
import { NewHypothesisDialog, LinkPainDialog } from '../../workspaces/founder/ValidateDialogs';
import { RECENTLY_MOVED_DAYS, daysBefore, historyReaches, startOfMonth } from '../../lib/verdictHistory';
import { placementText } from '../founder/InterviewReview';
import { NO_SUGGESTIONS, acceptAllBatches, heardLine, suggestionLine, suggestionsView } from './validatePhone';

/**
 * D697 (#1659) — Validate's three bottom sections: what the Interviews, Pain
 * map and Hypotheses pages of `FounderValidateWorkspace` (FVW) drew, under
 * Customer research's, Problem discovery's and Experiments and evidence's
 * tables, so #1666 can remove those pages without losing a feature.
 *
 * THEY READ NOTHING (decision 8). Every count is the module read's `parts`
 * (D690, #1691): `parts.can_write`, `parts.stats` over the whole venture
 * (never the 25 rows on the page), `parts.unthemed`, `parts.themes` and
 * `parts.fit_gap`. Every write is a callback from Validate's `parts` entry in
 * `CycleRoute.jsx`, which is the one file that reads; that includes Link to a
 * pain's lists, read when its dialog opens (decision 20).
 *
 * NO DIALOG IN PLACE (decision 21). Each dialog is a `fixed` layer, and inside
 * the cycle's size container an older browser places it against the column.
 * So a section hands its dialog to `openDialog(element)`, and `CycleRoute`
 * draws it after the container; `openDialog(null)` closes it.
 *
 * WRITE TOOLS FOR WRITERS ONLY (decision 9): Log an interview, both exports,
 * the Problem slide link, the unthemed-quotes panel, New hypothesis and Link to
 * a pain are drawn only when the read says `can_write`. The Worker refuses the
 * writes anyway. The strips are everyone's.
 *
 * ONE VOCABULARY (decision 10): the module's statuses. FVW's Validated,
 * Invalidated and Unproven are not drawn here.
 *
 * Below 1024px every grid is one column (decision 18), so #1665's phone pages
 * mount these unchanged.
 */

const SECTION = 'flex min-w-0 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const TILE = 'rounded-lg border border-axal-hairline bg-white px-3 py-2.5 dark:border-gray-800 dark:bg-gray-950';
const BUTTON = 'inline-flex w-fit items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-ink hover:border-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-500';
const LINK = 'text-[12.5px] font-semibold text-axal-violet underline dark:text-violet-300';
const NOTE = 'm-0 text-[11px] leading-relaxed text-axal-faint dark:text-gray-500';
const ERROR = 'm-0 text-[12px] text-red-700 dark:text-red-300';

const nr = (v) => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const day = (v) => String(v).slice(0, 10);

/** "Not recorded", never 0, where the read sent no value. */
function NotRecorded() {
  return (
    <span className="inline-flex whitespace-nowrap rounded border border-axal-hairline bg-axal-ground px-1.5 py-0.5 text-[10px] font-bold text-axal-faint dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
      Not recorded
    </span>
  );
}

/** FVW's stat strip: each tile's label, its value or Not recorded, and its note. */
function Strip({ items, testid }) {
  return (
    <div className={`grid grid-cols-1 gap-2.5 ${items.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`} data-testid={testid}>
      {items.map((it) => (
        <div key={it.label} className={TILE} data-testid="validate-stat">
          <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint dark:text-gray-500">{it.label}</div>
          {nr(it.value)
            ? <div className="mt-1.5"><NotRecorded /></div>
            : <div className="mt-1 text-base font-extrabold tabular-nums tracking-tight text-axal-ink dark:text-gray-100">{it.value}</div>}
          {it.note && <div className="mt-1 text-[10px] leading-snug text-axal-faint dark:text-gray-500">{it.note}</div>}
        </div>
      ))}
    </div>
  );
}

/** A button that runs an export, and prints the Worker's sentence when it is refused (FVW's `runExport`). */
function ExportButton({ label, run, testid }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const click = async () => {
    setBusy(true); setError('');
    try { await run(); } catch (e) { setError(e?.message || 'The export could not be produced.'); } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className={BUTTON} onClick={click} disabled={busy} aria-busy={busy} data-testid={testid}>{label}</button>
      {error && <p role="alert" className={ERROR}>{error}</p>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Customer research
// ---------------------------------------------------------------------------

/** `?log=` values that open Log an interview, as FVW's `?new=` did. */
const LOG_INTENTS = ['notes', 'upload'];

export function InterviewsSection({ parts, openDialog, onLog, onExport }) {
  const stats = parts?.stats || {};
  const writer = parts?.can_write === true;
  const [searchParams, setSearchParams] = useSearchParams();
  const logParam = searchParams.get('log');

  // The dialog outlives this render, so it saves through the latest callback.
  const log = useRef(onLog);
  log.current = onLog;
  const openLog = useCallback((intent = null) => openDialog(
    <LogInterviewModal open intent={intent} interview={null} onClose={() => openDialog(null)} onSave={(payload) => log.current(payload)} />,
  ), [openDialog]);
  // `?log=notes|upload` opens Log an interview, on load and whenever it appears
  // later, then leaves the address, so a reload does not reopen the form.
  useEffect(() => {
    if (!writer || !LOG_INTENTS.includes(logParam)) return;
    openLog(logParam);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('log');
      return next;
    }, { replace: true });
  }, [writer, logParam, setSearchParams, openLog]);

  const notAsked = stats.consent_not_asked;
  return (
    <section className={SECTION} data-testid="validate-section-interviews">
      <Strip testid="validate-interviews-strip" items={[
        { label: 'Interviews logged', value: stats.logged, note: 'the base every later stage counts against' },
        { label: 'With a pain recorded', value: stats.with_pain, note: 'an interview with no pain feeds nothing downstream' },
        // Three-state on purpose: never asked is counted apart from declined.
        { label: 'Consent to quote', value: stats.consent_agreed, note: notAsked ? `${notAsked} never asked — not the same as declined` : 'recorded on the interview' },
        { label: 'Deck-eligible', value: stats.consent_agreed, note: 'an interview may be quoted in the deck only with consent on file' },
      ]} />
      {writer && (
        <div className="flex flex-wrap items-start gap-2">
          <button type="button" className={BUTTON} onClick={() => openLog(null)} data-testid="validate-log-interview">Log an interview</button>
          <ExportButton label="Export interviews" run={onExport} testid="validate-export-interviews" />
        </div>
      )}
      {/* Decision 15: neither finds interviewees, so the card says what each is. */}
      <div className="flex flex-col gap-1.5 border-t border-axal-hairline pt-3 dark:border-gray-800" data-testid="validate-more-tools">
        <span className="text-[12px] font-extrabold text-axal-ink dark:text-gray-100">More tools</span>
        <Link to="/build/marketplace" className={LINK}>Marketplace: partners' services, and the needs you post</Link>
        <Link to="/build/team?mode=workspace&tab=advisors" className={LINK}>Team › Advisors: the advisor directory</Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Problem discovery
// ---------------------------------------------------------------------------

const PROBLEM_SLIDE_NOTE = 'These themes already feed the deck’s Problem slide — open the deck to read it.';

/** One unthemed quote and its Assign select. */
function UnthemedQuote({ quote, themes, onAssign }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const assign = async (e) => {
    const themeId = e.target.value;
    if (!themeId) return;
    setBusy(true); setError('');
    try { await onAssign(themeId, { interview_id: quote.interview_id, phrase: quote.phrase }); }
    catch (err) { setError(err?.message || 'The quote could not be assigned.'); }
    finally { setBusy(false); }
  };
  return (
    <li className="flex flex-col gap-1.5 border-t border-axal-hairline py-2 first:border-t-0 lg:flex-row lg:items-center lg:justify-between dark:border-gray-800" data-testid="validate-unthemed-quote">
      <span className="text-[12.5px] text-axal-ink dark:text-gray-100">
        “{quote.phrase}” · {quote.interviewee || 'Interviewee not recorded'} · {quote.date ? day(quote.date) : 'Date not recorded'}
      </span>
      <span className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-[11px] text-axal-muted dark:text-gray-400">
          Assign to a theme
          <select className="rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            value="" onChange={assign} disabled={busy || !themes.length} data-testid="validate-assign-theme">
            <option value="">{themes.length ? 'Choose a theme' : 'No theme yet'}</option>
            {themes.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
        {error && <span role="alert" className={ERROR}>{error}</span>}
      </span>
    </li>
  );
}

export function PainThemesSection({ parts, onExport, onAssign, newThemeHref = null }) {
  const stats = parts?.stats || {};
  const writer = parts?.can_write === true;
  const unthemed = Array.isArray(parts?.unthemed) ? parts.unthemed : null;
  const themes = Array.isArray(parts?.themes) ? parts.themes : [];
  const fitUnknown = Number(stats.fit_unrecorded_themes) || 0;
  return (
    <section className={SECTION} data-testid="validate-section-pain-themes">
      <Strip testid="validate-pain-strip" items={[
        { label: 'Themes', value: stats.themes, note: 'you name them; nothing else does' },
        { label: 'Interviews behind them', value: stats.interviews, note: 'the denominator for every frequency below' },
        { label: 'Ungrouped phrases', value: stats.ungrouped, note: 'logged, not yet themed' },
        // Null, not 0, while no severity or no ICP fit was ever recorded.
        {
          label: 'Need-to-have themes', value: stats.need_themes,
          note: nr(stats.need_themes) ? 'no severity recorded against any pain yet' : 'someone interviewed was recorded calling these a must',
        },
        {
          label: 'Themes your ICP named', value: stats.icp_themes,
          note: nr(stats.icp_themes) ? 'no ICP fit recorded on any interview yet'
            : fitUnknown > 0 ? `${fitUnknown} more have mentions whose ICP fit was never recorded` : 'every mention behind these has a recorded fit',
        },
      ]} />
      {writer && (
        <div className="flex flex-wrap items-start gap-2">
          <Link to="/raise/pitch?mode=workspace" title={PROBLEM_SLIDE_NOTE} className={BUTTON} data-testid="validate-problem-slide">Open the Problem slide</Link>
          <ExportButton label="Export map" run={onExport} testid="validate-export-map" />
        </div>
      )}
      {writer && unthemed && (
        <div className="flex flex-col gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800" data-testid="validate-unthemed">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[12px] font-extrabold text-axal-ink dark:text-gray-100">Unthemed quotes · {parts.unthemed_total ?? unthemed.length}</span>
            {newThemeHref && <Link to={newThemeHref} className={LINK} data-testid="validate-new-theme">New theme</Link>}
          </div>
          {unthemed.length
            ? <ul className="m-0 list-none p-0">{unthemed.map((quote, i) => <UnthemedQuote key={`${quote.interview_id}-${i}`} quote={quote} themes={themes} onAssign={onAssign} />)}</ul>
            : <p className={NOTE}>Every logged phrase is in a theme.</p>}
          {Number(parts.unthemed_total) > unthemed.length && (
            <p className={NOTE}>The newest {unthemed.length} of {parts.unthemed_total} are shown; assign them and the next come up.</p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Experiments and evidence
// ---------------------------------------------------------------------------

/**
 * The note a history view draws when its window opens before the record
 * starts (decision 19). Nothing is backfilled, so an empty table under such a
 * window must not read as "nothing moved". FVW's second sentence ("It starts
 * the first time this board is opened…") is not drawn: opening this page does
 * not start the history until #1666 writes it from the module read.
 */
export function historyNotes(filter, since, now = new Date()) {
  const notes = [];
  const f = filter || {};
  if (f.moved === 'recent' && !historyReaches(since, daysBefore(now, RECENTLY_MOVED_DAYS))) {
    notes.push(since
      ? `Lane history starts ${day(since)}, so moves before that are not on record.`
      : 'No lane history is on record yet.');
  }
  const opened = f.history === 'last_week' ? daysBefore(now, 7) : f.history === 'this_month' ? startOfMonth(now) : null;
  if (opened && !historyReaches(since, opened)) {
    notes.push(since
      ? `Status history starts ${day(since)}. Hypotheses with nothing on record that far back are left out rather than shown at today's status.`
      : 'No status history is on record yet.');
  }
  return notes;
}

/** FVW's fit line: a zero must not read as a finding. */
function FitLine({ count, projectId }) {
  if (!(Number(count) > 0)) return null;
  return (
    <p className="m-0 rounded-lg border border-dashed border-axal-hairline bg-axal-ground px-3.5 py-2.5 text-[12px] leading-relaxed text-axal-muted dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400" data-testid="validate-fit-line">
      <span className="font-semibold">{count}</span>
      {count === 1 ? ' interview has ' : ' interviews have '}
      no ICP fit recorded. Those cannot count toward a hypothesis, so any status that depends on them is withheld
      rather than guessed — an unrecorded fit is not the same as “not our customer”.{' '}
      <Link to={`/validate/customer-research${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`} className={LINK}>Record it on the interview</Link>.
    </p>
  );
}

/** Per open hypothesis, its ICP support against the bar (`parts.fit_gap`). */
function FitGap({ gap }) {
  if (!Array.isArray(gap) || !gap.length) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="validate-fit-gap">
      <span className="text-[12px] font-extrabold text-axal-ink dark:text-gray-100">Distance to the bar</span>
      <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 lg:grid-cols-2">
        {gap.map((g) => (
          <li key={g.id ?? g.code} className="text-[12px] text-axal-muted dark:text-gray-400">
            <span className="font-semibold text-axal-ink dark:text-gray-100">{g.code}</span>
            {' · '}{nr(g.supporting) ? 'support not recorded' : `${g.supporting} of ${g.bar} supporting ICP interviews`}
            {Number(g.fit_unrecorded) > 0 ? ` · ${plural(Number(g.fit_unrecorded), 'interview', 'interviews')} with no fit recorded` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HypothesesSection({ parts, projectId, query, openDialog, onLoadLinkLists, onLink, onNewHypothesis }) {
  const stats = parts?.stats || {};
  const writer = parts?.can_write === true;
  const [linkError, setLinkError] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const filter = query?.filter || {};
  const notes = historyNotes(filter, stats.history_since);

  // Link to a pain's lists are read when its dialog opens; a failed read says
  // so here and opens nothing.
  const openLink = async () => {
    setLinkBusy(true); setLinkError('');
    try {
      const lists = await onLoadLinkLists();
      openDialog(
        <LinkPainDialog open hypotheses={lists?.hypotheses || []} painGroups={lists?.painGroups || []} onClose={() => openDialog(null)}
          onSave={async (hypothesisId, { pain_group_id, direction }) => {
            await onLink(pain_group_id, { hypothesis_id: hypothesisId, direction });
            openDialog(null);
          }} />,
      );
    } catch (e) {
      setLinkError(e?.message || 'The hypotheses and themes could not be read.');
    } finally { setLinkBusy(false); }
  };
  const openNew = () => openDialog(
    <NewHypothesisDialog open onClose={() => openDialog(null)} onSave={async (body) => { await onNewHypothesis(body); openDialog(null); }} />,
  );

  return (
    <section className={SECTION} data-testid="validate-section-hypotheses">
      <Strip testid="validate-hypotheses-strip" items={[
        { label: 'Hypotheses', value: stats.hypotheses, note: nr(stats.hypotheses) ? null : `${stats.supported ?? 0} supported, ${stats.refuted ?? 0} refuted` },
        { label: 'Awaiting evidence', value: stats.awaiting, note: 'not yet at the bar either way' },
        { label: 'Bar per claim', value: stats.bar, note: 'ICP interviews to validate · not configurable yet' },
        // Absent, never 0, when none is withheld, as FVW drew it.
        { label: 'Verdict withheld', value: stats.withheld || null, note: 'hypotheses whose evidence has no ICP fit recorded' },
      ]} />
      <FitLine count={stats.fit_not_recorded} projectId={projectId} />
      <FitGap gap={parts?.fit_gap} />
      {notes.map((n) => <p key={n} className={NOTE} data-testid="validate-history-note">{n}</p>)}
      {filter.history === 'last_week' && (
        <p className={NOTE} data-testid="validate-history-basis">Status from the recorded history · counts are current</p>
      )}
      {writer && (
        <div className="flex flex-wrap items-start gap-2">
          {onNewHypothesis && <button type="button" className={BUTTON} onClick={openNew} data-testid="validate-new-hypothesis">New hypothesis</button>}
          <span className="inline-flex flex-col gap-1">
            <button type="button" className={BUTTON} onClick={openLink} disabled={linkBusy} aria-busy={linkBusy} data-testid="validate-link-pain">Link to a pain</button>
            {linkError && <p role="alert" className={ERROR}>{linkError}</p>}
          </span>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// D757 §2.7 (#1928) — From your interviews, on every Validate module but Verdict
// ---------------------------------------------------------------------------

/** A suggestion's own words: a finding's, else Interview review's for the older kinds. */
export function suggestionText(s) {
  return suggestionLine(s) ?? placementText(s);
}

/** One suggestion: what it says, the quote, where it was heard, and Accept, Edit and Discard. */
function SuggestionRow({ s, busy, error, onAccept, onDiscard }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(s.payload || {}, null, 2));
  const [bad, setBad] = useState(false);
  const accept = () => {
    if (!editing) return onAccept(s.id);
    let payload;
    try { payload = JSON.parse(draft); } catch { setBad(true); return undefined; }
    setBad(false);
    return onAccept(s.id, payload);
  };
  const heard = heardLine(s);
  return (
    <li className="flex flex-col gap-1.5 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-800" data-testid="validate-suggestion" data-id={s.id}>
      <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{suggestionText(s)}</span>
      {s.quote && <blockquote className="m-0 border-l-2 border-violet-300 pl-2 text-[12px] italic text-axal-muted dark:border-violet-700 dark:text-gray-300">{s.quote}</blockquote>}
      {s.href ? <Link to={s.href} className={LINK} data-testid="validate-suggestion-heard">{heard}</Link>
        : <span className="text-[11px] text-axal-faint dark:text-gray-500" data-testid="validate-suggestion-heard">{heard}</span>}
      {editing && (
        <textarea aria-label="Edit before accepting" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} data-testid="validate-suggestion-draft"
          className="w-full rounded-md border border-axal-hairline bg-white p-2 font-mono text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
      )}
      {bad && <p role="alert" className={ERROR}>The edit is not valid JSON. Nothing was accepted.</p>}
      {error && <p role="alert" className={ERROR}>{error} It is still suggested.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={busy} onClick={accept} data-testid="validate-suggestion-accept">{editing ? 'Save and accept' : 'Accept'}</button>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => { setEditing((x) => !x); setBad(false); }} data-testid="validate-suggestion-edit">{editing ? 'Cancel edit' : 'Edit'}</button>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => onDiscard(s.id)} data-testid="validate-suggestion-discard">Discard</button>
      </div>
    </li>
  );
}

/**
 * The module's pending interview suggestions (`parts.suggestions`, #1925), for
 * writers only: a reader's read carries no `suggestions` key, and nothing is
 * drawn. Each write is a callback from `CycleRoute.jsx`, which reloads the
 * module after it. Accept all goes per session through #1925's route
 * (`acceptAllBatches`); it never decides anything the founder did not press.
 */
export function FromYourInterviews({ parts, onAccept, onDiscard, onAcceptAll }) {
  const view = suggestionsView(parts);
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const [allError, setAllError] = useState('');
  if (view.state === 'hidden') return null;

  const run = async (id, fn) => {
    setBusy(id); setErrors((e) => ({ ...e, [id]: '' }));
    try { await fn(); } catch (err) { setErrors((e) => ({ ...e, [id]: err?.data?.detail || err?.message || 'It could not be saved.' })); } finally { setBusy(null); }
  };
  const acceptAll = async () => {
    setBusy('all'); setAllError('');
    try {
      const failed = await onAcceptAll(acceptAllBatches(view.rows));
      if (failed > 0) setAllError(`${failed} could not be accepted and ${failed === 1 ? 'is' : 'are'} still suggested.`);
    } catch (err) { setAllError(err?.message || 'Accept all could not run. Nothing more was accepted.'); } finally { setBusy(null); }
  };

  return (
    <section className={SECTION} data-testid="validate-from-interviews" data-state={view.state} aria-labelledby="validate-from-interviews-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="validate-from-interviews-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From your interviews</h2>
        {view.state === 'some' && (
          <button type="button" className={BUTTON} disabled={busy != null} onClick={acceptAll} data-testid="validate-suggestions-accept-all">Accept all</button>
        )}
      </div>
      {allError && <p role="alert" className={ERROR}>{allError}</p>}
      {view.state === 'unreadable' && <p className={NOTE} data-testid="validate-suggestions-unreadable">Your interview suggestions could not be read. This is not a claim that there are none.</p>}
      {view.state === 'none' && <p className={NOTE} data-testid="validate-suggestions-empty">{NO_SUGGESTIONS}</p>}
      {view.state === 'some' && (
        <ul className="m-0 list-none p-0">
          {view.rows.map((s) => (
            <SuggestionRow key={s.id} s={s} busy={busy != null} error={errors[s.id]}
              onAccept={(id, payload) => run(id, () => onAccept(id, payload))} onDiscard={(id) => run(id, () => onDiscard(id))} />
          ))}
        </ul>
      )}
    </section>
  );
}
