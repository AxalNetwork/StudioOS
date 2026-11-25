/**
 * D988 (#2779, part 7 of #2376) — the Licences page's Programs tab (canvas
 * GR7–GR15), `/admin/my-licence/programs`. Part 3's read (D984) gives the nine
 * programs with their standing and grant; part 5's (D986) the partner deal
 * types HQ allows; D799's list the requests with HQ.
 *
 * HQ decides, the studio asks. Nothing here writes but the request sheet,
 * which sends one of D983's program requests and changes nothing until HQ
 * answers. EACH READ FAILS ALONE: unreadable programs say so with Try again,
 * and the deal types and requests beside them still render. A program with no
 * grant row reads "Not recorded", never "Not granted" (D981 §3).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { licenceProgramsApi } from '../../../lib/api/licencePrograms';
import { licenceRequestsApi } from '../../../lib/api/licenceRequests';
import { partnerDealTypesApi } from '../../../lib/api/partnerDealTypes';
import { reportError } from '../../../lib/log';
import { tabPath } from '../../../lib/licencePage';
import { GRANTS_PATH } from '../../../lib/programGrants';
import { isSuperAdminUser } from '../../../lib/shellRole';
import {
  PURPOSE, copyStamp, periodOf, programTiles, scheduleOf, serviceTermLine, studioProgramAccess, studioProgramAccessPath, termsSummary,
  openProgramRequests,
} from '../../../lib/studioPrograms';
import { Skeleton } from '../../../ui';
import ProgramRequestSheet from './ProgramRequestSheet';
import ProgramTermsDialog from './ProgramTermsDialog';

const CARD = 'rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400';
const BTN = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';
const PRIMARY = 'rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800';
const LINK = 'text-left text-xs font-semibold text-slate-700 hover:underline dark:text-slate-300';
const TONE = {
  held: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  waiting: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  asked: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  paused: 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200',
  unrecorded: 'border-dashed border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400',
  muted: 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400',
};

/** A read's three states: undefined reading, null unreadable (with why), else the payload. */
function useRead(load) {
  const [state, setState] = useState({ value: undefined, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ value: undefined, error: null });
    load().then(
      (v) => { if (live) setState({ value: v, error: null }); },
      (e) => { reportError('licence-programs:read', e); if (live) setState({ value: null, error: e }); },
    );
    return () => { live = false; };
  }, [load, tick]);
  return [state, useCallback(() => setTick((t) => t + 1), [])];
}

const readPrograms = () => licenceProgramsApi.mine();
const readDealTypes = () => partnerDealTypesApi.mine();
const readRequests = () => licenceRequestsApi.list();

/**
 * GR11 C, and GR14 C for HQ: an account no licence binds. Drawn by the tab
 * and by the Licences page's "no licence" state on this tab.
 */
export function ProgramsUnlinked({ user }) {
  if (isSuperAdminUser(user)) {
    return (
      <div className={`${CARD} mx-auto flex max-w-xl flex-col items-center gap-3 p-10 text-center`} data-testid="licence-programs-hq">
        <p className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-white">You are viewing as an Admin.</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">HQ is not a studio, so it holds no grants.</p>
        <Link to={GRANTS_PATH} className={PRIMARY}>Open Program access by licence</Link>
      </div>
    );
  }
  return (
    <div className={`${CARD} mx-auto flex max-w-xl flex-col items-center gap-3 p-10 text-center`} data-testid="licence-programs-none">
      <p className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-white">Your account is not linked to a licence.</p>
      <p className="text-sm text-gray-600 dark:text-gray-400">On HQ-held accounts, HQ runs every program.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link to="/admin/programs" className={BTN}>Open Programs</Link>
        <Link to="/help" className={BTN}>Contact HQ</Link>
      </div>
    </div>
  );
}

