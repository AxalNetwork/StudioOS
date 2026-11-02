import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Card } from '../../../ui';
import AdminPageHeader, { HeaderTab } from '../../../ui/AdminPageHeader';
import { teamAgentsApi } from '../../../lib/api/teamAgents';
import {
  AUDIT_COLUMNS, BUILD, CAPS, COMPANY_COLUMNS, GUARDRAILS, NOT_RECORDED, PAUSED_BANNER, PAUSE_WORD, REASON_MIN,
  ROSTER_COLUMNS, RUN_COLUMNS, SUBTITLE, AREAS, areaTiles, notYet, overviewTiles, pauseArmed, skillRow, viewFor,
} from './aiAgentsModel';

/**
 * D4137 (#4137) — HQ › AI agents, the super admin control panel (SA0–SA9).
 *
 * Super Admin only (`hqOnly` in App.jsx; every route H1–H5 adds re-checks with
 * `requireSuperAdmin`). Four tabs at their own addresses: Overview, Roster,
 * Skills library (From Axal · Company skills) and Operations (Runs · Spend ·
 * Policies · Audit).
 *
 * ONE READ IS LIVE: `GET /api/teams/skills`, D1612's library, whose `hq` list
 * is the "From Axal" skills. Everything else waits for its build task (#4158,
 * #4160–#4163); each board says so and names the issue, and no control is
 * drawn enabled that the Worker would only refuse. When a task lands, its
 * builder flips `BUILD[key].live` in the model and wires the read.
 */

const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const EYEBROW = 'font-mono text-[10.5px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const H2 = 'text-[14px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100';
const BTN = 'rounded-lg border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200';
const TONE = {
  draft: 'bg-axal-ground text-axal-ink border-axal-hairline dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700',
  review: 'bg-axal-lavender text-axal-violet-deep border-axal-violet/25 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  muted: 'bg-transparent text-axal-muted border-axal-hairline dark:text-gray-400 dark:border-gray-700',
};

function Chip({ tone = 'muted', children }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${TONE[tone] ?? TONE.muted}`}>{children}</span>;
}

/** A board whose build task has not landed: what it will hold, and the issue. */
function NotYet({ build, children, testId }) {
  const b = BUILD[build];
  return (
    <Card className="space-y-2 px-4 py-4" data-testid={testId ?? `ai-agents-not-yet-${build}`}>
      <p role="status" className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">
        {notYet(build)}{' '}
        <a className="text-axal-violet underline dark:text-violet-300" href={`https://github.com/AxalNetwork/StudioOS/issues/${b.issue}`} target="_blank" rel="noreferrer">#{b.issue}</a>
      </p>
      {children}
    </Card>
  );
}

/** A table head and one row saying why it is empty — never a row of zeros. */
function EmptyTable({ columns, line, testId }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[12.5px]" data-testid={testId}>
        <thead className={EYEBROW}><tr className="text-left">{columns.map((c) => <th key={c} className="py-1.5 pr-3">{c}</th>)}</tr></thead>
        <tbody><tr><td colSpan={columns.length} className="py-6 text-center text-axal-muted dark:text-gray-400">{line}</td></tr></tbody>
      </table>
    </div>
  );
}

// ─── SA0 · Overview ─────────────────────────────────────────────────────────

function Overview({ skills }) {
  const tiles = overviewTiles({ hqSkills: skills.status === 'ready' ? skills.hq : null });
  return (
    <div className="space-y-4" data-testid="ai-agents-overview">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.key} className="px-4 py-3.5" data-testid={`ai-agents-kpi-${t.key}`}>
            <p className={EYEBROW}>{t.label}</p>
            <p className={`mt-1 font-mono tabular-nums ${t.value === NOT_RECORDED ? 'text-[15px] font-semibold text-axal-muted dark:text-gray-400' : 'text-[24px] font-extrabold text-axal-ink dark:text-gray-100'}`}>{t.value}</p>
            <p className="mt-1 text-[11.5px] text-axal-muted dark:text-gray-400">{t.note}</p>
          </Card>
        ))}
      </div>
      <NotYet build="H5" testId="ai-agents-needs-attention">
        <h2 className={H2}>Needs attention</h2>
        <p className={MUTED}>Agents paused at their cap, skills failing golden cases, imports waiting for review, model errors and flagged company skills will be listed here.</p>
      </NotYet>
      <NotYet build="H5" testId="ai-agents-spend-by-area">
        <h2 className={H2}>Spend by area · 30 days</h2>
        <ul className="grid gap-1 sm:grid-cols-2">
          {AREAS.map((a) => <li key={a.slug} className="flex justify-between text-[12.5px]"><span className="text-axal-ink dark:text-gray-200">{a.label}</span><span className="text-axal-muted dark:text-gray-400">{NOT_RECORDED}</span></li>)}
        </ul>
      </NotYet>
    </div>
  );
}

