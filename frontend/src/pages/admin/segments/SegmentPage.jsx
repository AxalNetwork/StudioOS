import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { personaSegmentsApi } from '../../../lib/api/personaSegments';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { AdminPageHeader, HeaderTab, actionGhost } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import MoveDialog from './MoveDialog';
import { ADMIN_RAIL_NOTE, BLOCK_FAILED, PROFILES, RAIL_NOTE, SEG_PATH, SEG_TITLE } from './segModel';
import {
  ACTIVE, ACTIVITY_KINDS, CONF_BANDS, HOW_SET, MEMBER_SORTS, activityRow, answersView, archetypesView, memberRow, membersParams,
  movedLine, needsView, profileTiles, profileTone, profileWord, rangeText, segmentTabOf, statusWord,
} from './segmentPageModel';

/**
 * D1005 (#2820, part 8 of #2378) — one segment's page at
 * /admin/persona-segments/:key, built to SEG2 (Profile), SEG3 (Members) and
 * SEG8 (Activity, this segment's own), under the shared admin page header
 * (D936) in the viewer's shell, with SEG4's Move dialog (`MoveDialog.jsx`).
 *
 * PROFILE shows counts only, never a name: the tiles (D999, D1128), who they
 * are and the typical member (D1000), how they work and what they told us at
 * sign-up (D1001, a count under 5 reads "<5"), and the needs with what
 * answers each. MEMBERS is D1002's list for this segment, a page at a time,
 * with its filters, a checkbox per row, the move bar and each row's ⋯ (Move
 * to another segment…, Open account). ACTIVITY is D1002's activity read
 * filtered to this segment. Every block answers alone: one whose read failed
 * says so with its own Try again, never as zeros.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';
const CONTROL = 'h-9 rounded-[7px] border border-axal-hairline bg-white px-2.5 text-[12.5px] text-axal-ink max-sm:h-11 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const FILL = { violet: 'bg-axal-violet dark:bg-violet-400', sky: 'bg-sky-500', amber: 'bg-amber-500', emerald: 'bg-emerald-500', muted: 'bg-axal-muted' };
const HOLLOW = 'border border-axal-muted bg-white dark:bg-gray-900';

/** One read, alone: `{ status, data }`, read again by `retry`. */
function useRead(load, deps) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading', data: null }));
    Promise.resolve().then(load).then(
      (data) => { if (live) setState({ status: 'ready', data }); },
      (e) => { reportError('persona-segments:segment', e); if (live) setState({ status: 'error', data: null, error: e }); },
    );
    return () => { live = false; };
    // `load` is rebuilt each render; `deps` and `tick` say when to call it.
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, retry: () => setTick((t) => t + 1) };
}

function Failed({ title, onRetry, id }) {
  return (
    <section className={`${CARD} flex flex-col gap-2 p-4`} data-testid={`seg-page-${id}-failed`}>
      {title ? <h2 className={H2}>{title}</h2> : null}
      <p role="alert" className="m-0 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">{BLOCK_FAILED}</p>
      <button type="button" className={`${actionGhost} self-start`} onClick={onRetry}>Try again</button>
    </section>
  );
}

const Loading = ({ id }) => <div className={`${CARD} h-28 animate-pulse`} aria-busy="true" data-testid={`seg-page-${id}-loading`} />;

