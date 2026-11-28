/**
 * D8729 (#8729) — the founder Studio's venture work, drawn to
 * `design/incoming/Studio Home Founder Page.dc.html` (SFD03 to SFD14): the
 * venture header whose h1 names the active venture, the Next card with one
 * primary action, and the separate paths for a first venture, a venture the
 * member cannot open, two ventures with none selected, and a projects read that
 * failed. The rules are `founderNextModel.js`; this file draws them.
 *
 * THE WAY BACK. A task link is a real link to the module's canonical address
 * (`studioTaskLink`). A plain click first stamps Studio's own history entry
 * with the id of the control that left it (`state.focus`), then pushes the
 * module with `state.under`, so Cancel, Esc or Back land on this entry again
 * and `useReturnFocus` puts focus back on that control once it is drawn.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, CircleAlert, RefreshCw } from 'lucide-react';
import { isPlainClick } from '../cycles/cycleModel';
import {
  CHOOSE_TITLE, FIRST_VENTURE_HREF, NEXT, NEXT_NONE_BODY, NEXT_NONE_TITLE, NEXT_UNREADABLE, VENTURES_UNREADABLE,
  taskName, ventureInitials,
} from './founderNextModel';

const CARD = 'mb-4 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint';

/** The address Studio is on now, for `state.under`. */
const here = (location) => `${location.pathname}${location.search}`;

/**
 * A link from Studio into a venture's module that keeps the way back: its
 * state carries `under` (CycleRoute's Cancel goes Back) and the venture the
 * link was written for, and Studio's own entry remembers which control left.
 */
export function StudioTaskLink({ to, id, ventureId = null, venture = null, className, children, ...rest }) {
  const location = useLocation();
  const navigate = useNavigate();
  const onClick = (e) => {
    if (!isPlainClick(e)) return;
    navigate(here(location), { replace: true, state: { ...(location.state || {}), focus: id } });
  };
  return (
    <Link to={to} id={id} state={{ under: here(location), focus: id, ventureId, venture }} onClick={onClick} className={className} {...rest}>
      {children}
    </Link>
  );
}

/** Back on Studio: focus the control the founder left from, once it is drawn (SFD06, SFD14). */
export function useReturnFocus() {
  const location = useLocation();
  const done = useRef(null);
  useEffect(() => {
    const id = location.state?.focus;
    if (typeof id !== 'string' || !id || done.current === location.key) return;
    const el = typeof document === 'undefined' ? null : document.getElementById(id);
    if (!el) return;
    done.current = location.key;
    el.focus?.();
  });
}

/** The shell switcher's trigger that is on screen: the sidebar's, or the phone header's pill. */
export function openShellSwitcher(doc = typeof document === 'undefined' ? null : document) {
  const all = doc ? [...doc.querySelectorAll('[data-company-switcher]')] : [];
  const el = all.find((x) => typeof x.getClientRects === 'function' && x.getClientRects().length > 0);
  if (!el) return false;
  el.click?.();
  return true;
}

