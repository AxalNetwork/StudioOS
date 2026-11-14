/**
 * D619 (#1006) — the archetype card page's three sections, from the owner's
 * canvas `Studio · Archetype card` (A24–A30) and the component its artboards
 * import, `Archetype Full Sections`.
 *
 *   Skills    — "Your skills, two ways": the self shape and the evidence dots
 *               on one radar, every axis in the table beside it.
 *   History   — "How your archetype has changed": one point per change of the
 *               displayed archetype, oldest first.
 *   Matches   — "Who you match with": each match type, the members who
 *               published it, and the caller's own publish switch.
 *
 * Presentational. The page reads each source and passes its state down, so a
 * section's Try again re-reads its own source only. A read in flight draws a
 * skeleton and a failed read draws its sentence, never an empty radar or an
 * empty list (A28, A29).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import {
  MATCH_MEMBERS_SHOWN,
  RADAR,
  SKILL_STATE_COPY,
  SKILL_STATE_LEGEND,
  memberRow,
  radarRings,
  radarSpokes,
} from '../../lib/archetypeCardV2';
import { STUDIO_CHAT_ANCHOR } from '../advisor/interviewCompleteRow';

const CARD = 'rounded-[16px] border border-[#ececf1] dark:border-gray-700 bg-white dark:bg-gray-900';
const WELL = 'bg-[#f4f3f7] dark:bg-gray-800';
const MUTED = 'text-[#6b6577] dark:text-gray-400';
const MONO = 'font-mono tabular-nums';

/** The state pill in the table and the legend: the state in form as well as words. */
export const STATE_PILL = {
  not_recorded: 'border border-dashed border-[#d4d1dc] dark:border-gray-600 text-[#6b6577] dark:text-gray-400',
  self_rated_only: 'border border-[#ddd0fb] dark:border-violet-800 bg-[#f4f0fe] dark:bg-violet-950/40 text-[#6d28d9] dark:text-violet-300',
  some_evidence: 'border border-[#fde68a] dark:border-amber-800 bg-[#fffbeb] dark:bg-amber-950/40 text-[#92400e] dark:text-amber-300',
  corroborated: 'border border-[#bbf7d0] dark:border-green-800 bg-[#f0fdf4] dark:bg-green-950/40 text-[#15803d] dark:text-green-300',
  evidence_only: 'border border-[#f59e0b] dark:border-amber-600 text-[#92400e] dark:text-amber-300',
};

function SectionHead({ eyebrow, title, id }) {
  return (
    <div className="flex flex-col gap-[14px]">
      <div className={`${MONO} text-[10px] font-bold uppercase tracking-[0.11em] ${MUTED}`}>{eyebrow}</div>
      <h2 id={id} className="m-0 text-[22px] @max-2xl:text-[18px] font-extrabold tracking-[-0.02em] text-[#18181b] dark:text-gray-100">{title}</h2>
    </div>
  );
}

/** A29 — a failed read: what could not be read, what that does not claim, and Try again. */
function ReadFailed({ text, claim, onRetry, testId }) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[#fecaca] dark:border-red-900 bg-[#fef2f2] dark:bg-red-950/40 px-[22px] py-[18px]"
    >
      <span className="text-[14px] font-semibold text-[#b91c1c] dark:text-red-300">
        {text} <span className="font-normal">{claim}</span>
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-[9px] border border-[#fecaca] dark:border-red-800 px-3 py-2 text-[13px] font-bold text-[#b91c1c] dark:text-red-300 hover:bg-white dark:hover:bg-red-900/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
        >
          Try again
        </button>
      )}
    </div>
  );
}

const bar = (w) => <div className={`h-3 rounded-full ${WELL}`} style={{ width: w }} />;

// ── 1 · Skills ───────────────────────────────────────────────────────────────

const LABEL_SHIFT = { start: 'translate(0,-50%)', end: 'translate(-100%,-50%)', middle: 'translate(-50%,-50%)' };

