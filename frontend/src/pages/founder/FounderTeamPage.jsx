/**
 * Team — the founder's roster, advisors, hiring and coverage for one company
 * (D435, migration 326). Mounted at /build/team?mode=workspace in place of the
 * retired TeamBuildingPage, whose three tabs (Advisor / Co-Founder / Jobs) were
 * the discovery surfaces — the advisor directory, Co-founder Match and the
 * jobs list. Those still open here, inside the tab that owns them, so the
 * founder redirects (`/advisors`, `/cofounder`, `/my/jobs`) keep landing:
 * `?tab=advisor` → Advisors, `?tab=cofounder` and `?tab=jobs` → Hiring.
 *
 * WHAT IS READ, AND FROM WHERE. One request (`GET /company/:uid/team`) returns
 * the roster, coverage and plan from their own stores, plus three reads it
 * composes and reports per source: the cap table of the company's projects
 * (migration 020), a member's Carta option-pool import (migration 057) and
 * the co-founder decision on `projects.cofounder_decision_meta` (migration
 * 162). A source that could not be read says so where its figure would be.
 * Jobs come from `jobs.mine()` and office hours from the calendar, each with
 * its own failed state.
 *
 * WHAT IS COMPUTED IS LABELLED COMPUTED. Vested fractions come from the
 * recorded schedule (start, cliff, length) and the clock, and the row says so;
 * nothing here re-derives a provider's vested figure. Equity percentages use
 * the cap table's own `ownership_pct` when the person is on it, and the
 * recorded grant over the fully-diluted total when they are not — and the row
 * says which.
 *
 * ECONOMICS ARE LOCKED, NOT HIDDEN (D431). `salary_cents` is absent from the
 * payload for a reader who is neither an editor nor the person, and the page
 * draws "Locked" — a hidden section teaches people the wrong shape of the
 * company.
 *
 * BUILT TO THE OWNER'S DECISION LINE. The canvas draws six things no store or
 * flow can honestly produce yet; each is named on screen in the Decisions
 * panel and in the D-entry, never invented: which cap table is the company's
 * when it has several projects; a company-level option pool and a top-up
 * model; issuing paperwork from this page; a payroll-load rate; talent leads
 * from a careers page; advisory grants flowing into the cap table.
 */
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Users, UserCircle, Briefcase, LayoutGrid, Lock, Sparkles, Plus, Download, X, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuthSync';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext';
import { api, jobs as jobsApi } from '../../lib/api';
import { hasTier } from '../../sidebarConfig';
import { openPaywall } from '../../components/PaywallModal';
import PageExplainer from '../../components/PageExplainer';
import IncomingLeadsStrip from '../../components/IncomingLeadsStrip';
import { buildDecisionModel, DECISION_OUTCOMES } from '../../lib/cofounderMatchViewModel';
import { Card, Pill, Unrecorded, Unreadable } from '../../ui';
import AdvisorsPage from '../AdvisorsPage';
import CofounderPage from '../CofounderPage';
import MyJobsPage from '../jobs/MyJobsPage';

// ---------------------------------------------------------------------------
// Vocabulary. Mirrors services/companyTeam.ts; the worker refuses anything else.
// ---------------------------------------------------------------------------

export const TABS = [
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'advisors', label: 'Advisors', icon: UserCircle },
  { id: 'hiring', label: 'Hiring', icon: Briefcase },
  { id: 'coverage', label: 'Coverage', icon: LayoutGrid },
];
// The retired page's tab ids, which the founder redirects in App.jsx still
// send. Each lands in the tab that now owns that job.
const LEGACY_TABS = { advisor: 'advisors', cofounder: 'hiring', jobs: 'hiring' };
export function resolveTab(param) {
  if (!param) return 'roster';
  if (TABS.some((t) => t.id === param)) return param;
  return LEGACY_TABS[param] || 'roster';
}

const PERSON_TYPES = ['founder', 'employee', 'contractor', 'advisor'];
const ACCESS_LEVELS = ['owner', 'member', 'limited', 'pending', 'none'];
const EQUITY_KINDS = ['common', 'options', 'advisory', 'none'];
const AGREEMENT_STATES = ['signed', 'sent', 'pending', 'missing'];
const IP_STATES = ['signed', 'pending', 'missing', 'not_applicable'];
const ELECTION_STATES = ['filed', 'not_filed', 'not_applicable'];
const COVERAGE_STATES = ['covered', 'thin', 'gap'];

const TYPE_LABEL = { founder: 'Founder', employee: 'Employee', contractor: 'Contractor', advisor: 'Advisor' };
const STATUS_LABEL = { active: 'Active', offer_out: 'Offer out', offboarded: 'Offboarded' };
const STATE_LABEL = {
  signed: 'Signed', sent: 'Sent', pending: 'Pending', missing: 'Missing', not_applicable: 'Not applicable',
  filed: 'Filed', not_filed: 'Not filed', covered: 'Covered', thin: 'Thin', gap: 'Gap',
};
const TONE = {
  signed: 'ok', filed: 'ok', covered: 'ok', active: 'ok',
  sent: 'warn', pending: 'warn', thin: 'warn', offer_out: 'warn', not_filed: 'danger',
  missing: 'danger', gap: 'danger', offboarded: 'neutral', not_applicable: 'neutral',
};
const stateLabel = (s) => (s ? STATE_LABEL[s] || s : null);
const toneOf = (s) => TONE[s] || 'neutral';

// ---------------------------------------------------------------------------
// Pure helpers — lifted by team_d435.test.mjs and run without React.
// ---------------------------------------------------------------------------

