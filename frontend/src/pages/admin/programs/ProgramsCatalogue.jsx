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
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { BELOW_MD_QUERY, usePhoneWidth } from '../../../ui/phone/usePhoneWidth';
import { scopeParam, scopeState } from '../insights/insightsModel';
import AdminBoardFrame, { useBoardSteps } from '../AdminBoardFrame';
import {
  AMBER, BlockFailed, CARD, ChartBlock, ChoiceGroup, Done, EYE, GrantBadge, H2, HeadlineCard, LINK, MovedNotice, PeriodControl, Pill, ProgramDimensions,
  SHOW_AS, StaleNote, StatusPill, StudioSelect, SUB, Skeleton, TH, Unread,
} from './parts';
import { LAYOUTS, ROW_HEADS, attentionState, groupedCards, headlineCards, nextSteps, phoneLine } from './overviewModel';
import { useCatalogueReads } from './useProgramReads';
import useProgramsTitle from './useProgramsTitle';
import { ProposalsSummary, YourProposals } from './ProposalTables';

const TABLET_QUERY = '(max-width: 1023px)';
import { ProgramsTabs, useWaitingProposals } from './ProposalsPage';
import NewProgramDialog from './NewProgramDialog';
import { NEW_PROGRAM } from './proposalsModel';
import {
  ASSIGNED_TO_YOU, COULD_NOT_READ, GROUPS, INCLUDING_MEMBER, LINE_ADMIN, LINE_SUPER, NOT_READ_YET,
  NOT_RECORDED, PRODUCT_TESTING_FOOT, READING, TITLE, asOfState, clockLabel, movedNotice, plural, programByKey, programDimensions, scopeChip, withoutMoved,
} from './programsModel';
import {
  PERIODS, catalogueCards, creditsChart, figureOf, investorsFigure, joinsChart, labApplications, labCohortLine,
  influencerLine, learningJoinOf, learningLine, mentorLine, needsOf, partnersFigure, referLine, scopeLinesOf, studioChip, testingLine, waitingChart,
  weeksFrom, withWeeks,
} from './catalogueModel';

