// D953 (#2371) — Admin › Programs, the catalogue, built to the owner's
// "Programs" canvas (PG1 for an Admin, PG2 for a Super Admin, PG3 in dark
// mode) from the reads that exist. This file is the routed page at
// `/admin/programs` (`guard(['admin'])` in App.jsx; `/admin/held/programs`
// redirects here with `?moved=held`) and board S19's file: its default export
// is one `AdminBoardFrame` named "Programs", and the header, the tiles, the
// cards and the foot sit in `CatalogueBody` inside it. Each card's door is a
// literal `to="…"`, so the reachability walk finds every program page.
import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import AdminBoardFrame from '../AdminBoardFrame';
import {
  BlockFailed, CARD, Chip, EYE, GrantBadge, H2, LINK, MovedNotice, Pill, Skeleton, StatusPill, SUB, Tile, Unread,
} from './parts';
import { useCatalogueReads } from './useProgramReads';
import {
  ASSIGNED_TO_YOU, CLAIMS_REASON, COULD_NOT_READ, DEACTIVATED_LINE, FOOT_PROFILING, GROUPS, INCLUDING_MEMBER,
  LAB_APPLICATIONS_REASON, LINE_ADMIN, LINE_SUPER, NOT_READ_YET, NOT_RECORDED, NOTHING_WAITING, PEOPLE_REASON,
  PRODUCT_TESTING_FOOT, PROGRAMS, READING, RUNNING_REASON, STRATEGIC_LINE, TITLE, WAITING_LABEL, WITHIN_500, asOfState,
  cardsIn, clockLabel, labCard, learningCardLine, learningFigures, learningJoin, livePerksFrom, mentorCardLine,
  mentorFigures, movedNotice, perkQueueFrom, referCard, scopeChip, testingFrom, waitingForYou, withoutMoved,
} from './programsModel';

const OPEN = 'inline-flex min-h-[34px] items-center rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[13px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const FIGURE = 'font-mono text-[12.5px] font-semibold leading-normal text-axal-ink dark:text-gray-100';

/** A card figure in its read's state; `children` is the ready figure. */
function CardFigure({ state, what, onRetry, testId, children }) {
  if (state === 'loading') return <Skeleton lines={1} testId={testId} />;
  if (state === 'unreadable') return <BlockFailed what={what} onRetry={onRetry} testId={testId} />;
  return <div className="flex flex-col gap-0.5" data-testid={testId}>{children}</div>;
}

/** The amber "Needs you [n]" when above zero; a Needs you whose read failed says so. */
function NeedsPill({ needs, programKey }) {
  if (!needs || needs.state === 'loading') return null;
  if (needs.state === 'unreadable') {
    return <span role="alert" className="text-[11.5px] font-semibold text-red-700 dark:text-red-300" data-testid={`programs-card-${programKey}-needs`}>Needs you could not be read</span>;
  }
  if (!(needs.count > 0)) return null;
  return <Pill tone="amber" testId={`programs-card-${programKey}-needs`}><span aria-hidden="true">!</span>{`Needs you ${needs.pill || needs.count.toLocaleString('en-US')}`}</Pill>;
}