export function initialsOf(name) {
  return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

export function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function fmtNum(n) {
  return n == null || !Number.isFinite(Number(n)) ? null : Number(n).toLocaleString('en-US');
}

export function centsToDollars(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return null;
  return `$${(Number(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function dollarsToCents(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

/**
 * The vested fraction from the RECORDED schedule and the clock. Returns null
 * when the schedule is not recorded; never reads a provider's vested count.
 * Before the cliff nothing is vested and the elapsed share is a ghost track.
 */
export function vestingOf(p, today = new Date()) {
  if (!p || !p.vest_start_date || !p.vest_months) return null;
  const start = new Date(`${p.vest_start_date}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const months = (today.getTime() - start.getTime()) / (86400000 * 30.4375);
  const cliff = p.cliff_months == null ? 0 : Number(p.cliff_months);
  const elapsed = Math.max(0, Math.min(1, months / Number(p.vest_months)));
  if (p.status === 'offer_out' || months < 0) {
    return { pct: 0, ghost: 0, note: `Starts ${fmtDate(p.vest_start_date)}`, cliffRecorded: p.cliff_months != null };
  }
  if (cliff > 0 && months < cliff) {
    const cliffDate = new Date(start); cliffDate.setUTCMonth(cliffDate.getUTCMonth() + cliff);
    const days = Math.max(0, Math.round((cliffDate.getTime() - today.getTime()) / 86400000));
    return { pct: 0, ghost: Math.round(elapsed * 100), note: `Cliff in ${days} days`, cliffRecorded: true };
  }
  return {
    pct: Math.round(elapsed * 100), ghost: 0,
    note: `${Math.round(elapsed * 100)}% vested · computed from the recorded schedule`,
    cliffRecorded: p.cliff_months != null,
  };
}

/** Fully-diluted denominator: the sum of every holder's shares the cap table read returned. */
export function fullyDiluted(capTable) {
  if (!capTable?.available) return null;
  const total = (capTable.holders || []).reduce((a, h) => a + (Number.isFinite(Number(h.shares)) ? Number(h.shares) : 0), 0);
  return total > 0 ? total : null;
}

/**
 * A person's equity: the cap table's own figure when they are on it, the
 * recorded grant over the fully-diluted total when they are not, and an
 * honest absence otherwise. `source` says which.
 */
export function equityOf(p, capTable) {
  const email = p?.email ? String(p.email).toLowerCase() : null;
  const holder = email && capTable?.available ? (capTable.holders || []).find((h) => h.email === email) : null;
  if (holder) {
    const pct = holder.ownership_pct != null ? Number(holder.ownership_pct)
      : (fullyDiluted(capTable) && holder.shares != null ? (Number(holder.shares) / fullyDiluted(capTable)) * 100 : null);
    return { source: 'cap_table', pct, shares: holder.shares, kind: holder.security_type || null };
  }
  if (p?.equity_shares != null && Number(p.equity_shares) > 0) {
    const fd = fullyDiluted(capTable);
    return { source: 'recorded', pct: fd ? (Number(p.equity_shares) / fd) * 100 : null, shares: Number(p.equity_shares), kind: p.equity_kind || null };
  }
  if (p?.equity_kind === 'none') return { source: 'none', pct: 0, shares: 0, kind: 'none' };
  return { source: 'unrecorded', pct: null, shares: null, kind: null };
}

export function paperworkGaps(people) {
  return (people || []).filter((p) => p.status !== 'offboarded' && (p.ip_assignment === 'missing' || p.election_83b === 'not_filed'));
}

/**
 * Monthly people cost from recorded annual salaries, for the reader the
 * payload served them to. Anyone whose salary is not recorded is counted as
 * unknown, never as zero; the payroll-load rate is not stored, so it is not
 * estimated.
 */
export function peopleCost(people) {
  const active = (people || []).filter((p) => p.status === 'active');
  const served = active.every((p) => Object.prototype.hasOwnProperty.call(p, 'salary_cents'));
  if (!served) return { locked: true };
  const bucket = (type) => {
    const rows = active.filter((p) => p.person_type === type);
    const known = rows.filter((p) => p.salary_cents != null);
    return {
      count: rows.length,
      unknown: rows.length - known.length,
      monthlyCents: Math.round(known.reduce((a, p) => a + Number(p.salary_cents), 0) / 12),
    };
  };
  const employees = bucket('employee');
  const contractors = bucket('contractor');
  const founders = bucket('founder');
  return {
    locked: false, employees, contractors, founders,
    totalMonthlyCents: employees.monthlyCents + contractors.monthlyCents + founders.monthlyCents,
    unknown: employees.unknown + contractors.unknown + founders.unknown,
    deferring: active.filter((p) => p.person_type === 'founder' && p.salary_cents === 0).length,
  };
}

/**
 * Pool arithmetic from what is recorded: granted (active option holders),
 * committed (offers out with options), and the pool's own available count
 * from the Carta import. "Reserved for open roles" has no store and is said
 * so, not counted as zero.
 */
export function poolArithmetic(pool, people) {
  const rows = (people || []).filter((p) => p.equity_kind === 'options' && p.equity_shares != null);
  const granted = rows.filter((p) => p.status === 'active').reduce((a, p) => a + Number(p.equity_shares), 0);
  const committed = rows.filter((p) => p.status === 'offer_out').reduce((a, p) => a + Number(p.equity_shares), 0);
  const first = pool?.available ? (pool.rows || [])[0] : null;
  const authorized = first?.shares_authorized ?? null;
  const available = first?.shares_available ?? null;
  return { granted, committed, authorized, available, pools: pool?.available ? (pool.rows || []).length : null };
}

export function rosterCsv(people) {
  const cols = ['name', 'email', 'person_type', 'role_title', 'start_date', 'status', 'access_level', 'equity_shares', 'equity_kind', 'agreement_status', 'ip_assignment', 'election_83b'];
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...(people || []).map((p) => cols.map((c) => esc(p[c])).join(','))].join('\n');
}

// ---------------------------------------------------------------------------
// Small pieces.
// ---------------------------------------------------------------------------

function TierGate({ tier, label, blurb, children }) {
  const { user } = useAuth();
  if (hasTier(user, tier)) return children;
  const tierLabel = tier === 'studio' ? 'Studio' : 'Growth';
  return (
    <div className="rounded-xl border border-gray-200 p-6 text-center dark:border-gray-800" data-testid={`tier-gate-${tier}`}>
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300"><Lock size={18} /></span>
      <h3 className="mt-3 font-semibold text-gray-900 dark:text-gray-100">{label} is a {tierLabel} feature</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-600 dark:text-gray-400">{blurb}</p>
      <button type="button" onClick={() => openPaywall(tier)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
        <Sparkles size={14} /> Upgrade to {tierLabel}
      </button>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-gray-700 dark:text-gray-300">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-gray-500 dark:text-gray-400">{hint}</span>}
    </label>
  );
}
const inputCls = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950';
function Select({ value, onChange, options, allowEmpty = true }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={inputCls}>
      {allowEmpty && <option value="">Not recorded</option>}
      {options.map((o) => <option key={o} value={o}>{stateLabel(o) || TYPE_LABEL[o] || o}</option>)}
    </select>
  );
}

function Locked({ children = 'Locked' }) {
  return <span className="inline-flex items-center gap-1 text-xs italic text-gray-500 dark:text-gray-400" title="Visible to the person and to editors of this company"><Lock size={11} /> {children}</span>;
}

// ---------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------

