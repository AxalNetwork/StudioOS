import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Card } from '../../../ui';
import AdminPageHeader, { HeaderTab } from '../../../ui/AdminPageHeader';
import { teamAgentsApi } from '../../../lib/api/teamAgents';
import { adminAiAgentsApi } from '../../../lib/api/adminAiAgents';
import {
  AUDIT_COLUMNS, BUILD, CAPS, COMPANY_COLUMNS, GUARDRAILS, NOT_RECORDED, PAUSED_BANNER, PAUSE_WORD, REASON_MIN,
  ROSTER_COLUMNS, RUN_COLUMNS, SUBTITLE, AREAS, areaTiles, notYet, overviewTiles, pauseArmed, skillRow, viewFor,
  PERSONA_STATUS, VALUE_KEYS, actionWord, defaultsArmed, filterRoster, fitLabel, historyLine, identityChanges, retireLines,
  rosterCounts, rosterRefusal, rosterRow, saveArmed, statusArmed, teamLine, usd, valueLabel,
} from './aiAgentsModel';

/**
 * D4137 (#4137) — HQ › AI agents, the super admin control panel (SA0–SA9).
 *
 * Super Admin only (`hqOnly` in App.jsx; every route H1–H5 adds re-checks with
 * `requireSuperAdmin`). Four tabs at their own addresses: Overview, Roster,
 * Skills library (From Axal · Company skills) and Operations (Runs · Spend ·
 * Policies · Audit).
 *
 * LIVE: `GET /api/teams/skills`, D1612's library, whose `hq` list is the
 * "From Axal" skills; and the Roster (H1, #4158, D4158): SA1's table and
 * cards, SA2's agent detail and SA2b's save, hide and retire dialogs, through
 * `adminAiAgentsApi.roster*`. Every roster write takes a reason; values are
 * shown, never sent. Everything else waits for its build task (#4160–#4163);
 * each board says so and names the issue, and no control is drawn enabled
 * that the Worker would only refuse. When a task lands, its builder flips
 * `BUILD[key].live` in the model and wires the read.
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

const FIELD = 'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL = 'block text-[12.5px] font-semibold text-axal-ink dark:text-gray-200';
const PRIMARY = 'rounded-lg bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';
const DANGER = 'rounded-lg border border-red-300 px-3 py-1.5 text-[12.5px] font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-300';

function Avatar({ src, name, size = 36 }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-lg bg-axal-lavender font-bold text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300" style={{ width: size, height: size }}>{String(name || '?')[0]}</span>;
  }
  return <img src={src} alt="" width={size} height={size} onError={() => setBroken(true)} className="shrink-0 rounded-lg [image-rendering:pixelated]" style={{ width: size, height: size }} />;
}

function Tags({ items }) {
  return <span className="flex flex-wrap gap-1">{items.map((t) => <span key={t} className="rounded-md border border-axal-hairline px-1.5 py-0.5 text-[11.5px] text-axal-ink dark:border-gray-700 dark:text-gray-200">{t}</span>)}</span>;
}

/** A reason box, the same on every write: required, at least 10 characters. */
function Reason({ value, onChange, label = 'Reason · required' }) {
  return (
    <label className={LABEL}>{label}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className={FIELD} placeholder={`At least ${REASON_MIN} characters`} data-testid="roster-reason" />
    </label>
  );
}

/** SA2b: the confirmation every roster write goes through. */
function Dialog({ title, lines, children, onCancel, onConfirm, confirm, danger, armed, busy, error, testId }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" data-testid={testId}>
      <div className="w-full max-w-[480px] space-y-3 rounded-xl border border-axal-hairline bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <h2 className={H2}>{title}</h2>
        {lines.map((l) => <p key={l} className="text-[13px] text-axal-ink dark:text-gray-200">{l}</p>)}
        {children}
        {error ? <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={danger ? DANGER : PRIMARY} onClick={onConfirm} disabled={!armed || busy} data-testid={`${testId}-confirm`}>{busy ? 'Saving…' : confirm}</button>
        </div>
      </div>
    </div>
  );
}

