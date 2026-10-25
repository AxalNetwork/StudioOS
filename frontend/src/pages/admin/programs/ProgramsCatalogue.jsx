// D953 (#2371) — Admin › Programs, the catalogue, built to the owner's
// "Programs" canvas (PG1 for an Admin, PG2 for a Super Admin, PG3 in dark
// mode). This file is the routed page at `/admin/programs` (`guard(['admin'])`
// in App.jsx; `/admin/held/programs` redirects here with `?moved=held`) and
// board S19's file: its default export is one `AdminBoardFrame` named
// "Programs", and the header, the tiles, the charts, the cards and the foot
// sit in `CatalogueBody` inside it. Each card's door is a literal `to="…"`, so
// the reachability walk finds every program page.
//
// D961 (#2794) completes it from part 1's catalogue read (D954 §3): the period
// control, the four tiles, Joins per week, Waiting by program, Credits in and
// out by month, every card's figures and Needs you, Lab applications from
// D960's `counts.pending`, the studio filter, each chart's loading and failed
// states (PG17, PG18a) and the phone catalogue (PG20a). Each block draws its
// own state; `catalogueModel.js` holds the one rule.
import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth';
import { scopeParam, scopeState } from '../insights/insightsModel';
import AdminBoardFrame from '../AdminBoardFrame';
import {
  BlockFailed, CARD, ChartBlock, Chip, EYE, GrantBadge, H2, LINK, MovedNotice, PeriodControl, Pill, StatusPill,
  StudioSelect, SUB, Skeleton, Tile, Unread,
} from './parts';
import { useCatalogueReads } from './useProgramReads';
import {
  ASSIGNED_TO_YOU, COULD_NOT_READ, FOOT_PROFILING, GROUPS, INCLUDING_MEMBER, LINE_ADMIN, LINE_SUPER, NOT_READ_YET,
  NOT_RECORDED, PRODUCT_TESTING_FOOT, READING, TITLE, asOfState, clockLabel, movedNotice, plural, scopeChip, withoutMoved,
} from './programsModel';
import {
  PERIODS, catalogueCards, catalogueTiles, creditsChart, figureOf, joinsChart, labApplications, labCohortLine,
  learningJoinOf, learningLine, mentorLine, needsOf, referLine, scopeLinesOf, studioChip, testingLine, waitingChart,
  weeksFrom, withWeeks,
} from './catalogueModel';

const OPEN = 'inline-flex min-h-[44px] items-center rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[13px] font-bold text-axal-ink hover:bg-axal-ground sm:min-h-[34px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const FIGURE = 'font-mono text-[12.5px] font-semibold leading-normal text-axal-ink dark:text-gray-100';

/** A card figure in its block's state (`catalogueModel.blockState`); `children` is the ready figure. */
function CardFigure({ s, what, onRetry, testId, children }) {
  if (s.state === 'loading') return <Skeleton lines={1} testId={testId} />;
  if (s.state === 'unreadable') return <BlockFailed what={what} onRetry={onRetry} testId={testId} />;
  if (s.state === 'pending') return <Unread word={NOT_READ_YET} reason={s.reason} testId={testId} />;
  if (s.state === 'unrecorded') return <Unread word={NOT_RECORDED} reason={s.reason} testId={testId} />;
  return <div className="flex flex-col gap-0.5" data-testid={testId}>{children}</div>;
}

/** A named line on a card (Lab applications, Claims), in its state. */
function CardLine({ label, s, onRetry, testId }) {
  if (s.state === 'loading') return <Skeleton lines={1} testId={testId} />;
  if (s.state === 'unreadable') return <BlockFailed what={label} onRetry={onRetry} testId={testId} />;
  if (s.state === 'ready') return <span className="text-[12px] text-axal-ink dark:text-gray-100" data-testid={testId}>{s.text}</span>;
  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <span className="text-[12px] text-axal-ink dark:text-gray-100">{`${label}: ${s.word || NOT_READ_YET}`}</span>
      {s.reason ? <span className={SUB}>{s.reason}</span> : null}
    </div>
  );
}