export default function FounderTeamPage() {
  const { company } = useActiveCompany();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = resolveTab(searchParams.get('tab'));
  const [team, setTeam] = useState({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [drawer, setDrawer] = useState(null); // person uid
  const [inviting, setInviting] = useState(false);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    if (!company?.uid) return undefined;
    let alive = true;
    setTeam({ phase: 'loading' });
    api.getCompanyTeam(company.uid)
      .then((data) => { if (alive) setTeam({ phase: 'ready', data }); })
      .catch((e) => { if (alive) setTeam({ phase: 'failed', error: e }); });
    return () => { alive = false; };
  }, [company?.uid, attempt]);

  const selectTab = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  };
  const reload = () => setAttempt((n) => n + 1);
  const patchPerson = (row) => setTeam((t) => (t.phase === 'ready'
    ? { ...t, data: { ...t.data, people: t.data.people.map((p) => (p.uid === row.uid ? row : p)) } }
    : t));

  if (!company) {
    return (
      <div className="space-y-4" data-testid="team-page">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Team</h1>
        <Card>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Team is scoped to a company, and this account has no company membership yet.
            Create one or accept an invitation in <Link to="/company-settings" className="text-violet-700 underline dark:text-violet-300">Company Settings</Link>.
          </p>
        </Card>
      </div>
    );
  }

  const data = team.phase === 'ready' ? team.data : null;
  const people = data?.people || [];
  const editor = !!data?.viewer?.editor;
  const active = people.filter((p) => p.status === 'active');
  const gaps = paperworkGaps(people);
  const fd = fullyDiluted(data?.cap_table);

  return (
    <div className="space-y-6" data-testid="team-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Team</h1>
          <PageExplainer pageKey="team_building" />
          <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
            Who builds {company.company_name} — their equity, vesting, paperwork, and the roles still open.
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400" data-testid="team-meta">
            {company.stage ? `Stage: ${company.stage}` : 'Stage not recorded'}
            {' · '}{company.created_at ? `created ${fmtDate(company.created_at)}` : 'creation date not recorded'}
            {data ? ` · ${active.length} active` : ''}
            {' · '}{fd ? `${fmtNum(fd)} shares fully diluted` : 'fully-diluted share count not recorded'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => exportRoster(people, company)} disabled={!data}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 disabled:opacity-50">
            <Download size={14} /> Export roster
          </button>
          {editor && (
            <button type="button" onClick={() => setInviting(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
              <Plus size={14} /> Invite teammate
            </button>
          )}
        </div>
      </div>

      {flash && (
        <div className={`rounded-lg px-4 py-2 text-sm ${flash.kind === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'}`} data-testid="team-flash">
          {flash.msg}
        </div>
      )}

      {team.phase === 'failed' && (
        <Card data-testid="team-unreadable">
          <Unreadable what="The team record" claim="Nothing here is drawn from a guess." onRetry={reload} />
        </Card>
      )}
      {team.phase === 'loading' && <Card><p className="text-sm text-gray-500">Loading…</p></Card>}

      {data && (
        <>
          <StatStrip data={data} people={people} />

          {gaps.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200" data-testid="paperwork-line">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                {gaps.length} team {gaps.length === 1 ? 'member has' : 'members have'} missing paperwork — {gaps.map((p) => `${p.name.split(' ')[0]} (${p.ip_assignment === 'missing' ? 'IP assignment' : '83(b) election'})`).join(', ')}. Both are diligence blockers.
                {' '}<Link to="/trust" className="underline">Open Trust Center →</Link>
              </div>
            </div>
          )}

          <div role="tablist" aria-label="Team sections" className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800">
            {TABS.map((t) => {
              const Icon = t.icon;
              const badge = t.id === 'roster' ? gaps.length
                : t.id === 'advisors' ? people.filter((p) => p.person_type === 'advisor' && p.status !== 'offboarded' && p.agreement_status !== 'signed').length
                  : t.id === 'coverage' ? (data.coverage || []).filter((c) => c.state === 'gap').length : 0;
              return (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => selectTab(t.id)}
                  data-testid={`team-tab-${t.id}`}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === t.id ? 'border-violet-600 text-violet-700 dark:text-violet-300' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'}`}>
                  <Icon size={16} /> {t.label}
                  {badge > 0 && <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{badge}</span>}
                </button>
              );
            })}
          </div>

          {tab === 'roster' && <RosterTab data={data} onOpen={setDrawer} />}
          {tab === 'advisors' && <AdvisorsTab data={data} onOpen={setDrawer} />}
          {tab === 'hiring' && <HiringTab data={data} />}
          {tab === 'coverage' && <CoverageTab data={data} company={company} flash={setFlash} onSaved={reload} />}

          <DecisionsPanel />
        </>
      )}

      {data && drawer && (
        <PersonDrawer
          person={people.find((p) => p.uid === drawer)}
          data={data}
          company={company}
          onClose={() => setDrawer(null)}
          onChanged={(row) => { patchPerson(row); }}
          flash={setFlash}
        />
      )}
      {inviting && (
        <InviteDrawer company={company} pool={data?.pool} people={people} onClose={() => setInviting(false)}
          onCreated={() => { setInviting(false); reload(); }} flash={setFlash} />
      )}
    </div>
  );
}

