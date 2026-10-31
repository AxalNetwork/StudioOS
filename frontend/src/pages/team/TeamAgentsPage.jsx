import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api } from '../../lib/api';
import { accountCompaniesApi } from '../../lib/api/accountCompanies.js';
import { teamsApi } from '../../lib/api/teams.js';
import { reportError } from '../../lib/log';
import { safeReadJSON } from '../../lib/storage';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext';
import {
  companyProjectTeamPath, projectCompany, projectTeamPath, projectsOfCompany, scopeFor, scopeKey, usePublishScope,
} from '../../lib/settingsScope.js';
import { ActionDialog, RemoveMemberDialog } from '../account/companies/LifecycleDialogs.jsx';
import { companyPowers, roleWord } from '../account/companies/companiesModel.js';
import { AgentTile, PersonAvatar } from './AgentMark.jsx';
import AskButton from './AskButton.jsx';
import PeopleCard from './PeopleCard.jsx';
import InvitationsBlock from './InvitationsBlock.jsx';
import InviteSheet from './InviteSheet.jsx';
import AgentsCard from './AgentsCard.jsx';
import AddAgentSheet from './AddAgentSheet.jsx';
import AgentProfileSheet from './AgentProfileSheet.jsx';
import RulebooksTab from './RulebooksTab.jsx';
import ApprovalsTab from './ApprovalsTab.jsx';
import TeamSettingsTab from './TeamSettingsTab.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_TEXT, EYEBROW, FIELD, MUTED, useMenu } from './teamUi.jsx';
import {
  COMPANY_ROLES, ROSTER_LINE, TABS, TITLE, countBadge, errorWords, freshMemberKey, managedNote, peopleFromCompany, peopleFromProject, projectResentWords, purposeLine, refusalWords, tabFrom,
} from './teamModel.js';

/**
 * D1497 (#3727) — Team: the people and AI agents working on a company or a
 * project, drawn to the owner's canvas (`design/incoming/Team Page.dc.html`,
 * TM1a–TM9f). One page, three forms, decided by `scopeFor` in
 * `lib/settingsScope.js`:
 *
 *   /account/companies/:uid/settings/team                 a company (TM1a, TM1e)
 *   /account/companies/:uid/settings/projects/:id/team    a project in a company (TM1b, TM1f)
 *   /projects/:id/settings/team                           a standalone project (TM1g)
 *
 * A project reached at the wrong form is forwarded to the right one, so a
 * project inside a company is always reached from Company settings › Projects.
 *
 * WIRED: People, Invitations and Invite (company and project) on the routes
 * that exist today, through #3841's `teamsApi` (`lib/api/teams.js`; see
 * `teamModel.js`), including project Resend and linking an account by name.
 * BEHIND THE SEAM: agents, rule books, approvals and agent settings, through
 * `agentsAdapter.js`. The registry, profile and rule books are on #3840's
 * routes (switched off until `TEAM_AGENTS_ENABLED`, and said so); approvals,
 * runs and tools wait for #3842–#3844 and say so. The list's `plan_ok` turns
 * "AI agent" off with the plan's words. The page never invents an agent, a
 * count or a zero.
 *
 * NO AIRAIL: the company form lives under Account, which has none by the
 * owner's rule (`NO_RAIL_ROUTES`); the project form is not in a rail shell
 * yet (owner question T1). The rail is not changed, and Ask draws only once
 * #3706's Ask panel serves it (`AskButton.jsx`).
 *
 * WHILE READING the page names no scope it has not read: the eyebrow says
 * "Reading…", no managed note is drawn, and the sidebar is not told a scope
 * (`usePublishScope(null)`) until the read is ready, nor ever for a refusal.
 */

const me = () => safeReadJSON('user', {}) || {};

