/**
 * HQ · Content — canvas H6, "one pipeline replacing three systems", and since
 * D214 the four panels canvases H18 and H19 draw on the same row.
 *
 * THE SUBTITLE IS A THIRD OUT OF DATE, and this page says so rather than
 * drawing the pipeline as though it had been built. Checking the premise:
 * news was never a third store — the `/api/admin/news` queue read the SAME
 * `articles` table behind a `Deprecation` header — and D166 retired it
 * outright, because its publish handler accepted `in_review` and so let an
 * admin skip the recorded approve step the surviving queue enforces. What is
 * left is two stores with two meanings of "published": an article is
 * editorial and goes through review; a publication is an
 * audience-and-section digest.
 *
 * THE BOARD (D214, H19's C3) DRAWS BOTH IN ONE SET OF LANES AND MERGES
 * NOTHING. Six lanes — Draft, Review, Localisation, Brand approval,
 * Scheduled, Published — built from the same by-status reads the route
 * reports beside them, every row labelled with its store. The canvas's "one
 * meaning of published" is refused in the band, because there are still two.
 * Localisation has no source, so its lane says why instead of holding a
 * number; Brand approval is the content escalations HQ has not answered.
 *
 * THE OTHER THREE PANELS ARE READ-ONLY SUMMARIES OF CONSOLES THAT STAY WHERE
 * THEY ARE (D214). H18 and H19's changelog says they retire the assessment
 * authoring console, the Personas tab and the network-profiles console; the
 * owner's brief says nothing retires. So the Assessment Studio, the personas
 * taxonomy and the Advisors & Partners deck roster each read the store their
 * console writes, draw what the canvas asks for that is stored, state what is
 * not with its reason, and end in ONE literal link to that console. None of
 * them holds a control. The roster links `/admin?tab=network-profiles`, never
 * the standalone path, because that route's reachability exemption would go
 * stale the moment something here linked it.
 *
 * THE MASTER TEMPLATE LIBRARY IS A LINK, NOT A SECOND COPY. The artboard
 * draws it here, but it already lives at `/admin/contracts` over the
 * `legal_templates` store. Two pages over one store drift apart; this one
 * carries the counts so the link is worth following and nothing else.
 *
 * NOT THE SAME PAGE AS `/admin/articles`. That is the plain-admin Content
 * Queue, which reviews one piece at a time. This is the HQ view above it, and
 * the board links it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileStack } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';
import { ConsoleLinkBody, CONSOLE_LINK, CONSOLE_TILE } from './ConsoleLink';

const UNAVAILABLE = Symbol('unavailable');
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());
const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);
/** "3 chapters", "1 chapter" — the count the server measured, never a default. */
const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;

const AMBER_INK = 'text-amber-700 dark:text-amber-300';
const PILL = 'shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.08em]';
const PILL_GREEN = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300';
const PILL_AMBER = 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300';
const PILL_NEUTRAL = 'border border-axal-hairline bg-axal-ground text-axal-muted';

