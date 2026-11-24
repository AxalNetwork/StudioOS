/**
 * D5998 (#5998) — Validate Overview V2, drawn to boards V1 (desktop), V2 (phone 390 and tablet 768) and V13
 * (states) of `design/incoming/Validate v2 Page.dc.html`, from the read D5996 built
 * (`GET /api/cycles/validate/overview`). Mounted through `def.Overview` (`defs/validate.jsx`), as Grow's and
 * Build's are, so `CycleOverview.jsx` is unchanged for the other cycles.
 *
 * The page goes objective → one next action → evidence → needs attention → recent changes → active
 * hypotheses. The next action and its meter are `ValidateLead` as it was (#4589's policy, #5999's meter,
 * D5997's objective): this file draws around it and never chooses a second primary. Record a session stays
 * in reach as the header's secondary button.
 *
 * Below 1024px the page is the phone root (`PhoneCycleRoot.jsx`, D703), with the objective above the next
 * action and Needs attention and the first hypotheses under it (V2 A); from 768px the evidence draws 3×2
 * there too (V2 B). Navigation is one per width: the header's tabs on desktop, the phone root's module list
 * below.
 *
 * Each part fails on its own with the shared Unavailable state and one Retry (#5129); a part an older read
 * does not send draws nothing.
 */
import { Link } from 'react-router-dom';
import { CycleHeader } from './CycleOverview';
import PhoneCycleRoot from './PhoneCycleRoot';
import { isPlainClick } from './cycleModel';
import { ValidateLead } from './ValidateNextAction';
import ValidateObjective from './ValidateObjective';
import { PmfChip } from './PmfMethod';
import { DataState, StateChip, Unrecorded } from '../../ui';
import { attentionView, changesView, evidenceView, hypothesesView, stillToEstablish, validateWriter } from './validateOverviewModel';

const CARD = 'flex min-w-0 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12px] leading-relaxed text-axal-muted dark:text-gray-400';
const SECONDARY = 'inline-flex min-h-[40px] items-center justify-center whitespace-nowrap rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[12px] font-bold text-axal-violet-deep hover:bg-axal-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-violet-300 dark:hover:bg-gray-800';
const TEXT_LINK = 'inline-flex min-h-[40px] items-center text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300';