export function SkillsRadar({ model }) {
  const rings = radarRings(model.labels.length || 8);
  const spokes = radarSpokes(model.labels.length || 8);
  return (
    <div className="relative mx-auto my-[18px] aspect-square w-full max-w-[300px]" data-testid="skills-radar">
      <svg
        viewBox={`0 0 ${RADAR.size} ${RADAR.size}`}
        className="absolute inset-0 h-full w-full overflow-visible"
        role="img"
        aria-label="Skills radar. The table lists every axis."
      >
        {rings.map((r) => (
          <polygon key={r} points={r} fill="none" strokeWidth="1" className="stroke-[#e4e2ec] dark:stroke-[#2f2f3b]" />
        ))}
        {spokes.map((s) => (
          <line key={`${s.x2},${s.y2}`} x1={RADAR.cx} y1={RADAR.cy} x2={s.x2} y2={s.y2} strokeWidth="1" className="stroke-[#e4e2ec] dark:stroke-[#2f2f3b]" />
        ))}
        {model.selfPath && (
          <path d={model.selfPath} fill="rgba(124,58,237,.22)" stroke="#7c3aed" strokeWidth="2" strokeLinejoin="round" data-testid="radar-self" />
        )}
        {model.selfMarks.map((m) => (
          <circle key={m.axis} cx={m.cx} cy={m.cy} r="4.5" fill="#7c3aed" data-testid="radar-self-mark" />
        ))}
        {model.dots.map((d) => (
          <circle
            key={d.axis}
            cx={d.cx}
            cy={d.cy}
            r="5"
            strokeWidth="2"
            className="fill-white dark:fill-gray-900 stroke-[#92400e] dark:stroke-amber-500"
            data-testid="radar-evidence-dot"
          />
        ))}
      </svg>
      {model.labels.map((l) => (
        <span
          key={l.axis}
          className="pointer-events-none absolute whitespace-nowrap text-[10.5px] font-semibold text-[#18181b] dark:text-gray-100"
          style={{ left: l.left, top: l.top, transform: LABEL_SHIFT[l.align] }}
        >
          {l.text}
        </span>
      ))}
      {model.allNotRecorded && (
        <span
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[4px] bg-white dark:bg-gray-900 px-1.5 py-0.5 ${MONO} text-[9.5px] font-semibold uppercase tracking-[0.06em] ${MUTED}`}
          data-testid="radar-all-not-recorded"
        >
          Not recorded
        </span>
      )}
      {model.gaps.map((g) => (
        <span
          key={g.axis}
          className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[4px] bg-white dark:bg-gray-900 px-1 py-px ${MONO} text-[8.5px] font-semibold uppercase tracking-[0.06em] ${MUTED}`}
          style={{ left: g.left, top: g.top }}
          data-testid="radar-gap"
        >
          Not recorded
        </span>
      ))}
      {model.evidenceOnly.map((e) => (
        <span
          key={e.axis}
          className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[4px] bg-white dark:bg-gray-900 px-1 py-px ${MONO} text-[8.5px] font-semibold text-[#92400e] dark:text-amber-400`}
          style={{ left: e.left, top: e.top }}
          data-testid="radar-evidence-only"
        >
          {e.text}
        </span>
      ))}
    </div>
  );
}

const TABLE_ROW = 'grid grid-cols-[minmax(0,1fr)_120px] gap-x-[10px] gap-y-1 px-3 py-[9px] @2xl:grid-cols-[minmax(0,1.4fr)_150px_64px_96px] @2xl:gap-[10px] @2xl:px-[14px] @2xl:py-2';

