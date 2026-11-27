import React, { useEffect, useState } from 'react';
import { Sheet } from '../../ui';
import { api } from '../../lib/api';
import { teamsApi } from '../../lib/api/teams.js';
import { reportError } from '../../lib/log';
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, MUTED } from './teamUi.jsx';
import {
  AUTHORITY_KEYS, COMPANY_ROLES, COMPANY_ROLE_HELP, INVITE_NOTE, SEARCH_DEBOUNCE_MS, SEARCH_HINT, SEARCH_MIN, SEARCH_SHORT, accountRefusalWords, authorityWord,
  companyInvitationLine, errorWords, maskEmail, meanings, projectInvitationRow, sharedLine, suggestedAuthority,
} from './teamModel.js';

/**
 * D1497 (#3727, TM2a, TM2b, TM9a2) — "Invite people", a Sheet at 520.
 *
 * COMPANY (wired): `POST /api/company/:uid/invitations` with
 * `{ email, role_in_company, title, authority }`. The roles are the stored
 * words (owner Q4 open): Owner, Admin, Founder or Member. Titles and what each
 * authority level means come from `GET /api/company/team-vocabulary`; the
 * ladder's default for a title is offered as "Suggested for …", never set
 * behind the person's back. A duplicate is said inside the form (TM9a2).
 *
 * PROJECT (wired): By email (`POST /api/projects/:id/invitations`, mode email),
 * Link an existing Axal account (#3841) and Co-founder match
 * (`POST /api/projects/:id/members`, mode cofounder_match, from the owner's
 * active matches). Linking an account searches by name
 * (`GET /api/account/people/search`, debounced, at least `SEARCH_MIN`
 * letters; 400 query_too_short is the same hint), draws each person's name and
 * what they share with you, and never an email or a numeric id: a pick is the
 * account's uid, sent as `{ mode: 'account', user_uid, role }`. 404
 * account_not_found, 403 not_reachable and 409 already_member /
 * already_pending come back in words about the person. No numeric user-id
 * field, ever.
 *
 * PENDING INVITATIONS (TM2b): the ones already waiting are listed under the
 * form, from the invitations the page already read, so an editor sees who is
 * invited before inviting again. The invite methods are a radio group, not
 * tabs: they switch the form in place.
 *
 * NOT DRAWN: the canvas's optional Message. No invitation store keeps a
 * message, so a field would be a promise the Worker does not keep; its Ask
 * field trigger waits for #3693 in any case.
 */

const SECTION = 'flex flex-col gap-1.5';
const LABEL = 'text-[13px] font-semibold text-axal-ink dark:text-gray-100';
const OPTIONAL = 'font-normal text-axal-muted dark:text-gray-400';

export default function InviteSheet({ kind, target, pending = null, onClose, onDone }) {
  return kind === 'company'
    ? <CompanyInvite company={target} pending={pending} onClose={onClose} onDone={onDone} />
    : <ProjectInvite project={target} pending={pending} onClose={onClose} onDone={onDone} />;
}

/** The invitations already waiting, as the page read them; nothing drawn when they were not read. */
function PendingList({ kind, list }) {
  if (!Array.isArray(list)) return null;
  const rows = list.filter((i) => String(i?.status || 'pending').toLowerCase() === 'pending');
  return (
    <section className="flex flex-col gap-1.5" data-testid="invite-pending">
      <span className={LABEL}>Pending invitations</span>
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map((i) => (
            <li key={kind === 'company' ? i.uid : i.id} className="font-mono text-[12px] text-axal-ink dark:text-gray-200">
              {kind === 'company' ? companyInvitationLine(i) : projectInvitationRow(i).line}
            </li>
          ))}
        </ul>
      ) : <span className={MUTED}>No invitation is waiting.</span>}
    </section>
  );
}

function Footer({ onClose, ready, busy, label = 'Send invitation', onSend }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy} data-testid="invite-cancel">Cancel</button>
      <button type="button" className={BTN_PRIMARY} onClick={onSend} disabled={!ready || busy} data-testid="invite-send">{busy ? 'Sending…' : label}</button>
    </div>
  );
}

const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

