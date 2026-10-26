import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminProductTestersApi, adminTestingApi } from '../../../lib/api/productTesting';
import { Pill } from '../../../ui';
import { ConsoleUnreadable, CONSOLE_LOADING } from '../consoles/shared';
import ProgrammeApplicants from '../../testing/ProgrammeApplicants';
import { MAIL_NOTE, ROLE_OPTIONS, datesLine, placesLine, statusLabel, statusTone } from '../../testing/programmeModel';
import {
  NOT_YET, PROGRAM_SUBS, RAIL, REACH_STEPS, TESTER_CHIPS, WAITS, blockState, dayOf, needsYou, overviewFigures, profileBars,
  profileWord, reachRows, testerRow, weeklySeries, weeklySummary,
} from './productTestingModel';

/**
 * D1195 (#2382) — the bodies of HQ › Platform › Product testing's tabs that
 * are new: Overview (TST1), one program (TST5, TST6), Applicants (TST8) and
 * the Tester pool (TST9). Review and Programs are D815's console
 * (`ProductTestingPanel`). Each block draws a read on `main` or says "Not read
 * here yet" with its reason (`productTestingModel.js` WAITS); none draws a zero
 * for a missing value, and none draws an email address.
 */
const CARD = 'rounded-xl border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900';
const H3 = 'm-0 text-[13px] font-bold text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';
const LINK = 'font-semibold text-axal-violet hover:underline dark:text-violet-300';
const EYEBROW = 'text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';

export function Wait({ id, title }) {
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid={`testing-wait-${id}`}>
      <h3 className={H3}>{title}</h3>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>{WAITS[id]}</p>
    </section>
  );
}

/** One read: loading, ready or unreadable, with Try again. A reload keeps what was read until it answers. */
function useRead(fn) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const load = useCallback(() => {
    setRead((r) => ({ status: 'loading', data: r.data }));
    return Promise.resolve().then(fn).then(
      (data) => setRead({ status: 'ready', data }),
      () => setRead({ status: 'unreadable', data: null }),
    );
  }, [fn]);
  useEffect(() => { load(); }, [load]);
  return { ...read, reload: load };
}

function Tile({ label, value, sub, testId, children }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1`} data-testid={testId}>
      <span className={EYEBROW}>{label}</span>
      <span className={`text-[22px] font-extrabold text-axal-ink dark:text-gray-100 ${MONO}`} data-testid={`${testId}-value`}>{value}</span>
      {sub ? <span className={`text-[12px] ${MUTED}`}>{sub}</span> : null}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overview (TST1)
 * ------------------------------------------------------------------ */

/** The page's two shared reads: the Overview's tiles and the header's tab counts draw from the same answers (D1201). */
export function useTestingReads({ api = adminTestingApi, testersApi = adminProductTestersApi } = {}) {
  const programmes = useRead(useCallback(() => api.programmes(), [api]));
  const testers = useRead(useCallback(() => testersApi.list('active'), [testersApi]));
  return { programmes, testers };
}

const SEG = 'inline-flex rounded-lg border border-axal-hairline p-0.5 text-[11.5px] font-semibold dark:border-gray-700';
const SEG_ON = 'rounded-md bg-violet-50 px-2 py-0.5 text-axal-ink dark:bg-violet-950 dark:text-gray-100';
const SEG_OFF = `rounded-md px-2 py-0.5 ${MUTED}`;

/** Chart or Table (the canvas's toggle): the table is the chart's "View as table", the same figures. */
function ChartToggle({ id, view, onChange }) {
  return (
    <div className={SEG} role="radiogroup" aria-label="Show as" data-testid={`${id}-toggle`}>
      {['chart', 'table'].map((k) => (
        <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => onChange(k)}
          className={view === k ? SEG_ON : SEG_OFF} data-testid={`${id}-toggle-${k}`}>{k === 'chart' ? 'Chart' : 'View as table'}</button>
      ))}
    </div>
  );
}

/** One overview block's frame: its title, the toggle when it has figures, and its four states. */
function Block({ id, title, meta, toggle, children, foot }) {
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2.5`} data-testid={id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={H3}>{title}{meta ? <span className={`ml-2 font-normal ${MUTED}`}>{meta}</span> : null}</h3>
        {toggle}
      </div>
      {children}
      {foot ? <p className={`m-0 text-[12px] ${MUTED}`}>{foot}</p> : null}
    </section>
  );
}