const TONE = {
  review: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200',
  result: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  processing: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  muted: 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

/** A V13 state word: Not recorded is the shared chip; the others are this page's tags in the same shape. */
function Tag({ tag }) {
  if (tag.tone === 'not_recorded') return <StateChip kind="not_recorded" />;
  return <span className={`inline-flex w-fit items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONE[tag.tone] || TONE.review}`}>{tag.label}</span>;
}

/** A part the read could not read: the shared Unavailable with one Retry, re-reading the overview. */
function PartUnavailable({ what, reason, onRetry, testId }) {
  return (
    <DataState state="unavailable" size="block" what={what} reason={reason || undefined}
      claim="This is not a claim that there is nothing to show." onRetry={onRetry} data-testid={testId} />
  );
}

/** V1's Evidence row: six figures; each names what it counts and over what period. */
export function EvidenceRow({ view, onRetry, cols = 'lg:grid-cols-6' }) {
  if (view.state === 'absent') return null;
  return (
    <section aria-labelledby="validate-evidence-title" className="flex flex-col gap-2" data-testid="validate-evidence" data-state={view.state}>
      <h2 id="validate-evidence-title" className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Evidence</h2>
      {view.state === 'unavailable'
        ? <div className={CARD}><PartUnavailable what="The evidence" reason={view.reason} onRetry={onRetry} testId="validate-evidence-unavailable" /></div>
        : (
          <dl className={`m-0 grid grid-cols-2 overflow-hidden rounded-xl border border-axal-hairline bg-white sm:grid-cols-3 ${cols} dark:border-gray-800 dark:bg-gray-900`}>
            {view.figures.map((f) => (
              <div key={f.key} className="flex min-w-0 flex-col gap-1 border-b border-r border-axal-hairline px-3.5 py-3 dark:border-gray-800" data-testid={`validate-evidence-${f.key}`} data-state={f.value == null ? 'not_recorded' : 'value'}>
                <dt className="text-[11.5px] text-axal-muted dark:text-gray-400">{f.label}</dt>
                <dd className="m-0 flex flex-col gap-1">
                  {f.value == null
                    ? <Unrecorded reason={f.reason || undefined} reasonVisible={Boolean(f.reason)} />
                    : <b className="text-[19px] font-bold text-axal-ink dark:text-gray-100">{f.value}</b>}
                  {f.value != null && f.detail && <small className="text-[11.5px] leading-snug text-axal-ink/80 dark:text-gray-300">{f.detail}</small>}
                  <small className="text-[10.5px] leading-snug text-axal-muted dark:text-gray-400" data-testid="validate-evidence-population">Counts {f.population}{f.window ? ` · ${f.window}` : ''}</small>
                </dd>
              </div>
            ))}
          </dl>
        )}
    </section>
  );
}

/** Needs attention: the read's items after the one next action, most useful first. */
export function Attention({ view, onRetry, limit = null }) {
  if (view.state === 'absent') return null;
  const items = limit ? view.items.slice(0, limit) : view.items;
  return (
    <section className={CARD} aria-labelledby="validate-attention-title" data-testid="validate-attention" data-state={view.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="validate-attention-title" className={H2}>Needs attention</h2>
        {view.line && <span className={MUTED} data-testid="validate-attention-line">{view.line}</span>}
      </div>
      {view.state === 'unavailable'
        ? <PartUnavailable what="Needs attention" reason={view.reason} onRetry={onRetry} testId="validate-attention-unavailable" />
        : items.length === 0
          ? <p className={`m-0 ${MUTED}`} data-testid="validate-attention-none">Nothing else needs attention in what was read.</p>
          : (
            <ol className="m-0 list-none p-0">
              {items.map((item) => (
                <li key={item.key} className="grid grid-cols-1 gap-2 border-t border-axal-hairline py-2.5 first:border-0 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-center dark:border-gray-800" data-testid={`validate-attention-${item.kind}`}>
                  <Tag tag={item.tag} />
                  <div className="min-w-0">
                    <b className="text-[13px] text-axal-ink dark:text-gray-100">{item.label}</b>
                    {item.detail && <div className={MUTED}>{item.detail}</div>}
                  </div>
                  {item.href && item.action && <Link to={item.href} className={SECONDARY}>{item.action}</Link>}
                </li>
              ))}
            </ol>
          )}
    </section>
  );
}

function Changes({ view, onRetry }) {
  if (view.state === 'absent') return null;
  return (
    <section className={CARD} aria-labelledby="validate-changes-title" data-testid="validate-changes" data-state={view.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="validate-changes-title" className={H2}>Recent changes</h2>
        <span className={MUTED}>Decisions are not listed</span>
      </div>
      {view.state === 'unavailable'
        ? <PartUnavailable what="Recent changes" reason={view.reason} onRetry={onRetry} testId="validate-changes-unavailable" />
        : view.rows.length === 0
          ? <p className={`m-0 ${MUTED}`} data-testid="validate-changes-none">No changes recorded yet.</p>
          : (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {view.rows.map((r) => (
                <li key={r.key} className="grid grid-cols-[52px_minmax(0,1fr)] gap-2 text-[12.5px] text-axal-ink dark:text-gray-200">
                  <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400">{r.day || 'Not recorded'}</span>
                  <span className="min-w-0"><b className="font-semibold">{r.module}</b>{r.text ? ` · ${r.text}` : ''}</span>
                </li>
              ))}
            </ol>
          )}
    </section>
  );
}

function Direction({ kind, n }) {
  const plus = kind === 'supports';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${plus ? 'border-emerald-300 text-emerald-800 dark:border-emerald-700 dark:text-emerald-300' : 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300'}`}>
      <i aria-hidden="true" className="not-italic">{plus ? '+' : '−'}</i>{plus ? 'Supports' : 'Contradicts'} · {n}
    </span>
  );
}

function Status({ word }) {
  return word
    ? <span className="inline-flex w-fit items-center whitespace-nowrap rounded-full border border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-800 dark:border-gray-600 dark:text-gray-200">{word}</span>
    : <StateChip kind="not_recorded" />;
}

/** Active hypotheses: state, direction and source breadth; one action each. */
function Hypotheses({ view, onRetry, allHref }) {
  if (view.state === 'absent') return null;
  return (
    <section className={CARD} aria-labelledby="validate-hypotheses-title" data-testid="validate-hypotheses" data-state={view.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="validate-hypotheses-title" className={H2}>Active hypotheses</h2>
        {view.state === 'ok' && <Link to={allHref} className={TEXT_LINK}>All hypotheses{view.total > view.rows.length ? ` (${view.total})` : ''} →</Link>}
      </div>
      {view.state === 'unavailable'
        ? <PartUnavailable what="The hypotheses" reason={view.reason} onRetry={onRetry} testId="validate-hypotheses-unavailable" />
        : view.rows.length === 0
          ? <p className={`m-0 ${MUTED}`} data-testid="validate-hypotheses-none">No open hypotheses.</p>
          : (
            <div role="table" aria-label="Active hypotheses" className="flex flex-col">
              {view.rows.map((h) => (
                <div key={h.key} role="row" className="grid grid-cols-1 gap-2 border-t border-axal-hairline py-2.5 first:border-0 lg:grid-cols-[44px_minmax(0,1fr)_96px_minmax(0,180px)_minmax(0,170px)_auto] lg:items-center dark:border-gray-800" data-testid={`validate-hypothesis-${h.key}`}>
                  <span role="cell" className="font-mono text-[11.5px] font-bold text-axal-violet-deep dark:text-violet-300">{h.code}</span>
                  <div role="cell" className="min-w-0">
                    <div className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{h.claim}</div>
                    {h.sources && <small className={MUTED}>{h.sources}</small>}
                  </div>
                  <span role="cell"><Status word={h.status} /></span>
                  <span role="cell" className="flex flex-wrap gap-1">
                    {h.supporting + h.contradicting === 0
                      ? <span className={MUTED}>No evidence linked</span>
                      : <>{h.supporting > 0 && <Direction kind="supports" n={h.supporting} />}{h.contradicting > 0 && <Direction kind="contradicts" n={h.contradicting} />}</>}
                  </span>
                  <span role="cell" className="flex flex-col gap-1 text-[12px] text-axal-ink/80 dark:text-gray-300">
                    {h.experiment.resultNeeded && <Tag tag={{ label: 'Result needed', tone: 'result' }} />}
                    <span>{h.experiment.text}</span>
                  </span>
                  {h.href ? <Link role="cell" to={h.href} className={TEXT_LINK}>{h.action}</Link> : <span role="cell" />}
                </div>
              ))}
            </div>
          )}
    </section>
  );
}

/** V13: an empty venture gets one calm list of what is still to establish, not a wall of empty modules. */
function StillToEstablish({ rows }) {
  return (
    <section className={CARD} aria-labelledby="validate-still-title" data-testid="validate-still-to-establish">
      <h2 id="validate-still-title" className={H2}>Still to establish</h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-axal-hairline py-2.5 first:border-0 dark:border-gray-800" data-testid={`validate-still-${r.key}`}>
            <div className="min-w-0">
              <b className="text-[13px] text-axal-ink dark:text-gray-100">{r.name}</b>
              {r.reason && <div className={MUTED}>{r.reason}</div>}
            </div>
            <StateChip kind="not_recorded" />
            {r.href && r.cta && <Link to={r.href} className={`${TEXT_LINK} col-span-2 w-fit`}>{r.cta}</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading Validate overview" data-testid="validate-overview-loading">
      <div className="h-[52px] animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" />
      <div className="h-[96px] animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" />
      <div className="h-[92px] animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" />
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="h-48 animate-pulse rounded-xl bg-axal-ground lg:col-span-7 dark:bg-gray-800" />
        <div className="h-48 animate-pulse rounded-xl bg-axal-ground lg:col-span-5 dark:bg-gray-800" />
      </div>
    </div>
  );
}

/** Record a session, the cycle's own action, kept in reach beside the header as a secondary button. */
function RecordSession({ action }) {
  if (!action?.href) return null;
  return (
    <Link to={action.href} className={SECONDARY} data-testid="cycle-action" aria-haspopup={action.onOpen ? 'dialog' : undefined}
      onClick={action.onOpen ? (e) => { if (isPlainClick(e)) { e.preventDefault(); action.onOpen(); } } : undefined}>{action.label}</Link>
  );
}

/** V2 A/B under the phone root's next action: Needs attention (three), the evidence from 768px, the first hypotheses. */
function PhoneParts({ raw, writer, onRetry, readOnly }) {
  const attention = attentionView(raw);
  const evidence = evidenceView(raw);
  const hyps = hypothesesView(raw, { writer });
  const empty = stillToEstablish(raw);
  return (
    <div className="mt-[26px] flex flex-col gap-3" data-testid="validate-phone-parts">
      {readOnly && <p role="status" className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100" data-testid="validate-read-only"><Tag tag={{ label: 'Locked', tone: 'muted' }} /> Read only: this venture’s writes are its founders’.</p>}
      {empty ? <StillToEstablish rows={empty} /> : (
        <>
          <div className="hidden md:block"><EvidenceRow view={evidence} onRetry={onRetry} cols="md:grid-cols-3" /></div>
          <Attention view={attention} onRetry={onRetry} limit={3} />
          {hyps.state === 'ok' && hyps.rows.length > 0 && (
            <section aria-label="Active hypotheses" className="flex flex-col gap-2" data-testid="validate-phone-hypotheses">
              {hyps.rows.slice(0, 2).map((h) => (
                <Link key={h.key} to={h.href || '#'} className={`${CARD} gap-1.5`} data-testid={`validate-phone-hypothesis-${h.key}`}>
                  <b className="text-[13px] text-axal-ink dark:text-gray-100">{h.code} · {h.claim}</b>
                  <Status word={h.status} />
                </Link>
              ))}
            </section>
          )}
          {hyps.state === 'unavailable' && <div className={CARD}><PartUnavailable what="The hypotheses" reason={hyps.reason} onRetry={onRetry} testId="validate-hypotheses-unavailable" /></div>}
        </>
      )}
    </div>
  );
}

export default function ValidateOverview({ raw, data, status, search = '', message = '', action = null, readOnly = false, onRetry, onRetryCard, openAction, onChanged, projectId = null, phone = false }) {
  const ready = status === 'ready' && raw;
  const writer = ready ? validateWriter(raw, readOnly) : false;
  // The read's own `can_write: false` (a partner, an advisor): every write is the founders'.
  const readOnlyView = ready && raw?.can_write === false;
  // A read-only page (support, narrative admin) draws the read as a reader would: no write controls.
  const viewRaw = ready && readOnly ? { ...raw, can_write: false } : raw;

  if (phone) {
    return (
      <PhoneCycleRoot cycle="validate" raw={viewRaw} status={status} search={search} projectId={projectId} message={message}
        openAction={readOnly ? undefined : openAction} onChanged={onChanged} onRetry={onRetry}
        before={ready && raw.objective ? <div className="mb-4"><ValidateObjective part={raw.objective} canWrite={writer} projectId={projectId} onChanged={onChanged} /></div> : null}
        after={ready ? <PhoneParts raw={viewRaw} writer={writer} onRetry={onRetry} readOnly={readOnly || readOnlyView} /> : null} />
    );
  }

  const cards = Array.isArray(data?.cards) ? data.cards : [];
  const empty = ready ? stillToEstablish(raw) : null;
  const allHref = `/validate/experiments${search || ''}`;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="validate-overview-v2">
      <CycleHeader cycle="validate" cards={cards} action={null} search={search}
        chip={projectId ? <PmfChip projectId={projectId} search={search} /> : null}
        more={readOnly ? null : <RecordSession action={action} />} />
      {status === 'loading' ? <Loading />
        : status === 'refused' ? <p role="status" className={`${CARD} m-0 text-[14px] font-semibold text-axal-ink dark:text-gray-100`} data-testid="validate-overview-refused">{message || 'You cannot open this venture’s Validate.'}</p>
          : !ready ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30" data-testid="validate-overview-unreadable">
              <DataState state="unavailable" size="block" what="The Validate overview" claim="This is not a claim that nothing is recorded." onRetry={onRetry} />
            </div>
          ) : (
            <>
              {(readOnly || readOnlyView) && (
                <p role="status" className="m-0 flex flex-wrap items-center gap-2 rounded-[10px] border border-axal-hairline bg-white px-3.5 py-2 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100" data-testid="validate-read-only">
                  <Tag tag={{ label: 'Locked', tone: 'muted' }} /> Read only: you can read this venture’s Validate; its writes are its founders’.
                </p>
              )}
              <ValidateLead raw={viewRaw} search={search} openAction={readOnly ? undefined : openAction} projectId={projectId} onChanged={onChanged} />
              {empty ? <StillToEstablish rows={empty} /> : (
                <>
                  <EvidenceRow view={evidenceView(raw)} onRetry={onRetry} />
                  <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
                    <div className="min-w-0 lg:col-span-7"><Attention view={attentionView(raw)} onRetry={onRetry} /></div>
                    <div className="min-w-0 lg:col-span-5"><Changes view={changesView(raw)} onRetry={onRetry} /></div>
                  </div>
                  <Hypotheses view={hypothesesView(raw, { writer })} onRetry={onRetry} allHref={allHref} />
                </>
              )}
            </>
          )}
    </div>
  );
}
