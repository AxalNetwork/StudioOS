/**
 * D6028 (#6028) — Build Overview V2, drawn to BD1 (desktop) and BD2 (phone)
 * of `design/incoming/Build v2 Page.dc.html` from the read D6027 built
 * (`GET /api/cycles/build/overview`). Mounted through `def.Overview`
 * (`defs/build.jsx`), so `CycleOverview.jsx` stays as it is for the other
 * cycles.
 *
 * One next action owns the page: the Next card's button is the only primary
 * (the header's Connect a tool is gone on this page, D6028). Then the status
 * strip with each figure's source, Needs attention (material blockers only),
 * the Build Plan preview and compact module cards, one status sentence and
 * one link each.
 *
 * Below 1024px the page is the phone root (`PhoneCycleRoot.jsx`, D703) with
 * Needs attention drawn under the next action and the plan row carrying the
 * plan's counts (BD2); the Build tabs and the plan entry are #4602's.
 *
 * Each part fails on its own and offers its own retry. The words for a state
 * come from `BuildState` below, one local component so #5129's shared state
 * component can replace it in one place.
 */
import { Link } from 'react-router-dom';
import { CycleHeader } from './CycleOverview';
import PhoneCycleRoot from './PhoneCycleRoot';
import { isPlainClick } from './cycleModel';
import { ROOT_ACTION_PATHS } from './validatePhone';
import HeaderAsk from '../../ui/HeaderAsk.jsx';
import { Unrecorded, Unreadable } from '../../ui';
import { attentionView, buildReadOnly, moduleCards, nextAction, overviewForViewer, planPreview, statusStrip } from './buildOverviewModel';

const CARD = 'flex min-w-0 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12px] leading-relaxed text-axal-muted dark:text-gray-400';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] bg-axal-violet px-4 py-2 text-[13px] font-bold text-white hover:bg-axal-violet-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet dark:bg-violet-600 dark:hover:bg-violet-500';
const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[12px] font-bold text-axal-violet-deep hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-violet-300 dark:hover:bg-gray-800';
const TEXT_LINK = 'inline-flex min-h-[44px] items-center text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300';
const RETRY = 'inline-flex min-h-[44px] items-center text-[12px] font-bold text-red-700 hover:underline dark:text-red-300';

const TONE = {
  needs_attention: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200',
  blocked: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200',
  not_recorded: 'border-dashed border-gray-300 bg-transparent italic text-gray-600 dark:border-gray-600 dark:text-gray-400',
  processing: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  unreadable: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
};

/**
 * The page's state words, in one place (#5129 will ship the shared ones):
 *   not_recorded  a readable source with no value: "Not recorded", never 0
 *   unreadable    a failed read: "<what> could not be read", with its own Try again
 *   read_only     a reader who cannot write
 */
export function BuildState({ state, what = '', reason = '', onRetry }) {
  if (state === 'unreadable') {
    return (
      <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="build-state-unreadable">
        <span>{what ? `${what} could not be read.` : 'Could not be read.'} {reason}</span>
        {onRetry && <button type="button" className={RETRY} onClick={onRetry}>Try again</button>}
      </span>
    );
  }
  if (state === 'read_only') {
    return <span className="text-[12.5px] font-bold" data-testid="build-state-read-only">Read only · {reason || 'decisions are the venture’s founders’.'}</span>;
  }
  return <span data-testid="build-state-not-recorded"><Unrecorded reason={reason || undefined} /></span>;
}

function Tag({ tone, children }) {
  return <span className={`inline-flex w-fit items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONE[tone] || TONE.needs_attention}`}>{children}</span>;
}