/** One card: group, name, purpose, pills, "Who · Join", figures, Needs you, door and foot. */
function ProgramCard({ p, superAdmin, who, needs, figures, door, foot }) {
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2.5 px-[18px] py-4`} data-testid={`programs-card-${p.key}`}>
      <span className={EYE}>{p.group}</span>
      <h3 className={H2}>{p.name}</h3>
      {p.purpose
        ? <p className={`m-0 ${SUB}`}>{p.purpose}</p>
        : <Unread word={NOT_RECORDED} reason={p.purposeReason} testId={`programs-card-${p.key}-purpose`} />}
      <div className="flex flex-wrap gap-1.5">
        <StatusPill status={p.status} />
        <GrantBadge grant={superAdmin ? p.hqGrant : p.grant} testId={`programs-card-${p.key}-grant`} />
        {superAdmin ? null : <NeedsPill needs={needs} programKey={p.key} />}
      </div>
      <div className="border-t border-axal-hairline pt-2 dark:border-gray-700" data-testid={`programs-card-${p.key}-who`}>
        {who || (p.who
          ? <span className="text-[12px] font-medium text-axal-muted dark:text-gray-400">{`Who: ${p.who} · Join: ${p.join}`}</span>
          : <Unread word={NOT_RECORDED} reason={p.whoReason} />)}
      </div>
      {figures}
      {door ? <div className="mt-auto flex flex-wrap gap-2 pt-1">{door}</div> : null}
      {foot ? <p className={`m-0 ${SUB}`} data-testid={`programs-card-${p.key}-foot`}>{foot}</p> : null}
    </section>
  );
}

const byKey = Object.fromEntries(PROGRAMS.map((p) => [p.key, p]));

function CatalogueBody() {
  const loc = useLocation();
  const navigate = useNavigate();
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const reads = useCatalogueReads(superAdmin);
  const [group, setGroup] = useState(null);
  const now = Date.now();
  const moved = movedNotice(loc.pathname, loc.search);
  const chip = scopeChip(superAdmin, reads.scopes);
  const asOf = asOfState(reads.drawn);

  const waiting = waitingForYou({ glance: reads.glance, hosts: reads.hosts, perkQueue: reads.perkQueue, now });
  const lab = labCard(reads.glance, reads.hosts, now);
  const mentor = mentorFigures(reads.assignments, reads.timeline);
  const refer = referCard(reads.glance);
  const live = livePerksFrom(reads.perks);
  const queue = perkQueueFrom(reads.perkQueue, now);
  const learning = learningFigures(reads.learning);
  const testing = testingFrom(reads.testing);
  const retry = reads.reload;
  const shown = new Set(cardsIn(group).map((p) => p.key));

  const waitingTile = waiting.state === 'ready'
    ? {
      key: 'waiting', label: 'Waiting for you', state: 'ready', value: waiting.value,
      sub: waiting.empty ? NOTHING_WAITING : waiting.oldest, overdue: waiting.overdue,
      cover: WAITING_LABEL, extra: STRATEGIC_LINE,
    }
    : { key: 'waiting', label: 'Waiting for you', state: waiting.state, reason: waiting.reason, extra: STRATEGIC_LINE };

  const mentorNeeds = mentor.state === 'ready'
    ? { state: 'ready', count: mentor.uncovered.length + mentor.stale.length }
    : { state: mentor.state };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6 lg:pb-10" data-testid="programs-catalogue">
      <header className="flex flex-wrap items-start justify-between gap-3" data-testid="programs-catalogue-header">
        <div className="flex min-w-0 flex-col gap-[7px]">
          <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">{TITLE}</h1>
          <p className="m-0 text-[13.5px] leading-normal text-axal-muted dark:text-gray-400" data-testid="programs-catalogue-line">{superAdmin ? LINE_SUPER : LINE_ADMIN}</p>
          <span title={chip.title} className="cursor-help self-start rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="programs-scope-chip">{chip.label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={`font-mono text-[12px] ${asOf.kind === 'failed' ? 'font-bold text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid="programs-asof">
            {asOf.kind === 'updated' ? `Updated ${clockLabel(asOf.at)}` : asOf.kind === 'failed' ? COULD_NOT_READ : READING}
          </span>
          <button type="button" aria-label="Refresh" onClick={retry} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid="programs-refresh">
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <MovedNotice text={moved} onDismiss={() => navigate({ pathname: loc.pathname, search: withoutMoved(loc.search), hash: loc.hash }, { replace: true })} />

      <div className="grid gap-3.5 sm:grid-cols-3" data-testid="programs-tiles">
        <Tile t={{ key: 'running', label: 'Programs running', state: 'placeholder', word: NOT_RECORDED, reason: RUNNING_REASON }} />
        <Tile t={{ key: 'people', label: 'People taking part', state: 'placeholder', word: NOT_READ_YET, reason: PEOPLE_REASON }} />
        <Tile t={waitingTile} onRetry={retry} />
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={H2}>Catalogue</h2>
          <span className={SUB} data-testid="programs-catalogue-count">{`${PROGRAMS.length} programs`}</span>
        </div>
        <div className="flex flex-wrap gap-1.5" data-testid="programs-groups">
          <Chip on={group === null} onClick={() => setGroup(null)} testId="programs-group-all">All</Chip>
          {GROUPS.map((g) => <Chip key={g} on={group === g} onClick={() => setGroup(g)} testId={`programs-group-${g}`}>{g}</Chip>)}
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="programs-cards">
        {shown.has('spinout-lab') ? (
          <ProgramCard
            p={byKey['spinout-lab']} superAdmin={superAdmin} needs={lab.needs}
            figures={(
              <>
                <CardFigure state={lab.figure.state} what="Cohort applications" onRetry={retry} testId="programs-card-spinout-lab-figure">
                  <span className={FIGURE}>{lab.figure.text}</span>
                </CardFigure>
                <div className="flex flex-col gap-0.5" data-testid="programs-card-spinout-lab-applications">
                  <span className="text-[12px] text-axal-ink dark:text-gray-100">{`Lab applications: ${NOT_READ_YET}`}</span>
                  <span className={SUB}>{LAB_APPLICATIONS_REASON}</span>
                </div>
              </>
            )}
            door={<Link to="/admin/programs/spinout-lab" className={OPEN} aria-label="Open Spin-Out Lab">Open</Link>}
          />
        ) : null}
        {shown.has('ai-native-venture') ? (
          <ProgramCard p={byKey['ai-native-venture']} superAdmin={superAdmin}
            door={<Link to="/admin/programs/ai-native-venture" className={OPEN} aria-label="Open AI-native Venture">Open</Link>} />
        ) : null}
        {shown.has('mentor-cohorts') ? (
          <ProgramCard
            p={byKey['mentor-cohorts']} superAdmin={superAdmin} needs={mentorNeeds}
            figures={(
              <CardFigure state={mentor.state} what="The mentors and cohorts" onRetry={retry} testId="programs-card-mentor-cohorts-figure">
                {mentor.state === 'ready' ? (
                  <>
                    <span className={FIGURE}>{mentorCardLine(mentor)}</span>
                    <span className={SUB}>{mentor.capped ? `Scheduled or running cohorts; ${WITHIN_500} assignments.` : 'Cohorts scheduled or running.'}</span>
                    <span className={SUB}>{DEACTIVATED_LINE}</span>
                  </>
                ) : null}
              </CardFigure>
            )}
            door={<Link to="/admin/programs/mentor-cohorts" className={OPEN} aria-label="Open Mentor cohort access">Open</Link>}
          />
        ) : null}
        {shown.has('investor-cohorts') ? (
          <ProgramCard
            p={byKey['investor-cohorts']} superAdmin={superAdmin}
            figures={<span className="font-mono text-[12.5px] font-semibold text-axal-muted dark:text-gray-400" data-testid="programs-card-investor-cohorts-figure">Not running</span>}
            door={<Link to="/admin/programs/investor-cohorts" className={OPEN} aria-label="Open Investor cohort access">Open</Link>}
          />
        ) : null}
        {shown.has('referral-partners') ? (
          <ProgramCard
            p={byKey['referral-partners']} superAdmin={superAdmin}
            figures={<Unread word={NOT_RECORDED} reason={byKey['referral-partners'].whoReason} testId="programs-card-referral-partners-figure" />}
            door={<Link to="/admin/programs/referral-partners" className={OPEN} aria-label="Open Referral partners">Open</Link>}
          />
        ) : null}
        {shown.has('refer-and-earn') ? (
          <ProgramCard
            p={byKey['refer-and-earn']} superAdmin={superAdmin} needs={refer}
            figures={(
              <CardFigure state={refer.state} what="Open referrals" onRetry={retry} testId="programs-card-refer-and-earn-figure">
                <span className={FIGURE}>{refer.text}</span>
                <span className={SUB}>{INCLUDING_MEMBER}</span>
              </CardFigure>
            )}
            door={<Link to="/admin/programs/refer-and-earn" className={OPEN} aria-label="Open Refer & Earn">Open</Link>}
          />
        ) : null}
        {shown.has('perks') ? (
          <ProgramCard
            p={byKey.perks} superAdmin={superAdmin}
            needs={queue.state === 'ready' ? { state: 'ready', count: queue.count, pill: queue.atLeast ? `${queue.count.toLocaleString('en-US')}+` : null } : { state: queue.state }}
            figures={(
              <>
                <CardFigure state={live.state} what="Live perks" onRetry={retry} testId="programs-card-perks-figure">
                  <span className={FIGURE}>{`${live.text} live`}</span>
                </CardFigure>
                <div className="flex flex-col gap-0.5" data-testid="programs-card-perks-claims">
                  <span className="text-[12px] text-axal-ink dark:text-gray-100">{`Claims: ${NOT_READ_YET}`}</span>
                  <span className={SUB}>{CLAIMS_REASON}</span>
                </div>
              </>
            )}
            door={<Link to="/admin/programs/perks" className={OPEN} aria-label="Open Perks">Open</Link>}
          />
        ) : null}
        {shown.has('learning') ? (
          <ProgramCard
            p={byKey.learning} superAdmin={superAdmin}
            who={superAdmin ? (
              <span className="text-[12px] font-medium text-axal-muted dark:text-gray-400">
                {`Who: ${byKey.learning.who} · Join: ${learning.state === 'ready' ? learningJoin(learning.rows) : learning.state === 'unreadable' ? COULD_NOT_READ : READING}`}
              </span>
            ) : null}
            figures={(
              <CardFigure state={learning.state} what="The learning programs" onRetry={retry} testId="programs-card-learning-figure">
                {learning.state === 'ready' ? (
                  <>
                    <span className={FIGURE}>{learningCardLine(learning)}</span>
                    {superAdmin ? null : <span className={SUB}>{ASSIGNED_TO_YOU}</span>}
                  </>
                ) : null}
              </CardFigure>
            )}
            door={(
              <>
                <Link to="/admin/programs/learning" className={OPEN} aria-label="Open Learning">Open</Link>
                {superAdmin ? <Link to="/learning/studio/programs" className={`${LINK} self-center`}>Open the program studio</Link> : null}
              </>
            )}
          />
        ) : null}
        {shown.has('product-testing') ? (
          <ProgramCard
            p={byKey['product-testing']} superAdmin={superAdmin}
            figures={superAdmin ? (
              <CardFigure state={testing.state} what="The testing programs" onRetry={retry} testId="programs-card-product-testing-figure">
                <span className={FIGURE}>{testing.text}</span>
              </CardFigure>
            ) : null}
            door={superAdmin ? <Link to="/admin?tab=product-testing" className={OPEN} aria-label="Open Product testing">Open</Link> : null}
            foot={superAdmin ? null : PRODUCT_TESTING_FOOT}
          />
        ) : null}
      </div>

      {/* O-PRF: one literal door until Profiling trends' home is decided. */}
      <p className={`m-0 flex flex-wrap items-center gap-x-2 ${SUB}`} data-testid="programs-foot">
        <span>{FOOT_PROFILING}</span>
        <Link to="/admin/profiling-trends" className={LINK}>Open profiling trends</Link>
      </p>
    </div>
  );
}

// D774 (#2100): S19 drew HeldZone's rail. The board's page, in the Admin boards' frame.
export default function ProgramsCatalogue() {
  return (
    <AdminBoardFrame workspace="Programs" note="Eadwyn reads the program figures on this page. Nothing changes until you act." data-testid="admin-board-programs">
      <CatalogueBody />
    </AdminBoardFrame>
  );
}
