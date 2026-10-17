/**
 * D564 (#1168) — the founder's /studio zones, over the reads `FounderStudioHome`
 * makes. Apart from the home so a Node test renders every state: the home
 * mounts StudioInterview, whose imports reach Worker modules.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, RefreshCw } from 'lucide-react';
import { Unrecorded, Unreadable } from '../../ui';
import {
  LOADING, UNREADABLE, NOT_RECORDED, EMPTY, READY, NO_STORE,
  headerOf, summaryOf, actionsOf, progressOf, questionsOf, activityOf, modulesOf, profileOf,
} from './founderStudioModel';

/** The canvas's zones over a set of reads. Exported so each state renders in a test. */
export default function FounderStudioBody({ user, reads, onRetry, advisorAvailable = null, children = null, profileCard = null, now = Date.now() }) {
  const header = useMemo(() => headerOf({ user, project: reads.project, lab: reads.lab }), [user, reads.project, reads.lab]);
  const summary = summaryOf(reads);
  const actions = actionsOf(reads);
  const progress = progressOf(reads.lab);
  const questions = questionsOf(reads);
  const activity = activityOf({ activity: reads.activity, now });
  const modules = modulesOf(reads);
  const profile = profileOf(reads);

  return (
    <section className="fs-root" data-testid="founder-studio-home">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[24px] font-extrabold tracking-tight" data-testid="text-founder-studio-title">Studio</h2>
            {header.phase && <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" data-testid="badge-founder-studio-phase">{header.phase}</span>}
            {header.phaseState === UNREADABLE && <span className="text-[11px] text-axal-muted"><Unrecorded reason="The Lab state could not be read.">Phase unreadable</Unrecorded></span>}
          </div>
          <p className="mt-1.5 max-w-[620px] text-[13.5px] text-axal-muted" data-testid="text-founder-studio-context">
            <strong className="font-bold text-axal-ink dark:text-white">{header.company || (header.companyState === LOADING ? '…' : 'No company record yet')}</strong>
            {' · '}{header.founderLine}: everything you have built across the platform, what it unlocked, and what to do next.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={header.profileHref} className="rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold dark:border-gray-700" data-testid="link-founder-company-profile">Company profile</Link>
          {actions.state === READY && actions.items[0]?.href && (
            <Link to={actions.items[0].href} className="rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-semibold text-white" data-testid="link-founder-continue">Continue where you left off</Link>
          )}
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-axal-muted" data-testid="button-refresh-founder-studio"><RefreshCw size={13} />Refresh</button>
        </div>
      </header>

      <div className="mb-4" data-testid="section-founder-advisor">
        {children}
        {advisorAvailable === false && <AdvisorUnavailable />}
      </div>

      <ul className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6" data-testid="founder-studio-summary">
        {summary.map((t) => (
          <li key={t.k} className="rounded-xl border border-axal-hairline bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900/40" data-testid={`founder-summary-${slug(t.k)}`}>
            <p className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint">{t.k}</p>
            <p className="mt-1 text-[20px] font-extrabold tabular-nums">
              {t.state === READY ? t.v : t.state === LOADING ? '…' : <span className="text-[12px] font-semibold text-axal-muted"><Unrecorded reason={t.reason}>{t.state === UNREADABLE ? 'Unreadable' : 'Not recorded'}</Unrecorded></span>}
            </p>
            {t.state === READY && t.sub && <p className="text-[11px] text-axal-muted">{t.sub}</p>}
          </li>
        ))}
      </ul>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-4">
          <Zone title="Do these next" note={actions.state === READY ? 'In your checklist’s order: nothing records what each item unblocks.' : null} testId="zone-founder-actions" zone={actions} onRetry={onRetry} what="Your checklist" empty="Nothing is waiting on you right now.">
            {actions.state === READY && (
              <ol className="grid gap-2">
                {actions.items.map((a) => (
                  <li key={a.n} className="flex items-center gap-3 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-700">
                    <span className="font-mono text-[11px] text-axal-faint">{a.n}</span>
                    <span className="min-w-0 flex-1 text-[13px] font-semibold">{a.title}</span>
                    {a.href && <Link to={a.href} className="text-[12px] font-semibold text-violet-700 dark:text-violet-300">Open</Link>}
                  </li>
                ))}
              </ol>
            )}
          </Zone>

          <Zone title="Company progress" note={progress.state === READY ? progress.stageNote : null} testId="zone-founder-progress" zone={progress} onRetry={onRetry} what="The Lab state">
            {progress.state === READY && (
              <>
                <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {progress.ladder.map((l) => (
                    <li key={l.name} className="text-[11.5px]">
                      <span className={`block h-1.5 rounded-full ${l.state === 'Complete' ? 'bg-emerald-500' : l.state === 'In progress' ? 'bg-violet-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
                      <span className="mt-1 block font-semibold">{l.name}</span>
                      <span className="text-axal-muted">{l.state}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <ListBlock label="Shipped" items={progress.shipped} empty="Nothing shipped yet." testId="founder-progress-shipped" />
                  <ListBlock label="Still open" items={progress.stillOpen} empty={progress.cohort ? 'Nothing open this week.' : 'Open items are the Lab’s weekly deliverables, inside a cohort.'} testId="founder-progress-open" />
                </div>
                <p className="mt-3 text-[12.5px] text-axal-muted" data-testid="founder-progress-gate"><strong className="text-axal-ink dark:text-white">Gate</strong> · {progress.gate}</p>
              </>
            )}
          </Zone>

          <Zone title="Eadwyn’s questions" note={questions.state === READY && questions.answered !== null && questions.open !== null ? `${questions.answered} answered · ${questions.open} open` : null} testId="zone-founder-questions" zone={questions.state === READY && !questions.items.length ? { state: EMPTY } : questions} onRetry={onRetry} what="Eadwyn’s questions" empty="No question is waiting on you.">
            {questions.state === READY && questions.items.length > 0 && (
              <ul className="grid gap-2">
                {questions.items.map((q) => (
                  <li key={q.id || q.q} className="flex items-start justify-between gap-3 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-700">
                    <span className="text-[13px]">{q.q}{q.high && <span className="ml-2 rounded-full bg-amber-50 px-2 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">High impact</span>}</span>
                    <a href="#studio-chat" className="shrink-0 text-[12px] font-semibold text-violet-700 dark:text-violet-300">Answer now</a>
                  </li>
                ))}
              </ul>
            )}
          </Zone>

          <Zone title="Activity across the platform" note="Last 7 days" testId="zone-founder-activity" zone={activity} onRetry={onRetry} what="Your activity" empty="Nothing recorded in the last 7 days.">
            {activity.state === READY && (
              <ul className="grid gap-1.5">
                {activity.items.map((a, i) => (
                  <li key={i} className="flex gap-3 text-[12.5px]">
                    <span className="w-20 shrink-0 text-axal-faint">{a.when}</span>
                    <span className="min-w-0">{a.what}{a.detail && <span className="text-axal-muted"> · {a.detail}</span>}</span>
                  </li>
                ))}
              </ul>
            )}
          </Zone>

          <Zone title="Module map" testId="zone-founder-modules" zone={modules} onRetry={onRetry} what="The Lab state">
            {modules.state === READY && (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {modules.items.map((m) => (
                  <li key={m.key} className={`flex items-center justify-between gap-2 rounded-lg border border-axal-hairline px-3 py-2 text-[12px] dark:border-gray-700 ${m.state === 'Locked' ? 'opacity-60' : ''}`}>
                    <span className="font-semibold">{m.name}</span>
                    <span className="text-[10.5px] font-bold text-axal-muted">{m.state}{m.note ? ` · ${m.note}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Zone>
        </div>

        <aside className="grid content-start gap-4">
          <Zone title="Your founder profile" testId="zone-founder-profile" zone={profile.completion.state === LOADING ? profile.completion : { state: READY }} onRetry={onRetry} what="Your profile">
            <p className="text-[28px] font-extrabold tabular-nums" data-testid="founder-profile-pct">
              {profile.completion.state === READY ? `${profile.completion.pct}%` : <span className="text-[12px] font-semibold text-axal-muted"><Unrecorded reason={profile.completion.reason}>{profile.completion.state === UNREADABLE ? 'Unreadable' : 'Not recorded'}</Unrecorded></span>}
            </p>
            {profileCard && <div className="mt-2" data-testid="founder-profile-archetype">{profileCard}</div>}
            <p className="mt-3 text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint">Confidence by dimension</p>
            {profile.dimensions.state === READY ? (
              <ul className="mt-1.5 grid gap-1.5" data-testid="founder-profile-dimensions">
                {profile.dimensions.items.map((d) => (
                  <li key={d.name} className="text-[12px]">
                    <span className="flex justify-between"><span>{d.name}</span><span className="text-axal-muted">{d.label}</span></span>
                    {d.pct !== null && <span className="mt-0.5 block h-1.5 rounded-full bg-gray-100 dark:bg-gray-800"><span className="block h-1.5 rounded-full bg-violet-600" style={{ width: `${d.pct}%` }} /></span>}
                  </li>
                ))}
              </ul>
            ) : profile.dimensions.state !== LOADING && (
              <p className="mt-1 text-[12px] text-axal-muted"><Unrecorded reason={profile.dimensions.reason}>{profile.dimensions.state === UNREADABLE ? 'Unreadable' : 'Not recorded'}</Unrecorded></p>
            )}
          </Zone>

          <Zone title="Holding progress" testId="zone-founder-blockers" zone={{ state: NOT_RECORDED, reason: NO_STORE.blockers }} />
          <Zone title="What this adds up to" testId="zone-founder-implications" zone={{ state: NOT_RECORDED, reason: NO_STORE.implications }} />
        </aside>
      </div>
    </section>
  );
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** One zone's frame and its four non-ready states. */
function Zone({ title, note = null, testId, zone, onRetry, what, empty, children }) {
  return (
    <section className="rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40" data-testid={testId} data-state={zone.state}>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-extrabold tracking-tight">{title}</h3>
        {note && <span className="text-[11.5px] text-axal-faint">{note}</span>}
      </div>
      {zone.state === LOADING && <p className="text-[12px] text-axal-muted">Reading…</p>}
      {zone.state === UNREADABLE && <Unreadable what={what} claim="This is not a claim that nothing is recorded." onRetry={onRetry} />}
      {zone.state === NOT_RECORDED && <p className="text-[12px] text-axal-muted"><Unrecorded reason={zone.reason}>Not recorded</Unrecorded> <span className="ml-1">{zone.reason}</span></p>}
      {zone.state === EMPTY && <p className="text-[12.5px] text-axal-muted">{empty}</p>}
      {zone.state === READY && children}
    </section>
  );
}

function ListBlock({ label, items, empty, testId }) {
  return (
    <div data-testid={testId}>
      <p className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint">{label}</p>
      {items.length ? (
        <ul className="mt-1 grid gap-1 text-[12.5px]">{items.map((d) => <li key={d}>{d}</li>)}</ul>
      ) : <p className="mt-1 text-[12px] text-axal-muted">{empty}</p>}
    </div>
  );
}

export function AdvisorUnavailable() {
  return (
    <section className="fs-advisor-unavailable" role="status" data-testid="status-founder-advisor-unavailable">
      <div className="fs-advisor-unavailable-main">
        <span className="fs-advisor-mark"><MessageCircle size={17} /></span>
        <div>
          <div className="fs-advisor-title">
            <h3>Eadwyn</h3>
            <span>Founder interview</span>
          </div>
          <p>The guided founder interview is not available in this environment. Your Studio records remain below.</p>
        </div>
      </div>
      <div className="fs-advisor-unavailable-note">
        <span>Live interview</span>
        <strong>Source unavailable</strong>
        <small>No answers or assessment data have been inferred.</small>
      </div>
    </section>
  );
}
