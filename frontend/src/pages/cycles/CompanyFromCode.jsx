import { useState } from 'react';
import { cyclesWrite } from '../../lib/api/cycles';
import { companyView, licenceText, membersOnlyText, ownerText } from './teamFromCode';

/**
 * D782 (#2115) — Company creation's "From GitHub" part (`id="from-github"`),
 * from the module read's `parts.github`:
 *
 *   - Where the code sits: each chosen repository, who owns it, and its
 *     licence as a fact ("No licence file"), never advice;
 *   - Proposed from code: "Move the code into the company's GitHub
 *     organisation", with its reason, for a repository a personal account
 *     owns. Accept makes it a formation step; Dismiss keeps it away. Nothing
 *     is written without Accept;
 *   - Evidence: an organisation-owned repository recorded on the IP
 *     assignment step.
 *
 * An owner's login reaches only the project's members. Nothing is drawn when
 * GitHub brought nothing.
 */
export default function CompanyFromCode({ part, projectId, reload }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const view = companyView(part);
  if (view.empty) return null;
  const decide = async (id, how) => {
    setBusy(id); setError('');
    try {
      await (how === 'accept' ? cyclesWrite.build.acceptCompanyProposal : cyclesWrite.build.dismissCompanyProposal)(projectId, id);
      reload?.();
    } catch (e) {
      setError(e?.message || (how === 'accept' ? 'That proposal could not be accepted.' : 'That proposal could not be dismissed.'));
    } finally { setBusy(null); }
  };
  return (
    <section id="from-github" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-company-github" aria-labelledby="from-github-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="from-github-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From GitHub</h2>
        <span className={FAINT}>Where the code sits, from the GitHub sync</span>
      </div>
      {view.state === 'unreadable' && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="company-github-unreadable">Unreadable: {view.reason}</p>}
      {view.state === 'members_only' && <p className={MUTED} data-testid="company-github-members-only">{membersOnlyText(view.total, 'repository', 'repositories')}</p>}
      {view.state === 'ok' && (
        <>
          {view.repositories.length > 0 && (
            <div className="flex flex-col gap-1.5" data-testid="company-github-repositories">
              <h3 className={SUB}>Where the code sits</h3>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {view.repositories.map((r) => (
                  <li key={r.repository} className="flex flex-col" data-testid={`company-repo-${r.repository}`}>
                    <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{r.repository}</span>
                    <span className={LINE}>{ownerText(r)} · {licenceText(r)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {view.proposals.length > 0 && (
            <div className="flex flex-col gap-1.5" data-testid="company-github-proposals">
              <h3 className={SUB}>Proposed from code</h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {view.proposals.map((p) => (
                  <li key={p.id} className="flex flex-col gap-1 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`company-proposal-${p.id}`}>
                    <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{p.title}</p>
                    <span className={FAINT}>{p.repository} · Proposed by GitHub</span>
                    {p.reason && <p className={LINE}>{p.reason}</p>}
                    <div className="flex gap-2 pt-1">
                      <button type="button" disabled={busy != null} onClick={() => decide(p.id, 'accept')} data-testid={`company-accept-${p.id}`}
                        className="rounded-md bg-axal-violet px-3 py-1 text-[12px] font-bold text-white transition-colors hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50">{busy === p.id ? 'Saving…' : 'Accept'}</button>
                      <button type="button" disabled={busy != null} onClick={() => decide(p.id, 'dismiss')} data-testid={`company-dismiss-${p.id}`}
                        className="rounded-md border border-axal-hairline px-3 py-1 text-[12px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">Dismiss</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="company-github-error">{error}</p>}
          {view.evidence.length > 0 && (
            <div className="flex flex-col gap-1.5" data-testid="company-github-evidence">
              <h3 className={SUB}>Evidence</h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {view.evidence.map((e) => (
                  <li key={`${e.record_id}:${e.repository}`} className={LINE} data-testid={`company-evidence-${e.repository}`}>{e.step}: {e.repository} sits in an organisation</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const SUB = 'm-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const LINE = 'm-0 text-[12px] text-axal-ink/80 dark:text-gray-300';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const FAINT = 'text-[11px] text-axal-faint dark:text-gray-500';
