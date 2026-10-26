import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { adminTestingApi, productTestingApi } from '../../../lib/api/productTesting';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { Lightbox, Pill } from '../../../ui';
import { ConsoleUnreadable, CONSOLE_LOADING } from './shared';
import ProgrammeForm from '../../testing/ProgrammeForm';
import { ROLE_OPTIONS, refusalText, statusLabel, statusTone } from '../../testing/programmeModel';
import TestingDialog from '../productTesting/TestingDialog';
import {
  CLOSES_FILTERS, OWNER_FILTERS, PLACES_FILTERS, SORTS, dayWord, dialogFor, earlierLine, firmsOf, logoInitial, menuFor,
  ownerName, programHref, programsView, rowFigures, sentBackLine, spanWords, statusChips, whoWords,
} from '../productTesting/reviewModel';

/**
 * HQ › Product testing — Review (TST2) and Programs (TST4), D815 board D5
 * (#2261) as D1202 (#3152, part 7 of #2382) redraws them. Super Admin only, as
 * D812's `/api/admin/testing` routes are.
 *
 *   Review    the partner programmes waiting for HQ as full cards, with the
 *             firm's earlier programmes and when it was last sent back; the
 *             approved ones not yet open; and the ones sent back, with HQ's note.
 *   Programs  every programme as a table: status chips, search, filters, sort,
 *             a pager, and one ⋯ menu per row with only the steps that apply
 *             (`reviewModel.js` `menuFor`).
 *
 * Every step opens a dialog that says what it changes, who is told and what is
 * recorded (`TestingDialog`, A–H); a refusal is drawn inside it in the
 * Worker's words (I). New program is the page header's, a lightbox over
 * Programs (`?new=1`), with the logo (D1199). Never a browser pop-up.
 */