function Zone({ title, sub, children, testid }) {
  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between gap-3" data-testid={testid}>
        <h2 className="text-[14.5px] font-extrabold tracking-tight">{title}</h2>
        {sub && <span className="text-[11.5px] text-axal-faint">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

/**
 * A READ THAT FAILED IS NOT A STORE THAT IS MISSING, so it does not wear the
 * same word. "Not recorded" is for a figure nothing stores; "Unreadable" is
 * for a store that exists and did not answer this time — the house rule that
 * a failed read is never a zero and never an absence.
 */
function Unread() {
  return <span className="italic text-amber-700 dark:text-amber-300">Unreadable</span>;
}

function ReadFailure({ reason }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-axal-muted">
      <Unread /> — {reason}
    </p>
  );
}

/** What a panel shows before its block can be judged: reading, or the whole summary failed. */
function Pending({ loading, what }) {
  return loading
    ? <p className="text-[12.5px] text-axal-muted">Reading {what}…</p>
    : <ReadFailure reason={`The content summary did not answer, so ${what} could not be read.`} />;
}

/** A canvas figure nothing stores: its name, then the reason — never a blank or a dash. */
function StatedAbsence({ label, reason, testid }) {
  return (
    <p className="mt-1.5 text-[11.5px] leading-relaxed text-axal-muted" data-testid={testid}>
      <span className="font-semibold text-axal-ink dark:text-white">{label}</span> · <Unrecorded /> — {reason}
    </p>
  );
}

/**
 * D208 — what one content submission names, in the words its branch sent.
 *
 * A LABEL, NOT A LINK. The item lives in the branch's database, which HQ cannot
 * open, so the branch sends the name it gives the item and this renders that
 * name as it came — the same "About" line HQ Support draws for this field, so
 * one field has one word.
 *
 * AN ABSENT LABEL IS STATED, NEVER BLANK. A submission raised without naming an
 * item, or before a submission could carry a label at all, has none. That row
 * says so with its reason rather than drawing an empty "About", which would read
 * as a label that failed to load.
 */
export function LocalisationRow({ subjectRef }) {
  const label = typeof subjectRef === 'string' ? subjectRef.trim() : '';
  if (label) {
    return (
      <p className="mt-1 text-[10.5px] text-axal-muted" data-testid="hq-localisation-about">
        About <span className="font-mono">{label}</span>
      </p>
    );
  }
  return (
    <p className="mt-1 text-[10.5px] text-axal-muted" data-testid="hq-localisation-unnamed">
      <Unrecorded /> — No item named: raised without one, or before a submission carried its label.
    </p>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="rounded-xl border border-axal-hairline bg-axal-ground p-3">
      <div className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      <div className="mt-1 text-lg font-extrabold tracking-tight tabular-nums text-axal-ink dark:text-white">
        {value ?? <Unrecorded />}
      </div>
      {note && <div className="mt-0.5 text-[10px] text-axal-faint">{note}</div>}
    </div>
  );
}

/* ── the band ────────────────────────────────────────────────────────────── */

/**
 * The header band's count. The canvas reads "{n} items · six lanes · one
 * meaning of published"; the first is the board's own measure of what is
 * short of published, and the last is refused, because two stores still mean
 * two different things by "published". A board that could not count a lane
 * has no total, and the band says so instead of printing a smaller one.
 */
export function bandLine({ loading, unreadable, board }) {
  if (loading) return '…';
  if (unreadable) return 'the content summary could not be read';
  const n = board ? board.in_flight : null;
  const head = n === null || n === undefined ? 'in pipeline: not fully counted' : `${num(n)} in pipeline`;
  return `${head} · localisation not recorded · two meanings of published`;
}

/* ── C3 · the board ──────────────────────────────────────────────────────── */

const PART_WORD = { articles: 'articles', publications: 'publications', escalations: 'open content escalations' };
const SLA_WORD = { past: 'past SLA', due_soon: 'due soon', ok: 'inside SLA' };

/**
 * One card's small line, in lower case: the store first, because a board that
 * puts two stores in one lane owes every row its origin. An escalation says
 * when it was raised and where it stands against its SLA; an article or a
 * publication, its status and when it last changed.
 */
export function cardMeta(card) {
  if (card.store === 'escalation') {
    return ['escalation', card.created_at ? `raised ${day(card.created_at)}` : null, SLA_WORD[card.sla] || null]
      .filter(Boolean).join(' · ');
  }
  return [card.store, card.status, day(card.updated_at)].filter(Boolean).join(' · ');
}

function BoardCard({ card }) {
  const title = card.store === 'escalation' ? card.subject : card.title;
  return (
    <li className="rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-2" data-testid="hq-content-card">
      <div className="truncate text-[11.5px] font-medium text-axal-ink dark:text-white">{title}</div>
      <div className="mt-0.5 font-mono text-[10px] text-axal-faint">{cardMeta(card)}</div>
      {/* Only an escalation knows which branch it came from. An article or a
          publication names none, so it draws no chip rather than a blank one. */}
      {card.store === 'escalation' && card.branch_code && (
        <span className={`mt-1 inline-block ${PILL} ${PILL_NEUTRAL}`}>{card.branch_code}</span>
      )}
    </li>
  );
}

/**
 * A part with no count is one of TWO states, and they are not the same claim.
 * No count and no rows: the read failed, so it is "Unreadable". No count but
 * rows: the store answered and was too large to count inside its ceiling —
 * the brand-approval lane past D204's cap — so the oldest rows it did read
 * are drawn under "not fully counted", which is what its reason promises.
 */
const readButNotCounted = (part) => (part.n === null || part.n === undefined) && Array.isArray(part.cards);

function LanePart({ part }) {
  const word = PART_WORD[part.store] || part.store;
  if (readButNotCounted(part)) {
    return (
      <>
        <p className="text-[11px] leading-snug text-axal-muted" data-testid="hq-content-part-not-counted">
          <span className="font-semibold">{word}</span> · <span className={`italic ${AMBER_INK}`}>not fully counted</span>
          {' '}— {part.reason || 'the count stopped before the end.'}
        </p>
        {part.cards.length > 0 && (
          <ul className="mt-1 space-y-1">
            {part.cards.map((card) => (
              <BoardCard key={`${card.store}-${card.id ?? card.uid}`} card={card} />
            ))}
          </ul>
        )}
      </>
    );
  }
  if (part.n === null || part.n === undefined) {
    return (
      <p className="text-[11px] leading-snug text-axal-muted">
        <span className="font-semibold">{word}</span> · <Unread /> — {part.reason || 'could not be counted.'}
      </p>
    );
  }
  return (
    <>
      <p className="text-[11px] tabular-nums text-axal-muted">
        {num(part.n)} {word}
        {part.reason && <span className={`block ${AMBER_INK}`}>{part.reason}</span>}
      </p>
      {part.cards === null ? (
        part.n > 0 && (
          <p className="text-[10.5px] text-axal-faint">The newest rows could not be read; the count above stands.</p>
        )
      ) : part.cards.length > 0 && (
        <ul className="mt-1 space-y-1">
          {part.cards.map((card) => (
            <BoardCard key={`${card.store}-${card.id ?? card.uid}`} card={card} />
          ))}
        </ul>
      )}
    </>
  );
}

/** A lane's figure: its total, or which of the three absences it is — no source, a failed read, or a count that stopped. */
function laneFigure(lane, noSource) {
  if (lane.total !== null && lane.total !== undefined) return num(lane.total);
  if (noSource) return <Unrecorded />;
  const failed = lane.parts.some((p) => (p.n === null || p.n === undefined) && !Array.isArray(p.cards));
  return failed ? <Unread /> : <span className={`text-[11px] italic ${AMBER_INK}`}>Not fully counted</span>;
}

function LaneColumn({ lane }) {
  const noSource = lane.parts.length === 0;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-axal-hairline p-2.5" data-testid={`hq-content-lane-${lane.key}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-extrabold tracking-tight text-axal-ink dark:text-white">{lane.label}</span>
        <span className="text-[13px] font-extrabold tabular-nums text-axal-ink dark:text-white">
          {laneFigure(lane, noSource)}
        </span>
      </div>
      {noSource ? (
        <p className="text-[11px] leading-relaxed text-axal-muted" data-testid="hq-content-lane-no-source">{lane.reason}</p>
      ) : (
        <>
          {lane.parts.map((part) => <LanePart key={part.store} part={part} />)}
          {lane.total_reason && <p className={`text-[10.5px] leading-snug ${AMBER_INK}`}>{lane.total_reason}</p>}
        </>
      )}
      {lane.note && <p className="text-[10.5px] leading-snug text-axal-faint">{lane.note}</p>}
    </div>
  );
}