export function SkillsTable({ rows }) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-[#ececf1] dark:border-gray-700" data-testid="skills-table">
      <div className={`${TABLE_ROW} ${WELL} ${MONO} text-[10px] font-bold uppercase tracking-[0.08em] ${MUTED}`} aria-hidden="true">
        <span>Axis</span><span>State</span><span>Self</span><span>Evidence</span>
      </div>
      <ul className="m-0 list-none p-0">
        {rows.map((r) => (
          <li key={r.axis} className={`${TABLE_ROW} items-center border-t border-[#ececf1] dark:border-gray-700 text-[12.5px]`} data-testid="skills-row">
            <span className="font-semibold text-[#18181b] dark:text-gray-100">{r.label}</span>
            <span>
              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_PILL[r.state] || STATE_PILL.not_recorded}`}>{r.stateText}</span>
            </span>
            <span className={`${MONO} whitespace-nowrap text-[12px] font-medium ${MUTED}`}>
              <span className="sr-only">Self: </span>{r.self ?? '—'}
            </span>
            <span className={`${MONO} whitespace-nowrap text-[12px] font-medium ${MUTED}`}>
              <span className="sr-only">Evidence: </span>{r.evidence ?? '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * state: 'loading' | 'unreadable' | 'ready'. `model` is `radarModel(...)`,
 * required when ready.
 */
export function SkillsSection({ state, model, onRetry }) {
  return (
    <section className="@container flex flex-col gap-[14px]" aria-labelledby="acp-skills" data-testid="archetype-skills">
      <SectionHead eyebrow="Skills" title="Your skills, two ways" id="acp-skills" />
      {state === 'loading' && (
        <div className={`${CARD} grid grid-cols-1 items-center gap-6 p-[22px] @2xl:grid-cols-[260px_minmax(0,1fr)]`} aria-busy="true" data-testid="skills-loading">
          <div className={`mx-auto aspect-square w-full max-w-[260px] rounded-full ${WELL}`} />
          <div className="flex flex-col gap-[10px]">{bar('60%')}{bar('85%')}{bar('40%')}</div>
        </div>
      )}
      {state === 'unreadable' && (
        <ReadFailed text="Your skills could not be read." claim="This is not a claim that none are recorded." onRetry={onRetry} testId="skills-unreadable" />
      )}
      {state === 'ready' && model && (
        <div className={`${CARD} grid grid-cols-1 items-start gap-6 p-[22px] @2xl:grid-cols-[300px_minmax(0,1fr)]`}>
          <div className="flex flex-col gap-3">
            <SkillsRadar model={model} />
            <div className={`flex flex-wrap gap-[14px] text-[12px] ${MUTED}`}>
              <span className="flex items-center gap-1.5">
                <span className="h-[10px] w-[14px] rounded-[3px] border-2 border-[#7c3aed] bg-[rgba(124,58,237,.22)]" aria-hidden="true" />
                Self, 0 to 5
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[10px] w-[10px] rounded-full border-2 border-[#92400e] dark:border-amber-500" aria-hidden="true" />
                Evidence, platform activity
              </span>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <SkillsTable rows={model.rows} />
            <dl className="m-0 flex flex-col gap-1.5" data-testid="skills-legend">
              {SKILL_STATE_LEGEND.map((l) => (
                <div key={l.state} className={`flex items-baseline gap-[10px] text-[12.5px] leading-[1.5] ${MUTED}`}>
                  <dt className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_PILL[l.state]}`}>{SKILL_STATE_COPY[l.state]}</dt>
                  <dd className="m-0">{l.text}</dd>
                </div>
              ))}
            </dl>
            {model.allNotRecorded && (
              <div
                className="flex flex-wrap items-center justify-between gap-[10px] rounded-[12px] border border-dashed border-[#d4d1dc] dark:border-gray-600 px-[14px] py-3"
                data-testid="skills-prompt"
              >
                <span className={`text-[13px] ${MUTED}`}>Answer a few skill questions with Eadwyn to fill this in.</span>
                <Link
                  to={`/studio#${STUDIO_CHAT_ANCHOR}`}
                  className="rounded-[9px] bg-[#7c3aed] px-3 py-2 text-[12.5px] font-bold text-white hover:bg-[#6d28d9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
                >
                  Open Eadwyn
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
      <p className={`m-0 text-[12.5px] leading-[1.55] ${MUTED}`}>
        Evidence counts what you have done on the platform. It is not an assessment of how good you are.
      </p>
    </section>
  );
}

// ── 2 · History ──────────────────────────────────────────────────────────────

/**
 * state: 'loading' | 'unreadable' | 'ready' | 'unclassified'. `view` is
 * `timelineView(...)`; `cardLabel` names the archetype the card shows.
 */
