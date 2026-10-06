import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, SectionLabel, Skeleton } from '../../ui';
import { accentChipClass } from '../../workspaces/shellConfig';

/**
 * D568 — the Account center's frame and the kit its sections share.
 *
 * `/account` is still `SettingsPage.jsx`; this file is what the canvas
 * (`ac-*` in `Ops Page.dc.html`) adds to it: the section list on the left of
 * the content, and the card, row, switch and chip every section draws with.
 * They are built on the `ui/` primitives and the axal tokens, the same layer
 * the sidebar pages use, rather than on the page's older local `Card`.
 *
 * NOTHING HERE FETCHES except `useAccountRead`, and that only runs the reader
 * it is handed. A section owns its own reads, so one failed store costs that
 * section's card and never the page.
 */

export const BTN = {
  primary: 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50',
  ghost: 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink transition-colors hover:border-axal-violet/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
  danger: 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-axal-sm border border-red-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/40',
  dangerSolid: 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-axal-sm bg-red-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50',
  link: 'text-[12.5px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-300',
};

export const INPUT = 'w-full rounded-axal-sm border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink placeholder:text-axal-faint focus:outline-none focus:ring-2 focus:ring-axal-violet/40 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/**
 * One read, in the three states a reader must be able to tell apart: still
 * loading, read (whatever it holds), and unreadable. A failed read keeps
 * `data` at null and says so; it is never handed on as an empty result.
 *
 * A re-read keeps the last good data on screen until the answer lands, so a
 * save followed by a refresh does not flash the card back to a skeleton.
 */
export function useAccountRead(reader, { enabled = true } = {}) {
  const [state, setState] = useState({ status: 'loading', data: null, message: '', code: null, httpStatus: null });
  const [attempt, setAttempt] = useState(0);
  const readerRef = useRef(reader);
  readerRef.current = reader;
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setState((s) => (s.status === 'ready' ? s : { ...s, status: 'loading' }));
    Promise.resolve()
      .then(() => readerRef.current())
      .then(
        (data) => { if (live) setState({ status: 'ready', data, message: '', code: null, httpStatus: null }); },
        (e) => { if (live) setState({ status: 'unreadable', data: null, message: e?.message || '', code: e?.code || null, httpStatus: e?.status ?? null }); },
      );
    return () => { live = false; };
  }, [attempt, enabled]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const set = useCallback((data) => setState({ status: 'ready', data, message: '', code: null, httpStatus: null }), []);
  return { ...state, reload, set };
}

/** The canvas's panel: a hairline card with a header row, a body and an optional footer. */
export function PanelCard({ title, aside, action, children, footer, accent = false, className = '', 'data-testid': testId }) {
  return (
    <Card padding="none" variant={accent ? 'accent' : 'plain'} className={`overflow-hidden ${className}`} data-testid={testId}>
      {(title || aside || action) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
          <h2 className="text-sm font-bold text-axal-ink dark:text-gray-100">{title}</h2>
          {(aside || action) && (
            <div className="flex items-center gap-2">
              {aside && <span className="text-xs text-axal-muted dark:text-gray-400">{aside}</span>}
              {action}
            </div>
          )}
        </div>
      )}
      <div className="px-4 py-3">{children}</div>
      {footer && <div className="border-t border-axal-hairline px-4 py-2.5 text-xs text-axal-muted dark:border-gray-800 dark:text-gray-400">{footer}</div>}
    </Card>
  );
}

/**
 * A label beside its value, as the canvas lays every profile field out.
 * `control` is set when the value is an input, which sits flush with the label.
 */
export function FieldRow({ label, htmlFor, children, hint, error, control = false, 'data-testid': testId }) {
  return (
    <div data-testid={testId} className="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 py-1 text-[13px]">
      {htmlFor
        ? <label htmlFor={htmlFor} className="pt-1.5 text-axal-muted dark:text-gray-400">{label}</label>
        : <span className="pt-1.5 text-axal-muted dark:text-gray-400">{label}</span>}
      <div className="min-w-0">
        <div className={`min-h-[30px] break-words text-axal-ink dark:text-gray-100 ${control ? '' : 'pt-1.5'}`}>{children}</div>
        {hint && <div className="mt-0.5 text-[11.5px] leading-snug text-axal-muted dark:text-gray-400">{hint}</div>}
        {error && <div role="alert" className="mt-0.5 text-[11.5px] text-red-700 dark:text-red-300">{error}</div>}
      </div>
    </div>
  );
}

