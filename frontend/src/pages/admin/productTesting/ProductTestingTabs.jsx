import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminProductTestersApi, adminTestingApi } from '../../../lib/api/productTesting';
import { Pill } from '../../../ui';
import { ConsoleUnreadable, CONSOLE_LOADING } from '../consoles/shared';
import ProgrammeApplicants from '../../testing/ProgrammeApplicants';
import { MAIL_NOTE, ROLE_OPTIONS, datesLine, placesLine, statusLabel, statusTone } from '../../testing/programmeModel';
import {
  NOT_YET, PROGRAM_SUBS, TESTER_CHIPS, WAITS, dayOf, overviewFigures, profileWord, testerRow,
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

export function OverviewTab({ api = adminTestingApi, testersApi = adminProductTestersApi }) {
  const programmes = useRead(useCallback(() => api.programmes(), [api]));
  const testers = useRead(useCallback(() => testersApi.list('active'), [testersApi]));
  if (programmes.status === 'loading') return <p className={`p-6 text-sm ${MUTED}`}>{CONSOLE_LOADING}</p>;
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
        <div className="lg:col-span-2"><Wait id="weekly" title="Applications and picks per week" /></div>
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
        </section>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Wait id="profiles" title="Who applies, by profile" />
        <Wait id="mail" title="Can Mail reach them?" />
      </div>

      <section className={`${CARD} flex flex-col gap-2`} data-testid="testing-status-chips">
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

      <Wait id="needs" title="Needs you" />
    </div>
  );
}

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
export function ProductTestingTabBody({ view, review, programs }) {
  if (view.tab === 'programs' && view.uid) return <ProgramTab uid={view.uid} sub={view.sub} />;
  if (view.tab === 'review') return review;
  if (view.tab === 'programs') return programs;
  if (view.tab === 'applicants') return <ApplicantsTab />;
  if (view.tab === 'testers') return <TestersTab />;
  return <OverviewTab />;
}
