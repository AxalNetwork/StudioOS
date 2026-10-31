import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, getActiveCompanyId } from '../../../lib/api';
import { accountCompaniesApi } from '../../../lib/api/accountCompanies.js';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { useAuth } from '../../../hooks/useAuthSync';
import { useActiveCompany } from '../../../contexts/ActiveCompanyContext';
import { useCompanySwitch } from '../../../ui/CompanySwitcher';
import { HeaderTab, Unreadable, actionPrimary, usePhoneWidth } from '../../../ui';
import { ConfirmDialog, NewCompanyDialog } from './CompaniesDialogs';
import CompanyLightbox from './CompanyLightbox';
import { CompaniesMovedNotice } from './CompaniesMoved';
import VentureLightbox from './VentureLightbox';
import {
  ACTIVE_HERE, ACTIVE_LINE, ADMIN_LINE, ADVISOR_LINE, EXPLORER_LINE, LINE, SHARED_LINE, TAB_LABELS, TITLE,
  answerCopy, canCreate, companiesTabFor, companyCards, companyPathFor, companyUidFor, engagementRows, filterCards, filterVentures, fundGroups,
  invitationRows, profileOf, projectGroups, tabCount, tabsFor, SETTINGS_PATH, companySettingsPathFor,
} from './companiesModel';