// ─── SA1 / SA2 · Roster ─────────────────────────────────────────────────────

function Roster({ view }) {
  if (view.sub === 'agent') {
    return (
      <div className="space-y-3" data-testid="ai-agents-agent-detail">
        <Link to="/hq/ai-agents/roster" className="text-[12.5px] font-semibold text-axal-violet dark:text-violet-300">‹ Roster</Link>
        <NotYet build="H1">
          <h2 className={H2}>{view.agent}</h2>
          <p className={MUTED}>The card teams see, then Identity (name, tagline, story, goal, avatar), Defaults for teams (model, starting cap, maximum cap), Usage and History. Values are fixed and part of who the agent is: they are shown, never edited. A name change needs a trademark check and a reason.</p>
        </NotYet>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="ai-agents-roster">
      <NotYet build="H1">
        <p className={MUTED}>The 16 agents come from the persona catalogue (#4117). Hide from the gallery and Retire each ask for a reason; teams already using an agent keep it until it is retired.</p>
        <EmptyTable columns={ROSTER_COLUMNS} line="The roster is read when #4158 lands." testId="ai-agents-roster-table" />
      </NotYet>
    </div>
  );
}

// ─── SA3 / SA4 / SA5 · Skills library ───────────────────────────────────────

function SubTabs({ view }) {
  if (view.tab === 'skills') {
    return (
      <nav aria-label="Skills library" className="flex gap-5 border-b border-axal-hairline dark:border-gray-800" data-testid="ai-agents-subtabs">
        <HeaderTab to="/hq/ai-agents/skills" end data-testid="ai-agents-sub-axal">From Axal</HeaderTab>
        <HeaderTab to="/hq/ai-agents/skills/companies" end data-testid="ai-agents-sub-companies">Company skills</HeaderTab>
      </nav>
    );
  }
  if (view.tab === 'operations') {
    return (
      <nav aria-label="Operations" className="flex gap-5 border-b border-axal-hairline dark:border-gray-800" data-testid="ai-agents-subtabs">
        <HeaderTab to="/hq/ai-agents/operations" end data-testid="ai-agents-sub-runs">Runs</HeaderTab>
        <HeaderTab to="/hq/ai-agents/operations/spend" end data-testid="ai-agents-sub-spend">Spend</HeaderTab>
        <HeaderTab to="/hq/ai-agents/operations/policies" end data-testid="ai-agents-sub-policies">Policies</HeaderTab>
        <HeaderTab to="/hq/ai-agents/operations/audit" end data-testid="ai-agents-sub-audit">Audit</HeaderTab>
      </nav>
    );
  }
  return null;
}

function Unreadable({ onRetry, what }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-red-700 dark:text-red-300" data-testid="ai-agents-unreadable">
      <span><strong>Could not be read.</strong> {what} could not be read just now. That is not the same as having none.</span>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline"><RefreshCw size={12} aria-hidden="true" /> Try again</button>
    </p>
  );
}

function FromAxal({ skills, onRetry }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => (skills.hq ?? []).map(skillRow).filter((r) => !q || `${r.name} ${r.slug ?? ''}`.toLowerCase().includes(q.toLowerCase())), [skills.hq, q]);
  if (skills.status === 'loading') return <p role="status" className={MUTED}>Reading the library…</p>;
  if (skills.status === 'unreadable') return <Unreadable onRetry={onRetry} what="The From Axal skills" />;
  const tiles = areaTiles(skills.hq);
  return (
    <div className="space-y-3" data-testid="ai-agents-skills">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="ai-agents-area-tiles">
        {tiles.map((t) => (
          <Card key={t.slug} className="px-3.5 py-3"><p className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{t.label}</p><p className="text-[11.5px] text-axal-muted dark:text-gray-400">{t.line}</p></Card>
        ))}
      </div>
      <Card className="space-y-2 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills" aria-label="Search skills"
            className="h-9 min-w-[220px] flex-1 rounded-lg border border-axal-hairline bg-white px-3 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
          <button type="button" disabled className={BTN} title={notYet('H2')}>Publish…</button>
          <button type="button" disabled className={BTN} title={notYet('H2')}>Re-run evals</button>
          <button type="button" disabled className={BTN} title={notYet('H2')}>Retire…</button>
        </div>
        <p className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="ai-agents-bulk-not-yet">Bulk actions, review and golden cases: {notYet('H2')}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12.5px]" data-testid="ai-agents-skill-table">
            <thead className={EYEBROW}><tr className="text-left">{['Skill', 'Area · level', 'Version · status', 'Agents', 'Tools', 'Golden cases', 'Last eval'].map((h) => <th key={h} className="py-1.5 pr-3">{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="py-6 text-center text-axal-muted dark:text-gray-400">{q ? 'No skill matches.' : 'No From Axal skill yet.'}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.uid} className="border-t border-axal-hairline/60 align-top dark:border-gray-800" data-testid="ai-agents-skill-row">
                  <td className="py-2 pr-3"><Link to={`/hq/ai-agents/skills/${encodeURIComponent(r.uid)}/edit`} className="font-semibold text-axal-ink hover:underline dark:text-gray-100">{r.name}</Link>{r.slug ? <div className="font-mono text-[11px] text-axal-muted dark:text-gray-500">{r.slug}</div> : null}</td>
                  <td className="py-2 pr-3 text-axal-ink dark:text-gray-200">{r.area} · {r.level}</td>
                  <td className="py-2 pr-3"><span className="mr-1.5 font-mono">{r.version}</span><Chip tone={r.status.tone}>{r.status.label}</Chip></td>
                  <td className="py-2 pr-3 font-mono tabular-nums">{r.agents}</td>
                  <td className="py-2 pr-3 text-axal-muted dark:text-gray-400">{r.tools.length ? r.tools.join(' · ') : 'No tools'}</td>
                  <td className="py-2 pr-3 text-axal-muted dark:text-gray-400">{r.golden}</td>
                  <td className="py-2 pr-3 text-axal-muted dark:text-gray-400">{r.lastEval}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Editor({ view, skills }) {
  const card = (skills.hq ?? []).find((s) => s.uid === view.skill) ?? null;
  const row = card ? skillRow(card) : null;
  return (
    <div className="space-y-3" data-testid="ai-agents-skill-editor">
      <Link to="/hq/ai-agents/skills" className="text-[12.5px] font-semibold text-axal-violet dark:text-violet-300">‹ From Axal</Link>
      {row ? (
        <Card className="space-y-1 px-4 py-4">
          <h2 className={H2}>{row.name}</h2>
          <p className={MUTED}>{row.area} · {row.level} · {row.version} · <Chip tone={row.status.tone}>{row.status.label}</Chip></p>
          {card.purpose ? <p className="text-[13px] text-axal-ink dark:text-gray-200">{card.purpose}</p> : null}
          {Array.isArray(card.steps) && card.steps.length ? (
            <ol className="list-decimal space-y-1 pl-5 text-[12.5px] text-axal-ink dark:text-gray-200">{card.steps.map((s, i) => <li key={i}>{typeof s === 'string' ? s : s.text}</li>)}</ol>
          ) : null}
        </Card>
      ) : skills.status === 'ready' ? <p className={MUTED}>This skill is not in the From Axal library.</p> : null}
      <NotYet build="H2">
        <p className={MUTED}>The editor with the live card preview, golden cases per model, the review by a second admin (you cannot approve your own changes) and Publish as the next version. A write-capable tool is refused with its reason.</p>
      </NotYet>
    </div>
  );
}

function CompanySkills() {
  return (
    <div className="space-y-3" data-testid="ai-agents-company-skills">
      <NotYet build="H3">
        <p className={MUTED}>Skills companies wrote or imported. HQ reads, flags or suspends with a reason, and the company is told. HQ never edits a company’s skill.</p>
        <EmptyTable columns={COMPANY_COLUMNS} line="The queue is read when #4161 lands." testId="ai-agents-company-table" />
      </NotYet>
    </div>
  );
}

// ─── SA6 / SA7 / SA8 · Operations ───────────────────────────────────────────

function Policies() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3" data-testid="ai-agents-policies">
      <NotYet build="H4">
        <h2 className={H2}>Models</h2>
        <p className={MUTED}>Per area, up to three suggested models in order, and models locked off platform-wide.</p>
        <h2 className={`${H2} pt-2`}>Caps</h2>
        <ul className="grid gap-1 sm:grid-cols-2">{CAPS.map((c) => <li key={c} className="flex justify-between text-[12.5px]"><span className="text-axal-ink dark:text-gray-200">{c}</span><span className="text-axal-muted dark:text-gray-400">{NOT_RECORDED}</span></li>)}</ul>
        <h2 className={`${H2} pt-2`}>Tools skills may request</h2>
        <p className={MUTED}>Read-only connectors only. A write tool is refused on every skill, from Axal or a company.</p>
      </NotYet>
      <Card className="px-4 py-4" data-testid="ai-agents-guardrails">
        <h2 className={H2}>Guardrails</h2>
        <table className="mt-2 w-full text-[12.5px]">
          <thead className={EYEBROW}><tr className="text-left"><th className="py-1.5 pr-3">Rule</th><th className="py-1.5 pr-3">Enforced by</th><th className="py-1.5">Violations 30d</th></tr></thead>
          <tbody>{GUARDRAILS.map((g) => <tr key={g.rule} className="border-t border-axal-hairline/60 dark:border-gray-800"><td className="py-2 pr-3 text-axal-ink dark:text-gray-200">{g.rule}</td><td className="py-2 pr-3 text-axal-muted dark:text-gray-400">{g.check}</td><td className="py-2 text-axal-muted dark:text-gray-400">{NOT_RECORDED}</td></tr>)}</tbody>
        </table>
        <p className="mt-2 text-[11.5px] text-axal-muted dark:text-gray-400">A violating output is never proposed. The counts arrive with #4162.</p>
      </Card>
      <Card className="space-y-2 border-red-200 px-4 py-4 dark:border-red-900" data-testid="ai-agents-kill-switch">
        <h2 className={H2}>Pause all AI agents</h2>
        <p className={MUTED}>Stops every agent on every team at once. Open proposals stay decidable. A banner shows on every team until you resume.</p>
        <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-[12.5px] font-semibold text-red-700 dark:border-red-800 dark:text-red-300" onClick={() => setOpen((v) => !v)} aria-expanded={open}>Pause all AI agents…</button>
        {open ? (
          <div className="space-y-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid="ai-agents-pause-form">
            <label className="block text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">Reason · required
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-axal-hairline px-2 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900" placeholder={`At least ${REASON_MIN} characters`} />
            </label>
            <label className="block text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">Type {PAUSE_WORD} to confirm
              <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 w-40 rounded-lg border border-axal-hairline px-2 py-1.5 font-mono text-[13px] dark:border-gray-700 dark:bg-gray-900" />
            </label>
            <p className="text-[11.5px] text-axal-muted dark:text-gray-400">What every team will see: “{PAUSED_BANNER}”</p>
            <button type="button" disabled title={notYet('H4')} data-armed={pauseArmed({ typed, reason }) ? 'yes' : 'no'}
              className="rounded-lg bg-red-700 px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50">Pause all AI agents</button>
            <p role="status" className="text-[11.5px] font-semibold text-axal-ink dark:text-gray-200">{notYet('H4')} Nothing is paused from this page until then.</p>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function Runs() {
  return (
    <NotYet build="H5" testId="ai-agents-runs">
      <p className={MUTED}>Every agent run across all teams. Opening a run shows its steps, inputs as references to records (never member emails), output, cost and errors.</p>
      <EmptyTable columns={RUN_COLUMNS} line="The run log is read when #4163 lands." testId="ai-agents-runs-table" />
    </NotYet>
  );
}

function Spend() {
  return (
    <div className="space-y-3" data-testid="ai-agents-spend">
      <NotYet build="H5">
        <p className={MUTED}>This month against the platform budget, the projection at the last 7 days’ pace, teams at their cap, and spend by agent, skill, company and model.</p>
      </NotYet>
      <p className={MUTED}>Members’ AI spend by model and page is on <Link to="/admin/platform/ai-usage" className="font-semibold text-axal-violet underline dark:text-violet-300">Platform › AI usage</Link> today.</p>
    </div>
  );
}

function Audit() {
  return (
    <NotYet build="H5" testId="ai-agents-audit">
      <p className={MUTED}>Every admin action on this panel: who, what, when, the reason, and before and after. Read only; entries cannot be edited or deleted. CSV export.</p>
      <EmptyTable columns={AUDIT_COLUMNS} line="The audit is read when #4163 lands." testId="ai-agents-audit-table" />
    </NotYet>
  );
}

// ─── The page ───────────────────────────────────────────────────────────────

export default function HqAiAgentsPage() {
  const { pathname } = useLocation();
  const view = viewFor(pathname);
  const [skills, setSkills] = useState({ status: 'loading', hq: null });

  const load = useCallback(() => {
    setSkills({ status: 'loading', hq: null });
    teamAgentsApi.axalSkills()
      .then((r) => setSkills({ status: 'ready', hq: Array.isArray(r?.hq) ? r.hq : [] }))
      .catch(() => setSkills({ status: 'unreadable', hq: null }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const hqCount = skills.status === 'ready' ? skills.hq.length : null;
  const tabs = (
    <>
      <HeaderTab to="/hq/ai-agents" end data-testid="ai-agents-tab-overview">Overview</HeaderTab>
      <HeaderTab to="/hq/ai-agents/roster" end={false} data-testid="ai-agents-tab-roster">Roster</HeaderTab>
      <HeaderTab to="/hq/ai-agents/skills" end={false} data-testid="ai-agents-tab-skills" count={hqCount == null ? null : { kind: 'num', value: hqCount }}>Skills library</HeaderTab>
      <HeaderTab to="/hq/ai-agents/operations" end={false} data-testid="ai-agents-tab-operations">Operations</HeaderTab>
    </>
  );

  return (
    <div className="space-y-4" data-testid="hq-ai-agents-page" data-view={`${view.tab}${view.sub ? `:${view.sub}` : ''}`}>
      <AdminPageHeader
        title="AI agents"
        pills={[{ label: 'HQ only', tone: 'hq' }]}
        line={SUBTITLE}
        tabs={tabs}
        data-testid="ai-agents-header"
      />
      <SubTabs view={view} />
      {view.tab === 'overview' ? <Overview skills={skills} /> : null}
      {view.tab === 'roster' ? <Roster view={view} /> : null}
      {view.tab === 'skills' && view.sub === 'axal' ? <FromAxal skills={skills} onRetry={load} /> : null}
      {view.tab === 'skills' && view.sub === 'editor' ? <Editor view={view} skills={skills} /> : null}
      {view.tab === 'skills' && view.sub === 'companies' ? <CompanySkills /> : null}
      {view.tab === 'operations' && view.sub === 'runs' ? <Runs /> : null}
      {view.tab === 'operations' && view.sub === 'spend' ? <Spend /> : null}
      {view.tab === 'operations' && view.sub === 'policies' ? <Policies /> : null}
      {view.tab === 'operations' && view.sub === 'audit' ? <Audit /> : null}
    </div>
  );
}
