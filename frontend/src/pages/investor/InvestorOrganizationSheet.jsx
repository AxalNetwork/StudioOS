/**
 * D6257 (#6257) — NW4.1 of the Network v2 Investor canvas (D6256): one
 * organization, opened from the Organizations directory, as the shared detail
 * `Sheet` (D1317). An organization here is a name, not a record: the company
 * the people the investor has a tie with link on their own accounts
 * (`other.company`, D572 part 3, D6258), grouped by linked profile (#7083).
 * Website, type and location are not stored, so none is drawn.
 *
 *   People in your book   each tie under the name: kind, where the name came
 *                         from, and the last touch (Going cold past 60 days; no
 *                         touch is Not recorded, never cold).
 *   Open reminders        the investor's own open reminders on those ties
 *                         (`partner_reminders`), with Done; Unavailable when
 *                         the reminders read failed, never "none".
 *   Introductions         Not recorded: no read joins an introduction to a
 *                         company (Backend required, D6257).
 *   Who knows them        `WhoKnowsStrip` with `{ company }` — the ask-a-teammate
 *                         entry (D1357), its own read and its own sheet.
 *   Request an intro      the founder-or-startup ask on these ties, as before.
 */
import { Sheet, Unreadable } from '../../ui';
import WhoKnowsStrip from '../relationships/WhoKnowsStrip.jsx';
import { shortDate } from '../../lib/networkBook';
import { daysSince, isCold, latestTouch, nameSource, openRemindersFor } from './investorNetworkModel';

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const H3 = 'm-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100';
const CARD = 'flex flex-col gap-2 rounded-[12px] border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const BTN = 'inline-flex min-h-[32px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 max-sm:min-h-[44px]';
const PILL = 'inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';

const title = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function Touch({ at, testId }) {
  if (!at) return <span className={MUTED} data-testid={testId}>— Not recorded</span>;
  const days = daysSince(at);
  return (
    <span className="flex flex-col" data-testid={testId}>
      <span className={`text-[12.5px] tabular-nums ${INK}`}>{shortDate(at) || String(at).slice(0, 10)}</span>
      {days !== null ? <span className={MUTED}>{days} days ago</span> : null}
      {isCold(at) ? <span className={`${PILL} mt-1 self-start`}>▽ Going cold</span> : null}
    </span>
  );
}

export default function InvestorOrganizationSheet({ org, reminders, onReminderDone, onRetryReminders, introAction = null, onClose, testId = 'organization-sheet' }) {
  const people = [...(org?.people?.entries?.() || [])].map(([id, person]) => ({ id, ...person }));
  const latest = latestTouch(people);
  const open = openRemindersFor(org?.relationshipIds || [], reminders);
  const sub = `${people.length} ${people.length === 1 ? 'person' : 'people'} in your book · latest touch ${latest ? (shortDate(latest) || String(latest).slice(0, 10)) : 'Not recorded'}`;
  return (
    <Sheet label={org?.name || 'Organization'} eyebrow="Organization · a name, not a record" title={org?.name} sub={sub} onClose={onClose} width={640} testId={testId}>
      <div className="flex flex-col gap-4">
        <p className={MUTED} data-testid={`${testId}-no-record`}>Website, type and location are not stored: there is no organization record behind this name.</p>

        <section className={CARD} aria-labelledby={`${testId}-people`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id={`${testId}-people`} className={H3}>People in your book</h3>
            <span className={MUTED}>{people.length} {people.length === 1 ? 'tie' : 'ties'}</span>
          </div>
          <ul className="m-0 flex list-none flex-col p-0">
            {people.map((person) => (
              <li key={person.id} className="grid grid-cols-1 gap-1 border-t border-axal-hairline py-2 first:border-0 sm:grid-cols-[1.3fr_1fr_1fr_1fr] sm:gap-3 dark:border-gray-700" data-testid={`${testId}-person-${person.id}`}>
                <span className="flex flex-col"><b className={`text-[13px] ${INK}`}>{person.name || 'Name not recorded'}</b>{person.role ? <span className={MUTED}>{title(person.role)}</span> : null}</span>
                <span className={`text-[12.5px] ${INK}`}>Tie{person.type ? ` · ${title(person.type)}` : ''}</span>
                <span className={MUTED}>{nameSource(org)}</span>
                <Touch at={person.lastTouch} testId={`${testId}-touch-${person.id}`} />
              </li>
            ))}
          </ul>
        </section>

        <section className={CARD} aria-labelledby={`${testId}-reminders`} data-testid={`${testId}-reminders-card`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id={`${testId}-reminders`} className={H3}>Open reminders</h3>
            {Array.isArray(open) ? <span className={MUTED}>{open.length}</span> : null}
          </div>
          {open === 'unreadable' ? <div data-testid={`${testId}-reminders-unreadable`}><Unreadable what="Your reminders" claim="This is not a claim that none are open." onRetry={onRetryReminders} /></div>
            : open === null ? <span className="h-8 animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800" role="status" aria-label="Loading reminders" />
              : open.length === 0 ? <p className={MUTED} data-testid={`${testId}-reminders-none`}>○ None open on these ties.</p>
                : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {open.map((r) => (
                      <li key={r.uid} className="flex flex-wrap items-center gap-2" data-testid={`${testId}-reminder-${r.uid}`}>
                        <span className="flex min-w-0 flex-1 flex-col"><b className={`text-[13px] ${INK}`}>{r.note || 'Re-surface this tie'}</b><span className={MUTED}>due {shortDate(r.remind_at) || r.remind_at || 'Not recorded'}</span></span>
                        <button type="button" className={BTN} onClick={() => onReminderDone?.(r.uid)} data-testid={`${testId}-reminder-done-${r.uid}`}>Done</button>
                      </li>
                    ))}
                  </ul>
                )}
        </section>

        <section className={CARD} aria-labelledby={`${testId}-intros`}>
          <h3 id={`${testId}-intros`} className={H3}>Introductions that name this company</h3>
          <p className={MUTED} data-testid={`${testId}-intros-none`}>— Not recorded. No introduction is linked to a company yet; each one is in Introductions.</p>
        </section>

        {org?.name ? <WhoKnowsStrip query={{ company: org.name }} subject={`someone at ${org.name}`} testId={`${testId}-who-knows`} /> : null}

        {introAction ? <section className={CARD} aria-label="Request an intro">{introAction}</section> : null}
      </div>
    </Sheet>
  );
}