/**
 * D1134 (#2422), completed by D1138 (#3018) — Account › Companies and
 * projects, built to the owner's canvas (CMP1, CMP3, CMP5, CMP9–CMP18).
 *
 * Each tab is its own address (`/account/portfolio`, `/projects`, `/funds`,
 * `/engagements`, `/invitations`); which ones a member sees is their
 * profile's (`tabsFor`). Each read is its own block: one that fails reads
 * Unreadable with Try again and never blanks another. The writes here are
 * New company and answering an invitation addressed to you, each in an
 * in-page dialog that says what it changes.
 *
 * D1139 (#3019): `/account/portfolio/<uid>` opens that company's lightbox
 * (CMP2) over the Companies tab, and a venture's Open its lightbox (CMP4);
 * the lifecycle dialogs (CMP6–CMP8) open from them.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const PILL = 'inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const NEUTRAL = `${PILL} border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400`;
const VIOLET = `${PILL} border-violet-300 bg-axal-lavender text-axal-violet dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-300`;
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:border-axal-violet disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const NOTE = 'm-0 flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-axal-lavender px-3 py-2.5 text-[13px] font-semibold text-axal-ink dark:bg-violet-950/40 dark:text-gray-100';
const FIELD = 'min-h-[36px] rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

function useRead(load, enabled, tick) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null });
  useEffect(() => {
    if (!enabled) { setState({ status: 'idle', data: null }); return undefined; }
    let alive = true;
    setState((s) => ({ status: 'loading', data: s.data }));
    Promise.resolve().then(load)
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch(() => { if (alive) setState({ status: 'error', data: null }); });
    return () => { alive = false; };
  }, [load, enabled, tick]);
  return state;
}

const readCompanies = () => accountCompaniesApi.companies();
const readProjects = () => accountCompaniesApi.projects();
const readInvitations = () => accountCompaniesApi.invitations();
const readFunds = () => api.fundsList();
const readEngagements = () => api.advisorClientsSharedWithMe();

function Skeleton({ testId }) {
  return (
    <div className={`${CARD} flex flex-col gap-2 px-4 py-3`} aria-hidden="true" data-testid={testId}>
      <span className={`text-[13px] font-semibold ${MUTED}`}>Reading…</span>
      {[80, 60, 70].map((w) => <span key={w} className="h-2.5 rounded-full bg-axal-ground dark:bg-gray-800" style={{ width: `${w}%` }} />)}
    </div>
  );
}

function Empty({ title, note, children, testId }) {
  return (
    <div className={`${CARD} flex flex-col items-center gap-2 px-6 py-8 text-center`} data-testid={testId}>
      <span aria-hidden="true" className={`text-[18px] ${MUTED}`}>○</span>
      <p className={`m-0 text-[14px] font-extrabold ${INK}`}>{title}</p>
      {note ? <p className={`m-0 max-w-[420px] text-[12.5px] ${MUTED}`}>{note}</p> : null}
      {children}
    </div>
  );
}

function Failed({ what, claim, retry, testId }) {
  return <div className={`${CARD} px-4 py-3`} data-testid={testId}><Unreadable what={what} claim={claim} onRetry={retry} /></div>;
}

const Note = ({ children, testId }) => <p className={NOTE} data-testid={testId}>{children}</p>;

// ---------------------------------------------------------------- Companies (CMP1, CMP9, CMP10, CMP13)

function CompanyCard({ c, profile, funds, phone }) {
  const pills = (
    <span className="flex flex-wrap items-center gap-1.5">
      {c.active ? <span className={VIOLET} data-testid="company-active">{ACTIVE_HERE}</span> : null}
      <span className={NEUTRAL}>{c.primary ? 'Primary admin' : c.role}{c.authority ? ` · ${c.authority}` : ''}</span>
    </span>
  );
  return (
    <section className={`${CARD} flex flex-col gap-2.5 px-4 py-3.5 ${c.active ? 'border-violet-300 ring-[3px] ring-axal-lavender dark:border-violet-700 dark:ring-violet-950/50' : ''}`} data-testid="company-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className={`m-0 text-[16px] font-extrabold tracking-[-.01em] ${INK}`}>{c.name}</h3>
          {pills}
          <span className={`text-[12px] ${MUTED}`}>{[c.stage, c.title].filter(Boolean).join(' · ') || 'Stage not recorded'}</span>
        </div>
        <span className="flex items-center gap-3">
          {c.active && !phone ? <Link className={LINK} to={companySettingsPathFor(c.uid)}>Company Settings</Link> : null}
          <Link className={BTN} to={companyPathFor(c.uid)} data-testid={`company-open-${c.uid}`}>Open</Link>
        </span>
      </div>
      <dl className="m-0 grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
        <dt className={EYE}>Members</dt>
        <dd className={`m-0 text-[12.5px] font-semibold ${INK}`} data-testid="company-members">{c.members}{c.invitations ? ` · ${c.invitations}` : ''}</dd>
        <dt className={EYE}>Cycles</dt>
        <dd className={`m-0 text-[12.5px] ${INK}`}>{c.cycles}<span className={`block text-[12px] ${MUTED}`}>Last opened: {c.lastOpened}</span></dd>
        {profile === 'partner' ? (
          <>
            <dt className={EYE}>In this firm</dt>
            <dd className={`m-0 flex flex-wrap gap-1.5 text-[12px] ${INK}`} data-testid="company-firm-counts">
              {[['engagements', 'engagement', 'engagements'], ['quotes', 'quote', 'quotes'], ['offers', 'offer', 'offers']].map(([k, one, many]) => (
                <span key={k} className={VIOLET}>{c.counts[k] == null ? `${many}: could not be read` : `${c.counts[k]} ${c.counts[k] === 1 ? one : many}`}</span>
              ))}
            </dd>
          </>
        ) : profile === 'investor' ? (
          <>
            <dt className={EYE}>Funds</dt>
            <dd className={`m-0 text-[12.5px] ${INK}`} data-testid="company-funds">
              {funds ? (funds.length ? funds.map((f) => (
                <span key={f.id} className="block">{f.name} · {f.line} · {f.canManage
                  ? <Link className={LINK} to="/funds">Manage</Link>
                  : <span className={MUTED}>{c.active ? 'You do not manage this fund' : 'Switch to this firm to manage'}</span>}</span>
              )) : 'No fund run by this firm') : (c.counts.funds == null ? 'Funds: could not be read' : `${c.counts.funds} fund${c.counts.funds === 1 ? '' : 's'}`)}
            </dd>
          </>
        ) : (
          <>
            <dt className={EYE}>Ventures</dt>
            <dd className={`m-0 text-[12.5px] ${INK}`} data-testid="company-ventures">{c.counts.projects == null ? 'Ventures: could not be read' : `${c.counts.projects} venture${c.counts.projects === 1 ? '' : 's'}`}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function CompaniesTab({ read, retry, profile, cards, funds, phone, onNew }) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  if (read.status === 'loading' && !read.data) return <><Skeleton testId="companies-loading" /><Skeleton /><Skeleton /></>;
  if (read.status === 'error') {
    return (
      <div className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="companies-unreadable">
        <Unreadable what="Your companies" claim="That is not the same as having none." onRetry={retry} />
        <p className={`m-0 text-[12px] ${MUTED}`}>The company switcher in the sidebar reads Unavailable until this reads.</p>
      </div>
    );
  }
  if (!cards.length) {
    if (profile === 'hq') return <Empty title="You belong to no company." note="HQ work does not need one." testId="companies-none" />;
    return (
      <Empty title="You don’t belong to a company yet." note="A company keeps your ventures, deals and team together. Create one, or accept an invitation." testId="companies-none">
        <span className="flex flex-wrap justify-center gap-2">
          {canCreate(profile) ? <button type="button" className={actionPrimary} onClick={onNew} data-testid="companies-none-new">New company</button> : null}
          <Link className={BTN} to="/account/portfolio/invitations">See invitations</Link>
        </span>
      </Empty>
    );
  }
  const roles = [...new Set(cards.map((c) => c.role))];
  const shown = filterCards(cards, { q, role });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" aria-label="Search companies" className={`${FIELD} min-w-[200px] flex-1`} data-testid="companies-search" />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role" className={FIELD} data-testid="companies-role">
          <option value="">Every role</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <span className={`self-center text-[12px] ${MUTED}`}>Sort: active first</span>
      </div>
      {shown.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((c) => <CompanyCard key={c.uid} c={c} profile={profile} phone={phone} funds={funds ? (funds.find((g) => g.key === c.uid)?.rows || []) : null} />)}
        </div>
      ) : <p className={`m-0 text-[13px] ${MUTED}`} data-testid="companies-none-match">No company matches. Clear the search or pick another role.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Projects (CMP3)

function ProjectsTab({ read, retry, summary, profile, onOpen }) {
  const [q, setQ] = useState('');
  const [company, setCompany] = useState('');
  if (read.status === 'loading' && !read.data) return <Skeleton testId="projects-loading" />;
  if (read.status === 'error') return <Failed what="Your ventures" claim="That is not the same as having none." retry={retry} testId="projects-unreadable" />;
  const groups = projectGroups(read.data, summary?.companies || []);
  if (!groups.length) {
    return (
      <Empty title="No ventures yet." note="A venture moves through Validate, Build, Raise and Grow inside its company." testId="projects-none">
        {profile === 'founder' ? <Link className={BTN} to="/build?new=1">Start a venture</Link> : null}
      </Empty>
    );
  }
  const shown = filterVentures(groups, { q, company });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ventures" aria-label="Search ventures" className={`${FIELD} min-w-[200px] flex-1`} data-testid="projects-search" />
        <select value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company" className={FIELD} data-testid="projects-company">
          <option value="">Every company</option>
          {groups.map((g) => <option key={g.key} value={g.key}>{g.title}</option>)}
        </select>
      </div>
      {shown.map((g) => (
        <section key={g.key} className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="project-group">
          <h3 className={`m-0 flex items-baseline justify-between text-[13.5px] font-extrabold ${INK}`}>{g.title}<span className={`font-mono text-[11.5px] ${MUTED}`}>{g.rows.length}</span></h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {g.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-2 first:border-0 first:pt-0 dark:border-gray-800" data-testid="project-row">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className={`text-[14px] font-bold ${INK}`}>{r.name}</span>
                  <span className={`text-[12px] ${MUTED}`}>{r.stage}{r.week ? ` · ${r.week}` : ''} · {r.members} · your seat: {r.seat}</span>
                  <span className={`text-[12px] ${MUTED}`}>{r.cycles}</span>
                </span>
                <button type="button" className={BTN} onClick={() => onOpen(r)} data-testid={`project-open-${r.id}`}>Open</button>
              </li>
            ))}
          </ul>
          {g.foot ? <p className={`m-0 text-[12px] ${MUTED}`}>{g.foot}</p> : null}
        </section>
      ))}
      {!shown.length ? <p className={`m-0 text-[13px] ${MUTED}`} data-testid="projects-none-match">No venture matches. Clear the search or pick another company.</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Invitations (CMP5, CMP12)

function InvitationsTab({ read, retry, summary, onAnswer }) {
  if (read.status === 'loading' && !read.data) return <Skeleton testId="invitations-loading" />;
  if (read.status === 'error') return <Failed what="Invitations to you" claim="That is not the same as having none." retry={retry} testId="invitations-unreadable" />;
  const { rows, failed } = invitationRows(read.data);
  const editing = (summary?.companies || []).filter((c) => c.pending_invitations?.available && c.pending_invitations.value > 0);
  return (
    <div className="flex flex-col gap-3">
      {failed.length ? <Failed what={failed.join(' and ')} claim="The others are listed." retry={retry} testId="invitations-partial" /> : null}
      {rows.length ? (
        <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="invitations-to-you">
          <h3 className={`m-0 flex items-baseline justify-between text-[13.5px] font-extrabold ${INK}`}>Invitations to you<span className="font-mono text-[11.5px] font-bold text-amber-700 dark:text-amber-300">{rows.length} waiting</span></h3>
          {rows.map((r) => (
            <div key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-2 first:border-0 first:pt-0 dark:border-gray-800" data-testid={`invitation-${r.key}`}>
              <span className="min-w-0">
                <b className={`block text-[14px] ${INK}`}>{r.title}</b>
                <span className={`text-[12px] ${MUTED}`}>{r.from}{r.sent ? ` · sent ${r.sent}` : ''}{r.expires ? ` · expires ${r.expires}` : ''}</span>
                {!r.canAccept ? <span className={`block text-[12px] ${MUTED}`}>An investor account cannot take a seat on a venture team.</span> : null}
              </span>
              <span className="flex gap-2">
                {r.canAccept ? <button type="button" className={actionPrimary} onClick={() => onAnswer(r, 'accept')} data-testid={`invitation-accept-${r.key}`}>Accept</button> : null}
                {r.canDecline ? <button type="button" className={BTN} onClick={() => onAnswer(r, 'decline')} data-testid={`invitation-decline-${r.key}`}>Decline</button> : null}
              </span>
            </div>
          ))}
          {rows.some((r) => r.kind === 'company') ? <p className={`m-0 text-[12px] ${MUTED}`}>Declining a company invitation is not built yet; it lapses on its own if you leave it.</p> : null}
        </section>
      ) : !failed.length ? <Empty title="No invitations waiting for you." note="Invitations to a company or a venture seat appear here." testId="invitations-none" /> : null}
      {editing.length ? (
        <section className={`${CARD} flex flex-col gap-1.5 px-4 py-3`} data-testid="invitations-sent">
          <h3 className={`m-0 text-[13.5px] font-extrabold ${INK}`}>Invitations you sent</h3>
          {editing.map((c) => <span key={c.uid} className={`text-[12.5px] ${INK}`}>{c.company_name} · {c.pending_invitations.value} pending</span>)}
          <p className={`m-0 text-[12px] ${MUTED}`}>Resend and revoke them in <Link className={LINK} to={SETTINGS_PATH}>Company Settings</Link> for the company that is active.</p>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Funds (CMP9) and Engagements (CMP11)

function FundsTab({ read, retry, groups }) {
  if (read.status === 'loading' && !read.data) return <Skeleton testId="funds-loading" />;
  if (read.status === 'error') return <Failed what="Your funds" claim="That is not the same as having none." retry={retry} testId="funds-unreadable" />;
  if (!groups.length) return <Empty title="No fund yet." note="Funds a firm you belong to runs appear here." testId="funds-none" />;
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <section key={g.key} className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="fund-group">
          <h3 className={`m-0 text-[13.5px] font-extrabold ${INK}`}>{g.key === 'none' ? g.title : `Funds ${g.title} runs`}</h3>
          {g.rows.map((f) => (
            <div key={f.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]" data-testid="fund-row">
              <span className={INK}><b>{f.name}</b> <span className={MUTED}>· {f.line}</span></span>
              {f.canManage ? <Link className={LINK} to="/funds">Manage</Link> : <span className={MUTED}>{g.active ? 'You do not manage this fund' : 'Switch to this firm to manage'}</span>}
            </div>
          ))}
          {g.foot ? <p className={`m-0 text-[12px] ${MUTED}`}>{g.foot}</p> : null}
        </section>
      ))}
      <Note>Managing a fund needs its firm active, so Manage shows on the active firm’s funds. <Link className={LINK} to="/funds">Your LP positions</Link></Note>
    </div>
  );
}

function EngagementsTab({ read, retry }) {
  if (read.status === 'loading' && !read.data) return <Skeleton testId="engagements-loading" />;
  if (read.status === 'error') return <Failed what="Your engagements" claim="That is not the same as having none." retry={retry} testId="engagements-unreadable" />;
  const rows = engagementRows(read.data);
  return (
    <div className="flex flex-col gap-3">
      <Note testId="engagements-note">{ADVISOR_LINE}</Note>
      {rows.length ? (
        <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="engagements">
          <h3 className={`m-0 text-[13.5px] font-extrabold ${INK}`}>Engagements · {rows.length}</h3>
          <p className={`m-0 text-[12px] ${MUTED}`}>Each one is a grant from a founder: what they share with you, and until when.</p>
          {rows.map((r) => (
            <div key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-2 dark:border-gray-800" data-testid="engagement-row">
              <span>
                <b className={`block text-[14px] ${INK}`}>{r.name}</b>
                <span className={`text-[12px] ${MUTED}`}>since {r.since} · until {r.until}</span>
                <span className="mt-1 flex flex-wrap gap-1">{r.shares.map((s) => <span key={s} className={NEUTRAL}>{s}</span>)}</span>
              </span>
              <Link className={BTN} to="/research/client-prep">Open brief</Link>
            </div>
          ))}
        </section>
      ) : <Empty title="No founder has opened a venture to you yet." note="When a founder grants you their venture, it appears here." testId="engagements-none" />}
    </div>
  );
}

// ---------------------------------------------------------------- the pane

export default function CompaniesProjects({ role, entityRecords = null }) {
  const loc = useLocation();
  const phone = usePhoneWidth();
  const auth = useAuth();
  const { company: active, setCompanies, companies: known } = useActiveCompany();
  const { create, switchTo, leave } = useCompanySwitch();
  const navigate = useNavigate();
  const meId = auth?.user?.id ?? null;
  // D1139 — a company uid in the address opens its lightbox over Companies.
  const openUid = companyUidFor(loc.pathname);
  const profile = profileOf(role, isSuperAdminUser(auth?.user));
  const visible = tabsFor(profile);
  const asked = companiesTabFor(loc.pathname);
  const tab = visible.includes(asked) ? asked : 'companies';
  const [venture, setVenture] = useState(null);

  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick((n) => n + 1), []);
  const companies = useRead(readCompanies, true, tick);
  const projects = useRead(readProjects, visible.includes('projects') || !!openUid, tick);
  const invitations = useRead(readInvitations, true, tick);
  const funds = useRead(readFunds, visible.includes('funds'), tick);
  const engagements = useRead(readEngagements, visible.includes('engagements'), tick);
  const [answering, setAnswering] = useState(null);
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState('');

  // The active company is this device's: the switcher's, else the stored id matched to the membership list.
  const activeUid = active?.uid ?? (known || []).find((c) => Number(c.id) === Number(getActiveCompanyId()))?.uid ?? null;
  const cards = useMemo(() => (companies.status === 'ready' ? companyCards(companies.data, { activeUid, known }) : []), [companies, activeUid, known]);
  const fundsByFirm = useMemo(() => (funds.status === 'ready' ? fundGroups(funds.data, cards) : []), [funds, cards]);
  const invites = invitations.status === 'ready' ? invitationRows(invitations.data).rows.length : null;

  const counts = {
    companies: tabCount(companies, companies.status === 'ready' ? cards.length : null),
    projects: tabCount(projects, projects.status === 'ready' ? (projects.data?.projects || []).length : null),
    funds: tabCount(funds, funds.status === 'ready' ? fundsByFirm.reduce((n, g) => n + g.rows.length, 0) : null),
    engagements: tabCount(engagements, engagements.status === 'ready' ? engagementRows(engagements.data).length : null),
    invitations: tabCount(invitations, invites),
  };

  const refreshSwitcher = () => api.listMyCompanies().then((rows) => { if (Array.isArray(rows)) setCompanies(rows); }).catch(() => {});
  const changed = (msg, { switcher = false } = {}) => { setDone(msg); if (switcher) refreshSwitcher(); retry(); };
  const answer = (row, kind) => {
    if (kind === 'decline') return accountCompaniesApi.declineProjectInvitation(row.id);
    return row.kind === 'company' ? accountCompaniesApi.acceptCompanyInvitation(row.id) : accountCompaniesApi.acceptProjectInvitation(row.id);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="companies-projects">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className={`m-0 text-[18px] font-extrabold tracking-[-.015em] ${INK}`}>{TITLE}</h2>
          <p className={`m-0 text-[12.5px] ${MUTED}`}>{LINE}</p>
        </div>
        {canCreate(profile) ? (
          <button type="button" className={`${actionPrimary} ${phone ? 'w-full' : ''}`} onClick={() => setAdding(true)} data-testid="companies-new">New company</button>
        ) : null}
      </header>

      <CompaniesMovedNotice />

      <nav className="flex gap-4 overflow-x-auto border-b border-axal-hairline dark:border-gray-700" aria-label={TITLE} data-testid="companies-tabs">
        {visible.includes('companies') && <HeaderTab to="/account/portfolio" count={counts.companies} data-testid="companies-tab-companies">{TAB_LABELS.companies}</HeaderTab>}
        {visible.includes('projects') && <HeaderTab to="/account/portfolio/projects" count={counts.projects} data-testid="companies-tab-projects">{TAB_LABELS.projects}</HeaderTab>}
        {visible.includes('funds') && <HeaderTab to="/account/portfolio/funds" count={counts.funds} data-testid="companies-tab-funds">{TAB_LABELS.funds}</HeaderTab>}
        {visible.includes('engagements') && <HeaderTab to="/account/portfolio/engagements" count={counts.engagements} data-testid="companies-tab-engagements">{TAB_LABELS.engagements}</HeaderTab>}
        {visible.includes('invitations') && <HeaderTab to="/account/portfolio/invitations" count={counts.invitations} data-testid="companies-tab-invitations">{TAB_LABELS.invitations}</HeaderTab>}
      </nav>

      {done ? <p role="status" className={`m-0 rounded-[9px] bg-axal-ground px-3 py-2 text-[12.5px] ${INK} dark:bg-gray-800`} data-testid="companies-done">{done}</p> : null}

      {tab === 'companies' && (
        <>
          {profile === 'explorer' ? <Note testId="companies-explorer-note">{EXPLORER_LINE} <Link className={LINK} to="/account/profile">Set up your profile</Link></Note> : null}
          {profile === 'admin' || profile === 'hq' ? (
            <Note testId="companies-admin-note">{ADMIN_LINE} <Link className={LINK} to={profile === 'hq' ? '/admin/licences' : '/admin/my-licence'}>Open Licences</Link></Note>
          ) : cards.length ? <Note testId="companies-active-note">{ACTIVE_LINE}</Note> : null}
          <CompaniesTab read={companies} retry={retry} profile={profile} cards={cards} phone={phone}
            funds={profile === 'investor' && funds.status === 'ready' ? fundsByFirm : null} onNew={() => setAdding(true)} />
          {cards.length ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="companies-shared">{SHARED_LINE}</p> : null}
          {/* D1140 (#3020, CMP19b): "Your companies", with each company's entity record, moved here from Profile and identity. */}
          {entityRecords && profile !== 'explorer' && profile !== 'admin' && profile !== 'hq' ? <div data-testid="companies-entity-records">{entityRecords}</div> : null}
        </>
      )}
      {tab === 'projects' && <ProjectsTab read={projects} retry={retry} summary={companies.status === 'ready' ? companies.data : null} profile={profile} onOpen={setVenture} />}
      {tab === 'funds' && <FundsTab read={funds} retry={retry} groups={fundsByFirm} />}
      {tab === 'engagements' && <EngagementsTab read={engagements} retry={retry} />}
      {tab === 'invitations' && (
        <InvitationsTab read={invitations} retry={retry} summary={companies.status === 'ready' ? companies.data : null}
          onAnswer={(row, kind) => setAnswering({ row, kind })} />
      )}

      {answering ? (() => {
        const copy = answerCopy(answering.row, answering.kind);
        return (
          <ConfirmDialog testId="invitation-dialog" title={copy.title} body={copy.body} button={copy.button} danger={answering.kind === 'decline'}
            run={() => answer(answering.row, answering.kind)} onClose={() => setAnswering(null)}
            onDone={() => {
              setDone(answering.kind === 'decline' ? `You declined the seat on ${answering.row.name}.` : `You joined ${answering.row.name}.`);
              if (answering.row.kind === 'company' && answering.kind === 'accept') refreshSwitcher();
              setAnswering(null); retry();
            }} />
        );
      })() : null}
      {openUid && !venture ? (
        <CompanyLightbox uid={openUid} card={cards.find((c) => c.uid === openUid) || null}
          projects={projects.status === 'ready' ? projects.data : null} meId={meId}
          active={activeUid === openUid} row={(known || []).find((c) => c.uid === openUid) || null}
          switchTo={switchTo} leave={leave} onChanged={changed} onOpenVenture={setVenture}
          onClose={() => navigate('/account/portfolio')} />
      ) : null}
      {venture ? (
        <VentureLightbox venture={venture} companies={cards} meId={meId}
          onClose={() => setVenture(null)} onChanged={changed} />
      ) : null}
      {adding ? (
        <NewCompanyDialog create={create} companies={companies.status === 'ready' ? companies.data?.companies : known} onClose={() => setAdding(false)}
          onDone={(c) => { setDone(`${c?.company_name || 'The company'} is created and active on this device.`); setAdding(false); retry(); }} />
      ) : null}
    </div>
  );
}