function BlockUnreadable({ id, reason, onRetry }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={`${id}-unreadable`}>
      <span className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">Unreadable</span>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>{reason}</p>
      <button type="button" className={`${LINK} w-fit text-[12px]`} onClick={onRetry} data-testid={`${id}-retry`}>Try again</button>
    </div>
  );
}

const Skeleton = ({ id }) => <div aria-label="Reading" className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" data-testid={`${id}-loading`} />;

const NotRecordedLine = ({ id, children }) => (
  <p className={`m-0 border-t-[1.5px] border-dashed border-gray-400 pt-3 text-[13px] font-semibold dark:border-gray-500 ${MUTED}`} data-testid={`${id}-not-recorded`}>{children}</p>
);

const APPS = 'stroke-violet-600 dark:stroke-violet-400';
const PICKS = 'stroke-sky-500 dark:stroke-sky-400';
const APPS_FILL = 'fill-violet-600 dark:fill-violet-400';
const PICKS_FILL = 'fill-sky-500 dark:fill-sky-400';
const SVG_TEXT = 'fill-axal-muted dark:fill-gray-400';
const SVG_INK = 'fill-axal-ink dark:fill-gray-100';
const SVG_HAIR = 'stroke-gray-200 dark:stroke-gray-700';

/** Applications and picks per week (TST1): two lines; unrecorded weeks a dashed hairline; the current week hollow, "to date". */
function WeeklyChart({ s }) {
  const W = 660, H = 250, L = 36, Rt = 116, T = 16, Bm = 30, iw = W - L - Rt, ih = H - T - Bm, n = s.rows.length;
  const ym = Math.max(5, Math.ceil((s.max || 0) / 5) * 5);
  const X = (i) => +(L + (n > 1 ? (i * iw) / (n - 1) : iw / 2)).toFixed(1);
  const Y = (v) => +(T + ih - (v / ym) * ih).toFixed(1);
  const ticks = []; for (let v = 0; v <= ym; v += ym / 4) ticks.push(v);
  const firstRec = s.rows.findIndex((r) => r.recorded);
  const lastUnrec = firstRec === -1 ? n - 1 : firstRec;
  const series = [['Applications', 'applications', APPS, APPS_FILL], ['Picks', 'picks', PICKS, PICKS_FILL]];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={weeklySummary(s)} className="h-auto w-full" data-testid="testing-weekly-chart">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={L + iw} y1={Y(v)} y2={Y(v)} className={SVG_HAIR} />
          <text x={L - 7} y={Y(v) + 4} textAnchor="end" fontSize="11" className={SVG_TEXT}>{v}</text>
        </g>
      ))}
      {s.rows.map((r, i) => (i % 2 === 0 || i === n - 1) ? <text key={r.week} x={X(i)} y={H - 8} textAnchor="middle" fontSize="10.5" className={SVG_TEXT}>{r.label}</text> : null)}
      {s.unrecorded > 0 ? (
        <g data-testid="testing-weekly-unrecorded">
          <line x1={X(0)} x2={X(Math.min(lastUnrec, n - 1))} y1={Y(0)} y2={Y(0)} strokeWidth="1.5" strokeDasharray="4 4" className="stroke-gray-500 dark:stroke-gray-400" />
          <text x={X(0) + 2} y={T + 14} fontSize="10.5" className={SVG_TEXT}>Not recorded:</text>
          <text x={X(0) + 2} y={T + 28} fontSize="10.5" className={SVG_TEXT}>no program was open</text>
        </g>
      ) : null}
      {series.map(([name, k, stroke, fill]) => {
        const pts = s.rows.map((r, i) => (r[k] == null ? null : [X(i), Y(r[k]), r, i])).filter(Boolean);
        if (!pts.length) return null;
        const last = pts[pts.length - 1];
        return (
          <g key={k} data-testid={`testing-weekly-${k}`}>
            <path d={pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0]} ${pt[1]}`).join(' ')} fill="none" strokeWidth="2.2" className={stroke} />
            {pts.map(([x, y, r]) => (
              <circle key={r.week} cx={x} cy={y} r={r.toDate ? 4.5 : 3} strokeWidth={r.toDate ? 2 : 0}
                className={r.toDate ? `${stroke} fill-white dark:fill-gray-900` : fill} tabIndex={0} data-testid={r.toDate ? `testing-weekly-${k}-to-date` : undefined}>
                <title>{`${r.label} · ${name} ${r[k]}${r.toDate ? ' so far' : ''}`}</title>
              </circle>
            ))}
            <text x={last[0] + 10} y={last[1] + 4} fontSize="11.5" fontWeight="700" className={SVG_INK}>{`${name} ${last[2][k]}`}</text>
          </g>
        );
      })}
      {n && s.rows[n - 1].toDate ? <text x={X(n - 1)} y={T + 6} textAnchor="middle" fontSize="10" className={SVG_TEXT}>to date</text> : null}
    </svg>
  );
}

const TABLE = 'w-full border-collapse text-left text-[12.5px]';
const TH = `border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800 ${EYEBROW}`;
const TD = 'border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800';

function WeeklyBlock({ read }) {
  const [view, setView] = useState('chart');
  const id = 'testing-weekly';
  const st = read.status === 'ready' ? blockState(read.data?.weekly) : null;
  const s = st?.state === 'ready' ? weeklySeries(read.data.weekly) : null;
  const legend = (
    <div className={`flex flex-wrap gap-3 text-[11.5px] ${MUTED}`}>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-violet-600 dark:bg-violet-400" />Applications</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-sky-500 dark:bg-sky-400" />Picks</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-3.5 border-t-[1.5px] border-dashed border-gray-500 dark:border-gray-400" />Not recorded</span>
    </div>
  );
  return (
    <Block id={id} title="Applications and picks per week" meta={s ? `Last ${s.rows.length} weeks` : null}
      toggle={s?.anyRecorded ? <ChartToggle id={id} view={view} onChange={setView} /> : null}
      foot={s?.anyRecorded ? 'Weeks start on Monday. The current week is a hollow point, to date.' : null}>
      {read.status === 'loading' ? <Skeleton id={id} /> : null}
      {read.status === 'unreadable' ? <BlockUnreadable id={id} reason="The overview did not answer. This is not a claim that there are none." onRetry={read.reload} /> : null}
      {st?.state === 'unreadable' ? <BlockUnreadable id={id} reason={st.reason} onRetry={read.reload} /> : null}
      {s && !s.anyRecorded ? <NotRecordedLine id={id}>Not recorded: no program has opened yet, so no week has applications or picks to count.</NotRecordedLine> : null}
      {s?.anyRecorded && view === 'chart' ? <>{legend}<WeeklyChart s={s} /></> : null}
      {s?.anyRecorded && view === 'table' ? (
        <div className="overflow-x-auto">
          <table className={TABLE} data-testid={`${id}-table`}>
            <thead><tr><th className={TH}>Week of</th><th className={TH}>Applications</th><th className={TH}>Picks</th></tr></thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.week}>
                  <td className={TD}>{r.label}{r.toDate ? <span className={MUTED}> · to date</span> : null}</td>
                  <td className={`${TD} ${MONO}`}>{r.recorded ? r.applications : 'Not recorded'}</td>
                  <td className={`${TD} ${MONO}`}>{r.recorded ? r.picks : 'Not recorded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Block>
  );
}

/** Who applies, by profile (TST1, TST14a): the pool and the applicants side by side, each answering alone. */
function ProfilesBlock({ read }) {
  const [view, setView] = useState('chart');
  const id = 'testing-profiles';
  const b = read.status === 'ready' ? profileBars(read.data?.by_profile) : null;
  const both = b && b.pool.state === 'ready' && b.applicants.state === 'ready';
  const any = b && (b.pool.state === 'ready' || b.applicants.state === 'ready');
  const empty = any && b.max === 0;
  const W = 560, L = 132, Rr = 34, rh = both ? 38 : 24, iw = W - L - Rr, mx = Math.max(1, b?.max || 0);
  const bars = (r) => [
    b.pool.state === 'ready' ? ['pool', r.pool, APPS_FILL, 'Testers in the pool'] : null,
    b.applicants.state === 'ready' ? ['applicants', r.applicants, PICKS_FILL, 'Applicants on open programs'] : null,
  ].filter(Boolean);
  return (
    <Block id={id} title="Who applies, by profile" toggle={any && !empty ? <ChartToggle id={id} view={view} onChange={setView} /> : null}
      foot={any ? (b.pool.state === 'ready' ? 'Any profile can be a tester. Admins cannot apply.' : 'The tester pool could not be read, so its bars are left out. Any profile can be a tester. Admins cannot apply.') : null}>
      {read.status === 'loading' ? <Skeleton id={id} /> : null}
      {read.status === 'unreadable' ? <BlockUnreadable id={id} reason="The overview did not answer. This is not a claim that there are none." onRetry={read.reload} /> : null}
      {b && !any ? <BlockUnreadable id={id} reason={b.pool.reason} onRetry={read.reload} /> : null}
      {b && any && b.pool.state !== 'ready' ? <p className="m-0 text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid={`${id}-pool-unreadable`}>The tester pool could not be read. <button type="button" className={`${LINK} text-[12px]`} onClick={read.reload}>Try again</button></p> : null}
      {b && any && b.applicants.state !== 'ready' ? <p className="m-0 text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid={`${id}-applicants-unreadable`}>The applicants on open programs could not be read. <button type="button" className={`${LINK} text-[12px]`} onClick={read.reload}>Try again</button></p> : null}
      {empty ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid={`${id}-empty`}>No testers in the pool and no applicants on open programs yet.</p> : null}
      {any && !empty && view === 'chart' ? (
        <>
          <div className={`flex flex-wrap gap-3 text-[11.5px] ${MUTED}`}>
            {b.pool.state === 'ready' ? <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-600 dark:bg-violet-400" />Testers in the pool</span> : null}
            {b.applicants.state === 'ready' ? <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500 dark:bg-sky-400" />Applicants on open programs</span> : null}
          </div>
          <svg viewBox={`0 0 ${W} ${b.rows.length * rh + 4}`} role="img" className="h-auto w-full" data-testid={`${id}-chart`}
            aria-label={`By profile: ${b.rows.map((r) => `${r.label} ${bars(r).map((x) => x[1]).join(' and ')}`).join(', ')}.`}>
            {b.rows.map((r, i) => {
              const y = i * rh + 4;
              return (
                <g key={r.key}>
                  <text x="0" y={y + 14} fontSize="12" className={SVG_INK}>{r.label}</text>
                  {bars(r).map(([k, v, fill, name], j) => {
                    const by = y + 2 + j * 14, bw = Math.max(2, (v / mx) * iw);
                    return (
                      <g key={k}>
                        <rect x={L} y={by} width={bw.toFixed(1)} height="11" rx="2" className={fill} tabIndex={0} data-testid={`${id}-${k}-${r.key}`}><title>{`${r.label} · ${name} ${v}`}</title></rect>
                        <text x={(L + bw + 6).toFixed(1)} y={by + 10} fontSize="11" className={`${SVG_INK} font-mono`}>{v}</text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </>
      ) : null}
      {any && !empty && view === 'table' ? (
        <div className="overflow-x-auto">
          <table className={TABLE} data-testid={`${id}-table`}>
            <thead><tr><th className={TH}>Profile</th>{b.pool.state === 'ready' ? <th className={TH}>Testers in the pool</th> : null}{b.applicants.state === 'ready' ? <th className={TH}>Applicants on open programs</th> : null}</tr></thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.key}>
                  <td className={TD}>{r.label}</td>
                  {b.pool.state === 'ready' ? <td className={`${TD} ${MONO}`}>{r.pool}</td> : null}
                  {b.applicants.state === 'ready' ? <td className={`${TD} ${MONO}`}>{r.applicants}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Block>
  );
}

/** Can Mail reach them? (TST1): per open program, the four steps; counts only, never an address. */
function ReachBlock({ read }) {
  const [view, setView] = useState('chart');
  const id = 'testing-reach';
  const st = read.status === 'ready' ? blockState(read.data?.mail_reach) : null;
  const rows = st?.state === 'ready' ? reachRows(read.data.mail_reach) : null;
  const W = 560, L = 118, cw = (W - L) / 4, rh = 40, T = 22;
  return (
    <Block id={id} title="Can Mail reach them?" toggle={rows?.length ? <ChartToggle id={id} view={view} onChange={setView} /> : null}
      foot="Mail writes only to picked testers who agreed, kept emails on, and whose address is not suppressed. Delivery figures are in Axal VC Mail.">
      {read.status === 'loading' ? <Skeleton id={id} /> : null}
      {read.status === 'unreadable' ? <BlockUnreadable id={id} reason="The overview did not answer. This is not a claim that there are none." onRetry={read.reload} /> : null}
      {st?.state === 'unreadable' ? <BlockUnreadable id={id} reason={st.reason} onRetry={read.reload} /> : null}
      {rows && rows.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid={`${id}-empty`}>No program is open or testing, so nobody is picked yet.</p> : null}
      {rows?.length && view === 'chart' ? (
        <svg viewBox={`0 0 ${W} ${T + rows.length * rh}`} role="img" className="h-auto w-full" data-testid={`${id}-chart`}
          aria-label={`Of the testers picked on each open program, how many Mail can reach: ${rows.map((r) => `${r.name} ${r.steps[3].n} of ${r.steps[0].n}`).join(', ')}.`}>
          {REACH_STEPS.map((s, j) => <text key={s.key} x={L + j * cw} y="12" fontSize="9" letterSpacing=".3" className={`${SVG_TEXT} font-mono`}>{s.label.toUpperCase()}</text>)}
          {rows.map((r, i) => {
            const y = T + i * rh, top = r.steps[0].n;
            return (
              <g key={r.uid}>
                <text x="0" y={y + 17} fontSize="12" fontWeight="700" className={SVG_INK}>{r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name}<title>{r.name}</title></text>
                {r.steps.map((s, j) => {
                  const x = L + j * cw, tw = cw - 36, bw = top > 0 ? Math.max(2, (s.n / top) * tw) : 0;
                  return (
                    <g key={s.key}>
                      <rect x={x} y={y + 8} width={tw.toFixed(1)} height="12" rx="3" className="fill-gray-50 stroke-gray-200 dark:fill-gray-800 dark:stroke-gray-700" />
                      {bw ? <rect x={x} y={y + 8} width={bw.toFixed(1)} height="12" rx="3" className={APPS_FILL} tabIndex={0}><title>{`${r.name} · ${s.label} ${s.n}`}</title></rect> : null}
                      <text x={(x + tw + 6).toFixed(1)} y={y + 18} fontSize="11" className={`${SVG_INK} font-mono`} data-testid={`${id}-${r.uid}-${s.key}`}>{s.n}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      ) : null}
      {rows?.length && view === 'table' ? (
        <div className="overflow-x-auto">
          <table className={TABLE} data-testid={`${id}-table`}>
            <thead><tr><th className={TH}>Program</th>{REACH_STEPS.map((s) => <th key={s.key} className={TH}>{s.label}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={r.uid}><td className={TD}>{r.name}</td>{r.steps.map((s) => <td key={s.key} className={`${TD} ${MONO}`}>{s.n}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </Block>
  );
}

/** Needs you (TST1), from the programme list: what waits on HQ, each with where it is acted on. */
function NeedsBlock({ items, now }) {
  const rows = needsYou(items, now);
  return (
    <Block id="testing-needs" title="Needs you" meta={String(rows.length)}
      foot="Withdrawal requests reach HQ through Support; they are not read here yet.">
      {rows.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="testing-needs-none">Nothing waits on you: no program waits for review, is approved and not open, has dates that passed its status, or has applicants with nobody picked.</p> : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800" data-testid={`testing-need-${r.key}`}>
              <span className="text-[13px] font-semibold leading-snug text-axal-ink dark:text-gray-100">{r.text}</span>
              <Link className={`${LINK} text-[12.5px]`} to={r.action.to}>{r.action.label}</Link>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

/** The rail's line (TST1): what Eadwyn reads here and never does. */
function RailNote() {
  return (
    <aside className="flex flex-col gap-2 rounded-xl border border-axal-lavender-edge bg-axal-lavender px-4 py-3 dark:border-violet-800 dark:bg-violet-950/40" data-testid="testing-rail-line">
      <p className="m-0 text-[13px] leading-relaxed text-axal-ink dark:text-gray-100">{RAIL.line}</p>
      <p className="m-0 text-[12px] text-axal-ink dark:text-gray-200"><span className={EYEBROW}>Reads</span> {RAIL.reads}</p>
      <p className="m-0 text-[12px] text-axal-ink dark:text-gray-200"><span className={EYEBROW}>Never</span> {RAIL.never}</p>
    </aside>
  );
}

export function OverviewTab({ api = adminTestingApi, testersApi = adminProductTestersApi, reads = null, now = Date.now() }) {
  const own = useTestingReads({ api: reads ? NO_READS : api, testersApi: reads ? NO_TESTERS : testersApi });
  const { programmes, testers } = reads || own;
  const overview = useRead(useCallback(() => api.overview(), [api]));
  if (programmes.status === 'loading' && !programmes.data) return <p className={`p-6 text-sm ${MUTED}`}>{CONSOLE_LOADING}</p>;
  if (programmes.status === 'unreadable') return <ConsoleUnreadable what="Testing programmes" onRetry={programmes.reload} />;
  const f = overviewFigures(programmes.data?.items);
  const totals = testers.data?.totals;
  const oldest = dayOf(f.oldestWaiting);
  return (
    <div className="flex flex-col gap-5" data-testid="testing-overview">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Tile label="Open programs" value={f.open} testId="testing-tile-open"
          sub={`${f.approvedNotOpen} approved, not yet open`} />
        <Tile label="Waiting for your review" value={f.waiting} testId="testing-tile-waiting"
          sub={f.waiting ? (oldest ? `Oldest sent ${oldest}` : 'When it was sent is not recorded') : 'Nothing waiting'}>
          <Link className={`${LINK} text-[12px]`} to="/admin/platform/product-testing/review">Open Review</Link>
        </Tile>
        <Tile label="Places filled" testId="testing-tile-places"
          value={f.places.places ? `${f.places.picked} of ${f.places.places}` : f.places.programs ? 'Not recorded' : '0'}
          sub={`On the ${f.places.programs} open ${f.places.programs === 1 ? 'program' : 'programs'} · ${f.places.applicants} applicants`} />
        {testers.status === 'ready' && totals ? (
          <Tile label="Tester pool" value={totals.active} testId="testing-tile-pool"
            sub={`${totals.paused} paused · ${totals.applied} applications waiting in Approvals`}>
            <Link className={`${LINK} text-[12px]`} to="/admin/approvals/product-testers">Decide in Approvals</Link>
          </Tile>
        ) : (
          <Tile label="Tester pool" testId="testing-tile-pool"
            value={testers.status === 'loading' ? 'Reading…' : 'Could not be read'}
            sub={testers.status === 'loading' ? null : 'The tester pool did not answer. This is not a claim that there are none.'}>
            {testers.status === 'unreadable' ? <button type="button" className={`${LINK} w-fit text-[12px]`} onClick={testers.reload}>Try again</button> : null}
          </Tile>
        )}
      </div>

      <div className="grid gap-3.5 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2"><WeeklyBlock read={overview} /></div>
        <section className={`${CARD} flex flex-col gap-2`} data-testid="testing-places-bars">
          <h3 className={H3}>Places filled, by open program</h3>
          {f.bars.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`}>No program is open or testing.</p> : f.bars.map((b) => (
            <Link key={b.uid} to={`/admin/platform/product-testing/programs/${encodeURIComponent(b.uid)}`} className="flex flex-col gap-1 no-underline" data-testid={`testing-bar-${b.uid}`}>
              <span className="flex items-center justify-between gap-2 text-[12.5px] text-axal-ink dark:text-gray-100">
                <span className="truncate">{b.name}</span>
                <span className={MONO}>{b.places ? `${b.picked} of ${b.places}` : 'Places not recorded'}</span>
              </span>
              {b.places ? (
                <span className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800">
                  <span className="block h-1.5 rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${Math.min(100, Math.round((b.picked / b.places) * 100))}%` }} />
                </span>
              ) : <span className="h-0 w-full border-t border-dashed border-gray-300 dark:border-gray-600" />}
            </Link>
          ))}
          <p className={`m-0 text-[12px] ${MUTED}`}>The track is the places; the fill is the testers picked. A bar opens its program.</p>
        </section>
      </div>

      <div className="hidden gap-3.5 sm:grid lg:grid-cols-2">
        <ProfilesBlock read={overview} />
        <ReachBlock read={overview} />
      </div>

      <section className={`${CARD} hidden flex-col gap-2 sm:flex`} data-testid="testing-status-chips">
        <h3 className={H3}>Programs by status</h3>
        <div className="flex flex-wrap gap-1.5">
          {f.chips.map((c) => (
            <Link key={c.status} to="/admin/platform/product-testing/programs" className="inline-flex items-center gap-1.5 rounded-full border border-axal-hairline px-2.5 py-1 text-[12px] font-semibold text-axal-ink no-underline hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800" data-testid={`testing-chip-${c.status}`}>
              {c.label} <span className={MONO}>{c.n}</span>
            </Link>
          ))}
        </div>
        <p className={`m-0 text-[12px] ${MUTED}`}>Axal VC {f.owners.hq} · Partner firms {f.owners.partner}</p>
      </section>

      <NeedsBlock items={programmes.data?.items} now={now} />
      <RailNote />
    </div>
  );
}

