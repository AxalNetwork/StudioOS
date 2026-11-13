/**
 * D702 (#1664) — the frame the four profile pages share (`Studio Mobile
 * Page.dc.html`, SMP:21-22).
 *
 *   · Below 1024px: D699's `PhoneBar` ("‹ Studio", the title, the sub) with
 *     the 40px "Open the Eadwyn menu" button as its `action`, which opens
 *     #1663's `EadwynMenu` with this page's route as `active`. The drawer reads
 *     the page's `project_id` from the location itself. The shell pads
 *     `/profile/*` (`p-4 md:p-6`), so the frame takes that back, as `/more`
 *     and Studio's phone page do, and the bar spans the width.
 *   · At 1024px and up: one column in the founder shell, "‹ Studio", the
 *     title, the sub, and the drawer's five "Your profile" links, the venture
 *     ones keeping the page's `project_id`.
 *
 * `bare` (the venture form as a page, below 1024px) draws only `children`,
 * so the form's own back bar is the only bar.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { PhoneBar, usePhoneWidth } from '../../ui';
import { EadwynMenu } from '../founder/EadwynMenu';
import { profileLinks } from './profileModel';

/** One read, kept apart as loading, ready and unreadable; `reload` reads again. */
export function useProfileRead(reader, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null, error: null });
  const [n, setN] = useState(0);
  const readerRef = useRef(reader);
  readerRef.current = reader;
  useEffect(() => {
    if (!enabled) { setState({ status: 'idle', data: null, error: null }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    Promise.resolve().then(() => readerRef.current()).then(
      (data) => { if (live) setState({ status: 'ready', data, error: null }); },
      (error) => { if (live) setState({ status: 'unreadable', data: null, error }); },
    );
    return () => { live = false; };
  }, [enabled, n, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { ...state, reload, set: (data) => setState({ status: 'ready', data, error: null }) };
}

/** The bar's button, SMP:21, and the drawer it opens. */
export function EadwynMenuButton({ active }) {
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={opener}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the Eadwyn menu"
        aria-haspopup="dialog"
        aria-expanded={open ? 'true' : 'false'}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#ececf1] text-[#4a4553] dark:border-gray-700 dark:text-gray-300"
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <EadwynMenu open={open} onClose={close} active={active} opener={opener} />
    </>
  );
}

const SECTION_TITLE = 'text-[10px] font-extrabold uppercase tracking-wide text-gray-700 dark:text-gray-300';
const ACTION = 'text-[13px] font-bold text-violet-700 dark:text-violet-300';

/** A section's "Edit": a link to the editor that owns the data, or a button. */
export function EditAction({ to, onClick, label = 'Edit', testid }) {
  if (to) return <Link to={to} className={ACTION} data-testid={testid}>{label}</Link>;
  return <button type="button" onClick={onClick} className={ACTION} data-testid={testid}>{label}</button>;
}

/**
 * A section that is not rows (text, a card, chips), in `PhoneRows`' section
 * metrics: the 10px title, the action at its right, the 22px gutter.
 */
export function ProfileSection({ title, action = null, testid, children }) {
  return (
    <section className="px-[22px] pb-[18px]" data-testid={testid}>
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-2.5">
          {title && <h2 className={SECTION_TITLE}>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** The canvas's card (SMP:31): a heading, a line and violet chips. */
export function ProfileCard({ heading, line, chips = [], testid }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-[#ececf1] p-3.5 dark:border-gray-800" data-testid={testid}>
      <span className="text-[16px] font-extrabold tracking-[-.015em] text-gray-900 dark:text-gray-100">{heading}</span>
      {line && <span className="text-[13px] leading-normal text-[#4a4553] dark:text-gray-300">{line}</span>}
      {chips.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full border border-[#e6dcff] bg-[#f6f2ff] px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">{c}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A section's text body (SMP:30), or Not recorded with its reason. */
export function ProfileText({ text, empty }) {
  if (text) return <p className="whitespace-pre-line text-[14.5px] leading-relaxed text-[#2b2735] dark:text-gray-200">{text}</p>;
  return (
    <p className="text-[13px] text-gray-600 dark:text-gray-400">
      <span className="mr-2 rounded border border-gray-300 px-1.5 text-[9.5px] font-bold text-gray-700 dark:border-gray-700 dark:text-gray-300">Not recorded</span>
      {empty}
    </p>
  );
}

export default function ProfileFrame({ page, bare = false, children }) {
  const phone = usePhoneWidth();
  const { search, pathname } = useLocation();
  if (phone) {
    return (
      <div className="-m-4 min-h-full bg-white text-gray-900 md:-m-6 lg:m-0 dark:bg-gray-950 dark:text-gray-100" data-testid="profile-phone">
        {!bare && (
          <PhoneBar
            back={{ label: 'Studio', to: '/studio' }}
            title={page.title}
            sub={page.sub}
            action={<EadwynMenuButton active={page.route} />}
          />
        )}
        <div className={bare ? '' : 'pb-4 pt-[18px]'}>{children}</div>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-3xl" data-testid="profile-desktop">
      <Link to="/studio" className="text-[12px] font-semibold text-violet-700 hover:underline dark:text-violet-300">‹ Studio</Link>
      <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{page.title}</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{page.sub}</p>
      <nav aria-label="Your profile" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]" data-testid="profile-links">
        {profileLinks(search).map((l) => (
          <Link
            key={l.route}
            to={l.href}
            aria-current={l.route === pathname ? 'page' : undefined}
            className={l.route === pathname
              ? 'font-bold text-violet-700 dark:text-violet-300'
              : 'font-semibold text-gray-700 hover:text-violet-700 dark:text-gray-300 dark:hover:text-violet-300'}
          >
            {l.title}
          </Link>
        ))}
      </nav>
      <div className="mt-5 rounded-2xl border border-gray-200 bg-white pb-1 pt-[18px] dark:border-gray-800 dark:bg-gray-950">{children}</div>
    </div>
  );
}
