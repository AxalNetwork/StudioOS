/**
 * D648 (#1448) — the Promo codes console. D1275 (#3301): HQ › Platform › Promo
 * codes complete, from the owner's canvas (PRM1, PRM1m, PRM2–PRM6, PRM9–PRM12).
 *
 *   PRM1   the four tiles, the state chips with their counts, search, Applies
 *          to and Sort, all in the address (`promoModel.viewOf`), and the
 *          paged list (`GET /api/admin/promos`, D1272);
 *   PRM1m  each row's menu by its state: an ended code offers only Open and
 *          Copy as a new code;
 *   PRM2   the drawer at `/:id` (`../promos/PromoParts.jsx`);
 *   PRM3–6 New code, Copy as a new code, Replace, Edit, Pause, Resume and End,
 *          each a dialog in the page (`../promos/PromoDialogs.jsx`);
 *   PRM9–12 nothing yet, nothing matching, reading, and a failed read, each
 *          said as itself. A missing figure is never 0.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { adminPromosApi } from '../../../lib/api/adminPromos.js';
import { promoUsageApi } from '../../../lib/api/promoUsage.js';
import { reportError } from '../../../lib/log';
import { actionGhost, actionPrimary } from '../../../ui';
import {
  ACTION_WORD, APPLIES_WORD, BASE, SORTS, STATE_WORD, appliesWord, codeHref, codesHref, dayWord, discountWord,
  durationWord, endsWord, last30, listQuery, narrowed, redeemedWord, rowActions, tiles, viewOf,
} from '../promos/promoModel';
import { catalogueChoices, catalogueNames } from '../promos/promoWizard';
import { PromoDrawer, ReadFailed, StatePill } from '../promos/PromoParts';
import { CodeWizard, EditDialog, EndDialog, PauseDialog, ResumeDialog } from '../promos/PromoDialogs';

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-axal-muted dark:text-gray-400';
const FIELD = 'rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const STATES = Object.keys(STATE_WORD);

function Tile({ t, reading }) {
  return (
    <div className={`${CARD} flex flex-col gap-1 p-3`} data-testid={`promo-tile-${t.key}`}>
      <span className={EYE}>{t.label}</span>
      {reading ? <span className={`text-[13px] ${MUTED}`}>Reading…</span>
        : t.value == null ? <span className={`text-[13px] font-semibold ${MUTED}`} data-testid={`promo-tile-${t.key}-unrecorded`}>Not recorded</span>
          : <span className="font-mono text-[20px] font-bold tabular-nums" data-testid={`promo-tile-${t.key}-value`}>{t.value}</span>}
      {!reading && t.sub && <span className={`text-[12px] ${MUTED}`}>{t.sub}</span>}
    </div>
  );
}

function RowMenu({ p, onAction }) {
  const [open, setOpen] = useState(false);
  const acts = rowActions(p.state);
  return (
    <div className="relative inline-block">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${p.code}`} onClick={() => setOpen((v) => !v)}
        className="rounded-md px-2 py-1 text-[15px] leading-none hover:bg-gray-100 dark:hover:bg-gray-800" data-testid={`promo-row-menu-${p.id}`}>⋯</button>
      {open && (
        <div role="menu" className={`${CARD} absolute right-0 z-20 mt-1 flex min-w-[220px] flex-col py-1 shadow-lg`} data-testid={`promo-row-menu-list-${p.id}`}>
          {acts.map((a) => (
            <button key={a} type="button" role="menuitem" className="px-3 py-1.5 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={() => { setOpen(false); onAction(a, p); }} data-testid={`promo-row-${a}-${p.id}`}>{ACTION_WORD[a]}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The page under the header. `view` is `promoModel.viewOf` of the address;
 * without one (the D648 console mount), the list with no filter.
 */