function Bar({ bar, max, tone }) {
  const width = bar.count === null ? 0 : Math.round((bar.count / max) * 100);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[12.5px]">
      <span className="text-axal-ink dark:text-gray-100">{bar.label}</span>
      <span className={`${MONO} font-semibold text-axal-ink dark:text-gray-100`}>{bar.text}</span>
      <span className="col-span-2 h-2 rounded-full bg-axal-ground dark:bg-gray-800" aria-hidden="true">
        <span className={`block h-2 rounded-full ${bar.hollow ? HOLLOW : FILL[tone] || FILL.violet}`} style={{ width: `${bar.hollow ? Math.max(width, 4) : width}%` }} />
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Profile (SEG2)
 * ------------------------------------------------------------------ */

function ProfileTab({ segKey, profile, tone }) {
  const seg = useRead(() => personaSegmentsApi.read(), [segKey]);
  const completion = useRead(() => personaSegmentsApi.completion(segKey), [segKey]);
  const answers = useRead(() => personaSegmentsApi.answers(segKey), [segKey]);
  const archetypes = useRead(() => personaSegmentsApi.archetypes(segKey), [segKey]);
  const tiles = profileTiles({ seg, completion }, segKey);
  const a = answersView(answers);
  const w = archetypesView(archetypes);
  const needs = needsView(profile);
  return (
    <div className="flex flex-col gap-3.5" data-testid="seg-page-profile">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.key} className={`${CARD} flex flex-col gap-1 px-3.5 py-3`} data-testid={`seg-page-tile-${t.key}`}>
            <span className={EYE}>{t.label}</span>
            {t.loading ? <span className={`${MONO} text-[13px] text-axal-muted`}>Reading…</span>
              : t.failed ? (
                <span className="flex flex-col items-start gap-1">
                  <span className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">Could not be read</span>
                  <button type="button" className="text-[12px] font-bold text-axal-violet underline dark:text-violet-300" onClick={t.key === 'answered' ? completion.retry : seg.retry}>Try again</button>
                </span>
              ) : <span className={`${MONO} text-[20px] font-extrabold text-axal-ink dark:text-gray-100`}>{t.value}</span>}
            {t.sub ? <span className={SUB}>{t.sub}</span> : null}
          </div>
        ))}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <section className={`${CARD} flex flex-col gap-2 p-4`} data-testid="seg-page-who">
          <h2 className={H2}>Who they are</h2>
          <p className="m-0 text-[13px] leading-normal text-axal-ink dark:text-gray-100">{profile.who || 'HQ has not written who this segment is yet.'}</p>
          {profile.typical?.length ? (
            <>
              <span className={EYE}>The typical member</span>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-axal-ink dark:text-gray-100">{profile.typical.map((t) => <li key={t}>{t}</li>)}</ul>
            </>
          ) : null}
        </section>
        {w.status === 'loading' ? <Loading id="work" /> : w.status === 'failed' ? <Failed title="How they work" onRetry={archetypes.retry} id="work" /> : (
          <section className={`${CARD} flex flex-col gap-2 p-4`} data-testid="seg-page-work">
            <h2 className={H2}>How they work</h2>
            <span className={SUB}>{`The working style each member shows on their profile. ${w.profiled} with one recorded.`}</span>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">{w.bars.map((b) => <Bar key={b.label} bar={b} max={w.max} tone={tone} />)}</ul>
          </section>
        )}
      </div>
      <section className="flex flex-col gap-2" data-testid="seg-page-told">
        <h2 className="m-0 text-[18px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">What they told us at sign-up</h2>
        <span className={SUB}>Counts only. No answer is shown on its own or next to a name. A count under 5 shows as &lt;5.</span>
        {a.status === 'loading' ? <Loading id="answers" /> : a.status === 'failed' ? <Failed onRetry={answers.retry} id="answers" /> : !a.questions.length ? (
          <p className={`m-0 ${SUB}`} data-testid="seg-page-no-questions">This segment asks no questions at sign-up.</p>
        ) : (
          <div className="grid gap-3.5 lg:grid-cols-3">
            {a.questions.map((q) => (
              <section key={q.key} className={`${CARD} flex flex-col gap-2 p-4`} data-testid={`seg-page-question-${q.key}`}>
                <h3 className="m-0 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{q.prompt}</h3>
                {q.open ? <span className={SUB}>Open answers are counted, not shown.</span> : null}
                <ul className="m-0 flex list-none flex-col gap-2 p-0">{q.bars.map((b) => <Bar key={b.label} bar={b} max={q.max} tone={tone} />)}</ul>
              </section>
            ))}
          </div>
        )}
      </section>
      <section className={`${CARD} flex flex-col gap-2 p-4`} data-testid="seg-page-needs">
        <h2 className={H2}>Needs and what answers them</h2>
        {!needs.recorded ? <p className={`m-0 ${SUB}`}>{needs.reason}</p> : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {needs.items.map((n) => (
              <li key={n.id} className="flex flex-col gap-0.5 border-t border-axal-hairline pt-2 first:border-t-0 first:pt-0 dark:border-gray-700">
                <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{n.text}</span>
                <span className={n.answered.length ? SUB : 'text-[12px] font-semibold text-amber-800 dark:text-amber-300'}>{n.answered.length ? `Answered by ${n.answered.join(', ')}` : 'Nothing answers it yet.'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Members (SEG3)
 * ------------------------------------------------------------------ */

function Pick({ label, value, options, onChange, testId }) {
  return (
    <label className="flex flex-col">
      <span className="sr-only">{label}</span>
      <select value={value || ''} onChange={(e) => onChange(e.target.value || null)} className={CONTROL} data-testid={testId}>
        <option value="">{`${label}: All`}</option>
        {options.map((o) => <option key={o.key} value={o.key}>{`${label}: ${o.label}`}</option>)}
      </select>
    </label>
  );
}

function RowMenu({ row, onMove, testId }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button type="button" aria-expanded={open} aria-label={`More actions for ${row.name}`} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} className={`${actionGhost} min-w-[36px] max-sm:min-h-[44px]`} data-testid={testId}>⋯</button>
      {open ? (
        <div className={`${CARD} absolute right-0 top-full z-20 mt-1 flex w-[230px] flex-col gap-0.5 p-1.5 shadow-lg`} data-testid={`${testId}-list`}>
          <button type="button" className="rounded-[7px] px-2.5 py-2 text-left text-[13px] font-semibold text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800" onClick={() => { setOpen(false); onMove(); }} data-testid={`${testId}-move`}>Move to another segment…</button>
          <Link to={`/admin/accounts/all?q=${encodeURIComponent(row.email || row.name)}`} className="rounded-[7px] px-2.5 py-2 text-[13px] font-semibold text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800" data-testid={`${testId}-account`}>Open account</Link>
        </div>
      ) : null}
    </div>
  );
}

function MembersTab({ segKey, superAdmin, onMoved }) {
  const [f, setF] = useState({ q: '', profile: null, how_set: null, band: null, sub: null, answered: null, active: null, sort: 'given', page: 1 });
  const params = membersParams(segKey, f);
  const members = useRead(() => personaSegmentsApi.members(params), [segKey, JSON.stringify(params)]);
  const [picked, setPicked] = useState(() => new Map());
  const [moving, setMoving] = useState(null);
  const set = (patch) => setF((x) => ({ ...x, page: 1, ...patch }));
  const rows = members.status === 'ready' && Array.isArray(members.data?.rows) ? members.data.rows : null;
  const toggle = (m) => setPicked((p) => { const n = new Map(p); if (n.has(m.user_id)) n.delete(m.user_id); else n.set(m.user_id, m); return n; });
  const asMover = (m) => ({ ...m, ...(() => { const r = memberRow(m); return { name: r.name, howSet: r.howSet, confidence: r.confidence }; })() });
  const pages = members.data ? Math.max(1, Math.ceil((Number(members.data.total) || 0) / (Number(members.data.page_size) || 25))) : 1;
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-label="Members" data-testid="seg-page-members">
      {picked.size ? (
        <div className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3.5 py-2.5 dark:border-violet-800 dark:bg-violet-950/40" data-testid="seg-page-move-bar">
          <span className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">{`${picked.size} selected`}</span>
          <button type="button" className={PRIMARY} onClick={() => setMoving([...picked.values()].map(asMover))} data-testid="seg-page-move-selected">Move to another segment…</button>
          <button type="button" className={actionGhost} onClick={() => setPicked(new Map())} data-testid="seg-page-move-clear">Clear</button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[200px] flex-1 flex-col">
          <span className="sr-only">Search name or email</span>
          <input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search name or email" className={CONTROL} data-testid="seg-page-search" />
        </label>
        <Pick label="Profile" value={f.profile} options={PROFILES.map((p) => ({ key: p.role, label: p.label }))} onChange={(v) => set({ profile: v })} testId="seg-page-filter-profile" />
        <Pick label="How set" value={f.how_set} options={HOW_SET} onChange={(v) => set({ how_set: v })} testId="seg-page-filter-how" />
        <Pick label="Confidence" value={f.band} options={CONF_BANDS} onChange={(v) => set({ band: v })} testId="seg-page-filter-band" />
        <Pick label="Sub-account" value={f.sub} options={[{ key: 'lp', label: 'LP' }, { key: 'tester', label: 'Product tester' }, { key: 'none', label: 'None' }]} onChange={(v) => set({ sub: v })} testId="seg-page-filter-sub" />
        <Pick label="Answered" value={f.answered} options={[{ key: 'yes', label: 'Started the questions' }, { key: 'no', label: 'Not started' }]} onChange={(v) => set({ answered: v })} testId="seg-page-filter-answered" />
        <Pick label="Last active" value={f.active} options={ACTIVE} onChange={(v) => set({ active: v })} testId="seg-page-filter-active" />
        <label className="flex flex-col">
          <span className="sr-only">Sort</span>
          <select value={f.sort} onChange={(e) => set({ sort: e.target.value })} className={CONTROL} data-testid="seg-page-sort">
            {MEMBER_SORTS.map((s) => <option key={s.key} value={s.key}>{`Sort: ${s.label}`}</option>)}
          </select>
        </label>
      </div>
      {members.status === 'loading' && !rows ? <span className={`${MONO} text-[12px] text-axal-muted`}>Reading…</span> : null}
      {members.status === 'error' ? (
        <div role="alert" className="flex flex-col items-start gap-2" data-testid="seg-page-members-failed">
          <span className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">The members could not be read. That is not the same as none.</span>
          <button type="button" className={actionGhost} onClick={members.retry}>Try again</button>
        </div>
      ) : null}
      {rows ? (
        rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-left text-[12.5px]" data-testid="seg-page-members-table">
              <thead>
                <tr className={EYE}>
                  <th scope="col" className="w-8 py-1.5"><span className="sr-only">Select</span></th>
                  {['Member', 'Profile', 'Sub-accounts', 'How set', 'Confidence', 'Tagged on', 'Last active'].map((c) => <th key={c} scope="col" className="py-1.5 pr-3 font-bold">{c}</th>)}
                  <th scope="col" className="py-1.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const r = memberRow(m);
                  return (
                    <tr key={r.id} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid={`seg-page-member-${r.id}`}>
                      <td className="py-2"><input type="checkbox" aria-label={`Select ${r.name}`} checked={picked.has(r.id)} onChange={() => toggle(m)} data-testid={`seg-page-pick-${r.id}`} /></td>
                      <td className="py-2 pr-3">
                        <span className="block font-bold text-axal-ink dark:text-gray-100">{r.name}</span>
                        {r.email ? <span className={`block ${SUB}`}>{r.email}</span> : null}
                        {r.differs ? <span className="mt-0.5 inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid={`seg-page-differs-${r.id}`}>Profile differs</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{r.profile}</td>
                      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{r.sub}</td>
                      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{r.howSet}</td>
                      <td className={`py-2 pr-3 ${MONO}`}>{r.confidence}</td>
                      <td className={`py-2 pr-3 ${MONO}`}>{r.tagged}</td>
                      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{r.lastActive}</td>
                      <td className="py-1 text-right"><RowMenu row={r} onMove={() => setMoving([asMover(m)])} testId={`seg-page-member-menu-${r.id}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className={`m-0 ${SUB}`} data-testid="seg-page-members-none">{Number(members.data.total) === 0 && !f.q && !f.profile && !f.how_set && !f.band && !f.sub && !f.answered && !f.active ? 'No member is in this segment yet.' : 'No member matches. Clear a filter.'}</p>
      ) : null}
      {rows ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid="seg-page-members-range">{rangeText(members.data)}</span>
          <button type="button" className={actionGhost} disabled={f.page <= 1} onClick={() => setF((x) => ({ ...x, page: x.page - 1 }))}>Previous</button>
          <button type="button" className={actionGhost} disabled={f.page >= pages} onClick={() => setF((x) => ({ ...x, page: x.page + 1 }))} data-testid="seg-page-members-next">Next</button>
        </div>
      ) : null}
      {members.data?.unreadable?.length ? <span className={SUB} data-testid="seg-page-members-partial">Some columns could not be read and say so: {members.data.unreadable.join(', ')}.</span> : null}
      <span className={SUB}>⋯ holds Move to another segment… and Open account. Confidence shows only for a suggestion at sign-up.</span>
      {moving ? (
        <MoveDialog members={moving} superAdmin={superAdmin} onClose={() => setMoving(null)}
          onMoved={(reply, target) => { setMoving(null); setPicked(new Map()); members.retry(); onMoved(movedLine(reply, target.name)); }} />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Activity (SEG8, this segment's)
 * ------------------------------------------------------------------ */

function ActivityTab({ segKey }) {
  const [kind, setKind] = useState(null);
  const [page, setPage] = useState(1);
  const act = useRead(() => personaSegmentsApi.activity({ segment: segKey, kind: kind || undefined, page: page > 1 ? page : undefined }), [segKey, kind, page]);
  const rows = act.status === 'ready' && Array.isArray(act.data?.rows) ? act.data.rows : null;
  const pages = act.data ? Math.max(1, Math.ceil((Number(act.data.total) || 0) / (Number(act.data.page_size) || 25))) : 1;
  const gone = act.data?.sources ? ACTIVITY_KINDS.filter((k) => act.data.sources[k.key]?.available === false) : [];
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-label="Activity" data-testid="seg-page-activity">
      <div className="flex flex-wrap items-center gap-2">
        <Pick label="What" value={kind} options={ACTIVITY_KINDS} onChange={(v) => { setKind(v); setPage(1); }} testId="seg-page-activity-kind" />
      </div>
      {act.status === 'loading' && !rows ? <span className={`${MONO} text-[12px] text-axal-muted`}>Reading…</span> : null}
      {act.status === 'error' ? (
        <div role="alert" className="flex flex-col items-start gap-2" data-testid="seg-page-activity-failed">
          <span className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">The activity could not be read. That is not the same as none.</span>
          <button type="button" className={actionGhost} onClick={act.retry}>Try again</button>
        </div>
      ) : null}
      {gone.length ? <span className="text-[12px] font-semibold text-amber-800 dark:text-amber-300" data-testid="seg-page-activity-partial">{`${gone.map((g) => g.label).join(', ')} could not be read, so ${gone.length === 1 ? 'it is' : 'they are'} not listed.`}</span> : null}
      {rows ? (rows.length ? (
        <ul className="m-0 flex list-none flex-col p-0" data-testid="seg-page-activity-list">
          {rows.map((r, i) => {
            const v = activityRow(r, segKey);
            return (
              <li key={`${r.kind}-${r.at}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-700">
                <span className="text-[13px] font-semibold leading-snug text-axal-ink dark:text-gray-100">{v.text}</span>
                <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`}>{v.when}</span>
                <span className={SUB}>{v.kind}</span>
              </li>
            );
          })}
        </ul>
      ) : <p className={`m-0 ${SUB}`} data-testid="seg-page-activity-none">Nothing has happened in this segment yet.</p>) : null}
      {rows ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`}>{rangeText(act.data)}</span>
          <button type="button" className={actionGhost} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <button type="button" className={actionGhost} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

export function SegmentPage({ superAdmin }) {
  const loc = useLocation();
  const at = segmentTabOf(loc.pathname);
  const segKey = at?.key ?? null;
  const read = useRead(() => (segKey ? personaSegmentsApi.segmentProfile(segKey) : Promise.reject(Object.assign(new Error('not found'), { status: 404 }))), [segKey]);
  const [done, setDone] = useState(null);
  const profile = read.data?.segment || null;
  const tone = profileTone(profile?.profile);
  const crumb = { label: SEG_TITLE, to: SEG_PATH, current: profile?.name || 'Segment' };
  const onMoved = useCallback((line) => setDone(line), []);
  // Literal doors, one per tab (D936), so the reachability walk finds each.
  const tabs = segKey ? (
    <>
      <HeaderTab to={`/admin/persona-segments/${segKey}`} data-testid="seg-page-tab-profile">Profile</HeaderTab>
      <HeaderTab to={`/admin/persona-segments/${segKey}/members`} data-testid="seg-page-tab-members">Members</HeaderTab>
      <HeaderTab to={`/admin/persona-segments/${segKey}/activity`} data-testid="seg-page-tab-activity">Activity</HeaderTab>
    </>
  ) : null;
  const pills = useMemo(() => (profile ? [
    { label: profileWord(profile.profile), tone: 'held', testId: 'seg-page-profile-pill' },
    { label: statusWord(profile.status), tone: profile.status === 'active' ? 'live' : 'hq', testId: 'seg-page-status-pill' },
  ] : []), [profile]);

  let body;
  if (!segKey || (read.status === 'error' && Number(read.error?.status) === 404)) {
    body = (
      <section className={`${CARD} flex flex-col items-start gap-2 p-5`} data-testid="seg-page-gone">
        <h2 className={H2}>No segment is recorded at this address.</h2>
        <Link to={SEG_PATH} className={actionGhost}>Open Persona segments</Link>
      </section>
    );
  } else if (read.status === 'loading') body = <Loading id="segment" />;
  else if (read.status === 'error') body = <Failed title="This segment" onRetry={read.retry} id="segment" />;
  else if (at.tab === 'members') body = <MembersTab segKey={segKey} superAdmin={superAdmin} onMoved={onMoved} />;
  else if (at.tab === 'activity') body = <ActivityTab segKey={segKey} />;
  else body = <ProfileTab segKey={segKey} profile={profile} tone={tone} />;

  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="seg-page">
      <AdminPageHeader crumb={crumb} title={profile?.name || 'Segment'} pills={pills} line={profile?.who || undefined} scope={!superAdmin} tabs={tabs} data-testid="seg-page-header" />
      {done ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] font-semibold text-axal-ink dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-gray-100" data-testid="seg-page-moved">
          <span><span aria-hidden="true" className="mr-1.5 text-emerald-700 dark:text-emerald-400">✓</span>{done.text}</span>
          <Link to={`/admin/persona-segments/${segKey}/activity`} className={actionGhost} data-testid="seg-page-moved-activity">View activity</Link>
        </div>
      ) : null}
      {body}
    </div>
  );
}

/** The page in its rail frame, as Persona segments sits (D1004's keys). */
export default function SegmentPageRoute() {
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  return superAdmin ? (
    <AdminBoardFrame workspace="Personas" note={RAIL_NOTE} data-testid="hq-board-persona-segment">
      <SegmentPage superAdmin />
    </AdminBoardFrame>
  ) : (
    <AdminBoardFrame workspace="Persona segments" note={ADMIN_RAIL_NOTE} data-testid="admin-board-persona-segment">
      <SegmentPage superAdmin={false} />
    </AdminBoardFrame>
  );
}
