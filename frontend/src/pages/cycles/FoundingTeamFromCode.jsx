import { useState } from 'react';
import { cyclesWrite } from '../../lib/api/cycles';
import { buildsText, membersOnlyText, teamView } from './teamFromCode';

/**
 * D782 (#2115) — Founding team's "From GitHub" part (`id="from-github"`),
 * from the module read's `parts.github`:
 *
 *   - each founder a login is matched to, with "Builds: N commits in the
 *     last 90 days" per repository, and Unmatch;
 *   - Not yet matched: each login that is not, with the founder's own
 *     control to match it to a founder on the cap table. A login is never
 *     matched by name or email: only this control matches one.
 *
 * Logins and commit counts reach only the project's members; anyone else
 * reads how many arrived. Nothing is drawn when GitHub brought no one.
 */
export default function FoundingTeamFromCode({ part, projectId, reload }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState({});
  const view = teamView(part);
  if (view.empty) return null;
  const write = async (key, fn, fallback) => {
    setBusy(key); setError('');
    try { await fn(); reload?.(); }
    catch (e) { setError(e?.message || fallback); }
    finally { setBusy(null); }
  };
  const match = (login) => {
    const holderId = Number(choice[login]);
    if (!Number.isSafeInteger(holderId) || holderId <= 0) { setError('Choose a founder first.'); return; }
    return write(`match:${login}`, () => cyclesWrite.build.matchGithubLogin(projectId, { login, holder_id: holderId }), 'That login could not be matched.');
  };
  const unmatch = (login) => write(`unmatch:${login}`, () => cyclesWrite.build.unmatchGithubLogin(projectId, login), 'That login could not be unmatched.');
  return (
    <section id="from-github" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-team-github" aria-labelledby="from-github-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="from-github-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From GitHub</h2>
        <span className={FAINT}>Who builds, from the GitHub sync</span>
      </div>
      {view.state === 'unreadable' && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="team-github-unreadable">Unreadable: {view.reason}</p>}
      {view.state === 'members_only' && <p className={MUTED} data-testid="team-github-members-only">{membersOnlyText(view.logins, 'contributor', 'contributors')}</p>}
      {view.state === 'ok' && (
        <>
          {view.builds.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="team-github-builds">
              {view.builds.map((b) => (
                <li key={b.record_id} className="flex flex-col gap-1 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`team-builds-${b.record_id}`}>
                  <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{b.name}</p>
                  {b.repositories.map((r) => (
                    <div key={`${r.repository}:${r.login}`} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className={LINE}>{buildsText(r.commits_90d)} <span className={FAINT}>· {r.repository} · {r.login}</span></span>
                      <button type="button" disabled={busy != null} onClick={() => unmatch(r.login)} data-testid={`team-unmatch-${r.login}`}
                        className="text-[11px] font-bold text-axal-muted hover:underline disabled:opacity-50 dark:text-gray-400">{busy === `unmatch:${r.login}` ? 'Saving…' : 'Unmatch'}</button>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {view.unmatched.length > 0 && (
            <div className="flex flex-col gap-1.5" data-testid="team-github-unmatched">
              <h3 className={SUB}>Not yet matched</h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {view.unmatched.map((u) => (
                  <li key={u.login} className="flex flex-col gap-1 border-b border-axal-ground pb-2 last:border-b-0 dark:border-gray-800" data-testid={`team-unmatched-${u.login}`}>
                    <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{u.login}</span>
                    <span className={FAINT}>{u.repositories.map((r) => `${r.repository}: ${r.commits_90d ?? 0}`).join(' · ')} commits in the last 90 days</span>
                    {view.founders.length === 0
                      ? <span className={FAINT}>Add a founder to the cap table to match this login.</span>
                      : (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <label className="sr-only" htmlFor={`team-founder-${u.login}`}>The founder this login belongs to</label>
                          <select id={`team-founder-${u.login}`} value={choice[u.login] ?? ''} onChange={(e) => setChoice((c) => ({ ...c, [u.login]: e.target.value }))} data-testid={`team-founder-${u.login}`}
                            className="rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                            <option value="">Choose a founder</option>
                            {view.founders.map((f) => <option key={f.holder_id} value={f.holder_id}>{f.name || 'A founder'}</option>)}
                          </select>
                          <button type="button" disabled={busy != null} onClick={() => match(u.login)} data-testid={`team-match-${u.login}`}
                            className="rounded-md bg-axal-violet px-3 py-1 text-[12px] font-bold text-white transition-colors hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50">{busy === `match:${u.login}` ? 'Saving…' : 'Match'}</button>
                        </div>
                      )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="team-github-error">{error}</p>}
        </>
      )}
    </section>
  );
}

const SUB = 'm-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const LINE = 'm-0 text-[12px] text-axal-ink/80 dark:text-gray-300';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const FAINT = 'text-[11px] text-axal-faint dark:text-gray-500';