/** The canvas's toggle: a real switch, announced as one, with its state in words for a screen reader. */
export function Switch({ checked, onChange, disabled = false, label, title, 'data-testid': testId }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      data-testid={testId}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-axal-violet/50 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-axal-violet' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform dark:bg-gray-100 ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

/** The skeleton a card draws while its read is out. */
export function LoadingRows({ lines = 3 }) {
  return <div data-testid="account-loading" className="py-1"><Skeleton.Text lines={lines} /></div>;
}

/** A write's outcome, on the card that made it: the route's own words, success or refusal. */
export function Outcome({ outcome }) {
  if (!outcome?.text) return null;
  const bad = outcome.tone === 'error';
  return (
    <p
      role={bad ? 'alert' : 'status'}
      data-testid={bad ? 'account-outcome-error' : 'account-outcome-ok'}
      className={`text-[12px] ${bad ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}
    >
      {outcome.text}
    </p>
  );
}

/**
 * A row of filter chips with the zone toolbar's own treatment (the canvas's
 * `.fil` / `.fil.on`, `ZoneToolbar.jsx`), so a list on this page filters the
 * way every sidebar page does. Violet is the canvas's colour for this page on
 * every role, which is the founder accent.
 */
export function Chips({ items, label }) {
  const on = accentChipClass('founder');
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={item.active ? 'true' : 'false'}
          onClick={item.onSelect}
          data-testid={item.testid}
          className={`inline-flex items-center whitespace-nowrap rounded-[7px] border px-2.5 py-[5px] text-[11px] font-semibold transition-colors ${
            item.active
              ? `${on} font-bold`
              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The section list on the left of the content — the canvas's `acNav`.
 *
 * TWO SHAPES, which is the canvas's own phone rule (D607, the 2026-10-06
 * export: `.op-secnav{display:none}.op-secdrop{display:flex}`). From `lg` it
 * is a column beside the content. Below `lg` it is one row, "Section", the
 * open section's name and ▾, and the list opens from it. The six canvas
 * sections come first in the canvas's order; the four the old page had and
 * the canvas does not draw follow under "More", kept rather than dropped.
 *
 * The phone row is a native select under the canvas's drawing, so the phone
 * opens its own picker, and the keyboard and a screen reader get a real
 * control. D568 drew a row of chips that scrolled sideways here, after the
 * export it was built from; the newer export replaced that row.
 */
export function AccountSectionNav({ sections, active, onSelect }) {
  const main = sections.filter((s) => s.group !== 'more');
  const more = sections.filter((s) => s.group === 'more');
  const current = sections.find((s) => s.id === active) || main[0] || sections[0];

  const item = (s) => {
    const on = s.id === active;
    return (
      <button
        key={s.id}
        type="button"
        onClick={() => onSelect(s.id)}
        aria-current={on ? 'page' : undefined}
        data-testid={`account-nav-${s.id}`}
        className={`rounded-axal-sm px-3 py-2 text-left text-[13px] transition-colors ${
          on
            ? 'bg-axal-lavender font-semibold text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300'
            : 'font-medium text-axal-muted hover:bg-axal-ground hover:text-axal-ink dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
        }`}
      >
        {s.label}
      </button>
    );
  };

  const option = (s) => <option key={s.id} value={s.id}>{s.label}</option>;

  return (
    <nav aria-label="Account sections" data-testid="account-section-nav" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
      <Card padding="none" className="hidden p-1.5 lg:block">
        <div className="flex flex-col gap-0.5">
          {main.map(item)}
          {more.length > 0 && (
            <>
              <SectionLabel className="px-3 pb-1 pt-3">More</SectionLabel>
              {more.map(item)}
            </>
          )}
        </div>
      </Card>
      <div
        data-testid="account-section-menu"
        className="relative flex min-h-[44px] items-center justify-between gap-2.5 rounded-axal-lg border border-axal-hairline bg-white px-3.5 focus-within:ring-2 focus-within:ring-axal-violet/40 dark:border-gray-800 dark:bg-gray-900 lg:hidden"
      >
        <span aria-hidden="true" className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-axal-muted dark:text-gray-400">Section</span>
          <span className="truncate text-sm font-semibold text-axal-ink dark:text-gray-100">{current?.label}</span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-axal-muted dark:text-gray-400">▾</span>
        <select
          aria-label="Account section"
          value={current?.id ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          data-testid="account-section-select"
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        >
          {main.map(option)}
          {more.length > 0 && <optgroup label="More">{more.map(option)}</optgroup>}
        </select>
      </div>
    </nav>
  );
}

/**
 * The rail's Coverage lines for this page. Counts and states the root
 * settings payload already carries — never the email address or a name, since
 * these lines are what Eadwyn is given to read.
 */
export function accountRailCoverage(data, sectionLabel) {
  if (!data) return [];
  const remaining = Number(data.totp_recovery_codes_remaining);
  return [
    sectionLabel ? `Open section: ${sectionLabel}` : null,
    `Email ${data.email_verified ? 'verified' : 'not verified'}`,
    `Authenticator ${data.totp_configured ? 'paired' : 'not set up'}`,
    Number.isFinite(remaining) ? `${remaining} recovery code${remaining === 1 ? '' : 's'} left` : null,
    data.deletion_requested_at ? 'Account deletion requested' : null,
  ].filter(Boolean);
}
