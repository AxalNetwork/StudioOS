import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import HeaderAsk from '../../ui/HeaderAsk.jsx';
import { DataState, StateChip } from '../../ui';
import { CycleCard } from './CycleOverview';
import { chartSummary, coverageWords, gainLabel, lastRead, nextStepItems, pitchView, unassessedWords } from './raiseOverviewModel';

export { gainLabel, lastRead, nextStepItems };

/**
 * D6046 (#6046, Raise V2 build 2/5) — the sections of Raise › Overview, drawn
 * to `Raise v2 Page.dc.html` (D4863): the readiness summary and next actions
 * (RA-04), the Pitch card (RA-05), investor activity (RA-02), connected
 * evidence (RA-06), the accessible detailed readiness (RA-07) and the one
 * value component (RA-08). Each draws a view `raiseOverviewModel.js` built
 * from the overview read, and reads nothing itself. `RaiseOverview.jsx`
 * composes them. D1466's lead row (Next steps, From your tools) became the
 * next actions and connected evidence here; its rules stay: Team is never a
 * step, an unknown gain is Not recorded, never "+0", and a last read that is
 * not recorded is never a date or 0.
 *
 * A read-only (staff) viewer gets no link that writes: no action on a next
 * step, no Connect, no Add investor, no Pitch action.
 */

export const CARD = 'flex min-w-0 flex-col gap-2.5 rounded-xl border border-axal-hairline bg-white px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900';
export const H2 = 'm-0 text-[14.5px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100';
export const SUB = 'text-[12.5px] text-axal-muted dark:text-gray-400';
export const BTN = 'inline-flex min-h-[36px] items-center justify-center whitespace-nowrap rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-violet-deep hover:bg-axal-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-gray-700 dark:bg-gray-900 dark:text-violet-300 dark:hover:bg-gray-800';
export const BTN_P = 'inline-flex min-h-[36px] items-center justify-center whitespace-nowrap rounded-[9px] bg-axal-violet px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500';
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300';
const NOTE = 'flex flex-wrap items-center gap-3 rounded-[10px] border border-axal-hairline bg-[#faf9fc] px-3.5 py-3 dark:border-gray-800 dark:bg-gray-800/40';

/**
 * RA-08: one value for every Raise card, in one of #5129's four shapes. A measured 0 is a value in ink;
 * Not recorded, Unavailable and Not applicable are their chips, never a 0 and never a dash.
 */
export function RaiseValue({ state, value, reason = null, testId }) {
  if (state === 'value') return <b className="font-mono text-[20px] font-bold tracking-[-.02em] text-axal-ink dark:text-gray-100" data-testid={testId} data-value-state="value">{Number(value).toLocaleString('en-US')}</b>;
  const kind = state === 'not_applicable' ? 'not_applicable' : state === 'unavailable' ? 'unavailable' : 'not_recorded';
  return <span className="flex flex-col items-start gap-0.5" data-testid={testId} data-value-state={kind}><StateChip kind={kind} />{reason ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{reason}</span> : null}</span>;
}