function CompanyInvite({ company, pending, onClose, onDone }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Member');
  const [title, setTitle] = useState('');
  const [authority, setAuthority] = useState('');
  const [vocab, setVocab] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => teamsApi.teamVocabulary())
      .then((v) => { if (alive) setVocab(v || false); })
      .catch(() => { if (alive) setVocab(false); });
    return () => { alive = false; };
  }, []);
  const titles = vocab ? [...(vocab.ladder || []).map((r) => r.title), ...(vocab.functions || []).map((f) => f.name)].filter(Boolean) : [];
  const meaning = meanings(vocab);
  const suggestion = suggestedAuthority(title, vocab);
  const ready = looksLikeEmail(email);
  const send = async () => {
    if (!ready || busy) return;
    setBusy(true); setRefusal('');
    try {
      const out = await teamsApi.inviteCompanyMember(company.uid, { email: email.trim(), role_in_company: role, title: title || null, authority: authority || null });
      onDone({ ...out, email: email.trim() });
    } catch (e) {
      reportError('team:invite-company', e);
      setRefusal(e?.status === 409 && !e?.code ? `${maskEmail(email)} is already on this team.` : errorWords(e));
    } finally { setBusy(false); }
  };
  return (
    <Sheet title="Invite people" sub={company.name} width={520} onClose={onClose} testId="invite-sheet"
      footer={<Footer onClose={onClose} ready={ready} busy={busy} onSend={send} />}>
      <div className="flex flex-col gap-5 px-5 py-5">
        <label className={SECTION}>
          <span className={LABEL}>Email</span>
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setRefusal(''); }} aria-invalid={refusal ? 'true' : undefined}
            className={`${FIELD} ${refusal ? 'border-2 border-axal-destructive dark:border-red-400' : ''}`} data-testid="invite-email" />
          {refusal ? <span role="alert" className="text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="invite-refusal">{refusal}</span> : null}
        </label>
        <label className={SECTION}>
          <span className={LABEL}>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={FIELD} data-testid="invite-role">
            {COMPANY_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <span className={MUTED}>{COMPANY_ROLE_HELP}</span>
        </label>
        <label className={SECTION}>
          <span className={LABEL}>Title <span className={OPTIONAL}>(optional)</span></span>
          {vocab === false ? <span className={MUTED} data-testid="invite-titles-unread">The titles could not be read. Send without one, or try again later.</span> : (
            <select value={title} onChange={(e) => setTitle(e.target.value)} disabled={!vocab} className={FIELD} data-testid="invite-title">
              <option value="">{vocab ? 'No title' : 'Reading…'}</option>
              {titles.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {vocab ? <span className={MUTED}>{(vocab.ladder || []).map((r) => r.title).join(' · ')}{(vocab.functions || []).length ? `, or a function: ${(vocab.functions || []).map((f) => f.name).filter(Boolean).join(', ')}.` : '.'}</span> : null}
        </label>
        <fieldset className={`${SECTION} m-0 border-0 p-0`}>
          <legend className={`${LABEL} mb-1.5`}>Authority</legend>
          <div role="radiogroup" aria-label="Authority" className="flex flex-col gap-1.5" data-testid="invite-authority">
            {AUTHORITY_KEYS.map((a) => {
              const on = authority === a;
              return (
                <label key={a} className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-axal-md border px-3 py-2 ${on ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline dark:border-gray-700'}`}>
                  <input type="radio" name="authority" checked={on} onChange={() => setAuthority(a)} className="accent-violet-600" data-testid={`invite-authority-${a}`} />
                  <span className="min-w-0 flex-1">
                    <b className="block text-[13px] text-axal-ink dark:text-gray-100">{authorityWord(a)}</b>
                    {meaning[a] ? <span className={MUTED}>{meaning[a]}</span> : null}
                  </span>
                  {suggestion?.authority === a ? <span className="rounded-axal-pill border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 text-[11px] font-semibold text-axal-violet-deep dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-300">Suggested for {title}</span> : null}
                </label>
              );
            })}
          </div>
          {suggestion ? <span className={MUTED} data-testid="invite-suggestion">{suggestion.line}</span> : null}
        </fieldset>
        <p className={`m-0 rounded-axal-md bg-axal-ground px-3 py-2.5 dark:bg-gray-900 ${MUTED}`}>{INVITE_NOTE}</p>
        <PendingList kind="company" list={pending} />
      </div>
    </Sheet>
  );
}

const METHODS = [
  { key: 'email', label: 'By email' },
  { key: 'account', label: 'Link an existing Axal account' },
  { key: 'match', label: 'Co-founder match' },
];

function ProjectInvite({ project, pending, onClose, onDone }) {
  const [method, setMethod] = useState('email');
  const [role, setRole] = useState('cofounder');
  const [email, setEmail] = useState('');
  const [matches, setMatches] = useState(null);
  const [pick, setPick] = useState('');
  const [person, setPerson] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  useEffect(() => {
    if (method !== 'match' || matches !== null) return undefined;
    let alive = true;
    Promise.resolve().then(() => api.cofounderListConnections())
      .then((r) => { const items = Array.isArray(r) ? r : (r?.items || []); if (alive) setMatches(items.filter((c) => c.status === 'active')); })
      .catch(() => { if (alive) setMatches(false); });
    return () => { alive = false; };
  }, [method, matches]);
  const ready = method === 'email' ? looksLikeEmail(email) : method === 'match' ? !!pick : method === 'account' ? !!person?.uid : false;
  const send = async () => {
    if (!ready || busy) return;
    setBusy(true); setRefusal('');
    try {
      const out = method === 'email'
        ? await teamsApi.createProjectInvitation(project.id, { mode: 'email', email: email.trim(), role })
        : method === 'account'
          ? await teamsApi.createProjectInvitation(project.id, { mode: 'account', user_uid: person.uid, role })
          : await teamsApi.addProjectMember(project.id, { mode: 'cofounder_match', connection_uid: pick, role });
      onDone({ ...out, method });
    } catch (e) {
      reportError('team:invite-project', e);
      setRefusal(method === 'account' ? accountRefusalWords(e) : errorWords(e));
    } finally { setBusy(false); }
  };
  return (
    <Sheet title="Invite people" sub={`${project.name} · project`} width={520} onClose={onClose} testId="invite-sheet"
      footer={<Footer onClose={onClose} ready={ready} busy={busy} onSend={send} label={method === 'match' ? 'Add co-founder' : 'Send invitation'} />}>
      <div className="flex flex-col gap-5 px-5 py-5">
        <div role="radiogroup" aria-label="How to invite" className="grid grid-cols-3 gap-1 rounded-axal-md bg-axal-ground p-1 dark:bg-gray-900">
          {METHODS.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={method === m.key}
              onClick={() => { setMethod(m.key); setRefusal(''); }}
              className={`rounded-[7px] px-2 py-2 text-[12.5px] font-semibold ${method === m.key ? 'bg-white text-axal-ink shadow-sm dark:bg-gray-800 dark:text-gray-100' : 'text-axal-muted disabled:cursor-not-allowed disabled:opacity-55 dark:text-gray-400'}`}
              data-testid={`invite-method-${m.key}`}>{m.label}</button>
          ))}
        </div>
        <fieldset className={`${SECTION} m-0 border-0 p-0`}>
          <legend className={`${LABEL} mb-1.5`}>Role</legend>
          <div role="radiogroup" aria-label="Role" className="flex gap-2">
            {[['cofounder', 'Co-founder'], ['advisor', 'Advisor']].map(([k, label]) => (
              <label key={k} className={`flex h-10 flex-1 cursor-pointer items-center gap-2 rounded-axal-md border px-3 text-[13px] ${role === k ? 'border-axal-violet bg-axal-lavender text-axal-ink dark:border-violet-500 dark:bg-violet-900/30 dark:text-gray-100' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-200'}`}>
                <input type="radio" name="seat" checked={role === k} onChange={() => setRole(k)} className="accent-violet-600" data-testid={`invite-seat-${k}`} />{label}
              </label>
            ))}
          </div>
        </fieldset>
        {method === 'email' ? (
          <label className={SECTION}>
            <span className={LABEL}>Email</span>
            <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setRefusal(''); }} className={FIELD} data-testid="invite-email" />
          </label>
        ) : null}
        {method === 'account' ? (
          <AccountSearch project={project} picked={person} onPick={(p) => { setPerson(p); setRefusal(''); }} />
        ) : null}
        {method === 'match' ? (
          <div className={SECTION}>
            <span className={LABEL}>Your co-founder matches</span>
            {matches === null ? <span className={MUTED}>Reading…</span>
              : matches === false ? <span className={MUTED} data-testid="invite-matches-unread">Your matches could not be read. That is not the same as having none.</span>
                : !matches.length ? <span className={MUTED}>No active co-founder match yet. A match is active once you both sign the NDA.</span>
                  : (
                    <div role="radiogroup" aria-label="Co-founder match" className="flex flex-col gap-1.5">
                      {matches.map((c) => (
                        <label key={c.uid} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-axal-md border px-3 text-[13px] ${pick === c.uid ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline dark:border-gray-700'}`}>
                          <input type="radio" name="match" checked={pick === c.uid} onChange={() => setPick(c.uid)} className="accent-violet-600" />
                          <span className="text-axal-ink dark:text-gray-100">{c.counterparty?.name || 'A match'}</span>
                        </label>
                      ))}
                    </div>
                  )}
          </div>
        ) : null}
        {refusal ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="invite-refusal">{refusal}</p> : null}
        <p className={`m-0 rounded-axal-md bg-axal-ground px-3 py-2.5 dark:bg-gray-900 ${MUTED}`}>{INVITE_NOTE}</p>
        <PendingList kind="project" list={pending} />
      </div>
    </Sheet>
  );
}

/**
 * "Link an existing Axal account" (TM2b, #3841): a name, searched once typing
 * rests, among the people who share a company or a co-founder match with you
 * and are not on this team yet. Each result is its name and what you share,
 * never an email and never a numeric id; the pick is the account's uid.
 * Fewer than `SEARCH_MIN` letters is not sent; the Worker's 400
 * query_too_short says the same words. A failed search is "could not be
 * read", never "nobody".
 */
function AccountSearch({ project, picked, onPick }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ status: 'idle' });
  useEffect(() => {
    const term = q.trim();
    if (term.length < SEARCH_MIN) { setFound({ status: term ? 'short' : 'idle' }); return undefined; }
    let alive = true;
    setFound((f) => (f.status === 'ready' ? f : { status: 'reading' }));
    const timer = setTimeout(() => {
      teamsApi.searchPeople(term, { project: project.id })
        .then((r) => { if (alive) setFound({ status: 'ready', people: Array.isArray(r?.people) ? r.people : [] }); })
        .catch((e) => {
          if (!alive) return;
          const code = e?.code || e?.data?.code || null;
          if (e?.status === 400 && code === 'query_too_short') setFound({ status: 'short' });
          else { reportError('team:people-search', e); setFound({ status: 'error' }); }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, project.id]);
  const people = found.status === 'ready' ? found.people.filter((p) => p?.uid) : [];
  return (
    <div className={SECTION}>
      <label className={SECTION}>
        <span className={LABEL}>Name</span>
        <input type="search" value={q} autoComplete="off" onChange={(e) => { setQ(e.target.value); onPick(null); }}
          aria-describedby="invite-account-hint" className={FIELD} data-testid="invite-account-q" />
      </label>
      <span id="invite-account-hint" className={MUTED} data-testid="invite-account-hint">{found.status === 'short' ? SEARCH_SHORT : SEARCH_HINT}</span>
      <div aria-live="polite" data-testid="invite-account-results">
        {found.status === 'reading' ? <span className={MUTED}>Searching…</span>
          : found.status === 'error' ? <span className={MUTED} data-testid="invite-account-unread">The search could not be read. That is not the same as nobody matching.</span>
            : found.status === 'ready' && !people.length ? <span className={MUTED} data-testid="invite-account-none">Nobody you share a company or a match with has that name, or they are already on this team.</span>
              : found.status === 'ready' ? (
                <div role="radiogroup" aria-label="Axal account" className="flex flex-col gap-1.5">
                  {people.map((p) => {
                    const on = picked?.uid === p.uid;
                    const shared = sharedLine(p);
                    return (
                      <label key={p.uid} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-axal-md border px-3 py-1.5 text-[13px] ${on ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline dark:border-gray-700'}`}>
                        <input type="radio" name="account" checked={on} onChange={() => onPick({ uid: p.uid, name: p.name })} className="accent-violet-600" data-testid={`invite-account-${p.uid}`} />
                        <span className="min-w-0">
                          <span className="block text-axal-ink dark:text-gray-100">{p.name || 'An Axal VC account'}</span>
                          {shared ? <span className={`block ${MUTED}`}>{shared}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
      </div>
    </div>
  );
}