function NotAMember({ name }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-axal-lg border border-axal-hairline bg-white px-6 py-10 text-center dark:border-gray-700 dark:bg-gray-900" data-testid="team-not-member">
      <h1 className="m-0 text-[18px] font-extrabold text-axal-ink dark:text-gray-100">{name ? `You're not a member of ${name}.` : 'You can’t see this team.'}</h1>
      <p className={`m-0 ${MUTED}`}>Ask one of its editors to invite you.</p>
      <Link to="/account/companies" className={BTN_TEXT}>Back to my companies</Link>
    </div>
  );
}

function AddToTeam({ disabled, reading, canInvite, agentOff, onPerson, onAgent }) {
  const { open, setOpen, trigger, menu } = useMenu();
  return (
    <span className="relative">
      <button ref={trigger} type="button" className={BTN_PRIMARY} aria-haspopup="menu" aria-expanded={open} aria-disabled={disabled || undefined}
        title={reading ? 'Reading the team…' : undefined}
        onClick={() => { if (!disabled) setOpen((v) => !v); }} data-testid="team-add">
        Add to team <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <span ref={menu} role="menu" aria-label="Add to team" className="absolute right-0 z-30 mt-1 flex w-[230px] flex-col rounded-axal-md border border-axal-hairline bg-white p-1 shadow-xl dark:border-gray-700 dark:bg-gray-900" data-testid="team-add-menu">
          <button type="button" role="menuitem" disabled={!canInvite} onClick={() => { setOpen(false); onPerson(); }}
            className="flex h-11 items-center gap-2.5 rounded-md px-2 text-left text-[13.5px] text-axal-ink hover:bg-axal-lavender disabled:opacity-55 dark:text-gray-100 dark:hover:bg-violet-900/30" data-testid="team-add-person">
            <PersonAvatar initials="+" size={28} />Person
          </button>
          <button type="button" role="menuitem" disabled={!!agentOff} title={agentOff || undefined} onClick={() => { setOpen(false); onAgent(); }}
            className="flex h-11 items-center gap-2.5 rounded-md px-2 text-left text-[13.5px] text-axal-ink hover:bg-axal-lavender disabled:cursor-not-allowed disabled:opacity-55 dark:text-gray-100 dark:hover:bg-violet-900/30" data-testid="team-add-agent">
            <AgentTile size={28} />AI agent
          </button>
          {agentOff ? <span className={`px-2 pb-1.5 ${MUTED}`} data-testid="team-add-agent-off">{agentOff}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/** The four sections, as links (each is its own address): the one in view carries `aria-current="page"`. */
function Tabs({ tab, badges }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Team" className="flex gap-5 overflow-x-auto border-b border-axal-hairline dark:border-gray-800">
      <span className="flex gap-5">
        {TABS.map((t) => (
          <Link key={t.key} to={`${pathname}?tab=${t.key}`} aria-current={tab === t.key ? 'page' : undefined}
            className={`-mb-px flex h-[42px] items-center gap-1.5 whitespace-nowrap border-b-2 text-[13.5px] ${tab === t.key ? 'border-axal-violet font-bold text-axal-ink dark:border-violet-400 dark:text-gray-100' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`team-tab-${t.key}`}>
            {t.label}
            {badges[t.key] ? <span className="rounded-full bg-axal-ground px-1.5 font-mono text-[11px] text-axal-ink dark:bg-gray-800 dark:text-gray-200">{badges[t.key]}</span> : null}
          </Link>
        ))}
      </span>
    </nav>
  );
}

function Toast({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-axal-md bg-axal-ink px-4 py-2.5 text-[13px] font-semibold text-white dark:bg-gray-100 dark:text-gray-900" data-testid="team-toast">
      <span>✓ {notice.text}</span>
      {notice.link ? <input readOnly value={notice.link} className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 font-mono text-[12px] dark:bg-black/10" aria-label="Invitation link" /> : null}
      <button type="button" onClick={onClose} className="ml-auto text-white/80 underline dark:text-gray-700">Dismiss</button>
    </div>
  );
}

/**
 * Change role. The select opens on the person's current role, even one that is
 * not on the list (no role, or a free-text one), and Save stays off until a
 * listed role other than it is chosen: one click never demotes anyone.
 */
function ChangeRoleDialog({ company, person, onClose, onDone }) {
  const current = person.roleKey || '';
  const [role, setRole] = useState(current);
  const copy = { title: `Change ${person.name}’s role`, body: [`${person.name}’s role in ${company.name} changes for every page that reads it.`], button: 'Save', cancel: 'Cancel' };
  return (
    <ActionDialog copy={copy} testId="team-change-role" ready={role !== current && COMPANY_ROLES.includes(role)}
      run={() => teamsApi.updateCompanyMember(company.uid, person.userId, { role_in_company: role })} onClose={onClose} onDone={onDone}>
      <select value={role} onChange={(e) => setRole(e.target.value)} className={FIELD} aria-label="Role" data-testid="team-change-role-select">
        {!COMPANY_ROLES.includes(current) ? <option value={current} disabled>{current ? `${roleWord(current)} (current)` : `${person.primary ? 'Primary admin, no role' : 'No role'} (current)`}</option> : null}
        {COMPANY_ROLES.map((r) => <option key={r} value={r}>{r}{r === current ? ' (current)' : ''}</option>)}
      </select>
    </ActionDialog>
  );
}

function RemoveCompanyMember({ company, person, onClose, onDone }) {
  const copy = { title: `Remove ${person.name} from ${company.name}?`, body: [`${person.name} loses access to ${company.name}. You can invite them again.`], button: 'Remove', cancel: 'Cancel', danger: true };
  return <ActionDialog copy={copy} testId="team-remove" run={() => teamsApi.removeCompanyMember(company.uid, person.userId)} onClose={onClose} onDone={onDone} />;
}

/** Reads one company's team: its detail, the invitations an editor reads, and the vocabulary. */
function useCompanyTeam(uid) {
  const [state, setState] = useState({ status: 'loading' });
  const load = useCallback(async () => {
    const who = me();
    try {
      const detail = await teamsApi.getCompany(uid);
      const powers = companyPowers(detail, who.id);
      const editor = powers.editor || who.role === 'admin';
      const [inv, vocab, mine] = await Promise.all([
        editor ? teamsApi.listCompanyInvitations(uid).then((r) => ({ ok: true, list: Array.isArray(r) ? r : (r?.invitations || []) })).catch((e) => { reportError('team:invitations', e); return { ok: false }; }) : Promise.resolve(null),
        teamsApi.teamVocabulary().catch(() => null),
        // The sidebar's Projects entry lists the company's projects from this read (TM1a, TM1e).
        accountCompaniesApi.projects().catch(() => null),
      ]);
      setState({ status: 'ready', detail, editor, invitations: inv, vocab, meId: who.id, projects: projectsOfCompany(mine?.projects, uid) });
    } catch (e) {
      setState({ status: e?.status === 404 || e?.status === 403 ? 'refused' : 'error', error: e });
    }
  }, [uid]);
  useEffect(() => { load(); }, [load]);
  return [state, load];
}

/** Reads one project's team: the project, its members and pending invitations, and its company. */
function useProjectTeam(id, companies) {
  const [state, setState] = useState({ status: 'loading' });
  const known = useRef(companies);
  known.current = companies;
  const load = useCallback(async () => {
    const who = me();
    try {
      const [project, members, mine] = await Promise.all([
        api.getProject(id),
        teamsApi.listProjectMembers(id),
        accountCompaniesApi.projects().catch(() => null),
      ]);
      const row = (mine?.projects || []).find((p) => String(p.id) === String(id));
      const company = projectCompany(project, { row, companies: known.current });
      setState({ status: 'ready', project, members, company, meId: who.id, projects: projectsOfCompany(mine?.projects, company?.uid) });
    } catch (e) {
      setState({ status: e?.status === 404 || e?.status === 403 ? 'refused' : 'error', error: e });
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  return [state, load];
}

export default function TeamAgentsPage({ form }) {
  return form === 'company' ? <CompanyTeam /> : <ProjectTeam form={form} />;
}

function CompanyTeam() {
  const { uid } = useParams();
  const [state, reload] = useCompanyTeam(uid);
  const detail = state.detail;
  const fresh = scopeFor({ company: { uid, name: detail?.company_name || (state.status === 'loading' ? '…' : null) }, projects: state.projects });
  // One object per drawn scope, so the tabs' reads do not re-run on every render.
  const freshKey = scopeKey(fresh);
  const scope = useMemo(() => fresh, [freshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!scope) return <div className="p-6"><NotAMember name={null} /></div>;
  const company = scope.company;
  return (
    <TeamBody state={state} reload={reload} scope={scope}
      people={detail ? peopleFromCompany(detail, state.meId, state.vocab) : null}
      canEdit={!!state.editor}
      invitations={state.invitations}
      highlightKey={detail && state.invitations?.ok ? freshMemberKey(detail, state.invitations.list) : null}
      target={company}
      onResend={async (i) => teamsApi.resendCompanyInvitation(uid, i.uid)}
      onRevoke={async (i) => teamsApi.revokeCompanyInvitation(uid, i.uid)}
      dialogs={{
        changeRole: (p, close, done) => <ChangeRoleDialog company={company} person={p} onClose={close} onDone={done} />,
        remove: (p, close, done) => <RemoveCompanyMember company={company} person={p} onClose={close} onDone={done} />,
      }} />
  );
}

function ProjectTeam({ form }) {
  const { id, uid } = useParams();
  const { search } = useLocation();
  const { companies } = useActiveCompany();
  const [state, reload] = useProjectTeam(id, companies);
  const p = state.project;
  const fresh = scopeFor({ project: { id, name: p?.name || (state.status === 'loading' ? '…' : null), company: state.status === 'ready' ? state.company : (form === 'company_project' ? { uid, name: null } : null) }, projects: state.projects });
  const freshKey = scopeKey(fresh);
  const scope = useMemo(() => fresh, [freshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!scope) return <div className="p-6"><NotAMember name={null} /></div>;
  if (state.status === 'ready') {
    // One address per form: a project in a company is reached from Company settings › Projects.
    if (scope.kind === 'company_project' && scope.company.uid && (form !== 'company_project' || uid !== scope.company.uid)) {
      return <Navigate replace to={`${companyProjectTeamPath(scope.company.uid, id)}${search}`} />;
    }
    if (scope.kind === 'project' && form !== 'project') return <Navigate replace to={`${projectTeamPath(id)}${search}`} />;
  }
  const read = state.members;
  const team = { id, name: scope.project.name };
  return (
    <TeamBody state={state} reload={reload} scope={scope}
      people={read ? peopleFromProject(read, state.meId) : null}
      canEdit={!!read?.can_manage}
      invitations={read?.can_manage ? { ok: true, list: read.invitations || [] } : null}
      lock={read?.locked ? (read.gate_reason || `Co-founder and advisor invites unlock in Week ${read.unlock_week} of the Spin-Out Lab.`) : null}
      target={team}
      onResend={async (row) => teamsApi.resendProjectInvitation(id, row.id)}
      onRevoke={async (row) => teamsApi.revokeProjectInvitation(id, row.id)}
      dialogs={{
        remove: (m, close, done) => <RemoveMemberDialog venture={team} member={{ userId: m.userId, name: m.name }} onClose={close} onDone={done} />,
      }} />
  );
}

function TeamBody({ state, reload, scope, people, canEdit, invitations, highlightKey, lock, target, onResend, onRevoke, dialogs }) {
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  const tab = tabFrom(search);
  const kind = scope.kind === 'company' ? 'company' : 'project';
  const id = kind === 'company' ? scope.company.uid : scope.project.id;
  const [agentsBlock, setAgentsBlock] = useState(null);
  const [rolesBlock, setRolesBlock] = useState(null);
  const [queueBlock, setQueueBlock] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [actionError, setActionError] = useState('');

  const loadAgents = useCallback(() => {
    setAgentsBlock(null);
    agents.listAgents(kind, id, kind === 'company' && canEdit ? { include: 'projects' } : {}).then(setAgentsBlock);
  }, [kind, id, canEdit]);
  // The agents are their own read: a failed people read still draws the agents card's own state (TM9c1).
  useEffect(() => { if (state.status !== 'loading') loadAgents(); }, [state.status, loadAgents]);
  useEffect(() => { agents.roles().then(setRolesBlock); agents.queue(kind, id, {}).then(setQueueBlock); }, [kind, id]);

  // The sidebar's bottom block draws the scope this page is about (TM1e–TM1g), once it is read.
  usePublishScope(state.status === 'ready' ? scope : null);

  if (state.status === 'refused') return <div className="p-6"><NotAMember name={null} /></div>;
  const reading = state.status === 'loading';
  const name = kind === 'company' ? scope.company.name : scope.project.name;
  const agentList = agentsBlock?.available ? (agentsBlock.value?.agents || []) : [];
  const agentOff = !agentsBlock ? 'Reading the agents…'
    : !agentsBlock.available ? agentsBlock.reason
      : !(agentsBlock.value?.can_manage) ? 'Only this team’s editors add agents.'
        // #3840's list says whether the caller's plan may add (`plan_ok`); `POST …/agents` refuses 403 plan_required otherwise.
        : agentsBlock.value?.plan_ok === false ? refusalWords('plan_required') : null;
  const planLocked = !!(agentsBlock?.available && agentsBlock.value?.can_manage && agentsBlock.value?.plan_ok === false);
  const act = async (key, run, after) => {
    setBusyKey(key); setActionError('');
    try { const out = await run(); after?.(out); await reload(); } catch (e) { reportError('team:invitation', e); setActionError(errorWords(e)); } finally { setBusyKey(null); }
  };
  const invited = (out) => {
    setSheet(null);
    const link = out?.email_sent === false && out?.accept_path ? `${globalThis.location?.origin || ''}${out.accept_path}` : null;
    setNotice(out?.method === 'match' ? { text: 'The co-founder is on the team.' }
      : out?.method === 'account' ? { text: 'The invitation is waiting in their Account › Invitations.' }
      : link ? { text: 'The invitation is saved. The email did not send: copy this link and send it yourself.', link }
        : { text: 'The invitation is saved and sent.' });
    reload();
  };
  // Resend issues a new token (company.ts): the old link is dead at once. With
  // no mail sent, the new link exists only in this answer, so it is handed to
  // the editor exactly as a new invitation's is (TM2c).
  const resentNotice = (out) => {
    const link = out?.email_sent === false && out?.accept_path ? `${globalThis.location?.origin || ''}${out.accept_path}` : null;
    setNotice(link
      ? { text: 'A new link was made and the old one no longer works. The email did not send: copy this link and send it yourself.', link }
      : { text: 'The invitation was resent. The old link no longer works.' });
  };
  const badges = { approvals: countBadge(queueBlock?.available ? queueBlock.value?.counts?.open : null) };

  return (
    <div className="flex flex-col gap-[18px] px-4 pb-8 pt-6 md:px-7" data-testid="team-page" data-scope={scope.kind}>
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={`m-0 ${EYEBROW}`} data-testid="team-eyebrow">{reading ? 'Reading…' : scope.eyebrow}</p>
          <h1 className="m-0 text-[26px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{TITLE}</h1>
          <p className={`m-0 mt-0.5 ${MUTED}`}>{purposeLine(name)}</p>
          {!reading && scope.kind === 'company_project' ? (
            <p role="note" className="m-0 mt-2 w-fit rounded-axal-md bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-ink dark:bg-violet-900/20 dark:text-gray-100" data-testid="team-managed-note">{managedNote(scope.company.name)}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <AskButton label={`Team · ${name}`} />
          {reading || canEdit ? (
            <AddToTeam disabled={reading} reading={reading} canInvite={canEdit} agentOff={agentOff}
              onPerson={() => setSheet({ kind: 'invite' })} onAgent={() => setSheet({ kind: 'agent' })} />
          ) : null}
        </div>
      </header>
      <Tabs tab={tab} badges={badges} />
      <Toast notice={notice} onClose={() => setNotice(null)} />
      {actionError ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{actionError}</p> : null}

      {tab === 'people' ? (
        <>
          <PeopleCard kind={kind} people={people} loading={reading} error={state.status === 'error'} onRetry={reload}
            canEdit={canEdit} company={scope.company?.name} lock={lock} highlightKey={highlightKey}
            onChangeRole={(p) => setDialog({ kind: 'changeRole', p })} onRemove={(p) => setDialog({ kind: 'remove', p })}>
            {!reading && canEdit && invitations ? (
              <InvitationsBlock kind={kind} invitations={invitations.list} error={invitations.ok === false} onRetry={reload}
                busyKey={busyKey} freshKey={fresh}
                onResend={(i) => act(kind === 'company' ? i.uid : i.key, () => onResend(i), kind === 'company' ? resentNotice : (out) => setNotice({ text: projectResentWords(out) }))}
                onRevoke={(i) => act(kind === 'company' ? i.uid : i.key, () => onRevoke(i))} />
            ) : null}
          </PeopleCard>
          <AgentsCard block={agentsBlock} loading={!agentsBlock} kind={kind} companyName={name}
            canAdd={!!agentsBlock?.value?.can_manage && !planLocked} planLocked={planLocked} onAdd={() => setSheet({ kind: 'agent' })}
            onOpen={(row) => setSheet({ kind: 'profile', uid: row.uid })} onRetry={loadAgents} />
          {kind === 'company' && ['founder', 'admin'].includes(me().role) ? <p className={`m-0 ${MUTED}`}>{ROSTER_LINE} <Link to="/build/team" className={BTN_TEXT}>Open Build › Team</Link></p> : null}
        </>
      ) : null}
      {tab === 'roles' ? <RulebooksTab scope={scope} canManage={!!agentsBlock?.value?.can_manage} agentsBlock={agentsBlock} /> : null}
      {tab === 'approvals' ? <ApprovalsTab scope={scope} /> : null}
      {tab === 'settings' ? (
        <TeamSettingsTab scope={scope} agentsBlock={agentsBlock} canManage={canEdit}
          onEditCap={(a) => setSheet({ kind: 'profile', uid: a.uid, edit: 'cap' })}
          onOpenRulebook={(a) => navigate(`${pathname}?tab=roles&role=${encodeURIComponent(a.role_key)}`)} />
      ) : null}

      {sheet?.kind === 'invite' ? <InviteSheet kind={kind} target={target} pending={invitations?.ok ? invitations.list : null} onClose={() => setSheet(null)} onDone={(out) => { if (out?.invitations?.[0]?.uid) setFresh(out.invitations[0].uid); invited(out); }} /> : null}
      {sheet?.kind === 'agent' && rolesBlock?.available ? (
        <AddAgentSheet scope={scope} roles={rolesBlock.value?.roles} models={rolesBlock.value?.models} held={agentList.map((a) => a.role_key)}
          me={{ name: me().name }} onClose={() => setSheet(null)} onAdded={() => { setSheet(null); loadAgents(); }}
          onEditRulebook={(key) => { setSheet(null); navigate(`${pathname}?tab=roles&role=${encodeURIComponent(key)}`); }} />
      ) : null}
      {sheet?.kind === 'profile' ? <AgentProfileSheet uid={sheet.uid} editCap={sheet.edit === 'cap'} canManage={!!agentsBlock?.value?.can_manage} onClose={() => setSheet(null)} onChanged={() => { setSheet(null); loadAgents(); }} /> : null}
      {dialog && dialogs[dialog.kind] ? dialogs[dialog.kind](dialog.p, () => setDialog(null), () => { setDialog(null); reload(); }) : null}
    </div>
  );
}
