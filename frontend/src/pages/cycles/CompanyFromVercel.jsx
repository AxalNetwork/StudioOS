import { useState } from 'react';
import { cyclesWrite } from '../../lib/api/cycles';
import { Lightbox, actionGhost, actionPrimary } from '../../ui';

/**
 * D1099 (#2964, Vercel part 4) — Company creation's "From Vercel" part
 * (`id="from-vercel"`), from the module read's `parts.vercel`: VC4b and VC4d
 * of `design/incoming/From Vercel Page.dc.html`.
 *
 *   - Where production runs: each chosen project's account (a personal Vercel
 *     account or a team) and its plan, as facts. A plan Vercel did not give is
 *     "Not recorded", never guessed;
 *   - Proposal · from your Vercel facts: on the Hobby plan, "Move the
 *     production project to the company's Vercel team on a paid plan", with
 *     Vercel's reason. Accept… opens a dialog that says what it changes (a
 *     formation step, nothing on Vercel); Dismiss keeps it away.
 *
 * A project reaches only the project's members. Nothing is drawn when Vercel
 * brought nothing. Mounted by `buildParts.jsx`'s `'vercel'` line on
 * `company-creation` (D1311).
 */

/** The part's state from `parts.vercel`: none, unreadable, members only, or ok. */
export function vercelCompanyView(part) {
  if (!part || typeof part !== 'object') return { state: 'none', empty: true, projects: [], proposals: [] };
  if (part.state === 'unreadable') return { state: 'unreadable', empty: false, reason: part.reason || 'What Vercel brought could not be read.', projects: [], proposals: [] };
  const total = Number.isSafeInteger(part.projects_total) && part.projects_total > 0 ? part.projects_total : 0;
  if (part.members_only) return { state: 'members_only', empty: !total, total, projects: [], proposals: [] };
  const projects = (Array.isArray(part.projects) ? part.projects : []).filter((p) => p && typeof p.vercel_project_id === 'string');
  const proposals = (Array.isArray(part.proposals) ? part.proposals : []).filter((p) => p && Number.isSafeInteger(p.id) && typeof p.title === 'string');
  return { state: 'ok', empty: !projects.length && !proposals.length, total, projects, proposals };
}

/** The dialog's sentence (VC4d): the step's title in quotes, for the venture by name when known. */
export const stepSentence = (title, venture) =>
  `“${String(title).replace(/\.$/, '')}” becomes a step in Company creation, for ${venture && String(venture).trim() ? String(venture).trim() : 'this venture'}.`;

export default function CompanyFromVercel({ part, projectId, ventureName, reload }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(null);
  const view = vercelCompanyView(part);
  if (view.empty) return null;
  const decide = async (id, how) => {
    setBusy(id); setError('');
    try {
      await (how === 'accept' ? cyclesWrite.build.acceptVercelProposal : cyclesWrite.build.dismissVercelProposal)(projectId, id);
      setAsking(null);
      reload?.();
    } catch (e) {
      setError(e?.message || (how === 'accept' ? 'That proposal could not be accepted. Nothing changed.' : 'That proposal could not be dismissed.'));
    } finally { setBusy(null); }
  };
  return (
    <section id="from-vercel" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-company-vercel" aria-labelledby="from-vercel-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="from-vercel-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From Vercel</h2>
        <span className={FAINT}>Where production runs, from the Vercel sync</span>
      </div>
      {view.state === 'unreadable' && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="company-vercel-unreadable">Unreadable: {view.reason}</p>}
      {view.state === 'members_only' && <p className={MUTED} data-testid="company-vercel-members-only">{view.total} {view.total === 1 ? 'project' : 'projects'} arrived from Vercel. Only the project’s members see which.</p>}
      {view.state === 'ok' && (
        <>
          {view.projects.map((p) => (
            <dl key={p.vercel_project_id} className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]" data-testid={`company-vercel-facts-${p.vercel_project_id}`}>
              <dt className={DT}>Account</dt><dd className={DD} data-testid={`company-vercel-account-${p.vercel_project_id}`}>{p.account || 'Not recorded'}</dd>
              <dt className={DT}>Plan</dt>
              <dd className={DD} data-testid={`company-vercel-plan-${p.vercel_project_id}`}>
                {p.plan_word || <span className="italic text-axal-muted dark:text-gray-400" title={p.plan_note || undefined}>{p.plan_note || 'Not recorded'}</span>}
              </dd>
              <dt className={DT}>Project</dt><dd className={`${DD} font-mono`}>{p.project || p.vercel_project_id}</dd>
            </dl>
          ))}
          {view.proposals.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 rounded-lg border border-axal-hairline px-3 py-2.5 dark:border-gray-800" data-testid={`company-vercel-proposal-${p.id}`}>
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400">Proposal · from your Vercel facts</span>
                <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{p.title}.</span>
                {p.reason && <span className="text-[12px] text-axal-ink/80 dark:text-gray-300">{p.reason}</span>}
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={busy != null} onClick={() => setAsking(p)} className={actionPrimary} data-testid={`company-vercel-accept-${p.id}`}>Accept…</button>
                <button type="button" disabled={busy != null} onClick={() => decide(p.id, 'dismiss')} className={actionGhost} data-testid={`company-vercel-dismiss-${p.id}`}>Dismiss</button>
              </div>
            </div>
          ))}
          {error && !asking && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="company-vercel-error">{error}</p>}
        </>
      )}
      {asking && (
        <Lightbox label="Add a formation step" title="Accept this proposal?" onClose={() => { if (busy == null) { setAsking(null); setError(''); } }} width={520} testId="company-vercel-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={actionGhost} disabled={busy != null} onClick={() => { setAsking(null); setError(''); }} data-testid="company-vercel-cancel">Cancel</button>
              <button type="button" className={actionPrimary} disabled={busy != null} onClick={() => decide(asking.id, 'accept')} data-testid="company-vercel-add">{busy === asking.id ? 'Adding…' : 'Add the step'}</button>
            </div>
          )}>
          <div className="flex flex-col gap-3 text-[13px]">
            <p className="m-0 text-axal-ink dark:text-gray-100" data-testid="company-vercel-dialog-sentence">{stepSentence(asking.title, ventureName)}</p>
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] text-axal-ink dark:bg-gray-800 dark:text-gray-100">Adds a formation step. Nothing changes on Vercel.</div>
            {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="company-vercel-dialog-error">{error}</p>}
          </div>
        </Lightbox>
      )}
    </section>
  );
}

const DT = 'font-semibold text-axal-muted dark:text-gray-400';
const DD = 'm-0 text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const FAINT = 'text-[11px] text-axal-faint dark:text-gray-500';