const PRIMARY = 'hidden min-h-[36px] items-center rounded-[9px] bg-axal-violet px-3.5 text-[13px] font-bold text-white hover:opacity-90 sm:inline-flex dark:bg-violet-600';
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
function ProgramCard({ p, superAdmin, parts }) {
  const { who, needs, figures, door, foot } = parts;
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2.5 px-[18px] py-4`} data-testid={`programs-card-${p.key}`}>
      <span className={EYE}>{p.group}</span>
      <h3 className={H2}>{p.name}</h3>
      {p.purpose
        ? <p className={`m-0 ${SUB}`}>{p.purpose}</p>
        : <Unread word={NOT_RECORDED} reason={p.purposeReason} testId={`programs-card-${p.key}-purpose`} />}
      <div className="flex flex-wrap gap-1.5">
        <StatusPill status={p.status} testId={`programs-card-${p.key}-status`} />
        <GrantBadge grant={superAdmin ? p.hqGrant : p.grant} badge={p.grantBadge} testId={`programs-card-${p.key}-grant`} />
        {superAdmin ? null : <NeedsPill needs={needs} programKey={p.key} />}
      </div>
      <ProgramDimensions dims={dimsOf(p, superAdmin)} testId={`programs-card-${p.key}-dimensions`} />
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

const dimsOf = (p, superAdmin) => programDimensions(p, { superAdmin, grantBadge: p.grantBadge, state: p.fallback || 'ready' });

/**
 * D4873 (PG01): one catalogue row. The five dimensions are labelled columns, not badges: the build pill with
 * the operation under it, member access, studio offering, existing grants, then the period's activity and one
 * Open. It keeps the card's test ids, so a row and a card are the same program to every reader.
 */
function ProgramRow({ p, superAdmin, parts }) {
  const v = Object.fromEntries(dimsOf(p, superAdmin).map((d) => [d.key, d.value]));
  const cell = 'border-t border-axal-hairline px-3 py-2.5 align-top dark:border-gray-700';
  return (
    <tr data-testid={`programs-card-${p.key}`}>
      <th scope="row" className={`${cell} text-left font-normal`}>
        <span className="flex flex-col gap-0.5">
          <span className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">
            {p.row && !programByKey(p.key) ? <span className="mr-1.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400">Custom</span> : null}
            {p.name}
          </span>
          {p.purpose ? <span className={SUB}>{p.purpose}</span> : <Unread word={NOT_RECORDED} reason={p.purposeReason} testId={`programs-card-${p.key}-purpose`} />}
          {superAdmin ? null : <NeedsPill needs={parts.needs} programKey={p.key} />}
        </span>
      </th>
      <td className={cell} data-testid={`programs-card-${p.key}-dimensions-build`}>
        <span className="flex flex-col items-start gap-1">
          <StatusPill status={p.status} testId={`programs-card-${p.key}-status`} />
          <span className={SUB} data-testid={`programs-card-${p.key}-dimensions-operation`}>{v.operation}</span>
        </span>
      </td>
      <td className={`${cell} text-[12.5px] text-axal-ink dark:text-gray-100`} data-testid={`programs-card-${p.key}-dimensions-access`}>{v.access}</td>
      <td className={`${cell} text-[12.5px] text-axal-ink dark:text-gray-100`} data-testid={`programs-card-${p.key}-dimensions-offering`}>{v.offering}</td>
      <td className={`${cell} text-[12.5px] text-axal-ink dark:text-gray-100`} data-testid={`programs-card-${p.key}-dimensions-grants`}>
        <span className="sr-only" data-testid={`programs-card-${p.key}-grant`}>{p.grantBadge?.word || (superAdmin ? p.hqGrant : p.grant)}</span>
        <span aria-hidden="true">{v.grants}</span>
      </td>
      <td className={cell}>{parts.figures || <span className={SUB}>—</span>}{parts.foot ? <p className={`m-0 ${SUB}`} data-testid={`programs-card-${p.key}-foot`}>{parts.foot}</p> : null}</td>
      <td className={`${cell} text-right`}>{parts.door}</td>
    </tr>
  );
}

/** PG07b: on a phone, a program is one compact row: its name, its build, and member access · studio offering. */
function PhoneProgram({ p, superAdmin, parts }) {
  const dims = dimsOf(p, superAdmin);
  return (
    <li className="flex items-center justify-between gap-3 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-700" data-testid={`programs-card-${p.key}`}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{p.name}</span>
          <StatusPill status={p.status} testId={`programs-card-${p.key}-status`} />
        </span>
        <span className={SUB} data-testid={`programs-card-${p.key}-line`}>{phoneLine(dims)}</span>
      </span>
      {parts.door}
    </li>
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
            {r.key === 'cohort' ? <Link to="/admin/programs/spinout-lab/applications" className={LINK} data-testid="programs-waiting-cohort-door">› Applications</Link> : null}
            {r.key === 'referrals' ? <Link to="/admin/programs/refer-and-earn/queue" className={LINK}>Open</Link> : null}
            {r.key === 'strategic' ? <Link to="/admin/programs/refer-and-earn" className={LINK}>Open</Link> : null}
            {r.key === 'perks' ? <Link to="/admin/programs/perks/queue" className={LINK}>Open</Link> : null}
            {r.key === 'hosts' ? <Link to="/admin/programs/spinout-lab/hosts" className={LINK} data-testid="programs-waiting-hosts-door">› Hosts</Link> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** PG01's Needs attention: queues first, then what is incomplete, then build blockers; each with its state in words. */
function NeedsAttention({ att, onRetry }) {
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2 px-[18px] py-4`} aria-labelledby="programs-attention-h" data-testid="programs-attention">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="programs-attention-h" className={H2}>Needs attention</h2>
        {att.state === 'ready' ? <span className={SUB} data-testid="programs-attention-count">{`${plural(att.items.length, 'item', 'items')} · queues first`}</span> : null}
      </div>
      {att.state === 'loading' ? <Skeleton lines={3} testId="programs-attention-loading" /> : null}
      {att.state === 'unreadable' ? <BlockFailed what="What needs attention" onRetry={onRetry} testId="programs-attention-unreadable" /> : null}
      {att.state === 'empty' ? <p className={`m-0 ${SUB}`} data-testid="programs-attention-empty">Nothing needs HQ right now.</p> : null}
      {att.state === 'ready' ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {att.items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-700" data-testid={`programs-attention-${i.key}`}>
              <span className="flex min-w-0 items-start gap-2">
                <span aria-hidden="true" className={`mt-0.5 font-mono text-[12px] font-bold ${i.tone === 'act' ? AMBER : 'text-axal-muted dark:text-gray-400'}`}>{i.tone === 'act' ? '!' : 'i'}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{i.title}</span>
                  {i.sub ? <span className={SUB}>{i.sub}</span> : null}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <Pill tone={i.tone === 'act' ? 'amber' : 'muted'} testId={`programs-attention-${i.key}-word`}>{i.word}</Pill>
                {i.to ? <Link to={i.to} className={LINK}>{i.action}</Link> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CatalogueBody() {
  // D4873 (PG05): the rail's next steps come from what this body read; the frame draws them.
  const onSteps = useBoardSteps();
  const loc = useLocation();
  const navigate = useNavigate();
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const phone = usePhoneWidth();
  const weeks = weeksFrom(loc.search);
  const [group, setGroup] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [created, setCreated] = useState(null);
  // D4873: the catalogue as rows (the default) or cards, and Activity's one Chart / Table choice.
  const [layout, setLayout] = useState('rows');
  const [view, setView] = useState('chart');
  // PG07a: below 1024px the catalogue is cards, so the Rows / Cards choice is not offered there.
  const narrow = usePhoneWidth(TABLET_QUERY);
  // PG07b: a phone proper (below 768px) gets the compact rows and the one urgent button; a tablet keeps Needs attention.
  const small = usePhoneWidth(BELOW_MD_QUERY);
  const waitingProposals = useWaitingProposals(superAdmin);

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
  useProgramsTitle('Programs', scope?.kind === 'branch' ? scope.label : superAdmin ? 'HQ' : null);

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

  const joins = joinsChart(reads.catalogue, { superAdmin, perStudio });
  const waiting = waitingChart(reads.catalogue);
  const credits = creditsChart(reads.catalogue);
  const { cards } = catalogueCards(reads.cards);
  // D4807: the last answer for this scope stays on screen while the next period reads; it says so.
  const stale = Boolean(reads.cards?.stale);
  const lab = labApplications(reads.labApps, { perStudio });
  // D4873 (PG01): the four headline cards, Needs attention, and Eadwyn's next steps from it.
  const headline = headlineCards({ read: reads.catalogue, cards, waiting, weeks, superAdmin });
  const att = attentionState({ read: reads.catalogue, cards, waiting });
  const steps = nextSteps(att, retry);
  const stepsKey = JSON.stringify(steps, (k, v) => (typeof v === 'function' ? undefined : v));
  useEffect(() => { onSteps(steps); }, [stepsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = groupedCards(cards, group);
  const asRows = !narrow && layout === 'rows';

  // D4873: what each program draws (who, Needs you, its figures, its door, its foot), once, for a row, a card or a phone row.
  const partsOf = (p) => {
    const needs = needsOf(p);
    switch (p.key) {
      case 'spinout-lab': {
        const f = figureOf(p, 'cohort_applications');
        return (
          ({ needs: needs, figures: (
              <>
                <CardFigure s={f} what="Cohort applications" onRetry={retry} testId="programs-card-spinout-lab-figure">
                  {f.state === 'ready' ? <span className={FIGURE}>{labCohortLine(f.data)}</span> : null}
                </CardFigure>
                <CardLine label="Lab applications" s={lab} onRetry={retry} testId="programs-card-spinout-lab-applications" />
              </>
            ), door: <Link to="/admin/programs/spinout-lab" className={OPEN} aria-label="Open Spin-Out Lab">Open</Link> })
        );
      }
      case 'ai-native-venture':
        return ({ door: <Link to="/admin/programs/ai-native-venture" className={OPEN} aria-label="Open AI-native Venture">Open</Link> });
      case 'mentor-cohorts': {
        const m = figureOf(p, 'mentors');
        const c = figureOf(p, 'coverage');
        const both = m.state === 'ready' && c.state === 'ready' ? { state: 'ready' } : m.state !== 'ready' ? m : c;
        return (
          ({ needs: needs, figures: (
              <CardFigure s={both} what="The mentors and cohorts" onRetry={retry} testId="programs-card-mentor-cohorts-figure">
                {both.state === 'ready' ? (
                  <>
                    <span className={FIGURE}>{mentorLine(m.data, c.data)}</span>
                    <span className={SUB}>Cohorts scheduled or running.</span>
                    {m.data.reason ? <span className={SUB}>{m.data.reason}</span> : null}
                  </>
                ) : null}
              </CardFigure>
            ), door: <Link to="/admin/programs/mentor-cohorts" className={OPEN} aria-label="Open Mentor cohort access">Open</Link> })
        );
      }
      case 'investor-cohorts': {
        // D963: "Not running" until the registry says the program runs; then part 6's summary.
        const f = investorsFigure(reads.investors, p, { perStudio });
        return (
          ({ figures: f.state === 'not_running'
              ? <span className="font-mono text-[12.5px] font-semibold text-axal-muted dark:text-gray-400" data-testid="programs-card-investor-cohorts-figure">Not running</span>
              : (
                <CardFigure s={f} what="Investor cohort access" onRetry={retry} testId="programs-card-investor-cohorts-figure">
                  {f.state === 'ready' ? <span className={FIGURE}>{f.text}</span> : null}
                </CardFigure>
              ), door: <Link to="/admin/programs/investor-cohorts" className={OPEN} aria-label="Open Investor cohort access">Open</Link> })
        );
      }
      case 'referral-partners': {
        // D963: "[n] partners · [m] with signed terms", from part 5's summary.
        const f = partnersFigure(reads.partners, { perStudio });
        return (
          ({ figures: (
              <CardFigure s={f} what="The referral partners" onRetry={retry} testId="programs-card-referral-partners-figure">
                {f.state === 'ready' ? <span className={FIGURE}>{f.text}</span> : null}
              </CardFigure>
            ), door: <Link to="/admin/programs/referral-partners" className={OPEN} aria-label="Open Referral partners">Open</Link> })
        );
      }
      case 'refer-and-earn': {
        const f = figureOf(p, 'open_referrals');
        const strategic = p.row?.needs_you?.strategic_requests;
        return (
          ({ needs: needs, figures: (
              <>
                <CardFigure s={f} what="Open referrals" onRetry={retry} testId="programs-card-refer-and-earn-figure">
                  {f.state === 'ready' ? <><span className={FIGURE}>{referLine(f.data)}</span><span className={SUB}>{INCLUDING_MEMBER}</span></> : null}
                </CardFigure>
                {strategic && strategic.available !== true ? (
                  <CardLine label="Strategic referral access" s={{ state: 'placeholder', word: strategic.pending ? NOT_READ_YET : COULD_NOT_READ, reason: strategic.reason }} testId="programs-card-refer-and-earn-strategic" />
                ) : null}
              </>
            ), door: <Link to="/admin/programs/refer-and-earn" className={OPEN} aria-label="Open Refer & Earn">Open</Link> })
        );
      }
      case 'perks': {
        const live = figureOf(p, 'live');
        const claims = figureOf(p, 'claims');
        return (
          ({ needs: needs, figures: (
              <>
                <CardFigure s={live} what="Live perks" onRetry={retry} testId="programs-card-perks-figure">
                  {live.state === 'ready' ? <span className={FIGURE}>{`${Number(live.data.count).toLocaleString('en-US')} live`}</span> : null}
                </CardFigure>
                <CardLine label="Claims" s={claims.state === 'ready' ? { state: 'ready', text: `Claims: ${Number(claims.data.count).toLocaleString('en-US')}` } : { ...claims, word: claims.state === 'pending' ? NOT_READ_YET : claims.state === 'loading' ? READING : COULD_NOT_READ }}
                  onRetry={retry} testId="programs-card-perks-claims" />
              </>
            ), door: <Link to="/admin/programs/perks" className={OPEN} aria-label="Open Perks">Open</Link> })
        );
      }
      case 'learning': {
        const f = figureOf(p, 'programs');
        return (
          ({ who: superAdmin ? (
              <span className="text-[12px] font-medium text-axal-muted dark:text-gray-400">
                {`Who: ${p.who || NOT_RECORDED} · Join: ${f.state === 'ready' ? learningJoinOf(f.data) : f.state === 'loading' ? READING : COULD_NOT_READ}`}
              </span>
            ) : null, figures: (
              <CardFigure s={f} what="The learning programs" onRetry={retry} testId="programs-card-learning-figure">
                {f.state === 'ready' ? <><span className={FIGURE}>{learningLine(f.data)}</span>{superAdmin ? null : <span className={SUB}>{ASSIGNED_TO_YOU}</span>}</> : null}
              </CardFigure>
            ), door: (
              <>
                <Link to="/admin/programs/learning" className={OPEN} aria-label="Open Learning">Open</Link>
                {superAdmin ? <Link to="/learning/studio/programs" className={`${LINK} self-center`}>Open the program studio</Link> : null}
              </>
            ) })
        );
      }
      // D4298 (#4298): Influencers, with P1's figure and its applications waiting on HQ; the door opens Applications.
      case 'influencer': {
        const f = figureOf(p, 'influencers');
        return (
          ({ needs: needs, figures: (
              <CardFigure s={f} what="The influencers" onRetry={retry} testId="programs-card-influencer-figure">
                {f.state === 'ready' ? <span className={FIGURE}>{influencerLine(f.data)}</span> : null}
              </CardFigure>
            ), door: <Link to="/admin/programs/influencer" className={OPEN} aria-label="Open Influencers">Open</Link> })
        );
      }
      case 'product-testing': {
        const f = figureOf(p, 'programs');
        return (
          ({ figures: superAdmin ? (
              <CardFigure s={f} what="The testing programs" onRetry={retry} testId="programs-card-product-testing-figure">
                {f.state === 'ready' ? <span className={FIGURE}>{testingLine(f.data)}</span> : null}
              </CardFigure>
            ) : null, door: superAdmin ? <Link to="/admin?tab=product-testing" className={OPEN} aria-label="Open Product testing">Open</Link> : null, foot: superAdmin ? null : PRODUCT_TESTING_FOOT })
        );
      }
      default:
        // D4808: a program an approval or New program made has the generic registry-backed page at its key.
        return ({ door: <Link to={`/admin/programs/${p.key}`} className={OPEN} aria-label={`Open ${p.name || p.key}`} data-testid={`programs-card-${p.key}-open`}>Open</Link> });
    }
  };

  const header = (
    <div className="flex flex-wrap items-center gap-2.5" data-testid="programs-header-controls">
      {superAdmin ? <StudioSelect scopes={scopeLinesOf(reads.scopes)} current={scope} onPick={pickStudio} /> : null}
      <PeriodControl periods={PERIODS} weeks={weeks} onPick={pickWeeks} />
      {phone ? null : (
        <>
          <span className={`font-mono text-[12px] ${asOf.kind === 'failed' ? 'font-bold text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid="programs-asof">
            {asOf.kind === 'updated' ? `Updated ${clockLabel(asOf.at)}` : asOf.kind === 'failed' ? COULD_NOT_READ : READING}
          </span>
          <button type="button" aria-label="Refresh" onClick={retry} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid="programs-refresh">
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          {/* D964: PG2's New program and PG1's Propose a program. A phone has no header door (dc:469). */}
          {superAdmin
            ? <button type="button" className={PRIMARY} onClick={() => setNewOpen(true)} data-testid="programs-new">{NEW_PROGRAM}</button>
            : <Link to="/admin/programs/propose" className={PRIMARY} data-testid="programs-propose">Propose a program</Link>}
        </>
      )}
    </div>
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6 lg:pb-10" data-testid="programs-catalogue">
      <header className="flex flex-col gap-3" data-testid="programs-catalogue-header">
        <div className="flex min-w-0 flex-col gap-[7px]">
          <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">{TITLE}</h1>
          <p className="m-0 text-[13.5px] leading-normal text-axal-muted dark:text-gray-400" data-testid="programs-catalogue-line">{superAdmin ? LINE_SUPER : LINE_ADMIN}</p>
          <span title={chip.title} className="cursor-help self-start rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="programs-scope-chip">{chip.label}</span>
        </div>
        {/* PG07b: on a phone, scope and period come first. */}
        {header}
      </header>

      {superAdmin ? <ProgramsTabs waiting={waitingProposals} /> : null}

      {created ? (
        <Done testId="programs-new-done">
          {`${created.name} is added as Proposed, with an empty playbook draft you edit and publish on its page.`}
          {created.key ? <> <Link to={`/admin/programs/${created.key}`} className="font-bold underline" data-testid="programs-new-open">Open program</Link></> : null}
        </Done>
      ) : null}

      <MovedNotice text={moved} onDismiss={() => navigate({ pathname: loc.pathname, search: withoutMoved(loc.search), hash: loc.hash }, { replace: true })} />

      {/* PG01: four headline cards, in the order of the four questions. On a tablet they go 2×2. */}
      <section aria-label="At a glance" className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="programs-tiles">
        {headline.map((c) => <HeadlineCard key={c.key} c={c} onRetry={retry} />)}
      </section>

      {/* PG07b: on a phone the most urgent action is one full-width button. */}
      {small && att.state === 'ready' && att.items[0]?.to ? (
        <Link to={att.items[0].to} className="flex min-h-[44px] items-center justify-center rounded-[9px] bg-axal-violet px-3.5 text-[14px] font-bold text-white dark:bg-violet-600" data-testid="programs-phone-urgent">
          {att.items[0].key.startsWith('queue-') ? `Review ${att.items[0].label.toLowerCase()} · ${att.items[0].count.toLocaleString('en-US')}` : att.items[0].title}
        </Link>
      ) : null}

      <div className={`grid items-start gap-3.5 ${superAdmin ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        {small ? null : <NeedsAttention att={att} onRetry={retry} />}
        {superAdmin ? <ProposalsSummary waiting={waitingProposals} /> : null}
      </div>

      {/* PG01: Activity, with one Chart / Table control for all three. A phone draws Joins only (D961). */}
      <section className="flex flex-col gap-3" aria-labelledby="programs-activity-h" data-testid="programs-activity">
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          <h2 id="programs-activity-h" className={H2}>Activity</h2>
          <ChoiceGroup label="Activity: show as" value={view} onPick={setView} options={SHOW_AS} groupTestId="programs-activity-view" testId={(v) => `programs-activity-as-${v}`} />
        </div>
        <ChartBlock b={joins} shape="lines" onRetry={retry} view={view} />
        {phone ? null : (
          <div className="grid gap-3.5 lg:grid-cols-2">
            <ChartBlock b={waiting} shape="bars" onRetry={retry} view={view}>
              {waiting.rows ? <WaitingRows rows={waiting.rows} /> : null}
              {waiting.rows ? <p className={`m-0 ${SUB}`} data-testid="programs-waiting-reconciles">{reconcileLine(headline)}</p> : null}
            </ChartBlock>
            <ChartBlock b={credits} shape="columns" onRetry={retry} view={view}>
              {credits.referral ? <p className={`m-0 ${SUB}`} data-testid="programs-chart-credits-referral">{`Referrals: ${credits.referral.word}. ${credits.referral.reason}`}</p> : null}
            </ChartBlock>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2.5" aria-labelledby="programs-catalogue-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="programs-catalogue-h" className={H2}>Catalogue</h2>
          <span className={SUB} data-testid="programs-catalogue-count">{plural(cards.length, 'program', 'programs')}</span>
          <StaleNote stale={stale} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ChoiceGroup label="Category" value={group ?? 'all'} onPick={(v) => setGroup(v === 'all' ? null : v)} groupTestId="programs-groups"
            options={[{ value: 'all', label: 'All' }, ...GROUPS.map((g) => ({ value: g, label: g }))]} testId={(v) => `programs-group-${v}`} />
          {narrow ? null : (
            <ChoiceGroup label="Show programs as" value={layout} onPick={setLayout} options={LAYOUTS} groupTestId="programs-layout" testId={(v) => `programs-layout-${v}`} />
          )}
        </div>

        {asRows ? (
          <div className={`${CARD} overflow-x-auto`} data-testid="programs-cards">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Programs by category, with their five states</caption>
              <thead>
                <tr>{ROW_HEADS.map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}<th scope="col" className={TH}><span className="sr-only">Open</span></th></tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.group} data-testid={`programs-rows-${g.group}`}>
                  <tr><th scope="rowgroup" colSpan={ROW_HEADS.length + 1} className={`${EYE} bg-axal-ground px-3 py-1.5 text-left dark:bg-gray-800`}>{g.group}</th></tr>
                  {g.cards.map((p) => <ProgramRow key={p.key} p={p} superAdmin={superAdmin} parts={partsOf(p)} />)}
                </tbody>
              ))}
            </table>
          </div>
        ) : small ? (
          <ul className={`${CARD} m-0 flex list-none flex-col px-4 py-1`} data-testid="programs-cards">
            {groups.flatMap((g) => g.cards).map((p) => <PhoneProgram key={p.key} p={p} superAdmin={superAdmin} parts={partsOf(p)} />)}
          </ul>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="programs-cards">
            {groups.flatMap((g) => g.cards).map((p) => <ProgramCard key={p.key} p={p} superAdmin={superAdmin} parts={partsOf(p)} />)}
          </div>
        )}
      </section>

      {superAdmin ? null : <YourProposals />}

      {newOpen ? (
        <NewProgramDialog onClose={() => setNewOpen(false)} onCreated={(c) => { setNewOpen(false); setCreated(c); retry(); waitingProposals.reload(); }} />
      ) : null}
    </div>
  );
}

/** "Totals 13 — matches Actions requiring HQ.", or why it does not add up yet. */
function reconcileLine(headline) {
  const h = headline.find((c) => c.key === 'waiting');
  if (!h || h.state !== 'ready') return 'Actions requiring HQ could not be totalled.';
  return h.incomplete ? `Totals ${h.value}: a queue was not read, so Actions requiring HQ is incomplete.` : `Totals ${h.value}: the same as Actions requiring HQ.`;
}

// D774 (#2100): S19 drew HeldZone's rail. The board's page, in the Admin boards' frame.
export default function ProgramsCatalogue() {
  return (
    <AdminBoardFrame workspace="Programs" note="Eadwyn reads the program figures on this page. Nothing changes until you act." data-testid="admin-board-programs">
      <CatalogueBody />
    </AdminBoardFrame>
  );
}