/** The amber "Needs you [n]" when above zero; a Needs you whose read failed says so. */
function NeedsPill({ needs, programKey }) {
  if (!needs || needs.state === 'loading') return null;
  if (needs.state === 'unreadable') {
    return <span role="alert" className="text-[11.5px] font-semibold text-red-700 dark:text-red-300" data-testid={`programs-card-${programKey}-needs`}>Needs you could not be read</span>;
  }
  if (!(needs.count > 0)) return null;
  return <Pill tone="amber" testId={`programs-card-${programKey}-needs`}><span aria-hidden="true">!</span>{`Needs you ${needs.count.toLocaleString('en-US')}`}</Pill>;
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
        <StatusPill status={p.status} testId={`programs-card-${p.key}-status`} />
        <GrantBadge grant={superAdmin ? p.hqGrant : p.grant} testId={`programs-card-${p.key}-grant`} />
        {superAdmin ? null : <NeedsPill needs={needs} programKey={p.key} />}
      </div>
      <div className="border-t border-axal-hairline pt-2 dark:border-gray-700" data-testid={`programs-card-${p.key}-who`}>
        {who || (p.who
          ? <span className="text-[12px] font-medium text-axal-muted dark:text-gray-400">{`Who: ${p.who} · Join: ${p.join || NOT_RECORDED}`}</span>
          : <Unread word={NOT_RECORDED} reason={p.whoReason} />)}
      </div>
      {figures}
      {door ? <div className="mt-auto flex flex-wrap gap-2 pt-1">{door}</div> : null}
      {foot ? <p className={`m-0 ${SUB}`} data-testid={`programs-card-${p.key}-foot`}>{foot}</p> : null}
    </section>
  );
}