function exportRoster(people, company) {
  const blob = new Blob([rosterCsv(people)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${String(company?.company_name || 'team').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-roster.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// Stat strip: four figures, each from a named source.
// ---------------------------------------------------------------------------

function StatStrip({ data, people }) {
  const active = people.filter((p) => p.status === 'active');
  const offers = people.filter((p) => p.status === 'offer_out').length;
  const contractors = active.filter((p) => p.person_type === 'contractor').length;
  const gaps = (data.coverage || []).filter((c) => c.state === 'gap').length;
  const thin = (data.coverage || []).filter((c) => c.state === 'thin').length;
  const pa = poolArithmetic(data.pool, people);
  const tile = (label, value, note, testid) => (
    <Card padding="sm" data-testid={testid}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{value}</div>
      <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{note}</div>
    </Card>
  );
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="stat-strip">
      {tile('On the team', active.length, `${offers} offer${offers === 1 ? '' : 's'} out · ${contractors} contractor${contractors === 1 ? '' : 's'}`, 'stat-team')}
      {tile('Open roles', <JobsCount />, 'from the roles you posted', 'stat-roles')}
      {tile('Pool unallocated',
        !data.pool?.available ? <Unrecorded reason={data.pool?.reason}>Unreadable</Unrecorded>
          : pa.available == null ? <Unrecorded reason="No option pool is imported for a member of this company.">Not recorded</Unrecorded>
            : fmtNum(pa.available),
        pa.available == null ? 'no Carta pool import on this company' : `${fmtNum(pa.granted)} granted · ${fmtNum(pa.committed)} offer out · reserved not recorded`,
        'stat-pool')}
      {tile('Coverage gaps', (data.coverage || []).length ? gaps : <Unrecorded reason="No coverage has been recorded yet.">Not recorded</Unrecorded>,
        (data.coverage || []).length ? `${thin} thin · see Coverage` : 'record coverage under Coverage', 'stat-gaps')}
    </div>
  );
}

// The jobs count is its own read with its own failed state; a failed read is
// not zero roles.
function useJobs() {
  const [jobs, setJobs] = useState({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setJobs({ phase: 'loading' });
    jobsApi.mine()
      .then((res) => { if (alive) setJobs({ phase: 'ready', rows: Array.isArray(res?.jobs) ? res.jobs : [] }); })
      .catch((e) => { if (alive) setJobs({ phase: 'failed', error: e }); });
    return () => { alive = false; };
  }, [attempt]);
  return [jobs, () => setAttempt((n) => n + 1)];
}
function JobsCount() {
  const [jobs] = useJobs();
  if (jobs.phase === 'loading') return '…';
  if (jobs.phase === 'failed') return <Unrecorded reason="The roles could not be read.">Unreadable</Unrecorded>;
  return jobs.rows.filter((j) => j.status !== 'draft' && j.status !== 'closed').length;
}

// ---------------------------------------------------------------------------
// Roster.
// ---------------------------------------------------------------------------

function RosterTab({ data, onOpen }) {
  const [filter, setFilter] = useState('all');
  const people = data.people || [];
  const shown = filter === 'all' ? people : people.filter((p) => p.person_type === filter);
  const fd = fullyDiluted(data.cap_table);
  const pa = poolArithmetic(data.pool, people);
  return (
    <div className="space-y-4">
      <Card padding="none">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Roster</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Everyone with equity, a contract, or access. Click a row for their full record.</p>
          </div>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            {[['all', 'All'], ['founder', 'Founders'], ['employee', 'Employees'], ['contractor', 'Contractors'], ['advisor', 'Advisors']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${filter === k ? 'bg-white text-violet-700 shadow-sm dark:bg-gray-900 dark:text-violet-300' : 'text-gray-600 dark:text-gray-300'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400" data-testid="roster-empty">
            {people.length === 0 ? 'Nobody is on the roster yet. "Invite teammate" records the first person.' : 'Nobody of this type is on the roster.'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="roster-list">
            {shown.map((p) => <RosterRow key={p.uid} p={p} capTable={data.cap_table} onOpen={onOpen} />)}
          </ul>
        )}
        <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400" data-testid="roster-footnote">
          {!data.cap_table?.available ? `${data.cap_table?.reason || 'The cap table could not be read.'} `
            : !(data.cap_table.projects || []).length ? 'No project of this company has a cap table, so equity is read from the recorded grants only. '
              : fd ? `${fmtNum(fd)} shares fully diluted across ${data.cap_table.projects.length === 1 ? 'the cap table of ' + data.cap_table.projects[0].name : `${data.cap_table.projects.length} project cap tables`}. `
                : 'The cap table read returned no holders with a share count. '}
          <Link to="/build/captable" className="text-violet-700 underline dark:text-violet-300">Reconcile in Cap Table →</Link>
        </p>
      </Card>

      <Card data-testid="pool-card">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Option pool</h2>
        {!data.pool?.available ? (
          <Unreadable what="The option pool" claim={data.pool?.reason || ''} />
        ) : pa.authorized == null ? (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            <Unrecorded reason="cap_table_option_pools is keyed by the member who imported it from Carta; nobody on this company has imported one.">No option pool is recorded for this company.</Unrecorded>
            {' '}What the roster records: {fmtNum(pa.granted)} option shares granted to active people and {fmtNum(pa.committed)} committed to offers out.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400" data-testid="pool-line">
              {fmtNum(pa.authorized)} shares authorised in {data.pool.rows[0].name} (a member’s Carta import) · {fmtNum(pa.granted)} granted and {fmtNum(pa.committed)} committed to offers out on this roster · {fmtNum(pa.available)} available per the import · reserved for open roles: not recorded.
            </p>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div className="bg-violet-600" style={{ width: `${Math.min(100, (pa.granted / pa.authorized) * 100)}%` }} title="granted" />
              <div className="bg-violet-400" style={{ width: `${Math.min(100, (pa.committed / pa.authorized) * 100)}%` }} title="committed" />
            </div>
          </>
        )}
        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
          A top-up model is not drawn: no modelling surface exists for a pool increase, and inventing a divisor would be a number nobody recorded (Decisions, below).
        </p>
      </Card>
    </div>
  );
}

function RosterRow({ p, capTable, onOpen }) {
  const eq = equityOf(p, capTable);
  const v = vestingOf(p);
  const flag = p.status !== 'offboarded' && (p.ip_assignment === 'missing' ? 'IP assignment missing' : p.election_83b === 'not_filed' ? '83(b) not filed' : null);
  return (
    <li>
      <button type="button" onClick={() => onOpen(p.uid)} data-testid={`roster-row-${p.uid}`}
        className={`grid w-full grid-cols-1 gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 md:grid-cols-[minmax(0,1.6fr)_1fr_1fr_auto] ${flag ? 'border-l-2 border-red-400' : ''}`}>
        <div className="flex items-start gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${p.person_type === 'founder' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{initialsOf(p.name)}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-gray-900 dark:text-gray-100">{p.name}</span>
              <Pill tone={p.person_type === 'founder' ? 'info' : 'neutral'}>{TYPE_LABEL[p.person_type] || p.person_type}</Pill>
              {flag && <Pill tone="danger">{flag}</Pill>}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{p.role_title || <Unrecorded>Role not recorded</Unrecorded>}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {p.start_date ? `${p.status === 'offer_out' ? 'Starts' : 'Started'} ${fmtDate(p.start_date)}` : 'Start date not recorded'}
              {' · '}{p.access_level ? `${p.access_level} access` : 'access not recorded'}
              {p.note ? ` · ${p.note}` : ''}
            </div>
          </div>
        </div>
        <div className="text-sm">
          <div className="text-[11px] uppercase text-gray-500">Equity</div>
          {eq.source === 'unrecorded' ? <Unrecorded>Not recorded</Unrecorded>
            : eq.source === 'none' ? <span className="text-gray-500">No grant</span>
              : (
                <>
                  <div className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{eq.pct != null ? `${eq.pct.toFixed(eq.pct < 1 ? 2 : 1)}%` : 'FD total not recorded'}</div>
                  <div className="text-[11px] text-gray-500">{fmtNum(eq.shares)} {eq.kind || 'shares'} · {eq.source === 'cap_table' ? 'on the cap table' : 'recorded grant, not on the cap table'}</div>
                </>
              )}
        </div>
        <div className="text-sm">
          <div className="text-[11px] uppercase text-gray-500">Vested</div>
          {!v ? <Unrecorded reason="No vesting schedule (start, length) is recorded for this person.">Schedule not recorded</Unrecorded> : (
            <>
              <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800" title={v.note}>
                <div className="absolute inset-y-0 left-0 bg-gray-300 dark:bg-gray-700" style={{ width: `${v.ghost}%` }} data-testid="vest-ghost" />
                <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${v.pct}%` }} data-testid="vest-fill" />
              </div>
              <div className="text-[11px] text-gray-500">{v.note}{!v.cliffRecorded ? ' · cliff not recorded' : ''}</div>
            </>
          )}
        </div>
        <div className="md:text-right"><Pill tone={toneOf(p.status)}>{STATUS_LABEL[p.status] || p.status}</Pill></div>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Advisors.
// ---------------------------------------------------------------------------

function AdvisorsTab({ data, onOpen }) {
  const advisors = (data.people || []).filter((p) => p.person_type === 'advisor' && p.status !== 'offboarded');
  const [showDirectory, setShowDirectory] = useState(false);
  const [hours, setHours] = useState({ phase: 'loading' });
  useEffect(() => {
    let alive = true;
    const from = new Date(); const to = new Date(); to.setDate(to.getDate() + 90);
    api.listCalendarEvents({ from: from.toISOString(), to: to.toISOString(), kinds: 'advisor_booking,partner_office_hour' })
      .then((res) => { if (alive) setHours({ phase: 'ready', rows: Array.isArray(res) ? res : (res?.items || res?.events || []) }); })
      .catch((e) => { if (alive) setHours({ phase: 'failed', error: e }); });
    return () => { alive = false; };
  }, []);
  const advisoryShares = advisors.reduce((a, p) => a + (p.equity_shares != null ? Number(p.equity_shares) : 0), 0);
  const fd = fullyDiluted(data.cap_table);
  return (
    <div className="space-y-4">
      <Card padding="none" data-testid="advisors-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Engaged advisors</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Advisors with an agreement in place. Grants recorded here are not written to the cap table (Decisions, below).</p>
          </div>
          <button type="button" onClick={() => setShowDirectory((v) => !v)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700" data-testid="find-advisor">
            {showDirectory ? 'Hide the directory' : 'Find an advisor'}
          </button>
        </div>
        {advisors.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">No advisor is recorded. "Invite teammate" with the type Advisor records one.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {advisors.map((a) => (
              <li key={a.uid}>
                <button type="button" onClick={() => onOpen(a.uid)} className="grid w-full grid-cols-1 gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 md:grid-cols-[minmax(0,1.6fr)_1fr_1fr_auto]" data-testid={`advisor-row-${a.uid}`}>
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{initialsOf(a.name)}</span>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">{a.name}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">{a.advisor_focus || <Unrecorded>Focus not recorded</Unrecorded>}</div>
                      <div className="text-[11px] text-gray-500">{a.start_date ? `Engaged ${fmtDate(a.start_date)}` : 'Engagement date not recorded'}</div>
                    </div>
                  </div>
                  <div className="text-sm">
                    <div className="text-[11px] uppercase text-gray-500">Grant</div>
                    {a.equity_shares == null ? <Unrecorded>Not recorded</Unrecorded> : (
                      <>
                        <div className="font-semibold tabular-nums">{fd ? `${((Number(a.equity_shares) / fd) * 100).toFixed(2)}%` : `${fmtNum(a.equity_shares)} shares`}</div>
                        <div className="text-[11px] text-gray-500">{fd ? `${fmtNum(a.equity_shares)} shares · ` : ''}{a.vest_months ? `${a.vest_months}-month vest${a.cliff_months == null ? ', cliff not recorded' : a.cliff_months === 0 ? ', no cliff' : `, ${a.cliff_months}-month cliff`}` : 'vesting not recorded'}</div>
                      </>
                    )}
                  </div>
                  <div className="text-sm">
                    <div className="text-[11px] uppercase text-gray-500">Cadence</div>
                    <div>{a.advisor_cadence || <Unrecorded>Not recorded</Unrecorded>}</div>
                  </div>
                  <div className="md:text-right"><Pill tone={toneOf(a.agreement_status)}>{stateLabel(a.agreement_status) || 'Agreement not recorded'}</Pill></div>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
          {advisors.length ? `Advisory grants recorded here total ${fmtNum(advisoryShares)} shares${fd ? ` (${((advisoryShares / fd) * 100).toFixed(2)}% of ${fmtNum(fd)} fully diluted)` : ''}.` : 'No advisory grant is recorded.'}
        </p>
      </Card>

      <Card data-testid="office-hours-card">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Upcoming office hours</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">Booked sessions with advisors and platform partners, from the calendar, next 90 days.</p>
        {hours.phase === 'loading' && <p className="mt-2 text-sm text-gray-500">Loading…</p>}
        {hours.phase === 'failed' && <Unreadable what="The calendar" claim="" />}
        {hours.phase === 'ready' && (hours.rows.length === 0 ? <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No office hours are booked in the next 90 days.</p> : (
          <ul className="mt-2 divide-y divide-gray-100 text-sm dark:divide-gray-800">
            {hours.rows.slice(0, 8).map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-gray-900 dark:text-gray-100">{e.title || 'Untitled session'}</span>
                <span className="text-xs text-gray-500">{e.start_at ? new Date(e.start_at).toLocaleString() : 'time not recorded'} · {e.status || 'status not recorded'}</span>
              </li>
            ))}
          </ul>
        ))}
      </Card>

      {showDirectory && (
        <TierGate tier="growth" label="The advisor directory" blurb="Discover operator-advisors, then book office hours to pressure-test the plan.">
          <Card data-testid="advisor-directory"><AdvisorsPage embedded /></Card>
        </TierGate>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hiring.
// ---------------------------------------------------------------------------

function HiringTab({ data }) {
  const [jobs, reloadJobs] = useJobs();
  const [showJobs, setShowJobs] = useState(false);
  const [showMatch, setShowMatch] = useState(false);
  const cf = data.cofounder;
  const model = cf?.available ? buildDecisionModel({ meta: cf.meta, milestoneKeys: [] }) : null;
  const live = jobs.phase === 'ready' ? jobs.rows.filter((j) => j.status !== 'draft' && j.status !== 'closed') : [];
  const drafts = jobs.phase === 'ready' ? jobs.rows.filter((j) => j.status === 'draft') : [];
  const applicants = jobs.phase === 'ready' ? jobs.rows.reduce((a, j) => a + (Number.isFinite(Number(j.application_count)) ? Number(j.application_count) : 0), 0) : null;
  return (
    <div className="space-y-4">
      <Card padding="none" data-testid="roles-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Open roles</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {jobs.phase === 'ready' ? `${live.length} live, ${drafts.length} draft · ${applicants} applicant${applicants === 1 ? '' : 's'} total` : jobs.phase === 'failed' ? 'The roles could not be read.' : 'Loading…'}
            </p>
          </div>
          <button type="button" onClick={() => setShowJobs((v) => !v)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700" data-testid="manage-roles">
            {showJobs ? 'Hide role management' : '+ New role · manage roles'}
          </button>
        </div>
        {jobs.phase === 'failed' && <div className="px-4 py-3"><Unreadable what="Your roles" claim="" onRetry={reloadJobs} /></div>}
        {jobs.phase === 'ready' && (jobs.rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">No open roles. Coverage gaps suggest what to open next.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {jobs.rows.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <div className="flex items-center gap-2"><span className="font-medium text-gray-900 dark:text-gray-100">{j.title}</span><Pill tone={j.status === 'published' || j.status === 'open' ? 'ok' : j.status === 'draft' ? 'neutral' : 'warn'}>{j.status || 'status not recorded'}</Pill></div>
                  <div className="text-[11px] text-gray-500">
                    {j.employment_type || 'type not recorded'} · {j.location_text || (j.remote ? 'Remote' : 'location not recorded')} · {j.project_name ? `${j.project_name} · ` : ''}compensation and equity reservation: not recorded on the posting
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="tabular-nums text-gray-600 dark:text-gray-300">{fmtNum(j.application_count) ?? 'applicants not recorded'} applied</span>
                  <Link to={`/grow/talent${j.project_id ? `?project_id=${j.project_id}` : ''}`} className="text-violet-700 underline dark:text-violet-300">Review applicants</Link>
                </div>
              </li>
            ))}
          </ul>
        ))}
        {showJobs && <div className="border-t border-gray-200 p-4 dark:border-gray-800" data-testid="jobs-embedded"><MyJobsPage embedded /></div>}
      </Card>

      <IncomingLeadsStrip audience="cofounder" sectionLabel="INBOUND LEADS · BRAND & PAGES" title="New co-founder leads" blurb="People who reached out about co-founding via your landing pages. Talent leads from a careers page have no audience yet (Decisions, below)." />

      <Card data-testid="cofounder-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Co-founder search</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">The Week-3 decision recorded on the company’s project in Co-founder Match.</p>
          </div>
          <button type="button" onClick={() => setShowMatch((v) => !v)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700" data-testid="open-cofounder-match">
            {showMatch ? 'Hide Co-founder Match' : 'Open Co-founder Match'}
          </button>
        </div>
        <div className="mt-3 text-sm" data-testid="cofounder-decision">
          {!cf?.available ? <Unrecorded reason={cf?.reason}>{cf?.reason || 'No decision is recorded.'}</Unrecorded> : (
            <>
              <div className="text-[11px] uppercase text-gray-500">Decision · {cf.project_name}</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{model?.outcome ? (DECISION_OUTCOMES.find((o) => o.value === model.outcome)?.label || model.outcome) : <Unrecorded>Outcome not recorded</Unrecorded>}</div>
              {model?.note && <p className="mt-1 text-gray-600 dark:text-gray-400">{model.note}</p>}
              <div className="mt-1 text-[11px] text-gray-500">{model?.decidedAt ? `Documented ${fmtDate(model.decidedAt)}` : 'Decision date not recorded'}</div>
            </>
          )}
        </div>
        {showMatch && (
          <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
            <TierGate tier="studio" label="Co-founder Match" blurb="Match with a complementary co-founder — identities stay private until interest is mutual.">
              <div data-testid="cofounder-embedded"><CofounderPage embedded /></div>
            </TierGate>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coverage: functions, headcount plan, people cost.
// ---------------------------------------------------------------------------

function CoverageTab({ data, company, flash, onSaved }) {
  const editor = !!data.viewer?.editor;
  const [rows, setRows] = useState(() => (data.coverage || []).map((c) => ({ ...c })));
  const [plan, setPlan] = useState(() => (data.plan || []).map((c) => ({ ...c })));
  const [busy, setBusy] = useState(false);
  const active = (data.people || []).filter((p) => p.status === 'active').length;
  const cost = peopleCost(data.people);
  const gaps = rows.filter((c) => c.state === 'gap').length;
  const thin = rows.filter((c) => c.state === 'thin').length;

  const saveCoverage = async () => {
    setBusy(true);
    try { await api.saveCompanyCoverage(company.uid, rows.map(({ function_name, state, owner_note, fix_note }) => ({ function_name, state, owner_note, fix_note }))); flash({ kind: 'ok', msg: 'Coverage saved.' }); onSaved(); }
    catch (e) { flash({ kind: 'error', msg: e?.message || 'Coverage could not be saved.' }); }
    finally { setBusy(false); }
  };
  const savePlan = async () => {
    setBusy(true);
    try { await api.saveCompanyHeadcountPlan(company.uid, plan.map(({ period_label, target_headcount, note }) => ({ period_label, target_headcount: Number(target_headcount), note }))); flash({ kind: 'ok', msg: 'Headcount plan saved.' }); onSaved(); }
    catch (e) { flash({ kind: 'error', msg: e?.message || 'The plan could not be saved.' }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card data-testid="coverage-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Function coverage</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {rows.length ? `${gaps} ${gaps === 1 ? 'function has' : 'functions have'} no owner and ${thin} ${thin === 1 ? 'is' : 'are'} thin. Gaps drive both the hiring plan and which advisors to recruit.` : 'No coverage is recorded yet.'}
            </p>
          </div>
          {editor && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setRows((r) => [...r, { function_name: '', state: 'gap', owner_note: '', fix_note: '' }])} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700">+ Function</button>
              <button type="button" disabled={busy} onClick={saveCoverage} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" data-testid="save-coverage">Save coverage</button>
            </div>
          )}
        </div>
        {rows.length > 0 && (
          <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((c, i) => (
              <li key={c.uid || `new-${i}`} className="grid grid-cols-1 gap-2 py-2 md:grid-cols-[1fr_120px_1.4fr_1.4fr_auto]">
                {editor ? <input value={c.function_name} onChange={(e) => setRows((r) => r.map((x, k) => (k === i ? { ...x, function_name: e.target.value } : x)))} placeholder="Function" className={inputCls} /> : <span className="text-sm font-medium">{c.function_name}</span>}
                {editor ? <Select value={c.state} allowEmpty={false} options={COVERAGE_STATES} onChange={(v) => setRows((r) => r.map((x, k) => (k === i ? { ...x, state: v } : x)))} /> : <Pill tone={toneOf(c.state)}>{stateLabel(c.state)}</Pill>}
                {editor ? <input value={c.owner_note || ''} onChange={(e) => setRows((r) => r.map((x, k) => (k === i ? { ...x, owner_note: e.target.value } : x)))} placeholder="Who holds it" className={inputCls} /> : <span className="text-sm text-gray-700 dark:text-gray-300">{c.owner_note || <Unrecorded>Owner not recorded</Unrecorded>}</span>}
                {editor ? <input value={c.fix_note || ''} onChange={(e) => setRows((r) => r.map((x, k) => (k === i ? { ...x, fix_note: e.target.value } : x)))} placeholder="What would fix it" className={inputCls} /> : <span className="text-sm text-gray-600 dark:text-gray-400">{c.fix_note || ''}</span>}
                {editor && <button type="button" onClick={() => setRows((r) => r.filter((_, k) => k !== i))} className="text-xs text-gray-500 hover:text-red-600" aria-label="Remove function"><X size={14} /></button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card data-testid="plan-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Headcount plan</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Targets recorded here; actuals are this roster’s active count ({active}).</p>
            </div>
            {editor && (
              <div className="flex gap-2">
                <button type="button" onClick={() => setPlan((r) => [...r, { period_label: '', target_headcount: '', note: '' }])} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700">+ Period</button>
                <button type="button" disabled={busy} onClick={savePlan} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" data-testid="save-plan">Save plan</button>
              </div>
            )}
          </div>
          {plan.length === 0 ? <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No period is planned yet.</p> : (
            <ul className="mt-3 space-y-2">
              {plan.map((q, i) => {
                const target = Number(q.target_headcount);
                const pct = Number.isFinite(target) && target > 0 ? Math.min(100, Math.round((active / target) * 100)) : 0;
                const behind = Number.isFinite(target) ? target - active : null;
                return (
                  <li key={q.uid || `new-${i}`} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      {editor ? <input value={q.period_label} onChange={(e) => setPlan((r) => r.map((x, k) => (k === i ? { ...x, period_label: e.target.value } : x)))} placeholder="Period" className={`${inputCls} max-w-[180px]`} /> : <span className="font-medium">{q.period_label}</span>}
                      {editor ? <input value={q.target_headcount} onChange={(e) => setPlan((r) => r.map((x, k) => (k === i ? { ...x, target_headcount: e.target.value } : x)))} inputMode="numeric" placeholder="Target" className={`${inputCls} max-w-[90px]`} /> : null}
                      <span className="text-xs text-gray-500">{Number.isFinite(target) ? `${active} of ${target}${behind > 0 ? ` · ${behind} to hire` : ' · on plan'}` : 'target not recorded'}</span>
                      {editor && <button type="button" onClick={() => setPlan((r) => r.filter((_, k) => k !== i))} className="text-xs text-gray-500 hover:text-red-600" aria-label="Remove period"><X size={14} /></button>}
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"><div className={`h-full ${behind != null && behind <= 0 ? 'bg-emerald-500' : 'bg-violet-400'}`} style={{ width: `${pct}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card data-testid="cost-card">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">People cost</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Salaries and contractors from the recorded annual figures, per month.</p>
          {cost.locked ? (
            <p className="mt-3 text-sm"><Locked>Locked · compensation is visible to the person and to editors of this company.</Locked></p>
          ) : (
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt>Salaries ({cost.employees.count} {cost.employees.count === 1 ? 'employee' : 'employees'})</dt><dd className="tabular-nums">{centsToDollars(cost.employees.monthlyCents)}</dd></div>
              <div className="flex justify-between"><dt>Contractors ({cost.contractors.count})</dt><dd className="tabular-nums">{centsToDollars(cost.contractors.monthlyCents)}</dd></div>
              <div className="flex justify-between"><dt>Founders ({cost.founders.count})</dt><dd className="tabular-nums">{centsToDollars(cost.founders.monthlyCents)}</dd></div>
              <div className="flex justify-between"><dt>Payroll load &amp; benefits</dt><dd><Unrecorded reason="No payroll-load rate is stored; the canvas's 11% is a fixture, not a fact about this company.">Not recorded</Unrecorded></dd></div>
              <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold dark:border-gray-800"><dt>Total monthly people cost</dt><dd className="tabular-nums" data-testid="cost-total">{centsToDollars(cost.totalMonthlyCents)}{cost.unknown ? ` + ${cost.unknown} not recorded` : ''}</dd></div>
            </dl>
          )}
          <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
            {!cost.locked && cost.deferring ? `${cost.deferring} founder${cost.deferring === 1 ? ' defers' : 's defer'} salary (recorded as $0). ` : ''}
            The plan for use of funds lives on the project (<Link to="/raise" className="underline">Raise</Link>); nothing here rewrites it.
          </p>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Person drawer: the record, its economics (locked or not), paperwork, and
// the two writes — edit and offboard.
// ---------------------------------------------------------------------------

function PersonDrawer({ person: p, data, company, onClose, onChanged, flash }) {
  const editor = !!data.viewer?.editor;
  const [editing, setEditing] = useState(false);
  const [offboarding, setOffboarding] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!p) return null;
  const eq = equityOf(p, data.cap_table);
  const v = vestingOf(p);
  const hasEconomics = Object.prototype.hasOwnProperty.call(p, 'salary_cents');

  const offboard = async () => {
    setBusy(true);
    try {
      const row = await api.updateCompanyPerson(company.uid, p.uid, { status: 'offboarded' });
      onChanged(row); setOffboarding(false); flash({ kind: 'ok', msg: `${p.name} is offboarded. The record stays.` });
    } catch (e) { flash({ kind: 'error', msg: e?.message || 'Offboarding failed.' }); }
    finally { setBusy(false); }
  };

  const docRow = (label, status, meta) => (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800">
      <div><div className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</div><div className="text-[11px] text-gray-500">{meta}</div></div>
      <Pill tone={toneOf(status)}>{stateLabel(status) || 'Not recorded'}</Pill>
    </li>
  );

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose} data-testid="person-drawer">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">{initialsOf(p.name)}</span>
            <div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">{p.name}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">{p.role_title || 'Role not recorded'} · {TYPE_LABEL[p.person_type]}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><X size={18} /></button>
        </div>

        {editing ? (
          <PersonForm initial={p} company={company} pool={data.pool} people={data.people} onCancel={() => setEditing(false)}
            onSaved={(row) => { onChanged(row); setEditing(false); flash({ kind: 'ok', msg: 'Record saved.' }); }} flash={flash} />
        ) : (
          <>
            <section className="mt-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Employment</h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-gray-500">Type</dt><dd>{TYPE_LABEL[p.person_type]}</dd>
                <dt className="text-gray-500">Status</dt><dd><Pill tone={toneOf(p.status)}>{STATUS_LABEL[p.status]}</Pill>{p.offboarded_at ? <span className="ml-2 text-xs text-gray-500">{fmtDate(p.offboarded_at)}</span> : null}</dd>
                <dt className="text-gray-500">Start date</dt><dd>{fmtDate(p.start_date) || <Unrecorded>Not recorded</Unrecorded>}</dd>
                <dt className="text-gray-500">Access level</dt><dd>{p.access_level || <Unrecorded>Not recorded</Unrecorded>}</dd>
                <dt className="text-gray-500">Compensation</dt>
                <dd data-testid="drawer-compensation">{!hasEconomics ? <Locked /> : p.salary_cents == null ? <Unrecorded>Not recorded</Unrecorded> : `${centsToDollars(p.salary_cents)}/yr`}{hasEconomics && p.compensation_note ? <span className="block text-xs text-gray-500">{p.compensation_note}</span> : null}</dd>
                <dt className="text-gray-500">Workspace account</dt><dd>{p.user_id ? `Linked (account #${p.user_id})` : 'Not linked to a member of this company'}</dd>
                <dt className="text-gray-500">Note</dt><dd>{p.note || <Unrecorded>None</Unrecorded>}</dd>
              </dl>
            </section>

            <section className="mt-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Equity &amp; vesting</h3>
              <div className="mt-2 text-sm">
                {eq.source === 'unrecorded' ? <Unrecorded>No grant is recorded</Unrecorded>
                  : eq.source === 'none' ? 'No grant (recorded as none).'
                    : <>{eq.pct != null ? `${eq.pct.toFixed(2)}% · ` : ''}{fmtNum(eq.shares)} {eq.kind || 'shares'} · {eq.source === 'cap_table' ? 'from the cap table' : 'the recorded grant; not on the cap table'}</>}
              </div>
              <div className="mt-1 text-xs text-gray-500">{v ? `${v.note}${!v.cliffRecorded ? ' · cliff not recorded' : ''} · ${p.vest_months}-month schedule from ${fmtDate(p.vest_start_date)}` : 'Vesting schedule not recorded.'}</div>
            </section>

            <section className="mt-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Paperwork</h3>
              <ul className="mt-2 space-y-2">
                {docRow(p.person_type === 'founder' ? 'Founder agreement' : p.person_type === 'advisor' ? 'Advisory agreement' : p.person_type === 'contractor' ? 'Contractor agreement' : 'Employment agreement', p.agreement_status,
                  p.agreement_status === 'signed' ? 'Recorded as executed' : p.agreement_status === 'sent' ? 'Recorded as sent, awaiting signature' : 'State as recorded on this roster')}
                {docRow('IP assignment', p.ip_assignment, p.ip_assignment === 'missing' ? 'Work product is not assigned — diligence blocker' : 'State as recorded on this roster')}
                {docRow('83(b) election', p.election_83b, p.election_83b === 'not_filed' ? 'Not filed — see Trust Center for the filing window' : p.election_83b === 'not_applicable' ? 'Options, not restricted stock — no election needed' : 'State as recorded on this roster')}
              </ul>
              <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400" data-testid="send-document-note">
                Send document: not available from here. No flow issues an offer, IP assignment or advisory agreement from the Team page; the states above are what the company recorded (Decisions, on the page).
              </p>
            </section>

            {editor && (
              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700" data-testid="edit-record">Edit record</button>
                {p.status !== 'offboarded' && (
                  <button type="button" onClick={() => setOffboarding((x) => !x)} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 dark:border-red-800 dark:text-red-300" data-testid="offboard">Offboard</button>
                )}
              </div>
            )}
            {offboarding && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-900/20" data-testid="offboard-confirm">
                <p className="font-medium text-red-800 dark:text-red-200">Offboard {p.name} from {company.company_name}?</p>
                <p className="mt-1 text-red-700 dark:text-red-300">
                  The record stays with today’s date as the offboarding date; their equity and paperwork rows are unchanged. Workspace access is separate: if they hold a membership, remove it in Company Settings.
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={offboard} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Yes, offboard</button>
                  <button type="button" onClick={() => setOffboarding(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700">Keep them</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms: create (invite drawer) and edit share one body.
// ---------------------------------------------------------------------------

function toForm(p) {
  return {
    name: p?.name || '', email: p?.email || '', person_type: p?.person_type || 'employee', role_title: p?.role_title || '',
    start_date: p?.start_date || '', access_level: p?.access_level || null, status: p?.status || 'active',
    salary: p?.salary_cents == null ? '' : String(p.salary_cents / 100), compensation_note: p?.compensation_note || '',
    equity_shares: p?.equity_shares == null ? '' : String(p.equity_shares), equity_kind: p?.equity_kind || null,
    vest_start_date: p?.vest_start_date || '', cliff_months: p?.cliff_months == null ? '' : String(p.cliff_months), vest_months: p?.vest_months == null ? '' : String(p.vest_months),
    agreement_status: p?.agreement_status || null, ip_assignment: p?.ip_assignment || null, election_83b: p?.election_83b || null,
    advisor_focus: p?.advisor_focus || '', advisor_cadence: p?.advisor_cadence || '', note: p?.note || '',
  };
}

export function formToPayload(f) {
  const cents = dollarsToCents(f.salary);
  return {
    name: f.name, email: f.email || null, person_type: f.person_type, role_title: f.role_title || null,
    start_date: f.start_date || null, access_level: f.access_level, status: f.status,
    salary_cents: cents === undefined ? null : cents, compensation_note: f.compensation_note || null,
    equity_shares: f.equity_shares === '' ? null : Number(f.equity_shares), equity_kind: f.equity_kind,
    vest_start_date: f.vest_start_date || null,
    cliff_months: f.cliff_months === '' ? null : Number(f.cliff_months), vest_months: f.vest_months === '' ? null : Number(f.vest_months),
    agreement_status: f.agreement_status, ip_assignment: f.ip_assignment, election_83b: f.election_83b,
    advisor_focus: f.advisor_focus || null, advisor_cadence: f.advisor_cadence || null, note: f.note || null,
  };
}

function PersonForm({ initial, company, onCancel, onSaved, flash, create = false, sendInvite, setSendInvite }) {
  const [f, setF] = useState(() => toForm(initial));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v && v.target ? v.target.value : v }));
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!f.name.trim()) { setErr('A name is required.'); return; }
    if (dollarsToCents(f.salary) === undefined) { setErr('Base salary must be a dollar amount.'); return; }
    setBusy(true);
    try {
      const payload = formToPayload(f);
      const row = create ? await api.addCompanyPerson(company.uid, payload) : await api.updateCompanyPerson(company.uid, initial.uid, payload);
      onSaved(row, payload);
    } catch (e2) { setErr(e2?.message || 'Could not save.'); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="mt-4 space-y-3" data-testid={create ? 'invite-form' : 'edit-form'}>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300" role="alert">{err}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Full name"><input value={f.name} onChange={set('name')} className={inputCls} required /></Field>
        <Field label="Work email" hint="Matched to a member of this company when one holds it."><input type="email" value={f.email} onChange={set('email')} className={inputCls} /></Field>
      </div>
      <Field label="Type">
        <div className="flex flex-wrap gap-1.5">
          {PERSON_TYPES.map((t) => (
            <button key={t} type="button" onClick={() => setF((x) => ({ ...x, person_type: t }))}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${f.person_type === t ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300 dark:border-gray-700'}`}>{TYPE_LABEL[t]}</button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role title"><input value={f.role_title} onChange={set('role_title')} className={inputCls} /></Field>
        <Field label="Start date"><input type="date" value={f.start_date} onChange={set('start_date')} className={inputCls} /></Field>
        <Field label="Access level"><Select value={f.access_level} options={ACCESS_LEVELS} onChange={set('access_level')} /></Field>
        <Field label="Status"><Select value={f.status} allowEmpty={false} options={['active', 'offer_out', 'offboarded']} onChange={set('status')} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Base salary (per year, USD)" hint="Stored as integer cents. Leave blank for not recorded; 0 records a deferred salary."><input value={f.salary} onChange={set('salary')} inputMode="decimal" className={inputCls} placeholder="145000" /></Field>
        <Field label="Compensation note"><input value={f.compensation_note} onChange={set('compensation_note')} className={inputCls} placeholder="Deferred until first close" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Grant (shares)"><input value={f.equity_shares} onChange={set('equity_shares')} inputMode="decimal" className={inputCls} /></Field>
        <Field label="Grant kind"><Select value={f.equity_kind} options={EQUITY_KINDS} onChange={set('equity_kind')} /></Field>
        <Field label="Vesting starts"><input type="date" value={f.vest_start_date} onChange={set('vest_start_date')} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Cliff (months)"><input value={f.cliff_months} onChange={set('cliff_months')} inputMode="numeric" className={inputCls} /></Field>
          <Field label="Length (months)"><input value={f.vest_months} onChange={set('vest_months')} inputMode="numeric" className={inputCls} /></Field>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Agreement"><Select value={f.agreement_status} options={AGREEMENT_STATES} onChange={set('agreement_status')} /></Field>
        <Field label="IP assignment"><Select value={f.ip_assignment} options={IP_STATES} onChange={set('ip_assignment')} /></Field>
        <Field label="83(b) election"><Select value={f.election_83b} options={ELECTION_STATES} onChange={set('election_83b')} /></Field>
      </div>
      {f.person_type === 'advisor' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Advisor focus"><input value={f.advisor_focus} onChange={set('advisor_focus')} className={inputCls} placeholder="GTM & enterprise sales" /></Field>
          <Field label="Cadence"><input value={f.advisor_cadence} onChange={set('advisor_cadence')} className={inputCls} placeholder="Monthly, 60 min" /></Field>
        </div>
      )}
      <Field label="Note"><input value={f.note} onChange={set('note')} className={inputCls} /></Field>
      {create && (
        <label className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={!!sendInvite} onChange={(e) => setSendInvite(e.target.checked)} disabled={!f.email} className="mt-0.5" data-testid="send-invite" />
          <span>Also invite this email to the {company.company_name} workspace (the invitation from Company Settings; they accept a link, nobody is joined without asking).</span>
        </label>
      )}
      <p className="text-[11px] text-gray-500 dark:text-gray-400" data-testid="invite-note">
        {f.person_type === 'employee' ? 'Records the person and the grant as stated. No offer letter, IP assignment or option paperwork is issued from here, and the pool is not drawn down — the cap table is the record of that.'
          : f.person_type === 'contractor' ? 'Records the person. No contractor agreement is issued from here; record its state above once it is signed.'
            : f.person_type === 'founder' ? 'Records the person. Restricted stock, the co-founder agreement and the 83(b) election are handled in the Legal engine and Trust Center; their states are recorded above.'
              : 'Records the advisor and the grant as stated. No advisory agreement is issued from here, and the grant is not written to the cap table.'}
      </p>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" data-testid="submit-person">{create ? 'Record' : 'Save'}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700">Cancel</button>
      </div>
    </form>
  );
}

function InviteDrawer({ company, onClose, onCreated, flash }) {
  const [sendInvite, setSendInvite] = useState(false);
  const onSaved = async (row, payload) => {
    if (sendInvite && payload.email) {
      try {
        await api.inviteCompanyMember(company.uid, { email: payload.email, role_in_company: 'Member' });
        flash({ kind: 'ok', msg: `${row.name} recorded and invited to the workspace.` });
      } catch (e) {
        flash({ kind: 'error', msg: `${row.name} is recorded, but the workspace invitation failed: ${e?.message || 'unknown error'}.` });
      }
    } else {
      flash({ kind: 'ok', msg: `${row.name} recorded.` });
    }
    onCreated();
  };
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose} data-testid="invite-drawer">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Invite teammate</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400">Records them on {company.company_name}’s roster, and optionally invites their email to the workspace.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><X size={18} /></button>
        </div>
        <PersonForm initial={null} company={company} create sendInvite={sendInvite} setSendInvite={setSendInvite} onCancel={onClose} onSaved={onSaved} flash={flash} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The decision line, on screen.
// ---------------------------------------------------------------------------

export const OPEN_DECISIONS = [
  ['Cap table of record', 'A company can own several projects, each with its own imported cap table. This page reads every holder across them; which one is the company’s cap table is the owner’s call.'],
  ['Option pool', 'The pool shown is a member’s Carta import (keyed per account, migration 057). Whether the company gets a pool of its own, and a top-up model, is the owner’s call; no divisor is invented meanwhile.'],
  ['Paperwork issuance', 'This page records the state of the agreement, IP assignment and 83(b) election. Issuing them from here — offer letter, contractor agreement, advisory agreement — needs the contract flow the owner chooses; "Send document" is not drawn as live.'],
  ['Payroll load', 'No payroll-load or benefits rate is stored, so people cost is salaries and contractors only, and says so.'],
  ['Talent leads', 'Landing-page leads route by audience, and only the co-founder audience reaches this page; a careers audience is a product decision.'],
  ['Advisory grants and the cap table', 'An advisor’s grant is recorded here and not written to cap_table_holders; whether the roster writes the cap table or the cap table is imported only is the owner’s call.'],
];

function DecisionsPanel() {
  return (
    <Card variant="dashed" data-testid="decisions-panel">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Built up to the owner’s decision line</h2>
      <ul className="mt-2 space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
        {OPEN_DECISIONS.map(([what, why]) => <li key={what}><span className="font-medium text-gray-800 dark:text-gray-200">{what}.</span> {why}</li>)}
      </ul>
    </Card>
  );
}