export function HistorySection({ state, view, cardLabel, onRetry }) {
  const points = view?.points || [];
  return (
    <section className="@container flex flex-col gap-[14px]" aria-labelledby="acp-history" data-testid="archetype-history">
      <SectionHead eyebrow="History" title="How your archetype has changed" id="acp-history" />
      {state === 'loading' && (
        <div className={`${CARD} flex items-center gap-6 px-[22px] py-[26px]`} aria-busy="true" data-testid="history-loading">
          <div className={`h-0.5 flex-1 ${WELL}`} /><div className={`h-3.5 w-3.5 rounded-full ${WELL}`} />
          <div className={`h-0.5 flex-1 ${WELL}`} /><div className={`h-3.5 w-3.5 rounded-full ${WELL}`} />
          <div className={`h-0.5 flex-1 ${WELL}`} />
        </div>
      )}
      {state === 'unreadable' && (
        <ReadFailed text="Your history could not be read." claim="This is not a claim that it has not changed." onRetry={onRetry} testId="history-unreadable" />
      )}
      {state === 'unclassified' && (
        <div className={`${CARD} p-[22px] text-[13px] leading-[1.55] ${MUTED}`} data-testid="history-unclassified">
          Not recorded: Eadwyn has not classified you yet.
        </div>
      )}
      {state === 'ready' && (
        <div className={`${CARD} flex flex-col gap-4 p-[22px]`}>
          {points.length === 0 ? (
            <p className={`m-0 text-[13px] leading-[1.55] ${MUTED}`} data-testid="history-none">
              Not recorded yet. Your history starts with the first reading saved with your profile.
            </p>
          ) : (
            <div className="relative">
            <span className="absolute left-0 right-0 top-[9px] hidden h-0.5 bg-[#e4e2ec] dark:bg-[#2f2f3b] @2xl:block" aria-hidden="true" />
            <ol className="relative m-0 flex list-none flex-col items-stretch gap-4 p-0 @2xl:flex-row @2xl:items-start @2xl:gap-0" data-testid="history-points">
              {points.map((p) => (
                <li
                  key={`${p.slug}-${p.at}`}
                  className="relative flex min-w-0 flex-1 flex-row items-start gap-2 px-1.5 text-left @2xl:flex-col @2xl:items-center @2xl:text-center"
                  data-testid="history-point"
                  aria-current={p.current ? 'true' : undefined}
                >
                  <span
                    className={`grid h-5 w-5 flex-none place-items-center rounded-full border-2 ${p.current ? 'border-[#7c3aed] bg-[#7c3aed]' : 'border-[#d4d1dc] dark:border-gray-600 bg-white dark:bg-gray-900'}`}
                    aria-hidden="true"
                  >
                    {p.current && <span className="h-2 w-2 rounded-full bg-white dark:bg-white" />}
                  </span>
                  <div className="flex min-w-0 flex-col gap-[3px]">
                    <span className={`text-[13.5px] ${p.current ? 'font-extrabold text-[#6d28d9] dark:text-violet-300' : 'font-semibold text-[#18181b] dark:text-gray-100'}`}>{p.label}</span>
                    <span className={`${MONO} text-[11px] font-medium ${MUTED}`}>{p.date}</span>
                    <span className={`text-[12px] ${MUTED}`}>{p.triggerText}</span>
                    {p.current && (
                      <span className={`self-start @2xl:self-center rounded-full border border-[#ddd0fb] dark:border-violet-800 bg-[#f4f0fe] dark:bg-violet-950/40 px-2 py-0.5 ${MONO} text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6d28d9] dark:text-violet-300`}>
                        Current
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            </div>
          )}
          {points.length === 1 && points[0].first && (
            <p className={`m-0 text-[13px] leading-[1.55] ${MUTED}`} data-testid="history-single">
              This is your first archetype. Changes appear here as your answers and activity build up.
            </p>
          )}
          {view?.capped && points.length > 0 && (
            <p className={`m-0 text-[12px] leading-[1.5] ${MUTED}`} data-testid="history-capped">
              Changes before {points[0].date} are not shown.
            </p>
          )}
          {points.length > 0 && !view?.agrees && cardLabel && (
            <p className={`m-0 text-[12px] leading-[1.5] ${MUTED}`} data-testid="history-differs">
              The card above shows {cardLabel}. This history follows the archetype saved with your profile, which changes only once a new reading has held for a while.
            </p>
          )}
          <p className={`m-0 text-[12px] leading-[1.5] ${MUTED}`}>
            Triggers: an answer, platform activity, a scheduled review, or an engine update.
          </p>
        </div>
      )}
    </section>
  );
}

// ── 3 · Matches ──────────────────────────────────────────────────────────────

/**
 * The publish banner (A24, A27). `publish` is { state: 'loading' | 'unreadable'
 * | 'ready', published, saving, saveFailed }.
 */
export function PublishBanner({ publish, onToggle, onRetry }) {
  const ready = publish?.state === 'ready';
  const on = ready && publish.published === true;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-[14px] rounded-[14px] border border-[#ddd0fb] dark:border-violet-900 bg-[#f4f0fe] dark:bg-violet-950/30 px-[18px] py-[14px]"
      data-testid="publish-banner"
    >
      <span className="text-[13.5px] leading-[1.5] text-[#18181b] dark:text-gray-100">
        Only members who publish their archetype appear here. Publish yours so they can find you.
      </span>
      {publish?.state === 'loading' && <span className={`h-5 w-24 rounded-full ${WELL}`} aria-busy="true" />}
      {publish?.state === 'unreadable' && (
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-[#b91c1c] dark:text-red-300" role="alert" data-testid="publish-unreadable">
          Whether yours is published could not be read.
          <button type="button" onClick={onRetry} className="underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]">Try again</button>
        </span>
      )}
      {ready && (
        <div className="flex items-center gap-[10px]">
          <span className={`${MONO} text-[11px] font-semibold uppercase tracking-[0.06em] ${MUTED}`} data-testid="publish-state">
            {on ? 'Published' : 'Not published'}
          </span>
          <button
            type="button"
            onClick={() => onToggle?.(!on)}
            disabled={publish.saving}
            aria-busy={publish.saving ? 'true' : undefined}
            className="flex items-center gap-[10px] rounded-full text-[12.5px] font-semibold text-[#18181b] dark:text-gray-100 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
            data-testid="publish-toggle"
          >
            <span className={`relative h-5 w-[34px] flex-none rounded-full ${on ? 'bg-[#7c3aed]' : 'bg-[#d4d1dc] dark:bg-gray-600'}`} aria-hidden="true">
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white dark:bg-white ${on ? 'right-0.5' : 'left-0.5'}`} />
            </span>
            {on ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      )}
      {ready && publish.saveFailed && (
        <span className="w-full text-[12.5px] font-semibold text-[#b91c1c] dark:text-red-300" role="alert" data-testid="publish-not-saved">
          Your choice was not saved. Try again.
        </span>
      )}
    </div>
  );
}

function MatchType({ group }) {
  const [open, setOpen] = useState(false);
  const rows = group.members.map(memberRow);
  const shown = open ? rows : rows.slice(0, MATCH_MEMBERS_SHOWN);
  const more = rows.length - shown.length;
  return (
    <li className={`${CARD} overflow-hidden`} data-testid="match-type">
      <div className="flex flex-col gap-[3px] border-b border-[#ececf1] dark:border-gray-700 px-[18px] py-[14px]">
        <h3 className="m-0 text-[15px] font-extrabold tracking-[-0.01em] text-[#18181b] dark:text-gray-100">{group.label}</h3>
        <p className={`m-0 text-[13px] leading-[1.5] ${MUTED}`}>{group.why}</p>
      </div>
      {rows.length === 0 ? (
        <p className={`m-0 px-[18px] py-[14px] text-[13px] ${MUTED}`} data-testid="match-type-none">No member has published this archetype yet.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {shown.map((m) => (
            <li
              key={m.key}
              className="flex flex-wrap items-center justify-between gap-[10px] border-b border-[#ececf1] dark:border-gray-700 px-[18px] py-[10px] last:border-b-0"
              data-testid="match-member"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-[10px]">
                <span className={`grid h-7 w-7 flex-none place-items-center rounded-full border border-[#ececf1] dark:border-gray-700 ${WELL} text-[10.5px] font-bold ${MUTED}`} aria-hidden="true">
                  {m.initials}
                </span>
                <span className="text-[13.5px] font-semibold text-[#18181b] dark:text-gray-100">{m.name}</span>
                {m.role && <span className={`text-[12.5px] ${MUTED}`}>{m.role}</span>}
                {m.archetype && (
                  <span className={`rounded-full border border-[#ddd0fb] dark:border-violet-800 bg-[#f4f0fe] dark:bg-violet-950/40 px-2 py-0.5 ${MONO} text-[10.5px] font-semibold text-[#6d28d9] dark:text-violet-300`}>
                    {m.archetype}
                  </span>
                )}
              </div>
              {m.values && (
                <span className="whitespace-nowrap rounded-full border border-dashed border-[#d4d1dc] dark:border-gray-600 px-2 py-0.5 text-[11px] font-semibold text-[#52525b] dark:text-gray-300" data-testid="match-values">
                  {m.values}
                </span>
              )}
            </li>
          ))}
          {more > 0 && (
            <li className="border-t border-[#ececf1] dark:border-gray-700">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="w-full px-[18px] py-[10px] text-left text-[12.5px] font-semibold text-[#6d28d9] dark:text-violet-300 hover:bg-[#f4f0fe] dark:hover:bg-violet-950/30 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#7c3aed]"
                data-testid="match-more"
              >
                and {more} more
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/**
 * state: 'loading' | 'unreadable' | 'locked' | 'ready'. `groups` is
 * `matchGroups(slug, reply)`; `reply` carries `more` and `values_fit_reason`.
 */
export function MatchesSection({ state, groups, reply, publish, onTogglePublish, onRetryPublish, onRetry }) {
  return (
    <section className="@container flex flex-col gap-[14px]" aria-labelledby="acp-matches" data-testid="archetype-matches">
      <SectionHead eyebrow="Matches" title="Who you match with" id="acp-matches" />
      {state === 'locked' && (
        <div className={`${CARD} flex flex-wrap items-center justify-between gap-[14px] p-[22px]`} data-testid="matches-locked">
          <div className="flex items-center gap-3">
            <Lock size={18} className="text-[#6b6577] dark:text-gray-400" aria-hidden="true" />
            <span className={`text-[14px] ${MUTED}`}>Matches are not included in your plan.</span>
          </div>
          <Link
            to="/pricing"
            className="rounded-[9px] bg-[#7c3aed] px-[14px] py-[9px] text-[13px] font-bold text-white hover:bg-[#6d28d9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
          >
            See plans
          </Link>
        </div>
      )}
      {state === 'unreadable' && (
        <ReadFailed text="Matches could not be read." claim="This is not a claim that nobody matches." onRetry={onRetry} testId="matches-unreadable" />
      )}
      {state === 'loading' && (
        <div className="flex flex-col gap-3" aria-busy="true" data-testid="matches-loading">
          {[0, 1].map((k) => (
            <div key={k} className={`${CARD} flex flex-col gap-[10px] p-[18px]`}>{bar('35%')}{bar('70%')}</div>
          ))}
        </div>
      )}
      {state === 'ready' && (
        <>
          <PublishBanner publish={publish} onToggle={onTogglePublish} onRetry={onRetryPublish} />
          {reply?.values_fit_reason && (
            <p className={`m-0 text-[12.5px] leading-[1.5] ${MUTED}`} data-testid="matches-values-reason">{reply.values_fit_reason}</p>
          )}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {(groups || []).map((g) => <MatchType key={g.label} group={g} />)}
          </ul>
          {reply?.more && (
            <p className={`m-0 text-[12px] leading-[1.5] ${MUTED}`} data-testid="matches-more-than-shown">
              More members published these archetypes than the 50 read here.
            </p>
          )}
          <p className={`m-0 text-[12px] leading-[1.5] ${MUTED}`}>
            You see a member&apos;s name, role and published archetype, and how your values compare overall. Their scores, traits, skills, values and history stay private.
          </p>
        </>
      )}
    </section>
  );
}