function RosterList() {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [filters, setFilters] = useState({ q: '', status: '', fit: '', value: '' });
  const [cards, setCards] = useState(false);
  const load = useCallback(() => {
    setState({ status: 'loading', data: null });
    adminAiAgentsApi.roster().then((data) => setState({ status: 'ready', data })).catch(() => setState({ status: 'unreadable', data: null }));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (state.status === 'loading') return <p role="status" className={MUTED}>Reading the roster…</p>;
  if (state.status === 'unreadable') return <Unreadable onRetry={load} what="The roster" />;
  const personas = filterRoster(state.data.personas, filters);
  const rows = personas.map(rosterRow);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-3" data-testid="ai-agents-roster">
      <Card className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={filters.q} onChange={set('q')} placeholder="Search agents" aria-label="Search agents" className="h-9 min-w-[200px] flex-1 rounded-lg border border-axal-hairline bg-white px-3 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
          <select value={filters.status} onChange={set('status')} aria-label="Status" className="h-9 rounded-lg border border-axal-hairline bg-white px-2 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
            <option value="">Status: all</option>
            {Object.entries(PERSONA_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={filters.fit} onChange={set('fit')} aria-label="Natural fit" className="h-9 rounded-lg border border-axal-hairline bg-white px-2 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
            <option value="">Natural fit: any</option>
            {['product', 'engineering', 'design', 'gtm', 'marketing', 'finance', 'legal', 'capital'].map((k) => <option key={k} value={k}>{fitLabel(k)}</option>)}
          </select>
          <select value={filters.value} onChange={set('value')} aria-label="Value" className="h-9 rounded-lg border border-axal-hairline bg-white px-2 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
            <option value="">Value: any</option>
            {VALUE_KEYS.map((k) => <option key={k} value={k}>{valueLabel(k)}</option>)}
          </select>
          <span className="ml-auto font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="roster-counts">{rosterCounts(state.data.counts)}</span>
          <span role="radiogroup" aria-label="View" className="flex overflow-hidden rounded-lg border border-axal-hairline dark:border-gray-700">
            <button type="button" role="radio" aria-checked={!cards} onClick={() => setCards(false)} className={`px-2.5 py-1.5 text-[12px] font-semibold ${!cards ? 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300' : 'text-axal-ink dark:text-gray-200'}`}>Table</button>
            <button type="button" role="radio" aria-checked={cards} onClick={() => setCards(true)} className={`border-l border-axal-hairline px-2.5 py-1.5 text-[12px] font-semibold dark:border-gray-700 ${cards ? 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300' : 'text-axal-ink dark:text-gray-200'}`}>Cards</button>
          </span>
        </div>
        <p className="text-[11.5px] text-axal-muted dark:text-gray-400">Hide and Retire ask for a reason. Teams already using an agent keep it until it is retired. Values are fixed.</p>
        {rows.length === 0 ? <p className="py-6 text-center text-[12.5px] text-axal-muted dark:text-gray-400">No agent matches.</p> : cards ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="roster-cards">
            {rows.map((r) => (
              <Link key={r.key} to={`/hq/ai-agents/roster/${encodeURIComponent(r.key)}`} className="flex flex-col gap-2 rounded-xl border border-axal-hairline p-3 hover:border-axal-violet dark:border-gray-800" data-testid="roster-card">
                <span className="flex items-center gap-3"><Avatar src={r.avatar} name={r.name} size={48} /><span className="flex flex-col gap-1"><b className="text-[15px] text-axal-ink dark:text-gray-100">{r.name}</b><Chip tone={r.status.tone}>{r.status.label}</Chip></span></span>
                <span className="text-[12.5px] text-axal-ink dark:text-gray-200">{r.tagline}</span>
                <Tags items={r.topValues} />
                <span className="text-[12px] text-axal-muted dark:text-gray-400">{r.risk} · {r.fit.join(', ')}</span>
                <span className="border-t border-axal-hairline pt-2 font-mono text-[11.5px] text-axal-ink dark:border-gray-800 dark:text-gray-200">{r.teams} teams · {r.runs} runs · {r.accepted} accepted</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[12.5px]" data-testid="ai-agents-roster-table">
              <thead className={EYEBROW}><tr className="text-left">{ROSTER_COLUMNS.map((c) => <th key={c} className="py-1.5 pr-3">{c}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-axal-hairline/60 align-top dark:border-gray-800" data-testid="roster-row">
                    <td className="py-2 pr-3">
                      <Link to={`/hq/ai-agents/roster/${encodeURIComponent(r.key)}`} className="flex items-center gap-2.5">
                        <Avatar src={r.avatar} name={r.name} />
                        <span className="min-w-0"><b className="text-[13.5px] text-axal-ink hover:underline dark:text-gray-100">{r.name}</b><span className="block max-w-[260px] truncate text-[12px] text-axal-muted dark:text-gray-400">{r.tagline}</span></span>
                      </Link>
                    </td>
                    <td className="py-2 pr-3"><Tags items={r.topValues} /></td>
                    <td className="py-2 pr-3"><span className="block text-axal-ink dark:text-gray-200">{r.risk}</span><Tags items={r.fit} /></td>
                    <td className="py-2 pr-3"><Chip tone={r.status.tone}>{r.status.label}</Chip></td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{r.teams}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{r.runs}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{r.spend}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{r.accepted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** The card teams see: identity, values (fixed), risk and natural fit. */
function PublicCard({ p }) {
  const row = rosterRow(p);
  return (
    <Card className="space-y-3 px-4 py-4" data-testid="roster-public-card">
      <div className="flex items-center gap-3"><Avatar src={p.avatar} name={p.name} size={64} /><div><p className="text-[18px] font-extrabold text-axal-ink dark:text-gray-100">{p.name}</p><p className="text-[12.5px] text-axal-muted dark:text-gray-400">{p.personality}</p></div></div>
      <p className="text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{p.tagline}</p>
      <p className="text-[12.5px] leading-relaxed text-axal-ink dark:text-gray-200">{p.story}</p>
      <p className="text-[12.5px] text-axal-ink dark:text-gray-200"><span className={EYEBROW}>Goal</span> {p.goal}</p>
      <div className="space-y-1"><p className={EYEBROW}>Top values</p><Tags items={row.topValues} /></div>
      <p className="text-[12.5px] text-axal-ink dark:text-gray-200">{row.risk} · {row.fit.join(', ')}</p>
    </Card>
  );
}

function RosterAgent({ agentKey }) {
  const [state, setState] = useState({ status: 'loading', p: null });
  const [models, setModels] = useState(null);
  const [draft, setDraft] = useState({});
  const [trademark, setTrademark] = useState(false);
  const [defaults, setDefaults] = useState({ model: '', start: '', max: '' });
  const [dialog, setDialog] = useState(null); // { kind: 'save' | 'hidden' | 'retired' | 'offered' | 'defaults' }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const take = useCallback((p) => {
    setState({ status: 'ready', p });
    setDraft({ name: p.name, tagline: p.tagline, story: p.story, goal: p.goal, avatar: p.avatar });
    setDefaults({ model: p.defaults?.model ?? '', start: p.defaults?.start_cap_usd ?? '', max: p.defaults?.max_cap_usd ?? '' });
    setTrademark(false);
  }, []);
  const load = useCallback(() => {
    setState({ status: 'loading', p: null });
    adminAiAgentsApi.rosterAgent(agentKey).then((r) => take(r.persona)).catch((e) => setState({ status: e?.status === 404 ? 'missing' : 'unreadable', p: null }));
  }, [agentKey, take]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { teamAgentsApi.roles().then((r) => setModels(Array.isArray(r?.models) ? r.models : null)).catch(() => setModels(null)); }, []);

  const back = <Link to="/hq/ai-agents/roster" className="text-[12.5px] font-semibold text-axal-violet dark:text-violet-300">‹ Roster</Link>;
  if (state.status === 'loading') return <div className="space-y-3">{back}<p role="status" className={MUTED}>Reading {agentKey}…</p></div>;
  if (state.status === 'missing') return <div className="space-y-3">{back}<p className={MUTED}>There is no such agent in the roster.</p></div>;
  if (state.status === 'unreadable') return <div className="space-y-3">{back}<Unreadable onRetry={load} what="This agent" /></div>;
  const p = state.p;
  const row = rosterRow(p);
  const changes = identityChanges(p, draft);
  const open = (kind) => { setDialog({ kind }); setReason(''); setError(null); };
  const close = () => { if (!busy) setDialog(null); };
  const send = (fn) => {
    setBusy(true); setError(null);
    fn().then((r) => { take(r.persona); setDialog(null); }).catch((e) => setError(rosterRefusal(e))).finally(() => setBusy(false));
  };
  const statusDialog = dialog && ['hidden', 'retired', 'offered'].includes(dialog.kind);
  const STATUS_WORDS = {
    hidden: { title: `Hide ${p.name} from the gallery?`, lines: [`New teams cannot add ${p.name}. Teams already using ${p.name} keep the agent.`], confirm: 'Hide from the gallery' },
    retired: { title: `Retire ${p.name}?`, lines: retireLines(p), confirm: 'Retire', danger: true },
    offered: { title: `Offer ${p.name} again?`, lines: [`${p.name} returns to the gallery. Agents paused when ${p.name} was retired stay paused until their team resumes them.`], confirm: 'Offer again' },
  };
  const usageTiles = [['Teams', row.teams], ['Runs 30d', row.runs], ['Spend 30d', row.spend], ['Accepted', row.accepted], ['Failed', row.failed]];

  return (
    <div className="space-y-3" data-testid="ai-agents-agent-detail">
      {back}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[20px] font-extrabold text-axal-ink dark:text-gray-100">{p.name}</h2>
        <Chip tone={row.status.tone}>{row.status.label}</Chip>
        <span className="ml-auto flex gap-2">
          {p.status !== 'offered' ? <button type="button" className={BTN} onClick={() => open('offered')} data-testid="roster-offer">Offer again…</button> : null}
          {p.status === 'offered' ? <button type="button" className={BTN} onClick={() => open('hidden')} data-testid="roster-hide">Hide from the gallery…</button> : null}
          {p.status !== 'retired' ? <button type="button" className={DANGER} onClick={() => open('retired')} data-testid="roster-retire">Retire…</button> : null}
        </span>
      </div>
      <p className={MUTED}>The card teams see, and what HQ sets behind it.</p>
      <div className="grid items-start gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        <PublicCard p={p} />
        <div className="min-w-0 space-y-3">
          <Card className="space-y-3 px-4 py-4" data-testid="roster-identity">
            <div className="flex items-center justify-between"><h3 className={H2}>Identity</h3>
              <button type="button" className={PRIMARY} disabled={!Object.keys(changes).length} onClick={() => open('save')} data-testid="roster-save">Save changes…</button></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={LABEL}>Name<input value={draft.name ?? ''} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className={FIELD} /></label>
              <label className={LABEL}>Avatar<input value={draft.avatar ?? ''} onChange={(e) => setDraft((d) => ({ ...d, avatar: e.target.value }))} className={`${FIELD} font-mono`} placeholder="/agents/name.webp" /></label>
            </div>
            <p className="text-[12px] text-axal-muted dark:text-gray-400">Changing a name needs a trademark check and a reason.</p>
            <label className={LABEL}>Tagline<input value={draft.tagline ?? ''} onChange={(e) => setDraft((d) => ({ ...d, tagline: e.target.value }))} className={FIELD} /></label>
            <label className={LABEL}>Story<textarea value={draft.story ?? ''} onChange={(e) => setDraft((d) => ({ ...d, story: e.target.value }))} rows={4} className={FIELD} /></label>
            <label className={LABEL}>Goal<input value={draft.goal ?? ''} onChange={(e) => setDraft((d) => ({ ...d, goal: e.target.value }))} className={FIELD} /></label>
            <div className="space-y-1" data-testid="roster-values">
              <p className={LABEL}>Values</p>
              <Tags items={VALUE_KEYS.map((k) => `${valueLabel(k)}${(p.top_values ?? []).includes(k) ? ' ·  top' : ''}`)} />
              <p className="text-[12px] text-axal-muted dark:text-gray-400">Fixed · part of who {p.name} is. Values, risk and natural fit cannot be edited.</p>
            </div>
          </Card>
          <Card className="space-y-3 px-4 py-4" data-testid="roster-defaults">
            <div className="flex items-center justify-between"><h3 className={H2}>Defaults for teams</h3>
              <button type="button" className={BTN} onClick={() => open('defaults')} disabled={!defaultsArmed({ ...defaults, reason: 'x'.repeat(REASON_MIN) })} data-testid="roster-defaults-save">Save defaults…</button></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={LABEL}>Default model
                {models ? (
                  <select value={defaults.model} onChange={(e) => setDefaults((d) => ({ ...d, model: e.target.value }))} className={FIELD}>
                    <option value="">{NOT_RECORDED}</option>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                  </select>
                ) : <input value={defaults.model} onChange={(e) => setDefaults((d) => ({ ...d, model: e.target.value }))} className={`${FIELD} font-mono`} placeholder="Model id" />}
              </label>
              <label className={LABEL}>Monthly cap teams start with ($)<input type="number" min="0" step="0.01" value={defaults.start} onChange={(e) => setDefaults((d) => ({ ...d, start: e.target.value }))} className={`${FIELD} font-mono`} /></label>
              <label className={LABEL}>Maximum cap a team may set ($)<input type="number" min="0" step="0.01" value={defaults.max} onChange={(e) => setDefaults((d) => ({ ...d, max: e.target.value }))} className={`${FIELD} font-mono`} /></label>
            </div>
            <p className="text-[12px] text-axal-muted dark:text-gray-400">A team’s editors can lower the cap, never raise it above the maximum. The platform maximum arrives with #4162.</p>
          </Card>
          <Card className="space-y-3 px-4 py-4" data-testid="roster-usage">
            <h3 className={H2}>Usage <span className="text-[12px] font-normal text-axal-muted dark:text-gray-400">last 30 days</span></h3>
            <div className="grid gap-2 sm:grid-cols-5">{usageTiles.map(([k, v]) => <div key={k} className="rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800"><p className={EYEBROW}>{k}</p><p className={`font-mono tabular-nums ${v === NOT_RECORDED ? 'text-[12.5px] text-axal-muted dark:text-gray-400' : 'text-[16px] font-bold text-axal-ink dark:text-gray-100'}`}>{v}</p></div>)}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><p className={EYEBROW}>Teams using {p.name}</p>
                {p.teams == null ? <p className={MUTED}>{NOT_RECORDED}</p> : p.teams.length === 0 ? <p className={MUTED}>No team uses {p.name}.</p>
                  : <ul className="mt-1 space-y-0.5">{p.teams.map((t, i) => <li key={i} className="text-[13px] text-axal-ink dark:text-gray-200">{teamLine(t)}{t.status === 'paused' ? <span className="text-axal-muted dark:text-gray-400"> · paused</span> : null}</li>)}</ul>}
              </div>
              <div><p className={EYEBROW}>Most-used skills</p>
                {p.skills == null ? <p className={MUTED}>{NOT_RECORDED}</p> : p.skills.length === 0 ? <p className={MUTED}>No run used a skill in the last 30 days.</p>
                  : <ul className="mt-1 space-y-0.5">{p.skills.map((k) => <li key={k.uid} className="flex justify-between text-[13px] text-axal-ink dark:text-gray-200"><span>{k.name}</span><span className="font-mono text-[12px]">{k.runs} runs</span></li>)}</ul>}
              </div>
            </div>
          </Card>
          <Card className="space-y-2 px-4 py-4" data-testid="roster-history">
            <div className="flex items-center justify-between"><h3 className={H2}>History</h3><Link to="/hq/ai-agents/operations/audit" className="text-[12.5px] font-semibold text-axal-violet dark:text-violet-300">All in Audit ›</Link></div>
            {p.history == null ? <p className={MUTED}>{NOT_RECORDED}</p> : p.history.length === 0 ? <p className={MUTED}>No change yet. Every change is logged here with its reason.</p> : (
              <table className="w-full text-[12.5px]"><thead className={EYEBROW}><tr className="text-left"><th className="py-1.5 pr-3">When · who</th><th className="py-1.5 pr-3">What · before → after</th><th className="py-1.5">Reason</th></tr></thead>
                <tbody>{p.history.map((h, i) => (
                  <tr key={i} className="border-t border-axal-hairline/60 align-top dark:border-gray-800">
                    <td className="py-2 pr-3"><span className="block font-mono text-[12px]">{h.at}</span><span>{h.admin?.name || NOT_RECORDED}</span></td>
                    <td className="py-2 pr-3"><b className="block text-axal-ink dark:text-gray-100">{actionWord(h.action)}</b><span className="text-axal-ink dark:text-gray-200">{historyLine(h)}</span></td>
                    <td className="py-2 text-axal-muted dark:text-gray-400">“{h.reason}”</td>
                  </tr>))}</tbody></table>
            )}
          </Card>
        </div>
      </div>

      {dialog?.kind === 'save' ? (
        <Dialog title={`Save changes to ${p.name}?`} testId="roster-save-dialog" confirm="Save changes" busy={busy} error={error} onCancel={close}
          lines={[...Object.entries(changes).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)}: ${k === 'story' ? 'rewritten' : `${p[k]} → ${v}`}`), `Teams using ${p.name} see this on the card at once. The values, risk and natural fit do not change.`]}
          armed={saveArmed({ changes, reason, trademark })}
          onConfirm={() => send(() => adminAiAgentsApi.rosterUpdate(p.key, { ...changes, ...('name' in changes ? { trademark_checked: trademark } : {}), reason: reason.trim() }))}>
          {'name' in changes ? <label className="flex items-center gap-2 text-[12.5px] font-semibold text-axal-ink dark:text-gray-200"><input type="checkbox" checked={trademark} onChange={(e) => setTrademark(e.target.checked)} data-testid="roster-trademark" /> Trademark check done</label> : null}
          <Reason value={reason} onChange={setReason} label={'name' in changes ? 'Why change the name?' : 'Reason · required'} />
        </Dialog>
      ) : null}
      {statusDialog ? (
        <Dialog title={STATUS_WORDS[dialog.kind].title} lines={STATUS_WORDS[dialog.kind].lines} confirm={STATUS_WORDS[dialog.kind].confirm} danger={STATUS_WORDS[dialog.kind].danger}
          testId={`roster-${dialog.kind}-dialog`} busy={busy} error={error} onCancel={close} armed={statusArmed({ reason })}
          onConfirm={() => send(() => adminAiAgentsApi.rosterUpdate(p.key, { status: dialog.kind, reason: reason.trim() }))}>
          <Reason value={reason} onChange={setReason} />
        </Dialog>
      ) : null}
      {dialog?.kind === 'defaults' ? (
        <Dialog title={`Save the defaults for ${p.name}?`} testId="roster-defaults-dialog" confirm="Save defaults" busy={busy} error={error} onCancel={close}
          lines={[`New teams start on ${defaults.model} with a ${usd(defaults.start)} monthly cap, and may set up to ${usd(defaults.max)}. Agents already added keep their cap.`]}
          armed={defaultsArmed({ ...defaults, reason })}
          onConfirm={() => send(() => adminAiAgentsApi.rosterDefaults(p.key, { model: defaults.model, start_cap_usd: Number(defaults.start), max_cap_usd: Number(defaults.max), reason: reason.trim() }))}>
          <Reason value={reason} onChange={setReason} />
        </Dialog>
      ) : null}
    </div>
  );
}

function Roster({ view }) {
  return view.sub === 'agent' ? <RosterAgent key={view.agent} agentKey={view.agent} /> : <RosterList />;
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