/**
 * H19 · C3 — the six lanes, each part named by its store. Pure: it renders
 * what it is given, so every state can be drawn by a test without a fetch.
 */
export function ContentBoard({ loading, unreadable, board, pipeline, unifiedReason }) {
  if (loading || unreadable) return <Pending loading={loading} what="the pipeline" />;
  if (!board || !Array.isArray(board.lanes)) return <ReadFailure reason="The board was not in the summary." />;
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="hq-content-board">
        {board.lanes.map((lane) => <LaneColumn key={lane.key} lane={lane} />)}
      </div>
      {pipeline?.available && pipeline.rejected > 0 && (
        <p className="mt-2 text-[11.5px] text-axal-muted">
          {plural(pipeline.rejected, 'article', 'articles')} rejected, which is not a lane — a rejected piece is out
          of the pipeline, not waiting in it.
        </p>
      )}
      {pipeline?.available && pipeline.unmapped_statuses.length > 0 && (
        <p className={`mt-2 text-[11.5px] ${AMBER_INK}`} data-testid="hq-content-unmapped">
          {pipeline.unmapped_statuses.map((s) => `${s.n} × ${s.status}`).join(', ')} —
          {' '}articles in no lane above, so not counted in the totals. `articles.status` has no CHECK
          constraint, so a new status can appear without a schema change.
        </p>
      )}
      {board.other_publication_statuses?.length > 0 && (
        <p className={`mt-2 text-[11.5px] ${AMBER_INK}`} data-testid="hq-content-other-publications">
          {board.other_publication_statuses.map((s) => `${s.n} × ${s.status}`).join(', ')} —
          {' '}publications in a status no lane names, so not counted in the totals.
        </p>
      )}
      <StatedAbsence label="Publish time" reason={board.publish_time?.reason} testid="hq-content-publish-time" />
      <StatedAbsence label="Branch of origin" reason={board.origin?.reason} testid="hq-content-origin" />
      {unifiedReason && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-content-not-unified">
          {unifiedReason}
        </p>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Link to="/admin/articles" className={CONSOLE_TILE} data-testid="hq-content-link-articles">
          <ConsoleLinkBody title="Articles" note="Review, approve and publish one piece at a time. Publishing is a manual step there." />
        </Link>
        <Link to="/admin/publications" className={CONSOLE_TILE} data-testid="hq-content-link-publications">
          <ConsoleLinkBody title="Publications" note="Draft and issue publications to their audience there." />
        </Link>
      </div>
    </>
  );
}

/* ── H18 · C1 · the Assessment Studio ────────────────────────────────────── */