export function PromoCodesPanel({ view: viewProp, now: nowProp }) {
  const navigate = useNavigate();
  const view = viewProp || viewOf(BASE, '');
  const f = view.filters;
  const now = nowProp ?? Date.now();
  const [list, setList] = useState({ kind: 'loading', data: null });
  const [usage, setUsage] = useState({ kind: 'loading', data: null });
  const [cat, setCat] = useState({ kind: 'loading', data: null });
  const [dialog, setDialog] = useState(null);
  const [said, setSaid] = useState('');
  const [version, setVersion] = useState(0);
  const [typed, setTyped] = useState(f.q || '');
  const q = useMemo(() => listQuery(f), [f.state, f.applies, f.q, f.sort, f.page]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadList = useCallback(async () => {
    setList((s) => ({ kind: s.data ? 'ok' : 'loading', data: s.data }));
    try { setList({ kind: 'ok', data: await adminPromosApi.list(q) }); } catch (e) {
      reportError('PromoCodes:list', e);
      setList({ kind: 'failed', data: null });
    }
  }, [q]);
  const loadUsage = useCallback(async () => {
    try { setUsage({ kind: 'ok', data: await promoUsageApi.usage(last30(now)) }); } catch (e) {
      reportError('PromoCodes:usage', e);
      setUsage({ kind: 'failed', data: null });
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadCat = useCallback(async () => {
    try { setCat({ kind: 'ok', data: await api.adminCatalogList() }); } catch (e) {
      reportError('PromoCodes:catalogue', e);
      setCat({ kind: 'failed', data: null });
    }
  }, []);
  useEffect(() => { loadList(); }, [loadList, version]);
  useEffect(() => { loadUsage(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadCat(); }, [loadCat]);

  // Search goes into the address after a pause in typing.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const t = setTimeout(() => navigate(codesHref({ ...f, q: typed.trim() || null, page: 1 }), { replace: true }), 300);
    return () => clearTimeout(t);
  }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (patch) => navigate(view.id ? codeHref(view.id, { ...f, ...patch }) : codesHref({ ...f, ...patch }));
  const names = useMemo(() => (cat.kind === 'ok' ? catalogueNames(cat.data?.products) : {}), [cat]);
  const choices = useMemo(() => (cat.kind === 'ok' ? catalogueChoices(cat.data?.products) : null), [cat]);
  const d = list.data;
  const rows = d?.promos || [];
  const counts = d?.counts || null;
  const all = counts && STATES.every((k) => Number.isSafeInteger(counts[k])) ? STATES.reduce((n, k) => n + counts[k], 0) : null;
  const t = tiles({ counts: list.kind === 'ok' ? counts : null, usage: usage.kind === 'ok' ? usage.data : null, scoped: narrowed(f) });
  const anyFilter = Boolean(f.state || f.applies || (f.q && f.q.length >= 2));

  const copy = async (p) => {
    try { await navigator.clipboard.writeText(p.code); setSaid(`Copied ${p.code}.`); } catch {
      setSaid(`Copy is not available in this browser. The code is ${p.code}.`);
    }
  };
  const onAction = (a, p) => {
    setSaid('');
    if (a === 'open') navigate(codeHref(p.id, f));
    else if (a === 'copy_code') copy(p);
    else setDialog({ kind: a, promo: p });
  };
  const after = (what) => { setDialog(null); setSaid(what); setVersion((v) => v + 1); };
  const lastPage = d ? Math.max(1, Math.ceil(d.total / d.page_size)) : 1;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="promo-codes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`m-0 text-[12.5px] ${MUTED}`}>Discounts members enter at checkout. Each code is a Stripe coupon that HQ creates here and Stripe enforces.</p>
        <button type="button" className={actionPrimary} onClick={() => setDialog({ kind: 'new', promo: null })} data-testid="promo-new">New code</button>
      </div>
      {said && <p className="m-0 text-[12.5px] font-semibold" role="status" data-testid="promo-said">{said}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="promo-tiles">
        {t.map((x) => <Tile key={x.key} t={x} reading={x.key === 'active' ? list.kind === 'loading' : usage.kind === 'loading'} />)}
      </div>

      <section className={`${CARD} flex min-w-0 flex-col gap-3 p-4`} data-testid="promo-list">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="State">
          {[null, ...STATES].map((s) => {
            const n = s ? counts?.[s] : all;
            const on = (f.state || null) === s;
            return (
              <button key={s || 'all'} type="button" role="tab" aria-selected={on} onClick={() => go({ state: s, page: 1 })} data-testid={`promo-chip-${s || 'all'}`}
                className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold ${on
                  ? 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950 dark:text-violet-200'
                  : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>
                {s ? STATE_WORD[s] : 'All'}{Number.isSafeInteger(n) && <span className="font-mono">{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" className={`${FIELD} min-w-[200px] flex-1`} placeholder="Search code or name" aria-label="Search code or name"
            value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="promo-search" />
          <select className={FIELD} aria-label="Applies to" value={f.applies || ''} onChange={(e) => go({ applies: e.target.value || null, page: 1 })} data-testid="promo-applies">
            <option value="">Applies to: any</option>
            {Object.entries(APPLIES_WORD).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
          </select>
          <select className={FIELD} aria-label="Sort" value={f.sort || 'newest'} onChange={(e) => go({ sort: e.target.value, page: 1 })} data-testid="promo-sort">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span className={`text-[12.5px] ${MUTED}`} data-testid="promo-range">
            {d ? (d.total === 0 ? '0 of 0' : `${(d.page - 1) * d.page_size + 1}–${Math.min(d.total, d.page * d.page_size)} of ${d.total}`) : ''}
          </span>
        </div>
        {typed.trim().length === 1 && <p className={`m-0 text-[12px] ${MUTED}`}>Search starts at two characters.</p>}

        {list.kind === 'loading' && <p className={`m-0 text-[13px] ${MUTED}`} data-testid="promo-list-reading">Reading…</p>}
        {list.kind === 'failed' && (
          <div className="flex flex-col gap-1">
            <ReadFailed what="The promo codes" onRetry={loadList} testId="promo-list-failed" />
            <p className={`m-0 text-[12.5px] ${MUTED}`}>The rest of Platform still works.</p>
          </div>
        )}
        {list.kind === 'ok' && rows.length === 0 && (anyFilter ? (
          <div className="flex flex-col items-start gap-2" data-testid="promo-none-match">
            <p className="m-0 font-semibold">No codes match these filters.</p>
            <Link to={BASE} className="text-[13px] font-semibold underline" onClick={() => setTyped('')} data-testid="promo-clear">Clear filters</Link>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2" data-testid="promo-none">
            <p className="m-0 font-semibold">No promo codes yet.</p>
            <p className={`m-0 text-[13px] ${MUTED}`}>Create a code to give members a discount at checkout.</p>
          </div>
        ))}
        {list.kind === 'ok' && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className={`border-b border-gray-200 text-left dark:border-gray-800 ${EYE}`}>
                  <th className="py-2 pr-3">Code</th><th className="py-2 pr-3">Discount</th><th className="py-2 pr-3">Applies to</th><th className="py-2 pr-3">Duration</th>
                  <th className="py-2 pr-3" title="Recorded by StudioOS; Stripe’s own count is in each code’s drawer">Redeemed</th>
                  <th className="py-2 pr-3">Ends</th><th className="py-2 pr-3">State</th><th className="py-2 pr-3">Created</th><th className="py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const applies = appliesWord(p, names);
                  const ends = endsWord(p, now);
                  return (
                    <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800" data-testid="promo-row">
                      {/* D1270 (#2381): a code opens its drawer at its own address (PRM2). */}
                      <td className="py-2 pr-3">
                        <Link to={codeHref(p.id, f)} className="font-mono font-semibold text-axal-ink underline-offset-2 hover:underline dark:text-gray-100" data-testid={`promo-open-${p.id}`}>{p.code}</Link>
                        {p.name && <div className={`text-[12px] ${MUTED}`}>{p.name}</div>}
                      </td>
                      <td className="py-2 pr-3 font-semibold">{discountWord(p)}</td>
                      <td className={`max-w-[16rem] py-2 pr-3 ${applies.unreadable ? 'text-red-700 dark:text-red-300' : ''}`} data-testid={`promo-applies-${p.id}`}>{applies.text}</td>
                      <td className="py-2 pr-3">{durationWord(p)}</td>
                      <td className="py-2 pr-3 font-mono" data-testid={`promo-redeemed-${p.id}`}>{redeemedWord(p)}</td>
                      <td className="py-2 pr-3"><div>{ends.day}</div>{ends.soon && <div className={`text-[11.5px] ${MUTED}`}>{ends.soon}</div>}</td>
                      <td className="py-2 pr-3"><StatePill state={p.state} testId={`promo-state-${p.id}`} /></td>
                      <td className={`py-2 pr-3 text-[12.5px] ${MUTED}`}>{dayWord(p.created_at) ?? 'Not recorded'}</td>
                      <td className="py-2 text-right"><RowMenu p={p} onAction={onAction} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {d && lastPage > 1 && (
          <div className="flex items-center justify-end gap-2" data-testid="promo-pager">
            <button type="button" className={actionGhost} disabled={d.page <= 1} onClick={() => go({ page: d.page - 1 })} data-testid="promo-pager-prev">Previous</button>
            <span className={`text-[12.5px] ${MUTED}`}>Page {d.page} of {lastPage}</span>
            <button type="button" className={actionGhost} disabled={d.page >= lastPage} onClick={() => go({ page: d.page + 1 })} data-testid="promo-pager-next">Next</button>
          </div>
        )}
        <p className={`m-0 text-[11.5px] ${MUTED}`}>Redeemed is what StudioOS recorded at checkout. Stripe also counts subscription redemptions; each code’s drawer gives its count.</p>
      </section>

      {view.id && (
        <PromoDrawer id={view.id} row={rows.find((p) => p.id === view.id) || null} names={names} choices={choices} version={version}
          onClose={() => navigate(codesHref(f))} onAction={onAction} />
      )}
      {(dialog?.kind === 'new' || dialog?.kind === 'copy_new') && (
        <CodeWizard mode={dialog.kind === 'new' ? 'new' : 'copy'} promo={dialog.promo} choices={choices} choicesFailed={cat.kind === 'failed'} now={now}
          onClose={() => setDialog(null)} onDone={(r) => after(`Created ${r?.code || 'the code'}.`)} />
      )}
      {dialog?.kind === 'replace' && (
        <CodeWizard mode="replace" promo={dialog.promo} choices={choices} choicesFailed={cat.kind === 'failed'} now={now} onClose={() => setDialog(null)}
          onDone={(r) => after(r?.old_ended === false ? `${r.code} was created; ${dialog.promo.code} is still live.` : `Created ${r?.code || 'the new code'} and ended ${dialog.promo.code}.`)} />
      )}
      {dialog?.kind === 'pause' && <PauseDialog promo={dialog.promo} onClose={() => setDialog(null)} onDone={() => after(`Paused ${dialog.promo.code}.`)} />}
      {dialog?.kind === 'resume' && <ResumeDialog promo={dialog.promo} onClose={() => setDialog(null)} onDone={() => after(`Resumed ${dialog.promo.code}.`)} />}
      {dialog?.kind === 'end' && <EndDialog promo={dialog.promo} onClose={() => setDialog(null)} onDone={() => after(`Ended ${dialog.promo.code}.`)} />}
      {dialog?.kind === 'edit' && <EditDialog promo={dialog.promo} onClose={() => setDialog(null)} onDone={() => after(`Saved ${dialog.promo.code}’s name and note.`)} />}
    </div>
  );
}

export default PromoCodesPanel;