/** The cycle's own action route (Connect a tool) opens over the page on a plain click, as the phone root does. */
const opensOver = (href, openAction) => (openAction && String(href).split(/[?#]/)[0] === `/build/${ROOT_ACTION_PATHS.build}`
  ? (e) => { if (isPlainClick(e)) { e.preventDefault(); openAction(); } } : undefined);

function NextCard({ focus, openAction }) {
  if (!focus) return null;
  const tone = focus.unavailable
    ? 'border-red-200 dark:border-red-900'
    : 'border-axal-lavender-edge dark:border-violet-800';
  return (
    <section aria-labelledby="build-next-title" data-testid="build-next" data-rule={focus.rule || ''}
      className={`relative grid gap-3 overflow-hidden rounded-[14px] border-[1.5px] bg-white py-4 pl-6 pr-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center dark:bg-gray-900 ${tone}`}>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${focus.unavailable ? 'bg-red-500' : 'bg-axal-violet dark:bg-violet-500'}`} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-violet dark:text-violet-300">Next</span>
        <h2 id="build-next-title" className="m-0 text-[20px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">{focus.headline}</h2>
        {focus.why && <p className={`m-0 text-[13px] leading-relaxed ${focus.unavailable ? 'text-red-700 dark:text-red-300' : 'text-axal-ink/80 dark:text-gray-300'}`} data-testid="build-next-why">{focus.why}</p>}
        {focus.then && <p className={`m-0 ${MUTED}`}>Then: {focus.then.replace(/^then\s*:?\s+/i, '')}</p>}
      </div>
      {focus.href && (
        <Link to={focus.href} className={PRIMARY} onClick={opensOver(focus.href, openAction)} data-testid="build-next-cta">{focus.cta} →</Link>
      )}
    </section>
  );
}

function StatusStrip({ items }) {
  if (!items.length) return null;
  return (
    <section aria-label="Build status" data-testid="build-status-strip"
      className="grid grid-cols-2 overflow-hidden rounded-xl border border-axal-hairline bg-white xl:grid-cols-4 dark:border-gray-800 dark:bg-gray-900">
      {items.map((f) => (
        <div key={f.key} className="flex min-w-0 flex-col gap-1 border-b border-r border-axal-hairline px-3.5 py-3 dark:border-gray-800" data-testid={`build-status-${f.key}`} data-state={f.state}>
          <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{f.label}</span>
          <b className="text-[17px] font-bold text-axal-ink dark:text-gray-100">
            {f.state === 'ok' ? f.value : <BuildState state={f.state} what={f.source || f.label} reason={f.state === 'not_recorded' ? f.reason : ''} />}
          </b>
          {f.source && (f.href
            ? <Link to={f.href} className="w-fit text-[10.5px] text-axal-muted hover:underline dark:text-gray-400">{f.source}</Link>
            : <span className="text-[10.5px] text-axal-muted dark:text-gray-400">{f.source}</span>)}
        </div>
      ))}
    </section>
  );
}

function Attention({ view, onRetry }) {
  return (
    <section className={CARD} aria-labelledby="build-attention-title" data-testid="build-attention" data-state={view.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="build-attention-title" className={H2}>Needs attention</h2>
        {view.state !== 'unreadable' && <span className={MUTED}>{view.count ? `${view.count} · material blockers only` : 'Material blockers only'}</span>}
      </div>
      {view.state === 'unreadable'
        ? <Unreadable what="Needs attention" claim="This does not mean nothing needs attention." onRetry={onRetry} />
        : view.items.length === 0
          ? <p className={`m-0 ${MUTED}`} data-testid="build-attention-none">Nothing needs attention in the records that were read.</p>
          : (
            <ol className="m-0 list-none p-0">
              {view.items.map((item) => (
                <li key={item.key} className="grid grid-cols-1 gap-2 border-t border-axal-hairline py-2.5 first:border-0 sm:grid-cols-[128px_minmax(0,1fr)_auto] sm:items-center dark:border-gray-800" data-testid={`build-attention-${item.key}`}>
                  <Tag tone={item.tone}>{item.toneLabel}</Tag>
                  <div className="min-w-0">
                    <b className="text-[13px] text-axal-ink dark:text-gray-100">{item.title}</b>
                    {item.detail && <div className={MUTED}>{item.detail}</div>}
                  </div>
                  {item.unreadable
                    ? <button type="button" className={SECONDARY} onClick={onRetry} data-testid={`build-attention-retry-${item.key}`}>Try again</button>
                    : item.link && <Link to={item.link.href} className={SECONDARY}>{item.link.label}</Link>}
                </li>
              ))}
            </ol>
          )}
    </section>
  );
}

function PlanCard({ plan, onRetry }) {
  return (
    <section className={CARD} aria-labelledby="build-plan-title" data-testid="build-plan-preview" data-state={plan.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="build-plan-title" className={H2}>Build Plan</h2>
        {plan.line && <span className={MUTED} data-testid="build-plan-line">{plan.line}</span>}
      </div>
      {plan.state === 'unreadable' ? <Unreadable what="The Build Plan" claim="This is not a claim that nothing waits for a decision." onRetry={onRetry} />
        : plan.state === 'restricted' ? <p className={`m-0 ${MUTED}`}>The Build Plan is open to the venture’s founders.</p>
          : plan.state === 'not_recorded' ? <p className={`m-0 ${MUTED}`}><BuildState state="not_recorded" /> · no Build Plan has been prepared for this venture.</p>
            : plan.items.length === 0 ? <p className={`m-0 ${MUTED}`}>Nothing is waiting for your decision.</p>
              : (
                <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[10px] border border-axal-hairline p-0 dark:border-gray-800">
                  {plan.items.map((i) => (
                    <li key={i.uid} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-axal-hairline px-3 py-2 last:border-0 dark:border-gray-800">
                      <b className="text-[12.5px] text-axal-ink dark:text-gray-100">{i.title || <Unrecorded reason="This proposal has no title." />}</b>
                      <span className="row-span-2"><Tag tone="processing">Waiting for you</Tag></span>
                      {i.meta && <small className="text-[11.5px] text-axal-muted dark:text-gray-400">{i.meta}</small>}
                    </li>
                  ))}
                </ul>
              )}
      {plan.state !== 'restricted' && <Link to={plan.href} className={`${TEXT_LINK} self-start`} data-testid="build-plan-open">Open Build Plan →</Link>}
    </section>
  );
}

function Modules({ cards, onRetryCard }) {
  if (!cards.length) return null;
  return (
    <section aria-labelledby="build-modules-title" className="flex flex-col gap-2.5">
      <h2 id="build-modules-title" className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Modules</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="build-modules">
        {cards.map((c) => (
          <article key={c.slug} className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-axal-hairline bg-white px-3.5 py-3 dark:border-gray-800 dark:bg-gray-900" data-testid={`build-module-${c.slug}`} data-state={c.state}>
            <b className="text-[13.5px] text-axal-ink dark:text-gray-100">{c.name}</b>
            {c.state === 'unreadable'
              ? <BuildState state="unreadable" what={c.name} onRetry={onRetryCard ? () => onRetryCard(c.slug) : undefined} />
              : <span className={`text-[12.5px] ${c.state === 'ok' ? 'text-axal-ink/80 dark:text-gray-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid="build-module-sentence">{c.sentence}</span>}
            <Link to={c.link.href} className={`${TEXT_LINK} mt-auto`}>{c.link.label} →</Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading Build overview" data-testid="build-overview-loading">
      <div className="h-[104px] animate-pulse rounded-[14px] bg-axal-ground dark:bg-gray-800" />
      <div className="h-[78px] animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" />
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="h-48 animate-pulse rounded-xl bg-axal-ground lg:col-span-7 dark:bg-gray-800" />
        <div className="h-48 animate-pulse rounded-xl bg-axal-ground lg:col-span-5 dark:bg-gray-800" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" />)}
      </div>
    </div>
  );
}

/** BD2: Needs attention under the phone's next action, three rows and the count, each row one 52px target. */
function PhoneAttention({ view, onRetry, readOnly }) {
  const rows = view.items.slice(0, 3);
  return (
    <div className="mt-[26px] flex flex-col gap-3" data-testid="build-phone-extra">
      {readOnly && <p role="status" className="m-0 text-[13px] text-axal-ink dark:text-gray-100"><BuildState state="read_only" /></p>}
      <section className={CARD} aria-labelledby="build-phone-attention-title" data-testid="build-attention" data-state={view.state}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="build-phone-attention-title" className={H2}>Needs attention</h2>
          {view.state !== 'unreadable' && view.count > 0 && <span className={MUTED}>{view.count}</span>}
        </div>
        {view.state === 'unreadable'
          ? <Unreadable what="Needs attention" claim="This does not mean nothing needs attention." onRetry={onRetry} />
          : rows.length === 0 ? <p className={`m-0 ${MUTED}`} data-testid="build-attention-none">Nothing needs attention in the records that were read.</p>
            : rows.map((item) => (item.unreadable
              ? (
                <div key={item.key} className="flex min-h-[52px] items-center justify-between gap-2 border-t border-axal-hairline first:border-0 dark:border-gray-800" data-testid={`build-attention-${item.key}`}>
                  <b className="text-[13px] text-red-700 dark:text-red-300">{item.title}</b>
                  <button type="button" className={RETRY} onClick={onRetry} data-testid={`build-attention-retry-${item.key}`}>Try again</button>
                </div>
              ) : item.link && (
                <Link key={item.key} to={item.link.href} className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-t border-axal-hairline py-1.5 first:border-0 dark:border-gray-800" data-testid={`build-attention-${item.key}`}>
                  <b className="text-[13px] text-axal-ink dark:text-gray-100">{item.title}</b>
                  <span aria-hidden="true" className="row-span-2 text-axal-muted dark:text-gray-400">›</span>
                  <span className="text-[12px] font-semibold text-axal-violet-deep dark:text-violet-300">{item.link.label}</span>
                </Link>
              )))}
      </section>
    </div>
  );
}

export default function BuildOverview({ raw, data, status, search = '', message = '', readOnly: readOnlyIn = false, onRetry, onRetryCard, openAction, onChanged, projectId = null, phone = false }) {
  const ready = status === 'ready' && raw;
  const readOnly = ready ? buildReadOnly(raw, readOnlyIn) : Boolean(readOnlyIn);
  const viewRaw = ready ? overviewForViewer(raw, readOnly) : raw;
  const attention = ready ? attentionView(raw, readOnly) : null;
  const plan = ready ? planPreview(raw, search) : null;

  if (phone) {
    return (
      <PhoneCycleRoot cycle="build" raw={viewRaw} status={status} search={search} projectId={projectId} message={message}
        openAction={readOnly ? undefined : openAction} onChanged={onChanged} onRetry={onRetry}
        after={attention ? <PhoneAttention view={attention} onRetry={onRetry} readOnly={readOnly} /> : null}
        planLine={plan?.line || null} />
    );
  }

  const cards = Array.isArray(data?.cards) ? data.cards : [];
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="build-overview-v2">
      {/* D6028: no header action on this page; the Next card holds the one primary. */}
      <CycleHeader cycle="build" cards={cards} action={null} search={search}
        title="Turn what you proved into a company." sub="Decide what to build, ship it, and keep the evidence attached."
        more={readOnly ? null : <HeaderAsk label="Build · Overview" testId="build-overview-ask" />} />
      {status === 'loading' ? <Loading />
        : status === 'refused' ? <p role="status" className={`${CARD} m-0 text-[14px] font-semibold text-axal-ink dark:text-gray-100`} data-testid="build-overview-refused">{message || 'You cannot open this venture’s Build.'}</p>
          : !ready ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30" data-testid="build-overview-unreadable">
              <Unreadable what="The Build overview" claim="This is not a claim that nothing is recorded." onRetry={onRetry} />
            </div>
          ) : (
            <>
              {readOnly && (
                <div role="status" className="rounded-[10px] border border-amber-300 bg-amber-50 px-3.5 py-2 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200" data-testid="build-overview-read-only">
                  <BuildState state="read_only" reason="you can read this venture’s Build, and its write actions are the founders’." />
                </div>
              )}
              <NextCard focus={nextAction(viewRaw, search)} openAction={readOnly ? undefined : openAction} />
              <StatusStrip items={statusStrip(raw, search)} />
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
                <div className="min-w-0 lg:col-span-7"><Attention view={attention} onRetry={onRetry} /></div>
                <div className="min-w-0 lg:col-span-5"><PlanCard plan={plan} onRetry={onRetry} /></div>
              </div>
              <Modules cards={moduleCards(raw, search, readOnly, cards)} onRetryCard={onRetryCard} />
            </>
          )}
    </div>
  );
}