const GAME_PILL = {
  published: ['Published', PILL_GREEN],
  draft: ['Draft', PILL_AMBER],
  archived: ['Archived', PILL_NEUTRAL],
};

/**
 * One game's line, from what HQ's database holds for it. Where the canvas
 * draws "Live on 4 branches · 812 completions", this draws the completed runs
 * HQ recorded — or says they could not be read — and nothing about branches,
 * which the panel states once below.
 */
export function gameMeta(g) {
  const parts = [];
  if (g.version !== null && g.version !== undefined) parts.push(`v${g.version}`);
  parts.push(plural(g.chapters, 'chapter', 'chapters'));
  parts.push(plural(g.archetypes, 'archetype', 'archetypes'));
  parts.push(`${plural(g.questions, 'active question', 'active questions')}`);
  parts.push(g.runs === null || g.runs === undefined ? 'runs unreadable' : plural(g.runs, 'completed run', 'completed runs'));
  return parts.join(' · ');
}

export function AssessmentPanel({ loading, unreadable, assessment }) {
  let body;
  if (loading || unreadable) body = <Pending loading={loading} what="the assessment games" />;
  else if (!assessment?.available) body = <ReadFailure reason={assessment?.reason || 'The assessment games were not in the summary.'} />;
  else {
    const s = assessment.by_status;
    body = (
      <>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Games authored" value={num(assessment.games_total)} note="on HQ's database" />
          <Stat label="Chapters" value={num(assessment.chapters_total)} note="across every game" />
          <Stat label="Archetypes" value={num(assessment.archetypes_total)} note="across every game" />
        </div>
        <p className="mt-2 text-[11.5px] tabular-nums text-axal-muted" data-testid="hq-assessment-status">
          {num(s.published)} published · {num(s.draft)} draft · {num(s.archived)} archived
        </p>
        {assessment.other_statuses.length > 0 && (
          <p className={`mt-1 text-[11.5px] ${AMBER_INK}`} data-testid="hq-assessment-other-statuses">
            {assessment.other_statuses.map((o) => `${o.n} × ${o.status}`).join(', ')} — a status the code does not
            name, counted in the total above.
          </p>
        )}
        {assessment.games.length === 0 ? (
          <p className="mt-2 text-[12px] text-axal-muted" data-testid="hq-assessment-none">
            No game is authored on HQ&rsquo;s database.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5" data-testid="hq-assessment-games">
            {assessment.games.map((g) => {
              const [label, tone] = GAME_PILL[g.status] || [g.status || 'no status', PILL_AMBER];
              return (
                <li key={g.id} className="flex items-start justify-between gap-3 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-bold text-axal-ink dark:text-white">{g.title || g.slug}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-axal-faint">{gameMeta(g)}</div>
                  </div>
                  <span className={`${PILL} ${tone}`}>{label}</span>
                </li>
              );
            })}
          </ul>
        )}
        {assessment.truncated && (
          <p className="mt-1 text-[11px] text-axal-faint">
            The first {num(assessment.games.length)} of {num(assessment.games_total)} games are listed.
          </p>
        )}
        {!assessment.runs_available && (
          <p className={`mt-2 text-[11.5px] ${AMBER_INK}`} data-testid="hq-assessment-runs-unreadable">
            {assessment.runs_reason}
          </p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">{assessment.runs_basis}</p>
        <StatedAbsence label="Live on branches" reason={assessment.branches?.reason} testid="hq-assessment-branches" />
      </>
    );
  }
  return (
    <>
      {body}
      {/* The canvas's footer says editing a question "republishes to every
          branch running that game; the branch is told". Nothing does either,
          so this says what an edit actually reaches. */}
      <p className="mt-2 text-[11px] leading-relaxed text-axal-muted" data-testid="hq-assessment-edit-reach">
        Editing a game on the console changes HQ&rsquo;s copy and nothing else: no call sends a game to a branch, so
        nothing is republished and there is no branch to tell. A branch runs and reads its own cohorts on its
        Programs page.
      </p>
      <Link to="/admin/assessment" className={CONSOLE_LINK} data-testid="hq-content-link-assessment">
        <ConsoleLinkBody
          title="Assessment Studio"
          note="Author games, chapters, archetypes and questions there. Authoring is refused on a branch. This panel changes none."
        />
      </Link>
    </>
  );
}

/* ── H18 · C2 · the personas taxonomy ────────────────────────────────────── */

/**
 * The footing, as sentences a reader can check against the rows: how many
 * active accounts carry a primary tag, how many carry none, and — when the
 * rows sum to more than the tagged accounts — why. Nothing stops an account
 * holding two primary tags, so the difference is reported, never hidden.
 */
export function personaFooting(p) {
  const lines = [
    `${num(p.accounts_tagged)} of ${plural(p.active_accounts, 'active account', 'active accounts')} carry a primary tag; ${num(p.unclassified)} carry none.`,
  ];
  if (p.multi_primary > 0) {
    lines.push(
      `${plural(p.multi_primary, 'account holds', 'accounts hold')} more than one primary tag — nothing prevents it — `
      + `so the rows sum to ${num(p.tagged_sum)} rather than ${num(p.accounts_tagged)}.`,
    );
  } else if (p.tagged_sum !== p.accounts_tagged) {
    lines.push(`The rows sum to ${num(p.tagged_sum)}, not ${num(p.accounts_tagged)}.`);
  }
  return lines;
}

export function PersonasPanel({ loading, unreadable, personas }) {
  let body;
  if (loading || unreadable) body = <Pending loading={loading} what="the persona tags" />;
  else if (!personas?.available) body = <ReadFailure reason={personas?.reason || 'The persona tags were not in the summary.'} />;
  else {
    body = (
      <>
        {/* No colour dot per persona: the canvas draws one, and nothing
            stores a colour for a persona. */}
        <ul className="grid gap-1 sm:grid-cols-2" data-testid="hq-personas-list">
          {personas.items.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-3 rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[11.5px]">
              <span className="min-w-0 truncate font-medium text-axal-ink dark:text-white">{p.label}</span>
              <span className="shrink-0 tabular-nums text-axal-muted">{num(p.tagged)} tagged</span>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-3 rounded-lg border border-dashed border-axal-hairline px-2.5 py-1.5 text-[11.5px]" data-testid="hq-personas-unclassified">
            <span className="font-medium text-axal-muted">Unclassified</span>
            <span className="shrink-0 tabular-nums text-axal-muted">{num(personas.unclassified)} with no primary tag</span>
          </li>
        </ul>
        {personas.unrecognised.length > 0 && (
          <p className={`mt-2 text-[11.5px] ${AMBER_INK}`} data-testid="hq-personas-unrecognised">
            {personas.unrecognised.map((u) => `${u.id} (${num(u.tagged)})`).join(', ')} — tagged with an id the code
            does not define, so no row above counts it.
          </p>
        )}
        <div className="mt-2 space-y-0.5 text-[11.5px] text-axal-muted" data-testid="hq-personas-footing">
          {personaFooting(personas).map((line) => <p key={line}>{line}</p>)}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">{personas.basis}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-personas-schema">{personas.schema_note}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-axal-faint">{personas.scope_note}</p>
      </>
    );
  }
  return (
    <>
      {body}
      <Link to="/admin?tab=personas" className={CONSOLE_LINK} data-testid="hq-content-link-personas">
        <ConsoleLinkBody title="Personas" note="Move an account from one persona to another there. No console adds, renames or retires a persona." />
      </Link>
    </>
  );
}

/* ── H19 · C4 · the Advisors & Partners deck roster ──────────────────────── */

/** What the deck built on HQ does with a row — the four states the route marks. */
export const REACH_LABEL = {
  profile: 'Team & Network slide',
  named: 'Names list only',
  counted: 'Network total only',
  archived: 'Not on the deck',
};

/** "Role on decks": what the slide prints, only for a row it draws. */
function deckRoleCell(row) {
  if (row.reach === 'profile') return <span className="text-axal-ink dark:text-white">{row.deck_role}</span>;
  return <span className="italic text-axal-faint">{row.reach === 'named' ? 'name only' : 'not printed'}</span>;
}

export function RosterPanel({ loading, unreadable, roster }) {
  let body;
  if (loading || unreadable) body = <Pending loading={loading} what="the roster" />;
  else if (!roster?.available) body = <ReadFailure reason={roster?.reason || 'The roster was not in the summary.'} />;
  else {
    body = (
      <>
        <p className="text-[11.5px] tabular-nums text-axal-muted" data-testid="hq-roster-counts">
          {num(roster.active)} active · {num(roster.archived)} archived
          {' · '}
          {roster.by_kind.map((k) => `${k.kind} ${num(k.active)}`).join(' · ')}
        </p>
        {roster.by_kind.some((k) => !k.known) && (
          <p className={`mt-1 text-[11.5px] ${AMBER_INK}`} data-testid="hq-roster-unknown-kind">
            {roster.by_kind.filter((k) => !k.known).map((k) => k.kind || 'no kind').join(', ')} — a kind the code
            does not define.
          </p>
        )}
        {roster.rows.length === 0 ? (
          <p className="mt-2 text-[12px] text-axal-muted" data-testid="hq-roster-none">
            No one is on the roster, so the deck built on HQ has no advisors to draw.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[11.5px]" data-testid="hq-roster-rows">
              <thead>
                <tr className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
                  <th className="py-1 pr-3 font-extrabold">Name</th>
                  <th className="py-1 pr-3 font-extrabold">Role on decks</th>
                  <th className="py-1 pr-3 font-extrabold">Appears on</th>
                  <th className="py-1 font-extrabold">State</th>
                </tr>
              </thead>
              <tbody>
                {roster.rows.map((row) => (
                  <tr key={row.id} className="border-t border-axal-hairline align-top">
                    <td className="py-1.5 pr-3">
                      <div className="font-medium text-axal-ink dark:text-white">
                        {row.name || <span className="italic text-axal-faint">No name</span>}
                      </div>
                      <div className="text-[10px] text-axal-faint">
                        {[row.kind, row.role, row.company].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3">{deckRoleCell(row)}</td>
                    <td className="py-1.5 pr-3 text-axal-muted">{REACH_LABEL[row.reach] || row.reach}</td>
                    <td className="py-1.5">
                      <span className={`${PILL} ${row.active ? PILL_GREEN : PILL_NEUTRAL}`}>
                        {row.active ? 'Active' : 'Archived'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {roster.truncated && (
          <p className="mt-1 text-[11px] text-axal-faint">
            The first {num(roster.rows.length)} rows are listed, in the deck&rsquo;s own order.
          </p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-roster-reach-note">{roster.reach_note}</p>
        <StatedAbsence label="Nominated by" reason={roster.nominations?.reason} testid="hq-roster-nominations" />
        <p className="mt-1.5 text-[11px] leading-relaxed text-axal-muted" data-testid="hq-roster-branch-rule">{roster.branch_rule}</p>
      </>
    );
  }
  return (
    <>
      {body}
      <Link to="/admin?tab=network-profiles" className={CONSOLE_LINK} data-testid="hq-content-link-roster">
        <ConsoleLinkBody title="Advisors & Partners" note="Add, edit, reorder and archive people there. This panel changes none." />
      </Link>
    </>
  );
}

/* ── the page ────────────────────────────────────────────────────────────── */

/** The localisation lane's count note — reading, unreadable and not offered are three different things. */
function submittedNote(lane, laneItems) {
  if (laneItems) return 'escalations of kind content';
  if (lane === null) return 'reading the lane';
  if (lane === UNAVAILABLE) return 'the lane could not be read';
  return 'the lane is not available';
}

export default function ContentPage() {
  const [data, setData] = useState(null);
  // D112 — the localisation lane reads the escalation board, not this summary.
  // Its own state and its own retry: the summary is a pure read and the lane
  // has writes behind it, so folding them together would mean a slow escalation
  // board blanked the editorial pipeline too.
  const [lane, setLane] = useState(null);
  const load = useCallback(() => {
    setData(null);
    api.hqContent().then(setData, (e) => { reportError('hq-content', e); setData(UNAVAILABLE); });
  }, []);
  const loadLane = useCallback(() => {
    setLane(null);
    api.escalations({ kind: 'content' }).then(setLane, (e) => {
      reportError('hq-content-lane', e);
      setLane(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { load(); loadLane(); }, [load, loadLane]);

  const loading = data === null;
  const unreadable = data === UNAVAILABLE;
  const ready = data && data !== UNAVAILABLE;
  const pipeline = ready ? data.pipeline : null;
  const pubs = ready ? data.publications : null;
  const templates = ready ? data.templates : null;
  const board = ready ? data.board : null;
  const assessment = ready ? data.assessment : null;
  const personas = ready ? data.personas : null;
  const roster = ready ? data.roster : null;
  const laneItems = lane && lane !== UNAVAILABLE && lane.available ? (lane.items || []) : null;

  // COVERAGE IS WHAT MAKES THE RAIL'S ONE ACTION WORK (D126). `canRun =
  // coverage.length > 0` in WorkerRail, so a mount that passes none renders
  // "Not recorded" and a permanently disabled button — which on this page was
  // false, since the reads above all answer.
  //
  // ONE LINE PER READ THAT ANSWERED. A source that failed contributes no line,
  // and `coverageNote` says so, because an empty rail must never be readable as
  // an empty pipeline. A real zero from a read that succeeded is a figure and
  // stays — `laneItems.length === 0` is the page's own "no branch has submitted
  // anything", which is not the fabricated `|| 0` the repo bans.
  const coverage = [
    pipeline?.available && num(pipeline.in_pipeline) !== null
      ? `${num(pipeline.in_pipeline)} articles in the editorial pipeline` : null,
    pubs?.available && num(pubs.total) !== null
      ? `${num(pubs.total)} publications in the second store` : null,
    board && num(board.in_flight) !== null
      ? `${num(board.in_flight)} items on the board short of published, across both stores and the brand-approval lane` : null,
    templates?.available && num(templates.templates) !== null
      ? `${num(templates.templates)} templates · ${num(templates.versions)} versions` : null,
    laneItems ? `${laneItems.length} content ${laneItems.length === 1 ? 'submission' : 'submissions'} from branches` : null,
    assessment?.available
      ? `${num(assessment.games_total)} assessment games · ${num(assessment.chapters_total)} chapters · ${num(assessment.archetypes_total)} archetypes` : null,
    personas?.available
      ? `${num(personas.accounts_tagged)} of ${num(personas.active_accounts)} active accounts carry a persona tag` : null,
    roster?.available
      ? `${num(roster.active)} active on the Advisors & Partners roster, ${num(roster.archived)} archived` : null,
  ].filter(Boolean);

  const rail = (
    <WorkerRail
      workspace="Content"
      role="super_admin"
      stance="Read-only summary"
      note="This rail summarises the pipeline board, the publications store, the branch localisation lane, the Assessment Studio, the personas taxonomy and the deck roster. It takes no action and decides no submission."
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (loading || lane === null
          ? 'Loading the content summary…'
          : 'Neither read answered, so there is nothing to read back — this is not a claim that the pipeline is empty.')}
      unavailable={[
        ['One unified pipeline', 'Articles and publications are still two stores with two meanings of "published".'],
        // D112 — "Brand approval" and "Per-subsidiary attribution" came OFF
        // this list: a content escalation carries the branch code and takes a
        // decision. "Localisation" stays and is NARROWER: what is missing is
        // the link between a piece and the one it localises, not the lane.
        // D208 — NARROWER AGAIN. A submission can now name the item it
        // concerns, so "which item" is answered; "what the submission is to
        // it" is not, and that is the part a localisation count needs.
        ['Localisation link', 'A submission can name the item it concerns, as its branch labels it. Nothing records whether it localises that item or asks for a change to it, so a count of localised items would still be a count of submissions.'],
        ['Per-article attribution', 'An escalation names the branch that submitted it; an ARTICLE still names no licence (U1).'],
        // D214 — what H18 and H19 draw that nothing stores.
        ['Publish time', 'Scheduled means approved; publishing is a manual step, and nothing stores when a piece goes out.'],
        ['Games on branches', 'No call sends a game to a branch, so none is live on one and no branch run reaches HQ.'],
        ['Persona schema', 'The twelve personas are defined in code, so no console adds, renames or retires one.'],
        ['Roster nominations', 'Nothing records who put a person on the roster, and a branch has no route to propose anyone to HQ.'],
      ]}
      data-testid="hq-content-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-content-page">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#1e3a8a] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All subsidiaries</span>
          {/* The artboard's header counts "N items · six lanes · one meaning
              of published". The count is the board's own; the claim of one
              meaning is refused, and localisation is named rather than
              filled with a number. */}
          <span className="text-[11px] opacity-80 tabular-nums" data-testid="hq-content-band">
            {bandLine({ loading, unreadable, board })}
          </span>
        </div>

        <header className="mt-4">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <FileStack size={13} /> HQ · Content
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Content</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Six lanes, from Draft to Published, drawn from the stores that exist: articles, publications, and the
            content escalations branches send HQ. Every row names its store, because the two stores still mean two
            different things by &ldquo;published&rdquo;, and a lane with no source says why rather than holding a
            number. Below it, the deck roster, the Assessment Studio and the personas taxonomy — each a read-only
            summary of its console, ending in a link to it.
          </p>
        </header>

        {unreadable && (
          <div className="mt-4">
            <Unreadable
              what="The content summary"
              claim="This is not a claim that nothing is in progress."
              onRetry={load}
            />
          </div>
        )}

        <div className="mt-4 space-y-4">
          <Zone title="Pipeline" sub="Draft → Review → Localisation → Brand approval → Scheduled → Published" testid="hq-content-board-zone">
            <ContentBoard
              loading={loading}
              unreadable={unreadable}
              board={board}
              pipeline={pipeline}
              unifiedReason={ready ? data.unified_pipeline_reason : null}
            />
          </Zone>

          <div className="grid gap-4 md:grid-cols-2">
            <Zone title="Master template library" sub="versioned · lives on Contracts">
              {templates?.available ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Templates" value={num(templates.templates)} note="legal template library" />
                    <Stat label="Versions" value={num(templates.versions)} note="archived versions stay binding" />
                  </div>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-axal-muted">
                    The artboard draws the library in this zone, but it already has a page. Two consoles over one
                    store drift apart, so this one counts and points.
                  </p>
                  <Link
                    to={templates.owned_by}
                    className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-violet-700 underline dark:text-violet-300"
                  >
                    Open the template library on Contracts
                  </Link>
                </>
              ) : templates ? (
                <ReadFailure reason={templates.reason} />
              ) : (
                <Pending loading={loading} what="the template library" />
              )}
            </Zone>

            <Zone title="Localisation" sub="Axal-subsidiary brand decisions only">
              {/* D112 — TWO OF THE THREE ABSENCES CLOSED, AND THE THIRD NAMED.
                  A content escalation carries the branch code (attribution) and
                  takes a decision (brand approval). What still does not exist
                  is a LINK saying which piece a submission localises — so this
                  lane counts submissions, and the refusal below says that
                  rather than being deleted.

                  D206 — THE KIND IS SETTLED WHERE THE ESCALATION IS RECORDED,
                  NOT HERE. This note used to say the lane did not filter on
                  kind yet, because reaching it from a branch code is two joins.
                  D206 makes that join at the write instead: `recordEscalation`
                  reads the kind from HQ's own ledger and refuses a white-label's
                  `content` escalation without recording it, and nothing changes
                  a licence's kind after it is issued. So no white-label row can
                  reach this lane to be filtered out, and a filter here would be
                  a second copy of a rule that already has one home.

                  D214 — this zone is the full list behind the board's Brand
                  approval lane, which shows only the oldest three. */}
              <p className="mb-3 text-[12px] leading-relaxed text-axal-muted" data-testid="hq-brand-desk-scope">
                Brand approval is for Axal subsidiaries. A white-label has no HQ brand desk, so HQ refuses
                a white-label&rsquo;s content escalation before recording it, reading the kind from its
                own licence ledger. Nothing here filters by kind because no white-label submission can
                reach this lane.
              </p>
              {lane === UNAVAILABLE && (
                <Unreadable
                  what="Content submissions"
                  claim="This is not a claim that no branch has submitted anything."
                  onRetry={loadLane}
                />
              )}
              {lane && lane !== UNAVAILABLE && !lane.available && (
                <ReadFailure reason={lane.reason} />
              )}
              {laneItems && laneItems.length === 0 && (
                <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-localisation-empty">
                  No branch has submitted content for brand approval. The lane reads escalations of
                  kind <code>content</code>; an empty one means nothing was pushed up, not that
                  nothing can be.
                </p>
              )}
              {laneItems && laneItems.length > 0 && (
                <ul className="space-y-2" data-testid="hq-localisation-lane">
                  {laneItems.map((it) => (
                    <li key={it.uid} className="rounded-xl border border-axal-hairline bg-axal-ground p-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-bold">{it.subject}</div>
                          <div className="mt-0.5 text-[10.5px] text-axal-faint">
                            {it.branch_code} · raised {it.created_at}
                            {it.sla === 'past' ? ' · past SLA' : it.sla === 'due_soon' ? ' · due soon' : ''}
                          </div>
                          <LocalisationRow subjectRef={it.subject_ref} />
                        </div>
                        <span className={`${PILL} ${it.answer ? PILL_GREEN : PILL_AMBER}`}>
                          {it.answer ? 'decided' : 'awaiting'}
                        </span>
                      </div>
                      {it.answer && (
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-axal-muted">
                          {it.answer}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {laneItems && laneItems.length > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-localisation-label-note">
                  An item is named in its branch&rsquo;s own words: a label, not a link. The item lives in
                  the branch&rsquo;s database, which HQ cannot open.
                </p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat
                  label="Submitted for approval"
                  value={laneItems ? String(laneItems.length) : null}
                  note={submittedNote(lane, laneItems)}
                />
                {/* STILL PERMANENTLY BLANK, and for the one reason that did not
                    change: counting localisations needs a link between two
                    pieces, and nothing records one. D208 lets a submission
                    NAME its item, which is not the same thing — a French
                    version of X and a fix to X both name X — so the check the
                    task asked for came out "stays null, narrower reason". */}
                <Stat label="Localised" value={null} note="naming an item does not record a localisation" />
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-axal-muted" data-testid="hq-localisation-reason">
                {ready ? data.localisation_reason : loading ? 'Reading the content summary…' : 'The content summary could not be read.'}
              </p>
            </Zone>
          </div>

          <Zone title="Advisors & Partners — deck roster" sub="read by the decks HQ builds · a branch keeps its own" testid="hq-content-roster">
            <RosterPanel loading={loading} unreadable={unreadable} roster={roster} />
          </Zone>

          <div className="grid gap-4 md:grid-cols-2">
            <Zone title="Assessment Studio" sub="games, chapters, archetypes · authored on HQ only" testid="hq-content-assessment">
              <AssessmentPanel loading={loading} unreadable={unreadable} assessment={assessment} />
            </Zone>
            <Zone title="Personas taxonomy" sub="the set is code · a retag is Admin's" testid="hq-content-personas">
              <PersonasPanel loading={loading} unreadable={unreadable} personas={personas} />
            </Zone>
          </div>
        </div>
      </div>

      <div className="mt-4 lg:mt-0">{rail}</div>
    </div>
  );
}