const BTN = 'inline-flex min-h-[32px] items-center justify-center gap-1 whitespace-nowrap rounded-[9px] px-3 text-[12.5px] font-bold max-sm:min-h-[44px] disabled:opacity-50';
const btnCls = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const primaryCls = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-500 dark:hover:bg-violet-400`;
const cardCls = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const inputCls = 'mt-1 w-full rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const selectCls = 'min-h-[32px] rounded-[9px] border border-axal-hairline bg-white px-2 text-[12.5px] text-axal-ink max-sm:min-h-[44px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const muted = 'text-axal-muted dark:text-gray-400';
const EYE = 'm-0 font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[16px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100';
const FORM_CLASSES = { input: inputCls, button: primaryCls };

export const PRODUCT_TESTING_HOLDER_ONLY = 'Product testing is reviewed by the Super Admin.';

export function ProductTestingPanel({ api = adminTestingApi, view = 'programs' }) {
  const holder = isSuperAdminUser(useAuth().user);
  if (!holder) {
    return <p className="p-6 text-sm text-gray-700 dark:text-gray-300" data-testid="product-testing-holder-only">{PRODUCT_TESTING_HOLDER_ONLY}</p>;
  }
  return <ProductTestingConsole api={api} view={view} />;
}

/** The programme's square: its logo (D1199), else its letter when there is none or it does not load. */
export function Logo({ p, size = 28 }) {
  const [failed, setFailed] = useState(!p?.logo_key);
  const box = { width: size, height: size };
  if (failed) {
    return (
      <span style={box} aria-hidden="true" className="grid flex-none place-items-center rounded-[7px] border border-violet-200 bg-violet-50 text-[12px] font-extrabold text-axal-violet-deep dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300">
        {logoInitial(p?.product_name)}
      </span>
    );
  }
  return <img src={productTestingApi.logoSrc(p.uid)} alt="" style={box} className="flex-none rounded-[7px] border border-axal-hairline object-contain dark:border-gray-700" onError={() => setFailed(true)} />;
}

export function ProductTestingConsole({ api = adminTestingApi, view = 'programs' }) {
  const [state, setState] = useState({ status: 'loading', items: [] });
  // { kind: 'form', programme } | { kind: <dialog>, programme }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const review = view === 'review';

  const load = useCallback(() => Promise.resolve()
    .then(() => api.programmes())
    .then((r) => setState({ status: 'ready', items: Array.isArray(r?.items) ? r.items : [] }))
    .catch(() => setState({ status: 'unreadable', items: [] })), [api]);
  useEffect(() => { load(); }, [load]);

  // New program is the header's: it opens this lightbox over Programs (`?new=1`).
  const wantsNew = !review && new URLSearchParams(location.search).get('new') === '1';
  useEffect(() => { if (wantsNew) { setNotice(null); setDialog({ kind: 'form', programme: null }); } }, [wantsNew]);
  const close = useCallback(() => {
    setDialog(null);
    if (wantsNew) navigate({ pathname: location.pathname }, { replace: true });
  }, [wantsNew, navigate, location.pathname]);

  const done = useCallback(async (text) => { setNotice({ ok: true, text }); setDialog(null); await load(); }, [load]);
  const ask = useCallback((kind, programme) => { setNotice(null); setDialog({ kind, programme }); }, []);

  async function save(payload, logo) {
    const editing = dialog?.programme;
    const out = editing ? await api.edit(editing.uid, payload) : await api.create(payload);
    const uid = out?.programme?.uid || editing?.uid;
    let logoLine = '';
    if (uid && logo?.file) {
      try { await api.uploadLogo(uid, logo.file); } catch (e) { logoLine = ` The logo was not saved: ${refusalText(e, 'it could not be uploaded. Try again from Edit.')}`; }
    } else if (uid && logo?.remove) {
      try { await api.removeLogo(uid); } catch (e) { logoLine = ` The logo was not removed: ${refusalText(e, 'try again from Edit.')}`; }
    }
    close();
    setNotice({ ok: !logoLine, text: `${payload.product_name} is saved as a draft. Open it when it should take applications.${logoLine}` });
    await load();
  }

  if (state.status === 'loading') return <p className={`p-6 text-sm ${muted}`}>{CONSOLE_LOADING}</p>;
  if (state.status === 'unreadable') return <ConsoleUnreadable what="Testing programmes" onRetry={load} />;

  const spec = dialog && dialog.kind !== 'form' ? dialogFor(dialog.kind, { p: dialog.programme }) : null;

  return (
    <div className="flex flex-col gap-5" data-testid={review ? 'product-testing-review' : 'product-testing-console'}>
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} data-testid="testing-notice"
          className={`m-0 text-[12.5px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
          {notice.text}
        </p>
      )}
      {review ? <Review items={state.items} api={api} ask={ask} /> : <Programs items={state.items} ask={ask} />}

      {dialog?.kind === 'form' && (
        <Lightbox label={dialog.programme ? 'Edit program' : 'New program'} onClose={close} testId="testing-form-dialog" width={640}
          title={dialog.programme ? `Edit ${dialog.programme.product_name}` : 'New program for an Axal VC product'}
          sub="Saved as a draft. Open it when it should take applications.">
          <ProgrammeForm programme={dialog.programme} onSave={save} onCancel={close} classes={FORM_CLASSES} logo />
        </Lightbox>
      )}
      {spec && <TestingDialog spec={spec} api={api} ctx={{ p: dialog.programme }} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The ⋯ menu (TST4m)
// ---------------------------------------------------------------------------

function RowMenu({ p, ask, testId }) {
  const [open, setOpen] = useState(false);
  const items = menuFor(p);
  const ref = useRef(null);
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const away = (e) => { if (ref.current && typeof ref.current.contains === 'function' && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener?.('mousedown', away);
    document.addEventListener?.('keydown', esc);
    return () => { document.removeEventListener?.('mousedown', away); document.removeEventListener?.('keydown', esc); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-block">
      <button type="button" className={`${btnCls} w-8 px-0`} aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${p.product_name}`}
        onClick={() => setOpen((o) => !o)} data-testid={testId}>⋯</button>
      {open ? (
        <span role="menu" className="absolute right-0 z-20 mt-1 flex min-w-[190px] flex-col rounded-xl border border-axal-hairline bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid={`${testId}-items`}>
          {items.map((it) => (it.to
            ? <Link key={it.key} role="menuitem" to={it.to} className="px-3 py-2 text-[13px] font-semibold text-axal-ink no-underline hover:bg-axal-ground max-sm:min-h-[44px] dark:text-gray-100 dark:hover:bg-gray-800" data-testid={`${testId}-${it.key}`}>{it.label}</Link>
            : <button key={it.key} type="button" role="menuitem" className="px-3 py-2 text-left text-[13px] font-semibold text-axal-ink hover:bg-axal-ground max-sm:min-h-[44px] dark:text-gray-100 dark:hover:bg-gray-800"
              onClick={() => { setOpen(false); ask(it.dialog === 'edit' ? 'form' : it.dialog, p); }} data-testid={`${testId}-${it.key}`}>{it.label}</button>))}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Review (TST2)
// ---------------------------------------------------------------------------

function Review({ items, api, ask }) {
  const waiting = items.filter((p) => p.status === 'submitted' && p.owner_kind === 'partner');
  const approved = items.filter((p) => p.status === 'approved');
  const sentBack = items.filter((p) => p.status === 'rejected');
  return (
    <>
      <section className="flex flex-col gap-3" data-testid="testing-waiting">
        <h2 className={H2}>Waiting for HQ · {waiting.length}</h2>
        {waiting.length === 0
          ? <p className={`m-0 text-[12.5px] ${muted}`} data-testid="testing-waiting-empty">No programme is waiting for HQ.</p>
          : <div className="grid gap-3 lg:grid-cols-2">{waiting.map((p) => <ReviewCard key={p.uid} p={p} items={items} api={api} ask={ask} />)}</div>}
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="flex flex-col gap-3" data-testid="testing-approved">
          <h2 className={H2}>Approved, not yet open · {approved.length}</h2>
          {approved.length === 0 ? <p className={`m-0 text-[12.5px] ${muted}`} data-testid="testing-approved-empty">No approved programme is waiting to open.</p> : approved.map((p) => (
            <article key={p.uid} className={`${cardCls} flex flex-col gap-2`} data-testid={`testing-programme-${p.uid}`}>
              <p className={EYE}>Approved{dayWord(p.updated_at) ? ` · ${dayWord(p.updated_at)}` : ''}</p>
              <h3 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{p.product_name} <span className={`text-[12px] font-semibold ${muted}`}>{ownerName(p)}</span></h3>
              <p className={`m-0 text-[12.5px] ${muted}`}>Applications {spanWords(p.opens_at, p.closes_at)} · {rowFigures(p).places}. It takes no applications until you open it.</p>
              <div><button type="button" className={btnCls} onClick={() => ask('open', p)} data-testid={`testing-open-${p.uid}`}>Open…</button></div>
            </article>
          ))}
        </section>
        <section className="flex flex-col gap-3" data-testid="testing-sent-back">
          <h2 className={H2}>Sent back · {sentBack.length}</h2>
          {sentBack.length === 0 ? <p className={`m-0 text-[12.5px] ${muted}`} data-testid="testing-sent-back-empty">No programme is sent back.</p> : sentBack.map((p) => (
            <article key={p.uid} className={`${cardCls} flex flex-col gap-2`} data-testid={`testing-programme-${p.uid}`}>
              <p className={EYE}>Sent back{dayWord(p.updated_at) ? ` · ${dayWord(p.updated_at)}` : ''}</p>
              <h3 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{p.product_name} <span className={`text-[12px] font-semibold ${muted}`}>{ownerName(p)}</span></h3>
              {p.review_note
                ? <blockquote className="m-0 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[13px] font-semibold italic text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" data-testid={`testing-note-${p.uid}`}>“{p.review_note}”</blockquote>
                : <p className={`m-0 text-[12.5px] ${muted}`}>HQ’s note is not recorded.</p>}
              <p className={`m-0 text-[12px] ${muted}`}>HQ’s note. Waiting for {ownerName(p)} to edit and send it again.</p>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}

function ReviewCard({ p, items, api, ask }) {
  const [events, setEvents] = useState(undefined);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => api.events(p.uid, { pageSize: 100 }))
      .then((r) => { if (live) setEvents(r?.events?.available === false ? false : r?.events?.items || []); })
      .catch(() => { if (live) setEvents(false); });
    return () => { live = false; };
  }, [api, p.uid]);
  const f = rowFigures(p);
  const facts = [
    ['Summary', p.summary], ['What testers do', p.tester_tasks], ['Time needed', p.time_needed],
    ['Screening questions', (p.questions || []).length ? p.questions.map((q, i) => `${i + 1}. ${q}`).join(' ') : null],
    ['Places', Number(p.places) > 0 ? String(p.places) : null], ['Applications', f.applications], ['Testing', f.testing],
  ];
  const side = [earlierLine(p, items), sentBackLine(events)].filter(Boolean).join(' ');
  return (
    <article className={`${cardCls} flex flex-col gap-3`} data-testid={`testing-programme-${p.uid}`}>
      <p className={EYE}>Waiting for HQ{dayWord(p.updated_at) ? ` · sent ${dayWord(p.updated_at)}` : ''}</p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{p.product_name}</h3>
        <span className={`text-[12px] ${muted}`}>{ownerName(p)}</span>
      </div>
      <div className="flex items-start gap-3">
        <Logo p={p} size={44} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">Sent{dayWord(p.updated_at) ? ` ${dayWord(p.updated_at)}` : ''} by {ownerName(p)}</p>
          <p className={`m-0 text-[12px] ${muted}`} data-testid={`testing-earlier-${p.uid}`}>{side || 'Reading its history…'}</p>
          <div className="flex flex-wrap gap-1">{(p.eligible_roles || []).length
            ? p.eligible_roles.map((r) => <Pill key={r} tone="neutral">{ROLE_OPTIONS.find(([k]) => k === r)?.[1] || r}</Pill>)
            : <span className={`text-[12px] ${muted}`}>No role chosen</span>}</div>
        </div>
      </div>
      <dl className="m-0 grid gap-x-5 gap-y-2 border-t border-axal-hairline pt-3 sm:grid-cols-2 dark:border-gray-800">
        {facts.map(([k, v]) => (
          <div key={k} className={k === 'Screening questions' || k === 'Summary' || k === 'What testers do' ? 'sm:col-span-2' : ''}>
            <dt className={EYE}>{k}</dt>
            <dd className={`m-0 text-[13px] ${v && v !== 'Not set' ? 'text-axal-ink dark:text-gray-100' : muted}`}>{v || 'Not recorded'}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryCls} onClick={() => ask('approve', p)} data-testid={`testing-approve-${p.uid}`}>Approve…</button>
        <button type="button" className={btnCls} onClick={() => ask('reject', p)} data-testid={`testing-reject-${p.uid}`}>Send back…</button>
        <RowMenu p={p} ask={ask} testId={`testing-review-menu-${p.uid}`} />
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Programs (TST4)
// ---------------------------------------------------------------------------

function Programs({ items, ask }) {
  const [f, setF] = useState({ q: '', status: '', owner: '', firm: '', role: '', places: '', closes: '', sort: 'changed_desc', page: 1 });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e, page: 1 }));
  const v = useMemo(() => programsView(items, f), [items, f]);
  const firms = useMemo(() => firmsOf(items), [items]);
  const chips = useMemo(() => statusChips(items), [items]);
  const ownerValue = f.firm ? `firm:${f.firm}` : f.owner;
  const setOwner = (e) => {
    const x = e.target.value;
    setF((s) => ({ ...s, owner: x.startsWith('firm:') ? 'partner' : x, firm: x.startsWith('firm:') ? x.slice(5) : '', page: 1 }));
  };
  return (
    <section className="flex flex-col gap-3" data-testid="testing-all">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Programs by status">
        {chips.map((c) => (
          <button key={c.status || 'all'} type="button" aria-pressed={f.status === c.status} onClick={() => set('status')(c.status)}
            className={`inline-flex min-h-[28px] items-center rounded-full border px-3 text-[12px] max-sm:min-h-[40px] ${f.status === c.status
              ? 'border-violet-200 bg-violet-50 font-bold text-axal-violet-deep dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300'
              : 'border-axal-hairline bg-white font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}
            data-testid={`testing-chip-${c.status || 'all'}`}>{c.label}</button>
        ))}
      </div>
      <div className={`${cardCls} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={f.q} onChange={set('q')} placeholder="Search product or partner firm" aria-label="Search product or partner firm"
            className={`${selectCls} min-w-[220px] flex-1 px-3`} data-testid="testing-search" />
          <select value={ownerValue} onChange={setOwner} className={selectCls} aria-label="Owner" data-testid="testing-filter-owner">
            {OWNER_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            {firms.map((n) => <option key={n} value={`firm:${n}`}>{n}</option>)}
          </select>
          <select value={f.role} onChange={set('role')} className={selectCls} aria-label="Who can apply" data-testid="testing-filter-role">
            <option value="">Anyone can apply</option>
            {ROLE_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select value={f.places} onChange={set('places')} className={selectCls} aria-label="Places" data-testid="testing-filter-places">
            {PLACES_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select value={f.closes} onChange={set('closes')} className={selectCls} aria-label="Applications close" data-testid="testing-filter-closes">
            {CLOSES_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select value={f.sort} onChange={set('sort')} className={selectCls} aria-label="Sort" data-testid="testing-sort">
            {SORTS.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}
          </select>
        </div>
        {items.length === 0 ? (
          <p className={`m-0 text-[12.5px] ${muted}`} data-testid="testing-all-empty">No testing programmes yet. Start one for an Axal VC product with New program.</p>
        ) : v.total === 0 ? (
          <p className={`m-0 text-[12.5px] ${muted}`} data-testid="testing-none-match">No programme matches these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse" data-testid="testing-table">
              <thead>
                <tr className="border-b border-axal-hairline dark:border-gray-800">
                  {['', 'Product', 'Status', 'Places', 'Applicants', 'Applications', 'Testing', 'Who can apply', 'Last change', ''].map((h, i) => (
                    <th key={i} className="px-2 py-2 text-left font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {v.rows.map((p) => {
                  const r = rowFigures(p);
                  return (
                    <tr key={p.uid} className="border-b border-axal-hairline align-middle last:border-0 dark:border-gray-800" data-testid={`testing-programme-${p.uid}`}>
                      <td className="px-2 py-2"><Logo p={p} /></td>
                      <td className="px-2 py-2">
                        <Link to={programHref(p.uid)} className="text-[13px] font-bold text-axal-ink no-underline hover:underline dark:text-gray-100">{p.product_name}</Link>
                        <span className={`block text-[11.5px] ${muted}`}>{ownerName(p)}</span>
                      </td>
                      <td className="px-2 py-2"><Pill tone={statusTone(p.status)}>{statusLabel(p.status)}</Pill></td>
                      <td className="px-2 py-2 font-mono text-[12px] text-axal-ink dark:text-gray-100">
                        <span className={r.opened ? '' : muted}>{r.places}</span>
                        {r.bar != null ? <span className="mt-1 block h-1.5 w-[72px] rounded-full bg-gray-100 dark:bg-gray-800"><span className="block h-1.5 rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${r.bar}%` }} /></span> : null}
                      </td>
                      <td className={`px-2 py-2 font-mono text-[12px] ${r.opened ? 'text-axal-ink dark:text-gray-100' : muted}`}>{r.applicants}</td>
                      <td className={`px-2 py-2 font-mono text-[12px] ${r.applications === 'Not set' ? muted : 'text-axal-ink dark:text-gray-100'}`}>{r.applications}</td>
                      <td className={`px-2 py-2 font-mono text-[12px] ${r.testing === 'Not set' ? muted : 'text-axal-ink dark:text-gray-100'}`}>{r.testing}</td>
                      <td className="px-2 py-2 text-[12px] text-axal-ink dark:text-gray-100">{whoWords(p.eligible_roles)}</td>
                      <td className={`px-2 py-2 font-mono text-[12px] ${muted}`}>{r.changed}</td>
                      <td className="px-2 py-2 text-right"><RowMenu p={p} ask={ask} testId={`testing-menu-${p.uid}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`font-mono text-[12px] ${muted}`} data-testid="testing-count">{v.count}</span>
          {v.pages > 1 ? (
            <span className="flex items-center gap-1.5">
              <button type="button" className={btnCls} disabled={v.page <= 1} onClick={() => setF((x) => ({ ...x, page: v.page - 1 }))} data-testid="testing-page-prev">‹ Previous</button>
              <span className={`font-mono text-[12px] ${muted}`}>Page {v.page} of {v.pages}</span>
              <button type="button" className={btnCls} disabled={v.page >= v.pages} onClick={() => setF((x) => ({ ...x, page: v.page + 1 }))} data-testid="testing-page-next">Next ›</button>
            </span>
          ) : null}
        </div>
        <p className={`m-0 text-[12px] ${muted}`}>A product’s name opens the program. ⋯ holds only the steps that apply to it.</p>
      </div>
    </section>
  );
}