/** The member's ventures as links into Studio, the current one marked. */
export function VentureChoices({ ventures, current = null, testId = 'studio-venture-choices', rows = false }) {
  const list = Array.isArray(ventures) ? ventures : [];
  if (!list.length) return null;
  return (
    <ul className={rows ? 'grid gap-2' : 'flex flex-wrap gap-2'} data-testid={testId}>
      {list.map((v) => {
        const name = v.name || `Venture ${v.id}`;
        const on = current != null && String(current) === String(v.id);
        return (
          <li key={v.id}>
            <Link
              to={`/studio?project_id=${encodeURIComponent(v.id)}`}
              aria-current={on ? 'page' : undefined}
              className={rows
                ? 'flex min-h-11 items-center gap-3 rounded-lg border border-axal-hairline px-3 py-2 text-[13.5px] font-semibold hover:border-violet-300 dark:border-gray-700'
                : 'sm-btn sm-btn-s min-h-11'}
              data-testid={`link-studio-venture-${v.id}`}
            >
              {rows && <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-[11px] font-extrabold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">{ventureInitials(name)}</span>}
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {rows && <ChevronRight size={14} aria-hidden="true" className="text-axal-muted" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The page's first heading and its line (SFD03, SFD09, SFD10, SFD12A). `head`
 * is `ventureHeadOf`; `level` is h1, or h2 inside the multi-licence Studio,
 * whose page owns the h1.
 */
export function VentureHeader({ head, header, ventures, currentId = null, phone = false, level = 'h1', customise = null, headingRef = null }) {
  const [list, setList] = useState(false);
  const H = level;
  const venture = head.kind === 'venture';
  const sub = head.kind === 'first' ? 'no venture yet. Start one, or talk it through with Eadwyn first.'
    : head.kind === 'unavailable' ? 'the link names a venture you cannot open.'
      : 'everything you have built across the platform, what it unlocked, and what to do next.';
  const canSwitch = venture && Array.isArray(ventures);
  const onSwitch = () => { if (!openShellSwitcher()) setList((v) => !v); };
  return (
    <header className={`flex flex-wrap items-end justify-between gap-3 ${phone ? 'pb-4' : 'pb-5'}`} data-testid="founder-studio-venture-head">
      <div className="min-w-0">
        <p className={EYEBROW}>{venture ? 'Studio · your venture' : 'Studio'}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <H ref={headingRef} tabIndex={-1} className={`${phone ? 'text-[24px]' : 'text-[28px]'} font-extrabold leading-tight tracking-tight outline-none`} data-testid="text-founder-studio-title">
            {head.kind === 'loading'
              ? <><span className="sr-only">Studio</span><span aria-hidden="true" className="inline-block h-6 w-48 rounded-full bg-gray-100 align-middle dark:bg-gray-800" /></>
              : head.title}
          </H>
          {canSwitch && (
            <button type="button" className={`sm-btn sm-btn-s ${phone ? 'sm-btn-sm min-h-11' : ''}`} aria-haspopup="true" aria-expanded={list ? 'true' : 'false'} aria-label="Switch venture" onClick={onSwitch} data-testid="button-studio-switch-venture">
              {phone ? 'Switch' : 'Switch venture'}
            </button>
          )}
          {header.phase && venture && <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" data-testid="badge-founder-studio-phase">{header.phase}</span>}
        </div>
        {!phone && (
          <p className="mt-1.5 max-w-[640px] text-[13.5px] text-axal-muted" data-testid="text-founder-studio-context">{header.founderLine}: {sub}</p>
        )}
        {list && canSwitch && (
          <div className="mt-3" data-testid="studio-switch-list">
            <VentureChoices ventures={ventures} current={currentId} rows />
            <Link to="/account/portfolio" className="sm-link mt-2 inline-block">Open Portfolio ›</Link>
          </div>
        )}
      </div>
      {customise}
    </header>
  );
}

function Skeleton() {
  return (
    <div className="sm-skel min-h-[132px]" aria-busy="true" data-testid="studio-next-loading">
      <i style={{ width: '22%' }} /><i style={{ width: '46%', height: 16 }} /><i style={{ width: '64%' }} />
      <i style={{ width: 120, height: 40, borderRadius: 9 }} />
      <span className="sm-muted">Reading your modules…</span>
    </div>
  );
}

/**
 * The Next card (SFD03, SFD11, SFD12A): the placed modules' next steps in
 * layout order; the first venture task is the one primary.
 */
export function NextCard({ next, venture, ventureId, phone = false, onRetry = null, onOpenEadwyn = null, onAddModules = null, dim = '' }) {
  const titleId = 'studio-next-title';
  const primary = next.state === NEXT.READY ? next.steps.find((s) => s.to) || null : null;
  const rest = next.state === NEXT.READY ? next.steps.filter((s) => s !== primary) : [];
  return (
    <section className={`${CARD} ${dim}`} aria-labelledby={titleId} data-testid="studio-next" data-state={next.state}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={titleId} className="text-[16px] font-extrabold tracking-tight">Next for {venture}</h2>
        {!phone && <span className="sm-muted">{next.state === NEXT.LOADING ? 'Reading your modules…' : 'From your placed modules, in layout order'}</span>}
      </div>
      {next.state === NEXT.LOADING && <Skeleton />}
      {next.state === NEXT.UNREADABLE && (
        <div className="grid gap-3">
          <p className="sm-err" role="alert" data-testid="studio-next-unreadable">
            <CircleAlert size={14} aria-hidden="true" />
            <span>{NEXT_UNREADABLE} The venture is still {venture}.</span>
            {onRetry && <button type="button" className="sm-btn sm-btn-s sm-btn-sm" onClick={onRetry}><RefreshCw size={12} aria-hidden="true" /> Try again</button>}
          </p>
          <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-axal-hairline px-3 py-2 text-[13px] dark:border-gray-700">
            <span><strong>Open Build for {venture}</strong> <span className="sm-muted">Every module page still works</span></span>
            <Link to={`/build?project_id=${encodeURIComponent(ventureId)}`} className="sm-link">Open Build ›</Link>
          </p>
        </div>
      )}
      {next.state === NEXT.NONE && (
        <div className="grid gap-2" data-testid="studio-next-none">
          <p className="text-[13.5px] font-semibold">{NEXT_NONE_TITLE}</p>
          <p className="sm-muted">{NEXT_NONE_BODY}</p>
          {onAddModules && <div><button type="button" className="sm-btn sm-btn-s" onClick={onAddModules}>Add modules</button></div>}
        </div>
      )}
      {next.state === NEXT.READY && (
        <div className="grid gap-2.5">
          {primary && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/20" data-testid="studio-next-primary">
              <p className={EYEBROW}>{primary.source}</p>
              <p className="mt-0.5 text-[15px] font-extrabold">{primary.text}</p>
              {primary.detail && <p className="sm-muted mt-0.5">{primary.detail}</p>}
              <StudioTaskLink to={primary.to} id={`studio-next-${primary.key}`} ventureId={ventureId} venture={venture}
                className={`sm-btn sm-btn-p mt-2.5 ${phone ? 'min-h-11' : ''}`} aria-label={taskName(primary.text, venture)} data-testid="link-studio-next-primary">
                {primary.text}
              </StudioTaskLink>
            </div>
          )}
          {rest.length > 0 && (
            <ul className="grid gap-1.5" data-testid="studio-next-rest">
              {rest.map((s) => (
                <li key={s.key} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-700">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold">{s.text}</span>
                    <span className="block text-[11.5px] text-axal-muted">{s.eadwyn ? (phone ? 'Eadwyn · answer in the chat' : 'Eadwyn · answer them in the chat below') : s.source}</span>
                  </span>
                  {s.eadwyn
                    ? <button type="button" id={`studio-next-${s.key}`} className="sm-link min-h-11 shrink-0" onClick={onOpenEadwyn || undefined} aria-label="Answer Eadwyn’s questions">Answer ›</button>
                    : s.to && (
                      <StudioTaskLink to={s.to} id={`studio-next-${s.key}`} ventureId={ventureId} venture={venture} className="sm-link inline-flex min-h-11 shrink-0 items-center" aria-label={taskName(s.text, venture)}>
                        Open ›
                      </StudioTaskLink>
                    )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** No venture yet (SFD09, SFD12E): the one way to make one, and Eadwyn, which works without one. */
export function FirstVentureCard({ onOpenEadwyn = null, phone = false, dim = '' }) {
  return (
    <section className={`${CARD} ${dim}`} aria-labelledby="studio-first-title" data-testid="studio-first-venture">
      <h2 id="studio-first-title" className="text-[16px] font-extrabold tracking-tight">Start your first venture</h2>
      {!phone && <p className="sm-muted">Nothing is recorded until a venture exists</p>}
      <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/20">
        <p className={EYEBROW}>Build</p>
        <p className="mt-0.5 text-[15px] font-extrabold">Create your startup</p>
        <p className="sm-muted mt-0.5">Name it and pick its stage. Studio then shows its modules and next steps.</p>
        <Link to={FIRST_VENTURE_HREF} className={`sm-btn sm-btn-p mt-2.5 ${phone ? 'min-h-11' : ''}`} data-testid="link-studio-first-venture">Create your startup</Link>
      </div>
      <p className="mt-2 flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border border-axal-hairline px-3 py-2 text-[13px] dark:border-gray-700">
        <span><strong>Talk it through with Eadwyn{phone ? '' : ' first'}</strong> <span className="sm-muted">{phone ? 'Works without a venture' : 'The founder interview below works without a venture'}</span></span>
        <button type="button" className="sm-link min-h-11" onClick={onOpenEadwyn || undefined}>Go to Eadwyn ›</button>
      </p>
    </section>
  );
}

/** Two or more ventures and none selected (SFD08 A, owner Q1 A): ask. */
export function VentureChooser({ ventures, dim = '' }) {
  const n = Array.isArray(ventures) ? ventures.length : 0;
  return (
    <section className={`${CARD} ${dim}`} aria-labelledby="studio-choose-title" data-testid="studio-venture-chooser">
      <h2 id="studio-choose-title" className="text-[16px] font-extrabold tracking-tight">{CHOOSE_TITLE}</h2>
      <p className="sm-muted mt-1">You have {n}. Studio opens the one you pick.</p>
      <div className="mt-3"><VentureChoices ventures={ventures} rows /></div>
      <Link to="/account/portfolio" className="sm-link mt-2 inline-block">Open Portfolio ›</Link>
    </section>
  );
}

/** The projects read failed (SFD08 C): Unavailable with Try again; no venture's figures are drawn. */
export function VenturesUnreadable({ onRetry = null, dim = '' }) {
  return (
    <section className={`${CARD} ${dim}`} data-testid="studio-ventures-unreadable">
      <p className="sm-err" role="alert">
        <CircleAlert size={14} aria-hidden="true" />
        <span>{VENTURES_UNREADABLE}</span>
        {onRetry && <button type="button" className="sm-btn sm-btn-s sm-btn-sm" onClick={onRetry}><RefreshCw size={12} aria-hidden="true" /> Try again</button>}
      </p>
      <p className="sm-muted mt-2">No venture’s figures are drawn. Eadwyn and your profile still load below, from their own reads.</p>
    </section>
  );
}

/** The phone's Eadwyn row (owner Q3 A): collapsed under the Next card; Open shows the chat below it. */
export function EadwynRow({ open, onToggle, line, controls }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-axal-hairline bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40" data-testid="studio-eadwyn-row">
      <span className="flex min-w-0 items-center gap-2.5">
        <img src="/eadwyn-ai.png" alt="" width="34" height="34" className="block h-[34px] w-[34px] shrink-0 object-contain [image-rendering:pixelated]" />
        <span className="min-w-0">
          <h2 className="text-[15px] font-extrabold leading-tight">Eadwyn AI</h2>
          <span className="block truncate text-[12px] text-axal-muted">{line}</span>
        </span>
      </span>
      <button type="button" className="sm-btn sm-btn-s sm-btn-sm min-h-11" aria-expanded={open ? 'true' : 'false'} aria-controls={controls} onClick={onToggle} data-testid="button-studio-eadwyn-toggle">
        {open ? 'Close' : 'Open'}
      </button>
    </div>
  );
}