function Tiles({ tiles }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="licence-programs-tiles">
      {tiles.map((t) => (
        <div key={t.id} className={`${CARD} flex flex-col gap-1 px-4 py-3`} data-testid={`licence-programs-tile-${t.id}`}>
          <span className={EYE}>{t.label}</span>
          <span className="font-mono text-lg font-bold text-gray-900 dark:text-gray-100">{t.value || ' '}</span>
          <span className="text-[11.5px] text-gray-500 dark:text-gray-400">{t.sub}</span>
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }) {
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[status.tone] || TONE.muted}`}>{status.word}</span>;
}

/** The Action cell, on the table and on the phone's cards. */
function Action({ p, action: a, act }) {
  if (!a) return <span className="text-xs text-gray-400">—</span>;
  if (a.kind === 'check_history') return <Link to={studioProgramAccessPath(p.program_key, a.kind)} className={LINK}>Check request history</Link>;
  if (a.kind === 'view_request') return <Link to={studioProgramAccessPath(p.program_key, a.kind)} className={LINK}>View request</Link>;
  if (a.kind === 'request') return <button type="button" className={LINK} onClick={() => act.ask(p, 'grant')} data-testid={`licence-program-ask-${p.program_key}`}>Request it</button>;
  return (
    <div className="flex flex-col gap-0.5">
      {a.page ? <Link to={a.page} className={LINK}>Open program ›</Link> : null}
      <span className="flex flex-wrap gap-x-2 text-[11px] text-gray-500">
        <button type="button" className="hover:underline" onClick={() => act.terms(p)} data-testid={`licence-program-terms-${p.program_key}`}>View all terms</button>
        {a.change && <button type="button" className="hover:underline" onClick={() => act.ask(p, 'change')}>Request a change</button>}
        {a.end && <button type="button" className="hover:underline" onClick={() => act.ask(p, 'end')}>Request to end</button>}
      </span>
    </div>
  );
}

function Dash() { return <span className="text-xs text-gray-400">—</span>; }

function ProgramsTable({ programs, requests, act }) {
  return (
    <section className={`${CARD} overflow-hidden`} aria-label="Programs">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Programs</h3>
        <span className="font-mono text-xs text-gray-500">{programs.length} programs</span>
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-t border-gray-100 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
              {['Program', 'Status', 'Your terms', 'Period', 'Schedule', 'Action'].map((c) => <th key={c} scope="col" className="px-3 py-2">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {programs.map((p) => {
              const { status: s, action } = studioProgramAccess(p, requests);
              const terms = termsSummary(p);
              const sched = scheduleOf(p);
              return (
                <tr key={p.program_key} className="border-t border-gray-100 align-top dark:border-gray-800" data-testid={`licence-program-${p.program_key}`}>
                  <th scope="row" className="px-3 py-2.5">
                    <span className="block font-semibold text-gray-900 dark:text-gray-100">{p.name}</span>
                    <span className="block text-[11.5px] font-normal text-gray-500 dark:text-gray-400">{PURPOSE[p.program_key] || p.group}</span>
                  </th>
                  <td className="px-3 py-2.5"><StatusPill status={s} />{s.line && <span className={`mt-1 block text-[11.5px] ${s.tone === 'asked' ? 'font-semibold text-amber-800 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}>{s.line}</span>}</td>
                  <td className="px-3 py-2.5 text-[12.5px]">{terms ? terms.map((t, i) => <span key={t} className={i ? 'block text-[11.5px] text-gray-500' : 'block text-gray-800 dark:text-gray-200'}>{t}</span>) : <Dash />}</td>
                  <td className="px-3 py-2.5 font-mono text-[11.5px] text-gray-700 dark:text-gray-300">{periodOf(p) || <Dash />}</td>
                  <td className={`px-3 py-2.5 text-[12px] ${sched?.muted ? 'text-gray-500' : 'font-mono text-gray-700 dark:text-gray-300'}`}>{sched ? sched.text : <Dash />}</td>
                  <td className="px-3 py-2.5"><Action p={p} action={action} act={act} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* GR15a: a card per program on a phone. */}
      <ul className="divide-y divide-gray-100 border-t border-gray-100 md:hidden dark:divide-gray-800 dark:border-gray-800" data-testid="licence-programs-cards">
        {programs.map((p) => {
          const { status: s, action } = studioProgramAccess(p, requests);
          const terms = termsSummary(p);
          return (
            <li key={p.program_key} className="flex flex-col gap-1.5 px-4 py-3" data-testid={`licence-program-card-${p.program_key}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100">{p.name}</span>
                <StatusPill status={s} />
              </div>
              <span className="text-[12px] text-gray-500 dark:text-gray-400">{s.tone === 'asked' ? s.line : terms ? terms.join(' · ') : (PURPOSE[p.program_key] || s.line)}</span>
              <Action p={p} action={action} act={act} />
            </li>
          );
        })}
      </ul>
      <p className="border-t border-gray-100 px-4 py-2.5 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
        Open program goes to that program’s page under Programs. A paused program shows HQ’s note and its terms. Runs at HQ has no action and no link.
      </p>
    </section>
  );
}

/** "Partner deal types you may offer" (D986): each type ✓ or locked, or why none is recorded. */
function DealTypes({ read, retry }) {
  const d = read.value;
  return (
    <section className={`${CARD} space-y-2 px-4 py-3.5`} data-testid="licence-programs-deal-types">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Partner deal types you may offer</h3>
      {d === undefined && <p className="font-mono text-xs text-gray-500">Reading…</p>}
      {d === null && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-red-700 dark:text-red-300" data-testid="licence-programs-deal-types-unreadable">
          <span>Unreadable. Your partner deal types could not be read. That is not the same as none.</span>
          <button type="button" className={BTN} onClick={retry}>Try again</button>
        </div>
      )}
      {d && (
        <>
          {!d.recorded && <p className="text-xs text-gray-600 dark:text-gray-400">{d.reason || 'Not recorded. HQ has not set which partner deal types this studio may offer.'}</p>}
          <ul className="flex flex-wrap gap-1.5">
            {(d.catalogue || []).map((c) => {
              const on = d.recorded ? (d.types || []).includes(c.type) : null;
              return (
                <li key={c.type} data-testid={`licence-deal-type-${c.type}`}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${on === false ? 'border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-500' : on ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-dashed border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>
                  {on === false ? `– ${c.label} · locked` : on ? `✓ ${c.label}` : c.label}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="text-[11px] text-gray-500 dark:text-gray-400">HQ sets these. Your partner invitations offer only these types.</p>
    </section>
  );
}

/** A program link only ever opens a form for the specific program after reading this licence's status. */
function LinkedProgram({ program, intent, requests, onClose, onSent, onChange }) {
  const onlyProgram = useMemo(() => [program], [program]);
  const load = useCallback(() => licenceRequestsApi.list(program.program_key), [program.program_key]);
  const [focused, retry] = useRead(load);
  const { status, action } = studioProgramAccess(program, focused.value);
  if (intent === 'terms' && action?.kind === 'open') {
    return <ProgramTermsDialog program={program} status={status} onClose={onClose} onRequestChange={() => onChange(program)} />;
  }
  if (intent === 'request' && action?.kind === 'request' && Array.isArray(requests?.items) && requests.available !== false) {
    return <ProgramRequestSheet open programs={onlyProgram} requests={requests} grantRequests={focused.value}
      initialProgram={program.program_key} initialAsk="grant" onClose={onClose} onSent={onSent} />;
  }
  return (
    <section className={`${CARD} space-y-2 p-4`} aria-live="polite" data-testid="licence-program-focused">
      <h3 className="font-semibold">{program.name}</h3>
      <StatusPill status={status} />
      {status.line && <p className="text-sm">{status.line}</p>}
      {status.request?.status === 'undelivered' && <Link className={LINK} to="/branch/approvals">Open To HQ to retry delivery</Link>}
      {status.request?.answer && <p className="text-sm">HQ’s answer: {status.request.answer}</p>}
      {focused.value === null && <button type="button" className={BTN} onClick={retry}>Try again</button>}
      {action?.kind === 'request' && intent !== 'request' && <Link className={LINK} to={studioProgramAccessPath(program.program_key, 'request')}>Request for my studio</Link>}
      {action?.kind === 'open' && intent !== 'terms' && <Link className={LINK} to={studioProgramAccessPath(program.program_key, 'open')}>View terms</Link>}
    </section>
  );
}

export default function ProgramsTab({ user = null, today = new Date() }) {
  const [params, setParams] = useSearchParams();
  const programKey = params.get('program');
  const closeLink = () => {
    const next = new URLSearchParams(params);
    next.delete('program'); next.delete('action');
    setParams(next, { replace: true });
  };
  const [programs, retryPrograms] = useRead(readPrograms);
  const [deals, retryDeals] = useRead(readDealTypes);
  const [requests, retryRequests] = useRead(readRequests);
  const [terms, setTerms] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [sent, setSent] = useState('');

  const read = programs.value;
  const list = Array.isArray(read?.programs) ? read.programs : read === undefined ? undefined : null;
  const reqs = requests.value;
  const open = openProgramRequests(reqs?.items);
  const tiles = programTiles({ programs: list, requests: reqs, today });
  const stamp = copyStamp(read);
  const act = {
    terms: (p) => setTerms(p),
    ask: (p, ask) => { setTerms(null); setSent(''); setSheet({ program: p?.program_key || null, ask }); },
  };

  if (read && read.linked === false) return <ProgramsUnlinked user={user} />;

  const focused = programKey && list?.find((program) => program.program_key === programKey);
  const sentRequest = (row) => {
    setSheet(null);
    setSent(row?.status === 'undelivered'
      ? <>Saved at your studio. HQ has yet to receive this request. <Link className={LINK} to="/branch/approvals">Open To HQ to retry delivery</Link></>
      : `Sent to HQ${row?.due_at ? `. HQ answers by ${String(row.due_at).slice(0, 10)}` : ''}. Nothing changes until HQ answers.`);
    retryRequests();
  };
  const nothingHeld = Array.isArray(list) && !list.some((p) => ['in_force', 'granted', 'paused', 'ended'].includes(p.standing));
  return (
    <div className="space-y-4" data-testid="licence-programs">
      <div className={`${CARD} px-4 py-3`}>
        <p className="text-[13px] font-bold text-gray-900 dark:text-gray-100" data-testid="licence-programs-rule">
          HQ decides which programs your studio runs, and on what terms.
        </p>
        <p className="text-xs text-gray-600 dark:text-gray-400">You can ask for a change from this tab or under Requests.</p>
      </div>
      {stamp && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300" data-testid="licence-programs-stamp">{stamp}</p>}
      {Array.isArray(read?.hq_services) && read.hq_services.length > 0 && (
        <section className={`${CARD} space-y-2 px-4 py-3`} aria-label="Services delivered by HQ" id="hq-services" data-testid="licence-hq-services">
          <h3 className="text-sm font-bold">Services delivered by HQ</h3>
          <ul className="space-y-2">
            {read.hq_services.map((service) => (
              <li key={JSON.stringify([service.program_key, service.package_name, service.package_version, service.starts_on, service.ends_on])} className="text-sm">
                <p>{service.description}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">{serviceTermLine(service)}</p>
              </li>
            ))}
          </ul>
          <Link to={tabPath('contract')} className={LINK}>View licence contract</Link>
        </section>
      )}
      {focused && <LinkedProgram key={`${programKey}:${params.get('action')}`} program={focused} intent={params.get('action')} requests={reqs}
        onClose={closeLink} onSent={(row) => { closeLink(); sentRequest(row); }}
        onChange={(p) => { closeLink(); act.ask(p, 'change'); }} />}
      {programKey && Array.isArray(list) && !focused && <p className={`${CARD} p-4 text-sm`} role="status">This program has no recorded entry on your studio licence.</p>}
      <Tiles tiles={tiles} />
      {sent && <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status" data-testid="licence-programs-sent">{sent}</p>}

      {list === undefined && (
        <div className={`${CARD} space-y-2 p-4`} data-testid="licence-programs-loading" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={28} />)}
        </div>
      )}
      {read === null && (
        <div role="alert" className={`${CARD} flex flex-col gap-2 p-4 text-sm text-red-700 dark:text-red-300`} data-testid="licence-programs-unreadable">
          <span>Your programs could not be read. That is not the same as none.</span>
          <button type="button" className={`${BTN} self-start`} onClick={retryPrograms}>Try again</button>
        </div>
      )}
      {read && !Array.isArray(read.programs) && (
        <p className={`${CARD} p-4 text-sm text-gray-600 dark:text-gray-400`} data-testid="licence-programs-no-copy">{read.reason || 'HQ has not sent this studio its programs yet.'}</p>
      )}
      {nothingHeld && Array.isArray(reqs?.items) && reqs.complete !== false && open.length === 0 && (
        <div className={`${CARD} flex flex-col items-center gap-2 p-6 text-center`} data-testid="licence-programs-nothing">
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">HQ has not granted any program to {read?.licence?.brand_name || 'your studio'} yet.</p>
          <p className="text-xs text-gray-600 dark:text-gray-400">See what HQ offers below, or request one.</p>
          <button type="button" className={PRIMARY} onClick={() => act.ask(null, 'grant')}>Request a program</button>
        </div>
      )}
      {Array.isArray(list) && <ProgramsTable programs={list} requests={reqs} act={act} />}
      {reqs !== undefined && (!Array.isArray(reqs?.items) || reqs.available === false) && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-amber-800 dark:text-amber-200" data-testid="licence-programs-requests-unreadable">
          <span>Your requests could not be read, so a program you asked for may not show as Requested.</span>
          <button type="button" className={BTN} onClick={retryRequests}>Try again</button>
        </div>
      )}
      <DealTypes read={deals} retry={retryDeals} />

      <ProgramTermsDialog
        program={terms}
        status={terms ? studioProgramAccess(terms, reqs).status : null}
        onClose={() => setTerms(null)}
        onRequestChange={(p) => act.ask(p, 'change')}
      />
      <ProgramRequestSheet
        open={!!sheet}
        programs={list}
        requests={reqs}
        initialProgram={sheet?.program || null}
        initialAsk={sheet?.ask || null}
        onClose={() => setSheet(null)}
        onSent={sentRequest}
      />
    </div>
  );
}