/** RA-01, RA-04: the readiness summary, coverage first, the unassessed areas named; never a score of 0 for an unassessed area. */
export function RaiseReadinessSummary({ view, search = '', onRetry }) {
  const review = `/raise/fundraising-readiness${search && search.startsWith('?') ? search : ''}`;
  let body;
  if (view.state === 'unavailable') body = <DataState state="unavailable" size="block" what="Fundraising readiness" reason={view.reason} onRetry={onRetry} data-testid="raise-readiness-unavailable" />;
  else if (view.state === 'none') {
    body = <p className={`m-0 ${SUB}`} data-testid="raise-readiness-none">No area is assessed yet, so readiness has no coverage to show.</p>;
  } else {
    body = (
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[22px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100" data-testid="raise-readiness-coverage">{coverageWords(view)}</p>
        <p className={`m-0 ${SUB}`}>{unassessedWords(view)}</p>
      </div>
    );
  }
  return (
    <section className={`${CARD} sm:flex-row sm:items-center sm:justify-between`} aria-labelledby="raise-readiness-title" data-testid="raise-readiness" data-state={view.state}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h2 id="raise-readiness-title" className={H2}>Fundraising readiness</h2>
        {body}
      </div>
      <Link to={review} className={`${BTN} self-start sm:self-center`} aria-label="Review fundraising readiness">Review readiness</Link>
    </section>
  );
}

/** RA-04: at most three next actions, before the score breakdown, each with its reason, a neutral impact label and one action. */
export function RaiseNextActions({ view, readOnly = false, onRetry }) {
  if (!view) return null;
  const n = view.state === 'ready' ? view.items.length : 0;
  return (
    <section className="flex flex-col gap-2.5" aria-labelledby="raise-next-title" data-testid="raise-next-actions" data-state={view.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="raise-next-title" className={H2}>{n ? `${n} ${n === 1 ? 'action' : 'actions'} to improve readiness` : 'Next actions'}</h2>
        <span className={SUB}>At most three, most useful first</span>
      </div>
      {view.state === 'unavailable'
        ? <DataState state="unavailable" size="block" what="Next actions" onRetry={onRetry} data-testid="raise-next-unavailable" />
        : !n ? <p className={`m-0 ${SUB}`} data-testid="raise-next-none">No readiness step is open right now.</p>
          : (
            <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-3">
              {view.items.map((it, i) => (
                <li key={it.key} className={`${CARD} ${i === 0 ? 'border-axal-lavender-edge dark:border-violet-800' : ''}`} data-testid={`raise-next-${it.key}`}>
                  <span className="font-mono text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">{i + 1} of {n}</span>
                  <h3 className="m-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{it.title}</h3>
                  <p className="m-0 text-[12.5px] leading-relaxed text-axal-ink/80 dark:text-gray-300"><span className="sr-only">Why: </span>{it.reason}</p>
                  {it.impact
                    ? <span className="self-start rounded-full border border-axal-hairline px-2 py-0.5 text-[11.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-200" title="How much the readiness assessment would change" data-testid="raise-next-impact">{it.impact}</span>
                    : <span className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="raise-next-impact-unrecorded">Readiness impact · Not recorded</span>}
                  {!readOnly && it.href
                    ? <Link to={it.href} className={`${i === 0 ? BTN_P : BTN} mt-auto self-start`} aria-label={it.label}>{it.cta}</Link>
                    : null}
                </li>
              ))}
            </ol>
          )}
      {readOnly && view.state === 'ready' && n ? <p className={`m-0 ${SUB}`}>Read only. The founder takes these steps.</p> : null}
    </section>
  );
}

/** RA-05: the Pitch card, in the state the Worker read (D6045): No deck, Working draft only, Saved, Reviewed, Shared, or Unavailable. */
export function RaisePitchCard({ card, activity, search = '', readOnly = false, onRetry }) {
  const view = pitchView(card, activity, search);
  if (!view) return null;
  return (
    <article className={CARD} data-testid="raise-pitch-card" data-pitch-state={view.key} aria-labelledby="raise-pitch-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="raise-pitch-title" className="m-0 text-[14.5px] font-extrabold text-axal-ink dark:text-gray-100">Pitch</h3>
        {view.label ? <span className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400" data-testid="raise-pitch-label">{view.label}</span> : null}
      </div>
      {view.key === 'unavailable'
        ? <DataState state="unavailable" size="block" what="The deck" reason={view.reason} onRetry={onRetry} />
        : <>
          {view.rows.length ? (
            <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
              {view.rows.map(([term, value]) => [
                <dt key={`${term}-t`} className="text-axal-muted dark:text-gray-400">{term}</dt>,
                <dd key={`${term}-d`} className="m-0 text-axal-ink dark:text-gray-100">{value == null ? <StateChip kind="not_recorded" /> : value === 'unavailable' ? <StateChip kind="unavailable" /> : value}</dd>,
              ])}
            </dl>
          ) : null}
          {view.note ? <p className={`m-0 ${SUB}`}>{view.note}</p> : null}
          {!readOnly && (
            <div className="mt-auto flex flex-wrap items-center gap-2">
              {view.actions.map((a, i) => <Link key={a.label} to={a.href} className={i === 0 ? BTN_P : BTN} aria-label={`${a.label} · Pitch`}>{a.label}</Link>)}
              {view.blocked ? <button type="button" className={`${BTN} cursor-not-allowed opacity-60`} aria-disabled="true" title={view.blocked.why} data-testid="raise-pitch-share-blocked">{view.blocked.label}<span className="sr-only"> · {view.blocked.why}</span></button> : null}
            </div>
          )}
        </>}
    </article>
  );
}

/** RA-01, RA-02: the five materials, rows of one status table when nothing is in them, cards when something is. */
export function RaiseMaterials({ split, rows, activity, search = '', readOnly = false, onRetryCard }) {
  if (!split.table.length && !split.cards.length) return null;
  return (
    <section className="flex flex-col gap-2.5" aria-labelledby="raise-materials-title" data-testid="raise-materials">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="raise-materials-title" className={H2}>Fundraising materials</h2>
        <span className={SUB}>Each opens its module</span>
      </div>
      {split.allEmpty ? <p className={`m-0 ${SUB}`} data-testid="raise-materials-nothing">Nothing set up for this raise yet. Start with your investor narrative; everything else builds on it.</p> : null}
      {rows.length ? (
        <div className={`${CARD} p-0`}>
          <table className="w-full border-collapse text-left text-[12.5px]" data-testid="raise-materials-table">
            <caption className="sr-only">Materials with nothing recorded yet</caption>
            <thead>
              <tr className="text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">
                <th scope="col" className="px-4 py-2 font-extrabold">Area</th>
                <th scope="col" className="px-2 py-2 font-extrabold">Status</th>
                <th scope="col" className="px-2 py-2 font-extrabold">Detail</th>
                {!readOnly && <th scope="col" className="px-4 py-2"><span className="sr-only">Next action</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`raise-material-row-${r.slug}`}>
                  <th scope="row" className="px-4 py-2.5 font-bold text-axal-ink dark:text-gray-100"><Link to={r.href} className="hover:underline" aria-label={`Open ${r.name}`}>{r.name}</Link></th>
                  <td className="px-2 py-2.5"><StateChip kind="not_recorded" /></td>
                  <td className="px-2 py-2.5 text-axal-muted dark:text-gray-400">{r.detail}</td>
                  {!readOnly && <td className="px-4 py-2.5 text-right">{r.next ? <Link to={r.next.href} className={BTN} aria-label={`${r.next.text}: ${r.name}`}>{r.next.text}</Link> : null}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {split.cards.length ? (
        <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2 xl:grid-cols-3" data-testid="raise-materials-cards">
          {split.cards.map((c) => (c.slug === 'pitch-deck' && c.pitch_state
            ? <RaisePitchCard key={c.slug} card={c} activity={activity} search={search} readOnly={readOnly} onRetry={onRetryCard ? () => onRetryCard(c.slug) : undefined} />
            : <CycleCard key={c.slug} cycle="raise" card={c} search={search} onRetry={onRetryCard ? () => onRetryCard(c.slug) : undefined} />))}
        </div>
      ) : null}
    </section>
  );
}

/** RA-02: investor activity, computed by the Worker from prospects, deck links and call responses; RA-01's one line when there is none. */
export function RaiseInvestorActivity({ view, addHref = null, openHref, readOnly = false }) {
  if (!view) return null;
  return (
    <section className={CARD} aria-labelledby="raise-activity-title" data-testid="raise-investor-activity" data-state={view.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="raise-activity-title" className={H2}>Investor activity</h2>
        <Link to={openHref} className={LINK} aria-label="Open capital relationships">Capital relationships ›</Link>
      </div>
      {view.state === 'empty' ? (
        <div className={NOTE} data-testid="raise-activity-empty">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <b className="text-[13px] text-axal-ink dark:text-gray-100">No investors in your pipeline yet.</b>
            <span className={SUB}>Investor activity appears once you add a prospect or share a deck link.</span>
          </div>
          {!readOnly && addHref ? <Link to={addHref} className={BTN} aria-label="Add investor to the pipeline">Add investor</Link> : null}
        </div>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {view.figures.map((f) => (
              <div key={f.key} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-800" data-testid={`raise-activity-${f.key}`}>
                <dt className="text-[11.5px] text-axal-muted dark:text-gray-400">{f.label}</dt>
                <dd className="m-0"><RaiseValue state={f.state} value={f.value} reason={f.state === 'value' ? null : f.reason} /></dd>
              </div>
            ))}
          </dl>
          {view.recent.length ? (
            <ol className="m-0 list-none p-0" aria-label="Latest investor activity" data-testid="raise-activity-feed">
              {view.recent.map((e, i) => (
                <li key={`${e.at}-${i}`} className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 border-t border-axal-hairline py-2 text-[12.5px] dark:border-gray-800 sm:grid-cols-[90px_minmax(0,14rem)_minmax(0,1fr)]">
                  <time dateTime={String(e.at).slice(0, 10)} className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{String(e.at).slice(0, 10)}</time>
                  <b className="truncate text-axal-ink dark:text-gray-100">{e.investor}</b>
                  <span className="text-axal-ink/80 dark:text-gray-300">{e.detail}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * D8258 (RA-06): a connected source's freshness beside its last read: Fresh, Stale (the shared chip, with the
 * source's window) or, with no last read stored, Not recorded. An older read with no freshness shows its last read only.
 */
function SourceFreshness({ r }) {
  const read = <span className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="raise-source-last-read">{lastRead(r.asOf)}</span>;
  if (r.freshness === 'fresh') return <><span className="text-[11.5px] font-bold text-emerald-700 dark:text-emerald-300" data-freshness="fresh">Fresh</span>{read}</>;
  if (r.freshness === 'stale') {
    return <><StateChip kind="stale" lastGood={r.asOf} data-freshness="stale" />{r.window ? <span className="sr-only">{`Older than ${r.window}.`}</span> : null}{read}</>;
  }
  if (r.freshness === 'not_recorded') return <span data-freshness="not_recorded" className="contents">{read}</span>;
  return read;
}

/** RA-06: connected evidence: one message and Connect sources with nothing connected; otherwise one row per source. */
export function RaiseConnectedEvidence({ view, readOnly = false, onRetry }) {
  if (!view) return null;
  const connect = '/account/connectors';
  let body;
  if (view.state === 'unavailable') body = <DataState state="unavailable" size="block" what="Your connected sources" onRetry={onRetry} data-testid="raise-sources-unavailable" />;
  else if (view.state === 'none') {
    body = (
      <div className={NOTE} data-testid="raise-sources-none">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="text-[13px] text-axal-ink dark:text-gray-100">Connect finance, product and document sources to keep fundraising evidence current.</b>
          <span className={SUB}>Nothing is connected, so evidence is only what you add by hand.</span>
        </div>
        {!readOnly ? <Link to={connect} className={BTN_P} aria-label="Connect sources for fundraising evidence">Connect sources</Link> : null}
      </div>
    );
  } else {
    body = (
      <>
        <ul className="m-0 list-none p-0" aria-label="Connected sources">
          {view.rows.map((r) => (
            <li key={r.key} className="grid grid-cols-1 gap-1 border-t border-axal-hairline py-2.5 text-[12.5px] first:border-t-0 dark:border-gray-800 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center sm:gap-3" data-testid={`raise-source-${r.key}`} data-state={r.state}>
              <b className="text-axal-ink dark:text-gray-100">{r.label}</b>
              {r.state === 'connected'
                ? <span className="text-axal-ink/80 dark:text-gray-300">{r.fact || 'Not recorded'}</span>
                : r.state === 'not_connected' ? <span className={SUB}>Not connected</span>
                  : r.state === 'disconnected' ? <span className={SUB}>{r.label} was disconnected. Its figures are not read until it is reconnected.</span>
                    : <span className={SUB}>{r.label} could not be read.</span>}
              <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                {r.state === 'connected'
                  ? <SourceFreshness r={r} />
                  : r.state === 'unreadable'
                    ? <><StateChip kind="unavailable" />{onRetry ? <button type="button" onClick={onRetry} className={LINK} aria-label={`Try reading ${r.label} again`}>Try again</button> : null}</>
                    : r.state === 'disconnected'
                      ? <><span className="text-[11.5px] font-bold text-amber-800 dark:text-amber-300" data-testid="raise-source-disconnected">Disconnected</span>{!readOnly ? <Link to={connect} className={LINK} aria-label={`Reconnect ${r.label}`}>Reconnect</Link> : null}</>
                      : !readOnly ? <Link to={connect} className={LINK} aria-label={`Connect ${r.label}`}>Connect</Link> : null}
              </span>
            </li>
          ))}
        </ul>
        {!readOnly ? <Link to={connect} className={`${LINK} self-start`} aria-label="Manage connected sources">Manage sources</Link> : null}
      </>
    );
  }
  return (
    <section className={CARD} aria-labelledby="raise-sources-title" data-testid="raise-connected-evidence" data-state={view.state}>
      <h2 id="raise-sources-title" className={H2}>Connected evidence</h2>
      {body}
    </section>
  );
}

/**
 * RA-07: detailed readiness, a titled chart with a text summary and a Bars / Table switch. An unassessed
 * area is a hatched, empty track labelled Not recorded, never a bar of 0. Collapsed once the raise runs (RA-02).
 */
export function RaiseDetailedReadiness({ view, defaultOpen = true, defaultMode = 'bars', search = '' }) {
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState(defaultMode);
  const id = useId();
  if (view.state !== 'ready') return null;
  const titleId = `${id}-title`;
  const sumId = `${id}-summary`;
  const regionId = `${id}-region`;
  const evidence = `/raise/fundraising-readiness${search && search.startsWith('?') ? search : ''}`;
  return (
    <section className={CARD} aria-labelledby={titleId} data-testid="raise-detailed-readiness" data-open={open ? 'true' : 'false'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className={H2}>Detailed readiness</h2>
        <button type="button" className={LINK} aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((o) => !o)} data-testid="raise-detailed-toggle">
          {open ? 'Hide area scores' : 'Show area scores'}
        </button>
      </div>
      {!open ? <p className={`m-0 ${SUB}`}>Area scores and how each is assessed.</p> : null}
      <div id={regionId} hidden={!open} className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id={sumId} className={`m-0 ${SUB}`} data-testid="raise-detailed-summary">{chartSummary(view)}</p>
          <div role="radiogroup" aria-label="Readiness view" className="inline-flex gap-0.5 rounded-[9px] border border-axal-hairline bg-[#f8f7fb] p-[3px] dark:border-gray-700 dark:bg-gray-800">
            {[['bars', 'Bars'], ['table', 'Table']].map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} data-testid={`raise-detailed-mode-${k}`}
                className={`min-h-[28px] rounded-[7px] px-3 text-[12px] ${mode === k ? 'bg-white font-bold text-axal-ink shadow-[0_0_0_1px_#ececf1] dark:bg-gray-900 dark:text-gray-100 dark:shadow-[0_0_0_1px_#374151]' : 'font-semibold text-axal-muted dark:text-gray-400'}`}>{label}</button>
            ))}
          </div>
        </div>
        {mode === 'bars' ? (
          <div role="img" aria-labelledby={titleId} aria-describedby={sumId} className="flex flex-col gap-1.5" data-testid="raise-detailed-bars">
            {view.areas.map((a) => (
              <div key={a.label} className="grid grid-cols-[10rem_minmax(0,1fr)_3.5rem_auto] items-center gap-3 text-[12.5px]" aria-hidden="true">
                <span className="text-axal-ink dark:text-gray-100">{a.label}</span>
                <span className={`h-2.5 overflow-hidden rounded-full ${a.score == null ? 'bg-[repeating-linear-gradient(45deg,#ececf1_0_4px,transparent_4px_8px)] dark:bg-[repeating-linear-gradient(45deg,#374151_0_4px,transparent_4px_8px)]' : 'bg-axal-ground dark:bg-gray-800'}`} data-bar-state={a.score == null ? 'not_recorded' : 'value'}>
                  {a.score != null ? <i className="block h-full rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${Math.max(0, Math.min(10, a.score)) * 10}%` }} /> : null}
                </span>
                <b className="font-mono text-axal-ink dark:text-gray-100">{a.score == null ? '' : `${a.score} / 10`}</b>
                <span>{a.score == null ? <StateChip kind="not_recorded" /> : null}</span>
              </div>
            ))}
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-[12.5px]" aria-labelledby={titleId} aria-describedby={sumId} data-testid="raise-detailed-table">
            <thead><tr className="text-[10.5px] uppercase tracking-[.07em] text-axal-muted dark:text-gray-400"><th scope="col" className="py-1.5 font-extrabold">Area</th><th scope="col" className="py-1.5 font-extrabold">Score out of 10</th></tr></thead>
            <tbody>
              {view.areas.map((a) => (
                <tr key={a.label} className="border-t border-axal-hairline dark:border-gray-800">
                  <th scope="row" className="py-2 font-semibold text-axal-ink dark:text-gray-100">{a.label}</th>
                  <td className="py-2 font-mono text-axal-ink dark:text-gray-100">{a.score == null ? <StateChip kind="not_recorded" /> : a.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Link to={evidence} className={`${LINK} self-start`} aria-label="Open fundraising readiness for each area's evidence">Each area’s evidence ›</Link>
      </div>
    </section>
  );
}

/**
 * D1466 (RO00, RO08): Raise › Overview's header Ask, beside the primary action
 * and secondary to it. Ask opens Eadwyn on "Raise · Overview" for typed
 * questions. It is drawn only while the panel serves the viewer (a founder on
 * their own venture), so a staff reader, a support session or a signed-out
 * view never sees it, and the overview itself uses no AI. RA-10's rail is #5130's.
 */
export function RaiseAsk() {
  // D1443 (#3706): Ask opens the Ask panel for every viewer a rail serves.
  return <HeaderAsk label="Raise · Overview" testId="raise-ask" />;
}