// When the page passes its own reads, the Overview makes none of its own.
const NO_READS = Object.freeze({ programmes: () => new Promise(() => {}) });
const NO_TESTERS = Object.freeze({ list: () => new Promise(() => {}) });

/* ------------------------------------------------------------------ *
 * One program (TST5, TST6)
 * ------------------------------------------------------------------ */

const roleNames = (roles) => (Array.isArray(roles) ? roles : [])
  .map((r) => ROLE_OPTIONS.find(([k]) => k === r)?.[1] || r).join(', ') || 'No role chosen';

export function ProgramTab({ uid, sub = 'overview', api = adminTestingApi }) {
  const programmes = useRead(useCallback(() => api.programmes(), [api]));
  const applicantsApi = useMemo(() => ({ applicants: api.applicants, pick: api.pick, decline: api.decline }), [api]);
  if (programmes.status === 'loading' && !programmes.data) return <p className={`p-6 text-sm ${MUTED}`}>{CONSOLE_LOADING}</p>;
  if (programmes.status === 'unreadable') return <ConsoleUnreadable what="This testing program" onRetry={programmes.reload} />;
  const p = (programmes.data?.items || []).find((x) => x.uid === uid);
  if (!p) {
    return (
      <section className={`${CARD} flex flex-col gap-2`} data-testid="testing-program-missing">
        <h3 className={H3}>No testing program has this address</h3>
        <Link className={`${LINK} text-[12.5px]`} to="/admin/platform/product-testing/programs">Back to Programs</Link>
      </section>
    );
  }
  const hq = p.owner_kind === 'hq';
  return (
    <div className="flex flex-col gap-4" data-testid="testing-program">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[18px] font-extrabold text-axal-ink dark:text-gray-100" data-testid="testing-program-name">{p.product_name}</h2>
        <Pill tone={statusTone(p.status)}>{statusLabel(p.status)}</Pill>
        <Pill tone="neutral">{hq ? 'Axal VC' : (p.owner_name || 'Partner not recorded')}</Pill>
      </div>
      <nav aria-label="Program" className="flex gap-4 border-b border-axal-hairline dark:border-gray-800">
        {PROGRAM_SUBS.map((s) => (
          <Link key={s.key} to={`/admin/platform/product-testing/programs/${encodeURIComponent(p.uid)}${s.query}`} aria-current={s.key === sub ? 'page' : undefined}
            className={`-mb-px border-b-2 px-0.5 pb-2 text-[13px] font-semibold no-underline ${s.key === sub ? 'border-axal-violet text-axal-ink dark:border-violet-400 dark:text-gray-100' : `border-transparent ${MUTED}`}`}
            data-testid={`testing-program-sub-${s.key}`}>{s.label}</Link>
        ))}
      </nav>
      {sub === 'overview' && (
        <section className={`${CARD} flex flex-col gap-1.5 text-[12.5px]`} data-testid="testing-program-details">
          <p className="m-0"><span className="font-semibold">Places:</span> {placesLine(p)} · {p.applicant_count} {p.applicant_count === 1 ? 'applicant' : 'applicants'}</p>
          <p className="m-0"><span className="font-semibold">Dates:</span> {datesLine(p)}</p>
          {p.summary && <p className="m-0">{p.summary}</p>}
          {p.tester_tasks && <p className="m-0"><span className="font-semibold">What testers do:</span> {p.tester_tasks}</p>}
          {p.time_needed && <p className="m-0"><span className="font-semibold">Time needed:</span> {p.time_needed}</p>}
          <p className="m-0"><span className="font-semibold">Who can apply:</span> {roleNames(p.eligible_roles)}</p>
          {(p.questions || []).length > 0 && <ol className="m-0 ml-4 list-decimal">{p.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>}
          {p.status === 'rejected' && p.review_note && <p className="m-0 text-red-700 dark:text-red-300">Sent back: {p.review_note}</p>}
        </section>
      )}
      {sub === 'applicants' && (hq ? (
        <section className={`${CARD} flex flex-col gap-2`} data-testid="testing-program-applicants">
          <p className={`m-0 text-[12.5px] ${MUTED}`}>{MAIL_NOTE} No email address is shown here.</p>
          <ProgrammeApplicants uid={p.uid} api={applicantsApi} onChanged={programmes.reload} />
        </section>
      ) : <Wait id="partnerApplicants" title="Applicants" />)}
      {sub === 'activity' && <Wait id="activity" title="Activity" />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Applicants (TST8)
 * ------------------------------------------------------------------ */

export function ApplicantsTab() {
  return (
    <div className="flex flex-col gap-3" data-testid="testing-applicants-tab">
      <p className={`m-0 text-[12.5px] ${MUTED}`}>An applicant applied to one program. A tester is in the pool. Someone can be both.</p>
      <Wait id="applicants" title="Every applicant" />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tester pool (TST9)
 * ------------------------------------------------------------------ */

const CHIP = 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold';

export function TestersTab({ testersApi = adminProductTestersApi }) {
  const [status, setStatus] = useState('active');
  const read = useRead(useCallback(() => testersApi.list(status), [testersApi, status]));
  const totals = read.data?.totals;
  return (
    <div className="flex flex-col gap-4" data-testid="testing-testers">
      <p className={`m-0 text-[12.5px] ${MUTED}`}>A tester is an account an admin approved to test products. Any profile can apply except Admin. Tester applications are decided in Approvals.</p>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Tester status">
        {TESTER_CHIPS.map((c) => (
          <button key={c.status} type="button" role="radio" aria-checked={status === c.status} onClick={() => setStatus(c.status)}
            className={`${CHIP} ${status === c.status ? 'border-violet-200 bg-violet-50 text-axal-ink dark:border-violet-700 dark:bg-violet-950 dark:text-gray-100' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100'}`}
            data-testid={`tester-chip-${c.status}`}>
            {c.label} <span className={MONO}>{totals ? totals[c.status] : '—'}</span>
          </button>
        ))}
        {totals ? (
          <Link to="/admin/approvals/product-testers" className={`${CHIP} border-amber-300 bg-amber-50 text-amber-900 no-underline dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200`} data-testid="tester-applications-link">
            <span className={MONO}>{totals.applied}</span> applications waiting · Decide in Approvals
          </Link>
        ) : null}
      </div>
      {read.status === 'loading' && <p className={`text-sm ${MUTED}`}>{CONSOLE_LOADING}</p>}
      {read.status === 'unreadable' && <ConsoleUnreadable what="The tester pool" onRetry={read.reload} />}
      {read.status === 'ready' && ((read.data?.rows || []).length === 0 ? (
        <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="testers-none">No {TESTER_CHIPS.find((c) => c.status === status)?.label.toLowerCase()} testers. Members become testers when an admin approves their application in Approvals.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]" data-testid="testers-table">
            <thead>
              <tr className={EYEBROW}>
                {['Name', 'Profile', 'Tester since', 'Availability', 'Email consent version', 'Status'].map((h) => <th key={h} className="border-b border-axal-hairline px-2 py-2 dark:border-gray-800">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {read.data.rows.map(testerRow).map((t) => (
                <tr key={t.id} className="border-b border-axal-hairline dark:border-gray-800" data-testid="tester-row">
                  <td className="px-2 py-2 font-semibold">{t.name}</td>
                  <td className="px-2 py-2">{profileWord(t.role)}</td>
                  <td className={`px-2 py-2 ${MONO}`}>{dayOf(t.since) || 'Not recorded'}</td>
                  <td className="px-2 py-2">{t.availability || 'Not given'}</td>
                  <td className={`px-2 py-2 ${MONO}`}>{t.consentVersion || 'No consent'}</td>
                  <td className="px-2 py-2">{TESTER_CHIPS.find((c) => c.status === t.status)?.label || t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`mt-2 text-[12px] ${MUTED}`}>{read.data.matching} {read.data.matching === 1 ? 'tester' : 'testers'} · page {read.data.page}</p>
        </div>
      ))}
      <Wait id="testerPrograms" title="Approved by, and programs" />
    </div>
  );
}

/** The tab an address names, drawn; Review and Programs are passed in (D815's console). */
export function ProductTestingTabBody({ view, review, programs, reads = null }) {
  if (view.tab === 'programs' && view.uid) return <ProgramTab uid={view.uid} sub={view.sub} />;
  if (view.tab === 'review') return review;
  if (view.tab === 'programs') return programs;
  if (view.tab === 'applicants') return <ApplicantsTab />;
  if (view.tab === 'testers') return <TestersTab />;
  return <OverviewTab reads={reads} />;
}