/** Waiting by program's rows: each queue a literal door, with its count or its state in words. */
function WaitingRows({ rows }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0" data-testid="programs-waiting-rows">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-700" data-testid={`programs-waiting-${r.key}`}>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.label}</span>
            <span className={SUB}>{r.state === 'ready' ? r.sub : `${r.word}${r.reason ? `. ${r.reason}` : ''}`}</span>
          </span>
          <span className="flex items-baseline gap-3">
            {r.state === 'ready' ? <span className="font-mono text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{r.text}</span> : null}
            {r.key === 'cohort' ? <Link to="/admin/spinout-lab" className={LINK}>Open</Link> : null}
            {r.key === 'referrals' ? <Link to="/admin/programs/refer-and-earn/queue" className={LINK}>Open</Link> : null}
            {r.key === 'strategic' ? <Link to="/admin/programs/refer-and-earn" className={LINK}>Open</Link> : null}
            {r.key === 'perks' ? <Link to="/admin/programs/perks/queue" className={LINK}>Open</Link> : null}
            {r.key === 'hosts' ? <Link to="/admin/spinout-lab" className={LINK}>Open</Link> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CatalogueBody() {
  const loc = useLocation();
  const navigate = useNavigate();
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const phone = usePhoneWidth();
  const weeks = weeksFrom(loc.search);
  const [group, setGroup] = useState(null);

  // The studio (PG2): R12's lines, then the picked studio. While R12 reads, no per-studio read is made.
  const reads = useCatalogueReads(superAdmin, {
    weeks,
    scopeOf: (scopesRead) => {
      const sc = scopeState(loc.search, superAdmin, scopeLinesOf(scopesRead));
      return { code: scopeParam(sc) || null, canRead: sc.kind !== 'pending', scope: sc };
    },
  });
  const { scope } = reads.studio;
  const perStudio = Boolean(reads.studio.code);

  const setSearch = (search) => navigate({ pathname: loc.pathname, search, hash: loc.hash }, { replace: true });
  const pickWeeks = (w) => setSearch(withWeeks(loc.search, w));
  const pickStudio = (c) => {
    const q = new URLSearchParams(loc.search);
    if (c === 'hq') q.delete('scope'); else q.set('scope', c);
    const s = q.toString();
    setSearch(s ? `?${s}` : '');
  };

  const moved = movedNotice(loc.pathname, loc.search);
  const chip = studioChip(scope, scopeChip(superAdmin, reads.scopes));
  const asOf = asOfState(reads.drawn);
  const retry = reads.reload;

  const tiles = catalogueTiles(reads.catalogue);
  const joins = joinsChart(reads.catalogue, { superAdmin, perStudio });
  const waiting = waitingChart(reads.catalogue);
  const credits = creditsChart(reads.catalogue);
  const { cards } = catalogueCards(reads.cards);
  const shown = cards.filter((c) => !group || c.group === group);
  const lab = labApplications(reads.labApps, { perStudio });

  const card = (p) => {
    const needs = needsOf(p);
    switch (p.key) {
      case 'spinout-lab': {
        const f = figureOf(p, 'cohort_applications');
        return (
          <ProgramCard key={p.key} p={p} superAdmin={superAdmin} needs={needs}
            figures={(
              <>
                <CardFigure s={f} what="Cohort applications" onRetry={retry} testId="programs-card-spinout-lab-figure">
                  {f.state === 'ready' ? <span className={FIGURE}>{labCohortLine(f.data)}</span> : null}
                </CardFigure>
                <CardLine label="Lab applications" s={lab} onRetry={retry} testId="programs-card-spinout-lab-applications" />
              </>
            )}
            door={<Link to="/admin/programs/spinout-lab" className={OPEN} aria-label="Open Spin-Out Lab">Open</Link>} />
        );
      }
      case 'ai-native-venture':
        return <ProgramCard key={p.key} p={p} superAdmin={superAdmin} door={<Link to="/admin/programs/ai-native-venture" className={OPEN} aria-label="Open AI-native Venture">Open</Link>} />;
      case 'mentor-cohorts': {
        const m = figureOf(p, 'mentors');
        const c = figureOf(p, 'coverage');
        const both = m.state === 'ready' && c.state === 'ready' ? { state: 'ready' } : m.state !== 'ready' ? m : c;
        return (
          <ProgramCard key={p.key} p={p} superAdmin={superAdmin} needs={needs}
            figures={(
              <CardFigure s={both} what="The mentors and cohorts" onRetry={retry} testId="programs-card-mentor-cohorts-figure">
                {both.state === 'ready' ? (
                  <>
                    <span className={FIGURE}>{mentorLine(m.data, c.data)}</span>
                    <span className={SUB}>Cohorts scheduled or running.</span>
                    {m.data.reason ? <span className={SUB}>{m.data.reason}</span> : null}
                  </>
                ) : null}
              </CardFigure>
            )}
            door={<Link to="/admin/programs/mentor-cohorts" className={OPEN} aria-label="Open Mentor cohort access">Open</Link>} />
        );
      }
      case 'investor-cohorts':
        return (
          <ProgramCard key={p.key} p={p} superAdmin={superAdmin}
            figures={<span className="font-mono text-[12.5px] font-semibold text-axal-muted dark:text-gray-400" data-testid="programs-card-investor-cohorts-figure">Not running</span>}
            door={<Link to="/admin/programs/investor-cohorts" className={OPEN} aria-label="Open Investor cohort access">Open</Link>} />
        );
      case 'referral-partners':
        return (
          <ProgramCard key={p.key} p={p} superAdmin={superAdmin}
            figures={<Unread word={NOT_RECORDED} reason={p.whoReason} testId="programs-card-referral-partners-figure" />}
            door={<Link to="/admin/programs/referral-partners" className={OPEN} aria-label="Open Referral partners">Open</Link>} />
        );
      case 'refer-and-earn': {
        const f = figureOf(p, 'open_referrals');
        const strategic = p.row?.needs_you?.strategic_requests;
        return (
          <ProgramCard key={p.key} p={p} superAdmin={superAdmin} needs={needs}
            figures={(
              <>
                <CardFigure s={f} what="Open referrals" onRetry={retry} testId="programs-card-refer-and-earn-figure">
                  {f.state === 'ready' ? <><span className={FIGURE}>{referLine(f.data)}</span><span className={SUB}>{INCLUDING_MEMBER}</span></> : null}
                </CardFigure>
                {strategic && strategic.available !== true ? (
                  <CardLine label="Strategic referral access" s={{ state: 'placeholder', word: strategic.pending ? NOT_READ_YET : COULD_NOT_READ, reason: strategic.reason }} testId="programs-card-refer-and-earn-strategic" />
                ) : null}
              </>
            )}
            door={<Link to="/admin/programs/refer-and-earn" className={OPEN} aria-label="Open Refer & Earn">Open</Link>} />
        );
      }
      case 'perks': {
        const live = figureOf(p, 'live');
        const claims = figureOf(p, 'claims');
        return (
          <ProgramCard key={p.key} p={p} superAdmin={superAdmin} needs={needs}
            figures={(
              <>
                <CardFigure s={live} what="Live perks" onRetry={retry} testId="programs-card-perks-figure">
                  {live.state === 'ready' ? <span className={FIGURE}>{`${Number(live.data.count).toLocaleString('en-US')} live`}</span> : null}
                </CardFigure>
                <CardLine label="Claims" s={claims.state === 'ready' ? { state: 'ready', text: `Claims: ${Number(claims.data.count).toLocaleString('en-US')}` } : { ...claims, word: claims.state === 'pending' ? NOT_READ_YET : claims.state === 'loading' ? READING : COULD_NOT_READ }}
                  onRetry={retry} testId="programs-card-perks-claims" />
              </>
            )}
            door={<Link to="/admin/programs/perks" className={OPEN} aria-label="Open Perks">Open</Link>} />
        );
      }
      case 'learning': {
        const f = figureOf(p, 'programs');
        return (
          <ProgramCard key={p.key} p={p} superAdmin={superAdmin}
            who={superAdmin ? (
              <span className="text-[12px] font-medium text-axal-muted dark:text-gray-400">
                {`Who: ${p.who || NOT_RECORDED} · Join: ${f.state === 'ready' ? learningJoinOf(f.data) : f.state === 'loading' ? READING : COULD_NOT_READ}`}
              </span>
            ) : null}
            figures={(
              <CardFigure s={f} what="The learning programs" onRetry={retry} testId="programs-card-learning-figure">
                {f.state === 'ready' ? <><span className={FIGURE}>{learningLine(f.data)}</span>{superAdmin ? null : <span className={SUB}>{ASSIGNED_TO_YOU}</span>}</> : null}
              </CardFigure>
            )}
            door={(
              <>
                <Link to="/admin/programs/learning" className={OPEN} aria-label="Open Learning">Open</Link>
                {superAdmin ? <Link to="/learning/studio/programs" className={`${LINK} self-center`}>Open the program studio</Link> : null}
              </>
            )} />
        );
      }
      case 'product-testing': {
        const f = figureOf(p, 'programs');
        return (
          <ProgramCard key={p.key} p={p} superAdmin={superAdmin}
            figures={superAdmin ? (
              <CardFigure s={f} what="The testing programs" onRetry={retry} testId="programs-card-product-testing-figure">
                {f.state === 'ready' ? <span className={FIGURE}>{testingLine(f.data)}</span> : null}
              </CardFigure>
            ) : null}
            door={superAdmin ? <Link to="/admin?tab=product-testing" className={OPEN} aria-label="Open Product testing">Open</Link> : null}
            foot={superAdmin ? null : PRODUCT_TESTING_FOOT} />
        );
      }
      default:
        return <ProgramCard key={p.key} p={p} superAdmin={superAdmin} />;
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6 lg:pb-10" data-testid="programs-catalogue">
      <header className="flex flex-wrap items-start justify-between gap-3" data-testid="programs-catalogue-header">
        <div className="flex min-w-0 flex-col gap-[7px]">
          <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">{TITLE}</h1>
          <p className="m-0 text-[13.5px] leading-normal text-axal-muted dark:text-gray-400" data-testid="programs-catalogue-line">{superAdmin ? LINE_SUPER : LINE_ADMIN}</p>
          <span title={chip.title} className="cursor-help self-start rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="programs-scope-chip">{chip.label}</span>
        </div>
        {/* PG20a: on a phone the header has no buttons, so no studio filter. */}
        {phone ? null : (
          <div className="flex flex-wrap items-center gap-2.5">
            {superAdmin ? <StudioSelect scopes={scopeLinesOf(reads.scopes)} current={scope} onPick={pickStudio} /> : null}
            <span className={`font-mono text-[12px] ${asOf.kind === 'failed' ? 'font-bold text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid="programs-asof">
              {asOf.kind === 'updated' ? `Updated ${clockLabel(asOf.at)}` : asOf.kind === 'failed' ? COULD_NOT_READ : READING}
            </span>
            <button type="button" aria-label="Refresh" onClick={retry} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid="programs-refresh">
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </header>

      <MovedNotice text={moved} onDismiss={() => navigate({ pathname: loc.pathname, search: withoutMoved(loc.search), hash: loc.hash }, { replace: true })} />

      <PeriodControl periods={PERIODS} weeks={weeks} onPick={pickWeeks} />

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4" data-testid="programs-tiles">
        {tiles.map((t) => <Tile key={t.key} t={t} onRetry={retry} />)}
      </div>

      <ChartBlock b={joins} shape="lines" onRetry={retry} />

      {/* PG20a draws neither on a phone (D961): Waiting for you's tile carries the total there. */}
      {phone ? null : (
        <div className="grid gap-3.5 lg:grid-cols-2">
          <ChartBlock b={waiting} shape="bars" onRetry={retry}>
            {waiting.rows ? <WaitingRows rows={waiting.rows} /> : null}
          </ChartBlock>
          <ChartBlock b={credits} shape="columns" onRetry={retry}>
            {credits.referral ? <p className={`m-0 ${SUB}`} data-testid="programs-chart-credits-referral">{`Referrals: ${credits.referral.word}. ${credits.referral.reason}`}</p> : null}
          </ChartBlock>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={H2}>Catalogue</h2>
          <span className={SUB} data-testid="programs-catalogue-count">{plural(cards.length, 'program', 'programs')}</span>
        </div>
        <div className="flex flex-wrap gap-1.5" data-testid="programs-groups">
          <Chip on={group === null} onClick={() => setGroup(null)} testId="programs-group-all">All</Chip>
          {GROUPS.map((g) => <Chip key={g} on={group === g} onClick={() => setGroup(g)} testId={`programs-group-${g}`}>{g}</Chip>)}
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="programs-cards">
        {shown.map(card)}
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
